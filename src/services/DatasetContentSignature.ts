import {ImageData} from '../store/labels/types';

/**
 * Only include data that is persisted by DataBatchSyncService.
 *
 * Image decoding, selection and workspace hydration may replace ImageData
 * objects without changing the server dataset. Those UI-only changes must not
 * make a freshly opened server snapshot look dirty.
 */
export const getDatasetContentSignature = (imagesData: ImageData[]): string =>
    JSON.stringify(imagesData.map(image => ({
        id: image.id,
        file: [
            image.fileData.name,
            image.fileData.size,
            image.fileData.lastModified,
        ],
        rects: image.labelRects
            .filter(rect => !rect.isPrompt)
            .map(rect => [
                rect.labelId,
                rect.rect.x,
                rect.rect.y,
                rect.rect.width,
                rect.rect.height,
            ]),
        polygons: image.labelPolygons.map(polygon => [
            polygon.labelId,
            polygon.vertices.map(vertex => [vertex.x, vertex.y]),
        ]),
    })));
