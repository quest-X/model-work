import {store} from "../../index";
import {DetectionAPIDetector, DetectionResult} from "../../ai/DetectionAPIDetector";
import {DetectSessionAPIService} from "../../ai/DetectSessionAPIService";
import {ImageData, LabelName, LabelRect} from "../../store/labels/types";
import {LabelStatus} from "../../data/enums/LabelStatus";
import {v4 as uuidv4} from "uuid";
import {updateImageData, updateLabelNames, updateActiveImageIndex, updateActiveLabelType, updateActiveLabelViewType} from "../../store/labels/actionCreators";
import {LabelType} from "../../data/enums/LabelType";
import {updateFullImageInferenceStatus, addInferenceHistory, toggleImageAILabelsVisibility, updateSegmentationResults} from "../../store/ai/actionCreators";
import {submitNewNotification, deleteNotificationById, updateNotificationById} from "../../store/notifications/actionCreators";
import {updatePerClassColorationStatus} from "../../store/general/actionCreators";
import {updateVideoCurrentFrame} from "../../store/video/actionCreators";
import {NotificationUtil} from "../../utils/NotificationUtil";
import {LabelUtil} from "../../utils/LabelUtil";
import {IRect} from "../../interfaces/IRect";
import {AISelector} from "../../store/selectors/AISelector";
import {LanguageConfig} from "../../data/LanguageConfig";
import {FrameExtractorService} from "../../services/FrameExtractorService";
import {EditorActions} from "./EditorActions";
import {EditorModel} from "../../staticModels/EditorModel";
import {TaskTracker} from "../../services/TaskTracker";
import {TaskType} from "../../store/tasks/types";

/**
 * 按视频分辨率压缩前端 in-flight 并发数。后端 YOLO 推理已是高效批处理,
 * 提高前端并发不会让后端更快(单 GPU 串行),只会让前端同时持有更多 blob/Image。
 * 1440p/4K 视频上,并发 4 会让前端额外吃 4 张 ~14MB+ 的 RGBA bitmap → 易触发 OOM 崩溃。
 */
function computeBatchConcurrency(width: number, height: number): number {
    const pixels = (width || 0) * (height || 0);
    if (pixels >= 2560 * 1440) return 1; // 1440p 及以上
    if (pixels >= 1920 * 1080) return 2; // 1080p
    return 4;                            // 720p 及以下保持原行为
}

// ── Dispatch coalescing ───────────────────────────────────────────────────
// Per-frame `updateImageDataById` during streaming inference mutates
// `imagesData` and re-runs every connected selector — a render storm at
// 200+ frames. Buffer pending image updates and flush as one
// `updateImageData(...)` per idle tick.
const pendingImageUpdates: Map<string, ImageData> = new Map();
let flushScheduled = false;
let flushIdleHandle: number | null = null;

type IdleDeadline = { didTimeout: boolean; timeRemaining: () => number; };
type RIC = (cb: (d: IdleDeadline) => void, opts?: { timeout?: number }) => number;
type CIC = (handle: number) => void;

const ric: RIC = (typeof (globalThis as any).requestIdleCallback === 'function')
    ? (globalThis as any).requestIdleCallback.bind(globalThis)
    : ((cb: (d: IdleDeadline) => void) => setTimeout(
        () => cb({ didTimeout: true, timeRemaining: () => 0 }), 16
    ) as unknown as number);

const cic: CIC = (typeof (globalThis as any).cancelIdleCallback === 'function')
    ? (globalThis as any).cancelIdleCallback.bind(globalThis)
    : ((h: number) => clearTimeout(h));

function flushPendingImageUpdates(): void {
    flushScheduled = false;
    flushIdleHandle = null;
    if (pendingImageUpdates.size === 0) return;

    const current: ImageData[] = [...store.getState().labels.imagesData];
    let modified = false;
    for (let i = 0; i < current.length; i++) {
        const next = pendingImageUpdates.get(current[i].id);
        if (next) {
            current[i] = next;
            modified = true;
        }
    }
    pendingImageUpdates.clear();
    if (modified) {
        store.dispatch(updateImageData(current));
        EditorModel.latestImagesData = current;
    }
}

function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    flushIdleHandle = ric(() => flushPendingImageUpdates(), { timeout: 50 });
}

function forceFlushPendingImageUpdates(): void {
    if (flushIdleHandle !== null) {
        cic(flushIdleHandle);
        flushIdleHandle = null;
    }
    flushScheduled = false;
    flushPendingImageUpdates();
}

export class AIDetectionActions {

    /** Flush hook for callers that finish a streaming batch. */
    public static flushPendingImageUpdates(): void {
        forceFlushPendingImageUpdates();
    }

    /**
     * 执行全图目标检测
     * @param imageData 当前图片数据
     */
    public static detectObjects(imageData: ImageData): void {
        // 检测功能独立运行，不受分割功能开关状态影响
        
        // 检查检测API是否可用
        if (!DetectionAPIDetector.isEnabled()) {
            return;
        }

        // 创建检测进度通知
        const progressNotification = NotificationUtil.createInferenceProgressNotification();
        store.dispatch(submitNewNotification(progressNotification));

        // 获取国际化文本
        const language = store.getState().general.language;
        const texts = LanguageConfig[language];

        // 更新进度：步骤1 - 预处理 (立即执行，无延迟)
        queueMicrotask(() => {
            const step1Notification = NotificationUtil.updateInferenceProgress(
                progressNotification, 
                1, 
                texts.aiInference.steps.preprocessing
            );
            store.dispatch(updateNotificationById(progressNotification.id, step1Notification));
        });

        // 更新进度：步骤2 - 检测过程
        const step2Notification = NotificationUtil.updateInferenceProgress(
            progressNotification, 
            2, 
            texts.notifications.detectionInProgress
        );
        store.dispatch(updateNotificationById(progressNotification.id, step2Notification));

        // 使用微任务调用检测API，避免阻塞UI
        queueMicrotask(() => {
            // 调用检测API
            DetectionAPIDetector.predict(
                imageData,
                // 成功回调
                (results: DetectionResult[]) => {
                    // 更新进度：步骤3 - 后处理
                    const step3Notification = NotificationUtil.updateInferenceProgress(
                        step2Notification, 
                        3, 
                        texts.aiInference.steps.postprocessing
                    );
                    store.dispatch(updateNotificationById(progressNotification.id, step3Notification));
                    // 检测完成，发现对象
                
                    // 将检测结果转换为可编辑的标注框
                    this.convertDetectionResultsToLabelRects(imageData, results);

                    // 将检测结果同步到推理结果视图（按图像ID存储）
                    const segResults = DetectionAPIDetector.convertToSegmentationFormat(results);
                    store.dispatch(updateSegmentationResults(segResults, imageData.id));
                    
                    // 批量更新通知，避免多次dispatch
                    queueMicrotask(() => {
                        // 完成检测进度，显示最终统计
                        const completedNotification = NotificationUtil.completeInferenceProgress(
                            step3Notification,
                            results.length
                        );
                        store.dispatch(updateNotificationById(progressNotification.id, completedNotification));
                        
                        // 延迟显示成功通知，但缩短时间
                        setTimeout(() => {
                            // 删除进度通知
                            store.dispatch(deleteNotificationById(progressNotification.id));
                            
                            const totalTime = ((Date.now() - progressNotification.startTime!) / 1000).toFixed(2);
                            
                            // 显示成功通知（重新读语言 — 推理期间用户可能切换了）
                            const langNow = store.getState().general.language;
                            const textsNow = LanguageConfig[langNow];
                            const successNotification = NotificationUtil.createSuccessNotification({
                                header: textsNow.notifications.detectionCompleted,
                                description: textsNow.notifications.detectionCompletedMessage
                                    .replace('{count}', String(results.length))
                                    .replace('{time}', totalTime)
                            });
                            successNotification.i18nHeader = 'notifications.detectionCompleted';
                            successNotification.i18nDescription = 'notifications.detectionCompletedMessage';
                            successNotification.i18nParams = { count: String(results.length), time: totalTime };
                            store.dispatch(submitNewNotification(successNotification));
                        }, 800); // 减少延迟时间
                    });

                    // 记录详细结果（性能优化：移除日志输出）
                    
                    // 重置检测状态
                    store.dispatch(updateFullImageInferenceStatus(false));

                    // 添加检测历史记录（会自动设置aiLabelsVisible为true）
                    store.dispatch(addInferenceHistory(imageData.id, results.length, true, 'detection'));

                    // 触发 canvas 重绘，显示检测结果
                    EditorActions.fullRender();
                },
                // 失败回调
                (error: Error) => {
                    // 目标检测失败
                    
                    // 删除进度通知
                    store.dispatch(deleteNotificationById(progressNotification.id));
                    
                    // 显示错误通知（重新读语言）
                    const langNow = store.getState().general.language;
                    const textsNow = LanguageConfig[langNow];
                    const errorNotification = NotificationUtil.createErrorNotification({
                        header: textsNow.notifications.detectionFailed,
                        description: error.message || textsNow.notifications.detectionFailedMessage
                    });
                    errorNotification.i18nHeader = 'notifications.detectionFailed';
                    store.dispatch(submitNewNotification(errorNotification));
                    
                    // 重置检测状态
                    store.dispatch(updateFullImageInferenceStatus(false));
                    
                    // 添加失败的检测历史记录
                    // 检测失败，添加失败记录
                    store.dispatch(addInferenceHistory(imageData.id, 0, false, 'detection'));
                }
            );
        }); // 移除不必要的延迟
    }

    /** 让出主线程给 UI 渲染 */
    private static yieldToUI(): Promise<void> {
        return new Promise(r => setTimeout(r, 0));
    }

    /**
     * 视频批量检测的流式路径：POST /detect-session/{sid}，后端拉帧 + 批量推理，
     * NDJSON 每帧回流。对比"逐帧下载 ZIP → 逐帧 POST /detect"的旧链路
     * （1440p 实测 ~0.8s/帧，大头在前端取帧往返），流式路径只剩后端推理耗时。
     *
     * frameQueue 按 frameIdx 升序；跳帧（部分帧已有 AI 框）切成连续区间逐段流。
     * @returns true = 流路径完成（或用户取消）；false = 流不可用（旧后端 / 会话
     *          失效），调用方应回退 blob 路径处理剩余帧。
     */
    private static async streamDetectViaSession(args: {
        sessionId: string;
        frameQueue: { frameIdx: number; imageData: ImageData }[];
        notify: (step: number, stepDesc: string, detail: string, force?: boolean) => void;
        t: () => typeof LanguageConfig[keyof typeof LanguageConfig];
        counters: { success: number; fail: number; objects: number };
    }): Promise<boolean> {
        const { sessionId, frameQueue, notify, t, counters } = args;
        if (frameQueue.length === 0) return true;

        const byIdx = new Map(frameQueue.map(q => [q.frameIdx, q.imageData]));
        // 连续 frameIdx 区间（[start, end) 半开）
        const runs: Array<[number, number]> = [];
        let runStart = frameQueue[0].frameIdx;
        let prev = runStart;
        for (let i = 1; i < frameQueue.length; i++) {
            const idx = frameQueue[i].frameIdx;
            if (idx === prev + 1) { prev = idx; continue; }
            runs.push([runStart, prev + 1]);
            runStart = idx;
            prev = idx;
        }
        runs.push([runStart, prev + 1]);

        const params = DetectionAPIDetector.buildParamsDict();
        const totalFrames = frameQueue.length;
        let done = 0;
        console.log('[BatchDetect] detect-session stream:', { runs: runs.length, totalFrames });

        for (const [start, end] of runs) {
            if (this.isCancelled()) return true;
            // eslint-disable-next-line no-await-in-loop -- 区间必须顺序流式消费
            const ok = await new Promise<boolean>((resolve) => {
                const controller = DetectSessionAPIService.streamDetectSession(
                    { sessionId, start, end, params },
                    {
                        onFrame: (f) => {
                            if (this.isCancelled()) {
                                controller.abort();
                                resolve(true);
                                return;
                            }
                            done++;
                            const img = byIdx.get(f.frame_idx);
                            if (!img) return;
                            if (f.error || !f.detections) {
                                counters.fail++;
                                store.dispatch(addInferenceHistory(img.id, 0, false, 'detection'));
                            } else {
                                this.applySingleResult(img, f.detections, f.frame_idx);
                                counters.objects += f.detections.length;
                                counters.success++;
                            }
                            const pct = Math.round((done / totalFrames) * 100);
                            notify(2, `${t().aiInference.steps.inferring} (${done}/${totalFrames})`,
                                `${pct}% — ${t().video.frame} ${f.frame_idx}`);
                        },
                        onDone: () => resolve(true),
                        onError: (err) => {
                            console.warn('[BatchDetect] detect-session stream failed:', err.message);
                            resolve(false);
                        },
                    },
                );
            });
            if (!ok) return false;
        }
        return true;
    }

    /** 用户是否已按下停止按钮(即把 isFullImageInferenceInProgress 翻成 false) */
    private static isCancelled(): boolean {
        return !store.getState().ai.isFullImageInferenceInProgress;
    }

    /**
     * 并发信号量：限制同时进行的 async 任务数。
     * 每次 dispatch 新任务前都检查取消标志,用户按停止后不再启动新任务。
     */
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
     * Batch detection -- sequential two-phase architecture (no race conditions)
     *
     * Video mode (both fast_ffmpeg_mode and raw_browser_mode):
     *   Phase 1: Sequential capture
     *     - fast_ffmpeg_mode (full-load): uses preExtractedFrames JPEGs directly as Blobs
     *     - fast_ffmpeg_mode (on-demand): fetches frame batches from backend via sessionId
     *     - raw_browser_mode fallback: seek + capture from <video> element one by one
     *   Phase 2: 4-way concurrent inference (withConcurrency, verified safe)
     *   Phase 3: Single Redux dispatch to batch-write all results
     *
     * Image mode:
     *   4-way concurrent inference -> batch write
     */
    public static async detectBatch(imagesToDetect: ImageData[], isBatch: boolean = true): Promise<void> {
        if (!DetectionAPIDetector.isEnabled() || imagesToDetect.length === 0) return;

        const startTime = Date.now();
        const t = () => LanguageConfig[store.getState().general.language]; // 实时读语言
        const total = imagesToDetect.length;
        let totalObjects = 0;
        let successCount = 0;
        let failCount = 0;

        console.log('[BatchDetect] Starting', { total });

        const progressNotification = NotificationUtil.createInferenceProgressNotification();
        store.dispatch(submitNewNotification(progressNotification));

        // P1 Task Manager 行：可取消，onCancel 走现有 isCancelled() 路径。
        const tmTexts = LanguageConfig[store.getState().general.language].taskManager;
        const task = TaskTracker.startTask({
            type: TaskType.BATCH_DETECT,
            priority: 'P1',
            title: tmTexts.types.batchDetect,
            cancellable: true,
            onCancel: () => store.dispatch(updateFullImageInferenceStatus(false)),
        });

        const videoState = store.getState().video;
        const isVideo = videoState.isVideoMode;
        const allImagesData: ImageData[] = store.getState().labels.imagesData;
        const activeVideo = isVideo ? videoState.activeVideo : null;
        const fps = activeVideo?.fps || (console.warn('[BatchDetect] fps 缺失，使用默认值 30'), 30);

        console.log('[BatchDetect] Mode:', isVideo
            ? `video/${activeVideo?.preExtractedFrames ? 'fast_ffmpeg_mode(full-load)' : (activeVideo?.sessionId || EditorModel.videoSessionId) ? 'fast_ffmpeg_mode(on-demand)' : 'raw_browser_mode'} (fps=${fps})`
            : 'image');

        // 通知辅助（节流 150ms）— 更新 stepDescription + currentStep
        // 同步喂 Task Manager：解析 detail 里的 "{pct}% — ..." 提取 pct，没有就传 undefined。
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

        // ======== Video mode (fast_ffmpeg_mode or raw_browser_mode) ========
        const preFrames = activeVideo?.preExtractedFrames;
        const sessionId = activeVideo?.sessionId || EditorModel.videoSessionId;

        if (isVideo && (preFrames || sessionId || EditorModel.videoElement)) {
            // Video mode: only detect selected frames (not all frames)
            // detectBatch 只在批量模式下被调用(单图走 detectObjects),所以直接跳过已推理帧
            const selectedIds = new Set(imagesToDetect.map(img => img.id));
            const frameQueue: { frameIdx: number; imageData: ImageData }[] = [];
            for (let frameIdx = 0; frameIdx < allImagesData.length; frameIdx++) {
                const img = allImagesData[frameIdx];
                if (!selectedIds.has(img.id)) continue;
                if (isBatch && img.labelRects.some((r: LabelRect) => r.isCreatedByAI)) continue;
                frameQueue.push({ frameIdx, imageData: img });
            }
            successCount = total - frameQueue.length;

            const captureTotal = frameQueue.length;
            console.log('[BatchDetect] Frame queue:', { captureTotal, skipped: total - captureTotal });

            if (captureTotal === 0) {
                store.dispatch(deleteNotificationById(progressNotification.id));
                store.dispatch(updateFullImageInferenceStatus(false));
                task.complete();
                return;
            }

            // ── 首选：后端 /detect-session 流式路径（帧不过前端，真批量推理）──
            // 失败（旧后端 404 / 会话失效）才回退到下面的取帧 + 逐帧推理链路。
            let pending = frameQueue;
            if (sessionId) {
                const counters = { success: successCount, fail: failCount, objects: totalObjects };
                const handled = await this.streamDetectViaSession({ sessionId, frameQueue, notify, t, counters });
                successCount = counters.success;
                failCount = counters.fail;
                totalObjects = counters.objects;
                if (handled) {
                    pending = [];
                } else {
                    console.warn('[BatchDetect] detect-session 流不可用，回退逐帧 blob 路径');
                    forceFlushPendingImageUpdates();
                    const latest = store.getState().labels.imagesData;
                    const doneIds = new Set(
                        latest.filter(im => im.labelRects.some((r: LabelRect) => r.isCreatedByAI)).map(im => im.id)
                    );
                    pending = frameQueue.filter(q => !doneIds.has(q.imageData.id));
                }
            }
            const pendingTotal = pending.length;

            let capturedBlobs: Array<Blob | null> = [];

            if (pendingTotal === 0) {
                // 流式路径已清空队列 — 跳过取帧与推理
            } else if (preFrames) {
                // === fast_ffmpeg_mode (full-load): use pre-extracted JPEG Files directly as Blobs ===
                console.log('[Capture] fast_ffmpeg_mode (full-load): using pre-extracted frames', { pendingTotal });
                notify(1, `Using pre-extracted frames (${pendingTotal})`, 'Skipping capture phase...', true);
                capturedBlobs = pending.map(({ frameIdx }) =>
                    frameIdx < preFrames.length ? (preFrames[frameIdx] as Blob) : null
                );
            } else if (sessionId) {
                // === fast_ffmpeg_mode (on-demand): 按真实帧索引逐帧取帧 ===
                // 注意：必须用 pending[i].frameIdx（视频中的真实位置），
                // 而不是循环变量 i（pending 的下标）——跳帧推理时两者不同！
                console.log('[Capture] fast_ffmpeg_mode (on-demand): fetching frames from backend', { pendingTotal, sessionId });
                capturedBlobs = new Array(pendingTotal).fill(null);
                for (let i = 0; i < pendingTotal; i++) {
                    if (this.isCancelled()) { console.log('[Capture] 用户取消,中止按需取帧'); break; }
                    const { frameIdx } = pending[i];
                    const pct = Math.round((i / pendingTotal) * 33);
                    notify(1,
                        `${t().aiInference.steps.captureFrame} (${i + 1}/${pendingTotal})`,
                        `${pct}% — frame ${frameIdx}`
                    );
                    try {
                        const [frame] = await FrameExtractorService.fetchFrameRange(sessionId, frameIdx, 1);
                        capturedBlobs[i] = frame as Blob;
                    } catch (err) {
                        console.warn(`[Capture] 按需获取帧 ${frameIdx} 失败:`, err);
                    }
                    if (i % 10 === 0 && i > 0) await this.yieldToUI();
                }
            } else {
                // === raw_browser_mode fallback: Phase 1 sequential seek+capture from <video> ===
                const video = EditorModel.videoElement!;
                const captureCanvas = document.createElement('canvas');
                captureCanvas.width = video.videoWidth;
                captureCanvas.height = video.videoHeight;
                const captureCtx = captureCanvas.getContext('2d')!;

                capturedBlobs = new Array(pendingTotal).fill(null);
                let captureSuccess = 0;
                let captureFail = 0;
                const captureStartTime = Date.now();

                console.log('[Capture] Phase 1 starting', {
                    pendingTotal,
                    videoSize: `${video.videoWidth}x${video.videoHeight}`,
                    readyState: video.readyState
                });

                for (let i = 0; i < pendingTotal; i++) {
                    if (this.isCancelled()) { console.log('[Capture] 用户取消,中止 raw_browser_mode 取帧'); break; }
                    const { frameIdx } = pending[i];
                    const targetTime = frameIdx / fps;

                    if (i % 5 === 0 || i === pendingTotal - 1) {
                        const pct = Math.round((i / pendingTotal) * 33);
                        notify(1, `${t().aiInference.steps.captureFrame} (${i + 1}/${pendingTotal})`, `${pct}% — ${t().video.frame} ${frameIdx}`);
                    }
                    if (i % 8 === 0 && i > 0) await this.yieldToUI();

                    let captured = false;
                    for (let attempt = 0; attempt < 4; attempt++) {
                        await this.seekVideoToTimeForCapture(video, targetTime);
                        try {
                            capturedBlobs[i] = await this.captureFrameToBlob(video, captureCtx, captureCanvas);
                            captured = true;
                            break;
                        } catch (err) {
                            console.warn(`[Capture] Frame ${frameIdx} attempt ${attempt + 1} failed: ${(err as Error).message}, readyState=${video.readyState}`);
                            if (attempt < 3) {
                                await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
                            }
                        }
                    }

                    if (captured) {
                        captureSuccess++;
                    } else {
                        captureFail++;
                        console.error(`[Capture] Frame ${frameIdx} FAILED after 3 attempts`);
                    }
                }

                captureCanvas.width = 0;
                captureCanvas.height = 0;

                const captureElapsed = ((Date.now() - captureStartTime) / 1000).toFixed(1);
                console.log('[Capture] Phase 1 complete', {
                    success: captureSuccess,
                    failed: captureFail,
                    total: pendingTotal,
                    elapsed: captureElapsed + 's'
                });
            }

            // === 流式推理：4路并发，每张完成立即写入 ===
            const inferStartTime = Date.now();
            console.log('[Inference] Streaming start', { pendingTotal, concurrency: 4 });

            // 批量推理前统一设置标签视图（避免对每帧 dispatch 一次）
            store.dispatch(updateActiveLabelViewType(LabelType.RECT));
            if (!store.getState().general.smartAnnotationActive && !store.getState().general.eraserMode) {
                store.dispatch(updateActiveLabelType(LabelType.RECT));
            }

            const tasks = capturedBlobs.map((blob, i) => {
                return async (): Promise<DetectionResult[] | null> => {
                    if (!blob) {
                        failCount++;
                        store.dispatch(addInferenceHistory(pending[i].imageData.id, 0, false, 'detection'));
                        return null;
                    }
                    try {
                        const results = await DetectionAPIDetector.predictFromBlob(
                            blob, `frame_${pending[i].frameIdx}.jpg`
                        );
                        // 立即写入 Redux
                        this.applySingleResult(pending[i].imageData, results, pending[i].frameIdx);
                        totalObjects += results.length;
                        successCount++;
                        return results;
                    } catch (err) {
                        console.error(`[Inference] Frame ${pending[i].frameIdx} FAILED:`, (err as Error).message);
                        failCount++;
                        store.dispatch(addInferenceHistory(pending[i].imageData.id, 0, false, 'detection'));
                        return null;
                    }
                };
            });

            const videoSize = store.getState().video?.activeVideo?.videoSize;
            const concurrency = computeBatchConcurrency(videoSize?.width || 0, videoSize?.height || 0);
            console.log(`[Inference] concurrency=${concurrency} (videoSize=${videoSize?.width}x${videoSize?.height})`);
            await this.withConcurrency(tasks, concurrency, (done, ttl) => {
                const pct = preFrames ? Math.round((done / ttl) * 90) : 33 + Math.round((done / ttl) * 55);
                notify(2, `${t().aiInference.steps.inferring} (${done}/${ttl})`, `${pct}% — ${t().video.frame} ${pending[Math.min(done - 1, ttl - 1)].frameIdx}`);
            });

            const inferElapsed = ((Date.now() - inferStartTime) / 1000).toFixed(1);
            console.log('[Inference] Streaming complete', {
                success: successCount, failed: failCount, elapsed: inferElapsed + 's'
            });

        } else {
            // ======== 普通图像模式：分块批量调 /batch_detect ========
            // v2.6.3 起从"4 路并发 × N 次 /detect"改为"分块 × /batch_detect"。后端
            // batch_detect 走真正的 batched forward pass，5 图实测 22% 提速 + 单次
            // HTTP 往返。BATCH_SIZE 取 8 平衡推理速率和单次 timeout 风险。
            const imageQueue = isBatch
                ? imagesToDetect.filter(img => !img.labelRects.some((r: LabelRect) => r.isCreatedByAI))
                : imagesToDetect;
            successCount = total - imageQueue.length;

            store.dispatch(updateActiveLabelViewType(LabelType.RECT));
            if (!store.getState().general.smartAnnotationActive && !store.getState().general.eraserMode) {
                store.dispatch(updateActiveLabelType(LabelType.RECT));
            }

            const BATCH_SIZE = 8;
            let processed = 0;
            for (let chunkStart = 0; chunkStart < imageQueue.length; chunkStart += BATCH_SIZE) {
                if (this.isCancelled()) break;
                const chunk = imageQueue.slice(chunkStart, chunkStart + BATCH_SIZE);
                const blobs = chunk.map(img => img.fileData as Blob);
                const filenames = chunk.map(img => img.fileData?.name || 'image.jpg');
                try {
                    const batchResults = await DetectionAPIDetector.predictBatchFromBlobs(blobs, filenames);
                    // 逐张落地结果，保持和原路径相同的 Redux 写入语义
                    for (let i = 0; i < chunk.length; i++) {
                        const imageData = chunk[i];
                        const results = batchResults[i] || [];
                        this.applySingleResult(imageData, results);
                        totalObjects += results.length;
                        successCount++;
                    }
                } catch (err) {
                    console.error(`[Inference] batch_detect chunk [${chunkStart},${chunkStart + chunk.length}) FAILED:`,
                        (err as Error).message);
                    // batch 失败 → 整 chunk 标失败（语义保守，不 fallback 逐张防止重复请求）
                    chunk.forEach(img => {
                        failCount++;
                        store.dispatch(addInferenceHistory(img.id, 0, false, 'detection'));
                    });
                }
                processed += chunk.length;
                const pct = Math.round((processed / imageQueue.length) * 100);
                notify(2, `${t().aiInference.steps.inferring} (${processed}/${imageQueue.length})`,
                    `${pct}% — ${chunk[chunk.length - 1]?.fileData?.name || `Image ${processed}`}`);
                if (chunkStart + BATCH_SIZE < imageQueue.length) await this.yieldToUI();
            }
        }

        // ── 完成 / 取消 ──
        // 流式推理：结果已实时写入，无需跳回第一帧，保持用户当前位置
        // 强制 flush 挂起的图像更新（最后几帧的 idle 调度可能未触发）
        forceFlushPendingImageUpdates();
        const wasCancelled = this.isCancelled();
        store.dispatch(deleteNotificationById(progressNotification.id));
        store.dispatch(updateFullImageInferenceStatus(false));

        // Task Manager 行收尾：cancel 已在 onCancel 路径登记过，这里走 complete
        // （wasCancelled=true 时面板那边已经 dispatch 过 TASK_CANCEL，下面这次也是
        // 幂等的 — reducer 只是覆盖 status，cancelled 优先级高于 completed 的语义
        // 取决于谁后到。为避免被 complete() 反向覆盖成 completed，这里区分一下。）
        if (wasCancelled) {
            // 由 panel × 触发的取消已经 dispatch TASK_CANCEL；非 panel 路径下也走 cancel。
            task.cancel();
        } else {
            task.complete();
        }

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[BatchDetect] ${wasCancelled ? 'Cancelled' : 'Complete'}`, { totalTime: totalTime + 's', successCount, failCount, totalObjects });

        const doneTexts = t();
        store.dispatch(submitNewNotification(NotificationUtil.createSuccessNotification({
            header: wasCancelled ? '推理已停止' : doneTexts.notifications.batchDetectionCompleted,
            description: doneTexts.notifications.batchDetectionCompletedMessage
                .replace('{total}', String(successCount))
                .replace('{count}', String(totalObjects))
                .replace('{time}', totalTime)
        })));

        if (!store.getState().general.enablePerClassColoration) {
            store.dispatch(updatePerClassColorationStatus(true));
        }

        // Signal batch completion to EditorContainer for auto-showing statistics panel
        if (successCount > 2) {
            EditorModel.lastBatchInferenceImageCount = successCount;
            window.dispatchEvent(new CustomEvent('batchInferenceComplete', { detail: { count: successCount } }));
        }

        EditorActions.fullRender();
    }

    /**
     * 流式写入：单张图推理完成后立即写入 Redux 并刷新 UI
     */
    private static applySingleResult(
        imageData: ImageData,
        results: DetectionResult[],
        frameIdx?: number
    ): void {
        if (!results || results.length === 0) return;

        // 创建缺失标签
        this.createMissingLabelsIfNeeded(results);

        const updatedLabels: LabelName[] = store.getState().labels.labels;
        // 重新读取最新的 imageData（可能已被其他并发写入更新）。
        // 视频模式 frameIdx 即数组下标 — O(1)；find() 在 1.5 万帧视频上是 O(N)/帧。
        const currentImagesData: ImageData[] = store.getState().labels.imagesData;
        const byIdx = frameIdx !== undefined ? currentImagesData[frameIdx] : undefined;
        const currentImg = (byIdx && byIdx.id === imageData.id)
            ? byIdx
            : currentImagesData.find(img => img.id === imageData.id);
        if (!currentImg) return;

        // 保持原生推理结果：不做任何去重/过滤，所有模型输出的框原样入库。
        // 重复框（包括同帧高 IOU 重叠、手动框被覆盖、多次推理叠加）由用户自行决定如何处理。
        const newRects: LabelRect[] = results.map(result => {
            const [x1, y1, x2, y2] = result.bbox;
            const rect: IRect = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };

            const matchingLabel = updatedLabels.find(l =>
                l.name.toLowerCase() === result.info.name.toLowerCase()
            );
            const labelId = matchingLabel?.id || null;

            return {
                id: uuidv4(),
                labelId,
                rect,
                isCreatedByAI: true,
                isVisible: true,
                status: LabelStatus.ACCEPTED,
                suggestedLabel: labelId ? null : result.info.name,
                confidence: result.info.confidence ?? 0
            };
        });

        if (newRects.length > 0) {
            // 合并已挂起的更新（同帧多次推理叠加时不丢历史 rects）
            const pendingPrev = pendingImageUpdates.get(imageData.id);
            const baseRects = pendingPrev ? pendingPrev.labelRects : currentImg.labelRects;
            const updatedImg: ImageData = {
                ...(pendingPrev || currentImg),
                labelRects: [...baseRects, ...newRects]
            };
            pendingImageUpdates.set(imageData.id, updatedImg);
            scheduleFlush();
            // 如果当前帧就是刚推理的帧，立即同步 playbackImageData，保证渲染立即看到最新框
            const videoState = store.getState().video;
            if (videoState.isVideoMode && videoState.activeVideo) {
                const curFrame = videoState.activeVideo.currentFrame;
                const imgIdx = frameIdx !== undefined && currentImagesData[frameIdx]?.id === imageData.id
                    ? frameIdx
                    : currentImagesData.findIndex(img => img.id === imageData.id);
                if (imgIdx === curFrame) {
                    EditorModel.playbackImageData = updatedImg;
                }
            }
        }

        // 设置 AI 标签可见 + 记录推理历史
        const segResults = DetectionAPIDetector.convertToSegmentationFormat(results);
        store.dispatch(updateSegmentationResults(segResults, imageData.id));
        store.dispatch(addInferenceHistory(imageData.id, results.length, true, 'detection'));

        // 关键：设置 aiLabelsVisible = true，否则渲染引擎会跳过 AI 标签
        const aiState = store.getState().ai.imageAIStates.get(imageData.id);
        if (!aiState || !aiState.aiLabelsVisible) {
            store.dispatch(toggleImageAILabelsVisibility(imageData.id));
        }

        // 仅当推理帧正是当前展示帧时才刷新，避免批量推理中对每帧都重绘
        const activeIdx = store.getState().labels.activeImageIndex;
        const activeImgId = store.getState().labels.imagesData[activeIdx]?.id;
        if (activeImgId === imageData.id) {
            // 当前帧需立即在 store 中可见才能正确 fullRender
            forceFlushPendingImageUpdates();
            EditorActions.fullRender();
        }
    }

    /**
     * 批量将推理结果写入 Redux — 单次 dispatch 更新所有图像
     * 避免 N 次 updateImageDataById 触发 N 次 React 重渲染
     * (保留供 detectObjects 单张模式使用)
     */
    private static batchApplyResults(
        frameQueue: { frameIdx: number; imageData: ImageData }[],
        inferenceResults: Array<DetectionResult[] | null>
    ): void {
        // 预先创建所有缺失的标签（合并所有结果中的类别名，一次性创建）
        const allClassNames = new Set<string>();
        for (const results of inferenceResults) {
            if (results) results.forEach(r => allClassNames.add(r.info.name));
        }
        const existingLabels: LabelName[] = store.getState().labels.labels;
        const missingNames = [...allClassNames].filter(
            name => !existingLabels.some(e => e.name.toLowerCase() === name.toLowerCase())
        );
        if (missingNames.length > 0) {
            this.createMissingLabels(missingNames);
        }

        // 用最新的标签列表生成 LabelRects
        const updatedLabels: LabelName[] = store.getState().labels.labels;
        const currentImagesData: ImageData[] = [...store.getState().labels.imagesData];

        // 构建 imageId → imagesData 索引的 map 加速查找
        const idToIdx = new Map<string, number>();
        currentImagesData.forEach((img, idx) => idToIdx.set(img.id, idx));

        let modified = false;

        for (let i = 0; i < frameQueue.length; i++) {
            const results = inferenceResults[i];
            if (!results) { continue; }
            if (results.length === 0) { continue; }

            const { imageData } = frameQueue[i];
            const arrIdx = idToIdx.get(imageData.id);
            if (arrIdx === undefined) { continue; }

            const currentImg = currentImagesData[arrIdx];
            // 保持原生推理结果：不做任何去重/过滤，所有模型输出的框原样入库
            const newRects: LabelRect[] = results.map(result => {
                const [x1, y1, x2, y2] = result.bbox;
                const rect: IRect = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };

                const matchingLabel = updatedLabels.find(l =>
                    l.name.toLowerCase() === result.info.name.toLowerCase()
                );
                const labelId = matchingLabel?.id || null;

                return {
                    id: uuidv4(),
                    labelId,
                    rect,
                    isCreatedByAI: true,
                    isVisible: true,
                    status: LabelStatus.ACCEPTED,
                    suggestedLabel: labelId ? null : result.info.name,
                    confidence: result.info.confidence ?? 0
                };
            });

            if (newRects.length > 0) {
                currentImagesData[arrIdx] = {
                    ...currentImg,
                    labelRects: [...currentImg.labelRects, ...newRects]
                };
                modified = true;
            }
        }

        // 单次 dispatch 更新全部图像数据
        if (modified) {
            store.dispatch(updateImageData(currentImagesData));
            // 批量推理出检测框后自动切到检测标签页（view + tool 同步）
            // 橡皮擦激活时不强制切换工具，避免中断用户的擦除操作
            store.dispatch(updateActiveLabelViewType(LabelType.RECT));
            if (!store.getState().general.smartAnnotationActive && !store.getState().general.eraserMode) {
                store.dispatch(updateActiveLabelType(LabelType.RECT));
            }
            // 同步缓存到 EditorModel，供播放时 handleVideoTimeUpdate 立即读取
            // （避免 imagesDataRef 在 React 重渲染前读到旧数据导致 rects=0）
            EditorModel.latestImagesData = currentImagesData;
        }

        // 为每个有检测结果的帧设置 aiLabelsVisible = true
        // 否则 RectRenderEngine 中 `isCreatedByAI ? aiLabelsVisible : true` 会隐藏所有 AI 框
        for (let i = 0; i < frameQueue.length; i++) {
            const results = inferenceResults[i];
            if (results && results.length > 0) {
                const { imageData } = frameQueue[i];
                store.dispatch(addInferenceHistory(imageData.id, results.length, true, 'detection'));
            }
        }
    }

    /**
     * 复用已有 canvas 从视频捕获当前帧为 Blob。
     * 用 createImageBitmap 验证帧非空。
     */
    private static async captureFrameToBlob(
        video: HTMLVideoElement,
        ctx: CanvasRenderingContext2D,
        canvas: HTMLCanvasElement
    ): Promise<Blob> {
        if (video.readyState < 2) throw new Error('Video not ready');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        // 用 JPEG q=0.9 编码:体积约为 PNG 的 1/5,主线程编码耗时降低 ~70%,通用目标检测精度无感差异
        // 注意:缺陷检测/OCR 等对压缩敏感的任务请单独走 PNG 通道
        const blob: Blob = await new Promise((resolve, reject) => {
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.9);
        });
        const bmp = await createImageBitmap(blob);
        bmp.close();
        return blob;
    }

    /**
     * 将检测结果转换为可编辑的标注框（异步版，单张检测用）
     */
    private static convertDetectionResultsToLabelRects(imageData: ImageData, results: DetectionResult[]): void {
        this.createMissingLabelsIfNeeded(results);
        // 同步写入:调用方紧接着会 addInferenceHistory + fullRender,
        // 若用 queueMicrotask 会导致 fullRender 时 rects 还没进 store,出现渲染竞态。
        this.batchApplyResults(
            [{ frameIdx: 0, imageData }],
            [results]
        );
    }

    /** 如果检测结果中有未知标签，先创建 */
    private static createMissingLabelsIfNeeded(results: DetectionResult[]): void {
        const existingLabels: LabelName[] = store.getState().labels.labels;
        const uniqueNewLabels = [...new Set(results
            .filter(result => !existingLabels.some(existing =>
                existing.name.toLowerCase() === result.info.name.toLowerCase()
            ))
            .map(result => result.info.name)
        )];
        if (uniqueNewLabels.length > 0) {
            this.createMissingLabels(uniqueNewLabels);
        }
    }

    /**
     * 创建缺失的标签
     */
    private static createMissingLabels(labelNames: string[]): void {
        const existingLabels: LabelName[] = store.getState().labels.labels;
        
        // 过滤掉已存在的标签名称（不区分大小写）
        const filteredLabelNames = labelNames.filter(name => 
            !existingLabels.some(existing => 
                existing.name.toLowerCase() === name.toLowerCase()
            )
        );
        
        if (filteredLabelNames.length === 0) {
            console.log('所有AI检测标签都已存在，无需创建新标签');
            return;
        }
        
        const newLabels = filteredLabelNames.map(name => LabelUtil.createLabelName(name));
        const updatedLabels = [...existingLabels, ...newLabels];
        
        store.dispatch(updateLabelNames(updatedLabels));
        // 创建了AI标签，跳过重复标签（性能优化：移除日志）
    }

    /**
     * 批量捕获专用 seek — 不依赖 rVFC（视频 opacity:0 时 rVFC 可能不触发）
     *
     * 策略：seeked 事件 → 轮询 readyState >= 3（最多 2s）→ 100ms 缓冲
     * H.264 远离关键帧的帧解码可能需要 >500ms，故轮询上限设为 2s。
     */
    private static seekVideoToTimeForCapture(video: HTMLVideoElement, time: number): Promise<void> {
        return new Promise<void>((resolve) => {
            // 已在目标时间
            if (Math.abs(video.currentTime - time) < 0.001) {
                if (video.readyState >= 3) {
                    setTimeout(resolve, 50);
                    return;
                }
                // 已到目标时间但帧未解码 — 直接轮询 readyState，不依赖 seeked 事件
                // （设置相同的 currentTime 不会触发 seeked）
                let polls = 0;
                const check = () => {
                    if (video.readyState >= 3 || polls >= 100) {
                        setTimeout(resolve, 100);
                    } else {
                        polls++;
                        setTimeout(check, 20);
                    }
                };
                check();
                return;
            }

            let settled = false;
            const settle = () => {
                if (settled) return;
                settled = true;
                video.removeEventListener('seeked', onSeeked);
                clearTimeout(emergencyTimer);
                resolve();
            };

            const emergencyTimer = setTimeout(() => {
                console.warn(`[Capture] Seek timeout for time=${time.toFixed(3)}, readyState=${video.readyState}, currentTime=${video.currentTime.toFixed(3)}`);
                settle();
            }, 5000); // 5秒保护（H.264 极端情况）

            const waitForDecode = () => {
                let polls = 0;
                const check = () => {
                    if (video.readyState >= 3 || polls >= 100) { // 100 × 20ms = 2000ms
                        setTimeout(settle, 100); // 100ms 缓冲
                    } else {
                        polls++;
                        setTimeout(check, 20);
                    }
                };
                check();
            };

            const onSeeked = () => {
                if (video.readyState >= 3) {
                    setTimeout(settle, 100);
                } else {
                    waitForDecode();
                }
            };

            video.addEventListener('seeked', onSeeked, { once: true });
            video.currentTime = time;
        });
    }

    /**
     * 单帧检测用 seek — 使用 rVFC 获得最高精度（视频可见时使用）
     */
    private static seekVideoToTime(video: HTMLVideoElement, time: number): Promise<void> {
        return new Promise<void>((resolve) => {
            if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) {
                resolve();
                return;
            }

            let settled = false;
            const settle = () => {
                if (settled) return;
                settled = true;
                clearTimeout(globalTimer);
                resolve();
            };

            const globalTimer = setTimeout(settle, 5000);

            const onSeeked = () => {
                if ('requestVideoFrameCallback' in video) {
                    (video as any).requestVideoFrameCallback(() => settle());
                } else {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            setTimeout(settle, 20);
                        });
                    });
                }
            };

            video.addEventListener('seeked', onSeeked, { once: true });
            video.currentTime = time;
        });
    }
}
