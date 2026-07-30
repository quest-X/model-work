import { Action } from '../Actions';
import { AIActionTypes, RoboflowAPIDetails, SegmentationResult } from './types';

export function updateSuggestedLabelList(labelList: string[]): AIActionTypes {
    return {
        type: Action.UPDATE_SUGGESTED_LABEL_LIST,
        payload: {
            labelList,
        }
    }
}

export function updateRejectedSuggestedLabelList(labelList: string[]): AIActionTypes {
    return {
        type: Action.UPDATE_REJECTED_SUGGESTED_LABEL_LIST,
        payload: {
            labelList,
        }
    }
}

export function updateDisabledAIFlag(isAIDisabled: boolean): AIActionTypes {
    return {
        type: Action.UPDATE_DISABLED_AI_FLAG,
        payload: {
            isAIDisabled,
        }
    }
}

export function updateRoboflowAPIDetails(roboflowAPIDetails: RoboflowAPIDetails): AIActionTypes {
    return {
        type: Action.UPDATE_ROBOFLOW_API_DETAILS,
        payload: {
            roboflowAPIDetails
        }
    }
}

export function updateFullImageInferenceStatus(isFullImageInferenceInProgress: boolean): AIActionTypes {
    return {
        type: Action.UPDATE_FULL_IMAGE_INFERENCE_STATUS,
        payload: {
            isFullImageInferenceInProgress
        }
    }
}

export function toggleImageAILabelsVisibility(imageId: string): AIActionTypes {
    return {
        type: Action.TOGGLE_IMAGE_AI_LABELS_VISIBILITY,
        payload: {
            imageId
        }
    }
}

export function updateSegmentationResults(segmentationResults: SegmentationResult[], imageId?: string): AIActionTypes {
    return {
        type: Action.UPDATE_SEGMENTATION_RESULTS,
        payload: {
            segmentationResults,
            imageId
        }
    }
}

export function removeSegmentationResultsByClassNames(classNames: string[]): AIActionTypes {
    return {
        type: Action.REMOVE_SEGMENTATION_RESULTS_BY_CLASS_NAMES,
        payload: {
            classNames
        }
    }
}

export function toggleImageSegmentationLabelsVisibility(imageId: string): AIActionTypes {
    return {
        type: Action.TOGGLE_IMAGE_SEGMENTATION_LABELS_VISIBILITY,
        payload: {
            imageId
        }
    }
}

export function addInferenceHistory(imageId: string, detectedCount: number, success: boolean = true, type: 'detection' | 'segmentation' = 'detection'): AIActionTypes {
    return {
        type: Action.ADD_INFERENCE_HISTORY,
        payload: {
            imageId,
            timestamp: Date.now(),
            detectedCount,
            success,
            type
        }
    }
}
