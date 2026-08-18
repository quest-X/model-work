import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import {connect} from 'react-redux';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {QueueActions} from '../../../logic/actions/QueueActions';
import {ImageRepository} from '../../../logic/imageRepository/ImageRepository';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {updateActivePopupType} from '../../../store/general/actionCreators';
import {removeQueueItem, updateQueueItem} from '../../../store/queue/actionCreators';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {ImageData, LabelName} from '../../../store/labels/types';
import {QueueDataSyncStatus, QueueItem, QueueItemType} from '../../../store/queue/types';
import {getEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import {DataBatchSyncService} from '../../../services/DataBatchSyncService';
import {TrainingDatasetSelection} from '../../../services/TrainingDatasetSelection';
import {VideoDatasetRestoreService} from '../../../services/VideoDatasetRestoreService';
import {
    ImageDatasetRestoreService,
    ImageWorkspaceUnavailableError,
} from '../../../services/ImageDatasetRestoreService';
import {
    DatasetActionTarget,
    DatasetEditSelection,
    DatasetExportSelection,
    DatasetInferenceSelection,
} from '../../../services/DatasetActionSelection';
import {PendingImportFiles} from '../../../utils/PendingImportFiles';
import {CameraResource, CameraResourceService} from '../../../services/CameraResourceService';
import './DataCenterPopup.scss';

interface DatasetVersionSummary {
    revision: number;
    operation_type: string;
    operation_name?: string | null;
    created_at: string;
    parent_revision?: number | null;
    image_count: number;
    annotated_count?: number | null;
}

interface DatasetSummary {
    id: string;
    name: string;
    project_name?: string | null;
    created_at: string;
    image_count: number;
    classes: string[];
    format: string;
    source_type?: string;
    source_id?: string | null;
    revision?: number;
    status?: string;
    updated_at?: string | null;
    storage_version?: number;
    unique_asset_count?: number | null;
    logical_bytes?: number | null;
    deduplicated_bytes?: number;
    last_task_at?: string | null;
    last_task_type?: string | null;
    media_type?: 'images' | 'video' | 'camera';
    camera?: CameraResource;
    video?: {
        filename: string;
        fps: number;
        duration: number;
        width: number;
        height: number;
        total_frames: number;
    } | null;
    versions?: DatasetVersionSummary[];
}

interface DatasetStats {
    image_count: number;
    class_distribution: Record<string, number>;
    annotated_count: number;
    annotation_coverage: number;
}

interface DatasetPreviewItem {
    index: number;
    name: string;
}

interface DatasetImagePreview extends DatasetPreviewItem {
    datasetId: string;
}

type ModelAssetType = 'custom' | 'detection' | 'segmentation';

interface ModelAsset {
    id?: string;
    name: string;
    type: ModelAssetType;
    format?: string;
    size_bytes?: number;
    modified_at?: string | null;
    source?: 'managed' | 'cache' | 'legacy' | 'local' | 'server';
    project?: string;
    category?: string;
    path?: string;
    relative_path?: string;
    callable?: boolean;
}

type ModelCatalogSort = 'relevance' | 'recent' | 'name' | 'size';
type CurrentModelSlot = 'detection' | 'segmentation' | null;
type DatasetMediaFilter = 'all' | 'images' | 'video' | 'camera';
type DatasetAnnotationFilter = 'all' | 'annotated' | 'unannotated';

interface ModelRuntimeStatus {
    model?: string;
    model_asset_id?: string;
    segmentation_model?: string;
    segmentation_model_asset_id?: string;
    loaded_models?: string[];
    model_tasks?: Record<string, string>;
}

type ResourceModule = 'data' | 'models';
type StorageTier = 'temporary' | 'persistent';

const RESOURCE_MODULES: ResourceModule[] = ['data', 'models'];
const STORAGE_TIERS: StorageTier[] = ['persistent', 'temporary'];
const DATASET_PREVIEW_LIMIT = 12;

interface IProps {
    language: Language;
    projectName: string;
    queueItems: QueueItem[];
    activeQueueItemId: string | null;
    activeVideoId?: string | null;
    activeVideoSessionId?: string;
    imagesData: ImageData[];
    labels: LabelName[];
    updateActivePopupTypeAction: (activePopupType: PopupWindowType) => void;
    updateQueueItemAction: (itemId: string, updates: Partial<QueueItem>) => void;
    removeQueueItemAction?: (itemId: string) => void;
}

const itemCount = (item: QueueItem): number => {
    if (item.type === QueueItemType.FOLDER) return item.files?.length || 0;
    if (item.type === QueueItemType.VIDEO) {
        return item.extractionMetadata?.totalFrames || item.extractedFrames?.length || 0;
    }
    return item.file ? 1 : 0;
};

const getDatasetStatus = (dataset: DatasetSummary, zh: boolean): {className: string; label: string} => {
    const status = (dataset.status || 'ready').toLowerCase();
    const statusLabels: Record<string, string> = {
        ready: zh ? '已就绪' : 'Ready',
        syncing: zh ? '同步中' : 'Syncing',
        processing: zh ? '处理中' : 'Processing',
        error: zh ? '异常' : 'Error',
    };
    return {className: status, label: statusLabels[status] || dataset.status || status};
};

const formatDatasetTime = (value: string | null | undefined, zh: boolean): string => {
    if (!value) return zh ? '暂无记录' : 'No record';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);
};

const versionOperationLabel = (version: DatasetVersionSummary, zh: boolean): string => {
    if (version.operation_name) return version.operation_name;
    const labels: Record<string, [string, string]> = {
        raw: ['原始数据', 'Raw data'],
        annotation_edit: ['标注编辑', 'Annotation edit'],
        cleaning: ['数据清洗', 'Data cleaning'],
        augmentation: ['数据增强', 'Data augmentation'],
        legacy_update: ['历史更新', 'Legacy update'],
    };
    const label = labels[version.operation_type] || [version.operation_type, version.operation_type];
    return zh ? label[0] : label[1];
};

const taskTypeLabel = (taskType: string | null | undefined, zh: boolean): string => {
    const labels: Record<string, [string, string]> = {
        training: ['训练', 'Training'],
        inference: ['推理', 'Inference'],
        cleaning: ['清洗', 'Cleaning'],
        augmentation: ['增强', 'Augmentation'],
    };
    const label = taskType ? labels[taskType] : undefined;
    if (!label) return '';
    return zh ? label[0] : label[1];
};

const comparableModelName = (name: string | null | undefined): string =>
    (name || '').toLowerCase().replace(/\.(pt|onnx|mlpackage|mlmodel)$/i, '');

const modelAssetFormat = (model: ModelAsset): string => {
    const explicitFormat = model.format?.trim().replace(/^\./, '');
    if (explicitFormat) return explicitFormat.toUpperCase();
    const filename = model.path || model.name;
    const extension = filename.match(/\.([a-z0-9]+)$/i)?.[1];
    return extension?.toUpperCase() || 'UNKNOWN';
};

const modelAssetDisplayName = (model: ModelAsset): string =>
    /\.[a-z0-9]+$/i.test(model.name)
        ? model.name
        : `${model.name}.${modelAssetFormat(model).toLowerCase()}`;

const formatBytes = (value: number | null | undefined): string => {
    const bytes = Math.max(0, value || 0);
    if (bytes === 0) return '—';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
};

const MODEL_TYPE_LABELS: Record<ModelAssetType, [string, string]> = {
    custom: ['自定义模型', 'Custom'],
    detection: ['检测模型', 'Detection'],
    segmentation: ['分割模型', 'Segmentation'],
};

const MODEL_SOURCE_LABELS: Record<NonNullable<ModelAsset['source']>, [string, string]> = {
    managed: ['资源目录', 'Managed storage'],
    cache: ['内置缓存', 'Built-in cache'],
    legacy: ['兼容目录', 'Legacy storage'],
    local: ['本地模型', 'Local model'],
    server: ['205 资产目录', '205 asset catalog'],
};

const localizedLabel = (label: [string, string], zh: boolean): string => label[zh ? 0 : 1];

const modelTypeLabel = (type: ModelAssetType, zh: boolean): string =>
    localizedLabel(MODEL_TYPE_LABELS[type], zh);

const modelSourceLabel = (source: ModelAsset['source'], zh: boolean): string =>
    localizedLabel(MODEL_SOURCE_LABELS[source || 'local'], zh);

const modelSlotLabel = (slot: Exclude<CurrentModelSlot, null>, zh: boolean): string => {
    if (slot === 'segmentation') return zh ? '分割槽正在使用' : 'Active in segmentation';
    return zh ? '检测槽正在使用' : 'Active in detection';
};

const modelUseActionLabel = (
    busy: boolean,
    callable: boolean,
    currentSlot: CurrentModelSlot,
    zh: boolean,
): string => {
    if (busy) return zh ? '加载中…' : 'Loading…';
    if (!callable) return zh ? '仅归档' : 'Archive only';
    if (currentSlot) return zh ? '已使用' : 'In use';
    return zh ? '使用' : 'Use';
};

const modelSyncActionLabel = (busy: boolean, zh: boolean): string =>
    busy ? (zh ? '同步中…' : 'Syncing…') : (zh ? '同步至服务器' : 'Sync to server');

const modelTimestamp = (model: ModelAsset): number =>
    model.modified_at ? new Date(model.modified_at).getTime() || 0 : 0;

const compareModelNames = (left: ModelAsset, right: ModelAsset): number =>
    modelAssetDisplayName(left).localeCompare(
        modelAssetDisplayName(right),
        undefined,
        {numeric: true, sensitivity: 'base'},
    );

const orderPersistentModels = (
    models: ModelAsset[],
    query: string,
    format: string,
    sort: ModelCatalogSort,
    resolveCurrentSlot: (model: ModelAsset) => CurrentModelSlot,
): ModelAsset[] => {
    const normalizedQuery = query.trim().toLowerCase();
    const relevanceScore = (model: ModelAsset): number =>
        (resolveCurrentSlot(model) ? 4 : 0)
        + (model.callable !== false ? 2 : 0)
        + (model.source === 'managed' ? 1 : 0);
    return models.filter(model => {
        if (format !== 'all' && modelAssetFormat(model) !== format) return false;
        return !normalizedQuery || [
            model.name,
            model.project,
            model.category,
            model.path,
            modelAssetFormat(model),
        ].some(value => value?.toLowerCase().includes(normalizedQuery));
    }).sort((left, right) => {
        if (sort === 'recent') {
            return modelTimestamp(right) - modelTimestamp(left) || compareModelNames(left, right);
        }
        if (sort === 'name') return compareModelNames(left, right);
        if (sort === 'size') {
            return (right.size_bytes || 0) - (left.size_bytes || 0)
                || compareModelNames(left, right);
        }
        return relevanceScore(right) - relevanceScore(left)
            || modelTimestamp(right) - modelTimestamp(left)
            || compareModelNames(left, right);
    });
};

const TIER_SIDEBAR_COPY = {
    data: {
        ariaLabel: ['数据存储层级', 'Data storage tiers'],
        temporaryLabel: ['临时数据', 'Temporary data'],
        temporaryDetail: ['浏览器工作副本', 'Browser work copies'],
        persistentLabel: ['持久化数据', 'Persistent data'],
        persistentDetail: ['服务器数据集', 'Server datasets'],
        hint: [
            '临时数据可继续编辑，持久化数据用于复用、追溯和下游任务。',
            'Temporary data remains editable; persistent data supports reuse, traceability, and downstream tasks.',
        ],
    },
    models: {
        ariaLabel: ['模型存储层级', 'Model storage tiers'],
        temporaryLabel: ['临时模型', 'Temporary models'],
        temporaryDetail: ['运行内存', 'Runtime memory'],
        persistentLabel: ['持久化模型', 'Persistent models'],
        persistentDetail: ['服务器模型文件', 'Server model files'],
        hint: [
            '临时模型代表当前运行状态，持久化模型代表可调用的文件版本。',
            'Temporary models show runtime state; persistent models are callable file versions.',
        ],
    },
} as const;

const tierSidebarCopy = (module: ResourceModule, zh: boolean) => {
    const copy = TIER_SIDEBAR_COPY[module];
    const index = zh ? 0 : 1;
    return {
        ariaLabel: copy.ariaLabel[index],
        temporaryLabel: copy.temporaryLabel[index],
        temporaryDetail: copy.temporaryDetail[index],
        persistentLabel: copy.persistentLabel[index],
        persistentDetail: copy.persistentDetail[index],
        hint: copy.hint[index],
    };
};

export const DataCenterPopup: React.FC<IProps> = ({
    language,
    projectName,
    queueItems,
    activeQueueItemId,
    activeVideoId,
    activeVideoSessionId,
    imagesData,
    labels,
    updateActivePopupTypeAction,
    updateQueueItemAction,
    removeQueueItemAction,
}) => {
    const zh = language === Language.CHINESE;
    const baseUrl = getEngineBaseUrl();

    const [activeModule, setActiveModule] = useState<ResourceModule>('data');
    const [activeTier, setActiveTier] = useState<StorageTier>('persistent');
    const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
    const [datasetsLoading, setDatasetsLoading] = useState(true);
    const [datasetsError, setDatasetsError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [stats, setStats] = useState<DatasetStats | null>(null);
    const [statsLoading, setStatsLoading] = useState(false);
    const [statsError, setStatsError] = useState<string | null>(null);
    const [datasetPreviewItems, setDatasetPreviewItems] = useState<DatasetPreviewItem[]>([]);
    const [datasetPreviewTotal, setDatasetPreviewTotal] = useState(0);
    const [datasetPreviewLoading, setDatasetPreviewLoading] = useState(false);
    const [datasetPreviewError, setDatasetPreviewError] = useState<string | null>(null);
    const [datasetPreviewFailures, setDatasetPreviewFailures] = useState<Set<number>>(new Set());
    const [datasetImagePreview, setDatasetImagePreview] = useState<DatasetImagePreview | null>(null);
    const [datasetActionId, setDatasetActionId] = useState<string | null>(null);
    const [datasetActionError, setDatasetActionError] = useState<string | null>(null);
    const [datasetQuery, setDatasetQuery] = useState('');
    const [datasetMediaFilter, setDatasetMediaFilter] = useState<DatasetMediaFilter>('all');
    const [datasetAnnotationFilter, setDatasetAnnotationFilter] = useState<DatasetAnnotationFilter>('all');
    const [datasetAnnotationCounts, setDatasetAnnotationCounts] = useState<Record<string, number | null>>({});
    const [datasetAnnotationLoading, setDatasetAnnotationLoading] = useState(false);
    const [datasetAnnotationError, setDatasetAnnotationError] = useState<string | null>(null);
    const [models, setModels] = useState<ModelAsset[]>([]);
    const [modelRuntime, setModelRuntime] = useState<ModelRuntimeStatus>({});
    const [modelsLoading, setModelsLoading] = useState(true);
    const [modelsError, setModelsError] = useState<string | null>(null);
    const [modelActionName, setModelActionName] = useState<string | null>(null);
    const [modelActionError, setModelActionError] = useState<string | null>(null);
    const [modelSyncName, setModelSyncName] = useState<string | null>(null);
    const [modelQuery, setModelQuery] = useState('');
    const [modelSort, setModelSort] = useState<ModelCatalogSort>('relevance');
    const [modelFormat, setModelFormat] = useState('all');

    const selectModule = (module: ResourceModule) => {
        setActiveModule(module);
        setActiveTier('persistent');
        document.getElementById(`resource-module-${module}`)?.focus();
    };

    const handleModuleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        const currentIndex = RESOURCE_MODULES.indexOf(activeModule);
        let nextModule: ResourceModule | undefined;
        if (event.key === 'Home') nextModule = RESOURCE_MODULES[0];
        if (event.key === 'End') nextModule = RESOURCE_MODULES[RESOURCE_MODULES.length - 1];
        if (event.key === 'ArrowRight') {
            nextModule = RESOURCE_MODULES[(currentIndex + 1) % RESOURCE_MODULES.length];
        }
        if (event.key === 'ArrowLeft') {
            nextModule = RESOURCE_MODULES[
                (currentIndex - 1 + RESOURCE_MODULES.length) % RESOURCE_MODULES.length
            ];
        }
        if (!nextModule) return;
        event.preventDefault();
        selectModule(nextModule);
    };

    const selectTier = (tier: StorageTier) => {
        setActiveTier(tier);
        document.getElementById(`resource-tier-${activeModule}-${tier}`)?.focus();
    };

    const handleTierKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        const currentIndex = STORAGE_TIERS.indexOf(activeTier);
        let nextTier: StorageTier | undefined;
        if (event.key === 'Home') nextTier = STORAGE_TIERS[0];
        if (event.key === 'End') nextTier = STORAGE_TIERS[STORAGE_TIERS.length - 1];
        if (event.key === 'ArrowDown') {
            nextTier = STORAGE_TIERS[(currentIndex + 1) % STORAGE_TIERS.length];
        }
        if (event.key === 'ArrowUp') {
            nextTier = STORAGE_TIERS[
                (currentIndex - 1 + STORAGE_TIERS.length) % STORAGE_TIERS.length
            ];
        }
        if (!nextTier) return;
        event.preventDefault();
        selectTier(nextTier);
    };

    const queueItemById = useMemo(
        () => new Map(queueItems.map(item => [item.id, item])),
        [queueItems],
    );
    const temporaryItems = useMemo(
        () => queueItems.filter(item => item.dataSyncStatus !== QueueDataSyncStatus.SYNCED),
        [queueItems],
    );
    const localChangeCount = useMemo(
        () => queueItems.filter(item => item.dataSyncStatus === QueueDataSyncStatus.DIRTY).length,
        [queueItems],
    );
    const runtimeModels = useMemo(() => {
        const seen = new Set<string>();
        return [
            {
                name: modelRuntime.model,
                id: modelRuntime.model_asset_id,
                type: 'detection' as ModelAssetType,
            },
            {
                name: modelRuntime.segmentation_model,
                id: modelRuntime.segmentation_model_asset_id,
                type: 'segmentation' as ModelAssetType,
            },
        ].reduce<ModelAsset[]>((result, slot) => {
            if (!slot.name) return result;
            const comparableName = slot.id || comparableModelName(slot.name);
            if (!comparableName || seen.has(comparableName)) return result;
            seen.add(comparableName);
            const persisted = models.find(model => (
                slot.id ? model.id === slot.id : comparableModelName(model.name) === comparableName
            ));
            result.push(persisted || {
                name: slot.name,
                id: slot.id,
                type: slot.type,
                source: 'local',
            });
            return result;
        }, []);
    }, [
        modelRuntime.model,
        modelRuntime.model_asset_id,
        modelRuntime.segmentation_model,
        modelRuntime.segmentation_model_asset_id,
        models,
    ]);
    const persistentModels = useMemo(
        () => models.filter(model => model.source === 'managed' || model.source === 'server'),
        [models],
    );
    const persistentModelFormats = useMemo(
        () => Array.from(new Set(persistentModels.map(modelAssetFormat)))
            .sort((left, right) => left.localeCompare(right)),
        [persistentModels],
    );

    const refreshDatasets = useCallback(() => {
        setDatasetsLoading(true);
        setDatasetsError(null);
        Promise.all([
            fetch(`${baseUrl}/datasets`).then(async response => {
                if (!response.ok) throw new Error(`${response.status}`);
                return response.json();
            }),
            CameraResourceService.list().catch(() => [] as CameraResource[]),
        ]).then(([data, cameras]) => {
            const cameraDatasets: DatasetSummary[] = cameras.map(camera => ({
                id: `camera:${camera.id}`,
                name: camera.name,
                created_at: camera.created_at,
                updated_at: camera.updated_at,
                image_count: 0,
                classes: [],
                format: 'camera',
                source_type: 'camera_resource',
                source_id: camera.id,
                revision: 1,
                status: 'ready',
                media_type: 'camera',
                camera,
            }));
            const nextDatasets = [
                ...(Array.isArray(data.datasets) ? data.datasets : []),
                ...cameraDatasets,
            ];
            setDatasets(nextDatasets);
            setDatasetAnnotationCounts({});
            setDatasetAnnotationError(null);
            setSelectedId(current => current && nextDatasets.some((dataset: DatasetSummary) => dataset.id === current)
                ? current
                : null);
        }).catch(() => {
            setDatasetsError(zh ? '无法读取服务器数据集' : 'Unable to load server datasets');
        }).finally(() => setDatasetsLoading(false));
    }, [baseUrl, zh]);

    const refreshModels = useCallback(() => {
        setModelsLoading(true);
        setModelsError(null);
        return Promise.all([
            fetch(`${baseUrl}/available-models`),
            fetch(`${baseUrl}/health`),
        ]).then(async ([modelsResponse, healthResponse]) => {
            if (!modelsResponse.ok) throw new Error(`${modelsResponse.status}`);
            const modelData = await modelsResponse.json();
            const healthData = healthResponse.ok ? await healthResponse.json() : {};
            const nextModels = Array.isArray(modelData.models)
                ? modelData.models.map((item: unknown): ModelAsset => {
                    if (typeof item === 'string') {
                        return {name: item, type: 'custom'};
                    }
                    const value = item as Partial<ModelAsset>;
                    return {
                        name: value.name || '',
                        type: value.type || 'custom',
                        format: value.format,
                        size_bytes: value.size_bytes,
                        modified_at: value.modified_at,
                        source: value.source,
                        id: value.id,
                        project: value.project,
                        category: value.category,
                        path: value.path,
                        relative_path: value.relative_path,
                        callable: value.callable,
                    };
                }).filter((item: ModelAsset) => item.name)
                : [];
            setModels(nextModels);
            setModelRuntime(healthData);
        }).catch(() => {
            setModelsError(zh ? '无法读取模型资源' : 'Unable to load model resources');
        }).finally(() => setModelsLoading(false));
    }, [baseUrl, zh]);

    useEffect(() => {
        refreshDatasets();
        window.addEventListener('opensight:data-center-updated', refreshDatasets);
        return () => window.removeEventListener('opensight:data-center-updated', refreshDatasets);
    }, [refreshDatasets]);

    useEffect(() => {
        refreshModels();
        window.addEventListener('opensight:model-loaded', refreshModels);
        return () => window.removeEventListener('opensight:model-loaded', refreshModels);
    }, [refreshModels]);


    useEffect(() => {
        if (datasetAnnotationFilter === 'all' || datasets.length === 0) {
            setDatasetAnnotationLoading(false);
            return undefined;
        }
        const missingDatasets = datasets.filter(dataset => (
            dataset.media_type !== 'camera' &&
            !Object.prototype.hasOwnProperty.call(datasetAnnotationCounts, dataset.id)
        ));
        if (missingDatasets.length === 0) {
            setDatasetAnnotationLoading(false);
            return undefined;
        }

        const controller = new AbortController();
        setDatasetAnnotationLoading(true);
        setDatasetAnnotationError(null);
        Promise.all(missingDatasets.map(async dataset => {
            try {
                const response = await fetch(
                    `${baseUrl}/datasets/${dataset.id}/stats`,
                    {signal: controller.signal},
                );
                if (!response.ok) throw new Error(`${response.status}`);
                const value = await response.json();
                const annotatedCount = typeof value.annotated_count === 'number'
                    ? value.annotated_count
                    : null;
                return [dataset.id, annotatedCount] as const;
            } catch {
                return [dataset.id, null] as const;
            }
        })).then(entries => {
            if (controller.signal.aborted) return;
            setDatasetAnnotationCounts(current => ({
                ...current,
                ...Object.fromEntries(entries),
            }));
            if (entries.some(([, count]) => count === null)) {
                setDatasetAnnotationError(zh ? '部分标注统计不可用' : 'Some annotation statistics are unavailable');
            }
        }).finally(() => {
            if (!controller.signal.aborted) setDatasetAnnotationLoading(false);
        });
        return () => controller.abort();
    }, [baseUrl, datasetAnnotationCounts, datasetAnnotationFilter, datasets, zh]);

    useEffect(() => {
        const controller = new AbortController();
        setStats(null);
        setStatsError(null);
        const selectedDataset = datasets.find(dataset => dataset.id === selectedId);
        if (!selectedId || selectedDataset?.media_type === 'camera') {
            setStatsLoading(false);
            return undefined;
        }
        setStatsLoading(true);
        fetch(`${baseUrl}/datasets/${selectedId}/stats`, {signal: controller.signal})
            .then(async response => {
                if (!response.ok) throw new Error(`${response.status}`);
                return response.json();
            })
            .then(value => {
                if (!controller.signal.aborted) {
                    setStats(value);
                    if (typeof value.annotated_count === 'number') {
                        setDatasetAnnotationCounts(current => ({
                            ...current,
                            [selectedId]: value.annotated_count,
                        }));
                    }
                }
            })
            .catch(cause => {
                if (cause instanceof Error && cause.name === 'AbortError') return;
                if (!controller.signal.aborted) {
                    setStatsError(zh ? '数据统计加载失败' : 'Failed to load dataset statistics');
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setStatsLoading(false);
            });
        return () => controller.abort();
    }, [selectedId, baseUrl, datasets, zh]);

    useEffect(() => {
        const controller = new AbortController();
        const selectedDataset = datasets.find(dataset => dataset.id === selectedId);
        setDatasetPreviewItems([]);
        setDatasetPreviewTotal(0);
        setDatasetPreviewError(null);
        setDatasetPreviewFailures(new Set());
        setDatasetImagePreview(null);
        if (!selectedId || selectedDataset?.media_type === 'camera' || !selectedDataset?.image_count) {
            setDatasetPreviewLoading(false);
            return undefined;
        }
        setDatasetPreviewLoading(true);
        fetch(`${baseUrl}/datasets/${encodeURIComponent(selectedId)}/preview?offset=0&limit=${DATASET_PREVIEW_LIMIT}`, {
            signal: controller.signal,
        }).then(async response => {
            if (!response.ok) throw new Error(`${response.status}`);
            return response.json();
        }).then(value => {
            if (controller.signal.aborted) return;
            const fallbackOffset = typeof value.offset === 'number' ? value.offset : 0;
            const items: DatasetPreviewItem[] = Array.isArray(value.items)
                ? value.items.filter((item: DatasetPreviewItem) => (
                    Number.isInteger(item?.index) && typeof item?.name === 'string'
                ))
                : (Array.isArray(value.images) ? value.images : []).map((name: string, index: number) => ({
                    index: fallbackOffset + index,
                    name,
                }));
            setDatasetPreviewItems(items);
            setDatasetPreviewTotal(typeof value.total === 'number'
                ? value.total
                : selectedDataset.image_count);
        }).catch(cause => {
            if (cause instanceof Error && cause.name === 'AbortError') return;
            if (!controller.signal.aborted) {
                setDatasetPreviewError(zh ? '图片缩略图加载失败' : 'Failed to load image thumbnails');
            }
        }).finally(() => {
            if (!controller.signal.aborted) setDatasetPreviewLoading(false);
        });
        return () => controller.abort();
    }, [baseUrl, datasets, selectedId, zh]);

    const moveDatasetImagePreview = useCallback((step: -1 | 1) => {
        setDatasetImagePreview(current => {
            if (!current) return null;
            const position = datasetPreviewItems.findIndex(item => item.index === current.index);
            const next = datasetPreviewItems[position + step];
            return next ? {...next, datasetId: current.datasetId} : current;
        });
    }, [datasetPreviewItems]);

    useEffect(() => {
        if (!datasetImagePreview) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setDatasetImagePreview(null);
            if (event.key === 'ArrowLeft') moveDatasetImagePreview(-1);
            if (event.key === 'ArrowRight') moveDatasetImagePreview(1);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [datasetImagePreview, moveDatasetImagePreview]);

    const useModel = async (model: ModelAsset) => {
        const identifier = model.id || model.name;
        setModelActionName(identifier);
        setModelActionError(null);
        try {
            const response = await fetch(`${baseUrl}/switch-model`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({model: identifier}),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(typeof body.detail === 'string' ? body.detail : `${response.status}`);
            }
            await refreshModels();
            window.dispatchEvent(new CustomEvent('opensight:model-loaded', {
                detail: {model: body.active || model.name},
            }));
        } catch (cause) {
            setModelActionError(cause instanceof Error
                ? cause.message
                : (zh ? '模型加载失败' : 'Failed to load model'));
        } finally {
            setModelActionName(null);
        }
    };

    const syncModelToServer = async (model: ModelAsset) => {
        const identifier = model.id || model.name;
        setModelSyncName(identifier);
        setModelActionError(null);
        try {
            const response = await fetch(`${baseUrl}/model-assets/sync`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({model: identifier}),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(typeof body.detail === 'string' ? body.detail : `${response.status}`);
            }
            await refreshModels();
        } catch (cause) {
            setModelActionError(cause instanceof Error
                ? cause.message
                : (zh ? '模型同步失败' : 'Failed to sync model'));
        } finally {
            setModelSyncName(null);
        }
    };

    const datasetDisplayName = (dataset: DatasetSummary): string => {
        const localSource = dataset.source_id ? queueItemById.get(dataset.source_id) : null;
        const inferredLegacyProject = !dataset.project_name && localSource ? projectName.trim() : '';
        return inferredLegacyProject || dataset.name;
    };

    const syncStatus = (item: QueueItem): {className: string; label: string} => {
        const status = item.dataSyncStatus || QueueDataSyncStatus.LOCAL;
        const labelsByStatus: Record<QueueDataSyncStatus, string> = {
            [QueueDataSyncStatus.LOCAL]: zh ? '仅本地' : 'Local only',
            [QueueDataSyncStatus.SYNCING]: zh ? '正在同步' : 'Syncing',
            [QueueDataSyncStatus.SYNCED]: `${zh ? '服务器快照' : 'Server snapshot'} · v${item.datasetRevision || 1}`,
            [QueueDataSyncStatus.DIRTY]: zh ? '有本地修改' : 'Local changes',
            [QueueDataSyncStatus.ERROR]: zh ? '同步失败' : 'Sync failed',
        };
        return {className: status.toLowerCase(), label: labelsByStatus[status]};
    };

    const openLocalItem = (item: QueueItem) => {
        if (item.id === activeQueueItemId) {
            PopupActions.close();
            return;
        }
        void QueueActions.switchToQueueItem(item, imagesData).then(() => PopupActions.close());
    };

    const syncLocalItem = (item: QueueItem) => {
        const cachedAnnotations = item.id === activeQueueItemId
            ? imagesData
            : ImageRepository.getFileCacheSnapshot(item.id);
        if (!cachedAnnotations) return;
        const annotations = cachedAnnotations;
        const syncPromise = item.type === QueueItemType.VIDEO
            ? DataBatchSyncService.syncQueueItem(item, annotations, labels, activeVideoSessionId)
            : DataBatchSyncService.syncQueueItem(item, annotations, labels);
        void syncPromise.catch(() => undefined);
    };

    const actionTarget = (dataset: DatasetSummary): DatasetActionTarget => ({
        id: dataset.id,
        name: datasetDisplayName(dataset),
        projectName: dataset.project_name || datasetDisplayName(dataset),
        revision: dataset.revision || 1,
        imageCount: dataset.image_count,
        classCount: dataset.classes.length,
        sourceId: dataset.source_id,
    });

    const upgradeLegacyVideoDataset = async (dataset: DatasetSummary): Promise<number> => {
        const linkedSource = dataset.source_id ? queueItemById.get(dataset.source_id) : null;
        const activeSource = activeQueueItemId ? queueItemById.get(activeQueueItemId) : null;
        const localSource = linkedSource?.type === QueueItemType.VIDEO ? linkedSource : activeSource;
        const canUpgrade = localSource?.type === QueueItemType.VIDEO
            && localSource.id === activeVideoId
            && Boolean(activeVideoSessionId);
        if (!localSource || !canUpgrade) {
            throw new Error(zh
                ? '该旧快照仅包含视频帧。请先重新打开原视频，再点击“使用”补全视频源。'
                : 'This legacy snapshot only contains frames. Reopen the source video, then use it again to attach the video source.');
        }
        const result = await DataBatchSyncService.syncQueueItem(
            {
                ...localSource,
                datasetId: dataset.id,
                datasetRevision: dataset.revision || 1,
            },
            imagesData,
            labels,
            activeVideoSessionId,
        );
        return result.revision || dataset.revision || 1;
    };

    const restoreVideoDataset = async (dataset: DatasetSummary): Promise<void> => {
        const revision = dataset.media_type === 'video'
            ? dataset.revision || 1
            : await upgradeLegacyVideoDataset(dataset);
        await VideoDatasetRestoreService.restore(
            dataset.id,
            datasetDisplayName(dataset),
            revision,
            imagesData,
        );
        PopupActions.close();
    };

    const openLegacyImageDataset = async (dataset: DatasetSummary): Promise<void> => {
        const response = await fetch(`${baseUrl}/datasets/${dataset.id}/export`);
        if (!response.ok) throw new Error(`${response.status}`);
        const archive = await response.blob();
        const safeName = datasetDisplayName(dataset).replace(/[^A-Za-z0-9._-]+/g, '_') || dataset.id;
        DatasetEditSelection.set(actionTarget(dataset));
        PendingImportFiles.set([
            new File([archive], `yolo_full_${safeName}_v${dataset.revision || 1}.zip`, {
                type: 'application/zip',
            }),
        ]);
        updateActivePopupTypeAction(PopupWindowType.IMPORT_ANNOTATIONS);
    };

    const openImageDataset = async (dataset: DatasetSummary): Promise<void> => {
        if (dataset.format !== 'opensight-batch') return openLegacyImageDataset(dataset);
        try {
            await ImageDatasetRestoreService.restore(
                dataset.id,
                datasetDisplayName(dataset),
                dataset.revision || 1,
                dataset.source_id,
                imagesData,
            );
            PopupActions.close();
        } catch (cause) {
            // Only snapshots created before workspace.json existed may take the
            // lossy YOLO compatibility path. A malformed modern workspace must
            // stay closed so mask geometry is never silently flattened.
            if (cause instanceof ImageWorkspaceUnavailableError) {
                await openLegacyImageDataset(dataset);
                return;
            }
            throw cause;
        }
    };

    const openDatasetForEditing = async (dataset: DatasetSummary) => {
        setDatasetActionId(dataset.id);
        setDatasetActionError(null);
        try {
            if (dataset.media_type === 'camera' && dataset.camera) {
                await CameraResourceService.open(dataset.camera, imagesData);
                PopupActions.close();
                return;
            }
            if (dataset.media_type === 'video' || dataset.source_type === 'video_queue') {
                await restoreVideoDataset(dataset);
                return;
            }
            await openImageDataset(dataset);
        } catch (cause) {
            DatasetEditSelection.set(null);
            setDatasetActionError(cause instanceof Error
                ? cause.message
                : (zh ? '无法打开服务器数据集' : 'Unable to open server dataset'));
        } finally {
            setDatasetActionId(null);
        }
    };

    const openInferenceSettings = (datasetId: string) => {
        DatasetInferenceSelection.set(datasetId);
        updateActivePopupTypeAction(PopupWindowType.DATASET_INFERENCE);
    };

    const openTrainingSettings = (datasetId: string) => {
        TrainingDatasetSelection.set(datasetId);
        updateActivePopupTypeAction(PopupWindowType.TRAINING_TASK);
    };

    const openExportSettings = (dataset: DatasetSummary) => {
        DatasetExportSelection.set(actionTarget(dataset));
        updateActivePopupTypeAction(PopupWindowType.DATASET_EXPORT);
    };

    const deleteDataset = (dataset: DatasetSummary, event: React.MouseEvent) => {
        event.stopPropagation();
        const datasetName = datasetDisplayName(dataset);
        const prompt = dataset.media_type === 'camera'
            ? (zh
                ? `确定删除相机资源“${datasetName}”吗？`
                : `Delete camera resource “${datasetName}”?`)
            : (zh
                ? `确定永久删除服务器数据集“${datasetName}”吗？此操作不可撤销。`
                : `Permanently delete server dataset “${datasetName}”? This cannot be undone.`);
        if (!window.confirm(prompt)) return;
        if (dataset.camera) {
            CameraResourceService.delete(dataset.camera.id).then(() => {
                if (selectedId === dataset.id) setSelectedId(null);
                const queueItem = queueItems.find(item => item.cameraResourceId === dataset.camera?.id);
                if (queueItem) removeQueueItemAction?.(queueItem.id);
                refreshDatasets();
            }).catch(() => undefined);
            return;
        }
        fetch(`${baseUrl}/datasets/${dataset.id}`, {method: 'DELETE'}).then(response => {
            if (!response.ok) throw new Error(`${response.status}`);
            if (selectedId === dataset.id) setSelectedId(null);
            const localSource = dataset.source_id ? queueItemById.get(dataset.source_id) : null;
            if (localSource) {
                updateQueueItemAction(localSource.id, {
                    dataSyncStatus: QueueDataSyncStatus.LOCAL,
                    datasetId: undefined,
                    datasetRevision: undefined,
                    syncedAt: undefined,
                });
            }
            refreshDatasets();
        }).catch(() => undefined);
    };

    const localItemUnit = (item: QueueItem): string => item.type === QueueItemType.VIDEO
        ? (zh ? '帧' : 'frames')
        : (zh ? '张图片' : 'images');

    const syncActionLabel = (item: QueueItem, hasReliableSnapshot: boolean): string => {
        if (item.dataSyncStatus === QueueDataSyncStatus.SYNCING) return zh ? '同步中…' : 'Syncing…';
        if (!hasReliableSnapshot) return zh ? '先打开后同步' : 'Open before syncing';
        return zh ? '同步至服务器' : 'Sync to server';
    };

    const renderLocalDataCard = (item: QueueItem) => {
        const status = syncStatus(item);
        const isActive = item.id === activeQueueItemId;
        const localProjectName = projectName.trim() || item.name;
        const syncing = item.dataSyncStatus === QueueDataSyncStatus.SYNCING;
        const hasReliableSnapshot = item.type === QueueItemType.VIDEO
            ? isActive && activeVideoId === item.id && Boolean(activeVideoSessionId)
            : isActive || ImageRepository.hasFileCache(item.id);
        return <article className={`LocalDataCard${isActive ? ' active' : ''}`} key={item.id}>
            <div className='DataCardIdentity'>
                <div className='DataCardTitleRow'>
                    <strong title={localProjectName}>{localProjectName}</strong>
                    {isActive && <span className='CurrentBadge'>{zh ? '当前打开' : 'Open'}</span>}
                </div>
                <span>{itemCount(item)} {localItemUnit(item)} · {zh ? '前端临时数据' : 'temporary frontend data'}</span>
                <span className={`SyncState ${status.className}`} aria-live='polite'>{status.label}</span>
                {item.dataSyncError && <span className='InlineError'>{item.dataSyncError}</span>}
            </div>
            <div className='DataCardActions'>
                <button type='button' onClick={() => openLocalItem(item)}>
                    {zh ? '使用' : 'Use'}
                </button>
                <button
                    type='button'
                    className='PrimaryAction'
                    disabled={syncing || !hasReliableSnapshot}
                    onClick={() => syncLocalItem(item)}
                >{syncActionLabel(item, hasReliableSnapshot)}</button>
            </div>
        </article>;
    };

    const renderDatasetTimes = (dataset: DatasetSummary) => {
        const taskType = taskTypeLabel(dataset.last_task_type, zh);
        const taskTime = formatDatasetTime(dataset.last_task_at, zh);
        const taskValue = dataset.last_task_at && taskType ? `${taskType} · ${taskTime}` : taskTime;
        return <div className='DatasetTimeGrid' aria-label={zh ? '数据时间信息' : 'Dataset timestamps'}>
            <div className='DatasetTimeField'>
                <span>{zh ? '创建时间' : 'Created'}</span>
                <time dateTime={dataset.created_at}>{formatDatasetTime(dataset.created_at, zh)}</time>
            </div>
            <div className='DatasetTimeField'>
                <span>{zh ? '编辑时间' : 'Last edited'}</span>
                <time dateTime={dataset.updated_at || dataset.created_at}>
                    {formatDatasetTime(dataset.updated_at || dataset.created_at, zh)}
                </time>
            </div>
            <div className='DatasetTimeField'>
                <span>{zh ? '任务时间' : 'Last task'}</span>
                <time dateTime={dataset.last_task_at || undefined}>{taskValue}</time>
            </div>
        </div>;
    };

    const renderVersionTimeline = (dataset: DatasetSummary) => {
        const versions = dataset.versions?.length
            ? [...dataset.versions].sort((left, right) => left.revision - right.revision)
            : [{
                revision: dataset.revision || 1,
                operation_type: 'raw',
                created_at: dataset.created_at,
                image_count: dataset.image_count,
            }];
        return <div className='VersionHistorySection'>
            <div className='SectionHeader'>{zh ? '数据版本' : 'Data versions'}</div>
            <ol className='VersionTimeline' aria-label={zh ? '数据版本时间轴' : 'Dataset version timeline'}>
                {versions.map(version => (
                    <li
                        className={`VersionCommit${version.revision === (dataset.revision || 1) ? ' current' : ''}`}
                        key={version.revision}
                    >
                        <div className='VersionCommitHeader'>
                            <strong>{versionOperationLabel(version, zh)}</strong>
                            <span>v{version.revision}</span>
                        </div>
                        <time dateTime={version.created_at}>{formatDatasetTime(version.created_at, zh)}</time>
                        <small>{version.image_count} {dataset.media_type === 'video'
                            ? (zh ? '帧' : 'frames')
                            : (zh ? '张图片' : 'images')}</small>
                    </li>
                ))}
            </ol>
        </div>;
    };

    const datasetPreviewUrl = (
        dataset: DatasetSummary,
        item: DatasetPreviewItem,
        variant: 'thumbnail' | 'original',
    ) => `${baseUrl}/datasets/${encodeURIComponent(dataset.id)}/preview/${item.index}/${variant}`
        + `?revision=${dataset.revision || 1}&name=${encodeURIComponent(item.name)}`;

    const renderDatasetPreviewStrip = (dataset: DatasetSummary) => {
        const visibleCount = datasetPreviewItems.length;
        return <div className='DatasetPreviewSection'>
            <div className='DatasetPreviewHeader'>
                <span>{zh ? '图片预览' : 'Image preview'}</span>
                {!datasetPreviewLoading && !datasetPreviewError && datasetPreviewTotal > 0 && <small>
                    {zh
                        ? `首批 ${visibleCount} / ${datasetPreviewTotal} · 点击查看大图`
                        : `First ${visibleCount} of ${datasetPreviewTotal} · Click to enlarge`}
                </small>}
            </div>
            {datasetPreviewLoading && <div className='DatasetPreviewLoading' aria-live='polite'>
                {zh ? '正在加载缩略图…' : 'Loading thumbnails…'}
            </div>}
            {datasetPreviewError && <div className='DatasetPreviewState error' role='alert'>
                {datasetPreviewError}
            </div>}
            {!datasetPreviewLoading && !datasetPreviewError && datasetPreviewTotal === 0
                && <div className='DatasetPreviewState'>{zh ? '这个版本没有图片' : 'No images in this version'}</div>}
            {visibleCount > 0 && <div
                className='DatasetPreviewRail'
                role='list'
                aria-label={zh ? '数据集图片缩略图' : 'Dataset image thumbnails'}
            >
                {datasetPreviewItems.map(item => {
                    const failed = datasetPreviewFailures.has(item.index);
                    return <div className={`DatasetPreviewTile${failed ? ' failed' : ''}`} role='listitem' key={item.index}>
                        <button
                            type='button'
                            aria-label={`${zh ? '查看图片' : 'View image'} ${item.name}`}
                            title={item.name}
                            onClick={() => setDatasetImagePreview({...item, datasetId: dataset.id})}
                        >
                            {!failed && <img
                                src={datasetPreviewUrl(dataset, item, 'thumbnail')}
                                alt=''
                                loading='lazy'
                                onError={() => setDatasetPreviewFailures(current => {
                                    const next = new Set(current);
                                    next.add(item.index);
                                    return next;
                                })}
                            />}
                            {failed && <span className='DatasetPreviewFailed'>
                                {zh ? '加载失败' : 'Unavailable'}
                            </span>}
                            <span className='DatasetPreviewFilename'>{item.name}</span>
                        </button>
                    </div>;
                })}
            </div>}
        </div>;
    };

    // The expanded card intentionally composes the independent timeline, stats and task states.
    // eslint-disable-next-line complexity
    const renderDatasetDetails = (dataset: DatasetSummary, detailsId: string) => (
        <div className='DatasetDetails' id={detailsId}>
            {renderDatasetTimes(dataset)}
            {renderVersionTimeline(dataset)}
            {renderDatasetPreviewStrip(dataset)}
            {statsLoading && <div className='StatsState'>{zh ? '正在加载数据统计…' : 'Loading dataset statistics…'}</div>}
            {statsError && <div className='StatsState error'>{statsError}</div>}
            {stats && <div className='StatsPanel'>
                <div className='StatsRow'><span>{zh ? '标注覆盖率' : 'Annotation coverage'}</span><span>{(stats.annotation_coverage * 100).toFixed(0)}%</span></div>
                <div className='StatsRow'><span>{zh ? '已标注' : 'Annotated'}</span><span>{stats.annotated_count} / {stats.image_count}</span></div>
                {Object.entries(stats.class_distribution).map(([className, count]) => (
                    <div className='StatsRow' key={className}><span>{className}</span><span>{count}</span></div>
                ))}
            </div>}
            <div className='TaskLinksSection'>
                <div className='SectionHeader'>{zh ? '下游任务' : 'Downstream tasks'}</div>
                <div className='TaskLinks'>
                    <button
                        type='button'
                        className='TaskLink'
                        disabled={datasetActionId === dataset.id}
                        onClick={() => openDatasetForEditing(dataset)}
                    >
                        {datasetActionId === dataset.id ? (zh ? '正在打开…' : 'Opening…') : (zh ? '使用' : 'Use')}
                    </button>
                    <button type='button' className='TaskLink' onClick={() => openInferenceSettings(dataset.id)}>
                        {zh ? '推理' : 'Inference'}
                    </button>
                    <button type='button' className='TaskLink' onClick={() => openTrainingSettings(dataset.id)}>
                        {zh ? '训练' : 'Training'}
                    </button>
                    <button type='button' className='TaskLink' onClick={() => openExportSettings(dataset)}>
                        {zh ? '导出' : 'Export'}
                    </button>
                </div>
                {datasetActionError && <p className='TaskActionError'>{datasetActionError}</p>}
                <p className='TaskCapabilityHint'>
                    {zh
                        ? '使用会创建可继续标注的前端工作副本；推理完成后生成新版本；训练引用当前快照；导出先确认再生成压缩包。'
                        : 'Use creates a frontend working copy; inference creates a new revision; training references this snapshot; export confirms before building an archive.'}
                </p>
            </div>
        </div>
    );

    // eslint-disable-next-line complexity
    const renderCameraDetails = (dataset: DatasetSummary, detailsId: string) => {
        const camera = dataset.camera;
        if (!camera) return null;
        const channel = camera.channels.find(item => item.id === camera.channel_id);
        return <div className='DatasetDetails' id={detailsId}>
            {renderDatasetTimes(dataset)}
            <div className='StatsPanel'>
                <div className='StatsRow'><span>{zh ? '相机地址' : 'Camera address'}</span><span>{camera.host}</span></div>
                <div className='StatsRow'><span>{zh ? '设备型号' : 'Model'}</span><span>{camera.device.model || '—'}</span></div>
                <div className='StatsRow'><span>{zh ? '播放通道' : 'Live channel'}</span><span>{camera.channel_id}</span></div>
                <div className='StatsRow'><span>{zh ? '码流' : 'Stream'}</span><span>
                    {channel ? `${channel.codec || '—'} · ${channel.width || '—'}×${channel.height || '—'} · ${channel.frame_rate || '—'} fps` : '—'}
                </span></div>
            </div>
            <div className='TaskLinksSection'>
                <div className='SectionHeader'>{zh ? '实时画面' : 'Live stream'}</div>
                <div className='TaskLinks'>
                    <button
                        type='button'
                        className='TaskLink'
                        disabled={datasetActionId === dataset.id}
                        onClick={() => openDatasetForEditing(dataset)}
                    >
                        {datasetActionId === dataset.id
                            ? (zh ? '正在打开…' : 'Opening…')
                            : (zh ? '使用' : 'Use')}
                    </button>
                </div>
                {datasetActionError && <p className='TaskActionError'>{datasetActionError}</p>}
                <p className='TaskCapabilityHint'>
                    {zh ? '打开后会像视频一样在编辑区持续播放实时画面。' : 'Opens a continuous live view in the editor, like a video source.'}
                </p>
            </div>
        </div>;
    };

    const datasetSourceLabel = (dataset: DatasetSummary, hasLocalSource: boolean): string => {
        if (dataset.camera) {
            return `${zh ? '网络相机' : 'Network camera'} · ${dataset.camera.host} · ${zh ? '通道' : 'Channel'} ${dataset.camera.channel_id}`;
        }
        const linkedProject = dataset.project_name || (hasLocalSource ? projectName.trim() : '');
        const projectLabel = linkedProject
            ? `${zh ? '项目' : 'Project'} ${linkedProject}`
            : (zh ? '未关联项目' : 'Unassigned project');
        const serverLabel = dataset.media_type === 'video'
            ? (zh ? '服务器视频项目' : 'Server video project')
            : (zh ? '服务器数据集' : 'Server dataset');
        const localCopyLabel = hasLocalSource
            ? ` · ${zh ? '关联本地工作副本' : 'linked local copy'}`
            : '';
        return `${projectLabel} · ${serverLabel} · v${dataset.revision || 1} · ${dataset.id.slice(0, 8)}${localCopyLabel}`;
    };

    // eslint-disable-next-line complexity
    const renderDatasetItem = (dataset: DatasetSummary) => {
        const expanded = selectedId === dataset.id;
        const datasetName = datasetDisplayName(dataset);
        const status = getDatasetStatus(dataset, zh);
        const detailsId = `dataset-details-${dataset.id}`;
        const localSource = dataset.source_id ? queueItemById.get(dataset.source_id) : null;
        const sourceLabel = datasetSourceLabel(dataset, !!localSource);
        return <article key={dataset.id} className={`DatasetItem${expanded ? ' selected' : ''}`}>
            <div className='DatasetRow'>
                <button
                    type='button'
                    className='DatasetToggle'
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    onClick={() => setSelectedId(expanded ? null : dataset.id)}
                >
                    <span className='DatasetRowMain'>
                        <span className='DatasetTitleRow'>
                            <span className='DatasetName'>{datasetName}</span>
                            <span className={`DatasetState ${status.className}`} aria-live='polite'>{status.label}</span>
                        </span>
                        <span className='DatasetMeta'>
                            {dataset.camera ? <>
                                <span>{zh ? '相机' : 'Camera'}</span>
                                <span>{zh ? '实时' : 'Live'}</span>
                                <span>{zh ? '通道' : 'Channel'} {dataset.camera.channel_id}</span>
                            </> : <>
                                <span>{dataset.media_type === 'video'
                                    ? (zh ? '视频' : 'Video') : (zh ? '图片' : 'Images')}</span>
                                <span>{dataset.image_count} {dataset.media_type === 'video'
                                    ? (zh ? '帧' : 'frames')
                                    : (zh ? '张' : 'images')}</span>
                                <span>{dataset.classes.length} {zh ? '类别' : 'classes'}</span>
                            </>}
                        </span>
                        <span className='DatasetSource'>{sourceLabel}</span>
                    </span>
                    <span className={`DatasetChevron${expanded ? ' expanded' : ''}`} aria-hidden='true' />
                </button>
                <button
                    type='button'
                    className='DeleteButton'
                    aria-label={`${zh ? '删除' : 'Delete'} ${datasetName}`}
                    onClick={(event) => deleteDataset(dataset, event)}
                />
            </div>
            {expanded && (dataset.camera
                ? renderCameraDetails(dataset, detailsId) : renderDatasetDetails(dataset, detailsId))}
        </article>;
    };

    const renderTemporaryData = () => <section className='DataTierPanel' aria-label={zh ? '临时数据' : 'Temporary data'}>
        <div className='TierExplanation'>
            <div>
                <strong>{zh ? '前端临时数据' : 'Temporary frontend data'}</strong>
                <span>{zh ? '查看当前浏览器中的工作副本、标注状态与服务器同步状态。' : 'Inspect browser work copies, annotation state, and server sync status.'}</span>
            </div>
        </div>
        <div className='LocalDataList'>
            {temporaryItems.length === 0 && <div className='EmptyState'>
                <strong>{zh ? '暂无临时数据' : 'No temporary data'}</strong>
                <span>{zh ? '从“操作 → 上传文件”加入图片或数据批次。' : 'Add images or a batch from Actions → Upload files.'}</span>
            </div>}
            {temporaryItems.map(renderLocalDataCard)}
        </div>
    </section>;

    // The persistent panel intentionally composes independent filter, loading and empty states.
    // eslint-disable-next-line complexity
    const renderPersistentData = () => {
        const annotationStatsPending = datasetAnnotationFilter !== 'all'
            && datasets.filter(dataset => dataset.media_type !== 'camera').some(dataset => (
                !Object.prototype.hasOwnProperty.call(datasetAnnotationCounts, dataset.id)
            ));
        const normalizedQuery = datasetQuery.trim().toLowerCase();
        const filteredDatasets = datasets.filter(dataset => {
            const mediaType = dataset.media_type || 'images';
            if (datasetMediaFilter !== 'all' && mediaType !== datasetMediaFilter) return false;
            const matchesQuery = !normalizedQuery || [
                datasetDisplayName(dataset),
                dataset.name,
                dataset.project_name,
                dataset.id,
                ...dataset.classes,
            ].some(value => value?.toLowerCase().includes(normalizedQuery));
            if (!matchesQuery) return false;
            if (dataset.media_type === 'camera') return true;
            if (datasetAnnotationFilter === 'all' || annotationStatsPending) return true;
            const annotatedCount = datasetAnnotationCounts[dataset.id];
            if (typeof annotatedCount !== 'number') return false;
            return datasetAnnotationFilter === 'annotated' ? annotatedCount > 0 : annotatedCount === 0;
        });
        const resultCount = zh
            ? `显示 ${filteredDatasets.length} / ${datasets.length}`
            : `Showing ${filteredDatasets.length} / ${datasets.length}`;
        let filterSummary = resultCount;
        if (annotationStatsPending || datasetAnnotationLoading) {
            filterSummary = `${zh ? '读取标注统计中' : 'Loading annotation statistics'} · ${resultCount}`;
        } else if (datasetAnnotationFilter !== 'all' && datasetAnnotationError) {
            filterSummary = `${datasetAnnotationError} · ${resultCount}`;
        }
        return <section className='DataTierPanel' aria-label={zh ? '持久化数据' : 'Persistent data'}>
        <div className='TierExplanation persistent'>
            <div>
                <strong>{zh ? '后端持久化数据' : 'Persistent backend data'}</strong>
                <span>{zh ? '查看核心引擎已有的数据快照、运行状态与下游任务入口。' : 'Inspect core-engine snapshots, runtime state, and downstream task entry points.'}</span>
            </div>
            <button type='button' onClick={refreshDatasets} disabled={datasetsLoading}>
                {datasetsLoading ? (zh ? '刷新中…' : 'Refreshing…') : (zh ? '刷新' : 'Refresh')}
            </button>
        </div>
        {datasetsError && <div className='EmptyState error'>
            <strong>{datasetsError}</strong>
            <span>{zh ? '请确认核心引擎的数据服务可用。' : 'Check that the core-engine data service is available.'}</span>
        </div>}
        {!datasetsError && !datasetsLoading && datasets.length === 0 && <div className='EmptyState'>
            <strong>{zh ? '暂无持久化数据' : 'No persistent data'}</strong>
            <span>{zh ? '在“临时数据”中选择一个批次并同步至服务器。' : 'Choose a temporary batch and sync it to the server.'}</span>
        </div>}
        {datasets.length > 0 && <div className='ModelCatalogFilter DatasetCatalogFilter'>
            <label className='ModelCatalogSelect'>
                <span>{zh ? '媒体' : 'Media'}</span>
                <select
                    value={datasetMediaFilter}
                    aria-label={zh ? '数据媒体类型' : 'Dataset media type'}
                    onChange={event => setDatasetMediaFilter(event.target.value as DatasetMediaFilter)}
                >
                    <option value='all'>{zh ? '全部媒体' : 'All media'}</option>
                    <option value='images'>{zh ? '图片' : 'Images'}</option>
                    <option value='video'>{zh ? '视频' : 'Video'}</option>
                    <option value='camera'>{zh ? '相机' : 'Camera'}</option>
                </select>
            </label>
            <label className='ModelCatalogSelect'>
                <span>{zh ? '标注' : 'Annotation'}</span>
                <select
                    value={datasetAnnotationFilter}
                    disabled={datasetMediaFilter === 'camera'}
                    aria-label={zh ? '数据标注状态' : 'Dataset annotation status'}
                    onChange={event => setDatasetAnnotationFilter(
                        event.target.value as DatasetAnnotationFilter,
                    )}
                >
                    <option value='all'>{zh ? '全部状态' : 'All states'}</option>
                    <option value='annotated'>{zh ? '有标注' : 'Annotated'}</option>
                    <option value='unannotated'>{zh ? '无标注' : 'Unannotated'}</option>
                </select>
            </label>
            <label className='ModelCatalogSearch'>
                <span>{zh ? '筛选数据资源' : 'Filter data resources'}</span>
                <input
                    type='search'
                    value={datasetQuery}
                    onChange={event => setDatasetQuery(event.target.value)}
                    placeholder={zh ? '名称、项目、类别或 ID' : 'Name, project, class, or ID'}
                />
            </label>
            <small aria-live='polite'>{filterSummary}</small>
        </div>}
        {datasets.length > 0 && filteredDatasets.length === 0 && !annotationStatsPending
            && <div className='EmptyState'>
                <strong>{zh ? '没有符合筛选条件的数据' : 'No datasets match these filters'}</strong>
                <span>{zh ? '请调整媒体类型、标注状态或搜索关键词。' : 'Adjust media, annotation, or search filters.'}</span>
            </div>}
        <div className='DatasetList'>
            {filteredDatasets.map(renderDatasetItem)}
        </div>
        </section>;
    };

    const currentModelSlot = (model: ModelAsset): CurrentModelSlot => {
        if (model.id && modelRuntime.model_asset_id === model.id) return 'detection';
        if (model.id && modelRuntime.segmentation_model_asset_id === model.id) return 'segmentation';
        const name = comparableModelName(model.name);
        if (comparableModelName(modelRuntime.model) === name) return 'detection';
        if (comparableModelName(modelRuntime.segmentation_model) === name) return 'segmentation';
        return null;
    };

    const renderModelItem = (
        model: ModelAsset,
        context: 'temporary' | 'persistent' = 'persistent',
    ) => {
        const currentSlot = currentModelSlot(model);
        const identifier = model.id || model.name;
        const busy = modelActionName === identifier;
        const syncBusy = modelSyncName === identifier;
        const persisted = model.source === 'managed' || model.source === 'server';
        const format = modelAssetFormat(model);
        const displayName = modelAssetDisplayName(model);
        const callable = model.callable !== false;
        return <article className={`ModelResourceCard${currentSlot ? ' active' : ''}`} key={identifier}>
            <div className='ModelResourceIdentity'>
                <div className='ModelResourceTitle'>
                    <strong title={displayName}>{displayName}</strong>
                    <span className={`ModelTypeBadge ${model.type}`}>{modelTypeLabel(model.type, zh)}</span>
                    {currentSlot && <span className='ModelLoadedBadge'>
                        {modelSlotLabel(currentSlot, zh)}
                    </span>}
                </div>
                <div className='ModelResourceMeta'>
                    <span>{zh ? '模型文件版本' : 'Model-file version'}</span>
                    <span>{format}</span>
                    <span>{formatBytes(model.size_bytes)}</span>
                    <span>{modelSourceLabel(model.source, zh)}</span>
                    {model.project && <span>{model.project}</span>}
                    {model.category && <span>{model.category}</span>}
                </div>
                {model.path && <div className='ModelResourcePath' title={model.path}>{model.path}</div>}
                <div className='ModelResourceTime'>
                    {zh ? '更新时间' : 'Updated'}：{formatDatasetTime(model.modified_at, zh)}
                </div>
            </div>
            <div className='ModelResourceActions'>
                <button
                    type='button'
                    className='PrimaryAction'
                    disabled={!callable || busy || !!currentSlot}
                    onClick={() => void useModel(model)}
                >
                    {modelUseActionLabel(busy, callable, currentSlot, zh)}
                </button>
                {context === 'temporary' && !persisted && <button
                    type='button'
                    className='SyncAction'
                    disabled={syncBusy}
                    onClick={() => void syncModelToServer(model)}
                >
                    {modelSyncActionLabel(syncBusy, zh)}
                </button>}
            </div>
        </article>;
    };

    const renderTemporaryModels = () => <section
        className='DataTierPanel'
        aria-label={zh ? '临时模型' : 'Temporary models'}
    >
        <div className='TierExplanation models temporary-models'>
            <div>
                <strong>{zh ? '临时模型（运行内存）' : 'Temporary runtime models'}</strong>
                <span>{zh
                    ? `${runtimeModels.length} 个模型正在运行。切换模型会更新运行槽，不会删除服务器上的模型文件。`
                    : `${runtimeModels.length} models are running. Switching updates the runtime slots without deleting server model files.`}</span>
            </div>
            <button type='button' onClick={refreshModels} disabled={modelsLoading}>
                {modelsLoading ? (zh ? '刷新中…' : 'Refreshing…') : (zh ? '刷新' : 'Refresh')}
            </button>
        </div>
        {modelActionError && <div className='ModelActionError' role='alert'>{modelActionError}</div>}
        {modelsError && <div className='EmptyState error'>
            <strong>{modelsError}</strong>
            <span>{zh ? '请确认核心引擎的模型服务可用。' : 'Check that the core-engine model service is available.'}</span>
        </div>}
        {!modelsError && !modelsLoading && runtimeModels.length === 0 && <div className='EmptyState'>
            <strong>{zh ? '暂无临时模型' : 'No temporary models'}</strong>
            <span>{zh
                ? '前往“持久化模型”选择一个模型并点击“使用”。'
                : 'Open Persistent models, choose a model, and select Use.'}</span>
        </div>}
        <div className='ModelResourceList RuntimeModelList'>
            {runtimeModels.map(model => renderModelItem(model, 'temporary'))}
        </div>
    </section>;

    const renderPersistentModelHeader = () => <div className='TierExplanation models'>
        <div>
            <strong>{zh ? '持久化模型资源' : 'Persistent model resources'}</strong>
            <span>{zh
                ? `${persistentModels.length} 个持久化版本 · ${persistentModels.filter(model => model.callable !== false).length} 个可直接调用 · ${runtimeModels.length} 个正在运行。`
                : `${persistentModels.length} persistent versions · ${persistentModels.filter(model => model.callable !== false).length} directly callable · ${runtimeModels.length} running.`}</span>
        </div>
        <div className='TierHeaderActions'>
            <button type='button' onClick={refreshModels} disabled={modelsLoading}>
                {modelsLoading ? (zh ? '刷新中…' : 'Refreshing…') : (zh ? '刷新' : 'Refresh')}
            </button>
        </div>
    </div>;

    const renderModelCatalogFilter = (orderedCount: number) => <div className='ModelCatalogFilter'>
        <label className='ModelCatalogSelect'>
            <span>{zh ? '排序' : 'Sort'}</span>
            <select
                value={modelSort}
                aria-label={zh ? '模型排序' : 'Model sort'}
                onChange={event => setModelSort(event.target.value as ModelCatalogSort)}
            >
                <option value='relevance'>{zh ? '综合' : 'Relevance'}</option>
                <option value='recent'>{zh ? '最近上传' : 'Recently uploaded'}</option>
                <option value='name'>{zh ? '名称' : 'Name'}</option>
                <option value='size'>{zh ? '文件大小' : 'File size'}</option>
            </select>
        </label>
        <label className='ModelCatalogSelect'>
            <span>{zh ? '类型' : 'Type'}</span>
            <select
                value={modelFormat}
                aria-label={zh ? '模型类型' : 'Model type'}
                onChange={event => setModelFormat(event.target.value)}
            >
                <option value='all'>{zh ? '全部类型' : 'All types'}</option>
                {persistentModelFormats.map(format => (
                    <option value={format} key={format}>{format}</option>
                ))}
            </select>
        </label>
        <label className='ModelCatalogSearch'>
            <span>{zh ? '筛选模型资产' : 'Filter model assets'}</span>
            <input
                type='search'
                value={modelQuery}
                onChange={event => setModelQuery(event.target.value)}
                placeholder={zh ? '名称、项目、分类或路径' : 'Name, project, category, or path'}
            />
        </label>
        <small>{zh
            ? `显示 ${orderedCount} / ${persistentModels.length}`
            : `Showing ${orderedCount} / ${persistentModels.length}`}</small>
    </div>;

    const renderPersistentModelState = () => <>
        {modelActionError && <div className='ModelActionError' role='alert'>{modelActionError}</div>}
        {modelsError && <div className='EmptyState error'>
            <strong>{modelsError}</strong>
            <span>{zh ? '请确认核心引擎的模型服务可用。' : 'Check that the core-engine model service is available.'}</span>
        </div>}
        {!modelsError && !modelsLoading && persistentModels.length === 0 && <div className='EmptyState'>
            <strong>{zh ? '暂无模型资源' : 'No model resources'}</strong>
            <span>{zh
                ? '可在“临时模型”中同步至服务器。'
                : 'Sync a temporary model to the server.'}</span>
        </div>}
    </>;

    const renderPersistentModels = () => {
        const orderedModels = orderPersistentModels(
            persistentModels,
            modelQuery,
            modelFormat,
            modelSort,
            currentModelSlot,
        );
        return <section className='DataTierPanel' aria-label={zh ? '持久化模型' : 'Persistent models'}>
            {renderPersistentModelHeader()}
            {renderPersistentModelState()}
            {renderModelCatalogFilter(orderedModels.length)}
            <div className='ModelResourceList'>
                {orderedModels.map(model => renderModelItem(model))}
            </div>
        </section>;
    };

    const renderModuleSelector = () => <div
        className='ResourceModuleTabs'
        role='tablist'
        aria-label={zh ? '资源类型' : 'Resource type'}
    >
        <button
            id='resource-module-data'
            type='button'
            role='tab'
            aria-label={zh ? '数据' : 'Data'}
            aria-controls='resource-module-panel'
            aria-selected={activeModule === 'data'}
            tabIndex={activeModule === 'data' ? 0 : -1}
            className={activeModule === 'data' ? 'active data' : 'data'}
            onClick={() => {
                setActiveModule('data');
                setActiveTier('persistent');
            }}
            onKeyDown={handleModuleKeyDown}
        >
            {localChangeCount > 0 && <span
                className='ResourceChangeBadge'
                role='status'
                aria-label={zh
                    ? `数据中有 ${localChangeCount} 个本地变动待处理`
                    : `${localChangeCount} local ${localChangeCount === 1 ? 'change' : 'changes'} pending in data`}
            >{localChangeCount}</span>}
            <span className='ResourceModuleCopy'>
                <strong>{zh ? '数据' : 'Data'}</strong>
                <small>{zh ? '工作副本与版本快照' : 'Work copies and version snapshots'}</small>
            </span>
            <span className='ResourceModuleStatus'>
                <i aria-hidden='true' />
                {temporaryItems.length + datasets.length}
            </span>
        </button>
        <button
            id='resource-module-models'
            type='button'
            role='tab'
            aria-label={zh ? '模型' : 'Models'}
            aria-controls='resource-module-panel'
            aria-selected={activeModule === 'models'}
            tabIndex={activeModule === 'models' ? 0 : -1}
            className={activeModule === 'models' ? 'active models' : 'models'}
            onClick={() => {
                setActiveModule('models');
                setActiveTier('persistent');
            }}
            onKeyDown={handleModuleKeyDown}
        >
            <span className='ResourceModuleCopy'>
                <strong>{zh ? '模型' : 'Models'}</strong>
                <small>{zh ? '运行模型与文件版本' : 'Runtime models and file versions'}</small>
            </span>
            <span className='ResourceModuleStatus'>
                <i aria-hidden='true' />
                {persistentModels.length}
            </span>
        </button>
    </div>;

    const renderTierSidebar = () => {
        const copy = tierSidebarCopy(activeModule, zh);
        const temporaryCount = activeModule === 'data' ? temporaryItems.length : runtimeModels.length;
        const persistentCount = activeModule === 'data' ? datasets.length : persistentModels.length;
        return <aside className='DataTierSidebar'>
            <div className='DataTierNavTitle'>{zh ? '存储状态' : 'Storage state'}</div>
            <div
                className='DataTierTabs'
                role='tablist'
                aria-label={copy.ariaLabel}
                aria-orientation='vertical'
            >
                <button
                    id={`resource-tier-${activeModule}-persistent`}
                    type='button'
                    role='tab'
                    aria-label={`${copy.persistentLabel} ${persistentCount}`}
                    aria-controls='data-tier-panel'
                    aria-selected={activeTier === 'persistent'}
                    tabIndex={activeTier === 'persistent' ? 0 : -1}
                    className={activeTier === 'persistent' ? 'active persistent' : ''}
                    onClick={() => setActiveTier('persistent')}
                    onKeyDown={handleTierKeyDown}
                >
                    <span className='DataTierTabCopy'>
                        <span>{copy.persistentLabel}</span>
                        <small>{copy.persistentDetail}</small>
                    </span>
                    <strong>{persistentCount}</strong>
                </button>
                <button
                    id={`resource-tier-${activeModule}-temporary`}
                    type='button'
                    role='tab'
                    aria-label={`${copy.temporaryLabel} ${temporaryCount}`}
                    aria-controls='data-tier-panel'
                    aria-selected={activeTier === 'temporary'}
                    tabIndex={activeTier === 'temporary' ? 0 : -1}
                    className={activeTier === 'temporary' ? 'active temporary' : ''}
                    onClick={() => setActiveTier('temporary')}
                    onKeyDown={handleTierKeyDown}
                >
                    {activeModule === 'data' && localChangeCount > 0 && <span
                        className='ResourceChangeBadge'
                        role='status'
                        aria-label={zh
                            ? `临时数据中有 ${localChangeCount} 个本地变动待处理`
                            : `${localChangeCount} local ${localChangeCount === 1 ? 'change' : 'changes'} pending in temporary data`}
                    >{localChangeCount}</span>}
                    <span className='DataTierTabCopy'>
                        <span>{copy.temporaryLabel}</span>
                        <small>{copy.temporaryDetail}</small>
                    </span>
                    <strong>{temporaryCount}</strong>
                </button>
            </div>
            <p className='DataTierSidebarHint'>{copy.hint}</p>
        </aside>;
    };

    const renderContent = () => (
        <div className='DataCenterPopupContent'>
            {renderModuleSelector()}
            <div
                id='resource-module-panel'
                className='DataWorkspace'
                role='tabpanel'
                aria-labelledby={`resource-module-${activeModule}`}
            >
                {renderTierSidebar()}
                <div
                    id='data-tier-panel'
                    className='DataTierMain'
                    role='region'
                    aria-labelledby={`resource-tier-${activeModule}-${activeTier}`}
                >
                    {activeModule === 'data'
                        ? (activeTier === 'temporary' ? renderTemporaryData() : renderPersistentData())
                        : (activeTier === 'temporary' ? renderTemporaryModels() : renderPersistentModels())}
                </div>
            </div>
        </div>
    );

    const renderDatasetImagePreview = () => {
        if (!datasetImagePreview) return null;
        const dataset = datasets.find(item => item.id === datasetImagePreview.datasetId);
        if (!dataset) return null;
        const position = datasetPreviewItems.findIndex(item => item.index === datasetImagePreview.index);
        const hasPrevious = position > 0;
        const hasNext = position >= 0 && position < datasetPreviewItems.length - 1;
        return createPortal(
            <div
                className='DatasetImagePreviewBackdrop'
                role='presentation'
                onMouseDown={() => setDatasetImagePreview(null)}
            >
                <div
                    className='DatasetImagePreviewDialog'
                    role='dialog'
                    aria-modal='true'
                    aria-label={zh ? '数据集图片预览' : 'Dataset image preview'}
                    onMouseDown={event => event.stopPropagation()}
                >
                    <button
                        type='button'
                        className='DatasetImagePreviewClose'
                        aria-label={zh ? '关闭图片预览' : 'Close image preview'}
                        onClick={() => setDatasetImagePreview(null)}
                    >×</button>
                    <button
                        type='button'
                        className='DatasetImagePreviewNav previous'
                        aria-label={zh ? '上一张' : 'Previous image'}
                        disabled={!hasPrevious}
                        onClick={() => moveDatasetImagePreview(-1)}
                    ><span aria-hidden='true' /></button>
                    <button
                        type='button'
                        className='DatasetImagePreviewNav next'
                        aria-label={zh ? '下一张' : 'Next image'}
                        disabled={!hasNext}
                        onClick={() => moveDatasetImagePreview(1)}
                    ><span aria-hidden='true' /></button>
                    <img
                        src={datasetPreviewUrl(dataset, datasetImagePreview, 'original')}
                        alt={datasetImagePreview.name}
                    />
                    <div className='DatasetImagePreviewCaption'>
                        <span title={datasetImagePreview.name}>{datasetImagePreview.name}</span>
                        <small>{datasetImagePreview.index + 1} / {datasetPreviewTotal}</small>
                    </div>
                </div>
            </div>,
            document.body,
        );
    };

    return (
        <>
            <GenericYesNoPopup
                title={zh ? '资源中心' : 'Resource Center'}
                renderContent={renderContent}
                skipAcceptButton
                rejectLabel={zh ? '关闭' : 'Close'}
                onReject={() => PopupActions.close()}
            />
            {renderDatasetImagePreview()}
        </>
    );
};

const mapDispatchToProps = {
    updateActivePopupTypeAction: updateActivePopupType,
    updateQueueItemAction: updateQueueItem,
    removeQueueItemAction: removeQueueItem,
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
    projectName: state.general.projectData.name,
    queueItems: state.queue.items,
    activeQueueItemId: state.queue.activeQueueItemId,
    activeVideoId: state.video.activeVideo?.id || null,
    activeVideoSessionId: state.video.activeVideo?.sessionId,
    imagesData: state.labels.imagesData,
    labels: state.labels.labels,
});

export default connect(mapStateToProps, mapDispatchToProps)(DataCenterPopup);
