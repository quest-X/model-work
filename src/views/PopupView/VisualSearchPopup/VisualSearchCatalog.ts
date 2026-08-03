import {getExtensionEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import {VisualSearchQueryKind, VisualSearchRevision} from '../../../store/visualSearch/types';

export type VisualSearchGranularity = VisualSearchQueryKind;

interface RawFeatureProfile {
    profile_id?: string;
    model?: string;
    model_revision?: string | null;
    granularity?: VisualSearchGranularity;
}

interface RawVisualSearchCollection {
    name?: string;
    display_name?: string;
    scene_name?: string;
    target_name?: string;
    version?: number;
    granularity?: VisualSearchGranularity;
    mode?: 'images' | 'objects';
    count?: number;
    profile_id?: string;
    model_revision?: string | null;
    profile?: RawFeatureProfile | null;
    collection_revision?: VisualSearchRevision | null;
    dataset_id?: string | null;
    dataset_revision?: VisualSearchRevision | null;
    compatible?: boolean;
    compatibility_reason?: string | null;
}

export interface VisualSearchCollection {
    name: string;
    displayName: string;
    sceneName: string;
    targetName: string;
    version: number;
    granularity: VisualSearchGranularity;
    count: number;
    profileId: string;
    modelName: string;
    modelRevision: string | null;
    collectionRevision: VisualSearchRevision | null;
    datasetId: string | null;
    datasetRevision: VisualSearchRevision | null;
    compatible: boolean;
    compatibilityReason: string | null;
}

const nonEmpty = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null;

const revision = (value: unknown): VisualSearchRevision | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return nonEmpty(value);
};

const collectionGranularity = (
    raw: RawVisualSearchCollection,
): VisualSearchGranularity | null => {
    if (raw.granularity) return raw.granularity;
    if (raw.profile?.granularity) return raw.profile.granularity;
    if (raw.mode === 'images') return 'image';
    if (raw.mode === 'objects') return 'bbox';
    return null;
};

export const normalizeVisualSearchCollection = (
    raw: RawVisualSearchCollection,
): VisualSearchCollection | null => {
    const name = nonEmpty(raw.name);
    const profileId = nonEmpty(raw.profile?.profile_id) ?? nonEmpty(raw.profile_id);
    if (!name || !profileId) return null;
    const granularity = collectionGranularity(raw);
    if (!granularity) return null;
    const displayName = nonEmpty(raw.display_name) ?? name;
    return {
        name,
        displayName,
        sceneName: nonEmpty(raw.scene_name) ?? 'Default scene',
        targetName: nonEmpty(raw.target_name) ?? displayName,
        version: Number.isFinite(raw.version) ? Math.max(1, raw.version as number) : 1,
        granularity,
        count: Number.isFinite(raw.count) ? Math.max(0, raw.count as number) : 0,
        profileId,
        modelName: nonEmpty(raw.profile?.model) ?? '',
        modelRevision: nonEmpty(raw.profile?.model_revision) ?? nonEmpty(raw.model_revision),
        collectionRevision: revision(raw.collection_revision),
        datasetId: nonEmpty(raw.dataset_id),
        datasetRevision: revision(raw.dataset_revision),
        compatible: raw.compatible === true,
        compatibilityReason: nonEmpty(raw.compatibility_reason),
    };
};

const responseError = async (response: Response): Promise<Error> => {
    const body = await response.json().catch(() => ({})) as {
        detail?: string | {message?: string};
    };
    const detail = body.detail;
    const message = typeof detail === 'string'
        ? detail
        : detail?.message ?? `HTTP ${response.status}`;
    return new Error(message);
};

export const loadVisualSearchCollections = async (
    signal?: AbortSignal,
): Promise<VisualSearchCollection[]> => {
    const response = await fetch(`${getExtensionEngineBaseUrl()}/vector_db/collections`, {signal});
    if (!response.ok) throw await responseError(response);
    const body = await response.json().catch(() => ({})) as {
        collections?: RawVisualSearchCollection[];
    };
    if (!Array.isArray(body.collections)) return [];
    return body.collections
        .map(normalizeVisualSearchCollection)
        .filter((item): item is VisualSearchCollection => item !== null);
};

export const collectionSupportsQuery = (
    collection: VisualSearchCollection,
    kind: VisualSearchQueryKind,
): boolean =>
    collection.granularity === kind &&
    collection.compatible &&
    collection.count > 0;

export const visualSearchCollectionLabel = (
    collection: VisualSearchCollection,
): string =>
    `${collection.sceneName} / ${collection.targetName} / v${collection.version} · ${collection.profileId}`;
