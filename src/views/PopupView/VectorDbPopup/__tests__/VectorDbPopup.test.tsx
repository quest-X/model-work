import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {VectorDbPopup} from '../VectorDbPopup';

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

const collection = {
    name: 'frame_index',
    display_name: '产线帧库',
    dim: 768,
    embedder: 'dinov2:base',
    granularity: 'image',
    mode: 'images',
    count: 12,
    search_count: 37,
    created_at: '2026-07-20T10:00:00',
    last_ingest_at: '2026-07-20T11:00:00',
    schema_version: 2,
    profile_id: 'fp_test_image',
    profile: {profile_id: 'fp_test_image', model: 'dinov2:base', dimension: 768, granularity: 'image', metric: 'COSINE'},
    library_id: 'library_test',
    target_id: 'target_test',
    target_name: '产线帧库',
    scene_id: 'scene_line_1',
    scene_name: '一号产线',
    world_id: null,
    version: 1,
    data_version: 4,
    active: true,
    index_type: 'IVF_FLAT',
    index_params: {nlist: 1024},
    compatible: true,
    compatibility_reason: null,
    quality: {valid_vectors: 12, invalid_vectors: 0, norm_min: 1, norm_max: 1, norm_mean: 1},
};

const readyStatus = {
    status: 'ok',
    vector_store: {state: 'ready', db_path: '/data/vector.db', error: null},
    embedder: {
        state: 'ready', progress: 100, backend: 'dinov2', model: 'facebook/dinov2-base',
        dim: 768, device: 'mps', error: null,
    },
    collections_count: 1,
};

const jsonResponse = (body: unknown, status = 200): Response => ({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
} as unknown as Response);

describe('VectorDbPopup', () => {
    let statusBody: typeof readyStatus;
    let collectionList: Array<typeof collection>;
    let jobList: Array<Record<string, unknown>>;

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
        statusBody = readyStatus;
        collectionList = [collection];
        jobList = [];
        global.fetch = jest.fn((input: RequestInfo, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/status')) return Promise.resolve(jsonResponse(statusBody));
            if (url.endsWith('/versions') && init?.method === 'POST') {
                return Promise.resolve(jsonResponse({...collection, name: 'frame_index_v2', version: 2}));
            }
            if (url.endsWith('/targets') && init?.method === 'POST') {
                const request = JSON.parse(String(init.body));
                return Promise.resolve(jsonResponse({
                    ...collection,
                    name: request.target_name,
                    display_name: request.target_name,
                    target_name: request.target_name,
                    scene_name: request.scene_name,
                    granularity: request.granularity,
                }, 201));
            }
            if (url.endsWith('/collections')) {
                return Promise.resolve(jsonResponse({status: 'success', collections: collectionList}));
            }
            if (url.endsWith('/datasets')) {
                return Promise.resolve(jsonResponse({datasets: [{id: 'dataset-1', name: '一号产线', image_count: 24}]}));
            }
            if (url.includes('/jobs/job-history-1/images?')) {
                return Promise.resolve(jsonResponse({
                    status: 'success',
                    job_id: 'job-history-1',
                    total: 24,
                    offset: 0,
                    limit: 30,
                    images: [
                        {index: 0, filename: 'frame-001.jpg'},
                        {index: 1, filename: 'frame-002.jpg'},
                    ],
                }));
            }
            if (url.endsWith('/jobs')) return Promise.resolve(jsonResponse({status: 'success', jobs: jobList}));
            if (url.endsWith('/warmup')) return Promise.resolve(jsonResponse({status: 'accepted'}));
            if (url.includes('/ingest')) return Promise.resolve(jsonResponse({status: 'accepted', job_id: 'job-1'}));
            return Promise.resolve(jsonResponse({status: 'success'}));
        }) as jest.Mock;
    });

    it('keeps vector management focused on ingest and persistent history', async () => {
        render(<VectorDbPopup language={Language.CHINESE}/>);

        expect((await screen.findAllByText('产线帧库')).length).toBeGreaterThan(0);
        expect(screen.getByRole('tab', {name: '入库记录'})).toBeInTheDocument();
        expect(screen.queryByRole('tab', {name: '快速向量检索'})).not.toBeInTheDocument();
        expect(screen.getByText(/检索功能统一放在「视觉检索」/)).toBeInTheDocument();
        expect(screen.getByText('特征配置')).toBeInTheDocument();
        const targetHeading = screen.getByRole('heading', {name: '产线帧库'});
        expect(targetHeading.parentElement).toHaveClass('CollectionNameRow');
        expect(within(targetHeading.parentElement as HTMLElement).getByText('整张图片 · v4'))
            .toBeInTheDocument();
        const metadata = document.querySelector('.MetadataGrid');
        expect(metadata).not.toBeNull();
        expect(within(metadata as HTMLElement).getByText('数据版本').closest('div'))
            .toHaveTextContent('v4 · 4 次成功入库');
        expect(screen.getByText('检索次数').closest('div')).toHaveTextContent('37');
    });

    it('defaults legacy collection search count to zero', async () => {
        const legacyCollection: Partial<typeof collection> = {...collection};
        delete legacyCollection.search_count;
        collectionList = [legacyCollection as typeof collection];

        render(<VectorDbPopup language={Language.CHINESE}/>);

        await screen.findAllByText('产线帧库');
        expect(screen.getByText('检索次数').closest('div')).toHaveTextContent('0');
    });

    it('groups physical indexes as scene, target and version nodes', async () => {
        collectionList = [
            collection,
            {...collection, name: 'frame_index_v2', version: 2, data_version: 2, active: false, count: 0},
        ];
        render(<VectorDbPopup language={Language.CHINESE}/>);

        expect((await screen.findAllByText('一号产线')).length).toBeGreaterThan(0);
        expect(screen.getByText('v4')).toBeInTheDocument();
        expect(screen.getByText('v2')).toBeInTheDocument();
        expect(document.querySelectorAll('.TargetGroup')).toHaveLength(1);
    });

    it('does not warm up implicitly and exposes an explicit model load action', async () => {
        statusBody = {...readyStatus, embedder: {...readyStatus.embedder, state: 'not_loaded', progress: 0}};
        render(<VectorDbPopup language={Language.CHINESE}/>);

        const loadButton = await screen.findByRole('button', {name: '加载特征模型'});
        expect((global.fetch as jest.Mock).mock.calls.some(([url, init]) =>
            String(url).endsWith('/warmup') && init?.method === 'POST')).toBe(false);

        await act(async () => {
            fireEvent.click(loadButton);
        });
        await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([url, init]) =>
            String(url).endsWith('/warmup') && init?.method === 'POST')).toBe(true));
    });

    it('creates a target in a scene with the explicitly selected immutable vector unit', async () => {
        render(<VectorDbPopup language={Language.CHINESE}/>);
        await screen.findAllByText('产线帧库');

        fireEvent.click(screen.getByRole('button', {name: /新建目标/}));
        fireEvent.click(screen.getByRole('radio', {name: /整张图片/}));
        fireEvent.change(screen.getByRole('combobox', {name: '场景名称'}), {
            target: {value: '__new_scene__'},
        });
        fireEvent.change(screen.getByPlaceholderText('例如：钢板产线'), {target: {value: '二号产线'}});
        fireEvent.change(screen.getByPlaceholderText('例如：划痕'), {target: {value: '缺陷整图库'}});
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: '创建目标'}));
        });

        await waitFor(() => {
            const createCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) =>
                String(url).endsWith('/targets') && init?.method === 'POST');
            expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
                scene_name: '二号产线',
                target_name: '缺陷整图库',
                granularity: 'image',
            });
        });
    });

    it('creates a strict mask target from the vector-unit picker', async () => {
        render(<VectorDbPopup language={Language.CHINESE}/>);
        await screen.findAllByText('产线帧库');

        fireEvent.click(screen.getByRole('button', {name: /新建目标/}));
        fireEvent.click(screen.getByRole('radio', {name: /分割区域/}));
        fireEvent.change(screen.getByPlaceholderText('例如：划痕'), {target: {value: '大鹅分割库'}});
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: '创建目标'}));
        });

        await waitFor(() => {
            const createCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) =>
                String(url).endsWith('/targets') && init?.method === 'POST');
            expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
                scene_id: 'scene_line_1',
                scene_name: '一号产线',
                target_name: '大鹅分割库',
                granularity: 'mask',
            });
        });
    });

    it('uses a real scene selector and preserves the existing scene id', async () => {
        render(<VectorDbPopup language={Language.CHINESE}/>);
        await screen.findAllByText('产线帧库');

        fireEvent.click(screen.getByRole('button', {name: /新建目标/}));
        const sceneSelect = screen.getByRole('combobox', {name: '场景名称'});
        expect(sceneSelect).toHaveValue('一号产线');
        expect(within(sceneSelect).getByRole('option', {name: '一号产线'})).toBeInTheDocument();
        fireEvent.change(screen.getByPlaceholderText('例如：划痕'), {target: {value: '划痕目标'}});
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: '创建目标'}));
        });

        await waitFor(() => {
            const createCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) =>
                String(url).endsWith('/targets') && init?.method === 'POST');
            expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
                scene_id: 'scene_line_1',
                scene_name: '一号产线',
                target_name: '划痕目标',
                granularity: 'bbox',
            });
        });
    });

    it('always ingests with the selected collection mode', async () => {
        render(<VectorDbPopup language={Language.CHINESE}/>);
        await screen.findAllByText('产线帧库');
        await screen.findByRole('option', {name: '一号产线（24）'});
        await screen.findByText('向量存储就绪');
        await act(async () => {
            await new Promise(resolve => window.setTimeout(resolve, 0));
        });

        const datasetSelect = screen.getByRole('combobox');
        fireEvent.change(datasetSelect, {target: {value: 'dataset-1'}});
        await waitFor(() => expect(datasetSelect).toHaveValue('dataset-1'));
        const ingestButton = screen.getByRole('button', {name: '开始生成向量'});
        await waitFor(() => expect(ingestButton).toBeEnabled());
        await act(async () => {
            fireEvent.click(ingestButton);
        });

        await waitFor(() => {
            const ingestCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes('/ingest'));
            const body = ingestCall?.[1]?.body as FormData;
            expect(body.get('granularity')).toBe('image');
            expect(body.get('dataset_id')).toBe('dataset-1');
        });
    });

    it('keeps mask ingest dataset-only and submits the immutable mask granularity', async () => {
        collectionList = [{
            ...collection,
            granularity: 'mask',
            mode: 'masks',
            profile_id: 'fp_test_mask',
            profile: {...collection.profile, profile_id: 'fp_test_mask', granularity: 'mask'},
        }];
        render(<VectorDbPopup language={Language.CHINESE}/>);

        expect((await screen.findAllByText('分割区域')).length).toBeGreaterThan(0);
        expect(screen.getByText(/入库和检索严格保持 mask→mask/)).toBeInTheDocument();
        expect(screen.getByRole('tab', {name: '本地上传'})).toBeDisabled();
        const datasetSelect = await screen.findByRole('combobox');
        await screen.findByRole('option', {name: '一号产线（24）'});
        await screen.findByText('向量存储就绪');
        fireEvent.change(datasetSelect, {target: {value: 'dataset-1'}});
        const ingestButton = screen.getByRole('button', {name: '开始生成向量'});
        await waitFor(() => expect(ingestButton).toBeEnabled());
        await act(async () => {
            fireEvent.click(ingestButton);
        });

        await waitFor(() => {
            const ingestCall = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
                String(url).includes('/ingest'));
            const body = ingestCall?.[1]?.body as FormData;
            expect(body.get('granularity')).toBe('mask');
            expect(body.get('dataset_id')).toBe('dataset-1');
        });
    });

    it('blocks an incompatible profile and creates a current-model physical version', async () => {
        collectionList = [{
            ...collection,
            compatible: false,
            compatibility_reason: 'fp_old 与 fp_current 不兼容',
        }];
        render(<VectorDbPopup language={Language.CHINESE}/>);

        expect(await screen.findByText('当前特征模型与这个索引不兼容')).toBeInTheDocument();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: '新建当前模型索引'}));
        });

        await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([url, init]) =>
            String(url).endsWith('/versions') && init?.method === 'POST')).toBe(true));
    });

    it('offers an existing compatible target version instead of duplicating its profile', async () => {
        collectionList = [
            {...collection, compatible: false, compatibility_reason: '旧模型不兼容'},
            {...collection, name: 'frame_index_v2', version: 2, active: false},
        ];
        render(<VectorDbPopup language={Language.CHINESE}/>);

        const switchButton = await screen.findByRole('button', {name: '切换到兼容的 v2'});
        fireEvent.click(switchButton);
        expect(screen.getByText('v4 · 4 次成功入库')).toBeInTheDocument();
        expect((global.fetch as jest.Mock).mock.calls.some(([url, init]) =>
            String(url).endsWith('/versions') && init?.method === 'POST')).toBe(false);
    });

    it('shows persisted ingest records for the selected physical version', async () => {
        jobList = [{
            job_id: 'job-history-1',
            state: 'completed',
            collection: 'frame_index',
            granularity: 'image',
            source: 'dataset',
            dataset_id: 'dataset-1',
            total_images: 24,
            processed_images: 24,
            inserted_objects: 0,
            inserted_vectors: 24,
            skipped_images: 1,
            failed_images: 0,
            invalid_vectors: 0,
            throughput_images_per_sec: 12,
            eta_seconds: null,
            resumable: false,
            error: null,
            started_at: '2026-07-22T15:00:00',
            updated_at: '2026-07-22T15:00:02',
            finished_at: '2026-07-22T15:00:02',
        }];
        render(<VectorDbPopup language={Language.CHINESE}/>);

        await screen.findAllByText('产线帧库');
        fireEvent.click(screen.getByRole('tab', {name: '入库记录'}));

        expect(await screen.findByText('版本更新')).toBeInTheDocument();
        expect(document.querySelector('.HistoryVersion')).toHaveTextContent('v4');
        expect(screen.getByText('dataset-1')).toBeInTheDocument();
        expect(screen.getByText(/24\/24 · 24 向量/)).toBeInTheDocument();
        expect(screen.getByText(/1 跳过/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: /查看 24 张入库图片/}));
        const thumbnail = await screen.findByRole('button', {name: '放大 frame-001.jpg'});
        expect(thumbnail).toHaveAttribute('aria-label', '放大 frame-001.jpg');
        expect((global.fetch as jest.Mock).mock.calls.some(([url]) =>
            String(url).includes('/jobs/job-history-1/images?offset=0&limit=12'))).toBe(true);
        expect(screen.getByRole('button', {name: '加载更多（2/24）'})).toBeInTheDocument();

        fireEvent.click(thumbnail);
        const preview = screen.getByRole('dialog', {name: '入库图片预览'});
        expect(within(preview).getByRole('img', {name: 'frame-001.jpg'})).toHaveAttribute(
            'src',
            'https://extension.test/extension_service/vector_db/jobs/job-history-1/images/0/original',
        );
        expect(within(preview).getByText('1/2')).toBeInTheDocument();
        expect(within(preview).getByRole('button', {name: '上一张'})).toBeDisabled();
        fireEvent.click(within(preview).getByRole('button', {name: '下一张'}));
        expect(within(preview).getByRole('img', {name: 'frame-002.jpg'})).toHaveAttribute(
            'src',
            'https://extension.test/extension_service/vector_db/jobs/job-history-1/images/1/original',
        );
        expect(within(preview).getByText('2/2')).toBeInTheDocument();
        fireEvent.keyDown(window, {key: 'ArrowLeft'});
        expect(within(preview).getByRole('img', {name: 'frame-001.jpg'})).toBeInTheDocument();
        fireEvent.click(within(preview).getByRole('button', {name: '关闭图片预览'}));
        expect(screen.queryByRole('dialog', {name: '入库图片预览'})).not.toBeInTheDocument();
    });

    it('requires the exact scene, target and version identifier before deleting a terminal record', async () => {
        jobList = [{
            job_id: 'job-history-1',
            state: 'completed',
            data_version: 4,
            collection: 'frame_index',
            granularity: 'image',
            source: 'dataset',
            dataset_id: 'missing-dataset',
            total_images: 24,
            processed_images: 24,
            inserted_objects: 0,
            inserted_vectors: 24,
            skipped_images: 0,
            failed_images: 0,
            invalid_vectors: 0,
            throughput_images_per_sec: 12,
            eta_seconds: null,
            resumable: false,
            error: null,
            started_at: '2026-07-22T15:00:00',
            updated_at: '2026-07-22T15:00:02',
            finished_at: '2026-07-22T15:00:02',
        }];
        render(<VectorDbPopup language={Language.CHINESE}/>);

        await screen.findAllByText('产线帧库');
        fireEvent.click(screen.getByRole('tab', {name: '入库记录'}));
        fireEvent.click(await screen.findByRole('button', {name: '删除 v4 版本记录'}));

        const dialog = screen.getByRole('dialog', {name: '删除版本 一号产线/产线帧库/v4'});
        expect(within(dialog).getByText(/只删除这条版本历史记录，不会回滚或修改当前向量数据/))
            .toBeInTheDocument();
        const confirmationInput = within(dialog).getByRole('textbox', {name: '输入版本标识以确认删除'});
        const deleteButton = within(dialog).getByRole('button', {name: '删除'});
        expect(deleteButton).toBeDisabled();
        fireEvent.change(confirmationInput, {target: {value: '一号产线/产线帧库/v3'}});
        expect(deleteButton).toBeDisabled();
        expect((global.fetch as jest.Mock).mock.calls.some(([url, init]) =>
            String(url).endsWith('/jobs/job-history-1') && init?.method === 'DELETE')).toBe(false);
        fireEvent.change(confirmationInput, {target: {value: '一号产线/产线帧库/v4'}});
        expect(deleteButton).toBeEnabled();
        await act(async () => {
            fireEvent.click(deleteButton);
        });

        await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([url, init]) =>
            String(url).endsWith('/jobs/job-history-1') && init?.method === 'DELETE')).toBe(true));
        expect(screen.queryByText('missing-dataset')).not.toBeInTheDocument();
    });
});
