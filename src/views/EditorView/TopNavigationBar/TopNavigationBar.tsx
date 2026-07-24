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
import {QueueItem} from '../../../store/queue/types';
import {updateQueueItem} from '../../../store/queue/actionCreators';
import {getEngineBaseUrl} from '../../../utils/DefaultBackendUrl';

interface IProps {
    updateActivePopupTypeAction: (activePopupType: PopupWindowType) => any;
    updateProjectDataAction: (projectData: ProjectData) => any;
    updateLanguageAction: (language: Language) => any;
    updateQueueItemAction: (itemId: string, updates: Partial<QueueItem>) => any;
    projectData: ProjectData;
    queueItems: QueueItem[];
    activeQueueItemId: string | null;
    language: Language;
    hasCoreEngine: boolean;
    hasExtensionEngine: boolean;
}

type ServicesDropdown = 'core' | 'extension' | null;

const TopNavigationBar: React.FC<IProps> = (props) => {
    const currentTexts = LanguageConfig[props.language];
    const [showActionsDropdown, setShowActionsDropdown] = useState(false);
    const [activeServicesDropdown, setActiveServicesDropdown] = useState<ServicesDropdown>(null);
    const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeQueueItem = props.queueItems.find(item => item.id === props.activeQueueItemId);

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
        window.dispatchEvent(new Event('opensight:open-task-center'));
    };

    const openVectorDb = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.VECTOR_DB);
    };

    const openL2gRetrieval = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.L2G_RETRIEVAL);
    };

    const toggleLanguage = () => {
        const newLanguage = props.language === Language.CHINESE ? Language.ENGLISH : Language.CHINESE;
        props.updateLanguageAction(newLanguage);
    };

    const toggleActionsDropdown = () => {
        setActiveServicesDropdown(null);
        setShowActionsDropdown(!showActionsDropdown);
    };

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
                            {activeServicesDropdown === 'core' && (
                                <div className='DropDownMenuContent ServicesDropdown'>
                                    <div className='DropDownMenuContentOption active'
                                        onClick={openDataCenter}>
                                        <div className='Marker'/>
                                        <img src='ico/api.png' alt='data-center'/>
                                        {currentTexts.modelManagement.dataCenter}
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
                </div>
            </div>
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
