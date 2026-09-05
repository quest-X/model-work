/**
 * DetectSessionAPIService — streams per-frame detections from backend
 * POST /detect-session/{sessionId} (NDJSON over HTTP).
 *
 * This is the server-side-iteration replacement for the legacy video batch
 * detection loop (frontend pulls each frame ZIP → POSTs /detect → repeats):
 * one request in, one NDJSON line per frame out, all frame I/O stays on the
 * backend and inference runs in true batched forward passes. On a 1440p video
 * the legacy loop costs ~0.8 s/frame (mostly frame download round-trips);
 * the stream costs roughly backend-inference time alone.
 *
 * Modeled on TrackingAPIService (fetch + ReadableStream reader — axios would
 * buffer the entire response).
 */
import { getEngineBaseUrl } from '../utils/DefaultBackendUrl';
import { DetectionResult } from './DetectionAPIDetector';
import {consumeNDJSON} from './consumeNDJSON';

export type DetectSessionFrame = {
    frame_idx: number;
    detections?: DetectionResult[];
    error?: string;
};

export type DetectSessionParams = {
    sessionId: string;
    /** Inclusive start frame index. */
    start: number;
    /** EXCLUSIVE end frame index (backend iterates [start, end)). */
    end: number;
    /** kwargs forwarded to backend detection.detect()/detect_batch(). */
    params?: Record<string, unknown>;
    batchSize?: number;
};

export type DetectSessionCallbacks = {
    onFrame: (frame: DetectSessionFrame) => void;
    onDone: (total: number) => void;
    onError: (err: Error) => void;
};

type LineOutcome = 'continue' | 'stop';

function handleLine(line: string, cb: DetectSessionCallbacks): LineOutcome {
    if (!line) return 'continue';
    let msg: Record<string, unknown>;
    try {
        msg = JSON.parse(line);
    } catch {
        throw new Error(`Malformed detect-session response: ${line.slice(0, 100)}`);
    }
    if (!msg || typeof msg !== 'object') throw new Error('Invalid detect-session event');
    if (msg.cancelled) throw new Error('Video detection cancelled');
    const frameIdx = msg.frame_idx;
    // Stream-level error (no frame_idx) aborts the run; per-frame errors flow
    // through onFrame so one bad frame doesn't kill the batch.
    if (msg.error && typeof frameIdx !== 'number') {
        cb.onError(new Error(String(msg.error)));
        return 'stop';
    }
    if (msg.done) {
        cb.onDone(typeof msg.total === 'number' ? msg.total : 0);
        return 'stop';
    }
    if (typeof frameIdx === 'number') {
        cb.onFrame(msg as unknown as DetectSessionFrame);
    }
    return 'continue';
}

export class DetectSessionAPIService {
    /** Start a detection stream. Returns an AbortController so caller can cancel. */
    public static streamDetectSession(
        p: DetectSessionParams,
        cb: DetectSessionCallbacks,
    ): AbortController {
        const controller = new AbortController();
        const url = `${getEngineBaseUrl()}/detect-session/${p.sessionId}`;

        const run = async () => {
            let response: Response;
            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        start: p.start,
                        end: p.end,
                        ...(p.params ? { params: p.params } : {}),
                        ...(p.batchSize ? { batch_size: p.batchSize } : {}),
                    }),
                });
            } catch (e) {
                if ((e as Error)?.name !== 'AbortError') cb.onError(e as Error);
                return;
            }

            if (!response.ok || !response.body) {
                const text = await response.text().catch(() => '');
                cb.onError(new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`));
                return;
            }

            try {
                await consumeNDJSON(response.body, line => handleLine(line, cb) === 'stop');
            } catch (e) {
                if ((e as Error)?.name !== 'AbortError') cb.onError(e as Error);
            }
        };

        run();
        return controller;
    }
}
