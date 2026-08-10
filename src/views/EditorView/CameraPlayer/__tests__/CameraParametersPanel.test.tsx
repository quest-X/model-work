import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {CameraParameterService} from '../../../../services/CameraParameterService';
import {CameraPreviewService, CameraPreviewState} from '../../../../services/CameraPreviewService';
import CameraParametersPanel from '../CameraParametersPanel';

jest.mock('../../../../services/CameraParameterService', () => ({
    CameraParameterService: {compare: jest.fn()},
}));
jest.mock('../../../../services/CameraPreviewService', () => ({
    CameraPreviewService: {update: jest.fn(), apply: jest.fn(), revert: jest.fn()},
}));

const neutral = {brightness: 0, contrast: 1, gamma: 1, saturation: 1, sharpness: 0, denoise: 0};
const preview = (current = neutral, dirty = false): CameraPreviewState => ({
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
const snapshot = {
    captured_at: '2026-08-07T02:00:00+00:00',
    advanced_control_captured_at: '2026-08-07T03:00:00+00:00',
    source: 'connection',
    live: false,
    connection: {scheme: 'http', host: '192.168.10.12', management_port: 80, rtsp_port: 554, channel_id: '102'},
    device: {name: 'Camera 01', model: 'DS-2CD2686FWDA2-IZS', serial_number: 'TEST123', firmware_version: 'V5.7.23', device_type: 'IPCamera', mac_address: '00:11:22:33:44:55'},
    channels: [{id: '102', name: 'Camera 01', enabled: true, codec: 'H.265', width: 640, height: 360, frame_rate: 25, rtsp_url: 'rtsp://192.168.10.12:554/Streaming/Channels/102'}],
    controls: {
        capabilities: {auto_exposure: true, manual_exposure: true, exposure_metrics: true, auto_focus: true, focus_metrics: true},
        state: {
            exposure: {mode: 'auto', shutter_us: 10000, gain_level: 20},
            focus: {mode: 'auto', position: 30, relative_position: 30, speed_level: 2},
            wdr: {mode: 'close', level: 50},
            day_night: {mode: 'day'},
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
const comparison = (previewState = preview()) => ({
    original: snapshot,
    current: {...snapshot, captured_at: '2026-08-07T02:05:00+00:00', source: 'live', live: true},
    changed_paths: [],
    preview: previewState,
});

describe('CameraParametersPanel', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (CameraParameterService.compare as jest.Mock).mockResolvedValue(comparison());
        (CameraPreviewService.update as jest.Mock).mockResolvedValue(preview({...neutral, brightness: 0.25}, true));
        (CameraPreviewService.apply as jest.Mock).mockResolvedValue(preview({...neutral, brightness: 0.25}, false));
        (CameraPreviewService.revert as jest.Mock).mockResolvedValue(preview());
    });
    afterEach(() => jest.useRealTimers());

    it('shows common software parameters first and expands physical details at the bottom', async () => {
        render(<CameraParametersPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);

        expect(await screen.findByText('软件预览调参（1012）')).toBeInTheDocument();
        expect(screen.getByText('物理相机曝光与对焦（只读）')).toBeInTheDocument();
        expect(screen.queryByText('设备信息')).not.toBeInTheDocument();
        expect(screen.queryByRole('tab')).not.toBeInTheDocument();
        const expand = screen.getByRole('button', {name: /展开全部参数/});
        fireEvent.click(expand);
        expect(screen.getByText('设备信息')).toBeInTheDocument();
        expect(screen.getByText('图像效果（SDK）')).toBeInTheDocument();
        expect(screen.getAllByText('HCNetSDK').length).toBeGreaterThan(0);
        expect(screen.getAllByText('只读').length).toBeGreaterThan(0);
        expect(screen.getAllByText('可编辑').length).toBeGreaterThan(0);
        expect(screen.getByText(/新增高级字段的原始值于/)).toBeInTheDocument();
    });

    it('automatically refreshes the current side without a refresh button', async () => {
        jest.useFakeTimers();
        render(<CameraParametersPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);
        await act(async () => { await Promise.resolve(); });
        expect(screen.getByText('自动刷新')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '刷新当前值'})).not.toBeInTheDocument();
        expect(CameraParameterService.compare).toHaveBeenCalledTimes(1);
        await act(async () => { jest.advanceTimersByTime(5000); await Promise.resolve(); });
        expect(CameraParameterService.compare).toHaveBeenCalledTimes(2);
    });

    it('edits software preview values while physical camera values remain read-only', async () => {
        const onStreamChanged = jest.fn();
        render(<CameraParametersPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()} onStreamChanged={onStreamChanged}/>);
        await screen.findByText('软件预览调参（1012）');

        expect(screen.queryByRole('button', {name: '编辑增益等级'})).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '编辑亮度'}));
        const input = screen.getByLabelText('亮度当前值');
        fireEvent.input(input, {target: {value: '0.25'}});
        expect(input).toHaveValue(0.25);
        fireEvent.submit(input.closest('form')!);

        await waitFor(() => expect(CameraPreviewService.update).toHaveBeenCalledWith('resource-1', {brightness: 0.25}));
        await waitFor(() => expect(onStreamChanged).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryByLabelText('亮度当前值')).not.toBeInTheDocument());
    });

    it('keeps the left baseline unchanged, and closing does not revert software settings', async () => {
        const onClose = jest.fn();
        (CameraParameterService.compare as jest.Mock).mockResolvedValue(comparison(preview({...neutral, brightness: 0.25}, true)));
        render(<CameraParametersPanel resourceId='resource-1' language={Language.CHINESE} onClose={onClose}/>);

        expect(await screen.findByText('当前为 1012 软件预览参数')).toBeInTheDocument();
        const brightnessRow = screen.getByRole('button', {name: '编辑亮度'}).closest('.CameraParameterRow')!;
        expect(brightnessRow).toHaveTextContent('0.00');
        expect(brightnessRow).toHaveTextContent('0.25');
        fireEvent.click(screen.getByRole('button', {name: '关闭相机参数'}));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(CameraPreviewService.revert).not.toHaveBeenCalled();
    });

    it('requires confirmation before saving an OpenSight preset and never offers physical dispatch', async () => {
        (CameraParameterService.compare as jest.Mock).mockResolvedValue(comparison(preview({...neutral, brightness: 0.25}, true)));
        render(<CameraParametersPanel resourceId='resource-1' language={Language.CHINESE} onClose={jest.fn()}/>);

        fireEvent.click(await screen.findByRole('button', {name: '保存当前方案'}));
        expect(CameraPreviewService.apply).not.toHaveBeenCalled();
        expect(screen.getByText('确认保存 OpenSight 调参方案？')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /下发到相机/})).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '确认保存'}));
        await waitFor(() => expect(CameraPreviewService.apply).toHaveBeenCalledWith('resource-1'));
        await waitFor(() => expect(screen.queryByText('确认保存 OpenSight 调参方案？')).not.toBeInTheDocument());
    });
});
