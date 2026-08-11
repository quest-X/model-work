import React from 'react';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {Language} from '../../../../data/LanguageConfig';
import {ComputeClusterService} from '../../../../services/ComputeClusterService';
import {ComputeClusterPopup} from '../ComputeClusterPopup';

jest.mock('../../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));
jest.mock('../../../../services/ComputeClusterService', () => ({
    ComputeClusterService: {
        status: jest.fn(), nodes: jest.fn(), tasks: jest.fn(), scheduler: jest.fn(),
        submitTask: jest.fn(), controlTask: jest.fn(),
    },
}));

const service = ComputeClusterService as jest.Mocked<typeof ComputeClusterService>;

describe('ComputeClusterPopup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        service.status.mockResolvedValue({
            state: 'ready', version: '0.1.0', protocol_version: 1,
            admin_configured: true, nodes: {total: 1, online: 1, gpu_total: 1, device_total: 1},
        });
        service.nodes.mockResolvedValue([{
            node_id: 'node-12345678', installation_id: 'install-1', name: 'edge-01',
            agent_version: '0.1.0', capabilities: ['system.health.v1'],
            network: {
                provider: 'tailscale', installed: true, online: true, ssh_available: true,
                addresses: ['100.64.0.1'],
            },
            resources: {
                captured_at: 1, platform: 'linux', architecture: 'x86_64', cpu_logical: 16,
                load_average_1m: 0.5, memory_total_bytes: 64 * 1024 ** 3,
                memory_available_bytes: 48 * 1024 ** 3, disk_total_bytes: 1024 ** 4,
                disk_free_bytes: 700 * 1024 ** 3,
                gpus: [{index: 0, uuid: 'GPU-1', name: 'NVIDIA RTX 4090', memory_total_mb: 24564, memory_used_mb: 1024, utilization_percent: 20}],
            },
            device_inventory: {
                state: 'ready', error: null,
                devices: [{
                    device_id: 'camera-1', kind: 'camera', provider: 'camera-connect',
                    name: 'IP CAMERA', model: 'DS-2CD2686FWDA2-IZS', status: 'registered',
                    channels: 2, capabilities: ['camera.registry.v1', 'camera.stream.v1'],
                }],
            },
            enrolled_at: 1, last_seen_at: 1, enabled: true, online: true, heartbeat_age_seconds: 2,
        }]);
        service.tasks.mockResolvedValue({
            version: 1, group_id: 'group-1', total: 0, counts: {}, nodes: [], tasks: [],
        });
        service.scheduler.mockResolvedValue({
            version: 1, group_id: 'group-1', policy: 'most-available-v1', online_nodes: 1,
            totals: {cpu_cores: 16, memory_bytes: 48 * 1024 ** 3, disk_bytes: 700 * 1024 ** 3, gpu_count: 1, gpu_memory_mb: 23540},
            reserved: {cpu_cores: 0, memory_bytes: 0, disk_bytes: 0, gpu_count: 0, gpu_memory_mb: 0},
            available: {cpu_cores: 16, memory_bytes: 48 * 1024 ** 3, disk_bytes: 700 * 1024 ** 3, gpu_count: 1, gpu_memory_mb: 23540},
            active_allocations: 0, allocations: [],
        });
    });

    it('shows node, aggregate resources, and the phase-three boundary', async () => {
        render(<ComputeClusterPopup language={Language.CHINESE}/>);

        expect(await screen.findByText('edge-01')).toBeInTheDocument();
        expect(screen.getByText('NVIDIA RTX 4090')).toBeInTheDocument();
        expect(screen.getByText('IP CAMERA')).toBeInTheDocument();
        expect(screen.getByText('DS-2CD2686FWDA2-IZS')).toBeInTheDocument();
        expect(screen.getByText('2 个通道')).toBeInTheDocument();
        expect(screen.getByText('已归属')).toBeInTheDocument();
        expect(screen.getByText('SSH: 可连接')).toBeInTheDocument();
        expect(screen.getByText('第三阶段：汇总跨地域资源，按任务需求自动选择节点、预留容量并在终态释放。')).toBeInTheDocument();
        expect(screen.getAllByText('16')).toHaveLength(2);
        expect(screen.getAllByText('在线')).toHaveLength(2);
        await waitFor(() => expect(service.status).toHaveBeenCalledTimes(1));
    });

    it('shows task dispatch, durable progress, and controls when enabled', async () => {
        const user = userEvent.setup();
        service.status.mockResolvedValue({
            state: 'ready', version: '0.1.0', protocol_version: 1,
            admin_configured: true,
            task_control: {
                enabled: true,
                allowed_task_types: ['system.wait'],
                resource_orchestration: true,
                placement_modes: ['automatic', 'manual'],
            },
            nodes: {total: 1, online: 1, gpu_total: 1, device_total: 1},
        });
        service.tasks.mockResolvedValue({
            version: 1, group_id: 'group-1', total: 1, counts: {running: 1}, nodes: [],
            tasks: [{
                task_id: 'task-12345678', node_id: 'node-12345678', node_name: 'edge-01',
                task_type: 'system.wait', mode: 'background', state: 'running',
                created_at: 1, updated_at: 2, lease_seconds: 60, lease_expires_at: null,
                control_request: null, checkpoint: null,
                progress: {completed: 5, total: 20, unit: 'seconds', percent: 25},
                result: null, error: null, attempt: 1, parameters: {seconds: 20},
                resources: {cpu_cores: 1, memory_bytes: 1024 ** 3, disk_bytes: 0, gpu_count: 0, gpu_memory_mb: 0},
                placement: {mode: 'automatic', policy: 'most-available-v1', reserved: true, created_at: 1},
            }],
        });
        service.submitTask.mockResolvedValue({} as never);

        render(<ComputeClusterPopup language={Language.CHINESE}/>);

        expect(await screen.findByText('计算群调度池')).toBeInTheDocument();
        expect(screen.getByText('提交任务需求')).toBeInTheDocument();
        expect(screen.getByText('等待测试 · edge-01')).toBeInTheDocument();
        expect(screen.getByText(/自动调度 · CPU 1 · 1.0 GB/)).toBeInTheDocument();
        expect(screen.getAllByText('25%').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByRole('button', {name: '暂停'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '取消'})).toBeInTheDocument();
        expect(screen.getByText('关闭页面并超过租约后自动取消')).toBeInTheDocument();

        await user.click(screen.getByRole('button', {name: '自动调度'}));
        await waitFor(() => expect(service.submitTask).toHaveBeenCalledWith(
            expect.objectContaining({
                node_id: undefined,
                resources: expect.objectContaining({cpu_cores: 1, memory_bytes: 1024 ** 3}),
            }),
        ));
    });

    it('shows enrollment guidance when the cluster is empty', async () => {
        service.status.mockResolvedValue({
            state: 'ready', version: '0.1.0', protocol_version: 1,
            admin_configured: true, nodes: {total: 0, online: 0, gpu_total: 0, device_total: 0},
        });
        service.nodes.mockResolvedValue([]);
        render(<ComputeClusterPopup language={Language.CHINESE}/>);

        expect(await screen.findByText('尚未注册计算节点')).toBeInTheDocument();
        expect(screen.getByText('model-work-node cluster join --control-url <OpenSight URL> --enrollment-token-file <secret file>')).toBeInTheDocument();
    });
});
