import {LabelsActionTypes, LabelsState, ImageData} from './types';
import {Action} from '../Actions';
import {LabelType} from '../../data/enums/LabelType';
import {downgradeEditedVisualSearchMaskGroups} from '../../utils/VisualSearchMaskProvenance';

const initialState: LabelsState = {
    activeImageIndex: null,
    activeLabelNameId: null,
    activeLabelType: LabelType.ALL, // 默认使用全部标签工具
    activeLabelViewType: LabelType.ALL, // 默认显示全部标签视图
    activeLabelId: null,
    highlightedLabelId: null,
    imagesData: [],
    firstLabelCreatedFlag: false,
    labels: []
};

const sanitizeImageUpdate = (
    previous: ImageData | undefined,
    next: ImageData,
): ImageData => ({
    ...next,
    labelPolygons: downgradeEditedVisualSearchMaskGroups(
        previous?.labelPolygons ?? [],
        next.labelPolygons ?? [],
    ),
});

// This legacy reducer owns the complete label action surface.
// eslint-disable-next-line complexity
export function labelsReducer(
    state = initialState,
    action: LabelsActionTypes
): LabelsState {
    switch (action.type) {
        case Action.UPDATE_ACTIVE_IMAGE_INDEX: {
            return {
                ...state,
                activeImageIndex: action.payload.activeImageIndex
            }
        }
        case Action.UPDATE_ACTIVE_LABEL_NAME_ID: {
            return {
                ...state,
                activeLabelNameId: action.payload.activeLabelNameId
            }
        }
        case Action.UPDATE_ACTIVE_LABEL_ID: {
            return {
                ...state,
                activeLabelId: action.payload.activeLabelId
            }
        }
        case Action.UPDATE_HIGHLIGHTED_LABEL_ID: {
            return {
                ...state,
                highlightedLabelId: action.payload.highlightedLabelId
            }
        }
        case Action.UPDATE_ACTIVE_LABEL_TYPE: {
            return {
                ...state,
                activeLabelType: action.payload.activeLabelType
            }
        }
        case Action.UPDATE_ACTIVE_LABEL_VIEW_TYPE: {
            return {
                ...state,
                activeLabelViewType: action.payload.activeLabelViewType
            }
        }
        case Action.UPDATE_IMAGE_DATA_BY_ID: {
            const previous = state.imagesData.find(imageData => imageData.id === action.payload.id);
            const nextImageData = sanitizeImageUpdate(previous, action.payload.newImageData);
            return {
                ...state,
                imagesData: state.imagesData.map((imageData: ImageData) =>
                    imageData.id === action.payload.id ? nextImageData : imageData
                )
            }
        }
        case Action.ADD_IMAGES_DATA: {
            return {
                ...state,
                imagesData: state.imagesData.concat(action.payload.imageData)
            }
        }
        case Action.UPDATE_IMAGES_DATA: {
            const previousById = new Map(state.imagesData.map(imageData => [imageData.id, imageData]));
            return {
                ...state,
                imagesData: action.payload.imageData.map(imageData =>
                    sanitizeImageUpdate(previousById.get(imageData.id), imageData))
            }
        }
        case Action.UPDATE_LABEL_NAMES: {
            return {
                ...state,
                labels: action.payload.labels
            }
        }
        case Action.UPDATE_FIRST_LABEL_CREATED_FLAG: {
            return {
                ...state,
                firstLabelCreatedFlag: action.payload.firstLabelCreatedFlag
            }
        }
        case Action.SELECT_ALL_IMAGES: {
            return {
                ...state,
                imagesData: state.imagesData.map((imageData: ImageData) => ({
                    ...imageData,
                    isSelected: action.payload.selectAll
                }))
            }
        }
        case Action.TOGGLE_IMAGE_SELECTION: {
            return {
                ...state,
                imagesData: state.imagesData.map((imageData: ImageData) =>
                    imageData.id === action.payload.imageId
                        ? { ...imageData, isSelected: !imageData.isSelected }
                        : imageData
                )
            }
        }
        case Action.SELECT_IMAGE_RANGE: {
            const { startIndex, endIndex } = action.payload;
            const minIndex = Math.min(startIndex, endIndex);
            const maxIndex = Math.max(startIndex, endIndex);
            
            return {
                ...state,
                imagesData: state.imagesData.map((imageData: ImageData, index: number) => ({
                    ...imageData,
                    isSelected: index >= minIndex && index <= maxIndex
                }))
            }
        }
        case Action.DELETE_IMAGE_BY_ID: {
            const { id } = action.payload;
            const newImagesData = state.imagesData.filter((img: ImageData) => img.id !== id);
            const deletedIndex = state.imagesData.findIndex((img: ImageData) => img.id === id);
            let newActiveIndex = state.activeImageIndex;
            if (newImagesData.length === 0) {
                newActiveIndex = null;
            } else if (deletedIndex <= state.activeImageIndex) {
                newActiveIndex = Math.max(0, state.activeImageIndex - 1);
            }
            return {
                ...state,
                imagesData: newImagesData,
                activeImageIndex: newActiveIndex
            }
        }
        case Action.DELETE_SELECTED_IMAGES: {
            const newImagesData = state.imagesData.filter((img: ImageData) => !img.isSelected);
            let newActiveIndex = state.activeImageIndex;
            if (newImagesData.length === 0) {
                newActiveIndex = null;
            } else {
                const activeImage = state.imagesData[state.activeImageIndex];
                if (activeImage?.isSelected) {
                    newActiveIndex = Math.min(newImagesData.length - 1, Math.max(0, state.activeImageIndex));
                } else {
                    newActiveIndex = newImagesData.findIndex((img: ImageData) => img.id === activeImage?.id);
                    if (newActiveIndex === -1) newActiveIndex = 0;
                }
            }
            return {
                ...state,
                imagesData: newImagesData,
                activeImageIndex: newActiveIndex
            }
        }
        case Action.ACCEPT_VISUAL_SEARCH_BBOX: {
            const targetIndex = state.imagesData.findIndex(
                imageData => imageData.id === action.payload.imageId,
            );
            if (targetIndex < 0) return state;
            const target = state.imagesData[targetIndex];
            if (target.labelRects.some(rect => rect.id === action.payload.labelRect.id)) {
                return state;
            }
            const imagesData = [...state.imagesData];
            imagesData[targetIndex] = {
                ...target,
                labelRects: [...target.labelRects, action.payload.labelRect],
            };
            return {
                ...state,
                imagesData,
                activeImageIndex: targetIndex,
                activeLabelId: action.payload.labelRect.id,
                activeLabelViewType: LabelType.RECT,
                firstLabelCreatedFlag: true,
            };
        }
        case Action.ACCEPT_VISUAL_SEARCH_MASK: {
            const targetIndex = state.imagesData.findIndex(
                imageData => imageData.id === action.payload.imageId,
            );
            if (targetIndex < 0 || action.payload.labelPolygons.length === 0) return state;
            const target = state.imagesData[targetIndex];
            const acceptedIds = new Set(action.payload.labelPolygons.map(polygon => polygon.id));
            if (target.labelPolygons.some(polygon => acceptedIds.has(polygon.id))) return state;
            if (target.labelPolygons.some(polygon =>
                polygon.extra?.visualSearch?.geometrySha256 === action.payload.geometrySha256)) {
                return state;
            }
            const imagesData = [...state.imagesData];
            imagesData[targetIndex] = {
                ...target,
                labelPolygons: [...target.labelPolygons, ...action.payload.labelPolygons],
            };
            return {
                ...state,
                imagesData,
                activeImageIndex: targetIndex,
                activeLabelId: action.payload.labelPolygons[0].id,
                activeLabelViewType: LabelType.POLYGON,
                firstLabelCreatedFlag: true,
            };
        }
        default:
            return state;
    }
}
