import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {CameraPreviewService, CameraPreviewState} from '../../../../services/CameraPreviewService';
import CameraControlPanel from '../CameraControlPanel';

jest.mock('../../../../services/CameraPreviewService', () => ({
    CameraPreviewService: {
        get: jest.fn(),
        update: jest.fn(),
        apply: jest.fn(),
        revert: jest.fn(),
        reset: jest.fn(),
        autoAdjust: jest.fn(),
        disableAuto: jest.fn(),
    },
}));

const service = CameraPreviewService as jest.Mocked<typeof CameraPreviewService>;
const neutral = {brightness: 0, contrast: 1, gamma: 1, saturation: 1, sharpness: 0, denoise: 0};
const state = (current = neutral, dirty = false): CameraPreviewState => ({
    logical_channels: {original: '1011', adjusted: '1012'},
    saved: neutral,
    current,
    active_automations: {exposure: false, focus: false, wdr: false, 'day-night': false},
    dirty,
    created_at: '2026-08-10T00:00:00Z',
    updated_at: null,
    applied_at: null,
    physical_camera_unchanged: true,
});

describe('CameraControlPanel', () => {
    let activeAutomations: CameraPreviewState['active_automations'];

    beforeEach(() => {
        jest.clearAllMocks();
        activeAutomations = {exposure: false, focus: false, wdr: false, 'day-night': false};
        service.get.mockResolvedValue(state());
        service.update.mockImplementation(async (_id, payload) => state({...neutral, ...payload}, true));
        service.apply.mockResolvedValue(state({...neutral, brightness: 0.2}, false));
        service.revert.mockResolvedValue(state());
        service.reset.mockResolvedValue(state());
        service.autoAdjust.mockImplementation(async (_id, action) => {
            activeAutomations = {...activeAutomations, [action]: true};
            return {
                ...state({...neutral, brightness: action === 'exposure' ? 0.2 : 0}, true),
                active_automations: activeAutomations,
                auto_adjustment: {
                    action,
                    mode: 'software',
                    metrics: {
                        luma: 0.25,
                        dark_ratio: 0.1,
                        clipped_ratio: 0.02,
                        focus_score: 320,
                        saturation: 0.4,
                        width: 1280,
                        height: 720,
                    },
                    message: '已完成 1012 软件自动调参',
                    software_branch_only: true,
                    physical_camera_unchanged: true,
                },
            };
        });
        service.disableAuto.mockImplementation(async (_id, action) => {
            activeAutomations = {...activeAutomations, [action]: false};
            return {...state(neutral, true), active_automations: activeAutomations};
        });
    });

    it('shows two logical LIVE branches and makes the non-destructive boundary explicit', async () => {
        render(<CameraControlPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);

        expect(await screen.findByRole('button', {name: '自动曝光'})).toBeInTheDocument();
        expect(screen.getByText('物理相机未修改')).toBeInTheDocument();
        expect(screen.getByText('1011')).toBeInTheDocument();
        expect(screen.getByText('1012')).toBeInTheDocument();
        expect(screen.getByText('原始对照')).toBeInTheDocument();
        expect(screen.getByText('调参效果')).toBeInTheDocument();
        expect(screen.getAllByText('LIVE')).toHaveLength(2);
        expect(screen.getByRole('button', {name: '自动对焦'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '自动宽动态'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '自动日夜'})).toBeInTheDocument();
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
        expect(screen.queryByText('下发到相机')).not.toBeInTheDocument();
    });

    it('keeps automatic controls independent so all four can be enabled together', async () => {
        const onStreamChanged = jest.fn();
        render(<CameraControlPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()} onStreamChanged={onStreamChanged}/>);

        const exposure = await screen.findByRole('button', {name: '自动曝光'});
        const focus = screen.getByRole('button', {name: '自动对焦'});
        const wdr = screen.getByRole('button', {name: '自动宽动态'});
        const dayNight = screen.getByRole('button', {name: '自动日夜'});
        fireEvent.click(exposure);
        await waitFor(() => expect(exposure).toHaveAttribute('aria-pressed', 'true'));
        fireEvent.click(focus);
        await waitFor(() => expect(focus).toHaveAttribute('aria-pressed', 'true'));
        fireEvent.click(wdr);
        await waitFor(() => expect(wdr).toHaveAttribute('aria-pressed', 'true'));
        fireEvent.click(dayNight);

        await waitFor(() => expect(dayNight).toHaveAttribute('aria-pressed', 'true'));
        expect(exposure).toHaveAttribute('aria-pressed', 'true');
        expect(focus).toHaveAttribute('aria-pressed', 'true');
        expect(wdr).toHaveAttribute('aria-pressed', 'true');
        expect(service.autoAdjust).toHaveBeenCalledTimes(4);
        expect(onStreamChanged).toHaveBeenCalledTimes(4);
        expect(await screen.findByText('已完成 1012 软件自动调参')).toBeInTheDocument();
        expect(screen.getByText('1280×720')).toBeInTheDocument();

        fireEvent.click(exposure);
        await waitFor(() => expect(service.disableAuto).toHaveBeenCalledWith('resource-1', 'exposure'));
        await waitFor(() => expect(exposure).toHaveAttribute('aria-pressed', 'false'));
        expect(focus).toHaveAttribute('aria-pressed', 'true');
        expect(wdr).toHaveAttribute('aria-pressed', 'true');
        expect(dayNight).toHaveAttribute('aria-pressed', 'true');
    });

    it('updates only the 1012 software preview and reconnects the logical streams', async () => {
        const onStreamChanged = jest.fn();
        render(<CameraControlPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()} onStreamChanged={onStreamChanged}/>);
        fireEvent.click(await screen.findByRole('button', {name: '高级微调'}));
        const brightness = screen.getByRole('slider', {name: '亮度'});

        fireEvent.change(brightness, {target: {value: '0.25'}});
        fireEvent.click(screen.getByRole('button', {name: '更新调参预览'}));

        await waitFor(() => expect(service.update).toHaveBeenCalledWith('resource-1', {
            brightness: 0.25,
            contrast: 1,
            gamma: 1,
            saturation: 1,
            sharpness: 0,
            denoise: 0,
        }));
        expect(onStreamChanged).toHaveBeenCalledTimes(1);
        expect(await screen.findByText('已更新 1012 调参预览')).toBeInTheDocument();
    });

    it('saves a preset without writing the camera and restores with a stream rebuild', async () => {
        const dirtyState = state({...neutral, brightness: 0.2}, true);
        service.get.mockResolvedValue(dirtyState);
        service.apply.mockResolvedValue({...dirtyState, saved: dirtyState.current, dirty: false});
        const onStreamChanged = jest.fn();
        const first = render(<CameraControlPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()} onStreamChanged={onStreamChanged}/>);

        fireEvent.click(await screen.findByRole('button', {name: '高级微调'}));
        await screen.findByRole('slider', {name: '亮度'});
        fireEvent.click(screen.getByRole('button', {name: '保存当前方案'}));
        await waitFor(() => expect(service.apply).toHaveBeenCalledWith('resource-1'));
        expect(onStreamChanged).not.toHaveBeenCalled();
        first.unmount();

        service.get.mockResolvedValue(dirtyState);
        render(<CameraControlPanel resourceId='resource-2' language={Language.CHINESE} onClose={jest.fn()} onStreamChanged={onStreamChanged}/>);
        fireEvent.click(await screen.findByRole('button', {name: '高级微调'}));
        await screen.findByRole('slider', {name: '亮度'});
        fireEvent.click(screen.getByRole('button', {name: '恢复已保存'}));
        await waitFor(() => expect(service.revert).toHaveBeenCalledWith('resource-2'));
        await waitFor(() => expect(onStreamChanged).toHaveBeenCalledTimes(1));
        expect(await screen.findByText('已恢复上次保存方案')).toBeInTheDocument();
    });
});
