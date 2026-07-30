export type VisualSearchQueryKind = 'image' | 'bbox' | 'mask';
export type VisualSearchRemoteState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type VisualSearchJobStatus = 'submitting' | VisualSearchRemoteState;
export type VisualSearchRevision = string | number;

export type VisualSearchPoint = readonly [number, number];
export type VisualSearchBBox = readonly [number, number, number, number];
export type VisualSearchPolygon = ReadonlyArray<VisualSearchPoint>;

export type VisualSearchQueryGeometry =
    | {kind: 'image'}
    | {kind: 'bbox'; bbox: VisualSearchBBox}
    | {
        kind: 'mask';
        polygons: ReadonlyArray<VisualSearchPolygon>;
        bbox: VisualSearchBBox;
        maskFileName: string;
    };

export interface VisualSearchSourceIdentity {
    imageId: string;
    assetId?: string;
    fileName: string;
    mediaKind: 'image' | 'frame';
    frameIndex?: number;
    videoSessionId?: string;
    datasetId?: string;
    datasetRevision?: VisualSearchRevision;
}

export interface VisualSearchProfileRef {
    id: string;
    modelRevision: string | null;
}

export interface VisualSearchTargetRef {
    collection: string;
    collectionRevision?: VisualSearchRevision | null;
    datasetId?: string;
    datasetRevision?: VisualSearchRevision;
}

export interface VisualSearchRequestOptions {
    topK: number;
    candidateK: number;
    className?: string;
    idempotencyKey: string;
}

export interface VisualSearchSnapshotMetadata {
    snapshotId: string;
    capturedAt: number;
    source: Readonly<VisualSearchSourceIdentity>;
    profile: Readonly<VisualSearchProfileRef>;
    target: Readonly<VisualSearchTargetRef>;
    options: Readonly<VisualSearchRequestOptions>;
    geometry: VisualSearchQueryGeometry;
    image: Readonly<{
        fileName: string;
        mimeType: string;
        size: number;
        width: number;
        height: number;
    }>;
}

/**
 * Upload bytes intentionally stay outside Redux. The immutable metadata is
 * retained in job history while these File objects can be released after the
 * create-task request completes.
 */
export interface VisualSearchQuerySnapshot extends VisualSearchSnapshotMetadata {
    imageFile: File;
    maskFile?: File;
}

export interface VisualSearchResultGeometry {
    kind?: VisualSearchQueryKind | string;
    bbox?: VisualSearchBBox | null;
    polygons?: ReadonlyArray<VisualSearchPolygon> | null;
    [key: string]: unknown;
}

export interface VisualSearchResultItem {
    resultId: string;
    assetId: string | null;
    datasetId: string | null;
    datasetRevision: VisualSearchRevision | null;
    rank: number;
    path: string;
    fileName: string;
    width: number | null;
    height: number | null;
    className: string | null;
    confidence: number | null;
    score: number;
    dinoScore: number;
    bbox: VisualSearchBBox | null;
    thumbnail: string | null;
    contentSha256: string | null;
    regionId: string | null;
    granularity: string | null;
    regionSource: string | null;
    geometry: VisualSearchResultGeometry | null;
}

export interface VisualSearchResult {
    collection: string;
    queryKind: VisualSearchQueryKind | string;
    queryGeometry: VisualSearchResultGeometry | null;
    profileId: string;
    modelRevision: string | null;
    collectionRevision: VisualSearchRevision | null;
    executedStages: string[];
    stageStatus: Record<string, unknown>;
    total: number;
    elapsedMs: number;
    items: VisualSearchResultItem[];
}

export interface VisualSearchRemoteError {
    code: string;
    message: string;
    retryable?: boolean;
}

export interface VisualSearchRemoteJob {
    taskId: string;
    state: VisualSearchRemoteState;
    phase: string;
    progress?: number;
    idempotentReplay?: boolean;
    createdAt?: number;
    startedAt?: number;
    finishedAt?: number;
    updatedAt?: number;
    recoveryCount?: number;
    cancelRequested?: boolean;
    result?: VisualSearchResult;
    error?: VisualSearchRemoteError;
}

export interface VisualSearchJobState {
    clientJobId: string;
    backendJobId?: string;
    snapshot: VisualSearchSnapshotMetadata;
    status: VisualSearchJobStatus;
    phase: string;
    progress?: number;
    createdAt: number;
    updatedAt: number;
    startedAt?: number;
    serverUpdatedAt?: number;
    finishedAt?: number;
    recoveryCount: number;
    cancelRequested: boolean;
    idempotentReplay: boolean;
    result?: VisualSearchResult;
    error?: VisualSearchRemoteError;
    selectedResultIds: string[];
}

export interface VisualSearchState {
    jobsById: Record<string, VisualSearchJobState>;
    jobOrder: string[];
    activeJobId: string | null;
}
