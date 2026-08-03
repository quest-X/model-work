import {
    normalizeVisualSearchTask,
    serializeVisualSearchSnapshot,
    VisualSearchAPI,
    VisualSearchAPIError,
} from '../VisualSearchAPI';
import {VisualSearchQuerySnapshot} from '../../store/visualSearch/types';

jest.mock('../../utils/DefaultBackendUrl', () => ({
    getExtensionEngineBaseUrl: () => 'https://gateway.test/extension_service',
}));

const response = (body: unknown, status: number = 200): Response => ({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
} as unknown as Response);

const snapshot = (kind: 'image' | 'bbox' | 'mask' = 'image'): VisualSearchQuerySnapshot => {
    const snapshotId = `snapshot-${kind}`;
    const maskFile = kind === 'mask'
        ? new File(['mask'], `${snapshotId}-mask.png`, {type: 'image/png'})
        : undefined;
    const geometry = kind === 'image'
        ? {kind: 'image'} as const
        : kind === 'bbox'
            ? {kind: 'bbox', bbox: [1, 2, 30, 40] as const} as const
            : {
                kind: 'mask',
                polygons: [[[1, 2], [30, 2], [30, 40]]] as const,
                bbox: [1, 2, 30, 40] as const,
                maskFileName: `${snapshotId}-mask.png`,
            } as const;
    const imageFile = new File(['pixels'], 'frame.jpg', {type: 'image/jpeg'});
    return {
        snapshotId,
        capturedAt: 123,
        source: {
            imageId: 'image-1',
            assetId: 'asset-1',
            fileName: 'frame.jpg',
            mediaKind: 'frame',
            frameIndex: 12,
            videoSessionId: 'session-1',
            datasetId: 'source-dataset',
            datasetRevision: 3,
        },
        profile: {id: 'dinov3-sat', modelRevision: 'model-rev-1'},
        target: {
            collection: 'scene/target/v1',
            collectionRevision: 'collection-rev-1',
            datasetId: 'target-dataset',
            datasetRevision: 7,
        },
        options: {
            topK: 10,
            candidateK: 40,
            className: 'goose',
            idempotencyKey: snapshotId,
        },
        geometry,
        image: {
            fileName: imageFile.name,
            mimeType: imageFile.type,
            size: imageFile.size,
            width: 1920,
            height: 1080,
        },
        imageFile,
        maskFile,
    };
};

describe('VisualSearchAPI', () => {
    it('uses the canonical vector-db task routes by default', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response({
            task_id: 'task/1',
            state: 'queued',
        }));
        const api = new VisualSearchAPI({fetchImpl});

        await api.createJob(snapshot('image'));
        await api.getJob('task/1');
        await api.cancelJob('task/1');

        expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
            'https://gateway.test/extension_service/vector_db/tasks',
            'https://gateway.test/extension_service/vector_db/tasks/task%2F1',
            'https://gateway.test/extension_service/vector_db/tasks/task%2F1/cancel',
        ]);
    });

    it('posts compatibility fields plus the complete immutable snapshot spec', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response({
            task_id: 'task-1',
            state: 'queued',
            created_at: 100,
        }));
        const api = new VisualSearchAPI({
            baseUrl: 'https://example.test/extension_service/l2g_retrieval',
            fetchImpl,
        });
        const query = snapshot('mask');

        await api.createJob(query);

        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://example.test/extension_service/l2g_retrieval/tasks');
        expect(init.method).toBe('POST');
        const form = init.body as FormData;
        expect(form.get('image')).toBeInstanceOf(File);
        expect(form.get('mask')).toBeInstanceOf(File);
        expect(form.get('query_kind')).toBe('mask');
        expect(form.get('collection')).toBe('scene/target/v1');
        expect(form.get('expected_profile_id')).toBe('dinov3-sat');
        expect(form.get('expected_model_revision')).toBe('model-rev-1');
        expect(form.get('expected_collection_revision')).toBe('collection-rev-1');
        expect(form.get('enable_naf')).toBe('false');
        expect(form.get('sam_rounds')).toBe('0');

        const spec = JSON.parse(String(form.get('spec')));
        expect(spec).toEqual(expect.objectContaining({
            spec_version: 1,
            snapshot_id: 'snapshot-mask',
            source: expect.objectContaining({
                image_id: 'image-1',
                asset_id: 'asset-1',
                media_kind: 'frame',
                frame_index: 12,
                video_session_id: 'session-1',
                dataset_id: 'source-dataset',
                dataset_revision: 3,
            }),
            target: expect.objectContaining({
                dataset_id: 'target-dataset',
                dataset_revision: 7,
                collection_revision: 'collection-rev-1',
            }),
            query: expect.objectContaining({
                kind: 'mask',
                polygons: [[[1, 2], [30, 2], [30, 40]]],
            }),
            image: expect.objectContaining({width: 1920, height: 1080}),
        }));
    });

    it('sends bbox only for bbox queries', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response({
            task_id: 'task-bbox',
            state: 'queued',
        }));
        const api = new VisualSearchAPI({baseUrl: 'https://example.test', fetchImpl});

        await api.createJob(snapshot('bbox'));

        const form = fetchImpl.mock.calls[0][1].body as FormData;
        expect(form.get('bbox')).toBe('[1,2,30,40]');
        expect(form.get('mask')).toBeNull();
    });

    it('omits compare-and-swap revision fields until the backend freezes them', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response({
            task_id: 'task-unpinned',
            state: 'queued',
        }));
        const api = new VisualSearchAPI({baseUrl: 'https://example.test', fetchImpl});
        const query = snapshot('image');
        query.profile = {id: query.profile.id, modelRevision: null};
        query.target = {...query.target, collectionRevision: null};

        await api.createJob(query);

        const form = fetchImpl.mock.calls[0][1].body as FormData;
        expect(form.get('expected_profile_id')).toBe('dinov3-sat');
        expect(form.get('expected_model_revision')).toBeNull();
        expect(form.get('expected_collection_revision')).toBeNull();
        expect(JSON.parse(String(form.get('spec')))).toEqual(expect.objectContaining({
            profile: {profile_id: 'dinov3-sat', model_revision: null},
            target: expect.objectContaining({collection_revision: null}),
        }));
    });

    it('normalizes exact result identity, geometry, and revisions', () => {
        const task = normalizeVisualSearchTask({
            task_id: 'task-1',
            state: 'succeeded',
            progress: 1,
            result: {
                collection: 'scene/target/v1',
                query_kind: 'bbox',
                query_geometry: {kind: 'bbox', bbox: [1, 2, 30, 40]},
                profile_id: 'dinov3-sat',
                model_revision: 'model-rev-1',
                collection_revision: 'collection-rev-1',
                executed_stages: ['dino'],
                stage_status: {dino: 'succeeded'},
                elapsed_ms: 12.5,
                items: [{
                    result_id: 'stable-result-1',
                    asset_id: 'asset-result-1',
                    dataset_id: 'target-dataset',
                    dataset_revision: 7,
                    rank: 1,
                    filename: 'goose.jpg',
                    image_path: '/dataset/goose.jpg',
                    width: 1920,
                    height: 1080,
                    conf: 0.88,
                    score: 0.95,
                    content_sha256: 'sha256:goose',
                    region_id: 'region-1',
                    granularity: 'bbox',
                    region_source: 'annotation',
                    bbox: [1, 2, 30, 40],
                    geometry: {kind: 'bbox', bbox: [1, 2, 30, 40]},
                }],
            },
        });

        expect(task.state).toBe('succeeded');
        expect(task.progress).toBe(100);
        expect(task.result).toEqual(expect.objectContaining({
            queryKind: 'bbox',
            collection: 'scene/target/v1',
            queryGeometry: expect.objectContaining({kind: 'bbox'}),
            profileId: 'dinov3-sat',
            modelRevision: 'model-rev-1',
            collectionRevision: 'collection-rev-1',
        }));
        expect(task.result?.items[0]).toEqual(expect.objectContaining({
            resultId: 'stable-result-1',
            assetId: 'asset-result-1',
            datasetId: 'target-dataset',
            datasetRevision: 7,
            width: 1920,
            height: 1080,
            path: '/dataset/goose.jpg',
            confidence: 0.88,
            contentSha256: 'sha256:goose',
            regionId: 'region-1',
            geometry: expect.objectContaining({kind: 'bbox'}),
        }));
    });

    it('normalizes only full-image canonical RLE for mask results', () => {
        const task = normalizeVisualSearchTask({
            task_id: 'task-mask',
            state: 'succeeded',
            result: {
                collection: 'scene/masks/v1',
                query_kind: 'mask',
                profile_id: 'profile-mask',
                collection_revision: 'collection-mask-1',
                query_geometry: {
                    kind: 'mask',
                    bbox: [1, 2, 4, 5],
                    mask: {
                        encoding: 'binary_rle_varint_zlib_base64_v1',
                        order: 'row-major',
                        size: [6, 8],
                        counts_base64: 'eJxjZAQAAAMAAg==',
                    },
                },
                items: [{
                    result_id: 'result-mask-1',
                    asset_id: '0123456789abcdef0123456789abcdef',
                    dataset_id: 'dataset-mask',
                    dataset_revision: 2,
                    rank: 1,
                    filename: 'mask.png',
                    image_path: '/dataset/mask.png',
                    width: 8,
                    height: 6,
                    score: 0.97,
                    content_sha256: 'a'.repeat(64),
                    region_id: 'region-mask-1',
                    granularity: 'mask',
                    bbox: [1, 2, 4, 5],
                    geometry: {
                        kind: 'mask',
                        bbox: [1, 2, 4, 5],
                        polygons: [[[1, 2], [4, 2], [4, 5], [1, 5]]],
                        mask: {
                            encoding: 'binary_rle_varint_zlib_base64_v1',
                            order: 'row-major',
                            size: [6, 8],
                            counts_base64: 'eJxjZAQAAAMAAg==',
                        },
                    },
                }],
            },
        });

        expect(task.result?.items[0].geometry?.mask).toEqual({
            encoding: 'binary_rle_varint_zlib_base64_v1',
            order: 'row-major',
            size: [6, 8],
            countsBase64: 'eJxjZAQAAAMAAg==',
        });
        expect(task.result?.items[0].geometry?.polygons).toEqual([
            [[1, 2], [4, 2], [4, 5], [1, 5]],
        ]);
    });

    it('keeps a mask result previewable but non-acceptable when canonical RLE is absent', () => {
        const task = normalizeVisualSearchTask({
            task_id: 'task-mask-invalid',
            state: 'succeeded',
            result: {
                query_kind: 'mask',
                profile_id: 'profile-mask',
                collection_revision: 'collection-mask-1',
                items: [{
                    result_id: 'result-mask-invalid',
                    width: 8,
                    height: 6,
                    granularity: 'mask',
                    bbox: [1, 2, 4, 5],
                    geometry: {
                        kind: 'mask',
                        bbox: [1, 2, 4, 5],
                        polygons: [[[1, 2], [4, 2], [4, 5], [1, 5]]],
                    },
                }],
            },
        });
        expect(task.result?.items[0].geometry).toEqual(expect.objectContaining({
            kind: 'mask',
            mask: null,
            polygons: expect.any(Array),
        }));
    });

    it('maps interrupted to a retryable terminal failure', () => {
        expect(normalizeVisualSearchTask({
            task_id: 'task-interrupted',
            state: 'interrupted',
            recovery_count: 2,
            updated_at: '2026-07-27T10:00:00Z',
        })).toEqual(expect.objectContaining({
            state: 'failed',
            phase: 'failed',
            recoveryCount: 2,
            updatedAt: Date.parse('2026-07-27T10:00:00Z'),
            error: {
                code: 'task_interrupted',
                message: expect.any(String),
                retryable: true,
            },
        }));
    });

    it('fails closed when a result lacks stable backend identity', () => {
        expect(() => normalizeVisualSearchTask({
            task_id: 'task-unstable',
            state: 'succeeded',
            result: {
                query_kind: 'image',
                profile_id: 'profile',
                model_revision: 'revision',
                collection_revision: 'collection-revision',
                items: [{rank: 1, filename: 'unstable.jpg', score: 0.5}],
            },
        })).toThrow('stable result_id');
    });

    it('posts cancellation and surfaces structured backend errors', async () => {
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(response({task_id: 'task/a', state: 'cancelled'}))
            .mockResolvedValueOnce(response({
                detail: {code: 'collection_revision_mismatch', message: 'collection changed'},
            }, 409));
        const api = new VisualSearchAPI({baseUrl: 'https://example.test', fetchImpl});

        await api.cancelJob('task/a');
        expect(fetchImpl).toHaveBeenNthCalledWith(
            1,
            'https://example.test/tasks/task%2Fa/cancel',
            expect.objectContaining({method: 'POST'}),
        );
        await expect(api.getJob('task-2')).rejects.toEqual(
            expect.objectContaining<Partial<VisualSearchAPIError>>({
                name: 'VisualSearchAPIError',
                status: 409,
                code: 'collection_revision_mismatch',
                message: 'collection changed',
            }),
        );
    });

    it('serializes no upload File objects into spec JSON', () => {
        const value = serializeVisualSearchSnapshot(snapshot('image'));
        expect(value).not.toHaveProperty('imageFile');
        expect(value).not.toHaveProperty('maskFile');
        expect(JSON.stringify(value)).not.toContain('pixels');
    });
});
