import { LabelName } from '../store/labels/types';
import { QueueItem, QueueItemType } from '../store/queue/types';

export interface StoredExtractionMetadata {
    fps: number;
    duration: number;
    totalFrames: number;
    width: number;
    height: number;
}

export type StoredVideoPlaybackMode = 'on-demand' | 'pre-extracted' | 'raw';

export interface StoredVideoRecoveryData {
    mode: StoredVideoPlaybackMode;
    sourceQueueItemId: string | null;
    sourceFile?: File;
    /** Best-effort fallback only; a stored source or dataset should be reopened first. */
    sessionId?: string;
    metadata: StoredExtractionMetadata;
}

export interface StoredProjectData {
    id: string;
    workspaceId?: string;
    images: StoredImageData[];
    labelNames: LabelName[];
    currentImageIndex: number;
    lastModified: number;
    version: string;
    segmentationResults?: any[];
    isVideoProject?: boolean;
    extractionMetadata?: StoredExtractionMetadata;
    videoRecovery?: StoredVideoRecoveryData;
    imageSegmentationResults?: Record<string, any[]>;
    queueItems?: QueueItem[];
    queueAnnotationSnapshots?: StoredQueueAnnotationSnapshot[];
    activeQueueItemId?: string | null;
}

/**
 * ArrayBuffer is the v2 on-disk representation. File is accepted because
 * IndexedDB preserves File values and recovery v3 stores a video source once.
 */
export type StoredFileData = ArrayBuffer | File;

export interface StoredImageData {
    id: string;
    /** Stable timeline position. Legacy records omit it and use array order. */
    frameIndex?: number;
    /** True when annotations are durable but the frame bytes are a runtime cache. */
    isPlaceholder?: boolean;
    fileName: string;
    fileData: StoredFileData;
    fileType: string;
    loadStatus: boolean;
    labelRects: any[];
    labelPoints: any[];
    labelLines: any[];
    labelPolygons: any[];
    labelNameIds: string[];
}

/** Annotation-only cache for a queue item; source pixels stay on QueueItem/videoRecovery. */
export interface StoredQueueAnnotationFrame {
    id: string;
    frameIndex: number;
    fileName: string;
    fileType: string;
    loadStatus: boolean;
    labelRects: any[];
    labelPoints: any[];
    labelLines: any[];
    labelPolygons: any[];
    labelNameIds: string[];
}

export interface StoredQueueAnnotationSnapshot {
    queueItemId: string;
    frames: StoredQueueAnnotationFrame[];
}

export interface StoredProjectMeta {
    imageCount: number;
    validImageCount: number;
    labelCount: number;
    isVideoProject: boolean;
    hasRecoverableProject: boolean;
    lastModified: number;
}

interface WorkspaceMetaRecord extends StoredProjectMeta {
    id: string;
    projectId: string;
}

interface ResolvedProjectLocation {
    projectId: string;
    workspaceId: string | null;
    meta: StoredProjectMeta;
    legacyProject?: StoredProjectData;
}

interface WorkspaceChannelMessage {
    type: 'probe' | 'claimed';
    workspaceId: string;
    instanceId: string;
    targetInstanceId?: string;
}

interface DismissedForeignSnapshots {
    workspaceId: string;
    revisions: Record<string, number>;
}

/**
 * A failed IndexedDB read is materially different from a missing record.  The
 * restore bootstrap must remain suspended in this case so an empty editor
 * cannot overwrite a recovery snapshot that merely failed to load once.
 */
export class RecoveryStorageReadError extends Error {
    public constructor(operation: string, cause?: unknown) {
        const detail = cause instanceof Error && cause.message ? `：${cause.message}` : '';
        super(`无法读取恢复数据库（${operation}）${detail}`);
        this.name = 'RecoveryStorageReadError';
    }
}

/** The recovery prompt's pinned record vanished before the user confirmed it. */
export class RecoverySnapshotUnavailableError extends Error {
    public constructor() {
        super('已选择的恢复快照已不存在，请重新检查恢复数据');
        this.name = 'RecoverySnapshotUnavailableError';
    }
}

/** The selected mutable workspace row advanced after its metadata was shown. */
export class RecoverySnapshotChangedError extends Error {
    public constructor() {
        super('已选择的恢复快照已更新，请重新检查后再恢复');
        this.name = 'RecoverySnapshotChangedError';
    }
}

export const getStoredFileByteLength = (data: StoredFileData | null | undefined): number => {
    if (!data) return 0;
    if (data instanceof ArrayBuffer) return data.byteLength;
    return typeof data.size === 'number' ? data.size : 0;
};

const hasAnnotations = (image: {
    labelRects?: any[];
    labelPolygons?: any[];
    labelPoints?: any[];
    labelLines?: any[];
}): boolean =>
    (image.labelRects?.length > 0) ||
    (image.labelPolygons?.length > 0) ||
    (image.labelPoints?.length > 0) ||
    (image.labelLines?.length > 0);

interface RecoverableQueueFrame {
    frame: StoredQueueAnnotationFrame;
    recoverable: boolean;
}

const isQueueFrameRecoverable = (
    projectData: StoredProjectData,
    item: QueueItem,
    frameIndex: number,
): boolean => {
    if (item.type === QueueItemType.IMAGE) {
        return getStoredFileByteLength(item.file) > 0;
    }
    if (item.type === QueueItemType.FOLDER) {
        return getStoredFileByteLength(item.files?.[frameIndex]) > 0;
    }
    if (item.type !== QueueItemType.VIDEO) return false;

    const activeVideoRecovery = projectData.videoRecovery?.sourceQueueItemId === item.id
        ? projectData.videoRecovery
        : undefined;
    return Boolean(
        getStoredFileByteLength(item.file) > 0 ||
        getStoredFileByteLength(item.extractedFrames?.[frameIndex]) > 0 ||
        item.datasetId ||
        getStoredFileByteLength(activeVideoRecovery?.sourceFile) > 0 ||
        activeVideoRecovery?.sessionId,
    );
};

const collectRecoverableQueueFrames = (
    projectData: StoredProjectData,
    queueItems: Map<string, QueueItem>,
): RecoverableQueueFrame[] =>
    (projectData.queueAnnotationSnapshots || []).flatMap(snapshot => {
        const item = queueItems.get(snapshot.queueItemId);
        if (!item) return [];
        return snapshot.frames.map(frame => ({
            frame,
            recoverable: isQueueFrameRecoverable(projectData, item, frame.frameIndex),
        }));
    });

const getReconstructableTimelineFrameCount = (
    projectData: StoredProjectData,
    queueItems: Map<string, QueueItem>,
    isVideoProject: boolean,
): number => {
    const activeVideoId = projectData.activeQueueItemId ||
        projectData.videoRecovery?.sourceQueueItemId;
    const activeVideoItem = activeVideoId ? queueItems.get(activeVideoId) : undefined;
    const timelineMetadata = projectData.videoRecovery?.metadata ||
        projectData.extractionMetadata ||
        activeVideoItem?.extractionMetadata;
    const hasReopenableVideoSource = Boolean(
        getStoredFileByteLength(projectData.videoRecovery?.sourceFile) > 0 ||
        projectData.videoRecovery?.sessionId ||
        (activeVideoItem?.type === QueueItemType.VIDEO && (
            activeVideoItem.datasetId ||
            getStoredFileByteLength(activeVideoItem.file) > 0
        )),
    );
    if (!isVideoProject || !hasReopenableVideoSource || !timelineMetadata) return 0;
    return timelineMetadata.totalFrames > 0 ? timelineMetadata.totalFrames : 0;
};

const getRecoveryImageCounts = (
    images: StoredImageData[],
    recoverableImages: StoredImageData[],
    queueFrames: RecoverableQueueFrame[],
    reconstructableTimelineFrameCount: number,
): {imageCount: number; validImageCount: number} => {
    if (queueFrames.length > 0) {
        return {
            imageCount: queueFrames.length,
            validImageCount: queueFrames.filter(({recoverable}) => recoverable).length,
        };
    }
    return {
        imageCount: Math.max(images.length, reconstructableTimelineFrameCount),
        validImageCount: Math.max(
            recoverableImages.length,
            reconstructableTimelineFrameCount,
        ),
    };
};

const getRecoveryLabelCount = (
    recoverableImages: StoredImageData[],
    queueFrames: RecoverableQueueFrame[],
): number => queueFrames.length > 0
    ? queueFrames.filter(({frame, recoverable}) => recoverable && hasAnnotations(frame)).length
    : recoverableImages.filter(hasAnnotations).length;

const hasRecoverableProjectData = (
    projectData: StoredProjectData,
    isVideoProject: boolean,
    hasCameraState: boolean,
    byteBackedImages: StoredImageData[],
    queueFrames: RecoverableQueueFrame[],
    reconstructableTimelineFrameCount: number,
): boolean => {
    const hasVideoState = isVideoProject && Boolean(
        (projectData.images || []).length > 0 ||
        projectData.videoRecovery ||
        projectData.extractionMetadata,
    );
    return hasCameraState ||
        hasVideoState ||
        reconstructableTimelineFrameCount > 0 ||
        byteBackedImages.length > 0 ||
        queueFrames.some(({recoverable}) => recoverable);
};

export class IndexedDBManager {
    private static readonly DB_NAME = 'MakeSenseDB';
    private static readonly DB_VERSION = 2;
    private static readonly PROJECT_STORE_NAME = 'projects';
    private static readonly META_STORE_NAME = 'workspaceMeta';
    private static readonly LEGACY_PROJECT_ID = 'current-project';
    private static readonly PROJECT_PREFIX = 'workspace:';
    private static readonly SESSION_WORKSPACE_KEY = 'opensight-recovery-workspace-id';
    private static readonly DISMISSED_FOREIGN_SNAPSHOT_KEY =
        'opensight-recovery-dismissed-foreign-snapshot';
    private static readonly WORKSPACE_LOCK_PREFIX = 'opensight-recovery-workspace:';
    private static readonly WORKSPACE_CHANNEL_NAME = 'opensight-recovery-workspace-claims';
    private static readonly MAX_DISMISSED_FOREIGN_SNAPSHOTS = 32;
    private static readonly WORKSPACE_RELOAD_HANDOFF_MS = 1000;
    private static readonly OPEN_TIMEOUT_MS = 5000;

    private static db: IDBDatabase | null = null;
    private static initializePromise: Promise<boolean> | null = null;
    private static workspaceId: string | null = null;
    private static workspaceIdWasRestored = false;
    private static workspaceIdentityInitialized = false;
    private static workspaceLockPromise: Promise<unknown> | null = null;
    private static workspaceLockRelease: (() => void) | null = null;
    private static workspaceChannel: BroadcastChannel | null = null;
    private static readonly workspaceInstanceId =
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    private static activeReadProjectId: string | null = null;
    private static activeReadWorkspaceId: string | null = null;
    private static activeReadLastModified: number | null = null;
    private static pinnedReadLocation: ResolvedProjectLocation | null = null;
    private static dismissedForeignSnapshots: DismissedForeignSnapshots | null = null;

    private static generateWorkspaceId(): string {
        return globalThis.crypto?.randomUUID?.()
            || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    public static getWorkspaceId(): string {
        if (this.workspaceId) return this.workspaceId;
        try {
            const storedId = sessionStorage.getItem(this.SESSION_WORKSPACE_KEY);
            if (storedId) {
                this.workspaceId = storedId;
                this.workspaceIdWasRestored = true;
                return storedId;
            }
        } catch {
            // Storage can be disabled in hardened/private browsing contexts.
        }

        const workspaceId = this.generateWorkspaceId();
        this.workspaceId = workspaceId;
        try {
            sessionStorage.setItem(this.SESSION_WORKSPACE_KEY, workspaceId);
        } catch {
            // The in-memory id still isolates this document.
        }
        return workspaceId;
    }

    private static rotateWorkspaceId(): string {
        const workspaceId = this.generateWorkspaceId();
        this.workspaceId = workspaceId;
        this.workspaceIdWasRestored = false;
        try {
            sessionStorage.setItem(this.SESSION_WORKSPACE_KEY, workspaceId);
        } catch {
            // The in-memory id still isolates this document.
        }
        return workspaceId;
    }

    private static canReuseWorkspaceAfterNavigation(): boolean {
        try {
            const navigation = performance.getEntriesByType('navigation')[0] as
                PerformanceNavigationTiming | undefined;
            return navigation?.type === 'reload' || navigation?.type === 'back_forward';
        } catch {
            return false;
        }
    }

    /**
     * Hold an exclusive lock until this document is destroyed. `false` means
     * the identity is already owned (or the lock service failed); `null` means
     * Web Locks is unavailable and the navigation fallback must decide.
     */
    private static claimWorkspaceLock(
        workspaceId: string,
        waitForReloadHandoff = false,
    ): Promise<boolean | null> {
        let lockManager: LockManager | undefined;
        try {
            lockManager = navigator.locks;
        } catch {
            return Promise.resolve(null);
        }
        if (!lockManager?.request) return Promise.resolve(null);

        return new Promise(resolve => {
            let settled = false;
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            let releaseLock: () => void = () => undefined;
            const abortController = waitForReloadHandoff ? new AbortController() : null;
            const holdLock = new Promise<void>(release => {
                releaseLock = release;
            });
            const finish = (claimed: boolean): void => {
                if (settled) return;
                settled = true;
                if (timeoutId) clearTimeout(timeoutId);
                resolve(claimed);
            };

            try {
                if (abortController) {
                    timeoutId = setTimeout(
                        () => abortController.abort(),
                        this.WORKSPACE_RELOAD_HANDOFF_MS,
                    );
                }
                this.workspaceLockPromise = lockManager!.request(
                    `${this.WORKSPACE_LOCK_PREFIX}${workspaceId}`,
                    abortController
                        ? {mode: 'exclusive', signal: abortController.signal}
                        : {mode: 'exclusive', ifAvailable: true},
                    async lock => {
                        if (!lock) {
                            finish(false);
                            return;
                        }
                        this.workspaceLockRelease = releaseLock;
                        finish(true);
                        await holdLock;
                    },
                ).catch(error => {
                    if (!(error instanceof DOMException && error.name === 'AbortError')) {
                        console.warn('[IDB] Workspace lock claim failed:', error);
                    }
                    finish(false);
                });
            } catch (error) {
                console.warn('[IDB] Workspace lock claim failed:', error);
                finish(false);
            }
        });
    }

    private static channelMessageHandler = (event: MessageEvent<WorkspaceChannelMessage>): void => {
        const message = event.data;
        if (!message || message.instanceId === this.workspaceInstanceId) return;
        if (message.type === 'probe' && message.workspaceId === this.workspaceId) {
            this.workspaceChannel?.postMessage({
                type: 'claimed',
                workspaceId: message.workspaceId,
                instanceId: this.workspaceInstanceId,
                targetInstanceId: message.instanceId,
            } as WorkspaceChannelMessage);
        }
    };

    private static initializeWorkspaceChannel(): void {
        if (typeof BroadcastChannel === 'undefined' || this.workspaceChannel) return;
        try {
            this.workspaceChannel = new BroadcastChannel(this.WORKSPACE_CHANNEL_NAME);
            this.workspaceChannel.onmessage = this.channelMessageHandler;
        } catch (error) {
            console.warn('[IDB] Workspace claim channel unavailable:', error);
            this.workspaceChannel = null;
        }
    }

    private static async initializeWorkspaceIdentity(): Promise<void> {
        if (this.workspaceIdentityInitialized) return;
        let workspaceId = this.getWorkspaceId();
        const canWaitForReloadHandoff = this.workspaceIdWasRestored &&
            this.canReuseWorkspaceAfterNavigation();
        const claimResult = await this.claimWorkspaceLock(
            workspaceId,
            canWaitForReloadHandoff,
        );

        if (claimResult === false) {
            // A cloned tab inherited sessionStorage while the source tab still
            // owns the writer lock. Retry once with a fresh unguessable key.
            workspaceId = this.rotateWorkspaceId();
            const rotatedClaim = await this.claimWorkspaceLock(workspaceId, false);
            if (rotatedClaim === false) {
                // A broken lock service must not make us reuse either denied key.
                this.rotateWorkspaceId();
            }
        } else if (claimResult === null &&
            this.workspaceIdWasRestored &&
            !this.canReuseWorkspaceAfterNavigation()) {
            // sessionStorage is copied into duplicated tabs. Without Web Locks,
            // only a real reload is safe to treat as the same writer.
            this.rotateWorkspaceId();
        }

        // BroadcastChannel remains a best-effort diagnostic/responder for older
        // documents, but identity correctness never waits on message delivery.
        this.initializeWorkspaceChannel();
        this.workspaceIdentityInitialized = true;
    }

    private static projectId(workspaceId: string): string {
        return `${this.PROJECT_PREFIX}${workspaceId}`;
    }

    private static requestPersistentStorage = async (): Promise<void> => {
        try {
            if (navigator.storage?.persist) {
                await navigator.storage.persist();
            }
        } catch (error) {
            console.warn('[IDB] Persistent storage request failed:', error);
        }
    };

    /** Read-only readiness signal for recovery UI; initialize() is safe to retry. */
    public static isReady(): boolean {
        return this.db !== null;
    }

    public static async initialize(): Promise<boolean> {
        if (this.db) return true;
        if (this.initializePromise) return this.initializePromise;

        this.initializePromise = (async () => {
            await this.initializeWorkspaceIdentity();
            return new Promise<boolean>((resolve) => {
                let settled = false;
                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                const finish = (result: boolean): void => {
                    if (settled) return;
                    settled = true;
                    if (timeoutId) clearTimeout(timeoutId);
                    resolve(result);
                };
                if (!window.indexedDB) {
                    console.error('浏览器不支持IndexedDB');
                    finish(false);
                    return;
                }

                let request: IDBOpenDBRequest;
                try {
                    request = window.indexedDB.open(this.DB_NAME, this.DB_VERSION);
                } catch (error) {
                    console.error('IndexedDB初始化失败:', error);
                    finish(false);
                    return;
                }
                timeoutId = setTimeout(() => {
                    console.error(
                        '[IDB] Open timed out; close older openSight tabs before retrying recovery storage.',
                    );
                    finish(false);
                }, this.OPEN_TIMEOUT_MS);
                request.onerror = () => {
                    console.error('IndexedDB初始化失败:', request.error);
                    finish(false);
                };
                request.onblocked = () => {
                    console.warn(
                        '[IDB] Database upgrade is blocked by another tab; initialization will time out and can be retried.',
                    );
                };
                request.onupgradeneeded = () => {
                    const database = request.result;
                    if (!database.objectStoreNames.contains(this.PROJECT_STORE_NAME)) {
                        const projectStore = database.createObjectStore(
                            this.PROJECT_STORE_NAME,
                            {keyPath: 'id'},
                        );
                        projectStore.createIndex('lastModified', 'lastModified', {unique: false});
                    }
                    if (!database.objectStoreNames.contains(this.META_STORE_NAME)) {
                        const metaStore = database.createObjectStore(
                            this.META_STORE_NAME,
                            {keyPath: 'id'},
                        );
                        metaStore.createIndex('lastModified', 'lastModified', {unique: false});
                    }
                };
                request.onsuccess = () => {
                    if (settled) {
                        request.result.close();
                        return;
                    }
                    this.db = request.result;
                    this.db.onversionchange = () => {
                        this.db?.close();
                        this.db = null;
                        this.initializePromise = null;
                    };
                    void this.requestPersistentStorage();
                    finish(true);
                };
            });
        })().finally(() => {
            if (!this.db) this.initializePromise = null;
        });

        return this.initializePromise;
    }

    private static buildMeta(
        projectData: StoredProjectData,
        workspaceId: string,
        projectId: string,
        lastModified: number,
    ): WorkspaceMetaRecord {
        const images = projectData.images || [];
        const queueItems = new Map(
            (projectData.queueItems || []).map(item => [item.id, item]),
        );
        const queueFrames = collectRecoverableQueueFrames(projectData, queueItems);
        const activeQueueItem = projectData.activeQueueItemId
            ? queueItems.get(projectData.activeQueueItemId)
            : undefined;
        const hasCameraState = Array.from(queueItems.values()).some(item =>
            item.type === QueueItemType.CAMERA && Boolean(item.cameraResourceId)
        );
        const isVideoProject = Boolean(
            projectData.videoRecovery ||
            projectData.isVideoProject ||
            activeQueueItem?.type === QueueItemType.VIDEO,
        );
        const byteBackedImages = images.filter(image => getStoredFileByteLength(image.fileData) > 0);
        const recoverableImages = isVideoProject ? images : byteBackedImages;
        const reconstructableTimelineFrameCount = getReconstructableTimelineFrameCount(
            projectData,
            queueItems,
            isVideoProject,
        );
        const {imageCount, validImageCount} = getRecoveryImageCounts(
            images,
            recoverableImages,
            queueFrames,
            reconstructableTimelineFrameCount,
        );

        return {
            id: workspaceId,
            projectId,
            imageCount,
            // Video placeholders carry durable annotations and stable frame indices;
            // they are not data loss merely because their pixels are runtime-cached.
            validImageCount,
            labelCount: getRecoveryLabelCount(recoverableImages, queueFrames),
            isVideoProject,
            hasRecoverableProject: hasRecoverableProjectData(
                projectData,
                isVideoProject,
                hasCameraState,
                byteBackedImages,
                queueFrames,
                reconstructableTimelineFrameCount,
            ),
            lastModified,
        };
    }

    public static async saveProject(projectData: StoredProjectData): Promise<boolean> {
        if (!this.db) {
            const initialized = await this.initialize();
            if (!initialized || !this.db) {
                console.error('IndexedDB未初始化');
                return false;
            }
        }

        const workspaceId = this.getWorkspaceId();
        const projectId = this.projectId(workspaceId);
        const lastModified = Date.now();
        const saveData: StoredProjectData = {
            ...projectData,
            id: projectId,
            workspaceId,
            lastModified,
            version: '3.0.0-recovery',
        };
        const meta = this.buildMeta(saveData, workspaceId, projectId, lastModified);
        const consumedForeignWorkspaceId = !this.pinnedReadLocation &&
            this.activeReadWorkspaceId &&
            this.activeReadWorkspaceId !== workspaceId &&
            this.activeReadProjectId !== this.LEGACY_PROJECT_ID
            ? this.activeReadWorkspaceId
            : null;
        const consumedForeignLastModified = consumedForeignWorkspaceId
            ? this.activeReadLastModified
            : null;

        return new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (result: boolean): void => {
                if (settled) return;
                settled = true;
                resolve(result);
            };

            try {
                const transaction = this.db!.transaction(
                    [this.PROJECT_STORE_NAME, this.META_STORE_NAME],
                    'readwrite',
                );
                const projectStore = transaction.objectStore(this.PROJECT_STORE_NAME);
                const metaStore = transaction.objectStore(this.META_STORE_NAME);
                const projectRequest = projectStore.put(saveData);
                const metaRequest = metaStore.put(meta);

                // Remove the single-key v2 record only as part of a committed v3 save.
                projectStore.delete(this.LEGACY_PROJECT_ID);

                transaction.oncomplete = () => {
                    if (consumedForeignWorkspaceId && consumedForeignLastModified !== null) {
                        this.dismissForeignSnapshot(
                            workspaceId,
                            consumedForeignWorkspaceId,
                            consumedForeignLastModified,
                        );
                    }
                    this.activeReadProjectId = projectId;
                    this.activeReadWorkspaceId = workspaceId;
                    this.activeReadLastModified = lastModified;
                    finish(true);
                };
                transaction.onabort = () => {
                    console.error('[IDB] saveProject transaction aborted:', transaction.error);
                    finish(false);
                };
                transaction.onerror = () => {
                    console.error('[IDB] saveProject transaction failed:', transaction.error);
                    finish(false);
                };
                projectRequest.onerror = () => finish(false);
                metaRequest.onerror = () => finish(false);
            } catch (error) {
                console.error('[IDB] saveProject transaction creation failed:', error);
                finish(false);
            }
        });
    }

    private static readProjectById(projectId: string): Promise<StoredProjectData | null> {
        return new Promise((resolve, reject) => {
            if (!this.db) { resolve(null); return; }
            try {
                const transaction = this.db.transaction([this.PROJECT_STORE_NAME], 'readonly');
                const request = transaction.objectStore(this.PROJECT_STORE_NAME).get(projectId);
                transaction.onabort = () => reject(
                    new RecoveryStorageReadError('项目快照', transaction.error),
                );
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(
                    new RecoveryStorageReadError('项目快照', request.error),
                );
            } catch (error) {
                reject(new RecoveryStorageReadError('项目快照', error));
            }
        });
    }

    private static readWorkspaceMeta(workspaceId: string): Promise<WorkspaceMetaRecord | null> {
        return new Promise((resolve, reject) => {
            if (!this.db) { resolve(null); return; }
            try {
                const transaction = this.db.transaction([this.META_STORE_NAME], 'readonly');
                const request = transaction.objectStore(this.META_STORE_NAME).get(workspaceId);
                transaction.onabort = () => reject(
                    new RecoveryStorageReadError('工作区索引', transaction.error),
                );
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(
                    new RecoveryStorageReadError('工作区索引', request.error),
                );
            } catch (error) {
                reject(new RecoveryStorageReadError('工作区索引', error));
            }
        });
    }

    private static readDismissedForeignSnapshots(
        currentWorkspaceId: string,
    ): DismissedForeignSnapshots | null {
        if (this.dismissedForeignSnapshots?.workspaceId === currentWorkspaceId) {
            return this.dismissedForeignSnapshots;
        }
        try {
            const raw = sessionStorage.getItem(this.DISMISSED_FOREIGN_SNAPSHOT_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as Partial<DismissedForeignSnapshots>;
            if (parsed.workspaceId !== currentWorkspaceId ||
                !parsed.revisions ||
                typeof parsed.revisions !== 'object') {
                return null;
            }
            const revisions = Object.fromEntries(
                Object.entries(parsed.revisions)
                    .filter((entry): entry is [string, number] =>
                        typeof entry[1] === 'number' && Number.isFinite(entry[1]))
                    .sort((left, right) => right[1] - left[1])
                    .slice(0, this.MAX_DISMISSED_FOREIGN_SNAPSHOTS),
            );
            this.dismissedForeignSnapshots = {
                workspaceId: currentWorkspaceId,
                revisions,
            };
            return this.dismissedForeignSnapshots;
        } catch {
            return null;
        }
    }

    private static dismissForeignSnapshot(
        currentWorkspaceId: string,
        sourceWorkspaceId: string,
        lastModified: number,
    ): void {
        const previous = this.readDismissedForeignSnapshots(currentWorkspaceId);
        const revisions = {
            ...previous?.revisions,
            [sourceWorkspaceId]: Math.max(
                previous?.revisions[sourceWorkspaceId] || 0,
                lastModified,
            ),
        };
        const boundedRevisions = Object.fromEntries(
            Object.entries(revisions)
                .sort((left, right) => right[1] - left[1])
                .slice(0, this.MAX_DISMISSED_FOREIGN_SNAPSHOTS),
        );
        const dismissal: DismissedForeignSnapshots = {
            workspaceId: currentWorkspaceId,
            revisions: boundedRevisions,
        };
        this.dismissedForeignSnapshots = dismissal;
        try {
            // sessionStorage makes the dismissal survive a reload without
            // suppressing recovery prompts in independent tabs.
            sessionStorage.setItem(
                this.DISMISSED_FOREIGN_SNAPSHOT_KEY,
                JSON.stringify(dismissal),
            );
        } catch {
            // The in-memory watermark still prevents rediscovery before reload.
        }
    }

    private static readLatestWorkspaceMeta(
        currentWorkspaceId: string,
    ): Promise<WorkspaceMetaRecord | null> {
        return new Promise((resolve, reject) => {
            if (!this.db) { resolve(null); return; }
            const dismissed = this.readDismissedForeignSnapshots(currentWorkspaceId);
            try {
                const transaction = this.db.transaction([this.META_STORE_NAME], 'readonly');
                const store = transaction.objectStore(this.META_STORE_NAME);
                const request = store.index('lastModified').openCursor(null, 'prev');
                transaction.onabort = () => reject(
                    new RecoveryStorageReadError('最近工作区索引', transaction.error),
                );
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) { resolve(null); return; }
                    const meta = cursor.value as WorkspaceMetaRecord;
                    const dismissedLastModified = dismissed?.revisions[meta.id];
                    const isDismissedForeignSnapshot = meta.id !== currentWorkspaceId &&
                        dismissedLastModified !== undefined &&
                        meta.lastModified <= dismissedLastModified;
                    if (meta.hasRecoverableProject && !isDismissedForeignSnapshot) {
                        resolve(meta);
                        return;
                    }
                    cursor.continue();
                };
                request.onerror = () => reject(
                    new RecoveryStorageReadError('最近工作区索引', request.error),
                );
            } catch (error) {
                reject(new RecoveryStorageReadError('最近工作区索引', error));
            }
        });
    }

    private static publicMeta(meta: WorkspaceMetaRecord): StoredProjectMeta {
        return {
            imageCount: meta.imageCount,
            validImageCount: meta.validImageCount,
            labelCount: meta.labelCount,
            isVideoProject: meta.isVideoProject,
            hasRecoverableProject: meta.hasRecoverableProject,
            lastModified: meta.lastModified,
        };
    }

    private static async resolveProjectLocation(): Promise<ResolvedProjectLocation | null> {
        const currentWorkspaceId = this.getWorkspaceId();
        const currentMeta = await this.readWorkspaceMeta(currentWorkspaceId);
        if (currentMeta) {
            return {
                projectId: currentMeta.projectId,
                workspaceId: currentWorkspaceId,
                meta: this.publicMeta(currentMeta),
            };
        }

        const latestMeta = await this.readLatestWorkspaceMeta(currentWorkspaceId);
        if (latestMeta) {
            return {
                projectId: latestMeta.projectId,
                workspaceId: latestMeta.id,
                meta: this.publicMeta(latestMeta),
            };
        }

        const legacyProject = await this.readProjectById(this.LEGACY_PROJECT_ID);
        if (!legacyProject) return null;
        return {
            projectId: this.LEGACY_PROJECT_ID,
            workspaceId: null,
            meta: this.publicMeta(this.buildMeta(
                legacyProject,
                'legacy',
                this.LEGACY_PROJECT_ID,
                legacyProject.lastModified || 0,
            )),
            legacyProject,
        };
    }

    public static async loadProject(): Promise<StoredProjectData | null> {
        const pinnedLocation = this.pinnedReadLocation;
        const location = pinnedLocation || await this.resolveProjectLocation();
        if (!location) return null;

        const storedProject = pinnedLocation
            ? await this.readProjectById(location.projectId)
            : location.legacyProject || await this.readProjectById(location.projectId);
        if (!storedProject) {
            if (pinnedLocation) {
                throw new RecoverySnapshotUnavailableError();
            }
            return null;
        }
        if (pinnedLocation && storedProject.lastModified !== location.meta.lastModified) {
            throw new RecoverySnapshotChangedError();
        }

        this.activeReadProjectId = location.projectId;
        this.activeReadWorkspaceId = location.workspaceId;
        this.activeReadLastModified = storedProject.lastModified || location.meta.lastModified;
        this.pinnedReadLocation = null;

        // Localize foreign/legacy data in memory. The first successful autosave
        // will upsert the one record owned by this workspace; an eager full copy
        // here would accumulate records for abandoned or failed restore attempts.
        if (location.workspaceId !== this.getWorkspaceId() ||
            location.projectId === this.LEGACY_PROJECT_ID) {
            return {
                ...storedProject,
                workspaceId: this.getWorkspaceId(),
            };
        }

        return storedProject;
    }

    public static async getProjectMeta(): Promise<StoredProjectMeta | null> {
        this.pinnedReadLocation = null;
        const location = await this.resolveProjectLocation();
        if (!location) {
            this.activeReadProjectId = null;
            this.activeReadWorkspaceId = null;
            this.activeReadLastModified = null;
            return null;
        }
        // Recheck only legacy "empty" metadata. This lets new recovery rules
        // (for example camera-only workspaces with zero image bytes) repair an
        // older false-negative without weakening the exact revision pinned by
        // an already recoverable prompt.
        let currentMeta = location.meta;
        if (!currentMeta.hasRecoverableProject && currentMeta.imageCount === 0) {
            const storedProject = location.legacyProject || await this.readProjectById(location.projectId);
            if (storedProject) {
                currentMeta = this.publicMeta(this.buildMeta(
                    storedProject,
                    location.workspaceId || 'legacy',
                    location.projectId,
                    storedProject.lastModified || location.meta.lastModified,
                ));
            }
        }
        // Pin the exact workspace/project pair displayed by the recovery prompt.
        // loadProject() must not run latest-selection again after user confirmation.
        this.pinnedReadLocation = {
            ...location,
            meta: {...currentMeta},
        };
        this.activeReadProjectId = location.projectId;
        this.activeReadWorkspaceId = location.workspaceId;
        this.activeReadLastModified = currentMeta.lastModified;
        return currentMeta;
    }

    public static async hasStoredProject(): Promise<boolean> {
        const meta = await this.getProjectMeta();
        return meta?.hasRecoverableProject === true;
    }

    public static async clearProject(): Promise<boolean> {
        if (!this.db) return false;

        const currentWorkspaceId = this.getWorkspaceId();
        const projectIds = new Set([
            this.projectId(currentWorkspaceId),
            this.LEGACY_PROJECT_ID,
        ]);
        const workspaceIds = new Set([currentWorkspaceId]);
        const selectedForeignWorkspaceId = this.activeReadWorkspaceId &&
            this.activeReadWorkspaceId !== currentWorkspaceId &&
            this.activeReadProjectId !== this.LEGACY_PROJECT_ID
            ? this.activeReadWorkspaceId
            : null;
        const selectedForeignLastModified = selectedForeignWorkspaceId
            ? this.activeReadLastModified
            : null;

        return new Promise((resolve) => {
            let settled = false;
            const finish = (result: boolean): void => {
                if (settled) return;
                settled = true;
                resolve(result);
            };
            try {
                const transaction = this.db!.transaction(
                    [this.PROJECT_STORE_NAME, this.META_STORE_NAME],
                    'readwrite',
                );
                const projectStore = transaction.objectStore(this.PROJECT_STORE_NAME);
                const metaStore = transaction.objectStore(this.META_STORE_NAME);
                projectIds.forEach(id => projectStore.delete(id));
                workspaceIds.forEach(id => metaStore.delete(id));
                transaction.oncomplete = () => {
                    if (selectedForeignWorkspaceId && selectedForeignLastModified !== null) {
                        this.dismissForeignSnapshot(
                            currentWorkspaceId,
                            selectedForeignWorkspaceId,
                            selectedForeignLastModified,
                        );
                    }
                    this.activeReadProjectId = null;
                    this.activeReadWorkspaceId = null;
                    this.activeReadLastModified = null;
                    this.pinnedReadLocation = null;
                    finish(true);
                };
                transaction.onabort = () => finish(false);
                transaction.onerror = () => finish(false);
            } catch {
                finish(false);
            }
        });
    }

    public static async getStorageInfo(): Promise<{used: number; quota: number}> {
        try {
            if (navigator.storage?.estimate) {
                const estimate = await navigator.storage.estimate();
                return {
                    used: estimate.usage || 0,
                    quota: estimate.quota || 0,
                };
            }
        } catch (error) {
            console.error('获取存储信息失败:', error);
        }
        return {used: 0, quota: 0};
    }
}
