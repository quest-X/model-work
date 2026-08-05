import {
    LabelsActionTypes,
    ImageData,
    LabelName,
    VisualSearchBBoxAcceptance,
    VisualSearchMaskAcceptance,
} from './types';
import {Action} from '../Actions';
import {LabelType} from '../../data/enums/LabelType';

export function updateActiveImageIndex(activeImageIndex: number): LabelsActionTypes {
    return {
        type: Action.UPDATE_ACTIVE_IMAGE_INDEX,
        payload: {
            activeImageIndex,
        },
    };
}

export function updateActiveLabelNameId(activeLabelNameId: string): LabelsActionTypes {
    return {
        type: Action.UPDATE_ACTIVE_LABEL_NAME_ID,
        payload: {
            activeLabelNameId,
        },
    };
}

export function updateActiveLabelId(activeLabelId: string): LabelsActionTypes {
    return {
        type: Action.UPDATE_ACTIVE_LABEL_ID,
        payload: {
            activeLabelId,
        },
    };
}

export function updateHighlightedLabelId(highlightedLabelId: string): LabelsActionTypes {
    return {
        type: Action.UPDATE_HIGHLIGHTED_LABEL_ID,
        payload: {
            highlightedLabelId,
        },
    };
}

export function updateActiveLabelType(activeLabelType: LabelType): LabelsActionTypes {
    return {
        type: Action.UPDATE_ACTIVE_LABEL_TYPE,
        payload: {
            activeLabelType,
        },
    };
}

export function updateActiveLabelViewType(activeLabelViewType: LabelType): LabelsActionTypes {
    return {
        type: Action.UPDATE_ACTIVE_LABEL_VIEW_TYPE,
        payload: {
            activeLabelViewType,
        },
    };
}

export function updateImageDataById(id: string, newImageData: ImageData): LabelsActionTypes {
    return {
        type: Action.UPDATE_IMAGE_DATA_BY_ID,
        payload: {
            id,
            newImageData
        },
    };
}

export function addImageData(imageData: ImageData[]): LabelsActionTypes {
    return {
        type: Action.ADD_IMAGES_DATA,
        payload: {
            imageData,
        },
    };
}

export function updateImageData(imageData: ImageData[]): LabelsActionTypes {
    return {
        type: Action.UPDATE_IMAGES_DATA,
        payload: {
            imageData,
        },
    };
}

export function updateLabelNames(labels: LabelName[]): LabelsActionTypes {
    return {
        type: Action.UPDATE_LABEL_NAMES,
        payload: {
            labels
        }
    }
}

export function updateFirstLabelCreatedFlag(firstLabelCreatedFlag: boolean): LabelsActionTypes {
    return {
        type: Action.UPDATE_FIRST_LABEL_CREATED_FLAG,
        payload: {
            firstLabelCreatedFlag
        }
    }
}

export function selectAllImages(selectAll: boolean): LabelsActionTypes {
    return {
        type: Action.SELECT_ALL_IMAGES,
        payload: {
            selectAll
        }
    }
}

export function toggleImageSelection(imageId: string): LabelsActionTypes {
    return {
        type: Action.TOGGLE_IMAGE_SELECTION,
        payload: {
            imageId
        }
    }
}

export function selectImageRange(startIndex: number, endIndex: number): LabelsActionTypes {
    return {
        type: Action.SELECT_IMAGE_RANGE,
        payload: {
            startIndex,
            endIndex
        }
    }
}

export function deleteImageById(id: string): LabelsActionTypes {
    return {
        type: Action.DELETE_IMAGE_BY_ID,
        payload: { id }
    }
}

export function deleteSelectedImages(): LabelsActionTypes {
    return {
        type: Action.DELETE_SELECTED_IMAGES,
        payload: {}
    }
}

export function acceptVisualSearchBBox(
    acceptance: VisualSearchBBoxAcceptance,
): LabelsActionTypes {
    return {
        type: Action.ACCEPT_VISUAL_SEARCH_BBOX,
        payload: acceptance,
    };
}

export function acceptVisualSearchMask(
    acceptance: VisualSearchMaskAcceptance,
): LabelsActionTypes {
    return {
        type: Action.ACCEPT_VISUAL_SEARCH_MASK,
        payload: acceptance,
    };
}
