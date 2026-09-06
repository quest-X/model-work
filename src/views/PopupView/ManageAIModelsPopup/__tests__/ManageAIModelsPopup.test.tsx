import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {PopupWindowType} from '../../../../data/enums/PopupWindowType';
import {Language} from '../../../../data/LanguageConfig';
import {AIModel} from '../../../../store/aimodels/types';
import {ManageAIModelsPopup} from '../ManageAIModelsPopup';

jest.mock('../../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({title, renderContent}: {title: React.ReactNode; renderContent: () => React.ReactNode}) => (
        <div><h1>{title}</h1>{renderContent()}</div>
    ),
}));

jest.mock('../../../Common/ImageButton/ImageButton', () => ({
    ImageButton: ({imageAlt, onClick}: {imageAlt: string; onClick: () => void}) => (
        <button type='button' aria-label={imageAlt} onClick={onClick}/>
    ),
}));

const createEngine = (modelType: AIModel['modelType']): AIModel => ({
    id: `${modelType}-engine`,
    name: modelType === 'core' ? '核心引擎' : '拓展引擎',
    url: `http://localhost/${modelType}`,
    modelType,
    createdAt: new Date('2026-08-20T00:00:00Z'),
    isActive: true,
});

const renderPopup = (engine: AIModel) => {
    const updateActivePopupTypeAction = jest.fn();
    render(
        <ManageAIModelsPopup
            updateActivePopupTypeAction={updateActivePopupTypeAction}
            addAIModelAction={jest.fn()}
            setActiveAIModelAction={jest.fn()}
            deleteAIModelAction={jest.fn()}
            aiModels={[engine]}
            activeModelId={engine.id}
            language={Language.CHINESE}
        />
    );
    return updateActivePopupTypeAction;
};

describe('ManageAIModelsPopup provided services', () => {
    it('shows concrete core service names and opens their actual popups', () => {
        const updatePopup = renderPopup(createEngine('core'));

        expect(screen.getByRole('button', {name: '资源中心'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '推理系统'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '训练系统'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '任务中心'})).toBeInTheDocument();
        expect(screen.queryByText('ultralytics/yolo26')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '资源中心'}));
        expect(updatePopup).toHaveBeenCalledWith(PopupWindowType.DATA_CENTER);
    });

    it('shows every concrete extension service and opens compute cluster', () => {
        const updatePopup = renderPopup(createEngine('extension'));

        expect(screen.getByRole('button', {name: '向量数据库'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '视觉检索'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '透视'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '连接相机'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '计算群'})).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '计算群'}));
        expect(updatePopup).toHaveBeenCalledWith(PopupWindowType.COMPUTE_CLUSTER);
    });

    it('closes engine management before opening task center', () => {
        jest.useFakeTimers();
        const updatePopup = renderPopup(createEngine('core'));
        const taskCenterHandler = jest.fn();
        window.addEventListener('opensight:open-task-center', taskCenterHandler);

        fireEvent.click(screen.getByRole('button', {name: '任务中心'}));
        expect(updatePopup).toHaveBeenCalledWith(null);
        jest.runOnlyPendingTimers();
        expect(taskCenterHandler).toHaveBeenCalledTimes(1);

        window.removeEventListener('opensight:open-task-center', taskCenterHandler);
        jest.useRealTimers();
    });
});
