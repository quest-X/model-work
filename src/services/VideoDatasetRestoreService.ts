import {v4 as uuidv4} from 'uuid';
import {store} from '../index';
import {EditorModel} from '../staticModels/EditorModel';
import {QueueActions} from '../logic/actions/QueueActions';
import {ImageRepository} from '../logic/imageRepository/ImageRepository';
import {addQueueItem} from '../store/queue/actionCreators';
import {
    QueueDataSyncStatus,
    QueueItem,
    QueueItemStatus,
    QueueItemType,
} from '../store/queue/types';
import {ImageData, LabelName} from '../store/labels/types';
import {updateLabelNames} from '../store/labels/actionCreators';
import {updateProjectData} from '../store/general/actionCreators';
import {ImageDataUtil} from '../utils/ImageDataUtil';
import {LabelUtil} from '../utils/LabelUtil';
import {getEngineBaseUrl} from '../utils/DefaultBackendUrl';

type WorkspaceRegion = {
    label_id: string;
    bbox: [number, number, number, number];
    shape?: 'rect' | 'polygon';
    vertices?: Array<{x: number; y: number}>;
};

type WorkspaceMetadata = {
    classes?: Array<{id: string; name: string; color?: string}>;
    images?: Array<{index: number; regions?: WorkspaceRegion[]}>;
};

type VideoSessionResponse = {
    sessionId: string;
    filename: string;
    metadata: {
        fps: number;
        duration: number;
        totalFrames: number;
        width: number;
        height: number;
    };
    workspace?: WorkspaceMetadata;
    dataset?: {revision?: number};
};

const readError = async (response: Response): Promise<string> => {
    const body = await response.json().catch(() => ({}));
    return typeof body.detail === 'string' ? body.detail : `${response.status}`;
};

const buildLabels = (workspace: WorkspaceMetadata): LabelName[] =>
    (workspace.classes || []).map(label => {
        const created = LabelUtil.createLabelName(label.name);
        return {
            ...created,
            id: label.id,
            color: label.color || created.color,
        };
    });

const buildFrames = (
    totalFrames: number,
    workspace: WorkspaceMetadata,
    validLabelIds: Set<string>,
): ImageData[] => {
    const regionsByIndex = new Map(
        (workspace.images || []).map(image => [image.index, image.regions || []]),
    );
    return Array.from({length: totalFrames}, (_, index) => {
        const image = ImageDataUtil.createImageDataFromFileData(
            new File([], `frame_${String(index).padStart(6, '0')}.jpg`, {
                type: 'image/jpeg',
            }),
        );
        const regions = regionsByIndex.get(index) || [];
        image.labelRects = regions
            .filter(region => region.shape !== 'polygon' && validLabelIds.has(region.label_id))
            .map(region => LabelUtil.createLabelRect(region.label_id, {
                x: region.bbox[0],
                y: region.bbox[1],
                width: region.bbox[2],
                height: region.bbox[3],
            }));
        image.labelPolygons = regions
            .filter(region => region.shape === 'polygon'
                && validLabelIds.has(region.label_id)
                && (region.vertices?.length || 0) >= 3)
            .map(region => LabelUtil.createLabelPolygon(region.label_id, region.vertices || []));
        image.labelNameIds = Array.from(new Set(
            [...image.labelRects, ...image.labelPolygons]
                .map(label => label.labelId)
                .filter((labelId): labelId is string => Boolean(labelId)),
        ));
        return image;
    });
};

export class VideoDatasetRestoreService {
    public static async restore(
        datasetId: string,
        datasetName: string,
        datasetRevision: number,
        currentImagesData: ImageData[],
    ): Promise<QueueItem> {
        const response = await fetch(
            `${getEngineBaseUrl()}/datasets/${encodeURIComponent(datasetId)}/video-session` +
            `?revision=${encodeURIComponent(String(datasetRevision))}`,
            {method: 'POST'},
        );
        if (!response.ok) throw new Error(await readError(response));
        const result = await response.json() as VideoSessionResponse;
        if (!result.sessionId || !result.metadata?.totalFrames) {
            throw new Error('Resource Center returned an incomplete video session');
        }
        if (result.dataset?.revision !== datasetRevision) {
            throw new Error(
                `Dataset revision mismatch: expected v${datasetRevision}, received v${result.dataset?.revision ?? 'unknown'}`,
            );
        }

        const labels = buildLabels(result.workspace || {});
        const frames = buildFrames(
            result.metadata.totalFrames,
            result.workspace || {},
            new Set(labels.map(label => label.id)),
        );
        const queueId = uuidv4();
        const item: QueueItem = {
            id: queueId,
            name: result.filename || datasetName,
            type: QueueItemType.VIDEO,
            file: new File([], result.filename || `${datasetName}.mp4`, {type: 'video/mp4'}),
            videoSessionId: result.sessionId,
            extractionMetadata: result.metadata,
            status: QueueItemStatus.PENDING,
            uploadedAt: Date.now(),
            dataSyncStatus: QueueDataSyncStatus.SYNCED,
            datasetId,
            datasetRevision,
            syncedAt: Date.now(),
        };

        EditorModel.videoSessionId = result.sessionId;
        EditorModel.preloadedImageCache = new Map();
        EditorModel.videoFrameFiles = [];
        ImageRepository.saveFileCache(queueId, frames);
        store.dispatch(addQueueItem(item));
        store.dispatch(updateLabelNames(labels));
        store.dispatch(updateProjectData({
            ...store.getState().general.projectData,
            name: datasetName,
        }));
        await QueueActions.switchToQueueItem(item, currentImagesData);
        return item;
    }
}
