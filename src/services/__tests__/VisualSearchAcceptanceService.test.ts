import configureStore from '../../configureStore';
import {LabelStatus} from '../../data/enums/LabelStatus';
import {UndoStack} from '../../logic/undo/UndoStack';
import {updateImageData} from '../../store/labels/actionCreators';
import {ImageData} from '../../store/labels/types';
import {addQueueItem, setActiveQueueItem, updateQueueItem} from '../../store/queue/actionCreators';
import {
    QueueDataSyncStatus,
    QueueItemStatus,
    QueueItemType,
} from '../../store/queue/types';
import {
    visualSearchJobStarted,
    visualSearchJobUpdated,
} from '../../store/visualSearch/actionCreators';
import {
    VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
    VisualSearchSnapshotMetadata,
} from '../../store/visualSearch/types';
import {VisualSearchAcceptanceService} from '../VisualSearchAcceptanceService';

jest.mock('../../index', () => ({
    store: {getState: jest.fn(), dispatch: jest.fn()},
}));

jest.mock('../../logic/actions/EditorActions', () => ({
    EditorActions: {fullRender: jest.fn()},
}));

const DIGEST = 'a'.repeat(64);
const ASSET_ID = '0123456789abcdef0123456789abcdef';
const MASK_POLYGONS = [
    [[10, 20], [30, 20], [30, 40], [10, 40]],
    [[40, 25], [55, 25], [55, 45], [40, 45]],
] as const;

const metadata: VisualSearchSnapshotMetadata = {
    snapshotId: 'snapshot-bbox',
    capturedAt: 100,
    source: {
        imageId: 'query-image',
        fileName: 'query.png',
        mediaKind: 'image',
        datasetId: 'dataset-1',
        datasetRevision: 7,
    },
    profile: {id: 'profile-bbox', modelRevision: 'model-rev-1'},
    target: {
        collection: 'collection-bbox',
        collectionRevision: 'collection-rev-1',
        datasetId: 'dataset-1',
        datasetRevision: 7,
    },
    options: {topK: 10, candidateK: 40, idempotencyKey: 'snapshot-bbox'},
    geometry: {kind: 'bbox', bbox: [1, 2, 30, 40]},
    image: {
        fileName: 'query.png',
        mimeType: 'image/png',
        size: 10,
        width: 100,
        height: 80,
    },
};

const resultFile = () => new File(['result-pixels'], 'goose.jpg', {type: 'image/jpeg'});

const imageData = (file: File): ImageData => ({
    id: 'target-image',
    fileData: file,
    loadStatus: true,
    labelRects: [],
    labelPoints: [],
    labelLines: [],
    labelPolygons: [],
    labelNameIds: [],
    isVisitedByRoboflowAPI: false,
});

const readyStore = () => {
    const testStore = configureStore();
    const file = resultFile();
    testStore.dispatch(updateImageData([imageData(file)]));
    testStore.dispatch(addQueueItem({
        id: 'queue-1',
        name: 'goose',
        type: QueueItemType.IMAGE,
        file,
        status: QueueItemStatus.COMPLETED,
        uploadedAt: 100,
        dataSyncStatus: QueueDataSyncStatus.SYNCED,
        datasetId: 'dataset-1',
        datasetRevision: 7,
    }));
    testStore.dispatch(setActiveQueueItem('queue-1'));
    testStore.dispatch(visualSearchJobStarted('snapshot-bbox', metadata, 100));
    testStore.dispatch(visualSearchJobUpdated('snapshot-bbox', {
        taskId: 'task-1',
        state: 'succeeded',
        phase: 'completed',
        result: {
            collection: 'collection-bbox',
            queryKind: 'bbox',
            queryGeometry: {
                kind: 'bbox',
                bbox: [1, 2, 30, 40],
            },
            profileId: 'profile-bbox',
            modelRevision: 'model-rev-1',
            collectionRevision: 'collection-rev-1',
            executedStages: ['dino'],
            stageStatus: {dino: 'completed'},
            total: 1,
            elapsedMs: 8,
            items: [{
                resultId: 'result-1',
                assetId: ASSET_ID,
                datasetId: 'dataset-1',
                datasetRevision: 7,
                rank: 1,
                path: '/datasets/goose.jpg',
                fileName: 'goose.jpg',
                width: 100,
                height: 80,
                className: 'goose',
                confidence: 0.81,
                score: 0.92,
                dinoScore: 0.92,
                bbox: [10, 20, 50, 60],
                thumbnail: null,
                contentSha256: DIGEST,
                regionId: 'region-1',
                granularity: 'bbox',
                regionSource: 'dataset',
                geometrySha256: null,
                acceptanceEligible: null,
                acceptanceReason: null,
                geometry: {kind: 'bbox', bbox: [10, 20, 50, 60]},
            }],
        },
    }, 120));
    return {testStore, file};
};

const readyMaskStore = () => {
    const {testStore, file} = readyStore();
    const maskMetadata: VisualSearchSnapshotMetadata = {
        ...metadata,
        snapshotId: 'snapshot-mask',
        geometry: {
            kind: 'mask',
            polygons: MASK_POLYGONS,
            bbox: [10, 20, 55, 45],
            maskFileName: 'snapshot-mask.png',
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        },
        options: {...metadata.options, idempotencyKey: 'snapshot-mask'},
    };
    testStore.dispatch(visualSearchJobStarted('snapshot-mask', maskMetadata, 100));
    testStore.dispatch(visualSearchJobUpdated('snapshot-mask', {
        taskId: 'task-mask-1',
        state: 'succeeded',
        phase: 'completed',
        result: {
            collection: 'collection-mask',
            queryKind: 'mask',
            queryGeometry: {kind: 'mask', bbox: [10, 20, 55, 45]},
            profileId: 'profile-mask',
            modelRevision: 'model-rev-1',
            collectionRevision: 'collection-mask-rev-1',
            executedStages: ['dino'],
            stageStatus: {dino: 'completed'},
            total: 1,
            elapsedMs: 8,
            items: [{
                resultId: 'mask-result-1',
                assetId: ASSET_ID,
                datasetId: 'dataset-1',
                datasetRevision: 7,
                rank: 1,
                path: '/datasets/goose.jpg',
                fileName: 'goose.jpg',
                width: 100,
                height: 80,
                className: 'goose',
                confidence: 0.84,
                score: 0.94,
                dinoScore: 0.94,
                bbox: [10, 20, 55, 45],
                thumbnail: null,
                contentSha256: DIGEST,
                regionId: 'mask-region-1',
                granularity: 'mask',
                regionSource: 'workspace_polygon',
                geometrySha256: 'c'.repeat(64),
                acceptanceEligible: true,
                acceptanceReason: null,
                geometry: {
                    kind: 'mask',
                    bbox: [10, 20, 55, 45],
                    rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
                    polygons: MASK_POLYGONS,
                    mask: {
                        encoding: 'binary_rle_varint_zlib_base64_v1',
                        order: 'row-major',
                        size: [80, 100],
                        countsBase64: 'eJw=',
                    },
                },
            }],
        },
    }, 120));
    return {testStore, file};
};

describe('VisualSearchAcceptanceService', () => {
    beforeEach(() => UndoStack.clear());

    it('accepts one exact bbox in one reducer action and one undo snapshot', async () => {
        const {testStore} = readyStore();
        UndoStack.clear();
        const afterAccept = jest.fn();
        const service = new VisualSearchAcceptanceService({
            getState: testStore.getState,
            dispatch: testStore.dispatch,
            digestFile: async () => DIGEST,
            afterAccept,
        });

        const accepted = await service.accept('snapshot-bbox', 'result-1');
        const state = testStore.getState();
        const rect = state.labels.imagesData[0].labelRects[0];

        expect(accepted).toEqual({
            imageId: 'target-image',
            labelRectId: 'visual-search:task-1:result-1',
        });
        expect(rect).toEqual(expect.objectContaining({
            id: 'visual-search:task-1:result-1',
            rect: {x: 10, y: 20, width: 40, height: 40},
            status: LabelStatus.ACCEPTED,
            isCreatedByAI: true,
            suggestedLabel: 'goose',
            confidence: 0.81,
        }));
        expect(state.labels.activeImageIndex).toBe(0);
        expect(state.labels.activeLabelId).toBe(rect.id);
        expect(state.queue.items[0].dataSyncStatus).toBe(QueueDataSyncStatus.DIRTY);
        expect(UndoStack.size()).toBe(1);
        await expect(service.accept('snapshot-bbox', 'result-1')).rejects.toThrow(
            'visual_search_acceptance_cas: already_accepted',
        );
        expect(UndoStack.size()).toBe(1);
        expect(UndoStack.pop()?.imagesData[0].labelRects).toEqual([]);
        expect(afterAccept).toHaveBeenCalledTimes(1);
    });

    it('fails the synchronous CAS if dataset revision changes during hashing', async () => {
        const {testStore} = readyStore();
        UndoStack.clear();
        let resolveDigest: ((value: string) => void) | undefined;
        const service = new VisualSearchAcceptanceService({
            getState: testStore.getState,
            dispatch: testStore.dispatch,
            digestFile: () => new Promise(resolve => {
                resolveDigest = resolve;
            }),
            afterAccept: jest.fn(),
        });

        const accepting = service.accept('snapshot-bbox', 'result-1');
        await Promise.resolve();
        testStore.dispatch(updateQueueItem('queue-1', {datasetRevision: 8}));
        resolveDigest?.(DIGEST);

        await expect(accepting).rejects.toThrow(
            'visual_search_acceptance_cas: queue_dataset_revision',
        );
        expect(testStore.getState().labels.imagesData[0].labelRects).toEqual([]);
        expect(UndoStack.size()).toBe(0);
    });

    it('fails the synchronous CAS if result content identity changes during hashing', async () => {
        const {testStore} = readyStore();
        UndoStack.clear();
        let resolveDigest: ((value: string) => void) | undefined;
        const service = new VisualSearchAcceptanceService({
            getState: testStore.getState,
            dispatch: testStore.dispatch,
            digestFile: () => new Promise(resolve => {
                resolveDigest = resolve;
            }),
            afterAccept: jest.fn(),
        });

        const accepting = service.accept('snapshot-bbox', 'result-1');
        await Promise.resolve();
        testStore.getState().visualSearch.jobsById['snapshot-bbox']
            .result!.items[0].contentSha256 = 'b'.repeat(64);
        resolveDigest?.(DIGEST);

        await expect(accepting).rejects.toThrow(
            'visual_search_acceptance_cas: result_asset_revision',
        );
        expect(testStore.getState().labels.imagesData[0].labelRects).toEqual([]);
        expect(UndoStack.size()).toBe(0);
    });

    it('rejects a local filename match whose SHA-256 identity differs', async () => {
        const {testStore} = readyStore();
        UndoStack.clear();
        const service = new VisualSearchAcceptanceService({
            getState: testStore.getState,
            dispatch: testStore.dispatch,
            digestFile: async () => 'b'.repeat(64),
            afterAccept: jest.fn(),
        });

        await expect(service.accept('snapshot-bbox', 'result-1')).rejects.toThrow(
            'does not match the result asset SHA-256',
        );
        expect(testStore.getState().labels.imagesData[0].labelRects).toEqual([]);
        expect(UndoStack.size()).toBe(0);
    });

    it('accepts a stable logical asset id that differs from the content SHA-256', async () => {
        const {testStore} = readyStore();
        UndoStack.clear();
        const service = new VisualSearchAcceptanceService({
            getState: testStore.getState,
            dispatch: testStore.dispatch,
            digestFile: async () => DIGEST,
            afterAccept: jest.fn(),
        });

        await expect(service.accept('snapshot-bbox', 'result-1')).resolves.toEqual({
            imageId: 'target-image',
            labelRectId: 'visual-search:task-1:result-1',
        });
        expect(testStore.getState().labels.imagesData[0].labelRects).toHaveLength(1);
    });

    it('rejects an empty logical asset id before hashing', async () => {
        const {testStore} = readyStore();
        testStore.getState().visualSearch.jobsById['snapshot-bbox'].result!.items[0].assetId = '  ';
        const digest = jest.fn(async () => DIGEST);
        const service = new VisualSearchAcceptanceService({
            getState: testStore.getState,
            dispatch: testStore.dispatch,
            digestFile: digest,
            afterAccept: jest.fn(),
        });

        await expect(service.accept('snapshot-bbox', 'result-1')).rejects.toThrow(
            'no stable asset identity',
        );
        expect(digest).not.toHaveBeenCalled();
    });

    it('rejects a malformed content SHA-256 before hashing', async () => {
        const {testStore} = readyStore();
        testStore.getState().visualSearch.jobsById['snapshot-bbox']
            .result!.items[0].contentSha256 = 'not-a-sha256';
        const digest = jest.fn(async () => DIGEST);
        const service = new VisualSearchAcceptanceService({
            getState: testStore.getState,
            dispatch: testStore.dispatch,
            digestFile: digest,
            afterAccept: jest.fn(),
        });

        await expect(service.accept('snapshot-bbox', 'result-1')).rejects.toThrow(
            'no valid SHA-256 content identity',
        );
        expect(digest).not.toHaveBeenCalled();
    });

    it('accepts all source mask components atomically as one undo step', async () => {
        const {testStore} = readyMaskStore();
        UndoStack.clear();
        const verifyMaskGeometry = jest.fn().mockResolvedValue(MASK_POLYGONS);
        const afterAccept = jest.fn();
        const service = new VisualSearchAcceptanceService({
            getState: testStore.getState,
            dispatch: testStore.dispatch,
            digestFile: async () => DIGEST,
            verifyMaskGeometry,
            afterAccept,
        });

        const accepted = await service.accept('snapshot-mask', 'mask-result-1');
        const state = testStore.getState();
        const polygons = state.labels.imagesData[0].labelPolygons;

        expect(accepted).toEqual({
            imageId: 'target-image',
            labelPolygonIds: [
                'visual-search:task-mask-1:mask-result-1:mask:0',
                'visual-search:task-mask-1:mask-result-1:mask:1',
            ],
        });
        expect(polygons).toHaveLength(2);
        expect(polygons[0]).toEqual(expect.objectContaining({
            id: 'visual-search:task-mask-1:mask-result-1:mask:0',
            vertices: MASK_POLYGONS[0].map(([x, y]) => ({x, y})),
            status: LabelStatus.ACCEPTED,
            isCreatedByAI: true,
            confidence: 0.84,
            extra: {visualSearch: expect.objectContaining({
                geometrySha256: 'c'.repeat(64),
                rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
                componentIndex: 0,
                componentCount: 2,
                verticesSignature: expect.stringMatching(/^[0-9a-f]{64}$/),
            })},
        }));
        expect(state.labels.activeLabelId).toBe(polygons[0].id);
        expect(state.queue.items[0].dataSyncStatus).toBe(QueueDataSyncStatus.DIRTY);
        expect(UndoStack.size()).toBe(1);
        await expect(service.accept('snapshot-mask', 'mask-result-1')).rejects.toThrow(
            'visual_search_acceptance_cas: already_accepted',
        );
        expect(UndoStack.size()).toBe(1);
        expect(UndoStack.pop()?.imagesData[0].labelPolygons).toEqual([]);
        expect(verifyMaskGeometry).toHaveBeenCalledTimes(2);
        expect(afterAccept).toHaveBeenCalledTimes(1);
    });

    it('rejects the same mask geometry returned under a different result id', async () => {
        const {testStore} = readyMaskStore();
        UndoStack.clear();
        const service = new VisualSearchAcceptanceService({
            getState: testStore.getState,
            dispatch: testStore.dispatch,
            digestFile: async () => DIGEST,
            verifyMaskGeometry: jest.fn().mockResolvedValue(MASK_POLYGONS),
            afterAccept: jest.fn(),
        });

        await service.accept('snapshot-mask', 'mask-result-1');
        const result = testStore.getState().visualSearch.jobsById['snapshot-mask'].result;
        if (!result) throw new Error('mask result fixture is missing');
        result.items.push({
            ...result.items[0],
            resultId: 'mask-result-duplicate',
            regionId: 'mask-region-duplicate',
        });

        await expect(service.accept('snapshot-mask', 'mask-result-duplicate')).rejects.toThrow(
            'visual_search_acceptance_cas: already_accepted_geometry',
        );
        expect(testStore.getState().labels.imagesData[0].labelPolygons).toHaveLength(2);
        expect(UndoStack.size()).toBe(1);
    });

    it('rejects a preview-only mask before hashing or mutation', async () => {
        const {testStore} = readyMaskStore();
        UndoStack.clear();
        testStore.getState().visualSearch.jobsById['snapshot-mask']
            .result!.items[0].acceptanceEligible = false;
        testStore.getState().visualSearch.jobsById['snapshot-mask']
            .result!.items[0].acceptanceReason = 'source_polygon_unavailable';
        const digest = jest.fn(async () => DIGEST);
        const verifyMaskGeometry = jest.fn().mockResolvedValue(MASK_POLYGONS);
        const service = new VisualSearchAcceptanceService({
            getState: testStore.getState,
            dispatch: testStore.dispatch,
            digestFile: digest,
            verifyMaskGeometry,
            afterAccept: jest.fn(),
        });

        await expect(service.accept('snapshot-mask', 'mask-result-1')).rejects.toThrow(
            'preview-only: source_polygon_unavailable',
        );
        expect(digest).not.toHaveBeenCalled();
        expect(verifyMaskGeometry).not.toHaveBeenCalled();
        expect(testStore.getState().labels.imagesData[0].labelPolygons).toEqual([]);
        expect(UndoStack.size()).toBe(0);
    });

    it('fails mask CAS if geometry identity changes while file hashing is pending', async () => {
        const {testStore} = readyMaskStore();
        UndoStack.clear();
        let resolveDigest: ((value: string) => void) | undefined;
        const service = new VisualSearchAcceptanceService({
            getState: testStore.getState,
            dispatch: testStore.dispatch,
            digestFile: () => new Promise(resolve => {
                resolveDigest = resolve;
            }),
            verifyMaskGeometry: jest.fn().mockResolvedValue(MASK_POLYGONS),
            afterAccept: jest.fn(),
        });

        const accepting = service.accept('snapshot-mask', 'mask-result-1');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(resolveDigest).toBeDefined();
        testStore.getState().visualSearch.jobsById['snapshot-mask']
            .result!.items[0].geometrySha256 = 'd'.repeat(64);
        resolveDigest?.(DIGEST);

        await expect(accepting).rejects.toThrow(
            'visual_search_acceptance_cas: result_geometry',
        );
        expect(testStore.getState().labels.imagesData[0].labelPolygons).toEqual([]);
        expect(UndoStack.size()).toBe(0);
    });
});
