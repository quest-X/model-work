import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {PopupWindowType} from '../../../../data/enums/PopupWindowType';
import {QueueDataSyncStatus, QueueItemStatus, QueueItemType} from '../../../../store/queue/types';
import {DataBatchSyncService} from '../../../../services/DataBatchSyncService';
import {TrainingDatasetSelection} from '../../../../services/TrainingDatasetSelection';
import {
    DatasetEditSelection,
    DatasetExportSelection,
    DatasetInferenceSelection,
} from '../../../../services/DatasetActionSelection';
import {PendingImportFiles} from '../../../../utils/PendingImportFiles';
import {DataCenterPopup} from '../DataCenterPopup';

jest.mock('../../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({title, renderContent}: {title: React.ReactNode; renderContent: () => React.ReactNode}) => (
        <div><h1>{title}</h1>{renderContent()}</div>
    ),
}));

jest.mock('../../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));

jest.mock('../../../../logic/actions/QueueActions', () => ({
    QueueActions: {switchToQueueItem: jest.fn().mockResolvedValue(undefined)},
}));

jest.mock('../../../../logic/imageRepository/ImageRepository', () => ({
    ImageRepository: {
        getFileCacheSnapshot: jest.fn(() => []),
        hasFileCache: jest.fn(() => false),
    },
}));

jest.mock('../../../../services/DataBatchSyncService', () => ({
    DataBatchSyncService: {syncQueueItem: jest.fn().mockResolvedValue({dataset_id: 'dataset-1', revision: 1})},
}));

jest.mock('../../../../services/TrainingDatasetSelection', () => ({
    TrainingDatasetSelection: {set: jest.fn(), get: jest.fn()},
}));

jest.mock('../../../../services/DatasetActionSelection', () => ({
    DatasetEditSelection: {set: jest.fn(), get: jest.fn()},
    DatasetExportSelection: {set: jest.fn(), get: jest.fn()},
    DatasetInferenceSelection: {set: jest.fn(), get: jest.fn()},
}));

jest.mock('../../../../utils/PendingImportFiles', () => ({
    PendingImportFiles: {set: jest.fn(), take: jest.fn()},
}));

jest.mock('../../../../utils/DefaultBackendUrl', () => ({
    getEngineBaseUrl: () => 'https://core.test/core_service',
}));

const jsonResponse = (body: unknown, status = 200): Response => ({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    blob: jest.fn().mockResolvedValue(new Blob(['archive'], {type: 'application/zip'})),
} as unknown as Response);

const localItem = {
    id: 'queue-1',
    name: '导入标注',
    type: QueueItemType.FOLDER,
    files: [new File(['image'], 'frame.jpg', {type: 'image/jpeg'})],
    status: QueueItemStatus.COMPLETED,
    uploadedAt: 1,
    dataSyncStatus: QueueDataSyncStatus.LOCAL,
};

const dataset = {
    id: 'dataset-1',
    name: 'default-project',
    project_name: 'default-project',
    created_at: '2026-07-22T00:00:00Z',
    image_count: 465,
    classes: ['gangye'],
    format: 'opensight-batch',
    source_type: 'file_queue',
    source_id: 'queue-1',
    revision: 2,
    status: 'ready',
    updated_at: '2026-07-22T01:00:00Z',
    last_task_at: '2026-07-22T02:00:00Z',
    last_task_type: 'training',
    versions: [
        {
            revision: 1,
            operation_type: 'raw',
            created_at: '2026-07-22T00:00:00Z',
            image_count: 465,
        },
        {
            revision: 2,
            operation_type: 'cleaning',
            operation_name: '数据清洗 A',
            created_at: '2026-07-22T01:00:00Z',
            parent_revision: 1,
            image_count: 465,
        },
    ],
};

const modelAssets = [
    {
        name: 'yolo26x',
        type: 'detection',
        format: 'pt',
        size_bytes: 128 * 1024 * 1024,
        modified_at: '2026-07-20T00:00:00Z',
        source: 'cache',
    },
    {
        id: 'server:gangye-v2',
        name: 'gangye-seg-v2',
        type: 'custom',
        format: 'pt',
        size_bytes: 256 * 1024 * 1024,
        modified_at: '2026-07-24T00:00:00Z',
        source: 'server',
        project: 'GBYW',
        category: '正式及预训练模型',
        path: '/home/baosight/data/lch/sdgt-projects/gbyw/models/gangye-seg-v2.pt',
        callable: true,
    },
    {
        id: 'server:archive-engine',
        name: 'gangye-seg-v2.engine',
        type: 'segmentation',
        format: 'engine',
        size_bytes: 300 * 1024 * 1024,
        modified_at: '2026-07-23T00:00:00Z',
        source: 'server',
        project: 'GBYW',
        category: '训练及矩阵实验输出',
        path: '/home/baosight/data/lch/sdgt-projects/gbyw/data/training/gangye-seg-v2.engine',
        callable: false,
    },
];

describe('DataCenterPopup', () => {
    const updateActivePopupTypeAction = jest.fn();
    const updateQueueItemAction = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn((input: RequestInfo, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/datasets')) return Promise.resolve(jsonResponse({datasets: [dataset]}));
            if (url.endsWith('/available-models')) {
                return Promise.resolve(jsonResponse({
                    models: modelAssets,
                    catalog: {
                        asset_count: 2,
                        callable_count: 1,
                        project_counts: {GBYW: 2},
                    },
                }));
            }
            if (url.endsWith('/health')) {
                return Promise.resolve(jsonResponse({
                    model: 'yolo26x.pt',
                    segmentation_model: '',
                    loaded_models: ['yolo26x.pt'],
                    model_tasks: {'yolo26x.pt': 'detect'},
                }));
            }
            if (url.endsWith('/switch-model') && init?.method === 'POST') {
                return Promise.resolve(jsonResponse({status: 'ok', active: 'gangye-seg-v2.pt'}));
            }
            if (url.endsWith('/model-assets/sync') && init?.method === 'POST') {
                return Promise.resolve(jsonResponse({
                    status: 'synced',
                    model: 'yolo26x.pt',
                    source: 'managed',
                }));
            }
            if (url.endsWith('/datasets/dataset-1/stats')) {
                return Promise.resolve(jsonResponse({
                    image_count: 465,
                    annotated_count: 465,
                    annotation_coverage: 1,
                    class_distribution: {gangye: 465},
                }));
            }
            return Promise.resolve(jsonResponse({status: 'success'}));
        }) as jest.Mock;
    });

    const renderPopup = () => render(<DataCenterPopup
        language={Language.CHINESE}
        projectName='default-project'
        queueItems={[localItem]}
        activeQueueItemId='queue-1'
        imagesData={[]}
        labels={[]}
        updateActivePopupTypeAction={updateActivePopupTypeAction}
        updateQueueItemAction={updateQueueItemAction}
    />);

    it('separates browser work data from server snapshots', async () => {
        renderPopup();
        await screen.findByRole('tab', {name: '持久化数据 1'});

        expect(screen.getByRole('heading', {name: '资源中心'})).toBeInTheDocument();
        expect(screen.getByRole('tablist', {name: '资源类型'})).toBeInTheDocument();
        expect(screen.getByRole('tab', {name: '数据'})).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tablist', {name: '数据存储层级'})).toHaveAttribute('aria-orientation', 'vertical');
        expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'resource-module-data');
        expect(screen.getByRole('region', {name: '临时数据 1'}))
            .toHaveAttribute('aria-labelledby', 'resource-tier-data-temporary');

        expect(screen.getByText('前端临时数据', {selector: '.TierExplanation strong'})).toBeInTheDocument();
        expect(screen.getByText('default-project', {selector: '.DataCardTitleRow strong'})).toBeInTheDocument();
        expect(screen.queryByText('当前项目')).not.toBeInTheDocument();
        expect(screen.queryByText('导入标注')).not.toBeInTheDocument();
        expect(screen.getByText('仅本地')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '使用'})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '查看 / 标注'})).not.toBeInTheDocument();
        expect(screen.queryByText('服务器数据快照')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', {name: /持久化数据/}));
        expect(await screen.findByText('后端持久化数据')).toBeInTheDocument();
        expect(screen.getByRole('region', {name: '持久化数据 1'}))
            .toHaveAttribute('aria-labelledby', 'resource-tier-data-persistent');
        expect(await screen.findByText('default-project', {selector: '.DatasetName'})).toBeInTheDocument();
        expect(screen.getByText('已就绪')).toBeInTheDocument();
        expect(screen.getByText(/项目 default-project/)).toBeInTheDocument();
    });

    it('supports keyboard navigation across resource modules and storage tiers', async () => {
        renderPopup();
        const temporaryTab = await screen.findByRole('tab', {name: '临时数据 1'});
        const persistentTab = await screen.findByRole('tab', {name: '持久化数据 1'});

        temporaryTab.focus();
        fireEvent.keyDown(temporaryTab, {key: 'ArrowDown'});

        expect(persistentTab).toHaveAttribute('aria-selected', 'true');
        expect(persistentTab).toHaveFocus();
        expect(screen.getByRole('region', {name: '持久化数据 1'}))
            .toHaveAttribute('aria-labelledby', 'resource-tier-data-persistent');

        const dataTab = screen.getByRole('tab', {name: '数据'});
        const modelsTab = screen.getByRole('tab', {name: '模型'});
        dataTab.focus();
        fireEvent.keyDown(dataTab, {key: 'ArrowRight'});
        expect(modelsTab).toHaveFocus();
        expect(modelsTab).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'resource-module-models');
        expect(screen.getByRole('tablist', {name: '模型存储层级'})).toBeInTheDocument();
        expect(await screen.findByRole('tab', {name: '临时模型 1'})).toHaveAttribute('aria-selected', 'true');
    });

    it('manages callable model-file versions in the resource center', async () => {
        renderPopup();
        fireEvent.click(await screen.findByRole('tab', {name: '模型'}));

        expect(await screen.findByRole('tab', {name: '临时模型 1'})).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('临时模型（运行内存）')).toBeInTheDocument();
        expect(screen.getByText('yolo26x.pt')).toBeInTheDocument();
        expect(screen.getByText('检测槽正在使用')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '同步至服务器'})).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: '同步至服务器'}));
        });
        await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([url, init]) =>
            String(url).endsWith('/model-assets/sync')
            && init?.method === 'POST'
            && JSON.parse(String(init.body)).model === 'yolo26x')).toBe(true));

        fireEvent.click(screen.getByRole('tab', {name: '持久化模型 2'}));
        expect(await screen.findByText('持久化模型资源')).toBeInTheDocument();
        expect(screen.queryByText('yolo26x.pt')).not.toBeInTheDocument();
        expect(screen.getByText('gangye-seg-v2.pt')).toBeInTheDocument();
        expect(screen.getByText('256.0 MiB')).toBeInTheDocument();
        expect(screen.getAllByText('205 资产目录')).toHaveLength(2);
        expect(screen.getByText('正式及预训练模型')).toBeInTheDocument();
        expect(screen.getByTitle(/sdgt-projects\/gbyw\/models\/gangye-seg-v2.pt/)).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '仅归档'})).toBeDisabled();

        const sortSelect = screen.getByRole('combobox', {name: '模型排序'});
        const typeSelect = screen.getByRole('combobox', {name: '模型类型'});
        expect(sortSelect).toHaveValue('relevance');
        expect(typeSelect).toHaveValue('all');
        expect(within(typeSelect).getByRole('option', {name: 'PT'})).toBeInTheDocument();
        expect(within(typeSelect).getByRole('option', {name: 'ENGINE'})).toBeInTheDocument();

        fireEvent.change(typeSelect, {target: {value: 'ENGINE'}});
        expect(screen.queryByText('gangye-seg-v2.pt')).not.toBeInTheDocument();
        expect(screen.getByText('gangye-seg-v2.engine')).toBeInTheDocument();
        expect(screen.getByText('显示 1 / 2')).toBeInTheDocument();

        fireEvent.change(typeSelect, {target: {value: 'all'}});
        fireEvent.change(sortSelect, {target: {value: 'name'}});
        let modelCards = Array.from(document.querySelectorAll('.ModelResourceList:not(.RuntimeModelList) .ModelResourceCard'));
        expect(modelCards[0]).toHaveTextContent('gangye-seg-v2.engine');

        fireEvent.change(sortSelect, {target: {value: 'recent'}});
        modelCards = Array.from(document.querySelectorAll('.ModelResourceList:not(.RuntimeModelList) .ModelResourceCard'));
        expect(modelCards[0]).toHaveTextContent('gangye-seg-v2.pt');

        fireEvent.change(sortSelect, {target: {value: 'size'}});
        modelCards = Array.from(document.querySelectorAll('.ModelResourceList:not(.RuntimeModelList) .ModelResourceCard'));
        expect(modelCards[0]).toHaveTextContent('gangye-seg-v2.engine');

        const customCard = screen.getByText('gangye-seg-v2.pt').closest('.ModelResourceCard');
        expect(customCard).not.toBeNull();
        await act(async () => {
            fireEvent.click(within(customCard as HTMLElement).getByRole('button', {name: '使用'}));
        });
        await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([url, init]) =>
            String(url).endsWith('/switch-model')
            && init?.method === 'POST'
            && JSON.parse(String(init.body)).model === 'server:gangye-v2')).toBe(true));

        fireEvent.change(screen.getByPlaceholderText('名称、项目、分类或路径'), {
            target: {value: '训练及矩阵'},
        });
        expect(screen.getByText('显示 1 / 2')).toBeInTheDocument();

        expect(screen.queryByRole('button', {name: '扫描 205 模型'})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '导入 / 更新版本'})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '同步至服务器'})).not.toBeInTheDocument();
    });

    it('removes a fully synced batch from temporary data', async () => {
        render(<DataCenterPopup
            language={Language.CHINESE}
            projectName='default-project'
            queueItems={[{
                ...localItem,
                dataSyncStatus: QueueDataSyncStatus.SYNCED,
                datasetId: 'dataset-1',
                datasetRevision: 1,
            }]}
            activeQueueItemId='queue-1'
            imagesData={[]}
            labels={[]}
            updateActivePopupTypeAction={updateActivePopupTypeAction}
            updateQueueItemAction={updateQueueItemAction}
        />);

        await screen.findByRole('tab', {name: '持久化数据 1'});
        expect(screen.getByRole('tab', {name: '临时数据 0'})).toBeInTheDocument();
        expect(screen.getByText('暂无临时数据')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '同步至服务器'})).not.toBeInTheDocument();
    });

    it('syncs a temporary batch from its own card', async () => {
        renderPopup();
        await screen.findByRole('tab', {name: '持久化数据 1'});

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: '同步至服务器'}));
        });

        expect(DataBatchSyncService.syncQueueItem).toHaveBeenCalledWith(localItem, [], []);
    });

    it('does not sync an inactive batch without a trustworthy annotation snapshot', async () => {
        render(<DataCenterPopup
            language={Language.CHINESE}
            projectName='default-project'
            queueItems={[localItem]}
            activeQueueItemId={null}
            imagesData={[]}
            labels={[]}
            updateActivePopupTypeAction={updateActivePopupTypeAction}
            updateQueueItemAction={updateQueueItemAction}
        />);

        await screen.findByRole('tab', {name: '持久化数据 1'});
        const syncButton = await screen.findByRole('button', {name: '先打开后同步'});
        expect(syncButton).toBeDisabled();
        fireEvent.click(syncButton);
        expect(DataBatchSyncService.syncQueueItem).not.toHaveBeenCalled();
    });

    it('persists the active video as a server frame dataset', async () => {
        const videoItem = {
            id: 'video-1',
            name: '炉口.mp4',
            type: QueueItemType.VIDEO,
            file: new File(['video'], '炉口.mp4', {type: 'video/mp4'}),
            extractionMetadata: {
                fps: 25,
                duration: 2,
                totalFrames: 50,
                width: 1920,
                height: 1080,
            },
            status: QueueItemStatus.COMPLETED,
            uploadedAt: 1,
            dataSyncStatus: QueueDataSyncStatus.LOCAL,
        };
        render(<DataCenterPopup
            language={Language.CHINESE}
            projectName='default-project'
            queueItems={[videoItem]}
            activeQueueItemId='video-1'
            activeVideoId='video-1'
            activeVideoSessionId='session-video-1'
            imagesData={[]}
            labels={[]}
            updateActivePopupTypeAction={updateActivePopupTypeAction}
            updateQueueItemAction={updateQueueItemAction}
        />);

        await screen.findByRole('tab', {name: '持久化数据 1'});
        expect(screen.queryByText('视频暂不支持持久化')).not.toBeInTheDocument();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: '同步至服务器'}));
        });
        expect(DataBatchSyncService.syncQueueItem).toHaveBeenCalledWith(
            videoItem,
            [],
            [],
            'session-video-1',
        );
    });

    it('shows downstream tasks only inside the expanded persistent dataset', async () => {
        renderPopup();
        await screen.findByRole('tab', {name: '持久化数据 1'});
        fireEvent.click(screen.getByRole('tab', {name: /持久化数据/}));
        await screen.findByText('default-project', {selector: '.DatasetName'});
        expect(screen.queryByRole('button', {name: '训练'})).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: /default-project.*465/}));
        expect(await screen.findByText('标注覆盖率')).toBeInTheDocument();
        expect(screen.getByText('创建时间')).toBeInTheDocument();
        expect(screen.getByText('编辑时间')).toBeInTheDocument();
        expect(screen.getByText('任务时间')).toBeInTheDocument();
        expect(screen.getByText(/^训练 ·/)).toBeInTheDocument();
        expect(screen.getByRole('list', {name: '数据版本时间轴'})).toBeInTheDocument();
        expect(screen.getByText('原始数据')).toBeInTheDocument();
        expect(screen.getByText('数据清洗 A')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '使用'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '推理'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '训练'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '导出'})).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '推理'}));
        expect(DatasetInferenceSelection.set).toHaveBeenCalledWith('dataset-1');
        expect(updateActivePopupTypeAction).toHaveBeenCalledWith(PopupWindowType.DATASET_INFERENCE);

        fireEvent.click(screen.getByRole('button', {name: '训练'}));

        expect(TrainingDatasetSelection.set).toHaveBeenCalledWith('dataset-1');
        expect(updateActivePopupTypeAction).toHaveBeenCalledWith(PopupWindowType.TRAINING_TASK);

        fireEvent.click(screen.getByRole('button', {name: '导出'}));
        expect(DatasetExportSelection.set).toHaveBeenCalledWith(expect.objectContaining({
            id: 'dataset-1',
            revision: 2,
        }));
        expect(updateActivePopupTypeAction).toHaveBeenCalledWith(PopupWindowType.DATASET_EXPORT);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: '使用'}));
        });
        await waitFor(() => expect(DatasetEditSelection.set).toHaveBeenCalledWith(expect.objectContaining({
            id: 'dataset-1',
            name: 'default-project',
            projectName: 'default-project',
        })));
        expect(PendingImportFiles.set).toHaveBeenCalledWith([
            expect.objectContaining({name: 'yolo_full_default-project_v2.zip'}),
        ]);
        expect(updateActivePopupTypeAction).toHaveBeenCalledWith(PopupWindowType.IMPORT_ANNOTATIONS);
    });

    it('requires confirmation before deleting a server snapshot', async () => {
        const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
        renderPopup();
        fireEvent.click(await screen.findByRole('tab', {name: '持久化数据 1'}));
        await screen.findByText('default-project', {selector: '.DatasetName'});

        fireEvent.click(screen.getByRole('button', {name: '删除 default-project'}));

        expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('不可撤销'));
        expect((global.fetch as jest.Mock).mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
        confirmSpy.mockRestore();
    });

    it('ignores a stale statistics response after another dataset is selected', async () => {
        const secondDataset = {...dataset, id: 'dataset-2', source_id: null, name: 'second-project'};
        let resolveFirstStats: ((response: Response) => void) | undefined;
        (global.fetch as jest.Mock).mockImplementation((input: RequestInfo) => {
            const url = String(input);
            if (url.endsWith('/datasets')) return Promise.resolve(jsonResponse({datasets: [dataset, secondDataset]}));
            if (url.endsWith('/dataset-1/stats')) {
                return new Promise<Response>(resolve => { resolveFirstStats = resolve; });
            }
            if (url.endsWith('/dataset-2/stats')) {
                return Promise.resolve(jsonResponse({
                    image_count: 12,
                    annotated_count: 6,
                    annotation_coverage: 0.5,
                    class_distribution: {second: 6},
                }));
            }
            return Promise.resolve(jsonResponse({status: 'success'}));
        });
        renderPopup();
        fireEvent.click(screen.getByRole('tab', {name: /持久化数据/}));
        await screen.findByText('second-project');
        fireEvent.click(screen.getByRole('button', {name: /default-project.*465/}));
        fireEvent.click(screen.getByRole('button', {name: /second-project.*465/}));
        expect(await screen.findByText('50%')).toBeInTheDocument();

        await act(async () => {
            resolveFirstStats?.(jsonResponse({
                image_count: 465,
                annotated_count: 465,
                annotation_coverage: 1,
                class_distribution: {stale: 465},
            }));
        });

        await waitFor(() => expect(screen.queryByText('100%')).not.toBeInTheDocument());
        expect(screen.getByText('50%')).toBeInTheDocument();
    });
});
