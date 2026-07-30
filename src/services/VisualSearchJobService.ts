import {store} from '../index';
import {
    VisualSearchAPIClient,
    VisualSearchAPIError,
    visualSearchAPI,
} from '../ai/VisualSearchAPI';
import {TaskTracker} from './TaskTracker';
import {TaskPriority, TaskType} from '../store/tasks/types';
import {
    visualSearchJobCancelRequested,
    visualSearchJobCancelled,
    visualSearchJobFailed,
    visualSearchJobStarted,
    visualSearchJobUpdated,
    VisualSearchActionTypes,
} from '../store/visualSearch/actionCreators';
import {
    VisualSearchQuerySnapshot,
    VisualSearchRemoteError,
    VisualSearchRemoteJob,
    VisualSearchResult,
    VisualSearchSnapshotMetadata,
} from '../store/visualSearch/types';
import {snapshotMetadata} from './QuerySnapshotService';

export interface VisualSearchRunHandle {
    clientJobId: string;
    done: Promise<VisualSearchRemoteJob>;
    cancel: () => Promise<void>;
}

export interface VisualSearchStartOptions {
    title?: string;
    subtitle?: string;
    priority?: TaskPriority;
}

interface JobTaskHandle {
    update(progress?: number, subtitle?: string): void;
    complete(): void;
    fail(error: unknown): void;
    cancel(): void;
}

interface JobTaskRuntime {
    start(options: {
        id: string;
        title: string;
        subtitle?: string;
        priority: TaskPriority;
        onCancel: () => void;
    }): JobTaskHandle;
}

interface VisualSearchJobServiceOptions {
    api?: VisualSearchAPIClient;
    dispatch?: (action: VisualSearchActionTypes) => unknown;
    taskRuntime?: JobTaskRuntime;
    pollIntervalMs?: number;
    timeoutMs?: number;
    now?: () => number;
    delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

interface ActiveRun {
    abortController: AbortController;
    backendTaskId?: string;
    cancelled: boolean;
    cancellation?: Promise<VisualSearchRemoteJob>;
    task: JobTaskHandle;
}

class RemoteVisualSearchError extends Error {
    public readonly remote: VisualSearchRemoteError;

    constructor(remote: VisualSearchRemoteError) {
        super(remote.message);
        this.name = 'RemoteVisualSearchError';
        this.remote = remote;
    }
}

class VisualSearchSnapshotDriftError extends Error {
    constructor(public readonly fields: string[]) {
        super(`Visual search snapshot drift: ${fields.join(', ')}`);
        this.name = 'VisualSearchSnapshotDriftError';
    }
}

const abortError = (): Error => {
    const error = new Error('Visual search cancelled');
    error.name = 'AbortError';
    return error;
};

const abortableDelay = (milliseconds: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(abortError());
            return;
        }
        const delayState: {timer?: ReturnType<typeof setTimeout>} = {};
        const onAbort = () => {
            if (delayState.timer) clearTimeout(delayState.timer);
            reject(abortError());
        };
        delayState.timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, Math.max(0, milliseconds));
        signal.addEventListener('abort', onAbort, {once: true});
    });

const defaultTaskRuntime: JobTaskRuntime = {
    start: options => TaskTracker.startTask({
        type: TaskType.VISUAL_SEARCH,
        priority: options.priority,
        title: options.title,
        subtitle: options.subtitle,
        cancellable: true,
        stableId: options.id,
        onCancel: options.onCancel,
    }),
};

const toRemoteError = (error: unknown): VisualSearchRemoteError => {
    if (error instanceof RemoteVisualSearchError) return error.remote;
    if (error instanceof VisualSearchSnapshotDriftError) {
        return {
            code: 'snapshot_drift',
            message: error.message,
            retryable: false,
        };
    }
    if (error instanceof VisualSearchAPIError) {
        return {
            code: error.code ?? `http_${error.status}`,
            message: error.message,
            retryable: error.status >= 500,
        };
    }
    return {
        code: 'visual_search_failed',
        message: error instanceof Error ? error.message : String(error ?? 'Visual search failed'),
    };
};

const cancelledRemoteJob = (taskId: string): VisualSearchRemoteJob => ({
    taskId,
    state: 'cancelled',
    phase: 'cancelled',
    cancelRequested: true,
});

const unconfirmedCancellation = (
    taskId: string,
    cause: unknown,
): VisualSearchRemoteJob => ({
    taskId,
    state: 'failed',
    phase: 'failed',
    cancelRequested: true,
    error: {
        code: 'cancel_unconfirmed',
        message: `Could not confirm visual-search cancellation: ${
            cause instanceof Error ? cause.message : String(cause)
        }`,
        retryable: true,
    },
});

const sameBBox = (
    left: readonly number[] | null | undefined,
    right: readonly number[] | null | undefined,
): boolean =>
    Boolean(
        left &&
        right &&
        left.length === 4 &&
        right.length === 4 &&
        left.every((value, index) => Math.abs(value - right[index]) <= 1e-6),
    );

const queryContractMismatches = (
    snapshot: VisualSearchSnapshotMetadata,
    result: VisualSearchResult,
): string[] => {
    const mismatches: string[] = [];
    if (result.queryKind !== snapshot.geometry.kind) mismatches.push('query_kind');
    if (result.queryGeometry?.kind !== snapshot.geometry.kind) {
        mismatches.push('query_geometry_kind');
    }
    if (snapshot.geometry.kind !== 'image' &&
        !sameBBox(snapshot.geometry.bbox, result.queryGeometry?.bbox)) {
        mismatches.push('query_geometry_bbox');
    }
    return mismatches;
};

const bindingContractMismatches = (
    snapshot: VisualSearchSnapshotMetadata,
    result: VisualSearchResult,
): string[] => {
    const mismatches: string[] = [];
    if (result.collection !== snapshot.target.collection) mismatches.push('collection');
    if (result.profileId !== snapshot.profile.id) mismatches.push('profile_id');
    if (snapshot.profile.modelRevision !== null &&
        result.modelRevision !== snapshot.profile.modelRevision) {
        mismatches.push('model_revision');
    }
    if (result.collectionRevision === null) {
        mismatches.push('collection_revision_missing');
    } else if (
        snapshot.target.collectionRevision !== undefined &&
        snapshot.target.collectionRevision !== null &&
        String(result.collectionRevision) !== String(snapshot.target.collectionRevision)
    ) {
        mismatches.push('collection_revision');
    }
    return mismatches;
};

const resultItemContractMismatches = (
    snapshot: VisualSearchSnapshotMetadata,
    result: VisualSearchResult,
): string[] => {
    const mismatches: string[] = [];
    const invalidGeometry = result.items.some(item =>
        item.geometry?.kind !== snapshot.geometry.kind);
    if (invalidGeometry) mismatches.push('result_geometry_kind');
    const targetDatasetMismatch = result.items.some(item =>
        snapshot.target.datasetId !== undefined &&
        item.datasetId !== null &&
        item.datasetId !== snapshot.target.datasetId);
    if (targetDatasetMismatch) mismatches.push('target_dataset_id');
    const targetRevisionMismatch = result.items.some(item =>
        snapshot.target.datasetRevision !== undefined &&
        item.datasetRevision !== null &&
        String(item.datasetRevision) !== String(snapshot.target.datasetRevision));
    if (targetRevisionMismatch) mismatches.push('target_dataset_revision');
    return mismatches;
};

export class VisualSearchJobService {
    private readonly api: VisualSearchAPIClient;
    private readonly dispatch: (action: VisualSearchActionTypes) => unknown;
    private readonly taskRuntime: JobTaskRuntime;
    private readonly pollIntervalMs: number;
    private readonly timeoutMs: number;
    private readonly now: () => number;
    private readonly delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    private readonly activeRuns = new Map<string, ActiveRun>();

    constructor(options: VisualSearchJobServiceOptions = {}) {
        this.api = options.api ?? visualSearchAPI;
        this.dispatch = options.dispatch ?? (action => store.dispatch(action));
        this.taskRuntime = options.taskRuntime ?? defaultTaskRuntime;
        this.pollIntervalMs = options.pollIntervalMs ?? 750;
        this.timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
        this.now = options.now ?? Date.now;
        this.delay = options.delay ?? abortableDelay;
    }

    public start(
        snapshot: VisualSearchQuerySnapshot,
        options: VisualSearchStartOptions = {},
    ): VisualSearchRunHandle {
        const clientJobId = snapshot.snapshotId;
        if (this.activeRuns.has(clientJobId)) {
            throw new Error(`visual-search snapshot ${clientJobId} is already running`);
        }

        const abortController = new AbortController();
        const task = this.taskRuntime.start({
            id: `visual-search:${clientJobId}`,
            title: options.title ?? 'Visual search',
            subtitle: options.subtitle ?? snapshot.target.collection,
            priority: options.priority ?? 'P1',
            onCancel: () => {
                void this.cancel(clientJobId);
            },
        });
        const activeRun: ActiveRun = {abortController, cancelled: false, task};
        this.activeRuns.set(clientJobId, activeRun);
        const metadata = snapshotMetadata(snapshot);
        this.dispatch(visualSearchJobStarted(clientJobId, metadata, this.now()));

        const createJob = Promise.resolve().then(() =>
            this.api.createJob(snapshot, activeRun.abortController.signal));
        const done = this.run(clientJobId, metadata, createJob, activeRun)
            .finally(() => this.activeRuns.delete(clientJobId));
        return {
            clientJobId,
            done,
            cancel: () => this.cancel(clientJobId),
        };
    }

    public async cancelByClientJobId(clientJobId: string): Promise<void> {
        await this.cancel(clientJobId);
    }

    public getRunningClientJobIds(): string[] {
        return Array.from(this.activeRuns.keys());
    }

    private async run(
        clientJobId: string,
        metadata: VisualSearchSnapshotMetadata,
        createJob: Promise<VisualSearchRemoteJob>,
        activeRun: ActiveRun,
    ): Promise<VisualSearchRemoteJob> {
        const startedAt = this.now();
        try {
            activeRun.task.update(undefined, 'uploading');
            const created = await createJob;
            activeRun.backendTaskId = created.taskId;
            if (activeRun.cancelled) {
                return this.confirmCancellation(clientJobId, activeRun);
            }
            if (this.handleRemote(clientJobId, metadata, created, activeRun.task)) return created;
            return await this.poll(clientJobId, metadata, activeRun, startedAt);
        } catch (error) {
            if (activeRun.cancelled && activeRun.backendTaskId) {
                return this.confirmCancellation(clientJobId, activeRun);
            }
            const remoteError = toRemoteError(error);
            this.dispatch(visualSearchJobFailed(
                clientJobId,
                remoteError,
                this.now(),
                activeRun.backendTaskId,
            ));
            activeRun.task.fail(error);
            throw error;
        }
    }

    private async poll(
        clientJobId: string,
        metadata: VisualSearchSnapshotMetadata,
        activeRun: ActiveRun,
        startedAt: number,
    ): Promise<VisualSearchRemoteJob> {
        while (!activeRun.cancelled) {
            if (this.now() - startedAt > this.timeoutMs) {
                throw new Error(`Visual search timed out after ${this.timeoutMs}ms`);
            }
            // Poll order is deliberate: wait first so a queued create response
            // remains visible and rapid jobs do not immediately double-request.
            // eslint-disable-next-line no-await-in-loop
            await this.delay(this.pollIntervalMs, activeRun.abortController.signal);
            // eslint-disable-next-line no-await-in-loop
            const remote = await this.api.getJob(
                activeRun.backendTaskId as string,
                activeRun.abortController.signal,
            );
            if (activeRun.cancelled) break;
            if (this.handleRemote(clientJobId, metadata, remote, activeRun.task)) return remote;
        }
        return this.confirmCancellation(clientJobId, activeRun);
    }

    private handleRemote(
        clientJobId: string,
        metadata: VisualSearchSnapshotMetadata,
        remote: VisualSearchRemoteJob,
        task: JobTaskHandle,
    ): boolean {
        if (remote.state === 'succeeded') this.assertExactSnapshot(metadata, remote);
        if (remote.state === 'failed') {
            throw new RemoteVisualSearchError(remote.error ?? {
                code: 'visual_search_failed',
                message: 'Visual search failed',
            });
        }
        this.dispatch(visualSearchJobUpdated(clientJobId, remote, this.now()));
        task.update(remote.progress, remote.phase);
        if (remote.state === 'succeeded') {
            task.complete();
            return true;
        }
        if (remote.state === 'cancelled') {
            task.cancel();
            return true;
        }
        return false;
    }

    private assertExactSnapshot(
        snapshot: VisualSearchSnapshotMetadata,
        remote: VisualSearchRemoteJob,
    ): void {
        const result = remote.result;
        if (!result) throw new Error('completed visual-search task is missing its result');
        const mismatches = [
            ...queryContractMismatches(snapshot, result),
            ...bindingContractMismatches(snapshot, result),
            ...resultItemContractMismatches(snapshot, result),
        ];
        if (mismatches.length > 0) {
            throw new VisualSearchSnapshotDriftError(mismatches);
        }
    }

    private async cancel(clientJobId: string): Promise<void> {
        const activeRun = this.activeRuns.get(clientJobId);
        if (!activeRun) return;
        if (activeRun.cancelled) {
            await activeRun.cancellation;
            return;
        }
        activeRun.cancelled = true;
        // Do not abort an in-flight create request before its task_id arrives:
        // the server may already have accepted it, which would leave an
        // unreachable orphan. Once identified, stop polling and cancel by id.
        if (activeRun.backendTaskId) activeRun.abortController.abort();
        this.dispatch(visualSearchJobCancelRequested(clientJobId, this.now()));
        activeRun.task.update(undefined, 'cancelling');
        if (activeRun.backendTaskId) {
            await this.confirmCancellation(clientJobId, activeRun);
        }
    }

    private confirmCancellation(
        clientJobId: string,
        activeRun: ActiveRun,
    ): Promise<VisualSearchRemoteJob> {
        if (activeRun.cancellation) return activeRun.cancellation;
        const taskId = activeRun.backendTaskId;
        if (!taskId) {
            return Promise.resolve(unconfirmedCancellation(
                clientJobId,
                new Error('task identity is not available yet'),
            ));
        }
        activeRun.cancellation = this.api.cancelJob(taskId).then(remote => {
            if (remote.state !== 'cancelled' && !remote.cancelRequested) {
                throw new Error(`backend returned state=${remote.state}`);
            }
            this.dispatch(visualSearchJobCancelled(clientJobId, this.now()));
            activeRun.task.cancel();
            return cancelledRemoteJob(taskId);
        }).catch(cause => {
            const failed = unconfirmedCancellation(taskId, cause);
            this.dispatch(visualSearchJobFailed(
                clientJobId,
                failed.error as VisualSearchRemoteError,
                this.now(),
                taskId,
            ));
            activeRun.task.fail(cause);
            return failed;
        });
        return activeRun.cancellation;
    }
}

export const visualSearchJobService = new VisualSearchJobService();
