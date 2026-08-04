import {
    VisualSearchBBox,
    VisualSearchMaskRLE,
    VisualSearchPolygon,
    VISUAL_SEARCH_MASK_LIMITS,
    VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
} from '../store/visualSearch/types';
import {sha256Bytes} from '../utils/Sha256';

export type InflateMaskCounts = (
    compressed: Uint8Array,
    maximumBytes: number,
) => Promise<Uint8Array>;

export type DigestMaskGeometry = (bytes: Uint8Array) => Promise<string>;

export interface VisualSearchMaskGeometryInput {
    mask: VisualSearchMaskRLE | null | undefined;
    polygons: ReadonlyArray<VisualSearchPolygon> | null | undefined;
    bbox: VisualSearchBBox | null | undefined;
    width: number | null | undefined;
    height: number | null | undefined;
    geometrySha256: string | null | undefined;
    rasterizerRevision: string | null | undefined;
}

interface ByteStreamReader {
    read(): Promise<{done: boolean; value?: Uint8Array}>;
    cancel?(reason?: unknown): Promise<void> | void;
    releaseLock?(): void;
}

interface ByteStream {
    getReader(): ByteStreamReader;
}

export const assertVisualSearchMaskDimensions = (
    width: number,
    height: number,
): number => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new Error('The mask dimensions must be positive integers');
    }
    if (width > VISUAL_SEARCH_MASK_LIMITS.maxDimension ||
        height > VISUAL_SEARCH_MASK_LIMITS.maxDimension) {
        throw new Error('The mask dimensions exceed the frontend safety limit');
    }
    const pixelCount = width * height;
    if (!Number.isSafeInteger(pixelCount) ||
        pixelCount > VISUAL_SEARCH_MASK_LIMITS.maxPixels) {
        throw new Error('The mask pixel count exceeds the frontend safety limit');
    }
    return pixelCount;
};

const assertPolygonBudgets = (
    polygons: ReadonlyArray<VisualSearchPolygon>,
): void => {
    if (polygons.length === 0) throw new Error('The mask requires at least one polygon');
    if (polygons.length > VISUAL_SEARCH_MASK_LIMITS.maxPolygons) {
        throw new Error('The mask polygon count exceeds the frontend safety limit');
    }
    let totalVertices = 0;
    polygons.forEach((polygon, polygonIndex) => {
        if (polygon.length < 3) {
            throw new Error(`Mask polygon ${polygonIndex} requires at least three vertices`);
        }
        if (polygon.length > VISUAL_SEARCH_MASK_LIMITS.maxVerticesPerPolygon) {
            throw new Error('A mask polygon exceeds the frontend vertex safety limit');
        }
        totalVertices += polygon.length;
        if (totalVertices > VISUAL_SEARCH_MASK_LIMITS.maxTotalVertices) {
            throw new Error('The mask total vertex count exceeds the frontend safety limit');
        }
        polygon.forEach(point => {
            if (point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
                throw new Error('Mask polygon coordinates must be finite points');
            }
        });
    });
};

const clampPixelCoordinate = (value: number, maximum: number): number =>
    Math.min(maximum, Math.max(0, Math.trunc(value)));

export const canonicalizeVisualSearchPolygons = (
    polygons: ReadonlyArray<VisualSearchPolygon>,
    width: number,
    height: number,
): ReadonlyArray<VisualSearchPolygon> => {
    assertVisualSearchMaskDimensions(width, height);
    assertPolygonBudgets(polygons);
    return polygons.map(polygon => polygon.map(point => [
        clampPixelCoordinate(point[0], width - 1),
        clampPixelCoordinate(point[1], height - 1),
    ] as const));
};

const decodeBase64 = (value: string): Uint8Array => {
    if (value.length === 0 ||
        value.length > VISUAL_SEARCH_MASK_LIMITS.maxCountsBase64Length) {
        throw new Error('The mask RLE compressed payload exceeds the frontend safety limit');
    }
    if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
        throw new Error('The mask RLE counts are not valid base64');
    }
    try {
        const binary = globalThis.atob(value);
        return Uint8Array.from(binary, character => character.charCodeAt(0));
    } catch {
        throw new Error('The mask RLE counts are not valid base64');
    }
};

export const readVisualSearchStreamWithLimit = async (
    stream: ByteStream,
    maximumBytes: number,
): Promise<Uint8Array> => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    let complete = false;
    try {
        while (!complete) {
            // eslint-disable-next-line no-await-in-loop
            const chunk = await reader.read();
            if (chunk.done) {
                complete = true;
                continue;
            }
            if (!(chunk.value instanceof Uint8Array)) {
                throw new Error('The mask RLE decompressor returned an invalid chunk');
            }
            byteLength += chunk.value.byteLength;
            if (byteLength > maximumBytes) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    await reader.cancel?.('mask RLE output limit exceeded');
                } catch {
                    // Preserve the deterministic budget error even if cancellation fails.
                }
                throw new Error('The mask RLE expands beyond its declared dimensions');
            }
            chunks.push(chunk.value);
        }
    } finally {
        reader.releaseLock?.();
    }
    const output = new Uint8Array(byteLength);
    let offset = 0;
    chunks.forEach(chunk => {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    });
    return output;
};

const defaultInflate: InflateMaskCounts = async (compressed, maximumBytes) => {
    type DecompressionStreamConstructor = new (format: 'deflate') => unknown;
    const constructor = (globalThis as typeof globalThis & {
        DecompressionStream?: DecompressionStreamConstructor;
    }).DecompressionStream;
    if (!constructor) {
        throw new Error('Mask RLE decompression is unavailable in this browser');
    }
    const source = new Blob([compressed]).stream() as unknown as {
        pipeThrough: (transform: unknown) => ByteStream;
    };
    return readVisualSearchStreamWithLimit(
        source.pipeThrough(new constructor('deflate')),
        maximumBytes,
    );
};

const decodePixels = (packed: Uint8Array, pixelCount: number): Uint8Array => {
    const pixels = new Uint8Array(pixelCount);
    let value = 0;
    let shift = 0;
    let total = 0;
    let runIndex = 0;
    for (const byte of packed) {
        value += (byte & 0x7f) * 2 ** shift;
        if (!Number.isSafeInteger(value)) throw new Error('The mask RLE varint is too large');
        if (byte & 0x80) {
            shift += 7;
            if (shift > 49) throw new Error('The mask RLE varint is too large');
            continue;
        }
        if (runIndex > 0 && value === 0) {
            throw new Error('The mask RLE contains a non-canonical empty run');
        }
        const nextTotal = total + value;
        if (nextTotal > pixelCount) throw new Error('The mask RLE exceeds its declared dimensions');
        if (runIndex % 2 === 1) pixels.fill(1, total, nextTotal);
        total = nextTotal;
        runIndex += 1;
        value = 0;
        shift = 0;
    }
    if (shift !== 0) throw new Error('The mask RLE varint is truncated');
    if (runIndex === 0 || total !== pixelCount) {
        throw new Error('The mask RLE pixel count differs from its declared dimensions');
    }
    return pixels;
};

const drawLine = (
    pixels: Uint8Array,
    width: number,
    height: number,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
): void => {
    let x = startX;
    let y = startY;
    const dx = Math.abs(endX - startX);
    const sx = startX < endX ? 1 : -1;
    const dy = -Math.abs(endY - startY);
    const sy = startY < endY ? 1 : -1;
    let error = dx + dy;
    let complete = false;
    while (!complete) {
        if (x >= 0 && x < width && y >= 0 && y < height) pixels[y * width + x] = 1;
        if (x === endX && y === endY) {
            complete = true;
            continue;
        }
        const doubled = 2 * error;
        if (doubled >= dy) {
            error += dy;
            x += sx;
        }
        if (doubled <= dx) {
            error += dx;
            y += sy;
        }
    }
};

const fillPolygon = (
    pixels: Uint8Array,
    width: number,
    height: number,
    polygon: VisualSearchPolygon,
): void => {
    let minimumY = height - 1;
    let maximumY = 0;
    polygon.forEach((point, index) => {
        const next = polygon[(index + 1) % polygon.length];
        drawLine(pixels, width, height, point[0], point[1], next[0], next[1]);
        minimumY = Math.min(minimumY, point[1]);
        maximumY = Math.max(maximumY, point[1]);
    });
    for (let y = minimumY; y <= maximumY; y += 1) {
        const intersections: number[] = [];
        polygon.forEach((point, index) => {
            const next = polygon[(index + 1) % polygon.length];
            if (point[1] === next[1]) return;
            const low = Math.min(point[1], next[1]);
            const high = Math.max(point[1], next[1]);
            if (y < low || y >= high) return;
            intersections.push(
                point[0] + ((y - point[1]) * (next[0] - point[0])) /
                (next[1] - point[1]),
            );
        });
        intersections.sort((left, right) => left - right);
        for (let index = 0; index + 1 < intersections.length; index += 2) {
            const start = Math.ceil(intersections[index]);
            const end = Math.floor(intersections[index + 1]);
            if (end >= start) pixels.fill(1, y * width + start, y * width + end + 1);
        }
    }
};

/** Canonical v1 rasterizer: integer vertices, Bresenham edges, half-open scanline union. */
export const rasterizeVisualSearchPolygons = (
    polygons: ReadonlyArray<VisualSearchPolygon>,
    width: number,
    height: number,
): Uint8Array => {
    const canonical = canonicalizeVisualSearchPolygons(polygons, width, height);
    const pixels = new Uint8Array(width * height);
    canonical.forEach(polygon => fillPolygon(pixels, width, height, polygon));
    return pixels;
};

export const visualSearchMaskPixelsBBox = (
    pixels: Uint8Array,
    width: number,
    height: number,
): VisualSearchBBox | null => {
    const pixelCount = assertVisualSearchMaskDimensions(width, height);
    if (pixels.byteLength !== pixelCount) {
        throw new Error('The mask pixel buffer differs from its declared dimensions');
    }
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    pixels.forEach((value, index) => {
        if (!value) return;
        const x = index % width;
        const y = Math.floor(index / width);
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
    });
    return right < 0 ? null : [left, top, right + 1, bottom + 1];
};

const sameBBox = (left: VisualSearchBBox | null, right: VisualSearchBBox): boolean =>
    Boolean(left && left.every((value, index) => value === right[index]));

const samePixels = (left: Uint8Array, right: Uint8Array): boolean =>
    left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

interface RequiredMaskGeometry {
    mask: VisualSearchMaskRLE;
    polygons: ReadonlyArray<VisualSearchPolygon>;
    bbox: VisualSearchBBox;
    width: number;
    height: number;
    geometrySha256: string;
    rasterizerRevision: typeof VISUAL_SEARCH_MASK_RASTERIZER_REVISION;
}

// Validation enumerates every untrusted wire boundary before allocating the mask.
// eslint-disable-next-line complexity
const requireMaskGeometry = (
    input: VisualSearchMaskGeometryInput,
): RequiredMaskGeometry => {
    const {mask, polygons, bbox, width, height, geometrySha256} = input;
    if (!mask || !polygons?.length || !bbox || width === null || width === undefined ||
        height === null || height === undefined) {
        throw new Error('The mask result lacks canonical RLE, source polygons, or dimensions');
    }
    assertVisualSearchMaskDimensions(width, height);
    assertPolygonBudgets(polygons);
    if (!geometrySha256 || !/^[0-9a-f]{64}$/.test(geometrySha256)) {
        throw new Error('The mask result lacks a valid geometry SHA-256 identity');
    }
    if (input.rasterizerRevision !== VISUAL_SEARCH_MASK_RASTERIZER_REVISION) {
        throw new Error('The mask result uses an unsupported rasterizer revision');
    }
    if (mask.encoding !== 'binary_rle_varint_zlib_base64_v1' ||
        mask.order !== 'row-major' ||
        mask.size[0] !== height || mask.size[1] !== width) {
        throw new Error('The mask RLE contract or dimensions are invalid');
    }
    if (mask.countsBase64.length === 0 ||
        mask.countsBase64.length > VISUAL_SEARCH_MASK_LIMITS.maxCountsBase64Length) {
        throw new Error('The mask RLE compressed payload exceeds the frontend safety limit');
    }
    if (polygons.some(polygon => polygon.some(point =>
        !Number.isInteger(point[0]) || !Number.isInteger(point[1])))) {
        throw new Error('Mask source polygons must use canonical integer pixel coordinates');
    }
    if (polygons.some(polygon => polygon.some(point =>
        point[0] < 0 || point[1] < 0 || point[0] >= width || point[1] >= height))) {
        throw new Error('Mask source polygons are outside the full-image pixel bounds');
    }
    return {
        mask,
        polygons,
        bbox,
        width,
        height,
        geometrySha256,
        rasterizerRevision: input.rasterizerRevision,
    };
};

export const canonicalVisualSearchMaskGeometryJSON = (
    geometry: Pick<RequiredMaskGeometry, 'mask' | 'polygons' | 'rasterizerRevision'>,
): string => JSON.stringify({
    acceptance: {eligible: true, reason: null},
    mask: {
        counts_base64: geometry.mask.countsBase64,
        encoding: geometry.mask.encoding,
        order: geometry.mask.order,
        size: [geometry.mask.size[0], geometry.mask.size[1]],
    },
    polygons: geometry.polygons.map(polygon =>
        polygon.map(point => [point[0], point[1]])),
    rasterizer_revision: geometry.rasterizerRevision,
    schema_version: 2,
});

const decodeMaskPixels = async (
    geometry: RequiredMaskGeometry,
    inflate: InflateMaskCounts,
): Promise<Uint8Array> => {
    const pixelCount = assertVisualSearchMaskDimensions(geometry.width, geometry.height);
    const packed = await inflate(decodeBase64(geometry.mask.countsBase64), pixelCount + 1);
    if (packed.byteLength > pixelCount + 1) {
        throw new Error('The mask RLE expands beyond its declared dimensions');
    }
    return decodePixels(packed, pixelCount);
};

export const verifyVisualSearchMaskGeometry = async (
    input: VisualSearchMaskGeometryInput,
    inflate: InflateMaskCounts = defaultInflate,
    digest: DigestMaskGeometry = bytes => sha256Bytes(bytes),
): Promise<ReadonlyArray<VisualSearchPolygon>> => {
    const geometry = requireMaskGeometry(input);
    const canonicalJSON = canonicalVisualSearchMaskGeometryJSON(geometry);
    // Schema-v2 canonical geometry contains only ASCII keys, numbers and base64.
    const canonicalBytes = Uint8Array.from(
        canonicalJSON,
        character => character.charCodeAt(0),
    );
    const actualGeometrySha256 = (await digest(canonicalBytes)).toLowerCase();
    if (actualGeometrySha256 !== geometry.geometrySha256) {
        throw new Error('The mask canonical geometry SHA-256 identity does not match its content');
    }
    const decoded = await decodeMaskPixels(geometry, inflate);
    if (!sameBBox(
        visualSearchMaskPixelsBBox(decoded, geometry.width, geometry.height),
        geometry.bbox,
    )) {
        throw new Error('The mask RLE tight bbox differs from the result bbox');
    }
    const rasterized = rasterizeVisualSearchPolygons(
        geometry.polygons,
        geometry.width,
        geometry.height,
    );
    if (!samePixels(decoded, rasterized)) {
        throw new Error('The source polygons and canonical RLE are not bit-exact');
    }
    return geometry.polygons;
};
