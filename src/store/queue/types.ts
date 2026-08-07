import { Action } from '../Actions';

export enum QueueItemType {
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
    FOLDER = 'FOLDER',
    CAMERA = 'CAMERA'
}

export enum QueueItemStatus {
    PENDING = 'PENDING',
    PROCESSING = 'PROCESSING',
    COMPLETED = 'COMPLETED',
    ERROR = 'ERROR'
}

export enum QueueDataSyncStatus {
    LOCAL = 'LOCAL',
    SYNCING = 'SYNCING',
    SYNCED = 'SYNCED',
    DIRTY = 'DIRTY',
    ERROR = 'ERROR'
}

export type QueueItem = {
    id: string;
    name: string;
    type: QueueItemType;
    file?: File;
    files?: File[]; // For folders
    extractedFrames?: File[];          // FFmpeg 拆出的 JPEG 帧（VIDEO 模式专用）
    videoSessionId?: string;           // On-demand backend session owned by this video item
    extractionMetadata?: {             // 拆帧时的视频元信息
        fps: number;
        duration: number;
        totalFrames: number;
        width: number;
        height: number;
    };
    status: QueueItemStatus;
    uploadedAt: number; // timestamp
    thumbnail?: string; // Base64 thumbnail for images/videos
    cameraResourceId?: string;
    cameraChannelId?: string;
    cameraHost?: string;
    cameraModel?: string;
    error?: string;
    dataSyncStatus?: QueueDataSyncStatus;
    datasetId?: string;
    datasetRevision?: number;
    dataSyncError?: string;
    syncedAt?: number;
}

export type QueueState = {
    items: QueueItem[];
    activeQueueItemId: string | null;
}

interface AddQueueItem {
    type: typeof Action.ADD_QUEUE_ITEM;
    payload: {
        item: QueueItem;
    }
}

interface AddQueueItems {
    type: typeof Action.ADD_QUEUE_ITEMS;
    payload: {
        items: QueueItem[];
    }
}

interface RemoveQueueItem {
    type: typeof Action.REMOVE_QUEUE_ITEM;
    payload: {
        itemId: string;
    }
}

interface UpdateQueueItem {
    type: typeof Action.UPDATE_QUEUE_ITEM;
    payload: {
        itemId: string;
        updates: Partial<QueueItem>;
    }
}

interface SetActiveQueueItem {
    type: typeof Action.SET_ACTIVE_QUEUE_ITEM;
    payload: {
        itemId: string | null;
    }
}

interface ClearQueue {
    type: typeof Action.CLEAR_QUEUE;
}

export type QueueActionTypes = 
    | AddQueueItem
    | AddQueueItems
    | RemoveQueueItem
    | UpdateQueueItem
    | SetActiveQueueItem
    | ClearQueue;
