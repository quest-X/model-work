import {Middleware} from 'redux';
import {Action} from '../../store/Actions';
import {UndoStack, RestoreFlag, UndoSnapshot} from './UndoStack';
import {AppState} from '../../store';
import {
    ImageData,
    LabelsActionTypes,
    VisualSearchBBoxAcceptance,
    VisualSearchMaskAcceptance,
} from '../../store/labels/types';
import {VisualSearchResultItem} from '../../store/visualSearch/types';
import {
    parseVisualSearchMaskComponent,
    validateVisualSearchMaskGroup,
    ValidatedVisualSearchMaskComponent,
} from '../../utils/VisualSearchMaskProvenance';

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

type AcceptVisualSearchMaskAction = Extract<
    LabelsActionTypes,
    {type: Action.ACCEPT_VISUAL_SEARCH_MASK}
>;

type AcceptVisualSearchAction = AcceptVisualSearchBBoxAction | AcceptVisualSearchMaskAction;
type VisualSearchAcceptance = VisualSearchBBoxAcceptance | VisualSearchMaskAcceptance;

const samePolygons = (
    left: ReadonlyArray<ReadonlyArray<readonly [number, number]>> | null | undefined,
    right: ReadonlyArray<ReadonlyArray<readonly [number, number]>> | null | undefined,
): boolean => Boolean(left && right && left.length === right.length && left.every(
    (polygon, polygonIndex) => polygon.length === right[polygonIndex].length && polygon.every(
        (point, pointIndex) => point.length === 2 &&
            point.every((value, axis) =>
                Math.abs(value - right[polygonIndex][pointIndex][axis]) <= 1e-6),
    ),
));

const sameMask = (
    left: VisualSearchMaskAcceptance['mask'] | null | undefined,
    right: VisualSearchMaskAcceptance['mask'] | null | undefined,
): boolean => Boolean(left && right &&
    left.encoding === right.encoding &&
    left.order === right.order &&
    left.size[0] === right.size[0] &&
    left.size[1] === right.size[1] &&
    left.countsBase64 === right.countsBase64);

// The CAS intentionally enumerates every mutable identity boundary.
// eslint-disable-next-line complexity
const assertCommonAcceptanceCAS = (
    state: AppState,
    acceptance: VisualSearchAcceptance,
    kind: 'bbox' | 'mask',
): {result: VisualSearchResultItem; image: ImageData} => {
    const job = state.visualSearch.jobsById[acceptance.clientJobId];
    if (!job || job.status !== 'succeeded') acceptanceCASFailure('job_state');
    if (job.backendJobId !== acceptance.backendJobId) acceptanceCASFailure('task_id');
    if (job.snapshot.geometry.kind !== kind || job.result?.queryKind !== kind) {
        acceptanceCASFailure('query_kind');
    }
    if (job.snapshot.target.datasetId !== acceptance.datasetId ||
        !sameRevision(job.snapshot.target.datasetRevision, acceptance.datasetRevision)) {
        acceptanceCASFailure('snapshot_dataset_revision');
    }
    const result = job.result?.items.find(item => item.resultId === acceptance.resultId);
    if (!result) acceptanceCASFailure('result_id');
    if (result.assetId !== acceptance.assetId ||
        result.contentSha256 !== acceptance.contentSha256 ||
        result.datasetId !== acceptance.datasetId ||
        !sameRevision(result.datasetRevision, acceptance.datasetRevision)) {
        acceptanceCASFailure('result_asset_revision');
    }
    if (state.queue.activeQueueItemId !== acceptance.queueItemId) {
        acceptanceCASFailure('active_queue');
    }
    const queueItem = state.queue.items.find(item => item.id === acceptance.queueItemId);
    if (!queueItem) {
        acceptanceCASFailure('queue_item');
    }
    if (queueItem.datasetId !== acceptance.datasetId ||
        !sameRevision(queueItem.datasetRevision, acceptance.queueDatasetRevision)) {
        acceptanceCASFailure('queue_dataset_revision');
    }
    const image = state.labels.imagesData.find(item => item.id === acceptance.imageId);
    if (!image || image.fileData !== acceptance.expectedFile) {
        acceptanceCASFailure('image_identity');
    }
    return {result, image};
};

const assertBBoxAcceptanceCAS = (
    state: AppState,
    action: AcceptVisualSearchBBoxAction,
): void => {
    const acceptance = action.payload;
    const {result, image} = assertCommonAcceptanceCAS(state, acceptance, 'bbox');
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
    if (image.labelRects.some(rect => rect.id === acceptance.labelRect.id)) {
        acceptanceCASFailure('already_accepted');
    }
};

const assertMaskLabels = (
    acceptance: VisualSearchMaskAcceptance,
): void => {
    if (acceptance.labelPolygons.length !== acceptance.sourcePolygons.length ||
        acceptance.labelPolygons.length === 0) acceptanceCASFailure('mask_labels');
    const ids = new Set<string>();
    const components: ValidatedVisualSearchMaskComponent[] = [];
    acceptance.labelPolygons.forEach((label, index) => {
        const expectedId = `visual-search:${acceptance.backendJobId}:` +
            `${acceptance.resultId}:mask:${index}`;
        const vertices = label.vertices.map(point => [point.x, point.y] as const);
        if (label.id !== expectedId ||
            !samePolygons([vertices], [acceptance.sourcePolygons[index]]) ||
            ids.has(label.id)) acceptanceCASFailure('mask_labels');
        ids.add(label.id);
        try {
            const component = parseVisualSearchMaskComponent(label);
            if (!component) acceptanceCASFailure('mask_provenance');
            components.push(component as ValidatedVisualSearchMaskComponent);
        } catch {
            acceptanceCASFailure('mask_provenance');
        }
    });
    let validated: ValidatedVisualSearchMaskComponent[];
    try {
        validated = validateVisualSearchMaskGroup(components);
    } catch {
        acceptanceCASFailure('mask_provenance');
    }
    validated.forEach(component => {
        const provenance = component.provenance;
        if (provenance.clientJobId !== acceptance.clientJobId ||
            provenance.backendJobId !== acceptance.backendJobId ||
            provenance.resultId !== acceptance.resultId ||
            provenance.assetId !== acceptance.assetId ||
            provenance.geometrySha256 !== acceptance.geometrySha256 ||
            provenance.rasterizerRevision !== acceptance.rasterizerRevision ||
            provenance.datasetId !== acceptance.datasetId ||
            !sameRevision(provenance.datasetRevision, acceptance.datasetRevision) ||
            provenance.componentCount !== acceptance.labelPolygons.length) {
            acceptanceCASFailure('mask_provenance');
        }
    });
};

const assertMaskAcceptanceCAS = (
    state: AppState,
    action: AcceptVisualSearchMaskAction,
): void => {
    const acceptance = action.payload;
    const {result, image} = assertCommonAcceptanceCAS(state, acceptance, 'mask');
    if (result.geometry?.kind !== 'mask' ||
        result.granularity !== 'mask' ||
        result.geometrySha256 !== acceptance.geometrySha256 ||
        result.geometry.rasterizerRevision !== acceptance.rasterizerRevision ||
        result.acceptanceEligible !== true ||
        Boolean(result.acceptanceReason) ||
        !sameMask(result.geometry.mask, acceptance.mask) ||
        !samePolygons(result.geometry.polygons, acceptance.sourcePolygons)) {
        acceptanceCASFailure('result_geometry');
    }
    assertMaskLabels(acceptance);
    const acceptedIds = new Set(acceptance.labelPolygons.map(polygon => polygon.id));
    if (image.labelPolygons.some(polygon => acceptedIds.has(polygon.id))) {
        acceptanceCASFailure('already_accepted');
    }
};

const assertVisualSearchAcceptanceCAS = (
    state: AppState,
    action: AcceptVisualSearchAction,
): void => {
    if (action.type === Action.ACCEPT_VISUAL_SEARCH_BBOX) {
        assertBBoxAcceptanceCAS(state, action);
    } else {
        assertMaskAcceptanceCAS(state, action);
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
    if (action?.type === Action.ACCEPT_VISUAL_SEARCH_BBOX ||
        action?.type === Action.ACCEPT_VISUAL_SEARCH_MASK) {
        const before = store.getState();
        assertVisualSearchAcceptanceCAS(before, action as AcceptVisualSearchAction);
        if (!RestoreFlag.get()) UndoStack.push(takeSnapshot(before));
        const result = next(action);
        lastSnapshot = takeSnapshot(store.getState());
        lastSnapshotTime = performance.now();
        return result;
    }
    const restoring = RestoreFlag.get();
    if (!restoring && action && SNAPSHOT_ACTIONS.has(action.type) && lastSnapshot) {
        UndoStack.push(lastSnapshot);
    }
    const result = next(action);
    if (action && LABEL_STATE_ACTIONS.has(action.type)) {
        const now = performance.now();
        // Restore actions must replace the cache immediately. Otherwise an undo
        // followed within 300 ms by a normal edit can push the pre-undo state and
        // resurrect the accepted visual-search result on the next undo.
        if (restoring || now - lastSnapshotTime >= SNAPSHOT_MIN_INTERVAL_MS) {
            lastSnapshot = takeSnapshot(store.getState());
            lastSnapshotTime = now;
        }
    } else if (lastSnapshot === null && action) {
        // First dispatch after boot — seed the snapshot so the first mutation is undoable
        lastSnapshot = takeSnapshot(store.getState());
    }
    return result;
};
