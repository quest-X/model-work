import React from 'react';
import {render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {ComputeClusterService} from '../../../../services/ComputeClusterService';
import {ComputeClusterPopup} from '../ComputeClusterPopup';

jest.mock('../../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));
jest.mock('../../../../services/ComputeClusterService', () => ({
    ComputeClusterService: {status: jest.fn(), nodes: jest.fn()},
}));

const service = ComputeClusterService as jest.Mocked<typeof ComputeClusterService>;

describe('ComputeClusterPopup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        service.status.mockResolvedValue({
            state: 'ready', version: '0.1.0', protocol_version: 1,
            admin_configured: true, nodes: {total: 1, online: 1, gpu_total: 1},
        });
        service.nodes.mockResolvedValue([{
            node_id: 'node-12345678', installation_id: 'install-1', name: 'edge-01',
            agent_version: '0.1.0', capabilities: ['system.health.v1'],
            network: {provider: 'tailscale', installed: true, online: true, addresses: ['100.64.0.1']},
            resources: {
                captured_at: 1, platform: 'linux', architecture: 'x86_64', cpu_logical: 16,
                load_average_1m: 0.5, memory_total_bytes: 64 * 1024 ** 3,
                memory_available_bytes: 48 * 1024 ** 3, disk_total_bytes: 1024 ** 4,
                disk_free_bytes: 700 * 1024 ** 3,
                gpus: [{index: 0, uuid: 'GPU-1', name: 'NVIDIA RTX 4090', memory_total_mb: 24564, memory_used_mb: 1024, utilization_percent: 20}],
            },
            enrolled_at: 1, last_seen_at: 1, enabled: true, online: true, heartbeat_age_seconds: 2,
        }]);
    });

    it('shows node, aggregate resources, and monitoring-only boundary', async () => {
        render(<ComputeClusterPopup language={Language.CHINESE}/>);

        expect(await screen.findByText('edge-01')).toBeInTheDocument();
        expect(screen.getByText('NVIDIA RTX 4090')).toBeInTheDocument();
        expect(screen.getByText('汇总灵析节点的计算资源与心跳状态；0.1 阶段仅监控，不开放远程命令。')).toBeInTheDocument();
        expect(screen.getAllByText('16')).toHaveLength(2);
        expect(screen.getAllByText('在线')).toHaveLength(2);
        await waitFor(() => expect(service.status).toHaveBeenCalledTimes(1));
    });

    it('shows enrollment guidance when the cluster is empty', async () => {
        service.status.mockResolvedValue({
            state: 'ready', version: '0.1.0', protocol_version: 1,
            admin_configured: true, nodes: {total: 0, online: 0, gpu_total: 0},
        });
        service.nodes.mockResolvedValue([]);
        render(<ComputeClusterPopup language={Language.CHINESE}/>);

        expect(await screen.findByText('尚未注册计算节点')).toBeInTheDocument();
        expect(screen.getByText('model-work-node cluster join --control-url <OpenSight URL> --enrollment-token-file <secret file>')).toBeInTheDocument();
    });
});
