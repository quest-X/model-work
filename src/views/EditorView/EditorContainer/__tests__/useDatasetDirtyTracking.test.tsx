import React from 'react';
import {render} from '@testing-library/react';
import {LabelStatus} from '../../../../data/enums/LabelStatus';
import {getDatasetContentSignature} from '../../../../services/DatasetContentSignature';
import {ImageData} from '../../../../store/labels/types';
import {
    QueueDataSyncStatus,
    QueueItem,
    QueueItemStatus,
    QueueItemType,
} from '../../../../store/queue/types';
import {useDatasetDirtyTracking} from '../useDatasetDirtyTracking';

jest.mock('../../../../services/DatasetContentSignature', () => {
    const actual = jest.requireActual('../../../../services/DatasetContentSignature');
    return {
        ...actual,
        getDatasetContentSignature: jest.fn(actual.getDatasetContentSignature),
    };
});

type HookOptions = Parameters<typeof useDatasetDirtyTracking>[0];
type HarnessProps = HookOptions & {renderToken?: number};

const Harness: React.FC<HarnessProps> = ({renderToken, ...options}) => {
    useDatasetDirtyTracking(options);
    return <span>{renderToken}</span>;
};

const image = (id: string, fileName: string): ImageData => ({
    id,
    fileData: new File(['image'], fileName, {
        type: 'image/jpeg',
        lastModified: 10,
    }),
    loadStatus: true,
    labelRects: [{
        id: `${id}-rect`,
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

const queueItem = (
    id: string,
    dataSyncStatus: QueueDataSyncStatus = QueueDataSyncStatus.SYNCED,
): QueueItem => ({
    id,
    name: id,
    type: QueueItemType.IMAGE,
    status: QueueItemStatus.COMPLETED,
    uploadedAt: 10,
    dataSyncStatus,
});

describe('useDatasetDirtyTracking', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('does not mark a synced batch dirty for UI-only hydration changes', () => {
        const original = image('image-1', 'frame.jpg');
        const hydrated = {
            ...original,
            loadStatus: false,
            isSelected: true,
            labelRects: original.labelRects.map(rect => ({
                ...rect,
                isVisible: false,
            })),
        };
        const updateQueueItem = jest.fn();
        const item = queueItem('queue-1');
        const {rerender} = render(<Harness
            activeQueueItemId={item.id}
            imagesData={[original]}
            queueItems={[item]}
            updateQueueItem={updateQueueItem}
        />);

        rerender(<Harness
            activeQueueItemId={item.id}
            imagesData={[hydrated]}
            queueItems={[item]}
            updateQueueItem={updateQueueItem}
        />);

        expect(updateQueueItem).not.toHaveBeenCalled();
    });

    it('marks a synced batch dirty when persisted annotation content changes', () => {
        const original = image('image-1', 'frame.jpg');
        const edited = {
            ...original,
            labelRects: original.labelRects.map(rect => ({
                ...rect,
                rect: {...rect.rect, width: 30},
            })),
        };
        const updateQueueItem = jest.fn();
        const item = queueItem('queue-1');
        const {rerender} = render(<Harness
            activeQueueItemId={item.id}
            imagesData={[original]}
            queueItems={[item]}
            updateQueueItem={updateQueueItem}
        />);

        rerender(<Harness
            activeQueueItemId={item.id}
            imagesData={[edited]}
            queueItems={[item]}
            updateQueueItem={updateQueueItem}
        />);

        expect(updateQueueItem).toHaveBeenCalledTimes(1);
        expect(updateQueueItem).toHaveBeenCalledWith(item.id, {
            dataSyncStatus: QueueDataSyncStatus.DIRTY,
        });
    });

    it('does not mark either synced batch dirty when switching active batches', () => {
        const firstItem = queueItem('queue-1');
        const secondItem = queueItem('queue-2');
        const queueItems = [firstItem, secondItem];
        const updateQueueItem = jest.fn();
        const {rerender} = render(<Harness
            activeQueueItemId={firstItem.id}
            imagesData={[image('image-1', 'first.jpg')]}
            queueItems={queueItems}
            updateQueueItem={updateQueueItem}
        />);

        rerender(<Harness
            activeQueueItemId={secondItem.id}
            imagesData={[image('image-2', 'second.jpg')]}
            queueItems={queueItems}
            updateQueueItem={updateQueueItem}
        />);

        expect(updateQueueItem).not.toHaveBeenCalled();
    });

    it('does not recompute the dataset signature for unrelated renders', () => {
        const item = queueItem('queue-1');
        const imagesData = [image('image-1', 'frame.jpg')];
        const queueItems = [item];
        const updateQueueItem = jest.fn();
        const {rerender} = render(<Harness
            activeQueueItemId={item.id}
            imagesData={imagesData}
            queueItems={queueItems}
            updateQueueItem={updateQueueItem}
            renderToken={1}
        />);

        rerender(<Harness
            activeQueueItemId={item.id}
            imagesData={imagesData}
            queueItems={queueItems}
            updateQueueItem={updateQueueItem}
            renderToken={2}
        />);

        expect(getDatasetContentSignature).toHaveBeenCalledTimes(1);
    });

    it('does not override a queue item already marked dirty atomically', () => {
        const original = image('image-1', 'frame.jpg');
        const edited = {
            ...original,
            labelRects: original.labelRects.map(rect => ({
                ...rect,
                rect: {...rect.rect, height: 40},
            })),
        };
        const updateQueueItem = jest.fn();
        const syncedItem = queueItem('queue-1');
        const dirtyItem = queueItem('queue-1', QueueDataSyncStatus.DIRTY);
        const {rerender} = render(<Harness
            activeQueueItemId={syncedItem.id}
            imagesData={[original]}
            queueItems={[syncedItem]}
            updateQueueItem={updateQueueItem}
        />);

        rerender(<Harness
            activeQueueItemId={dirtyItem.id}
            imagesData={[edited]}
            queueItems={[dirtyItem]}
            updateQueueItem={updateQueueItem}
        />);

        expect(updateQueueItem).not.toHaveBeenCalled();
    });
});
