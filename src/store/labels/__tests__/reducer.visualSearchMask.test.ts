import {LabelStatus} from '../../../data/enums/LabelStatus';
import {LabelType} from '../../../data/enums/LabelType';
import {DataBatchSyncService} from '../../../services/DataBatchSyncService';
import {deriveEditorVisualSearchQuery} from '../../../views/PopupView/VisualSearchPopup/VisualSearchGeometry';
import {VISUAL_SEARCH_MASK_RASTERIZER_REVISION} from '../../visualSearch/types';
import {updateImageDataById} from '../actionCreators';
import {labelsReducer} from '../reducer';
import {ImageData, LabelPolygon, LabelsState} from '../types';
import {visualSearchVerticesSignature} from '../../../utils/VisualSearchMaskProvenance';

const vertices = [
    [{x: 1, y: 1}, {x: 5, y: 1}, {x: 3, y: 4}],
    [{x: 8, y: 2}, {x: 12, y: 2}, {x: 10, y: 6}],
];

const component = (index: number): LabelPolygon => ({
    id: `visual-search:task-mask:result-mask:mask:${index}`,
    labelId: 'goose',
    vertices: vertices[index].map(point => ({...point})),
    isVisible: true,
    isCreatedByAI: true,
    status: LabelStatus.ACCEPTED,
    suggestedLabel: '',
    extra: {
        overlay: {opacity: 0.5},
        visualSearch: {
            schemaVersion: 1,
            clientJobId: 'client-mask',
            backendJobId: 'task-mask',
            resultId: 'result-mask',
            componentIndex: index,
            componentCount: 2,
            assetId: 'asset-mask',
            geometrySha256: 'a'.repeat(64),
            rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
            regionId: 'region-mask',
            datasetId: 'dataset-mask',
            datasetRevision: 2,
            verticesSignature: visualSearchVerticesSignature(vertices[index]),
        },
    },
});

const image = (): ImageData => ({
    id: 'image-mask',
    fileData: new File(['pixels'], 'goose.png', {type: 'image/png'}),
    loadStatus: true,
    labelRects: [],
    labelPoints: [],
    labelLines: [],
    labelPolygons: [component(0), component(1)],
    labelNameIds: ['goose'],
    isVisitedByRoboflowAPI: false,
});

const state = (value: ImageData): LabelsState => ({
    activeImageIndex: 0,
    activeLabelNameId: 'goose',
    activeLabelType: LabelType.POLYGON,
    activeLabelViewType: LabelType.POLYGON,
    activeLabelId: value.labelPolygons[0]?.id ?? null,
    highlightedLabelId: null,
    imagesData: [value],
    firstLabelCreatedFlag: true,
    labels: [
        {id: 'goose', name: 'goose'},
        {id: 'bird', name: 'bird'},
    ],
});

const expectManualGroup = (value: ImageData): void => {
    value.labelPolygons.forEach(polygon => {
        expect(polygon.extra?.visualSearch).toBeUndefined();
        expect(polygon.extra?.overlay).toEqual({opacity: 0.5});
    });
};

describe('labelsReducer visual-search mask edit boundary', () => {
    it('downgrades the whole group after an in-place drag and omits the stale SHA', () => {
        const current = image();
        const currentState = state(current);
        current.labelPolygons = current.labelPolygons.map((polygon, index) => index === 0
            ? {...polygon, vertices: [{x: 2, y: 1}, ...polygon.vertices.slice(1)]}
            : polygon);

        const nextState = labelsReducer(
            currentState,
            updateImageDataById(current.id, current),
        );
        const updated = nextState.imagesData[0];
        expectManualGroup(updated);
        expect(deriveEditorVisualSearchQuery(updated, updated.labelPolygons[0].id))
            .toEqual(expect.objectContaining({
                kind: 'mask',
                geometry: {kind: 'mask', polygons: [[[2, 1], [5, 1], [3, 4]]]},
            }));

        const metadata = DataBatchSyncService.buildMetadata(
            [updated.fileData],
            [updated],
            nextState.labels,
        );
        expect(metadata.images[0].regions.every(region => !region.mask_group)).toBe(true);
    });

    it('downgrades every surviving component when one component is deleted', () => {
        const current = image();
        const next = {...current, labelPolygons: current.labelPolygons.slice(1)};

        const nextState = labelsReducer(
            state(current),
            updateImageDataById(current.id, next),
        );

        expect(nextState.imagesData[0].labelPolygons).toHaveLength(1);
        expectManualGroup(nextState.imagesData[0]);
    });

    it('downgrades the whole group when one component changes label', () => {
        const current = image();
        const next = {
            ...current,
            labelPolygons: current.labelPolygons.map((polygon, index) => index === 0
                ? {...polygon, labelId: 'bird'}
                : polygon),
        };

        const nextState = labelsReducer(
            state(current),
            updateImageDataById(current.id, next),
        );

        expectManualGroup(nextState.imagesData[0]);
        expect(nextState.imagesData[0].labelPolygons.map(polygon => polygon.labelId))
            .toEqual(['bird', 'goose']);
    });

    it('keeps provenance when only presentation state changes', () => {
        const current = image();
        const next = {
            ...current,
            labelPolygons: current.labelPolygons.map((polygon, index) => index === 0
                ? {...polygon, isVisible: false}
                : polygon),
        };

        const nextState = labelsReducer(
            state(current),
            updateImageDataById(current.id, next),
        );

        nextState.imagesData[0].labelPolygons.forEach(polygon =>
            expect(polygon.extra?.visualSearch).toBeDefined());
    });
});
