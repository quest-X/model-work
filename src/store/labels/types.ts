import {IRect} from '../../interfaces/IRect';
import {Action} from '../Actions';
import {LabelType} from '../../data/enums/LabelType';
import {IPoint} from '../../interfaces/IPoint';
import {LabelStatus} from '../../data/enums/LabelStatus';
import {ILine} from '../../interfaces/ILine';

export type Annotation = {
    id: string;
    labelId: string | null;
    isVisible: boolean;
}

export type LabelRect = Annotation & {
    rect: IRect;
    isCreatedByAI: boolean;
    status: LabelStatus;
    suggestedLabel: string;
    confidence?: number; // AI 检测置信度 (0-1)
    /** SAM prompt 标记：isPrompt=true 时为临时 prompt（推理后自动清除） */
    isPrompt?: boolean;
    /** 点 prompt 类型 */
    promptLabel?: 'positive' | 'negative';
}

export type LabelPoint = Annotation & {
    point: IPoint;
    isCreatedByAI: boolean;
    status: LabelStatus;
    suggestedLabel: string;
}

export type LabelPolygon = Annotation & {
    vertices: IPoint[];
    isCreatedByAI: boolean;
    status: LabelStatus;
    suggestedLabel: string;
    confidence?: number; // AI 分割置信度 (0-1)
    trackingGroupId?: string; // 同一次目标跟踪产出的所有帧 polygon 共享此 ID
    extra?: Record<string, any>; // 自定义后处理脚本注入的字段（含 overlays 等）
}

export type LabelLine = Annotation & {
    line: ILine;
    isCreatedByAI: boolean;
    status: LabelStatus;
    suggestedLabel: string;
}

export type LabelName = {
    name: string;
    id: string;
    color?: string;
}

export type ImageData = {
    id: string;
    fileData: File;
    loadStatus: boolean;
    labelRects: LabelRect[];
    labelPoints: LabelPoint[];
    labelLines: LabelLine[];
    labelPolygons: LabelPolygon[];
    labelNameIds: string[];

    // Multi-selection support
    isSelected?: boolean;

    // ROBOFLOW API
    isVisitedByRoboflowAPI: boolean;
}

export type LabelsState = {
    activeImageIndex: number;
    activeLabelNameId: string;
    activeLabelType: LabelType;
    activeLabelViewType: LabelType; // 新增：当前查看的标签视图类型
    activeLabelId: string | null;
    highlightedLabelId: string;
    imagesData: ImageData[];
    firstLabelCreatedFlag: boolean;
    labels: LabelName[];
}

export interface VisualSearchBBoxAcceptance {
    clientJobId: string;
    backendJobId: string;
    resultId: string;
    queueItemId: string;
    datasetId: string;
    datasetRevision: string | number;
    assetId: string;
    imageId: string;
    expectedFile: File;
    labelRect: LabelRect;
}

interface UpdateActiveImageIndex {
    type: typeof Action.UPDATE_ACTIVE_IMAGE_INDEX;
    payload: {
        activeImageIndex: number;
    }
}

interface UpdateActiveLabelNameId {
    type: typeof Action.UPDATE_ACTIVE_LABEL_NAME_ID;
    payload: {
        activeLabelNameId: string;
    }
}

interface UpdateActiveLabelId {
    type: typeof Action.UPDATE_ACTIVE_LABEL_ID;
    payload: {
        activeLabelId: string;
    }
}

interface UpdateHighlightedLabelId {
    type: typeof Action.UPDATE_HIGHLIGHTED_LABEL_ID;
    payload: {
        highlightedLabelId: string;
    }
}

interface UpdateActiveLabelType {
    type: typeof Action.UPDATE_ACTIVE_LABEL_TYPE;
    payload: {
        activeLabelType: LabelType;
    }
}

interface UpdateActiveLabelViewType {
    type: typeof Action.UPDATE_ACTIVE_LABEL_VIEW_TYPE;
    payload: {
        activeLabelViewType: LabelType;
    }
}

interface UpdateImageDataById {
    type: typeof Action.UPDATE_IMAGE_DATA_BY_ID;
    payload: {
        id: string;
        newImageData: ImageData;
    }
}

interface AddImageData {
    type: typeof Action.ADD_IMAGES_DATA;
    payload: {
        imageData: ImageData[];
    }
}

interface UpdateImageData {
    type: typeof Action.UPDATE_IMAGES_DATA;
    payload: {
        imageData: ImageData[];
    }
}

interface UpdateLabelNames {
    type: typeof Action.UPDATE_LABEL_NAMES;
    payload: {
        labels: LabelName[];
    }
}

interface UpdateFirstLabelCreatedFlag {
    type: typeof Action.UPDATE_FIRST_LABEL_CREATED_FLAG;
    payload: {
        firstLabelCreatedFlag: boolean;
    }
}

interface SelectAllImages {
    type: typeof Action.SELECT_ALL_IMAGES;
    payload: {
        selectAll: boolean;
    }
}

interface ToggleImageSelection {
    type: typeof Action.TOGGLE_IMAGE_SELECTION;
    payload: {
        imageId: string;
    }
}

interface SelectImageRange {
    type: typeof Action.SELECT_IMAGE_RANGE;
    payload: {
        startIndex: number;
        endIndex: number;
    }
}

interface DeleteImageById {
    type: typeof Action.DELETE_IMAGE_BY_ID;
    payload: {
        id: string;
    }
}

interface AcceptVisualSearchBBox {
    type: typeof Action.ACCEPT_VISUAL_SEARCH_BBOX;
    payload: VisualSearchBBoxAcceptance;
}

export type LabelsActionTypes = UpdateActiveImageIndex
    | UpdateActiveLabelNameId
    | UpdateActiveLabelType
    | UpdateActiveLabelViewType
    | UpdateImageDataById
    | AddImageData
    | UpdateImageData
    | UpdateLabelNames
    | UpdateActiveLabelId
    | UpdateHighlightedLabelId
    | UpdateFirstLabelCreatedFlag
    | SelectAllImages
    | ToggleImageSelection
    | SelectImageRange
    | DeleteImageById
    | AcceptVisualSearchBBox
