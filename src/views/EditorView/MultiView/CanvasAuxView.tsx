import React, {useEffect, useMemo, useState} from 'react';
import {CanvasMultiViewStore, CanvasMultiViewState, CanvasViewKind} from './CanvasMultiViewStore';
import {ModelInspectorAPI} from '../../PopupView/ModelInspectorPopup/ModelInspectorAPI';
import {resolveVisualSearchSource, ResolvedVisualSearchSource} from '../../PopupView/VisualSearchPopup/VisualSearchPopup';
import {LabelsSelector} from '../../../store/selectors/LabelsSelector';
import {VideoSelector} from '../../../store/selectors/VideoSelector';
import {ImageData} from '../../../store/labels/types';
import './CanvasMultiView.scss';

interface Props { imageData: ImageData; state: CanvasMultiViewState; }
interface InspectorResult { source: ResolvedVisualSearchSource; sessionId?: string; layerId?: string; channel?: number; classId?: number; attentionReady?: boolean; }

const names: Record<CanvasViewKind, string> = {original: '原图', heatmap: '热力图', features: '特征图', attention: '注意力图'};

export const CanvasAuxViews = ({imageData, state}: Props) => {
    const [result, setResult] = useState<InspectorResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const needsInspector = state.views.slice(1).some(view => view !== 'original');
    const key = `${imageData.id}:${LabelsSelector.getActiveImageIndex()}:${state.layout}`;

    useEffect(() => {
        if (state.layout === '1x1') return undefined;
        const controller = new AbortController();
        let owned: InspectorResult | null = null;
        setLoading(true); setError(''); setResult(null);
        (async () => {
            const source = await resolveVisualSearchSource({
                activeImage: imageData,
                activeImageIndex: LabelsSelector.getActiveImageIndex(),
                isVideoMode: VideoSelector.isVideoMode(),
                activeVideo: VideoSelector.getActiveVideo(),
            });
            owned = {source};
            if (needsInspector) {
                const catalog = await ModelInspectorAPI.layers('detection', 'stages', controller.signal);
                const layerId = catalog.default_layer_ids[0] || catalog.layers[0]?.id;
                if (!layerId) throw new Error('当前模型没有可视化层');
                const file = new File([source.blob], imageData.fileData?.name || 'frame.jpg', {type: source.blob.type || 'image/jpeg'});
                const session = await ModelInspectorAPI.createSession(file, 'detection', [layerId], {imgsz: 640, topK: 5, maxSide: 1024}, controller.signal);
                const layer = session.layers[0];
                owned = {...owned, sessionId: session.id, layerId, channel: layer?.channels?.[0]?.index};
                if (state.views.includes('attention') && session.predictions[0]) {
                    try {
                        await ModelInspectorAPI.createAttribution(session.id, layerId, session.predictions[0].class_id, controller.signal);
                        owned.attentionReady = true;
                        owned.classId = session.predictions[0].class_id;
                    } catch (_) { owned.attentionReady = false; }
                }
            }
            if (!controller.signal.aborted) setResult(owned);
        })().catch(cause => {
            if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法生成模型视图');
        }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => {
            controller.abort();
            if (owned?.sessionId) ModelInspectorAPI.deleteSession(owned.sessionId);
            owned?.source.release();
        };
    }, [key, needsInspector]);

    const mapUrl = (kind: CanvasViewKind): string | null => {
        if (!result?.sessionId || !result.layerId) return null;
        if (kind === 'heatmap') return ModelInspectorAPI.mapUrl(result.sessionId, result.layerId, {kind: 'mean_abs', palette: 'turbo'});
        if (kind === 'features') return ModelInspectorAPI.mapUrl(result.sessionId, result.layerId, {kind: 'channel', palette: 'magma', channel: result.channel || 0});
        if (kind === 'attention' && result.attentionReady) return ModelInspectorAPI.mapUrl(result.sessionId, result.layerId, {kind: 'gradcam', palette: 'jet', classId: result.classId});
        return null;
    };

    return <>{state.views.slice(1).map((view, offset) => {
        const index = offset + 1;
        const visual = view === 'original' ? result?.source.previewUrl : mapUrl(view);
        return <div className='CanvasViewPane auxiliary' key={index}>
            <div className='CanvasViewHeader'>
                <select value={view} onChange={event => CanvasMultiViewStore.setView(index, event.target.value as CanvasViewKind)}>
                    {Object.keys(names).map(kind => <option key={kind} value={kind}>{names[kind as CanvasViewKind]}</option>)}
                </select>
                <span>只读</span>
            </div>
            <div className='CanvasViewBody'>
                {result?.source.previewUrl && view !== 'original' && <img className='base' src={result.source.previewUrl} alt=''/>}
                {visual && <img className={view === 'original' ? 'visual original' : 'visual overlay'} src={visual} alt={names[view]}/>} 
                {loading && <div className='CanvasViewMessage'>正在生成 {names[view]}…</div>}
                {!loading && !visual && <div className='CanvasViewMessage'>{error || (view === 'attention' ? '当前模型暂不支持注意力归因' : '请先加载检测模型并执行推理')}</div>}
            </div>
        </div>;
    })}</>;
};
