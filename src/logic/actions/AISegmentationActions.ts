import {store} from "../../index";
import {SegmentationAPIDetector, SegmentationResult} from "../../ai/SegmentationAPIDetector";
import {ImageData, LabelName, LabelPolygon} from "../../store/labels/types";
import {LabelStatus} from "../../data/enums/LabelStatus";
import {v4 as uuidv4} from "uuid";
import {updateImageDataById, updateLabelNames, updateActiveLabelType, updateActiveLabelViewType} from "../../store/labels/actionCreators";
import {LabelType} from "../../data/enums/LabelType";
import {updateFullImageInferenceStatus, addInferenceHistory, updateSegmentationResults} from "../../store/ai/actionCreators";
import {submitNewNotification, deleteNotificationById, updateNotificationById} from "../../store/notifications/actionCreators";
import {updatePerClassColorationStatus} from "../../store/general/actionCreators";
import {NotificationUtil} from "../../utils/NotificationUtil";
import {LabelUtil} from "../../utils/LabelUtil";
import {LanguageConfig} from "../../data/LanguageConfig";
import {FrameExtractorService} from "../../services/FrameExtractorService";
import {EditorActions} from "./EditorActions";
import {EditorModel} from "../../staticModels/EditorModel";
import {TaskTracker} from "../../services/TaskTracker";
import {TaskType} from "../../store/tasks/types";

/**
 * 按视频分辨率压缩前端 in-flight 并发数。后端 SAM 是单 GPU 串行(torch.inference_mode),
 * 提高并发并不会让推理更快,只会让前端同时持有更多 blob/Image,放大内存峰值。
 * 1440p/4K 视频上,并发 4 会让前端额外吃 4 张 ~14MB+ 的 RGBA bitmap → 易触发 OOM 崩溃。
 */
function computeBatchConcurrency(width: number, height: number): number {
    const pixels = (width || 0) * (height || 0);
    if (pixels >= 2560 * 1440) return 1; // 1440p 及以上
    if (pixels >= 1920 * 1080) return 2; // 1080p
    return 4;                            // 720p 及以下保持原行为
}

export class AISegmentationActions {

    /** 自动模式 UX 提示：每会话首次进入 segmentBatch 时弹一次，告诉用户 ~20s/图 是正常的 */
    private static automaticModeHintShown = false;

    private static yieldToUI(): Promise<void> {
        return new Promise(r => setTimeout(r, 0));
    }

    private static isCancelled(): boolean {
        return !store.getState().ai.isFullImageInferenceInProgress;
    }

    private static async withConcurrency<T>(
        tasks: Array<() => Promise<T>>,
        limit: number,
        onProgress?: (done: number, total: number) => void
    ): Promise<Array<T | null>> {
        const results: Array<T | null> = new Array(tasks.length).fill(null);
        let nextIdx = 0;
        let done = 0;

        const worker = async () => {
            while (nextIdx < tasks.length) {
                if (this.isCancelled()) return;
                const i = nextIdx++;
                try {
                    results[i] = await tasks[i]();
                } catch {
                    results[i] = null;
                }
                done++;
                onProgress?.(done, tasks.length);
            }
        };

        await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
        return results;
    }

    /**
     * 批量分割 — 和 AIDetectionActions.detectBatch 完全并行的流程，
     * 只是 API 调用走 /segment、结果写入 labelPolygons 而非 labelRects。
     *
     * @param isBatch true = 批量模式,跳过已有 AI 多边形的图像(避免重复推理);
     *                false = 单图模式,允许对已推理过的图像重复推理。
     */
    public static async segmentBatch(imagesToSegment: ImageData[], isBatch: boolean = true): Promise<void> {
        if (!SegmentationAPIDetector.isEnabled() || imagesToSegment.length === 0) return;

        // SAM 自动模式（无 prompt）每图 ~20s 是 grid sampling 的算法特性，不是卡死。
        // 首次告知用户预期，之后不再打扰。
        if (!AISegmentationActions.automaticModeHintShown) {
            AISegmentationActions.automaticModeHintShown = true;
            const lang = store.getState().general.language;
            const { ActiveModel, formatModelDisplay } = await import('../../ai/ActiveModel');
            const display = formatModelDisplay(ActiveModel.getSegmentation());
            const hint = lang === 'zh'
                ? { header: `${display} 自动模式`, description: '无 prompt 时每张图约 20 秒（grid sampling）。如需更快，先画 bbox 或点作为提示。' }
                : { header: `${display} automatic mode`, description: '~20s per image without prompt (grid sampling). Draw a bbox or points first for instant results.' };
            store.dispatch(submitNewNotification(NotificationUtil.createMessageNotification(hint)));
        }

        const startTime = Date.now();
        const t = () => LanguageConfig[store.getState().general.language]; // 实时读语言
        const total = imagesToSegment.length;
        let totalObjects = 0;
        let successCount = 0;
        let failCount = 0;

        console.log('[BatchSegment] Starting', { total });

        store.dispatch(updateFullImageInferenceStatus(true));
        const progressNotification = NotificationUtil.createInferenceProgressNotification();
        store.dispatch(submitNewNotification(progressNotification));

        // P1 Task Manager 行：可取消，onCancel 走现有 isCancelled() 路径。
        const tmTexts = LanguageConfig[store.getState().general.language].taskManager;
        const task = TaskTracker.startTask({
            type: TaskType.BATCH_SEGMENT,
            priority: 'P1',
            title: tmTexts.types.batchSegment,
            cancellable: true,
            onCancel: () => store.dispatch(updateFullImageInferenceStatus(false)),
        });

        const videoState = store.getState().video;
        const isVideo = videoState.isVideoMode;
        const allImagesData: ImageData[] = store.getState().labels.imagesData;
        const activeVideo = isVideo ? videoState.activeVideo : null;
        const fps = activeVideo?.fps || 30;

        // 通知辅助（节流 150ms）
        let lastNotifyTime = 0;
        const notify = (step: number, stepDesc: string, detail: string, force = false) => {
            const now = Date.now();
            if (!force && now - lastNotifyTime < 150) return;
            lastNotifyTime = now;
            store.dispatch(updateNotificationById(progressNotification.id, {
                ...progressNotification,
                currentStep: step,
                stepDescription: stepDesc,
                description: detail
            }));
            const m = /^(\d+)%/.exec(detail);
            const pct = m ? parseInt(m[1], 10) : undefined;
            task.update(pct, stepDesc);
        };

        const preFrames = activeVideo?.preExtractedFrames;
        const sessionId = activeVideo?.sessionId || EditorModel.videoSessionId;

        if (isVideo && (preFrames || sessionId || EditorModel.videoElement)) {
            // ======== Video mode: 帧捕获 + 分割 ========
            // 批量模式跳过已有 AI 多边形的帧；单图模式允许重复推理
            const selectedIds = new Set(imagesToSegment.map(img => img.id));
            const frameQueue: { frameIdx: number; imageData: ImageData }[] = [];
            for (let frameIdx = 0; frameIdx < allImagesData.length; frameIdx++) {
                const img = allImagesData[frameIdx];
                if (!selectedIds.has(img.id)) continue;
                if (isBatch && img.labelPolygons.some(p => p.isCreatedByAI)) continue;
                frameQueue.push({ frameIdx, imageData: img });
            }
            successCount = total - frameQueue.length;

            const captureTotal = frameQueue.length;
            console.log('[BatchSegment] Frame queue:', { captureTotal });

            if (captureTotal === 0) {
                store.dispatch(deleteNotificationById(progressNotification.id));
                store.dispatch(updateFullImageInferenceStatus(false));
                task.complete();
                return;
            }

            let capturedBlobs: Array<Blob | null>;

            if (preFrames) {
                // fast_ffmpeg_mode (full-load)
                capturedBlobs = frameQueue.map(({ frameIdx }) =>
                    frameIdx < preFrames.length ? (preFrames[frameIdx] as Blob) : null
                );
            } else if (sessionId) {
                // fast_ffmpeg_mode (on-demand): 按真实帧索引逐帧取帧
                // 注意：必须用 frameQueue[i].frameIdx（视频中的真实位置），
                // 而不是循环变量 i（frameQueue 的下标）——跳帧推理时两者不同！
                capturedBlobs = new Array(captureTotal).fill(null);
                for (let i = 0; i < captureTotal; i++) {
                    if (this.isCancelled()) { console.log('[Segment/Capture] 用户取消,中止按需取帧'); break; }
                    const { frameIdx } = frameQueue[i];
                    const pct = Math.round((i / captureTotal) * 33);
                    notify(1,
                        `${t().aiInference.steps.captureFrame} (${i + 1}/${captureTotal})`,
                        `${pct}% — frame ${frameIdx}`
                    );
                    try {
                        const [frame] = await FrameExtractorService.fetchFrameRange(sessionId, frameIdx, 1);
                        capturedBlobs[i] = frame as Blob;
                    } catch (err) {
                        console.warn(`[Segment/Capture] fetch frame ${frameIdx} failed:`, err);
                    }
                    if (i % 10 === 0 && i > 0) await this.yieldToUI();
                }
            } else {
                // raw_browser_mode: not implemented for segmentation (fallback)
                console.warn('[BatchSegment] raw_browser_mode not supported for segmentation');
                capturedBlobs = [];
            }

            // === 流式分割推理：4路并发 ===
            const inferStartTime = Date.now();
            console.log('[Segment] Streaming start', { captureTotal, concurrency: 4 });

            // 批量推理前统一设置标签视图（避免对每帧 dispatch 一次）
            store.dispatch(updateActiveLabelViewType(LabelType.POLYGON));
            if (!store.getState().general.smartAnnotationActive && !store.getState().general.eraserMode) {
                store.dispatch(updateActiveLabelType(LabelType.POLYGON));
            }

            const tasks = capturedBlobs.map((blob, i) => {
                return async (): Promise<SegmentationResult[] | null> => {
                    if (!blob) {
                        failCount++;
                        store.dispatch(addInferenceHistory(frameQueue[i].imageData.id, 0, false, 'segmentation'));
                        return null;
                    }
                    try {
                        const results = await SegmentationAPIDetector.predictFromBlob(
                            blob, `frame_${frameQueue[i].frameIdx}.jpg`
                        );
                        this.applySingleResult(frameQueue[i].imageData, results);
                        totalObjects += results.length;
                        successCount++;
                        return results;
                    } catch (err) {
                        console.error(`[Segment] Frame ${frameQueue[i].frameIdx} FAILED:`, (err as Error).message);
                        failCount++;
                        store.dispatch(addInferenceHistory(frameQueue[i].imageData.id, 0, false, 'segmentation'));
                        return null;
                    }
                };
            });

            const videoSize = store.getState().video?.activeVideo?.videoSize;
            const concurrency = computeBatchConcurrency(videoSize?.width || 0, videoSize?.height || 0);
            console.log(`[Segment] concurrency=${concurrency} (videoSize=${videoSize?.width}x${videoSize?.height})`);
            await this.withConcurrency(tasks, concurrency, (done, ttl) => {
                const pct = preFrames ? Math.round((done / ttl) * 90) : 33 + Math.round((done / ttl) * 55);
                notify(2, `${t().aiInference.steps.inferring} (${done}/${ttl})`, `${pct}% — ${t().video.frame} ${frameQueue[Math.min(done - 1, ttl - 1)].frameIdx}`);
            });

            console.log('[Segment] Streaming complete', {
                success: successCount, failed: failCount, elapsed: ((Date.now() - inferStartTime) / 1000).toFixed(1) + 's'
            });

        } else {
            // ======== 普通图像模式：4路并发流式分割 ========
            // 批量模式跳过已推理过的图;单图模式允许重复推理
            const imageQueue = isBatch
                ? imagesToSegment.filter(img => !img.labelPolygons.some(p => p.isCreatedByAI))
                : imagesToSegment;
            successCount = total - imageQueue.length;

            // 批量推理前统一设置标签视图（避免对每帧 dispatch 一次）
            store.dispatch(updateActiveLabelViewType(LabelType.POLYGON));
            if (!store.getState().general.smartAnnotationActive && !store.getState().general.eraserMode) {
                store.dispatch(updateActiveLabelType(LabelType.POLYGON));
            }

            const imageTasks = imageQueue.map((imageData) => async (): Promise<SegmentationResult[] | null> => {
                try {
                    const blob = imageData.fileData;
                    const results = await SegmentationAPIDetector.predictFromBlob(blob, imageData.fileData?.name || 'image.jpg');
                    this.applySingleResult(imageData, results);
                    totalObjects += results.length;
                    successCount++;
                    return results;
                } catch (err) {
                    console.error(`[Segment] Image ${imageData.fileData?.name} FAILED:`, (err as Error).message);
                    failCount++;
                    store.dispatch(addInferenceHistory(imageData.id, 0, false, 'segmentation'));
                    return null;
                }
            });

            await this.withConcurrency(imageTasks, 4, (done, ttl) => {
                const pct = Math.round((done / ttl) * 100);
                notify(2, `${t().aiInference.steps.inferring} (${done}/${ttl})`, `${pct}% — ${imageQueue[done - 1]?.fileData?.name || `Image ${done}`}`);
            });
        }

        // ── 完成 / 取消 ──
        const wasCancelled = this.isCancelled();
        store.dispatch(deleteNotificationById(progressNotification.id));
        store.dispatch(updateFullImageInferenceStatus(false));
        const allFailed = !wasCancelled && failCount > 0 && successCount === 0;
        if (wasCancelled) {
            task.cancel();
        } else if (allFailed) {
            task.fail(new Error('Batch segmentation failed for every image'));
        } else {
            task.complete();
        }

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log('[BatchSegment] Complete', { totalTime: totalTime + 's', successCount, failCount, totalObjects });

        const doneTexts = t();
        const completionNotification = allFailed
            ? NotificationUtil.createErrorNotification(doneTexts.notifications.modelInferenceError)
            : NotificationUtil.createSuccessNotification({
                header: doneTexts.notifications.batchDetectionCompleted,
                description: doneTexts.notifications.batchDetectionCompletedMessage
                    .replace('{total}', String(successCount))
                    .replace('{count}', String(totalObjects))
                    .replace('{time}', totalTime)
            });
        store.dispatch(submitNewNotification(completionNotification));

        if (!store.getState().general.enablePerClassColoration) {
            store.dispatch(updatePerClassColorationStatus(true));
        }

        if (successCount > 2) {
            EditorModel.lastBatchInferenceImageCount = successCount;
            window.dispatchEvent(new CustomEvent('batchInferenceComplete', { detail: { count: successCount } }));
        }

        EditorActions.fullRender();
    }

    /**
     * 单帧分割结果写入 Redux
     * @param source 'batch' = 全图分割（写推理历史 + 推理结果面板）
     *               'smart' = 智能标注（只追加多边形，不写历史/结果面板）
     */
    public static applySingleResult(
        imageData: ImageData,
        results: SegmentationResult[],
        source: 'batch' | 'smart' | 'tracking' = 'batch',
        trackingGroupId?: string,
    ): void {
        if (!results || results.length === 0) return;

        // 创建缺失标签
        const allClassNames = new Set(results.map(r => r.info.name));
        const existingLabels: LabelName[] = store.getState().labels.labels;
        const missingNames = [...allClassNames].filter(
            name => !existingLabels.some(e => e.name.toLowerCase() === name.toLowerCase())
        );
        if (missingNames.length > 0) {
            const newLabels = missingNames.map(name => LabelUtil.createLabelName(name));
            store.dispatch(updateLabelNames([...existingLabels, ...newLabels]));
        }

        const updatedLabels: LabelName[] = store.getState().labels.labels;
        const currentImagesData: ImageData[] = store.getState().labels.imagesData;
        const currentImg = currentImagesData.find(img => img.id === imageData.id);
        if (!currentImg) return;

        // mask → LabelPolygon
        // isFinite 过滤后 vertices 可能 < 3（NaN/Infinity 被剔），下游 DrawUtil.drawPolygonWithFill
        // 会反复抛 "无效的 anchors 数据"——所以 map 里直接 return null + filter 掉。
        const newPolygons: LabelPolygon[] = results
            .filter(result => result.mask && result.mask.length >= 3)
            .map(result => {
                const vertices = result.mask
                    .filter(([x, y]) => isFinite(x) && isFinite(y))
                    .map(([x, y]) => ({ x, y }));
                if (vertices.length < 3) return null;

                const matchingLabel = updatedLabels.find(l =>
                    l.name.toLowerCase() === result.info.name.toLowerCase()
                );
                const labelId = matchingLabel?.id || null;

                return {
                    id: uuidv4(),
                    labelId,
                    vertices,
                    isCreatedByAI: true,
                    isVisible: true,
                    status: LabelStatus.ACCEPTED,
                    suggestedLabel: labelId ? null : result.info.name,
                    confidence: result.info.confidence ?? 0,
                    trackingGroupId,
                    extra: result.extra,  // 透传自定义后处理脚本注入的字段（含 overlays）
                };
            })
            .filter((p): p is LabelPolygon => p !== null);

        if (newPolygons.length > 0) {
            const updatedImg = {
                ...currentImg,
                labelPolygons: [...currentImg.labelPolygons, ...newPolygons]
            };
            store.dispatch(updateImageDataById(imageData.id, updatedImg));
        }

        // 智能标注是一次性 prompt 推理，不该污染推理结果面板和历史
        if (source === 'batch') {
            const segResults = SegmentationAPIDetector.convertToUnifiedFormat(results);
            store.dispatch(updateSegmentationResults(segResults, imageData.id));
            store.dispatch(addInferenceHistory(imageData.id, results.length, true, 'segmentation'));
        }
        // 注：smart 路径不再需要手动设 segmentationLabelsVisible=true —— reducer lazy-init 默认就是 true

        // 仅当推理帧正是当前展示帧时才刷新，避免批量推理中对每帧都重绘
        const activeIdx = store.getState().labels.activeImageIndex;
        const activeImgId = store.getState().labels.imagesData[activeIdx]?.id;
        if (activeImgId === imageData.id) {
            EditorActions.fullRender();
        }
    }
}
