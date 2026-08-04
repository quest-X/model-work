import {applyMiddleware, createStore, Store} from 'redux';
import {LabelStatus} from '../../../data/enums/LabelStatus';
import {rootReducer, AppState} from '../../../store';
import {
    acceptVisualSearchBBox,
    acceptVisualSearchMask,
    updateImageDataById,
} from '../../../store/labels/actionCreators';
import {
    ImageData,
    LabelPolygon,
    LabelRect,
    VisualSearchBBoxAcceptance,
    VisualSearchMaskAcceptance,
} from '../../../store/labels/types';
import {
    QueueDataSyncStatus,
    QueueItemStatus,
    QueueItemType,
} from '../../../store/queue/types';
import {UndoActions} from '../../actions/UndoActions';
import {RestoreFlag, UndoStack} from '../UndoStack';
import {undoMiddleware} from '../undoMiddleware';
import {VISUAL_SEARCH_MASK_RASTERIZER_REVISION} from '../../../store/visualSearch/types';
import {visualSearchVerticesSignature} from '../../../utils/VisualSearchMaskProvenance';

let mockReduxStore: Store<AppState>;

jest.mock('../../../index', () => ({
    get store() {
        return mockReduxStore;
    },
}));

jest.mock('../../actions/EditorActions', () => ({
    EditorActions: {fullRender: jest.fn()},
}));

const labelRect = (id: string, x: number): LabelRect => ({
    id,
    labelId: 'goose',
    rect: {x, y: 2, width: 10, height: 12},
    isVisible: true,
    isCreatedByAI: id === 'accepted-result',
    status: LabelStatus.ACCEPTED,
    suggestedLabel: '',
});

describe('undoMiddleware restore snapshots', () => {
    beforeEach(() => {
        UndoStack.clear();
        RestoreFlag.set(false);
    });

    afterEach(() => {
        UndoStack.clear();
        RestoreFlag.set(false);
        jest.restoreAllMocks();
    });

    it('does not resurrect an accepted result after immediate undo, edit, and undo', () => {
        jest.spyOn(performance, 'now').mockReturnValue(100);
        const file = new File(['pixels'], 'goose.jpg', {
            type: 'image/jpeg',
            lastModified: 1,
        });
        const image: ImageData = {
            id: 'image-1',
            fileData: file,
            loadStatus: true,
            labelRects: [],
            labelPoints: [],
            labelLines: [],
            labelPolygons: [],
            labelNameIds: ['goose'],
            isVisitedByRoboflowAPI: false,
        };
        const initial = rootReducer(undefined, {type: '@@INIT'});
        const preloaded: AppState = {
            ...initial,
            labels: {
                ...initial.labels,
                imagesData: [image],
                labels: [{id: 'goose', name: 'goose'}],
                activeImageIndex: 0,
            },
            queue: {
                activeQueueItemId: 'queue-1',
                items: [{
                    id: 'queue-1',
                    name: 'goose.jpg',
                    type: QueueItemType.IMAGE,
                    file,
                    status: QueueItemStatus.COMPLETED,
                    uploadedAt: 1,
                    dataSyncStatus: QueueDataSyncStatus.SYNCED,
                    datasetId: 'dataset-1',
                    datasetRevision: 3,
                }],
            },
            visualSearch: {
                activeJobId: 'snapshot-1',
                jobOrder: ['snapshot-1'],
                jobsById: {
                    'snapshot-1': {
                        clientJobId: 'snapshot-1',
                        backendJobId: 'task-1',
                        snapshot: {
                            snapshotId: 'snapshot-1',
                            capturedAt: 1,
                            source: {
                                imageId: 'source-image',
                                fileName: 'source.jpg',
                                mediaKind: 'image',
                            },
                            profile: {id: 'profile-1', modelRevision: 'model-1'},
                            target: {
                                collection: 'bbox-collection',
                                collectionRevision: 1,
                                datasetId: 'dataset-1',
                                datasetRevision: 3,
                            },
                            options: {
                                topK: 5,
                                candidateK: 20,
                                idempotencyKey: 'snapshot-1',
                            },
                            geometry: {kind: 'bbox', bbox: [2, 2, 12, 14]},
                            image: {
                                fileName: 'source.jpg',
                                mimeType: 'image/jpeg',
                                size: 6,
                                width: 32,
                                height: 24,
                            },
                        },
                        status: 'succeeded',
                        phase: 'completed',
                        createdAt: 1,
                        updatedAt: 2,
                        recoveryCount: 0,
                        cancelRequested: false,
                        idempotentReplay: false,
                        selectedResultIds: [],
                        result: {
                            collection: 'bbox-collection',
                            queryKind: 'bbox',
                            queryGeometry: {kind: 'bbox', bbox: [2, 2, 12, 14]},
                            profileId: 'profile-1',
                            modelRevision: 'model-1',
                            collectionRevision: 1,
                            executedStages: ['dino'],
                            stageStatus: {dino: 'completed'},
                            total: 1,
                            elapsedMs: 1,
                            items: [{
                                resultId: 'result-1',
                                assetId: 'asset-1',
                                datasetId: 'dataset-1',
                                datasetRevision: 3,
                                rank: 1,
                                path: '/dataset/goose.jpg',
                                fileName: 'goose.jpg',
                                width: 32,
                                height: 24,
                                className: 'goose',
                                confidence: 0.9,
                                score: 0.9,
                                dinoScore: 0.9,
                                bbox: [2, 2, 12, 14],
                                thumbnail: null,
                                contentSha256: 'f'.repeat(64),
                                regionId: 'region-1',
                                granularity: 'bbox',
                                regionSource: 'dataset',
                                geometrySha256: null,
                                acceptanceEligible: null,
                                acceptanceReason: null,
                                geometry: {kind: 'bbox', bbox: [2, 2, 12, 14]},
                            }],
                        },
                    },
                },
            },
        };
        mockReduxStore = createStore(
            rootReducer,
            preloaded,
            applyMiddleware(undoMiddleware),
        );
        const acceptance: VisualSearchBBoxAcceptance = {
            clientJobId: 'snapshot-1',
            backendJobId: 'task-1',
            resultId: 'result-1',
            queueItemId: 'queue-1',
            datasetId: 'dataset-1',
            datasetRevision: 3,
            assetId: 'asset-1',
            contentSha256: 'f'.repeat(64),
            imageId: 'image-1',
            expectedFile: file,
            labelRect: labelRect('accepted-result', 2),
        };

        mockReduxStore.dispatch(acceptVisualSearchBBox(acceptance));
        expect(mockReduxStore.getState().labels.imagesData[0].labelRects)
            .toHaveLength(1);

        UndoActions.undo();
        expect(mockReduxStore.getState().labels.imagesData[0].labelRects).toEqual([]);

        const restored = mockReduxStore.getState().labels.imagesData[0];
        mockReduxStore.dispatch(updateImageDataById(restored.id, {
            ...restored,
            labelRects: [labelRect('ordinary-edit', 15)],
        }));
        expect(mockReduxStore.getState().labels.imagesData[0].labelRects[0].id)
            .toBe('ordinary-edit');

        UndoActions.undo();
        expect(mockReduxStore.getState().labels.imagesData[0].labelRects).toEqual([]);
    });

    it('undoes a multipart accepted mask atomically without resurrecting its components', () => {
        jest.spyOn(performance, 'now').mockReturnValue(200);
        const file = new File(['mask-pixels'], 'goose-mask.jpg', {
            type: 'image/jpeg',
            lastModified: 2,
        });
        const sourcePolygons = [
            [[2, 2], [8, 2], [8, 8], [2, 8]],
            [[12, 10], [18, 10], [18, 16], [12, 16]],
        ] as const;
        const geometrySha256 = 'a'.repeat(64);
        const mask = {
            encoding: 'binary_rle_varint_zlib_base64_v1',
            order: 'row-major',
            size: [24, 32],
            countsBase64: 'AA==',
        } as const;
        const labelPolygons: LabelPolygon[] = sourcePolygons.map((polygon, index) => {
            const vertices = polygon.map(([x, y]) => ({x, y}));
            return {
                id: `visual-search:task-mask:result-mask:mask:${index}`,
                labelId: 'goose',
                vertices,
                isVisible: true,
                isCreatedByAI: true,
                status: LabelStatus.ACCEPTED,
                suggestedLabel: '',
                extra: {
                    visualSearch: {
                        schemaVersion: 1,
                        clientJobId: 'snapshot-mask',
                        backendJobId: 'task-mask',
                        resultId: 'result-mask',
                        componentIndex: index,
                        componentCount: sourcePolygons.length,
                        assetId: 'asset-mask',
                        geometrySha256,
                        rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
                        regionId: 'region-mask',
                        datasetId: 'dataset-1',
                        datasetRevision: 3,
                        verticesSignature: visualSearchVerticesSignature(vertices),
                    },
                },
            };
        });
        const image: ImageData = {
            id: 'image-mask',
            fileData: file,
            loadStatus: true,
            labelRects: [],
            labelPoints: [],
            labelLines: [],
            labelPolygons: [],
            labelNameIds: ['goose'],
            isVisitedByRoboflowAPI: false,
        };
        const initial = rootReducer(undefined, {type: '@@INIT'});
        const preloaded: AppState = {
            ...initial,
            labels: {
                ...initial.labels,
                imagesData: [image],
                labels: [{id: 'goose', name: 'goose'}],
                activeImageIndex: 0,
            },
            queue: {
                activeQueueItemId: 'queue-mask',
                items: [{
                    id: 'queue-mask',
                    name: 'goose-mask.jpg',
                    type: QueueItemType.IMAGE,
                    file,
                    status: QueueItemStatus.COMPLETED,
                    uploadedAt: 2,
                    dataSyncStatus: QueueDataSyncStatus.SYNCED,
                    datasetId: 'dataset-1',
                    datasetRevision: 3,
                }],
            },
            visualSearch: {
                activeJobId: 'snapshot-mask',
                jobOrder: ['snapshot-mask'],
                jobsById: {
                    'snapshot-mask': {
                        clientJobId: 'snapshot-mask',
                        backendJobId: 'task-mask',
                        snapshot: {
                            snapshotId: 'snapshot-mask',
                            capturedAt: 2,
                            source: {
                                imageId: 'source-mask',
                                fileName: 'source-mask.jpg',
                                mediaKind: 'image',
                            },
                            profile: {id: 'profile-1', modelRevision: 'model-1'},
                            target: {
                                collection: 'mask-collection',
                                collectionRevision: 1,
                                datasetId: 'dataset-1',
                                datasetRevision: 3,
                            },
                            options: {
                                topK: 5,
                                candidateK: 20,
                                idempotencyKey: 'snapshot-mask',
                            },
                            geometry: {
                                kind: 'mask',
                                polygons: sourcePolygons,
                                bbox: [2, 2, 18, 16],
                                maskFileName: 'query-mask.png',
                                rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
                            },
                            image: {
                                fileName: 'source-mask.jpg',
                                mimeType: 'image/jpeg',
                                size: 11,
                                width: 32,
                                height: 24,
                            },
                        },
                        status: 'succeeded',
                        phase: 'completed',
                        createdAt: 2,
                        updatedAt: 3,
                        recoveryCount: 0,
                        cancelRequested: false,
                        idempotentReplay: false,
                        selectedResultIds: [],
                        result: {
                            collection: 'mask-collection',
                            queryKind: 'mask',
                            queryGeometry: {
                                kind: 'mask',
                                bbox: [2, 2, 18, 16],
                                polygons: sourcePolygons,
                                mask,
                                rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
                            },
                            profileId: 'profile-1',
                            modelRevision: 'model-1',
                            collectionRevision: 1,
                            executedStages: ['dino'],
                            stageStatus: {dino: 'completed'},
                            total: 1,
                            elapsedMs: 1,
                            items: [{
                                resultId: 'result-mask',
                                assetId: 'asset-mask',
                                datasetId: 'dataset-1',
                                datasetRevision: 3,
                                rank: 1,
                                path: '/dataset/goose-mask.jpg',
                                fileName: 'goose-mask.jpg',
                                width: 32,
                                height: 24,
                                className: 'goose',
                                confidence: 0.95,
                                score: 0.95,
                                dinoScore: 0.95,
                                bbox: [2, 2, 18, 16],
                                thumbnail: null,
                                contentSha256: 'b'.repeat(64),
                                regionId: 'region-mask',
                                granularity: 'mask',
                                regionSource: 'dataset',
                                geometrySha256,
                                acceptanceEligible: true,
                                acceptanceReason: null,
                                geometry: {
                                    kind: 'mask',
                                    bbox: [2, 2, 18, 16],
                                    polygons: sourcePolygons,
                                    mask,
                                    rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
                                },
                            }],
                        },
                    },
                },
            },
        };
        mockReduxStore = createStore(
            rootReducer,
            preloaded,
            applyMiddleware(undoMiddleware),
        );
        const acceptance: VisualSearchMaskAcceptance = {
            clientJobId: 'snapshot-mask',
            backendJobId: 'task-mask',
            resultId: 'result-mask',
            queueItemId: 'queue-mask',
            datasetId: 'dataset-1',
            datasetRevision: 3,
            assetId: 'asset-mask',
            contentSha256: 'b'.repeat(64),
            geometrySha256,
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
            imageId: 'image-mask',
            expectedFile: file,
            mask,
            sourcePolygons,
            labelPolygons,
        };

        mockReduxStore.dispatch(acceptVisualSearchMask(acceptance));
        expect(mockReduxStore.getState().labels.imagesData[0].labelPolygons)
            .toHaveLength(2);

        UndoActions.undo();
        expect(mockReduxStore.getState().labels.imagesData[0].labelPolygons).toEqual([]);

        const restored = mockReduxStore.getState().labels.imagesData[0];
        const manualPolygon: LabelPolygon = {
            id: 'ordinary-mask-edit',
            labelId: 'goose',
            vertices: [{x: 20, y: 2}, {x: 25, y: 2}, {x: 25, y: 7}],
            isVisible: true,
            isCreatedByAI: false,
            status: LabelStatus.ACCEPTED,
            suggestedLabel: '',
        };
        mockReduxStore.dispatch(updateImageDataById(restored.id, {
            ...restored,
            labelPolygons: [manualPolygon],
        }));
        expect(mockReduxStore.getState().labels.imagesData[0].labelPolygons)
            .toEqual([manualPolygon]);

        UndoActions.undo();
        expect(mockReduxStore.getState().labels.imagesData[0].labelPolygons).toEqual([]);
    });
});
