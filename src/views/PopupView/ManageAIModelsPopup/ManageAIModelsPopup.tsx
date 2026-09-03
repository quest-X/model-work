import React, { useState, useEffect } from 'react';
import './ManageAIModelsPopup.scss';
import { GenericYesNoPopup } from '../GenericYesNoPopup/GenericYesNoPopup';
import { PopupWindowType } from '../../../data/enums/PopupWindowType';
import { updateActivePopupType } from '../../../store/general/actionCreators';
import { addAIModel, setActiveAIModel, deleteAIModel } from '../../../store/aimodels/actionCreators';
import { AppState } from '../../../store';
import { connect } from 'react-redux';
import { ImageButton } from '../../Common/ImageButton/ImageButton';
import { AIModel } from '../../../store/aimodels/types';
import { Language, LanguageConfig } from '../../../data/LanguageConfig';
import { StyledTextField } from '../../Common/StyledTextField/StyledTextField';

interface EngineServiceDescriptor {
    id: string;
    name: string;
    servicePath: string;
    popupType?: PopupWindowType;
    eventName?: string;
}

export interface IProps {
    updateActivePopupTypeAction: (activePopupType: PopupWindowType | null) => any;
    addAIModelAction: (model: AIModel) => any;
    setActiveAIModelAction: (modelId: string | null) => any;
    deleteAIModelAction: (modelId: string) => any;
    aiModels: AIModel[];
    activeModelId: string | null;
    language: Language;
}

export const ManageAIModelsPopup: React.FC<IProps> = ({
    updateActivePopupTypeAction,
    addAIModelAction,
    setActiveAIModelAction,
    deleteAIModelAction,
    aiModels,
    activeModelId,
    language
}) => {
    const currentTexts = LanguageConfig[language];
    const [selectedModelId, setSelectedModelId] = useState<string | null>(activeModelId);
    const [isEditing, setIsEditing] = useState(false);
    const [editingModel, setEditingModel] = useState<AIModel | null>(null);

    useEffect(() => {
        if (aiModels.length > 0 && !selectedModelId) {
            setSelectedModelId(aiModels[0].id);
        }
    }, [aiModels, selectedModelId]);

    const onAccept = () => {
        if (selectedModelId) {
            setActiveAIModelAction(selectedModelId);
        }
        updateActivePopupTypeAction(null);
    };

    const onReject = () => {
        updateActivePopupTypeAction(null);
    };

    const addNewModel = () => {
        updateActivePopupTypeAction(PopupWindowType.MODEL_ENGINE);
    };

    const selectModel = (modelId: string) => {
        setSelectedModelId(modelId);
        setIsEditing(false);
        setEditingModel(null);
    };

    const editModel = (model: AIModel) => {
        setEditingModel({ ...model });
        setIsEditing(true);
    };

    const deleteModel = (modelId: string) => {
        deleteAIModelAction(modelId);
        if (selectedModelId === modelId) {
            const remainingModels = aiModels.filter(m => m.id !== modelId);
            setSelectedModelId(remainingModels.length > 0 ? remainingModels[0].id : null);
        }
    };

    const saveEditingModel = () => {
        if (editingModel) {
            addAIModelAction(editingModel); // 这里会通过reducer的UPDATE逻辑来更新
            setIsEditing(false);
            setEditingModel(null);
        }
    };

    const cancelEditing = () => {
        setIsEditing(false);
        setEditingModel(null);
    };

    const coreServices: EngineServiceDescriptor[] = [
        {
            id: 'resource-center',
            name: currentTexts.modelManagement.dataCenter,
            servicePath: 'core/resource-center',
            popupType: PopupWindowType.DATA_CENTER
        },
        {
            id: 'inference-settings',
            name: currentTexts.modelManagement.callModels,
            servicePath: 'core/inference-settings',
            popupType: PopupWindowType.CALL_MODEL
        },
        {
            id: 'training-settings',
            name: currentTexts.modelManagement.trainingTask,
            servicePath: 'core/training-settings',
            popupType: PopupWindowType.TRAINING_TASK
        },
        {
            id: 'task-center',
            name: currentTexts.modelManagement.taskCenter,
            servicePath: 'core/task-center',
            eventName: 'opensight:open-task-center'
        }
    ];

    const extensionServices: EngineServiceDescriptor[] = [
        {
            id: 'vector-database',
            name: currentTexts.modelManagement.vectorDb,
            servicePath: 'extension/vector-database',
            popupType: PopupWindowType.VECTOR_DB
        },
        {
            id: 'visual-retrieval',
            name: currentTexts.modelManagement.l2gRetrieval,
            servicePath: 'extension/visual-retrieval',
            popupType: PopupWindowType.L2G_RETRIEVAL
        },
        {
            id: 'model-inspector',
            name: currentTexts.modelManagement.modelInspector,
            servicePath: 'extension/model-inspector',
            popupType: PopupWindowType.MODEL_INSPECTOR
        },
        {
            id: 'camera-connect',
            name: currentTexts.modelManagement.cameraConnect,
            servicePath: 'extension/camera-connect',
            popupType: PopupWindowType.CAMERA_CONNECT
        },
        {
            id: 'compute-cluster',
            name: currentTexts.modelManagement.computeCluster,
            servicePath: 'extension/compute-cluster',
            popupType: PopupWindowType.COMPUTE_CLUSTER
        }
    ];

    const openProvidedService = (service: EngineServiceDescriptor) => {
        if (service.popupType) {
            updateActivePopupTypeAction(service.popupType);
            return;
        }

        if (service.eventName) {
            updateActivePopupTypeAction(null);
            window.setTimeout(() => {
                window.dispatchEvent(new Event(service.eventName));
            }, 0);
        }
    };

    const renderProvidedServices = () => {
        const selectedEngine = aiModels.find(m => m.id === selectedModelId);
        const services = selectedEngine?.modelType === 'extension'
            ? extensionServices
            : coreServices;

        return (
            <div className='ProvidedServicesSection'>
                <div className='SectionTitle'>
                    {currentTexts.modelManagement.providedServices}
                </div>
                <div className='ProvidedServicesList'>
                    {services.map(service => (
                        <button
                            type='button'
                            key={service.id}
                            className='EngineServiceEntry'
                            onClick={() => openProvidedService(service)}
                            aria-label={service.name}
                        >
                            <span className='EngineServiceText'>
                                <span className='EngineServiceName'>{service.name}</span>
                                <span className='EngineServicePath'>{service.servicePath}</span>
                            </span>
                            <span className='EngineServiceAction' aria-hidden='true'>›</span>
                        </button>
                    ))}
                </div>
            </div>
        );
    };

    const updateEditingField = (field: keyof AIModel, value: string) => {
        if (editingModel) {
            setEditingModel({
                ...editingModel,
                [field]: value
            });
        }
    };

    const renderModelList = () => {
        if (aiModels.length === 0) {
            return (
                <div className='EmptyList' onClick={addNewModel}>
                    <img
                        draggable={false}
                        alt={'ai-models'}
                        src={'ico/robot.png'}
                    />
                    <p className='extraBold'>
                        {currentTexts.modelManagement.noModels}
                    </p>
                    <p>
                        {currentTexts.modelManagement.noModelsHint}
                    </p>
                </div>
            );
        }

        return (
                <div className='ManageAIModelsPopupContent'>
                    {aiModels.map((model, index) => (
                        <div 
                            key={model.id} 
                            className={`ModelEntry ${selectedModelId === model.id ? 'selected' : ''}`}
                            onClick={() => selectModel(model.id)}
                        >
                            <div className='ModelIndex'>
                                {index + 1}
                            </div>
                            <div className='ModelName'>
                                {model.name || model.url}
                            </div>
                            <div className='ModelActions'>
                                <ImageButton
                                    image={'ico/edit.png'}
                                    imageAlt={'edit'}
                                    buttonSize={{ width: 20, height: 20 }}
                                    padding={8}
                                    onClick={() => editModel(model)}
                                />
                                <ImageButton
                                    image={'ico/trash.png'}
                                    imageAlt={'delete'}
                                    buttonSize={{ width: 20, height: 20 }}
                                    padding={8}
                                    onClick={() => deleteModel(model.id)}
                                />
                            </div>
                        </div>
                    ))}
                </div>
        );
    };

    const renderModelDetails = () => {
        const selectedModel = aiModels.find(m => m.id === selectedModelId);
        
        if (isEditing && editingModel) {
            return (
                <div className='ModelDetails editing'>
                    <div className='ModelField'>
                        <StyledTextField
                            variant='standard'
                            label={currentTexts.modelManagement.modelName}
                            value={editingModel.name}
                            onChange={(e) => updateEditingField('name', e.target.value)}
                            style={{ width: '100%', marginBottom: '16px' }}
                        />
                    </div>
                    <div className='ModelField'>
                        <StyledTextField
                            variant='standard'
                            label={currentTexts.modelManagement.modelUrl}
                            value={editingModel.url}
                            onChange={(e) => updateEditingField('url', e.target.value)}
                            style={{ width: '100%', marginBottom: '16px' }}
                        />
                    </div>
                    <div className='ModelField'>
                        <StyledTextField
                            variant='standard'
                            type='password'
                            label={currentTexts.modelManagement.apiKeyOptional}
                            value={editingModel.apiKey || ''}
                            onChange={(e) => updateEditingField('apiKey', e.target.value)}
                            style={{ width: '100%', marginBottom: '16px' }}
                        />
                    </div>
                    {/* 模型描述字段暂时隐藏，以后再启用
                    <div className='ModelField'>
                        <StyledTextField
                            variant='standard'
                            label={currentTexts.modelManagement.descriptionOptional}
                            value={editingModel.description || ''}
                            onChange={(e) => updateEditingField('description', e.target.value)}
                            style={{ width: '100%', marginBottom: '16px' }}
                        />
                    </div>
                    */}
                    <div className='EditActions'>
                        <ImageButton
                            image={'ico/cancel.png'}
                            imageAlt={'cancel'}
                            buttonSize={{ width: 30, height: 30 }}
                            padding={10}
                            onClick={cancelEditing}
                        />
                        <ImageButton
                            image={'ico/save.png'}
                            imageAlt={'save'}
                            buttonSize={{ width: 30, height: 30 }}
                            padding={10}
                            onClick={saveEditingModel}
                        />
                    </div>
                </div>
            );
        }

        if (!selectedModel) {
            return (
                <div className='ModelDetails empty'>
                    <p>{currentTexts.modelManagement.selectModelHint}</p>
                </div>
            );
        }

        return (
            <div className='ModelDetails'>
                <div className='ModelField header'>
                    <div className='model-name-section'>
                        <label>{currentTexts.modelManagement.modelName}</label>
                        <span className='model-name'>{selectedModel.name || currentTexts.modelManagement.unnamedModel}</span>
                    </div>
                    <div className='created-time-section'>
                        <label>{language === Language.CHINESE ? '添加时间' : 'Added'}</label>
                        <span className='created-time'>{(() => {
                            const d = new Date(selectedModel.createdAt);
                            const yyyy = d.getFullYear();
                            const mm = String(d.getMonth() + 1).padStart(2, '0');
                            const dd = String(d.getDate()).padStart(2, '0');
                            const h = d.getHours();
                            const min = String(d.getMinutes()).padStart(2, '0');
                            const sec = String(d.getSeconds()).padStart(2, '0');
                            const ampm = h >= 12 ? 'PM' : 'AM';
                            const h12 = h % 12 || 12;
                            return `${yyyy}/${mm}/${dd}, ${h12}:${min}:${sec} ${ampm}`;
                        })()}</span>
                    </div>
                </div>
                <div className='ModelField'>
                    <label>{currentTexts.modelManagement.apiEndpoint}</label>
                    <span className='url'>{selectedModel.url}</span>
                </div>
                <div className='ModelField'>
                    <label>{currentTexts.modelManagement.apiKey}</label>
                    <span>{selectedModel.apiKey ? '••••••••' : currentTexts.modelManagement.none}</span>
                </div>
                {/* 模型描述字段暂时隐藏，以后再启用
                <div className='ModelField'>
                    <label>{currentTexts.modelManagement.description}</label>
                    <span>{selectedModel.description || currentTexts.modelManagement.noDescription}</span>
                </div>
                */}
            </div>
        );
    };

    const renderContent = () => {
        return (
            <div className='ManageAIModelsPopup'>
                <div className='LeftContainer'>
                    <ImageButton
                        image={'ico/plus.png'}
                        imageAlt={'add'}
                        buttonSize={{ width: 40, height: 40 }}
                        padding={25}
                        onClick={addNewModel}
                        externalClassName={'monochrome'}
                    />
                </div>
                <div className='RightContainer'>
                    <div className='Message'>
                        {currentTexts.modelManagement.manageMessage}
                    </div>
                    <div className='ContentArea'>
                        <div className='ModelsListContainer'>
                            <div className='SectionTitle'>
                                {currentTexts.modelManagement.modelEngines}
                            </div>
                            <div className={`ModelsContainer${aiModels.length === 0 ? ' empty' : ''}`}>
                                {renderModelList()}
                            </div>
                            {aiModels.length > 0 && renderProvidedServices()}
                        </div>
                        <div className='ModelDetailsContainer'>
                            <div className='SectionTitle'>
                                {currentTexts.modelManagement.modelDetails}
                            </div>
                            {renderModelDetails()}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <GenericYesNoPopup
            title={currentTexts.modelManagement.title}
            renderContent={renderContent}
            acceptLabel={currentTexts.modelManagement.close}
            onAccept={onReject}
            skipRejectButton={true}
        />
    );
};

const mapDispatchToProps = {
    updateActivePopupTypeAction: updateActivePopupType,
    addAIModelAction: addAIModel,
    setActiveAIModelAction: setActiveAIModel,
    deleteAIModelAction: deleteAIModel
};

const mapStateToProps = (state: AppState) => ({
    aiModels: state.aimodels.models,
    activeModelId: state.aimodels.activeModelId,
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ManageAIModelsPopup);
