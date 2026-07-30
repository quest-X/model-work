import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useDropzone} from 'react-dropzone';
import {connect} from 'react-redux';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {getEngineBaseUrl, getExtensionEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import {consumeSimilaritySearchPreset} from '../../../ai/SimilaritySearchPresetStore';
import './L2GRetrievalPopup.scss';

type RetrievalEngine = 'dino' | 'l2g';
type Granularity = 'image' | 'bbox';

interface PipelineStatus {
    state: string;
    error: string | null;
}

interface L2GStatus {
    status: string;
    version: string;
    pipeline: PipelineStatus;
    vector_store?: {
        state: string;
        collection: string | null;
        count: number;
        error?: string | null;
    };
    config_file: string;
    defaults: {top_k: number; max_database_size: number};
}

interface DinoStatus {
    status: string;
    vector_store: {state: string; error: string | null};
    embedder: {
        state: string;
        progress: number;
        model: string;
        dim: number | null;
        device: string | null;
        error: string | null;
    };
}

interface DinoCollection {
    name: string;
    display_name: string;
    scene_id: string;
    target_id: string;
    target_name?: string;
    scene_name?: string;
    version: number;
    data_version?: number;
    granularity: Granularity;
    count: number;
    embedder: string;
    profile_id: string;
    compatible: boolean;
    compatibility_reason: string | null;
}

interface DinoResult {
    score: number;
    filename: string;
    class_name: string;
    thumbnail: string | null;
}

interface L2GResult {
    path: string;
    score: number;
    thumbnail: string | null;
}

interface SearchSnapshot<T> {
    results: T[];
    elapsed: number | null;
    attempted: boolean;
    error: string | null;
    searching: boolean;
}

interface DatasetSummary {
    id: string;
    name: string;
    project_name?: string | null;
    image_count: number;
    revision: number;
    status: string;
}

interface IProps {
    language: Language;
}

const findDataset = (datasets: DatasetSummary[], datasetId: string): DatasetSummary | null =>
    datasets.find(item => item.id === datasetId) ?? null;

const datasetProjectName = (dataset: DatasetSummary | null): string =>
    dataset?.project_name ?? '';

const selectedDatasetNameOrEmpty = (dataset: DatasetSummary | null): string =>
    dataset?.name ?? '';

const emptySearchSnapshot = <T,>(): SearchSnapshot<T> => ({
    results: [],
    elapsed: null,
    attempted: false,
    error: null,
    searching: false,
});

const resolvePresetDefaults = (preset: ReturnType<typeof consumeSimilaritySearchPreset>) => ({
    engine: preset?.mode ?? 'dino' as RetrievalEngine,
    collectionName: preset?.collectionName ?? '',
    datasetId: preset?.datasetId ?? '',
    queryFile: preset?.queryFile ?? null,
});

const readResponse = async <T,>(response: Response): Promise<T> => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = (body as {detail?: unknown}).detail;
        throw new Error(typeof detail === 'string' ? detail : String(response.status));
    }
    return body as T;
};

export const L2GRetrievalPopup: React.FC<IProps> = ({language}) => {
    const [similarityPreset] = useState(() => consumeSimilaritySearchPreset());
    const presetDefaults = resolvePresetDefaults(similarityPreset);
    const pendingPresetSearchRef = useRef(!!similarityPreset);
    const zh = language === Language.CHINESE;
    const t = useCallback(
        (zhText: string, enText: string) => (zh ? zhText : enText),
        [zh],
    );
    const extensionBaseUrl = getExtensionEngineBaseUrl();
    const coreBaseUrl = getEngineBaseUrl();
    const dinoBaseUrl = `${extensionBaseUrl}/vector_db`;
    const l2gBaseUrl = `${extensionBaseUrl}/l2g_retrieval`;

    const [engine, setEngine] = useState<RetrievalEngine>(presetDefaults.engine);
    const [dinoStatus, setDinoStatus] = useState<DinoStatus | null>(null);
    const [dinoDown, setDinoDown] = useState(false);
    const [dinoCollections, setDinoCollections] = useState<DinoCollection[]>([]);
    const [collectionsLoading, setCollectionsLoading] = useState(true);
    const [collectionsError, setCollectionsError] = useState<string | null>(null);
    const [selectedCollectionName, setSelectedCollectionName] = useState(presetDefaults.collectionName);
    const [warmingDino, setWarmingDino] = useState(false);

    const [l2gStatus, setL2GStatus] = useState<L2GStatus | null>(null);
    const [l2gDown, setL2GDown] = useState(false);
    const [warmingL2G, setWarmingL2G] = useState(false);
    const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
    const [datasetsLoading, setDatasetsLoading] = useState(true);
    const [datasetsError, setDatasetsError] = useState<string | null>(null);
    const [selectedDatasetId, setSelectedDatasetId] = useState(presetDefaults.datasetId);

    const [queryFile, setQueryFile] = useState<File | null>(presetDefaults.queryFile);
    const [queryPreview, setQueryPreview] = useState<string | null>(null);
    const queryPreviewRef = useRef<string | null>(null);
    const [topK, setTopK] = useState(12);
    const [classFilter, setClassFilter] = useState('');
    const [queryBbox, setQueryBbox] = useState('');
    const [dinoSearch, setDinoSearch] = useState<SearchSnapshot<DinoResult>>(emptySearchSnapshot);
    const [l2gSearch, setL2GSearch] = useState<SearchSnapshot<L2GResult>>(emptySearchSnapshot);
    const searchingRef = useRef<Record<RetrievalEngine, boolean>>({dino: false, l2g: false});
    const currentSearch = engine === 'dino' ? dinoSearch : l2gSearch;
    const {
        results: currentResults,
        elapsed,
        attempted: searchAttempted,
        error: searchError,
        searching,
    } = currentSearch;
    const anySearching = dinoSearch.searching || l2gSearch.searching;

    const selectedCollection = dinoCollections.find(item => item.name === selectedCollectionName) || null;
    const selectedSceneName = selectedCollection?.scene_name || '';
    const selectedTargetName = selectedCollection
        ? selectedCollection.target_name || selectedCollection.display_name
        : '';
    const sceneNames = Array.from(new Set(dinoCollections.map(item => item.scene_name || '')));
    const targetNames = Array.from(new Set(
        dinoCollections
            .filter(item => (item.scene_name || '') === selectedSceneName)
            .map(item => item.target_name || item.display_name),
    ));
    const versionCollections = dinoCollections.filter(item =>
        (item.scene_name || '') === selectedSceneName
        && (item.target_name || item.display_name) === selectedTargetName,
    );
    const selectedDataset = findDataset(datasets, selectedDatasetId);
    const selectedProjectName = datasetProjectName(selectedDataset);
    const selectedDatasetName = selectedDatasetNameOrEmpty(selectedDataset);
    const projectNames = Array.from(new Set(datasets.map(item => item.project_name || '')));
    const datasetNames = Array.from(new Set(
        datasets
            .filter(item => (item.project_name || '') === selectedProjectName)
            .map(item => item.name),
    ));
    const revisionDatasets = datasets.filter(item =>
        (item.project_name || '') === selectedProjectName
        && item.name === selectedDatasetName,
    );
    const dinoReady = dinoStatus?.vector_store.state === 'ready' && dinoStatus?.embedder.state === 'ready';
    const l2gReady = l2gStatus?.pipeline?.state === 'ready';

    const selectPreferredCollection = (collections: DinoCollection[]) =>
        collections.find(item => item.compatible && item.count > 0) || collections[0] || null;

    const selectScene = (sceneName: string) => {
        const nextCollection = selectPreferredCollection(
            dinoCollections.filter(item => (item.scene_name || '') === sceneName),
        );
        setSelectedCollectionName(nextCollection?.name || '');
    };

    const selectTarget = (targetName: string) => {
        const nextCollection = selectPreferredCollection(
            dinoCollections.filter(item =>
                (item.scene_name || '') === selectedSceneName
                && (item.target_name || item.display_name) === targetName,
            ),
        );
        setSelectedCollectionName(nextCollection?.name || '');
    };

    const selectDatasetProject = (projectName: string) => {
        const nextDataset = datasets.find(item => (item.project_name || '') === projectName);
        setSelectedDatasetId(nextDataset?.id || '');
    };

    const selectDatasetTarget = (datasetName: string) => {
        const nextDataset = datasets.find(item =>
            (item.project_name || '') === selectedProjectName
            && item.name === datasetName,
        );
        setSelectedDatasetId(nextDataset?.id || '');
    };

    const fetchDinoStatus = useCallback(async () => {
        try {
            const response = await fetch(`${dinoBaseUrl}/status`);
            setDinoStatus(await readResponse<DinoStatus>(response));
            setDinoDown(false);
        } catch {
            setDinoDown(true);
        }
    }, [dinoBaseUrl]);

    const fetchL2GStatus = useCallback(async () => {
        try {
            const response = await fetch(`${l2gBaseUrl}/status`);
            setL2GStatus(await readResponse<L2GStatus>(response));
            setL2GDown(false);
        } catch {
            setL2GDown(true);
        }
    }, [l2gBaseUrl]);

    const fetchCollections = useCallback(async () => {
        setCollectionsLoading(true);
        setCollectionsError(null);
        try {
            const response = await fetch(`${dinoBaseUrl}/collections`);
            const body = await readResponse<{collections?: DinoCollection[]}>(response);
            const collections = Array.isArray(body.collections) ? body.collections : [];
            setDinoCollections(collections);
            setSelectedCollectionName(current => {
                if (similarityPreset?.mode === 'dino') {
                    const targetLatest = collections
                        .filter(item =>
                            item.scene_id === similarityPreset.sceneId
                            && item.target_id === similarityPreset.targetId
                        )
                        .sort((left, right) => right.version - left.version)[0];
                    if (targetLatest) return targetLatest.name;
                }
                if (current && collections.some(item => item.name === current)) return current;
                const preferred = collections.find(item => item.compatible && item.count > 0);
                return preferred?.name || collections[0]?.name || '';
            });
        } catch (cause) {
            setCollectionsError(cause instanceof Error ? cause.message : t('DINO 向量版本加载失败', 'Failed to load DINO vector versions'));
        } finally {
            setCollectionsLoading(false);
        }
    }, [dinoBaseUrl, similarityPreset, t]);

    const fetchDatasets = useCallback(async () => {
        setDatasetsLoading(true);
        setDatasetsError(null);
        try {
            const response = await fetch(`${coreBaseUrl}/datasets`);
            const body = await readResponse<{datasets?: DatasetSummary[]}>(response);
            const nextDatasets = Array.isArray(body.datasets)
                ? body.datasets.filter(dataset => dataset.status === 'ready' && dataset.image_count > 0)
                : [];
            setDatasets(nextDatasets);
            setSelectedDatasetId(current => {
                if (similarityPreset?.mode === 'l2g' && similarityPreset.datasetId) {
                    return similarityPreset.datasetId;
                }
                if (current && nextDatasets.some(dataset => dataset.id === current)) return current;
                return nextDatasets[0]?.id || '';
            });
        } catch (cause) {
            setDatasetsError(cause instanceof Error ? cause.message : t('数据集加载失败', 'Failed to load datasets'));
        } finally {
            setDatasetsLoading(false);
        }
    }, [coreBaseUrl, similarityPreset, t]);

    useEffect(() => {
        if (!similarityPreset?.queryFile || queryPreviewRef.current) return;
        const preview = URL.createObjectURL(similarityPreset.queryFile);
        queryPreviewRef.current = preview;
        setQueryPreview(preview);
    }, [similarityPreset]);

    useEffect(() => {
        fetchDinoStatus();
        fetchL2GStatus();
        fetchCollections();
        fetchDatasets();
        const timer = window.setInterval(() => {
            fetchDinoStatus();
            fetchL2GStatus();
        }, 5000);
        return () => window.clearInterval(timer);
    }, [fetchCollections, fetchDatasets, fetchDinoStatus, fetchL2GStatus]);

    useEffect(() => () => {
        if (queryPreviewRef.current) URL.revokeObjectURL(queryPreviewRef.current);
    }, []);

    const warmupDino = async () => {
        setWarmingDino(true);
        try {
            await readResponse(await fetch(`${dinoBaseUrl}/warmup`, {method: 'POST'}));
        } catch {
            // The status banner will expose any warmup failure.
        } finally {
            await fetchDinoStatus();
            setWarmingDino(false);
        }
    };

    const warmupL2G = async () => {
        setWarmingL2G(true);
        try {
            await readResponse(await fetch(`${l2gBaseUrl}/warmup`, {method: 'POST'}));
        } catch {
            // The status banner will expose any warmup failure.
        } finally {
            await fetchL2GStatus();
            setWarmingL2G(false);
        }
    };

    const onDrop = useCallback((accepted: File[]) => {
        const file = accepted[0];
        if (!file) return;
        if (queryPreviewRef.current) URL.revokeObjectURL(queryPreviewRef.current);
        const preview = URL.createObjectURL(file);
        queryPreviewRef.current = preview;
        setQueryFile(file);
        setQueryPreview(preview);
        setDinoSearch(emptySearchSnapshot());
        setL2GSearch(emptySearchSnapshot());
    }, []);

    const queryDropzone = useDropzone({
        onDrop,
        accept: {'image/*': ['.jpg', '.jpeg', '.png', '.bmp', '.webp']},
        multiple: false,
        disabled: anySearching,
    });

    const changeEngine = (nextEngine: RetrievalEngine) => {
        setEngine(nextEngine);
    };

    const searchDino = async (): Promise<{results: DinoResult[]; elapsed: number}> => {
        if (!queryFile || !selectedCollection) {
            throw new Error(t('请选择查询图与向量版本。', 'Choose a query image and vector version.'));
        }
        const form = new FormData();
        form.append('file', queryFile);
        form.append('collection', selectedCollection.name);
        form.append('top_k', String(topK));
        if (selectedCollection.granularity === 'bbox' && classFilter.trim()) {
            form.append('class_name', classFilter.trim());
        }
        if (selectedCollection.granularity === 'bbox' && queryBbox.trim()) {
            form.append('bbox', queryBbox.trim());
        }
        const startedAt = performance.now();
        const response = await fetch(`${dinoBaseUrl}/search`, {method: 'POST', body: form});
        const body = await readResponse<{results?: DinoResult[]}>(response);
        return {
            results: Array.isArray(body.results) ? body.results : [],
            elapsed: Number(((performance.now() - startedAt) / 1000).toFixed(3)),
        };
    };

    const searchL2G = async (): Promise<{results: L2GResult[]; elapsed: number | null}> => {
        if (!queryFile || !selectedDatasetId) {
            throw new Error(t('请选择查询图与数据集。', 'Choose a query image and dataset.'));
        }
        const form = new FormData();
        form.append('query', queryFile);
        form.append('dataset_id', selectedDatasetId);
        form.append('top_k', String(topK));
        const response = await fetch(`${l2gBaseUrl}/search`, {method: 'POST', body: form});
        const body = await readResponse<{results?: L2GResult[]; elapsed_s?: number}>(response);
        return {
            results: Array.isArray(body.results) ? body.results : [],
            elapsed: body.elapsed_s ?? null,
        };
    };

    const runSearch = async () => {
        const searchEngine = engine;
        if (searchingRef.current[searchEngine]) return;
        searchingRef.current[searchEngine] = true;
        if (searchEngine === 'dino') {
            setDinoSearch(previous => ({
                ...previous,
                attempted: true,
                error: null,
                searching: true,
            }));
        } else {
            setL2GSearch(previous => ({
                ...previous,
                attempted: true,
                error: null,
                searching: true,
            }));
        }
        try {
            if (searchEngine === 'dino') {
                const result = await searchDino();
                setDinoSearch(previous => ({
                    ...previous,
                    ...result,
                    attempted: true,
                    error: null,
                }));
            } else {
                const result = await searchL2G();
                setL2GSearch(previous => ({
                    ...previous,
                    ...result,
                    attempted: true,
                    error: null,
                }));
            }
        } catch (cause) {
            const error = cause instanceof Error
                ? cause.message
                : t('视觉检索失败，请检查引擎状态与输入。', 'Visual search failed. Check the engine status and input.');
            if (searchEngine === 'dino') {
                setDinoSearch(previous => ({...previous, attempted: true, error}));
            } else {
                setL2GSearch(previous => ({...previous, attempted: true, error}));
            }
        } finally {
            searchingRef.current[searchEngine] = false;
            if (searchEngine === 'dino') {
                setDinoSearch(previous => ({...previous, searching: false}));
            } else {
                setL2GSearch(previous => ({...previous, searching: false}));
            }
        }
    };

    const renderDinoBanner = () => {
        if (dinoDown) return <div className='Banner error'>{t('DINO 向量服务不可达', 'DINO vector service is unreachable')}</div>;
        const storeError = dinoStatus?.vector_store?.error;
        const embedderError = dinoStatus?.embedder?.error;
        if (storeError || embedderError) {
            return <div className='Banner error'>{t('DINO 服务异常：', 'DINO service error: ')}{storeError || embedderError}</div>;
        }
        if (dinoReady) {
            return <div className='Banner ok'>
                {t('DINO 检索就绪', 'DINO retrieval ready')} · {dinoStatus?.embedder.model} · {dinoStatus?.embedder.dim || '—'}d · {dinoStatus?.embedder.device || '—'}
            </div>;
        }
        return <div className='Banner info'>
            {dinoStatus?.embedder.state === 'loading'
                ? t(`DINO 模型加载中 · ${Math.round(dinoStatus.embedder.progress || 0)}%`, `Loading DINO model · ${Math.round(dinoStatus.embedder.progress || 0)}%`)
                : t('DINO 特征模型尚未加载。', 'The DINO feature model is not loaded. ')}
            {dinoStatus?.embedder.state !== 'loading' && <button className='InlineButton' disabled={warmingDino} onClick={warmupDino}>
                {warmingDino ? t('加载中…', 'Loading…') : t('加载 DINO 模型', 'Load DINO model')}
            </button>}
        </div>;
    };

    const renderL2GBanner = () => {
        const pipelineState = l2gStatus?.pipeline?.state ?? 'unknown';
        if (l2gDown) return <div className='Banner error'>{t('L2G 服务不可达或插件未启用', 'L2G service is unreachable or disabled')}</div>;
        if (pipelineState === 'error' || pipelineState === 'missing_dep') {
            return <div className='Banner error'>{t('L2G 管道异常：', 'L2G pipeline error: ')}{l2gStatus?.pipeline?.error ?? pipelineState}</div>;
        }
        if (l2gStatus?.vector_store?.state === 'error') {
            return <div className='Banner error'>{t('L2G Milvus 异常：', 'L2G Milvus error: ')}{l2gStatus.vector_store.error}</div>;
        }
        if (pipelineState === 'loading') return <div className='Banner info'>{t('L2G 管道加载中…', 'Loading L2G pipeline…')}</div>;
        if (l2gReady) return <div className='Banner ok'>
            {t('L2G 检索就绪', 'L2G retrieval ready')} · v{l2gStatus?.version} · Milvus {l2gStatus?.vector_store?.count || 0}
        </div>;
        return <div className='Banner info'>
            {t('L2G 管道尚未加载。', 'The L2G pipeline is not loaded. ')}
            <button className='InlineButton' disabled={warmingL2G} onClick={warmupL2G}>
                {warmingL2G ? t('加载中…', 'Loading…') : t('加载 L2G 管道', 'Load L2G pipeline')}
            </button>
        </div>;
    };

    const renderDinoFields = () => (
        <>
            <div className='HierarchySelectors'>
                <label>
                    {t('场景', 'Scene')}
                    <select
                        value={selectedSceneName}
                        disabled={collectionsLoading || !!collectionsError || dinoCollections.length === 0}
                        onChange={event => selectScene(event.target.value)}
                    >
                        {dinoCollections.length === 0 && <option value=''>
                            {collectionsLoading ? t('正在读取…', 'Loading…') : t('暂无可用场景', 'No scenes available')}
                        </option>}
                        {sceneNames.map(sceneName => (
                            <option key={sceneName || '__default_scene__'} value={sceneName}>
                                {sceneName || t('默认场景', 'Default scene')}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    {t('目标', 'Target')}
                    <select
                        value={selectedTargetName}
                        disabled={collectionsLoading || !!collectionsError || targetNames.length === 0}
                        onChange={event => selectTarget(event.target.value)}
                    >
                        {targetNames.length === 0 && <option value=''>{t('暂无可用目标', 'No targets available')}</option>}
                        {targetNames.map(targetName => (
                            <option key={targetName} value={targetName}>{targetName}</option>
                        ))}
                    </select>
                </label>
                <label>
                    {t('版本', 'Version')}
                    <select
                        value={selectedCollectionName}
                        disabled={collectionsLoading || !!collectionsError || versionCollections.length === 0}
                        onChange={event => setSelectedCollectionName(event.target.value)}
                    >
                        {versionCollections.length === 0 && <option value=''>{t('暂无可用版本', 'No versions available')}</option>}
                        {versionCollections.map(item => (
                            <option key={item.name} value={item.name} disabled={!item.compatible || item.count === 0}>
                                v{item.version} · {item.granularity === 'bbox' ? t('目标框', 'bbox') : t('整图', 'image')} · {item.count}
                                {!item.compatible ? ` · ${t('不兼容', 'incompatible')}` : ''}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            {selectedCollection && <div className='ProfileBinding'>
                <span>{t('特征配置', 'Feature Profile')}</span>
                <strong title={selectedCollection.profile_id}>{selectedCollection.profile_id}</strong>
                <small>{selectedCollection.embedder}</small>
            </div>}
            {collectionsError && <div className='FieldError'>
                <span>{collectionsError}</span>
                <button type='button' onClick={fetchCollections}>{t('重试', 'Retry')}</button>
            </div>}
            {selectedCollection?.granularity === 'bbox' && <div className='InlineFields'>
                <label>
                    {t('类别过滤（可选）', 'Class filter (optional)')}
                    <input value={classFilter} onChange={event => setClassFilter(event.target.value)} />
                </label>
                <label>
                    {t('查询框（可选）', 'Query bbox (optional)')}
                    <input placeholder='x1,y1,x2,y2' value={queryBbox} onChange={event => setQueryBbox(event.target.value)} />
                </label>
            </div>}
        </>
    );

    const renderL2GFields = () => (
        <>
            <div className='HierarchySelectors'>
                <label>
                    {t('场景', 'Scene')}
                    <select
                        value={selectedProjectName}
                        disabled={datasetsLoading || !!datasetsError || datasets.length === 0}
                        onChange={event => selectDatasetProject(event.target.value)}
                    >
                        {datasets.length === 0 && <option value=''>
                            {datasetsLoading ? t('正在读取…', 'Loading…') : t('暂无可用场景', 'No scenes available')}
                        </option>}
                        {projectNames.map(projectName => (
                            <option key={projectName || '__default_project__'} value={projectName}>
                                {projectName || t('默认场景', 'Default scene')}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    {t('目标', 'Target')}
                    <select
                        value={selectedDatasetName}
                        disabled={datasetsLoading || !!datasetsError || datasetNames.length === 0}
                        onChange={event => selectDatasetTarget(event.target.value)}
                    >
                        {datasetNames.length === 0 && <option value=''>{t('暂无可用目标', 'No targets available')}</option>}
                        {datasetNames.map(datasetName => (
                            <option key={datasetName} value={datasetName}>{datasetName}</option>
                        ))}
                    </select>
                </label>
                <label>
                    {t('版本', 'Version')}
                    <select
                        value={selectedDatasetId}
                        disabled={datasetsLoading || !!datasetsError || revisionDatasets.length === 0}
                        onChange={event => setSelectedDatasetId(event.target.value)}
                    >
                        {revisionDatasets.length === 0 && <option value=''>{t('暂无可用版本', 'No versions available')}</option>}
                        {revisionDatasets.map(dataset => (
                            <option key={dataset.id} value={dataset.id}>
                                v{dataset.revision || 1} · {dataset.image_count} {t('张', 'images')}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            {datasetsError && <div className='FieldError'>
                <span>{datasetsError}</span>
                <button type='button' onClick={fetchDatasets}>{t('重试', 'Retry')}</button>
            </div>}
        </>
    );

    const canSearch = engine === 'dino'
        ? !!queryFile && !!selectedCollection && selectedCollection.compatible && selectedCollection.count > 0 && dinoReady
        : !!queryFile && !!selectedDatasetId && l2gReady;

    useEffect(() => {
        if (!pendingPresetSearchRef.current || !canSearch || searchingRef.current[engine]) return;
        pendingPresetSearchRef.current = false;
        void runSearch();
    }, [canSearch, engine]);

    const renderResults = () => {
        if (!searchAttempted || searchError) return null;
        if (!searching && currentResults.length === 0) {
            return <div className='EmptyHint'>{t('没有找到相似结果', 'No similar results found')}</div>;
        }
        if (currentResults.length === 0) return null;
        return <div className='ResultGrid' aria-live='polite'>
            {currentResults.map((item, index) => {
                const dinoItem = engine === 'dino' ? item as DinoResult : null;
                const l2gItem = engine === 'l2g' ? item as L2GResult : null;
                const label = dinoItem?.filename || l2gItem?.path || '';
                return <div className='ResultCard' key={`${label}-${index}`}>
                    {item.thumbnail
                        ? <img src={item.thumbnail} alt={label}/>
                        : <div className='ThumbPlaceholder'>{t('无缩略图', 'No preview')}</div>}
                    <div className='RankBadge'>{index + 1}</div>
                    <div className='ScoreBadge'>{(item.score * 100).toFixed(1)}%</div>
                    <div className='ResultMeta'>
                        {dinoItem?.class_name && <span className='ClassTag'>{dinoItem.class_name}</span>}
                        <span className='FileName' title={label}>{label}</span>
                    </div>
                </div>;
            })}
        </div>;
    };

    const renderEngineHint = () => <div className='Hint'>
        {engine === 'dino'
            ? t('选择向量数据库中的场景、目标和版本进行毫秒级相似检索。查询会绑定该版本的特征配置，不会跨模型混检。',
                'Run millisecond similarity search against a scene, target and version from Vector Database. Queries bind to that version profile and never mix model spaces.')
            : t('高精度模式复用数据中心的唯一原图，由 L2G 局部特征与全局重排处理困难样本，无需填写服务器路径。',
                'High-precision mode reuses canonical data-center images and applies L2G local-to-global reranking without server paths.')}
    </div>;

    const renderSearchForm = () => <div className='SearchForm'>
        <div className='QueryPanel'>
            <div {...queryDropzone.getRootProps({className: `QueryDropzone${queryDropzone.isDragActive ? ' active' : ''}`})}>
                <input {...queryDropzone.getInputProps()} />
                {queryPreview
                    ? <img className='QueryPreview' src={queryPreview} alt={queryFile?.name || t('查询图片', 'Query image')}/>
                    : <span>{t('拖入或点击选择查询图', 'Drop or click to choose a query image')}</span>}
            </div>
            {queryFile && <div className='QueryFileName' title={queryFile.name}>{queryFile.name}</div>}
        </div>
        <div className='Fields'>
            {engine === 'dino' ? renderDinoFields() : renderL2GFields()}
            <label className='TopKField'>
                Top-K
                <input type='number' min={1} max={100} value={topK} onChange={event => setTopK(Math.max(1, Math.min(100, Number(event.target.value) || 12)))}/>
            </label>
            <button type='button' className='SearchButton' disabled={!canSearch || searching} onClick={runSearch}>
                {searching ? t('检索中…', 'Searching…') : t('开始视觉检索', 'Run visual search')}
            </button>
        </div>
    </div>;

    const renderResultSummary = () => elapsed !== null && <div className='ResultSummary'>
        {t('检索引擎', 'Engine')}：{engine === 'dino' ? 'DINO' : 'L2G'} · {t('耗时', 'Elapsed')} {elapsed}s · {currentResults.length} {t('个结果', 'results')}
    </div>;

    const renderContent = () => (
        <div className='L2GRetrievalPopupContent VisualRetrievalPopupContent'>
            <div className='EngineTabs' role='tablist' aria-label={t('视觉检索引擎', 'Visual retrieval engine')}>
                <button type='button' role='tab' aria-selected={engine === 'dino'} className={engine === 'dino' ? 'active' : ''} onClick={() => changeEngine('dino')}>
                    <strong>{t('快速模式', 'Fast Mode')}</strong>
                    <span>{t('DINO 向量检索', 'DINO vector search')}</span>
                    <i className={dinoReady ? 'ready' : 'pending'}/>
                </button>
                <button type='button' role='tab' aria-selected={engine === 'l2g'} className={engine === 'l2g' ? 'active' : ''} onClick={() => changeEngine('l2g')}>
                    <strong>{t('高精度模式', 'High-precision Mode')}</strong>
                    <span>{t('L2G 局部到全局重排', 'L2G local-to-global reranking')}</span>
                    <i className={l2gReady ? 'ready' : 'pending'}/>
                </button>
            </div>
            {engine === 'dino' ? renderDinoBanner() : renderL2GBanner()}
            {similarityPreset && <div className='Hint'>
                {t('推理栏检索方案：', 'Inference-bar retrieval plan: ')}
                <strong>{similarityPreset.sceneName} / {similarityPreset.targetName}</strong>
                {' · '}
                {engine === 'dino' ? t('快速', 'Fast') : t('精细', 'Precision')}
                {' · '}
                {t(`最新数据版本 v${similarityPreset.dataVersion}`, `Latest data version v${similarityPreset.dataVersion}`)}
            </div>}
            {renderEngineHint()}
            {renderSearchForm()}
            {searchError && <div className='Banner error' role='alert'>{searchError}</div>}
            {renderResultSummary()}
            {renderResults()}
        </div>
    );

    return <GenericYesNoPopup
        title={t('视觉检索', 'Visual Retrieval')}
        renderContent={renderContent}
        skipAcceptButton
        rejectLabel={t('关闭', 'Close')}
        onReject={() => PopupActions.close()}
    />;
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
});

export default connect(mapStateToProps)(L2GRetrievalPopup);
