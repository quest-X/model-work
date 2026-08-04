import {LabelPolygon} from '../store/labels/types';
import {
    VISUAL_SEARCH_MASK_LIMITS,
    VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
} from '../store/visualSearch/types';
import {sha256HexFallback} from './Sha256';

export interface VisualSearchMaskComponentProvenance {
    schemaVersion: 1;
    clientJobId: string;
    backendJobId: string;
    resultId: string;
    componentIndex: number;
    componentCount: number;
    assetId: string;
    geometrySha256: string;
    rasterizerRevision: typeof VISUAL_SEARCH_MASK_RASTERIZER_REVISION;
    regionId: string | null;
    datasetId: string;
    datasetRevision: string | number;
    verticesSignature: string;
}

export interface ValidatedVisualSearchMaskComponent {
    label: LabelPolygon;
    provenance: VisualSearchMaskComponentProvenance;
}

const objectValue = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;

const nonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

const validRevision = (value: unknown): value is string | number =>
    (typeof value === 'string' && value.trim().length > 0) ||
    (typeof value === 'number' && Number.isFinite(value));

const asciiBytes = (value: string): Uint8Array => Uint8Array.from(
    value,
    character => character.charCodeAt(0),
);

export const visualSearchVerticesSignature = (
    vertices: ReadonlyArray<Readonly<{x: number; y: number}>>,
): string => {
    if (vertices.length < 3 ||
        vertices.length > VISUAL_SEARCH_MASK_LIMITS.maxVerticesPerPolygon ||
        vertices.some(point => !Number.isInteger(point.x) || !Number.isInteger(point.y) ||
            point.x < 0 || point.y < 0)) {
        throw new Error('Invalid visual-search mask component vertices');
    }
    const canonical = JSON.stringify(vertices.map(point => [point.x, point.y]));
    return sha256HexFallback(asciiBytes(canonical));
};

const rawVisualSearch = (label: LabelPolygon): Record<string, unknown> | null => {
    const extra = objectValue(label.extra);
    if (!extra || !Object.prototype.hasOwnProperty.call(extra, 'visualSearch')) return null;
    const provenance = objectValue(extra.visualSearch);
    if (!provenance) throw new Error('Invalid visual-search mask provenance');
    return provenance;
};

const validComponentNumbers = (componentIndex: unknown, componentCount: unknown): boolean =>
    Number.isInteger(componentIndex) && (componentIndex as number) >= 0 &&
    Number.isInteger(componentCount) && (componentCount as number) > 0 &&
    (componentCount as number) <= VISUAL_SEARCH_MASK_LIMITS.maxPolygons &&
    (componentIndex as number) < (componentCount as number);

const validIdentityFields = (raw: Record<string, unknown>): boolean =>
    raw.schemaVersion === 1 &&
    nonEmptyString(raw.clientJobId) &&
    nonEmptyString(raw.backendJobId) &&
    nonEmptyString(raw.resultId) &&
    nonEmptyString(raw.assetId) &&
    nonEmptyString(raw.datasetId) &&
    validRevision(raw.datasetRevision);

const validGeometryFields = (raw: Record<string, unknown>): boolean =>
    typeof raw.geometrySha256 === 'string' && /^[0-9a-f]{64}$/.test(raw.geometrySha256) &&
    raw.rasterizerRevision === VISUAL_SEARCH_MASK_RASTERIZER_REVISION &&
    (raw.regionId === null || raw.regionId === undefined || nonEmptyString(raw.regionId)) &&
    typeof raw.verticesSignature === 'string' && /^[0-9a-f]{64}$/.test(raw.verticesSignature);

export const parseVisualSearchMaskComponent = (
    label: LabelPolygon,
): ValidatedVisualSearchMaskComponent | null => {
    const raw = rawVisualSearch(label);
    if (!raw) return null;
    const componentIndex = raw.componentIndex;
    const componentCount = raw.componentCount;
    const regionId = raw.regionId;
    if (!validIdentityFields(raw) ||
        !validGeometryFields(raw) ||
        !validComponentNumbers(componentIndex, componentCount)) {
        throw new Error('Invalid visual-search mask provenance');
    }
    const expectedId = `visual-search:${raw.backendJobId}:${raw.resultId}:mask:${componentIndex}`;
    if (label.id !== expectedId || visualSearchVerticesSignature(label.vertices) !== raw.verticesSignature) {
        throw new Error('Visual-search mask component vertices no longer match their geometry SHA');
    }
    return {
        label,
        provenance: {
            schemaVersion: 1,
            clientJobId: raw.clientJobId as string,
            backendJobId: raw.backendJobId as string,
            resultId: raw.resultId as string,
            componentIndex: componentIndex as number,
            componentCount: componentCount as number,
            assetId: raw.assetId as string,
            geometrySha256: raw.geometrySha256 as string,
            rasterizerRevision: raw.rasterizerRevision as
                typeof VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
            regionId: regionId === undefined ? null : regionId as string | null,
            datasetId: raw.datasetId as string,
            datasetRevision: raw.datasetRevision as string | number,
            verticesSignature: raw.verticesSignature as string,
        },
    };
};

const sameRevision = (left: string | number, right: string | number): boolean =>
    String(left) === String(right);

const sameGroupIdentity = (
    left: VisualSearchMaskComponentProvenance,
    right: VisualSearchMaskComponentProvenance,
): boolean =>
    left.clientJobId === right.clientJobId &&
    left.backendJobId === right.backendJobId &&
    left.resultId === right.resultId &&
    left.assetId === right.assetId &&
    left.geometrySha256 === right.geometrySha256 &&
    left.rasterizerRevision === right.rasterizerRevision &&
    left.regionId === right.regionId &&
    left.datasetId === right.datasetId &&
    sameRevision(left.datasetRevision, right.datasetRevision) &&
    left.componentCount === right.componentCount;

export const validateVisualSearchMaskGroup = (
    components: ReadonlyArray<ValidatedVisualSearchMaskComponent>,
): ValidatedVisualSearchMaskComponent[] => {
    if (components.length === 0) throw new Error('Visual-search mask group is empty');
    const reference = components[0];
    const componentCount = reference.provenance.componentCount;
    let totalVertices = 0;
    const byIndex = new Map<number, ValidatedVisualSearchMaskComponent>();
    components.forEach(component => {
        if (!sameGroupIdentity(reference.provenance, component.provenance) ||
            reference.label.labelId !== component.label.labelId) {
            throw new Error('Inconsistent visual-search mask group provenance or label');
        }
        const index = component.provenance.componentIndex;
        if (byIndex.has(index)) throw new Error('Duplicate visual-search mask component index');
        totalVertices += component.label.vertices.length;
        if (totalVertices > VISUAL_SEARCH_MASK_LIMITS.maxTotalVertices) {
            throw new Error('Visual-search mask group exceeds the total vertex limit');
        }
        byIndex.set(index, component);
    });
    if (byIndex.size !== componentCount) {
        throw new Error('Incomplete visual-search mask group components');
    }
    const ordered: ValidatedVisualSearchMaskComponent[] = [];
    for (let index = 0; index < componentCount; index += 1) {
        const component = byIndex.get(index);
        if (!component) throw new Error('Incomplete visual-search mask group components');
        ordered.push(component);
    }
    return ordered;
};

export const selectedVisualSearchMaskGroup = (
    labels: ReadonlyArray<LabelPolygon>,
    selected: LabelPolygon,
): ValidatedVisualSearchMaskComponent[] | null => {
    const selectedComponent = parseVisualSearchMaskComponent(selected);
    if (!selectedComponent) return null;
    const selectedProvenance = selectedComponent.provenance;
    const candidates = labels.filter(label => {
        if (label.id === selected.id) return true;
        const raw = rawVisualSearch(label);
        return raw?.backendJobId === selectedProvenance.backendJobId &&
            raw.resultId === selectedProvenance.resultId;
    }).map(label => parseVisualSearchMaskComponent(label) as ValidatedVisualSearchMaskComponent);
    return validateVisualSearchMaskGroup(candidates);
};

export const allVisualSearchMaskGroups = (
    labels: ReadonlyArray<LabelPolygon>,
): ValidatedVisualSearchMaskComponent[][] => {
    const groups = new Map<string, ValidatedVisualSearchMaskComponent[]>();
    labels.forEach(label => {
        const component = parseVisualSearchMaskComponent(label);
        if (!component) return;
        const provenance = component.provenance;
        const key = `${provenance.backendJobId}\u0000${provenance.resultId}`;
        const group = groups.get(key) ?? [];
        group.push(component);
        groups.set(key, group);
    });
    const validated: ValidatedVisualSearchMaskComponent[][] = [];
    groups.forEach(group => validated.push(validateVisualSearchMaskGroup(group)));
    return validated;
};
