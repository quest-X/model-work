import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {CameraParameterService} from '../../../../services/CameraParameterService';
import {CameraTrialService} from '../../../../services/CameraTrialService';
import CameraParametersPanel from '../CameraParametersPanel';

jest.mock('../../../../services/CameraParameterService', () => ({
    CameraParameterService: {compare: jest.fn(), update: jest.fn()},
}));

jest.mock('../../../../services/CameraTrialService', () => ({
    CameraTrialService: {apply: jest.fn(), revert: jest.fn()},
}));

const snapshot = {
    captured_at: '2026-08-07T02:00:00+00:00',
    advanced_control_captured_at: '2026-08-07T03:00:00+00:00',
    source: 'connection',
    live: false,
    connection: {scheme: 'http', host: '192.168.10.12', management_port: 80, rtsp_port: 554, channel_id: '102'},
    device: {
        name: 'Camera 01',
        model: 'DS-2CD2686FWDA2-IZS',
        serial_number: 'TEST123',
        firmware_version: 'V5.7.23',
        device_type: 'IPCamera',
        mac_address: '00:11:22:33:44:55',
    },
    channels: [{id: '102', name: 'Camera 01', enabled: true, codec: 'H.265', width: 640, height: 360, frame_rate: 25, rtsp_url: 'rtsp://192.168.10.12:554/Streaming/Channels/102'}],
    controls: {
        capabilities: {auto_exposure: true, manual_exposure: true, exposure_metrics: true, auto_focus: true, focus_metrics: true},
        state: {
            exposure: {mode: 'auto', shutter_us: 10000, gain_level: 20},
            focus: {mode: 'auto', position: 30, relative_position: 30, speed_level: 2},
            sdk_image: {
                video_effect: {brightness_level: 50, contrast_level: 45},
                white_balance: {mode: 'auto', red_gain: 50, blue_gain: 48},
                enhancement: {power_line_frequency: '50 Hz', defog_mode: 'auto'},
                lens: {optical_zoom_level: 2.5},
            },
        },
        metrics: {luma: 0.2, saturation_ratio: 0.01, dark_ratio: 0.4, focus_score: 90, width: 640, height: 360},
    },
    errors: [],
} as const;

describe('CameraParametersPanel', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    beforeEach(() => {
        (CameraParameterService.update as jest.Mock).mockReset().mockResolvedValue({
            phase: 'trial',
            dirty: true,
            active: {auto_exposure: false, auto_focus: false, auto_wdr: false, auto_day_night: false},
            started_at: '2026-08-07T02:05:00+00:00',
            expires_at: '2026-08-07T02:15:00+00:00',
            applied_at: null,
        });
        (CameraTrialService.apply as jest.Mock).mockReset().mockResolvedValue({});
        (CameraTrialService.revert as jest.Mock).mockReset().mockResolvedValue({});
        (CameraParameterService.compare as jest.Mock).mockReset().mockResolvedValue({
            original: snapshot,
            current: {
                ...snapshot,
                captured_at: '2026-08-07T02:05:00+00:00',
                source: 'live',
                live: true,
                controls: {
                    ...snapshot.controls,
                    state: {
                        ...snapshot.controls.state,
                        exposure: {mode: 'manual', shutter_us: 5000, gain_level: 12},
                    },
                },
            },
            changed_paths: ['controls.state.exposure.mode', 'controls.state.exposure.shutter_us', 'controls.state.exposure.gain_level'],
        });
    });

    it('shows original and current values side by side and marks changes', async () => {
        render(<CameraParametersPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);

        expect(await screen.findByText('左侧基准')).toBeInTheDocument();
        expect(screen.getByText('右侧实时')).toBeInTheDocument();
        expect(screen.queryByText('原始参数 · 已锁定')).not.toBeInTheDocument();
        expect(screen.queryByText('当前参数 · 实时读取')).not.toBeInTheDocument();
        expect(screen.getByText(/接入时快照/)).toBeInTheDocument();
        expect(screen.getByText('原始值')).toBeInTheDocument();
        expect(screen.getByText(/当前值 ·/)).toBeInTheDocument();
        expect(screen.getByText('1/100s (10000 μs)')).toBeInTheDocument();
        expect(screen.getByText('1/200s (5000 μs)')).toBeInTheDocument();
        expect(screen.getAllByText('已修改').length).toBeGreaterThanOrEqual(3);
    });

    it('keeps the first-read source label without showing a persistent legacy notice', async () => {
        (CameraParameterService.compare as jest.Mock).mockResolvedValue({
            original: {...snapshot, source: 'first_read'},
            current: {...snapshot, source: 'live', live: true},
            changed_paths: [],
        });

        render(<CameraParametersPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);

        expect(await screen.findByText(/首次读取快照/)).toBeInTheDocument();
        expect(screen.queryByText(/该相机早于参数快照功能创建/)).not.toBeInTheDocument();
    });

    it('shows common parameters by default and expands all parameters from the bottom', async () => {
        render(<CameraParametersPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);

        await screen.findByText('左侧基准');
        expect(screen.queryByRole('tab', {name: /常用参数/})).not.toBeInTheDocument();
        expect(screen.getByText('曝光与对焦')).toBeInTheDocument();
        expect(screen.queryByText('设备信息')).not.toBeInTheDocument();
        expect(screen.queryByText('图像效果（SDK）')).not.toBeInTheDocument();
        const expandButton = screen.getByRole('button', {name: /展开全部参数/});
        expect(expandButton).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText(/当前显示 .* 项常用参数/)).not.toBeInTheDocument();

        fireEvent.click(expandButton);

        const collapseButton = screen.getByRole('button', {name: /收起全部参数/});
        expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('设备信息')).toBeInTheDocument();
        expect(screen.getByText('图像效果（SDK）')).toBeInTheDocument();
        expect(screen.getByText('亮度等级')).toBeInTheDocument();
        expect(screen.getByText('白平衡模式')).toBeInTheDocument();
        expect(screen.getAllByText('HCNetSDK').length).toBeGreaterThan(0);
        expect(screen.getAllByText('只读').length).toBeGreaterThan(0);
        expect(screen.getAllByText('可编辑').length).toBeGreaterThan(0);
        const statusTags = (label: string) => Array.from(
            screen.getByText(label).closest('.CameraParameterRow')!
                .querySelectorAll('.CameraParameterLabel small i'),
        ).map(node => node.textContent).filter(text =>
            ['只读', '已读取', '可编辑', '已修改'].includes(text || ''),
        );
        expect(statusTags('对焦位置')).toEqual(['只读', '已读取']);
        expect(statusTags('曝光模式')).toEqual(['已读取', '可编辑', '已修改']);
        expect(screen.getByText(/新增高级字段的原始值于/)).toBeInTheDocument();

        fireEvent.click(collapseButton);
        expect(screen.queryByText('设备信息')).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: /展开全部参数/})).toHaveAttribute('aria-expanded', 'false');
    });

    it('automatically refreshes the live side without a manual refresh button', async () => {
        jest.useFakeTimers();
        render(<CameraParametersPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);

        await act(async () => {
            await Promise.resolve();
        });
        expect(screen.getByText('左侧基准')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '刷新当前值'})).not.toBeInTheDocument();
        expect(screen.getByText('自动刷新')).toBeInTheDocument();
        expect(CameraParameterService.compare).toHaveBeenCalledTimes(1);

        await act(async () => {
            jest.advanceTimersByTime(5000);
            await Promise.resolve();
        });
        expect(CameraParameterService.compare).toHaveBeenCalledTimes(2);
    });

    it('edits only supported live camera controls and keeps device facts read-only', async () => {
        render(<CameraParametersPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);
        await screen.findByText('左侧基准');

        expect(screen.queryByRole('button', {name: '编辑设备名称'})).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '编辑增益等级'}));
        const input = screen.getByLabelText('增益等级当前值');
        fireEvent.change(input, {target: {value: '33'}});
        fireEvent.click(screen.getByRole('button', {name: '确认修改增益等级'}));

        await waitFor(() => expect(CameraParameterService.update).toHaveBeenCalledWith('resource-1', {gain_level: 33}));
        await waitFor(() => expect(CameraParameterService.compare).toHaveBeenCalledTimes(2));
    });

    it('reverts an active parameter trial before closing', async () => {
        const onClose = jest.fn();
        (CameraParameterService.compare as jest.Mock).mockResolvedValue({
            original: snapshot,
            current: {
                ...snapshot,
                source: 'live',
                live: true,
                controls: {
                    ...snapshot.controls,
                    trial: {
                        phase: 'trial',
                        dirty: true,
                        active: {auto_exposure: false, auto_focus: false, auto_wdr: false, auto_day_night: false},
                        started_at: '2026-08-07T02:05:00+00:00',
                        expires_at: '2026-08-07T02:15:00+00:00',
                        applied_at: null,
                    },
                },
            },
            changed_paths: ['controls.state.exposure.gain_level'],
        });
        render(<CameraParametersPanel resourceId='resource-1' language={Language.CHINESE} onClose={onClose}/>);

        expect(await screen.findByText('当前参数仅处于临时试调')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '关闭相机参数'}));

        await waitFor(() => expect(CameraTrialService.revert).toHaveBeenCalledWith('resource-1', true));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it('requires an explicit second confirmation before applying to the camera', async () => {
        (CameraParameterService.compare as jest.Mock).mockResolvedValue({
            original: snapshot,
            current: {
                ...snapshot,
                source: 'live',
                live: true,
                controls: {
                    ...snapshot.controls,
                    trial: {
                        phase: 'trial',
                        dirty: true,
                        active: {auto_exposure: false, auto_focus: false, auto_wdr: true, auto_day_night: false},
                        started_at: '2026-08-07T02:05:00+00:00',
                        expires_at: '2026-08-07T02:15:00+00:00',
                        applied_at: null,
                    },
                },
            },
            changed_paths: ['controls.state.wdr.mode'],
        });
        render(<CameraParametersPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);

        const applyButton = await screen.findByRole('button', {name: '下发到相机'});
        fireEvent.click(applyButton);
        expect(CameraTrialService.apply).not.toHaveBeenCalled();
        expect(screen.getByText('确认下发当前参数？')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '确认下发'}));
        await waitFor(() => expect(CameraTrialService.apply).toHaveBeenCalledWith('resource-1'));
        await waitFor(() => expect(screen.queryByText('确认下发当前参数？')).not.toBeInTheDocument());
    });
});
