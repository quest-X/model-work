import {
    normalizeVisualSearchResultItem,
    VisualSearchAPIError,
} from '../ai/VisualSearchAPI';
import {VisualSearchResultItem} from '../store/visualSearch/types';
import {getExtensionEngineBaseUrl} from '../utils/DefaultBackendUrl';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type SeedPolarity = 'positive' | 'negative';
export type SeedCandidateStatus = 'candidate' | 'accepted' | 'rejected';

export interface VisualSearchSeedNode {
    seedId: string;
    parentSeedId: string | null;
    resultId: string | null;
    polarity: SeedPolarity;
    trust: number;
    generation: number;
    assetId: string | null;
    regionId: string | null;
}

export interface VisualSearchSeedCandidate {
    resultId: string;
    item: VisualSearchResultItem;
    positiveScore: number;
    negativeScore: number;
    fusedScore: number;
    discoveredBy: string[];
    firstGeneration: number;
    status: SeedCandidateStatus;
}

export interface VisualSearchSeedEvidence {
    seedId: string;
    polarity: SeedPolarity;
    trust: number;
    candidateK: number;
    searchedAt: string;
    items: VisualSearchResultItem[];
}

export interface VisualSearchSeedGraph {
    graphId: string;
    rootTaskId: string;
    collection: string;
    queryKind: 'bbox' | 'mask';
    profileId: string;
    collectionRevision: string;
    topK: number;
    candidateK: number;
    negativeWeight: number;
    generation: number;
    seeds: VisualSearchSeedNode[];
    candidates: VisualSearchSeedCandidate[];
    evidence: VisualSearchSeedEvidence[];
    createdAt: string;
    updatedAt: string;
}

export interface SeedGraphExpandSelection {
    acceptResultIds: string[];
    rejectResultIds: string[];
    candidateK?: number;
    negativeWeight?: number;
}

export interface VisualSearchSeedGraphRunner {
    create(taskId: string, topK?: number, candidateK?: number): Promise<VisualSearchSeedGraph>;
    expand(graphId: string, selection: SeedGraphExpandSelection): Promise<VisualSearchSeedGraph>;
}

interface SeedGraphServiceOptions {
    baseUrl?: string | (() => string);
    fetchImpl?: FetchLike;
}

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : {};

const stringValue = (value: unknown, fallback = ''): string =>
    typeof value === 'string' ? value : fallback;

const numberValue = (value: unknown, fallback = 0): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const stringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];

const seedGraphKind = (graph: JsonRecord): 'bbox' | 'mask' =>
    graph.query_kind === 'mask' || graph.queryKind === 'mask' ? 'mask' : 'bbox';

const normalizeSeedGraph = (value: unknown): VisualSearchSeedGraph => {
    const graph = record(value);
    const rawSeeds = Array.isArray(graph.seeds) ? graph.seeds : [];
    const rawCandidates = Array.isArray(graph.candidates) ? graph.candidates : [];
    const rawEvidence = Array.isArray(graph.evidence) ? graph.evidence : [];
    const graphId = stringValue(graph.graph_id ?? graph.graphId);
    if (!graphId) throw new Error('Seed graph response is missing graph_id');
    return {
        graphId,
        rootTaskId: stringValue(graph.root_task_id ?? graph.rootTaskId),
        collection: stringValue(graph.collection),
        queryKind: seedGraphKind(graph),
        profileId: stringValue(graph.profile_id ?? graph.profileId),
        collectionRevision: stringValue(
            graph.collection_revision ?? graph.collectionRevision,
        ),
        topK: numberValue(graph.top_k ?? graph.topK),
        candidateK: numberValue(graph.candidate_k ?? graph.candidateK),
        negativeWeight: numberValue(
            graph.negative_weight ?? graph.negativeWeight,
            0.35,
        ),
        generation: numberValue(graph.generation),
        seeds: rawSeeds.map(seedValue => {
            const seed = record(seedValue);
            return {
                seedId: stringValue(seed.seed_id ?? seed.seedId),
                parentSeedId: stringValue(
                    seed.parent_seed_id ?? seed.parentSeedId,
                    '',
                ) || null,
                resultId: stringValue(seed.result_id ?? seed.resultId, '') || null,
                polarity: seed.polarity === 'negative' ? 'negative' : 'positive',
                trust: numberValue(seed.trust),
                generation: numberValue(seed.generation),
                assetId: stringValue(seed.asset_id ?? seed.assetId, '') || null,
                regionId: stringValue(seed.region_id ?? seed.regionId, '') || null,
            };
        }),
        candidates: rawCandidates.map((candidateValue, index) => {
            const candidate = record(candidateValue);
            const status = candidate.status === 'accepted' || candidate.status === 'rejected'
                ? candidate.status
                : 'candidate';
            const item = normalizeVisualSearchResultItem(candidate.item, index);
            return {
                resultId: stringValue(
                    candidate.result_id ?? candidate.resultId,
                    item.resultId,
                ),
                item,
                positiveScore: numberValue(
                    candidate.positive_score ?? candidate.positiveScore,
                ),
                negativeScore: numberValue(
                    candidate.negative_score ?? candidate.negativeScore,
                ),
                fusedScore: numberValue(candidate.fused_score ?? candidate.fusedScore),
                discoveredBy: stringList(
                    candidate.discovered_by ?? candidate.discoveredBy,
                ),
                firstGeneration: numberValue(
                    candidate.first_generation ?? candidate.firstGeneration,
                ),
                status,
            };
        }),
        evidence: rawEvidence.map(evidenceValue => {
            const evidence = record(evidenceValue);
            const rawItems = Array.isArray(evidence.items) ? evidence.items : [];
            return {
                seedId: stringValue(evidence.seed_id ?? evidence.seedId),
                polarity: evidence.polarity === 'negative' ? 'negative' : 'positive',
                trust: numberValue(evidence.trust),
                candidateK: numberValue(evidence.candidate_k ?? evidence.candidateK),
                searchedAt: stringValue(evidence.searched_at ?? evidence.searchedAt),
                items: rawItems.map((item, index) =>
                    normalizeVisualSearchResultItem(item, index)),
            };
        }),
        createdAt: stringValue(graph.created_at ?? graph.createdAt),
        updatedAt: stringValue(graph.updated_at ?? graph.updatedAt),
    };
};

const readGraph = async (response: Response): Promise<VisualSearchSeedGraph> => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const root = record(body);
        const detailValue = root.detail ?? root.error ?? root;
        const detail = record(detailValue);
        const message = typeof detailValue === 'string'
            ? detailValue
            : stringValue(detail.message ?? detail.detail, `HTTP ${response.status}`);
        throw new VisualSearchAPIError(
            message,
            response.status,
            stringValue(detail.code) || undefined,
            detailValue,
        );
    }
    return normalizeSeedGraph(body);
};

export class VisualSearchSeedGraphService implements VisualSearchSeedGraphRunner {
    constructor(private readonly options: SeedGraphServiceOptions = {}) {}

    public create(
        taskId: string,
        topK?: number,
        candidateK?: number,
    ): Promise<VisualSearchSeedGraph> {
        return this.request(`/tasks/${encodeURIComponent(taskId)}/seed-graph`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({top_k: topK, candidate_k: candidateK}),
        });
    }

    public expand(
        graphId: string,
        selection: SeedGraphExpandSelection,
    ): Promise<VisualSearchSeedGraph> {
        return this.request(`/seed-graphs/${encodeURIComponent(graphId)}/expand`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                accept_result_ids: selection.acceptResultIds,
                reject_result_ids: selection.rejectResultIds,
                candidate_k: selection.candidateK,
                negative_weight: selection.negativeWeight,
            }),
        });
    }

    private request(path: string, init: RequestInit): Promise<VisualSearchSeedGraph> {
        const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
        return fetchImpl(this.endpoint(path), init).then(readGraph);
    }

    private endpoint(path: string): string {
        const configured = this.options.baseUrl;
        const base = typeof configured === 'function'
            ? configured()
            : configured ?? `${getExtensionEngineBaseUrl()}/vector_db`;
        return `${base.replace(/\/+$/, '')}${path}`;
    }
}

export const visualSearchSeedGraphService = new VisualSearchSeedGraphService();
