import {
    VisualSearchBBox,
    VisualSearchMaskRLE,
    VisualSearchPolygon,
    VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
} from '../store/visualSearch/types';

export type InflateMaskCounts = (
    compressed: Uint8Array,
    maximumBytes: number,
) => Promise<Uint8Array>;

export interface VisualSearchMaskGeometryInput {
    mask: VisualSearchMaskRLE | null | undefined;
    polygons: ReadonlyArray<VisualSearchPolygon> | null | undefined;
    bbox: VisualSearchBBox | null | undefined;
    width: number | null | undefined;
    height: number | null | undefined;
    geometrySha256: string | null | undefined;
    rasterizerRevision: string | null | undefined;
}

const decodeBase64 = (value: string): Uint8Array => {
    try {
        const binary = globalThis.atob(value);
        return Uint8Array.from(binary, character => character.charCodeAt(0));
    } catch {
        throw new Error('The mask RLE counts are not valid base64');
    }
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
        pipeThrough: (transform: unknown) => unknown;
    };
    const stream = source.pipeThrough(new constructor('deflate'));
    const output = new Uint8Array(await new Response(
        stream as BodyInit,
    ).arrayBuffer());
    if (output.byteLength > maximumBytes) {
        throw new Error('The mask RLE expands beyond its declared dimensions');
    }
    return output;
};

const decodeVarints = (packed: Uint8Array, pixelCount: number): number[] => {
    const counts: number[] = [];
    let value = 0;
    let shift = 0;
    let total = 0;
    for (const byte of packed) {
        value += (byte & 0x7f) * 2 ** shift;
        if (!Number.isSafeInteger(value)) throw new Error('The mask RLE varint is too large');
        if (byte & 0x80) {
            shift += 7;
            if (shift > 49) throw new Error('The mask RLE varint is too large');
            continue;
        }
        if (counts.length > 0 && value === 0) {
            throw new Error('The mask RLE contains a non-canonical empty run');
        }
        counts.push(value);
        total += value;
        if (total > pixelCount) throw new Error('The mask RLE exceeds its declared dimensions');
        value = 0;
        shift = 0;
    }
    if (shift !== 0) throw new Error('The mask RLE varint is truncated');
    if (counts.length === 0 || total !== pixelCount) {
        throw new Error('The mask RLE pixel count differs from its declared dimensions');
    }
    return counts;
};

const decodePixels = (counts: number[], pixelCount: number): Uint8Array => {
    const pixels = new Uint8Array(pixelCount);
    let offset = 0;
    counts.forEach((count, index) => {
        if (index % 2 === 1) pixels.fill(1, offset, offset + count);
        offset += count;
    });
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

const integerPolygon = (polygon: VisualSearchPolygon): Array<readonly [number, number]> =>
    polygon.map(point => [Math.trunc(point[0]), Math.trunc(point[1])] as const);

const fillPolygon = (
    pixels: Uint8Array,
    width: number,
    height: number,
    polygon: Array<readonly [number, number]>,
): void => {
    polygon.forEach((point, index) => {
        const next = polygon[(index + 1) % polygon.length];
        drawLine(pixels, width, height, point[0], point[1], next[0], next[1]);
    });
    const minimumY = Math.max(0, Math.min(...polygon.map(point => point[1])));
    const maximumY = Math.min(height - 1, Math.max(...polygon.map(point => point[1])));
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
            const start = Math.max(0, Math.ceil(intersections[index]));
            const end = Math.min(width - 1, Math.floor(intersections[index + 1]));
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
    const pixels = new Uint8Array(width * height);
    polygons.forEach(polygon => fillPolygon(
        pixels,
        width,
        height,
        integerPolygon(polygon),
    ));
    return pixels;
};

const pixelsBBox = (
    pixels: Uint8Array,
    width: number,
    height: number,
): VisualSearchBBox | null => {
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
    Boolean(left && left.every((value, index) => Math.abs(value - right[index]) <= 1e-6));

const samePixels = (left: Uint8Array, right: Uint8Array): boolean =>
    left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

interface RequiredMaskGeometry {
    mask: VisualSearchMaskRLE;
    polygons: ReadonlyArray<VisualSearchPolygon>;
    bbox: VisualSearchBBox;
    width: number;
    height: number;
}

const requireMaskGeometry = (
    input: VisualSearchMaskGeometryInput,
): RequiredMaskGeometry => {
    const {mask, polygons, bbox, width, height, geometrySha256} = input;
    if (!mask || !polygons?.length || !bbox || !width || !height) {
        throw new Error('The mask result lacks canonical RLE, source polygons, or dimensions');
    }
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
    if (polygons.some(polygon => polygon.some(point =>
        !Number.isInteger(point[0]) || !Number.isInteger(point[1])))) {
        throw new Error('Mask source polygons must use canonical integer pixel coordinates');
    }
    if (polygons.some(polygon => polygon.some(point =>
        point[0] < 0 || point[1] < 0 || point[0] >= width || point[1] >= height))) {
        throw new Error('Mask source polygons are outside the full-image pixel bounds');
    }
    return {mask, polygons, bbox, width, height};
};

const decodeMaskPixels = async (
    geometry: RequiredMaskGeometry,
    inflate: InflateMaskCounts,
): Promise<Uint8Array> => {
    const pixelCount = geometry.width * geometry.height;
    if (!Number.isSafeInteger(pixelCount) || pixelCount <= 0 || pixelCount > 250_000_000) {
        throw new Error('The mask dimensions are unsafe to decode');
    }
    const packed = await inflate(decodeBase64(geometry.mask.countsBase64), pixelCount + 1);
    if (packed.byteLength > pixelCount + 1) {
        throw new Error('The mask RLE expands beyond its declared dimensions');
    }
    return decodePixels(decodeVarints(packed, pixelCount), pixelCount);
};

export const verifyVisualSearchMaskGeometry = async (
    input: VisualSearchMaskGeometryInput,
    inflate: InflateMaskCounts = defaultInflate,
): Promise<ReadonlyArray<VisualSearchPolygon>> => {
    const geometry = requireMaskGeometry(input);
    const decoded = await decodeMaskPixels(geometry, inflate);
    if (!sameBBox(pixelsBBox(decoded, geometry.width, geometry.height), geometry.bbox)) {
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
