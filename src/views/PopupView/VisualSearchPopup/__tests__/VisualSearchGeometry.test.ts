import {LabelStatus} from '../../../../data/enums/LabelStatus';
import {ImageData} from '../../../../store/labels/types';
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

    it('never treats a temporary prompt rectangle as retrieval geometry', () => {
        expect(deriveEditorVisualSearchQuery(image(), 'prompt-1')).toEqual(
            expect.objectContaining({kind: 'image', annotationId: null}),
        );
    });
});
