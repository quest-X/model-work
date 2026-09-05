import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {Language} from '../../../data/LanguageConfig';
import {ExporterUtil} from '../../../utils/ExporterUtil';
import {OCRPanel} from './OCRPopup';

jest.mock('../../../index', () => ({store: {dispatch: jest.fn(), getState: () => ({})}}));
jest.mock('../../../logic/actions/PopupActions', () => ({PopupActions: {close: jest.fn()}}));
jest.mock('../../../utils/DefaultBackendUrl', () => ({getEngineBaseUrl: () => '/core_service'}));
jest.mock('../../../utils/ExporterUtil', () => ({ExporterUtil: {saveAs: jest.fn()}}));
jest.mock('../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({renderContent}: {renderContent: () => React.ReactNode}) => <>{renderContent()}</>,
}));

const chooseImage = () => fireEvent.change(screen.getByLabelText('图片'), {
    target: {files: [new File(['fixture'], 'text.png', {type: 'image/png'})]},
});

describe('OCR panel', () => {
    const previousFetch = global.fetch;
    beforeEach(() => {
        URL.createObjectURL = jest.fn(() => 'blob:fixture');
        URL.revokeObjectURL = jest.fn();
    });
    afterEach(() => { global.fetch = previousFetch; jest.clearAllMocks(); });

    it('sends the selected model and exports real text and coordinates', async () => {
        const rows = [{text: '上海 12345', bbox: [10, 20, 200, 80], confidence: .99}];
        global.fetch = jest.fn().mockResolvedValue({ok: true, json: async () => ({results: rows})});
        render(<OCRPanel language={Language.CHINESE}/>);
        expect(screen.getByRole('button', {name: '识别'})).toBeDisabled();
        chooseImage();
        fireEvent.change(screen.getByLabelText('模型'), {target: {value: 'ppocrv5_server'}});
        await act(async () => { fireEvent.click(screen.getByRole('button', {name: '识别'})); });
        const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
        expect(url).toBe('/core_service/ocr');
        expect(init.body.get('model')).toBe('ppocrv5_server');
        expect(init.body.get('file').name).toBe('text.png');
        expect(screen.getByText('上海 12345')).toBeInTheDocument();
        expect(screen.getByText('10, 20, 200, 80')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '导出 JSON'}));
        expect(JSON.parse((ExporterUtil.saveAs as jest.Mock).mock.calls[0][0])).toEqual({
            image: 'text.png', model: 'ppocrv5_server', results: rows,
        });
        chooseImage();
        expect(screen.queryByText('上海 12345')).not.toBeInTheDocument();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fixture');
    });

    it('surfaces backend failures and allows retry', async () => {
        global.fetch = jest.fn().mockResolvedValue({ok: false, json: async () => ({detail: 'Model unavailable'})});
        render(<OCRPanel language={Language.CHINESE}/>);
        chooseImage();
        await act(async () => { fireEvent.click(screen.getByRole('button', {name: '识别'})); });
        expect(screen.getByRole('alert')).toHaveTextContent('Model unavailable');
        expect(screen.getByRole('button', {name: '识别'})).not.toBeDisabled();
        expect(screen.queryByRole('button', {name: '导出 JSON'})).not.toBeInTheDocument();
    });

    it('stops waiting without claiming the server stopped', async () => {
        global.fetch = jest.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('Aborted')));
        }));
        const view = render(<OCRPanel language={Language.CHINESE}/>);
        chooseImage();
        fireEvent.click(screen.getByRole('button', {name: '识别'}));
        expect(screen.getByLabelText('模型')).toBeDisabled();
        await act(async () => { fireEvent.click(screen.getByRole('button', {name: '停止等待'})); });
        expect(screen.getByRole('alert')).toHaveTextContent('可能仍在运行');
        expect(screen.getByRole('button', {name: '识别'})).not.toBeDisabled();
        fireEvent.click(screen.getByRole('button', {name: '识别'}));
        const signal = (global.fetch as jest.Mock).mock.calls[1][1].signal;
        await act(async () => { view.unmount(); });
        expect(signal.aborted).toBe(true);
    });
});
