import { store } from '../index';
import { LocalStorageManager, ProjectSettings } from '../utils/LocalStorageManager';
import {
    IndexedDBManager,
    StoredExtractionMetadata,
    StoredImageData,
    StoredProjectData,
    StoredQueueAnnotationFrame,
    StoredQueueAnnotationSnapshot,
    StoredVideoPlaybackMode,
    StoredVideoRecoveryData,
} from '../utils/IndexedDBManager';
import { AIStateStorageManager } from '../utils/AIStateStorageManager';
import {ImageRepository} from '../logic/imageRepository/ImageRepository';
import { TaskTracker } from './TaskTracker';
import { TaskType } from '../store/tasks/types';
import { LanguageConfig } from '../data/LanguageConfig';
import {QueueItem, QueueItemType} from '../store/queue/types';
import {ImageData} from '../store/labels/types';

const MAX_RECOVERY_BYTES = 500 * 1024 * 1024;

type PersistableValue = null | boolean | number | string | PersistableValue[] | {
    [key: string]: PersistableValue;
};

interface FramePersistenceDecision {
    image: ImageData;
    frameIndex: number;
    persistBytes: boolean;
    allowPlaceholder: boolean;
}

const fileDescriptor = (file: File | null | undefined): PersistableValue => file ? {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
} : null;

const canonicalize = (value: any): PersistableValue => {
    if (value === null) return null;
    if (value === undefined) return '__undefined__';
    if (typeof File !== 'undefined' && value instanceof File) return fileDescriptor(value);
    if (value instanceof Map) {
        return Array.from(value.entries())
            .sort(([left], [right]) => String(left).localeCompare(String(right)))
            .map(([key, entry]) => [canonicalize(key), canonicalize(entry)]);
    }
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value === 'number') {
        if (Number.isNaN(value)) return '__NaN__';
        if (!Number.isFinite(value)) return value > 0 ? '__Infinity__' : '__-Infinity__';
        return value;
    }
    if (typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce<Record<string, PersistableValue>>((result, key) => {
                result[key] = canonicalize(value[key]);
                return result;
            }, {});
    }
    return String(value);
};

const normalizeQueueItem = (item: QueueItem): Record<string, any> => {
    const {
        file,
        files,
        extractedFrames,
        // Runtime backend leases are intentionally not durable.
        videoSessionId: _videoSessionId,
        ...metadata
    } = item;
    return {
        ...metadata,
        file: fileDescriptor(file),
        files: files?.map(fileDescriptor),
        extractedFrames: extractedFrames?.map(fileDescriptor),
    };
};

const annotationFrameFor = (
    image: ImageData,
    frameIndex: number,
): StoredQueueAnnotationFrame => ({
    id: image.id,
    frameIndex,
    fileName: image.fileData?.name || `frame-${frameIndex}`,
    fileType: image.fileData?.type || '',
    loadStatus: image.loadStatus,
    labelRects: image.labelRects || [],
    labelPoints: image.labelPoints || [],
    labelLines: image.labelLines || [],
    labelPolygons: image.labelPolygons || [],
    labelNameIds: image.labelNameIds || [],
});

const queueAnnotationSnapshotsFor = (state: any): StoredQueueAnnotationSnapshot[] => {
    const activeQueueItemId = state.queue?.activeQueueItemId || null;
    return (state.queue?.items || []).flatMap((item: QueueItem) => {
        const images = item.id === activeQueueItemId
            ? state.labels?.imagesData || []
            : ImageRepository.getFileCacheSnapshot(item.id);
        if (!images) return [];
        return [{
            queueItemId: item.id,
            frames: images.map(annotationFrameFor),
        }];
    });
};

const activeVideoQueueItemFor = (state: any, activeVideo: any): QueueItem | undefined => {
    const queueItems: QueueItem[] = state.queue?.items || [];
    const activeQueueItem = queueItems.find(
        item => item.id === state.queue?.activeQueueItemId,
    );
    if (activeQueueItem?.type === QueueItemType.VIDEO) return activeQueueItem;
    return queueItems.find(
        item => item.type === QueueItemType.VIDEO && item.id === activeVideo?.id,
    );
};

/** Exact signature of every state field written by AutoSaveService. */
export const buildPersistenceSignature = (state: any): string => {
    const activeVideo = state.video?.activeVideo;
    const activeVideoQueueItem = activeVideoQueueItemFor(state, activeVideo);
    const signatureState = {
        settings: {
            language: state.general?.language,
            projectData: state.general?.projectData,
            zoom: state.general?.zoom,
            imageDragMode: state.general?.imageDragMode,
            smartAnnotationActive: state.general?.smartAnnotationActive,
            currentImageIndex: state.labels?.activeImageIndex,
            activeLabelType: state.labels?.activeLabelType,
        },
        labels: state.labels?.labels || [],
        images: (state.labels?.imagesData || []).map((image: ImageData, frameIndex: number) => ({
            frameIndex,
            id: image.id,
            file: fileDescriptor(image.fileData),
            labelRects: image.labelRects || [],
            labelPoints: image.labelPoints || [],
            labelLines: image.labelLines || [],
            labelPolygons: image.labelPolygons || [],
            labelNameIds: image.labelNameIds || [],
        })),
        video: {
            isVideoMode: state.video?.isVideoMode || false,
            activeVideoIndex: state.video?.activeVideoIndex,
            activeVideo: activeVideo ? {
                id: activeVideo.id,
                sourceFile: fileDescriptor(activeVideo.fileData),
                loadStatus: activeVideo.loadStatus,
                duration: activeVideo.duration,
                fps: activeVideo.fps,
                totalFrames: activeVideo.totalFrames,
                videoSize: activeVideo.videoSize,
                sessionBacked: Boolean(activeVideo.sessionId),
                fallbackSessionId: activeVideoQueueItem?.videoSessionId || activeVideo.sessionId,
                preExtractedFrames: activeVideo.preExtractedFrames?.map(fileDescriptor),
            } : null,
        },
        queue: {
            activeQueueItemId: state.queue?.activeQueueItemId || null,
            items: (state.queue?.items || []).map(normalizeQueueItem),
            annotationSnapshots: queueAnnotationSnapshotsFor(state),
        },
        ai: {
            segmentationResults: state.ai?.segmentationResults || [],
            imageSegmentationResults: state.ai?.imageSegmentationResults || new Map(),
            imageAIStates: state.ai?.imageAIStates || new Map(),
        },
    };
    return JSON.stringify(canonicalize(signatureState));
};

const extractionMetadataFor = (activeVideo: any): StoredExtractionMetadata => ({
    fps: activeVideo?.fps || 0,
    duration: activeVideo?.duration || 0,
    totalFrames: activeVideo?.totalFrames || 0,
    width: activeVideo?.videoSize?.width || 0,
    height: activeVideo?.videoSize?.height || 0,
});

const playbackModeFor = (activeVideo: any): StoredVideoPlaybackMode => {
    if (activeVideo?.preExtractedFrames) return 'pre-extracted';
    if (activeVideo?.sessionId) return 'on-demand';
    return 'raw';
};

const sameFile = (left: File | null | undefined, right: File | null | undefined): boolean =>
    left === right || Boolean(left && right &&
        left.name === right.name &&
        left.size === right.size &&
        left.type === right.type &&
        left.lastModified === right.lastModified);

export class AutoSaveService {
    private static saveTimer: NodeJS.Timeout | null = null;
    private static readonly SAVE_INTERVAL = 180000;
    private static readonly EDIT_DEBOUNCE_MS = 3000;
    private static editDebounceTimer: NodeJS.Timeout | null = null;
    private static unsubscribeStore: (() => void) | null = null;
    private static visibilityListener: (() => void) | null = null;
    private static isInitialized = false;
    private static initializationPromise: Promise<void> | null = null;
    private static lastSavedSignature = '';
    private static inFlightSave: Promise<void> | null = null;
    private static pendingSave = false;
    private static pendingForce = false;
    private static suspendDepth = 0;
    public static onSaveComplete: (() => void) | null = null;

    public static async initialize(): Promise<void> {
        if (this.isInitialized) return;
        if (this.initializationPromise) return this.initializationPromise;
        this.initializationPromise = this.initializeOnce().finally(() => {
            this.initializationPromise = null;
        });
        return this.initializationPromise;
    }

    private static async initializeOnce(): Promise<void> {
        this.stopAutoSave();
        const dbInitialized = await IndexedDBManager.initialize();
        if (!dbInitialized) {
            console.warn('IndexedDB暂不可用；关闭旧标签页后，后续自动保存将重试');
        }

        this.startAutoSave();
        this.unsubscribeStore = store.subscribe(() => {
            if (this.editDebounceTimer) clearTimeout(this.editDebounceTimer);
            this.editDebounceTimer = setTimeout(() => {
                if (typeof document !== 'undefined' && document.hidden) return;
                void this.saveCurrentState();
            }, this.EDIT_DEBOUNCE_MS);
        });
        this.visibilityListener = () => {
            if (typeof document !== 'undefined' && document.hidden) {
                void this.saveCurrentState();
            }
        };
        document.addEventListener('visibilitychange', this.visibilityListener);
        window.addEventListener('beforeunload', this.saveBeforeUnload);
        this.isInitialized = true;
    }

    public static startAutoSave(): void {
        if (this.saveTimer) clearInterval(this.saveTimer);
        this.saveTimer = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            void this.saveCurrentState();
        }, this.SAVE_INTERVAL);
    }

    public static stopAutoSave(): void {
        if (!this.saveTimer) return;
        clearInterval(this.saveTimer);
        this.saveTimer = null;
    }

    public static queueSignature(items: QueueItem[]): string {
        return JSON.stringify(canonicalize(items.map(normalizeQueueItem)));
    }

    public static suspend(): void {
        // Idempotent because React StrictMode may run the App bootstrap effect
        // twice; one matching resume must still make the writer ready.
        this.suspendDepth = 1;
        // A queued save represents pre-restore state. Never carry it across a
        // restore/clear boundary; the caller may explicitly force-save later.
        this.pendingSave = false;
        this.pendingForce = false;
    }

    public static resume(): void {
        this.suspendDepth = 0;
        if (this.suspendDepth === 0 && this.pendingSave) {
            void this.startSaveLoop();
        }
    }

    public static async drain(): Promise<void> {
        while (this.inFlightSave) {
            await this.inFlightSave;
        }
    }

    public static saveCurrentState(force: boolean = false): Promise<void> {
        if (this.suspendDepth > 0) return Promise.resolve();
        this.pendingSave = true;
        this.pendingForce = this.pendingForce || force;
        return this.startSaveLoop();
    }

    private static startSaveLoop(): Promise<void> {
        if (this.inFlightSave) return this.inFlightSave;
        const loop = this.runSaveLoop();
        this.inFlightSave = loop.then(async () => {
            this.inFlightSave = null;
            if (this.pendingSave && this.suspendDepth === 0) {
                await this.startSaveLoop();
            }
        });
        return this.inFlightSave;
    }

    private static async runSaveLoop(): Promise<void> {
        while (this.pendingSave && this.suspendDepth === 0) {
            const force = this.pendingForce;
            this.pendingSave = false;
            this.pendingForce = false;
            await this.performSave(force);
        }
    }

    private static async performSave(force: boolean): Promise<void> {
        const signature = buildPersistenceSignature(store.getState());
        if (!force && signature === this.lastSavedSignature && this.lastSavedSignature !== '') return;

        const stateAtStart = store.getState();
        const texts = LanguageConfig[stateAtStart.general.language].taskManager;
        const task = TaskTracker.startTask({
            type: TaskType.AUTO_SAVE,
            priority: 'P0',
            title: texts.types.autoSave,
            cancellable: false,
            autoRemoveAfterMs: 0,
        });

        try {
            const saved = await this.saveProjectData();
            if (!saved) {
                task.fail(new Error('Recovery snapshot was not committed'));
                return;
            }
            // The lightweight timestamps are only evidence of a durable recovery
            // point after the IndexedDB transaction has committed.
            await this.saveSettings();
            await this.saveAIState();
            this.lastSavedSignature = signature;
            this.onSaveComplete?.();
            task.complete();
        } catch (error) {
            console.error('保存当前状态失败:', error);
            task.fail(error);
        } finally {
            // A mutation that landed during serialization must receive a newer,
            // ordered commit even if its debounce has not fired yet.
            if (buildPersistenceSignature(store.getState()) !== signature) {
                this.pendingSave = true;
            }
        }
    }

    private static async saveSettings(): Promise<void> {
        const state = store.getState();
        const settings: Partial<ProjectSettings> = {
            language: state.general.language,
            projectName: state.general.projectData.name,
            zoom: state.general.zoom,
            imageDragMode: state.general.imageDragMode,
            smartAnnotationActive: state.general.smartAnnotationActive,
            currentImageIndex: state.labels.activeImageIndex,
            activeLabelType: state.labels.activeLabelType,
        };
        LocalStorageManager.saveSettings(settings);
    }

    private static async saveAIState(): Promise<void> {
        AIStateStorageManager.saveImageAIStates(store.getState().ai.imageAIStates);
    }

    private static videoRecoveryFor(state: any): StoredVideoRecoveryData | undefined {
        const activeVideo = state.video?.isVideoMode ? state.video.activeVideo : null;
        if (!activeVideo) return undefined;
        const activeQueueItem = activeVideoQueueItemFor(state, activeVideo);
        const sourceFile = activeQueueItem?.file?.size > 0
            ? activeQueueItem.file
            : activeVideo.fileData;
        return {
            mode: playbackModeFor(activeVideo),
            sourceQueueItemId: activeQueueItem?.id || null,
            // Store the source once regardless of size. If quota cannot hold it,
            // IndexedDB aborts atomically and the previous snapshot survives.
            sourceFile: sourceFile?.size > 0 ? sourceFile : undefined,
            sessionId: activeQueueItem?.videoSessionId || activeVideo.sessionId,
            metadata: extractionMetadataFor(activeVideo),
        };
    }

    private static queueItemsForStorage(
        queueItems: QueueItem[],
        videoRecovery: StoredVideoRecoveryData | undefined,
    ): QueueItem[] {
        return queueItems.map(item => {
            const runtimeItem = item as QueueItem & {videoSessionId?: string};
            const {
                videoSessionId: _videoSessionId,
                ...durableItem
            } = runtimeItem;
            if (item.id !== videoRecovery?.sourceQueueItemId) return durableItem as QueueItem;
            return {
                ...durableItem,
                file: undefined,
                extractedFrames: undefined,
            } as QueueItem;
        });
    }

    private static frameDecisions(
        images: ImageData[],
        videoRecovery: StoredVideoRecoveryData | undefined,
        queueItems: QueueItem[],
    ): FramePersistenceDecision[] {
        const sourceQueueItem = queueItems.find(
            item => item.id === videoRecovery?.sourceQueueItemId,
        );
        const allowPlaceholder = Boolean(
            (videoRecovery?.sourceFile && videoRecovery.sourceFile.size > 0) ||
            sourceQueueItem?.datasetId,
        );
        // This cap applies only to optional, reconstructable frame caches. The
        // original video source is a separate durable recovery dependency.
        let remainingBytes = MAX_RECOVERY_BYTES;
        return images.map((image, frameIndex) => {
            const isVideoSource = sameFile(image.fileData, videoRecovery?.sourceFile);
            const fitsRecoveryBudget = !isVideoSource && image.fileData.size <= remainingBytes;
            // Non-video and non-reconstructable video bytes must never be silently
            // truncated. Let IndexedDB reject the transaction and keep the previous
            // committed snapshot if quota is insufficient.
            const persistBytes = image.fileData.size > 0 &&
                (!allowPlaceholder || fitsRecoveryBudget);
            if (allowPlaceholder && persistBytes) remainingBytes -= image.fileData.size;
            return {image, frameIndex, persistBytes, allowPlaceholder};
        });
    }

    private static async storedImageFor(
        decision: FramePersistenceDecision,
    ): Promise<StoredImageData> {
        const {image, frameIndex} = decision;
        let fileData = new ArrayBuffer(0);
        let isPlaceholder = true;
        if (decision.persistBytes) {
            try {
                fileData = await image.fileData.arrayBuffer();
                isPlaceholder = fileData.byteLength === 0;
            } catch (error) {
                if (!decision.allowPlaceholder) throw error;
                fileData = new ArrayBuffer(0);
            }
        }
        return {
            id: image.id,
            frameIndex,
            isPlaceholder,
            fileName: image.fileData.name,
            fileData,
            fileType: image.fileData.type,
            loadStatus: image.loadStatus,
            labelRects: image.labelRects || [],
            labelPoints: image.labelPoints || [],
            labelLines: image.labelLines || [],
            labelPolygons: image.labelPolygons || [],
            labelNameIds: image.labelNameIds || [],
        };
    }

    private static async saveProjectData(): Promise<boolean> {
        const state = store.getState();
        const imagesData = state.labels.imagesData;
        const queueItems = state.queue?.items || [];
        const activeQueueItemId = state.queue?.activeQueueItemId || null;
        const videoRecovery = this.videoRecoveryFor(state);

        // Preserve annotations and frame topology even when pixels are only a
        // runtime/backend cache. A zero-byte frame is a record, not an empty project.
        const decisions = this.frameDecisions(imagesData, videoRecovery, queueItems);
        const storedImages = await Promise.all(
            decisions.map(decision => this.storedImageFor(decision)),
        );

        const imageSegmentationResults: Record<string, any[]> = {};
        state.ai?.imageSegmentationResults?.forEach((results: any[], imageId: string) => {
            imageSegmentationResults[imageId] = results;
        });

        const activeVideo = state.video?.isVideoMode ? state.video.activeVideo : null;
        const projectData: StoredProjectData = {
            id: 'current-project',
            images: storedImages,
            labelNames: state.labels.labels || [],
            currentImageIndex: state.labels.activeImageIndex,
            lastModified: Date.now(),
            version: '3.0.0-recovery',
            segmentationResults: state.ai?.segmentationResults || [],
            imageSegmentationResults,
            isVideoProject: Boolean(activeVideo),
            extractionMetadata: activeVideo ? extractionMetadataFor(activeVideo) : undefined,
            videoRecovery,
            queueItems: this.queueItemsForStorage(queueItems, videoRecovery),
            queueAnnotationSnapshots: queueAnnotationSnapshotsFor(state),
            activeQueueItemId,
        };

        return IndexedDBManager.saveProject(projectData);
    }

    private static saveBeforeUnload = (): void => {
        // Best effort only. Never advance LocalStorage's lastSaved marker until
        // the matching IndexedDB snapshot has actually committed.
        void this.saveCurrentState();
    };

    public static destroy(): void {
        this.stopAutoSave();
        if (this.editDebounceTimer) {
            clearTimeout(this.editDebounceTimer);
            this.editDebounceTimer = null;
        }
        this.unsubscribeStore?.();
        this.unsubscribeStore = null;
        if (this.visibilityListener) {
            document.removeEventListener('visibilitychange', this.visibilityListener);
            this.visibilityListener = null;
        }
        window.removeEventListener('beforeunload', this.saveBeforeUnload);
        this.pendingSave = false;
        this.pendingForce = false;
        this.suspendDepth = 0;
        this.initializationPromise = null;
        this.isInitialized = false;
    }
}
