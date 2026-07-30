import {store} from '../index';
import {EditorActions} from '../logic/actions/EditorActions';
import {acceptVisualSearchBBox} from '../store/labels/actionCreators';
import {LabelRect, VisualSearchBBoxAcceptance} from '../store/labels/types';
import {AppState} from '../store';
import {LabelStatus} from '../data/enums/LabelStatus';
import {
    VisualSearchBBox,
    VisualSearchJobState,
    VisualSearchResultItem,
} from '../store/visualSearch/types';

export interface VisualSearchAcceptanceResult {
    imageId: string;
    labelRectId: string;
}

interface VisualSearchAcceptanceOptions {
    getState?: () => AppState;
    dispatch?: (action: ReturnType<typeof acceptVisualSearchBBox>) => unknown;
    digestFile?: (file: File) => Promise<string>;
    afterAccept?: () => void;
}

const normalizeSha256 = (value: string | null | undefined): string | null => {
    const normalized = value?.trim().toLowerCase() ?? '';
    const digest = normalized.startsWith('sha256:')
        ? normalized.slice('sha256:'.length)
        : normalized;
    return /^[0-9a-f]{64}$/.test(digest) ? digest : null;
};

const hex = (bytes: ArrayBuffer): string =>
    Array.from(new Uint8Array(bytes))
        .map(value => value.toString(16).padStart(2, '0'))
        .join('');

const digestFile = async (file: File): Promise<string> => {
    if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is unavailable in this browser');
    return hex(await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
};

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
    left: VisualSearchBBox | null | undefined,
    right: VisualSearchBBox | null | undefined,
): boolean =>
    Boolean(
        left &&
        right &&
        left.every((value, index) => Math.abs(value - right[index]) <= 1e-6),
    );

const resultBBox = (item: VisualSearchResultItem): VisualSearchBBox | null =>
    item.geometry?.bbox ?? item.bbox;

const requireAcceptableJob = (
    state: AppState,
    clientJobId: string,
    resultId: string,
): {job: VisualSearchJobState; item: VisualSearchResultItem} => {
    const job = state.visualSearch.jobsById[clientJobId];
    if (!job || job.status !== 'succeeded' || !job.backendJobId || !job.result) {
        throw new Error('Only a completed visual-search task can be accepted');
    }
    if (job.snapshot.geometry.kind !== 'bbox' ||
        job.result.queryKind !== 'bbox') {
        throw new Error('Only bbox → bbox results can be accepted');
    }
    const item = job.result.items.find(candidate => candidate.resultId === resultId);
    if (!item) throw new Error('The visual-search result is no longer available');
    if (item.geometry?.kind !== 'bbox' || !sameBBox(item.geometry.bbox, item.bbox)) {
        throw new Error('The result does not contain one exact bbox geometry');
    }
    return {job, item};
};

const requireDatasetBinding = (
    state: AppState,
    job: VisualSearchJobState,
    item: VisualSearchResultItem,
): {queueItemId: string; datasetId: string; datasetRevision: string | number} => {
    if (state.video.isVideoMode) {
        throw new Error('Visual-search acceptance is disabled for video frames');
    }
    const datasetId = job.snapshot.target.datasetId;
    const datasetRevision = job.snapshot.target.datasetRevision;
    if (!datasetId || datasetRevision === undefined || datasetRevision === null) {
        throw new Error('The frozen target has no authoritative dataset revision');
    }
    if (item.datasetId !== datasetId ||
        !sameRevision(item.datasetRevision, datasetRevision)) {
        throw new Error('The result dataset revision differs from the frozen target');
    }
    const queueItemId = state.queue.activeQueueItemId;
    const queueItem = state.queue.items.find(candidate => candidate.id === queueItemId);
    if (!queueItem ||
        queueItem.datasetId !== datasetId ||
        !sameRevision(queueItem.datasetRevision, datasetRevision)) {
        throw new Error('Open the exact target dataset revision in the file queue first');
    }
    return {queueItemId: queueItem.id, datasetId, datasetRevision};
};

const requireAssetDigest = (item: VisualSearchResultItem): string => {
    const assetDigest = normalizeSha256(item.assetId);
    const contentDigest = normalizeSha256(item.contentSha256);
    if (!assetDigest || !contentDigest || assetDigest !== contentDigest) {
        throw new Error('The result has no consistent SHA-256 asset identity');
    }
    return assetDigest;
};

const validateBBox = (item: VisualSearchResultItem): VisualSearchBBox => {
    const bbox = resultBBox(item);
    if (!bbox || !item.width || !item.height) {
        throw new Error('The result has no authoritative bbox dimensions');
    }
    if (bbox.some(value => !Number.isFinite(value)) ||
        bbox[0] < 0 ||
        bbox[1] < 0 ||
        bbox[2] > item.width ||
        bbox[3] > item.height ||
        bbox[2] <= bbox[0] ||
        bbox[3] <= bbox[1]) {
        throw new Error('The result bbox is outside its source asset');
    }
    return bbox;
};

export const visualSearchAcceptedRectId = (
    backendJobId: string,
    resultId: string,
): string =>
    `visual-search:${backendJobId}:${resultId}`;

const matchingFileName = (item: VisualSearchResultItem, file: File): boolean => {
    const pathName = item.path.split(/[\\/]/).pop();
    return file.name === item.fileName || file.name === pathName;
};

export class VisualSearchAcceptanceService {
    private readonly getState: () => AppState;
    private readonly dispatch: (action: ReturnType<typeof acceptVisualSearchBBox>) => unknown;
    private readonly fileDigest: (file: File) => Promise<string>;
    private readonly afterAccept: () => void;
    private readonly digestCache = new WeakMap<File, Promise<string>>();

    constructor(options: VisualSearchAcceptanceOptions = {}) {
        this.getState = options.getState ?? (() => store.getState());
        this.dispatch = options.dispatch ?? (action => store.dispatch(action));
        this.fileDigest = options.digestFile ?? digestFile;
        this.afterAccept = options.afterAccept ?? (() => EditorActions.fullRender());
    }

    public async accept(
        clientJobId: string,
        resultId: string,
    ): Promise<VisualSearchAcceptanceResult> {
        const initial = this.getState();
        const {job, item} = requireAcceptableJob(initial, clientJobId, resultId);
        const binding = requireDatasetBinding(initial, job, item);
        const expectedDigest = requireAssetDigest(item);
        const bbox = validateBBox(item);
        const candidates = initial.labels.imagesData.filter(image =>
            matchingFileName(item, image.fileData));
        if (candidates.length === 0) {
            throw new Error('The exact result asset is not loaded in the active queue');
        }

        let target = null as typeof candidates[number] | null;
        for (const candidate of candidates) {
            // Deliberately sequential: a duplicate filename normally resolves on
            // the first hash and we avoid retaining multiple full image buffers.
            // eslint-disable-next-line no-await-in-loop
            const actualDigest = await this.hash(candidate.fileData);
            if (actualDigest === expectedDigest) {
                target = candidate;
                break;
            }
        }
        if (!target) throw new Error('The local file does not match the result asset SHA-256');

        const rectId = visualSearchAcceptedRectId(job.backendJobId as string, item.resultId);
        const currentLabels = this.getState().labels.labels;
        const matchingLabel = item.className
            ? currentLabels.find(label =>
                label.name.toLowerCase() === item.className?.toLowerCase())
            : undefined;
        const labelRect: LabelRect = {
            id: rectId,
            labelId: matchingLabel?.id ?? null,
            rect: {
                x: bbox[0],
                y: bbox[1],
                width: bbox[2] - bbox[0],
                height: bbox[3] - bbox[1],
            },
            isVisible: true,
            isCreatedByAI: true,
            status: LabelStatus.ACCEPTED,
            suggestedLabel: matchingLabel ? null : item.className ?? '',
            confidence: item.confidence ?? item.score,
        };
        const acceptance: VisualSearchBBoxAcceptance = {
            clientJobId,
            backendJobId: job.backendJobId as string,
            resultId,
            queueItemId: binding.queueItemId,
            datasetId: binding.datasetId,
            datasetRevision: binding.datasetRevision,
            assetId: item.assetId as string,
            imageId: target.id,
            expectedFile: target.fileData,
            labelRect,
        };

        // The middleware re-reads all job, queue, dataset, result and File
        // identities synchronously here. Any change while SHA-256 was running
        // aborts the whole action before either labels or undo state can mutate.
        this.dispatch(acceptVisualSearchBBox(acceptance));
        this.afterAccept();
        return {imageId: target.id, labelRectId: rectId};
    }

    private hash(file: File): Promise<string> {
        const cached = this.digestCache.get(file);
        if (cached) return cached;
        const pending = this.fileDigest(file).then(value => {
            const normalized = normalizeSha256(value);
            if (!normalized) throw new Error('The local SHA-256 digest is invalid');
            return normalized;
        });
        this.digestCache.set(file, pending);
        return pending;
    }
}

export const visualSearchAcceptanceService = new VisualSearchAcceptanceService();
