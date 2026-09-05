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

const renderNavigation = (
    queueItems: QueueItem[],
    language = Language.CHINESE,
    overrides: Partial<React.ComponentProps<typeof TopNavigationBar>> = {},
) => render(
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
        {...overrides}
    />,
);

describe('TopNavigationBar core-engine change badge', () => {
    it('opens OCR from the core engine menu', () => {
        const updatePopup = jest.fn();
        renderNavigation([], Language.CHINESE, {updateActivePopupTypeAction: updatePopup});
        fireEvent.click(screen.getByText('核心引擎'));
        fireEvent.click(screen.getByRole('button', {name: '文字识别 OCR'}));
        expect(updatePopup).toHaveBeenCalledWith(PopupWindowType.OCR);
    });
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
    it('refreshes recovered plugins when reopening the extension menu', async () => {
        const previousFetch = global.fetch;
        let state = 'error';
        global.fetch = jest.fn().mockImplementation(async () => ({
            ok: true,
            json: async () => ({plugins: {
                camera_connect: {enabled: true, state},
                compute_cluster: {enabled: true, state},
            }}),
        }));
        const view = renderNavigation([], Language.CHINESE, {hasExtensionEngine: true});
        try {
            fireEvent.click(screen.getByText('拓展引擎'));
            await waitFor(() => expect(global.fetch).toHaveBeenCalled());
            expect(screen.queryByText('计算群')).not.toBeInTheDocument();
            fireEvent.click(screen.getByText('拓展引擎'));
            state = 'ready';
            fireEvent.click(screen.getByText('拓展引擎'));
            await waitFor(() => expect(screen.getByText('计算群')).toBeInTheDocument());
        } finally {
            view.unmount();
            global.fetch = previousFetch;
        }
    });

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
        expect(screen.getByText('透视').closest('.DropDownMenuContentOption')).toHaveClass('divider');
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
        expect(screen.getByText('透视').closest('.DropDownMenuContentOption')).not.toHaveClass('divider');
        fireEvent.click(screen.getByText('视觉检索'));
        expect(updatePopup).toHaveBeenLastCalledWith(PopupWindowType.L2G_RETRIEVAL);

        fireEvent.click(screen.getByText('拓展引擎'));
        fireEvent.click(screen.getByText('透视'));
        expect(updatePopup).toHaveBeenLastCalledWith(PopupWindowType.MODEL_INSPECTOR);
        global.fetch = previousFetch;
    });
});

describe('TopNavigationBar account preview', () => {
    beforeEach(() => window.localStorage.clear());

    it('places an accessible account menu after the language control', () => {
        const switchPlatform = jest.fn();
        renderNavigation([], Language.CHINESE, {onPlatformSwitch: switchPlatform});

        const avatar = screen.getByRole('button', {name: '打开账户菜单'});
        expect(avatar).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(avatar);
        expect(avatar).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('menu', {name: '账户菜单'})).toBeInTheDocument();
        expect(screen.getByText('本地管理员')).toBeInTheDocument();
        const platformSwitch = screen.getByRole('menuitem', {name: '切换到控制后台'});
        expect(platformSwitch).not.toHaveAttribute('href');
        expect(screen.getByRole('menuitem', {name: '修改密码'})).toBeInTheDocument();
        expect(screen.getByRole('menuitem', {name: '退出登录'})).toBeInTheDocument();

        fireEvent.click(platformSwitch);
        expect(switchPlatform).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menu', {name: '账户菜单'})).not.toBeInTheDocument();
    });

    it('offers a return to the annotation platform from control mode', () => {
        renderNavigation([], Language.CHINESE, {platformMode: 'control'});

        expect(screen.getByText('项目名称:')).toBeInTheDocument();
        expect(screen.getByText('核心引擎')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '打开账户菜单'}));
        expect(screen.getByRole('menuitem', {name: '切换到标注平台'})).toBeInTheDocument();
    });

    it('uploads and persists an account avatar from the account summary', async () => {
        const {container} = renderNavigation([], Language.CHINESE);
        fireEvent.click(screen.getByRole('button', {name: '打开账户菜单'}));

        expect(screen.getByRole('button', {name: '上传头像'})).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('上传头像', {selector: 'input'}), {
            target: {files: [new File(['avatar'], 'avatar.png', {type: 'image/png'})]},
        });

        await waitFor(() => expect(container.querySelector('.AccountAvatarButton img'))
            .toHaveAttribute('src', expect.stringContaining('data:image/png;base64,')));
        expect(window.localStorage.getItem('opensight.account.avatar'))
            .toContain('data:image/png;base64,');
    });
});
