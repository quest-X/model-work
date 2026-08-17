import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {ProjectType} from '../../../../data/enums/ProjectType';
import {
    QueueDataSyncStatus,
    QueueItem,
    QueueItemStatus,
    QueueItemType,
} from '../../../../store/queue/types';
import {TopNavigationBar} from '../TopNavigationBar';
import {PopupWindowType} from '../../../../data/enums/PopupWindowType';

jest.mock('../../StateBar/StateBar', () => ({
    __esModule: true,
    default: function MockStateBar() {
        return <div data-testid='state-bar'/>;
    },
}));
jest.mock('../DropDownMenu/DropDownMenu', () => ({
    __esModule: true,
    default: function MockDropDownMenu() {
        return <div data-testid='actions-menu'/>;
    },
}));

const queueItem = (id: string, dataSyncStatus: QueueDataSyncStatus): QueueItem => ({
    id,
    name: id,
    type: QueueItemType.FOLDER,
    status: QueueItemStatus.COMPLETED,
    uploadedAt: 1,
    dataSyncStatus,
});

const renderNavigation = (queueItems: QueueItem[], language = Language.CHINESE) => render(
    <TopNavigationBar
        updateActivePopupTypeAction={jest.fn()}
        updateProjectDataAction={jest.fn()}
        updateLanguageAction={jest.fn()}
        updateQueueItemAction={jest.fn()}
        projectData={{type: ProjectType.OBJECT_DETECTION, name: 'badge-test'}}
        queueItems={queueItems}
        activeQueueItemId={null}
        language={language}
        hasCoreEngine
        hasExtensionEngine={false}
    />,
);

describe('TopNavigationBar core-engine change badge', () => {
    it('shows the number of dirty datasets only', () => {
        renderNavigation([
            queueItem('dirty-1', QueueDataSyncStatus.DIRTY),
            queueItem('dirty-2', QueueDataSyncStatus.DIRTY),
            queueItem('local', QueueDataSyncStatus.LOCAL),
            queueItem('syncing', QueueDataSyncStatus.SYNCING),
            queueItem('error', QueueDataSyncStatus.ERROR),
        ]);

        expect(screen.getByRole('status', {name: '2 个本地变动待处理'})).toHaveTextContent('2');

        fireEvent.click(screen.getByText('核心引擎'));
        expect(screen.getAllByRole('status', {name: '2 个本地变动待处理'})).toHaveLength(2);
        expect(screen.getByText('资源中心').parentElement)
            .toHaveTextContent('2');
    });

    it('hides the badge when there are no local changes', () => {
        renderNavigation([
            queueItem('synced', QueueDataSyncStatus.SYNCED),
            queueItem('local', QueueDataSyncStatus.LOCAL),
        ]);

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('provides an English singular description', () => {
        renderNavigation([queueItem('dirty', QueueDataSyncStatus.DIRTY)], Language.ENGLISH);

        expect(screen.getByRole('status', {name: '1 local change pending'})).toHaveTextContent('1');
    });
});

describe('TopNavigationBar compute-cluster entry', () => {
    it('opens the compute cluster only when its extension is ready', async () => {
        const updatePopup = jest.fn();
        const previousFetch = global.fetch;
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                plugins: {
                    camera_connect: {enabled: true, state: 'ready'},
                    compute_cluster: {enabled: true, state: 'ready'},
                },
            }),
        } as Response);
        global.fetch = fetchMock;
        render(<TopNavigationBar
            updateActivePopupTypeAction={updatePopup}
            updateProjectDataAction={jest.fn()}
            updateLanguageAction={jest.fn()}
            updateQueueItemAction={jest.fn()}
            projectData={{type: ProjectType.OBJECT_DETECTION, name: 'cluster-test'}}
            queueItems={[]}
            activeQueueItemId={null}
            language={Language.CHINESE}
            hasCoreEngine
            hasExtensionEngine
        />);

        fireEvent.click(screen.getByText('拓展引擎'));
        await waitFor(() => expect(screen.getByText('计算群')).toBeInTheDocument());
        fireEvent.click(screen.getByText('计算群'));

        expect(updatePopup).toHaveBeenCalledWith(PopupWindowType.COMPUTE_CLUSTER);
        global.fetch = previousFetch;
    });
});

describe('TopNavigationBar extension tool entries', () => {
    it('opens visual retrieval and model inspection from the extension menu', () => {
        const updatePopup = jest.fn();
        const previousFetch = global.fetch;
        global.fetch = jest.fn(() => new Promise<Response>(() => undefined));
        render(<TopNavigationBar
            updateActivePopupTypeAction={updatePopup}
            updateProjectDataAction={jest.fn()}
            updateLanguageAction={jest.fn()}
            updateQueueItemAction={jest.fn()}
            projectData={{type: ProjectType.OBJECT_DETECTION, name: 'extension-tools-test'}}
            queueItems={[]}
            activeQueueItemId={null}
            language={Language.CHINESE}
            hasCoreEngine
            hasExtensionEngine
        />);

        fireEvent.click(screen.getByText('拓展引擎'));
        fireEvent.click(screen.getByText('视觉检索'));
        expect(updatePopup).toHaveBeenLastCalledWith(PopupWindowType.L2G_RETRIEVAL);

        fireEvent.click(screen.getByText('拓展引擎'));
        fireEvent.click(screen.getByText('透视'));
        expect(updatePopup).toHaveBeenLastCalledWith(PopupWindowType.MODEL_INSPECTOR);
        global.fetch = previousFetch;
    });
});
