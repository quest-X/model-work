import {useEffect, useMemo, useRef} from 'react';
import {getDatasetContentSignature} from '../../../services/DatasetContentSignature';
import {ImageData} from '../../../store/labels/types';
import {QueueDataSyncStatus, QueueItem} from '../../../store/queue/types';

interface DatasetDirtyTrackingOptions {
    activeQueueItemId: string | null;
    imagesData: ImageData[];
    queueItems: QueueItem[];
    updateQueueItem: (itemId: string, updates: Partial<QueueItem>) => void;
}

export const useDatasetDirtyTracking = ({
    activeQueueItemId,
    imagesData,
    queueItems,
    updateQueueItem,
}: DatasetDirtyTrackingOptions): void => {
    const currentSignature = useMemo(
        () => getDatasetContentSignature(imagesData),
        [imagesData],
    );
    const previousDatasetSignatureRef = useRef(currentSignature);
    const previousActiveQueueItemIdRef = useRef<string | null>(activeQueueItemId);

    useEffect(() => {
        const activeItem = queueItems.find(item => item.id === activeQueueItemId);
        const sameBatch = previousActiveQueueItemIdRef.current === activeQueueItemId;
        const annotationsChanged = previousDatasetSignatureRef.current !== currentSignature;

        if (sameBatch &&
            annotationsChanged &&
            activeItem?.dataSyncStatus === QueueDataSyncStatus.SYNCED) {
            updateQueueItem(activeItem.id, {dataSyncStatus: QueueDataSyncStatus.DIRTY});
        }

        previousDatasetSignatureRef.current = currentSignature;
        previousActiveQueueItemIdRef.current = activeQueueItemId;
    }, [activeQueueItemId, currentSignature, queueItems, updateQueueItem]);
};
