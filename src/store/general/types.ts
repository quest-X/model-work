import {ISize} from '../../interfaces/ISize';
import {Action} from '../Actions';
import {PopupWindowType} from '../../data/enums/PopupWindowType';
import {CustomCursorStyle} from '../../data/enums/CustomCursorStyle';
import {ContextType} from '../../data/enums/ContextType';
import {ProjectType} from '../../data/enums/ProjectType';
import {Language} from '../../data/LanguageConfig';

export type ProjectData = {
    type: ProjectType;
    name: string,
}

export type GeneralState = {
    windowSize: ISize;
    activePopupType: PopupWindowType;
    // 打开弹窗时绑定的目标节点(如远程 model-work-node)；null 表示操作本机/后端所在网络。
    activePopupNodeId: string | null;
    activePopupNodeName: string | null;
    activePopupNodeRemote: boolean;
    customCursorStyle: CustomCursorStyle;
    preventCustomCursor: boolean;
    imageDragMode: boolean;
    smartAnnotationActive: boolean;
    samNegativeMode: boolean;       // true = 负点模式；false = 正点模式（默认）
    trackingMode: boolean;
    trackingInProgress: boolean;
    eraserMode: boolean;
    eraserFineMode: boolean;
    enablePerClassColoration: boolean;
    activeContext: ContextType;
    projectData: ProjectData;
    zoom: number;
    language: Language;
}

interface UpdateProjectData {
    type: typeof Action.UPDATE_PROJECT_DATA;
    payload: {
        projectData: ProjectData;
    }
}

interface UpdateWindowSize {
    type: typeof Action.UPDATE_WINDOW_SIZE;
    payload: {
        windowSize: ISize;
    }
}

interface UpdateActivePopupType {
    type: typeof Action.UPDATE_ACTIVE_POPUP_TYPE;
    payload: {
        activePopupType: PopupWindowType;
        activePopupNodeId: string | null;
        activePopupNodeName: string | null;
        activePopupNodeRemote: boolean;
    }
}

interface UpdateCustomCursorStyle {
    type: typeof Action.UPDATE_CUSTOM_CURSOR_STYLE;
    payload: {
        customCursorStyle: CustomCursorStyle;
    }
}

interface UpdateActiveContext {
    type: typeof Action.UPDATE_CONTEXT;
    payload: {
        activeContext: ContextType;
    }
}

interface UpdatePreventCustomCursorStatus {
    type: typeof Action.UPDATE_PREVENT_CUSTOM_CURSOR_STATUS;
    payload: {
        preventCustomCursor: boolean;
    }
}

interface UpdateImageDragModeStatus {
    type: typeof Action.UPDATE_IMAGE_DRAG_MODE_STATUS;
    payload: {
        imageDragMode: boolean;
    }
}

interface UpdateSmartAnnotationActiveStatus {
    type: typeof Action.UPDATE_SMART_ANNOTATION_ACTIVE_STATUS;
    payload: {
        smartAnnotationActive: boolean;
    }
}

interface UpdateZoom {
    type: typeof Action.UPDATE_ZOOM,
    payload: {
        zoom: number;
    }
}

interface UpdatePerClassColoration {
    type: typeof Action.UPDATE_ENABLE_PER_CLASS_COLORATION_STATUS,
    payload: {
        enablePerClassColoration: boolean;
    }
}

interface UpdateLanguage {
    type: typeof Action.UPDATE_LANGUAGE,
    payload: {
        language: Language;
    }
}

interface UpdateTrackingModeStatus {
    type: typeof Action.UPDATE_TRACKING_MODE_STATUS;
    payload: {
        trackingMode: boolean;
    }
}

interface UpdateTrackingInProgressStatus {
    type: typeof Action.UPDATE_TRACKING_IN_PROGRESS_STATUS;
    payload: {
        trackingInProgress: boolean;
    }
}

interface UpdateEraserMode {
    type: typeof Action.UPDATE_ERASER_MODE;
    payload: {
        eraserMode: boolean;
    }
}

interface UpdateEraserFineMode {
    type: typeof Action.UPDATE_ERASER_FINE_MODE;
    payload: {
        eraserFineMode: boolean;
    }
}

interface UpdateSamNegativeMode {
    type: typeof Action.UPDATE_SAM_NEGATIVE_MODE;
    payload: {
        samNegativeMode: boolean;
    }
}

export type GeneralActionTypes = UpdateProjectData
    | UpdateWindowSize
    | UpdateActivePopupType
    | UpdateCustomCursorStyle
    | UpdateActiveContext
    | UpdatePreventCustomCursorStatus
    | UpdateImageDragModeStatus
    | UpdateSmartAnnotationActiveStatus
    | UpdateTrackingModeStatus
    | UpdateTrackingInProgressStatus
    | UpdateEraserMode
    | UpdateEraserFineMode
    | UpdateSamNegativeMode
    | UpdateZoom
    | UpdatePerClassColoration
    | UpdateLanguage
