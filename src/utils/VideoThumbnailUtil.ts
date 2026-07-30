import {ISize} from '../interfaces/ISize';

export const VIDEO_THUMBNAIL_MAX_EDGE = 200;

export const getVideoThumbnailSize = (
    width: number,
    height: number,
    maxEdge: number = VIDEO_THUMBNAIL_MAX_EDGE,
): ISize => {
    if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        !Number.isFinite(maxEdge) ||
        width <= 0 ||
        height <= 0 ||
        maxEdge <= 0
    ) {
        return {width: 1, height: 1};
    }
    const scale = Math.min(maxEdge / width, maxEdge / height, 1);
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
};
