import React, {useState, useEffect, useRef} from 'react';
import './TopNavigationBar.scss';
import StateBar from '../StateBar/StateBar';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {updateActivePopupType, updateProjectData, updateLanguage} from '../../../store/general/actionCreators';
import {Settings} from '../../../settings/Settings';
import {ProjectData} from '../../../store/general/types';
import DropDownMenu from './DropDownMenu/DropDownMenu';
import {TextButton} from '../../Common/TextButton/TextButton';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {QueueDataSyncStatus, QueueItem} from '../../../store/queue/types';
import {updateQueueItem} from '../../../store/queue/actionCreators';
import {getEngineBaseUrl, getExtensionEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import {AUTH_PREVIEW_SIGN_OUT_EVENT} from '../../AuthPreview/AuthPreview';
import {
    ACCOUNT_SESSION_CHANGED, AccountUser, currentAccountSession,
    uploadAccountAvatar as saveAccountAvatar,
} from '../../../services/AccountService';
import {AccountCenter} from '../../AccountCenter/AccountCenter';

interface IProps {
    updateActivePopupTypeAction: (activePopupType: PopupWindowType | null) => any;
    updateProjectDataAction: (projectData: ProjectData) => any;
    updateLanguageAction: (language: Language) => any;
    updateQueueItemAction: (itemId: string, updates: Partial<QueueItem>) => any;
    projectData: ProjectData;
    queueItems: QueueItem[];
    activeQueueItemId: string | null;
    language: Language;
    hasCoreEngine: boolean;
    hasExtensionEngine: boolean;
    platformMode?: 'annotation' | 'control';
    onPlatformSwitch?: () => void;
}

type ServicesDropdown = 'core' | 'extension' | null;
const ACCOUNT_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const ACCOUNT_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Top navigation intentionally owns its mutually exclusive menus and platform mode.
// eslint-disable-next-line complexity
export const TopNavigationBar: React.FC<IProps> = (props) => {
    const currentTexts = LanguageConfig[props.language];
    const controlMode = props.platformMode === 'control';
    const [showActionsDropdown, setShowActionsDropdown] = useState(false);
    const [showAccountDropdown, setShowAccountDropdown] = useState(false);
    const [showAccountCenter, setShowAccountCenter] = useState(
        () => Boolean(currentAccountSession()?.user.password_change_required),
    );
    const [account, setAccount] = useState<AccountUser | null>(() => currentAccountSession()?.user || null);
    const [activeServicesDropdown, setActiveServicesDropdown] = useState<ServicesDropdown>(null);
    const [cameraConnectAvailable, setCameraConnectAvailable] = useState(false);
    const [computeClusterAvailable, setComputeClusterAvailable] = useState(false);
    const extensionEngineBaseUrl = getExtensionEngineBaseUrl();
    const accountAvatar = account?.avatar_url || '';
    const accountAvatarText = account?.role === 'admin' ? '管' : (account?.display_name?.[0] || 'A').toUpperCase();
    const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const avatarInputRef = useRef<HTMLInputElement | null>(null);
    const activeQueueItem = props.queueItems.find(item => item.id === props.activeQueueItemId);
    const localChangeCount = props.queueItems.filter(
        item => item.dataSyncStatus === QueueDataSyncStatus.DIRTY,
    ).length;
    const localChangeDescription = props.language === Language.CHINESE
        ? `${localChangeCount} 个本地变动待处理`
        : `${localChangeCount} local ${localChangeCount === 1 ? 'change' : 'changes'} pending`;

    const onFocus = (event: React.FocusEvent<HTMLInputElement>) => {
        event.target.setSelectionRange(0, event.target.value.length);
    };

    const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
            .toLowerCase()
            .replace(' ', '-');

        props.updateProjectDataAction({
            ...props.projectData,
            name: value
        });
    };

    useEffect(() => {
        const cleanName = props.projectData.name.trim();
        if (!activeQueueItem || !cleanName) return undefined;
        if (activeQueueItem.name !== cleanName) {
            props.updateQueueItemAction(activeQueueItem.id, {name: cleanName});
        }

        const datasetId = activeQueueItem.datasetId;
        if (!datasetId) return undefined;
        renameTimerRef.current = setTimeout(() => {
            renameTimerRef.current = null;
            fetch(`${getEngineBaseUrl()}/datasets/${encodeURIComponent(datasetId)}`, {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name: cleanName, project_name: cleanName}),
            }).then(response => {
                if (!response.ok) throw new Error(`${response.status}`);
                window.dispatchEvent(new CustomEvent('opensight:data-center-updated', {
                    detail: {datasetId, queueItemId: activeQueueItem.id},
                }));
            }).catch(error => {
                console.warn('[ProjectRename] Failed to rename server dataset', error);
            });
        }, 500);
        return () => {
            if (renameTimerRef.current !== null) {
                clearTimeout(renameTimerRef.current);
                renameTimerRef.current = null;
            }
        };
    }, [
        props.projectData.name,
        activeQueueItem?.id,
        activeQueueItem?.name,
        activeQueueItem?.datasetId,
        props.updateQueueItemAction,
    ]);

    const closePopup = () => props.updateActivePopupTypeAction(PopupWindowType.EXIT_PROJECT)
    
    const showKeyboardShortcuts = () => props.updateActivePopupTypeAction(PopupWindowType.KEYBOARD_SHORTCUTS)
    
    const openLoadMoreMediaPopup = () => props.updateActivePopupTypeAction(PopupWindowType.IMPORT_IMAGES)

    const toggleServicesDropdown = (dropdown: Exclude<ServicesDropdown, null>) => {
        setShowActionsDropdown(false);
        setShowAccountDropdown(false);
        setActiveServicesDropdown((activeDropdown) => activeDropdown === dropdown ? null : dropdown);
    };

    // 「调用模型」按钮：打开本地模型挑选 / 加载弹窗
    const openLocalModelManager = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.CALL_MODEL);
    };

    const openDataCenter = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.DATA_CENTER);
    };

    const openTrainingTask = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.TRAINING_TASK);
    };

    const openTaskCenter = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(null);
        window.setTimeout(() => {
            window.dispatchEvent(new Event('opensight:open-task-center'));
        }, 0);
    };

    const openVectorDb = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.VECTOR_DB);
    };

    const openL2gRetrieval = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.L2G_RETRIEVAL);
    };

    const openModelInspector = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.MODEL_INSPECTOR);
    };

    const openCameraConnect = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.CAMERA_CONNECT);
    };

    const openComputeCluster = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.COMPUTE_CLUSTER);
    };

    useEffect(() => {
        if (!props.hasExtensionEngine) {
            setCameraConnectAvailable(false);
            setComputeClusterAvailable(false);
            return undefined;
        }
        const controller = new AbortController();
        fetch(`${extensionEngineBaseUrl}/health`, {signal: controller.signal})
            .then(response => response.ok ? response.json() : Promise.reject(new Error(`${response.status}`)))
            .then(health => {
                const plugin = health?.plugins?.camera_connect;
                setCameraConnectAvailable(Boolean(plugin?.enabled && plugin?.state === 'ready'));
                const computeCluster = health?.plugins?.compute_cluster;
                setComputeClusterAvailable(Boolean(computeCluster?.enabled && computeCluster?.state === 'ready'));
            })
            .catch(error => {
                if (error?.name !== 'AbortError') {
                    setCameraConnectAvailable(false);
                    setComputeClusterAvailable(false);
                }
            });
        return () => controller.abort();
    }, [props.hasExtensionEngine, extensionEngineBaseUrl, activeServicesDropdown]);

    const toggleLanguage = () => {
        const newLanguage = props.language === Language.CHINESE ? Language.ENGLISH : Language.CHINESE;
        props.updateLanguageAction(newLanguage);
    };

    const toggleActionsDropdown = () => {
        setActiveServicesDropdown(null);
        setShowAccountDropdown(false);
        setShowActionsDropdown(!showActionsDropdown);
    };

    const toggleAccountDropdown = () => {
        setShowActionsDropdown(false);
        setActiveServicesDropdown(null);
        setShowAccountDropdown(open => !open);
    };

    const uploadAccountAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!ACCOUNT_AVATAR_TYPES.has(file.type) || file.size > ACCOUNT_AVATAR_MAX_BYTES) {
            window.alert(currentTexts.account.avatarUploadError);
            return;
        }
        try { setAccount(await saveAccountAvatar(file)); }
        catch { window.alert(currentTexts.account.avatarUploadError); }
    };

    useEffect(() => {
        const update = () => {
            const user = currentAccountSession()?.user || null;
            setAccount(user);
            if (user?.password_change_required) setShowAccountCenter(true);
        };
        window.addEventListener(ACCOUNT_SESSION_CHANGED, update);
        return () => window.removeEventListener(ACCOUNT_SESSION_CHANGED, update);
    }, []);

    // 点击外部关闭下拉菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Element;
            if (!target.closest('.ActionsDropdownContainer')) {
                setShowActionsDropdown(false);
            }
        };

        if (showActionsDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showActionsDropdown]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Element;
            if (!target.closest('.ServicesDropdownContainer')) {
                setActiveServicesDropdown(null);
            }
        };

        if (activeServicesDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [activeServicesDropdown]);

    useEffect(() => {
        const closeAccountDropdown = (event: MouseEvent | KeyboardEvent) => {
            if (
                event instanceof KeyboardEvent
                    ? event.key === 'Escape'
                    : !(event.target as Element).closest('.AccountDropdownContainer')
            ) {
                setShowAccountDropdown(false);
            }
        };

        if (showAccountDropdown) {
            document.addEventListener('mousedown', closeAccountDropdown);
            document.addEventListener('keydown', closeAccountDropdown);
        }

        return () => {
            document.removeEventListener('mousedown', closeAccountDropdown);
            document.removeEventListener('keydown', closeAccountDropdown);
        };
    }, [showAccountDropdown]);

    return (
        <div className='TopNavigationBar'>
            <StateBar/>
            <div className='TopNavigationBarWrapper'>
                <div className='NavigationBarGroupWrapper left'>
                    <div
                        className='Header'
                        onClick={showKeyboardShortcuts}
                    >
                        <img
                            draggable={false}
                            alt={'make-sense'}
                            src={'/make-sense-ico-transparent.png'}
                        />
                        {currentTexts.makeSense}
                    </div>
                    <div className='ActionsDropdownContainer'>
                        <TextButton
                            label={currentTexts.actions.title}
                            onClick={toggleActionsDropdown}
                            externalClassName={'actions-button'}
                        />
                        {showActionsDropdown && <DropDownMenu isVisible={true}/>}
                    </div>
                    {props.hasCoreEngine && (
                        <div className='ServicesDropdownContainer'>
                            <TextButton
                                label={currentTexts.modelManagement.coreServices}
                                onClick={() => toggleServicesDropdown('core')}
                                externalClassName={'services-button'}
                            />
                            {localChangeCount > 0 && (
                                <span
                                    className='ServicesChangeBadge'
                                    role='status'
                                    aria-label={localChangeDescription}
                                    title={localChangeDescription}
                                >
                                    {localChangeCount}
                                </span>
                            )}
                            {activeServicesDropdown === 'core' && (
                                <div className='DropDownMenuContent ServicesDropdown'>
                                    <div className='DropDownMenuContentOption active'
                                        onClick={openDataCenter}>
                                        <div className='Marker'/>
                                        <img src='ico/api.png' alt='data-center'/>
                                        <span className='ServicesOptionLabel'>
                                            {currentTexts.modelManagement.dataCenter}
                                        </span>
                                        {localChangeCount > 0 && (
                                            <span
                                                className='ServicesOptionChangeBadge'
                                                role='status'
                                                aria-label={localChangeDescription}
                                                title={localChangeDescription}
                                            >
                                                {localChangeCount}
                                            </span>
                                        )}
                                    </div>
                                    <div className='DropDownMenuContentOption active'
                                        onClick={openLocalModelManager}>
                                        <div className='Marker'/>
                                        <img src='ico/ai.png' alt='local-models'/>
                                        {currentTexts.modelManagement.callModels}
                                    </div>
                                    <div className='DropDownMenuContentOption active'
                                        onClick={openTrainingTask}>
                                        <div className='Marker'/>
                                        <img src='ico/ai.png' alt='training-task'/>
                                        {currentTexts.modelManagement.trainingTask}
                                    </div>
                                    <div className='DropDownMenuContentOption active'
                                        onClick={openTaskCenter}>
                                        <div className='Marker'/>
                                        <img src='ico/tasks.png' alt='task-center'/>
                                        {currentTexts.modelManagement.taskCenter}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {props.hasExtensionEngine && (
                        <div className='ServicesDropdownContainer'>
                            <TextButton
                                label={currentTexts.modelManagement.extensionServices}
                                onClick={() => toggleServicesDropdown('extension')}
                                externalClassName={'services-button'}
                            />
                            {activeServicesDropdown === 'extension' && (
                                <div className='DropDownMenuContent ServicesDropdown'>
                                    <div className='DropDownMenuContentOption active'
                                        onClick={openVectorDb}>
                                        <div className='Marker'/>
                                        <img src='ico/api.png' alt='vector-db'/>
                                        {currentTexts.modelManagement.vectorDb}
                                    </div>
                                    <div className='DropDownMenuContentOption active'
                                        onClick={openL2gRetrieval}>
                                        <div className='Marker'/>
                                        <img src='ico/ai.png' alt='l2g-retrieval'/>
                                        {currentTexts.modelManagement.l2gRetrieval}
                                    </div>
                                    <div className={`DropDownMenuContentOption active${cameraConnectAvailable || computeClusterAvailable ? ' divider' : ''}`}
                                        onClick={openModelInspector}>
                                        <div className='Marker'/>
                                        <img src='ico/eye.png' alt='model-inspector'/>
                                        {currentTexts.modelManagement.modelInspector}
                                    </div>
                                    {cameraConnectAvailable && <div className='DropDownMenuContentOption active'
                                        onClick={openCameraConnect}>
                                        <div className='Marker'/>
                                        <img src='ico/camera.png' alt='camera-connect'/>
                                        {currentTexts.modelManagement.cameraConnect}
                                    </div>}
                                    {computeClusterAvailable && <div className='DropDownMenuContentOption active'
                                        onClick={openComputeCluster}>
                                        <div className='Marker'/>
                                        <img src='ico/tasks.png' alt='compute-cluster'/>
                                        {currentTexts.modelManagement.computeCluster}
                                    </div>}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <div
                    className='ProjectNameContainer'
                >
                    <div className='ProjectName'>{currentTexts.projectName}</div>
                    <div
                        className='ProjectNameInputWrapper'
                        data-value={props.projectData.name}
                    >
                        <input
                            type='text'
                            size={1}
                            value={props.projectData.name}
                            onChange={onChange}
                            onFocus={onFocus}
                        />
                    </div>
                </div>
                <div className='NavigationBarGroupWrapper right'>
                    <TextButton
                        label={currentTexts.languageToggle}
                        onClick={toggleLanguage}
                        externalClassName={'language-toggle-button'}
                    />
                    <div className='AccountDropdownContainer'>
                        <button
                            type='button'
                            className='AccountAvatarButton'
                            aria-label={currentTexts.account.openMenu}
                            aria-haspopup='menu'
                            aria-expanded={showAccountDropdown}
                            onClick={toggleAccountDropdown}
                        >
                            {accountAvatar ? <img src={accountAvatar} alt=''/> : accountAvatarText}
                        </button>
                        <input
                            ref={avatarInputRef}
                            className='AccountAvatarInput'
                            type='file'
                            accept='image/jpeg,image/png,image/webp'
                            aria-label={currentTexts.account.uploadAvatar}
                            onChange={uploadAccountAvatar}
                        />
                        {showAccountDropdown && <div
                            className='AccountDropdown'
                            role='menu'
                            aria-label={currentTexts.account.menuLabel}
                        >
                            <div className='AccountSummary'>
                                <button
                                    type='button'
                                    className='AccountSummaryAvatar'
                                    aria-label={currentTexts.account.uploadAvatar}
                                    title={currentTexts.account.uploadAvatar}
                                    onClick={() => avatarInputRef.current?.click()}
                                >
                                    {accountAvatar ? <img src={accountAvatar} alt=''/> : accountAvatarText}
                                </button>
                                <span className='AccountSummaryText'>
                                    <strong>{account?.display_name || currentTexts.account.displayName}</strong>
                                    <small>{account?.role === 'admin' ? currentTexts.account.role : account?.username}</small>
                                </span>
                            </div>
                            <div className='AccountMenuDivider'/>
                            <button
                                type='button'
                                role='menuitem'
                                className='AccountMenuItem'
                                onClick={() => {
                                    setShowAccountDropdown(false);
                                    props.onPlatformSwitch?.();
                                }}
                            >
                                <img src='/ico/api.png' alt=''/>
                                {controlMode
                                    ? currentTexts.account.switchToAnnotationPlatform
                                    : currentTexts.account.switchToControlPlatform}
                            </button>
                            <button type='button' role='menuitem' className='AccountMenuItem' onClick={() => {
                                setShowAccountDropdown(false);
                                setShowAccountCenter(true);
                            }}>
                                <img src='/ico/secure.png' alt=''/>
                                {currentTexts.account.personalCenter}
                            </button>
                            <button
                                type='button'
                                role='menuitem'
                                className='AccountMenuItem AccountMenuItemDanger'
                                onClick={() => {
                                    setShowAccountDropdown(false);
                                    window.dispatchEvent(new Event(AUTH_PREVIEW_SIGN_OUT_EVENT));
                                }}
                            >
                                <img src='/ico/right.png' alt=''/>
                                {currentTexts.account.signOut}
                            </button>
                        </div>}
                    </div>
                </div>
            </div>
            {showAccountCenter && account && <AccountCenter
                user={account}
                zh={props.language === Language.CHINESE}
                onClose={() => setShowAccountCenter(false)}
                onUserChanged={setAccount}
            />}
        </div>
    );
};

const mapDispatchToProps = {
    updateActivePopupTypeAction: updateActivePopupType,
    updateProjectDataAction: updateProjectData,
    updateLanguageAction: updateLanguage,
    updateQueueItemAction: updateQueueItem,
};

const mapStateToProps = (state: AppState) => ({
    projectData: state.general.projectData,
    queueItems: state.queue.items,
    activeQueueItemId: state.queue.activeQueueItemId,
    language: state.general.language,
    hasCoreEngine: !!state.aimodels?.models.some(model => model.modelType === 'core'),
    hasExtensionEngine: !!state.aimodels?.models.some(model => model.modelType === 'extension')
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(TopNavigationBar);
