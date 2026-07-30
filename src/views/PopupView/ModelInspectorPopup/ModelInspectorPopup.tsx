import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {connect} from 'react-redux';
import {saveAs} from 'file-saver';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {ImageData} from '../../../store/labels/types';
import {ImageRepository} from '../../../logic/imageRepository/ImageRepository';
import {EditorModel} from '../../../staticModels/EditorModel';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {
    CatalogDetail,
    HeatmapKind,
    HeatmapPalette,
    InspectionLayerResult,
    InspectionSession,
    InspectorLayer,
    InspectorSlot,
    InspectorStatus,
    ModelInspectorAPI,
    SlotCapability,
} from './ModelInspectorAPI';
import './ModelInspectorPopup.scss';

export const MODEL_INSPECTOR_ESCAPE_EVENT = 'opensight:model-inspector-escape';

interface IProps {
    language: Language;
    activeImage: ImageData | null;
    activeModelTask: string | null;
}

const MAP_KINDS: Array<{value: Exclude<HeatmapKind, 'channel' | 'gradcam'>; zh: string; en: string}> = [
    {value: 'mean_abs', zh: '平均响应', en: 'Mean response'},
    {value: 'max_abs', zh: '峰值响应', en: 'Peak response'},
    {value: 'eigen', zh: '主成分', en: 'Principal map'},
];

const PALETTES: HeatmapPalette[] = ['turbo', 'magma', 'viridis', 'inferno', 'jet', 'gray'];

const stateLabel = (state: SlotCapability['state'], zh: boolean): string => {
    const values: Record<SlotCapability['state'], [string, string]> = {
        ready: ['可检查', 'Ready'],
        not_loaded: ['未加载', 'Not loaded'],
        unsupported: ['不支持', 'Unsupported'],
        unavailable: ['不可用', 'Unavailable'],
    };
    return values[state][zh ? 0 : 1];
};

const bytesLabel = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${Math.max(0, bytes / 1024).toFixed(0)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
};

const parametersLabel = (value: number): string => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return String(value);
};

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
});

const isAbortError = (cause: unknown): boolean =>
    cause instanceof DOMException && cause.name === 'AbortError';

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error && cause.message ? cause.message : fallback;

const sessionCaptureOptions = (
    selectedCount: number,
    limits: InspectorStatus['limits'] | undefined,
): {imgsz: number; topK: number; maxSide: number} => {
    const batched = selectedCount > (limits?.max_layers || 32);
    return {
        imgsz: 640,
        topK: batched ? limits?.batch_top_channels || 4 : 8,
        maxSide: batched ? limits?.batch_map_side || 160 : limits?.max_map_side || 256,
    };
};

const decodedImageForFrame = (imageData: ImageData): HTMLImageElement | undefined => {
    const currentVideoFrame = EditorModel.videoFrameImage;
    const matchesPlaybackFrame = !EditorModel.playbackImageData
        || EditorModel.playbackImageData.id === imageData.id;
    if (
        imageData.fileData.size === 0
        && matchesPlaybackFrame
        && currentVideoFrame?.getAttribute('src')
    ) {
        return currentVideoFrame;
    }
    return ImageRepository.getById(imageData.id);
};

const canvasFileFromRepository = async (imageData: ImageData): Promise<File> => {
    if (imageData.fileData && imageData.fileData.size > 0) return imageData.fileData;
    const image = decodedImageForFrame(imageData);
    if (!image || !image.src) throw new Error('当前帧尚未解码，请先在编辑器中显示该帧');
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error('当前帧没有可用像素');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('无法读取当前帧');
    return new File([blob], `${imageData.id}.png`, {type: 'image/png'});
};

// The workbench intentionally coordinates status, capture, comparison and export
// in one popup so its short-lived session can be disposed from a single boundary.
// eslint-disable-next-line complexity
export const ModelInspectorPopup: React.FC<IProps> = ({language, activeImage, activeModelTask}) => {
    const zh = language === Language.CHINESE;
    const t = useCallback((zhText: string, enText: string) => zh ? zhText : enText, [zh]);
    const slot: InspectorSlot = activeModelTask === 'segment' ? 'segmentation' : 'detection';
    const [status, setStatus] = useState<InspectorStatus | null>(null);
    const [statusLoading, setStatusLoading] = useState(true);
    const [detail, setDetail] = useState<CatalogDetail>('stages');
    const [catalog, setCatalog] = useState<InspectorLayer[]>([]);
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');
    const [session, setSession] = useState<InspectionSession | null>(null);
    const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
    const [compareLayerId, setCompareLayerId] = useState<string | null>(null);
    const [compareEnabled, setCompareEnabled] = useState(false);
    const [mapKind, setMapKind] = useState<HeatmapKind>('mean_abs');
    const [palette, setPalette] = useState<HeatmapPalette>('turbo');
    const [opacity, setOpacity] = useState(68);
    const [activeChannel, setActiveChannel] = useState<number | null>(null);
    const [targetClassId, setTargetClassId] = useState(0);
    const [revision, setRevision] = useState(0);
    const [busy, setBusy] = useState(false);
    const [attributionBusy, setAttributionBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const requestRef = useRef<AbortController | null>(null);
    const sessionIdRef = useRef<string | null>(null);
    const automaticCaptureKeyRef = useRef<string | null>(null);

    const discardSession = useCallback((updateState: boolean = true) => {
        const sessionId = sessionIdRef.current;
        sessionIdRef.current = null;
        if (sessionId) void ModelInspectorAPI.deleteSession(sessionId);
        if (updateState) {
            setSession(null);
            setActiveLayerId(null);
            setCompareLayerId(null);
            setCompareEnabled(false);
        }
    }, []);

    const previousSlotRef = useRef<InspectorSlot>(slot);
    useEffect(() => {
        if (previousSlotRef.current === slot) return;
        previousSlotRef.current = slot;
        discardSession();
    }, [discardSession, slot]);

    useEffect(() => {
        const controller = new AbortController();
        setStatusLoading(true);
        ModelInspectorAPI.status(controller.signal).then(value => {
            setStatus(value);
            setStatusLoading(false);
        }).catch((cause: unknown) => {
            if (isAbortError(cause)) return;
            setError(t(
                '模型透视插件未连接。请确认后端已启用 OPENSIGHT_PLUGIN_MODEL_INSPECTOR_ENABLED。',
                'Model Inspector is unavailable. Enable OPENSIGHT_PLUGIN_MODEL_INSPECTOR_ENABLED on the backend.',
            ));
            setStatusLoading(false);
        });
        return () => controller.abort();
    }, [t]);

    useEffect(() => {
        let ownedUrl: string | null = null;
        if (activeImage?.fileData && activeImage.fileData.size > 0) {
            ownedUrl = URL.createObjectURL(activeImage.fileData);
            setPreviewUrl(ownedUrl);
        } else if (activeImage) {
            setPreviewUrl(decodedImageForFrame(activeImage)?.src || null);
        } else {
            setPreviewUrl(null);
        }
        discardSession();
        return () => {
            if (ownedUrl) URL.revokeObjectURL(ownedUrl);
        };
    }, [activeImage?.id, discardSession]);

    useEffect(() => () => {
        requestRef.current?.abort();
        discardSession(false);
    }, [discardSession]);

    const capability = useMemo(
        () => status?.slots.find(item => item.slot === slot) || null,
        [slot, status],
    );

    useEffect(() => {
        if (!capability || capability.state !== 'ready') {
            setCatalog([]);
            setSelectedIds(new Set());
            return undefined;
        }
        const controller = new AbortController();
        setCatalogLoading(true);
        setError(null);
        ModelInspectorAPI.layers(slot, detail, controller.signal).then(value => {
            setCatalog(value.layers);
            setSelectedIds(new Set(value.default_layer_ids));
            setCatalogLoading(false);
        }).catch((cause: unknown) => {
            if (isAbortError(cause)) return;
            setError(errorMessage(cause, t('无法读取模型层', 'Unable to read model layers')));
            setCatalogLoading(false);
        });
        return () => controller.abort();
    }, [capability?.model, capability?.state, detail, slot, t]);

    const visibleCatalog = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return catalog;
        return catalog.filter(item =>
            item.path.toLowerCase().includes(query)
            || item.type.toLowerCase().includes(query)
            || item.group.toLowerCase().includes(query),
        );
    }, [catalog, search]);

    const groupedCatalog = useMemo(() => {
        const groups: Array<{name: string; layers: InspectorLayer[]}> = [];
        visibleCatalog.forEach(layer => {
            let group = groups.find(item => item.name === layer.group);
            if (!group) {
                group = {name: layer.group, layers: []};
                groups.push(group);
            }
            group.layers.push(layer);
        });
        return groups;
    }, [visibleCatalog]);

    const maxLayers = status?.limits.max_layers || 32;
    const maxTotalLayers = status?.limits.max_total_layers || 512;
    const batchCount = selectedIds.size === 0 ? 0 : Math.ceil(selectedIds.size / maxLayers);
    const selectVisibleLayers = useCallback(() => {
        const limitedLayers = visibleCatalog.slice(0, maxTotalLayers);
        setSelectedIds(new Set(limitedLayers.map(layer => layer.id)));
        if (visibleCatalog.length > maxTotalLayers) {
            setError(t(
                `当前筛选共有 ${visibleCatalog.length} 层；单次批量任务最多处理 ${maxTotalLayers} 层，已选择前 ${maxTotalLayers} 层。`,
                `${visibleCatalog.length} layers match; one batch task supports ${maxTotalLayers}. The first ${maxTotalLayers} are selected.`,
            ));
        } else {
            setError(null);
        }
    }, [maxTotalLayers, t, visibleCatalog]);

    const clearSelectedLayers = useCallback(() => {
        setSelectedIds(new Set());
        setError(null);
    }, []);

    useEffect(() => {
        const handleSelectAllShortcut = (event: KeyboardEvent) => {
            const target = event.target;
            const isTextEntry = target instanceof HTMLTextAreaElement
                || target instanceof HTMLInputElement && !['button', 'checkbox', 'radio'].includes(target.type)
                || target instanceof HTMLElement && target.isContentEditable;
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
                if (isTextEntry) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                selectVisibleLayers();
            }
        };
        window.addEventListener('keydown', handleSelectAllShortcut, true);
        return () => window.removeEventListener('keydown', handleSelectAllShortcut, true);
    }, [selectVisibleLayers]);

    useEffect(() => {
        const handleEscape = (event: Event) => {
            if (selectedIds.size === 0) return;
            event.preventDefault();
            clearSelectedLayers();
        };
        window.addEventListener(MODEL_INSPECTOR_ESCAPE_EVENT, handleEscape);
        return () => window.removeEventListener(MODEL_INSPECTOR_ESCAPE_EVENT, handleEscape);
    }, [clearSelectedLayers, selectedIds.size]);

    const toggleLayer = (identifier: string) => {
        setSelectedIds(previous => {
            const next = new Set(previous);
            if (next.has(identifier)) next.delete(identifier);
            else if (next.size < maxTotalLayers) next.add(identifier);
            else setError(t(`一次批量任务最多处理 ${maxTotalLayers} 层`, `A batch task is limited to ${maxTotalLayers} layers`));
            return next;
        });
    };

    const createSession = useCallback(async () => {
        if (!activeImage || capability?.state !== 'ready' || selectedIds.size === 0) return;
        setBusy(true);
        setError(null);
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        discardSession();
        try {
            const file = await canvasFileFromRepository(activeImage);
            const value = await ModelInspectorAPI.createSession(
                file,
                slot,
                Array.from(selectedIds),
                sessionCaptureOptions(selectedIds.size, status?.limits),
                controller.signal,
            );
            sessionIdRef.current = value.id;
            setSession(value);
            const readyLayers = value.layers.filter(layer => layer.status === 'ready');
            setActiveLayerId(readyLayers[0]?.id || value.layers[0]?.id || null);
            setCompareLayerId(readyLayers[1]?.id || null);
            setMapKind('mean_abs');
            setActiveChannel(readyLayers[0]?.channels[0]?.index ?? null);
            const predictionClass = value.predictions[0]?.class_id;
            if (predictionClass !== undefined) setTargetClassId(predictionClass);
        } catch (cause: unknown) {
            if (!isAbortError(cause)) {
                setError(errorMessage(cause, t('生成热图失败', 'Heatmap capture failed')));
            }
        } finally {
            if (requestRef.current === controller) {
                requestRef.current = null;
                setBusy(false);
            }
        }
    }, [activeImage, capability?.state, discardSession, selectedIds, slot, status?.limits, t]);

    useEffect(() => {
        if (
            detail !== 'stages'
            || catalogLoading
            || catalog.length === 0
            || !activeImage
            || capability?.state !== 'ready'
        ) return;
        const automaticCaptureKey = `${activeImage.id}:${slot}:${capability.model}`;
        if (automaticCaptureKeyRef.current === automaticCaptureKey) return;
        automaticCaptureKeyRef.current = automaticCaptureKey;
        if (selectedIds.size > 0) void createSession();
    }, [
        activeImage,
        capability?.model,
        capability?.state,
        catalog.length,
        catalogLoading,
        createSession,
        detail,
        selectedIds.size,
        slot,
    ]);

    const activeLayer = useMemo(
        () => session?.layers.find(layer => layer.id === activeLayerId) || null,
        [activeLayerId, session],
    );
    const compareLayer = useMemo(
        () => session?.layers.find(layer => layer.id === compareLayerId) || null,
        [compareLayerId, session],
    );
    const readyLayers = useMemo(
        () => session?.layers.filter(layer => layer.status === 'ready') || [],
        [session],
    );

    useEffect(() => {
        setMapKind('mean_abs');
        setActiveChannel(activeLayer?.channels[0]?.index ?? null);
    }, [activeLayerId]);

    const ribbonRef = useRef<HTMLDivElement>(null);
    const activeLayerIndex = readyLayers.findIndex(layer => layer.id === activeLayerId);

    useEffect(() => {
        if (activeLayerIndex < 0) return;
        const activeButton = ribbonRef.current?.children.item(activeLayerIndex) as HTMLElement | null;
        activeButton?.scrollIntoView?.({behavior: 'smooth', block: 'nearest', inline: 'center'});
    }, [activeLayerIndex]);

    const navigateActiveLayer = (direction: 1 | -1): void => {
        const nextLayer = readyLayers[activeLayerIndex + direction];
        if (nextLayer) setActiveLayerId(nextLayer.id);
    };

    const handleRibbonWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
        const el = ribbonRef.current;
        if (!el || event.ctrlKey || event.metaKey || event.altKey) return;
        const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        if (delta === 0 || el.scrollWidth <= el.clientWidth) return;
        event.preventDefault();
        el.scrollLeft += delta;
    }, []);

    const uniquePredictions = useMemo(() => {
        const seen = new Set<number>();
        return (session?.predictions || []).filter(item => {
            if (seen.has(item.class_id)) return false;
            seen.add(item.class_id);
            return true;
        });
    }, [session]);

    const mapUrlFor = useCallback((layer: InspectionLayerResult, comparison: boolean = false): string => {
        if (!session) return '';
        let kind = mapKind;
        let channel: number | undefined;
        let classId: number | undefined;
        if (kind === 'channel') {
            if (activeChannel !== null && layer.channels.some(item => item.index === activeChannel)) {
                channel = activeChannel;
            } else {
                kind = 'mean_abs';
            }
        }
        if (kind === 'gradcam') {
            if (comparison || layer.id !== activeLayerId || !layer.maps.includes('gradcam')) {
                kind = 'mean_abs';
            } else {
                classId = targetClassId;
            }
        }
        return ModelInspectorAPI.mapUrl(session.id, layer.id, {
            kind,
            palette,
            channel,
            classId,
            revision,
        });
    }, [activeChannel, activeLayerId, mapKind, palette, revision, session, targetClassId]);

    const runAttribution = async () => {
        if (!session || !activeLayer) return;
        setAttributionBusy(true);
        setError(null);
        try {
            await ModelInspectorAPI.createAttribution(session.id, activeLayer.id, targetClassId);
            setSession(previous => previous ? {
                ...previous,
                layers: previous.layers.map(layer => layer.id === activeLayer.id
                    ? {...layer, maps: Array.from(new Set([...layer.maps, 'gradcam']))}
                    : layer),
            } : previous);
            setRevision(value => value + 1);
            setMapKind('gradcam');
        } catch (cause: unknown) {
            setError(errorMessage(cause, t('目标归因失败', 'Target attribution failed')));
        } finally {
            setAttributionBusy(false);
        }
    };

    const exportMap = async (composite: boolean) => {
        if (!session || !activeLayer || !previewUrl) return;
        setError(null);
        try {
            const mapUrl = mapUrlFor(activeLayer);
            const response = await fetch(mapUrl);
            if (!response.ok) throw new Error(`${response.status}`);
            const heatmapBlob = await response.blob();
            const mapName = `${session.model}-${activeLayer.path.replace(/[^a-zA-Z0-9_.-]+/g, '_')}`;
            if (!composite) {
                saveAs(heatmapBlob, `${mapName}-${mapKind}.png`);
                return;
            }
            const heatmapObjectUrl = URL.createObjectURL(heatmapBlob);
            try {
                const [original, heatmap] = await Promise.all([
                    loadImage(previewUrl),
                    loadImage(heatmapObjectUrl),
                ]);
                const originalWidth = session.original_size[0];
                const originalHeight = session.original_size[1];
                const scale = Math.min(1, 4096 / Math.max(originalWidth, originalHeight));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(originalWidth * scale));
                canvas.height = Math.max(1, Math.round(originalHeight * scale));
                const context = canvas.getContext('2d');
                if (!context) throw new Error('Canvas unavailable');
                context.drawImage(original, 0, 0, canvas.width, canvas.height);
                context.globalAlpha = opacity / 100;
                context.drawImage(heatmap, 0, 0, canvas.width, canvas.height);
                const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
                if (!blob) throw new Error('PNG export failed');
                saveAs(blob, `${mapName}-${mapKind}-overlay.png`);
            } finally {
                URL.revokeObjectURL(heatmapObjectUrl);
            }
        } catch (cause: unknown) {
            setError(errorMessage(cause, t('导出失败', 'Export failed')));
        }
    };

    const renderViewport = (layer: InspectionLayerResult, label: string, comparison: boolean = false) => {
        const width = session?.original_size[0] || 1;
        const height = session?.original_size[1] || 1;
        return <div className='mi-viewport-column' data-testid={comparison ? 'inspector-compare-b' : 'inspector-view-a'}>
            <div className='mi-viewport-label'><span>{label}</span><strong>{layer.path}</strong></div>
            <div className='mi-media-frame' style={{aspectRatio: `${width} / ${height}`}}>
                {previewUrl && <img className='mi-original-image' src={previewUrl} alt={session?.filename || 'source'} />}
                <img
                    className='mi-heatmap-image'
                    src={mapUrlFor(layer, comparison)}
                    alt={`${layer.path} heatmap`}
                    style={{opacity: opacity / 100}}
                />
                {!comparison && session?.predictions.map(prediction => prediction.bbox && (
                    <div
                        className='mi-prediction-box'
                        key={prediction.index}
                        style={{
                            left: `${prediction.bbox[0] / width * 100}%`,
                            top: `${prediction.bbox[1] / height * 100}%`,
                            width: `${(prediction.bbox[2] - prediction.bbox[0]) / width * 100}%`,
                            height: `${(prediction.bbox[3] - prediction.bbox[1]) / height * 100}%`,
                        }}
                        title={`${prediction.name} ${(prediction.confidence * 100).toFixed(1)}%`}
                    />
                ))}
            </div>
        </div>;
    };

    const slotName = (value: InspectorSlot) => value === 'detection'
        ? t('检测模型', 'Detection model')
        : t('分割模型', 'Segmentation model');

    return <div className='model-inspector-backdrop'>
        <section className='model-inspector-shell' aria-label={t('模型透视', 'Model Inspector')}>
            <header className='mi-header'>
                <div className='mi-brand'>
                    <span className='mi-brand-mark' aria-hidden='true'><i/><i/><i/></span>
                    <div>
                        <h2>{t('模型透视', 'Model Inspector')} <em>LAB</em></h2>
                        <p>{t('沿 opensight 当前推理链观察特征如何形成', 'Follow feature formation along the active opensight inference path')}</p>
                    </div>
                </div>
                <div className='mi-header-meta'>
                    <span>{activeImage?.fileData?.name || t('当前帧', 'Current frame')}</span>
                    {session && <><b>{session.model}</b><small>{session.elapsed_ms.toFixed(0)} ms · {bytesLabel(status?.cache_bytes || 0)}</small></>}
                </div>
                <button className='mi-close' onClick={() => PopupActions.close()} aria-label={t('关闭', 'Close')}>×</button>
            </header>

            {statusLoading ? <div className='mi-state-page'><div className='mi-spinner'/><h3>{t('正在连接模型透视插件', 'Connecting to Model Inspector')}</h3></div>
                : !status ? <div className='mi-state-page mi-state-error'>
                    <span className='mi-state-icon'>!</span>
                    <h3>{t('插件当前不可用', 'Plugin unavailable')}</h3>
                    <p>{error}</p>
                    <code>OPENSIGHT_PLUGIN_MODEL_INSPECTOR_ENABLED=true</code>
                </div>
                    : <div className='mi-workbench'>
                        <aside className='mi-left-panel'>
                            <div className='mi-panel-heading'>
                                <span>{t('当前推理模型', 'Current inference model')}</span>
                                <small>v{status.version}</small>
                            </div>
                            <div className='mi-slot-list'>
                                <div className={`mi-slot-card active state-${capability?.state || 'unavailable'}`}>
                                    <span className='mi-slot-dot'/>
                                    <span><strong>{slotName(slot)}</strong><small>{capability?.model || t('暂无模型', 'No model')}</small></span>
                                    <em>{capability ? stateLabel(capability.state, zh) : t('不可用', 'Unavailable')}</em>
                                </div>
                            </div>
                            {capability && capability.state !== 'ready' && <div className='mi-capability-note'>
                                <strong>{stateLabel(capability.state, zh)}</strong>
                                <p>{capability.reason || t('请先在顶部模型菜单加载对应模型', 'Load a model for this slot from the top model menu')}</p>
                                {capability.runtime !== 'unknown' && <code>{capability.runtime}</code>}
                            </div>}

                            <div className='mi-layer-toolbar'>
                                <div className='mi-segmented'>
                                    <button className={detail === 'stages' ? 'active' : ''} onClick={() => setDetail('stages')}>{t('语义阶段', 'Stages')}</button>
                                    <button className={detail === 'all' ? 'active' : ''} onClick={() => setDetail('all')}>{t('全部算子', 'Operators')}</button>
                                </div>
                                <input value={search} onChange={event => setSearch(event.target.value)} placeholder={t('搜索层路径 / 类型', 'Search path / type')} />
                                <div className='mi-layer-selection'>
                                    <span>{selectedIds.size} {t('层待捕获', 'selected')}{batchCount > 1 && t(` · 自动分 ${batchCount} 批`, ` · ${batchCount} automatic batches`)}</span>
                                    <div>
                                        <button type='button' onClick={selectVisibleLayers} title={t('选择当前筛选结果（Ctrl/⌘+A）', 'Select filtered layers (Ctrl/⌘+A)')}>{t('全选', 'Select')} <kbd>Ctrl/⌘ A</kbd></button>
                                        <button type='button' onClick={clearSelectedLayers} disabled={selectedIds.size === 0} title={t('清空选择（Esc）', 'Clear selection (Esc)')}>{t('清空', 'Clear')} <kbd>Esc</kbd></button>
                                    </div>
                                </div>
                            </div>
                            <div className='mi-layer-list'>
                                {catalogLoading && <div className='mi-list-loading'>{t('读取结构…', 'Reading graph…')}</div>}
                                {groupedCatalog.map(group => <div className='mi-layer-group' key={group.name}>
                                    <h4>{group.name}<small>{group.layers.length}</small></h4>
                                    {group.layers.map(layer => {
                                        const result = session?.layers.find(item => item.id === layer.id);
                                        return <label className={`mi-layer-row ${activeLayerId === layer.id ? 'active' : ''}`} key={layer.id}>
                                            <input type='checkbox' checked={selectedIds.has(layer.id)} onChange={() => toggleLayer(layer.id)} />
                                            <button onClick={() => result && setActiveLayerId(layer.id)} disabled={!result}>
                                                <span>{layer.path}</span>
                                                <small>{layer.type} · {parametersLabel(layer.parameters)}</small>
                                            </button>
                                            {result && <i className={`status-${result.status}`} title={result.reason || result.status}/>}
                                        </label>;
                                    })}
                                </div>)}
                            </div>
                            <button
                                className='mi-capture-button'
                                data-testid='inspector-capture'
                                disabled={busy || !activeImage || capability?.state !== 'ready' || selectedIds.size === 0}
                                onClick={createSession}
                            >
                                {busy ? <><span className='mi-button-spinner'/>{batchCount > 1
                                    ? t(`正在自动分 ${batchCount} 批处理…`, `Processing ${batchCount} batches…`)
                                    : t('正在沿模型前向传播…', 'Tracing model forward…')}</>
                                    : session
                                        ? t(`重新生成 ${selectedIds.size} 层透视${batchCount > 1 ? ` · ${batchCount} 批` : ''}`, `Refresh ${selectedIds.size} layers${batchCount > 1 ? ` · ${batchCount} batches` : ''}`)
                                        : t(`生成 ${selectedIds.size} 层透视${batchCount > 1 ? ` · ${batchCount} 批` : ''}`, `Inspect ${selectedIds.size} layers${batchCount > 1 ? ` · ${batchCount} batches` : ''}`)}
                            </button>
                        </aside>

                        <main className='mi-center-panel'>
                            <div className='mi-canvas-toolbar'>
                                <div className='mi-map-tabs'>
                                    {MAP_KINDS.map(item => <button key={item.value} disabled={!activeLayer} className={mapKind === item.value ? 'active' : ''} onClick={() => setMapKind(item.value)}>{zh ? item.zh : item.en}</button>)}
                                </div>
                                <label>{t('色带', 'Palette')}<select value={palette} onChange={event => setPalette(event.target.value as HeatmapPalette)}>{PALETTES.map(item => <option key={item}>{item}</option>)}</select></label>
                                <label className='mi-opacity'>{t('叠加强度', 'Overlay')}<input type='range' min='0' max='100' value={opacity} onChange={event => setOpacity(Number(event.target.value))}/><span>{opacity}%</span></label>
                                <button className={compareEnabled ? 'active' : ''} disabled={readyLayers.length < 2} onClick={() => setCompareEnabled(value => !value)}>A/B</button>
                            </div>
                            {!session || !activeLayer ? <div
                                className='mi-empty-canvas'
                            >
                                <div className='mi-empty-orbit'><span/><span/><span/></div>
                                <h3>{busy
                                    ? t('正在生成语义阶段透视', 'Generating semantic stage views')
                                    : activeImage
                                        ? t('当前图片尚未生成阶段透视', 'This image has not been inspected yet')
                                        : t('请先在 opensight 中打开一张图片', 'Open an image in opensight first')}</h3>
                                <p>{t('点击左侧按钮生成当前图片的透视。', 'Use the button on the left to inspect the current image.')}</p>
                            </div> : <>
                                <div className='mi-canvas-stage'>
                                    <div
                                        className={`mi-viewports ${compareEnabled && compareLayer ? 'compare' : ''}`}
                                    >
                                        {renderViewport(activeLayer, 'A')}
                                        {compareEnabled && compareLayer && renderViewport(compareLayer, 'B', true)}
                                    </div>
                                    <button
                                        type='button'
                                        className='mi-canvas-nav prev'
                                        disabled={activeLayerIndex <= 0}
                                        onClick={() => navigateActiveLayer(-1)}
                                        aria-label={t('上一层透视', 'Previous layer view')}
                                    >‹</button>
                                    <button
                                        type='button'
                                        className='mi-canvas-nav next'
                                        disabled={activeLayerIndex < 0 || activeLayerIndex >= readyLayers.length - 1}
                                        onClick={() => navigateActiveLayer(1)}
                                        aria-label={t('下一层透视', 'Next layer view')}
                                    >›</button>
                                </div>
                                <div className='mi-stage-ribbon-wrap'>
                                    <div
                                        className='mi-stage-ribbon'
                                        ref={ribbonRef}
                                        onWheel={handleRibbonWheel}
                                        data-testid='inspector-stage-ribbon'
                                    >
                                        {readyLayers.map((layer, index) => <button
                                            key={layer.id}
                                            className={activeLayerId === layer.id ? 'active' : ''}
                                            onClick={() => setActiveLayerId(layer.id)}
                                        >
                                            <img loading='lazy' src={ModelInspectorAPI.mapUrl(session.id, layer.id, {kind: 'mean_abs', palette})} alt='' />
                                            <span>{String(index + 1).padStart(2, '0')}</span>
                                            <small>{layer.path.split('.').slice(-2).join('.')}</small>
                                        </button>)}
                                    </div>
                                </div>
                            </>}
                        </main>

                        <aside className='mi-right-panel'>
                            <div className='mi-panel-heading'><span>{t('单层分析', 'Layer analysis')}</span>{session && <small>{session.family}</small>}</div>
                            {!activeLayer ? <div className='mi-right-empty'>{t('生成后在阶段带中选择一层', 'Capture and choose a layer from the stage ribbon')}</div> : <>
                                <div className='mi-layer-summary'>
                                    <span>{activeLayer.group}</span>
                                    <h3>{activeLayer.path}</h3>
                                    <p>{activeLayer.type}</p>
                                    <dl>
                                        <div><dt>{t('输出', 'Output')}</dt><dd>{activeLayer.output_shape.join(' × ')}</dd></div>
                                        <div><dt>{t('布局', 'Layout')}</dt><dd>{activeLayer.layout || '—'}</dd></div>
                                        <div><dt>{t('缓存图', 'Maps')}</dt><dd>{activeLayer.maps.length}</dd></div>
                                    </dl>
                                </div>

                                <section className='mi-analysis-section'>
                                    <h4>{t('高响应通道', 'Top response channels')}<small>Top-{activeLayer.channels.length}</small></h4>
                                    <div className='mi-channel-grid'>
                                        {activeLayer.channels.map(channel => <button
                                            key={channel.index}
                                            className={mapKind === 'channel' && activeChannel === channel.index ? 'active' : ''}
                                            onClick={() => {setActiveChannel(channel.index); setMapKind('channel');}}
                                        >
                                            <img src={session ? ModelInspectorAPI.mapUrl(session.id, activeLayer.id, {kind: 'channel', palette, channel: channel.index}) : ''} alt='' />
                                            <span>ch {channel.index}</span><small>{(channel.score * 100).toFixed(1)}%</small>
                                        </button>)}
                                    </div>
                                </section>

                                {compareEnabled && <section className='mi-analysis-section'>
                                    <h4>{t('B 层', 'Layer B')}</h4>
                                    <select value={compareLayerId || ''} onChange={event => setCompareLayerId(event.target.value)}>
                                        {readyLayers.filter(layer => layer.id !== activeLayerId).map(layer => <option value={layer.id} key={layer.id}>{layer.path}</option>)}
                                    </select>
                                </section>}

                                <section className='mi-analysis-section'>
                                    <h4>{t('目标归因', 'Target attribution')}<small>Grad-CAM</small></h4>
                                    {capability?.supports_attribution ? <>
                                        {uniquePredictions.length > 0 ? <select value={targetClassId} onChange={event => setTargetClassId(Number(event.target.value))}>
                                            {uniquePredictions.map(item => <option key={item.class_id} value={item.class_id}>{item.name} · {(item.confidence * 100).toFixed(1)}%</option>)}
                                        </select> : <label className='mi-class-input'>{t('类别 ID', 'Class ID')}<input type='number' min='0' value={targetClassId} onChange={event => setTargetClassId(Math.max(0, Number(event.target.value)))}/></label>}
                                        <button className='mi-secondary-button' disabled={attributionBusy} onClick={runAttribution}>{attributionBusy ? t('正在反向归因…', 'Attributing…') : t('生成类别响应图', 'Generate class response')}</button>
                                    </> : <p className='mi-muted'>{t('SAM 当前提供激活特征；目标归因将在掩码提示目标契约稳定后开放。', 'SAM exposes activations; target attribution waits for a stable mask-prompt target contract.')}</p>}
                                </section>

                                <section className='mi-analysis-section mi-export-section'>
                                    <h4>{t('导出', 'Export')}</h4>
                                    <div><button onClick={() => exportMap(false)}>{t('仅热图 PNG', 'Heatmap PNG')}</button><button onClick={() => exportMap(true)}>{t('原图叠加 PNG', 'Overlay PNG')}</button></div>
                                </section>
                            </>}
                            {session?.warnings.map(item => <div className='mi-warning' key={item}>{item}</div>)}
                            {error && <div className='mi-error-banner' role='alert'><span>!</span><p>{error}</p><button onClick={() => setError(null)}>×</button></div>}
                        </aside>
                    </div>}
        </section>
    </div>;
};

const mapStateToProps = (state: AppState): IProps => {
    const index = state.labels.activeImageIndex;
    return {
        language: state.general.language,
        activeImage: index === null ? null : state.labels.imagesData[index] || null,
        activeModelTask: state.aimodels.selectedModelTask,
    };
};

export default connect(mapStateToProps)(ModelInspectorPopup);
