import { store } from '../../index';
import { QueueItem, QueueItemType, QueueItemStatus } from '../../store/queue/types';
import { ImageData } from '../../store/labels/types';
import { setActiveQueueItem, updateQueueItem } from '../../store/queue/actionCreators';
import { updateImageData, updateActiveImageIndex } from '../../store/labels/actionCreators';
import {
    addVideoData,
    removeVideoData,
    updateActiveVideoIndex,
    updateVideoMode,
} from '../../store/video/actionCreators';
import { ImageRepository } from '../imageRepository/ImageRepository';
import { ImageDataUtil } from '../../utils/ImageDataUtil';
import { VideoData, VideoState } from '../../store/video/types';
import { EditorModel } from '../../staticModels/EditorModel';
import { TaskTracker } from '../../services/TaskTracker';
import type { TaskHandle } from '../../services/TaskTracker';
import { TaskType } from '../../store/tasks/types';
import { LanguageConfig } from '../../data/LanguageConfig';
import { FrameExtractorService } from '../../services/FrameExtractorService';
import { getEngineBaseUrl } from '../../utils/DefaultBackendUrl';

type VideoRuntime = {
    sessionId?: string;
    metadata?: QueueItem['extractionMetadata'];
};

type PreparedVideoSwitch = {
    targetItem: QueueItem;
    sessionId?: string;
    queueUpdates?: Partial<QueueItem>;
};

type ResolvedVideoSession = {
    sessionId?: string;
    stale: boolean;
};

type ActiveSwitch = {
    generation: number;
    task: TaskHandle;
};

export class QueueActions {
    private static switchGeneration = 0;
    private static activeSwitch?: ActiveSwitch;

    private static setVideoRuntimeGlobals(sessionId?: string, frames?: File[]): void {
        EditorModel.videoSessionId = sessionId || '';
        EditorModel.videoFrameFiles = frames ? [...frames] : [];
        EditorModel.preloadedImageCache = new Map();
        EditorModel.videoFrameImage = null;
        EditorModel.playbackImageData = null;
    }

    private static async reopenVideoRuntime(targetItem: QueueItem): Promise<VideoRuntime> {
        if (targetItem.datasetId) {
            const revisionQuery = targetItem.datasetRevision === undefined
                ? ''
                : `?revision=${encodeURIComponent(String(targetItem.datasetRevision))}`;
            const response = await fetch(
                `${getEngineBaseUrl()}/datasets/${encodeURIComponent(
                    targetItem.datasetId
                )}/video-session${revisionQuery}`,
                {method: 'POST'},
            );
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                const detail = typeof body.detail === 'string' ? body.detail : `${response.status}`;
                throw new Error(`无法重新打开服务器视频：${detail}`);
            }
            const result = await response.json();
            if (targetItem.datasetRevision !== undefined) {
                const actualRevision = result.dataset?.revision;
                if (actualRevision === undefined
                    || String(actualRevision) !== String(targetItem.datasetRevision)) {
                    const actual = actualRevision === undefined ? '缺失' : `v${actualRevision}`;
                    throw new Error(
                        `数据集版本不匹配：队列项 v${targetItem.datasetRevision}，服务器 ${actual}`
                    );
                }
            }
            if (!result.sessionId || !result.metadata?.totalFrames) {
                throw new Error('服务器返回的视频会话不完整');
            }
            return {sessionId: result.sessionId, metadata: result.metadata};
        }

        if (targetItem.file?.size) {
            try {
                const result = await FrameExtractorService.openSession(targetItem.file);
                return {
                    sessionId: result.sessionId,
                    metadata: {
                        fps: result.fps,
                        duration: result.duration,
                        totalFrames: result.totalFrames,
                        width: result.width,
                        height: result.height,
                    },
                };
            } catch (error) {
                // Local source files remain usable by raw_browser_mode while the
                // engine is unavailable, so annotations can still be recovered.
                console.warn('[QueueActions] 视频会话重建失败，回退浏览器播放:', error);
            }
        }
        return {metadata: targetItem.extractionMetadata};
    }

    private static async validateVideoSession(sessionId: string): Promise<boolean> {
        try {
            const response = await fetch(
                `${getEngineBaseUrl()}/extraction-status/${encodeURIComponent(sessionId)}`,
                {method: 'GET'},
            );
            return response.ok;
        } catch (_error) {
            return false;
        }
    }

    private static resolveVideoSession(
        targetItem: QueueItem,
        videoState: VideoState
    ): string | undefined {
        const storedTarget = store.getState().queue.items.find(item => item.id === targetItem.id);
        const existingVideo = videoState.videos
            .filter(video => video.id === targetItem.id)
            .pop();
        const ownedSessionId = targetItem.videoSessionId
            || storedTarget?.videoSessionId
            || existingVideo?.sessionId;
        if (ownedSessionId) return ownedSessionId;

        const legacyGlobalSessionId = EditorModel.videoSessionId || undefined;
        if (!legacyGlobalSessionId) return undefined;

        const globalSessionBelongsToDifferentVideo = videoState.videos.some(video =>
            video.id !== targetItem.id && video.sessionId === legacyGlobalSessionId
        );
        if (globalSessionBelongsToDifferentVideo) return undefined;

        const isInitialOrCurrentVideo = videoState.videos.length === 0
            || videoState.activeVideo?.id === targetItem.id;
        return isInitialOrCurrentVideo ? legacyGlobalSessionId : undefined;
    }

    private static async resolveUsableVideoSession(
        targetItem: QueueItem,
        videoState: VideoState,
    ): Promise<ResolvedVideoSession> {
        const sessionId = QueueActions.resolveVideoSession(targetItem, videoState);
        if (!sessionId) return {stale: false};
        const usable = await QueueActions.validateVideoSession(sessionId);
        return usable ? {sessionId, stale: false} : {stale: true};
    }

    private static shouldReopenVideo(targetItem: QueueItem, staleSession: boolean): boolean {
        const needsRuntime = !targetItem.extractedFrames || staleSession;
        const hasDurableSource = Boolean(targetItem.datasetId || targetItem.file?.size);
        return needsRuntime && hasDurableSource;
    }

    private static createVideoData(targetItem: QueueItem, sessionId?: string): VideoData {
        const meta = targetItem.extractionMetadata;
        if (!meta?.fps) {
            console.warn('[QueueActions] fps 缺失，使用默认值 30');
        }
        return {
            id: targetItem.id,
            fileData: targetItem.file!,
            loadStatus: !!meta,
            duration: meta?.duration || 0,
            fps: meta?.fps || 30,
            totalFrames: meta?.totalFrames || 0,
            videoSize: meta
                ? { width: meta.width, height: meta.height }
                : { width: 0, height: 0 },
            currentFrame: 0,
            currentTime: 0,
            isPlaying: false,
            frames: new Map(),
            preExtractedFrames: targetItem.extractedFrames,
            sessionId,
        };
    }

    private static activateVideoData(videoData: VideoData, videoState: VideoState): void {
        const existingVideos = videoState.videos.filter(video => video.id === videoData.id);
        const reusableVideoIndex = videoState.videos.findIndex(video =>
            video.id === videoData.id && video.sessionId === videoData.sessionId
        );
        if (existingVideos.length === 1 && reusableVideoIndex >= 0) {
            store.dispatch(updateActiveVideoIndex(reusableVideoIndex));
            return;
        }
        if (existingVideos.length > 0) {
            store.dispatch(removeVideoData(videoData.id));
        }
        store.dispatch(addVideoData(videoData));
    }

    private static restoreVideoImages(
        targetItem: QueueItem,
        cachedData: ImageData[] | null,
    ): void {
        if (cachedData) {
            store.dispatch(updateImageData(cachedData));
            store.dispatch(updateActiveImageIndex(0));
        } else if (targetItem.extractedFrames) {
            store.dispatch(updateImageData(
                targetItem.extractedFrames.map(f => ImageDataUtil.createImageDataFromFileData(f))
            ));
            store.dispatch(updateActiveImageIndex(0));
        } else if (targetItem.extractionMetadata) {
            // Raw-browser fallback still needs a durable timeline immediately.
            // VideoEditor will replace these placeholders as frames decode.
            const placeholders: ImageData[] = [];
            for (let i = 0; i < targetItem.extractionMetadata.totalFrames; i++) {
                placeholders.push(ImageDataUtil.createImageDataFromFileData(
                    new File([], `frame_${String(i).padStart(6, '0')}.jpg`, { type: 'image/jpeg' })
                ));
            }
            store.dispatch(updateImageData(placeholders));
            store.dispatch(updateActiveImageIndex(0));
        }
    }

    private static async prepareVideoSwitch(targetItem: QueueItem): Promise<PreparedVideoSwitch> {
        const state = store.getState();
        const storedTarget = state.queue.items.find(item => item.id === targetItem.id);
        let runtimeTarget = targetItem;
        const resolvedSession = await QueueActions.resolveUsableVideoSession(
            targetItem,
            state.video,
        );
        let sessionId = resolvedSession.sessionId;
        let queueUpdates: Partial<QueueItem> | undefined;
        if (!sessionId && QueueActions.shouldReopenVideo(targetItem, resolvedSession.stale)) {
            const reopened = await QueueActions.reopenVideoRuntime(targetItem);
            sessionId = reopened.sessionId;
            runtimeTarget = {
                ...targetItem,
                videoSessionId: sessionId,
                extractionMetadata: reopened.metadata || targetItem.extractionMetadata,
            };
            if (sessionId) {
                queueUpdates = {
                    videoSessionId: sessionId,
                    extractionMetadata: runtimeTarget.extractionMetadata,
                };
            }
        }
        if (resolvedSession.stale && !sessionId
            && (targetItem.videoSessionId || storedTarget?.videoSessionId)) {
            queueUpdates = {videoSessionId: undefined};
            runtimeTarget = {...runtimeTarget, videoSessionId: undefined};
        }
        if (sessionId && runtimeTarget === targetItem
            && !targetItem.videoSessionId && !storedTarget?.videoSessionId) {
            queueUpdates = {videoSessionId: sessionId};
        }

        return {targetItem: runtimeTarget, sessionId, queueUpdates};
    }

    private static commitVideoSwitch(
        prepared: PreparedVideoSwitch,
        cachedData: ImageData[] | null,
    ): void {
        const {targetItem, sessionId, queueUpdates} = prepared;
        if (queueUpdates) {
            store.dispatch(updateQueueItem(targetItem.id, queueUpdates));
        }
        QueueActions.setVideoRuntimeGlobals(sessionId, targetItem.extractedFrames);
        const videoData = QueueActions.createVideoData(targetItem, sessionId);
        store.dispatch(updateVideoMode(true));
        QueueActions.activateVideoData(videoData, store.getState().video);
        ImageRepository.setActiveFileId(targetItem.id);
        QueueActions.restoreVideoImages(targetItem, cachedData);
    }

    private static switchToNonVideo(targetItem: QueueItem, cachedData: ImageData[] | null): void {
        QueueActions.setVideoRuntimeGlobals();
        store.dispatch(updateVideoMode(false));
        ImageRepository.setActiveFileId(targetItem.id);
        if (cachedData) {
            store.dispatch(updateImageData(cachedData));
            store.dispatch(updateActiveImageIndex(0));
            return;
        }

        const files = targetItem.type === QueueItemType.FOLDER
            ? targetItem.files!
            : [targetItem.file!];
        store.dispatch(updateImageData(
            files.map(f => ImageDataUtil.createImageDataFromFileData(f))
        ));
        store.dispatch(updateActiveImageIndex(0));
    }

    public static async switchToQueueItem(
        targetItem: QueueItem,
        currentImagesData: ImageData[]
    ): Promise<void> {
        const generation = ++QueueActions.switchGeneration;
        QueueActions.activeSwitch?.task.cancel();

        // P0 Task Manager 行：队列文件切换属于"基础数据加载"。
        const tmTexts = LanguageConfig[store.getState().general.language].taskManager;
        const task = TaskTracker.startTask({
            type: TaskType.QUEUE_LOAD,
            priority: 'P0',
            title: tmTexts.types.queueLoad,
            subtitle: targetItem.name,
            cancellable: false,
            autoRemoveAfterMs: 0,
        });
        QueueActions.activeSwitch = {generation, task};

        try {
            // Slow video resources are prepared without touching the current editor.
            // The generation check makes the latest requested switch the sole committer.
            const preparedVideo = targetItem.type === QueueItemType.VIDEO
                ? await QueueActions.prepareVideoSwitch(targetItem)
                : undefined;
            if (generation !== QueueActions.switchGeneration) return;

            const currentFileId = ImageRepository.getActiveFileId();
            if (currentFileId && currentImagesData.length > 0) {
                ImageRepository.saveFileCache(currentFileId, currentImagesData);
            }

            // No await is allowed inside this commit block: the old editor remains
            // intact until every resource needed by the new target is ready.
            ImageRepository.clearCurrentDisplay();
            store.dispatch(updateImageData([]));
            store.dispatch(updateActiveImageIndex(0));
            store.dispatch(setActiveQueueItem(targetItem.id));
            store.dispatch(updateQueueItem(targetItem.id, {status: QueueItemStatus.PROCESSING}));

            const cachedData = ImageRepository.restoreFileCache(targetItem.id);

            if (preparedVideo) {
                QueueActions.commitVideoSwitch(preparedVideo, cachedData);
            } else {
                QueueActions.switchToNonVideo(targetItem, cachedData);
            }

            store.dispatch(updateQueueItem(targetItem.id, { status: QueueItemStatus.COMPLETED }));
            task.complete();
        } catch (error) {
            if (generation !== QueueActions.switchGeneration) return;
            store.dispatch(updateQueueItem(targetItem.id, {
                status: QueueItemStatus.ERROR,
                error: error instanceof Error ? error.message : '加载失败'
            }));
            task.fail(error);
        } finally {
            if (QueueActions.activeSwitch?.generation === generation) {
                QueueActions.activeSwitch = undefined;
            }
        }
    }
}
