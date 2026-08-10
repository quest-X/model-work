import {store} from '../index';
import {LocalStorageManager} from '../utils/LocalStorageManager';
import {
    getStoredFileByteLength,
    IndexedDBManager,
    StoredExtractionMetadata,
    StoredImageData,
    StoredProjectData,
    StoredQueueAnnotationFrame,
    StoredVideoPlaybackMode,
    StoredVideoRecoveryData,
} from '../utils/IndexedDBManager';
import {
    updateImageDragModeStatus,
    updateLanguage,
    updateSmartAnnotationActiveStatus,
    updateZoom,
} from '../store/general/actionCreators';
import {
    updateActiveImageIndex,
    updateActiveLabelType,
    updateImageData,
    updateLabelNames,
} from '../store/labels/actionCreators';
import {updateSegmentationResults} from '../store/ai/actionCreators';
import {
    addVideoData,
    updateVideoCurrentFrame,
    updateVideoMode,
} from '../store/video/actionCreators';
import {addQueueItems, setActiveQueueItem} from '../store/queue/actionCreators';
import {
    QueueDataSyncStatus,
    QueueItem,
    QueueItemStatus,
    QueueItemType,
} from '../store/queue/types';
import {VideoData} from '../store/video/types';
import {ImageData} from '../store/labels/types';
import {ImageRepository} from '../logic/imageRepository/ImageRepository';
import {LabelType} from '../data/enums/LabelType';
import {EditorModel} from '../staticModels/EditorModel';
import {FrameExtractorService} from './FrameExtractorService';
import {getEngineBaseUrl} from '../utils/DefaultBackendUrl';

type StoredVideoRecoveryWithLease = StoredVideoRecoveryData & {
    /** Legacy/runtime fallback only. A fresh source or dataset session wins. */
    sessionId?: string;
};

type DatasetVideoSessionResponse = {
    sessionId: string;
    filename?: string;
    metadata: StoredExtractionMetadata;
    dataset?: {revision?: number};
};

type PreparedVideo = {
    queueItem: QueueItem;
    queueItems: QueueItem[];
    metadata: StoredExtractionMetadata;
    sourceFile: File;
    sessionId?: string;
    preExtractedFrames?: File[];
};

const videoFilePattern = /\.(mp4|webm|mov|avi|mkv|m4v|ogg)$/i;

export class ProjectRestoreService {
    public static normalizeQueueItems(queueItems: QueueItem[]): QueueItem[] {
        return queueItems.map(item => item.dataSyncStatus === QueueDataSyncStatus.SYNCING
            ? {
                ...item,
                dataSyncStatus: QueueDataSyncStatus.ERROR,
                dataSyncError: '上次同步被中断，请重试 / Previous sync was interrupted; retry.',
            }
            : item
        );
    }

    public static async checkForStoredData(): Promise<{
        hasSettings: boolean;
        hasProject: boolean;
        lastSaved: number;
        projectName?: string;
        imageCount?: number;
        validImageCount?: number;
        labelCount?: number;
        isVideoProject?: boolean;
    }> {
        const hasSettings = LocalStorageManager.hasStoredSettings();
        const localLastSaved = LocalStorageManager.getLastSavedTime();
        const projectName = hasSettings ? LocalStorageManager.getSettings().projectName : undefined;
        const meta = await IndexedDBManager.getProjectMeta();
        const hasProject = meta !== null && (
            meta.hasRecoverableProject ?? meta.validImageCount > 0
        );

        return {
            hasSettings,
            hasProject,
            // The committed IndexedDB timestamp is authoritative for project data.
            lastSaved: hasProject ? (meta?.lastModified || 0) : localLastSaved,
            projectName,
            imageCount: meta?.imageCount,
            validImageCount: meta?.validImageCount,
            labelCount: meta?.labelCount,
            isVideoProject: meta?.isVideoProject,
        };
    }

    public static async restoreSettings(): Promise<boolean> {
        try {
            const settings = LocalStorageManager.getSettings();
            if (settings.lastSaved === 0) return false;

            store.dispatch(updateLanguage(settings.language));
            store.dispatch(updateZoom(settings.zoom));
            store.dispatch(updateImageDragModeStatus(settings.imageDragMode));
            store.dispatch(updateSmartAnnotationActiveStatus(settings.smartAnnotationActive));
            store.dispatch(updateActiveImageIndex(settings.currentImageIndex));
            store.dispatch(updateActiveLabelType(settings.activeLabelType as LabelType));
            return true;
        } catch (error) {
            console.error('恢复设置失败:', error);
            return false;
        }
    }

    // Recovery deliberately keeps validation and the final Redux commit in one
    // orchestration boundary so no partially rebuilt project becomes visible.
    // eslint-disable-next-line complexity
    public static async restoreProject(onProgress?: (msg: string) => void): Promise<boolean> {
        try {
            const storedProject = await IndexedDBManager.loadProject();
            if (!storedProject) return false;

            const queueItems = this.normalizeQueueItems(storedProject.queueItems || []);
            const activeQueueItem = queueItems.find(item => item.id === storedProject.activeQueueItemId)
                || queueItems.find(item => item.id === storedProject.videoRecovery?.sourceQueueItemId)
                || queueItems[0];
            const isVideoProject = this.isVideoProject(storedProject, activeQueueItem);
            const isCameraProject = activeQueueItem?.type === QueueItemType.CAMERA;

            onProgress?.('正在校验恢复数据...');
            let restoredImages = this.buildRestoredImages(
                storedProject,
                isVideoProject,
                activeQueueItem?.id,
            );
            if (restoredImages.length === 0 && activeQueueItem) {
                const activeSnapshot = storedProject.queueAnnotationSnapshots?.find(
                    snapshot => snapshot.queueItemId === activeQueueItem.id,
                );
                if (activeSnapshot) {
                    restoredImages = this.restoreQueueSnapshot(activeQueueItem, activeSnapshot.frames);
                }
            }
            if (restoredImages.length === 0 && isVideoProject) {
                const metadata = this.metadataFor(storedProject, activeQueueItem, 0);
                if (metadata.totalFrames > 0) {
                    const queueId = activeQueueItem?.id
                        || storedProject.videoRecovery?.sourceQueueItemId
                        || 'restored-video';
                    restoredImages = this.reconcileVideoTimeline([], metadata.totalFrames, queueId);
                }
            }
            if (restoredImages.length === 0 && !isCameraProject) {
                throw new Error(isVideoProject ? '视频时间轴数据为空' : '没有可恢复的图像文件');
            }

            // Reconnect/validate the video before mutating Redux. A failed backend
            // lease must leave the currently committed recovery record untouched.
            const preparedVideo = isVideoProject
                ? await this.prepareVideo(storedProject, queueItems, activeQueueItem, restoredImages, onProgress)
                : null;
            if (preparedVideo) {
                restoredImages = this.reconcileVideoTimeline(
                    restoredImages,
                    preparedVideo.metadata.totalFrames,
                    preparedVideo.queueItem.id,
                );
            }

            onProgress?.('正在恢复标签与队列...');
            if (storedProject.labelNames?.length > 0) {
                store.dispatch(updateLabelNames(storedProject.labelNames));
            }

            const restoredQueueItems = preparedVideo?.queueItems || queueItems;
            if (restoredQueueItems.length > 0) {
                store.dispatch(addQueueItems(restoredQueueItems));
            }
            const activeQueueId = preparedVideo?.queueItem.id
                || storedProject.activeQueueItemId
                || restoredQueueItems[0]?.id
                || null;
            this.restoreInactiveQueueCaches(storedProject, restoredQueueItems, activeQueueId);

            if (storedProject.segmentationResults?.length > 0) {
                store.dispatch(updateSegmentationResults(storedProject.segmentationResults));
            }
            if (storedProject.imageSegmentationResults) {
                Object.entries(storedProject.imageSegmentationResults).forEach(([imageId, results]) => {
                    store.dispatch(updateSegmentationResults(results, imageId));
                });
            }

            const validIndex = Math.max(
                0,
                Math.min(storedProject.currentImageIndex || 0, restoredImages.length - 1),
            );

            if (preparedVideo) {
                onProgress?.('正在恢复视频时间轴...');
                this.commitVideoRestore(preparedVideo, restoredImages, validIndex);
            } else {
                const activeId = storedProject.activeQueueItemId
                    && restoredQueueItems.some(item => item.id === storedProject.activeQueueItemId)
                    ? storedProject.activeQueueItemId
                    : restoredQueueItems[0]?.id || null;
                store.dispatch(updateVideoMode(false));
                store.dispatch(updateImageData(restoredImages));
                store.dispatch(updateActiveImageIndex(validIndex));
                store.dispatch(setActiveQueueItem(activeId));
                ImageRepository.setActiveFileId(activeId);
                if (activeId) ImageRepository.saveFileCache(activeId, restoredImages);
            }

            onProgress?.('恢复完成');
            return true;
        } catch (error) {
            console.error('恢复项目失败:', error);
            throw error instanceof Error ? error : new Error('恢复项目失败');
        }
    }

    private static isVideoProject(
        project: StoredProjectData,
        activeQueueItem?: QueueItem,
    ): boolean {
        const firstImage = project.images[0];
        return Boolean(
            project.videoRecovery
            || project.isVideoProject
            || activeQueueItem?.type === QueueItemType.VIDEO
            || firstImage?.fileType?.startsWith('video/')
            || videoFilePattern.test(firstImage?.fileName || ''),
        );
    }

    private static storedFrameIndex(image: StoredImageData, arrayIndex: number): number {
        if (Number.isInteger(image.frameIndex) && (image.frameIndex as number) >= 0) {
            return image.frameIndex as number;
        }
        const filenameIndex = /frame[_-]?(\d+)/i.exec(image.fileName || '');
        return filenameIndex ? Number(filenameIndex[1]) : arrayIndex;
    }

    private static storedFileToFile(
        storedImage: StoredImageData,
        frameIndex: number,
        videoPlaceholder: boolean,
    ): File {
        const fileName = videoPlaceholder
            ? `frame_${String(frameIndex).padStart(6, '0')}.jpg`
            : storedImage.fileName;
        const fileType = videoPlaceholder ? 'image/jpeg' : (storedImage.fileType || '');
        if (storedImage.fileData instanceof File && !videoPlaceholder) {
            return storedImage.fileData;
        }
        return new File([storedImage.fileData], fileName, {type: fileType});
    }

    private static imageFromStored(
        storedImage: StoredImageData,
        frameIndex: number,
        isVideo: boolean,
    ): ImageData {
        const isPlaceholder = isVideo && (
            storedImage.isPlaceholder === true
            || getStoredFileByteLength(storedImage.fileData) === 0
        );
        return {
            id: storedImage.id,
            fileData: this.storedFileToFile(storedImage, frameIndex, isPlaceholder),
            loadStatus: false,
            labelRects: storedImage.labelRects || [],
            labelPoints: storedImage.labelPoints || [],
            labelLines: storedImage.labelLines || [],
            labelPolygons: storedImage.labelPolygons || [],
            labelNameIds: storedImage.labelNameIds || [],
            isVisitedByRoboflowAPI: false,
        };
    }

    private static buildRestoredImages(
        project: StoredProjectData,
        isVideo: boolean,
        activeQueueItemId?: string,
    ): ImageData[] {
        if (!isVideo) {
            return project.images
                .filter(image => getStoredFileByteLength(image.fileData) > 0)
                .map((image, index) => this.imageFromStored(image, index, false));
        }

        const indexedImages = new Map<number, StoredImageData>();
        project.images.forEach((image, arrayIndex) => {
            indexedImages.set(this.storedFrameIndex(image, arrayIndex), image);
        });
        const maxStoredIndex = Math.max(-1, ...Array.from(indexedImages.keys()));
        const expectedFrames = project.videoRecovery?.metadata.totalFrames
            || project.extractionMetadata?.totalFrames
            || maxStoredIndex + 1;
        const totalFrames = Math.max(expectedFrames, maxStoredIndex + 1, project.images.length);
        const idPrefix = activeQueueItemId || project.videoRecovery?.sourceQueueItemId || 'restored-video';

        return Array.from({length: totalFrames}, (_, frameIndex) => {
            const storedImage = indexedImages.get(frameIndex);
            if (storedImage) return this.imageFromStored(storedImage, frameIndex, true);
            return {
                id: `${idPrefix}-frame-${frameIndex}`,
                fileData: new File([], `frame_${String(frameIndex).padStart(6, '0')}.jpg`, {
                    type: 'image/jpeg',
                }),
                loadStatus: false,
                labelRects: [],
                labelPoints: [],
                labelLines: [],
                labelPolygons: [],
                labelNameIds: [],
                isVisitedByRoboflowAPI: false,
            };
        });
    }

    private static metadataFor(
        project: StoredProjectData,
        activeQueueItem: QueueItem | undefined,
        imageCount: number,
    ): StoredExtractionMetadata {
        const stored = project.videoRecovery?.metadata
            || project.extractionMetadata
            || activeQueueItem?.extractionMetadata;
        const fps = stored?.fps && stored.fps > 0 ? stored.fps : 30;
        const totalFrames = Math.max(stored?.totalFrames || 0, imageCount);
        return {
            fps,
            duration: stored?.duration || (totalFrames / fps),
            totalFrames,
            width: stored?.width || 0,
            height: stored?.height || 0,
        };
    }

    private static annotationFrameToImage(
        frame: StoredQueueAnnotationFrame,
        fileData: File,
    ): ImageData {
        return {
            id: frame.id,
            fileData,
            loadStatus: false,
            labelRects: frame.labelRects || [],
            labelPoints: frame.labelPoints || [],
            labelLines: frame.labelLines || [],
            labelPolygons: frame.labelPolygons || [],
            labelNameIds: frame.labelNameIds || [],
            isVisitedByRoboflowAPI: false,
        };
    }

    private static reconcileVideoTimeline(
        images: ImageData[],
        totalFrames: number,
        queueItemId: string,
    ): ImageData[] {
        if (totalFrames <= 0) throw new Error('重新连接的视频没有可用帧');
        if (images.length === totalFrames) return images;

        const truncated = images.slice(totalFrames);
        if (truncated.some(image =>
            (image.labelRects?.length || 0) > 0 ||
            (image.labelPoints?.length || 0) > 0 ||
            (image.labelLines?.length || 0) > 0 ||
            (image.labelPolygons?.length || 0) > 0
        )) {
            throw new Error(
                `视频帧数已变化（快照 ${images.length} 帧，当前 ${totalFrames} 帧），为防止标注错位已停止恢复`,
            );
        }

        return Array.from({length: totalFrames}, (_, frameIndex) => images[frameIndex] || {
            id: `${queueItemId}-frame-${frameIndex}`,
            fileData: new File([], `frame_${String(frameIndex).padStart(6, '0')}.jpg`, {
                type: 'image/jpeg',
            }),
            loadStatus: false,
            labelRects: [],
            labelPoints: [],
            labelLines: [],
            labelPolygons: [],
            labelNameIds: [],
            isVisitedByRoboflowAPI: false,
        });
    }

    private static sourceFilesForQueueItem(item: QueueItem): File[] {
        if (item.type === QueueItemType.FOLDER) return item.files || [];
        return item.file ? [item.file] : [];
    }

    private static restoreQueueSnapshot(
        item: QueueItem,
        frames: StoredQueueAnnotationFrame[],
    ): ImageData[] {
        const sortedFrames = [...frames].sort((left, right) => left.frameIndex - right.frameIndex);
        if (item.type === QueueItemType.VIDEO) {
            const framesByIndex = new Map(sortedFrames.map(frame => [frame.frameIndex, frame]));
            const maxSnapshotIndex = Math.max(-1, ...Array.from(framesByIndex.keys()));
            const totalFrames = Math.max(
                item.extractionMetadata?.totalFrames || 0,
                maxSnapshotIndex + 1,
            );
            return Array.from({length: totalFrames}, (_, frameIndex) => {
                const frame = framesByIndex.get(frameIndex);
                const placeholder = new File(
                    [],
                    frame?.fileName || `frame_${String(frameIndex).padStart(6, '0')}.jpg`,
                    {type: frame?.fileType || 'image/jpeg'},
                );
                if (frame) return this.annotationFrameToImage(frame, placeholder);
                return {
                    id: `${item.id}-frame-${frameIndex}`,
                    fileData: placeholder,
                    loadStatus: false,
                    labelRects: [],
                    labelPoints: [],
                    labelLines: [],
                    labelPolygons: [],
                    labelNameIds: [],
                    isVisitedByRoboflowAPI: false,
                };
            });
        }

        const sourceFiles = this.sourceFilesForQueueItem(item);
        return sortedFrames.flatMap((frame, index) => {
            const sourceFile = sourceFiles.find(file => file.name === frame.fileName)
                || sourceFiles[frame.frameIndex]
                || sourceFiles[index];
            return sourceFile ? [this.annotationFrameToImage(frame, sourceFile)] : [];
        });
    }

    private static restoreInactiveQueueCaches(
        project: StoredProjectData,
        queueItems: QueueItem[],
        activeQueueItemId: string | null,
    ): void {
        const queueById = new Map(queueItems.map(item => [item.id, item]));
        (project.queueAnnotationSnapshots || []).forEach(snapshot => {
            if (snapshot.queueItemId === activeQueueItemId) return;
            const item = queueById.get(snapshot.queueItemId);
            if (!item) return;
            const restored = this.restoreQueueSnapshot(item, snapshot.frames || []);
            if (restored.length > 0) {
                ImageRepository.saveFileCache(item.id, restored);
            }
        });
    }

    private static isUsableVideoFile(file: File | undefined): file is File {
        return Boolean(file && file.size > 0 && (
            file.type.startsWith('video/') || videoFilePattern.test(file.name)
        ));
    }

    private static async openDatasetSession(
        datasetId: string,
        expectedRevision?: number,
    ): Promise<DatasetVideoSessionResponse> {
        const revisionQuery = expectedRevision === undefined
            ? ''
            : `?revision=${encodeURIComponent(String(expectedRevision))}`;
        const response = await fetch(
            `${getEngineBaseUrl()}/datasets/${encodeURIComponent(datasetId)}/video-session${revisionQuery}`,
            {method: 'POST'},
        );
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const detail = typeof body.detail === 'string' ? body.detail : `${response.status}`;
            throw new Error(detail);
        }
        const result = await response.json() as DatasetVideoSessionResponse;
        if (!result.sessionId || !result.metadata?.totalFrames) {
            throw new Error('服务器返回的视频会话不完整');
        }
        if (expectedRevision !== undefined && result.dataset?.revision !== expectedRevision) {
            throw new Error(
                `数据集版本不一致：恢复快照需要 v${expectedRevision}，服务器返回 v${result.dataset?.revision ?? '未知'}`,
            );
        }
        return result;
    }

    private static async validateSession(sessionId: string, frameIndex: number): Promise<void> {
        const frames = await FrameExtractorService.fetchFrameRange(sessionId, frameIndex, 1);
        if (frames.length === 0) throw new Error('视频会话没有返回帧');
    }

    // The ordered fallback chain (dataset -> source file -> old lease) is kept
    // explicit because each branch has different durability guarantees.
    // eslint-disable-next-line complexity
    private static async prepareVideo(
        project: StoredProjectData,
        queueItems: QueueItem[],
        activeQueueItem: QueueItem | undefined,
        restoredImages: ImageData[],
        onProgress?: (msg: string) => void,
    ): Promise<PreparedVideo> {
        const recovery = project.videoRecovery as StoredVideoRecoveryWithLease | undefined;
        const metadata = this.metadataFor(project, activeQueueItem, restoredImages.length);
        const recoverySource = recovery?.sourceFile;
        const queueSource = activeQueueItem?.file;
        let sourceFile: File | undefined;
        if (this.isUsableVideoFile(recoverySource)) {
            sourceFile = recoverySource;
        } else if (this.isUsableVideoFile(queueSource)) {
            sourceFile = queueSource;
        }
        const allFramesHavePixels = restoredImages.length >= metadata.totalFrames
            && restoredImages.slice(0, metadata.totalFrames).every(image => image.fileData.size > 0);
        let mode: StoredVideoPlaybackMode = recovery?.mode
            || (allFramesHavePixels ? 'pre-extracted' : sourceFile ? 'raw' : 'on-demand');
        let runtimeMetadata = metadata;
        let sessionId: string | undefined;
        let preExtractedFrames: File[] | undefined;
        let reconnectError: unknown;

        if (mode === 'pre-extracted' && allFramesHavePixels) {
            preExtractedFrames = restoredImages.slice(0, metadata.totalFrames).map(image => image.fileData);
        } else {
            // An incomplete pre-extracted cache is still recoverable from its source.
            if (mode === 'pre-extracted') mode = 'on-demand';
            if (activeQueueItem?.datasetId) {
                onProgress?.('正在重新连接服务器视频...');
                try {
                    const reopened = await this.openDatasetSession(
                        activeQueueItem.datasetId,
                        activeQueueItem.datasetRevision,
                    );
                    sessionId = reopened.sessionId;
                    runtimeMetadata = reopened.metadata;
                    mode = 'on-demand';
                } catch (error) {
                    reconnectError = error;
                }
            }

            if (!sessionId && sourceFile && mode !== 'raw') {
                onProgress?.('正在重新打开本地视频...');
                try {
                    const reopened = await FrameExtractorService.openSession(sourceFile);
                    sessionId = reopened.sessionId;
                    runtimeMetadata = {
                        fps: reopened.fps,
                        duration: reopened.duration,
                        totalFrames: reopened.totalFrames,
                        width: reopened.width,
                        height: reopened.height,
                    };
                    mode = 'on-demand';
                } catch (error) {
                    // The original File remains browser-playable even if FFmpeg is down.
                    console.warn('[ProjectRestore] 后端重连失败，回退浏览器视频播放:', error);
                    reconnectError = error;
                    mode = 'raw';
                }
            }

            const previousLease = recovery?.sessionId || activeQueueItem?.videoSessionId;
            if (!sessionId && !sourceFile && previousLease) {
                onProgress?.('正在验证原视频会话...');
                try {
                    await this.validateSession(previousLease, Math.min(
                        project.currentImageIndex || 0,
                        Math.max(0, runtimeMetadata.totalFrames - 1),
                    ));
                    sessionId = previousLease;
                    mode = 'on-demand';
                } catch (error) {
                    reconnectError = error;
                }
            }

            if (!sessionId && !sourceFile) {
                const reason = reconnectError instanceof Error ? `：${reconnectError.message}` : '';
                throw new Error(`视频源当前不可用，请确认核心引擎在线后重试${reason}`);
            }
        }

        const queueId = activeQueueItem?.id
            || recovery?.sourceQueueItemId
            || `restored-video-${project.lastModified || Date.now()}`;
        const runtimeSource = sourceFile || new File([], activeQueueItem?.name || 'restored-video.mp4', {
            type: 'video/mp4',
        });
        const queueItem: QueueItem = {
            ...(activeQueueItem || {
                id: queueId,
                name: runtimeSource.name,
                type: QueueItemType.VIDEO,
                status: QueueItemStatus.COMPLETED,
                uploadedAt: project.lastModified || Date.now(),
            }),
            id: queueId,
            type: QueueItemType.VIDEO,
            file: runtimeSource,
            extractedFrames: preExtractedFrames,
            videoSessionId: sessionId,
            extractionMetadata: runtimeMetadata,
            status: QueueItemStatus.COMPLETED,
        };
        const restoredQueueItems = activeQueueItem
            ? queueItems.map(item => item.id === activeQueueItem.id ? queueItem : item)
            : [queueItem, ...queueItems];

        return {
            queueItem,
            queueItems: restoredQueueItems,
            metadata: runtimeMetadata,
            sourceFile: runtimeSource,
            sessionId,
            preExtractedFrames,
        };
    }

    private static commitVideoRestore(
        prepared: PreparedVideo,
        restoredImages: ImageData[],
        currentFrame: number,
    ): void {
        const {queueItem, metadata, sourceFile, sessionId, preExtractedFrames} = prepared;
        const safeFrame = Math.min(currentFrame, Math.max(0, metadata.totalFrames - 1));
        const videoData: VideoData = {
            id: queueItem.id,
            fileData: sourceFile,
            loadStatus: metadata.totalFrames > 0,
            duration: metadata.duration,
            fps: metadata.fps,
            totalFrames: metadata.totalFrames,
            videoSize: {width: metadata.width, height: metadata.height},
            currentFrame: safeFrame,
            currentTime: safeFrame / metadata.fps,
            isPlaying: false,
            frames: new Map(),
            preExtractedFrames,
            sessionId,
        };

        EditorModel.videoSessionId = sessionId || '';
        EditorModel.videoFrameFiles = preExtractedFrames ? [...preExtractedFrames] : [];
        EditorModel.preloadedImageCache = new Map();
        EditorModel.videoFrameImage = null;
        EditorModel.playbackImageData = null;
        ImageRepository.setActiveFileId(queueItem.id);
        ImageRepository.saveFileCache(queueItem.id, restoredImages);

        store.dispatch(setActiveQueueItem(queueItem.id));
        store.dispatch(updateImageData(restoredImages));
        store.dispatch(updateVideoMode(true));
        store.dispatch(addVideoData(videoData));
        store.dispatch(updateActiveImageIndex(safeFrame));
        store.dispatch(updateVideoCurrentFrame(queueItem.id, safeFrame, safeFrame / metadata.fps));
    }

    public static async clearAllStoredData(): Promise<void> {
        const cleared = await IndexedDBManager.clearProject();
        if (!cleared) throw new Error('无法清除 IndexedDB 中的恢复数据');
        LocalStorageManager.clearSettings();
    }

    public static formatLastSavedTime(timestamp: number): string {
        if (timestamp === 0) return '从未保存';
        const date = new Date(timestamp);
        const diffMins = Math.floor((Date.now() - date.getTime()) / (1000 * 60));
        if (diffMins < 1) return '刚刚';
        if (diffMins < 60) return `${diffMins}分钟前`;
        if (diffMins < 1440) return `${Math.floor(diffMins / 60)}小时前`;
        return date.toLocaleString();
    }
}
