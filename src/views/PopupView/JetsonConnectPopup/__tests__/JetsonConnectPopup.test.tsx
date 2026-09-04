import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {ComputeClusterService} from '../../../../services/ComputeClusterService';
import {JetsonConnectPopup} from '../JetsonConnectPopup';

jest.mock('../../GenericYesNoPopup/GenericYesNoPopup', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    GenericYesNoPopup: ({title, renderContent, acceptLabel, onAccept, disableAcceptButton}: any) => <div>
        <h1>{title}</h1>{renderContent()}
        <button onClick={onAccept} disabled={disableAcceptButton}>{acceptLabel}</button>
    </div>,
}));
jest.mock('../../../../logic/actions/PopupActions', () => ({PopupActions: {close: jest.fn()}}));
jest.mock('../../../../services/ComputeClusterService', () => ({
    ComputeClusterService: {scanLan: jest.fn(), lanAssets: jest.fn(), connectJetson: jest.fn()},
}));

const service = ComputeClusterService as jest.Mocked<typeof ComputeClusterService>;
const asset = {
    asset_id: 'lan-jetson', node_id: 'node-1', node_name: 'edge-01', cidr: '192.168.50.0/24',
    address: '192.168.50.60', hostname: 'jetson-orin', mac: '00:04:4b:11:22:33',
    device_kind: 'edge_compute', device_model: 'NVIDIA Jetson AGX Orin Developer Kit',
    ports: [{port: 22, service: 'ssh'}], online: true, first_seen_at: 1, last_seen_at: 1,
    last_changed_at: 1, change_type: 'new' as const,
};
const otherSshAsset = {
    ...asset,
    asset_id: 'lan-server', address: '192.168.50.61', hostname: 'linux-server',
    device_kind: '', device_model: 'Dell Precision 3660',
};

describe('JetsonConnectPopup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        service.scanLan.mockResolvedValue({
            schema_version: 'lan-discovery.console-result.v1', scan_id: 'scan-1',
            cidr: '192.168.50.0/24', interface: 'eth0', started_at: 1, finished_at: 2,
            addresses_scanned: 254, host_count: 1, ports_scanned: [22],
            hosts: [{address: asset.address, hostname: asset.hostname, mac: asset.mac, ports: asset.ports}],
            truncated: false,
        });
        service.lanAssets.mockResolvedValue({
            version: 1, group_id: 'group-1',
            summary: {total: 2, online: 2, offline: 0, new: 2, changed: 0, networks: 1},
            latest_scans: [], assets: [asset, otherSshAsset],
        });
        service.connectJetson
            .mockResolvedValueOnce({status: 'confirmation_required', fingerprint: 'SHA256:abcdefghijklmnopqrstuvwx'})
            .mockResolvedValueOnce({
                status: 'connected', fingerprint: 'SHA256:abcdefghijklmnopqrstuvwx',
                device_model: 'NVIDIA Jetson AGX Orin Developer Kit', architecture: 'aarch64',
                asset: {...otherSshAsset, device_kind: 'edge_compute', device_model: 'NVIDIA Jetson AGX Orin Developer Kit'},
            });
    });

    it('scans, confirms the SSH host key, and verifies a Jetson before adding it', async () => {
        render(<JetsonConnectPopup language={Language.CHINESE} nodeId='node-1' nodeName='baoxin-156-windows'/>);
        expect(screen.getByText('扫描范围：baoxin-156-windows 节点所在的本地局域网')).toBeInTheDocument();
        expect(screen.queryByText(/node-1/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));
        expect(await screen.findByText('jetson-orin')).toBeInTheDocument();
        expect(screen.getByText('linux-server')).toBeInTheDocument();
        expect(screen.getByText(/发现 2 台 SSH 候选设备/)).toBeInTheDocument();
        fireEvent.click(screen.getByText('linux-server').closest('button') as HTMLButtonElement);

        fireEvent.change(screen.getByPlaceholderText('nvidia'), {target: {value: 'jetson'}});
        fireEvent.change(screen.getByLabelText('密码'), {target: {value: 'secret'}});
        fireEvent.click(screen.getByRole('button', {name: '检查并连接'}));
        expect(await screen.findByText('SHA256:abcdefghijklmnopqrstuvwx')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '信任并连接'}));
        expect(await screen.findByText('NVIDIA Jetson AGX Orin Developer Kit')).toBeInTheDocument();
        await waitFor(() => expect(service.connectJetson).toHaveBeenLastCalledWith(
            'lan-server',
            expect.objectContaining({expected_fingerprint: 'SHA256:abcdefghijklmnopqrstuvwx'}),
        ));
    });

    it('keeps an SSH candidate unverified when device identification fails', async () => {
        service.connectJetson.mockReset().mockRejectedValue(new Error('SSH 设备不是 NVIDIA Jetson'));
        const dispatch = jest.spyOn(window, 'dispatchEvent');
        render(<JetsonConnectPopup language={Language.CHINESE} nodeId='node-1'/>);

        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));
        fireEvent.click((await screen.findByText('linux-server')).closest('button') as HTMLButtonElement);
        fireEvent.change(screen.getByPlaceholderText('nvidia'), {target: {value: 'operator'}});
        fireEvent.change(screen.getByLabelText('密码'), {target: {value: 'secret'}});
        fireEvent.click(screen.getByRole('button', {name: '检查并连接'}));

        expect(await screen.findByText('SSH 设备不是 NVIDIA Jetson')).toBeInTheDocument();
        expect(screen.getByText('未连接')).toBeInTheDocument();
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({type: 'opensight:jetson-updated'}));
        dispatch.mockRestore();
    });

    it('labels a main-site scan range as remote', () => {
        render(<JetsonConnectPopup language={Language.CHINESE} nodeId='node-1' nodeName='baoxin-156-windows' remote/>);
        expect(screen.getByText('扫描范围：baoxin-156-windows 节点所在的远程局域网')).toBeInTheDocument();
    });

    it('shows LAN scan errors in Chinese', async () => {
        service.scanLan.mockRejectedValue(new Error('Selected node has no scannable LAN segment'));
        render(<JetsonConnectPopup language={Language.CHINESE} nodeId='node-1'/>);

        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));

        expect(await screen.findByText('该节点没有可扫描的局域网网段（可能故障或没有私有网卡）')).toBeInTheDocument();
        expect(screen.queryByText('Selected node has no scannable LAN segment')).not.toBeInTheDocument();
    });

    it('stops an active scan', async () => {
        let signal: AbortSignal | undefined;
        service.scanLan.mockImplementation((_nodeId, nextSignal, onProgress) => {
            signal = nextSignal;
            onProgress?.(42, 106, 253);
            return new Promise((_resolve, reject) => nextSignal?.addEventListener('abort', () => {
                const aborted = new Error('Aborted');
                aborted.name = 'AbortError';
                reject(aborted);
            }));
        });
        render(<JetsonConnectPopup language={Language.CHINESE} nodeId='node-1'/>);

        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));
        expect(await screen.findByRole('progressbar', {name: '扫描进度'})).toHaveAttribute('value', '42');
        expect(screen.getByText('NVIDIA Jetson 发现 (106/253)')).toBeInTheDocument();
        expect(screen.queryByText('42%')).not.toBeInTheDocument();
        const stopButton = screen.getByRole('button', {name: '停止'});
        expect(stopButton).toHaveClass('danger');
        fireEvent.click(stopButton);

        expect(signal?.aborted).toBe(true);
        expect(await screen.findByRole('button', {name: '开始扫描'})).toBeInTheDocument();
    });
});
