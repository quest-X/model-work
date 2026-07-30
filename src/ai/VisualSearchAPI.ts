import {getExtensionEngineBaseUrl} from '../utils/DefaultBackendUrl';
import {
    VisualSearchBBox,
    VisualSearchQueryKind,
    VisualSearchQuerySnapshot,
    VisualSearchRemoteError,
    VisualSearchRemoteJob,
    VisualSearchRemoteState,
    VisualSearchResult,
    VisualSearchResultGeometry,
    VisualSearchResultItem,
    VisualSearchRevision,
} from '../store/visualSearch/types';

type JsonObject = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface VisualSearchAPIClient {
    createJob(snapshot: VisualSearchQuerySnapshot, signal?: AbortSignal): Promise<VisualSearchRemoteJob>;
    getJob(taskId: string, signal?: AbortSignal): Promise<VisualSearchRemoteJob>;
    cancelJob(taskId: string, signal?: AbortSignal): Promise<VisualSearchRemoteJob>;
}

export interface VisualSearchAPIOptions {
    baseUrl?: string | (() => string);
    fetchImpl?: FetchLike;
}

export class VisualSearchAPIError extends Error {
    public readonly status: number;
    public readonly code?: string;
    public readonly detail: unknown;

    constructor(message: string, status: number, code?: string, detail?: unknown) {
        super(message);
        this.name = 'VisualSearchAPIError';
        this.status = status;
        this.code = code;
        this.detail = detail;
    }
}

const asObject = (value: unknown): JsonObject =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonObject
        : {};

const asString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

const asNumber = (value: unknown): number | undefined => {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
};

const asRevision = (value: unknown): VisualSearchRevision | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return asString(value);
};

const firstValue = (record: JsonObject, keys: string[]): unknown => {
    for (const key of keys) {
        if (record[key] !== undefined) return record[key];
    }
    return undefined;
};

const stringOrEmpty = (value: unknown): string => asString(value) ?? '';
const stringOrNull = (value: unknown): string | null => asString(value) ?? null;
const numberOr = (value: unknown, fallback: number): number => asNumber(value) ?? fallback;
const numberOrNull = (value: unknown): number | null => asNumber(value) ?? null;
const revisionOrNull = (value: unknown): VisualSearchRevision | null => asRevision(value) ?? null;

const optionalBoolean = (record: JsonObject, keys: string[]): boolean | undefined => {
    const value = firstValue(record, keys);
    return typeof value === 'boolean' ? value : undefined;
};

const asTimestamp = (value: unknown): number | undefined => {
    const numeric = asNumber(value);
    if (numeric !== undefined) return numeric;
    const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeState = (value: unknown): VisualSearchRemoteState => {
    switch (value) {
        case 'running':
            return 'running';
        case 'succeeded':
        case 'success':
        case 'completed':
            return 'succeeded';
        case 'failed':
        case 'error':
        case 'interrupted':
            return 'failed';
        case 'cancelled':
        case 'canceled':
            return 'cancelled';
        default:
            return 'queued';
    }
};

const defaultPhase = (state: VisualSearchRemoteState): string => {
    switch (state) {
        case 'queued':
            return 'queued';
        case 'running':
            return 'searching';
        case 'succeeded':
            return 'completed';
        case 'failed':
            return 'failed';
        case 'cancelled':
            return 'cancelled';
    }
};

const normalizeProgress = (value: unknown, state: VisualSearchRemoteState): number | undefined => {
    const progress = asNumber(value);
    if (progress === undefined) return state === 'succeeded' ? 100 : undefined;
    const percent = progress >= 0 && progress <= 1 ? progress * 100 : progress;
    return Math.max(0, Math.min(100, percent));
};

const normalizeBBox = (value: unknown): VisualSearchBBox | null => {
    if (!Array.isArray(value) || value.length !== 4) return null;
    const values = value.map(asNumber);
    if (values.some(item => item === undefined)) return null;
    return [
        values[0] as number,
        values[1] as number,
        values[2] as number,
        values[3] as number,
    ];
};

const normalizeGeometry = (value: unknown): VisualSearchResultGeometry | null => {
    const geometry = asObject(value);
    if (Object.keys(geometry).length === 0) return null;
    return {
        ...geometry,
        kind: asString(geometry.kind ?? geometry.type),
        bbox: normalizeBBox(geometry.bbox),
    };
};

const normalizeResultItem = (
    value: unknown,
    index: number,
): VisualSearchResultItem => {
    const item = asObject(value);
    const rank = numberOr(item.rank, index + 1);
    const fileName = stringOrEmpty(firstValue(item, ['filename', 'file_name']));
    const serverResultId = asString(firstValue(item, ['result_id', 'resultId']));
    if (!serverResultId) {
        throw new Error(`visual-search result ${rank} is missing stable result_id`);
    }
    return {
        resultId: serverResultId,
        assetId: stringOrNull(firstValue(item, ['asset_id', 'assetId'])),
        datasetId: stringOrNull(firstValue(item, ['dataset_id', 'datasetId'])),
        datasetRevision: revisionOrNull(firstValue(item, ['dataset_revision', 'datasetRevision'])),
        rank,
        path: stringOrEmpty(firstValue(item, ['path', 'image_path', 'imagePath'])),
        fileName,
        width: numberOrNull(firstValue(item, ['width', 'image_width', 'imageWidth'])),
        height: numberOrNull(firstValue(item, ['height', 'image_height', 'imageHeight'])),
        className: stringOrNull(firstValue(item, ['class_name', 'className'])),
        confidence: numberOrNull(firstValue(item, ['conf', 'confidence'])),
        score: numberOr(item.score, 0),
        dinoScore: numberOr(firstValue(item, ['dino_score', 'dinoScore', 'score']), 0),
        bbox: normalizeBBox(item.bbox),
        thumbnail: stringOrNull(firstValue(item, ['thumbnail', 'thumbnail_url', 'thumbnailUrl'])),
        contentSha256: stringOrNull(firstValue(item, ['content_sha256', 'contentSha256'])),
        regionId: stringOrNull(firstValue(item, ['region_id', 'regionId'])),
        granularity: stringOrNull(item.granularity),
        regionSource: stringOrNull(firstValue(item, ['region_source', 'regionSource'])),
        geometry: normalizeGeometry(item.geometry),
    };
};

const normalizeQueryKind = (value: unknown): VisualSearchQueryKind | string =>
    asString(value) ?? '';

const normalizeResult = (
    value: unknown,
    queryKind: unknown,
): VisualSearchResult | undefined => {
    const result = asObject(value);
    if (Object.keys(result).length === 0) return undefined;
    const rawItems = Array.isArray(result.items) ? result.items : [];
    const stageValue = firstValue(result, ['executed_stages', 'executedStages']);
    const stages = Array.isArray(stageValue) ? stageValue : [];
    return {
        collection: stringOrEmpty(result.collection),
        queryKind: normalizeQueryKind(firstValue(result, ['query_kind', 'queryKind']) ?? queryKind),
        queryGeometry: normalizeGeometry(firstValue(result, ['query_geometry', 'queryGeometry'])),
        profileId: stringOrEmpty(firstValue(result, ['profile_id', 'profileId'])),
        modelRevision: stringOrNull(firstValue(result, ['model_revision', 'modelRevision'])),
        collectionRevision: revisionOrNull(
            firstValue(result, ['collection_revision', 'collectionRevision']),
        ),
        executedStages: (stages as unknown[]).map(asString).filter(Boolean) as string[],
        stageStatus: asObject(firstValue(result, ['stage_status', 'stageStatus'])),
        total: numberOr(result.total, rawItems.length),
        elapsedMs: numberOr(firstValue(result, ['elapsed_ms', 'elapsedMs']), 0),
        items: rawItems.map((item, index) => normalizeResultItem(item, index)),
    };
};

const normalizeError = (value: unknown): VisualSearchRemoteError | undefined => {
    if (!value) return undefined;
    if (typeof value === 'string') return {code: 'visual_search_failed', message: value};
    const error = asObject(value);
    if (Object.keys(error).length === 0) return undefined;
    return {
        code: asString(error.code) ?? 'visual_search_failed',
        message: asString(error.message ?? error.detail) ?? 'Visual search failed',
        retryable: typeof error.retryable === 'boolean' ? error.retryable : undefined,
    };
};

export const normalizeVisualSearchTask = (value: unknown): VisualSearchRemoteJob => {
    const task = asObject(value);
    const taskId = asString(firstValue(task, ['task_id', 'taskId', 'id']));
    if (!taskId) throw new Error('visual-search task response is missing task_id');
    const rawState = firstValue(task, ['state', 'status']);
    const state = normalizeState(rawState);
    const spec = asObject(task.spec);
    const queryGeometry = asObject(firstValue(task, ['query_geometry', 'queryGeometry']));
    const taskError = normalizeError(task.error);
    const interruptedError = rawState === 'interrupted'
        ? {
            code: 'task_interrupted',
            message: taskError?.message ??
                'Visual search task was interrupted before completion',
            retryable: true,
        }
        : undefined;
    return {
        taskId,
        state,
        phase: asString(firstValue(task, ['phase', 'stage'])) ?? defaultPhase(state),
        progress: normalizeProgress(task.progress, state),
        idempotentReplay: optionalBoolean(task, ['idempotent_replay', 'idempotentReplay']),
        createdAt: asTimestamp(firstValue(task, ['created_at', 'createdAt'])),
        startedAt: asTimestamp(firstValue(task, ['started_at', 'startedAt'])),
        updatedAt: asTimestamp(firstValue(task, ['updated_at', 'updatedAt'])),
        finishedAt: asTimestamp(firstValue(task, ['finished_at', 'finishedAt'])),
        recoveryCount: asNumber(firstValue(task, ['recovery_count', 'recoveryCount'])),
        cancelRequested: optionalBoolean(task, ['cancel_requested', 'cancelRequested']),
        result: normalizeResult(
            task.result,
            firstValue(task, ['query_kind', 'queryKind']) ??
                queryGeometry.kind ??
                spec.query_kind,
        ),
        error: interruptedError ?? taskError,
    };
};

export const serializeVisualSearchSnapshot = (
    snapshot: VisualSearchQuerySnapshot,
): JsonObject => {
    const geometry = snapshot.geometry.kind === 'image'
        ? {kind: 'image'}
        : snapshot.geometry.kind === 'bbox'
            ? {kind: 'bbox', bbox: snapshot.geometry.bbox}
            : {
                kind: 'mask',
                bbox: snapshot.geometry.bbox,
                polygons: snapshot.geometry.polygons,
                mask_file_name: snapshot.geometry.maskFileName,
            };
    return {
        spec_version: 1,
        snapshot_id: snapshot.snapshotId,
        captured_at: snapshot.capturedAt,
        source: {
            image_id: snapshot.source.imageId,
            asset_id: snapshot.source.assetId,
            file_name: snapshot.source.fileName,
            media_kind: snapshot.source.mediaKind,
            frame_index: snapshot.source.frameIndex,
            video_session_id: snapshot.source.videoSessionId,
            dataset_id: snapshot.source.datasetId,
            dataset_revision: snapshot.source.datasetRevision,
        },
        profile: {
            profile_id: snapshot.profile.id,
            model_revision: snapshot.profile.modelRevision,
        },
        target: {
            collection: snapshot.target.collection,
            collection_revision: snapshot.target.collectionRevision,
            dataset_id: snapshot.target.datasetId,
            dataset_revision: snapshot.target.datasetRevision,
        },
        options: {
            top_k: snapshot.options.topK,
            candidate_k: snapshot.options.candidateK,
            class_name: snapshot.options.className,
            idempotency_key: snapshot.options.idempotencyKey,
        },
        query: geometry,
        image: {
            file_name: snapshot.image.fileName,
            mime_type: snapshot.image.mimeType,
            size: snapshot.image.size,
            width: snapshot.image.width,
            height: snapshot.image.height,
        },
    };
};

const readBody = async (response: Response): Promise<unknown> => {
    if (response.status === 204) return {};
    return response.json().catch(() => ({}));
};

const apiErrorFrom = (body: unknown, status: number): VisualSearchAPIError => {
    const root = asObject(body);
    const detailValue = root.detail ?? root.error ?? root;
    const detail = asObject(detailValue);
    const code = asString(detail.code);
    const message = typeof detailValue === 'string'
        ? detailValue
        : asString(detail.message ?? detail.detail) ?? `HTTP ${status}`;
    return new VisualSearchAPIError(message, status, code, detailValue);
};

const readTask = async (response: Response): Promise<VisualSearchRemoteJob> => {
    const body = await readBody(response);
    if (!response.ok) throw apiErrorFrom(body, response.status);
    return normalizeVisualSearchTask(body);
};

export class VisualSearchAPI implements VisualSearchAPIClient {
    private readonly options: VisualSearchAPIOptions;

    constructor(options: VisualSearchAPIOptions = {}) {
        this.options = options;
    }

    public async createJob(
        snapshot: VisualSearchQuerySnapshot,
        signal?: AbortSignal,
    ): Promise<VisualSearchRemoteJob> {
        const form = new FormData();
        form.append('image', snapshot.imageFile, snapshot.imageFile.name);
        form.append('collection', snapshot.target.collection);
        form.append('query_kind', snapshot.geometry.kind);
        form.append('top_k', String(snapshot.options.topK));
        form.append('candidate_k', String(snapshot.options.candidateK));
        form.append('idempotency_key', snapshot.options.idempotencyKey);
        form.append('expected_profile_id', snapshot.profile.id);
        if (snapshot.profile.modelRevision) {
            form.append('expected_model_revision', snapshot.profile.modelRevision);
        }
        if (snapshot.target.collectionRevision !== undefined &&
            snapshot.target.collectionRevision !== null) {
            form.append('expected_collection_revision', String(snapshot.target.collectionRevision));
        }
        form.append('spec', JSON.stringify(serializeVisualSearchSnapshot(snapshot)));
        form.append('enable_naf', 'false');
        form.append('sam_rounds', '0');
        if (snapshot.options.className) form.append('class_name', snapshot.options.className);
        if (snapshot.geometry.kind === 'bbox') {
            form.append('bbox', JSON.stringify(snapshot.geometry.bbox));
        }
        if (snapshot.geometry.kind === 'mask') {
            if (!snapshot.maskFile) throw new Error('mask snapshot is missing its PNG file');
            form.append('mask', snapshot.maskFile, snapshot.maskFile.name);
        }
        return readTask(await this.fetch(this.endpoint('/tasks'), {
            method: 'POST',
            body: form,
            signal,
        }));
    }

    public async getJob(taskId: string, signal?: AbortSignal): Promise<VisualSearchRemoteJob> {
        return readTask(await this.fetch(this.endpoint(`/tasks/${encodeURIComponent(taskId)}`), {
            signal,
        }));
    }

    public async cancelJob(taskId: string, signal?: AbortSignal): Promise<VisualSearchRemoteJob> {
        return readTask(await this.fetch(
            this.endpoint(`/tasks/${encodeURIComponent(taskId)}/cancel`),
            {method: 'POST', signal},
        ));
    }

    private fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const fetchImpl = this.options.fetchImpl ??
            ((request, requestInit) => globalThis.fetch(request, requestInit));
        return fetchImpl(input, init);
    }

    private endpoint(path: string): string {
        const configured = this.options.baseUrl;
        const base = typeof configured === 'function'
            ? configured()
            : configured ?? `${getExtensionEngineBaseUrl()}/vector_db`;
        return `${base.replace(/\/+$/, '')}${path}`;
    }
}

export const visualSearchAPI = new VisualSearchAPI();
