import {Action} from '../Actions';

// 推理结果格式（兼容检测和分割结果的统一格式）
export interface SegmentationResult {
    class_id: number;
    class_name: string;
    confidence: number;
    info?: {
        id: number;
        name: string;
        confidence: number;
    };
    bbox: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        width: number;
        height: number;
    };
    mask: {
        area: number;
        mask_data?: [number, number][];
    } | null;
}

export type RoboflowAPIDetails = {
    status: boolean,
    model: string,
    key: string
}

export type AIState = {
    // ROBOFLOW API
    roboflowAPIDetails: RoboflowAPIDetails;

    // GENERAL
    suggestedLabelList: string[];
    rejectedSuggestedLabelList: string[];
    isAIDisabled: boolean;

    // FULL IMAGE INFERENCE STATE
    isFullImageInferenceInProgress: boolean;

    // SEGMENTATION/DETECTION RESULTS
    segmentationResults: SegmentationResult[]; // 全局推理结果（保留用于兼容）
    imageSegmentationResults: Map<string, SegmentationResult[]>; // 按图像ID存储推理结果

    // AI LABELS VISIBILITY STATE - 每张图片���立
    imageAIStates: Map<string, {
        aiLabelsVisible: boolean; // 检测标签是否显示（默认false闭眼）
        segmentationLabelsVisible: boolean; // 分割标签是否显示
        inferenceHistory: Array<{
            timestamp: number;    // 推理时间戳
            detectedCount: number; // 检测到的对象数量
            success: boolean;     // 推理是否成功
            type: 'detection' | 'segmentation'; // 推理类型
        }>;
    }>;
}

interface UpdateSuggestedLabelList {
    type: typeof Action.UPDATE_SUGGESTED_LABEL_LIST;
    payload: {
        labelList: string[];
    }
}

interface UpdateRejectedSuggestedLabelList {
    type: typeof Action.UPDATE_REJECTED_SUGGESTED_LABEL_LIST;
    payload: {
        labelList: string[];
    }
}

interface UpdateDisabledAIFlag {
    type: typeof Action.UPDATE_DISABLED_AI_FLAG;
    payload: {
        isAIDisabled: boolean;
    }
}

interface UpdateRoboflowAPIDetails {
    type: typeof Action.UPDATE_ROBOFLOW_API_DETAILS;
    payload: {
        roboflowAPIDetails: RoboflowAPIDetails
    }
}

interface UpdateFullImageInferenceStatus {
    type: typeof Action.UPDATE_FULL_IMAGE_INFERENCE_STATUS;
    payload: {
        isFullImageInferenceInProgress: boolean;
    }
}

interface ToggleImageAILabelsVisibility {
    type: typeof Action.TOGGLE_IMAGE_AI_LABELS_VISIBILITY;
    payload: {
        imageId: string;
    }
}

interface ToggleImageSegmentationLabelsVisibility {
    type: typeof Action.TOGGLE_IMAGE_SEGMENTATION_LABELS_VISIBILITY;
    payload: {
        imageId: string;
    }
}

interface AddInferenceHistory {
    type: typeof Action.ADD_INFERENCE_HISTORY;
    payload: {
        imageId: string;
        timestamp: number;
        detectedCount: number;
        success: boolean;
        type: 'detection' | 'segmentation';
    }
}

interface UpdateSegmentationResults {
    type: typeof Action.UPDATE_SEGMENTATION_RESULTS;
    payload: {
        segmentationResults: SegmentationResult[];
        imageId?: string; // 关联的图像ID
    }
}

interface RemoveSegmentationResultsByClassNames {
    type: typeof Action.REMOVE_SEGMENTATION_RESULTS_BY_CLASS_NAMES;
    payload: {
        classNames: string[];
    }
}

export type AIActionTypes = UpdateSuggestedLabelList
    | UpdateRejectedSuggestedLabelList
    | UpdateDisabledAIFlag
    | UpdateRoboflowAPIDetails
    | UpdateFullImageInferenceStatus
    | ToggleImageAILabelsVisibility
    | ToggleImageSegmentationLabelsVisibility
    | AddInferenceHistory
    | UpdateSegmentationResults
    | RemoveSegmentationResultsByClassNames
