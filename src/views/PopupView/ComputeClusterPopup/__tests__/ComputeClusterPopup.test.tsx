import React from 'react';
import {act, render, screen, waitFor} from '@testing-library/react';
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
        resourceGraph: jest.fn(), lanScanTargets: jest.fn(), lanAssets: jest.fn(),
        lanSchedules: jest.fn(), createLanSchedule: jest.fn(), controlLanSchedule: jest.fn(),
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
            network_dependencies: [{
                dependency_id: 'tailscale', kind: 'overlay_network', state: 'healthy',
                checked_at: 1, required_for: ['system.wait', 'information.web_fetch'],
            }, {
                dependency_id: 'control_ssh', kind: 'control_transport', state: 'healthy',
                checked_at: 1, required_for: ['system.wait', 'information.web_fetch'],
            }, {
                dependency_id: 'public_http', kind: 'internet_egress', state: 'healthy',
                checked_at: 1, required_for: ['information.web_fetch'],
            }],
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
        service.resourceGraph.mockResolvedValue({
            schema_version: 'resource-knowledge-graph.v2', group_id: 'group-1', generated_at: 1,
            summary: {
                entities: 9, relations: 8, online_nodes: 1, compute_resources: 1,
                managed_devices: 1, network_dependencies: 3, healthy_network_dependencies: 3,
                work_agents: 2, callable_work_agents: 2, interactive_work_agents: 2,
            },
            entities: [{
                entity_id: 'group:group-1', kind: 'compute_group', label: 'cross-region-lab',
                state: 'available', callable: true, modes: [],
            }, {
                entity_id: 'node:node-12345678', kind: 'compute_node', label: 'edge-01',
                state: 'available', callable: true, node_id: 'node-12345678', modes: [],
            }, {
                entity_id: 'compute-resource:node-12345678', kind: 'compute_resource', label: 'edge-01 compute',
                state: 'available', callable: true, node_id: 'node-12345678', modes: [],
                platform: 'linux', architecture: 'x86_64', cpu_logical: 16,
                memory_available_bytes: 48 * 1024 ** 3, disk_free_bytes: 700 * 1024 ** 3, gpu_count: 1,
            }, {
                entity_id: 'work-agent:system.wait', kind: 'work_agent', label: 'system.wait',
                state: 'available', callable: true, task_type: 'system.wait',
                capability: 'task.system.wait.v1', category: 'diagnostic',
                modes: ['online', 'background'], available_node_count: 1,
                required_network_dependencies: ['tailscale', 'control_ssh'],
                recommended_resources: {
                    cpu_cores: 0.1, memory_bytes: 64 * 1024 ** 2, disk_bytes: 0,
                    gpu_count: 0, gpu_memory_mb: 0,
                },
            }, {
                entity_id: 'work-agent:information.web_fetch', kind: 'work_agent', label: 'information.web_fetch',
                state: 'available', callable: true, task_type: 'information.web_fetch',
                capability: 'task.information.web_fetch.v1', category: 'information',
                modes: ['background'], available_node_count: 1,
                required_network_dependencies: ['tailscale', 'control_ssh', 'public_http'],
                recommended_resources: {
                    cpu_cores: 0.5, memory_bytes: 256 * 1024 ** 2, disk_bytes: 64 * 1024 ** 2,
                    gpu_count: 0, gpu_memory_mb: 0,
                },
            }, ...(['tailscale', 'control_ssh', 'public_http'] as const).map(dependencyId => ({
                entity_id: `network-dependency:node-12345678:${dependencyId}`,
                kind: 'network_dependency' as const,
                label: dependencyId,
                state: 'available' as const,
                callable: true,
                node_id: 'node-12345678',
                modes: [],
                dependency_id: dependencyId,
                dependency_kind: dependencyId === 'tailscale'
                    ? 'overlay_network'
                    : dependencyId === 'control_ssh' ? 'control_transport' : 'internet_egress',
                checked_at: 1,
                required_for: dependencyId === 'public_http'
                    ? ['information.web_fetch' as const]
                    : ['system.wait' as const, 'information.web_fetch' as const],
            })), {
                entity_id: 'managed-device:node-12345678:camera-1', kind: 'managed_device',
                label: 'IP CAMERA', state: 'available', callable: false,
                node_id: 'node-12345678', modes: [], provider: 'camera-connect',
                device_kind: 'camera', device_status: 'registered', channels: 2,
                device_model: 'DS-2CD2686FWDA2-IZS',
                device_capabilities: ['camera.registry.v1', 'camera.stream.v1'],
            }],
            relations: [{
                relation_id: 'contains:1', kind: 'contains', source_id: 'group:group-1',
                target_id: 'node:node-12345678', active: true, reason: 'available',
            }, {
                relation_id: 'provides:1', kind: 'provides', source_id: 'node:node-12345678',
                target_id: 'compute-resource:node-12345678', active: true, reason: 'available',
            }, {
                relation_id: 'can-execute:1', kind: 'can_execute', source_id: 'node:node-12345678',
                target_id: 'work-agent:system.wait', active: true, reason: 'available',
            }, {
                relation_id: 'can-execute:2', kind: 'can_execute', source_id: 'node:node-12345678',
                target_id: 'work-agent:information.web_fetch', active: true, reason: 'available',
            }, ...(['tailscale', 'control_ssh', 'public_http'] as const).map(dependencyId => ({
                relation_id: `depends-on:${dependencyId}`,
                kind: 'depends_on' as const,
                source_id: 'node:node-12345678',
                target_id: `network-dependency:node-12345678:${dependencyId}`,
                active: true,
                reason: 'available' as const,
            })), {
                relation_id: 'manages:camera-1', kind: 'manages',
                source_id: 'node:node-12345678',
                target_id: 'managed-device:node-12345678:camera-1',
                active: false, reason: 'not_console_allowlisted',
            }],
        });
        service.lanScanTargets.mockResolvedValue({
            version: 1,
            group_id: 'group-1',
            nodes: [{
                node_id: 'node-12345678',
                node_name: 'edge-01',
                targets: [{
                    interface: 'eth0', address: '192.168.50.20', cidr: '192.168.50.0/24',
                    prefix_length: 24, interface_cidr: '192.168.50.0/24',
                    narrowed: false, address_count: 254,
                }],
            }],
        });
        service.lanAssets.mockResolvedValue({
            version: 1, group_id: 'group-1',
            summary: {total: 1, online: 1, offline: 0, new: 1, changed: 0, networks: 1},
            latest_scans: [],
            assets: [{
                asset_id: 'lan-1', node_id: 'node-12345678', node_name: 'edge-01',
                cidr: '192.168.50.0/24', address: '192.168.50.30', hostname: 'camera.local',
                mac: '00:11:22:33:44:55', ports: [{port: 554, service: 'rtsp'}], online: true,
                first_seen_at: 1, last_seen_at: 1, last_changed_at: 1, change_type: 'new',
            }],
        });
        service.lanSchedules.mockResolvedValue({
            version: 1, group_id: 'group-1',
            summary: {total: 1, enabled: 1, paused: 0, failed: 0},
            schedules: [{
                schedule_id: 'schedule-1', node_id: 'node-12345678', node_name: 'edge-01',
                cidr: '192.168.50.0/24', interval_minutes: 60, enabled: true,
                created_at: 1, updated_at: 1, next_run_at: 9999999999,
                last_run_at: null, last_task_id: null, last_error: null, run_count: 2,
            }],
        });
    });

    it('shows node, aggregate resources, and the phase-six boundary', async () => {
        const user = userEvent.setup();
        render(<ComputeClusterPopup language={Language.CHINESE}/>);

        expect(await screen.findByRole('navigation', {name: '计算群工作区'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '资源与关系 0'})).toHaveAttribute('aria-current', 'page');
        await user.click(await screen.findByRole('button', {name: '节点详情 1'}));
        expect(screen.getByText('edge-01')).toBeInTheDocument();
        expect(screen.getByText('NVIDIA RTX 4090')).toBeInTheDocument();
        expect(screen.getByText('IP CAMERA')).toBeInTheDocument();
        expect(screen.getByText('DS-2CD2686FWDA2-IZS')).toBeInTheDocument();
        expect(screen.getByText('2 个通道')).toBeInTheDocument();
        expect(screen.getByText('已归属')).toBeInTheDocument();
        expect(screen.getByText('SSH: 可连接')).toBeInTheDocument();
        expect(screen.getByText('统一查看资源关系、工作调度、网络资产与节点状态。')).toBeInTheDocument();
        expect(screen.getAllByText('16')).toHaveLength(2);
        expect(screen.getAllByText('在线')).toHaveLength(2);
        expect(screen.queryByRole('button', {name: '刷新'})).not.toBeInTheDocument();
        expect(screen.getByRole('status', {name: '自动刷新正常 · v0.1.0'})).toBeInTheDocument();
        await waitFor(() => expect(service.status).toHaveBeenCalledTimes(1));
    });

    it('maximizes and restores the compute cluster workspace', async () => {
        const user = userEvent.setup();
        render(<ComputeClusterPopup language={Language.CHINESE}/>);

        const popup = screen.getByRole('region', {name: '计算群'});
        const maximize = screen.getByRole('button', {name: '放大计算群窗口'});
        expect(popup).not.toHaveClass('maximized');
        expect(maximize).toHaveAttribute('aria-pressed', 'false');

        await user.click(maximize);
        expect(popup).toHaveClass('maximized');
        expect(popup.parentElement).toHaveClass('maximized');
        const restore = screen.getByRole('button', {name: '还原计算群窗口'});
        expect(restore).toHaveAttribute('aria-pressed', 'true');

        await user.click(restore);
        expect(popup).not.toHaveClass('maximized');
        expect(screen.getByRole('button', {name: '放大计算群窗口'})).toHaveAttribute('aria-pressed', 'false');
    });

    it('refreshes the cluster automatically every two seconds', async () => {
        jest.useFakeTimers();
        try {
            render(<ComputeClusterPopup language={Language.CHINESE}/>);
            await act(async () => { await Promise.resolve(); });
            expect(service.status).toHaveBeenCalledTimes(1);

            await act(async () => {
                jest.advanceTimersByTime(2000);
                await Promise.resolve();
            });
            expect(service.status).toHaveBeenCalledTimes(2);
            expect(screen.queryByRole('button', {name: '刷新'})).not.toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });

    it('renders the authoritative graph and clears focus from the canvas background', async () => {
        const user = userEvent.setup();
        service.status.mockResolvedValue({
            state: 'ready', version: '0.1.0', protocol_version: 1,
            admin_configured: true,
            task_control: {
                enabled: true,
                allowed_task_types: ['system.wait', 'information.web_fetch'],
                resource_orchestration: true,
                work_agent_execution: true,
                resource_knowledge_graph: true,
                graph_schema: 'resource-knowledge-graph.v2',
                graph_interaction: true,
                network_dependency_health: true,
                managed_device_inventory: true,
                placement_modes: ['automatic', 'manual'],
            },
            nodes: {total: 1, online: 1, gpu_total: 1, device_total: 1},
        });

        render(<ComputeClusterPopup language={Language.CHINESE}/>);

        expect(await screen.findByText('计算群资源 Graph')).toBeInTheDocument();
        const resourceWorkspace = screen.getByRole('button', {name: '资源与关系 9'}).closest('.ComputeClusterPopup');
        const schedulerPanel = resourceWorkspace?.querySelector('.ComputeSchedulerPanel');
        const graphPanel = resourceWorkspace?.querySelector('.ComputeKnowledgePanel');
        expect(schedulerPanel?.nextElementSibling).toBe(graphPanel);
        expect(screen.getByText('资源关系 · 可交互')).toBeInTheDocument();
        expect(screen.getByText('cross-region-lab')).toBeInTheDocument();
        expect(screen.getByText('resource-knowledge-graph.v2')).toBeInTheDocument();
        expect(screen.getByTestId('resource-node-link-graph')).toBeInTheDocument();
        expect(screen.getAllByTestId('resource-graph-node')).toHaveLength(9);
        expect(screen.getAllByTestId('resource-graph-edge')).toHaveLength(8);
        expect(screen.getAllByText('公开信息采集 agent').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('等待诊断 agent').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('2/2')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '复位图谱'})).not.toBeInTheDocument();

        const node = screen.getByRole('button', {name: '查看 edge-01'});
        const canvas = screen.getByRole('figure', {name: '计算群资源节点关系图'});
        await user.click(node);
        expect(node).toHaveAttribute('aria-pressed', 'true');
        await user.click(canvas);
        expect(node).toHaveAttribute('aria-pressed', 'false');
        await waitFor(() => expect(service.resourceGraph).toHaveBeenCalledTimes(1));
    });

    it('uses a graph work-agent button to fill a directed task and recommended resources', async () => {
        const user = userEvent.setup();
        service.status.mockResolvedValue({
            state: 'ready', version: '0.2.0', protocol_version: 1,
            admin_configured: true,
            task_control: {
                enabled: true,
                allowed_task_types: ['system.wait', 'information.web_fetch'],
                resource_orchestration: true,
                work_agent_execution: true,
                resource_knowledge_graph: true,
                graph_schema: 'resource-knowledge-graph.v2',
                graph_interaction: true,
                network_dependency_health: true,
                managed_device_inventory: true,
                placement_modes: ['automatic', 'manual'],
            },
            nodes: {total: 1, online: 1, gpu_total: 1, device_total: 1},
        });
        service.submitTask.mockResolvedValue({} as never);

        render(<ComputeClusterPopup language={Language.CHINESE}/>);

        const agentButton = await screen.findByRole('button', {name: '选择 公开信息采集 agent'});
        expect(agentButton).toBeEnabled();
        await user.click(agentButton);

        expect(screen.getByRole('button', {name: '工作调度 0'})).toHaveAttribute('aria-current', 'page');
        expect(screen.getByText('已从图谱带入')).toBeInTheDocument();
        expect(screen.getByRole('combobox', {name: '工作类型'})).toHaveValue('information.web_fetch');
        expect(screen.getByRole('combobox', {name: '节点选择'})).toHaveValue('node-12345678');
        expect(screen.getByRole('spinbutton', {name: 'CPU 核心'})).toHaveValue(0.5);
        expect(screen.getByRole('spinbutton', {name: '内存（GB）'})).toHaveValue(0.25);
        expect(screen.getByRole('spinbutton', {name: '磁盘（GB）'})).toHaveValue(0.0625);

        await user.click(screen.getByRole('button', {name: '定向下发'}));
        await waitFor(() => expect(service.submitTask).toHaveBeenCalledWith(
            expect.objectContaining({
                node_id: 'node-12345678',
                task_type: 'information.web_fetch',
                resources: {
                    cpu_cores: 0.5,
                    memory_bytes: 256 * 1024 ** 2,
                    disk_bytes: 64 * 1024 ** 2,
                    gpu_count: 0,
                    gpu_memory_mb: 0,
                },
            }),
        ));
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

        await screen.findByRole('navigation', {name: '计算群工作区'});
        await user.click(await screen.findByRole('button', {name: '工作调度 1'}));
        expect(screen.queryByText('计算群调度池')).not.toBeInTheDocument();
        expect(screen.getByText('分发节点工作')).toBeInTheDocument();
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
                task_type: 'system.wait',
                resources: expect.objectContaining({cpu_cores: 1, memory_bytes: 1024 ** 3}),
            }),
        ));
    });

    it('dispatches the information work agent and renders redacted evidence metadata', async () => {
        const user = userEvent.setup();
        service.status.mockResolvedValue({
            state: 'ready', version: '0.1.0', protocol_version: 1,
            admin_configured: true,
            task_control: {
                enabled: true,
                allowed_task_types: ['system.wait', 'information.web_fetch'],
                resource_orchestration: true,
                work_agent_execution: true,
                evidence_projection: 'metadata-only-v1',
                placement_modes: ['automatic', 'manual'],
            },
            nodes: {total: 1, online: 1, gpu_total: 1, device_total: 1},
        });
        service.tasks.mockResolvedValue({
            version: 1, group_id: 'group-1', total: 1, counts: {succeeded: 1}, nodes: [],
            tasks: [{
                task_id: 'task-information', node_id: 'node-12345678', node_name: 'edge-01',
                task_type: 'information.web_fetch', mode: 'background', state: 'succeeded',
                created_at: 1, updated_at: 2, lease_seconds: 60, lease_expires_at: null,
                control_request: null, checkpoint: null, progress: null,
                result: {
                    schema_version: 'webfetch.console-result.v1',
                    request_id: 'request-1', status: 'fetched', reason_code: 'accepted',
                    provider: 'direct', requested_url: 'https://example.com/article',
                    final_url: 'https://example.com/article', fetched_at: '2026-08-11T20:00:00+08:00',
                    title: 'Public evidence', author: '', published_at: '', meaningful_chars: 2048,
                    content_sha256: 'a'.repeat(64), warnings: [], attempt_count: 1,
                },
                error: null, attempt: 1, parameters: {url: 'https://example.com/article'},
                resources: {cpu_cores: 1, memory_bytes: 1024 ** 3, disk_bytes: 0, gpu_count: 0, gpu_memory_mb: 0},
                placement: {mode: 'automatic', policy: 'most-available-v1', reserved: false, created_at: 1},
            }],
        });
        service.submitTask.mockResolvedValue({} as never);

        render(<ComputeClusterPopup language={Language.CHINESE}/>);

        await screen.findByRole('navigation', {name: '计算群工作区'});
        await user.click(await screen.findByRole('button', {name: '工作调度 1'}));
        expect(screen.getByText('公开信息抓取 · edge-01')).toBeInTheDocument();
        expect(screen.getByText('Public evidence')).toBeInTheDocument();
        expect(screen.getByText('direct · accepted · 1 次尝试')).toBeInTheDocument();
        expect(screen.getByText(/SHA-256 aaaaaaaaaaaa/)).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '暂停'})).not.toBeInTheDocument();
        expect(screen.getByText('正文、原始响应和节点路径留在执行节点；控制台仅显示来源、状态与内容哈希。')).toBeInTheDocument();

        const urlInput = screen.getByDisplayValue('https://example.com/');
        await user.clear(urlInput);
        await user.type(urlInput, 'https://example.com/article');
        await user.click(screen.getByRole('button', {name: '自动调度'}));
        await waitFor(() => expect(service.submitTask).toHaveBeenCalledWith(
            expect.objectContaining({
                task_type: 'information.web_fetch',
                mode: 'background',
                url: 'https://example.com/article',
                seconds: undefined,
            }),
        ));
    });

    it('dispatches phase 7.1 only to a selected node-advertised private network', async () => {
        const user = userEvent.setup();
        service.status.mockResolvedValue({
            state: 'ready', version: '0.3.0', protocol_version: 1,
            admin_configured: true,
            task_control: {
                enabled: true,
                allowed_task_types: ['system.wait', 'information.web_fetch', 'network.lan_discovery'],
                resource_orchestration: true,
                work_agent_execution: true,
                lan_discovery: true,
                placement_modes: ['automatic', 'manual'],
            },
            nodes: {total: 1, online: 1, gpu_total: 1, device_total: 1},
        });
        service.submitTask.mockResolvedValue({} as never);

        render(<ComputeClusterPopup language={Language.CHINESE}/>);

        await screen.findByRole('navigation', {name: '计算群工作区'});
        await user.click(screen.getByRole('button', {name: '工作调度 0'}));
        const workType = screen.getByRole('combobox', {name: '工作类型'});
        await user.selectOptions(workType, 'network.lan_discovery');
        await user.selectOptions(screen.getByRole('combobox', {name: '节点选择'}), 'node-12345678');

        expect(screen.getByRole('combobox', {name: '扫描网段'})).toHaveValue('192.168.50.0/24');
        expect(screen.getByText(/只扫描节点实时上报的私有网段/)).toBeInTheDocument();
        expect(screen.getByRole('combobox', {name: '运行方式'})).toBeDisabled();

        await user.click(screen.getByRole('button', {name: '定向下发'}));
        await waitFor(() => expect(service.submitTask).toHaveBeenCalledWith(
            expect.objectContaining({
                node_id: 'node-12345678',
                task_type: 'network.lan_discovery',
                mode: 'background',
                cidr: '192.168.50.0/24',
            }),
        ));
    });

    it('renders the network asset inventory in its workspace', async () => {
        const user = userEvent.setup();
        service.status.mockResolvedValue({
            state: 'ready', version: '0.3.1', protocol_version: 1,
            admin_configured: true,
            task_control: {
                enabled: true,
                allowed_task_types: ['system.wait', 'information.web_fetch', 'network.lan_discovery'],
                resource_orchestration: true,
                work_agent_execution: true,
                lan_discovery: true,
                lan_asset_inventory: true,
                placement_modes: ['automatic', 'manual'],
            },
            nodes: {total: 1, online: 1, gpu_total: 1, device_total: 1},
        });

        render(<ComputeClusterPopup language={Language.CHINESE}/>);

        await screen.findByRole('navigation', {name: '计算群工作区'});
        await user.click(await screen.findByRole('button', {name: '网络资产 1'}));
        expect(screen.getByText('资产台账')).toBeInTheDocument();
        expect(screen.getByText('camera.local')).toBeInTheDocument();
        expect(screen.getByText('rtsp:554')).toBeInTheDocument();
        expect(screen.getByText('00:11:22:33:44:55')).toBeInTheDocument();
        await waitFor(() => expect(service.lanAssets).toHaveBeenCalledTimes(1));
    });

    it('creates and controls scheduled discovery in the network workspace', async () => {
        const user = userEvent.setup();
        service.status.mockResolvedValue({
            state: 'ready', version: '0.3.2', protocol_version: 1,
            admin_configured: true,
            task_control: {
                enabled: true,
                allowed_task_types: ['network.lan_discovery'],
                resource_orchestration: true, lan_discovery: true,
                lan_discovery_schedules: true,
                phase7_complete: true, cross_region_recovery: true,
                placement_modes: ['automatic', 'manual'],
            },
            nodes: {total: 1, online: 1, gpu_total: 1, device_total: 1},
        });
        service.createLanSchedule.mockResolvedValue({} as never);
        service.controlLanSchedule.mockResolvedValue({} as never);

        render(<ComputeClusterPopup language={Language.CHINESE}/>);

        await screen.findByRole('navigation', {name: '计算群工作区'});
        await user.click(screen.getByRole('button', {name: '网络资产 0'}));
        expect(screen.getByText('自动发现')).toBeInTheDocument();
        expect(screen.getByText('已执行 2 次')).toBeInTheDocument();
        await user.selectOptions(screen.getByRole('combobox', {name: '计划节点'}), 'node-12345678');
        await user.click(screen.getByRole('button', {name: '创建计划'}));
        await waitFor(() => expect(service.createLanSchedule).toHaveBeenCalledWith({
            node_id: 'node-12345678', cidr: '192.168.50.0/24', interval_minutes: 60,
        }));
        await user.click(screen.getByRole('button', {name: '立即执行'}));
        await waitFor(() => expect(service.controlLanSchedule).toHaveBeenCalledWith('schedule-1', 'run-now'));
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
