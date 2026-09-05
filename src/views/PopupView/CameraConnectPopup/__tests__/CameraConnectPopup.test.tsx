import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {CameraDiscoveryResponse, CameraResourceService} from '../../../../services/CameraResourceService';
import {ComputeClusterService} from '../../../../services/ComputeClusterService';
import {CameraConnectPopup} from '../CameraConnectPopup';

jest.mock('../../GenericYesNoPopup/GenericYesNoPopup', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        connect: jest.fn(),
        snapshot: jest.fn(),
        discover: jest.fn(),
        list: jest.fn(),
        create: jest.fn(),
        credentials: jest.fn(),
        update: jest.fn(),
        open: jest.fn(),
        openCluster: jest.fn(),
    },
}));

jest.mock('../../../../services/ComputeClusterService', () => ({
    ComputeClusterService: {
        discoverCameras: jest.fn(),
        connectCamera: jest.fn(),
        snapshotCamera: jest.fn(),
        createCameraResource: jest.fn(),
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
        window.localStorage.clear();
        const connected = {
            status: 'success',
            device: savedResource.device,
            channels: [
                {id: '101', name: 'Main', enabled: true, codec: 'H.265', width: 3840, height: 2160, frame_rate: 25, rtsp_url: 'rtsp://camera/101'},
                {id: '102', name: 'Sub', enabled: true, codec: 'H.264', width: 640, height: 360, frame_rate: 25, rtsp_url: 'rtsp://camera/102'},
            ],
            snapshot_channel: '102',
            playback_channel: '102',
        } as const;
        (CameraResourceService.connect as jest.Mock).mockResolvedValue(connected);
        (ComputeClusterService.connectCamera as jest.Mock).mockResolvedValue(connected);
        (ComputeClusterService.snapshotCamera as jest.Mock).mockResolvedValue(new Blob(['jpeg']));
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
            }, {
                host: '192.168.10.30',
                name: 'Office Axis',
                manufacturer: 'Axis Communications',
                model: 'M3085-V',
                scheme: 'http',
                port: 80,
                rtsp_port: 554,
                sdk_port: null,
                open_ports: [80, 554],
                services: ['HTTP', 'RTSP'],
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
        (CameraResourceService.openCluster as jest.Mock).mockResolvedValue(undefined);
    });

    it('hides saved cameras while still loading known credentials by IP', async () => {
        render(<CameraConnectPopup language={Language.CHINESE} imagesData={[]} />);

        await waitFor(() => expect(CameraResourceService.list).toHaveBeenCalledTimes(1));
        expect(CameraResourceService.discover).not.toHaveBeenCalled();
        expect(screen.queryByText('上次使用的相机')).not.toBeInTheDocument();

        const hostInput = screen.getByPlaceholderText('192.168.10.64');
        fireEvent.change(hostInput, {target: {value: savedResource.host}});
        fireEvent.blur(hostInput);

        await waitFor(() => {
            expect(CameraResourceService.credentials).toHaveBeenCalledWith(savedResource.id);
            expect(screen.getByLabelText('用户名')).toHaveValue('camera-operator');
        });
        expect(screen.getByPlaceholderText('192.168.10.64')).toHaveValue('192.168.10.12');
        const ports = screen.getAllByRole('spinbutton');
        expect(ports[0]).toHaveValue(80);
        expect(ports[1]).toHaveValue(554);
        expect(screen.getByLabelText('用户名')).toBeEnabled();
        expect(screen.getByLabelText('密码')).toHaveValue('saved-camera-password');
        expect(screen.getByLabelText('密码')).toBeEnabled();
        expect(screen.getByLabelText('用户名').closest('.CameraCredentials')).toContainElement(screen.getByLabelText('密码'));

        fireEvent.change(screen.getByLabelText('用户名'), {target: {value: 'edited-operator'}});
        fireEvent.click(screen.getByRole('button', {name: '连接'}));
        await waitFor(() => expect(screen.getByText('相机连接成功')).toBeInTheDocument());
        expect(screen.getByLabelText('播放通道')).toHaveValue('101');
        const successBanner = screen.getByText('相机连接成功');
        const protocolSelect = screen.getByLabelText('协议');
        const confirmButton = screen.getByRole('button', {name: '保存'});
        const connectedDetails = document.querySelector('.CameraConnectedDetails');
        expect(successBanner.closest('.CameraForm')).toBeNull();
        expect(successBanner.nextElementSibling).toHaveClass('CameraForm');
        expect(successBanner.compareDocumentPosition(protocolSelect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(successBanner.compareDocumentPosition(confirmButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(connectedDetails).not.toBeNull();
        expect(connectedDetails?.closest('.CameraDiscoveryPanel')).not.toBeNull();
        fireEvent.click(screen.getByRole('button', {name: '保存'}));

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

        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));
        await waitFor(() => expect(screen.getByText('North gate')).toBeInTheDocument());
        expect(screen.queryByText('Office Axis')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('North gate').closest('button') as HTMLButtonElement);

        expect(screen.getByPlaceholderText('192.168.10.64')).toHaveValue('192.168.10.12');
        expect(screen.getByPlaceholderText('admin')).toHaveValue('');
        expect(screen.getByPlaceholderText('123456')).toHaveValue('');
        expect(screen.getByText('未连接')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '连接'})).toBeDisabled();
    });

    it('restores the last scan and offers a rescan when reopened', async () => {
        (CameraResourceService.list as jest.Mock).mockResolvedValue([]);
        const firstOpen = render(<CameraConnectPopup language={Language.CHINESE} imagesData={[]} />);
        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));
        expect(await screen.findByText('North gate')).toBeInTheDocument();
        firstOpen.unmount();

        render(<CameraConnectPopup language={Language.CHINESE} imagesData={[]} />);

        await waitFor(() => expect(CameraResourceService.list).toHaveBeenCalledTimes(2));
        expect(screen.getByText('North gate')).toBeInTheDocument();
        expect(screen.queryByText('Office Axis')).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: '重新扫描'})).toBeInTheDocument();
        expect(CameraResourceService.discover).toHaveBeenCalledTimes(1);
    });

    it('keeps scanning when closed and reattaches when reopened', async () => {
        let resolveScan: ((result: CameraDiscoveryResponse) => void) | undefined;
        let signal: AbortSignal | undefined;
        (CameraResourceService.list as jest.Mock).mockResolvedValue([]);
        (CameraResourceService.discover as jest.Mock).mockImplementation((_timeout, nextSignal) => {
            signal = nextSignal;
            return new Promise(resolve => {
                resolveScan = resolve;
            });
        });
        const firstOpen = render(<CameraConnectPopup language={Language.CHINESE} imagesData={[]} />);
        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));
        expect(await screen.findByText('后台扫描中；关闭窗口不会停止。')).toBeInTheDocument();

        firstOpen.unmount();
        render(<CameraConnectPopup language={Language.CHINESE} imagesData={[]} />);

        expect(await screen.findByRole('button', {name: '停止'})).toBeInTheDocument();
        expect(CameraResourceService.discover).toHaveBeenCalledTimes(1);
        expect(signal?.aborted).toBe(false);
        await act(async () => resolveScan?.({
            networks: ['192.168.10.0/24'], scanned_hosts: 253, duration_ms: 1220,
            devices: [{
                host: '192.168.10.12', name: 'North gate', manufacturer: 'Hikvision', model: '',
                scheme: 'http', port: 80, rtsp_port: 554, sdk_port: 8000,
                open_ports: [80, 554, 8000], services: ['HTTP', 'RTSP'],
                discovery_methods: ['RTSP'], confidence: 'confirmed',
            }],
        }));
        expect(await screen.findByText('扫描已完成；可选择结果或重新扫描。')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '重新扫描'})).toBeInTheDocument();
    });

    it('cancels a camera scan only when Stop is clicked', async () => {
        let signal: AbortSignal | undefined;
        (CameraResourceService.list as jest.Mock).mockResolvedValue([]);
        (CameraResourceService.discover as jest.Mock).mockImplementation((_timeout, nextSignal) => {
            signal = nextSignal;
            return new Promise((_resolve, reject) => nextSignal?.addEventListener('abort', () => {
                const aborted = new Error('Aborted');
                aborted.name = 'AbortError';
                reject(aborted);
            }));
        });
        render(<CameraConnectPopup language={Language.CHINESE} imagesData={[]} />);
        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));

        fireEvent.click(await screen.findByRole('button', {name: '停止'}));

        expect(signal?.aborted).toBe(true);
        expect(await screen.findByRole('button', {name: '开始扫描'})).toBeInTheDocument();
        expect(screen.queryByText('Aborted')).not.toBeInTheDocument();
    });

    it('runs discovery on the selected remote node instead of this computer', async () => {
        (CameraResourceService.list as jest.Mock).mockResolvedValue([]);
        (ComputeClusterService.discoverCameras as jest.Mock).mockResolvedValue({
            networks: ['192.168.50.0/24'],
            scanned_hosts: 253,
            duration_ms: 1500,
            devices: [{
                host: '192.168.50.12', name: 'remote-camera', manufacturer: 'Hikvision',
                model: '', scheme: 'http', port: 80, rtsp_port: 554, sdk_port: 8000,
                open_ports: [80, 554, 8000], services: ['HTTP', 'RTSP'],
                discovery_methods: ['RTSP'], confidence: 'confirmed',
            }, {
                host: '192.168.50.13', name: 'dahua-camera', manufacturer: 'Dahua',
                model: '', scheme: 'http', port: 80, rtsp_port: 554, sdk_port: 37777,
                open_ports: [554, 37777], services: ['RTSP'],
                discovery_methods: ['SDK 37777'], confidence: 'probable',
            }, {
                host: '192.168.50.20', name: 'web-server', manufacturer: 'Unknown',
                model: '', scheme: 'http', port: 80, rtsp_port: 554, sdk_port: null,
                open_ports: [80], services: ['HTTP'], discovery_methods: [], confidence: 'probable',
            }],
        });

        render(<CameraConnectPopup
            language={Language.CHINESE}
            imagesData={[]}
            nodeId='remote-node'
            nodeName='在线节点'
            remote
        />);
        expect(CameraResourceService.list).not.toHaveBeenCalled();
        expect(screen.getByText('扫描范围：在线节点 节点所在的远程局域网')).toBeInTheDocument();
        expect(screen.queryByText(/remote-node/)).not.toBeInTheDocument();
        expect(screen.getByText('海康、大华相机发现')).toBeInTheDocument();
        expect(screen.getByText(/扫描结果只显示海康、大华相机/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));

        expect(await screen.findByText('remote-camera')).toBeInTheDocument();
        expect(screen.getByText('dahua-camera')).toBeInTheDocument();
        expect(screen.queryByText('web-server')).not.toBeInTheDocument();
        expect(ComputeClusterService.discoverCameras).toHaveBeenCalledWith(
            'remote-node', 0.35, expect.any(AbortSignal),
        );
        expect(CameraResourceService.discover).not.toHaveBeenCalled();
    });

    it('shows progress while scanning a selected remote node', async () => {
        (ComputeClusterService.discoverCameras as jest.Mock).mockImplementation(() =>
            new Promise(() => undefined),
        );
        render(<CameraConnectPopup
            language={Language.CHINESE}
            imagesData={[]}
            nodeId='remote-node'
        />);

        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));

        expect(await screen.findByRole('progressbar', {name: '扫描进度'})).not.toHaveAttribute('value');
        fireEvent.click(screen.getByRole('button', {name: '停止'}));
    });

    it('does not create a remote resource when camera authentication fails', async () => {
        (ComputeClusterService.connectCamera as jest.Mock).mockRejectedValueOnce(
            new Error('相机认证失败，请检查用户名和密码'),
        );
        render(<CameraConnectPopup
            language={Language.CHINESE}
            imagesData={[]}
            nodeId='remote-node'
        />);

        fireEvent.change(screen.getByPlaceholderText('192.168.10.64'), {
            target: {value: '192.168.50.12'},
        });
        fireEvent.change(screen.getByLabelText('用户名'), {target: {value: 'operator'}});
        fireEvent.change(screen.getByLabelText('密码'), {target: {value: 'secret'}});
        fireEvent.click(screen.getByRole('button', {name: '连接'}));

        expect(await screen.findByText('相机认证失败，请检查用户名和密码')).toBeInTheDocument();
        expect(ComputeClusterService.createCameraResource).not.toHaveBeenCalled();
        expect(CameraResourceService.openCluster).not.toHaveBeenCalled();
    });

    it('keeps connect, snapshot, save, and live opening on the selected node', async () => {
        const remoteResource = {
            ...savedResource,
            id: '00000000-0000-4000-8000-000000000055',
            host: '192.168.50.12',
            name: 'remote-camera',
            channels: [{
                id: '102', name: 'Sub', enabled: true, codec: 'H.264', width: 640,
                height: 360, frame_rate: 25, rtsp_url: 'rtsp://192.168.50.12/102',
            }],
        };
        (ComputeClusterService.discoverCameras as jest.Mock).mockResolvedValue({
            networks: ['192.168.50.0/24'], scanned_hosts: 253, duration_ms: 1000,
            devices: [{
                host: '192.168.50.12', name: 'remote-camera', manufacturer: 'Hikvision',
                model: '', scheme: 'http', port: 80, rtsp_port: 554, sdk_port: 8000,
                open_ports: [80, 554, 8000], services: ['HTTP', 'RTSP'],
                discovery_methods: ['RTSP'], confidence: 'confirmed',
            }],
        });
        (ComputeClusterService.createCameraResource as jest.Mock).mockResolvedValue(remoteResource);
        Object.defineProperty(URL, 'createObjectURL', {
            configurable: true,
            value: jest.fn(() => 'blob:remote-camera'),
        });
        Object.defineProperty(URL, 'revokeObjectURL', {
            configurable: true,
            value: jest.fn(),
        });

        render(<CameraConnectPopup
            language={Language.CHINESE}
            imagesData={[]}
            nodeId='remote-node'
            nodeName='远程节点'
        />);
        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));
        fireEvent.click((await screen.findByText('remote-camera')).closest('button') as HTMLButtonElement);
        fireEvent.change(screen.getByLabelText('用户名'), {target: {value: 'operator'}});
        fireEvent.change(screen.getByLabelText('密码'), {target: {value: 'secret'}});
        fireEvent.click(screen.getByRole('button', {name: '连接'}));

        await screen.findByText('相机连接成功');
        fireEvent.click(screen.getByRole('button', {name: '抓图预览'}));
        await screen.findByAltText('相机抓图预览');
        fireEvent.click(screen.getByRole('button', {name: '保存'}));

        await waitFor(() => expect(CameraResourceService.openCluster).toHaveBeenCalled());
        expect(ComputeClusterService.connectCamera).toHaveBeenCalledWith(
            'remote-node', expect.objectContaining({host: '192.168.50.12', username: 'operator'}),
        );
        expect(ComputeClusterService.snapshotCamera).toHaveBeenCalledWith(
            'remote-node', expect.objectContaining({host: '192.168.50.12', channel_id: '102'}),
        );
        expect(ComputeClusterService.createCameraResource).toHaveBeenCalledWith(
            'remote-node', expect.objectContaining({host: '192.168.50.12', channel_id: '102'}),
        );
        expect(CameraResourceService.openCluster).toHaveBeenCalledWith(
            'remote-node', '远程节点', expect.objectContaining({device_id: remoteResource.id}), [],
        );
        expect(CameraResourceService.create).not.toHaveBeenCalled();
        expect(CameraResourceService.open).not.toHaveBeenCalled();
    });
});
