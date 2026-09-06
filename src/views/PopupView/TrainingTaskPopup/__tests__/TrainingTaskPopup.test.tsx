import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {TrainingDatasetSelection} from '../../../../services/TrainingDatasetSelection';
import {TrainingTaskPopup} from '../TrainingTaskPopup';

jest.mock('../../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({title, renderContent}: {title: React.ReactNode; renderContent: () => React.ReactNode}) => (
        <div><h1>{title}</h1>{renderContent()}</div>
    ),
}));

jest.mock('../../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));

jest.mock('../../../../services/TrainingDatasetSelection', () => ({
    TrainingDatasetSelection: {get: jest.fn(), set: jest.fn()},
}));

jest.mock('../../../../utils/DefaultBackendUrl', () => ({
    getEngineBaseUrl: () => 'https://core.test/core_service',
}));

const jsonResponse = (body: unknown): Response => ({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
} as unknown as Response);

describe('TrainingTaskPopup', () => {
    let jobs: unknown[];
    let datasets: unknown[];

    beforeEach(() => {
        jest.clearAllMocks();
        jobs = [];
        datasets = [
            {id: 'dataset-1', name: '一号数据', image_count: 10, classes: ['钢卷'], annotated_count: 8},
            {id: 'dataset-2', name: '二号数据', image_count: 20, classes: ['钢板'], annotated_count: 16},
        ];
        (TrainingDatasetSelection.get as jest.Mock).mockReturnValue('dataset-2');
        global.fetch = jest.fn((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/datasets')) {
                return Promise.resolve(jsonResponse({datasets}));
            }
            if (url.endsWith('/training/jobs')) return Promise.resolve(jsonResponse({jobs}));
            return Promise.resolve(jsonResponse({status: 'success'}));
        }) as jest.Mock;
    });

    it('preselects the dataset chosen in Resource Center', async () => {
        render(<TrainingTaskPopup language={Language.CHINESE}/>);

        await waitFor(() => expect(screen.getByLabelText('数据集')).toHaveValue('dataset-2'));
        expect(TrainingDatasetSelection.set).toHaveBeenCalledWith('dataset-2');
    });

    it('shows the dataset name for each job and falls back to its dataset id', async () => {
        jobs = [
            {
                job_id: 'job-known',
                name: '二号训练',
                state: 'running',
                dataset_id: 'dataset-2',
                progress: {epoch: 4, total_epochs: 10, metrics: {}},
            },
            {
                job_id: 'job-orphaned',
                state: 'failed',
                dataset_id: 'dataset-removed',
                progress: {epoch: 0, total_epochs: 0, metrics: {}},
            },
        ];

        render(<TrainingTaskPopup language={Language.CHINESE}/>);

        expect(await screen.findByText('二号数据')).toBeInTheDocument();
        expect(screen.getByText('dataset-removed')).toBeInTheDocument();
        expect(document.querySelectorAll('.JobDataset')).toHaveLength(2);
        expect(screen.getByText('开始训练')).toBeDisabled();
    });

    it('submits chosen saved weights and CPU with validated limits', async () => {
        render(<TrainingTaskPopup language={Language.CHINESE}/>);
        await waitFor(() => expect(screen.getByLabelText('数据集')).toHaveValue('dataset-2'));
        fireEvent.change(screen.getByLabelText('训练设备'), {target: {value: 'cpu'}});
        fireEvent.change(screen.getByLabelText('起始权重'), {target: {value: 'yolov8n-seg'}});
        fireEvent.change(screen.getByLabelText('Epochs'), {target: {value: '0'}});
        expect(screen.getByText('开始训练')).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Epochs'), {target: {value: '1'}});
        await act(async () => {
            fireEvent.click(screen.getByText('开始训练'));
        });
        await waitFor(() => expect(fetch).toHaveBeenCalledWith('https://core.test/core_service/training/jobs',
            expect.objectContaining({method: 'POST', body: JSON.stringify({
                dataset_id: 'dataset-2', model_type: 'yolov8n-seg', device: 'cpu', epochs: 1, imgsz: 640, batch: 16,
            })})));
    });

    it('blocks training until the selected dataset has valid annotations', async () => {
        datasets = [
            {id: 'dataset-2', name: '未标注数据', image_count: 20, classes: ['钢板'], annotated_count: 0},
        ];
        render(<TrainingTaskPopup language={Language.CHINESE}/>);

        expect(await screen.findByText('该数据集没有有效标注，请先在资源中心完成标注')).toBeInTheDocument();
        expect(screen.getByText('开始训练')).toBeDisabled();
        expect(screen.getByRole('heading', {name: '训练系统'})).toBeInTheDocument();
    });

    it('waits for a successful synchronous switch before advertising model readiness', async () => {
        jobs = [{job_id: 'done', state: 'completed', produced_model: 'seg_done', progress: {epoch: 1, total_epochs: 1}}];
        const existingFetch = global.fetch;
        let finish: (response: Response) => void;
        global.fetch = jest.fn((input: RequestInfo | URL, options?: RequestInit) => String(input).endsWith('/switch-model')
            ? new Promise<Response>(resolve => { finish = resolve; }) : existingFetch(input, options));
        const loaded = jest.fn();
        window.addEventListener('opensight:model-loaded', loaded);
        render(<TrainingTaskPopup language={Language.CHINESE}/>);
        fireEvent.click(await screen.findByText('加载到推理任务'));
        expect(screen.getByText('正在加载模型…')).toBeInTheDocument();
        expect(loaded).not.toHaveBeenCalled();
        await act(async () => finish(jsonResponse({status: 'ok', active: 'seg_done'})));
        expect(loaded).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('link', {name: '下载模型'})).toHaveAttribute('href',
            'https://core.test/core_service/training/jobs/done/model');
        window.removeEventListener('opensight:model-loaded', loaded);
    });

    it('shows failed loading and cancellation instead of reporting success', async () => {
        jobs = [
            {job_id: 'done', state: 'completed', produced_model: 'seg_done', progress: {epoch: 1, total_epochs: 1}},
            {job_id: 'running', state: 'running', progress: {epoch: 0, total_epochs: 1}},
        ];
        const existingFetch = global.fetch;
        global.fetch = jest.fn((input: RequestInfo | URL, options?: RequestInit) => options?.method === 'POST'
            ? Promise.resolve({...jsonResponse({detail: 'fixture action failure'}), ok: false, status: 409})
            : existingFetch(input, options));
        const loaded = jest.fn();
        window.addEventListener('opensight:model-loaded', loaded);
        render(<TrainingTaskPopup language={Language.CHINESE}/>);
        fireEvent.click(await screen.findByText('加载到推理任务'));
        expect(await screen.findByRole('alert')).toHaveTextContent('fixture action failure');
        expect(loaded).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('取消'));
        expect(await screen.findByRole('alert')).toHaveTextContent('fixture action failure');
        expect(screen.getByText('训练中')).toBeInTheDocument();
        window.removeEventListener('opensight:model-loaded', loaded);
    });

    it('shows the bounded log returned by the backend', async () => {
        jobs = [{job_id: 'done', state: 'failed', progress: {epoch: 0, total_epochs: 1}}];
        const existingFetch = global.fetch;
        global.fetch = jest.fn((input: RequestInfo | URL, options?: RequestInit) => String(input).endsWith('/log')
            ? Promise.resolve(jsonResponse({log: 'epoch 1: fixture log'})) : existingFetch(input, options));
        render(<TrainingTaskPopup language={Language.CHINESE}/>);
        fireEvent.click(await screen.findByText('查看 / 刷新日志'));
        expect(await screen.findByText('epoch 1: fixture log')).toBeInTheDocument();
    });
});
