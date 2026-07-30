import { ContextType } from '../../../data/enums/ContextType';
import './EditorTopNavigationBar.scss';
import React, { useEffect, useMemo, useCallback, useState, useRef } from 'react';
import classNames from 'classnames';
import { AppState } from '../../../store';
import { store } from '../../../index';
import { connect } from 'react-redux';
import { updateSmartAnnotationActiveStatus, updateImageDragModeStatus, updateActivePopupType, updateCustomCursorStyle, updateEraserMode, updateEraserFineMode, updateTrackingModeStatus, updateSamNegativeMode } from '../../../store/general/actionCreators';
import { PopupWindowType } from '../../../data/enums/PopupWindowType';
import { CustomCursorStyle } from '../../../data/enums/CustomCursorStyle';
import { GeneralSelector } from '../../../store/selectors/GeneralSelector';
import { ViewPointSettings } from '../../../settings/ViewPointSettings';
import { ImageButton } from '../../Common/ImageButton/ImageButton';
import { ViewPortActions } from '../../../logic/actions/ViewPortActions';
import { LabelsSelector } from '../../../store/selectors/LabelsSelector';
import { ImageData } from '../../../store/labels/types';
import { LabelType } from '../../../data/enums/LabelType';
import { AISelector } from '../../../store/selectors/AISelector';
import { updateActiveLabelType, updateActiveLabelViewType } from '../../../store/labels/actionCreators';
import { ISize } from '../../../interfaces/ISize';
import { AIActions } from '../../../logic/actions/AIActions';
import { Fade, styled, Switch, Tooltip, tooltipClasses, TooltipProps } from '@mui/material';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {EditorModel} from '../../../staticModels/EditorModel';
import { ImageUtil } from '../../../utils/ImageUtil';
import { updateFullImageInferenceStatus, toggleImageAILabelsVisibility, toggleImageSegmentationLabelsVisibility, addInferenceHistory } from '../../../store/ai/actionCreators';
import { AIDetectionActions } from '../../../logic/actions/AIDetectionActions';
import { AISegmentationActions } from '../../../logic/actions/AISegmentationActions';
import { DetectionAPIDetector } from '../../../ai/DetectionAPIDetector';
import { SegmentationAPIDetector } from '../../../ai/SegmentationAPIDetector';
import { getEngineBaseUrl, getExtensionEngineBaseUrl } from '../../../utils/DefaultBackendUrl';
import { ActiveModel } from '../../../ai/ActiveModel';
import { queueSimilaritySearchPreset, SimilaritySearchMode } from '../../../ai/SimilaritySearchPresetStore';
import { ScriptStore } from '../../../ai/ScriptStore';
import { PipelineStore } from '../../../ai/PipelineStore';
import { SmartAnnotationActions } from '../../../logic/actions/SmartAnnotationActions';
import { AIStateStorageManager } from '../../../utils/AIStateStorageManager';
import { AIModelsSelector } from '../../../store/selectors/AIModelsSelector';
import { YOLO_MODEL_FAMILIES, SEG_MODEL_FAMILIES } from '../../PopupView/CallModelPopup/CallModelPopup';
import { EditorActions } from '../../../logic/actions/EditorActions';
import { ObjectTrackingActions } from '../../../logic/actions/ObjectTrackingActions';
import { submitNewNotification, deleteNotificationById } from '../../../store/notifications/actionCreators';
import { getTimelineRange, FrameRange } from '../VideoTimeline/VideoTimeline';
import { NotificationUtil } from '../../../utils/NotificationUtil';
import { inferModelTaskFromName } from '../../../utils/ModelTaskUtil';
import {ModelInspectorTrigger} from './ModelInspectorTrigger';
const BUTTON_SIZE: ISize = { width: 30, height: 30 };
const BUTTON_PADDING: number = 10;

interface SimilarityVectorCollection {
    name: string;
    scene_id: string;
    scene_name: string;
    target_id: string;
    target_name: string;
    version: number;
    data_version?: number;
    granularity: 'image' | 'bbox';
    count: number;
    compatible: boolean;
    compatibility_reason?: string | null;
}

interface SimilarityIngestJob {
    collection: string;
    state: string;
    dataset_id: string;
    data_version?: number;
    finished_at?: string | null;
    updated_at?: string | null;
}

interface SimilaritySearchConfig {
    mode: SimilaritySearchMode;
    sceneId: string;
    sceneName: string;
    targetId: string;
    targetName: string;
    collectionName: string;
    collectionVersion: number;
    dataVersion: number;
    datasetId?: string;
}

const StyledTooltip = styled(({ className, ...props }: TooltipProps) => (
    <Tooltip {...props} classes={{ popper: className }} />
  ))(({ theme }) => ({
    [`& .${tooltipClasses.tooltip}`]: {
        backgroundColor: '#171717',
        color: '#ffffff',
        boxShadow: theme.shadows[1],
        fontSize: 12,
        maxWidth: 200,
        textAlign: 'center'
    },
  }));

const IOSSwitch = styled(Switch)(() => ({
    width: 36,
    height: 20,
    padding: 0,
    '& .MuiSwitch-switchBase': {
        padding: 2,
        color: '#bbb',
        '&.Mui-checked': {
            transform: 'translateX(16px)',
            color: '#fff',
            '& + .MuiSwitch-track': {
                backgroundColor: '#2196f3',
                opacity: 1,
            },
        },
        '&.Mui-disabled': {
            color: '#555',
            '& + .MuiSwitch-track': {
                backgroundColor: '#333',
                opacity: 0.5,
            },
        },
    },
    '& .MuiSwitch-thumb': {
        width: 16,
        height: 16,
        boxShadow: 'none',
    },
    '& .MuiSwitch-track': {
        borderRadius: 10,
        backgroundColor: '#555',
        opacity: 1,
    },
}));

const getButtonWithTooltip = (
    key: string,
    tooltipMessage: string,
    imageSrc: string,
    imageAlt: string,
    isActive: boolean,
    href?: string,
    onClick?: () => any,
    isDisabled?: boolean,
    onDoubleClick?: () => any,
    externalClassName?: string,
): React.ReactElement => {
    return <StyledTooltip
        key={key}
        disableFocusListener={true}
        title={tooltipMessage}
        TransitionComponent={Fade}
        TransitionProps={{ timeout: 600 }}
        placement='bottom'
    >
        <div>
            <ImageButton
                buttonSize={BUTTON_SIZE}
                padding={BUTTON_PADDING}
                image={imageSrc}
                imageAlt={imageAlt}
                href={href}
                onClick={isDisabled ? undefined : onClick}
                onDoubleClick={isDisabled ? undefined : onDoubleClick}
                isActive={isActive}
                isDisabled={isDisabled}
                externalClassName={externalClassName}
            />
        </div>
    </StyledTooltip>;
};

interface IProps {
    activeContext: ContextType;
    updateImageDragModeStatusAction: (imageDragMode: boolean) => any;
    updateSmartAnnotationActiveStatusAction: (smartAnnotationActive: boolean) => any;
    updateTrackingModeStatusAction: (trackingMode: boolean) => any;
    trackingMode: boolean;
    trackingInProgress: boolean;
    updateActivePopupTypeAction: (popupType: PopupWindowType) => any;
    updateFullImageInferenceStatus: (isInProgress: boolean) => any;
    toggleImageAILabelsVisibility: (imageId: string) => any;
    toggleImageSegmentationLabelsVisibility: (imageId: string) => any;
    addInferenceHistory: (imageId: string, detectedCount: number, success?: boolean) => any;
    imageDragMode: boolean;
    smartAnnotationActive: boolean;
    samNegativeMode: boolean;
    updateSamNegativeModeAction: (v: boolean) => any;
    eraserMode: boolean;
    eraserFineMode: boolean;
    updateEraserModeAction: (eraserMode: boolean) => any;
    isFullImageInferenceInProgress: boolean;
    imageAIStates: Map<string, { aiLabelsVisible: boolean; segmentationLabelsVisible: boolean; inferenceHistory: Array<any> }>;
    activeLabelType: LabelType;
    activeLabelViewType: LabelType;
    language: Language;
    isAIDisabled: boolean;
    activeImageIndex: number;
    imagesData: ImageData[];
    hasDetectionModel: boolean;
    hasExtensionEngine: boolean;
    modelInspectorBackendKey: string;
    updateActiveLabelType: (activeLabelType: LabelType) => any;
    updateActiveLabelViewType: (activeLabelViewType: LabelType) => any;
}

const EditorTopNavigationBar: React.FC<IProps> = React.memo((
    {
        activeContext,
        updateImageDragModeStatusAction,
        updateSmartAnnotationActiveStatusAction,
        updateTrackingModeStatusAction,
        trackingMode,
        trackingInProgress,
        updateActivePopupTypeAction,
        updateFullImageInferenceStatus,
        toggleImageAILabelsVisibility,
        toggleImageSegmentationLabelsVisibility,
        addInferenceHistory,
        imageDragMode,
        smartAnnotationActive,
        samNegativeMode,
        updateSamNegativeModeAction,
        eraserMode,
        eraserFineMode,
        updateEraserModeAction,
        isFullImageInferenceInProgress,
        imageAIStates,
        activeLabelType,
        activeLabelViewType,
        language,
        isAIDisabled,
        activeImageIndex,
        imagesData,
        hasDetectionModel,
        hasExtensionEngine,
        modelInspectorBackendKey,
        updateActiveLabelType,
        updateActiveLabelViewType,
    }) => {
    const currentTexts = useMemo(() => LanguageConfig[language], [language]);
    
    
    // 辅助函数：检查图片是否真的有AI生成的标签
    const hasAILabels = (imageData: any): boolean => {
        if (!imageData || !imageData.labelRects) return false;
        return imageData.labelRects.some((rect: any) => rect.isCreatedByAI);
    };
    
    // 新的设计不需要复杂的状态同步，因为状态完全基于用户操作和分割历史
    const getClassName = () => {
        return classNames(
            'EditorTopNavigationBar',
            {
                'with-context': activeContext === ContextType.EDITOR
            }
        );
    };

    const imageDragOnClick = useCallback(() => {
        // 切换标签拖拽模式
        updateImageDragModeStatusAction(!imageDragMode);
        // 开启拖拽模式时自动关闭智能标注
        if (!imageDragMode && smartAnnotationActive) {
            updateSmartAnnotationActiveStatusAction(false);
        }
    }, [imageDragMode, smartAnnotationActive, updateImageDragModeStatusAction, updateSmartAnnotationActiveStatusAction]);

    // 顶部工具栏点击 —— 只切换「编辑工具」(activeLabelType → 渲染引擎)
    // 侧栏视图 (activeLabelViewType) 由左侧 LabelsToolkit tab 独立控制，两者解耦
    // 绘制矩形框 / 绘制多边形 / 智能标注 / 查看所有标签 四个工具互斥
    const onToolClick = useCallback((toolType: LabelType) => {
        if (smartAnnotationActive) {
            updateSmartAnnotationActiveStatusAction(false);
        }
        // 切换任何工具时无条件关闭橡皮擦（避免 stale closure 漏掉 eraserMode=true 的情况）
        updateEraserModeAction(false);
        updateActiveLabelType(toolType);
        // 切换工具时重置 cursor 到 DEFAULT —— 避免从 ALL 视图切过来时 GRAB 光标残留
        store.dispatch(updateCustomCursorStyle(CustomCursorStyle.DEFAULT));
    }, [smartAnnotationActive, updateSmartAnnotationActiveStatusAction, updateActiveLabelType, updateEraserModeAction]);

    // 橡皮擦按钮 —— 2 状态切换：整体擦除 ↔ 局部擦除
    // 首次点击激活橡皮擦（进入整体擦除），之后每次点击在整体/局部之间切换
    // 退出橡皮擦：点击其他工具按钮（查看标签/绘制矩形框/绘制多边形）
    const eraserOnClick = useCallback(() => {
        if (!eraserMode) {
            // 未激活 → 默认局部擦除
            updateEraserModeAction(true);
            store.dispatch(updateEraserFineMode(true));
            if (smartAnnotationActive) updateSmartAnnotationActiveStatusAction(false);
            if (trackingMode) updateTrackingModeStatusAction(false);
            if (imageDragMode) updateImageDragModeStatusAction(false);
            updateActiveLabelType(LabelType.ALL);
            store.dispatch(updateCustomCursorStyle(CustomCursorStyle.DEFAULT));
        } else {
            // 已激活 → 在整体/局部之间切换
            store.dispatch(updateEraserFineMode(!eraserFineMode));
        }
    }, [eraserMode, eraserFineMode, smartAnnotationActive, trackingMode, imageDragMode, updateEraserModeAction,
        updateSmartAnnotationActiveStatusAction, updateTrackingModeStatusAction, updateImageDragModeStatusAction, updateActiveLabelType]);

    // 显示/隐藏标签按钮 —— 同时控制矩形框和多边形
    // 默认可见：未被显式隐藏前两个 flag 都是 true
    const toggleAILabelsOnClick = useCallback(() => {
        const activeImageData = LabelsSelector.getActiveImageData();
        if (!activeImageData) return;
        const aiState = imageAIStates.get(activeImageData.id);
        const rectsVisible = aiState?.aiLabelsVisible ?? true;
        const polysVisible = aiState?.segmentationLabelsVisible ?? true;
        const anyVisible = rectsVisible || polysVisible;
        // 若任一可见 → 全部隐藏；若都不可见 → 全部显示
        const target = !anyVisible;
        if (rectsVisible !== target) {
            toggleImageAILabelsVisibility(activeImageData.id);
        }
        if (polysVisible !== target) {
            toggleImageSegmentationLabelsVisibility(activeImageData.id);
        }
        queueMicrotask(() => { EditorActions.fullRender(); });
    }, [toggleImageAILabelsVisibility, toggleImageSegmentationLabelsVisibility, imageAIStates]);

    // ── 时间轴选区（Shift+拖拽）──
    const [timelineRange, setTimelineRange] = useState<FrameRange | null>(getTimelineRange());
    useEffect(() => {
        const handler = () => setTimelineRange(getTimelineRange());
        window.addEventListener('timelineRangeChange', handler);
        return () => window.removeEventListener('timelineRangeChange', handler);
    }, []);

    // ── 推理下拉菜单 ──
    const [showInferenceMenu, setShowInferenceMenu] = useState(false);
    const inferenceMenuRef = useRef<HTMLDivElement>(null);
    const [selectedModelNames, setSelectedModelNames] = useState<string[]>([]);
    const [useModelMultiSelect, setUseModelMultiSelect] = useState(false);
    const [similaritySearchSelected, setSimilaritySearchSelected] = useState(false);
    const [showSimilarityConfig, setShowSimilarityConfig] = useState(false);
    const [similarityCollections, setSimilarityCollections] = useState<SimilarityVectorCollection[]>([]);
    const [similarityJobs, setSimilarityJobs] = useState<SimilarityIngestJob[]>([]);
    const [similarityOptionsLoading, setSimilarityOptionsLoading] = useState(false);
    const [similarityOptionsError, setSimilarityOptionsError] = useState<string | null>(null);
    const [similaritySceneId, setSimilaritySceneId] = useState('');
    const [similarityTargetId, setSimilarityTargetId] = useState('');
    const [similarityCollectionName, setSimilarityCollectionName] = useState('');
    const [similarityMode, setSimilarityMode] = useState<SimilaritySearchMode>('dino');
    const [similaritySearchConfig, setSimilaritySearchConfig] = useState<SimilaritySearchConfig | null>(null);
    const multiInferenceCancelledRef = useRef(false);
    const pendingModelSwitchesRef = useRef<Map<string, Promise<boolean>>>(new Map());
    // 用于区分智能标注按钮的单击 vs 双击（延迟单击 200ms）
    const smartClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // 自定义脚本激活标记 —— 监听 ScriptStore 变更事件刷新
    // ✱ 位置语义：preprocess 激活 → 模型名前面；postprocess 激活 → 后面
    const [hasPreScript, setHasPreScript] = useState<boolean>(() => ScriptStore.hasPreprocess() && PipelineStore.isActivated('preprocess'));
    const [hasPostScript, setHasPostScript] = useState<boolean>(() => ScriptStore.hasPostprocess() && PipelineStore.isActivated('postprocess'));
    useEffect(() => {
        const sync = () => {
            setHasPreScript(ScriptStore.hasPreprocess() && PipelineStore.isActivated('preprocess'));
            setHasPostScript(ScriptStore.hasPostprocess() && PipelineStore.isActivated('postprocess'));
        };
        window.addEventListener('opensight:script-changed', sync);
        const unsubPipeline = PipelineStore.subscribe(sync);
        return () => {
            window.removeEventListener('opensight:script-changed', sync);
            unsubPipeline();
        };
    }, []);
    // 多模型：后端同时保持多个模型在内存，前端下拉展示所有已加载模型
    const [loadedModels, setLoadedModels] = useState<string[]>([]);
    const [activeModelName, setActiveModelName] = useState('');
    // 后端返回的每个模型的 task 类型（detect/segment/classify/pose）
    const [modelTasks, setModelTasks] = useState<Record<string, string>>({});
    // 后端两个 slot 的当前占用
    const [detSlotName, setDetSlotName] = useState<string>('');
    const [segSlotName, setSegSlotName] = useState<string>('');
    // 磁盘上所有模型（/available-models 返回），每类选一个作为内置代表
    const [availableModels, setAvailableModels] = useState<Array<{ name: string; type: string }>>([]);

    // 展示完整文件名（含扩展名），方便用户辨认模型
    const formatName = (name: string) => {
        return name || '';
    };

    // 智能标注需要 SAM 系列分割模型；检查已加载模型中是否有 SAM 家族
    const isSAMLoaded = useMemo(
        () => loadedModels.some(name => /^(sam2|sam3|sam_|mobile_sam|FastSAM)/i.test(name)),
        [loadedModels]
    );
    // 目标跟踪需要 memory-based SAM 家族（SAM 2 / SAM 3），只有它们有跨帧 memory attention
    // SAM 1 / MobileSAM / FastSAM / YOLO-seg 没有 tracking 能力，按钮保持 disabled
    const isTrackingModelLoaded = useMemo(
        () => loadedModels.some(name => /^(sam2|sam3)/i.test(name)),
        [loadedModels]
    );

    // 智能标注按钮：单击 = 激活正点 / 关闭，双击 = 激活负点
    // 用 200ms 延迟区分单击与双击，避免双击时先触发单击
    const smartAnnotationOnClick = useCallback(() => {
        if (!isSAMLoaded) {
            updateActivePopupTypeAction(PopupWindowType.CALL_MODEL);
            return;
        }
        if (smartClickTimerRef.current) {
            clearTimeout(smartClickTimerRef.current);
            smartClickTimerRef.current = null;
        }
        smartClickTimerRef.current = setTimeout(() => {
            smartClickTimerRef.current = null;
            if (smartAnnotationActive) {
                // 已激活 → 关闭智能标注
                // 保持 ALL 视图，否则切回 RECT 视图时 SAM 生成的 polygon 会不可见
                updateSmartAnnotationActiveStatusAction(false);
                updateSamNegativeModeAction(false);
                updateActiveLabelType(LabelType.ALL);
            } else {
                // 未激活 → 激活正点模式
                updateSmartAnnotationActiveStatusAction(true);
                updateSamNegativeModeAction(false);
                updateActiveLabelType(LabelType.ALL);
                if (trackingMode) updateTrackingModeStatusAction(false);
                if (imageDragMode) updateImageDragModeStatusAction(false);
            }
        }, 200);
    }, [isSAMLoaded, smartAnnotationActive, trackingMode, imageDragMode, activeLabelViewType,
        updateSmartAnnotationActiveStatusAction, updateSamNegativeModeAction,
        updateActiveLabelType, updateTrackingModeStatusAction, updateImageDragModeStatusAction,
        updateActivePopupTypeAction]);

    // 智能标注按钮双击 → 激活负点模式
    const smartAnnotationOnDoubleClick = useCallback(() => {
        if (!isSAMLoaded) {
            updateActivePopupTypeAction(PopupWindowType.CALL_MODEL);
            return;
        }
        // 取消待执行的单击
        if (smartClickTimerRef.current) {
            clearTimeout(smartClickTimerRef.current);
            smartClickTimerRef.current = null;
        }
        updateSamNegativeModeAction(true);
        if (!smartAnnotationActive) {
            updateSmartAnnotationActiveStatusAction(true);
            updateActiveLabelType(LabelType.ALL);
            if (trackingMode) updateTrackingModeStatusAction(false);
            if (imageDragMode) updateImageDragModeStatusAction(false);
        }
    }, [isSAMLoaded, smartAnnotationActive, trackingMode, imageDragMode,
        updateSmartAnnotationActiveStatusAction, updateSamNegativeModeAction,
        updateActiveLabelType, updateTrackingModeStatusAction, updateImageDragModeStatusAction,
        updateActivePopupTypeAction]);

    // 检索按钮：只负责切换 trackingMode，不涉及正/负点逻辑
    const trackingOnClick = useCallback(() => {
        if (!isTrackingModelLoaded) {
            updateActivePopupTypeAction(PopupWindowType.CALL_MODEL);
            return;
        }
        const willActivate = !trackingMode;
        updateTrackingModeStatusAction(willActivate);
        if (willActivate) {
            // 激活检索 → 关闭智能标注和其他互斥模式
            if (smartAnnotationActive) {
                updateSmartAnnotationActiveStatusAction(false);
                updateSamNegativeModeAction(false);
            }
            if (imageDragMode) updateImageDragModeStatusAction(false);
            if (eraserMode) updateEraserModeAction(false);
        }
    }, [isTrackingModelLoaded, trackingMode, smartAnnotationActive, imageDragMode, eraserMode,
        updateTrackingModeStatusAction, updateSmartAnnotationActiveStatusAction, updateSamNegativeModeAction,
        updateImageDragModeStatusAction, updateEraserModeAction, updateActivePopupTypeAction]);

    // 智能标注激活时自动切换到 SAM 模型
    useEffect(() => {
        if (smartAnnotationActive) {
            const samModel = loadedModels.find(name => /^(sam2|sam3|sam_|mobile_sam|FastSAM)/i.test(name));
            if (samModel && samModel !== activeModelName) {
                const url = `${getEngineBaseUrl()}/switch-model`;
                fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: samModel }),
                }).then(r => r.json()).then(() => {
                    setActiveModelName(samModel);
                }).catch(() => {});
            }
        }
    }, [smartAnnotationActive, loadedModels, activeModelName]);

    // 切换模型：调用后端 /switch-model，立即乐观更新；切换成功后强制刷新一次状态
    const fetchModelsRef = useRef<() => void>();
    const switchModel = useCallback((modelName: string): Promise<boolean> => {
        const pendingSwitch = pendingModelSwitchesRef.current.get(modelName);
        if (pendingSwitch) return pendingSwitch;
        if (modelName === detSlotName || modelName === segSlotName) {
            setActiveModelName(modelName);
            return Promise.resolve(true);
        }

        setActiveModelName(modelName); // 乐观更新，轮询不会覆盖
        const url = `${getEngineBaseUrl()}/switch-model`;
        const request = fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelName }),
        }).then(r => {
            if (!r.ok) throw new Error(`Switch model failed: HTTP ${r.status}`);
            return r.json();
        }).then(data => {
            if (data.active) setActiveModelName(data.active);
            fetchModelsRef.current?.();
            return true;
        }).catch(() => false).finally(() => {
            pendingModelSwitchesRef.current.delete(modelName);
        });
        pendingModelSwitchesRef.current.set(modelName, request);
        return request;
    }, [detSlotName, segSlotName]);

    // 轮询后端获取已加载模型列表 + 模型类型
    // 注意：health 返回的 "model" 始终是 detection slot，不反映用户的最后选择。
    // activeModelName 仅在首次加载或用户主动切换时设置，轮询不覆盖。
    const initializedRef = useRef(false);
    const loadedModelsRef = useRef<string[]>([]);
    const lastConnectedRef = useRef(false);
    useEffect(() => {
        const fetchModels = (): Promise<boolean> => {
            const baseUrl = getEngineBaseUrl();
            const healthPromise = fetch(`${baseUrl}/health`).then(r => r.json()).then(data => {
                window.dispatchEvent(new CustomEvent('opensight:backend-status', { detail: { connected: true } }));
                if (data.model_tasks) setModelTasks(data.model_tasks);
                setDetSlotName(data.model || '');
                setSegSlotName(data.segmentation_model || '');
                // 同步给非 React 模块（SmartAnnotation / Tracking）用，避免再 fetch 一次
                ActiveModel.setDetection(data.model || '');
                ActiveModel.setSegmentation(data.segmentation_model || '');

                // 首次：用后端 detection slot 初始化
                if (!initializedRef.current && data.model && data.model !== 'none') {
                    setActiveModelName(data.model);
                    initializedRef.current = true;
                }

                // 检测到新模型被加载 → 自动切到新模型
                if (data.loaded_models) {
                    const prev = loadedModelsRef.current;
                    const curr = data.loaded_models as string[];
                    if (initializedRef.current) {
                        const newModels = curr.filter(m => !prev.includes(m));
                        if (newModels.length > 0) {
                            setActiveModelName(newModels[newModels.length - 1]);
                        }
                    }
                    loadedModelsRef.current = curr;
                    setLoadedModels(curr);
                }

                if (EditorModel.lastLoadedModelService) {
                    EditorModel.lastLoadedModelService = null;
                }
                return true;
            }).catch(() => {
                window.dispatchEvent(new CustomEvent('opensight:backend-status', { detail: { connected: false } }));
                return false;
            });
            // 磁盘上所有模型（供 slot 被自定义占用时选一个内置代表）
            fetch(`${baseUrl}/available-models`).then(r => r.json()).then(data => {
                if (Array.isArray(data.models)) setAvailableModels(data.models);
            }).catch(() => {});
            return healthPromise;
        };
        fetchModelsRef.current = fetchModels;

        // 自适应轮询：未连接时用短间隔（2s）快速发现刚启动的后端，
        // 一旦连上就退回 30s（v2.6.0 起的节流，避免推理时打满 health 通道）。
        // 切换模型时由 switchModel 主动调 fetchModelsRef 强制刷新，不靠轮询。
        const CONNECTED_INTERVAL = 30000;
        const DISCONNECTED_INTERVAL = 2000;
        let timer: ReturnType<typeof setInterval>;
        const scheduleTick = (intervalMs: number) => {
            clearInterval(timer);
            timer = setInterval(tick, intervalMs);
        };
        const tick = () => {
            if (document.hidden) return;
            const wasConnected = lastConnectedRef.current;
            fetchModels().then((connected) => {
                if (connected !== wasConnected) {
                    lastConnectedRef.current = connected;
                    scheduleTick(connected ? CONNECTED_INTERVAL : DISCONNECTED_INTERVAL);
                }
            });
        };
        fetchModels().then((connected) => {
            lastConnectedRef.current = connected;
            scheduleTick(connected ? CONNECTED_INTERVAL : DISCONNECTED_INTERVAL);
        });
        const onModelLoaded = () => fetchModels();
        window.addEventListener('opensight:model-loaded', onModelLoaded);
        return () => {
            clearInterval(timer);
            window.removeEventListener('opensight:model-loaded', onModelLoaded);
        };
    }, []);

    // 点击外部关闭下拉
    useEffect(() => {
        if (!showInferenceMenu) return undefined;
        const handleClickOutside = (e: MouseEvent) => {
            if (inferenceMenuRef.current && !inferenceMenuRef.current.contains(e.target as Node)) {
                setShowInferenceMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showInferenceMenu]);

    const loadSimilaritySearchOptions = useCallback(async () => {
        setSimilarityOptionsLoading(true);
        setSimilarityOptionsError(null);
        const vectorBaseUrl = `${getExtensionEngineBaseUrl()}/vector_db`;
        try {
            const [collectionsResponse, jobsResponse] = await Promise.all([
                fetch(`${vectorBaseUrl}/collections`),
                fetch(`${vectorBaseUrl}/jobs`),
            ]);
            if (!collectionsResponse.ok || !jobsResponse.ok) {
                throw new Error(`HTTP ${collectionsResponse.status}/${jobsResponse.status}`);
            }
            const collectionsBody = await collectionsResponse.json();
            const jobsBody = await jobsResponse.json();
            setSimilarityCollections(
                Array.isArray(collectionsBody.collections) ? collectionsBody.collections : []
            );
            setSimilarityJobs(Array.isArray(jobsBody.jobs) ? jobsBody.jobs : []);
        } catch (cause) {
            setSimilarityOptionsError(
                language === 'zh'
                    ? `检索方案加载失败：${cause instanceof Error ? cause.message : String(cause)}`
                    : `Failed to load retrieval options: ${cause instanceof Error ? cause.message : String(cause)}`
            );
        } finally {
            setSimilarityOptionsLoading(false);
        }
    }, [language]);

    useEffect(() => {
        if (showSimilarityConfig) {
            void loadSimilaritySearchOptions();
        }
    }, [showSimilarityConfig, loadSimilaritySearchOptions]);

    // 模型下拉选项（useMemo 避免重复计算）
    const modelDropdownEntries = useMemo(() => {
        const zh = language === 'zh';
        const allBuiltins = [...YOLO_MODEL_FAMILIES, ...SEG_MODEL_FAMILIES].flatMap(f => f.variants);
        const isCustomName = (name: string) => !allBuiltins.includes(name.replace(/\.(pt|onnx)$/i, ''));
        const normalize = (name: string): string =>
            name.endsWith('.pt') || name.endsWith('.onnx') ? name : name + '.pt';
        type Cat = 'custom-seg' | 'builtin-seg' | 'custom-det' | 'builtin-det';
        const pickFor = (cat: Cat): string | null => {
            const slotName = cat.endsWith('seg') ? segSlotName : detSlotName;
            if (slotName) {
                const slotIsCustom = isCustomName(slotName);
                const slotMatchesCat = cat.startsWith('custom') ? slotIsCustom : !slotIsCustom;
                if (slotMatchesCat) return slotName;
            }
            if (cat.startsWith('custom')) {
                const expectsSegmentation = cat.endsWith('seg');
                return loadedModels.find(name => {
                    if (!isCustomName(name)) return false;
                    const task = modelTasks[name] || inferModelTaskFromName(name);
                    return expectsSegmentation ? task === 'segment' : task !== 'segment';
                }) || null;
            }
            const found = cat === 'builtin-seg'
                ? availableModels.find(m => m.type === 'segmentation')
                : availableModels.find(m => m.type === 'detection');
            return found ? normalize(found.name) : null;
        };
        const catOrder: Array<{ cat: Cat; label: string }> = [
            { cat: 'custom-det',  label: zh ? '自定义' : 'Custom' },
            { cat: 'custom-seg',  label: zh ? '自定义' : 'Custom' },
            { cat: 'builtin-det', label: zh ? '检测模型' : 'Detection' },
            { cat: 'builtin-seg', label: zh ? '分割模型' : 'Segmentation Model' },
        ];
        const seen = new Set<string>();
        const entries: Array<{
            name: string;
            label: string;
            group: 'custom' | 'models';
            task: 'detect' | 'segment';
        }> = [];
        for (const { cat, label } of catOrder) {
            const name = pickFor(cat);
            if (name && !seen.has(name)) {
                seen.add(name);
                entries.push({
                    name,
                    label,
                    group: cat.startsWith('custom') ? 'custom' : 'models',
                    task: cat.endsWith('seg') ? 'segment' : 'detect',
                });
            }
        }
        return entries;
    }, [language, availableModels, detSlotName, segSlotName, loadedModels, modelTasks]);

    // 模型列表刷新后移除已经不存在的勾选项。
    useEffect(() => {
        setSelectedModelNames(current =>
            current.filter(name => modelDropdownEntries.some(entry => entry.name === name))
        );
    }, [modelDropdownEntries]);

    const activeModelEntry = modelDropdownEntries.find(e => e.name === activeModelName);
    const effectiveSelectedModelNames = useModelMultiSelect
        ? selectedModelNames
        : activeModelEntry ? [activeModelEntry.name] : [];
    const selectedModelEntries = modelDropdownEntries.filter(
        entry => effectiveSelectedModelNames.includes(entry.name)
    );

    // 当前选中项的显示文本
    const activeModelLabel = activeModelEntry
        ? `${activeModelEntry.label} (${activeModelEntry.name})`
        : loadedModels.length === 0 ? (language === 'zh' ? '未加载模型' : 'No model') : activeModelName;
    const selectedOptionCount = selectedModelEntries.length + (similaritySearchSelected ? 1 : 0);
    const modelButtonLabel = useModelMultiSelect
        ? selectedOptionCount === 0
            ? (language === 'zh' ? '请选择模型' : 'Select models')
            : selectedOptionCount === 1 && selectedModelEntries.length === 1
                ? `${selectedModelEntries[0].label} (${selectedModelEntries[0].name})`
                : selectedOptionCount === 1
                    ? (language === 'zh' ? '检索相似' : 'Similarity Search')
                : (language === 'zh'
                    ? `已选 ${selectedOptionCount} 项`
                    : `${selectedOptionCount} options selected`)
        : activeModelLabel;

    const similarityScenes = useMemo(() => {
        const scenes = new Map<string, string>();
        similarityCollections.forEach(collection => {
            scenes.set(collection.scene_id, collection.scene_name);
        });
        return [...scenes.entries()].map(([id, name]) => ({ id, name }));
    }, [similarityCollections]);

    const similarityTargets = useMemo(() => {
        const targets = new Map<string, string>();
        similarityCollections
            .filter(collection => collection.scene_id === similaritySceneId)
            .forEach(collection => targets.set(collection.target_id, collection.target_name));
        return [...targets.entries()].map(([id, name]) => ({ id, name }));
    }, [similarityCollections, similaritySceneId]);

    const similarityVersionCollections = useMemo(
        () => similarityCollections
            .filter(collection =>
                collection.scene_id === similaritySceneId
                && collection.target_id === similarityTargetId
            )
            .sort((left, right) => right.version - left.version),
        [similarityCollections, similaritySceneId, similarityTargetId]
    );

    const latestSimilarityCollection = similarityVersionCollections[0] || null;
    const selectedSimilarityCollection = similarityVersionCollections.find(
        collection => collection.name === similarityCollectionName
    ) || latestSimilarityCollection;

    const selectedSimilarityDatasetJob = useMemo(() => {
        if (!selectedSimilarityCollection) return null;
        return similarityJobs
            .filter(job =>
                job.collection === selectedSimilarityCollection.name
                && job.state === 'completed'
                && !!job.dataset_id
            )
            .sort((left, right) => {
                const dataVersionDifference = (right.data_version || 0) - (left.data_version || 0);
                if (dataVersionDifference !== 0) return dataVersionDifference;
                const rightTime = Date.parse(right.finished_at || right.updated_at || '') || 0;
                const leftTime = Date.parse(left.finished_at || left.updated_at || '') || 0;
                return rightTime - leftTime;
            })[0] || null;
    }, [selectedSimilarityCollection, similarityJobs]);

    useEffect(() => {
        if (similarityScenes.length === 0) return;
        if (!similarityScenes.some(scene => scene.id === similaritySceneId)) {
            setSimilaritySceneId(similarityScenes[0].id);
        }
    }, [similarityScenes, similaritySceneId]);

    useEffect(() => {
        if (similarityTargets.length === 0) {
            setSimilarityTargetId('');
            return;
        }
        if (!similarityTargets.some(target => target.id === similarityTargetId)) {
            setSimilarityTargetId(similarityTargets[0].id);
        }
    }, [similarityTargets, similarityTargetId]);

    useEffect(() => {
        if (similarityVersionCollections.length === 0) {
            setSimilarityCollectionName('');
            return;
        }
        if (!similarityVersionCollections.some(collection => collection.name === similarityCollectionName)) {
            setSimilarityCollectionName(similarityVersionCollections[0].name);
        }
    }, [similarityCollectionName, similarityVersionCollections]);

    const openSimilarityConfig = useCallback(() => {
        if (similaritySearchConfig) {
            setSimilaritySceneId(similaritySearchConfig.sceneId);
            setSimilarityTargetId(similaritySearchConfig.targetId);
            setSimilarityCollectionName(similaritySearchConfig.collectionName);
            setSimilarityMode(similaritySearchConfig.mode);
        }
        setShowSimilarityConfig(true);
    }, [similaritySearchConfig]);

    const saveSimilarityConfig = useCallback(() => {
        if (!selectedSimilarityCollection) return;
        if (similarityMode === 'dino' && (
            !selectedSimilarityCollection.compatible || selectedSimilarityCollection.count === 0
        )) return;
        if (similarityMode === 'l2g' && !selectedSimilarityDatasetJob?.dataset_id) return;

        const config: SimilaritySearchConfig = {
            mode: similarityMode,
            sceneId: selectedSimilarityCollection.scene_id,
            sceneName: selectedSimilarityCollection.scene_name,
            targetId: selectedSimilarityCollection.target_id,
            targetName: selectedSimilarityCollection.target_name,
            collectionName: selectedSimilarityCollection.name,
            collectionVersion: selectedSimilarityCollection.version,
            dataVersion: selectedSimilarityCollection.data_version
                || selectedSimilarityDatasetJob?.data_version
                || 0,
            datasetId: selectedSimilarityDatasetJob?.dataset_id || undefined,
        };
        if (!useModelMultiSelect) {
            setSelectedModelNames(activeModelEntry ? [activeModelEntry.name] : []);
        }
        setUseModelMultiSelect(true);
        setSimilaritySearchConfig(config);
        setSimilaritySearchSelected(true);
        setShowSimilarityConfig(false);
    }, [
        activeModelEntry,
        selectedSimilarityCollection,
        selectedSimilarityDatasetJob,
        similarityMode,
        useModelMultiSelect,
    ]);
    const similarityConfigCanSave = !!selectedSimilarityCollection
        && (
            similarityMode === 'dino'
                ? selectedSimilarityCollection.compatible && selectedSimilarityCollection.count > 0
                : !!selectedSimilarityDatasetJob?.dataset_id
        );
    const similarityConfigSummary = similaritySearchConfig
        ? `${similaritySearchConfig.sceneName}-${similaritySearchConfig.targetName}-v${
            similaritySearchConfig.collectionVersion
        }-${
            similaritySearchConfig.mode === 'dino'
                ? (language === 'zh' ? '快速模式' : 'Fast Mode')
                : (language === 'zh' ? '高精度模式' : 'High-precision Mode')
        }`
        : '';

    // 判断当前活跃模型是否为分割类型:
    // 1. 优先使用后端 model_tasks（精确，通过 model.task 属性获取）
    // 2. 回退到统一文件名 token 规则（含日期_SEG_项目_... 模型）
    const isSegModel = useMemo(
        () => {
            const task = modelTasks[activeModelName];
            if (task) return task === 'segment';
            return inferModelTaskFromName(activeModelName) === 'segment';
        },
        [activeModelName, modelTasks]
    );

    // 同步选中模型的任务类型到 Redux，供 pipeline popup 读取
    useEffect(() => {
        const task = modelTasks[activeModelName];
        const resolvedTask: string | null = task
            ? task
            : activeModelName
                ? inferModelTaskFromName(activeModelName)
                : null;
        store.dispatch({ type: 'SET_SELECTED_MODEL_TASK', payload: resolvedTask });
    }, [activeModelName, modelTasks]);

    const launchConfiguredSimilaritySearch = useCallback((queryFile: File): boolean => {
        if (!similaritySearchConfig) return false;
        queueSimilaritySearchPreset({
            ...similaritySearchConfig,
            queryFile,
        });
        updateActivePopupTypeAction(PopupWindowType.L2G_RETRIEVAL);
        return true;
    }, [similaritySearchConfig, updateActivePopupTypeAction]);

    const runInference = useCallback(async (_mode?: string) => {
        setShowInferenceMenu(false);
        if (isFullImageInferenceInProgress) {
            console.log('[Infer] skip: inference already in progress');
            return;
        }

        const activeImageData = LabelsSelector.getActiveImageData();
        if (!activeImageData) {
            console.log('[Infer] skip: no active image data');
            return;
        }
        multiInferenceCancelledRef.current = false;
        console.log('[Infer] entry', {
            isSegModel,
            smartAnnotationActive,
            trackingMode,
            activeModelName,
            selectedModels: selectedModelEntries.map(entry => entry.name),
            hasImage: !!activeImageData,
            imageId: activeImageData.id,
        });

        // ── 智能标注模式：收集 prompt LabelRects，统一发 SAM 推理 ──
        if (smartAnnotationActive) {
            const prompts = SmartAnnotationActions.getPromptRects(activeImageData);
            if (prompts.length === 0) return;
            SmartAnnotationActions.runAllPrompts();
            return;
        }

        // ── 检索模式：用当前帧的 polygon 作为 seed mask 跨帧跟踪 ──
        if (trackingMode) {
            const polygons = (activeImageData.labelPolygons || []).filter(p => p.isVisible !== false);
            if (polygons.length === 0) {
                const errNote = NotificationUtil.createErrorNotification({
                    header: language === 'zh' ? '检索失败' : 'Retrieval failed',
                    description: language === 'zh'
                        ? '当前帧没有可见标注，请先用智能标注创建 seed mask（或取消隐藏已有标注）'
                        : 'No visible annotations on current frame. Create a seed mask first or unhide existing ones.',
                });
                store.dispatch(submitNewNotification(errNote));
                setTimeout(() => store.dispatch(deleteNotificationById(errNote.id)), 5000);
                return;
            }

            const range = getTimelineRange();
            const activeVideo = store.getState().video?.activeVideo;
            const currentFrame = activeVideo?.currentFrame ?? LabelsSelector.getActiveImageIndex();

            // 提取 polygon vertices → [x,y][][]
            const maskPolygons: [number, number][][] = polygons.map(p =>
                p.vertices.map((v: any) => [v.x, v.y] as [number, number])
            );

            const rangeStart = range ? range.startFrame : 0;
            const rangeEnd = range ? range.endFrame : imagesData.length - 1;
            const sessionId = activeVideo?.sessionId || '';
            const modelName = activeModelName;

            // 自动判断方向：seed 帧离选区末端更近时反向检索
            const distToStart = Math.abs(currentFrame - rangeStart);
            const distToEnd = Math.abs(currentFrame - rangeEnd);
            const reverse = distToEnd < distToStart;

            // 反向：从 seed 帧往前走到选区起点；正向：从 seed 帧往后走到选区终点
            const startFrame = reverse ? rangeStart : currentFrame;
            const endFrame = reverse ? currentFrame : rangeEnd;

            // 尝试从第一个 polygon 的 labelId 获取 className
            const labels = store.getState().labels.labels;
            const firstLabelId = polygons[0]?.labelId;
            const labelName = labels.find((l: any) => l.id === firstLabelId);
            const className = labelName?.name || 'retrieved';

            ObjectTrackingActions.startRetrieval({
                sessionId,
                startFrameIdx: startFrame,
                endFrameIdx: endFrame,
                maskPolygons,
                modelName,
                className,
                reverse,
            });
            return;
        }

        // ── 正常推理模式 ──
        // 多选模式按菜单顺序串行执行（检测 → 推理），避免两个批任务争抢全局进度状态。
        const inferencePlan = useModelMultiSelect
            ? selectedModelEntries
            : [{
                name: activeModelName,
                task: isSegModel ? 'segment' as const : 'detect' as const,
            }];
        if (inferencePlan.length === 0) {
            if (similaritySearchSelected) {
                if (!launchConfiguredSimilaritySearch(activeImageData.fileData as File)) {
                    setShowInferenceMenu(true);
                    openSimilarityConfig();
                }
            }
            return;
        }

        const range = getTimelineRange();
        const selectedImages = imagesData.filter((img: ImageData) => img.isSelected);
        const isTimelineBatch = range !== null;
        const isSelectionBatch = selectedImages.length > 1;
        const isBatchMode = isTimelineBatch || isSelectionBatch;
        const targets = range
            ? imagesData.slice(range.startFrame, range.endFrame + 1)
            : isSelectionBatch ? selectedImages : [activeImageData];
        if (targets.length === 0) return;
        const detectionModelCount = inferencePlan.filter(entry => entry.task === 'detect').length;
        const segmentationModelCount = inferencePlan.filter(entry => entry.task === 'segment').length;

        for (const entry of inferencePlan) {
            if (multiInferenceCancelledRef.current) break;

            updateFullImageInferenceStatus(true);
            const modelReady = await switchModel(entry.name);
            if (!modelReady) {
                updateFullImageInferenceStatus(false);
                continue;
            }
            if (multiInferenceCancelledRef.current) {
                updateFullImageInferenceStatus(false);
                break;
            }

            if (entry.task === 'segment') {
                await AISegmentationActions.segmentBatch(
                    targets,
                    isBatchMode && segmentationModelCount === 1
                );
            } else {
                // 单模型单帧沿用原来的轻量回调路径；多模型单帧改走可等待的
                // detectBatch(false)，确保检测完成后再开始下一项推理。
                if (inferencePlan.length === 1 && !isBatchMode && !similaritySearchSelected) {
                    AIDetectionActions.detectObjects(activeImageData);
                } else {
                    await AIDetectionActions.detectBatch(
                        targets,
                        isBatchMode && detectionModelCount === 1
                    );
                }
            }
        }
        if (similaritySearchSelected && !multiInferenceCancelledRef.current) {
            if (!launchConfiguredSimilaritySearch(activeImageData.fileData as File)) {
                setShowInferenceMenu(true);
                openSimilarityConfig();
            }
        }
    }, [
        imagesData,
        isFullImageInferenceInProgress,
        updateFullImageInferenceStatus,
        isSegModel,
        smartAnnotationActive,
        trackingMode,
        language,
        activeModelName,
        selectedModelEntries,
        similaritySearchSelected,
        launchConfiguredSimilaritySearch,
        openSimilarityConfig,
        switchModel,
        useModelMultiSelect,
    ]);

    const withAI = (
        (activeLabelType === LabelType.RECT || activeLabelType === LabelType.ALL) && AISelector.isRoboflowAPIModelLoaded()
    )

    return (
        <div className={getClassName()}>
            <div className='ButtonWrapper collapsible'>
                {
                    getButtonWithTooltip(
                        'zoom-in',
                        currentTexts.editorTopNavBar.zoomIn,
                        'ico/zoom-in.png',
                        'zoom-in',
                        false,
                        undefined,
                        () => ViewPortActions.zoomIn()
                    )
                }
                {
                    getButtonWithTooltip(
                        'zoom-out',
                        currentTexts.editorTopNavBar.zoomOut,
                        'ico/zoom-out.png',
                        'zoom-out',
                        false,
                        undefined,
                        () => ViewPortActions.zoomOut()
                    )
                }
                {
                    getButtonWithTooltip(
                        'zoom-max',
                        currentTexts.editorTopNavBar.maxZoom,
                        'ico/zoom-max.png',
                        'zoom-max',
                        false,
                        undefined,
                        () => ViewPortActions.setOneForOneZoom()
                    )
                }
                {
                    getButtonWithTooltip(
                        'zoom-fit',
                        currentTexts.editorTopNavBar.fitImage,
                        'ico/zoom-fit.png',
                        'zoom-fit',
                        false,
                        undefined,
                        () => ViewPortActions.setDefaultZoom()
                    )
                }
            </div>
            <div className='ButtonWrapper collapsible'>
                {
                    getButtonWithTooltip(
                        'tool-all',
                        currentTexts.labelTypes?.toolAll || '查看所有标签',
                        'ico/all.png',
                        'tool-all',
                        !smartAnnotationActive && !eraserMode && activeLabelType === LabelType.ALL,
                        undefined,
                        () => onToolClick(LabelType.ALL)
                    )
                }
                {
                    getButtonWithTooltip(
                        'tool-rect',
                        currentTexts.labelTypes?.toolRect || '绘制矩形框',
                        'ico/rectangle.png',
                        'tool-rect',
                        !smartAnnotationActive && !eraserMode && activeLabelType === LabelType.RECT,
                        undefined,
                        () => onToolClick(LabelType.RECT)
                    )
                }
                {/* Point and Line tools hidden
                {
                    getButtonWithTooltip(
                        'tool-point',
                        currentTexts.labelTypes?.point || '点',
                        'ico/point.png',
                        'tool-point',
                        activeLabelType === LabelType.POINT,
                        undefined,
                        () => onToolClick(LabelType.POINT)
                    )
                }
                {
                    getButtonWithTooltip(
                        'tool-line',
                        currentTexts.labelTypes?.line || '线条',
                        'ico/line.png',
                        'tool-line',
                        activeLabelType === LabelType.LINE,
                        undefined,
                        () => onToolClick(LabelType.LINE)
                    )
                }
                */}
                {
                    getButtonWithTooltip(
                        'tool-polygon',
                        currentTexts.labelTypes?.toolPolygon || '绘制多边形',
                        'ico/polygon.png',
                        'tool-polygon',
                        !smartAnnotationActive && !eraserMode && activeLabelType === LabelType.POLYGON,
                        undefined,
                        () => onToolClick(LabelType.POLYGON)
                    )
                }
                {(() => {
                    const activeImageData = LabelsSelector.getActiveImageData();
                    const hasImage = imagesData.length > 0;
                    const aiState = activeImageData ? imageAIStates.get(activeImageData.id) : null;
                    const rectsVisible = aiState?.aiLabelsVisible ?? true;
                    const polysVisible = aiState?.segmentationLabelsVisible ?? true;
                    const anyVisible = rectsVisible || polysVisible;
                    const hasAnyLabel = hasImage && (
                        (activeImageData?.labelRects?.length || 0) > 0 ||
                        (activeImageData?.labelPolygons?.length || 0) > 0
                    );
                    const isDisabled = !hasImage || !hasAnyLabel;
                    const icon = isDisabled ? 'ico/eye-slash.png'
                        : anyVisible ? 'ico/eye.png' : 'ico/eye-off.png';
                    return getButtonWithTooltip(
                        'toggle-ai-labels',
                        anyVisible ? '隐藏标签' : '显示标签',
                        icon,
                        'toggle-ai-labels',
                        !isDisabled && anyVisible,
                        undefined,
                        isDisabled ? undefined : toggleAILabelsOnClick,
                        isDisabled
                    );
                })()}
            </div>
            {useMemo(() => {
                if (imagesData.length === 0) return null;
                const activeImageData = LabelsSelector.getActiveImageData();
                const hasAnyLabel = imagesData.length > 0 && (
                    (activeImageData?.labelRects?.length || 0) > 0 ||
                    (activeImageData?.labelPolygons?.length || 0) > 0
                );

                return <div className='ButtonWrapper'>
                    {isSAMLoaded && getButtonWithTooltip(
                        'smart-annotation',
                        smartAnnotationActive
                            ? (samNegativeMode
                                ? (language === 'zh' ? '负点模式（单击关闭）' : 'Negative mode (click to close)')
                                : (language === 'zh' ? '正点模式（单击关闭/双击切负点）' : 'Positive mode (click off / dbl-click neg)'))
                            : (language === 'zh' ? '智能标注（单击正点/双击负点）' : 'Smart Annotation (click pos / dbl-click neg)'),
                        'ico/cross-hair.png',
                        'smart-annotation',
                        smartAnnotationActive && !eraserMode,
                        undefined,
                        smartAnnotationOnClick,
                        false,
                        smartAnnotationOnDoubleClick,
                        smartAnnotationActive && samNegativeMode ? 'active-negative' : undefined,
                    )}
                    {isTrackingModelLoaded && getButtonWithTooltip(
                        'object-tracking',
                        language === 'zh' ? '检索' : 'Retrieve',
                        'ico/tracking.png',
                        'object-tracking',
                        trackingMode && !eraserMode,
                        undefined,
                        trackingOnClick,
                    )}
                    {hasAnyLabel && getButtonWithTooltip(
                        'eraser',
                        language === 'zh'
                            ? (eraserFineMode ? '局部擦除' : '整体擦除')
                            : (eraserFineMode ? 'Local erase' : 'Whole erase'),
                        eraserFineMode ? 'ico/eraser.png' : 'ico/eraser-fine.png',
                        'eraser',
                        eraserMode,
                        undefined,
                        eraserOnClick
                    )}
                </div>;
            }, [imagesData, activeImageIndex, isSAMLoaded, smartAnnotationActive, samNegativeMode, smartAnnotationOnClick, smartAnnotationOnDoubleClick, isTrackingModelLoaded, trackingOnClick, trackingMode, trackingInProgress, currentTexts, eraserMode, eraserFineMode, eraserOnClick, language])}
            <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto', gap: 6, height: '100%' }}>
                <ModelInspectorTrigger
                    key={modelInspectorBackendKey}
                    backendKey={modelInspectorBackendKey}
                    disabled={imagesData.length === 0}
                    hasExtensionEngine={hasExtensionEngine}
                    language={language}
                    onOpen={() => updateActivePopupTypeAction(PopupWindowType.MODEL_INSPECTOR)}
                />
                <div ref={inferenceMenuRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <button
                        disabled={isFullImageInferenceInProgress}
                        onClick={() => setShowInferenceMenu(v => !v)}
                        style={{
                            background: '#333',
                            color: imagesData.length === 0 ? '#666' : '#ccc',
                            border: '1px solid #555',
                            borderRadius: 4,
                            fontSize: 11,
                            height: 22,
                            lineHeight: '16px',
                            padding: '0 20px 0 6px',
                            cursor: 'default',
                            outline: 'none',
                            width: 186,
                            minWidth: 186,
                            maxWidth: 186,
                            flexShrink: 0,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            position: 'relative',
                            textAlign: 'left',
                            boxSizing: 'border-box',
                        }}
                    >
                        {modelButtonLabel}
                        {hasPreScript && <span title={language === 'zh' ? '已激活自定义前处理脚本' : 'Custom preprocess script active'} style={{ color: '#5cc98a', fontWeight: 700 }}>*</span>}
                        {hasPostScript && <span title={language === 'zh' ? '已激活自定义后处理脚本' : 'Custom postprocess script active'} style={{ color: '#5cc98a', fontWeight: 700 }}>*</span>}
                        <span style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', fontSize: 9, pointerEvents: 'none' }}>▼</span>
                    </button>
                    {showInferenceMenu && (
                        <div style={{
                            position: 'absolute',
                            top: 'calc(100% + 2px)',
                            left: 0,
                            zIndex: 9999,
                            background: '#2a2a2a',
                            border: '1px solid #555',
                            borderRadius: 4,
                            minWidth: '100%',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                            overflow: 'hidden',
                        }}>
                            {showSimilarityConfig ? (
                                <div style={{ width: 330, color: '#ccc', fontSize: 11 }}>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        height: 32,
                                        padding: '0 10px',
                                        borderBottom: '1px solid #555',
                                        color: '#fff',
                                        fontWeight: 600,
                                    }}>
                                        <button
                                            type='button'
                                            onClick={() => setShowSimilarityConfig(false)}
                                            title={language === 'zh' ? '返回' : 'Back'}
                                            style={{
                                                padding: 0,
                                                border: 0,
                                                background: 'transparent',
                                                color: '#ccc',
                                                cursor: 'pointer',
                                                fontSize: 16,
                                                lineHeight: 1,
                                            }}
                                        >
                                            ←
                                        </button>
                                        {language === 'zh' ? '配置检索相似' : 'Configure Similarity Search'}
                                    </div>
                                    <div style={{ padding: 10 }}>
                                        {similarityOptionsLoading ? (
                                            <div style={{ padding: '12px 0', color: '#aaa', textAlign: 'center' }}>
                                                {language === 'zh' ? '正在读取检索方案…' : 'Loading retrieval options…'}
                                            </div>
                                        ) : similarityOptionsError ? (
                                            <div style={{ padding: '8px 0', color: '#ff8a80' }}>
                                                <div>{similarityOptionsError}</div>
                                                <button
                                                    type='button'
                                                    onClick={() => void loadSimilaritySearchOptions()}
                                                    style={{
                                                        marginTop: 7,
                                                        border: '1px solid #666',
                                                        borderRadius: 3,
                                                        background: '#3a3a3a',
                                                        color: '#ddd',
                                                        cursor: 'pointer',
                                                        fontSize: 11,
                                                    }}
                                                >
                                                    {language === 'zh' ? '重试' : 'Retry'}
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <label style={{ display: 'block', marginBottom: 9 }}>
                                                    <span style={{ display: 'block', marginBottom: 4 }}>
                                                        {language === 'zh' ? '场景' : 'Scene'}
                                                    </span>
                                                    <select
                                                        value={similaritySceneId}
                                                        onChange={event => setSimilaritySceneId(event.target.value)}
                                                        style={{
                                                            width: '100%',
                                                            height: 26,
                                                            padding: '0 6px',
                                                            border: '1px solid #555',
                                                            borderRadius: 3,
                                                            background: '#202020',
                                                            color: '#ddd',
                                                            fontSize: 11,
                                                        }}
                                                    >
                                                        {similarityScenes.length === 0 && (
                                                            <option value=''>{language === 'zh' ? '暂无场景' : 'No scenes'}</option>
                                                        )}
                                                        {similarityScenes.map(scene => (
                                                            <option key={scene.id} value={scene.id}>{scene.name}</option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label style={{ display: 'block', marginBottom: 9 }}>
                                                    <span style={{ display: 'block', marginBottom: 4 }}>
                                                        {language === 'zh' ? '目标' : 'Target'}
                                                    </span>
                                                    <select
                                                        value={similarityTargetId}
                                                        onChange={event => setSimilarityTargetId(event.target.value)}
                                                        disabled={similarityTargets.length === 0}
                                                        style={{
                                                            width: '100%',
                                                            height: 26,
                                                            padding: '0 6px',
                                                            border: '1px solid #555',
                                                            borderRadius: 3,
                                                            background: '#202020',
                                                            color: '#ddd',
                                                            fontSize: 11,
                                                        }}
                                                    >
                                                        {similarityTargets.length === 0 && (
                                                            <option value=''>{language === 'zh' ? '暂无目标' : 'No targets'}</option>
                                                        )}
                                                        {similarityTargets.map(target => (
                                                            <option key={target.id} value={target.id}>{target.name}</option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label style={{
                                                    display: 'block',
                                                    marginBottom: 10,
                                                }}>
                                                    <span style={{ display: 'block', marginBottom: 4 }}>
                                                        {language === 'zh' ? '版本' : 'Version'}
                                                    </span>
                                                    {selectedSimilarityCollection ? (
                                                        <>
                                                            <select
                                                                value={selectedSimilarityCollection.name}
                                                                onChange={event => setSimilarityCollectionName(event.target.value)}
                                                                style={{
                                                                    width: '100%',
                                                                    height: 26,
                                                                    padding: '0 6px',
                                                                    border: '1px solid #555',
                                                                    borderRadius: 3,
                                                                    background: '#202020',
                                                                    color: '#ddd',
                                                                    fontSize: 11,
                                                                }}
                                                            >
                                                                {similarityVersionCollections.map(collection => (
                                                                    <option
                                                                        key={collection.name}
                                                                        value={collection.name}
                                                                        disabled={!collection.compatible || collection.count === 0}
                                                                    >
                                                                        v{collection.version} {collection.granularity === 'bbox'
                                                                            ? (language === 'zh' ? '(目标框)' : '(Bounding boxes)')
                                                                            : (language === 'zh' ? '(整张图片)' : '(Whole image)')}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            <div style={{
                                                                marginTop: 4,
                                                                color: selectedSimilarityCollection.name === latestSimilarityCollection?.name
                                                                    ? '#7fcf9a'
                                                                    : '#aaa',
                                                            }}>
                                                                {selectedSimilarityCollection.name === latestSimilarityCollection?.name
                                                                    ? (language === 'zh'
                                                                        ? `已自动选择最新版本，共 ${selectedSimilarityCollection.count} 条向量`
                                                                        : `Latest version selected automatically, ${selectedSimilarityCollection.count} vectors total`)
                                                                    : (language === 'zh'
                                                                        ? `共 ${selectedSimilarityCollection.count} 条向量`
                                                                        : `${selectedSimilarityCollection.count} vectors total`)}
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <span style={{ color: '#ff8a80' }}>
                                                            {language === 'zh' ? '该目标暂无向量版本' : 'No vector version for this target'}
                                                        </span>
                                                    )}
                                                </label>
                                                <div style={{ marginBottom: 10 }}>
                                                    <div style={{ marginBottom: 5 }}>
                                                        {language === 'zh' ? '检索方案' : 'Retrieval mode'}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 6 }}>
                                                        {([
                                                            ['dino', language === 'zh' ? '快速' : 'Fast'],
                                                            ['l2g', language === 'zh' ? '高精度' : 'High-precision'],
                                                        ] as Array<[SimilaritySearchMode, string]>).map(([mode, label]) => (
                                                            <button
                                                                key={mode}
                                                                type='button'
                                                                onClick={() => setSimilarityMode(mode)}
                                                                style={{
                                                                    flex: 1,
                                                                    height: 28,
                                                                    border: `1px solid ${similarityMode === mode ? '#d32f2f' : '#555'}`,
                                                                    borderRadius: 3,
                                                                    background: similarityMode === mode ? '#c62828' : '#333',
                                                                    color: similarityMode === mode ? '#fff' : '#ccc',
                                                                    cursor: 'pointer',
                                                                    fontSize: 11,
                                                                }}
                                                            >
                                                                {label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                {selectedSimilarityCollection && similarityMode === 'dino' && (
                                                    !selectedSimilarityCollection.compatible || selectedSimilarityCollection.count === 0
                                                ) && (
                                                    <div style={{ marginBottom: 9, color: '#ff8a80' }}>
                                                        {selectedSimilarityCollection.compatibility_reason
                                                            || (language === 'zh' ? '所选版本暂无可检索向量' : 'The selected version has no searchable vectors')}
                                                    </div>
                                                )}
                                                {selectedSimilarityCollection && similarityMode === 'l2g' && (
                                                    <div style={{
                                                        marginBottom: 9,
                                                        color: selectedSimilarityDatasetJob?.dataset_id ? '#7fcf9a' : '#ff8a80',
                                                    }}>
                                                        {selectedSimilarityDatasetJob?.dataset_id
                                                            ? (language === 'zh' ? '高精度检索数据已就绪' : 'High-precision search dataset is ready')
                                                            : (language === 'zh' ? '所选版本暂无高精度检索数据' : 'No high-precision search data for the selected version')}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'flex-end',
                                        gap: 6,
                                        padding: '8px 10px',
                                        borderTop: '1px solid #555',
                                    }}>
                                        <button
                                            type='button'
                                            onClick={() => setShowSimilarityConfig(false)}
                                            style={{
                                                height: 26,
                                                padding: '0 12px',
                                                border: '1px solid #555',
                                                borderRadius: 3,
                                                background: '#333',
                                                color: '#ccc',
                                                cursor: 'pointer',
                                                fontSize: 11,
                                            }}
                                        >
                                            {language === 'zh' ? '取消' : 'Cancel'}
                                        </button>
                                        <button
                                            type='button'
                                            disabled={similarityOptionsLoading || !!similarityOptionsError || !similarityConfigCanSave}
                                            onClick={saveSimilarityConfig}
                                            style={{
                                                height: 26,
                                                padding: '0 12px',
                                                border: '1px solid #b71c1c',
                                                borderRadius: 3,
                                                background: similarityOptionsLoading || !!similarityOptionsError || !similarityConfigCanSave ? '#4a2b2b' : '#c62828',
                                                color: similarityOptionsLoading || !!similarityOptionsError || !similarityConfigCanSave ? '#8f7777' : '#fff',
                                                cursor: similarityOptionsLoading || !!similarityOptionsError || !similarityConfigCanSave ? 'not-allowed' : 'pointer',
                                                fontSize: 11,
                                            }}
                                        >
                                            {language === 'zh' ? '保存并勾选' : 'Save and select'}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {modelDropdownEntries.map((e, index) => {
                                        const previousEntry = modelDropdownEntries[index - 1];
                                        const startsModelGroup = index > 0 && e.group === 'models' && previousEntry.group === 'custom';
                                        const isChecked = effectiveSelectedModelNames.includes(e.name);
                                        return (
                                        <React.Fragment key={e.name}>
                                            {startsModelGroup && <div style={{ height: 1, background: '#555' }} />}
                                            <div
                                                onClick={() => {
                                                    const baseSelection = useModelMultiSelect
                                                        ? selectedModelNames
                                                        : activeModelEntry ? [activeModelEntry.name] : [];
                                                    setUseModelMultiSelect(true);
                                                    if (isChecked) {
                                                        setSelectedModelNames(baseSelection.filter(name => name !== e.name));
                                                    } else {
                                                        setSelectedModelNames([...baseSelection, e.name]);
                                                        void switchModel(e.name);
                                                    }
                                                }}
                                                style={{
                                                    padding: '5px 10px',
                                                    fontSize: 11,
                                                    cursor: 'default',
                                                    color: e.name === activeModelName ? '#fff' : '#ccc',
                                                    background: e.name === activeModelName ? '#c62828' : 'transparent',
                                                    whiteSpace: 'nowrap',
                                                }}
                                                onMouseEnter={ev => { if (e.name !== activeModelName) (ev.currentTarget as HTMLDivElement).style.background = '#3a3a3a'; }}
                                                onMouseLeave={ev => { if (e.name !== activeModelName) (ev.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                                            >
                                                <input
                                                    type='checkbox'
                                                    checked={isChecked}
                                                    readOnly
                                                    style={{
                                                        width: 12,
                                                        height: 12,
                                                        margin: '0 6px 0 0',
                                                        verticalAlign: '-2px',
                                                        accentColor: '#c62828',
                                                        pointerEvents: 'none',
                                                    }}
                                                />
                                                {e.label} ({e.name})
                                            </div>
                                        </React.Fragment>
                                        );
                                    })}
                                    <div style={{ height: 1, background: '#555' }} />
                                    <div
                                        title={similarityConfigSummary || (language === 'zh' ? '配置后启用检索相似' : 'Configure before enabling similarity search')}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            padding: '5px 10px',
                                            fontSize: 11,
                                            cursor: 'default',
                                            color: '#ccc',
                                            background: 'transparent',
                                            whiteSpace: 'nowrap',
                                        }}
                                        onMouseEnter={ev => { (ev.currentTarget as HTMLDivElement).style.background = '#3a3a3a'; }}
                                        onMouseLeave={ev => { (ev.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                                    >
                                        <label
                                            style={{
                                                display: 'flex',
                                                flex: 1,
                                                alignItems: 'center',
                                                minWidth: 0,
                                                cursor: similaritySearchConfig ? 'pointer' : 'not-allowed',
                                            }}
                                        >
                                            <input
                                                type='checkbox'
                                                checked={similaritySearchSelected}
                                                disabled={!similaritySearchConfig}
                                                onChange={() => {
                                                    if (!similaritySearchConfig) return;
                                                    if (!useModelMultiSelect) {
                                                        setSelectedModelNames(activeModelEntry ? [activeModelEntry.name] : []);
                                                    }
                                                    setUseModelMultiSelect(true);
                                                    setSimilaritySearchSelected(current => !current);
                                                }}
                                                style={{
                                                    width: 12,
                                                    height: 12,
                                                    margin: '0 6px 0 0',
                                                    accentColor: '#c62828',
                                                }}
                                            />
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {language === 'zh' ? '检索相似' : 'Similarity Search'}
                                                {similaritySearchConfig && (
                                                    <>
                                                        {' ('}{similarityConfigSummary}{')'}
                                                    </>
                                                )}
                                            </span>
                                        </label>
                                        <button
                                            type='button'
                                            onClick={openSimilarityConfig}
                                            title={language === 'zh' ? '配置检索方案' : 'Configure retrieval plan'}
                                            style={{
                                                marginLeft: 8,
                                                padding: '2px 4px',
                                                border: 0,
                                                background: 'transparent',
                                                color: '#aaa',
                                                cursor: 'pointer',
                                                fontSize: 10,
                                                lineHeight: 1,
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {language === 'zh' ? '配置' : 'Configure'} ⚙
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
                <button
                    disabled={imagesData.length === 0 || (useModelMultiSelect && selectedOptionCount === 0)}
                    onClick={() => {
                        if (isFullImageInferenceInProgress) {
                            multiInferenceCancelledRef.current = true;
                            updateFullImageInferenceStatus(false);
                        } else {
                            void runInference('detection');
                        }
                    }}
                    style={{
                        background: isFullImageInferenceInProgress ? '#c62828' : '#333',
                        color: imagesData.length === 0 || (useModelMultiSelect && selectedOptionCount === 0)
                            ? '#666'
                            : isFullImageInferenceInProgress ? '#fff' : '#ccc',
                        border: '1px solid #555',
                        borderRadius: 4,
                        height: 22,
                        lineHeight: '16px',
                        padding: '0 10px',
                        fontSize: 11,
                        cursor: imagesData.length === 0 || (useModelMultiSelect && selectedOptionCount === 0)
                            ? 'not-allowed'
                            : 'pointer',
                        whiteSpace: 'nowrap',
                        boxSizing: 'border-box',
                    }}
                >
                    {isFullImageInferenceInProgress
                        ? (language === 'zh' ? '停止' : 'Stop')
                        : (() => {
                            const label = trackingMode
                                ? (language === 'zh' ? '检索' : 'Retrieve')
                                : (language === 'zh' ? '推理' : 'Infer');
                            // 时间轴选区优先显示帧数
                            if (timelineRange) {
                                const rangeCount = timelineRange.endFrame - timelineRange.startFrame + 1;
                                return `${label} x${rangeCount}${language === 'zh' ? '帧' : 'f'}`;
                            }
                            const selected = imagesData.filter((img: ImageData) => img.isSelected);
                            const count = selected.length > 1 ? selected.length : imagesData.length > 0 ? 1 : 0;
                            return count > 1 ? `${label} x${count}` : label;
                        })()}
                </button>
            </div>
            {withAI && <div className='ButtonWrapper'>
                    {
                        getButtonWithTooltip(
                            'accept-all',
                            currentTexts.editorTopNavBar.acceptAllDetections,
                            'ico/accept-all.png',
                            'accept-all',
                            false,
                            undefined,
                            () => AIActions.acceptAllSuggestedLabels(LabelsSelector.getActiveImageData())
                        )
                    }
                    {
                        getButtonWithTooltip(
                            'reject-all',
                            currentTexts.editorTopNavBar.rejectAllDetections,
                            'ico/reject-all.png',
                            'reject-all',
                            false,
                            undefined,
                            () => AIActions.rejectAllSuggestedLabels(LabelsSelector.getActiveImageData())
                        )
                    }
                </div>}
        </div>
    );
});

const mapDispatchToProps = {
    updateImageDragModeStatusAction: updateImageDragModeStatus,
    updateSmartAnnotationActiveStatusAction: updateSmartAnnotationActiveStatus,
    updateTrackingModeStatusAction: updateTrackingModeStatus,
    updateActivePopupTypeAction: updateActivePopupType,
    updateFullImageInferenceStatus,
    toggleImageAILabelsVisibility,
    toggleImageSegmentationLabelsVisibility,
    addInferenceHistory,
    updateActiveLabelType,
    updateActiveLabelViewType,
    updateEraserModeAction: updateEraserMode,
    updateSamNegativeModeAction: updateSamNegativeMode,
};

const mapStateToProps = (state: AppState) => ({
    activeContext: state.general.activeContext,
    imageDragMode: state.general.imageDragMode,
    smartAnnotationActive: state.general.smartAnnotationActive,
    samNegativeMode: state.general.samNegativeMode ?? false,
    trackingMode: state.general.trackingMode ?? false,
    trackingInProgress: state.general.trackingInProgress ?? false,
    eraserMode: state.general.eraserMode ?? false,
    eraserFineMode: state.general.eraserFineMode ?? false,
    isFullImageInferenceInProgress: state.ai.isFullImageInferenceInProgress,
    imageAIStates: state.ai.imageAIStates,
    activeLabelType: state.labels.activeLabelType,
    activeLabelViewType: state.labels.activeLabelViewType,
    language: state.general.language,
    isAIDisabled: state.ai.isAIDisabled,
    activeImageIndex: state.labels.activeImageIndex,
    imagesData: state.labels.imagesData,
    hasDetectionModel: AIModelsSelector.hasModelsOfType(state, 'core') || DetectionAPIDetector.isEnabled(),
    hasExtensionEngine: AIModelsSelector.hasModelsOfType(state, 'extension'),
    modelInspectorBackendKey: [
        state.aimodels.activeModelId || '',
        ...state.aimodels.models
            .filter(model => model.modelType === 'core' || model.modelType === 'extension')
            .map(model => `${model.id}:${model.url}:${model.isActive}`),
    ].join('|'),
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditorTopNavigationBar);
