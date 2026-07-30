import {store} from '../index';
import {LanguageConfig} from '../data/LanguageConfig';
import {ImageData, LabelName} from '../store/labels/types';
import {updateQueueItem} from '../store/queue/actionCreators';
import {QueueDataSyncStatus, QueueItem, QueueItemType} from '../store/queue/types';
import {TaskType} from '../store/tasks/types';
import {getEngineBaseUrl} from '../utils/DefaultBackendUrl';
import {TaskTracker} from './TaskTracker';

type BatchRegion = {
    label_id: string;
    bbox: [number, number, number, number];
};

type BatchMetadata = {
    version: 1;
    classes: Array<{id: string; name: string}>;
    images: Array<{index: number; regions: BatchRegion[]}>;
};

type BatchUploadResponse = {
    status: string;
    dataset_id: string;
    revision: number;
};

const fileSignature = (file: File): string =>
    `${file.name}::${file.size}::${file.lastModified}`;

const filesForItem = (item: QueueItem): File[] => {
    if (item.type === QueueItemType.FOLDER) return item.files || [];
    if (item.type === QueueItemType.IMAGE && item.file) return [item.file];
    return [];
};

const polygonBoundingBox = (vertices: Array<{x: number; y: number}>): [number, number, number, number] | null => {
    if (vertices.length === 0) return null;
    const xs = vertices.map(vertex => vertex.x).filter(Number.isFinite);
    const ys = vertices.map(vertex => vertex.y).filter(Number.isFinite);
    if (xs.length === 0 || ys.length === 0) return null;
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    if (maxX <= minX || maxY <= minY) return null;
    return [minX, minY, maxX - minX, maxY - minY];
};

const readError = async (response: Response): Promise<string> => {
    try {
        const body = await response.json();
        return typeof body.detail === 'string' ? body.detail : JSON.stringify(body);
    } catch {
        return `${response.status} ${response.statusText}`.trim();
    }
};

export class DataBatchSyncService {
    private static inFlight = new Map<string, Promise<BatchUploadResponse>>();

    public static buildMetadata(files: File[], imagesData: ImageData[], labels: LabelName[]): BatchMetadata {
        const labelIds = new Set(labels.map(label => label.id));
        const usedLabelIds = new Set<string>();
        const remainingImages = [...imagesData];
        const images = files.map((file, index) => {
            const exactIndex = remainingImages.findIndex(image => image.fileData === file);
            const signatureIndex = exactIndex >= 0
                ? exactIndex
                : remainingImages.findIndex(image => fileSignature(image.fileData) === fileSignature(file));
            const image = signatureIndex >= 0 ? remainingImages.splice(signatureIndex, 1)[0] : undefined;
            const regions: BatchRegion[] = [];

            image?.labelRects.forEach(labelRect => {
                if (!labelRect.labelId || !labelIds.has(labelRect.labelId) || labelRect.isPrompt) return;
                const {x, y, width, height} = labelRect.rect;
                if (width > 0 && height > 0) {
                    regions.push({label_id: labelRect.labelId, bbox: [x, y, width, height]});
                    usedLabelIds.add(labelRect.labelId);
                }
            });
            image?.labelPolygons.forEach(labelPolygon => {
                if (!labelPolygon.labelId || !labelIds.has(labelPolygon.labelId)) return;
                const bbox = polygonBoundingBox(labelPolygon.vertices);
                if (bbox) {
                    regions.push({label_id: labelPolygon.labelId, bbox});
                    usedLabelIds.add(labelPolygon.labelId);
                }
            });
            return {index, regions};
        });

        return {
            version: 1,
            classes: labels
                .filter(label => usedLabelIds.has(label.id))
                .map(label => ({id: label.id, name: label.name})),
            images,
        };
    }

    public static buildVideoMetadata(imagesData: ImageData[], labels: LabelName[]): BatchMetadata {
        return this.buildMetadata(imagesData.map(image => image.fileData), imagesData, labels);
    }

    public static syncQueueItem(
        item: QueueItem,
        imagesData: ImageData[],
        labels: LabelName[],
        videoSessionId?: string,
    ): Promise<BatchUploadResponse> {
        const existing = this.inFlight.get(item.id);
        if (existing) return existing;

        const files = filesForItem(item);
        if (item.type === QueueItemType.VIDEO && !videoSessionId) {
            return Promise.reject(new Error('Open the video again before synchronizing it'));
        }
        if (item.type !== QueueItemType.VIDEO && files.length === 0) {
            return Promise.reject(new Error('Only image batches can be synchronized to Resource Center'));
        }

        const promise = this.performSync(item, files, imagesData, labels, videoSessionId)
            .finally(() => this.inFlight.delete(item.id));
        this.inFlight.set(item.id, promise);
        return promise;
    }

    private static async performSync(
        item: QueueItem,
        files: File[],
        imagesData: ImageData[],
        labels: LabelName[],
        videoSessionId?: string,
    ): Promise<BatchUploadResponse> {
        const texts = LanguageConfig[store.getState().general.language];
        const task = TaskTracker.startTask({
            type: TaskType.DATA_SYNC,
            priority: 'P0',
            title: texts.taskManager.types.dataSync,
            subtitle: item.name,
            cancellable: false,
            autoRemoveAfterMs: 0,
        });
        store.dispatch(updateQueueItem(item.id, {
            dataSyncStatus: QueueDataSyncStatus.SYNCING,
            dataSyncError: undefined,
        }));

        try {
            const form = new FormData();
            const projectName = store.getState().general.projectData.name.trim();
            form.append('name', projectName || item.name);
            if (projectName) form.append('project_name', projectName);
            form.append('source_id', item.id);
            if (item.datasetId) form.append('dataset_id', item.datasetId);
            form.append('operation_type', item.datasetId ? 'annotation_edit' : 'raw');
            const metadata = item.type === QueueItemType.VIDEO
                ? this.buildVideoMetadata(imagesData, labels)
                : this.buildMetadata(files, imagesData, labels);
            form.append('metadata', JSON.stringify(metadata));
            if (item.type !== QueueItemType.VIDEO) {
                files.forEach(file => form.append('files', file, file.name));
            } else if (item.file?.name) {
                form.append('video_filename', item.file.name);
            }
            const endpoint = item.type === QueueItemType.VIDEO
                ? `/datasets/video-sessions/${encodeURIComponent(String(videoSessionId))}`
                : '/datasets/batches';
            const response = await fetch(`${getEngineBaseUrl()}${endpoint}`, {
                method: 'POST',
                body: form,
            });
            if (!response.ok) throw new Error(await readError(response));
            const result = await response.json() as BatchUploadResponse;
            if (!result.dataset_id) throw new Error('Resource Center returned no dataset id');
            store.dispatch(updateQueueItem(item.id, {
                dataSyncStatus: QueueDataSyncStatus.SYNCED,
                datasetId: result.dataset_id,
                datasetRevision: result.revision || 1,
                dataSyncError: undefined,
                syncedAt: Date.now(),
            }));
            window.dispatchEvent(new CustomEvent('opensight:data-center-updated', {
                detail: {datasetId: result.dataset_id, queueItemId: item.id},
            }));
            task.complete();
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            store.dispatch(updateQueueItem(item.id, {
                dataSyncStatus: QueueDataSyncStatus.ERROR,
                dataSyncError: message,
            }));
            task.fail(error);
            throw error;
        }
    }
}
