import {
    IndexedDBManager,
    RecoverySnapshotChangedError,
    RecoverySnapshotUnavailableError,
    RecoveryStorageReadError,
    StoredProjectData,
} from '../IndexedDBManager';
import {QueueItemStatus, QueueItemType} from '../../store/queue/types';

const project = (): StoredProjectData => ({
    id: 'current-project',
    images: [],
    labelNames: [],
    currentImageIndex: 0,
    lastModified: 1,
    version: 'legacy',
});

type FakeTransaction = {
    error: Error | null;
    oncomplete?: () => void;
    onabort?: () => void;
    onerror?: () => void;
    objectStore: (name: string) => {
        put: (value: any) => {onerror?: () => void};
        delete: (key: string) => {onerror?: () => void};
    };
};

const transactionHarness = () => {
    const puts: Array<{store: string; value: any}> = [];
    const deletes: Array<{store: string; key: string}> = [];
    const transaction: FakeTransaction = {
        error: null,
        objectStore: (name: string) => ({
            put: (value: any) => {
                puts.push({store: name, value});
                return {};
            },
            delete: (key: string) => {
                deletes.push({store: name, key});
                return {};
            },
        }),
    };
    return {transaction, puts, deletes};
};

describe('IndexedDBManager durability', () => {
    afterEach(() => {
        (IndexedDBManager as any).workspaceLockRelease?.();
        (IndexedDBManager as any).workspaceChannel?.close?.();
        jest.restoreAllMocks();
        jest.useRealTimers();
        sessionStorage.clear();
        Object.assign(IndexedDBManager as any, {
            db: null,
            initializePromise: null,
            workspaceId: null,
            workspaceIdWasRestored: false,
            workspaceIdentityInitialized: false,
            workspaceLockPromise: null,
            workspaceLockRelease: null,
            workspaceChannel: null,
            activeReadProjectId: null,
            activeReadWorkspaceId: null,
            activeReadLastModified: null,
            pinnedReadLocation: null,
            dismissedForeignSnapshots: null,
        });
    });

    it('keeps a restored workspace identity on reload when Web Locks are unavailable', async () => {
        const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
        const originalBroadcastChannel = globalThis.BroadcastChannel;
        const originalGetEntries = Object.getOwnPropertyDescriptor(performance, 'getEntriesByType');
        Object.defineProperty(navigator, 'locks', {configurable: true, value: undefined});
        Object.defineProperty(globalThis, 'BroadcastChannel', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        Object.defineProperty(performance, 'getEntriesByType', {
            configurable: true,
            value: jest.fn(() => [{type: 'reload'} as PerformanceNavigationTiming]),
        });
        sessionStorage.setItem('opensight-recovery-workspace-id', 'tab-stable');

        try {
            await (IndexedDBManager as any).initializeWorkspaceIdentity();

            expect(IndexedDBManager.getWorkspaceId()).toBe('tab-stable');
        } finally {
            if (originalLocks) {
                Object.defineProperty(navigator, 'locks', originalLocks);
            } else {
                delete (navigator as any).locks;
            }
            Object.defineProperty(globalThis, 'BroadcastChannel', {
                configurable: true,
                writable: true,
                value: originalBroadcastChannel,
            });
            if (originalGetEntries) {
                Object.defineProperty(performance, 'getEntriesByType', originalGetEntries);
            } else {
                delete (performance as any).getEntriesByType;
            }
        }
    });

    it('allocates a new workspace identity for an independent tab session', () => {
        jest.spyOn(IndexedDBManager as any, 'generateWorkspaceId')
            .mockReturnValueOnce('tab-a')
            .mockReturnValueOnce('tab-b');

        const firstTab = IndexedDBManager.getWorkspaceId();
        sessionStorage.clear();
        (IndexedDBManager as any).workspaceId = null;
        const secondTab = IndexedDBManager.getWorkspaceId();

        expect(firstTab).toBe('tab-a');
        expect(secondTab).toBe('tab-b');
    });

    it('rotates a cloned identity when the live tab owns its lifetime Web Lock', async () => {
        const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
        const originalBroadcastChannel = globalThis.BroadcastChannel;
        class DelayedBroadcastChannel {
            public onmessage: ((event: any) => void) | null = null;

            public postMessage(): void {
                // A frozen source tab never responds during initialization.
            }

            public close(): void {
                // Test channel owns no native resources.
            }
        }
        const request = jest.fn((name: string, _options: LockOptions, callback: (lock: any) => any) =>
            Promise.resolve(callback(name.endsWith('cloned-tab') ? null : {name})),
        );
        Object.defineProperty(navigator, 'locks', {
            configurable: true,
            value: {request},
        });
        Object.defineProperty(globalThis, 'BroadcastChannel', {
            configurable: true,
            writable: true,
            value: DelayedBroadcastChannel,
        });
        sessionStorage.setItem('opensight-recovery-workspace-id', 'cloned-tab');
        jest.spyOn(IndexedDBManager as any, 'generateWorkspaceId')
            .mockReturnValue('rotated-tab');

        try {
            await (IndexedDBManager as any).initializeWorkspaceIdentity();

            expect(IndexedDBManager.getWorkspaceId()).toBe('rotated-tab');
            expect(sessionStorage.getItem('opensight-recovery-workspace-id'))
                .toBe('rotated-tab');
            expect(request).toHaveBeenNthCalledWith(
                1,
                'opensight-recovery-workspace:cloned-tab',
                {mode: 'exclusive', ifAvailable: true},
                expect.any(Function),
            );
            expect(request).toHaveBeenNthCalledWith(
                2,
                'opensight-recovery-workspace:rotated-tab',
                {mode: 'exclusive', ifAvailable: true},
                expect.any(Function),
            );
        } finally {
            (IndexedDBManager as any).workspaceLockRelease?.();
            if (originalLocks) {
                Object.defineProperty(navigator, 'locks', originalLocks);
            } else {
                delete (navigator as any).locks;
            }
            Object.defineProperty(globalThis, 'BroadcastChannel', {
                configurable: true,
                writable: true,
                value: originalBroadcastChannel,
            });
        }
    });

    it('waits briefly for the previous reload document to hand off its Web Lock', async () => {
        const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
        const originalBroadcastChannel = globalThis.BroadcastChannel;
        const originalGetEntries = Object.getOwnPropertyDescriptor(performance, 'getEntriesByType');
        let grantLock: (() => void) | null = null;
        const request = jest.fn((name: string, options: LockOptions, callback: (lock: any) => any) =>
            new Promise((resolve, reject) => {
                grantLock = () => resolve(callback({name}));
                options.signal?.addEventListener('abort', () => {
                    reject(new DOMException('handoff timed out', 'AbortError'));
                });
            }),
        );
        Object.defineProperty(navigator, 'locks', {
            configurable: true,
            value: {request},
        });
        Object.defineProperty(globalThis, 'BroadcastChannel', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        Object.defineProperty(performance, 'getEntriesByType', {
            configurable: true,
            value: jest.fn(() => [{type: 'reload'} as PerformanceNavigationTiming]),
        });
        sessionStorage.setItem('opensight-recovery-workspace-id', 'reload-tab');
        const generateWorkspaceId = jest.spyOn(IndexedDBManager as any, 'generateWorkspaceId');

        try {
            const initializing = (IndexedDBManager as any).initializeWorkspaceIdentity();
            expect(grantLock).not.toBeNull();
            grantLock!();
            await initializing;

            expect(IndexedDBManager.getWorkspaceId()).toBe('reload-tab');
            expect(generateWorkspaceId).not.toHaveBeenCalled();
            expect(request).toHaveBeenCalledWith(
                'opensight-recovery-workspace:reload-tab',
                expect.objectContaining({
                    mode: 'exclusive',
                    signal: expect.any(AbortSignal),
                }),
                expect.any(Function),
            );
            expect(request.mock.calls[0][1]).not.toHaveProperty('ifAvailable');
        } finally {
            (IndexedDBManager as any).workspaceLockRelease?.();
            if (originalLocks) {
                Object.defineProperty(navigator, 'locks', originalLocks);
            } else {
                delete (navigator as any).locks;
            }
            Object.defineProperty(globalThis, 'BroadcastChannel', {
                configurable: true,
                writable: true,
                value: originalBroadcastChannel,
            });
            if (originalGetEntries) {
                Object.defineProperty(performance, 'getEntriesByType', originalGetEntries);
            } else {
                delete (performance as any).getEntriesByType;
            }
        }
    });

    it('rotates a navigated cloned identity without Web Locks or BroadcastChannel', async () => {
        const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
        const originalBroadcastChannel = globalThis.BroadcastChannel;
        const originalGetEntries = Object.getOwnPropertyDescriptor(performance, 'getEntriesByType');
        Object.defineProperty(navigator, 'locks', {configurable: true, value: undefined});
        Object.defineProperty(globalThis, 'BroadcastChannel', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        Object.defineProperty(performance, 'getEntriesByType', {
            configurable: true,
            value: jest.fn(() => [{type: 'navigate'} as PerformanceNavigationTiming]),
        });
        sessionStorage.setItem('opensight-recovery-workspace-id', 'cloned-tab');
        jest.spyOn(IndexedDBManager as any, 'generateWorkspaceId')
            .mockReturnValue('rotated-without-channel');

        try {
            await (IndexedDBManager as any).initializeWorkspaceIdentity();

            expect(IndexedDBManager.getWorkspaceId()).toBe('rotated-without-channel');
        } finally {
            if (originalLocks) {
                Object.defineProperty(navigator, 'locks', originalLocks);
            } else {
                delete (navigator as any).locks;
            }
            Object.defineProperty(globalThis, 'BroadcastChannel', {
                configurable: true,
                writable: true,
                value: originalBroadcastChannel,
            });
            if (originalGetEntries) {
                Object.defineProperty(performance, 'getEntriesByType', originalGetEntries);
            } else {
                delete (performance as any).getEntriesByType;
            }
        }
    });

    it('bounds a blocked database upgrade and permits a later retry', async () => {
        jest.useFakeTimers();
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const originalIndexedDB = window.indexedDB;
        const lateDatabase = {close: jest.fn()};
        const request: any = {result: lateDatabase};
        const open = jest.fn(() => request);
        Object.defineProperty(window, 'indexedDB', {
            configurable: true,
            value: {open},
        });
        (IndexedDBManager as any).workspaceIdentityInitialized = true;

        try {
            const initializing = IndexedDBManager.initialize();
            await Promise.resolve();
            await Promise.resolve();
            expect(open).toHaveBeenCalledTimes(1);
            request.onblocked?.();

            jest.advanceTimersByTime((IndexedDBManager as any).OPEN_TIMEOUT_MS);
            await expect(initializing).resolves.toBe(false);
            expect((IndexedDBManager as any).initializePromise).toBeNull();
            expect(IndexedDBManager.isReady()).toBe(false);

            request.onsuccess?.();
            expect(lateDatabase.close).toHaveBeenCalledTimes(1);
        } finally {
            Object.defineProperty(window, 'indexedDB', {
                configurable: true,
                value: originalIndexedDB,
            });
        }
    });

    it('exposes database readiness without mutating initialization state', () => {
        expect(IndexedDBManager.isReady()).toBe(false);
        (IndexedDBManager as any).db = {close: jest.fn()};
        expect(IndexedDBManager.isReady()).toBe(true);
    });

    it('reports success only after transaction commit and false on a later abort', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const harness = transactionHarness();
        (IndexedDBManager as any).db = {
            transaction: () => harness.transaction,
        };
        (IndexedDBManager as any).workspaceId = 'tab-a';
        (IndexedDBManager as any).activeReadProjectId = 'workspace:tab-foreign';
        (IndexedDBManager as any).activeReadWorkspaceId = 'tab-foreign';
        (IndexedDBManager as any).activeReadLastModified = 41;
        let settled = false;

        const saving = IndexedDBManager.saveProject(project()).then(result => {
            settled = true;
            return result;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        harness.transaction.error = new Error('QuotaExceededError');
        harness.transaction.onabort?.();
        await expect(saving).resolves.toBe(false);
        expect(sessionStorage.getItem('opensight-recovery-dismissed-foreign-snapshot'))
            .toBeNull();
        expect((IndexedDBManager as any).activeReadWorkspaceId).toBe('tab-foreign');
    });

    it('dismisses the consumed foreign revision only after the first local save commits', async () => {
        const harness = transactionHarness();
        (IndexedDBManager as any).db = {
            transaction: () => harness.transaction,
        };
        (IndexedDBManager as any).workspaceId = 'tab-local';
        (IndexedDBManager as any).activeReadProjectId = 'workspace:tab-foreign';
        (IndexedDBManager as any).activeReadWorkspaceId = 'tab-foreign';
        (IndexedDBManager as any).activeReadLastModified = 41;

        const saving = IndexedDBManager.saveProject(project());
        expect(sessionStorage.getItem('opensight-recovery-dismissed-foreign-snapshot'))
            .toBeNull();
        harness.transaction.oncomplete?.();

        await expect(saving).resolves.toBe(true);
        expect(JSON.parse(sessionStorage.getItem(
            'opensight-recovery-dismissed-foreign-snapshot',
        ) || '{}')).toEqual({
            workspaceId: 'tab-local',
            revisions: {'tab-foreign': 41},
        });
        expect((IndexedDBManager as any).activeReadWorkspaceId).toBe('tab-local');
    });

    it('does not mistake a failed metadata read for an empty recovery store', async () => {
        const request: any = {error: new Error('temporary read failure')};
        const transaction: any = {
            error: null,
            objectStore: () => ({get: () => request}),
        };
        (IndexedDBManager as any).db = {
            transaction: () => transaction,
        };

        const reading = (IndexedDBManager as any).readWorkspaceMeta('tab-a');
        request.onerror?.();

        await expect(reading).rejects.toBeInstanceOf(RecoveryStorageReadError);
    });

    it('isolates project records by workspace key instead of current-project', async () => {
        const first = transactionHarness();
        const second = transactionHarness();
        const transactions = [first.transaction, second.transaction];
        (IndexedDBManager as any).db = {
            transaction: () => transactions.shift(),
        };

        (IndexedDBManager as any).workspaceId = 'tab-a';
        const saveA = IndexedDBManager.saveProject(project());
        first.transaction.oncomplete?.();
        await expect(saveA).resolves.toBe(true);

        (IndexedDBManager as any).workspaceId = 'tab-b';
        const saveB = IndexedDBManager.saveProject(project());
        second.transaction.oncomplete?.();
        await expect(saveB).resolves.toBe(true);

        const projectA = first.puts.find(entry => entry.store === 'projects')?.value;
        const projectB = second.puts.find(entry => entry.store === 'projects')?.value;
        expect(projectA.id).toBe('workspace:tab-a');
        expect(projectB.id).toBe('workspace:tab-b');
        expect(projectA.id).not.toBe(projectB.id);
    });

    it('clears only this workspace and legacy data after viewing another tab snapshot', async () => {
        const harness = transactionHarness();
        (IndexedDBManager as any).db = {
            transaction: () => harness.transaction,
        };
        (IndexedDBManager as any).workspaceId = 'tab-local';
        (IndexedDBManager as any).activeReadProjectId = 'workspace:tab-foreign';
        (IndexedDBManager as any).activeReadWorkspaceId = 'tab-foreign';
        (IndexedDBManager as any).activeReadLastModified = 41;

        const clearing = IndexedDBManager.clearProject();
        harness.transaction.oncomplete?.();
        await expect(clearing).resolves.toBe(true);

        expect(harness.deletes).toEqual(expect.arrayContaining([
            {store: 'projects', key: 'workspace:tab-local'},
            {store: 'projects', key: 'current-project'},
            {store: 'workspaceMeta', key: 'tab-local'},
        ]));
        expect(harness.deletes).not.toEqual(expect.arrayContaining([
            expect.objectContaining({key: 'workspace:tab-foreign'}),
        ]));
        expect(harness.deletes).not.toEqual(expect.arrayContaining([
            expect.objectContaining({key: 'tab-foreign'}),
        ]));
        expect(JSON.parse(sessionStorage.getItem(
            'opensight-recovery-dismissed-foreign-snapshot',
        ) || '{}')).toEqual({
            workspaceId: 'tab-local',
            revisions: {'tab-foreign': 41},
        });
    });

    it('hides a dismissed foreign revision but offers a newer save from that workspace', async () => {
        sessionStorage.setItem('opensight-recovery-dismissed-foreign-snapshot', JSON.stringify({
            workspaceId: 'tab-local',
            revisions: {'tab-foreign': 41},
        }));
        const readLatest = async (lastModified: number): Promise<any> => {
            const request: any = {};
            const cursor: any = {
                value: {
                    id: 'tab-foreign',
                    projectId: 'workspace:tab-foreign',
                    imageCount: 1,
                    validImageCount: 1,
                    labelCount: 0,
                    isVideoProject: false,
                    hasRecoverableProject: true,
                    lastModified,
                },
                continue: () => {
                    request.result = null;
                    request.onsuccess?.();
                },
            };
            const transaction: any = {
                error: null,
                objectStore: () => ({
                    index: () => ({openCursor: () => request}),
                }),
            };
            (IndexedDBManager as any).db = {transaction: () => transaction};
            (IndexedDBManager as any).dismissedForeignSnapshots = null;

            const reading = (IndexedDBManager as any).readLatestWorkspaceMeta('tab-local');
            request.result = cursor;
            request.onsuccess?.();
            return reading;
        };

        await expect(readLatest(41)).resolves.toBeNull();
        await expect(readLatest(42)).resolves.toEqual(expect.objectContaining({
            id: 'tab-foreign',
            lastModified: 42,
        }));
    });

    it('does not persist a foreign dismissal when clear aborts', async () => {
        const harness = transactionHarness();
        (IndexedDBManager as any).db = {
            transaction: () => harness.transaction,
        };
        (IndexedDBManager as any).workspaceId = 'tab-local';
        (IndexedDBManager as any).activeReadProjectId = 'workspace:tab-foreign';
        (IndexedDBManager as any).activeReadWorkspaceId = 'tab-foreign';
        (IndexedDBManager as any).activeReadLastModified = 41;

        const clearing = IndexedDBManager.clearProject();
        harness.transaction.onabort?.();

        await expect(clearing).resolves.toBe(false);
        expect(sessionStorage.getItem('opensight-recovery-dismissed-foreign-snapshot'))
            .toBeNull();
    });

    it('loads a foreign snapshot as copy-on-write without an eager durable copy', async () => {
        const foreignProject = {...project(), id: 'workspace:tab-foreign', workspaceId: 'tab-foreign'};
        (IndexedDBManager as any).db = {};
        (IndexedDBManager as any).workspaceId = 'tab-local';
        jest.spyOn(IndexedDBManager as any, 'resolveProjectLocation').mockResolvedValue({
            projectId: 'workspace:tab-foreign',
            workspaceId: 'tab-foreign',
            meta: {},
        });
        jest.spyOn(IndexedDBManager as any, 'readProjectById').mockResolvedValue(foreignProject);
        const saveProject = jest.spyOn(IndexedDBManager, 'saveProject').mockResolvedValue(true);

        const loaded = await IndexedDBManager.loadProject();

        expect(saveProject).not.toHaveBeenCalled();
        expect(loaded).toEqual(expect.objectContaining({workspaceId: 'tab-local'}));
        expect(foreignProject.workspaceId).toBe('tab-foreign');
    });

    it('loads a legacy record as copy-on-write for the current workspace', async () => {
        const legacy = project();
        (IndexedDBManager as any).db = {};
        (IndexedDBManager as any).workspaceId = 'tab-new';
        jest.spyOn(IndexedDBManager as any, 'readWorkspaceMeta').mockResolvedValue(null);
        jest.spyOn(IndexedDBManager as any, 'readLatestWorkspaceMeta').mockResolvedValue(null);
        jest.spyOn(IndexedDBManager as any, 'readProjectById').mockResolvedValue(legacy);
        const saveProject = jest.spyOn(IndexedDBManager, 'saveProject').mockResolvedValue(true);

        const loaded = await IndexedDBManager.loadProject();

        expect(loaded).toEqual(expect.objectContaining({workspaceId: 'tab-new'}));
        expect(saveProject).not.toHaveBeenCalled();
    });

    it('pins the prompt selection when a different workspace saves before confirmation', async () => {
        const locationA = {
            projectId: 'workspace:tab-a',
            workspaceId: 'tab-a',
            meta: {
                imageCount: 1,
                validImageCount: 1,
                labelCount: 0,
                isVideoProject: false,
                hasRecoverableProject: true,
                lastModified: 10,
            },
        };
        const locationB = {
            ...locationA,
            projectId: 'workspace:tab-b',
            workspaceId: 'tab-b',
            meta: {...locationA.meta, lastModified: 20},
        };
        let latestLocation = locationA;
        (IndexedDBManager as any).db = {};
        (IndexedDBManager as any).workspaceId = 'tab-local';
        const resolveLocation = jest.spyOn(IndexedDBManager as any, 'resolveProjectLocation')
            .mockImplementation(async () => latestLocation);
        const readProject = jest.spyOn(IndexedDBManager as any, 'readProjectById')
            .mockImplementation(async (...args: unknown[]) => {
                const projectId = String(args[0]);
                return projectId === locationA.projectId
                    ? {...project(), id: projectId, workspaceId: 'tab-a', lastModified: 10, version: 'A'}
                    : {...project(), id: projectId, workspaceId: 'tab-b', lastModified: 20, version: 'B'};
            });

        await expect(IndexedDBManager.getProjectMeta()).resolves.toEqual(locationA.meta);
        latestLocation = locationB;
        const loaded = await IndexedDBManager.loadProject();

        expect(resolveLocation).toHaveBeenCalledTimes(1);
        expect(readProject).toHaveBeenCalledWith('workspace:tab-a');
        expect(loaded).toEqual(expect.objectContaining({version: 'A', workspaceId: 'tab-local'}));
    });

    it('reclassifies legacy empty metadata when the stored project is a camera workspace', async () => {
        const location = {
            projectId: 'workspace:tab-camera',
            workspaceId: 'tab-camera',
            meta: {
                imageCount: 0,
                validImageCount: 0,
                labelCount: 0,
                isVideoProject: false,
                hasRecoverableProject: false,
                lastModified: 10,
            },
        };
        const cameraProject: StoredProjectData = {
            ...project(),
            id: location.projectId,
            workspaceId: location.workspaceId,
            lastModified: 10,
            queueItems: [{
                id: 'camera-resource-1',
                name: 'North gate',
                type: QueueItemType.CAMERA,
                status: QueueItemStatus.COMPLETED,
                uploadedAt: 1,
                cameraResourceId: 'resource-1',
                cameraChannelId: '101',
            }],
            activeQueueItemId: 'camera-resource-1',
        };
        (IndexedDBManager as any).db = {};
        (IndexedDBManager as any).workspaceId = 'tab-camera';
        jest.spyOn(IndexedDBManager as any, 'resolveProjectLocation').mockResolvedValue(location);
        const readProject = jest.spyOn(IndexedDBManager as any, 'readProjectById')
            .mockResolvedValue(cameraProject);

        await expect(IndexedDBManager.getProjectMeta()).resolves.toEqual(expect.objectContaining({
            imageCount: 0,
            validImageCount: 0,
            hasRecoverableProject: true,
            lastModified: 10,
        }));
        expect(readProject).toHaveBeenCalledWith(location.projectId);
    });

    it('rejects when the pinned workspace row advances before confirmation', async () => {
        const pinnedLocation = {
            projectId: 'workspace:tab-a',
            workspaceId: 'tab-a',
            meta: {
                imageCount: 1,
                validImageCount: 1,
                labelCount: 0,
                isVideoProject: false,
                hasRecoverableProject: true,
                lastModified: 10,
            },
        };
        (IndexedDBManager as any).db = {};
        (IndexedDBManager as any).workspaceId = 'tab-local';
        jest.spyOn(IndexedDBManager as any, 'resolveProjectLocation')
            .mockResolvedValue(pinnedLocation);
        jest.spyOn(IndexedDBManager as any, 'readProjectById').mockResolvedValue({
            ...project(),
            id: pinnedLocation.projectId,
            workspaceId: pinnedLocation.workspaceId,
            lastModified: 11,
        });

        await IndexedDBManager.getProjectMeta();

        await expect(IndexedDBManager.loadProject())
            .rejects.toBeInstanceOf(RecoverySnapshotChangedError);
    });

    it('rejects instead of selecting another project when the pinned row disappears', async () => {
        const pinnedLocation = {
            projectId: 'workspace:tab-a',
            workspaceId: 'tab-a',
            meta: {
                imageCount: 1,
                validImageCount: 1,
                labelCount: 0,
                isVideoProject: false,
                hasRecoverableProject: true,
                lastModified: 10,
            },
        };
        (IndexedDBManager as any).db = {};
        (IndexedDBManager as any).workspaceId = 'tab-local';
        const resolveLocation = jest.spyOn(IndexedDBManager as any, 'resolveProjectLocation')
            .mockResolvedValue(pinnedLocation);
        jest.spyOn(IndexedDBManager as any, 'readProjectById').mockResolvedValue(null);

        await IndexedDBManager.getProjectMeta();

        await expect(IndexedDBManager.loadProject())
            .rejects.toBeInstanceOf(RecoverySnapshotUnavailableError);
        expect(resolveLocation).toHaveBeenCalledTimes(1);
    });

    it('treats annotated zero-byte video frames as recoverable metadata', async () => {
        const videoProject: StoredProjectData = {
            ...project(),
            isVideoProject: true,
            images: [{
                id: 'frame-0',
                frameIndex: 0,
                isPlaceholder: true,
                fileName: 'frame_000000.jpg',
                fileType: 'image/jpeg',
                fileData: new ArrayBuffer(0),
                loadStatus: false,
                labelRects: [{id: 'r1'}],
                labelPoints: [],
                labelLines: [],
                labelPolygons: [],
                labelNameIds: ['steel'],
            }],
        };
        (IndexedDBManager as any).db = {};
        (IndexedDBManager as any).workspaceId = 'tab-video';
        const buildMeta = (IndexedDBManager as any).buildMeta.bind(IndexedDBManager);
        const meta = buildMeta(videoProject, 'tab-video', 'workspace:tab-video', 10);
        jest.spyOn(IndexedDBManager as any, 'resolveProjectLocation').mockResolvedValue({
            projectId: 'workspace:tab-video',
            workspaceId: 'tab-video',
            meta,
        });

        await expect(IndexedDBManager.hasStoredProject()).resolves.toBe(true);
        await expect(IndexedDBManager.getProjectMeta()).resolves.toEqual(expect.objectContaining({
            validImageCount: 1,
            labelCount: 1,
            hasRecoverableProject: true,
        }));
    });

    it('counts a source-backed empty video timeline from extraction metadata', () => {
        const videoProject: StoredProjectData = {
            ...project(),
            isVideoProject: true,
            images: [],
            videoRecovery: {
                mode: 'on-demand',
                sourceQueueItemId: 'active-video',
                sourceFile: new File(['video-bytes'], 'source.mp4', {type: 'video/mp4'}),
                metadata: {
                    fps: 25,
                    duration: 4,
                    totalFrames: 100,
                    width: 1920,
                    height: 1080,
                },
            },
        };

        const meta = (IndexedDBManager as any).buildMeta(
            videoProject,
            'tab-video',
            'workspace:tab-video',
            10,
        );

        expect(meta).toEqual(expect.objectContaining({
            imageCount: 100,
            validImageCount: 100,
            hasRecoverableProject: true,
        }));

        videoProject.images = [{
            id: 'cached-frame',
            frameIndex: 0,
            isPlaceholder: true,
            fileName: 'frame_000000.jpg',
            fileData: new ArrayBuffer(0),
            fileType: 'image/jpeg',
            loadStatus: false,
            labelRects: [],
            labelPoints: [],
            labelLines: [],
            labelPolygons: [],
            labelNameIds: [],
        }];
        const partialMeta = (IndexedDBManager as any).buildMeta(
            videoProject,
            'tab-video',
            'workspace:tab-video',
            11,
        );
        expect(partialMeta).toEqual(expect.objectContaining({
            imageCount: 100,
            validImageCount: 100,
        }));
    });

    it('counts recoverable inactive queue annotations even when the active image list is empty', () => {
        const queueProject: StoredProjectData = {
            ...project(),
            queueItems: [{
                id: 'inactive-image',
                name: 'inactive.jpg',
                type: QueueItemType.IMAGE,
                file: new File(['pixels'], 'inactive.jpg', {type: 'image/jpeg'}),
                status: QueueItemStatus.COMPLETED,
                uploadedAt: 1,
            }],
            queueAnnotationSnapshots: [{
                queueItemId: 'inactive-image',
                frames: [{
                    id: 'inactive-frame',
                    frameIndex: 0,
                    fileName: 'inactive.jpg',
                    fileType: 'image/jpeg',
                    loadStatus: true,
                    labelRects: [{id: 'rect-1'}],
                    labelPoints: [],
                    labelLines: [],
                    labelPolygons: [],
                    labelNameIds: ['steel'],
                }],
            }],
        };

        const meta = (IndexedDBManager as any).buildMeta(
            queueProject,
            'tab-queue',
            'workspace:tab-queue',
            10,
        );

        expect(meta).toEqual(expect.objectContaining({
            imageCount: 1,
            validImageCount: 1,
            labelCount: 1,
            hasRecoverableProject: true,
        }));
    });

    it('treats a saved camera queue as recoverable without image bytes', () => {
        const cameraProject: StoredProjectData = {
            ...project(),
            images: [],
            queueItems: [{
                id: 'camera-resource-1',
                name: 'North gate',
                type: QueueItemType.CAMERA,
                status: QueueItemStatus.COMPLETED,
                uploadedAt: 1,
                cameraResourceId: 'resource-1',
                cameraChannelId: '101',
                cameraHost: '192.168.10.12',
            }],
            activeQueueItemId: 'camera-resource-1',
        };

        const meta = (IndexedDBManager as any).buildMeta(
            cameraProject,
            'tab-camera',
            'workspace:tab-camera',
            10,
        );

        expect(meta).toEqual(expect.objectContaining({
            imageCount: 0,
            validImageCount: 0,
            hasRecoverableProject: true,
        }));
    });
});
