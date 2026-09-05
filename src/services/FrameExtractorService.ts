/**
 * FrameExtractorService — v1.9.1
 *
 * This service powers the "fast_ffmpeg_mode" playback path. It uploads the
 * video to the backend FFmpeg server and exposes on-demand frame fetching.
 *
 * Flow: openSession() uploads the video and returns a sessionId + metadata.
 * Frames are then fetched in batches via fetchFrameRange(sessionId, ...)
 * (sliding-window in FramePlayer).
 *
 * If this service fails (backend unreachable), EditorContainer falls back
 * to raw_browser_mode (browser-native <video> element via VideoPlayer).
 *
 * @see VideoPlaybackMode in data/enums/VideoPlaybackMode.ts
 */
import axios from 'axios';
import JSZip from 'jszip';
import {getEngineBaseUrl} from '../utils/DefaultBackendUrl';
import {TaskTracker} from './TaskTracker';
import {TaskType} from '../store/tasks/types';
import {store} from '../index';
import {LanguageConfig} from '../data/LanguageConfig';

// ── ZIP-parse worker ──────────────────────────────────────────────────────
// Vite picks up `new Worker(new URL(...), { type: 'module' })` and emits a
// chunk for the worker module. Falls back to main-thread JSZip if Worker
// construction throws (very old browsers / SSR / tests).
const WORKER_TIMEOUT_MS = 30_000;
let workerSeq = 0;
let cachedWorker: Worker | null = null;

function getWorker(): Worker | null {
    if (cachedWorker) return cachedWorker;
    try {
        cachedWorker = new Worker(
            new URL('../workers/FrameExtractorWorker.ts', import.meta.url),
            { type: 'module' }
        );
    } catch (err) {
        console.warn('[FrameExtractor] Worker init failed, using main thread:', (err as Error).message);
        cachedWorker = null;
    }
    return cachedWorker;
}

interface WorkerEntry { name: string; blob: Blob; }

function unzipInWorker(buffer: ArrayBuffer): Promise<WorkerEntry[]> {
    const worker = getWorker();
    if (!worker) {
        // Fallback path: main-thread JSZip (legacy behaviour).
        return JSZip.loadAsync(buffer).then(async (zip) => {
            const names = Object.keys(zip.files).filter(n => n.endsWith('.jpg')).sort();
            const out: WorkerEntry[] = [];
            for (const name of names) {
                out.push({ name, blob: await zip.files[name].async('blob') });
            }
            return out;
        });
    }

    const id = ++workerSeq;
    return new Promise<WorkerEntry[]>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined = undefined;
        const onMessage = (ev: MessageEvent) => {
            const data = ev.data;
            if (!data || data.id !== id) return;
            clearTimeout(timer);
            worker.removeEventListener('message', onMessage);
            if (data.ok) {
                resolve(data.entries as WorkerEntry[]);
            } else {
                reject(new Error(data.error || 'Worker unzip failed'));
            }
        };

        timer = setTimeout(() => {
            worker.removeEventListener('message', onMessage);
            reject(new Error(`Worker unzip timeout after ${WORKER_TIMEOUT_MS}ms`));
        }, WORKER_TIMEOUT_MS);
        worker.addEventListener('message', onMessage);
        // Transfer the ArrayBuffer to avoid a structured-clone copy.
        worker.postMessage({ id, buffer }, [buffer]);
    });
}

export interface FrameExtractionResult {
    fps: number;
    duration: number;
    totalFrames: number;
    width: number;
    height: number;
    sessionId?: string;  // fast_ffmpeg_mode (on-demand): backend session ID for batch frame fetching
}

export type ProgressCallback = (phase: string, current: number, total: number) => void;

/**
 * 后端 session 已失效（通常因后端重启）。触发方：GET /frames/{sid} 返回 404。
 * 捕获侧应停止继续请求并提示用户重新上传。
 */
export class SessionExpiredError extends Error {
    constructor(public sessionId: string) {
        super(`Backend session expired: ${sessionId}`);
        this.name = 'SessionExpiredError';
    }
}

const getApiBase = () => getEngineBaseUrl();

export class FrameExtractorService {

    // ── 入口：always on-demand ─────────────────────────────────────────────

    /**
     * 上传视频并返回 sessionId，帧由 FramePlayer 滑动窗口按需获取。
     * 所有视频统一走 on-demand 模式，避免大视频 JSZip OOM。
     */
    static async openSession(
        videoFile: File,
        targetFps: number = 0,
        onProgress?: ProgressCallback,
    ): Promise<FrameExtractionResult> {

        // P1 Task Manager 行：后端 session 不可由前端取消。
        const tmTexts = LanguageConfig[store.getState().general.language].taskManager;
        const task = TaskTracker.startTask({
            type: TaskType.FRAME_EXTRACTION,
            priority: 'P1',
            title: tmTexts.types.frameExtraction,
            subtitle: videoFile.name,
            cancellable: false,
        });

        // 在原 onProgress 回调外再喂一份给 task：phase 作为 subtitle，进度算成 0..100。
        const wrappedProgress: ProgressCallback = (phase, current, total) => {
            const pct = total > 0 ? Math.round((current / total) * 100) : undefined;
            task.update(pct, phase);
            onProgress?.(phase, current, total);
        };

        wrappedProgress('上传视频', 0, 100);
        console.log(`[FrameExtractor] 上传视频: ${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(1)}MB)`);

        try {
            const uploadResult = await this.uploadVideo(videoFile, targetFps, wrappedProgress);
            const { sessionId, metadata } = uploadResult;

            console.log(`[FrameExtractor] fast_ffmpeg_mode (on-demand): sessionId=${sessionId}, 总帧数=${metadata.totalFrames}`);

            task.complete();
            return {
                fps: metadata.fps,
                duration: metadata.duration,
                totalFrames: metadata.totalFrames,
                width: metadata.width,
                height: metadata.height,
                sessionId,
            };
        } catch (err) {
            task.fail(err);
            throw err;
        }
    }

    // ── 上传视频 ────────────────────────────────────────────────────────────

    static async uploadVideo(
        videoFile: File,
        targetFps: number = 0,
        onProgress?: ProgressCallback,
    ): Promise<{ sessionId: string; metadata: FrameExtractionResult }> {

        const formData = new FormData();
        formData.append('file', videoFile, videoFile.name);
        formData.append('fps', targetFps.toString());

        const response = await axios.post(`${getApiBase()}/upload-video`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 600000,
            onUploadProgress: onProgress ? (e) => {
                if (e.total) {
                    onProgress('上传视频', Math.round((e.loaded / e.total) * 100), 100);
                }
            } : undefined,
        });

        const {sessionId, metadata} = response.data || {};
        if (typeof sessionId !== 'string' || !sessionId || !metadata ||
            !['fps', 'duration', 'width', 'height', 'totalFrames'].every(key =>
                Number.isFinite(metadata[key]) && metadata[key] > 0) ||
            !Number.isInteger(metadata.totalFrames)) {
            throw new Error('视频元数据无效 / Invalid video metadata');
        }
        return {sessionId, metadata};
    }

    // ── 按需取帧 ────────────────────────────────────────────────────────────

    /**
     * 从后端按范围获取帧（GET /frames/{sessionId}?start=N&count=M）
     */
    static async fetchFrameRange(
        sessionId: string,
        start: number,
        count: number,
        onProgress?: ProgressCallback,
    ): Promise<File[]> {

        let response;
        try {
            response = await axios.get(`${getApiBase()}/frames/${sessionId}`, {
                params: { start, count },
                responseType: 'arraybuffer',
                timeout: 150000,
            });
        } catch (err) {
            if (axios.isAxiosError(err) && err.response?.status === 404) {
                throw new SessionExpiredError(sessionId);
            }
            throw err;
        }

        // 解析 metadata
        const metadataHeader = response.headers['x-frame-metadata'];
        let metadata: {startFrame: number; batchFrames: number};
        try { metadata = JSON.parse(metadataHeader); }
        catch { throw new Error('帧元数据无效 / Invalid frame metadata'); }

        // 解压 ZIP（Web Worker，避免阻塞主线程）
        const entries = await unzipInWorker(response.data as ArrayBuffer);
        const indices = entries.map(entry => Number(/^frame_(\d+)\.jpg$/.exec(entry.name)?.[1]));
        if (!metadata || metadata.startFrame !== start || metadata.batchFrames !== entries.length ||
            entries.length === 0 || entries.length > count ||
            indices.some((index, i) => !Number.isSafeInteger(index) || index < 1 || index !== indices[0] + i)) {
            throw new Error('帧数据缺失或顺序不一致，请重试 / Missing or misaligned frames; retry');
        }

        const frames: File[] = [];
        for (let i = 0; i < entries.length; i++) {
            const globalIndex = start + i;
            const file = new File(
                [entries[i].blob],
                `frame_${String(globalIndex).padStart(6, '0')}.jpg`,
                { type: 'image/jpeg' }
            );
            frames.push(file);

            if (onProgress && i % 10 === 0) {
                onProgress('解压帧', i + 1, entries.length);
            }
        }

        return frames;
    }
}
