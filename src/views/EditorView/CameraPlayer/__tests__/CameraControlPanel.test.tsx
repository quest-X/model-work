import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
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
            },
            active: {auto_exposure: false, auto_focus: false},
            state,
            metrics,
        });
    });

    it('keeps changes reversible until they are explicitly applied to the camera', async () => {
        service.autoExposure.mockResolvedValue({
            action: 'auto_exposure',
            message: '自动曝光已完成',
            after: {...metrics, luma: 0.36},
            state: controlledExposureState,
            active: {auto_exposure: true, auto_focus: false},
            trial: {
                phase: 'trial',
                dirty: true,
                active: {auto_exposure: true, auto_focus: false},
                started_at: '2026-08-07T10:00:00Z',
                expires_at: '2026-08-07T10:10:00Z',
                applied_at: null,
            },
        } as any);
        trialService.apply.mockResolvedValue({
            action: 'apply_trial',
            message: '当前试调参数已固定到相机',
            after: {...metrics, luma: 0.36},
            state: controlledExposureState,
            active: {auto_exposure: false, auto_focus: false},
            trial: {
                phase: 'applied',
                dirty: false,
                active: {auto_exposure: false, auto_focus: false},
                started_at: null,
                expires_at: null,
                applied_at: '2026-08-07T10:01:00Z',
            },
        });
        render(<CameraControlPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);

        await screen.findByText('测试模式 · 尚未修改');
        const exposureButton = screen.getByRole('button', {name: '自动曝光'});
        await waitFor(() => expect(exposureButton).not.toBeDisabled());
        fireEvent.click(exposureButton);
        expect(await screen.findByText('试调中 · 尚未确认')).toBeInTheDocument();

        const applyButton = screen.getByRole('button', {name: '应用到相机'});
        expect(applyButton).not.toBeDisabled();
        fireEvent.click(applyButton);

        await waitFor(() => expect(trialService.apply).toHaveBeenCalledWith('resource-1'));
        expect(await screen.findByText('已应用到相机')).toBeInTheDocument();
        expect(screen.getByText('当前试调参数已固定到相机')).toBeInTheDocument();
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
            },
            active: {auto_exposure: true, auto_focus: false},
            state: controlledExposureState,
            metrics,
            trial: {
                phase: 'trial',
                dirty: true,
                active: {auto_exposure: true, auto_focus: false},
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
            active: {auto_exposure: false, auto_focus: false},
            trial: {
                phase: 'idle',
                dirty: false,
                active: {auto_exposure: false, auto_focus: false},
                started_at: null,
                expires_at: null,
                applied_at: null,
            },
        });
        render(<CameraControlPanel resourceId='resource-1' language={Language.CHINESE} onClose={onClose}/>);

        await screen.findByText('试调中 · 尚未确认');
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
            active: {auto_exposure: true, auto_focus: false},
            converged: true,
            iterations: 4,
            target_luma: 0.35,
        });
        service.restoreExposure.mockResolvedValue({
            action: 'restore_auto_exposure',
            message: '已恢复相机原生自动曝光',
            after: metrics,
            state,
            active: {auto_exposure: false, auto_focus: false},
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
            active: {auto_exposure: false, auto_focus: true},
        });
        service.restoreFocus.mockResolvedValue({
            action: 'restore_auto_focus',
            message: '已恢复相机原生自动对焦',
            after: metrics,
            state,
            active: {auto_exposure: false, auto_focus: false},
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
});
