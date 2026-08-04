import {
    canonicalVisualSearchMaskGeometryJSON,
    rasterizeVisualSearchPolygons,
    readVisualSearchStreamWithLimit,
    verifyVisualSearchMaskGeometry,
} from '../VisualSearchMaskGeometry';
import {
    VISUAL_SEARCH_MASK_LIMITS,
    VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
    VisualSearchMaskRLE,
    VisualSearchPolygon,
} from '../../store/visualSearch/types';
import {inflateSync} from 'zlib';

const varints = (counts: number[]): Uint8Array => {
    const bytes: number[] = [];
    counts.forEach(count => {
        let remaining = count;
        while (remaining >= 0x80) {
            bytes.push((remaining & 0x7f) | 0x80);
            remaining = Math.floor(remaining / 0x80);
        }
        bytes.push(remaining);
    });
    return new Uint8Array(bytes);
};

const countsFromPixels = (pixels: Uint8Array): number[] => {
    const counts: number[] = [];
    let bit = 0;
    let run = 0;
    pixels.forEach(pixel => {
        if (pixel === bit) run += 1;
        else {
            counts.push(run);
            bit = pixel;
            run = 1;
        }
    });
    counts.push(run);
    return counts;
};

const mask = (height: number, width: number): VisualSearchMaskRLE => ({
    encoding: 'binary_rle_varint_zlib_base64_v1',
    order: 'row-major',
    size: [height, width],
    countsBase64: 'Y29tcHJlc3NlZA==',
});

const polygon: VisualSearchPolygon = [[1, 1], [5, 1], [3, 4]];

describe('VisualSearchMaskGeometry', () => {
    it('matches the canonical boundary-inclusive triangle fixture', () => {
        const pixels = rasterizeVisualSearchPolygons([polygon], 8, 7);
        expect(Array.from(pixels)).toEqual(Array.from(new Uint8Array([
            0, 0, 0, 0, 0, 0, 0, 0,
            0, 1, 1, 1, 1, 1, 0, 0,
            0, 0, 1, 1, 1, 0, 0, 0,
            0, 0, 1, 1, 1, 0, 0, 0,
            0, 0, 0, 1, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0,
        ])));
    });

    it('pins the backend slanted-edge golden that differs from Pillow', async () => {
        const backendPolygon = [[6, 3], [7, 11], [1, 2]] as const;
        const pixels = rasterizeVisualSearchPolygons([backendPolygon], 12, 14);
        const rows = Array.from({length: 14}, (_unused, y) =>
            Array.from(pixels.slice(y * 12, (y + 1) * 12))
                .map(value => value ? '#' : '.')
                .join(''));

        expect(rows).toEqual([
            '............',
            '............',
            '.###........',
            '..#####.....',
            '..#####.....',
            '...####.....',
            '....###.....',
            '....####....',
            '.....###....',
            '......##....',
            '......##....',
            '.......#....',
            '............',
            '............',
        ]);

        await expect(verifyVisualSearchMaskGeometry({
            mask: {
                encoding: 'binary_rle_varint_zlib_base64_v1',
                order: 'row-major',
                size: [16, 16],
                countsBase64: 'eNpTZOZj5WblYeFl5gViPiY+Jn5GDwAJpQEB',
            },
            polygons: [backendPolygon],
            bbox: [1, 2, 8, 12],
            width: 16,
            height: 16,
            geometrySha256: '02b1bcf5e5c74c6123e9e6b06dad556847ebe0b702eae7ebfc59840205ee520a',
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        }, async compressed => new Uint8Array(inflateSync(compressed))))
            .resolves.toEqual([backendPolygon]);
    });

    it('accepts canonical RLE only when source polygons rasterize bit-exactly', async () => {
        // Copied from the backend's canonical integer-Bresenham fixture.
        const backendPolygon = [[16, 16], [48, 16], [48, 48], [16, 48]] as const;
        const backendMask: VisualSearchMaskRLE = {
            encoding: 'binary_rle_varint_zlib_base64_v1',
            order: 'row-major',
            size: [64, 64],
            countsBase64: 'eNqbwKEoTyE8zw4AR2wJkA==',
        };
        const inflate = jest.fn(async (compressed: Uint8Array) =>
            new Uint8Array(inflateSync(compressed)));

        await expect(verifyVisualSearchMaskGeometry({
            mask: backendMask,
            polygons: [backendPolygon],
            bbox: [16, 16, 49, 49],
            width: 64,
            height: 64,
            geometrySha256: '1ca3c978bc3c9f281e2385f87e17900d25f7b1fd74b4f1041f7d1a4c6a6ed62f',
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        }, inflate)).resolves.toEqual([backendPolygon]);
        expect(inflate).toHaveBeenCalledWith(expect.any(Uint8Array), 4097);
        expect(rasterizeVisualSearchPolygons([backendPolygon], 64, 64)
            .reduce((sum, value) => sum + value, 0)).toBe(1089);
    });

    it('rejects RLE and source polygons that differ by one pixel', async () => {
        const pixels = rasterizeVisualSearchPolygons([polygon], 8, 7);
        pixels[0] = 1;
        const inflate = jest.fn().mockResolvedValue(varints(countsFromPixels(pixels)));

        await expect(verifyVisualSearchMaskGeometry({
            mask: mask(7, 8),
            polygons: [polygon],
            bbox: [0, 0, 6, 5],
            width: 8,
            height: 7,
            geometrySha256: 'b'.repeat(64),
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        }, inflate, async () => 'b'.repeat(64))).rejects.toThrow('not bit-exact');
    });

    it('rejects missing source polygons rather than deriving contours', async () => {
        await expect(verifyVisualSearchMaskGeometry({
            mask: mask(7, 8),
            polygons: [],
            bbox: [1, 1, 6, 5],
            width: 8,
            height: 7,
            geometrySha256: 'c'.repeat(64),
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        }, jest.fn())).rejects.toThrow('lacks canonical RLE, source polygons');
    });

    it('fails closed on non-canonical fractional wire polygons', async () => {
        await expect(verifyVisualSearchMaskGeometry({
            mask: mask(7, 8),
            polygons: [[[1.5, 1], [5, 1], [3, 4]]],
            bbox: [1, 1, 6, 5],
            width: 8,
            height: 7,
            geometrySha256: 'd'.repeat(64),
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        }, jest.fn())).rejects.toThrow('canonical integer pixel coordinates');
    });

    it('fails closed on an unpinned rasterizer revision', async () => {
        await expect(verifyVisualSearchMaskGeometry({
            mask: mask(7, 8),
            polygons: [polygon],
            bbox: [1, 1, 6, 5],
            width: 8,
            height: 7,
            geometrySha256: 'e'.repeat(64),
            rasterizerRevision: 'pillow_inclusive_boundary_union_v1',
        }, jest.fn())).rejects.toThrow('unsupported rasterizer revision');
    });

    it('rejects a canonical vertex at x == width or y == height', async () => {
        await expect(verifyVisualSearchMaskGeometry({
            mask: mask(7, 8),
            polygons: [[[1, 1], [8, 1], [3, 7]]],
            bbox: [1, 1, 8, 7],
            width: 8,
            height: 7,
            geometrySha256: 'f'.repeat(64),
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        }, jest.fn())).rejects.toThrow('outside the full-image pixel bounds');
    });

    it('rebuilds backend schema-v2 canonical JSON before trusting geometry SHA', async () => {
        const backendPolygon = [[16, 16], [48, 16], [48, 48], [16, 48]] as const;
        const backendMask: VisualSearchMaskRLE = {
            encoding: 'binary_rle_varint_zlib_base64_v1',
            order: 'row-major',
            size: [64, 64],
            countsBase64: 'eNqbwKEoTyE8zw4AR2wJkA==',
        };
        expect(canonicalVisualSearchMaskGeometryJSON({
            mask: backendMask,
            polygons: [backendPolygon],
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        })).toBe('{"acceptance":{"eligible":true,"reason":null},"mask":' +
            '{"counts_base64":"eNqbwKEoTyE8zw4AR2wJkA==","encoding":' +
            '"binary_rle_varint_zlib_base64_v1","order":"row-major","size":[64,64]},' +
            '"polygons":[[[16,16],[48,16],[48,48],[16,48]]],' +
            '"rasterizer_revision":"integer_bresenham_half_open_v1","schema_version":2}');

        const inflate = jest.fn(async (compressed: Uint8Array) =>
            new Uint8Array(inflateSync(compressed)));
        await expect(verifyVisualSearchMaskGeometry({
            mask: backendMask,
            polygons: [backendPolygon],
            bbox: [16, 16, 49, 49],
            width: 64,
            height: 64,
            geometrySha256: '0'.repeat(64),
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        }, inflate)).rejects.toThrow('identity does not match its content');
        expect(inflate).not.toHaveBeenCalled();
    });

    it('cancels streamed decompression as soon as the output cap is crossed', async () => {
        const cancel = jest.fn();
        const releaseLock = jest.fn();
        const read = jest.fn()
            .mockResolvedValueOnce({done: false, value: new Uint8Array([1, 2])})
            .mockResolvedValueOnce({done: false, value: new Uint8Array([3, 4])});

        await expect(readVisualSearchStreamWithLimit({
            getReader: () => ({read, cancel, releaseLock}),
        }, 3)).rejects.toThrow('expands beyond');
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(read).toHaveBeenCalledTimes(2);
        expect(releaseLock).toHaveBeenCalledTimes(1);
    });

    it('rejects dimensions, polygon, vertex, and compressed-payload budget overflows', async () => {
        const base = {
            mask: mask(7, 8),
            polygons: [polygon],
            bbox: [1, 1, 6, 5] as const,
            width: 8,
            height: 7,
            geometrySha256: 'a'.repeat(64),
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        };
        await expect(verifyVisualSearchMaskGeometry({
            ...base,
            mask: mask(1, VISUAL_SEARCH_MASK_LIMITS.maxDimension + 1),
            width: VISUAL_SEARCH_MASK_LIMITS.maxDimension + 1,
            height: 1,
        }, jest.fn())).rejects.toThrow('dimensions exceed');
        await expect(verifyVisualSearchMaskGeometry({
            ...base,
            polygons: Array.from(
                {length: VISUAL_SEARCH_MASK_LIMITS.maxPolygons + 1},
                () => polygon,
            ),
        }, jest.fn())).rejects.toThrow('polygon count');
        await expect(verifyVisualSearchMaskGeometry({
            ...base,
            polygons: [Array.from(
                {length: VISUAL_SEARCH_MASK_LIMITS.maxVerticesPerPolygon + 1},
                () => [1, 1] as const,
            )],
        }, jest.fn())).rejects.toThrow('polygon exceeds');
        await expect(verifyVisualSearchMaskGeometry({
            ...base,
            polygons: Array.from(
                {length: VISUAL_SEARCH_MASK_LIMITS.maxPolygons},
                () => Array.from({
                    length: Math.floor(
                        VISUAL_SEARCH_MASK_LIMITS.maxTotalVertices /
                        VISUAL_SEARCH_MASK_LIMITS.maxPolygons,
                    ) + 1,
                }, () => [1, 1] as const),
            ),
        }, jest.fn())).rejects.toThrow('total vertex count');
        await expect(verifyVisualSearchMaskGeometry({
            ...base,
            mask: {
                ...base.mask,
                countsBase64: 'A'.repeat(
                    VISUAL_SEARCH_MASK_LIMITS.maxCountsBase64Length + 4,
                ),
            },
        }, jest.fn(), async () => 'a'.repeat(64))).rejects.toThrow('compressed payload');
    });

    it('rejects an injected decompression bomb before parsing its runs', async () => {
        const backendPolygon = [[16, 16], [48, 16], [48, 48], [16, 48]] as const;
        const inflate = jest.fn((_compressed: Uint8Array, maximumBytes: number) =>
            Promise.resolve(new Uint8Array(maximumBytes + 1)));
        await expect(verifyVisualSearchMaskGeometry({
            mask: {
                encoding: 'binary_rle_varint_zlib_base64_v1',
                order: 'row-major',
                size: [64, 64],
                countsBase64: 'eNqbwKEoTyE8zw4AR2wJkA==',
            },
            polygons: [backendPolygon],
            bbox: [16, 16, 49, 49],
            width: 64,
            height: 64,
            geometrySha256: '1ca3c978bc3c9f281e2385f87e17900d25f7b1fd74b4f1041f7d1a4c6a6ed62f',
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        }, inflate)).rejects.toThrow('expands beyond');
    });
});
