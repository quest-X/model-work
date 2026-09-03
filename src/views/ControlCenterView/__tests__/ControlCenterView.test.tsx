import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {Language} from '../../../data/LanguageConfig';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeResourceGraph,
} from '../../../services/ComputeClusterService';
import {CameraResourceService} from '../../../services/CameraResourceService';
import {AgentChatService} from '../../../services/AgentChatService';
import {ControlCenterView} from '../ControlCenterView';

jest.mock('../../PopupView/ComputeClusterPopup/ComputeClusterPopup', () => ({
    ComputeClusterPopup: ({initialWorkspace}: {initialWorkspace: string}) => <section>
        <h3>{initialWorkspace === 'network' ? '节点局域网资产' : initialWorkspace}</h3>
    </section>,
}));

const node = (
    name: string,
    online: boolean,
    withCamera = false,
    hardwareModel?: string | null,
    platform = 'Windows',
    controlTransport: ComputeClusterNode['control_transport'] = online ? 'lan' : null,
): ComputeClusterNode => ({
    node_id: `${name}-id`,
    installation_id: `${name}-installation`,
    name,
    agent_version: '0.7.0',
    capabilities: ['system.health.v1'],
    control_transport: controlTransport,
    network: {
        provider: 'tailscale',
        installed: true,
        online,
        ssh_available: online,
        addresses: [],
    },
    network_dependencies: [
        {
            dependency_id: 'tailscale',
            kind: 'overlay_network',
            state: online ? 'healthy' : 'unavailable',
            checked_at: 1,
            required_for: [],
        },
        {
            dependency_id: 'control_ssh',
            kind: 'control_transport',
            state: online ? 'healthy' : 'unavailable',
            checked_at: 1,
            required_for: [],
        },
    ],
    resources: {
        captured_at: 1,
        platform,
        architecture: 'AMD64',
        ...(hardwareModel === undefined ? {} : {hardware_model: hardwareModel}),
        cpu_logical: 16,
        load_average_1m: null,
        memory_total_bytes: 32 * 1024 ** 3,
        memory_available_bytes: 16 * 1024 ** 3,
        disk_total_bytes: 1024 ** 4,
        disk_free_bytes: 512 * 1024 ** 3,
        disk_read_bytes_per_second: 8 * 1024 ** 2,
        disk_write_bytes_per_second: 2 * 1024 ** 2,
        network_receive_bytes_per_second: 4 * 1024 ** 2,
        network_send_bytes_per_second: 1024 ** 2,
        gpus: [],
    },
    device_inventory: {
        state: 'ready',
        devices: withCamera ? [{
            device_id: 'camera-1',
            kind: 'camera',
            provider: 'camera-connect',
            name: '车间相机',
            model: 'DS-2CD2686FWDA2-IZS',
            status: 'registered',
            channels: 2,
            capabilities: [],
        }] : [],
    },
    enrolled_at: 1,
    last_seen_at: 1,
    enabled: true,
    online,
    heartbeat_age_seconds: online ? 2 : 120,
});

const runtimeNode = (name: string, online = true): ComputeClusterNode => {
    const value = node(name, online);
    return {...value, capabilities: [...value.capabilities, 'runtime.read.v1', 'runtime.inventory.v1']};
};

const graph = (clusterNode: ComputeClusterNode): ComputeResourceGraph => ({
    schema_version: 'resource-knowledge-graph.v3',
    group_id: 'group-1',
    generated_at: 1,
    summary: {
        entities: 2,
        relations: 1,
        online_nodes: Number(clusterNode.online),
        regions: 1,
        compute_resources: 0,
        managed_devices: 0,
        network_dependencies: 0,
        healthy_network_dependencies: 0,
        work_agents: 0,
        callable_work_agents: 0,
        interactive_work_agents: 0,
    },
    entities: [{
        entity_id: 'region:test',
        kind: 'compute_region',
        label: '测试地域',
        state: clusterNode.online ? 'available' : 'unavailable',
        callable: true,
        modes: [],
        region_id: 'test',
        region_name: '测试地域',
        member_count: 1,
        online_member_count: Number(clusterNode.online),
    }, {
        entity_id: `node:${clusterNode.node_id}`,
        kind: 'compute_node',
        label: clusterNode.name,
        state: clusterNode.online ? 'available' : 'unavailable',
        callable: true,
        modes: [],
        node_id: clusterNode.node_id,
        region_id: 'test',
        region_name: '测试地域',
    }],
    relations: [{
        relation_id: 'contains:test',
        kind: 'contains',
        source_id: 'region:test',
        target_id: `node:${clusterNode.node_id}`,
        active: clusterNode.online,
        reason: clusterNode.online ? 'available' : 'node_offline',
    }],
});

describe('ControlCenterView', () => {
    beforeEach(() => {
        jest.spyOn(ComputeClusterService, 'runtime').mockImplementation(() => new Promise(() => undefined));
        jest.spyOn(ComputeClusterService, 'runtimeInventory').mockImplementation(() => new Promise(() => undefined));
        jest.spyOn(ComputeClusterService, 'runtimeEvents').mockImplementation(() => new Promise(() => undefined));
    });

    afterEach(() => {
        jest.restoreAllMocks();
        window.localStorage.clear();
    });

    it('selects an online machine and switches the central status view', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([
            node('离线节点', false),
            node('在线节点', true, true, 'NVIDIA Jetson AGX Orin'),
        ]);
        const {container, rerender} = render(<ControlCenterView language={Language.CHINESE}/>);

        expect(await screen.findByRole('heading', {name: '在线节点'})).toBeInTheDocument();
        expect(screen.getByRole('heading', {name: '基础信息'})).toBeInTheDocument();
        expect(screen.getByRole('heading', {name: '网络情况'})).toBeInTheDocument();
        expect(screen.getByRole('heading', {name: '运行服务'})).toBeInTheDocument();
        expect(screen.getByRole('heading', {name: '相关设备'})).toBeInTheDocument();
        expect(screen.queryByText('节点在线')).not.toBeInTheDocument();
        expect(screen.queryByText('设备信息与基础计算资源')).not.toBeInTheDocument();
        expect(screen.queryByText('集群节点局域网直连与远程连接')).not.toBeInTheDocument();
        expect(screen.queryByText('节点运行时与视觉算法服务')).not.toBeInTheDocument();
        expect(screen.queryByText('摄像头及其他边缘接入设备')).not.toBeInTheDocument();
        expect(screen.getByText('处理器')).toBeInTheDocument();
        expect(screen.getByText('内存')).toBeInTheDocument();
        expect(screen.getByText('图形处理器')).toBeInTheDocument();
        expect(screen.getByText('可用磁盘')).toBeInTheDocument();
        const deviceInformation = screen.getByLabelText('设备信息');
        expect(deviceInformation.children).toHaveLength(4);
        expect(screen.getByText('设备信息')).toBeInTheDocument();
        expect(screen.getByText('计算资源')).toBeInTheDocument();
        expect(within(deviceInformation).getByText('设备型号')).toBeInTheDocument();
        expect(within(deviceInformation).getByText('NVIDIA Jetson AGX Orin')).toBeInTheDocument();
        expect(within(deviceInformation).getByText('处理器架构')).toBeInTheDocument();
        expect(within(deviceInformation).getByText('AMD64')).toBeInTheDocument();
        expect(within(deviceInformation).getByText('0.7.0')).toBeInTheDocument();
        expect(within(deviceInformation).queryByText('最后检查')).not.toBeInTheDocument();
        expect(container.querySelector('.ControlNodeHeader')).toHaveTextContent('最后检查 未知');
        expect(container.querySelector('.ControlNodeHeader')).not.toHaveTextContent('节点程序 0.7.0');
        expect(within(container.querySelector('.ControlToolbarGroup') as HTMLElement)
            .getByText('在线节点-id')).toBeInTheDocument();
        expect(within(deviceInformation).queryByText('节点状态')).not.toBeInTheDocument();
        expect(screen.queryByText('全部')).not.toBeInTheDocument();
        expect(screen.queryByText('CPU')).not.toBeInTheDocument();
        expect(screen.queryByText('GPU')).not.toBeInTheDocument();
        expect(screen.getByText('SSH 局域网')).toBeInTheDocument();
        expect(screen.getByText('Tailscale 远程')).toBeInTheDocument();
        expect(screen.getByText('DS-2CD2686FWDA2-IZS')).toBeInTheDocument();
        expect(screen.getByText('已登记 · 运行状态未上报')).toBeInTheDocument();
        expect(screen.queryByText('摄像头注册表')).not.toBeInTheDocument();
        expect(screen.queryByText('运行详情暂不可用')).not.toBeInTheDocument();
        expect(ComputeClusterService.runtime).not.toHaveBeenCalled();
        expect(screen.getByText('计算群资源心跳有效')).toBeInTheDocument();
        expect(screen.queryByText('视觉算法服务')).not.toBeInTheDocument();
        expect(container.querySelector('.EditorContainer.ControlCenterView')).toBeInTheDocument();
        expect(container.querySelector('.EditorTopNavigationBar.ControlTopNavigationBar')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '刷新机器状态'})).toBeInTheDocument();
        expect(container.querySelector('.SideNavigationBar.right')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('机器'));
        expect(container.querySelector('.SideNavigationBar.left.closed')).toBeInTheDocument();
        expect(container.querySelector('.SideNavigationBar.left .NavigationBarContentWrapper')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('机器'));

        fireEvent.click(screen.getByRole('button', {name: /离线节点/}));
        expect(screen.getByRole('heading', {name: '离线节点'})).toBeInTheDocument();
        expect(screen.getByText('计算群资源心跳已中断')).toBeInTheDocument();
        expect(within(screen.getByLabelText('设备信息')).getByText('未上报')).toBeInTheDocument();
        const offlineSsh = screen.getByRole('button', {name: /SSH 局域网.*打开当前节点终端连接/});
        const offlineTailscale = screen.getByRole('button', {name: /Tailscale 远程.*打开当前节点终端连接/});
        expect(offlineSsh).toBeDisabled();
        expect(offlineTailscale).toBeDisabled();
        expect(offlineSsh).toHaveTextContent('故障');
        expect(offlineTailscale).toHaveTextContent('故障');
        expect(offlineSsh.querySelector('.ControlStatusDot')).toHaveClass('offline');
        expect(offlineTailscale.querySelector('.ControlStatusDot')).toHaveClass('offline');

        rerender(<ControlCenterView language={Language.ENGLISH}/>);
        expect(screen.getByText('CPU')).toBeInTheDocument();
        expect(screen.getByText('Memory')).toBeInTheDocument();
        expect(screen.getByText('GPU')).toBeInTheDocument();
        expect(screen.getByText('Available disk')).toBeInTheDocument();
        const englishDeviceInformation = screen.getByLabelText('Device information');
        expect(englishDeviceInformation.children).toHaveLength(4);
        expect(within(englishDeviceInformation).getByText('Device model')).toBeInTheDocument();
        expect(within(englishDeviceInformation).getByText('Not reported')).toBeInTheDocument();
        expect(within(englishDeviceInformation).getByText('Processor architecture')).toBeInTheDocument();
        expect(container.querySelector('.ControlNodeHeader')).toHaveTextContent('Last check Unknown');
        expect(within(englishDeviceInformation).queryByText('Node state')).not.toBeInTheDocument();
        expect(screen.getByText('LAN SSH')).toBeInTheDocument();
        expect(screen.getByText('Remote Tailscale')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: /Active Just now/})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /camera/})).not.toBeInTheDocument();
        expect(screen.queryByText('处理器')).not.toBeInTheDocument();
        expect(screen.queryByText('图形处理器')).not.toBeInTheDocument();
    });

    it('does not report LAN SSH as healthy when the active control route is Tailscale', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([
            node('山东节点', true, false, null, 'Windows', 'tailscale'),
        ]);
        render(<ControlCenterView language={Language.CHINESE}/>);

        const lan = await screen.findByRole('button', {name: /SSH 局域网/});
        const remote = screen.getByRole('button', {name: /Tailscale 远程/});
        expect(lan).toHaveTextContent('故障');
        expect(lan.querySelector('.ControlStatusDot')).toHaveClass('offline');
        expect(remote).toHaveTextContent('正常');
        expect(remote.querySelector('.ControlStatusDot')).toHaveClass('healthy');
    });

    it('opens the resource monitor without overview service cards', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([
            runtimeNode('节点甲'),
            runtimeNode('节点乙'),
        ]);
        const runtime = jest.mocked(ComputeClusterService.runtime).mockImplementation(async () => ({
            schema_version: 'runtime.snapshot.v1',
            captured_at: 100,
            summary: {total: 2, healthy: 2, degraded: 0, unavailable: 0, task_counts: {running: 1}},
            services: [{
                service_id: 'node-agent',
                name: 'Node Agent',
                kind: 'service',
                state: 'healthy',
                version: '0.8.0',
                uptime_seconds: 3600,
                restart_count: null,
                health: {state: 'healthy', checked_at: 100, status_code: 200, latency_ms: 12},
                process: {pid: 4321, state: 'running'},
                task_counts: {},
            }, {
                service_id: 'task-executor',
                name: 'Task Executor',
                kind: 'worker',
                state: 'healthy',
                version: '0.8.0',
                uptime_seconds: 3600,
                restart_count: null,
                health: {state: 'healthy', checked_at: 100, status_code: 200, latency_ms: null},
                process: {pid: 4321, state: 'running'},
                task_counts: {running: 1, failed: 0},
            }],
        }));
        jest.mocked(ComputeClusterService.runtimeEvents).mockImplementation(async nodeId => {
            if (nodeId === '节点乙-id') throw new Error('events unavailable');
            return {
                schema_version: 'runtime.events.v1',
                captured_at: 101,
                cursor: 7,
                events: [{
                    cursor: 6,
                    created_at: 101 - 24 * 60 * 60 - 1,
                    service_id: 'task-executor',
                    level: 'error',
                    event_type: 'lease_expired',
                    message: 'Task lease expired',
                    task_id: 'old-task',
                }, {
                    cursor: 7,
                    created_at: 101,
                    service_id: 'node-agent',
                    level: 'warning',
                    event_type: 'health.degraded',
                    message: '探测延迟升高',
                    task_id: null,
                }],
                has_more: false,
            };
        });
        const runtimeInventory = jest.mocked(ComputeClusterService.runtimeInventory).mockResolvedValue({
            schema_version: 'runtime.inventory.v1',
            captured_at: 101,
            processes_available: true,
            processes: [{
                pid: 9876,
                name: 'python.exe',
                memory_bytes: 64 * 1024 ** 2,
                state: 'running',
            }, {
                pid: 1234,
                name: 'zeta.exe',
                memory_bytes: 128 * 1024 ** 2,
                state: 'sleeping',
            }],
            startup_services_available: true,
            startup_services: [{
                name: 'ModelWorkNodeAgent',
                display_name: 'Model Work Node Agent',
                state: 'running',
                start_type: 'automatic',
            }, {
                name: 'AlphaService',
                display_name: 'Alpha Service',
                state: 'stopped',
                start_type: 'automatic',
            }],
        });
        jest.spyOn(ComputeClusterService, 'tasks').mockResolvedValue({
            version: 1,
            group_id: 'default',
            total: 2,
            counts: {queued: 1, succeeded: 1},
            nodes: [],
            tasks: [{
                task_id: 'task-network-1',
                node_id: '节点乙-id',
                node_name: '节点乙',
                task_type: 'system.wait',
                mode: 'online',
                state: 'queued',
                created_at: 100,
                updated_at: 101,
                lease_seconds: 30,
                result: null,
                error: null,
                attempt: 0,
                parameters: {seconds: 1},
            }, {
                task_id: 'task-web-2',
                node_id: '节点甲-id',
                node_name: '节点甲',
                task_type: 'information.web_fetch',
                mode: 'background',
                state: 'succeeded',
                created_at: 98,
                updated_at: 99,
                lease_seconds: 30,
                result: null,
                error: null,
                attempt: 1,
                parameters: {url: 'https://example.com'},
            }],
        });
        jest.spyOn(AgentChatService, 'conversations').mockResolvedValue([{
            id: 'conversation-1',
            title: '@节点乙 测试连通',
            created_at: '2026-09-03T01:00:00Z',
            updated_at: '2026-09-03T01:01:00Z',
        }]);
        jest.spyOn(AgentChatService, 'conversation').mockResolvedValue({
            conversation: {
                id: 'conversation-1',
                title: '@节点乙 测试连通',
                created_at: '2026-09-03T01:00:00Z',
                updated_at: '2026-09-03T01:01:00Z',
            },
            messages: [{
                id: 'message-1',
                conversation_id: 'conversation-1',
                role: 'user',
                content: '@节点乙 测试连通',
                metadata: {},
                created_at: '2026-09-03T01:00:00Z',
            }, {
                id: 'message-2',
                conversation_id: 'conversation-1',
                role: 'assistant',
                content: '已向节点乙下发连通测试。',
                metadata: {},
                created_at: '2026-09-03T01:01:00Z',
            }],
        });
        render(<ControlCenterView language={Language.CHINESE}/>);

        await screen.findByRole('button', {name: '打开资源监视器'});
        await waitFor(() => expect(runtime).toHaveBeenCalledWith('节点甲-id', expect.anything()));
        expect(screen.getByText(/^最后检查 /)).toBeInTheDocument();
        expect(document.querySelector('.ControlRuntimeChecked')).not.toBeInTheDocument();
        expect(screen.queryByText('视觉算法服务')).not.toBeInTheDocument();
        const recentIssues = await screen.findByLabelText('最近异常');
        expect(recentIssues).toHaveTextContent('探测延迟升高');
        expect(screen.getByRole('heading', {name: '运行服务'}).closest('section')).not.toContainElement(recentIssues);
        expect(screen.queryByText('Task lease expired')).not.toBeInTheDocument();
        expect(screen.queryByText('Node Agent')).not.toBeInTheDocument();
        fireEvent.click(within(recentIssues).getByRole('button', {name: '关闭最近异常'}));
        expect(screen.queryByLabelText('最近异常')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '打开资源监视器'}));
        const monitor = await screen.findByRole('dialog', {name: '节点甲 资源监视器'});
        expect(within(monitor).getByRole('navigation', {name: '资源监视器导航'})).toBeInTheDocument();
        expect(within(monitor).getAllByText('50%')).toHaveLength(3);
        expect(within(monitor).getByRole('complementary', {name: '资源列表'})).toBeInTheDocument();
        expect(within(monitor).getAllByRole('img', {name: '内存使用率趋势'})).toHaveLength(2);
        expect(within(monitor).getByRole('img', {name: '磁盘读写趋势'})).toBeInTheDocument();
        expect(within(monitor).getByText('等待利用率数据')).toBeInTheDocument();
        fireEvent.click(within(monitor).getByRole('button', {name: '磁盘 50%'}));
        expect(within(monitor).getByLabelText('磁盘 性能详情')).toHaveTextContent('读取 8.0 MB/s');
        expect(within(monitor).getByLabelText('磁盘 性能详情')).toHaveTextContent('蓝色读取 · 橙色写入');

        const monitorNavigation = within(monitor).getByRole('navigation', {name: '资源监视器导航'});
        expect(runtimeInventory).toHaveBeenCalledWith('节点甲-id', expect.anything());
        fireEvent.click(within(monitorNavigation).getByRole('button', {name: '进程'}));
        const processSection = within(monitor).getByLabelText('进程清单');
        const processRows = () => within(processSection).getAllByRole('row').slice(1);
        expect(processRows()[0]).toHaveTextContent('zeta.exe');
        fireEvent.click(within(processSection).getByRole('button', {name: '按名称升序排列'}));
        expect(processRows()[0]).toHaveTextContent('python.exe');
        fireEvent.click(within(processSection).getByRole('button', {name: '按名称降序排列'}));
        expect(processRows()[0]).toHaveTextContent('zeta.exe');
        fireEvent.click(within(monitorNavigation).getByRole('button', {name: '启动应用'}));
        const startupSection = within(monitor).getByLabelText('启动应用清单');
        const startupRows = () => within(startupSection).getAllByRole('row').slice(1);
        expect(startupRows()[0]).toHaveTextContent('Alpha Service');
        fireEvent.click(within(startupSection).getByRole('button', {name: '按名称降序排列'}));
        expect(startupRows()[0]).toHaveTextContent('Model Work Node Agent');
        expect(startupSection).toHaveTextContent('自动');
        expect(within(monitorNavigation).queryByRole('button', {name: '网络'})).not.toBeInTheDocument();
        fireEvent.click(within(monitorNavigation).getByRole('button', {name: '性能'}));
        fireEvent.click(within(monitor).getByRole('button', {name: '网络 正常'}));
        expect(within(monitor).getByLabelText('网络 性能详情')).toHaveTextContent('下载 4.0 MB/s');
        expect(within(monitor).getByLabelText('网络 性能详情')).toHaveTextContent('蓝色下载 · 红色上传');

        fireEvent.click(within(monitor).getByRole('button', {name: '服务'}));
        expect(within(monitor).getByText('受管服务')).toBeInTheDocument();
        expect(within(monitor).queryByText('Task Executor')).not.toBeInTheDocument();
        expect(within(monitor).getByText('任务执行器').parentElement).toHaveTextContent('正常');
        expect(within(monitor).getByText('接口健康')).toBeInTheDocument();
        expect(within(monitor).getByText(/HTTP 200/)).toHaveTextContent('12 ms');
        expect(within(monitor).getByText(/PID 4321/)).toHaveTextContent('运行中');
        expect(within(monitor).getByText(/运行中 1/)).toHaveTextContent('失败 0');
        expect(within(monitor).getByText('探测延迟升高')).toBeInTheDocument();

        fireEvent.click(within(monitor).getByRole('button', {name: '任务'}));
        expect(await within(monitor).findByText('task-network-1')).toBeInTheDocument();
        const taskSection = within(monitor).getByLabelText('提交任务');
        const taskRows = () => within(taskSection).getAllByRole('row').slice(1);
        expect(taskSection).toHaveTextContent('连通测试');
        expect(within(monitor).getByText('排队')).toBeInTheDocument();
        expect(taskRows()[0]).toHaveTextContent('task-network-1');
        fireEvent.click(within(taskSection).getByRole('button', {name: '按任务升序排列'}));
        expect(taskRows()[0]).toHaveTextContent('task-web-2');
        fireEvent.click(within(taskSection).getByRole('button', {name: '按任务降序排列'}));
        expect(taskRows()[0]).toHaveTextContent('task-network-1');
        expect(within(monitor).queryByText('过往对话')).not.toBeInTheDocument();

        fireEvent.click(within(monitor).getByRole('button', {name: '对话'}));
        expect(await within(monitor).findAllByText('@节点乙 测试连通')).toHaveLength(2);
        expect(within(monitor).getByLabelText('对话记录')).toHaveTextContent('已向节点乙下发连通测试。');
        expect(ComputeClusterService.tasks).toHaveBeenCalled();
        expect(AgentChatService.conversation).toHaveBeenCalledWith('conversation-1');

        fireEvent.click(within(monitor).getByRole('button', {name: '关闭资源监视器'}));
        expect(screen.queryByRole('dialog', {name: '节点甲 资源监视器'})).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: /节点乙/}));
        await waitFor(() => expect(ComputeClusterService.runtimeEvents)
            .toHaveBeenCalledWith('节点乙-id', 0, 50, expect.anything()));
        expect(screen.queryByText('Task Executor')).not.toBeInTheDocument();
        expect(screen.queryByText('Node Agent')).not.toBeInTheDocument();
        expect(screen.queryByText('运行详情暂不可用')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '打开资源监视器'}));
        const secondMonitor = await screen.findByRole('dialog', {name: '节点乙 资源监视器'});
        fireEvent.click(within(secondMonitor).getByRole('button', {name: '服务'}));
        expect(await within(secondMonitor)
            .findByText(/服务日志暂不可用：events unavailable/)).toBeInTheDocument();
    });

    it('keeps the heartbeat fallback when a capable node runtime is unavailable', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([runtimeNode('故障节点')]);
        jest.mocked(ComputeClusterService.runtime).mockRejectedValue(new Error('HTTP 503'));
        render(<ControlCenterView language={Language.CHINESE}/>);

        const warning = await screen.findByText('运行详情暂不可用');
        const banner = warning.closest('.ControlRuntimeWarning');
        expect(banner).toBeInTheDocument();
        expect(banner?.nextElementSibling).toHaveClass('ControlNodeContent');
        expect(screen.getByText('资源监视器')).toBeInTheDocument();
        expect(screen.getByText('计算群资源心跳有效')).toBeInTheDocument();
        expect(ComputeClusterService.runtimeEvents).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: '关闭运行详情提示'}));
        expect(screen.queryByText('运行详情暂不可用')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '打开资源监视器'}));
        const monitor = screen.getByRole('dialog', {name: '故障节点 资源监视器'});
        expect(within(monitor).getAllByText('50%')).toHaveLength(3);
        fireEvent.click(within(monitor).getByRole('button', {name: '服务'}));
        expect(within(monitor).getByText('受管服务暂不可用')).toBeInTheDocument();
        expect(within(monitor).getByText('HTTP 503')).toBeInTheDocument();
    });

    it('fills the services page when runtime finishes after the monitor opens', async () => {
        const nodes = jest.spyOn(ComputeClusterService, 'nodes').mockImplementation(
            async () => [runtimeNode('慢服务节点')],
        );
        let finishRuntime!: (value: Awaited<ReturnType<typeof ComputeClusterService.runtime>>) => void;
        const runtime = jest.mocked(ComputeClusterService.runtime).mockImplementation(() => new Promise(resolve => {
            finishRuntime = resolve;
        }));
        jest.mocked(ComputeClusterService.runtimeEvents).mockResolvedValue({
            schema_version: 'runtime.events.v1',
            captured_at: 100,
            cursor: 0,
            events: [],
            has_more: false,
        });
        render(<ControlCenterView language={Language.CHINESE}/>);

        fireEvent.click(await screen.findByRole('button', {name: '打开资源监视器'}));
        const monitor = screen.getByRole('dialog', {name: '慢服务节点 资源监视器'});
        fireEvent.click(within(monitor).getByRole('button', {name: '服务'}));
        expect(within(monitor).getByText('正在读取受管服务…')).toBeInTheDocument();

        await act(async () => finishRuntime({
            schema_version: 'runtime.snapshot.v1',
            captured_at: 100,
            summary: {total: 1, healthy: 1, degraded: 0, unavailable: 0, task_counts: {}},
            services: [{
                service_id: 'node-agent',
                name: 'Node Agent',
                kind: 'service',
                state: 'healthy',
                version: '0.8.0',
                uptime_seconds: 60,
                restart_count: null,
                health: {state: 'healthy', checked_at: 100, status_code: 200, latency_ms: 8},
                process: {pid: 4321, state: 'running'},
                task_counts: {},
            }],
        }));

        expect(await within(monitor).findAllByText('Node Agent')).toHaveLength(2);
        expect(within(monitor).queryByText('受管服务详情未上报')).not.toBeInTheDocument();

        runtime.mockRejectedValueOnce(new Error('HTTP 503'));
        fireEvent.click(screen.getByRole('button', {name: '刷新机器状态'}));
        await waitFor(() => expect(nodes).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(runtime).toHaveBeenCalledTimes(2));
        expect(await screen.findByText('运行详情暂不可用')).toBeInTheDocument();
        expect(within(monitor).getAllByText('Node Agent')).toHaveLength(2);
        expect(within(monitor).queryByText('受管服务暂不可用')).not.toBeInTheDocument();
    });

    it('does not probe runtime details for offline or older nodes', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([
            node('旧节点', true),
            runtimeNode('离线节点', false),
        ]);
        render(<ControlCenterView language={Language.CHINESE}/>);

        expect(await screen.findByRole('heading', {name: '旧节点'})).toBeInTheDocument();
        expect(ComputeClusterService.runtime).not.toHaveBeenCalled();
        expect(ComputeClusterService.runtimeEvents).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: /离线节点/}));
        expect(await screen.findByRole('heading', {name: '离线节点'})).toBeInTheDocument();
        expect(screen.getByText('心跳中断')).toBeInTheDocument();
        expect(screen.getByText('计算群资源心跳已中断')).toBeInTheDocument();
        expect(screen.queryByText('实时状态')).not.toBeInTheDocument();
    });

    it('does not overlap a slow runtime refresh for the same node', async () => {
        const nodesRequest = jest.spyOn(ComputeClusterService, 'nodes').mockImplementation(
            async () => [runtimeNode('慢节点')],
        );
        const runtime = jest.mocked(ComputeClusterService.runtime);
        render(<ControlCenterView language={Language.CHINESE}/>);

        expect(await screen.findByRole('heading', {name: '慢节点'})).toBeInTheDocument();
        await waitFor(() => expect(runtime).toHaveBeenCalledTimes(1));
        const refreshButton = screen.getByRole('button', {name: '刷新机器状态'});
        fireEvent.click(refreshButton);
        await waitFor(() => expect(nodesRequest).toHaveBeenCalledTimes(2));
        expect(runtime).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(refreshButton).not.toBeDisabled());
    });

    it('shows an honest retry state when the cluster service is unavailable', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockRejectedValue(new Error('HTTP 500'));
        render(<ControlCenterView language={Language.CHINESE}/>);

        expect(await screen.findByText('无法读取计算群')).toBeInTheDocument();
        expect(screen.getByText('HTTP 500')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '重试'})).toBeInTheDocument();
    });

    it('turns the bottom shield into the Agent side-chat trigger', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([node('在线节点', true)]);
        const toggle = jest.fn();
        window.addEventListener('opensight:toggle-agent-chat', toggle);
        render(<ControlCenterView language={Language.CHINESE}/>);

        fireEvent.click(await screen.findByRole('button', {name: '在侧边栏询问 Agent'}));

        expect(toggle).toHaveBeenCalledTimes(1);
        window.removeEventListener('opensight:toggle-agent-chat', toggle);
    });

    it('adds, removes, and restores tags for each machine', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([
            node('在线节点', true),
        ]);
        const {unmount} = render(<ControlCenterView language={Language.CHINESE}/>);

        await screen.findByRole('heading', {name: '在线节点'});
        fireEvent.change(screen.getByRole('textbox', {name: '新标签'}), {
            target: {value: '上海-热轧作业区'},
        });
        fireEvent.click(screen.getByRole('button', {name: '添加标签'}));

        expect(screen.getByText('上海-热轧作业区')).toBeInTheDocument();
        expect(window.localStorage.getItem('opensight.control-center.node-tags.在线节点-id'))
            .toBe('["上海-热轧作业区"]');

        unmount();
        render(<ControlCenterView language={Language.CHINESE}/>);
        expect(await screen.findByText('上海-热轧作业区')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '删除标签 上海-热轧作业区'}));
        expect(screen.queryByText('上海-热轧作业区')).not.toBeInTheDocument();
        expect(window.localStorage.getItem('opensight.control-center.node-tags.在线节点-id')).toBe('[]');
    });

    it('opens the pinned overview and switches map and graph views', async () => {
        const onlineNode = node('在线节点', true);
        const nodesRequest = jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([onlineNode]);
        const resourceGraph = graph(onlineNode);
        resourceGraph.entities.forEach(entity => {
            entity.region_id = '310000';
            entity.region_name = '上海市';
        });
        jest.spyOn(ComputeClusterService, 'resourceGraph').mockResolvedValue(resourceGraph);
        const {container} = render(<ControlCenterView language={Language.CHINESE}/>);

        expect(await screen.findByRole('heading', {name: '在线节点'})).toBeInTheDocument();
        const machine = screen.getByRole('button', {name: /在线节点/});
        const overview = screen.getByRole('button', {name: /总览/});
        fireEvent.click(overview);

        expect(machine).toHaveAttribute('aria-pressed', 'false');
        expect(overview).toHaveAttribute('aria-pressed', 'true');
        expect(await screen.findByRole('region', {name: '计算群地理地图'})).toBeInTheDocument();
        expect(screen.getByText('边缘集群地图', {selector: 'strong'})).toBeInTheDocument();
        expect(screen.queryByRole('heading', {name: '在线节点'})).not.toBeInTheDocument();

        const china = container.querySelector('[data-map-feature="China"]');
        expect(china).toBeInTheDocument();
        const map = container.querySelector('svg[aria-label="可交互全球节点地图"]') as SVGSVGElement;
        const setPointerCapture = jest.fn();
        Object.defineProperty(map, 'setPointerCapture', {value: setPointerCapture});
        fireEvent.mouseEnter(china as Element);
        expect(screen.getByText('中国', {selector: '.ControlGeoMapInspector strong'})).toBeInTheDocument();
        fireEvent.pointerDown(china as Element, {button: 0, pointerId: 1, clientX: 100, clientY: 100});
        fireEvent.pointerUp(china as Element, {button: 0, pointerId: 1, clientX: 100, clientY: 100});
        expect(setPointerCapture).not.toHaveBeenCalled();
        fireEvent.click(china as Element);
        expect(screen.getByText('中国节点地图')).toBeInTheDocument();
        const shandong = container.querySelector('[data-map-feature="山东省"]');
        expect(shandong).toBeInTheDocument();
        fireEvent.click(shandong as Element);
        expect(screen.getByText('山东省地级地图')).toBeInTheDocument();
        expect(container.querySelector('[data-map-feature="济南市"]')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '中国'}));
        const shanghai = container.querySelector('[data-map-feature="上海市"]');
        expect(shanghai).toBeInTheDocument();
        fireEvent.click(shanghai as Element);
        expect(screen.getByText('上海市区级地图')).toBeInTheDocument();
        expect(container.querySelector('[data-map-feature="浦东新区"]')).toBeInTheDocument();
        expect(container.querySelector('.ControlGeoMapMarker')).toHaveTextContent('1');
        expect(screen.getByText('1 / 1 节点在线 · 区级位置待细化')).toBeInTheDocument();

        expect(screen.queryByRole('button', {name: '刷新机器状态'})).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '图谱'}));
        expect(screen.getByRole('region', {name: '节点与传感器拓扑'})).toBeInTheDocument();
        expect(screen.getByText('边缘集群图谱', {selector: 'strong'})).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '地图'}));
        expect(screen.getByRole('region', {name: '计算群地理地图'})).toBeInTheDocument();
        expect(nodesRequest).toHaveBeenCalledTimes(1);

        fireEvent.click(machine);
        expect(await screen.findByRole('heading', {name: '在线节点'})).toBeInTheDocument();
        fireEvent.click(machine);
        expect(screen.getByRole('heading', {name: '在线节点'})).toBeInTheDocument();
        expect(screen.getByText(/^查询于 /)).toBeInTheDocument();
    });

    it('uses the reported system icon and reserves the device image for Jetson', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([
            node('Jetson', true, false, 'NVIDIA Jetson AGX Orin', 'linux'),
            node('Windows', true, false, null, 'windows'),
            node('Linux', true, false, null, 'linux'),
            node('Mac', true, false, null, 'darwin'),
        ]);
        render(<ControlCenterView language={Language.CHINESE}/>);

        await screen.findByRole('heading', {name: 'Jetson'});
        expect(screen.getByRole('img', {name: 'Jetson'})).toHaveAttribute('src', '/ico/jetson-agx-orin.png');
        expect(screen.getByRole('img', {name: 'Windows'}).querySelector('image')).toHaveAttribute('href', '/ico/system-windows.svg');
        expect(screen.getByRole('img', {name: 'Linux'}).querySelector('image')).toHaveAttribute('href', '/ico/system-linux.svg');
        expect(screen.getByRole('img', {name: 'macOS'}).querySelector('image')).toHaveAttribute('href', '/ico/system-macos.svg');
    });

    it('groups, orders, and filters the machine list', async () => {
        const machines = [
            {...node('Charlie', true, false, null, 'windows'), heartbeat_age_seconds: 30},
            {...node('Alpha', true, false, null, 'linux'), heartbeat_age_seconds: 10},
            {...node('Bravo', false, false, null, 'windows'), heartbeat_age_seconds: 20},
        ];
        const regionGraph = graph(machines[0]);
        regionGraph.entities = [
            {...regionGraph.entities[0], entity_id: 'region:shanghai', label: '上海', region_id: 'shanghai', region_name: '上海'},
            ...machines.map((machine, index) => ({
                ...regionGraph.entities[1],
                entity_id: `node:${machine.node_id}`,
                label: machine.name,
                node_id: machine.node_id,
                region_id: 'shanghai',
                region_name: index === 0 ? null : '上海',
            })),
        ];
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue(machines);
        jest.spyOn(ComputeClusterService, 'resourceGraph').mockResolvedValue(regionGraph);
        render(<ControlCenterView language={Language.CHINESE}/>);

        await screen.findByRole('heading', {name: 'Charlie'});
        const list = screen.getByRole('complementary', {name: '机器列表'});
        expect(screen.getByRole('combobox', {name: '节点分组'})).toHaveValue('region');
        expect(within(list).getByText('上海市')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox', {name: '节点排序'}), {target: {value: 'name'}});
        expect(Array.from(list.querySelectorAll('.ControlMachineItem:not(.overview) strong'))
            .map(item => item.textContent)).toEqual(['Alpha', 'Bravo', 'Charlie']);

        expect(list.querySelectorAll('.ControlMachineGroupHeading')).toHaveLength(1);
        expect(within(list).queryByText('shanghai')).not.toBeInTheDocument();

        fireEvent.change(screen.getByRole('combobox', {name: '节点分组'}), {target: {value: 'platform'}});
        expect(list.querySelectorAll('.ControlMachineGroupHeading')).toHaveLength(2);

        fireEvent.change(screen.getByRole('combobox', {name: '节点状态'}), {target: {value: 'offline'}});
        expect(screen.getByRole('button', {name: /Bravo/})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /Alpha/})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /Charlie/})).not.toBeInTheDocument();
    });

    it('opens a camera in the existing annotation player', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([
            node('在线节点', true, true),
        ]);
        const open = jest.spyOn(CameraResourceService, 'openCluster').mockResolvedValue();
        const onCameraOpened = jest.fn();
        render(
            <ControlCenterView
                language={Language.CHINESE}
                imagesData={[]}
                onCameraOpened={onCameraOpened}
            />
        );

        fireEvent.click(await screen.findByRole('button', {name: '打开车间相机实时画面'}));

        await waitFor(() => {
            expect(open).toHaveBeenCalledWith(
                '在线节点-id',
                '在线节点',
                expect.objectContaining({device_id: 'camera-1'}),
                [],
            );
            expect(onCameraOpened).toHaveBeenCalledTimes(1);
        });
    });

    it('opens terminal connection from related features in the main canvas', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([
            node('在线节点', true),
        ]);
        jest.spyOn(ComputeClusterService, 'terminalTargets').mockResolvedValue({
            version: 1,
            enabled: true,
            targets: [{
                node_id: '在线节点-id',
                node_name: '在线节点',
                platform: 'Windows',
                online: true,
                available: true,
                reason: 'available',
            }],
        });
        const {container} = render(<ControlCenterView language={Language.CHINESE}/>);

        await screen.findByRole('heading', {name: '在线节点'});
        fireEvent.click(screen.getByText('相关功能'));
        fireEvent.click(within(screen.getByLabelText('相关功能列表')).getByRole('button', {name: /终端连接/}));

        expect(await screen.findByRole('heading', {name: '节点终端连接'})).toBeInTheDocument();
        expect(screen.getByLabelText('终端指令')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('combobox', {name: '目标节点'})).toHaveValue('在线节点-id'));
        expect(container.querySelector('.ControlCenterBody .ComputeTerminalPanel')).toBeInTheDocument();
    });

    it('opens terminal connection from the network status cards', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([
            node('在线节点', true),
        ]);
        jest.spyOn(ComputeClusterService, 'terminalTargets').mockResolvedValue({
            version: 1,
            enabled: true,
            targets: [{
                node_id: '在线节点-id',
                node_name: '在线节点',
                platform: 'Windows',
                online: true,
                available: true,
                reason: 'available',
            }],
        });
        render(<ControlCenterView language={Language.CHINESE}/>);

        await screen.findByRole('heading', {name: '在线节点'});
        expect(screen.getByRole('button', {name: /SSH 局域网.*打开当前节点终端连接/})).toBeEnabled();
        fireEvent.click(screen.getByRole('button', {name: /Tailscale 远程.*打开当前节点终端连接/}));

        expect(await screen.findByRole('heading', {name: '节点终端连接'})).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('combobox', {name: '目标节点'})).toHaveValue('在线节点-id'));
    });

    it('opens network assets from related features in the main canvas', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([
            node('在线节点', true),
        ]);
        render(<ControlCenterView language={Language.CHINESE}/>);

        await screen.findByRole('heading', {name: '在线节点'});
        fireEvent.click(screen.getByText('相关功能'));
        fireEvent.click(screen.getByRole('button', {name: /网络资产/}));

        expect(await screen.findByRole('heading', {name: '节点局域网资产'})).toBeInTheDocument();
        expect(screen.getByText('计算群资产台账')).toBeInTheDocument();
    });

    it('queries the current group with an index starting at one', async () => {
        const onlineNode = node('在线节点', true);
        const currentGraph = graph(onlineNode);
        currentGraph.entities.unshift({
            entity_id: 'group:group-1',
            kind: 'compute_group',
            label: 'factory-a',
            state: 'available',
            callable: false,
            modes: [],
        });
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([onlineNode]);
        jest.spyOn(ComputeClusterService, 'resourceGraph').mockResolvedValue(currentGraph);
        render(<ControlCenterView language={Language.CHINESE}/>);

        await screen.findByRole('heading', {name: '在线节点'});
        fireEvent.click(screen.getByText('相关功能'));
        fireEvent.click(screen.getByRole('button', {name: /群查询/}));

        const list = await screen.findByLabelText('当前群列表');
        expect(within(list).getByText('序号 1')).toBeInTheDocument();
        expect(within(list).getByText('factory-a')).toBeInTheDocument();
        expect(within(list).getByText('group-1')).toBeInTheDocument();
    });
});
