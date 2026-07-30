import {LabelActions} from '../../actions/LabelActions';
import {store} from '../../../index';
import {updateImageData, updateLabelNames} from '../../../store/labels/actionCreators';
import {ImageData} from '../../../store/labels/types';
import {LabelUtil} from '../../../utils/LabelUtil';

const imageData = (
    id: string,
    deletedLabelId: string,
    retainedLabelId: string
): ImageData => ({
    id,
    fileData: new File(['image'], `${id}.jpg`, {type: 'image/jpeg'}),
    loadStatus: true,
    labelRects: [
        LabelUtil.createLabelRect(deletedLabelId, {x: 1, y: 1, width: 10, height: 10}),
        LabelUtil.createLabelRect(retainedLabelId, {x: 2, y: 2, width: 20, height: 20}),
    ],
    labelPoints: [
        LabelUtil.createLabelPoint(deletedLabelId, {x: 3, y: 3}),
        LabelUtil.createLabelPoint(retainedLabelId, {x: 4, y: 4}),
    ],
    labelLines: [
        LabelUtil.createLabelLine(deletedLabelId, {
            start: {x: 5, y: 5},
            end: {x: 6, y: 6},
        }),
        LabelUtil.createLabelLine(retainedLabelId, {
            start: {x: 7, y: 7},
            end: {x: 8, y: 8},
        }),
    ],
    labelPolygons: [
        LabelUtil.createLabelPolygon(deletedLabelId, [
            {x: 0, y: 0},
            {x: 10, y: 0},
            {x: 10, y: 10},
        ]),
        LabelUtil.createLabelPolygon(retainedLabelId, [
            {x: 20, y: 20},
            {x: 30, y: 20},
            {x: 30, y: 30},
        ]),
    ],
    labelNameIds: [deletedLabelId, retainedLabelId],
    isVisitedByRoboflowAPI: false,
});

describe('LabelActions label deletion cascade', () => {
    it('deletes every annotation using the removed label across all images', () => {
        const deletedLabel = LabelUtil.createLabelName('deleted');
        const retainedLabel = LabelUtil.createLabelName('retained');
        store.dispatch(updateLabelNames([deletedLabel, retainedLabel]));
        store.dispatch(updateImageData([
            imageData('image-1', deletedLabel.id, retainedLabel.id),
            imageData('image-2', deletedLabel.id, retainedLabel.id),
        ]));

        LabelActions.removeLabelNames([deletedLabel.id]);

        store.getState().labels.imagesData.forEach(image => {
            expect(image.labelRects).toHaveLength(1);
            expect(image.labelPoints).toHaveLength(1);
            expect(image.labelLines).toHaveLength(1);
            expect(image.labelPolygons).toHaveLength(1);
            expect(image.labelNameIds).toEqual([retainedLabel.id]);
            [
                ...image.labelRects,
                ...image.labelPoints,
                ...image.labelLines,
                ...image.labelPolygons,
            ].forEach(annotation => expect(annotation.labelId).toBe(retainedLabel.id));
        });
    });
});
