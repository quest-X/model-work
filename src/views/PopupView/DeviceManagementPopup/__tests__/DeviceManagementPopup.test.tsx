import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {CameraResourceService} from '../../../../services/CameraResourceService';
import {ComputeClusterNode} from '../../../../services/ComputeClusterService';
import {DeviceManagementPopup} from '../DeviceManagementPopup';

jest.mock('../../../../services/CameraResourceService', () => ({
    CameraResourceService: {update: jest.fn(), delete: jest.fn()},
}));

const node = {
    node_id: 'node-1', installation_id: 'node-1', name: 'remote-node', agent_version: '0.9.0',
    capabilities: [], control_transport: 'tailscale',
    network: {provider: 'tailscale', installed: true, online: true, addresses: []},
    network_dependencies: [],
    resources: {
        captured_at: 1, platform: 'linux', architecture: 'x86_64', cpu_logical: 8,
        load_average_1m: 0, memory_total_bytes: 1, memory_available_bytes: 1,
        disk_total_bytes: 1, disk_free_bytes: 1, gpus: [],
    },
    device_inventory: {state: 'ready', devices: []},
    enrolled_at: 1, last_seen_at: 1, enabled: true, online: true, heartbeat_age_seconds: 1,
} as ComputeClusterNode;

describe('DeviceManagementPopup remote camera safety', () => {
    it('disables edit and delete instead of calling this computer camera service', () => {
        render(<DeviceManagementPopup
            language={Language.CHINESE}
            node={node}
            cameras={[{
                device_id: 'camera-1', kind: 'camera', provider: 'camera-connect',
                name: '远程相机', model: 'DS-2CD2686', status: 'online', channels: 1,
                capabilities: ['camera.stream.v1'],
            }]}
            edgeDevices={[]}
            initialTab='camera'
            onClose={jest.fn()}
            onAddCamera={jest.fn()}
            onDiscoverEdge={jest.fn()}
            onCamerasChanged={jest.fn()}
        />);

        expect(screen.getByText('查看设备状态、通道与能力。远程资源需在所属节点更名或删除。')).toBeInTheDocument();
        const edit = screen.getByRole('button', {name: '编辑'});
        const remove = screen.getByRole('button', {name: '删除'});
        expect(edit).toBeDisabled();
        expect(remove).toBeDisabled();
        fireEvent.click(edit);
        fireEvent.click(remove);
        expect(CameraResourceService.update).not.toHaveBeenCalled();
        expect(CameraResourceService.delete).not.toHaveBeenCalled();
    });

    it('uses Normal and Fault for English status filters and values', () => {
        render(<DeviceManagementPopup
            language={Language.ENGLISH}
            node={node}
            cameras={[{
                device_id: 'camera-1', kind: 'camera', provider: 'camera-connect',
                name: 'Remote camera', model: 'DS-2CD2686', status: 'online', channels: 1,
                capabilities: [],
            }, {
                device_id: 'camera-2', kind: 'camera', provider: 'camera-connect',
                name: 'Fault camera', model: 'DS-2CD2686', status: 'offline', channels: 1,
                capabilities: [],
            }]}
            edgeDevices={[]}
            initialTab='camera'
            onClose={jest.fn()}
            onAddCamera={jest.fn()}
            onDiscoverEdge={jest.fn()}
            onCamerasChanged={jest.fn()}
        />);

        expect(screen.getByRole('option', {name: 'Normal only'})).toBeInTheDocument();
        expect(screen.getAllByText('Normal').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Fault').length).toBeGreaterThan(0);
        expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    });
});
