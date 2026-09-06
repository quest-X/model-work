import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../data/LanguageConfig';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {CallModelPopup} from './CallModelPopup';

jest.mock('../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({title, renderContent, acceptLabel, onAccept, disableAcceptButton}: {
        title: React.ReactNode;
        renderContent: () => React.ReactNode;
        acceptLabel: string;
        onAccept: () => void;
        disableAcceptButton: boolean;
    }) => (
        <div>
            <h1>{title}</h1>
            {renderContent()}
            <button type='button' disabled={disableAcceptButton} onClick={onAccept}>{acceptLabel}</button>
        </div>
    ),
}));

jest.mock('./PipelineCanvas', () => function MockPipelineCanvas() {
    return <div data-testid='pipeline-canvas'/>;
});

jest.mock('../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));

jest.mock('../../../utils/DefaultBackendUrl', () => ({
    ...jest.requireActual('../../../utils/DefaultBackendUrl'),
    getDefaultCoreServiceBase: () => 'https://core.test/core_service',
    resolveEngineBaseUrl: () => 'https://core.test/core_service',
}));

jest.mock('../../../utils/HostSystem', () => ({
    getHostSystem: () => 'linux',
    supportsCoreML: () => false,
    showsTensorRTPlaceholder: () => false,
}));

describe('CallModelPopup inference capabilities', () => {
    beforeEach(() => {
        global.fetch = jest.fn(() => new Promise<Response>(() => undefined));
    });

    it('opens OCR from the inference system', async () => {
        const updatePopup = jest.fn();
        render(<CallModelPopup
            updateActivePopupType={updatePopup}
            language={Language.CHINESE}
            aiModels={[{
                id: 'core',
                name: '核心引擎',
                url: 'https://core.test',
                modelType: 'core',
                createdAt: new Date('2026-09-06T00:00:00Z'),
                isActive: true,
            }]}
            activeAIModelId='core'
        />);

        expect(screen.getByRole('heading', {name: '推理系统'})).toBeInTheDocument();
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        fireEvent.click(screen.getByText('文字识别 OCR'));
        fireEvent.click(screen.getByRole('button', {name: '进入'}));
        expect(updatePopup).toHaveBeenCalledWith(PopupWindowType.OCR);
    });
});
