import {GeneralActionTypes, GeneralState} from './types';
import {Action} from '../Actions';
import {CustomCursorStyle} from '../../data/enums/CustomCursorStyle';
import {ViewPointSettings} from '../../settings/ViewPointSettings';
import {ProjectType} from '../../data/enums/ProjectType';
import {Language} from '../../data/LanguageConfig';

const initialState: GeneralState = {
    windowSize: null,
    activePopupType: null,
    activePopupNodeId: null,
    activePopupNodeName: null,
    activePopupNodeRemote: false,
    customCursorStyle: CustomCursorStyle.DEFAULT,
    activeContext: null,
    preventCustomCursor: false,
    imageDragMode: false,
    smartAnnotationActive: false,
    samNegativeMode: false,
    trackingMode: false,
    trackingInProgress: false,
    eraserMode: true, // 默认激活橡皮擦工具
    eraserFineMode: true, // 默认局部擦除
    enablePerClassColoration: true,
    projectData: {
        type: ProjectType.OBJECT_DETECTION, // 默认设置为目标检测项目
        name: 'default-project',
    },
    zoom: ViewPointSettings.MIN_ZOOM,
    language: Language.CHINESE // 默认中文
};

// Idempotency guard for scalar-assignment cases: if the dispatched value
// equals the current state, return the same reference so React-Redux's
// shallow compare short-circuits the re-render. Without this, render-time
// dispatches from canvas render engines (e.g. cursor style) can trigger
// componentDidUpdate → fullRender → dispatch loops that hit React's
// "Maximum update depth exceeded" guard.
export function generalReducer(
    state = initialState,
    action: GeneralActionTypes
): GeneralState {
    switch (action.type) {
        case Action.UPDATE_WINDOW_SIZE: {
            return {
                ...state,
                windowSize: action.payload.windowSize
            }
        }
        case Action.UPDATE_ACTIVE_POPUP_TYPE: {
            if (
                state.activePopupType === action.payload.activePopupType
                && state.activePopupNodeId === action.payload.activePopupNodeId
                && state.activePopupNodeName === action.payload.activePopupNodeName
                && state.activePopupNodeRemote === action.payload.activePopupNodeRemote
            ) return state;
            return {
                ...state,
                activePopupType: action.payload.activePopupType,
                activePopupNodeId: action.payload.activePopupNodeId,
                activePopupNodeName: action.payload.activePopupNodeName,
                activePopupNodeRemote: action.payload.activePopupNodeRemote,
            }
        }
        case Action.UPDATE_CUSTOM_CURSOR_STYLE: {
            if (state.customCursorStyle === action.payload.customCursorStyle) return state;
            return {
                ...state,
                customCursorStyle: action.payload.customCursorStyle
            }
        }
        case Action.UPDATE_CONTEXT: {
            if (state.activeContext === action.payload.activeContext) return state;
            return {
                ...state,
                activeContext: action.payload.activeContext
            }
        }
        case Action.UPDATE_PREVENT_CUSTOM_CURSOR_STATUS: {
            if (state.preventCustomCursor === action.payload.preventCustomCursor) return state;
            return {
                ...state,
                preventCustomCursor: action.payload.preventCustomCursor
            }
        }
        case Action.UPDATE_IMAGE_DRAG_MODE_STATUS: {
            if (state.imageDragMode === action.payload.imageDragMode) return state;
            return {
                ...state,
                imageDragMode: action.payload.imageDragMode
            }
        }
        case Action.UPDATE_SMART_ANNOTATION_ACTIVE_STATUS: {
            if (state.smartAnnotationActive === action.payload.smartAnnotationActive) return state;
            return {
                ...state,
                smartAnnotationActive: action.payload.smartAnnotationActive
            }
        }
        case Action.UPDATE_TRACKING_MODE_STATUS: {
            if (state.trackingMode === action.payload.trackingMode) return state;
            return {
                ...state,
                trackingMode: action.payload.trackingMode
            }
        }
        case Action.UPDATE_TRACKING_IN_PROGRESS_STATUS: {
            if (state.trackingInProgress === action.payload.trackingInProgress) return state;
            return {
                ...state,
                trackingInProgress: action.payload.trackingInProgress
            }
        }
        case Action.UPDATE_ERASER_MODE: {
            if (state.eraserMode === action.payload.eraserMode) return state;
            return {
                ...state,
                eraserMode: action.payload.eraserMode,
                // 保留 eraserFineMode，使橡皮擦记住上次模式（整体/局部）
                // 这样从局部擦除切换到其他工具再切回，仍恢复局部擦除
            }
        }
        case Action.UPDATE_ERASER_FINE_MODE: {
            if (state.eraserFineMode === action.payload.eraserFineMode) return state;
            return {
                ...state,
                eraserFineMode: action.payload.eraserFineMode
            }
        }
        case Action.UPDATE_SAM_NEGATIVE_MODE: {
            if (state.samNegativeMode === action.payload.samNegativeMode) return state;
            return {
                ...state,
                samNegativeMode: action.payload.samNegativeMode
            }
        }
        case Action.UPDATE_PROJECT_DATA: {
            return {
                ...state,
                projectData: action.payload.projectData
            }
        }
        case Action.UPDATE_ZOOM: {
            if (state.zoom === action.payload.zoom) return state;
            return {
                ...state,
                zoom: action.payload.zoom
            }
        }
        case Action.UPDATE_ENABLE_PER_CLASS_COLORATION_STATUS: {
            if (state.enablePerClassColoration === action.payload.enablePerClassColoration) return state;
            return {
                ...state,
                enablePerClassColoration: action.payload.enablePerClassColoration
            }
        }
        case Action.UPDATE_LANGUAGE: {
            if (state.language === action.payload.language) return state;
            return {
                ...state,
                language: action.payload.language
            }
        }
        default:
            return state;
    }
}
