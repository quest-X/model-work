import {store} from '../index';
import {EditorActions} from '../logic/actions/EditorActions';
import {acceptVisualSearchBBox, acceptVisualSearchMask} from '../store/labels/actionCreators';
import {
    LabelPolygon,
    LabelRect,
    VisualSearchBBoxAcceptance,
    VisualSearchMaskAcceptance,
} from '../store/labels/types';
import {AppState} from '../store';
import {LabelStatus} from '../data/enums/LabelStatus';
import {sha256File} from '../utils/Sha256';
import {
    VisualSearchBBox,
    VisualSearchJobState,
    VisualSearchResultItem,
} from '../store/visualSearch/types';
import {
    verifyVisualSearchMaskGeometry,
    VisualSearchMaskGeometryInput,
} from './VisualSearchMaskGeometry';

export interface VisualSearchAcceptanceResult {
    imageId: string;
    labelRectId?: string;
    labelPolygonIds?: string[];
}

interface VisualSearchAcceptanceOptions {
    getState?: () => AppState;
    dispatch?: (action: ReturnType<typeof acceptVisualSearchBBox>) => unknown;
    digestFile?: (file: File) => Promise<string>;
    verifyMaskGeometry?: (
        input: VisualSearchMaskGeometryInput,
    ) => Promise<ReadonlyArray<ReadonlyArray<readonly [number, number]>>>;
    afterAccept?: () => void;
}

type VerifyMaskGeometry = NonNullable<VisualSearchAcceptanceOptions['verifyMaskGeometry']>;

const normalizeSha256 = (value: string | null | undefined): string | null => {
    const normalized = value?.trim().toLowerCase() ?? '';
    const digest = normalized.startsWith('sha256:')
        ? normalized.slice('sha256:'.length)
        : normalized;
    return /^[0-9a-f]{64}$/.test(digest) ? digest : null;
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
    const kind = job.snapshot.geometry.kind;
    if ((kind !== 'bbox' && kind !== 'mask') || job.result.queryKind !== kind) {
        throw new Error('Only same-kind bbox or mask results can be accepted');
    }
    const item = job.result.items.find(candidate => candidate.resultId === resultId);
    if (!item) throw new Error('The visual-search result is no longer available');
    if (item.geometry?.kind !== kind || !sameBBox(item.geometry.bbox, item.bbox)) {
        throw new Error(`The result does not contain exact ${kind} geometry`);
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
    if (!item.assetId?.trim()) {
        throw new Error('The result has no stable asset identity');
    }
    const contentDigest = normalizeSha256(item.contentSha256);
    if (!contentDigest) {
        throw new Error('The result has no valid SHA-256 content identity');
    }
    return contentDigest;
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

export const visualSearchAcceptedMaskPolygonId = (
    backendJobId: string,
    resultId: string,
    componentIndex: number,
): string =>
    `visual-search:${backendJobId}:${resultId}:mask:${componentIndex}`;

const matchingFileName = (item: VisualSearchResultItem, file: File): boolean => {
    const pathName = item.path.split(/[\\/]/).pop();
    return file.name === item.fileName || file.name === pathName;
};

const freezeResultItem = (item: VisualSearchResultItem): VisualSearchResultItem => ({
    ...item,
    bbox: item.bbox ? [...item.bbox] as VisualSearchBBox : null,
    geometry: item.geometry ? {
        ...item.geometry,
        bbox: item.geometry.bbox
            ? [...item.geometry.bbox] as VisualSearchBBox
            : item.geometry.bbox,
        polygons: item.geometry.polygons?.map(polygon =>
            polygon.map(point => [...point] as const)) ?? item.geometry.polygons,
        mask: item.geometry.mask ? {
            ...item.geometry.mask,
            size: [...item.geometry.mask.size] as [number, number],
        } : item.geometry.mask,
    } : null,
});

export class VisualSearchAcceptanceService {
    private readonly getState: () => AppState;
    private readonly dispatch: (action: ReturnType<typeof acceptVisualSearchBBox>) => unknown;
    private readonly fileDigest: (file: File) => Promise<string>;
    private readonly verifyMask: VerifyMaskGeometry;
    private readonly afterAccept: () => void;
    private readonly digestCache = new WeakMap<File, Promise<string>>();

    constructor(options: VisualSearchAcceptanceOptions = {}) {
        this.getState = options.getState ?? (() => store.getState());
        this.dispatch = options.dispatch ?? (action => store.dispatch(action));
        this.fileDigest = options.digestFile ?? sha256File;
        this.verifyMask = options.verifyMaskGeometry ?? verifyVisualSearchMaskGeometry;
        this.afterAccept = options.afterAccept ?? (() => EditorActions.fullRender());
    }

    public async accept(
        clientJobId: string,
        resultId: string,
    ): Promise<VisualSearchAcceptanceResult> {
        const initial = this.getState();
        const {job, item: currentItem} = requireAcceptableJob(initial, clientJobId, resultId);
        const item = freezeResultItem(currentItem);
        const backendJobId = job.backendJobId as string;
        const binding = requireDatasetBinding(initial, job, item);
        const expectedDigest = requireAssetDigest(item);
        const bbox = validateBBox(item);
        const sourcePolygons = item.geometry?.kind === 'mask'
            ? await this.requireMaskGeometry(item)
            : null;
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

        const currentLabels = this.getState().labels.labels;
        const matchingLabel = item.className
            ? currentLabels.find(label =>
                label.name.toLowerCase() === item.className?.toLowerCase())
            : undefined;
        if (sourcePolygons) {
            return this.acceptMask(
                clientJobId,
                backendJobId,
                item,
                binding,
                target,
                sourcePolygons,
                matchingLabel?.id ?? null,
            );
        }
        return this.acceptBBox(
            clientJobId,
            backendJobId,
            item,
            binding,
            target,
            bbox,
            matchingLabel?.id ?? null,
        );
    }

    private acceptBBox(
        clientJobId: string,
        backendJobId: string,
        item: VisualSearchResultItem,
        binding: ReturnType<typeof requireDatasetBinding>,
        target: AppState['labels']['imagesData'][number],
        bbox: VisualSearchBBox,
        labelId: string | null,
    ): VisualSearchAcceptanceResult {
        const rectId = visualSearchAcceptedRectId(backendJobId, item.resultId);
        const labelRect: LabelRect = {
            id: rectId,
            labelId,
            rect: {
                x: bbox[0],
                y: bbox[1],
                width: bbox[2] - bbox[0],
                height: bbox[3] - bbox[1],
            },
            isVisible: true,
            isCreatedByAI: true,
            status: LabelStatus.ACCEPTED,
            suggestedLabel: labelId ? null : item.className ?? '',
            confidence: item.confidence ?? item.score,
        };
        const acceptance: VisualSearchBBoxAcceptance = {
            clientJobId,
            backendJobId,
            resultId: item.resultId,
            queueItemId: binding.queueItemId,
            datasetId: binding.datasetId,
            datasetRevision: binding.datasetRevision,
            assetId: item.assetId as string,
            contentSha256: item.contentSha256 as string,
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

    private acceptMask(
        clientJobId: string,
        backendJobId: string,
        item: VisualSearchResultItem,
        binding: ReturnType<typeof requireDatasetBinding>,
        target: AppState['labels']['imagesData'][number],
        sourcePolygons: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
        labelId: string | null,
    ): VisualSearchAcceptanceResult {
        const labelPolygons: LabelPolygon[] = sourcePolygons.map((polygon, index) => ({
            id: visualSearchAcceptedMaskPolygonId(backendJobId, item.resultId, index),
            labelId,
            vertices: polygon.map(point => ({x: point[0], y: point[1]})),
            isVisible: true,
            isCreatedByAI: true,
            status: LabelStatus.ACCEPTED,
            suggestedLabel: labelId ? null : item.className ?? '',
            confidence: item.confidence ?? item.score,
            extra: {
                visualSearch: {
                    schemaVersion: 1,
                    clientJobId,
                    backendJobId,
                    resultId: item.resultId,
                    componentIndex: index,
                    componentCount: sourcePolygons.length,
                    assetId: item.assetId,
                    geometrySha256: item.geometrySha256,
                    rasterizerRevision: item.geometry?.rasterizerRevision,
                    regionId: item.regionId,
                    datasetId: binding.datasetId,
                    datasetRevision: binding.datasetRevision,
                },
            },
        }));
        const acceptance: VisualSearchMaskAcceptance = {
            clientJobId,
            backendJobId,
            resultId: item.resultId,
            queueItemId: binding.queueItemId,
            datasetId: binding.datasetId,
            datasetRevision: binding.datasetRevision,
            assetId: item.assetId as string,
            contentSha256: item.contentSha256 as string,
            geometrySha256: item.geometrySha256 as string,
            rasterizerRevision: item.geometry?.rasterizerRevision as string,
            imageId: target.id,
            expectedFile: target.fileData,
            mask: item.geometry?.mask as VisualSearchMaskAcceptance['mask'],
            sourcePolygons,
            labelPolygons,
        };
        this.dispatch(acceptVisualSearchMask(acceptance));
        this.afterAccept();
        return {
            imageId: target.id,
            labelPolygonIds: labelPolygons.map(polygon => polygon.id),
        };
    }

    private async requireMaskGeometry(
        item: VisualSearchResultItem,
    ): Promise<ReadonlyArray<ReadonlyArray<readonly [number, number]>>> {
        if (item.acceptanceEligible !== true || item.acceptanceReason) {
            throw new Error(
                `The mask result is preview-only: ${item.acceptanceReason || 'not eligible'}`,
            );
        }
        return this.verifyMask({
            mask: item.geometry?.mask,
            polygons: item.geometry?.polygons,
            bbox: item.geometry?.bbox ?? item.bbox,
            width: item.width,
            height: item.height,
            geometrySha256: item.geometrySha256,
            rasterizerRevision: item.geometry?.rasterizerRevision,
        });
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
