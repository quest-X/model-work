/**
 * TrackingAPIService — streams per-frame masks from backend /track (NDJSON over HTTP).
 *
 * Uses fetch() + a ReadableStream reader (no axios) because axios buffers the
 * whole response before resolving. One POST per tracking run; the caller gets
 * an AbortController to cancel mid-stream.
 */
import { getEngineBaseUrl } from '../utils/DefaultBackendUrl';
import {consumeNDJSON} from './consumeNDJSON';

export type TrackFrameResult = {
    frame_idx: number;
    mask: [number, number][]; // polygon vertices in image-space pixels
    area: number;
    confidence: number;
};

export type StreamTrackParams = {
    sessionId: string;
    startFrame: number;
    endFrame: number;
    /** Exactly one of bbox or maskPolygons must be provided. */
    bbox?: [number, number, number, number]; // x1,y1,x2,y2 in image-space
    /** Polygon vertices from SAM annotations on seed frame.
     *  Each polygon is an array of [x,y] pairs in image-space pixels.
     *  Backend rasterizes them into a binary mask for SAM 2/3 tracking. */
    maskPolygons?: [number, number][][];
    modelName: string;
    /** When true, tracking runs from endFrame backwards to startFrame.
     *  The seed prompt is applied to endFrame (reversed clip frame 0). */
    reverse?: boolean;
    /** Mirrors /segment postprocess. Only present keys are applied; absent =
     *  use backend defaults (polygon_epsilon=2px memory baseline, others off).
     *  Caller is responsible for honoring the pipeline activation toggle. */
    postprocess?: {
        polygon_epsilon?: number;
        min_mask_area?: number;
        mask_dilate?: number;
        max_polygon_points?: number;
    };
};

export type TrackStatusMessage =
    | { status: 'clipping'; n_frames: number; message: string }
    | { status: 'preparing'; frames_to_encode: number; skip_until: number; message: string }
    | { status: 'walking'; current: number; target: number };

export type StreamTrackCallbacks = {
    onFrame: (frame: TrackFrameResult) => void;
    onDone: (total: number) => void;
    onError: (err: Error) => void;
    onStatus?: (status: TrackStatusMessage) => void;
};

export class TrackingAPIService {
    /** Start a tracking stream. Returns an AbortController so caller can cancel. */
    public static streamTrack(
        params: StreamTrackParams,
        cb: StreamTrackCallbacks,
    ): AbortController {
        const controller = new AbortController();
        const url = `${getEngineBaseUrl()}/track`;

        const run = async () => {
            let response: Response;
            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        session_id: params.sessionId,
                        start_frame: params.startFrame,
                        end_frame: params.endFrame,
                        prompt: params.maskPolygons
                            ? { mask: params.maskPolygons }
                            : { bbox: params.bbox },
                        model: params.modelName,
                        ...(params.reverse ? { reverse: true } : {}),
                        ...(params.postprocess ? { postprocess: params.postprocess } : {}),
                    }),
                });
            } catch (e: any) {
                if (e?.name !== 'AbortError') cb.onError(e as Error);
                return;
            }

            if (!response.ok || !response.body) {
                const text = await response.text().catch(() => '');
                cb.onError(new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`));
                return;
            }

            try {
                await consumeNDJSON(response.body, line => {
                    const msg = JSON.parse(line);
                    if (!msg || typeof msg !== 'object') throw new Error('Invalid tracking event');
                    if (msg.error) throw new Error(msg.error);
                    if (msg.cancelled) throw new Error('Tracking cancelled');
                    if (msg.done) { cb.onDone(msg.total ?? 0); return true; }
                    if (msg.status) cb.onStatus?.(msg as TrackStatusMessage);
                    else if (typeof msg.frame_idx === 'number') cb.onFrame(msg as TrackFrameResult);
                    return false;
                });
            } catch (e: any) {
                if (e?.name !== 'AbortError') cb.onError(e as Error);
            }
        };

        run();
        return controller;
    }
}
