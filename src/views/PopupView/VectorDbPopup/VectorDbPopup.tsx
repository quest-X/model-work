import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import {useDropzone} from 'react-dropzone';
import {connect} from 'react-redux';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {getEngineBaseUrl, getExtensionEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import './VectorDbPopup.scss';

type Granularity = 'image' | 'bbox' | 'mask';
type WorkspaceTab = 'ingest' | 'history';
type IngestSource = 'dataset' | 'upload';

interface EmbedderStatus {
    state: string;
    progress: number;
    backend: string;
    model: string;
    dim: number | null;
    device: string | null;
    error: string | null;
}

interface StoreStatus {
    state: string;
    db_path: string;
    error: string | null;
}

interface ExtStatus {
    status: string;
    vector_store: StoreStatus;
    embedder: EmbedderStatus;
    collections_count: number;
    profiles?: Record<Granularity, FeatureProfile>;
}

interface FeatureProfile {
    profile_id: string;
    model: string;
    dimension: number;
    granularity: Granularity;
    metric: string;
}

interface CollectionInfo {
    name: string;
    display_name: string;
    dim: number;
    embedder: string;
    granularity: Granularity;
    mode?: 'objects' | 'images' | 'masks';
    count: number;
    search_count?: number;
    created_at: string;
    last_ingest_at: string | null;
    schema_version: number;
    profile_id: string;
    profile: FeatureProfile;
    library_id: string;
    target_id?: string;
    target_name?: string;
    scene_id?: string;
    scene_name?: string;
    world_id?: string | null;
    version: number;
    data_version?: number;
    active: boolean;
    index_type: string;
    index_params: Record<string, unknown>;
    compatible: boolean;
    compatibility_reason: string | null;
    quality: {
        valid_vectors?: number;
        invalid_vectors?: number;
        norm_min?: number;
        norm_max?: number;
        norm_mean?: number;
        failed_images?: number;
        skipped_images?: number;
    };
}

interface TargetGroup {
    targetId: string;
    targetName: string;
    vectorCount: number;
    versions: CollectionInfo[];
}

interface SceneGroup {
    sceneId: string;
    sceneName: string;
    vectorCount: number;
    targets: TargetGroup[];
}

interface IngestJob {
    job_id: string;
    state: string;
    data_version?: number | null;
    collection: string;
    granularity: Granularity;
    mode?: 'objects' | 'images' | 'masks';
    source: string;
    dataset_id?: string | null;
    total_images: number;
    processed_images: number;
    inserted_objects: number;
    inserted_vectors: number;
    skipped_images: number;
    failed_images: number;
    invalid_vectors: number;
    throughput_images_per_sec: number;
    eta_seconds: number | null;
    resumable: boolean;
    error: string | null;
    started_at?: string | null;
    updated_at?: string | null;
    finished_at?: string | null;
}

interface IngestJobImage {
    index: number;
    filename: string;
}

interface IngestJobImagePage {
    status: string;
    job_id: string;
    total: number;
    offset: number;
    limit: number;
    images: IngestJobImage[];
}

interface JobImageState {
    images: IngestJobImage[];
    total: number;
    loading: boolean;
    error: string | null;
}

interface ImagePreview {
    jobId: string;
    index: number;
    filename: string;
}

interface DatasetSummary {
    id: string;
    name: string;
    image_count: number;
}

interface IProps {
    language: Language;
}

type Translate = (zhText: string, enText: string) => string;

const TERMINAL_JOB_STATES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const HISTORY_IMAGE_PAGE_SIZE = 12;
const NEW_SCENE_OPTION = '__new_scene__';
const normalizeIngestSource = (
    granularity: Granularity,
    source: IngestSource,
): IngestSource => granularity === 'mask' ? 'dataset' : source;

const JOB_STATE_LABELS: Record<string, [string, string]> = {
    completed: ['版本更新', 'Version updated'],
    failed: ['版本更新失败', 'Version update failed'],
    cancelled: ['版本更新已取消', 'Version update cancelled'],
    interrupted: ['版本更新中断', 'Version update interrupted'],
    running: ['正在更新版本', 'Updating version'],
    queued: ['等待版本更新', 'Version update queued'],
};

const collectionTargetId = (collection: CollectionInfo) =>
    collection.target_id || collection.library_id || `target_${collection.name}`;

const collectionTargetName = (collection: CollectionInfo) =>
    collection.target_name || collection.display_name || collection.name;

const collectionGranularity = (collection: CollectionInfo): Granularity =>
    collection.granularity || (collection.mode === 'images'
        ? 'image'
        : collection.mode === 'masks' ? 'mask' : 'bbox');

const ingestJobSourceLabel = (item: IngestJob, t: Translate): string => {
    const fromDataset = Boolean(item.dataset_id)
        || item.source === 'dataset'
        || item.source.startsWith('dataset:');
    if (!fromDataset) return t('本地上传', 'Local upload');
    return item.dataset_id
        || item.source.replace(/^dataset:/, '')
        || t('资源中心', 'Resource Center');
};

const historyVersionName = (
    dataVersion: number | undefined,
    jobId: string,
    t: Translate,
): {name: string; identifier: string} => {
    if (dataVersion) {
        const version = `v${dataVersion}`;
        return {name: version, identifier: version};
    }
    return {name: t('这条', 'this'), identifier: jobId.slice(0, 12)};
};

const historyDeleteToken = (
    selected: CollectionInfo,
    versionIdentifier: string,
): string => [
    selected.scene_name || selected.scene_id || 'default-scene',
    selected.target_name || selected.target_id || selected.display_name,
    versionIdentifier,
].join('/');

const normalizeCollection = (collection: CollectionInfo): CollectionInfo => {
    const targetId = collectionTargetId(collection);
    const targetName = collectionTargetName(collection);
    return {
        ...collection,
        display_name: targetName,
        target_id: targetId,
        target_name: targetName,
        scene_id: collection.scene_id || 'scene_default',
        scene_name: collection.scene_name || '默认场景',
        granularity: collectionGranularity(collection),
        schema_version: collection.schema_version || 1,
        version: collection.version || 1,
        data_version: typeof collection.data_version === 'number' && Number.isFinite(collection.data_version)
            ? Math.max(0, Math.floor(collection.data_version))
            : 0,
        search_count: typeof collection.search_count === 'number' && Number.isFinite(collection.search_count)
            ? Math.max(0, collection.search_count)
            : 0,
        active: collection.active ?? true,
        compatible: collection.compatible ?? true,
        quality: collection.quality || {},
        index_type: collection.index_type || 'FLAT',
        index_params: collection.index_params || {},
    };
};

const readResponse = async <T,>(response: Response): Promise<T> => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = (body as {detail?: unknown}).detail;
        throw new Error(typeof detail === 'string' ? detail : String(response.status));
    }
    return body as T;
};

export const VectorDbPopup: React.FC<IProps> = ({language}) => {
    const zh = language === Language.CHINESE;
    const t = useCallback(
        (zhText: string, enText: string) => (zh ? zhText : enText),
        [zh],
    );
    const baseUrl = `${getExtensionEngineBaseUrl()}/vector_db`;
    const coreBaseUrl = getEngineBaseUrl();

    const [status, setStatus] = useState<ExtStatus | null>(null);
    const [backendDown, setBackendDown] = useState(false);
    const [warmingUp, setWarmingUp] = useState(false);

    const [collections, setCollections] = useState<CollectionInfo[]>([]);
    const [collectionsLoading, setCollectionsLoading] = useState(true);
    const [collectionsError, setCollectionsError] = useState<string | null>(null);
    const [selectedName, setSelectedName] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [newSceneName, setNewSceneName] = useState('');
    const [newSceneIsCustom, setNewSceneIsCustom] = useState(true);
    const [newTargetName, setNewTargetName] = useState('');
    const [createGranularity, setCreateGranularity] = useState<Granularity>('bbox');
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [versioning, setVersioning] = useState(false);

    const [activeTab, setActiveTab] = useState<WorkspaceTab>('ingest');
    const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
    const [datasetsLoading, setDatasetsLoading] = useState(true);
    const [datasetsError, setDatasetsError] = useState<string | null>(null);
    const [ingestSource, setIngestSource] = useState<IngestSource>('dataset');
    const [datasetId, setDatasetId] = useState('');
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [submittingIngest, setSubmittingIngest] = useState(false);
    const [job, setJob] = useState<IngestJob | null>(null);
    const [jobs, setJobs] = useState<IngestJob[]>([]);
    const [jobsLoading, setJobsLoading] = useState(true);
    const [jobsError, setJobsError] = useState<string | null>(null);
    const [ingestError, setIngestError] = useState<string | null>(null);
    const [deleteJobConfirmId, setDeleteJobConfirmId] = useState<string | null>(null);
    const [deleteJobConfirmationText, setDeleteJobConfirmationText] = useState('');
    const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
    const [jobDeleteError, setJobDeleteError] = useState<string | null>(null);
    const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(() => new Set());
    const [jobImages, setJobImages] = useState<Record<string, JobImageState>>({});
    const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null);

    const selected = collections.find(collection => collection.name === selectedName) || null;
    const maskDatasetOnly = selected?.granularity === 'mask';
    const hierarchy = useMemo<SceneGroup[]>(() => {
        const sceneMap = new Map<string, {
            sceneId: string;
            sceneName: string;
            vectorCount: number;
            targets: Map<string, TargetGroup>;
        }>();
        collections.forEach(collection => {
            const sceneId = collection.scene_id || 'scene_default';
            const targetId = collection.target_id || collection.library_id;
            let scene = sceneMap.get(sceneId);
            if (!scene) {
                scene = {
                    sceneId,
                    sceneName: collection.scene_name || '默认场景',
                    vectorCount: 0,
                    targets: new Map<string, TargetGroup>(),
                };
                sceneMap.set(sceneId, scene);
            }
            let target = scene.targets.get(targetId);
            if (!target) {
                target = {
                    targetId,
                    targetName: collection.target_name || collection.display_name,
                    vectorCount: 0,
                    versions: [],
                };
                scene.targets.set(targetId, target);
            }
            target.versions.push(collection);
            target.vectorCount += collection.count;
            scene.vectorCount += collection.count;
        });
        return Array.from(sceneMap.values())
            .sort((left, right) => left.sceneName.localeCompare(right.sceneName))
            .map(scene => ({
                sceneId: scene.sceneId,
                sceneName: scene.sceneName,
                vectorCount: scene.vectorCount,
                targets: Array.from(scene.targets.values())
                    .sort((left, right) => left.targetName.localeCompare(right.targetName))
                    .map(target => ({
                        ...target,
                        versions: target.versions.sort((left, right) => left.version - right.version),
                    })),
            }));
    }, [collections]);
    const totalTargets = useMemo(
        () => hierarchy.reduce((total, scene) => total + scene.targets.length, 0),
        [hierarchy],
    );
    const totalVectors = useMemo(
        () => collections.reduce((total, collection) => total + collection.count, 0),
        [collections],
    );
    const totalDataVersions = useMemo(
        () => collections.reduce((total, collection) => total + (collection.data_version || 0), 0),
        [collections],
    );
    const dataVersionLabel = (collection: CollectionInfo): string =>
        (collection.data_version || 0) > 0
            ? `v${collection.data_version}`
            : t('未入库', 'Not ingested');
    const storeBad = !!status && ['missing_dep', 'error'].includes(status.vector_store.state);
    const embedderBad = !!status && ['missing_dep', 'error'].includes(status.embedder.state);
    const embedderReady = status?.embedder.state === 'ready';
    const storeReady = status?.vector_store.state === 'ready';
    const activeJob = !!job && !TERMINAL_JOB_STATES.has(job.state);
    const selectedJobActive = activeJob && job?.collection === selected?.name;

    const refreshStatus = useCallback(async () => {
        try {
            const response = await fetch(`${baseUrl}/status`);
            const nextStatus = await readResponse<ExtStatus>(response);
            setStatus(nextStatus);
            setBackendDown(false);
        } catch {
            setBackendDown(true);
        }
    }, [baseUrl]);

    const refreshCollections = useCallback(async () => {
        setCollectionsLoading(true);
        setCollectionsError(null);
        try {
            const response = await fetch(`${baseUrl}/collections`);
            const data = await readResponse<{collections?: CollectionInfo[]}>(response);
            const nextCollections = Array.isArray(data.collections)
                ? data.collections.map(normalizeCollection)
                : [];
            setCollections(nextCollections);
            setSelectedName(current => {
                if (current && nextCollections.some(collection => collection.name === current)) return current;
                return nextCollections[0]?.name || null;
            });
        } catch (cause) {
            setCollectionsError(cause instanceof Error ? cause.message : t('集合加载失败', 'Failed to load collections'));
        } finally {
            setCollectionsLoading(false);
        }
    }, [baseUrl, t]);

    const refreshDatasets = useCallback(async () => {
        setDatasetsLoading(true);
        setDatasetsError(null);
        try {
            const response = await fetch(`${coreBaseUrl}/datasets`);
            const data = await readResponse<{datasets?: DatasetSummary[]}>(response);
            setDatasets(Array.isArray(data.datasets) ? data.datasets : []);
        } catch (cause) {
            setDatasetsError(cause instanceof Error ? cause.message : t('资源中心不可用', 'Resource Center unavailable'));
        } finally {
            setDatasetsLoading(false);
        }
    }, [coreBaseUrl, t]);

    const recoverJob = useCallback(async () => {
        setJobsLoading(true);
        setJobsError(null);
        try {
            const response = await fetch(`${baseUrl}/jobs`);
            const data = await readResponse<{jobs?: IngestJob[]}>(response);
            const nextJobs = Array.isArray(data.jobs) ? data.jobs : [];
            setJobs(nextJobs);
            const visible = nextJobs.find(item => !TERMINAL_JOB_STATES.has(item.state))
                || nextJobs.find(item => item.resumable);
            setJob(visible || null);
        } catch (cause) {
            setJobsError(cause instanceof Error ? cause.message : t('入库记录加载失败', 'Failed to load ingest history'));
        } finally {
            setJobsLoading(false);
        }
    }, [baseUrl, t]);

    const loadJobImages = useCallback(async (jobId: string, offset = 0) => {
        setJobImages(current => ({
            ...current,
            [jobId]: {
                images: offset > 0 ? current[jobId]?.images || [] : [],
                total: current[jobId]?.total || 0,
                loading: true,
                error: null,
            },
        }));
        try {
            const query = new URLSearchParams({
                offset: String(offset),
                limit: String(HISTORY_IMAGE_PAGE_SIZE),
            });
            const response = await fetch(
                `${baseUrl}/jobs/${encodeURIComponent(jobId)}/images?${query.toString()}`,
            );
            const page = await readResponse<IngestJobImagePage>(response);
            setJobImages(current => {
                const previous = offset > 0 ? current[jobId]?.images || [] : [];
                const existingIndexes = new Set(previous.map(image => image.index));
                return {
                    ...current,
                    [jobId]: {
                        images: [
                            ...previous,
                            ...page.images.filter(image => !existingIndexes.has(image.index)),
                        ],
                        total: page.total,
                        loading: false,
                        error: null,
                    },
                };
            });
        } catch (cause) {
            setJobImages(current => ({
                ...current,
                [jobId]: {
                    images: offset > 0 ? current[jobId]?.images || [] : [],
                    total: current[jobId]?.total || 0,
                    loading: false,
                    error: cause instanceof Error
                        ? cause.message
                        : t('入库图片加载失败', 'Failed to load ingest images'),
                },
            }));
        }
    }, [baseUrl, t]);

    const toggleJobImages = (jobId: string) => {
        const opening = !expandedJobIds.has(jobId);
        setExpandedJobIds(current => {
            const next = new Set(current);
            if (next.has(jobId)) next.delete(jobId);
            else next.add(jobId);
            return next;
        });
        if (opening && !jobImages[jobId]) {
            void loadJobImages(jobId);
        }
    };

    const moveImagePreview = useCallback((step: -1 | 1) => {
        setImagePreview(current => {
            if (!current) return current;
            const images = jobImages[current.jobId]?.images || [];
            const currentPosition = images.findIndex(image => image.index === current.index);
            const nextImage = images[currentPosition + step];
            if (!nextImage) return current;
            return {
                jobId: current.jobId,
                index: nextImage.index,
                filename: nextImage.filename,
            };
        });
    }, [jobImages]);

    useEffect(() => {
        refreshStatus();
        const timer = window.setInterval(refreshStatus, 5000);
        return () => window.clearInterval(timer);
    }, [refreshStatus]);

    useEffect(() => {
        refreshCollections();
        refreshDatasets();
        recoverJob();
    }, [recoverJob, refreshCollections, refreshDatasets]);

    useEffect(() => {
        if (!job || TERMINAL_JOB_STATES.has(job.state)) return undefined;
        const pollJob = async () => {
            try {
                const response = await fetch(`${baseUrl}/jobs/${encodeURIComponent(job.job_id)}`);
                if (response.status === 404) {
                    setJob(null);
                    setIngestError(t('任务状态已丢失，后端可能已重启', 'Job state was lost; the backend may have restarted'));
                    return;
                }
                const nextJob = await readResponse<IngestJob>(response);
                setJob(nextJob);
                setJobs(current => {
                    const exists = current.some(item => item.job_id === nextJob.job_id);
                    return exists
                        ? current.map(item => item.job_id === nextJob.job_id ? nextJob : item)
                        : [nextJob, ...current];
                });
                if (nextJob.state === 'completed') refreshCollections();
            } catch {
                // The status/collection banners report connectivity; keep the last job progress visible.
            }
        };
        const timer = window.setInterval(pollJob, 1000);
        return () => window.clearInterval(timer);
    }, [baseUrl, job, refreshCollections, t]);

    useEffect(() => {
        setDatasetId('');
        setPendingFiles([]);
        setIngestSource('dataset');
        setIngestError(null);
        setDeleteConfirm(false);
        setDeleteError(null);
        setDeleteJobConfirmId(null);
        setDeleteJobConfirmationText('');
        setJobDeleteError(null);
    }, [selectedName]);

    useEffect(() => {
        if (!maskDatasetOnly) return;
        setIngestSource('dataset');
        setPendingFiles([]);
    }, [maskDatasetOnly]);

    useEffect(() => {
        if (!imagePreview) return undefined;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setImagePreview(null);
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                moveImagePreview(-1);
            }
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                moveImagePreview(1);
            }
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [imagePreview, moveImagePreview]);

    useEffect(() => {
        if (!deleteJobConfirmId || deletingJobId) return undefined;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setDeleteJobConfirmId(null);
            setDeleteJobConfirmationText('');
            setJobDeleteError(null);
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [deleteJobConfirmId, deletingJobId]);

    const warmup = async () => {
        setWarmingUp(true);
        try {
            const response = await fetch(`${baseUrl}/warmup`, {method: 'POST'});
            await readResponse(response);
            await refreshStatus();
        } catch {
            await refreshStatus();
        } finally {
            setWarmingUp(false);
        }
    };

    const createTarget = async () => {
        const sceneName = newSceneName.trim();
        const targetName = newTargetName.trim();
        if (!sceneName || !targetName || creating) return;
        setCreating(true);
        setCreateError(null);
        try {
            const existingScene = hierarchy.find(scene => scene.sceneName === sceneName);
            const response = await fetch(`${baseUrl}/targets`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    scene_id: existingScene?.sceneId,
                    scene_name: sceneName,
                    target_name: targetName,
                    granularity: createGranularity,
                }),
            });
            const created = await readResponse<CollectionInfo>(response);
            setNewTargetName('');
            setShowCreate(false);
            await refreshCollections();
            setSelectedName(created.name);
        } catch (cause) {
            setCreateError(cause instanceof Error ? cause.message : t('创建失败', 'Create failed'));
        } finally {
            setCreating(false);
        }
    };

    const deleteCollection = async () => {
        if (!selected || deleting || selectedJobActive) return;
        setDeleting(true);
        setDeleteError(null);
        try {
            const response = await fetch(`${baseUrl}/collections/${encodeURIComponent(selected.name)}`, {
                method: 'DELETE',
            });
            await readResponse(response);
            setDeleteConfirm(false);
            await refreshCollections();
        } catch (cause) {
            setDeleteError(cause instanceof Error ? cause.message : t('删除失败', 'Delete failed'));
        } finally {
            setDeleting(false);
        }
    };

    const createCurrentVersion = async () => {
        if (!selected || versioning) return;
        setVersioning(true);
        setIngestError(null);
        try {
            const response = await fetch(
                `${baseUrl}/targets/${encodeURIComponent(selected.target_id || selected.library_id)}/versions`,
                {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({}),
                },
            );
            const created = await readResponse<CollectionInfo>(response);
            await refreshCollections();
            setSelectedName(created.name);
        } catch (cause) {
            setIngestError(cause instanceof Error ? cause.message : t('创建特征索引失败', 'Failed to create feature index'));
        } finally {
            setVersioning(false);
        }
    };

    const activateVersion = async () => {
        if (!selected || selected.active || versioning) return;
        setVersioning(true);
        try {
            const response = await fetch(
                `${baseUrl}/collections/${encodeURIComponent(selected.name)}/activate`,
                {method: 'POST'},
            );
            await readResponse(response);
            await refreshCollections();
        } catch (cause) {
            setIngestError(cause instanceof Error ? cause.message : t('切换特征索引失败', 'Failed to activate feature index'));
        } finally {
            setVersioning(false);
        }
    };

    const onIngestDrop = useCallback((accepted: File[]) => {
        setPendingFiles(accepted);
        setDatasetId('');
        setIngestError(null);
    }, []);

    const ingestDropzone = useDropzone({
        accept: {
            'image/*': ['.jpg', '.jpeg', '.png', '.bmp', '.webp'],
            'application/zip': ['.zip'],
            'application/x-zip-compressed': ['.zip'],
        },
        disabled: maskDatasetOnly || !embedderReady || !storeReady ||
            !selected?.compatible || activeJob || submittingIngest,
        multiple: true,
        onDrop: onIngestDrop,
    });

    const startIngest = async () => {
        if (!selected || activeJob || submittingIngest) return;
        if (selected.granularity === 'mask' && ingestSource !== 'dataset') {
            setIngestError(t(
                '分割区域只允许从资源中心读取真实 mask 标注。',
                'Segmentation masks can only ingest real mask annotations from Resource Center.',
            ));
            return;
        }
        setSubmittingIngest(true);
        setIngestError(null);
        const form = new FormData();
        form.append('granularity', selected.granularity);
        if (ingestSource === 'dataset') {
            form.append('dataset_id', datasetId);
        } else {
            pendingFiles.forEach(file => form.append('files', file));
        }
        try {
            const response = await fetch(
                `${baseUrl}/collections/${encodeURIComponent(selected.name)}/ingest`,
                {method: 'POST', body: form},
            );
            const body = await readResponse<{job_id: string}>(response);
            setPendingFiles([]);
            setDatasetId('');
            const queuedJob: IngestJob = {
                job_id: body.job_id,
                state: 'queued',
                collection: selected.name,
                granularity: selected.granularity,
                source: ingestSource,
                total_images: 0,
                processed_images: 0,
                inserted_vectors: 0,
                inserted_objects: 0,
                skipped_images: 0,
                failed_images: 0,
                invalid_vectors: 0,
                throughput_images_per_sec: 0,
                eta_seconds: null,
                resumable: false,
                error: null,
                started_at: new Date().toISOString(),
            };
            setJob(queuedJob);
            setJobs(current => [queuedJob, ...current.filter(item => item.job_id !== queuedJob.job_id)]);
        } catch (cause) {
            setIngestError(cause instanceof Error ? cause.message : t('入库请求失败', 'Ingest request failed'));
        } finally {
            setSubmittingIngest(false);
        }
    };

    const cancelIngest = async () => {
        if (!job || !activeJob) return;
        try {
            const response = await fetch(`${baseUrl}/jobs/${encodeURIComponent(job.job_id)}/cancel`, {method: 'POST'});
            await readResponse(response);
        } catch (cause) {
            setIngestError(cause instanceof Error ? cause.message : t('取消失败', 'Cancel failed'));
        }
    };

    const resumeIngest = async () => {
        if (!job || activeJob || !job.resumable) return;
        try {
            const response = await fetch(
                `${baseUrl}/jobs/${encodeURIComponent(job.job_id)}/resume`,
                {method: 'POST'},
            );
            await readResponse(response);
            const resumed = {...job, state: 'queued', error: null};
            setJob(resumed);
            setJobs(current => current.map(item => item.job_id === resumed.job_id ? resumed : item));
        } catch (cause) {
            setIngestError(cause instanceof Error ? cause.message : t('恢复失败', 'Resume failed'));
        }
    };

    const deleteHistoryJob = async (jobId: string) => {
        if (deletingJobId) return;
        setDeletingJobId(jobId);
        setJobDeleteError(null);
        try {
            const response = await fetch(
                `${baseUrl}/jobs/${encodeURIComponent(jobId)}`,
                {method: 'DELETE'},
            );
            await readResponse(response);
            setJobs(current => current.filter(item => item.job_id !== jobId));
            setJob(current => current?.job_id === jobId ? null : current);
            setExpandedJobIds(current => {
                const next = new Set(current);
                next.delete(jobId);
                return next;
            });
            setJobImages(current => {
                const next = {...current};
                delete next[jobId];
                return next;
            });
            setDeleteJobConfirmId(null);
            setDeleteJobConfirmationText('');
        } catch (cause) {
            setJobDeleteError(cause instanceof Error
                ? cause.message
                : t('版本记录删除失败', 'Failed to delete version record'));
        } finally {
            setDeletingJobId(null);
        }
    };

    const granularityLabel = (granularity: Granularity) => {
        if (granularity === 'bbox') return t('目标框', 'Bounding boxes');
        if (granularity === 'mask') return t('分割区域', 'Segmentation masks');
        return t('整张图片', 'Whole images');
    };

    const granularityIngestDescription = (granularity: Granularity) => granularity === 'mask'
        ? t('仅从资源中心读取真实分割标注，入库和检索严格保持 mask→mask。',
            'Only real Resource Center masks are accepted; ingest and retrieval remain mask→mask.')
        : t('创建时已固定，后续入库将始终使用该粒度。',
            'Fixed at creation; every ingest uses this granularity.');

    const formatDate = (value?: string | null) => {
        if (!value) return t('尚未入库', 'Never ingested');
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(zh ? 'zh-CN' : 'en-US');
    };

    const formatDuration = (item: IngestJob) => {
        if (!item.started_at) return '—';
        const started = new Date(item.started_at).getTime();
        const ended = new Date(item.finished_at || item.updated_at || Date.now()).getTime();
        if (Number.isNaN(started) || Number.isNaN(ended)) return '—';
        const seconds = Math.max(0, Math.round((ended - started) / 1000));
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        return `${minutes}m ${seconds % 60}s`;
    };

    const formatVectorNorm = (collection: CollectionInfo) => collection.quality.norm_mean != null
        ? `${collection.quality.norm_mean.toFixed(4)} (${collection.quality.norm_min?.toFixed(3)}–${collection.quality.norm_max?.toFixed(3)})`
        : '—';

    const renderVersionAction = (collection: CollectionInfo) => {
        if (collection.active || !collection.compatible) return null;
        return <button
            type='button'
            className='SecondaryButton'
            disabled={versioning}
            onClick={activateVersion}
        >{t('设为当前索引', 'Make active index')}</button>;
    };

    const renderProfileWarning = (collection: CollectionInfo) => {
        if (collection.compatible) return null;
        const compatibleSibling = collections.find(candidate =>
            collectionTargetId(candidate) === collectionTargetId(collection)
            && candidate.compatible,
        );
        return <div className='ProfileWarning' role='alert'>
            <div>
                <strong>{t('当前特征模型与这个索引不兼容', 'Current feature model is incompatible with this index')}</strong>
                <span>{collection.compatibility_reason}</span>
            </div>
            {compatibleSibling
                ? <button
                    type='button'
                    className='PrimaryButton'
                    onClick={() => setSelectedName(compatibleSibling.name)}
                >{t(`切换到兼容的 v${compatibleSibling.version}`, `Open compatible v${compatibleSibling.version}`)}</button>
                : <button type='button' className='PrimaryButton' disabled={versioning} onClick={createCurrentVersion}>
                    {versioning ? t('创建中…', 'Creating…') : t('新建当前模型索引', 'Create current-model index')}
                </button>}
        </div>;
    };

    const renderServiceNotice = () => {
        if (backendDown) {
            return <div className='ServiceNotice error' role='alert'>
                <span>{t('无法连接拓展引擎，当前仅显示上次读取的数据。', 'Cannot reach the extension engine. Showing the last loaded data.')}</span>
                <button type='button' onClick={refreshStatus}>{t('重试', 'Retry')}</button>
            </div>;
        }
        if (storeBad) {
            return <div className='ServiceNotice error' role='alert'>
                {t('向量存储不可用：', 'Vector store unavailable: ')}{status?.vector_store.error}
            </div>;
        }
        if (embedderBad) {
            return <div className='ServiceNotice error' role='alert'>
                <span>{t('特征模型不可用：', 'Feature model unavailable: ')}{status?.embedder.error}</span>
                <button type='button' disabled={warmingUp} onClick={warmup}>{t('重试加载', 'Retry loading')}</button>
            </div>;
        }
        if (status?.embedder.state === 'not_loaded') {
            return <div className='ServiceNotice info'>
                <span>{t('特征模型尚未加载。浏览集合和入库记录不受影响；生成向量需要先加载模型。',
                    'The feature model is not loaded. Browsing collections and ingest history remain available; vector ingest requires it.')}</span>
                <button type='button' disabled={warmingUp} onClick={warmup}>
                    {warmingUp ? t('正在启动…', 'Starting…') : t('加载特征模型', 'Load feature model')}
                </button>
            </div>;
        }
        if (status?.embedder.state === 'loading') {
            return <div className='ServiceNotice info' role='status'>
                {t('特征模型加载中', 'Loading feature model')}{status.embedder.progress > 0 ? ` · ${Math.round(status.embedder.progress)}%` : '…'}
            </div>;
        }
        return null;
    };

    const renderCreateTarget = () => (
        <div className='CreateCollectionCard'>
            <label className='FieldStack'>
                <span>{t('场景名称', 'Scene name')}</span>
                <select
                    autoFocus
                    value={newSceneIsCustom ? NEW_SCENE_OPTION : newSceneName}
                    onChange={event => {
                        if (event.target.value === NEW_SCENE_OPTION) {
                            setNewSceneIsCustom(true);
                            setNewSceneName('');
                            return;
                        }
                        setNewSceneIsCustom(false);
                        setNewSceneName(event.target.value);
                    }}
                >
                    {hierarchy.map(scene => (
                        <option key={scene.sceneId} value={scene.sceneName}>{scene.sceneName}</option>
                    ))}
                    <option value={NEW_SCENE_OPTION}>{t('＋ 新建场景…', '＋ New scene…')}</option>
                </select>
                {newSceneIsCustom && <input
                    autoFocus
                    value={newSceneName}
                    placeholder={t('例如：钢板产线', 'e.g. steel line')}
                    onChange={event => setNewSceneName(event.target.value)}
                />}
            </label>
            <label className='FieldStack'>
                <span>{t('目标名称', 'Target name')}</span>
                <input
                    value={newTargetName}
                    placeholder={t('例如：划痕', 'e.g. scratch')}
                    onChange={event => setNewTargetName(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') createTarget(); }}
                />
            </label>
            <fieldset className='ModePicker'>
                <legend>{t('向量单位（创建后不可修改）', 'Vector unit (immutable after creation)')}</legend>
                <button
                    type='button'
                    className={createGranularity === 'bbox' ? 'ModeOption selected' : 'ModeOption'}
                    role='radio'
                    aria-checked={createGranularity === 'bbox'}
                    onClick={() => setCreateGranularity('bbox')}
                >
                    <strong>{t('目标框', 'Bounding boxes')}</strong>
                    <span>{t('数据批次读取标注框；散图上传自动检测', 'Use batch annotations; detect objects for loose uploads')}</span>
                </button>
                <button
                    type='button'
                    className={createGranularity === 'image' ? 'ModeOption selected' : 'ModeOption'}
                    role='radio'
                    aria-checked={createGranularity === 'image'}
                    onClick={() => setCreateGranularity('image')}
                >
                    <strong>{t('整张图片', 'Whole images')}</strong>
                    <span>{t('每张图片生成一个全局向量', 'Create one global vector per image')}</span>
                </button>
                <button
                    type='button'
                    className={createGranularity === 'mask' ? 'ModeOption selected' : 'ModeOption'}
                    role='radio'
                    aria-checked={createGranularity === 'mask'}
                    onClick={() => setCreateGranularity('mask')}
                >
                    <strong>{t('分割区域', 'Segmentation masks')}</strong>
                    <span>{t('读取数据批次中的真实 mask；检索严格保持 mask→mask',
                        'Use real dataset masks; retrieval remains strictly mask→mask')}</span>
                </button>
            </fieldset>
            {createError && <div className='InlineError' role='alert'>{createError}</div>}
            <div className='InlineActions'>
                <button type='button' className='SecondaryButton' onClick={() => setShowCreate(false)}>{t('取消', 'Cancel')}</button>
                <button
                    type='button'
                    className='PrimaryButton'
                    disabled={!newSceneName.trim() || !newTargetName.trim() || creating || !storeReady || storeBad || backendDown}
                    onClick={createTarget}
                >
                    {creating ? t('创建中…', 'Creating…') : t('创建目标', 'Create target')}
                </button>
            </div>
        </div>
    );

    const renderCollections = () => (
        <aside className='CollectionsPanel'>
            <div className='PanelHeading'>
                <div>
                    <span className='Eyebrow'>{t('资源', 'Resources')}</span>
                    <strong>{t('场景 / 目标', 'Scenes / targets')}</strong>
                </div>
                <span className='CountBadge'>{totalTargets}</span>
            </div>
            <button
                type='button'
                className='NewCollectionButton'
                disabled={!storeReady || storeBad || backendDown}
                onClick={() => {
                    const willShow = !showCreate;
                    setShowCreate(willShow);
                    setCreateError(null);
                    if (!willShow) return;
                    const preferredSceneName = selected?.scene_name || hierarchy[0]?.sceneName || '';
                    setNewSceneName(preferredSceneName);
                    setNewSceneIsCustom(!preferredSceneName);
                }}
            >
                <span aria-hidden='true'>＋</span>{t('新建目标', 'New target')}
            </button>
            {showCreate && renderCreateTarget()}
            {collectionsLoading && <div className='CollectionState' role='status'>{t('正在读取目录…', 'Loading catalog…')}</div>}
            {!collectionsLoading && collectionsError && (
                <div className='CollectionState error' role='alert'>
                    <span>{collectionsError}</span>
                    <button type='button' onClick={refreshCollections}>{t('重试', 'Retry')}</button>
                </div>
            )}
            {!collectionsLoading && !collectionsError && collections.length === 0 && (
                <div className='CollectionState empty'>
                    <strong>{t('还没有目标', 'No targets yet')}</strong>
                    <span>{t('新建目标并完成首次入库后，即生成数据版本 v1。', 'Create a target and complete its first ingest to generate data version v1.')}</span>
                </div>
            )}
            <div className='HierarchyList' role='tree' aria-label={t('向量目录', 'Vector catalog')}>
                {hierarchy.map(scene => (
                    <section className='SceneGroup' role='treeitem' aria-expanded='true' key={scene.sceneId}>
                        <div className='SceneHeading'>
                            <span aria-hidden='true'>▾</span>
                            <strong title={scene.sceneName}>{scene.sceneName}</strong>
                            <small>{scene.targets.length} {t('个目标', 'targets')}</small>
                        </div>
                        <div className='TargetList' role='group'>
                            {scene.targets.map(target => (
                                <div className='TargetGroup' key={target.targetId}>
                                    <div className='TargetHeading'>
                                        <strong title={target.targetName}>{target.targetName}</strong>
                                        <span>{target.vectorCount.toLocaleString()}</span>
                                    </div>
                                    <div className='VersionList'>
                                        {target.versions.map(collection => (
                                            <button
                                                type='button'
                                                key={collection.name}
                                                className={selectedName === collection.name ? 'VersionRow selected' : 'VersionRow'}
                                                aria-current={selectedName === collection.name}
                                                onClick={() => setSelectedName(collection.name)}
                                            >
                                                <span className={`VersionDot ${collection.active ? 'active' : ''}`}/>
                                                <strong>{dataVersionLabel(collection)}</strong>
                                                <span>{granularityLabel(collection.granularity)}</span>
                                                <small>{collection.count.toLocaleString()}</small>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </aside>
    );

    const renderDatasetSource = () => (
        <div className='SourceCard'>
            <label className='FieldStack'>
                <span>{t('选择数据批次', 'Select a data batch')}</span>
                <select
                    value={datasetId}
                    disabled={datasetsLoading || !!datasetsError}
                    onChange={event => setDatasetId(event.target.value)}
                >
                    <option value=''>{datasetsLoading
                        ? t('正在读取…', 'Loading…')
                        : t('请选择一个数据集', 'Choose a dataset')}</option>
                    {datasets.map(dataset => (
                        <option key={dataset.id} value={dataset.id}>
                            {dataset.name}（{dataset.image_count}）
                        </option>
                    ))}
                </select>
            </label>
            {datasetsError && <div className='InlineError' role='alert'>
                {maskDatasetOnly
                    ? t('资源中心不可用；mask 入库需要资源中心数据批次。',
                        'Resource Center is unavailable; mask ingest requires a data batch.')
                    : t('资源中心不可用；你仍可切换到本地上传。',
                        'Resource Center is unavailable; local upload is still available.')}
                <button type='button' onClick={refreshDatasets}>{t('重试', 'Retry')}</button>
            </div>}
            {!datasetsLoading && !datasetsError && datasets.length === 0 && (
                <div className='MutedText'>{maskDatasetOnly
                    ? t('暂无数据批次，请先从文件队列同步包含分割标注的数据。',
                        'No data batches; first sync data with segmentation annotations from File Queue.')
                    : t('暂无数据批次，可从文件队列同步或改用本地上传。',
                        'No data batches; sync one from File Queue or use local upload.')}</div>
            )}
        </div>
    );

    const renderUploadSource = () => (
        <div {...ingestDropzone.getRootProps({className: `UploadZone${ingestDropzone.isDragActive ? ' active' : ''}`})}>
            <input {...ingestDropzone.getInputProps()} />
            <span className='UploadIcon' aria-hidden='true'>⇧</span>
            <strong>{pendingFiles.length > 0
                ? t(`已选择 ${pendingFiles.length} 个文件`, `${pendingFiles.length} file(s) selected`)
                : t('拖入图片或 ZIP', 'Drop images or a ZIP')}</strong>
            <span>{t('支持 JPG、PNG、BMP、WebP 与 ZIP', 'JPG, PNG, BMP, WebP and ZIP are supported')}</span>
        </div>
    );

    const renderIngest = () => {
        if (!selected) return null;
        const normalizedSource = normalizeIngestSource(selected.granularity, ingestSource);
        const noSource = normalizedSource === 'dataset' ? !datasetId : pendingFiles.length === 0;
        const disabled = !embedderReady || !storeReady || !selected.compatible
            || activeJob || submittingIngest || noSource
            || (selected.granularity === 'mask' && ingestSource !== 'dataset');
        return <div className='WorkspaceBody'>
            <div className='ImmutableModeNotice'>
                <span>{t('目标向量单位', 'Target vector unit')}</span>
                <strong>{granularityLabel(selected.granularity)}</strong>
                <small>{granularityIngestDescription(selected.granularity)}</small>
            </div>
            <div className='FormSection'>
                <span className='FormLabel'>{t('数据来源', 'Data source')}</span>
                <div className='SegmentedControl' role='tablist' aria-label={t('入库数据来源', 'Ingest source')}>
                    <button
                        type='button'
                        role='tab'
                        aria-selected={normalizedSource === 'dataset'}
                        className={normalizedSource === 'dataset' ? 'active' : ''}
                        onClick={() => { setIngestSource('dataset'); setPendingFiles([]); }}
                    >{t('资源中心', 'Resource Center')}</button>
                    <button
                        type='button'
                        role='tab'
                        aria-selected={normalizedSource === 'upload'}
                        className={normalizedSource === 'upload' ? 'active' : ''}
                        disabled={selected.granularity === 'mask'}
                        onClick={() => { setIngestSource('upload'); setDatasetId(''); }}
                    >{t('本地上传', 'Local upload')}</button>
                </div>
            </div>
            {normalizedSource === 'dataset' ? renderDatasetSource() : renderUploadSource()}
            {ingestError && <div className='InlineError' role='alert'>{ingestError}</div>}
            <button type='button' className='PrimaryButton' disabled={disabled} onClick={startIngest}>
                {submittingIngest ? t('正在提交…', 'Submitting…') : t('开始生成向量', 'Start vector ingest')}
            </button>
        </div>;
    };

    const closeDeleteHistoryDialog = () => {
        setDeleteJobConfirmId(null);
        setDeleteJobConfirmationText('');
        setJobDeleteError(null);
    };

    const renderHistoryDeleteDialog = (
        item: IngestJob,
        deleteConfirmationToken: string,
        deleteDialogTitleId: string,
        deleteConfirmationMatches: boolean,
    ) => createPortal(
        <div
            className='HistoryDeleteDialogBackdrop'
            role='presentation'
            onMouseDown={event => {
                if (event.target !== event.currentTarget || deletingJobId) return;
                closeDeleteHistoryDialog();
            }}
        >
            <section
                className='HistoryDeleteDialog'
                role='dialog'
                aria-modal='true'
                aria-labelledby={deleteDialogTitleId}
                onMouseDown={event => event.stopPropagation()}
            >
                <header>
                    <strong id={deleteDialogTitleId}>
                        {t(`删除版本 ${deleteConfirmationToken}`, `Delete version ${deleteConfirmationToken}`)}
                    </strong>
                    <button
                        type='button'
                        aria-label={t('关闭删除确认', 'Close delete confirmation')}
                        disabled={deletingJobId === item.job_id}
                        onClick={closeDeleteHistoryDialog}
                    >×</button>
                </header>
                <div className='HistoryDeleteDialogBody'>
                    <div className='HistoryDeleteTarget' aria-hidden='true'>
                        <span className='HistoryDeleteLock' />
                        <strong>{deleteConfirmationToken}</strong>
                        <small>{item.job_id}</small>
                    </div>
                    <p>{t(
                        '删除后无法恢复。此操作只删除这条版本历史记录，不会回滚或修改当前向量数据。',
                        'This cannot be undone. It removes only this version history record and does not roll back or modify current vector data.',
                    )}</p>
                    <label htmlFor='history-delete-confirmation'>
                        {t('如需确认，请在下方输入', 'To confirm, type')}{' '}
                        <code>{deleteConfirmationToken}</code>
                    </label>
                    <input
                        id='history-delete-confirmation'
                        type='text'
                        value={deleteJobConfirmationText}
                        autoFocus
                        autoComplete='off'
                        spellCheck={false}
                        aria-label={t('输入版本标识以确认删除', 'Type the version identifier to confirm deletion')}
                        onChange={event => setDeleteJobConfirmationText(event.target.value)}
                    />
                    {jobDeleteError && <span className='InlineError' role='alert'>{jobDeleteError}</span>}
                </div>
                <footer>
                    <button
                        type='button'
                        className='SecondaryButton'
                        disabled={deletingJobId === item.job_id}
                        onClick={closeDeleteHistoryDialog}
                    >{t('取消', 'Cancel')}</button>
                    <button
                        type='button'
                        className='DangerButton solid'
                        disabled={!deleteConfirmationMatches || deletingJobId === item.job_id}
                        onClick={() => deleteHistoryJob(item.job_id)}
                    >{deletingJobId === item.job_id
                            ? t('删除中…', 'Deleting…')
                            : t('删除', 'Delete')}</button>
                </footer>
            </section>
        </div>,
        document.body,
    );

    const renderHistoryImagesPanel = (
        item: IngestJob,
        panelId: string,
        imageState: JobImageState | undefined,
    ) => <div className='HistoryImagesPanel' id={panelId}>
        {imageState?.error && <div className='HistoryImagesState error'>
            <span>{imageState.error}</span>
            <button
                type='button'
                className='SecondaryButton'
                onClick={() => loadJobImages(item.job_id)}
            >{t('重试', 'Retry')}</button>
        </div>}
        {!imageState?.error && imageState?.images.length === 0 && imageState?.loading && (
            <div className='HistoryImagesState'>{t('正在加载缩略图…', 'Loading thumbnails…')}</div>
        )}
        {!imageState?.error && imageState && !imageState.loading && imageState.images.length === 0 && (
            <div className='HistoryImagesState'>{t('这条记录没有可浏览的图片。', 'No browsable images are available for this run.')}</div>
        )}
        {imageState && imageState.images.length > 0 && <div className='HistoryImageGrid'>
            {imageState.images.map(image => {
                const encodedJobId = encodeURIComponent(item.job_id);
                return <button
                    type='button'
                    className='HistoryThumbnail'
                    key={image.index}
                    aria-label={t(`放大 ${image.filename}`, `Enlarge ${image.filename}`)}
                    onClick={() => setImagePreview({
                        jobId: item.job_id,
                        index: image.index,
                        filename: image.filename,
                    })}
                >
                    <img
                        src={`${baseUrl}/jobs/${encodedJobId}/images/${image.index}/thumbnail`}
                        alt={image.filename}
                        loading='lazy'
                    />
                    <span title={image.filename}>{image.filename}</span>
                </button>;
            })}
        </div>}
        {imageState && imageState.images.length < imageState.total && (
            <button
                type='button'
                className='SecondaryButton HistoryLoadMore'
                disabled={imageState.loading}
                onClick={() => loadJobImages(item.job_id, imageState.images.length)}
            >{imageState.loading
                    ? t('加载中…', 'Loading…')
                    : t(`加载更多（${imageState.images.length}/${imageState.total}）`,
                        `Load more (${imageState.images.length}/${imageState.total})`)}</button>
        )}
    </div>;

    const renderHistoryJob = (
        item: IngestJob,
        selectedCollection: CollectionInfo,
        versionByJobId: Map<string, number>,
    ) => {
        const label = JOB_STATE_LABELS[item.state] || JOB_STATE_LABELS.queued;
        const dataVersion = versionByJobId.get(item.job_id);
        const source = ingestJobSourceLabel(item, t);
        const expanded = expandedJobIds.has(item.job_id);
        const imageState = jobImages[item.job_id];
        const imageCount = imageState?.total ?? item.total_images;
        const panelId = `ingest-images-${item.job_id}`;
        const version = historyVersionName(dataVersion, item.job_id, t);
        const deleteConfirmationToken = historyDeleteToken(selectedCollection, version.identifier);
        const deleteDialogTitleId = `delete-history-title-${item.job_id}`;
        const deleteConfirmationMatches = deleteJobConfirmationText === deleteConfirmationToken;
        return <article className={`HistoryRow ${item.state}${expanded ? ' expanded' : ''}`} key={item.job_id}>
            <div className='HistoryRowHeader'>
                <button
                    type='button'
                    className='HistorySummary'
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    aria-label={`${t(label[0], label[1])}，${expanded
                        ? t('收起入库图片', 'Hide ingest images')
                        : t(`查看 ${imageCount} 张入库图片`, `View ${imageCount} ingest images`)}`}
                    onClick={() => toggleJobImages(item.job_id)}
                >
                    <span className='HistoryState'>
                    {dataVersion
                        ? <span className='HistoryVersion'>v{dataVersion}</span>
                        : <span className='HistoryDot'/>}
                    <span>
                        <strong>{t(label[0], label[1])}</strong>
                        <small title={item.job_id}>{item.job_id.slice(0, 12)}</small>
                    </span>
                    </span>
                    <span className='HistoryMetric'>
                        <span>{t('数据来源', 'Source')}</span>
                    <strong title={source}>{source}</strong>
                    </span>
                    <span className='HistoryMetric'>
                        <span>{t('处理结果', 'Processed')}</span>
                    <strong>{item.processed_images}/{item.total_images} · {item.inserted_vectors ?? item.inserted_objects} {t('向量', 'vectors')}</strong>
                    </span>
                    <span className='HistoryMetric'>
                        <span>{t('开始时间 / 耗时', 'Started / duration')}</span>
                    <strong>{formatDate(item.started_at)} · {formatDuration(item)}</strong>
                    </span>
                    <span className='HistoryMetric anomalies'>
                        <span>{t('异常', 'Anomalies')}</span>
                    <strong>{item.failed_images} {t('失败', 'failed')} · {item.skipped_images} {t('跳过', 'skipped')} · {item.invalid_vectors} {t('无效', 'invalid')}</strong>
                    </span>
                    <span className='HistoryExpand' aria-hidden='true'>
                        <small>{imageCount} {t('张', 'images')}</small>
                        <i className='HistoryExpandIcon' />
                    </span>
                </button>
                {TERMINAL_JOB_STATES.has(item.state) && <button
                    type='button'
                    className='HistoryDeleteButton'
                    aria-label={t(`删除 ${version.name} 版本记录`, `Delete ${version.name} version record`)}
                    title={t('删除版本记录', 'Delete version record')}
                    onClick={() => {
                        setDeleteJobConfirmId(item.job_id);
                        setDeleteJobConfirmationText('');
                        setJobDeleteError(null);
                    }}
                >{t('删除', 'Delete')}</button>}
            </div>
            {deleteJobConfirmId === item.job_id && renderHistoryDeleteDialog(
                item,
                deleteConfirmationToken,
                deleteDialogTitleId,
                deleteConfirmationMatches,
            )}
            {item.error && <div className='HistoryError'>{item.error}</div>}
            {expanded && renderHistoryImagesPanel(item, panelId, imageState)}
        </article>;
    };

    const renderHistory = () => {
        if (!selected) return null;
        const selectedJobs = jobs.filter(item => item.collection === selected.name);
        const completedJobs = selectedJobs
            .filter(item => item.state === 'completed')
            .sort((left, right) => {
                const leftTime = new Date(left.finished_at || left.updated_at || left.started_at || 0).getTime();
                const rightTime = new Date(right.finished_at || right.updated_at || right.started_at || 0).getTime();
                if (leftTime !== rightTime) return leftTime - rightTime;
                return left.job_id.localeCompare(right.job_id);
            });
        const firstVisibleVersion = Math.max(
            1,
            (selected.data_version || completedJobs.length) - completedJobs.length + 1,
        );
        const versionByJobId = new Map(
            completedJobs.map((item, index) => [
                item.job_id,
                item.data_version || firstVisibleVersion + index,
            ]),
        );
        return <div className='WorkspaceBody IngestHistory'>
            <div className='HistoryHeading'>
                <div>
                    <strong>{t('入库记录', 'Ingest history')}</strong>
                    <span>{t('记录持久保存在拓展引擎中，页面刷新后仍可追溯。',
                        'Records are persisted by the extension engine and remain available after refresh.')}</span>
                </div>
                <button type='button' className='SecondaryButton' disabled={jobsLoading} onClick={recoverJob}>
                    {jobsLoading ? t('刷新中…', 'Refreshing…') : t('刷新记录', 'Refresh')}
                </button>
            </div>
            {jobsError && <div className='InlineError' role='alert'>{jobsError}</div>}
            {!jobsLoading && !jobsError && selectedJobs.length === 0 && (
                <div className='HistoryEmpty'>{t('这个目标还没有入库记录。', 'This target has no ingest history yet.')}</div>
            )}
            <div className='HistoryList'>
                {selectedJobs.map(item => renderHistoryJob(item, selected, versionByJobId))}
            </div>
        </div>;
    };

    const renderImagePreview = () => {
        if (!imagePreview) return null;
        const previewImages = jobImages[imagePreview.jobId]?.images || [];
        const previewPosition = previewImages.findIndex(image => image.index === imagePreview.index);
        const hasPrevious = previewPosition > 0;
        const hasNext = previewPosition >= 0 && previewPosition < previewImages.length - 1;
        const originalUrl = `${baseUrl}/jobs/${encodeURIComponent(imagePreview.jobId)}/images/${imagePreview.index}/original`;
        return createPortal(
            <div
                className='HistoryImagePreviewBackdrop'
                role='presentation'
                onMouseDown={() => setImagePreview(null)}
            >
                <div
                    className='HistoryImagePreviewDialog'
                    role='dialog'
                    aria-modal='true'
                    aria-label={t('入库图片预览', 'Ingest image preview')}
                    onMouseDown={event => event.stopPropagation()}
                >
                    <button
                        type='button'
                        className='HistoryImagePreviewClose'
                        aria-label={t('关闭图片预览', 'Close image preview')}
                        onClick={() => setImagePreview(null)}
                    >×</button>
                    <button
                        type='button'
                        className='HistoryImagePreviewNav previous'
                        aria-label={t('上一张', 'Previous image')}
                        disabled={!hasPrevious}
                        onClick={() => moveImagePreview(-1)}
                    ><span aria-hidden='true' /></button>
                    <button
                        type='button'
                        className='HistoryImagePreviewNav next'
                        aria-label={t('下一张', 'Next image')}
                        disabled={!hasNext}
                        onClick={() => moveImagePreview(1)}
                    ><span aria-hidden='true' /></button>
                    <img src={originalUrl} alt={imagePreview.filename}/>
                    <div className='HistoryImagePreviewCaption'>
                        <span title={imagePreview.filename}>{imagePreview.filename}</span>
                        <small>{previewPosition + 1}/{previewImages.length}</small>
                    </div>
                </div>
            </div>,
            document.body,
        );
    };

    const renderDeleteConfirmation = () => {
        if (!deleteConfirm) return null;
        return <div className='DeleteConfirm' role='alert'>
            <div>
                <strong>{t('永久删除当前向量索引？', 'Permanently delete the current vector index?')}</strong>
                <span>{t('该索引的向量与插件保存的上传副本会被删除；同一目标的其他索引和源数据不受影响。',
                    'Vectors and plugin-managed upload copies for this index will be removed; other indexes and Resource Center source data are unchanged.')}</span>
                {deleteError && <span className='InlineError'>{deleteError}</span>}
            </div>
            <div className='InlineActions'>
                <button type='button' className='SecondaryButton' onClick={() => setDeleteConfirm(false)}>{t('取消', 'Cancel')}</button>
                <button type='button' className='DangerButton solid' disabled={deleting} onClick={deleteCollection}>
                    {deleting ? t('删除中…', 'Deleting…') : t('确认删除', 'Delete')}
                </button>
            </div>
        </div>;
    };

    const renderActiveWorkspace = () => activeTab === 'ingest' ? renderIngest() : renderHistory();

    const renderSelectedCollection = () => {
        if (!selected) {
            return <div className='WorkspaceEmpty'>
                <span className='EmptyGlyph' aria-hidden='true'>◇</span>
                <strong>{t('选择或新建一个目标', 'Select or create a target')}</strong>
                <span>{t('场景管理业务上下文，目标管理检索对象；每次成功入库形成一个新的数据版本。',
                    'Scenes hold business context, targets hold retrieval subjects, and every successful ingest creates a new data version.')}</span>
            </div>;
        }
        return <section className='CollectionWorkspace'>
            <header className='CollectionHeader'>
                <div className='CollectionTitle'>
                    <div className='CollectionIdentity'>
                        <span className='Eyebrow'>
                            {selected.scene_name
                                ? `${selected.scene_name} ${t('场景', 'Scene')}`
                                : t('默认场景', 'Default scene')}
                        </span>
                        <div className='CollectionNameRow'>
                            <h3>{selected.target_name || selected.display_name}</h3>
                            <span className={`ModeBadge ${selected.granularity}`}>
                                {granularityLabel(selected.granularity)} · {dataVersionLabel(selected)}
                            </span>
                        </div>
                    </div>
                </div>
                <div className='InlineActions'>
                    {renderVersionAction(selected)}
                    <button
                        type='button'
                        className='DangerButton'
                        disabled={selectedJobActive}
                        onClick={() => { setDeleteConfirm(true); setDeleteError(null); }}
                    >{t('删除数据库', 'Delete database')}</button>
                </div>
            </header>
            <div className='MetadataGrid'>
                <div><span>{t('场景', 'Scene')}</span><strong>{selected.scene_name || t('默认场景', 'Default scene')}</strong></div>
                <div><span>{t('目标', 'Target')}</span><strong>{selected.target_name || selected.display_name}</strong></div>
                <div><span>{t('向量数量', 'Vectors')}</span><strong>{selected.count.toLocaleString()}</strong></div>
                <div><span>{t('向量维度', 'Dimensions')}</span><strong>{selected.dim}</strong></div>
                <div><span>{t('特征模型', 'Embedder')}</span><strong title={selected.embedder}>{selected.embedder}</strong></div>
                <div><span>{t('特征配置', 'Feature Profile')}</span><strong title={selected.profile_id}>{selected.profile_id}</strong></div>
                <div><span>{t('数据版本', 'Data version')}</span><strong>
                    {(selected.data_version || 0) > 0
                        ? `${dataVersionLabel(selected)} · ${selected.data_version} ${t('次成功入库', 'successful ingests')}`
                        : t('尚未入库', 'Never ingested')}
                </strong></div>
                <div><span>{t('向量索引', 'Vector index')}</span><strong>{selected.index_type}</strong></div>
                <div><span>{t('最近入库', 'Last ingest')}</span><strong>{formatDate(selected.last_ingest_at)}</strong></div>
                <div><span>{t('向量范数', 'Vector norm')}</span><strong>{formatVectorNorm(selected)}</strong></div>
                <div><span>{t('异常统计', 'Anomalies')}</span><strong>
                    {selected.quality.invalid_vectors || 0} {t('无效向量', 'invalid vectors')} ·{' '}
                    {selected.quality.failed_images || 0} {t('失败图片', 'failed images')}
                </strong></div>
                <div><span>{t('检索次数', 'Search count')}</span><strong>
                    {(selected.search_count ?? 0).toLocaleString()}
                </strong></div>
            </div>
            {renderProfileWarning(selected)}
            {renderDeleteConfirmation()}
            <div className='WorkspaceTabs' role='tablist' aria-label={t('数据操作', 'Data actions')}>
                <button
                    type='button'
                    role='tab'
                    aria-selected={activeTab === 'ingest'}
                    className={activeTab === 'ingest' ? 'active' : ''}
                    onClick={() => setActiveTab('ingest')}
                >{t('添加数据', 'Add data')}</button>
                <button
                    type='button'
                    role='tab'
                    aria-selected={activeTab === 'history'}
                    className={activeTab === 'history' ? 'active' : ''}
                    onClick={() => setActiveTab('history')}
                >{t('入库记录', 'Ingest history')}</button>
            </div>
            {renderActiveWorkspace()}
        </section>;
    };

    const renderJob = () => {
        if (!job) return null;
        const percent = job.total_images > 0
            ? Math.min(100, Math.round((job.processed_images / job.total_images) * 100))
            : 0;
        const label = JOB_STATE_LABELS[job.state] || JOB_STATE_LABELS.queued;
        return <div className={`ActivityStrip ${job.state}`} aria-live='polite'>
            <div className='ActivityMain'>
                <span className='ActivityDot'/>
                <div>
                    <strong>{t(label[0], label[1])} · {job.collection}</strong>
                    <span>
                        {job.processed_images}/{job.total_images} {t('张图片', 'images')} ·{' '}
                        {(job.inserted_vectors ?? job.inserted_objects).toLocaleString()} {t('个向量', 'vectors')}
                        {job.skipped_images > 0 && ` · ${job.skipped_images} ${t('跳过', 'skipped')}`}
                        {job.failed_images > 0 && ` · ${job.failed_images} ${t('失败', 'failed')}`}
                        {job.throughput_images_per_sec > 0 && ` · ${job.throughput_images_per_sec.toFixed(1)} img/s`}
                        {job.eta_seconds != null && job.eta_seconds > 0 && ` · ETA ${Math.ceil(job.eta_seconds)}s`}
                    </span>
                </div>
            </div>
            <div
                className='ActivityProgress'
                role='progressbar'
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={t('入库进度', 'Ingest progress')}
            ><span style={{width: `${percent}%`}}/></div>
            {job.error && <div className='InlineError'>{job.error}</div>}
            {activeJob
                ? <button type='button' className='SecondaryButton' onClick={cancelIngest}>{t('取消任务', 'Cancel job')}</button>
                : job.resumable
                    ? <button type='button' className='SecondaryButton' onClick={resumeIngest}>{t('继续任务', 'Resume job')}</button>
                    : <button type='button' className='SecondaryButton' onClick={() => setJob(null)}>{t('隐藏', 'Dismiss')}</button>}
        </div>;
    };

    const renderContent = () => (
        <div className='VectorDbPopupContent'>
            <div className='VectorDbIntro'>
                <div>
                    <span className='Eyebrow'>{t('拓展服务', 'Extension service')}</span>
                    <p>{t('按场景、目标和数据版本管理 DINO 向量，并追踪每一次入库任务与质量结果。检索功能统一放在「视觉检索」。',
                        'Manage DINO vectors by scene, target, and data version, and track every ingest run and quality result. Retrieval is unified under Visual Retrieval.')}</p>
                </div>
                <div className='ServiceChips' aria-label={t('服务概况', 'Service overview')}>
                    <span className={`ServiceChip ${storeReady ? 'ready' : 'pending'}`}>
                        <i/>{storeReady ? t('向量存储就绪', 'Store ready') : t('检查向量存储', 'Checking store')}
                    </span>
                    <span className={`ServiceChip ${embedderReady ? 'ready' : 'pending'}`}>
                        <i/>{embedderReady
                            ? `${status?.embedder.model} · ${status?.embedder.dim || '—'}d · ${status?.embedder.device || '—'}`
                            : t('特征模型未就绪', 'Embedder not ready')}
                    </span>
                </div>
            </div>
            {renderServiceNotice()}
            <div className='OverviewStats'>
                <div><span>{t('场景', 'Scenes')}</span><strong>{hierarchy.length}</strong></div>
                <div><span>{t('目标', 'Targets')}</span><strong>{totalTargets}</strong></div>
                <div><span>{t('数据版本', 'Data versions')}</span><strong>{totalDataVersions}</strong></div>
                <div><span>{t('向量总数', 'Total vectors')}</span><strong>{totalVectors.toLocaleString()}</strong></div>
            </div>
            <div className='VectorWorkspace'>
                {renderCollections()}
                {renderSelectedCollection()}
            </div>
            {renderJob()}
        </div>
    );

    return <>
        <GenericYesNoPopup
            title={t('向量数据库', 'Vector Database')}
            renderContent={renderContent}
            skipAcceptButton
            rejectLabel={t('关闭', 'Close')}
            onReject={() => PopupActions.close()}
        />
        {renderImagePreview()}
    </>;
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
});

export default connect(mapStateToProps)(VectorDbPopup);
