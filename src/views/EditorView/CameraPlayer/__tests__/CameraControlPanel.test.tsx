import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {CameraResourceService} from '../../../../services/CameraResourceService';
import {CameraTrialService} from '../../../../services/CameraTrialService';
import CameraControlPanel from '../CameraControlPanel';

jest.mock('../../../../services/CameraResourceService', () => ({
    CameraResourceService: {
        controls: jest.fn(),
        autoExposure: jest.fn(),
        autoFocus: jest.fn(),
        restoreExposure: jest.fn(),
        restoreFocus: jest.fn(),
    },
}));

jest.mock('../../../../services/CameraTrialService', () => ({
    CameraTrialService: {
        apply: jest.fn(),
        revert: jest.fn(),
        autoWdr: jest.fn(),
        restoreWdr: jest.fn(),
        autoDayNight: jest.fn(),
        restoreDayNight: jest.fn(),
    },
}));

const service = CameraResourceService as jest.Mocked<typeof CameraResourceService>;
const trialService = CameraTrialService as jest.Mocked<typeof CameraTrialService>;
const metrics = {
    luma: 0.35,
    saturation_ratio: 0.01,
    dark_ratio: 0.02,
    focus_score: 1800,
    width: 640,
    height: 360,
};
const state = {
    exposure: {mode: 'auto' as const, shutter_us: 10000, gain_level: 22},
    focus: {mode: 'auto' as const, position: 0, relative_position: 0, speed_level: 1},
    wdr: {mode: 'close' as const, level: 50},
    day_night: {mode: 'day' as const},
};
const inactive = {auto_exposure: false, auto_focus: false, auto_wdr: false, auto_day_night: false};
const IDLE_TRIAL_FIXTURE = {
    phase: 'idle' as const,
    dirty: false,
    active: inactive,
    started_at: null,
    expires_at: null,
    applied_at: null,
};
const controlledExposureState = {
    ...state,
    exposure: {...state.exposure, mode: 'manual' as const},
};
const controlledFocusState = {
    ...state,
    focus: {...state.focus, mode: 'manual' as const},
};

describe('CameraControlPanel', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        service.controls.mockResolvedValue({
            capabilities: {
                auto_exposure: true,
                manual_exposure: true,
                exposure_metrics: true,
                auto_focus: true,
                focus_metrics: true,
                auto_wdr: true,
                auto_day_night: true,
            },
            active: inactive,
            state,
            metrics,
        } as any);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('keeps controls disabled and retries when the initial state read is busy', async () => {
        jest.useFakeTimers();
        service.controls
            .mockReset()
            .mockRejectedValueOnce(new Error('该相机正在执行自动调参，请稍后再试'))
            .mockResolvedValue({
                capabilities: {
                    auto_exposure: true,
                    manual_exposure: true,
                    exposure_metrics: true,
                    auto_focus: true,
                    focus_metrics: true,
                    auto_wdr: true,
                    auto_day_night: true,
                },
                active: inactive,
                state,
                metrics,
                trial: IDLE_TRIAL_FIXTURE,
            } as any);

        render(<CameraControlPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);
        await act(async () => {
            await Promise.resolve();
        });

        const focusButton = screen.getByRole('button', {name: '自动对焦'});
        expect(screen.getByText('该相机正在执行自动调参，请稍后再试')).toBeInTheDocument();
        expect(focusButton).toBeDisabled();
        fireEvent.click(focusButton);
        expect(service.autoFocus).not.toHaveBeenCalled();

        await act(async () => {
            jest.advanceTimersByTime(1500);
            await Promise.resolve();
        });

        expect(service.controls).toHaveBeenCalledTimes(2);
        expect(screen.queryByText('该相机正在执行自动调参，请稍后再试')).not.toBeInTheDocument();
        expect(screen.queryByText('调试中')).not.toBeInTheDocument();
        expect(focusButton).not.toBeDisabled();
    });

    it('keeps apply-to-camera out of smart controls', async () => {
        service.autoExposure.mockResolvedValue({
            action: 'auto_exposure',
            message: '自动曝光已完成',
            after: {...metrics, luma: 0.36},
            state: controlledExposureState,
            active: {...inactive, auto_exposure: true},
            trial: {
                phase: 'trial',
                dirty: true,
                active: {...inactive, auto_exposure: true},
                started_at: '2026-08-07T10:00:00Z',
                expires_at: '2026-08-07T10:10:00Z',
                applied_at: null,
            },
        } as any);
        render(<CameraControlPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);

        await screen.findByText('1800');
        const exposureButton = screen.getByRole('button', {name: '自动曝光'});
        await waitFor(() => expect(exposureButton).not.toBeDisabled());
        fireEvent.click(exposureButton);
        expect(await screen.findByText('调试中')).toHaveClass('CameraDebugBadge');
        expect(screen.queryByText('试调中 · 临时生效')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '应用到相机'})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '撤销全部试调'})).not.toBeInTheDocument();
    });

    it('shows professional abbreviations and camera parameters for all four controls', async () => {
        render(<CameraControlPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);

        await screen.findByText('1800');
        expect(screen.getByText('AEC')).toBeInTheDocument();
        expect(screen.getByText('AF')).toBeInTheDocument();
        expect(screen.getByText('WDR')).toBeInTheDocument();
        expect(screen.getByText('D/N')).toBeInTheDocument();
        expect(screen.getByText('快门')).toBeInTheDocument();
        expect(screen.getByText('1/100s')).toBeInTheDocument();
        expect(screen.getByText('增益')).toBeInTheDocument();
        expect(screen.getByText('镜头位置')).toBeInTheDocument();
        expect(screen.getByText('速度级别')).toBeInTheDocument();
        expect(screen.getByText('强度')).toBeInTheDocument();
        expect(screen.getByText('控制来源')).toBeInTheDocument();
        expect(screen.getByText('相机原设')).toBeInTheDocument();
    });

    it('reverts an unconfirmed trial before closing the panel', async () => {
        const onClose = jest.fn();
        service.controls.mockResolvedValue({
            capabilities: {
                auto_exposure: true,
                manual_exposure: true,
                exposure_metrics: true,
                auto_focus: true,
                focus_metrics: true,
                auto_wdr: true,
                auto_day_night: true,
            },
            active: {...inactive, auto_exposure: true},
            state: controlledExposureState,
            metrics,
            trial: {
                phase: 'trial',
                dirty: true,
                active: {...inactive, auto_exposure: true},
                started_at: '2026-08-07T10:00:00Z',
                expires_at: '2026-08-07T10:10:00Z',
                applied_at: null,
            },
        } as any);
        trialService.revert.mockResolvedValue({
            action: 'revert_trial',
            message: '试调已撤销，已恢复试调前的相机参数',
            after: metrics,
            state,
            active: inactive,
            trial: {
                phase: 'idle',
                dirty: false,
                active: inactive,
                started_at: null,
                expires_at: null,
                applied_at: null,
            },
        });
        render(<CameraControlPanel resourceId='resource-1' language={Language.CHINESE} onClose={onClose}/>);

        await screen.findByText('调试中');
        fireEvent.click(screen.getByRole('button', {name: '关闭相机控制'}));

        await waitFor(() => expect(trialService.revert).toHaveBeenCalledWith('resource-1'));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it('uses one button to enable automatic exposure and restore the camera default', async () => {
        const onBeforeAction = jest.fn();
        service.autoExposure.mockResolvedValue({
            action: 'auto_exposure',
            message: '自动曝光已完成',
            after: {...metrics, luma: 0.36},
            state: controlledExposureState,
            active: {...inactive, auto_exposure: true},
            converged: true,
            iterations: 4,
            target_luma: 0.35,
        });
        service.restoreExposure.mockResolvedValue({
            action: 'restore_auto_exposure',
            message: '已恢复相机原生自动曝光',
            after: metrics,
            state,
            active: inactive,
        });
        render(<CameraControlPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()} onBeforeAction={onBeforeAction}/>);

        expect(await screen.findByText('1800')).toBeInTheDocument();
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
        expect(screen.queryByText('目标亮度')).not.toBeInTheDocument();
        const exposureButton = screen.getByRole('button', {name: '自动曝光'});
        expect(exposureButton).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByRole('button', {name: '恢复相机自动'})).not.toBeInTheDocument();
        fireEvent.click(exposureButton);

        await waitFor(() => expect(service.autoExposure).toHaveBeenCalledWith('resource-1', 0.35));
        expect(onBeforeAction).toHaveBeenCalledTimes(1);
        expect(await screen.findByText('自动曝光已完成')).toBeInTheDocument();
        expect(exposureButton).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(exposureButton);
        await waitFor(() => expect(service.restoreExposure).toHaveBeenCalledWith('resource-1'));
        expect(onBeforeAction).toHaveBeenCalledTimes(1);
        expect(await screen.findByText('已恢复相机原生自动曝光')).toBeInTheDocument();
        expect(exposureButton).toHaveAttribute('aria-pressed', 'false');
    });

    it('independently enables autofocus and restores the camera default', async () => {
        service.autoFocus.mockResolvedValue({
            action: 'auto_focus',
            message: '自动对焦已完成',
            after: {...metrics, focus_score: 2300},
            before: metrics,
            improvement: 500,
            state: controlledFocusState,
            active: {...inactive, auto_focus: true},
        });
        service.restoreFocus.mockResolvedValue({
            action: 'restore_auto_focus',
            message: '已恢复相机原生自动对焦',
            after: metrics,
            state,
            active: inactive,
        });
        render(<CameraControlPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);

        await screen.findByText('1800');
        const focusButton = screen.getByRole('button', {name: '自动对焦'});
        expect(focusButton).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(focusButton);

        await waitFor(() => expect(service.autoFocus).toHaveBeenCalledWith('resource-1'));
        expect(await screen.findByText('清晰度变化: +500')).toBeInTheDocument();
        expect(focusButton).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(focusButton);
        await waitFor(() => expect(service.restoreFocus).toHaveBeenCalledWith('resource-1'));
        expect(await screen.findByText('已恢复相机原生自动对焦')).toBeInTheDocument();
        expect(focusButton).toHaveAttribute('aria-pressed', 'false');
    });

    it('independently toggles auto WDR and auto day/night', async () => {
        trialService.autoWdr.mockResolvedValue({
            action: 'auto_wdr',
            message: '自动宽动态已开启',
            after: metrics,
            state: {...state, wdr: {mode: 'auto', level: 50}},
            active: {...inactive, auto_wdr: true},
            trial: {...IDLE_TRIAL_FIXTURE, phase: 'trial', dirty: true, active: {...inactive, auto_wdr: true}},
        } as any);
        trialService.restoreWdr.mockResolvedValue({
            action: 'restore_trial_wdr',
            message: '已恢复试调前的宽动态参数',
            after: metrics,
            state,
            active: inactive,
            trial: {...IDLE_TRIAL_FIXTURE, phase: 'trial'},
        } as any);
        trialService.autoDayNight.mockResolvedValue({
            action: 'auto_day_night',
            message: '自动日夜切换已开启',
            after: metrics,
            state: {...state, day_night: {mode: 'auto'}},
            active: {...inactive, auto_day_night: true},
            trial: {...IDLE_TRIAL_FIXTURE, phase: 'trial', dirty: true, active: {...inactive, auto_day_night: true}},
        } as any);

        render(<CameraControlPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);
        await screen.findByText('1800');

        const wdrButton = screen.getByRole('button', {name: '自动宽动态'});
        const dayNightButton = screen.getByRole('button', {name: '自动日夜'});
        fireEvent.click(wdrButton);
        await waitFor(() => expect(trialService.autoWdr).toHaveBeenCalledWith('resource-1'));
        await waitFor(() => expect(wdrButton).toHaveAttribute('aria-pressed', 'true'));

        fireEvent.click(wdrButton);
        await waitFor(() => expect(trialService.restoreWdr).toHaveBeenCalledWith('resource-1'));
        await waitFor(() => expect(wdrButton).toHaveAttribute('aria-pressed', 'false'));

        fireEvent.click(dayNightButton);
        await waitFor(() => expect(trialService.autoDayNight).toHaveBeenCalledWith('resource-1'));
        await waitFor(() => expect(dayNightButton).toHaveAttribute('aria-pressed', 'true'));
    });
});
