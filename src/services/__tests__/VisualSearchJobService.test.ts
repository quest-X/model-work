import {VisualSearchAPIClient} from '../../ai/VisualSearchAPI';
import {VisualSearchJobService} from '../VisualSearchJobService';
import {
    initialVisualSearchState,
    visualSearchReducer,
} from '../../store/visualSearch/reducer';
import {VisualSearchActionTypes} from '../../store/visualSearch/actionCreators';
import {
    VisualSearchQuerySnapshot,
    VisualSearchRemoteJob,
    VisualSearchState,
} from '../../store/visualSearch/types';

const snapshot = (): VisualSearchQuerySnapshot => {
    const imageFile = new File(['pixels'], 'query.jpg', {type: 'image/jpeg'});
    return {
        snapshotId: 'snapshot-1',
        capturedAt: 100,
        source: {
            imageId: 'image-1',
            fileName: 'query.jpg',
            mediaKind: 'image',
            datasetId: 'source-dataset',
            datasetRevision: 1,
        },
        profile: {id: 'dinov3-sat', modelRevision: 'model-rev-1'},
        target: {
            collection: 'collection-1',
            collectionRevision: 'collection-rev-1',
            datasetId: 'target-dataset',
            datasetRevision: 2,
        },
        options: {
            topK: 10,
            candidateK: 20,
            idempotencyKey: 'snapshot-1',
        },
        geometry: {kind: 'image'},
        image: {
            fileName: imageFile.name,
            mimeType: imageFile.type,
            size: imageFile.size,
            width: 100,
            height: 80,
        },
        imageFile,
    };
};

const remote = (
    state: VisualSearchRemoteJob['state'],
    extra: Partial<VisualSearchRemoteJob> = {},
): VisualSearchRemoteJob => ({
    taskId: 'task-1',
    state,
    phase: state === 'running' ? 'ranking' : state,
    ...extra,
});

const succeeded = (): VisualSearchRemoteJob => remote('succeeded', {
    progress: 100,
    result: {
        collection: 'collection-1',
        queryKind: 'image',
        queryGeometry: {kind: 'image'},
        profileId: 'dinov3-sat',
        modelRevision: 'model-rev-1',
        collectionRevision: 'collection-rev-1',
        executedStages: ['dino'],
        stageStatus: {dino: 'succeeded'},
        total: 1,
        elapsedMs: 25,
        items: [{
            resultId: 'result-1',
            assetId: 'asset-1',
            datasetId: 'target-dataset',
            datasetRevision: 2,
            rank: 1,
            path: '/data/goose.jpg',
            fileName: 'goose.jpg',
            width: 1920,
            height: 1080,
            className: 'goose',
            confidence: null,
            score: 0.9,
            dinoScore: 0.9,
            bbox: null,
            thumbnail: null,
            contentSha256: 'sha256:image',
            regionId: null,
            granularity: 'image',
            regionSource: null,
            geometrySha256: null,
            acceptanceEligible: null,
            acceptanceReason: null,
            geometry: {kind: 'image'},
        }],
    },
});

const taskRuntime = () => {
    const handle = {
        update: jest.fn(),
        complete: jest.fn(),
        fail: jest.fn(),
        cancel: jest.fn(),
    };
    return {
        handle,
        runtime: {start: jest.fn().mockReturnValue(handle)},
    };
};

const reducerDispatch = () => {
    let state: VisualSearchState = initialVisualSearchState;
    const dispatch = jest.fn((action: VisualSearchActionTypes) => {
        state = visualSearchReducer(state, action);
        return action;
    });
    return {dispatch, getState: () => state};
};

describe('VisualSearchJobService', () => {
    it('publishes queued/running/succeeded phases and completes Task Manager', async () => {
        const api: VisualSearchAPIClient = {
            createJob: jest.fn().mockResolvedValue(remote('queued')),
            getJob: jest.fn()
                .mockResolvedValueOnce(remote('running', {progress: 45}))
                .mockResolvedValueOnce(succeeded()),
            cancelJob: jest.fn(),
        };
        const task = taskRuntime();
        const state = reducerDispatch();
        const service = new VisualSearchJobService({
            api,
            dispatch: state.dispatch,
            taskRuntime: task.runtime,
            delay: async () => undefined,
            now: () => 1000,
        });

        const result = await service.start(snapshot()).done;

        expect(result.state).toBe('succeeded');
        expect(api.getJob).toHaveBeenCalledTimes(2);
        expect(task.handle.update).toHaveBeenCalledWith(45, 'ranking');
        expect(task.handle.complete).toHaveBeenCalledTimes(1);
        expect(state.getState().jobsById['snapshot-1']).toEqual(expect.objectContaining({
            backendJobId: 'task-1',
            status: 'succeeded',
            phase: 'succeeded',
            result: expect.objectContaining({profileId: 'dinov3-sat'}),
        }));
        expect(state.getState().jobsById['snapshot-1'].snapshot).not.toHaveProperty('imageFile');
        expect(service.getRunningClientJobIds()).toEqual([]);
    });

    it('cancels both the poll request and the backend task', async () => {
        const api: VisualSearchAPIClient = {
            createJob: jest.fn().mockResolvedValue(remote('queued')),
            getJob: jest.fn(),
            cancelJob: jest.fn().mockResolvedValue(remote('cancelled')),
        };
        const task = taskRuntime();
        const state = reducerDispatch();
        const delay = jest.fn((_milliseconds: number, signal: AbortSignal) =>
            new Promise<void>((_resolve, reject) => {
                signal.addEventListener('abort', () => {
                    const error = new Error('cancelled');
                    error.name = 'AbortError';
                    reject(error);
                }, {once: true});
            }));
        const service = new VisualSearchJobService({
            api,
            dispatch: state.dispatch,
            taskRuntime: task.runtime,
            delay,
        });

        const run = service.start(snapshot());
        await Promise.resolve();
        await Promise.resolve();
        await run.cancel();
        const result = await run.done;

        expect(result.state).toBe('cancelled');
        expect(api.cancelJob).toHaveBeenCalledWith('task-1');
        expect(task.handle.cancel).toHaveBeenCalledTimes(1);
        expect(state.getState().jobsById['snapshot-1'].status).toBe('cancelled');
    });

    it('waits for task identity before cancelling an in-flight create request', async () => {
        let resolveCreate: ((job: VisualSearchRemoteJob) => void) | undefined;
        let createSignal: AbortSignal | undefined;
        const api: VisualSearchAPIClient = {
            createJob: jest.fn((_snapshot, signal) => {
                createSignal = signal;
                return new Promise(resolve => {
                    resolveCreate = resolve;
                });
            }),
            getJob: jest.fn(),
            cancelJob: jest.fn().mockResolvedValue(remote('cancelled')),
        };
        const state = reducerDispatch();
        const service = new VisualSearchJobService({
            api,
            dispatch: state.dispatch,
            taskRuntime: taskRuntime().runtime,
        });

        const run = service.start(snapshot());
        await Promise.resolve();
        await run.cancel();
        expect(createSignal?.aborted).toBe(false);

        resolveCreate?.(remote('queued'));
        const result = await run.done;
        expect(result.state).toBe('cancelled');
        expect(api.cancelJob).toHaveBeenCalledWith('task-1');
    });

    it('surfaces an unconfirmed backend cancellation as a retryable failure', async () => {
        let resolveCreate: ((job: VisualSearchRemoteJob) => void) | undefined;
        const api: VisualSearchAPIClient = {
            createJob: jest.fn(() => new Promise(resolve => {
                resolveCreate = resolve;
            })),
            getJob: jest.fn(),
            cancelJob: jest.fn().mockRejectedValue(new Error('gateway offline')),
        };
        const task = taskRuntime();
        const state = reducerDispatch();
        const service = new VisualSearchJobService({
            api,
            dispatch: state.dispatch,
            taskRuntime: task.runtime,
        });

        const run = service.start(snapshot());
        await Promise.resolve();
        await run.cancel();
        expect(state.getState().jobsById['snapshot-1']).toEqual(expect.objectContaining({
            status: 'submitting',
            phase: 'cancelling',
            cancelRequested: true,
        }));

        resolveCreate?.(remote('queued'));
        const result = await run.done;
        expect(result).toEqual(expect.objectContaining({
            state: 'failed',
            error: expect.objectContaining({
                code: 'cancel_unconfirmed',
                retryable: true,
            }),
        }));
        expect(state.getState().jobsById['snapshot-1']).toEqual(expect.objectContaining({
            status: 'failed',
            error: expect.objectContaining({code: 'cancel_unconfirmed'}),
        }));
        expect(task.handle.fail).toHaveBeenCalledTimes(1);
    });

    it('fails closed when backend execution drifts from the frozen snapshot', async () => {
        const drifted = succeeded();
        drifted.result = {...drifted.result, modelRevision: 'model-rev-2'};
        const api: VisualSearchAPIClient = {
            createJob: jest.fn().mockResolvedValue(drifted),
            getJob: jest.fn(),
            cancelJob: jest.fn(),
        };
        const task = taskRuntime();
        const state = reducerDispatch();
        const service = new VisualSearchJobService({
            api,
            dispatch: state.dispatch,
            taskRuntime: task.runtime,
        });

        await expect(service.start(snapshot()).done).rejects.toThrow(
            'snapshot drift: model_revision',
        );
        expect(task.handle.fail).toHaveBeenCalledTimes(1);
        expect(state.getState().jobsById['snapshot-1']).toEqual(expect.objectContaining({
            status: 'failed',
            backendJobId: 'task-1',
            error: expect.objectContaining({code: 'snapshot_drift'}),
        }));
    });

    it('rejects query/result geometry kind substitution', async () => {
        const substituted = succeeded();
        const exactResult = substituted.result;
        if (!exactResult) throw new Error('test fixture is missing result');
        substituted.result = {
            ...exactResult,
            queryKind: 'bbox',
            queryGeometry: {kind: 'bbox', bbox: [1, 2, 3, 4]},
            items: exactResult.items.map(item => ({
                ...item,
                geometry: {kind: 'bbox', bbox: [1, 2, 3, 4]},
            })),
        };
        const task = taskRuntime();
        const state = reducerDispatch();
        const service = new VisualSearchJobService({
            api: {
                createJob: jest.fn().mockResolvedValue(substituted),
                getJob: jest.fn(),
                cancelJob: jest.fn(),
            },
            dispatch: state.dispatch,
            taskRuntime: task.runtime,
        });

        await expect(service.start(snapshot()).done).rejects.toThrow('query_kind');
        expect(state.getState().jobsById['snapshot-1'].error).toEqual(
            expect.objectContaining({
                code: 'snapshot_drift',
                message: expect.stringContaining('result_geometry_kind'),
            }),
        );
    });

    it('rejects collection substitution and changed query coordinates', async () => {
        const query = snapshot();
        query.geometry = {kind: 'bbox', bbox: [1, 2, 30, 40]};
        const substituted = succeeded();
        const exactResult = substituted.result;
        if (!exactResult) throw new Error('test fixture is missing result');
        substituted.result = {
            ...exactResult,
            collection: 'another-collection',
            queryKind: 'bbox',
            queryGeometry: {kind: 'bbox', bbox: [1, 2, 31, 40]},
            items: exactResult.items.map(item => ({
                ...item,
                bbox: [5, 6, 20, 30],
                geometry: {kind: 'bbox', bbox: [5, 6, 20, 30]},
            })),
        };
        const state = reducerDispatch();
        const service = new VisualSearchJobService({
            api: {
                createJob: jest.fn().mockResolvedValue(substituted),
                getJob: jest.fn(),
                cancelJob: jest.fn(),
            },
            dispatch: state.dispatch,
            taskRuntime: taskRuntime().runtime,
        });

        await expect(service.start(query).done).rejects.toThrow('collection');
        expect(state.getState().jobsById['snapshot-1'].error?.message).toContain(
            'query_geometry_bbox',
        );
    });

    it('requires the backend-frozen collection revision even when catalog omitted it', async () => {
        const query = snapshot();
        query.target = {...query.target, collectionRevision: null};
        const unpinned = succeeded();
        if (!unpinned.result) throw new Error('test fixture is missing result');
        unpinned.result = {...unpinned.result, collectionRevision: null};
        const state = reducerDispatch();
        const service = new VisualSearchJobService({
            api: {
                createJob: jest.fn().mockResolvedValue(unpinned),
                getJob: jest.fn(),
                cancelJob: jest.fn(),
            },
            dispatch: state.dispatch,
            taskRuntime: taskRuntime().runtime,
        });

        await expect(service.start(query).done).rejects.toThrow(
            'collection_revision_missing',
        );
    });

    it('rejects duplicate concurrent starts for one immutable snapshot', () => {
        const api: VisualSearchAPIClient = {
            createJob: jest.fn(() => new Promise(() => undefined)),
            getJob: jest.fn(),
            cancelJob: jest.fn(),
        };
        const task = taskRuntime();
        const service = new VisualSearchJobService({
            api,
            dispatch: jest.fn(),
            taskRuntime: task.runtime,
        });
        service.start(snapshot());

        expect(() => service.start(snapshot())).toThrow('already running');
    });
});
