import {Middleware} from 'redux';
import {Action} from '../../store/Actions';
import {UndoStack, RestoreFlag, UndoSnapshot} from './UndoStack';
import {AppState} from '../../store';
import {ImageData, LabelsActionTypes} from '../../store/labels/types';
import {QueueItemType} from '../../store/queue/types';

// Actions whose "before" state we want on the undo stack
const SNAPSHOT_ACTIONS = new Set<string>([
    Action.UPDATE_IMAGE_DATA_BY_ID,
    Action.UPDATE_IMAGES_DATA,
    Action.DELETE_IMAGE_BY_ID,
    Action.DELETE_SELECTED_IMAGES
]);

// Actions that change labels state and should refresh the cached clean snapshot
const LABEL_STATE_ACTIONS = new Set<string>([
    Action.UPDATE_IMAGE_DATA_BY_ID,
    Action.UPDATE_IMAGES_DATA,
    Action.ADD_IMAGES_DATA,
    Action.DELETE_IMAGE_BY_ID,
    Action.DELETE_SELECTED_IMAGES,
    Action.UPDATE_LABEL_NAMES
]);

const sameRevision = (
    left: string | number | null | undefined,
    right: string | number | null | undefined,
): boolean =>
    left !== null &&
    left !== undefined &&
    right !== null &&
    right !== undefined &&
    String(left) === String(right);

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

const acceptanceCASFailure = (field: string): never => {
    throw new Error(`visual_search_acceptance_cas: ${field}`);
};

type AcceptVisualSearchBBoxAction = Extract<
    LabelsActionTypes,
    {type: Action.ACCEPT_VISUAL_SEARCH_BBOX}
>;

// The acceptance gate intentionally enumerates every identity boundary so a
// partial check can never turn into a partial write.
// eslint-disable-next-line complexity
const assertVisualSearchAcceptanceCAS = (
    state: AppState,
    action: AcceptVisualSearchBBoxAction,
): void => {
    const acceptance = action.payload;
    const job = state.visualSearch.jobsById[acceptance.clientJobId];
    if (!job || job.status !== 'succeeded') acceptanceCASFailure('job_state');
    if (job.backendJobId !== acceptance.backendJobId) acceptanceCASFailure('task_id');
    if (job.snapshot.geometry.kind !== 'bbox' || job.result?.queryKind !== 'bbox') {
        acceptanceCASFailure('query_kind');
    }
    if (job.snapshot.target.datasetId !== acceptance.datasetId ||
        !sameRevision(job.snapshot.target.datasetRevision, acceptance.datasetRevision)) {
        acceptanceCASFailure('snapshot_dataset_revision');
    }

    const result = job.result?.items.find(item => item.resultId === acceptance.resultId);
    if (!result) acceptanceCASFailure('result_id');
    if (result.assetId !== acceptance.assetId ||
        result.datasetId !== acceptance.datasetId ||
        !sameRevision(result.datasetRevision, acceptance.datasetRevision)) {
        acceptanceCASFailure('result_asset_revision');
    }
    const resultBBox = result.geometry?.bbox ?? result.bbox;
    const acceptedBBox = [
        acceptance.labelRect.rect.x,
        acceptance.labelRect.rect.y,
        acceptance.labelRect.rect.x + acceptance.labelRect.rect.width,
        acceptance.labelRect.rect.y + acceptance.labelRect.rect.height,
    ];
    if (result.geometry?.kind !== 'bbox' || !sameBBox(resultBBox, acceptedBBox)) {
        acceptanceCASFailure('result_geometry');
    }

    if (state.video.isVideoMode) acceptanceCASFailure('video_mode');
    if (state.queue.activeQueueItemId !== acceptance.queueItemId) {
        acceptanceCASFailure('active_queue');
    }
    const queueItem = state.queue.items.find(item => item.id === acceptance.queueItemId);
    if (!queueItem || queueItem.type === QueueItemType.VIDEO) {
        acceptanceCASFailure('queue_item');
    }
    if (queueItem.datasetId !== acceptance.datasetId ||
        !sameRevision(queueItem.datasetRevision, acceptance.datasetRevision)) {
        acceptanceCASFailure('queue_dataset_revision');
    }

    const image = state.labels.imagesData.find(item => item.id === acceptance.imageId);
    if (!image || image.fileData !== acceptance.expectedFile) {
        acceptanceCASFailure('image_identity');
    }
    if (image.labelRects.some(rect => rect.id === acceptance.labelRect.id)) {
        acceptanceCASFailure('already_accepted');
    }
};

const clone: <T>(value: T) => T = typeof (globalThis as any).structuredClone === 'function'
    ? (v) => (globalThis as any).structuredClone(v)
    : (v) => JSON.parse(JSON.stringify(v));

function cloneImageData(list: ImageData[]): ImageData[] {
    // File objects in fileData can't be structured-cloned reliably in all envs; preserve reference.
    return list.map(d => ({
        ...d,
        labelRects: clone(d.labelRects),
        labelPoints: clone(d.labelPoints),
        labelLines: clone(d.labelLines),
        labelPolygons: clone(d.labelPolygons),
        labelNameIds: [...d.labelNameIds]
    }));
}

// Cached deep-clone of the most recent clean state. Because render engines mutate
// ImageData in place before dispatching, we cannot snapshot inside the middleware
// at dispatch time — state is already dirty. Instead, after every label-state
// change we cache a deep clone; on the next mutation we push that clean cache.
let lastSnapshot: UndoSnapshot | null = null;

// Throttle snapshots: structuredClone of 15k+ ImageData entries costs ~50-100ms.
// During playback, UPDATE_IMAGE_DATA_BY_ID fires on every frame (25+ times/sec),
// causing >2.5s of cloning overhead per 16s of playback. Throttle to at most
// one snapshot every 300ms — still captures undo points for interactive edits,
// while eliminating 90%+ of cloning during rapid-fire dispatches.
let lastSnapshotTime = 0;
const SNAPSHOT_MIN_INTERVAL_MS = 300;

function takeSnapshot(state: AppState): UndoSnapshot {
    return {
        imagesData: cloneImageData(state.labels.imagesData),
        labels: [...state.labels.labels]
    };
}

export const undoMiddleware: Middleware<Record<string, never>, AppState> =
store => next => (action: any) => {
    if (action?.type === Action.ACCEPT_VISUAL_SEARCH_BBOX) {
        const before = store.getState();
        assertVisualSearchAcceptanceCAS(before, action as AcceptVisualSearchBBoxAction);
        if (!RestoreFlag.get()) UndoStack.push(takeSnapshot(before));
        const result = next(action);
        lastSnapshot = takeSnapshot(store.getState());
        lastSnapshotTime = performance.now();
        return result;
    }
    if (!RestoreFlag.get() && action && SNAPSHOT_ACTIONS.has(action.type) && lastSnapshot) {
        UndoStack.push(lastSnapshot);
    }
    const result = next(action);
    if (action && LABEL_STATE_ACTIONS.has(action.type)) {
        const now = performance.now();
        if (now - lastSnapshotTime >= SNAPSHOT_MIN_INTERVAL_MS) {
            lastSnapshot = takeSnapshot(store.getState());
            lastSnapshotTime = now;
        }
    } else if (lastSnapshot === null && action) {
        // First dispatch after boot — seed the snapshot so the first mutation is undoable
        lastSnapshot = takeSnapshot(store.getState());
    }
    return result;
};
