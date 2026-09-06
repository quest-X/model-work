import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {ComputeClusterNode, ComputeClusterService} from '../../../../services/ComputeClusterService';
import {DeviceManagementPopup} from '../DeviceManagementPopup';

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

describe('DeviceManagementPopup remote camera management', () => {
    afterEach(() => jest.restoreAllMocks());

    it('closes from outside or Escape without rendering an X button', () => {
        const onClose = jest.fn();
        const {container} = render(<DeviceManagementPopup
            language={Language.CHINESE}
            node={node}
            cameras={[]}
            edgeDevices={[]}
            initialTab='camera'
            onClose={onClose}
            onAddCamera={jest.fn()}
            onDiscoverEdge={jest.fn()}
            onOpenCamera={jest.fn()}
            onOpenEdgeDevice={jest.fn()}
            onCamerasChanged={jest.fn()}
        />);

        expect(screen.queryByRole('button', {name: '关闭设备管理'})).not.toBeInTheDocument();
        fireEvent.mouseDown(screen.getByRole('dialog', {name: '设备管理'}));
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.mouseDown(container.querySelector('.DeviceManagementBackdrop') as HTMLElement);
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(window, {key: 'Escape'});
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('edits and deletes through the owning node', async () => {
        const update = jest.spyOn(ComputeClusterService, 'updateCameraResource').mockResolvedValue({} as never);
        const remove = jest.spyOn(ComputeClusterService, 'deleteCameraResource').mockResolvedValue();
        const changed = jest.fn();
        const {container} = render(<DeviceManagementPopup
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
            onOpenCamera={jest.fn()}
            onOpenEdgeDevice={jest.fn()}
            onCamerasChanged={changed}
        />);

        expect(screen.getByText('查看设备状态、通道与能力，并通过所属节点更名或删除。')).toBeInTheDocument();
        expect(container.querySelector('.DeviceManagementNodeState .fault')).toHaveTextContent('故障');
        expect(screen.queryByRole('button', {name: '刷新'})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '添加摄像头'})).not.toBeInTheDocument();
        expect(screen.queryByText('显示 1 / 1')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '编辑'})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '删除'})).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '管理'}));
        fireEvent.click(screen.getByRole('button', {name: '编辑'}));
        fireEvent.change(screen.getByRole('textbox', {name: '摄像头名称'}), {
            target: {value: '新名称'},
        });
        fireEvent.click(screen.getByRole('button', {name: '保存'}));
        await waitFor(() => expect(update).toHaveBeenCalledWith('node-1', 'camera-1', '新名称'));

        fireEvent.click(await screen.findByRole('button', {name: '删除'}));
        fireEvent.click(screen.getByRole('button', {name: '确认删除'}));
        await waitFor(() => expect(remove).toHaveBeenCalledWith('node-1', 'camera-1'));
        await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));

        fireEvent.click(screen.getByRole('button', {name: '完成'}));
        expect(screen.queryByRole('button', {name: '编辑'})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '删除'})).not.toBeInTheDocument();
    });

    it('groups unavailable cameras and offline edge devices under Fault', () => {
        render(<DeviceManagementPopup
            language={Language.ENGLISH}
            node={{...node, communication_state: 'abnormal'}}
            cameras={[{
                device_id: 'camera-1', kind: 'camera', provider: 'camera-connect',
                name: 'Remote camera', model: 'DS-2CD2686', status: 'registered', channels: 1,
                capabilities: [],
            }, {
                device_id: 'camera-2', kind: 'camera', provider: 'camera-connect',
                name: 'Fault camera', model: 'DS-2CD2686', status: 'offline', channels: 1,
                capabilities: [],
            }, {
                device_id: 'camera-3', kind: 'camera', provider: 'camera-connect',
                name: 'Unavailable camera', model: 'DS-2CD2686', status: 'unavailable', channels: 1,
                capabilities: [],
            }]}
            edgeDevices={[true, false].map((online, index) => ({
                asset_id: `edge-${index}`, node_id: node.node_id, node_name: node.name, cidr: '10.0.0.0/24',
                address: `10.0.0.${index + 1}`, hostname: '', mac: '', display_name: `Edge ${index}`,
                device_model: 'Orin', ports: [], online,
                first_seen_at: 1, last_seen_at: 1, last_changed_at: 1, change_type: 'unchanged',
            }))}
            initialTab='camera'
            onClose={jest.fn()}
            onAddCamera={jest.fn()}
            onDiscoverEdge={jest.fn()}
            onOpenCamera={jest.fn()}
            onOpenEdgeDevice={jest.fn()}
            onCamerasChanged={jest.fn()}
        />);

        expect(screen.getByRole('option', {name: 'Normal only'})).toBeInTheDocument();
        expect(screen.getByRole('option', {name: 'Fault only'})).toBeInTheDocument();
        expect(screen.queryByRole('option', {name: 'Abnormal only'})).not.toBeInTheDocument();
        expect(screen.getByLabelText('Device summary')).toHaveTextContent('Total3Normal1Fault2');
        expect(screen.getAllByText('Normal').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Fault').length).toBeGreaterThan(0);
        expect(screen.queryByText('Abnormal')).not.toBeInTheDocument();
        expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox', {name: 'Filter device status'}), {target: {value: 'fault'}});
        expect(screen.queryByText('Remote camera')).not.toBeInTheDocument();
        expect(screen.getByText('Fault camera')).toBeInTheDocument();
        expect(screen.getByText('Unavailable camera')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', {name: /Edge devices/}));
        expect(screen.getByLabelText('Device summary')).toHaveTextContent('Total2Normal1Fault1');
        fireEvent.change(screen.getByRole('combobox', {name: 'Filter device status'}), {target: {value: 'fault'}});
        expect(screen.queryByText('Edge 0')).not.toBeInTheDocument();
        expect(screen.getByText('Edge 1').closest('.DeviceManagementRow')
            ?.querySelector('.DeviceManagementStatus')).toHaveTextContent('Fault');
        expect(screen.getByText('Edge 1').closest('.DeviceManagementRow')
            ?.querySelector('.DeviceManagementStatus')).toHaveClass('fault');
    });

    it('opens camera live view and edge terminal only on double click', () => {
        const openCamera = jest.fn();
        const openEdgeDevice = jest.fn();
        render(<DeviceManagementPopup
            language={Language.CHINESE}
            node={node}
            cameras={[{
                device_id: 'camera-1', kind: 'camera', provider: 'camera-connect',
                name: '远程相机', model: 'DS-2CD2686', status: 'online', channels: 1,
                capabilities: [],
            }]}
            edgeDevices={[{
                asset_id: 'edge-1', node_id: 'node-1', node_name: 'remote-node', cidr: '10.0.0.0/24',
                address: '10.0.0.10', hostname: 'edge-device', mac: '', display_name: 'AIPACK-01',
                device_model: 'Orin', ports: [{port: 22, service: 'ssh'}], online: true,
                first_seen_at: 1, last_seen_at: 1, last_changed_at: 1, change_type: 'unchanged',
            }]}
            initialTab='camera'
            onClose={jest.fn()}
            onAddCamera={jest.fn()}
            onDiscoverEdge={jest.fn()}
            onOpenCamera={openCamera}
            onOpenEdgeDevice={openEdgeDevice}
            onCamerasChanged={jest.fn()}
        />);

        const cameraRow = screen.getByText('远程相机').closest('.DeviceManagementRow') as HTMLElement;
        fireEvent.click(cameraRow);
        expect(openCamera).not.toHaveBeenCalled();
        fireEvent.doubleClick(cameraRow);
        expect(openCamera).toHaveBeenCalledWith('camera-1');

        fireEvent.click(screen.getByRole('tab', {name: /边缘计算设备/}));
        const edgeRow = screen.getByText('AIPACK-01').closest('.DeviceManagementRow') as HTMLElement;
        fireEvent.click(edgeRow);
        expect(openEdgeDevice).not.toHaveBeenCalled();
        fireEvent.doubleClick(edgeRow);
        expect(openEdgeDevice).toHaveBeenCalledWith('edge-1');
    });
});
