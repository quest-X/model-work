import React from 'react';
import {render, screen} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {ProjectType} from '../../../../data/enums/ProjectType';
import {
    QueueDataSyncStatus,
    QueueItem,
    QueueItemStatus,
    QueueItemType,
} from '../../../../store/queue/types';
import {TopNavigationBar} from '../TopNavigationBar';

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
