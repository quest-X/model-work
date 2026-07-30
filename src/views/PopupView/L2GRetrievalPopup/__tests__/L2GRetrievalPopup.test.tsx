import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {L2GRetrievalPopup} from '../L2GRetrievalPopup';

jest.mock('../../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({title, renderContent}: {title: React.ReactNode; renderContent: () => React.ReactNode}) => (
        <div><h1>{title}</h1>{renderContent()}</div>
    ),
}));

jest.mock('../../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));

jest.mock('../../../../utils/DefaultBackendUrl', () => ({
    getEngineBaseUrl: () => 'https://core.test/core_service',
    getExtensionEngineBaseUrl: () => 'https://extension.test/extension_service',
}));

const jsonResponse = (body: unknown, status = 200): Response => ({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
} as unknown as Response);

const dinoCollection = {
    name: 'gangye_v1',
    display_name: 'gangye',
    target_name: 'gangye',
    scene_name: 'gbyw',
    version: 1,
    granularity: 'image',
    count: 465,
    embedder: 'dinov3:dinov3_vith16plus',
    profile_id: 'fp_fcc2c772628f1317',
    compatible: true,
    compatibility_reason: null,
};

describe('VisualRetrievalPopup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(URL, 'createObjectURL', {
            configurable: true,
            value: jest.fn(() => 'blob:query-preview'),
        });
        Object.defineProperty(URL, 'revokeObjectURL', {
            configurable: true,
            value: jest.fn(),
        });
        global.fetch = jest.fn((input: RequestInfo, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/vector_db/status')) {
                return Promise.resolve(jsonResponse({
                    status: 'ok',
                    vector_store: {state: 'ready', error: null},
                    embedder: {state: 'ready', progress: 100, model: 'dinov3_vith16plus', dim: 1280, device: 'cuda', error: null},
                }));
            }
            if (url.endsWith('/vector_db/collections')) {
                return Promise.resolve(jsonResponse({status: 'success', collections: [dinoCollection]}));
            }
            if (url.endsWith('/l2g_retrieval/status')) {
                return Promise.resolve(jsonResponse({
                    status: 'ok', version: '1.0', pipeline: {state: 'ready', error: null},
                    config_file: '/tmp/l2g.yaml', defaults: {top_k: 10, max_database_size: 1000},
                }));
            }
            if (url === 'https://core.test/core_service/datasets') {
                return Promise.resolve(jsonResponse({
                    datasets: [{
                        id: 'dataset-1', name: '导入标注', project_name: 'gbyw',
                        image_count: 465, revision: 1, status: 'ready',
                    }],
                }));
            }
            if (url.endsWith('/vector_db/search') && init?.method === 'POST') {
                return Promise.resolve(jsonResponse({
                    results: [{score: 0.973, filename: 'frame_006483.jpg', class_name: '', thumbnail: 'data:image/jpeg;base64,AA=='}],
                }));
            }
            if (url.endsWith('/l2g_retrieval/search') && init?.method === 'POST') {
                return Promise.resolve(jsonResponse({
                    elapsed_s: 1.2,
                    results: [{score: 0.991, path: 'frame_006483', thumbnail: 'data:image/jpeg;base64,AA=='}],
                }));
            }
            return Promise.resolve(jsonResponse({status: 'ok'}));
        }) as jest.Mock;
    });

    it('provides one visual retrieval entry for DINO and L2G', async () => {
        render(<L2GRetrievalPopup language={Language.CHINESE}/>);

        expect(screen.getByRole('heading', {name: '视觉检索'})).toBeInTheDocument();
        expect(screen.getByRole('tab', {name: /快速模式/})).toBeInTheDocument();
        expect(screen.getByRole('tab', {name: /高精度模式/})).toBeInTheDocument();
        expect(await screen.findByText('特征配置')).toBeInTheDocument();
        expect(screen.getByText('fp_fcc2c772628f1317')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', {name: /高精度模式/}));
        expect(await screen.findByLabelText('场景')).toHaveValue('gbyw');
        expect(screen.getByLabelText('目标')).toHaveValue('导入标注');
        expect(screen.getByLabelText('版本')).toHaveValue('dataset-1');
        expect(screen.getByRole('option', {name: /v1 · 465 张/})).toBeInTheDocument();
        expect(screen.getByText(/复用数据中心的唯一原图/)).toBeInTheDocument();
    });

    it('binds DINO search to the selected physical vector version', async () => {
        const {container} = render(<L2GRetrievalPopup language={Language.CHINESE}/>);
        await screen.findByText('fp_fcc2c772628f1317');

        const input = container.querySelector('.QueryDropzone input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, {target: {files: [new File(['image'], 'query.png', {type: 'image/png'})]}});
        const button = screen.getByRole('button', {name: '开始视觉检索'});
        await waitFor(() => expect(button).toBeEnabled());
        await act(async () => {
            fireEvent.click(button);
        });

        await screen.findByText('97.3%');
        const searchCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) =>
            String(url).endsWith('/vector_db/search') && init?.method === 'POST');
        const body = searchCall?.[1]?.body as FormData;
        expect(body.get('collection')).toBe('gangye_v1');
        expect(body.get('file')).toBeInstanceOf(File);
    });

    it('binds precision search to a structured data-center dataset', async () => {
        const {container} = render(<L2GRetrievalPopup language={Language.CHINESE}/>);
        fireEvent.click(screen.getByRole('tab', {name: /高精度模式/}));
        await screen.findByRole('option', {name: /v1 · 465 张/});

        const input = container.querySelector('.QueryDropzone input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, {target: {files: [new File(['image'], 'query.png', {type: 'image/png'})]}});
        const button = screen.getByRole('button', {name: '开始视觉检索'});
        await waitFor(() => expect(button).toBeEnabled());
        await act(async () => {
            fireEvent.click(button);
        });

        await screen.findByText('99.1%');
        const searchCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) =>
            String(url).endsWith('/l2g_retrieval/search') && init?.method === 'POST');
        const body = searchCall?.[1]?.body as FormData;
        expect(body.get('dataset_id')).toBe('dataset-1');
        expect(body.get('database_dir')).toBeNull();
    });

    it('preserves each engine result when switching modes', async () => {
        const {container} = render(<L2GRetrievalPopup language={Language.CHINESE}/>);
        await screen.findByText('fp_fcc2c772628f1317');

        const input = container.querySelector('.QueryDropzone input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, {target: {files: [new File(['image'], 'query.png', {type: 'image/png'})]}});

        const runSearch = async () => {
            const button = screen.getByRole('button', {name: '开始视觉检索'});
            await waitFor(() => expect(button).toBeEnabled());
            await act(async () => {
                fireEvent.click(button);
            });
        };

        await runSearch();
        expect(await screen.findByText('97.3%')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', {name: /高精度模式/}));
        await screen.findByRole('option', {name: /v1 · 465 张/});
        expect(screen.queryByText('97.3%')).not.toBeInTheDocument();

        await runSearch();
        expect(await screen.findByText('99.1%')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', {name: /快速模式/}));
        expect(await screen.findByText('97.3%')).toBeInTheDocument();
        expect(screen.queryByText('99.1%')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', {name: /高精度模式/}));
        expect(await screen.findByText('99.1%')).toBeInTheDocument();
    });
});
