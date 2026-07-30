import {v4 as uuidv4} from 'uuid';
import {
    VisualSearchBBox,
    VisualSearchPoint,
    VisualSearchPolygon,
    VisualSearchProfileRef,
    VisualSearchQueryGeometry,
    VisualSearchQuerySnapshot,
    VisualSearchRequestOptions,
    VisualSearchSnapshotMetadata,
    VisualSearchSourceIdentity,
    VisualSearchTargetRef,
} from '../store/visualSearch/types';

export type QuerySnapshotPhase =
    | 'resolving-source'
    | 'copying-image'
    | 'encoding-mask'
    | 'freezing-snapshot'
    | 'complete';

export type QueryGeometryInput =
    | {kind: 'image'}
    | {kind: 'bbox'; bbox: readonly [number, number, number, number]}
    | {
        kind: 'mask';
        polygons: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
        /** Optional authoritative PNG mask. Otherwise polygons are rasterized. */
        maskBlob?: Blob;
    };

export interface QuerySnapshotInput {
    imageBlob: Blob;
    width: number;
    height: number;
    source: VisualSearchSourceIdentity;
    profile: VisualSearchProfileRef;
    target: VisualSearchTargetRef;
    options: Omit<VisualSearchRequestOptions, 'idempotencyKey'> & {
        idempotencyKey?: string;
    };
    geometry: QueryGeometryInput;
    /**
     * Zero-byte File objects represent on-demand video frames in the editor.
     * The caller supplies the resolver so this service stays independent from
     * active Redux state and snapshots exactly the frame visible at invocation.
     */
    resolveFrame?: () => Promise<Blob>;
}

export interface QuerySnapshotDependencies {
    createId?: () => string;
    now?: () => number;
    encodeMask?: (
        polygons: ReadonlyArray<VisualSearchPolygon>,
        width: number,
        height: number,
    ) => Promise<Blob>;
    onPhase?: (phase: QuerySnapshotPhase) => void;
}

const requireNonEmpty = (value: string, field: string): string => {
    const normalized = value?.trim();
    if (!normalized) throw new Error(`${field} is required`);
    return normalized;
};

const requireRevision = (value: string | number, field: string): string | number => {
    if (typeof value === 'string') return requireNonEmpty(value, field);
    if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
    return value;
};

const requirePositiveInteger = (value: number, field: string): number => {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${field} must be a positive integer`);
    }
    return value;
};

const optionalDatasetRef = (
    datasetId: string | undefined,
    datasetRevision: string | number | undefined,
    field: string,
): {datasetId?: string; datasetRevision?: string | number} => {
    const normalizedId = datasetId?.trim() || undefined;
    const normalizedRevision = datasetRevision === undefined
        ? undefined
        : requireRevision(datasetRevision, `${field}.datasetRevision`);
    if (Boolean(normalizedId) !== (normalizedRevision !== undefined)) {
        throw new Error(`${field}.datasetId and datasetRevision must be provided together`);
    }
    return {datasetId: normalizedId, datasetRevision: normalizedRevision};
};

const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, value));

const normalizeBBox = (
    value: readonly [number, number, number, number],
    width: number,
    height: number,
): VisualSearchBBox => {
    if (value.some(coordinate => !Number.isFinite(coordinate))) {
        throw new Error('bbox coordinates must be finite');
    }
    const left = clamp(Math.min(value[0], value[2]), width);
    const top = clamp(Math.min(value[1], value[3]), height);
    const right = clamp(Math.max(value[0], value[2]), width);
    const bottom = clamp(Math.max(value[1], value[3]), height);
    if (right <= left || bottom <= top) {
        throw new Error('bbox must have a positive area inside the source image');
    }
    return Object.freeze([left, top, right, bottom]) as VisualSearchBBox;
};

const normalizePolygons = (
    value: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
    width: number,
    height: number,
): ReadonlyArray<VisualSearchPolygon> => {
    if (value.length === 0) throw new Error('mask requires at least one polygon');
    return Object.freeze(value.map((polygon, polygonIndex) => {
        if (polygon.length < 3) {
            throw new Error(`mask polygon ${polygonIndex} requires at least three points`);
        }
        return Object.freeze(polygon.map((point, pointIndex) => {
            if (point.length !== 2 || point.some(coordinate => !Number.isFinite(coordinate))) {
                throw new Error(`mask polygon ${polygonIndex} point ${pointIndex} is invalid`);
            }
            return Object.freeze([
                clamp(point[0], width),
                clamp(point[1], height),
            ]) as VisualSearchPoint;
        }));
    }));
};

const polygonBounds = (polygons: ReadonlyArray<VisualSearchPolygon>): VisualSearchBBox => {
    const points = polygons.flat();
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);
    const bbox: VisualSearchBBox = [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
    ];
    if (bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) {
        throw new Error('mask must have a positive area');
    }
    return Object.freeze(bbox) as VisualSearchBBox;
};

const canvasMaskEncoder = async (
    polygons: ReadonlyArray<VisualSearchPolygon>,
    width: number,
    height: number,
): Promise<Blob> => {
    if (typeof document === 'undefined') {
        throw new Error('maskBlob is required when canvas is unavailable');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas is unavailable for mask encoding');

    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    context.beginPath();
    polygons.forEach(polygon => {
        context.moveTo(polygon[0][0], polygon[0][1]);
        polygon.slice(1).forEach(point => context.lineTo(point[0], point[1]));
        context.closePath();
    });
    context.fillStyle = '#fff';
    context.fill('evenodd');

    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('failed to encode mask PNG'));
        }, 'image/png');
    });
};

const cloneAsFile = (blob: Blob, fileName: string, fallbackType: string): File => {
    const source = blob.slice(0, blob.size, blob.type || fallbackType);
    const lastModified = blob instanceof File ? blob.lastModified : Date.now();
    return new File([source], fileName, {
        type: blob.type || fallbackType,
        lastModified,
    });
};

const freezeGeometry = (
    input: QueryGeometryInput,
    width: number,
    height: number,
    maskFileName: string,
): {
    geometry: VisualSearchQueryGeometry;
    polygons?: ReadonlyArray<VisualSearchPolygon>;
} => {
    if (input.kind === 'image') return {geometry: Object.freeze({kind: 'image'})};
    if (input.kind === 'bbox') {
        return {
            geometry: Object.freeze({
                kind: 'bbox',
                bbox: normalizeBBox(input.bbox, width, height),
            }),
        };
    }
    const polygons = normalizePolygons(input.polygons, width, height);
    return {
        geometry: Object.freeze({
            kind: 'mask',
            polygons,
            bbox: polygonBounds(polygons),
            maskFileName,
        }),
        polygons,
    };
};

export const snapshotMetadata = (
    snapshot: VisualSearchQuerySnapshot,
): VisualSearchSnapshotMetadata => Object.freeze({
    snapshotId: snapshot.snapshotId,
    capturedAt: snapshot.capturedAt,
    source: snapshot.source,
    profile: snapshot.profile,
    target: snapshot.target,
    options: snapshot.options,
    geometry: snapshot.geometry,
    image: snapshot.image,
});

const resolveSourceBlob = async (input: QuerySnapshotInput): Promise<Blob> => {
    if (input.imageBlob?.size > 0) return input.imageBlob;
    if (!input.resolveFrame) {
        throw new Error('source image is empty and no frame resolver was provided');
    }
    const resolved = await input.resolveFrame();
    if (!resolved || resolved.size === 0) throw new Error('resolved source image is empty');
    return resolved;
};

const freezeSource = (
    input: VisualSearchSourceIdentity,
): Readonly<VisualSearchSourceIdentity> => {
    const dataset = optionalDatasetRef(
        input.datasetId,
        input.datasetRevision,
        'source',
    );
    const source: Readonly<VisualSearchSourceIdentity> = Object.freeze({
        imageId: requireNonEmpty(input.imageId, 'source.imageId'),
        assetId: input.assetId?.trim() || undefined,
        fileName: requireNonEmpty(input.fileName, 'source.fileName'),
        mediaKind: input.mediaKind,
        frameIndex: input.frameIndex,
        videoSessionId: input.videoSessionId?.trim() || undefined,
        ...dataset,
    });
    if (source.mediaKind === 'frame' &&
        (!Number.isInteger(source.frameIndex) || (source.frameIndex as number) < 0)) {
        throw new Error('source.frameIndex is required for frame snapshots');
    }
    return source;
};

const freezeProfile = (input: VisualSearchProfileRef): Readonly<VisualSearchProfileRef> =>
    Object.freeze({
        id: requireNonEmpty(input.id, 'profile.id'),
        modelRevision: input.modelRevision?.trim() || null,
    });

const freezeTarget = (input: VisualSearchTargetRef): Readonly<VisualSearchTargetRef> =>
    Object.freeze({
        collection: requireNonEmpty(input.collection, 'target.collection'),
        collectionRevision: input.collectionRevision === undefined ||
            input.collectionRevision === null
            ? null
            : requireRevision(input.collectionRevision, 'target.collectionRevision'),
        ...optionalDatasetRef(input.datasetId, input.datasetRevision, 'target'),
    });

const freezeOptions = (
    input: QuerySnapshotInput['options'],
    snapshotId: string,
): Readonly<VisualSearchRequestOptions> => {
    const topK = requirePositiveInteger(input.topK, 'options.topK');
    const candidateK = requirePositiveInteger(input.candidateK, 'options.candidateK');
    if (candidateK < topK) {
        throw new Error('options.candidateK must be greater than or equal to topK');
    }
    return Object.freeze({
        topK,
        candidateK,
        className: input.className?.trim() || undefined,
        idempotencyKey: input.idempotencyKey?.trim() || snapshotId,
    });
};

const createMaskFile = async (
    input: QueryGeometryInput,
    frozenPolygons: ReadonlyArray<VisualSearchPolygon> | undefined,
    width: number,
    height: number,
    maskFileName: string,
    dependencies: QuerySnapshotDependencies,
): Promise<File | undefined> => {
    if (input.kind !== 'mask') return undefined;
    dependencies.onPhase?.('encoding-mask');
    const maskBlob = input.maskBlob ??
        await (dependencies.encodeMask ?? canvasMaskEncoder)(
            frozenPolygons as ReadonlyArray<VisualSearchPolygon>,
            width,
            height,
        );
    if (!maskBlob || maskBlob.size === 0) throw new Error('encoded mask is empty');
    if (maskBlob.type !== 'image/png') throw new Error('mask must be encoded as image/png');
    return cloneAsFile(maskBlob, maskFileName, 'image/png');
};

export class QuerySnapshotService {
    public static async capture(
        input: QuerySnapshotInput,
        dependencies: QuerySnapshotDependencies = {},
    ): Promise<VisualSearchQuerySnapshot> {
        const emit = (phase: QuerySnapshotPhase) => dependencies.onPhase?.(phase);
        const width = requirePositiveInteger(input.width, 'width');
        const height = requirePositiveInteger(input.height, 'height');
        const snapshotId = dependencies.createId?.() ?? uuidv4();
        const capturedAt = dependencies.now?.() ?? Date.now();

        emit('resolving-source');
        const sourceBlob = await resolveSourceBlob(input);
        const source = freezeSource(input.source);
        const profile = freezeProfile(input.profile);
        const target = freezeTarget(input.target);
        const options = freezeOptions(input.options, snapshotId);

        emit('copying-image');
        const imageFile = cloneAsFile(
            sourceBlob,
            source.fileName,
            sourceBlob.type || 'application/octet-stream',
        );
        const maskFileName = `${snapshotId}-mask.png`;
        const frozen = freezeGeometry(input.geometry, width, height, maskFileName);

        const maskFile = await createMaskFile(
            input.geometry,
            frozen.polygons,
            width,
            height,
            maskFileName,
            dependencies,
        );

        emit('freezing-snapshot');
        const snapshot: VisualSearchQuerySnapshot = {
            snapshotId,
            capturedAt,
            source,
            profile,
            target,
            options,
            geometry: frozen.geometry,
            image: Object.freeze({
                fileName: imageFile.name,
                mimeType: imageFile.type,
                size: imageFile.size,
                width,
                height,
            }),
            imageFile,
            maskFile,
        };
        emit('complete');
        return Object.freeze(snapshot);
    }
}
