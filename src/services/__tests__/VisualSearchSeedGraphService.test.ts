import {VisualSearchSeedGraphService} from '../VisualSearchSeedGraphService';

const graphResponse = (generation = 0) => ({
    graph_id: 'seedgraph_one',
    root_task_id: 'task-one',
    collection: 'bbox-branch',
    query_kind: 'bbox',
    profile_id: 'fp-bbox',
    collection_revision: 'revision-one',
    top_k: 12,
    candidate_k: 48,
    negative_weight: 0.35,
    generation,
    seeds: [{
        seed_id: 'seed_root',
        parent_seed_id: null,
        result_id: null,
        polarity: 'positive',
        trust: 1,
        generation: 0,
        asset_id: null,
        region_id: null,
    }],
    evidence: [{
        seed_id: 'seed_root',
        polarity: 'positive',
        trust: 1,
        candidate_k: 1,
        searched_at: '2026-08-04T00:00:00Z',
        items: [],
    }],
    candidates: [{
        result_id: 'result-one',
        item: {
            result_id: 'result-one',
            asset_id: 'asset-one',
            dataset_id: 'dataset-one',
            dataset_revision: 4,
            rank: 1,
            image_path: '/data/one.jpg',
            filename: 'one.jpg',
            width: 100,
            height: 80,
            score: 0.91,
            dino_score: 0.91,
            bbox: [2, 3, 20, 30],
            content_sha256: 'a'.repeat(64),
            region_id: 'region-one',
            granularity: 'bbox',
            region_source: 'dataset_yolo',
            geometry: {kind: 'bbox', bbox: [2, 3, 20, 30]},
        },
        positive_score: 0.91,
        negative_score: 0,
        fused_score: 0.91,
        discovered_by: ['seed_root'],
        first_generation: 0,
        status: 'candidate',
    }],
    created_at: '2026-08-04T00:00:00Z',
    updated_at: '2026-08-04T00:00:00Z',
});

const jsonResponse = (body: unknown): Response => ({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
} as unknown as Response);

describe('VisualSearchSeedGraphService', () => {
    it('creates and expands a graph using stable result identities', async () => {
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(jsonResponse(graphResponse()))
            .mockResolvedValueOnce(jsonResponse(graphResponse(1)));
        const service = new VisualSearchSeedGraphService({
            baseUrl: 'https://extension.test/vector_db',
            fetchImpl,
        });

        const created = await service.create('task-one', 12, 48);
        const expanded = await service.expand(created.graphId, {
            acceptResultIds: ['result-one'],
            rejectResultIds: [],
            candidateK: 48,
        });

        expect(created.candidates[0].item).toEqual(expect.objectContaining({
            resultId: 'result-one',
            assetId: 'asset-one',
            regionId: 'region-one',
            bbox: [2, 3, 20, 30],
        }));
        expect(expanded.generation).toBe(1);
        expect(created.evidence[0]).toEqual(expect.objectContaining({
            seedId: 'seed_root',
            candidateK: 1,
        }));
        expect(fetchImpl).toHaveBeenNthCalledWith(
            1,
            'https://extension.test/vector_db/tasks/task-one/seed-graph',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({top_k: 12, candidate_k: 48}),
            }),
        );
        expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
            accept_result_ids: ['result-one'],
            reject_result_ids: [],
            candidate_k: 48,
        });
    });

    it('preserves the mask seed-graph contract from the server', async () => {
        const response = graphResponse();
        response.query_kind = 'mask';
        const service = new VisualSearchSeedGraphService({
            fetchImpl: jest.fn().mockResolvedValue(jsonResponse(response)),
        });

        const graph = await service.create('mask-task');

        expect(graph.queryKind).toBe('mask');
        expect(graph.negativeWeight).toBe(0.35);
    });
});
