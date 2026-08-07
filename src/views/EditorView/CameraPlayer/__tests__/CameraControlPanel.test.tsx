import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {CameraResourceService} from '../../../../services/CameraResourceService';
import CameraControlPanel from '../CameraControlPanel';

jest.mock('../../../../services/CameraResourceService', () => ({
    CameraResourceService: {
        controls: jest.fn(),
        autoExposure: jest.fn(),
        autoFocus: jest.fn(),
        restoreExposure: jest.fn(),
    },
}));

const service = CameraResourceService as jest.Mocked<typeof CameraResourceService>;
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
            state,
            metrics,
        });
    });

    it('uses one button to enable automatic exposure and restore the camera default', async () => {
        service.autoExposure.mockResolvedValue({
            action: 'auto_exposure',
            message: '自动曝光已完成',
            after: {...metrics, luma: 0.36},
            state: controlledExposureState,
            converged: true,
            iterations: 4,
            target_luma: 0.35,
        });
        service.restoreExposure.mockResolvedValue({
            action: 'restore_auto_exposure',
            message: '已恢复相机原生自动曝光',
            after: metrics,
            state,
        });
        render(<CameraControlPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);

        expect(await screen.findByText('1800')).toBeInTheDocument();
        const exposureButton = screen.getByRole('button', {name: '自动曝光'});
        expect(exposureButton).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByRole('button', {name: '恢复相机自动'})).not.toBeInTheDocument();
        fireEvent.click(exposureButton);

        await waitFor(() => expect(service.autoExposure).toHaveBeenCalledWith('resource-1', 0.35));
        expect(await screen.findByText('自动曝光已完成')).toBeInTheDocument();
        expect(exposureButton).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(exposureButton);
        await waitFor(() => expect(service.restoreExposure).toHaveBeenCalledWith('resource-1'));
        expect(await screen.findByText('已恢复相机原生自动曝光')).toBeInTheDocument();
        expect(exposureButton).toHaveAttribute('aria-pressed', 'false');
    });

    it('runs one-push autofocus and reports the focus delta', async () => {
        service.autoFocus.mockResolvedValue({
            action: 'auto_focus',
            message: '自动对焦已完成',
            after: {...metrics, focus_score: 2300},
            before: metrics,
            improvement: 500,
            state,
        });
        render(<CameraControlPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);

        await screen.findByText('1800');
        fireEvent.click(screen.getByRole('button', {name: '开始自动对焦'}));

        await waitFor(() => expect(service.autoFocus).toHaveBeenCalledWith('resource-1'));
        expect(await screen.findByText('清晰度变化: +500')).toBeInTheDocument();
    });
});
