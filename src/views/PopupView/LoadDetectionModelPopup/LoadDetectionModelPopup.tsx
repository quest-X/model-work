import React, {useState, useEffect} from 'react';
import './LoadDetectionModelPopup.scss'
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {ImageButton} from '../../Common/ImageButton/ImageButton';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {GeneralActionTypes} from '../../../store/general/types';
import {updateActivePopupType} from '../../../store/general/actionCreators';
import {submitNewNotification} from '../../../store/notifications/actionCreators';
import {INotification, NotificationsActionType} from '../../../store/notifications/types';
import {NotificationUtil} from '../../../utils/NotificationUtil';
import {NotificationsDataMap} from '../../../data/info/NotificationsData';
import {Notification} from '../../../data/enums/Notification';
import {CSSHelper} from '../../../logic/helpers/CSSHelper';
import {ClipLoader} from 'react-spinners';
import {useDropzone} from 'react-dropzone';
import {DetectionAPIDetector} from '../../../ai/DetectionAPIDetector';
import {SegmentationAPIDetector} from '../../../ai/SegmentationAPIDetector';
import {EditorModel} from '../../../staticModels/EditorModel';
import {getSelectedCustomExt, getSelectedModelFamily, getServerUrl, SEG_MODEL_FAMILIES} from '../CallModelPopup/CallModelPopup';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {inferModelTaskFromName} from '../../../utils/ModelTaskUtil';

enum ModelSource {
    UPLOAD = 'UPLOAD',
    OFFICIAL = 'OFFICIAL'
}

const VARIANT_LABELS: Record<string, string> = {
    'n': 'Nano', 's': 'Small', 'm': 'Medium', 'l': 'Large', 'x': 'Extra Large',
    't': 'Tiny', 'c': 'Compact', 'e': 'Extended'
};

function getVariantLabel(variant: string): string {
    const suffix = variant.replace(/^.*?(\w)$/, '$1');
    return VARIANT_LABELS[suffix] || suffix.toUpperCase();
}

interface IProps {
    updateActivePopupTypeAction: (activePopupType: PopupWindowType) => GeneralActionTypes;
    submitNewNotificationAction: (notification: INotification) => NotificationsActionType;
    language: Language;
}

export const LoadDetectionModelPopup: React.FC<IProps> = ({ updateActivePopupTypeAction, submitNewNotificationAction, language }) => {
    const texts = LanguageConfig[language];
    const modelFamily = getSelectedModelFamily();
    const serverUrl = getServerUrl();
    const customExt = getSelectedCustomExt() || 'pt';   // 'pt' | 'onnx' | 'mlpackage', defaults to .pt
    const customExtDot = `.${customExt}`;
    const isMlpackage = customExt === 'mlpackage';
    const variants = modelFamily?.variants || [];
    const isSegModel = modelFamily && SEG_MODEL_FAMILIES.some(f => f.id === modelFamily.id);

    const [modelSource, setModelSource] = useState(modelFamily ? ModelSource.OFFICIAL : ModelSource.UPLOAD);
    const [selectedVariant, setSelectedVariant] = useState(modelFamily?.defaultVariant || variants[0] || '');
    const [isLoading, setIsLoading] = useState(false);
    const [loadProgress, setLoadProgress] = useState(0);
    const [loadState, setLoadState] = useState('');
    const [modelFile, setModelFile] = useState<File | null>(null);
    // .mlpackage 是目录包，拖进来会递归出一堆文件 —— 单独存（文件列表 + 包名）
    const [mlpkgFiles, setMlpkgFiles] = useState<File[]>([]);
    const [mlpkgName, setMlpkgName] = useState<string>('');
    const [loadedModel, setLoadedModel] = useState<string>('');
    const [downloadedModels, setDownloadedModels] = useState<string[]>([]);

    useEffect(() => {
        fetch(`${serverUrl}/health`).then(r => r.json())
            .then(data => { if (data.model) setLoadedModel(data.model.replace(/\.(pt|onnx)$/, '')); })
            .catch(() => undefined);
        fetch(`${serverUrl}/available-models`).then(r => r.json())
            .then(data => {
                if (data.models) setDownloadedModels(data.models.map((m: unknown) =>
                    typeof m === 'string' ? m : (m as { name: string }).name
                ));
            })
            .catch(() => undefined);
    }, [serverUrl]);

    const pollLoadStatus = (): Promise<void> => {
        return new Promise((resolve, reject) => {
            const interval = setInterval(async () => {
                try {
                    const service = isSegModel ? 'segmentation' : 'detection';
                    const res = await fetch(`${serverUrl}/load-status?service=${service}`);
                    if (!res.ok) throw new Error(`${res.status}`);
                    const data = await res.json();
                    setLoadProgress(data.progress || 0);
                    setLoadState(data.state || '');
                    if (data.state === 'ready') {
                        clearInterval(interval);
                        setLoadedModel(data.model?.replace(/\.(pt|onnx)$/, '') || '');
                        resolve();
                    } else if (['error', 'missing_dep', 'not_loaded'].includes(data.state)) {
                        clearInterval(interval);
                        reject(new Error(data.error || texts.loadYoloModel.loadFailed));
                    }
                } catch {
                    clearInterval(interval);
                    reject(new Error(texts.loadYoloModel.connectionFailed));
                }
            }, 500);
        });
    };

    // 拖进来的可能是 .mlpackage 本身或它的父目录 —— 把相对路径重锚到 *.mlpackage 段
    const reRootToMlpackage = (relPath: string): string | null => {
        const parts = relPath.split('/');
        const idx = parts.findIndex(p => /\.mlpackage$/i.test(p));
        return idx < 0 ? null : parts.slice(idx).join('/');
    };

    const onDrop = (accepted: File[]) => {
        if (isMlpackage) {
            const roots = new Set<string>();
            const kept: File[] = [];
            for (const f of accepted) {
                const meta = f as File & {path?: string; webkitRelativePath?: string};
                const rel = reRootToMlpackage(meta.path || meta.webkitRelativePath || f.name);
                if (!rel) continue;
                roots.add(rel.split('/')[0]);
                kept.push(f);
            }
            if (kept.length > 0 && roots.size === 1) {
                setMlpkgFiles(kept);
                setMlpkgName([...roots][0]);
            }
            return;
        }
        const modelFiles = accepted.filter((f: File) => f.name.toLowerCase().endsWith(customExtDot));
        if (modelFiles.length > 0) {
            setModelFile(modelFiles[0]);
        }
    };

    const {getRootProps, getInputProps} = useDropzone(
        // .mlpackage：不能点选(选不中包)、不设 accept(否则包内文件被过滤)，只走拖拽
        isMlpackage
            ? {onDrop, noClick: true}
            : {onDrop, accept: {'application/octet-stream': [customExtDot]}}
    );

    const triggerDetection = () => {
        const baseUrl = serverUrl.replace(/\/+$/, '');
        if (isSegModel) {
            SegmentationAPIDetector.setConfig({ url: baseUrl + '/segment', enabled: true });
            EditorModel.lastLoadedModelService = 'segmentation';
        } else {
            DetectionAPIDetector.setConfig({ url: baseUrl + '/detect', enabled: true });
            EditorModel.lastLoadedModelService = 'detection';
        }
        window.dispatchEvent(new CustomEvent('opensight:model-loaded'));
        PopupActions.close();
    };

    // .mlpackage 目录包上传：把拖进来的所有文件按相对路径打包，POST /upload-mlpackage
    const doMlpackageUpload = async () => {
        if (mlpkgFiles.length === 0) { setIsLoading(false); setLoadState(''); return; }
        const formData = new FormData();
        for (const f of mlpkgFiles) {
            const meta = f as File & {path?: string; webkitRelativePath?: string};
            const rel = reRootToMlpackage(meta.path || meta.webkitRelativePath || f.name);
            if (rel) formData.append('files', f, rel);  // 第三参 = 相对路径
        }
        try {
            setLoadProgress(30);
            const res = await fetch(`${serverUrl}/upload-mlpackage`, { method: 'POST', body: formData });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.detail || res.statusText);
            }
            setLoadProgress(100);
            const data = await res.json().catch(() => ({}));
            const baseUrl = serverUrl.replace(/\/+$/, '');
            const uploadedService = data.service || (
                inferModelTaskFromName(mlpkgName) === 'segment' ? 'segmentation' : 'detection'
            );
            if (uploadedService === 'segmentation') {
                SegmentationAPIDetector.setConfig({ url: baseUrl + '/segment', enabled: true });
                EditorModel.lastLoadedModelService = 'segmentation';
            } else {
                DetectionAPIDetector.setConfig({ url: baseUrl + '/detect', enabled: true });
                EditorModel.lastLoadedModelService = 'detection';
            }
            window.dispatchEvent(new CustomEvent('opensight:model-loaded'));
            PopupActions.close();
        } catch (e) {
            setIsLoading(false);
            setLoadState('');
            const base = NotificationsDataMap[Notification.MODEL_LOAD_ERROR];
            const errMsg = (e as Error)?.message?.trim();
            submitNewNotificationAction(NotificationUtil.createErrorNotification({
                header: base.header,
                description: errMsg || base.description,
            }));
        }
    };

    const doOfficialLoad = async () => {
        try {
            const res = await fetch(`${serverUrl}/load-model`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: `${selectedVariant}.pt`,
                    service: modelFamily && SEG_MODEL_FAMILIES.some(f => f.id === modelFamily.id) ? 'segmentation' : 'detection'
                })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.detail || res.statusText);
            }
            await pollLoadStatus();
            triggerDetection();
        } catch (e) {
            setIsLoading(false);
            setLoadState('');
            // 优先显示后端真实错误（torch / 文件损坏 / 网络下载失败），兜底才用通用文案。
            const base = NotificationsDataMap[Notification.MODEL_DOWNLOAD_ERROR];
            const errMsg = (e as Error)?.message?.trim();
            submitNewNotificationAction(NotificationUtil.createErrorNotification({
                header: base.header,
                description: errMsg || base.description,
            }));
        }
    };

    const doSingleFileUpload = async () => {
        if (!modelFile) return;
        const formData = new FormData();
        formData.append('file', modelFile);
        try {
            setLoadProgress(30);
            const res = await fetch(`${serverUrl}/upload`, { method: 'POST', body: formData });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.detail || res.statusText);
            }
            setLoadProgress(100);
            // 新后端返回权威 service；旧后端按统一文件名 token 规则兜底。
            const data = await res.json().catch(() => ({}));
            const uploadedService = data.service || (
                inferModelTaskFromName(modelFile.name) === 'segment' ? 'segmentation' : 'detection'
            );
            const baseUrl = serverUrl.replace(/\/+$/, '');
            if (uploadedService === 'segmentation') {
                SegmentationAPIDetector.setConfig({ url: baseUrl + '/segment', enabled: true });
                EditorModel.lastLoadedModelService = 'segmentation';
            } else {
                DetectionAPIDetector.setConfig({ url: baseUrl + '/detect', enabled: true });
                EditorModel.lastLoadedModelService = 'detection';
            }
            window.dispatchEvent(new CustomEvent('opensight:model-loaded'));
            PopupActions.close();
        } catch (e) {
            setIsLoading(false);
            setLoadState('');
            const base = NotificationsDataMap[Notification.MODEL_LOAD_ERROR];
            const errMsg = (e as Error)?.message?.trim();
            submitNewNotificationAction(NotificationUtil.createErrorNotification({
                header: base.header,
                description: errMsg || base.description,
            }));
        }
    };

    const onAccept = async () => {
        setIsLoading(true);
        setLoadProgress(0);
        setLoadState('downloading');
        if (isMlpackage) { await doMlpackageUpload(); return; }
        if (modelSource === ModelSource.OFFICIAL) { await doOfficialLoad(); return; }
        await doSingleFileUpload();
    };

    const onReject = () => {
        updateActivePopupTypeAction(PopupWindowType.CALL_MODEL);
    };

    const changeModelSource = (source: ModelSource) => {
        setModelSource(source);
        setModelFile(null);
    };

    // RENDER

    const renderMenu = () => {
        return(<div className='left-container'>
            {!modelFamily && <ImageButton
                image={'ico/upload.png'}
                imageAlt={'upload custom model'}
                buttonSize={{ width: 40, height: 40 }}
                padding={15}
                onClick={() => changeModelSource(ModelSource.UPLOAD)}
                externalClassName={'monochrome'}
                isActive={modelSource === ModelSource.UPLOAD}
            />}
            {!!modelFamily && <ImageButton
                image={'ico/download.png'}
                imageAlt={'official models'}
                buttonSize={{ width: 40, height: 40 }}
                padding={15}
                onClick={() => changeModelSource(ModelSource.OFFICIAL)}
                externalClassName={'monochrome'}
                isActive={modelSource === ModelSource.OFFICIAL}
            />}
        </div>)
    };

    const renderOptions = () => {
        return(<div className='options'>
            {variants.map((variant) => {
                const isActive = loadedModel === variant;
                const isDownloaded = downloadedModels.includes(variant);
                const classes = `options-item${isActive ? ' active' : isDownloaded ? ' downloaded' : ''}`;
                return (
                    <div
                        className={classes}
                        onClick={() => setSelectedVariant(variant)}
                        key={variant}
                    >
                        <img
                            draggable={false}
                            src={variant === selectedVariant ? 'ico/checkbox-checked.png' : 'ico/checkbox-unchecked.png'}
                            alt={variant === selectedVariant ? 'checked' : 'unchecked'}
                        />
                        <span className='variant-name'>{variant} ({getVariantLabel(variant)})</span>
                        {isActive && <span className='status-badge active-badge'>{texts.loadYoloModel.active}</span>}
                        {!isActive && isDownloaded && <span className='status-badge downloaded-badge'>{texts.loadYoloModel.downloaded}</span>}
                    </div>
                );
            })}
        </div>)
    };

    const renderMessage = () => {
        const uploadMessage = texts.loadYoloModel.uploadMessage.replace('{ext}', customExtDot);
        const officialMessage = texts.loadYoloModel.officialMessage.replace('{name}', modelFamily?.name || 'YOLO');
        return(<div className='message'>
            {modelSource === ModelSource.OFFICIAL ? officialMessage : uploadMessage}
        </div>)
    };

    const stateLabels: Record<string, string> = {
        downloading: texts.loadYoloModel.downloading,
        loading: texts.loadYoloModel.loading,
        ready: texts.loadYoloModel.ready,
        error: texts.loadYoloModel.errorState,
    };

    const renderLoader = () => {
        return(<div className='loader'>
            <ClipLoader
                size={40}
                color={CSSHelper.getLeadingColor()}
                loading={true}
            />
            <div className='progress-info'>
                <p className='progress-text'>{stateLabels[loadState] || texts.loadYoloModel.preparing} {loadProgress}%</p>
                <div className='progress-bar'>
                    <div className='progress-fill' style={{ width: `${loadProgress}%` }} />
                </div>
            </div>
        </div>)
    };

    const renderMlpackageDropZone = () => {
        const has = mlpkgFiles.length > 0;
        const zh = language === Language.CHINESE;
        return(<div {...getRootProps({ className: 'drop-zone' })}>
            <input {...getInputProps()} />
            <img draggable={false} alt={has ? 'uploaded' : 'upload'} src={has ? 'ico/box-closed.png' : 'ico/box-opened.png'} />
            {has ? <>
                <p className='extraBold'>{mlpkgName}</p>
                <p>{mlpkgFiles.length} {zh ? '个文件' : 'files'}</p>
            </> : <>
                <p className='extraBold'>{zh ? '把 .mlpackage 拖到这里' : 'Drag a .mlpackage here'}</p>
                <p>{zh ? '（CoreML · Apple 神经引擎，不能点选、只能拖）' : '(CoreML · Apple Neural Engine — drag only)'}</p>
            </>}
        </div>)
    };

    const renderDropZone = () => {
        if (isMlpackage) return renderMlpackageDropZone();
        const hasFile = modelFile !== null;
        return(<div {...getRootProps({ className: 'drop-zone' })}>
            <input {...getInputProps()} />
            <img
                draggable={false}
                alt={hasFile ? 'uploaded' : 'upload'}
                src={hasFile ? 'ico/box-closed.png' : 'ico/box-opened.png'}
            />
            {hasFile ? <>
                <p className='extraBold'>{modelFile.name}</p>
                <p>{(modelFile.size / 1024 / 1024).toFixed(1)} MB</p>
            </> : <>
                <p className='extraBold'>{texts.loadYoloModel.dragModel.replace('{ext}', customExtDot)}</p>
                <p>{texts.or}</p>
                <p className='extraBold'>{texts.loadYoloModel.clickToSelect}</p>
            </>}
        </div>)
    };

    const renderContent = () => {
        const shouldRenderDropZone = !isLoading && modelSource === ModelSource.UPLOAD;
        const shouldRenderOptions = !isLoading && modelSource === ModelSource.OFFICIAL;
        return (<div className='load-detection-model-popup'>
            {renderMenu()}
            <div className='right-container'>
                {isLoading && renderLoader()}
                {!isLoading && renderMessage()}
                {shouldRenderOptions && renderOptions()}
                {shouldRenderDropZone && renderDropZone()}
            </div>
        </div>);
    };

    const disableAcceptButton = isLoading ||
        (modelSource === ModelSource.UPLOAD && !modelFile) ||
        (modelSource === ModelSource.OFFICIAL && !selectedVariant);

    const title = modelFamily
        ? texts.loadYoloModel.title.replace('{model}', modelFamily.name.split('/')[1]?.toUpperCase() || modelFamily.id)
        : texts.loadYoloModel.titleFallback;

    return (
        <GenericYesNoPopup
            title={title}
            renderContent={renderContent}
            disableAcceptButton={disableAcceptButton}
            acceptLabel={texts.loadYoloModel.acceptLabel}
            onAccept={onAccept}
            rejectLabel={texts.loadYoloModel.rejectLabel}
            onReject={onReject}
        />
    );
}

const mapDispatchToProps = {
    updateActivePopupTypeAction: updateActivePopupType,
    submitNewNotificationAction: submitNewNotification
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(LoadDetectionModelPopup);
