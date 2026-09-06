import React, {useState, useEffect} from 'react';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import './CallModelPopup.scss'
import {updateActivePopupType as storeUpdateActivePopupType} from '../../../store/general/actionCreators';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {GeneralActionTypes} from '../../../store/general/types';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {AIModel} from '../../../store/aimodels/types';
import {getDefaultCoreServiceBase, resolveEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import {getHostSystem, showsTensorRTPlaceholder, supportsCoreML} from '../../../utils/HostSystem';
import PipelineCanvas from './PipelineCanvas';

export interface YOLOModelFamily {
    id: string;
    name: string;
    variants: string[];
    defaultVariant?: string;
}

export const YOLO_MODEL_FAMILIES: YOLOModelFamily[] = [
    { id: 'yolo26', name: 'ultralytics/yolo26', variants: ['yolo26n', 'yolo26s', 'yolo26m', 'yolo26l', 'yolo26x'], defaultVariant: 'yolo26x' },
    { id: 'yolo12', name: 'ultralytics/yolo12', variants: ['yolo12n', 'yolo12s', 'yolo12m', 'yolo12l', 'yolo12x'] },
    { id: 'yolo11', name: 'ultralytics/yolo11', variants: ['yolo11n', 'yolo11s', 'yolo11m', 'yolo11l', 'yolo11x'] },
    { id: 'yolov10', name: 'ultralytics/yolov10', variants: ['yolov10n', 'yolov10s', 'yolov10m', 'yolov10l', 'yolov10x'] },
    { id: 'yolov9', name: 'ultralytics/yolov9', variants: ['yolov9t', 'yolov9s', 'yolov9m', 'yolov9c', 'yolov9e'] },
    { id: 'yolov8', name: 'ultralytics/yolov8', variants: ['yolov8n', 'yolov8s', 'yolov8m', 'yolov8l', 'yolov8x'] },
];

export const SEG_MODEL_FAMILIES: YOLOModelFamily[] = [
    { id: 'yolov8-seg', name: 'ultralytics/yolov8-seg', variants: ['yolov8n-seg', 'yolov8s-seg', 'yolov8m-seg', 'yolov8l-seg', 'yolov8x-seg'] },
    { id: 'yolo11-seg', name: 'ultralytics/yolo11-seg', variants: ['yolo11n-seg', 'yolo11s-seg', 'yolo11m-seg', 'yolo11l-seg', 'yolo11x-seg'] },
    { id: 'sam', name: 'ultralytics/SAM', variants: ['sam_b', 'sam_l'] },
    { id: 'sam2', name: 'ultralytics/SAM 2', variants: ['sam2_t', 'sam2_s', 'sam2_b', 'sam2_l', 'sam2.1_t', 'sam2.1_s', 'sam2.1_b', 'sam2.1_l'], defaultVariant: 'sam2.1_b' },
    { id: 'sam3', name: 'ultralytics/SAM 3', variants: ['sam3', 'sam3.1_multiplex'], defaultVariant: 'sam3.1_multiplex' },
    { id: 'mobile-sam', name: 'ultralytics/MobileSAM', variants: ['mobile_sam'] },
    { id: 'fast-sam', name: 'ultralytics/FastSAM', variants: ['FastSAM-s', 'FastSAM-x'] },
];

// Module-level state shared between CallModelPopup and LoadDetectionModelPopup
let _selectedModelFamily: YOLOModelFamily | null = null;
// 默认跟随浏览器当前 host —— 跨机访问时直接打到前端所在机器的 :8000
let _serverUrl: string = getDefaultCoreServiceBase();
let _selectedCustomExt: 'pt' | 'onnx' | 'mlpackage' | null = null;

export const getSelectedModelFamily = (): YOLOModelFamily | null => _selectedModelFamily;
export const getServerUrl = (): string => _serverUrl;
export const getSelectedCustomExt = (): 'pt' | 'onnx' | 'mlpackage' | null => _selectedCustomExt;

interface IProps {
    updateActivePopupType: (activePopupType: PopupWindowType) => GeneralActionTypes;
    language: Language;
    // 用户通过「模型引擎」popup 注册的推理服务列表。由 Redux aimodels store 提供。
    aiModels: AIModel[];
    activeAIModelId: string | null;
}

export const CallModelPopup: React.FC<IProps> = ({
    updateActivePopupType,
    language,
    aiModels,
    activeAIModelId,
}) => {
    const currentTexts = LanguageConfig[language];
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const [availableModels, setAvailableModels] = useState<string[]>([]);
    // 后端同时在内存中的所有模型（多模型共存）
    const [loadedModels, setLoadedModels] = useState<string[]>([]);

    // 推理基础地址从已注册的引擎推导 —— 不再让用户在这个弹窗里填 URL。
    // Only the core engine owns inference capabilities. An active extension
    // engine must never receive detection/model-management requests.
    const coreEngines = aiModels.filter(model => model.modelType === 'core');
    const activeEngine = coreEngines.find(model => model.id === activeAIModelId)
        || coreEngines.find(model => model.isActive)
        || coreEngines[0]
        || null;
    const derivedBaseUrl = activeEngine
        ? resolveEngineBaseUrl(activeEngine.url, 'core')
        : getDefaultCoreServiceBase();

    const refreshHealth = () => {
        fetch(`${derivedBaseUrl}/health`)
            .then(r => r.json())
            .then(data => {
                if (data.loaded_models) setLoadedModels(data.loaded_models);
            })
            .catch(() => { /* Optional health refresh; engine may be offline. */ });
    };

    useEffect(() => {
        fetch(`${derivedBaseUrl}/available-models`)
            .then(r => r.json())
            .then(data => {
                if (!data.models) return;
                const names: string[] = data.models.map((m: unknown) =>
                    typeof m === 'string' ? m : (m as { name: string }).name
                );
                setAvailableModels(names);
            })
            .catch(() => { /* Optional catalog refresh; engine may be offline. */ });
        refreshHealth();
        const onModelLoaded = () => refreshHealth();
        window.addEventListener('opensight:model-loaded', onModelLoaded);
        return () => window.removeEventListener('opensight:model-loaded', onModelLoaded);
    }, [derivedBaseUrl]);

    const getDownloadedCount = (family: YOLOModelFamily): number => {
        return family.variants.filter(v => availableModels.includes(v)).length;
    };

    const onSelect = (id: string) => {
        setSelectedId(selectedId === id ? null : id);
    };

    const onAccept = () => {
        if (selectedId === 'ocr') {
            updateActivePopupType(PopupWindowType.OCR);
            return;
        }
        // 自定义 .pt / .onnx / .mlpackage 上传 —— 统一进二级页 LoadDetectionModelPopup
        if (selectedId === 'custom-pt' || selectedId === 'custom-onnx' || selectedId === 'custom-mlpackage') {
            _selectedModelFamily = null;
            _serverUrl = derivedBaseUrl;
            _selectedCustomExt = selectedId === 'custom-onnx' ? 'onnx'
                : selectedId === 'custom-mlpackage' ? 'mlpackage' : 'pt';
            updateActivePopupType(PopupWindowType.LOAD_DETECTION_MODEL);
            return;
        }
        // 本地内置 YOLO / SAM family —— 推送到 LoadDetectionModelPopup 走加载流程
        const family = YOLO_MODEL_FAMILIES.find(f => f.id === selectedId)
            || SEG_MODEL_FAMILIES.find(f => f.id === selectedId);
        if (!family) return;
        _selectedModelFamily = family;
        _serverUrl = derivedBaseUrl;
        _selectedCustomExt = null;
        updateActivePopupType(PopupWindowType.LOAD_DETECTION_MODEL);
    };

    const onReject = () => {
        PopupActions.close();
    };

    // 找出该 family 中所有已加载（在内存中）的模型
    const getActiveVariants = (family: YOLOModelFamily): string[] => {
        return loadedModels.filter(m => {
            const baseName = m.replace(/\.(pt|onnx)$/i, '');
            return family.variants.includes(baseName);
        });
    };

    const renderFamilyOption = (family: YOLOModelFamily) => {
        const isSelected = selectedId === family.id;
        const downloaded = getDownloadedCount(family);
        const total = family.variants.length;
        const activeVariants = getActiveVariants(family);
        const isActive = activeVariants.length > 0;
        return <div
            className={`OptionsItem${downloaded > 0 ? ' has-models' : ''}${isActive ? ' active-model' : ''}`}
            onClick={() => onSelect(family.id)}
            key={family.id}
        >
            <img
                draggable={false}
                src={isSelected ? 'ico/checkbox-checked.png' : 'ico/checkbox-unchecked.png'}
                alt={isSelected ? 'checked' : 'unchecked'}
            />
            {family.name}
            {downloaded > 0 && <span className='model-count'> ({downloaded}/{total})</span>}
            {activeVariants.map(v => <span key={v} className='active-badge'>✓ {v.replace(/\.(pt|onnx)$/i, '')}</span>)}
        </div>
    };

    const hasCoreEngine = coreEngines.length > 0;

    const zhTexts = language === Language.CHINESE;
    const hostSystem = getHostSystem();
    const canUseCoreML = supportsCoreML(hostSystem);
    const showTensorRT = showsTensorRTPlaceholder(hostSystem);
    const hostSystemLabel = hostSystem === 'macos'
        ? 'macOS'
        : hostSystem === 'windows'
            ? 'Windows'
            : hostSystem === 'linux'
                ? 'Linux'
                : (zhTexts ? '未知系统' : 'Unknown system');

    // 从 loadedModels 中找出所有自定义模型（不属于任何内置 family）
    const allBuiltinVariants = [
        ...YOLO_MODEL_FAMILIES.flatMap(f => f.variants),
        ...SEG_MODEL_FAMILIES.flatMap(f => f.variants),
    ];
    const customLoadedModels = loadedModels.filter(name => {
        const baseName = name.replace(/\.(pt|onnx|mlpackage|mlmodel)$/i, '');
        return !allBuiltinVariants.includes(baseName);
    });
    const isCoremlName = (n: string) => /\.(mlpackage|mlmodel)$/i.test(n);
    const customOnnxModels = customLoadedModels.filter(n => n.toLowerCase().endsWith('.onnx'));
    const customMlpkgModels = customLoadedModels.filter(isCoremlName);
    // 其余（既非 .onnx 也非 CoreML）才算 .pt —— 避免 .mlpackage 误挂到 .pt 行
    const customPtModels = customLoadedModels.filter(n => !n.toLowerCase().endsWith('.onnx') && !isCoremlName(n));

    // .mlpackage 行 —— 和 .pt/.onnx 一样的勾选行；点「进入」跳二级页 LoadDetectionModelPopup 拖拽上传
    const renderMlpackageRow = () => (
        <div
            className={`OptionsItem${customMlpkgModels.length > 0 ? ' has-models active-model' : ''}`}
            onClick={() => onSelect('custom-mlpackage')}
        >
            <img
                draggable={false}
                src={selectedId === 'custom-mlpackage' ? 'ico/checkbox-checked.png' : 'ico/checkbox-unchecked.png'}
                alt={selectedId === 'custom-mlpackage' ? 'checked' : 'unchecked'}
            />
            {zhTexts ? '模型 .mlpackage 文件（CoreML / ANE）' : '.mlpackage model file (CoreML / ANE)'}
            {customMlpkgModels.map(n => <span key={n} className='active-badge'>✓ {n}</span>)}
        </div>
    );

    const renderPlatformSpecificCustomRow = () => {
        if (canUseCoreML) return renderMlpackageRow();
        if (!showTensorRT) return null;
        return (
            <div className='OptionsItem disabled'>
                <img draggable={false} src={'ico/checkbox-unchecked.png'} alt={'unchecked'} />
                {zhTexts ? '模型 .engine / .trt 文件（即将推出）' : '.engine / .trt model file (coming soon)'}
            </div>
        );
    };

    // Existing model-family rendering intentionally keeps all platform branches together.
    // eslint-disable-next-line complexity
    const renderContent = () => {
        return <div className='CallModelPopupContent'>
            <div className='ModelSection'>
                <div className='SectionHeader'>{zhTexts ? '推理流程' : 'Pipeline'}</div>
                <PipelineCanvas zh={zhTexts} onOpenPopup={updateActivePopupType} />
            </div>
            {hasCoreEngine && (
                <div className='ModelSection'>
                    <div className='SectionHeader'>{zhTexts ? '推理能力' : 'Inference Capabilities'}</div>
                    <div className='Options'>
                        <div className='OptionsItem' onClick={() => onSelect('ocr')}>
                            <img
                                draggable={false}
                                src={selectedId === 'ocr' ? 'ico/checkbox-checked.png' : 'ico/checkbox-unchecked.png'}
                                alt={selectedId === 'ocr' ? 'checked' : 'unchecked'}
                            />
                            {zhTexts ? '文字识别 OCR' : 'Text Recognition OCR'}
                        </div>
                    </div>
                </div>
            )}
            <div className='ModelSection'>
                <div className='SectionHeader CustomSectionHeader'>
                    <span>{zhTexts ? '自定义' : 'Custom'}</span>
                    <span className='HostSystemBadge'>{hostSystemLabel}</span>
                </div>
                <div className='Options'>
                    <div
                        className={`OptionsItem${customPtModels.length > 0 ? ' has-models active-model' : ''}`}
                        onClick={() => onSelect('custom-pt')}
                    >
                        <img
                            draggable={false}
                            src={selectedId === 'custom-pt' ? 'ico/checkbox-checked.png' : 'ico/checkbox-unchecked.png'}
                            alt={selectedId === 'custom-pt' ? 'checked' : 'unchecked'}
                        />
                        {zhTexts ? '模型 .pt 文件' : '.pt model file'}
                        {customPtModels.map(n => <span key={n} className='active-badge'>✓ {n}</span>)}
                    </div>
                    <div
                        className={`OptionsItem${customOnnxModels.length > 0 ? ' has-models active-model' : ''}`}
                        onClick={() => onSelect('custom-onnx')}
                    >
                        <img
                            draggable={false}
                            src={selectedId === 'custom-onnx' ? 'ico/checkbox-checked.png' : 'ico/checkbox-unchecked.png'}
                            alt={selectedId === 'custom-onnx' ? 'checked' : 'unchecked'}
                        />
                        {zhTexts ? '模型 .onnx 文件' : '.onnx model file'}
                        {customOnnxModels.map(n => <span key={n} className='active-badge'>✓ {n}</span>)}
                    </div>
                    {renderPlatformSpecificCustomRow()}
                </div>
            </div>
            {hasCoreEngine && (
                <div className='ModelSection'>
                    <div className='SectionHeader'>{zhTexts ? '检测模型' : 'Detection Models'}</div>
                    <div className='Options'>
                        {YOLO_MODEL_FAMILIES.map(f => renderFamilyOption(f))}
                    </div>
                </div>
            )}
            {hasCoreEngine && (
                <div className='ModelSection'>
                    <div className='SectionHeader'>{zhTexts ? '分割模型' : 'Segmentation Models'}</div>
                    <div className='Options'>
                        {SEG_MODEL_FAMILIES.map(f => renderFamilyOption(f))}
                    </div>
                </div>
            )}
        </div>
    };

    const acceptDisabled = !selectedId;

    return (
        <GenericYesNoPopup
            title={currentTexts.popups.callModel.title}
            renderContent={renderContent}
            acceptLabel={currentTexts.popups.callModel.acceptButton}
            onAccept={onAccept}
            disableAcceptButton={acceptDisabled}
            rejectLabel={currentTexts.popups.callModel.rejectButton}
            onReject={onReject}
        />
    );
};

const mapDispatchToProps = {
    updateActivePopupType: storeUpdateActivePopupType,
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
    aiModels: state.aimodels.models,
    activeAIModelId: state.aimodels.activeModelId,
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CallModelPopup);
