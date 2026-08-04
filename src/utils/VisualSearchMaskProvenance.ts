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

const looseMaskGroupKey = (label: LabelPolygon): string | null => {
    try {
        const raw = rawVisualSearch(label);
        if (!raw) return null;
        return nonEmptyString(raw.backendJobId) && nonEmptyString(raw.resultId)
            ? JSON.stringify([raw.backendJobId, raw.resultId])
            : `invalid:${label.id}`;
    } catch {
        return `invalid:${label.id}`;
    }
};

const maskGroupsByKey = (
    labels: ReadonlyArray<LabelPolygon>,
): Map<string, LabelPolygon[]> => {
    const groups = new Map<string, LabelPolygon[]>();
    labels.forEach(label => {
        const key = looseMaskGroupKey(label);
        if (!key) return;
        const group = groups.get(key) ?? [];
        group.push(label);
        groups.set(key, group);
    });
    return groups;
};

const validCurrentMaskGroup = (labels: ReadonlyArray<LabelPolygon>): boolean => {
    try {
        const components = labels.map(label => {
            const component = parseVisualSearchMaskComponent(label);
            if (!component) throw new Error('Missing visual-search mask provenance');
            return component;
        });
        validateVisualSearchMaskGroup(components);
        return true;
    } catch {
        return false;
    }
};

const sameVertices = (left: LabelPolygon, right: LabelPolygon): boolean =>
    left.vertices.length === right.vertices.length && left.vertices.every((point, index) =>
        point.x === right.vertices[index].x && point.y === right.vertices[index].y);

const withoutVisualSearch = (label: LabelPolygon): LabelPolygon => {
    if (!label.extra || !Object.prototype.hasOwnProperty.call(label.extra, 'visualSearch')) {
        return label;
    }
    const extra = {...label.extra};
    delete extra.visualSearch;
    return {
        ...label,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
    };
};

/**
 * UPDATE_IMAGE_DATA payloads may arrive after render engines mutate Redux-owned
 * objects in place. Validate the persisted vertex signature as well as the old
 * snapshot, then atomically turn every affected component into a manual polygon.
 */
export const downgradeEditedVisualSearchMaskGroups = (
    previousLabels: ReadonlyArray<LabelPolygon>,
    nextLabels: ReadonlyArray<LabelPolygon>,
): LabelPolygon[] => {
    const previousGroups = maskGroupsByKey(previousLabels);
    const nextGroups = maskGroupsByKey(nextLabels);
    const downgradedKeys = new Set<string>();
    nextGroups.forEach((group, key) => {
        if (!validCurrentMaskGroup(group)) downgradedKeys.add(key);
    });

    const nextById = new Map(nextLabels.map(label => [label.id, label]));
    previousGroups.forEach((previousGroup, previousKey) => {
        const nextGroup = nextGroups.get(previousKey);
        const previousIds = new Set(previousGroup.map(label => label.id));
        if (nextGroup && (nextGroup.length !== previousGroup.length ||
            nextGroup.some(label => !previousIds.has(label.id)))) {
            downgradedKeys.add(previousKey);
        }
        previousGroup.forEach(previousLabel => {
            const nextLabel = nextById.get(previousLabel.id);
            if (!nextLabel) {
                if (nextGroup) downgradedKeys.add(previousKey);
                return;
            }
            const nextKey = looseMaskGroupKey(nextLabel);
            if (nextKey !== previousKey ||
                nextLabel.labelId !== previousLabel.labelId ||
                !sameVertices(previousLabel, nextLabel)) {
                downgradedKeys.add(previousKey);
                if (nextKey) downgradedKeys.add(nextKey);
            }
        });
    });

    const previousKeyById = new Map<string, string>();
    previousGroups.forEach((group, key) => {
        group.forEach(label => previousKeyById.set(label.id, key));
    });
    return nextLabels.map(label => {
        const nextKey = looseMaskGroupKey(label);
        const previousKey = previousKeyById.get(label.id);
        return (nextKey && downgradedKeys.has(nextKey)) ||
            (previousKey && downgradedKeys.has(previousKey))
            ? withoutVisualSearch(label)
            : label;
    });
};
