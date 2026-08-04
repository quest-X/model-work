import {LabelStatus} from '../../../../data/enums/LabelStatus';
import {ImageData, LabelPolygon} from '../../../../store/labels/types';
import {
    VISUAL_SEARCH_MASK_LIMITS,
    VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
} from '../../../../store/visualSearch/types';
import {visualSearchVerticesSignature} from '../../../../utils/VisualSearchMaskProvenance';
import {deriveEditorVisualSearchQuery} from '../VisualSearchGeometry';

const image = (): ImageData => ({
    id: 'image-1',
    fileData: new File(['pixels'], 'source.png', {type: 'image/png'}),
    loadStatus: true,
    labelRects: [{
        id: 'rect-1',
        labelId: 'label-rect',
        isVisible: true,
        rect: {x: 10, y: 20, width: 30, height: 40},
        isCreatedByAI: false,
        status: LabelStatus.ACCEPTED,
        suggestedLabel: '',
    }, {
        id: 'prompt-1',
        labelId: 'label-prompt',
        isVisible: true,
        rect: {x: 1, y: 2, width: 3, height: 4},
        isCreatedByAI: true,
        status: LabelStatus.UNDECIDED,
        suggestedLabel: '',
        isPrompt: true,
    }],
    labelPoints: [],
    labelLines: [],
    labelPolygons: [{
        id: 'polygon-1',
        labelId: 'label-mask',
        isVisible: true,
        vertices: [{x: 4, y: 5}, {x: 40, y: 5}, {x: 40, y: 50}],
        isCreatedByAI: false,
        status: LabelStatus.ACCEPTED,
        suggestedLabel: '',
    }],
    labelNameIds: [],
    isVisitedByRoboflowAPI: false,
});

const acceptedComponent = (
    componentIndex: number,
    vertices: Array<{x: number; y: number}>,
    componentCount: number = 2,
): LabelPolygon => ({
    id: `visual-search:task-mask:result-mask:mask:${componentIndex}`,
    labelId: 'label-mask',
    isVisible: true,
    vertices,
    isCreatedByAI: true,
    status: LabelStatus.ACCEPTED,
    suggestedLabel: '',
    extra: {visualSearch: {
        schemaVersion: 1,
        clientJobId: 'client-mask',
        backendJobId: 'task-mask',
        resultId: 'result-mask',
        componentIndex,
        componentCount,
        assetId: 'asset-mask',
        geometrySha256: 'd'.repeat(64),
        rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        regionId: 'region-mask',
        datasetId: 'dataset-mask',
        datasetRevision: 3,
        verticesSignature: visualSearchVerticesSignature(vertices),
    }},
});

describe('deriveEditorVisualSearchQuery', () => {
    it('uses the full image when there is no selected annotation', () => {
        expect(deriveEditorVisualSearchQuery(image(), null)).toEqual({
            kind: 'image',
            geometry: {kind: 'image'},
            annotationId: null,
            labelId: null,
        });
    });

    it('turns the selected rectangle into an image-coordinate bbox', () => {
        expect(deriveEditorVisualSearchQuery(image(), 'rect-1')).toEqual({
            kind: 'bbox',
            geometry: {kind: 'bbox', bbox: [10, 20, 40, 60]},
            annotationId: 'rect-1',
            labelId: 'label-rect',
        });
    });

    it('keeps selected polygon geometry as a mask query', () => {
        expect(deriveEditorVisualSearchQuery(image(), 'polygon-1')).toEqual({
            kind: 'mask',
            geometry: {
                kind: 'mask',
                polygons: [[[4, 5], [40, 5], [40, 50]]],
            },
            annotationId: 'polygon-1',
            labelId: 'label-mask',
        });
    });

    it('reassembles every accepted component in canonical index order', () => {
        const target = image();
        const first = acceptedComponent(
            0,
            [{x: 1, y: 1}, {x: 5, y: 1}, {x: 3, y: 4}],
        );
        const second = acceptedComponent(
            1,
            [{x: 8, y: 2}, {x: 12, y: 2}, {x: 10, y: 6}],
        );
        target.labelPolygons = [second, first];

        expect(deriveEditorVisualSearchQuery(target, second.id)).toEqual({
            kind: 'mask',
            geometry: {
                kind: 'mask',
                polygons: [
                    [[1, 1], [5, 1], [3, 4]],
                    [[8, 2], [12, 2], [10, 6]],
                ],
            },
            annotationId: second.id,
            labelId: 'label-mask',
        });
    });

    it('fails closed on incomplete, duplicate, inconsistent, oversized, or edited groups', () => {
        const first = acceptedComponent(
            0,
            [{x: 1, y: 1}, {x: 5, y: 1}, {x: 3, y: 4}],
        );
        const missing = image();
        missing.labelPolygons = [first];
        expect(() => deriveEditorVisualSearchQuery(missing, first.id)).toThrow('Incomplete');

        const mixed = image();
        const second = acceptedComponent(
            1,
            [{x: 8, y: 2}, {x: 12, y: 2}, {x: 10, y: 6}],
        );
        second.labelId = 'another-label';
        mixed.labelPolygons = [first, second];
        expect(() => deriveEditorVisualSearchQuery(mixed, first.id)).toThrow('provenance or label');

        const duplicate = image();
        duplicate.labelPolygons = [
            first,
            acceptedComponent(0, [{x: 8, y: 2}, {x: 12, y: 2}, {x: 10, y: 6}]),
        ];
        expect(() => deriveEditorVisualSearchQuery(duplicate, first.id)).toThrow('Duplicate');

        const inconsistent = image();
        const otherAsset = acceptedComponent(
            1,
            [{x: 8, y: 2}, {x: 12, y: 2}, {x: 10, y: 6}],
        );
        if (otherAsset.extra) otherAsset.extra.visualSearch.assetId = 'other-asset';
        inconsistent.labelPolygons = [first, otherAsset];
        expect(() => deriveEditorVisualSearchQuery(inconsistent, first.id)).toThrow('provenance or label');

        const oversized = acceptedComponent(
            0,
            [{x: 1, y: 1}, {x: 5, y: 1}, {x: 3, y: 4}],
            VISUAL_SEARCH_MASK_LIMITS.maxPolygons + 1,
        );
        const huge = image();
        huge.labelPolygons = [oversized];
        expect(() => deriveEditorVisualSearchQuery(huge, oversized.id)).toThrow(
            'Invalid visual-search mask provenance',
        );

        const stale = acceptedComponent(
            0,
            [{x: 1, y: 1}, {x: 5, y: 1}, {x: 3, y: 4}],
            1,
        );
        stale.vertices[0].x = 2;
        const edited = image();
        edited.labelPolygons = [stale];
        expect(() => deriveEditorVisualSearchQuery(edited, stale.id)).toThrow(
            'no longer match their geometry SHA',
        );
    });

    it('never treats a temporary prompt rectangle as retrieval geometry', () => {
        expect(deriveEditorVisualSearchQuery(image(), 'prompt-1')).toEqual(
            expect.objectContaining({kind: 'image', annotationId: null}),
        );
    });
});
