import {LabelStatus} from '../../data/enums/LabelStatus';
import {ImageData} from '../../store/labels/types';
import {getDatasetContentSignature} from '../DatasetContentSignature';

const image = (): ImageData => ({
    id: 'image-1',
    fileData: new File(['image'], 'frame.jpg', {
        type: 'image/jpeg',
        lastModified: 10,
    }),
    loadStatus: true,
    labelRects: [{
        id: 'rect-1',
        labelId: 'class-1',
        isVisible: true,
        rect: {x: 1, y: 2, width: 3, height: 4},
        isCreatedByAI: false,
        status: LabelStatus.ACCEPTED,
        suggestedLabel: '',
    }],
    labelPoints: [],
    labelLines: [],
    labelPolygons: [],
    labelNameIds: ['class-1'],
    isSelected: false,
    isVisitedByRoboflowAPI: false,
});

describe('getDatasetContentSignature', () => {
    it('ignores UI-only object replacement during dataset hydration', () => {
        const original = image();
        const hydrated = {
            ...original,
            loadStatus: false,
            isSelected: true,
            labelRects: original.labelRects.map(rect => ({
                ...rect,
                isVisible: false,
            })),
        };

        expect(getDatasetContentSignature([hydrated]))
            .toBe(getDatasetContentSignature([original]));
    });

    it('changes when a persisted annotation changes', () => {
        const original = image();
        const edited = {
            ...original,
            labelRects: original.labelRects.map(rect => ({
                ...rect,
                rect: {...rect.rect, width: 30},
            })),
        };

        expect(getDatasetContentSignature([edited]))
            .not.toBe(getDatasetContentSignature([original]));
    });
});
