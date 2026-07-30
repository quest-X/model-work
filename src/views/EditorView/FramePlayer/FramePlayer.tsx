/**
 * FramePlayer — fast_ffmpeg_mode playback component
 *
 * This component implements the "fast_ffmpeg_mode" video playback path:
 * the backend FFmpeg process extracts every frame as a JPEG file, and this
 * component plays the JPEG sequence on a <canvas> driven by requestAnimationFrame.
 *
 * Two sub-modes are handled transparently:
 *   - Full-load (small videos): all frame Files are available in `frames` prop.
 *   - On-demand  (large videos): frames are fetched in batches via `sessionId`
 *     using a sliding-window cache (see MIN_AHEAD / MAX_AVAILABLE constants).
 *
 * Counterpart: VideoPlayer.tsx implements "raw_browser_mode" (browser-native
 * <video> element). The switch between the two lives in VideoEditor.tsx.
 *
 * @see VideoPlaybackMode in data/enums/VideoPlaybackMode.ts
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import '../VideoPlayer/VideoPlayer.scss';
import { ISize } from '../../../interfaces/ISize';
import { Language, LanguageConfig } from '../../../data/LanguageConfig';
import { EditorModel } from '../../../staticModels/EditorModel';
import { EditorActions } from '../../../logic/actions/EditorActions';
import { FrameExtractorService, SessionExpiredError } from '../../../services/FrameExtractorService';
import {getVideoThumbnailSize} from '../../../utils/VideoThumbnailUtil';

interface IProps {
    language: Language;
    frames: File[];
    sessionId?: string;  // fast_ffmpeg_mode (on-demand): backend session ID for batch frame fetching
    fps: number;
    duration: number;
    totalFrames: number;
    videoSize: ISize;
    currentTime: number;
    currentFrame: number;
    isPlaying?: boolean;
    onTimeUpdate?: (time: number, frame: number) => void;
    onLoadedMetadata?: (duration: number, frames: number, fps: number, videoSize: ISize) => void;
    onPlayPause?: () => void;
    onFirstFrameDrawn?: (canvas: HTMLCanvasElement) => void;
    // 帧完整加载回调：Image 解码 + 缩略图生成完毕
    onFrameReady?: (frameIdx: number, thumbnailImage: HTMLImageElement) => void;
}

const BATCH_SIZE = 100;

// === available_frames 滑动窗口（基于秒数 × fps 动态计算） ===
const MIN_AHEAD_SECONDS = 20;   // 前方保持 20 秒可播放（25fps=500, 30fps=600）
const MAX_AVAILABLE_SECONDS = 60; // 缓存上限 60 秒（仅用于低分辨率：高分辨率被内存预算覆盖）
const KEEP_BEHIND_SECONDS = 3;  // 后方保留 3 秒（支持短回退）

// === 三层缓存独立预算 ===
//
// 解码后 RGBA 帧 (重) — 14MB/帧 (1440p),严格限制以防崩溃
const DECODED_FRAME_BUDGET_BYTES = 1_200_000_000;   // 1.2 GB
const MIN_CACHE_FLOOR = 30;
const MIN_AHEAD_FLOOR = 8;
//
// JPEG 字节层 (中) — 300KB/帧典型,允许大窗口,scrub 时不必回后端
// 600MB → ~2000 帧 (1440p ~80秒);  注意力区拖动几乎都在窗内
const JPEG_BUDGET_BYTES = 600_000_000;
const ASSUMED_JPEG_BYTES_PER_FRAME = 300_000;       // 经验值,用于估算窗口大小
//
// 缩略图: 由 thumbnailDoneRef 累积,150x150 JPEG ~10KB/张,15094 张 ~150MB
// 不主动驱逐,自然累积

const FramePlayer: React.FC<IProps> = ({
    language,
    frames,
    sessionId,
    fps,
    duration,
    totalFrames,
    videoSize,
    currentTime,
    currentFrame,
    isPlaying = false,
    onTimeUpdate,
    onLoadedMetadata,
    onPlayPause,
    onFirstFrameDrawn,
    onFrameReady,
}) => {
    const texts = LanguageConfig[language];

    // 基于实际 fps 动态计算滑动窗口参数
    const fpsClamped = fps || 30;
    const secondsBasedMaxAvailable = Math.ceil(MAX_AVAILABLE_SECONDS * fpsClamped);
    const secondsBasedMinAhead = Math.ceil(MIN_AHEAD_SECONDS * fpsClamped);
    const KEEP_BEHIND = Math.ceil(KEEP_BEHIND_SECONDS * fpsClamped);

    // 按分辨率内存预算压缩缓存上限,避免 1440p+ 视频吃光浏览器进程内存导致崩溃
    const perFrameBytes = Math.max(1, (videoSize.width || 0) * (videoSize.height || 0) * 4);
    const memoryBasedMaxAvailable = Math.floor(DECODED_FRAME_BUDGET_BYTES / perFrameBytes);
    const MAX_AVAILABLE = Math.max(
        MIN_CACHE_FLOOR,
        Math.min(secondsBasedMaxAvailable, memoryBasedMaxAvailable),
    );
    // MIN_AHEAD 也要相应压缩,且必须留出 KEEP_BEHIND 和一定 margin,否则刚加载就被淘汰
    const MIN_AHEAD = Math.max(
        MIN_AHEAD_FLOOR,
        Math.min(secondsBasedMinAhead, MAX_AVAILABLE - KEEP_BEHIND - 5),
    );

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const focusableElementRef = useRef<HTMLDivElement>(null);
    const mountedRef = useRef(true);
    const [isLoaded, setIsLoaded] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0); // initLoad 进度 0-100
    // 后台分批加载状态：init 完成后，滑动窗口持续补帧时显示
    const [bgLoad, setBgLoad] = useState<{ ahead: number; min: number } | null>(null);
    const bgLoadRef = useRef<{ ahead: number; min: number } | null>(null);
    // session 失效（后端重启或清理）：停止继续请求并显示提示
    const [sessionExpired, setSessionExpired] = useState(false);
    const sessionExpiredRef = useRef(false);
    const updateBgLoad = useCallback((val: { ahead: number; min: number } | null) => {
        const prev = bgLoadRef.current;
        if (val === null && prev === null) return;
        if (val && prev && val.ahead === prev.ahead && val.min === prev.min) return;
        bgLoadRef.current = val;
        setBgLoad(val);
    }, []);

    // 帧图像缓存
    const frameCacheRef = useRef<Map<number, HTMLImageElement>>(new Map());
    const blobUrlCacheRef = useRef<Map<number, string>>(new Map());
    // P3 兜底：已向父组件投递过缩略图的帧号，空闲时从头到尾填补剩余帧
    const thumbnailDoneRef = useRef<Set<number>>(new Set());
    const p3CursorRef = useRef(0);

    // 稳定 ref
    const onTimeUpdateRef = useRef(onTimeUpdate);
    onTimeUpdateRef.current = onTimeUpdate;
    const onPlayPauseRef = useRef(onPlayPause);
    onPlayPauseRef.current = onPlayPause;
    const isPlayingRef = useRef(isPlaying);
    isPlayingRef.current = isPlaying;
    const onFrameReadyRef = useRef(onFrameReady);
    onFrameReadyRef.current = onFrameReady;

    // 播放（rAF 驱动）
    const rafRef = useRef<number>();
    const playFrameRef = useRef(0);
    const isVideoEndedRef = useRef(false);

    // 加载去重
    const pendingRequestsRef = useRef<Map<number, Promise<HTMLImageElement>>>(new Map());
    const pendingBatchRef = useRef<Map<number, Promise<File[]>>>(new Map());

    // === available_frames 滑动窗口控制 ===
    const loadGenRef = useRef(0);       // 取消令牌
    const thumbnailCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const initPhaseRef = useRef(true);  // 初始化阶段标志
    const lastSeekFrameRef = useRef(-1);

    // 稳定 ref
    const loadFrameFullRef = useRef<(frameIdx: number) => Promise<void>>(() => Promise.resolve());
    const maintainRef = useRef<() => void>(() => {});

    // 加载单帧图像（缓存 → 全局帧池 → 后端批量取）
    const loadFrameImage = useCallback(async (frameIdx: number): Promise<HTMLImageElement> => {
        if (frameIdx < 0 || frameIdx >= totalFrames) {
            throw new Error(`Frame ${frameIdx} out of range [0, ${totalFrames})`);
        }

        const cache = frameCacheRef.current;
        const cached = cache.get(frameIdx);
        if (cached) return cached;

        const preloaded = EditorModel.preloadedImageCache.get(frameIdx);
        if (preloaded) {
            cache.set(frameIdx, preloaded);
            EditorModel.preloadedImageCache.delete(frameIdx);
            return preloaded;
        }

        const pending = pendingRequestsRef.current.get(frameIdx);
        if (pending) return pending;

        const promise = (async () => {
            const allFrames = EditorModel.videoFrameFiles;
            let frameFile = (allFrames.length > frameIdx ? allFrames[frameIdx] : null)
                || (frames.length > frameIdx ? frames[frameIdx] : null);

            if (!frameFile && sessionId) {
                if (sessionExpiredRef.current) throw new SessionExpiredError(sessionId);
                const batchStart = Math.floor(frameIdx / BATCH_SIZE) * BATCH_SIZE;
                const batchCount = Math.min(BATCH_SIZE, totalFrames - batchStart);
                let batchPromise = pendingBatchRef.current.get(batchStart);
                if (!batchPromise) {
                    batchPromise = FrameExtractorService.fetchFrameRange(sessionId, batchStart, batchCount);
                    pendingBatchRef.current.set(batchStart, batchPromise);
                    // 独立清理链：用 .then 同时处理成功/失败，避免 .finally 衍生未捕获拒绝
                    batchPromise.then(
                        () => pendingBatchRef.current.delete(batchStart),
                        () => pendingBatchRef.current.delete(batchStart),
                    );
                }
                let fetched: File[];
                try {
                    fetched = await batchPromise;
                } catch (e) {
                    if (e instanceof SessionExpiredError) {
                        sessionExpiredRef.current = true;
                        setSessionExpired(true);
                    }
                    throw e;
                }
                for (let i = 0; i < fetched.length; i++) {
                    allFrames[batchStart + i] = fetched[i];
                }
                frameFile = allFrames[frameIdx] || null;
            }

            if (!frameFile) throw new Error(`Frame ${frameIdx} unavailable`);

            // 0 字节占位文件 = on-demand 视频帧未拉到，URL.createObjectURL 后浏览器加载会
            // 触发 net::ERR_FILE_NOT_FOUND 刷屏。直接抛错，让调用方等真实数据到达后再试。
            if (frameFile.size === 0) {
                throw new Error(`Frame ${frameIdx} is a 0-byte placeholder; pending backend fetch`);
            }

            // 驱逐由 evictOldFrames 统一处理，此处不做

            return new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                const url = URL.createObjectURL(frameFile!);
                blobUrlCacheRef.current.set(frameIdx, url);
                img.onload = () => { cache.set(frameIdx, img); resolve(img); };
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    blobUrlCacheRef.current.delete(frameIdx);
                    reject(new Error(`Failed to decode frame ${frameIdx}`));
                };
                img.src = url;
            });
        })();

        pendingRequestsRef.current.set(frameIdx, promise);
        try { return await promise; }
        finally { pendingRequestsRef.current.delete(frameIdx); }
    }, [frames, sessionId, totalFrames]);

    const ensureCanvasSize = (canvas: HTMLCanvasElement) => {
        // Use display size × devicePixelRatio instead of full video resolution.
        // e.g. 2560×1440 video displayed at 636×358 on 2x Retina → canvas 1272×716
        // saves ~75% GPU pixel fill vs native resolution.
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const targetW = rect.width > 0
            ? Math.min(Math.round(rect.width * dpr), videoSize.width)
            : videoSize.width;
        const targetH = rect.height > 0
            ? Math.min(Math.round(rect.height * dpr), videoSize.height)
            : videoSize.height;
        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
        }
    };

    const drawFrame = useCallback(async (frameIdx: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ensureCanvasSize(canvas);
        try {
            const img = await loadFrameImage(frameIdx);
            if (!mountedRef.current || canvas !== canvasRef.current) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            EditorModel.videoFrameImage = img;
            // 暂停中的 seek cache-miss 路径：videoFrameImage 异步到手后，
            // VideoEditor 的 sync effect 已经用旧图跑过一次 fullRender 了，
            // 这里主动补一次，把 Editor canvas 刷到正确的底图。
            if (!isPlayingRef.current && EditorModel.canvas) {
                EditorActions.setActiveImage(img);
                EditorActions.fullRender();
            }
        } catch (err) {
            console.error(`[FramePlayer] drawFrame(${frameIdx}) failed:`, err);
        }
    }, [loadFrameImage, videoSize]);

    const drawFrameSync = useCallback((frameIdx: number): boolean => {
        const canvas = canvasRef.current;
        if (!mountedRef.current || !canvas) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;

        let cached = frameCacheRef.current.get(frameIdx);
        if (!cached) {
            const preloaded = EditorModel.preloadedImageCache.get(frameIdx);
            if (preloaded) {
                frameCacheRef.current.set(frameIdx, preloaded);
                EditorModel.preloadedImageCache.delete(frameIdx);
                cached = preloaded;
            } else {
                return false;
            }
        }
        ensureCanvasSize(canvas);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(cached, 0, 0, canvas.width, canvas.height);
        EditorModel.videoFrameImage = cached;
        return true;
    }, [videoSize]);

    // === 完整加载一帧：Image 解码 + 缩略图 ===
    const loadFrameFull = useCallback(async (frameIdx: number): Promise<void> => {
        try {
            const img = await loadFrameImage(frameIdx);
            const cb = onFrameReadyRef.current;
            if (!cb || videoSize.width === 0) return;

            if (!thumbnailCanvasRef.current) {
                thumbnailCanvasRef.current = document.createElement('canvas');
            }
            const thumbnailSize = getVideoThumbnailSize(videoSize.width, videoSize.height);
            thumbnailCanvasRef.current.width = thumbnailSize.width;
            thumbnailCanvasRef.current.height = thumbnailSize.height;
            const ctx = thumbnailCanvasRef.current.getContext('2d');
            if (!ctx) return;

            ctx.clearRect(0, 0, thumbnailSize.width, thumbnailSize.height);
            ctx.drawImage(img, 0, 0, thumbnailSize.width, thumbnailSize.height);

            // Use async toBlob instead of synchronous toDataURL to avoid blocking
            // the main thread (~512ms total savings per Gemini/DevTools analysis).
            const blob: Blob | null = await new Promise(r => thumbnailCanvasRef.current!.toBlob(r, 'image/jpeg', 0.5));
            if (!blob) return;
            const thumbUrl = URL.createObjectURL(blob);
            await new Promise<void>(resolve => {
                const thumb = new Image();
                // 不撤销 thumbUrl：ImagePreview <img src={image.src}> 渲染仍指向它
                thumb.onload = () => {
                    cb(frameIdx, thumb);
                    thumbnailDoneRef.current.add(frameIdx);
                    resolve();
                };
                thumb.onerror = () => { URL.revokeObjectURL(thumbUrl); resolve(); };
                thumb.src = thumbUrl;
            });
        } catch (err) {
            console.error(`[FramePlayer] loadFrameFull(${frameIdx}) failed:`, err);
        }
    }, [loadFrameImage, videoSize]);

    // === RGBA 解码缓存淘汰 ===
    // 仅清解码后的 Image,不动 JPEG 字节池(JPEG 层有自己的 evictJpegByBudget)。
    // 这样 scrub 命中 JPEG 缓存时只需重新解码(~30ms),不必回后端拉(100-300ms)。
    const evictOldFrames = useCallback((currentPos: number) => {
        const cache = frameCacheRef.current;
        if (cache.size <= MAX_AVAILABLE) return;

        const toEvict: number[] = [];
        for (const key of cache.keys()) {
            if (key < currentPos - KEEP_BEHIND) toEvict.push(key);
            if (cache.size - toEvict.length <= MAX_AVAILABLE) break;
        }
        for (const key of toEvict) {
            cache.delete(key);
            const url = blobUrlCacheRef.current.get(key);
            if (url) { URL.revokeObjectURL(url); blobUrlCacheRef.current.delete(key); }
        }
        if (toEvict.length > 0) {
            console.log(`[FramePlayer] RGBA 淘汰 ${toEvict.length} 帧, 缓存=${cache.size}`);
        }
    }, [MAX_AVAILABLE, KEEP_BEHIND]);

    // === JPEG 字节池独立淘汰(只在 on-demand 模式) ===
    // 当 JPEG 池超过预算时,从距当前帧最远处开始 evict,保留注意力区。
    // 全片不一定都在内存里,但当前 ±N 千帧基本都有。
    const evictJpegByBudget = useCallback((currentPos: number) => {
        if (!sessionId) return; // full-load 模式由父组件管理,这里不能动
        const pool = EditorModel.videoFrameFiles;
        const maxFrames = Math.floor(JPEG_BUDGET_BYTES / ASSUMED_JPEG_BYTES_PER_FRAME);

        // O(N) 扫一次,15094 帧约 0.1ms,可接受
        const heldIndices: number[] = [];
        for (let i = 0; i < pool.length; i++) {
            if (pool[i]) heldIndices.push(i);
        }
        if (heldIndices.length <= maxFrames) return;

        // 按"距 currentPos 远近"排序,最远的优先 evict
        heldIndices.sort((a, b) => Math.abs(b - currentPos) - Math.abs(a - currentPos));
        const toRemove = heldIndices.length - maxFrames;
        for (let i = 0; i < toRemove; i++) {
            pool[heldIndices[i]] = undefined;
        }
        console.log(`[FramePlayer] JPEG 淘汰 ${toRemove} 帧, 池容量=${heldIndices.length - toRemove}/${maxFrames}`);
    }, [sessionId]);

    // 持续维护 available_frames：保证当前位置前方始终有 MIN_AHEAD 帧可播放
    const maintainAvailableFrames = useCallback(async () => {
        const gen = ++loadGenRef.current;

        while (loadGenRef.current === gen) {
            if (sessionExpiredRef.current) return;
            const pos = isPlayingRef.current ? playFrameRef.current : currentFrameRef.current;
            const searchEnd = Math.min(pos + MAX_AVAILABLE, totalFrames);

            // 找当前位置前方第一个未缓存帧
            let target = -1;
            for (let i = Math.max(0, pos); i < searchEnd; i++) {
                if (!frameCacheRef.current.has(i)) { target = i; break; }
            }

            // 更新后台加载 UI：MIN_AHEAD 窗口内从 pos 起连续已缓存帧数
            const posClamped = Math.max(0, pos);
            const minEnd = Math.min(posClamped + MIN_AHEAD, totalFrames);
            const minRequired = Math.max(0, minEnd - posClamped);
            const ahead = target < 0 ? minRequired : Math.max(0, target - posClamped);
            updateBgLoad(ahead < minRequired ? { ahead, min: minRequired } : null);

            if (target < 0) {
                // 窗口内全部已缓存：P3 兜底 —— 未播放时从头到尾补齐全视频缩略图
                if (!isPlayingRef.current) {
                    const cursor = thumbnailDoneRef.current;
                    while (p3CursorRef.current < totalFrames && cursor.has(p3CursorRef.current)) {
                        p3CursorRef.current++;
                    }
                    if (p3CursorRef.current < totalFrames) {
                        const idx = p3CursorRef.current;
                        p3CursorRef.current++; // 无论成败推进，避免失败帧无限重试
                        try { await loadFrameFullRef.current(idx); } catch {}
                        continue;
                    }
                }
                await new Promise(r => setTimeout(r, 200));
                continue;
            }

            const isUrgent = target < pos + MIN_AHEAD;

            if (isUrgent) {
                // 紧急：在 MIN_AHEAD 范围内有空缺 → 只缓存图片（快，即使播放中也加载）
                try { await loadFrameImage(target); } catch {}
            } else if (!isPlayingRef.current) {
                // 非紧急 + 未播放 → 完整加载（含缩略图）
                try { await loadFrameFullRef.current(target); } catch {}
                if (target % 10 === 0) await new Promise(r => setTimeout(r, 0));
            } else {
                // 非紧急 + 播放中 → 缓冲充足，暂停加载
                await new Promise(r => setTimeout(r, 300));
                continue;
            }

            // 淘汰旧帧:RGBA 严格限,JPEG 大窗口独立 LRU
            evictOldFrames(pos);
            evictJpegByBudget(pos);
        }
    }, [totalFrames, loadFrameImage, evictOldFrames, evictJpegByBudget, updateBgLoad, MIN_AHEAD, MAX_AVAILABLE]);

    // 更新稳定 ref
    loadFrameFullRef.current = loadFrameFull;
    maintainRef.current = () => { maintainAvailableFrames(); };

    // === 初始化 ===
    const initDoneRef = useRef(false);
    useEffect(() => {
        const hasSource = frames.length > 0 || !!sessionId;
        if (!hasSource || videoSize.width === 0) return undefined;
        if (initDoneRef.current) return undefined;

        let cancelled = false;

        const init = async () => {
            try {
                // 移入解析阶段预加载缓存
                const preloaded = EditorModel.preloadedImageCache;
                if (preloaded.size > 0) {
                    for (const [idx, img] of preloaded) {
                        frameCacheRef.current.set(idx, img);
                    }
                    console.log(`[FramePlayer] 从预加载缓存移入 ${preloaded.size} 帧到 LRU`);
                    preloaded.clear();
                }

                // 加载并绘制第 0 帧
                await loadFrameImage(0);
                if (cancelled) return;
                await drawFrame(0);
                if (cancelled) return;

                initDoneRef.current = true;

                // 通知父组件元数据（触发 ImageData 创建）
                onLoadedMetadata?.(duration, totalFrames, fps, videoSize);

                if (canvasRef.current) {
                    setTimeout(() => {
                        if (!cancelled && canvasRef.current) {
                            onFirstFrameDrawn?.(canvasRef.current);
                        }
                    }, 0);
                }

                focusableElementRef.current?.focus();

                // 等待 VideoEditor 创建 ImageData（下一个 React 渲染周期）
                await new Promise(r => setTimeout(r, 100));
                if (cancelled) return;

                const gen = ++loadGenRef.current;
                const initEnd = Math.min(MIN_AHEAD, totalFrames);

                let loaded = 0;
                const tick = () => {
                    loaded++;
                    // 用"解析中 X%"进度反馈，不打开右下角角标
                    setLoadingProgress(Math.round((loaded / initEnd) * 100));
                };

                // 预拉所有 batch：每个 batch 的第一帧并发触发 loadFrameImage，
                // 让网络 fetch / ZIP 解压与后续的 canvas+thumbnail 主线程工作流水线重叠
                if (sessionId) {
                    const warms: Promise<any>[] = [];
                    for (let start = 0; start < initEnd; start += BATCH_SIZE) {
                        warms.push(loadFrameImage(start).catch(() => null));
                    }
                    await Promise.all(warms);
                    if (loadGenRef.current !== gen || cancelled) return;
                }

                // Fast-prefetch：前 FAST 帧全部并发，最容易被用户看到，必须尽快出现
                const FAST = Math.min(20, initEnd);
                await Promise.all(
                    Array.from({ length: FAST }, (_, i) =>
                        (async () => {
                            if (loadGenRef.current !== gen || cancelled) return;
                            try { await loadFrameFullRef.current(i); } catch {}
                            tick();
                        })()
                    )
                );
                if (loadGenRef.current !== gen || cancelled) return;

                // 剩余帧用 worker pool（batch 已预拉，worker 只做 decode + thumbnail）
                const CONCURRENCY = 8;
                let nextIdx = FAST;
                await Promise.all(
                    Array.from({ length: CONCURRENCY }, async () => {
                        while (true) {
                            if (loadGenRef.current !== gen || cancelled) return;
                            const i = nextIdx++;
                            if (i >= initEnd) return;
                            try { await loadFrameFullRef.current(i); } catch {}
                            tick();
                        }
                    })
                );
                if (loadGenRef.current !== gen || cancelled) return;

                // 完全解析完，一次性掀开画面
                setIsLoaded(true);
                initPhaseRef.current = false;

                // 启动 available_frames 滑动窗口维护（P3 兜底继续填剩余帧）
                maintainRef.current();
            } catch (err) {
                console.error('[FramePlayer] Init failed:', err);
                if (err instanceof SessionExpiredError) {
                    sessionExpiredRef.current = true;
                    setSessionExpired(true);
                }
            }
        };

        init();
        return () => { cancelled = true; };
    }, [frames.length, sessionId, videoSize.width, videoSize.height]); // eslint-disable-line react-hooks/exhaustive-deps

    // 播放帧 ref
    const currentFrameRef = useRef(currentFrame);
    currentFrameRef.current = currentFrame;

    // === 播放/暂停控制（rAF + 时间驱动） ===
    useEffect(() => {
        if (!isLoaded) return undefined;

        if (isPlaying) {
            if (isVideoEndedRef.current) {
                isVideoEndedRef.current = false;
                playFrameRef.current = 0;
                onTimeUpdateRef.current?.(0, 0);
                drawFrameSync(0) || drawFrame(0);
            } else {
                playFrameRef.current = currentFrameRef.current;
            }

            const startTime = performance.now();
            const startFrame = playFrameRef.current;

            const tick = (now: number) => {
                // 基于真实时间计算目标帧号（不累加，不漂移）
                const elapsed = (now - startTime) / 1000;
                const targetFrame = Math.min(
                    startFrame + Math.floor(elapsed * fps),
                    totalFrames - 1
                );

                // 帧号没变 → 跳过（屏幕刷新率 > 视频帧率时）
                if (targetFrame === playFrameRef.current && targetFrame < totalFrames - 1) {
                    rafRef.current = requestAnimationFrame(tick);
                    return;
                }

                // 始终更新帧位置（确保帧号和时间轴跟随真实时间）
                playFrameRef.current = targetFrame;
                onTimeUpdateRef.current?.(targetFrame / fps, targetFrame);

                // 尝试同步绘制（缓存命中则画，否则保持上一帧画面）
                drawFrameSync(targetFrame);

                // 到达最后一帧 → 确保画完再暂停
                if (targetFrame >= totalFrames - 1) {
                    onTimeUpdateRef.current?.(duration, totalFrames - 1);

                    if (!frameCacheRef.current.has(totalFrames - 1)) {
                        // 最后一帧不在缓存 → 异步加载，画完再暂停
                        drawFrame(totalFrames - 1).then(() => {
                            isVideoEndedRef.current = true;
                            onPlayPauseRef.current?.();
                        });
                    } else {
                        // 最后一帧在缓存 → 确保画上再暂停
                        drawFrameSync(totalFrames - 1);
                        isVideoEndedRef.current = true;
                        onPlayPauseRef.current?.();
                    }
                    return; // 不再 requestAnimationFrame
                }

                rafRef.current = requestAnimationFrame(tick);
            };

            rafRef.current = requestAnimationFrame(tick);
        } else {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = undefined;
            }
        }

        return () => {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = undefined;
            }
        };
    }, [isPlaying, isLoaded, fps, totalFrames, duration, drawFrameSync, drawFrame]);

    // === 外部 seek（暂停时响应 currentTime 变化）===
    useEffect(() => {
        if (!isLoaded || isPlaying) return;
        // 初始化阶段不响应 seek，避免干扰 initLoad
        if (initPhaseRef.current) return;

        const targetFrame = Math.max(0, Math.min(Math.round(currentTime * fps), totalFrames - 1));

        // 帧号没变则跳过，防止 seek 重复触发
        if (targetFrame === lastSeekFrameRef.current) return;
        lastSeekFrameRef.current = targetFrame;

        // 先试 drawFrameSync（缓存命中零闪烁）：同步更新 videoFrameImage，
        // 随后 VideoEditor 的 sync effect 跑 setActiveImage 时就能读到新底图。
        // 缓存未命中才 fall back 到 async drawFrame（完成后会自动补一次 fullRender）。
        if (!drawFrameSync(targetFrame)) {
            drawFrame(targetFrame);
        }
        // 重启滑动窗口维护，从新位置开始填充
        maintainRef.current();
    }, [currentTime, isLoaded, isPlaying, fps, totalFrames, drawFrame, drawFrameSync]);

    // 键盘快捷键
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isLoaded) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onPlayPauseRef.current?.();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isLoaded]);

    // 清理（不主动 revokeObjectURL，避免 Strict Mode 双重挂载间撤销正在加载的 URL）
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            loadGenRef.current++; // 终止 maintainAvailableFrames 循环
            frameCacheRef.current = new Map();
            blobUrlCacheRef.current = new Map();
            pendingRequestsRef.current = new Map();
            EditorModel.videoFrameImage = null;
        };
    }, []);

    return (
        <div className="VideoPlayer" ref={containerRef}>
            <div
                ref={focusableElementRef}
                tabIndex={0}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    outline: 'none',
                    zIndex: 1
                }}
                aria-label={texts.video.playerAriaLabel}
            />
            <canvas
                ref={canvasRef}
                className="VideoCanvas"
                style={{
                    display: 'block',
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain'
                }}
            />
            {!isLoaded && (
                <div className="LoadingOverlay">
                    <div className="LoadingSpinner"></div>
                    <p>解析中 {loadingProgress}%</p>
                </div>
            )}
            {isLoaded && bgLoad && bgLoad.ahead === 0 && (
                <div className="LoadingOverlay LoadingOverlayDim">
                    <div className="LoadingSpinner"></div>
                    <p>加载帧中 {bgLoad.ahead}/{bgLoad.min}</p>
                </div>
            )}
            {isLoaded && bgLoad && !sessionExpired && (
                <div className="BgLoadingBadge">
                    <div className="BgSpinner"></div>
                    <span>缓冲 {bgLoad.ahead}/{bgLoad.min}</span>
                </div>
            )}
            {sessionExpired && (
                <div className="LoadingOverlay">
                    <p style={{ fontSize: 16, marginBottom: 8 }}>视频会话已失效</p>
                    <p style={{ fontSize: 13, color: '#aaa' }}>
                        后端已重启或 session 已清理，请删除当前队列项并重新上传视频
                    </p>
                </div>
            )}
        </div>
    );
};

export default FramePlayer;
