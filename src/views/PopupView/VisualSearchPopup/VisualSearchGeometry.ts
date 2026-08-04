import {ImageData} from '../../../store/labels/types';
import {QueryGeometryInput} from '../../../services/QuerySnapshotService';
import {VisualSearchQueryKind} from '../../../store/visualSearch/types';
import {selectedVisualSearchMaskGroup} from '../../../utils/VisualSearchMaskProvenance';

export interface EditorVisualSearchQuery {
    kind: VisualSearchQueryKind;
    geometry: QueryGeometryInput;
    annotationId: string | null;
    labelId: string | null;
}

export const deriveEditorVisualSearchQuery = (
    image: ImageData | null,
    activeLabelId: string | null,
): EditorVisualSearchQuery => {
    if (!image || !activeLabelId) {
        return {kind: 'image', geometry: {kind: 'image'}, annotationId: null, labelId: null};
    }
    const rectangle = image.labelRects.find(item =>
        item.id === activeLabelId && !item.isPrompt);
    if (rectangle) {
        const {x, y, width, height} = rectangle.rect;
        return {
            kind: 'bbox',
            geometry: {kind: 'bbox', bbox: [x, y, x + width, y + height]},
            annotationId: rectangle.id,
            labelId: rectangle.labelId,
        };
    }
    const polygon = image.labelPolygons.find(item => item.id === activeLabelId);
    if (polygon) {
        const group = selectedVisualSearchMaskGroup(image.labelPolygons, polygon);
        const polygons = group
            ? group.map(component => component.label.vertices.map(point =>
                [point.x, point.y] as [number, number]))
            : [polygon.vertices.map(point => [point.x, point.y] as [number, number])];
        return {
            kind: 'mask',
            geometry: {
                kind: 'mask',
                polygons,
            },
            annotationId: polygon.id,
            labelId: polygon.labelId,
        };
    }
    return {kind: 'image', geometry: {kind: 'image'}, annotationId: null, labelId: null};
};

export const visualSearchKindLabel = (
    kind: VisualSearchQueryKind,
    chinese: boolean,
): string => {
    const labels: Record<VisualSearchQueryKind, [string, string]> = {
        image: ['整图', 'Image'],
        bbox: ['框选', 'BBox'],
        mask: ['掩码', 'Mask'],
    };
    return labels[kind][chinese ? 0 : 1];
};
