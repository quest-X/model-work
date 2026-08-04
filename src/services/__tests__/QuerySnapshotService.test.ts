import {
    QuerySnapshotInput,
    QuerySnapshotPhase,
    QuerySnapshotService,
} from '../QuerySnapshotService';
import {
    VISUAL_SEARCH_MASK_LIMITS,
    VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
} from '../../store/visualSearch/types';

const baseInput = (overrides: Partial<QuerySnapshotInput> = {}): QuerySnapshotInput => ({
    imageBlob: new File(['pixels'], 'source.png', {type: 'image/png', lastModified: 7}),
    width: 100,
    height: 80,
    source: {
        imageId: 'image-1',
        assetId: 'asset-1',
        fileName: 'source.png',
        mediaKind: 'image',
        datasetId: 'source-dataset',
        datasetRevision: 4,
    },
    profile: {id: 'dinov3-sat', modelRevision: 'sha256:model-v1'},
    target: {
        collection: 'scene/target/v1',
        collectionRevision: 'collection-rev-1',
        datasetId: 'target-dataset',
        datasetRevision: 9,
    },
    options: {topK: 10, candidateK: 50, className: 'goose'},
    geometry: {kind: 'image'},
    ...overrides,
});

describe('QuerySnapshotService', () => {
    it('copies image bytes and freezes exact source/profile/target metadata', async () => {
        const input = baseInput();
        const snapshot = await QuerySnapshotService.capture(input, {
            createId: () => 'snapshot-1',
            now: () => 1234,
        });

        expect(snapshot.snapshotId).toBe('snapshot-1');
        expect(snapshot.capturedAt).toBe(1234);
        expect(snapshot.imageFile).not.toBe(input.imageBlob);
        expect(snapshot.imageFile.size).toBe(input.imageBlob.size);
        expect(snapshot.source).toEqual(expect.objectContaining({
            imageId: 'image-1',
            assetId: 'asset-1',
            datasetId: 'source-dataset',
            datasetRevision: 4,
        }));
        expect(snapshot.profile).toEqual({
            id: 'dinov3-sat',
            modelRevision: 'sha256:model-v1',
        });
        expect(snapshot.target.collectionRevision).toBe('collection-rev-1');
        expect(snapshot.options.idempotencyKey).toBe('snapshot-1');
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.source)).toBe(true);
    });

    it('resolves a zero-byte video placeholder into the exact frame', async () => {
        const phases: QuerySnapshotPhase[] = [];
        const resolveFrame = jest.fn().mockResolvedValue(
            new File(['frame-pixels'], 'frame_000042.jpg', {type: 'image/jpeg'}),
        );
        const snapshot = await QuerySnapshotService.capture(baseInput({
            imageBlob: new File([], 'frame_000042.jpg', {type: 'image/jpeg'}),
            source: {
                imageId: 'frame-image-42',
                fileName: 'frame_000042.jpg',
                mediaKind: 'frame',
                frameIndex: 42,
                videoSessionId: 'video-session-1',
                datasetId: 'video-dataset',
                datasetRevision: 2,
            },
            resolveFrame,
        }), {
            createId: () => 'frame-snapshot',
            onPhase: phase => phases.push(phase),
        });

        expect(resolveFrame).toHaveBeenCalledTimes(1);
        expect(snapshot.imageFile.size).toBeGreaterThan(0);
        expect(snapshot.source).toEqual(expect.objectContaining({
            mediaKind: 'frame',
            frameIndex: 42,
            videoSessionId: 'video-session-1',
        }));
        expect(phases).toEqual([
            'resolving-source',
            'copying-image',
            'freezing-snapshot',
            'complete',
        ]);
    });

    it('preserves unknown backend fingerprints as null instead of inventing revisions', async () => {
        const snapshot = await QuerySnapshotService.capture(baseInput({
            profile: {id: 'dinov3-sat', modelRevision: null},
            target: {
                collection: 'scene/target/v1',
                collectionRevision: null,
            },
        }), {createId: () => 'server-pinned-snapshot'});

        expect(snapshot.profile.modelRevision).toBeNull();
        expect(snapshot.target).toEqual({
            collection: 'scene/target/v1',
            collectionRevision: null,
        });
    });

    it('normalizes and deep-copies bbox geometry in image coordinates', async () => {
        const bbox: [number, number, number, number] = [90, 20, -10, 120];
        const snapshot = await QuerySnapshotService.capture(baseInput({
            geometry: {kind: 'bbox', bbox},
        }), {createId: () => 'bbox-snapshot'});
        bbox[0] = 1;

        expect(snapshot.geometry).toEqual({
            kind: 'bbox',
            bbox: [0, 20, 90, 80],
        });
        if (snapshot.geometry.kind === 'bbox') {
            expect(Object.isFrozen(snapshot.geometry.bbox)).toBe(true);
        }
    });

    it('deep-copies polygons and creates an authoritative PNG mask', async () => {
        const polygons: [number, number][][] = [[
            [-10, 5],
            [30, 5],
            [30, 90],
            [-10, 90],
        ]];
        let encodedPixels: Uint8Array | null = null;
        const encodeMask = jest.fn(async (pixels: Uint8Array) => {
            encodedPixels = pixels;
            return new Blob(['png-mask'], {type: 'image/png'});
        });
        const snapshot = await QuerySnapshotService.capture(baseInput({
            geometry: {kind: 'mask', polygons},
        }), {
            createId: () => 'mask-snapshot',
            encodeMask,
        });
        polygons[0][0][0] = 77;

        expect(encodeMask).toHaveBeenCalledWith(expect.any(Uint8Array), 100, 80);
        expect(encodedPixels?.reduce((sum, value) => sum + value, 0)).toBe(2325);
        expect(snapshot.geometry).toEqual({
            kind: 'mask',
            polygons: [[[0, 5], [30, 5], [30, 79], [0, 79]]],
            bbox: [0, 5, 31, 80],
            maskFileName: 'mask-snapshot-mask.png',
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        });
        expect(snapshot.maskFile).toEqual(expect.objectContaining({
            name: 'mask-snapshot-mask.png',
            type: 'image/png',
        }));
    });

    it('truncates then clamps float vertices to canonical full-image pixels', async () => {
        let encodedPixels: Uint8Array | null = null;
        const snapshot = await QuerySnapshotService.capture(baseInput({
            width: 6,
            height: 5,
            geometry: {
                kind: 'mask',
                polygons: [[[-2.8, -1.2], [6.9, 1.9], [4.8, 5.7]]],
            },
        }), {
            createId: () => 'canonical-boundary-mask',
            encodeMask: async pixels => {
                encodedPixels = pixels;
                return new Blob(['png-mask'], {type: 'image/png'});
            },
        });

        expect(snapshot.geometry).toEqual({
            kind: 'mask',
            polygons: [[[0, 0], [5, 1], [4, 4]]],
            bbox: [0, 0, 6, 5],
            maskFileName: 'canonical-boundary-mask-mask.png',
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        });
        expect(encodedPixels?.[0]).toBe(1);
        expect(encodedPixels?.[4 * 6 + 4]).toBe(1);
    });

    it('rasterizes multiple polygons as a foreground union', async () => {
        let encodedPixels: Uint8Array | null = null;
        const snapshot = await QuerySnapshotService.capture(baseInput({
            width: 6,
            height: 6,
            geometry: {
                kind: 'mask',
                polygons: [
                    [[1, 1], [3, 1], [3, 3], [1, 3]],
                    [[2, 2], [4, 2], [4, 4], [2, 4]],
                ],
            },
        }), {
            createId: () => 'union-mask',
            encodeMask: async pixels => {
                encodedPixels = pixels;
                return new Blob(['png-mask'], {type: 'image/png'});
            },
        });

        expect(snapshot.geometry).toEqual(expect.objectContaining({
            bbox: [1, 1, 5, 5],
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        }));
        expect(encodedPixels?.reduce((sum, value) => sum + value, 0)).toBe(14);
        expect(encodedPixels?.[2 * 6 + 2]).toBe(1);
    });

    it('fails closed instead of accepting an unverified caller mask PNG', async () => {
        const encodeMask = jest.fn();
        await expect(QuerySnapshotService.capture(baseInput({
            geometry: {
                kind: 'mask',
                polygons: [[[1, 1], [5, 1], [5, 5], [1, 5]]],
                maskBlob: new Blob(['unverified'], {type: 'image/png'}),
            },
        }), {encodeMask})).rejects.toThrow(
            'maskBlob cannot override canonical polygon rasterization',
        );
        expect(encodeMask).not.toHaveBeenCalled();
    });

    it('rejects invalid configuration before uploading anything', async () => {
        await expect(QuerySnapshotService.capture(baseInput({
            options: {topK: 20, candidateK: 10},
        }))).rejects.toThrow('candidateK');
        await expect(QuerySnapshotService.capture(baseInput({
            geometry: {kind: 'bbox', bbox: [1, 1, 1, 10]},
        }))).rejects.toThrow('positive area');
        await expect(QuerySnapshotService.capture(baseInput({
            source: {
                imageId: 'image-1',
                fileName: 'source.png',
                mediaKind: 'image',
                datasetId: 'dataset-without-revision',
            },
        }))).rejects.toThrow('provided together');
    });

    it('rejects an image query whose total pixel count exceeds the shared hard budget', async () => {
        const width = 10_001;
        const height = 10_000;
        expect(width).toBeLessThan(VISUAL_SEARCH_MASK_LIMITS.maxDimension);
        expect(height).toBeLessThan(VISUAL_SEARCH_MASK_LIMITS.maxDimension);
        expect(width * height).toBeGreaterThan(VISUAL_SEARCH_MASK_LIMITS.maxPixels);

        await expect(QuerySnapshotService.capture(baseInput({
            width,
            height,
            geometry: {kind: 'image'},
        }))).rejects.toThrow('pixel count exceeds the frontend safety limit');
    });
});
