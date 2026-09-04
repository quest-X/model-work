import {ISize} from '../../interfaces/ISize';
import {GeneralActionTypes, ProjectData} from './types';
import {Action} from '../Actions';
import {PopupWindowType} from '../../data/enums/PopupWindowType';
import {CustomCursorStyle} from '../../data/enums/CustomCursorStyle';
import {ContextType} from '../../data/enums/ContextType';
import {Language} from '../../data/LanguageConfig';

export function updateWindowSize(windowSize: ISize): GeneralActionTypes {
    return {
        type: Action.UPDATE_WINDOW_SIZE,
        payload: {
            windowSize,
        },
    };
}

export function updateActivePopupType(
    activePopupType: PopupWindowType,
    activePopupNodeId: string | null = null,
    activePopupNodeName: string | null = null,
    activePopupNodeRemote = false,
): GeneralActionTypes {
    return {
        type: Action.UPDATE_ACTIVE_POPUP_TYPE,
        payload: {
            activePopupType,
            activePopupNodeId,
            activePopupNodeName,
            activePopupNodeRemote,
        }
    }
}

export function updateCustomCursorStyle(customCursorStyle: CustomCursorStyle): GeneralActionTypes {
    return {
        type: Action.UPDATE_CUSTOM_CURSOR_STYLE,
        payload: {
            customCursorStyle,
        }
    }
}

export function updateActiveContext(activeContext: ContextType): GeneralActionTypes {
    return {
        type: Action.UPDATE_CONTEXT,
        payload: {
            activeContext,
        },
    };
}

export function updatePreventCustomCursorStatus(preventCustomCursor: boolean): GeneralActionTypes {
    return {
        type: Action.UPDATE_PREVENT_CUSTOM_CURSOR_STATUS,
        payload: {
            preventCustomCursor,
        },
    };
}

export function updateImageDragModeStatus(imageDragMode: boolean): GeneralActionTypes {
    return {
        type: Action.UPDATE_IMAGE_DRAG_MODE_STATUS,
        payload: {
            imageDragMode,
        },
    };
}

export function updateSmartAnnotationActiveStatus(smartAnnotationActive: boolean): GeneralActionTypes {
    return {
        type: Action.UPDATE_SMART_ANNOTATION_ACTIVE_STATUS,
        payload: {
            smartAnnotationActive,
        },
    };
}

export function updateSamNegativeMode(samNegativeMode: boolean): GeneralActionTypes {
    return {
        type: Action.UPDATE_SAM_NEGATIVE_MODE,
        payload: { samNegativeMode },
    };
}

export function updateTrackingModeStatus(trackingMode: boolean): GeneralActionTypes {
    return {
        type: Action.UPDATE_TRACKING_MODE_STATUS,
        payload: {
            trackingMode,
        },
    };
}

export function updateTrackingInProgressStatus(trackingInProgress: boolean): GeneralActionTypes {
    return {
        type: Action.UPDATE_TRACKING_IN_PROGRESS_STATUS,
        payload: {
            trackingInProgress,
        },
    };
}

export function updateProjectData(projectData: ProjectData): GeneralActionTypes {
    return {
        type: Action.UPDATE_PROJECT_DATA,
        payload: {
            projectData,
        },
    };
}

export function updateZoom(zoom: number): GeneralActionTypes {
    return {
        type: Action.UPDATE_ZOOM,
        payload: {
            zoom,
        },
    };
}

export function updatePerClassColorationStatus(enablePerClassColoration: boolean): GeneralActionTypes {
    return {
        type: Action.UPDATE_ENABLE_PER_CLASS_COLORATION_STATUS,
        payload: {
            enablePerClassColoration,
        },
    };
}

export function updateEraserMode(eraserMode: boolean): GeneralActionTypes {
    return {
        type: Action.UPDATE_ERASER_MODE,
        payload: {
            eraserMode,
        },
    };
}

export function updateEraserFineMode(eraserFineMode: boolean): GeneralActionTypes {
    return {
        type: Action.UPDATE_ERASER_FINE_MODE,
        payload: {
            eraserFineMode,
        },
    };
}

export function updateLanguage(language: Language): GeneralActionTypes {
    return {
        type: Action.UPDATE_LANGUAGE,
        payload: {
            language,
        },
    };
}
