import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {App} from '../App';
import {ProjectType} from '../data/enums/ProjectType';
import {AutoSaveService} from '../services/AutoSaveService';
import {ProjectRestoreService} from '../services/ProjectRestoreService';

jest.unmock('../App');
jest.mock('../views/EditorView/EditorView', () => ({
    __esModule: true,
    default: ({platformMode, onPlatformSwitch}: {
        platformMode: 'annotation' | 'control';
        onPlatformSwitch: () => void;
    }) => <main>
        <span>{platformMode}</span>
        <button type='button' onClick={onPlatformSwitch}>切换平台</button>
    </main>,
}));
const mockResourceLoad = jest.fn();
jest.mock('../views/PopupView/PopupView', () => ({
    __esModule: true,
    default: ({onBeforeOpenAnnotation, onOpenAnnotation}: {
        onBeforeOpenAnnotation: () => boolean;
        onOpenAnnotation: () => void;
    }) => <button type='button' onClick={() => {
        if (!onBeforeOpenAnnotation()) return;
        mockResourceLoad();
        onOpenAnnotation();
    }}>使用资源</button>,
}));
jest.mock('../views/NotificationsView/NotificationsView', () => ({__esModule: true, default: () => null}));
jest.mock('../views/MobileMainView/MobileMainView', () => ({__esModule: true, default: () => null}));
jest.mock('../views/SizeItUpView/SizeItUpView', () => ({SizeItUpView: () => null}));
jest.mock('../staticModels/PlatformModel', () => ({
    PlatformModel: {mobileDeviceData: {manufacturer: '', os: ''}},
}));
jest.mock('../services/AutoSaveService', () => ({
    AutoSaveService: {
        initialize: jest.fn(), suspend: jest.fn(), resume: jest.fn(), drain: jest.fn(),
    },
}));
jest.mock('../services/ProjectRestoreService', () => ({
    ProjectRestoreService: {
        checkForStoredData: jest.fn(), restoreSettings: jest.fn(), restoreProject: jest.fn(),
        clearAllStoredData: jest.fn(), formatLastSavedTime: jest.fn(() => '刚刚'),
    },
}));
jest.mock('../utils/IndexedDBManager', () => ({
    IndexedDBManager: {isReady: jest.fn(() => true), initialize: jest.fn()},
    RecoveryStorageReadError: class RecoveryStorageReadError extends Error {},
}));

const autoSave = AutoSaveService as jest.Mocked<typeof AutoSaveService>;
const restore = ProjectRestoreService as jest.Mocked<typeof ProjectRestoreService>;
const props = {
    projectType: ProjectType.OBJECT_DETECTION,
    windowSize: {width: 1920, height: 1080},
    roboflowAPIDetails: {status: false, model: '', key: ''},
};

describe('App restore prompt scope', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        autoSave.initialize.mockResolvedValue();
        restore.restoreSettings.mockResolvedValue(true);
        restore.checkForStoredData.mockResolvedValue({hasSettings: false, hasProject: false, lastSaved: 0});
    });

    it('opens a resource in annotation when no recovery is pending', async () => {
        render(<App {...props}/>);
        await waitFor(() => expect(autoSave.resume).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('button', {name: '使用资源'}));
        expect(await screen.findByText('annotation')).toBeInTheDocument();
        expect(mockResourceLoad).toHaveBeenCalledTimes(1);
    });

    it.each(['stored-project', 'storage-error'])('protects existing work before resource loading: %s', async condition => {
        if (condition === 'stored-project') {
            restore.checkForStoredData.mockResolvedValue({hasSettings: true, hasProject: true, lastSaved: 1});
        } else {
            restore.checkForStoredData.mockRejectedValueOnce(new Error('database unavailable'));
        }
        const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<App {...props}/>);
        fireEvent.click(await screen.findByRole('button', {name: '使用资源'}));
        expect(await screen.findByText('是否恢复之前的工作?')).toBeInTheDocument();
        expect(mockResourceLoad).not.toHaveBeenCalled();
        expect(restore.clearAllStoredData).not.toHaveBeenCalled();
        expect(autoSave.resume).not.toHaveBeenCalled();
        errorLog.mockRestore();
    });

    it('waits until the annotation platform before offering project recovery', async () => {
        restore.checkForStoredData.mockResolvedValue({
            hasSettings: true,
            hasProject: true,
            lastSaved: 1,
            projectName: '标注项目',
        });

        render(<App {...props}/>);

        expect(await screen.findByText('control')).toBeInTheDocument();
        expect(screen.queryByText('是否恢复之前的工作?')).not.toBeInTheDocument();
        expect(autoSave.resume).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: '切换平台'}));

        expect(await screen.findByText('是否恢复之前的工作?')).toBeInTheDocument();
    });

    it('restores settings silently when there is no annotation project', async () => {
        restore.checkForStoredData.mockResolvedValue({
            hasSettings: true,
            hasProject: false,
            lastSaved: 1,
        });

        render(<App {...props}/>);

        await waitFor(() => expect(restore.restoreSettings).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole('button', {name: '切换平台'}));
        expect(await screen.findByText('annotation')).toBeInTheDocument();
        expect(screen.queryByText('是否恢复之前的工作?')).not.toBeInTheDocument();
        expect(autoSave.resume).toHaveBeenCalledTimes(1);
    });
});
