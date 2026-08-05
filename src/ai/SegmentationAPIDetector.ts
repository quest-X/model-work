import axios from 'axios';
import {store} from '../index';
import {AIModelsSelector} from '../store/selectors/AIModelsSelector';
import {getDefaultCoreServiceUrl, getEngineBaseUrl} from '../utils/DefaultBackendUrl';
import {PipelineStore} from './PipelineStore';
import {ScriptStore} from './ScriptStore';

export interface SegmentationObjectInfo {
    id: number;
    name: string;
    confidence: number;
}

export interface SegmentationResult {
    info: SegmentationObjectInfo;
    bbox: [number, number, number, number]; // [x1, y1, x2, y2]
    mask: [number, number][]; // polygon vertices [[x,y], ...]
    extra?: Record<string, any>; // 自定义后处理脚本注入的额外字段（含 overlays 等）
}

export interface SegmentationAPIResponse {
    status: string;
    total: number;
    results: SegmentationResult[];
}

export interface SegmentationInferenceParams {
    conf: number;
    iou: number;
    imgsz: number;
    max_det: number;
    augment: boolean;
    agnostic_nms: boolean;
    classes: string;           // comma-separated class IDs; '' = all classes
    retina_masks: boolean;     // YOLO-seg only: use high-resolution retina masks
    imgsz_enabled: boolean;
    conf_enabled: boolean;
    iou_enabled: boolean;
    max_det_enabled: boolean;
    augment_enabled: boolean;
    agnostic_nms_enabled: boolean;
    classes_enabled: boolean;
    retina_masks_enabled: boolean;
}

export interface SegmentationPostprocessParams {
    polygon_epsilon: number;            // Douglas-Peucker 抽稀像素阈值；0 = 关闭
    min_mask_area: number;              // mask 最小像素面积；0 = 关闭
    largest_cc_only: boolean;           // 仅保留最大连通域
    mask_dilate: number;                // 形态学膨胀半径（像素）；0 = 关闭
    max_polygon_points: number;         // 最大顶点数限制；0 = 关闭
    mask_iou_threshold: number;         // 去重 IoU 阈值；0 = 关闭
    polygon_epsilon_enabled: boolean;
    min_mask_area_enabled: boolean;
    largest_cc_only_enabled: boolean;
    mask_dilate_enabled: boolean;
    max_polygon_points_enabled: boolean;
    mask_iou_threshold_enabled: boolean;
}

const INFERENCE_PARAMS_STORAGE_KEY = 'segmentationAPI.inferenceParams';
const POSTPROCESS_PARAMS_STORAGE_KEY = 'segmentationAPI.postprocessParams';
const POSTPROCESS_PARAMS_VERSION = 4; // 升版本使旧缓存失效，强制用新默认值

export const DEFAULT_SEGMENTATION_INFERENCE_PARAMS: SegmentationInferenceParams = {
    conf: 0.25,
    iou: 0.7,
    imgsz: 640,
    max_det: 300,
    augment: false,
    agnostic_nms: false,
    classes: '',
    retina_masks: false,
    imgsz_enabled: true,
    conf_enabled: true,
    iou_enabled: true,
    max_det_enabled: true,
    augment_enabled: true,
    agnostic_nms_enabled: true,
    classes_enabled: true,
    retina_masks_enabled: true,
};

export const DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS: SegmentationPostprocessParams = {
    polygon_epsilon: 1.5,
    min_mask_area: 200,
    largest_cc_only: false,
    mask_dilate: 1,
    max_polygon_points: 100,
    mask_iou_threshold: 0.5,
    polygon_epsilon_enabled: false,
    min_mask_area_enabled: true,
    largest_cc_only_enabled: false,
    mask_dilate_enabled: false,
    max_polygon_points_enabled: true,
    mask_iou_threshold_enabled: true,
};

function loadSegInferenceParams(): SegmentationInferenceParams {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(INFERENCE_PARAMS_STORAGE_KEY) : null;
        if (!raw) return { ...DEFAULT_SEGMENTATION_INFERENCE_PARAMS };
        const p = JSON.parse(raw);
        return {
            conf: typeof p.conf === 'number' ? p.conf : DEFAULT_SEGMENTATION_INFERENCE_PARAMS.conf,
            iou: typeof p.iou === 'number' ? p.iou : DEFAULT_SEGMENTATION_INFERENCE_PARAMS.iou,
            imgsz: typeof p.imgsz === 'number' ? p.imgsz : DEFAULT_SEGMENTATION_INFERENCE_PARAMS.imgsz,
            max_det: typeof p.max_det === 'number' ? p.max_det : DEFAULT_SEGMENTATION_INFERENCE_PARAMS.max_det,
            augment: typeof p.augment === 'boolean' ? p.augment : DEFAULT_SEGMENTATION_INFERENCE_PARAMS.augment,
            agnostic_nms: typeof p.agnostic_nms === 'boolean' ? p.agnostic_nms : DEFAULT_SEGMENTATION_INFERENCE_PARAMS.agnostic_nms,
            classes: typeof p.classes === 'string' ? p.classes : DEFAULT_SEGMENTATION_INFERENCE_PARAMS.classes,
            retina_masks: typeof p.retina_masks === 'boolean' ? p.retina_masks : DEFAULT_SEGMENTATION_INFERENCE_PARAMS.retina_masks,
            imgsz_enabled: p.imgsz_enabled !== false,
            conf_enabled: p.conf_enabled !== false,
            iou_enabled: p.iou_enabled !== false,
            max_det_enabled: p.max_det_enabled !== false,
            augment_enabled: p.augment_enabled !== false,
            agnostic_nms_enabled: p.agnostic_nms_enabled !== false,
            classes_enabled: p.classes_enabled !== false,
            retina_masks_enabled: p.retina_masks_enabled !== false,
        };
    } catch {
        return { ...DEFAULT_SEGMENTATION_INFERENCE_PARAMS };
    }
}

function loadSegPostprocessParams(): SegmentationPostprocessParams {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(POSTPROCESS_PARAMS_STORAGE_KEY) : null;
        if (!raw) return { ...DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS };
        const p = JSON.parse(raw);
        if (p._version !== POSTPROCESS_PARAMS_VERSION) return { ...DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS };
        return {
            polygon_epsilon: typeof p.polygon_epsilon === 'number' ? p.polygon_epsilon : DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS.polygon_epsilon,
            min_mask_area: typeof p.min_mask_area === 'number' ? p.min_mask_area : DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS.min_mask_area,
            largest_cc_only: typeof p.largest_cc_only === 'boolean' ? p.largest_cc_only : DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS.largest_cc_only,
            mask_dilate: typeof p.mask_dilate === 'number' ? p.mask_dilate : DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS.mask_dilate,
            max_polygon_points: typeof p.max_polygon_points === 'number' ? p.max_polygon_points : DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS.max_polygon_points,
            mask_iou_threshold: typeof p.mask_iou_threshold === 'number' ? p.mask_iou_threshold : DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS.mask_iou_threshold,
            polygon_epsilon_enabled: p.polygon_epsilon_enabled !== false,
            min_mask_area_enabled: p.min_mask_area_enabled !== false,
            largest_cc_only_enabled: p.largest_cc_only_enabled !== false,
            mask_dilate_enabled: p.mask_dilate_enabled !== false,
            max_polygon_points_enabled: p.max_polygon_points_enabled !== false,
            mask_iou_threshold_enabled: p.mask_iou_threshold_enabled !== false,
        };
    } catch {
        return { ...DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS };
    }
}

export class SegmentationAPIDetector {
    private static config = {
        // 默认分割 API:跟随 window.location.hostname,支持局域网跨机访问
        url: getDefaultCoreServiceUrl('/segment'),
        enabled: true
    };

    private static inferenceParams: SegmentationInferenceParams = loadSegInferenceParams();
    private static postprocessParams: SegmentationPostprocessParams = loadSegPostprocessParams();

    public static setConfig(config: { url: string; enabled: boolean }) {
        this.config = config;
    }

    public static getConfig() {
        return this.config;
    }

    public static isEnabled(): boolean {
        return this.config.enabled;
    }

    public static getInferenceParams(): SegmentationInferenceParams {
        return { ...this.inferenceParams };
    }

    public static setInferenceParams(partial: Partial<SegmentationInferenceParams>) {
        this.inferenceParams = { ...this.inferenceParams, ...partial };
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(INFERENCE_PARAMS_STORAGE_KEY, JSON.stringify(this.inferenceParams));
            }
        } catch { /* ignore */ }
    }

    public static getPostprocessParams(): SegmentationPostprocessParams {
        return { ...this.postprocessParams };
    }

    public static setPostprocessParams(partial: Partial<SegmentationPostprocessParams>) {
        this.postprocessParams = { ...this.postprocessParams, ...partial };
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(POSTPROCESS_PARAMS_STORAGE_KEY, JSON.stringify({ ...this.postprocessParams, _version: POSTPROCESS_PARAMS_VERSION }));
            }
        } catch { /* ignore */ }
    }

    private static appendPipelineParams(formData: FormData) {
        // 按 PipelineStore 阶段激活 + 各参数独立 enabled 标志双重过滤。
        const ip = this.inferenceParams;
        if (PipelineStore.isActivated('preprocess')) {
            if (ip.imgsz_enabled !== false)  formData.append('imgsz',   String(ip.imgsz));
            if (ip.augment_enabled !== false) formData.append('augment', ip.augment ? '1' : '0');
        }
        if (PipelineStore.isActivated('inference')) {
            if (ip.conf_enabled !== false)          formData.append('conf',         String(ip.conf));
            if (ip.iou_enabled !== false)           formData.append('iou',          String(ip.iou));
            if (ip.max_det_enabled !== false)       formData.append('max_det',      String(ip.max_det));
            if (ip.agnostic_nms_enabled !== false)  formData.append('agnostic_nms', ip.agnostic_nms ? '1' : '0');
            if (ip.classes_enabled !== false && ip.classes.trim())
                formData.append('classes', ip.classes.trim());
            if (ip.retina_masks_enabled !== false)  formData.append('retina_masks', ip.retina_masks ? '1' : '0');
        }
        if (PipelineStore.isActivated('postprocess')) {
            const pp = this.postprocessParams;
            if (pp.polygon_epsilon_enabled !== false)  formData.append('polygon_epsilon', String(pp.polygon_epsilon));
            if (pp.min_mask_area_enabled !== false)    formData.append('min_mask_area',   String(pp.min_mask_area));
            if (pp.largest_cc_only_enabled !== false)  formData.append('largest_cc_only', pp.largest_cc_only ? '1' : '0');
            if (pp.mask_dilate_enabled !== false && pp.mask_dilate > 0)
                formData.append('mask_dilate', String(pp.mask_dilate));
            if (pp.max_polygon_points_enabled !== false && pp.max_polygon_points > 0)
                formData.append('max_polygon_points', String(pp.max_polygon_points));
            if (pp.mask_iou_threshold_enabled === true && pp.mask_iou_threshold > 0)
                formData.append('mask_iou_threshold', String(pp.mask_iou_threshold));
        }

        // ── 自定义脚本 ──
        const sel = ScriptStore.get();
        if (PipelineStore.isActivated('preprocess') && sel.preprocess)
            formData.append('preprocess_script', sel.preprocess);
        if (PipelineStore.isActivated('postprocess') && sel.postprocess)
            formData.append('postprocess_script', sel.postprocess);
        if ((sel.preprocess || sel.postprocess) && sel.params.trim())
            formData.append('script_params', sel.params);
    }

    /**
     * 从 store 读取 activeModel 并同步到 config。
     * 检测、分割和 OCR 都由 core engine 暴露为 capability。
     */
    private static syncFromActiveModel(): { ok: boolean; reason?: string } {
        try {
            const state = store.getState();
            const active = AIModelsSelector.getActiveModelByType(state, 'core');
            if (active) {
                if (!active.url) {
                    return { ok: false, reason: `Active model "${active.name}" has no url` };
                }
                // Keep inference on the canonical engine route. In particular, a
                // same-host legacy :58600 registration must use the browser gateway
                // instead of exposing its self-signed backend certificate directly.
                const base = getEngineBaseUrl().replace(/\/+$/, '');
                this.config = { url: `${base}/segment`, enabled: true };
                return { ok: true };
            }
            if (this.config.enabled && this.config.url) return { ok: true };
            return { ok: false, reason: 'No active AI model and segmentation API not configured' };
        } catch {
            return this.config.enabled ? { ok: true } : { ok: false, reason: 'Segmentation API disabled' };
        }
    }

    /**
     * 从预先捕获的 Blob 调用分割 API
     * - 不传 prompt：全图分割（批量推理路径，原有行为）
     * - prompt.point：SAM 单点前景 prompt（智能标注 click）
     * - prompt.bbox：SAM bbox prompt（智能标注 drag）
     */
    public static async predictFromBlob(
        blob: Blob,
        filename: string = 'frame.jpg',
        prompt?: {
            bbox?: [number, number, number, number];
            // legacy single-point (kept for backward compat)
            point?: [number, number];
            pointLabel?: number;
            // multi-point support
            points?: [number, number][];
            pointLabels?: number[];
        }
    ): Promise<SegmentationResult[]> {
        // 当没有 prompt 时(批量分割路径)才从 store 同步 activeModel;
        // 带 prompt 的 SAM 智能标注保持走 config(由 LoadDetectionModelPopup 设置)。
        if (!prompt) {
            const sync = this.syncFromActiveModel();
            if (!sync.ok) {
                throw new Error(sync.reason || 'Segmentation API is disabled');
            }
        } else if (!this.config.enabled) {
            throw new Error('Segmentation API is disabled');
        }

        const formData = new FormData();
        formData.append('file', blob, filename);

        if (prompt?.points && prompt.points.length > 0) {
            // Multi-point: "x1,y1;x2,y2;..."
            formData.append('points', prompt.points.map(([x, y]) =>
                `${Math.round(x)},${Math.round(y)}`).join(';'));
            formData.append('point_labels', (prompt.pointLabels || prompt.points.map(() => 1)).join(';'));
        } else if (prompt?.point) {
            // Legacy single-point
            formData.append('points', `${Math.round(prompt.point[0])},${Math.round(prompt.point[1])}`);
            formData.append('point_labels', String(prompt.pointLabel ?? 1));
        }
        if (prompt?.bbox) {
            const [x1, y1, x2, y2] = prompt.bbox;
            formData.append('bbox', `${Math.round(x1)},${Math.round(y1)},${Math.round(x2)},${Math.round(y2)}`);
        }
        this.appendPipelineParams(formData);

        const response = await axios.post<SegmentationAPIResponse>(
            this.config.url,
            formData,
            {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 60000, // 分割比检测慢，给 60s
            }
        );

        if (response.data.status === 'success' && response.data.results) {
            return response.data.results;
        }
        throw new Error('Segmentation failed: ' + response.data.status);
    }

    /**
     * 将分割结果转换为统一的推理结果格式
     */
    /**
     * Shoelace formula: 从多边形顶点计算面积（像素²）
     */
    private static polygonArea(vertices: [number, number][]): number {
        const n = vertices.length;
        if (n < 3) return 0;
        let area = 0;
        for (let i = 0; i < n; i++) {
            const [x1, y1] = vertices[i];
            const [x2, y2] = vertices[(i + 1) % n];
            area += x1 * y2 - x2 * y1;
        }
        return Math.abs(area) / 2;
    }

    public static convertToUnifiedFormat(results: SegmentationResult[]): any[] {
        return results.map(result => ({
            class_id: result.info.id,
            class_name: result.info.name,
            confidence: result.info.confidence,
            bbox: {
                x1: result.bbox[0],
                y1: result.bbox[1],
                x2: result.bbox[2],
                y2: result.bbox[3],
                width: result.bbox[2] - result.bbox[0],
                height: result.bbox[3] - result.bbox[1]
            },
            mask: {
                area: this.polygonArea(result.mask),
                mask_data: result.mask
            }
        }));
    }

    public static async testConnection(): Promise<boolean> {
        try {
            const response = await axios.get(this.config.url.replace('/segment', '/health'), {
                timeout: 5000
            });
            return response.status === 200;
        } catch {
            return false;
        }
    }
}
