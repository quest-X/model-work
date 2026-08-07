import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {CameraResourceService} from '../../../../services/CameraResourceService';
import {CameraConnectPopup} from '../CameraConnectPopup';

jest.mock('../../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({title, renderContent, acceptLabel, onAccept, disableAcceptButton, rejectLabel, onReject, footerContent}: any) => <div>
        <h1>{title}</h1>
        {renderContent()}
        {footerContent}
        <button onClick={onAccept} disabled={disableAcceptButton}>{acceptLabel}</button>
        <button onClick={onReject}>{rejectLabel}</button>
    </div>,
}));

jest.mock('../../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));

jest.mock('../../../../utils/DefaultBackendUrl', () => ({
    getExtensionEngineBaseUrl: () => 'http://gateway.test/extension_service',
}));

jest.mock('../../../../services/CameraResourceService', () => ({
    CameraResourceService: {
        discover: jest.fn(),
        list: jest.fn(),
        create: jest.fn(),
        credentials: jest.fn(),
        update: jest.fn(),
        open: jest.fn(),
    },
}));

const savedResource = {
    id: 'camera-resource-1',
    name: 'IP CAMERA',
    host: '192.168.10.12',
    port: 80,
    rtsp_port: 554,
    scheme: 'http' as const,
    channel_id: '101',
    device: {
        name: 'North gate',
        model: 'DS-2CD2686FWDA2-IZS',
        serial_number: '',
        firmware_version: '',
        device_type: 'IPC',
        mac_address: '',
    },
    channels: [],
    created_at: '2026-08-06T00:00:00Z',
    updated_at: '2026-08-07T00:00:00Z',
};

describe('CameraConnectPopup LAN discovery', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                status: 'success',
                device: savedResource.device,
                channels: [
                    {id: '101', name: 'Main', enabled: true, width: 3840, height: 2160, rtsp_url: 'rtsp://camera/101'},
                    {id: '102', name: 'Sub', enabled: true, width: 640, height: 360, rtsp_url: 'rtsp://camera/102'},
                ],
                snapshot_channel: '102',
                playback_channel: '102',
            }),
        }) as jest.Mock;
        (CameraResourceService.discover as jest.Mock).mockResolvedValue({
            networks: ['192.168.10.0/24'],
            scanned_hosts: 253,
            duration_ms: 1220,
            devices: [{
                host: '192.168.10.12',
                name: 'North gate',
                manufacturer: 'Hikvision',
                model: 'DS-2CD2686FWDA2-IZS',
                scheme: 'http',
                port: 80,
                rtsp_port: 554,
                sdk_port: 8000,
                open_ports: [80, 554, 8000],
                services: ['HTTP', 'RTSP', 'Hikvision SDK'],
                discovery_methods: ['WS-Discovery', 'RTSP'],
                confidence: 'confirmed',
            }],
        });
        (CameraResourceService.list as jest.Mock).mockResolvedValue([savedResource]);
        (CameraResourceService.credentials as jest.Mock).mockResolvedValue({
            host: savedResource.host,
            port: savedResource.port,
            rtsp_port: savedResource.rtsp_port,
            scheme: savedResource.scheme,
            username: 'camera-operator',
            password: 'saved-camera-password',
            verify_tls: false,
            timeout_seconds: 8,
        });
        (CameraResourceService.update as jest.Mock).mockResolvedValue(savedResource);
        (CameraResourceService.open as jest.Mock).mockResolvedValue(undefined);
    });

    it('fills editable saved credentials and updates the existing camera after confirmation', async () => {
        render(<CameraConnectPopup language={Language.CHINESE} imagesData={[]} />);

        await waitFor(() => expect(CameraResourceService.list).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole('button', {name: '扫描局域网'}));

        await waitFor(() => expect(screen.getByText('IP CAMERA')).toBeInTheDocument());
        expect(CameraResourceService.discover).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/发现 1 台相机/)).toBeInTheDocument();

        fireEvent.click(screen.getByText('IP CAMERA').closest('button') as HTMLButtonElement);

        await waitFor(() => {
            expect(CameraResourceService.credentials).toHaveBeenCalledWith(savedResource.id);
            expect(screen.getByLabelText('用户名')).toHaveValue('camera-operator');
        });
        expect(screen.getByPlaceholderText('192.168.10.64')).toHaveValue('192.168.10.12');
        const ports = screen.getAllByRole('spinbutton');
        expect(ports[0]).toHaveValue(80);
        expect(ports[1]).toHaveValue(554);
        expect(screen.queryByText('已记住')).not.toBeInTheDocument();
        expect(screen.getByText('已保存')).toBeInTheDocument();
        expect(screen.queryByText('填入表单')).not.toBeInTheDocument();
        expect(screen.queryByText('已记住此相机')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '使用已保存连接'})).not.toBeInTheDocument();
        expect(screen.getByLabelText('用户名')).toBeEnabled();
        expect(screen.getByLabelText('密码')).toHaveValue('saved-camera-password');
        expect(screen.getByLabelText('密码')).toBeEnabled();

        fireEvent.change(screen.getByLabelText('用户名'), {target: {value: 'edited-operator'}});
        fireEvent.click(screen.getByRole('button', {name: '连接'}));
        await waitFor(() => expect(screen.getByText('相机连接成功')).toBeInTheDocument());
        expect(screen.getByLabelText('播放通道')).toHaveValue('101');
        const successBanner = screen.getByText('相机连接成功');
        const protocolSelect = screen.getByLabelText('协议');
        const confirmButton = screen.getByRole('button', {name: '确认'});
        const connectedDetails = document.querySelector('.CameraConnectedDetails');
        expect(successBanner.closest('.CameraForm')).toBeNull();
        expect(successBanner.nextElementSibling).toHaveClass('CameraForm');
        expect(successBanner.compareDocumentPosition(protocolSelect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(successBanner.compareDocumentPosition(confirmButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(connectedDetails).not.toBeNull();
        expect(connectedDetails?.closest('.CameraDiscoveryPanel')).not.toBeNull();
        fireEvent.click(screen.getByRole('button', {name: '确认'}));

        await waitFor(() => expect(CameraResourceService.update).toHaveBeenCalledWith(
            savedResource.id,
            expect.objectContaining({
                username: 'edited-operator',
                password: 'saved-camera-password',
                host: savedResource.host,
                channel_id: '101',
            }),
        ));
        await waitFor(() => expect(CameraResourceService.open).toHaveBeenCalledWith(savedResource, []));
    });

    it('keeps manual credential entry available for a new camera', async () => {
        (CameraResourceService.list as jest.Mock).mockResolvedValue([]);
        render(<CameraConnectPopup language={Language.CHINESE} imagesData={[]} />);

        fireEvent.click(screen.getByRole('button', {name: '扫描局域网'}));
        await waitFor(() => expect(screen.getByText('North gate')).toBeInTheDocument());
        fireEvent.click(screen.getByText('North gate').closest('button') as HTMLButtonElement);

        expect(screen.getByPlaceholderText('192.168.10.64')).toHaveValue('192.168.10.12');
        expect(screen.getByPlaceholderText('admin')).toHaveValue('');
        expect(screen.getByPlaceholderText('123456')).toHaveValue('');
        expect(screen.getByText('未连接')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '连接'})).toBeDisabled();
    });
});
