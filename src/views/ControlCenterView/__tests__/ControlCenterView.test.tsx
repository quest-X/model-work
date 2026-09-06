import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {Language} from '../../../data/LanguageConfig';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeResourceGraph,
} from '../../../services/ComputeClusterService';
import {AgentChatService} from '../../../services/AgentChatService';
import {ControlCenterView} from '../ControlCenterView';

const originalFetch = global.fetch;

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
        lan_ssh_available: online && controlTransport === 'lan',
        tailscale_ssh_available: online,
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
        jest.spyOn(ComputeClusterService, 'groups').mockResolvedValue({
            schema_version: 'group-memberships.v1',
            group_count: 0,
            groups: [],
        });
        jest.spyOn(ComputeClusterService, 'runtime').mockImplementation(() => new Promise(() => undefined));
        jest.spyOn(ComputeClusterService, 'runtimeInventory').mockImplementation(() => new Promise(() => undefined));
        jest.spyOn(ComputeClusterService, 'runtimeEvents').mockImplementation(() => new Promise(() => undefined));
        jest.spyOn(ComputeClusterService, 'lanAssets').mockResolvedValue({
            version: 1,
            group_id: 'group-1',
            summary: {total: 0, online: 0, offline: 0, new: 0, changed: 0, networks: 0},
            latest_scans: [],
            assets: [],
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        Object.defineProperty(global, 'fetch', {configurable: true, writable: true, value: originalFetch});
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
        expect(screen.getByRole('heading', {name: '资源监控'})).toBeInTheDocument();
        expect(screen.getByRole('heading', {name: '相关设备'})).toBeInTheDocument();
        expect(screen.getByText('边缘计算设备')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '发现并添加局域网边缘计算设备'})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '添加设备'})).not.toBeInTheDocument();
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
        expect(container.querySelector('.ControlNodeHeader')).not.toHaveTextContent('最后检查 未知');
        expect(container.querySelector('.ControlNodeHeader')).not.toHaveTextContent('节点程序 0.7.0');
        expect(within(container.querySelector('.ControlToolbarGroup') as HTMLElement)
            .getByText('在线节点-id')).toBeInTheDocument();
        expect(within(deviceInformation).queryByText('节点状态')).not.toBeInTheDocument();
        expect(screen.queryByText('全部')).not.toBeInTheDocument();
        expect(screen.queryByText('CPU')).not.toBeInTheDocument();
        expect(screen.queryByText('GPU')).not.toBeInTheDocument();
        expect(screen.getByText('SSH 局域网')).toBeInTheDocument();
        expect(screen.getByText('Tailscale 远程')).toBeInTheDocument();
        const cameraCard = screen.getByText('DS-2CD2686FWDA2-IZS')
            .closest('.ControlCameraCard') as HTMLElement;
        expect(within(cameraCard).getByText('正常')).toBeInTheDocument();
        expect(screen.queryByText('摄像头注册表')).not.toBeInTheDocument();
        expect(screen.queryByText('运行详情暂不可用')).not.toBeInTheDocument();
        expect(ComputeClusterService.runtime).not.toHaveBeenCalled();
        expect(screen.getByText('CPU · MEM · GPU · DISK · NETWORK')).toBeInTheDocument();
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
        expect(screen.getByText('CPU · MEM · GPU · DISK · NETWORK')).toBeInTheDocument();
        expect(within(screen.getByLabelText('设备信息')).getByText('未上报')).toBeInTheDocument();
        const offlineSsh = screen.getByRole('button', {name: /SSH 局域网.*打开当前节点终端连接/});
        const offlineTailscale = screen.getByRole('button', {name: /Tailscale 远程.*打开当前节点终端连接/});
        expect(offlineSsh).toBeDisabled();
        expect(offlineTailscale).toBeDisabled();
        expect(offlineSsh).toHaveTextContent('故障');
        expect(offlineTailscale).toHaveTextContent('故障');
        expect(offlineSsh.querySelector('.ControlStatusDot')).toHaveClass('warning');
        expect(offlineTailscale.querySelector('.ControlStatusDot')).toHaveClass('warning');

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
        expect(container.querySelector('.ControlNodeHeader')).not.toHaveTextContent('Last check Unknown');
        expect(within(englishDeviceInformation).queryByText('Node state')).not.toBeInTheDocument();
        expect(screen.getByText('LAN SSH')).toBeInTheDocument();
        expect(screen.getByText('Remote Tailscale')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: /Active Just now/})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /Open live view/})).not.toBeInTheDocument();
        expect(screen.queryByText('处理器')).not.toBeInTheDocument();
        expect(screen.queryByText('图形处理器')).not.toBeInTheDocument();
    });

    it('shows a disconnected path and mixed paths as faulty', async () => {
        const remoteNode = node('山东节点', true, false, null, 'Windows', 'tailscale');
        remoteNode.network.lan_ssh_available = false;
        remoteNode.network.tailscale_ssh_available = true;
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([remoteNode]);
        render(<ControlCenterView language={Language.CHINESE}/>);

        const lan = await screen.findByRole('button', {name: /SSH 局域网/});
        const remote = screen.getByRole('button', {name: /Tailscale 远程/});
        expect(lan).toHaveTextContent('故障');
        expect(lan.querySelector('.ControlStatusDot')).toHaveClass('warning');
        expect(remote).toHaveTextContent('正常');
        expect(remote.querySelector('.ControlStatusDot')).toHaveClass('healthy');
        const machineState = screen.getByRole('button', {name: /山东节点/})
            .querySelector('.ControlMachineState');
        expect(machineState).toHaveTextContent('故障');
        expect(machineState).toHaveClass('warning');
        expect(screen.getByRole('button', {name: /总览/}).querySelector('.ControlMachineState'))
            .toHaveClass('warning');
    });

    it('does not guess a version when the node reports unknown', async () => {
        const machine = node('旧节点', true);
        machine.agent_version = 'unknown';
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([machine]);
        render(<ControlCenterView language={Language.CHINESE}/>);

        const information = await screen.findByLabelText('设备信息');
        expect(within(information).getByText('—')).toBeInTheDocument();
        expect(within(information).queryByText('unknown')).not.toBeInTheDocument();
    });

    it('recovers an uncertain node when bidirectional communication returns', async () => {
        const faultyNode = node('异常节点', true);
        faultyNode.network.lan_ssh_available = false;
        faultyNode.network.tailscale_ssh_available = false;
        faultyNode.communication_state = 'fault';
        const repairedNode = node('异常节点', true);
        repairedNode.network_dependencies.push({
            dependency_id: 'public_http',
            kind: 'internet_egress',
            state: 'unavailable',
            checked_at: 1,
            required_for: ['information.web_fetch'],
        });
        const nodes = jest.spyOn(ComputeClusterService, 'nodes')
            .mockResolvedValueOnce([faultyNode])
            .mockResolvedValue([repairedNode]);
        render(<ControlCenterView language={Language.CHINESE}/>);

        const machineState = () => screen.getByRole('button', {name: /异常节点/})
            .querySelector('.ControlMachineState');
        await waitFor(() => expect(machineState()).toHaveTextContent('故障'));
        expect(machineState()).toHaveClass('warning');

        fireEvent.click(screen.getByRole('button', {name: '刷新机器状态'}));
        await waitFor(() => expect(nodes).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(machineState()).toHaveTextContent('正常'));
        expect(machineState()).toHaveClass('healthy');
    });

    it('opens the resource monitor without overview service cards', async () => {
        const monitoredNode = runtimeNode('节点甲');
        monitoredNode.resources.gpus = [{
            index: 0,
            uuid: 'GPU-1',
            name: 'NVIDIA RTX 4090',
            memory_total_mb: 24_564,
            memory_used_mb: 1_024,
            utilization_percent: 33,
            temperature_celsius: 67,
        }];
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([
            monitoredNode,
            runtimeNode('节点乙'),
        ]);
        const runtimeInventory = jest.mocked(ComputeClusterService.runtimeInventory).mockResolvedValue({
            schema_version: 'runtime.inventory.v1',
            captured_at: 101,
            processes_available: true,
            processes: [{
                pid: 9876,
                name: 'python.exe',
                cpu_percent: 35,
                memory_bytes: 64 * 1024 ** 2,
                state: 'running',
            }, {
                pid: 1234,
                name: 'zeta.exe',
                cpu_percent: 10,
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
        jest.spyOn(AgentChatService, 'tasks').mockResolvedValue({
            total: 1,
            tasks: [{
                id: 'trace-agent-1',
                kind: 'agent_request',
                title: '查看状态',
                status: 'succeeded',
                revision: 2,
                source_message: '查看状态',
                result: {response: '在线'},
                created_at: '1970-01-01T00:00:40Z',
                updated_at: '1970-01-01T00:00:50Z',
            }],
        });
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
                content: '扫描完成。\n| 设备 | 正常服务 | 结果 |\n| --- | --- | --- |\n| 节点乙 | 2/2 | **正常** |',
                metadata: {task_id: 'scan-1'},
                created_at: '2026-09-03T01:01:00Z',
            }],
        });
        render(<ControlCenterView language={Language.CHINESE}/>);

        await screen.findByRole('button', {name: '打开资源监视器'});
        expect(await screen.findByText('CPU · MEM · GPU · DISK · NETWORK')).toBeInTheDocument();
        expect(screen.getByText(/^最后检查 /)).toBeInTheDocument();
        expect(document.querySelector('.ControlRuntimeChecked')).not.toBeInTheDocument();
        expect(screen.queryByText('视觉算法服务')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('最近异常')).not.toBeInTheDocument();
        expect(ComputeClusterService.runtime).not.toHaveBeenCalled();
        expect(ComputeClusterService.runtimeEvents).not.toHaveBeenCalled();
        expect(screen.queryByText('Node Agent')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '打开资源监视器'}));
        const monitor = await screen.findByRole('dialog', {name: '节点甲 资源监视器'});
        const maximizeMonitor = within(monitor).getByRole('button', {name: '放大资源监视器窗口'});
        expect(maximizeMonitor).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(maximizeMonitor);
        expect(monitor).toHaveClass('maximized');
        expect(monitor.parentElement).toHaveClass('maximized');
        const restoreMonitor = within(monitor).getByRole('button', {name: '还原资源监视器窗口'});
        expect(restoreMonitor).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(restoreMonitor);
        expect(monitor).not.toHaveClass('maximized');
        expect(within(monitor).getByRole('navigation', {name: '资源监视器导航'})).toBeInTheDocument();
        expect(within(monitor).getAllByText('50%')).toHaveLength(3);
        expect(within(monitor).getByRole('complementary', {name: '资源列表'})).toBeInTheDocument();
        expect(within(monitor).getAllByRole('img', {name: '内存使用率趋势'})).toHaveLength(2);
        expect(within(monitor).getByRole('img', {name: '磁盘读写趋势'})).toBeInTheDocument();
        expect(within(monitor).getByText('等待利用率数据')).toBeInTheDocument();
        fireEvent.click(within(monitor).getByRole('button', {name: '磁盘 50%'}));
        expect(within(monitor).getByLabelText('磁盘 性能详情')).toHaveTextContent('读取 8.0 MB/s');
        expect(within(monitor).getByLabelText('磁盘 性能详情')).toHaveTextContent('蓝色读取 · 橙色写入');
        fireEvent.click(within(monitor).getByRole('button', {name: '图形处理器 33%'}));
        expect(within(monitor).getByLabelText('图形处理器 性能详情')).toHaveTextContent('显存 1.0 GB / 24.0 GB');
        expect(within(monitor).getByLabelText('图形处理器 性能详情')).toHaveTextContent('最高温度 67°C');

        const monitorNavigation = within(monitor).getByRole('navigation', {name: '资源监视器导航'});
        expect(runtimeInventory).toHaveBeenCalledWith('节点甲-id', expect.anything());
        fireEvent.click(within(monitorNavigation).getByRole('button', {name: '进程'}));
        const processSection = within(monitor).getByLabelText('进程清单');
        expect(processSection.querySelector('.ControlMonitorSearchHeader')).toBeInTheDocument();
        const processRows = () => within(processSection).getAllByRole('row').slice(1);
        expect(processRows()[0]).toHaveTextContent('zeta.exe');
        expect(processRows()[0]).toHaveTextContent('10.0%');
        fireEvent.click(within(processSection).getByRole('button', {name: '按CPU降序排列'}));
        expect(processRows()[0]).toHaveTextContent('python.exe');
        const processSearch = within(processSection).getByRole('searchbox', {name: '搜索进程'});
        fireEvent.change(processSearch, {target: {value: 'zeta'}});
        expect(processRows()).toHaveLength(1);
        expect(processRows()[0]).toHaveTextContent('zeta.exe');
        fireEvent.change(processSearch, {target: {value: ''}});
        fireEvent.click(within(processSection).getByRole('button', {name: '按名称升序排列'}));
        expect(processRows()[0]).toHaveTextContent('python.exe');
        fireEvent.click(within(processSection).getByRole('button', {name: '按名称降序排列'}));
        expect(processRows()[0]).toHaveTextContent('zeta.exe');
        fireEvent.click(within(monitorNavigation).getByRole('button', {name: '启动应用'}));
        const startupSection = within(monitor).getByLabelText('启动应用清单');
        expect(startupSection.querySelector('.ControlMonitorSearchHeader')).toBeInTheDocument();
        const startupRows = () => within(startupSection).getAllByRole('row').slice(1);
        expect(startupRows()[0]).toHaveTextContent('Alpha Service');
        expect(startupRows()[0]).toHaveTextContent('故障');
        fireEvent.click(within(startupSection).getByRole('button', {name: '按名称降序排列'}));
        expect(startupRows()[0]).toHaveTextContent('节点服务node-service');
        expect(startupRows()[0]).toHaveTextContent('正常');
        expect(startupRows()[0]).not.toHaveTextContent('Agent');
        const startupSearch = within(startupSection).getByRole('searchbox', {name: '搜索启动应用'});
        fireEvent.change(startupSearch, {target: {value: 'AlphaService'}});
        expect(startupRows()).toHaveLength(1);
        expect(startupRows()[0]).toHaveTextContent('Alpha Service');
        expect(startupSection).toHaveTextContent('自动');
        expect(within(monitorNavigation).queryByRole('button', {name: '网络'})).not.toBeInTheDocument();
        fireEvent.click(within(monitorNavigation).getByRole('button', {name: '性能'}));
        fireEvent.click(within(monitor).getByRole('button', {name: '网络 正常'}));
        expect(within(monitor).getByLabelText('网络 性能详情')).toHaveTextContent('下载 4.0 MB/s');
        expect(within(monitor).getByLabelText('网络 性能详情')).toHaveTextContent('蓝色下载 · 红色上传');
        expect(within(monitorNavigation).queryByRole('button', {name: '服务'})).not.toBeInTheDocument();
        expect(within(monitor).queryByLabelText('受管服务')).not.toBeInTheDocument();

        fireEvent.click(within(monitor).getByRole('button', {name: '任务'}));
        expect(await within(monitor).findByText('task-network-1')).toBeInTheDocument();
        const taskSection = within(monitor).getByLabelText('提交任务');
        expect(taskSection.querySelector('.ControlMonitorSearchHeader')).toBeInTheDocument();
        const taskRows = () => within(taskSection).getAllByRole('row').slice(1);
        expect(taskSection).toHaveTextContent('连通测试');
        expect(within(monitor).getByText('排队')).toBeInTheDocument();
        expect(taskRows()[0]).toHaveTextContent('task-network-1');
        fireEvent.click(within(taskSection).getByRole('button', {name: '按任务升序排列'}));
        expect(taskRows()[0]).toHaveTextContent('trace-agent-1');
        fireEvent.click(within(taskSection).getByRole('button', {name: '按任务降序排列'}));
        expect(taskRows()[0]).toHaveTextContent('task-network-1');
        const taskSearch = within(taskSection).getByRole('searchbox', {name: '搜索任务'});
        fireEvent.change(taskSearch, {target: {value: 'task-web-2'}});
        expect(taskRows()).toHaveLength(1);
        expect(taskRows()[0]).toHaveTextContent('task-web-2');
        fireEvent.change(taskSearch, {target: {value: 'trace-agent-1'}});
        expect(taskRows()).toHaveLength(1);
        expect(taskRows()[0]).toHaveTextContent('Agent 请求');
        expect(taskRows()[0]).toHaveTextContent('OpenSight Agent');
        fireEvent.change(taskSearch, {target: {value: '不存在'}});
        expect(within(taskSection).getByText('未找到匹配任务')).toBeInTheDocument();
        expect(ComputeClusterService.tasks).toHaveBeenCalledWith(undefined, 200);
        expect(AgentChatService.tasks).toHaveBeenCalledWith(200);
        expect(within(monitor).queryByText('过往对话')).not.toBeInTheDocument();

        fireEvent.click(within(monitor).getByRole('button', {name: '对话'}));
        expect(within(monitor).getByLabelText('过往对话').querySelector('.ControlMonitorSearchHeader')).toBeInTheDocument();
        expect(await within(monitor).findAllByText('@节点乙 测试连通')).toHaveLength(2);
        const conversationLog = within(monitor).getByLabelText('对话记录');
        expect(conversationLog).toHaveTextContent('扫描完成。');
        expect(within(conversationLog).getByRole('table')).toHaveTextContent('节点乙2/2正常');
        expect(within(conversationLog).getByText('正常').tagName).toBe('STRONG');
        const taskId = within(conversationLog).getByText('任务编号：scan-1');
        expect(taskId).toHaveClass('ControlConversationTaskId');
        expect(taskId.previousElementSibling).toHaveClass('ControlConversationMessageContent');
        const conversationSearch = within(monitor).getByRole('searchbox', {name: '搜索对话'});
        fireEvent.change(conversationSearch, {target: {value: '不存在'}});
        expect(within(monitor).getByText('未找到匹配对话')).toBeInTheDocument();
        fireEvent.change(conversationSearch, {target: {value: '节点乙'}});
        expect(within(monitor).getByRole('button', {name: /@节点乙 测试连通/})).toBeInTheDocument();
        expect(ComputeClusterService.tasks).toHaveBeenCalled();
        expect(AgentChatService.conversation).toHaveBeenCalledWith('conversation-1');

        fireEvent.mouseDown(monitor.closest('.ControlResourceMonitorBackdrop') as HTMLElement);
        expect(screen.queryByRole('dialog', {name: '节点甲 资源监视器'})).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: /节点乙/}));
        expect(screen.queryByText('Task Executor')).not.toBeInTheDocument();
        expect(screen.queryByText('Node Agent')).not.toBeInTheDocument();
        expect(screen.queryByText('运行详情暂不可用')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '打开资源监视器'}));
        const secondMonitor = await screen.findByRole('dialog', {name: '节点乙 资源监视器'});
        expect(within(secondMonitor).queryByRole('button', {name: '服务'})).not.toBeInTheDocument();
    });

    it('keeps model-work-node runtime details silent', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([runtimeNode('故障节点')]);
        jest.mocked(ComputeClusterService.runtime).mockRejectedValue(new Error('HTTP 503'));
        render(<ControlCenterView language={Language.CHINESE}/>);

        expect(await screen.findByText('资源监视器')).toBeInTheDocument();
        expect(screen.queryByText('运行详情暂不可用')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('最近异常')).not.toBeInTheDocument();
        expect(ComputeClusterService.runtime).not.toHaveBeenCalled();
        expect(ComputeClusterService.runtimeEvents).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: '打开资源监视器'}));
        const monitor = screen.getByRole('dialog', {name: '故障节点 资源监视器'});
        expect(within(monitor).getAllByText('50%')).toHaveLength(3);
        expect(within(monitor).queryByRole('button', {name: '服务'})).not.toBeInTheDocument();
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
        expect(within(screen.getByRole('button', {name: '打开资源监视器'})).getByText('故障')).toBeInTheDocument();
        expect(screen.getByText('CPU · MEM · GPU · DISK · NETWORK')).toBeInTheDocument();
        expect(screen.queryByText('实时状态')).not.toBeInTheDocument();
    });

    it('shows an honest retry state when the cluster service is unavailable', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockRejectedValue(new Error('HTTP 500'));
        render(<ControlCenterView language={Language.CHINESE}/>);

        expect(await screen.findByText('无法读取计算群')).toBeInTheDocument();
        expect(screen.getByText('HTTP 500')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '重试'})).toBeInTheDocument();
    });

    it('does not invent a third status for an empty cluster', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([]);
        jest.spyOn(ComputeClusterService, 'resourceGraph').mockRejectedValue(new Error('no graph'));
        const {container} = render(<ControlCenterView language={Language.CHINESE}/>);

        expect(await screen.findByText('暂无机器')).toBeInTheDocument();
        expect(container.querySelector('.ControlToolbarGroup .ControlStatusDot')).not.toBeInTheDocument();
    });

    it('keeps the refresh warning above the node and lets the user close it', async () => {
        const machine = runtimeNode('在线节点');
        const nodes = jest.spyOn(ComputeClusterService, 'nodes')
            .mockResolvedValueOnce([machine])
            .mockRejectedValueOnce(new Error('HTTP 500'));
        render(<ControlCenterView language={Language.CHINESE}/>);

        expect(await screen.findByRole('heading', {name: '在线节点'})).toBeInTheDocument();
        expect(screen.queryByText('运行详情暂不可用')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '刷新机器状态'}));
        await waitFor(() => expect(nodes).toHaveBeenCalledTimes(2));
        expect(await screen.findByText(/本次刷新失败.*HTTP 500/)).toBeInTheDocument();
        expect(screen.queryByText('运行详情暂不可用')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '关闭刷新失败提示'}));
        expect(screen.queryByText(/本次刷新失败.*HTTP 500/)).not.toBeInTheDocument();
    });

    it('does not duplicate the global OpenSight Agent trigger inside the control center', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([node('在线节点', true)]);
        render(<ControlCenterView language={Language.CHINESE}/>);

        expect(await screen.findByRole('heading', {name: '在线节点'})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '在侧边栏询问 Agent'})).not.toBeInTheDocument();
    });

    it('shows a coarse location and one configurable work area', async () => {
        const locatedNode = node('在线节点', true);
        locatedNode.labels = {
            region: '310000',
            region_name: '上海市',
            district: '310113',
            district_name: '宝山区',
            site: 'shanghai-baoshan-office',
            site_name: '办公室',
        };
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([locatedNode]);
        jest.spyOn(ComputeClusterService, 'resourceGraph').mockResolvedValue(graph(locatedNode));
        window.localStorage.setItem('opensight.control-center.node-tags.在线节点-id', '["上海市"]');
        let view = render(<ControlCenterView language={Language.CHINESE}/>);

        await screen.findByRole('heading', {name: '在线节点'});
        const tags = screen.getByLabelText('节点标签');
        expect(within(tags).getByText('地域 (上海市)')).toBeInTheDocument();
        expect(within(tags).getByText('作业区(办公室)')).toBeInTheDocument();
        expect(within(tags).queryByText('宝山区')).not.toBeInTheDocument();
        expect(tags.children).toHaveLength(2);
        expect(screen.queryByRole('button', {name: '清除作业区 上海市'})).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', {name: '自定义作业区'})).not.toBeInTheDocument();

        view.unmount();
        locatedNode.labels.site_name = '';
        view = render(<ControlCenterView language={Language.CHINESE}/>);
        await screen.findByRole('heading', {name: '在线节点'});
        fireEvent.change(screen.getByRole('textbox', {name: '自定义作业区'}), {
            target: {value: '上海-热轧作业区'},
        });
        fireEvent.click(screen.getByRole('button', {name: '添加作业区'}));

        expect(screen.getByText('作业区(上海-热轧作业区)')).toBeInTheDocument();
        expect(window.localStorage.getItem('opensight.control-center.node-tags.在线节点-id'))
            .toBe('["上海-热轧作业区"]');

        view.unmount();
        render(<ControlCenterView language={Language.CHINESE}/>);
        expect(await screen.findByText('作业区(上海-热轧作业区)')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '清除作业区 上海-热轧作业区'}));
        expect(screen.queryByText('作业区(上海-热轧作业区)')).not.toBeInTheDocument();
        expect(window.localStorage.getItem('opensight.control-center.node-tags.在线节点-id')).toBe('[]');
    });

    it('opens the pinned overview and switches map and graph views', async () => {
        const districtFetch = jest.fn();
        Object.defineProperty(global, 'fetch', {configurable: true, writable: true, value: districtFetch});
        const onlineNode = node('在线节点', true);
        onlineNode.network.lan_ssh_available = false;
        onlineNode.communication_state = 'fault';
        onlineNode.labels = {
            region: '310000',
            region_name: '上海市',
            district: '310113',
            district_name: '宝山区',
            site: 'shanghai-baoshan-office',
            site_name: '办公室',
        };
        const backupNode = node('上海备用节点', true);
        backupNode.network.lan_ssh_available = false;
        backupNode.communication_state = 'fault';
        backupNode.labels = {...onlineNode.labels};
        const rizhaoNode = node('日照节点', false);
        rizhaoNode.communication_state = 'abnormal';
        rizhaoNode.labels = {
            region: '370000',
            region_name: '山东省',
            city: '371100',
            city_name: '日照市',
        };
        const nodesRequest = jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([
            onlineNode,
            backupNode,
            rizhaoNode,
        ]);
        const resourceGraph = graph(onlineNode);
        resourceGraph.relations.push({
            relation_id: 'contains:backup', kind: 'contains', source_id: 'region:test',
            target_id: `node:${backupNode.node_id}`, active: true, reason: 'available',
        });
        resourceGraph.entities.forEach(entity => {
            entity.region_id = '310000';
            entity.region_name = '上海市';
        });
        resourceGraph.entities.push({
            ...resourceGraph.entities[1],
            entity_id: `node:${backupNode.node_id}`,
            label: backupNode.name,
            node_id: backupNode.node_id,
        }, {
            ...resourceGraph.entities[1],
            entity_id: `node:${rizhaoNode.node_id}`,
            label: rizhaoNode.name,
            node_id: rizhaoNode.node_id,
            region_id: '370000',
            region_name: '山东省',
        }, {
            entity_id: 'device:edge-1',
            kind: 'managed_device',
            label: 'AIPACK-01',
            state: 'available',
            callable: false,
            modes: [],
            node_id: onlineNode.node_id,
            device_kind: 'edge_compute',
        });
        jest.spyOn(ComputeClusterService, 'resourceGraph').mockResolvedValue(resourceGraph);
        const {container} = render(<ControlCenterView language={Language.CHINESE}/>);

        expect(await screen.findByRole('heading', {name: '在线节点'})).toBeInTheDocument();
        const machineList = screen.getByRole('complementary', {name: '机器列表'});
        expect(new Set(Array.from(machineList.querySelectorAll('.ControlMachineGroupHeading strong'))
            .map(item => item.textContent))).toEqual(new Set(['上海市', '山东省']));
        const machine = screen.getByRole('button', {name: /在线节点/});
        const overview = screen.getByRole('button', {name: /总览/});
        fireEvent.click(overview);

        expect(machine).toHaveAttribute('aria-pressed', 'false');
        expect(overview).toHaveAttribute('aria-pressed', 'true');
        expect(await screen.findByRole('region', {name: '计算群地理地图'}, {timeout: 15_000})).toBeInTheDocument();
        expect(screen.getByText('边缘集群地图', {selector: 'strong'})).toBeInTheDocument();
        const mapStats = screen.getByRole('region', {name: '计算群地理地图'})
            .querySelector('.ComputeKnowledgeStats');
        expect(mapStats).toHaveTextContent('3主节点');
        expect(mapStats?.querySelector('.online')).toHaveTextContent('0正常');
        expect(mapStats?.querySelector('.warning')).toHaveTextContent('3故障');
        expect(mapStats?.querySelector('.offline')).not.toBeInTheDocument();
        expect(container.querySelector('.ControlGeoMapMarker')).toHaveTextContent('3/1');
        expect(container.querySelector('.ControlGeoMapMarker')).toHaveClass('warning');
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
        fireEvent.click(screen.getByRole('button', {name: '进入中国下一级地图'}));
        expect(screen.getByText('中国节点地图')).toBeInTheDocument();
        const shandong = container.querySelector('[data-map-feature="山东省"]');
        expect(shandong).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '进入上海市下一级地图'})).toHaveClass('warning');
        const shandongMarker = screen.getByRole('button', {name: '进入山东省下一级地图'});
        expect(shandongMarker).toHaveClass('warning');
        fireEvent.click(shandongMarker);
        expect(screen.getByText('山东省市级地图')).toBeInTheDocument();
        expect(container.querySelector('[data-map-prefecture="日照市"]')).toHaveTextContent('1/0');
        expect(screen.getByText('正常 0 · 故障 1 · 日照市')).toBeInTheDocument();
        expect(screen.getByText('正常节点')).toBeInTheDocument();
        expect(screen.getByText('故障节点')).toBeInTheDocument();
        expect(screen.queryByText('异常节点')).not.toBeInTheDocument();
        expect(screen.queryByText('在线节点', {selector: '.ComputeKnowledgeLegend span'})).not.toBeInTheDocument();
        expect(screen.queryByText('离线节点', {selector: '.ComputeKnowledgeLegend span'})).not.toBeInTheDocument();
        const jinan = container.querySelector('[data-map-feature="济南市"]');
        expect(jinan).toBeInTheDocument();
        fireEvent.click(jinan as Element);
        expect(screen.getByText('山东省市级地图')).toBeInTheDocument();
        expect(districtFetch).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: '中国'}));
        const shanghai = container.querySelector('[data-map-feature="上海市"]');
        expect(shanghai).toBeInTheDocument();
        fireEvent.click(shanghai as Element);
        expect(screen.getByText('上海市地图')).toBeInTheDocument();
        expect(container.querySelector('[data-map-prefecture="上海市"]')).toHaveTextContent('2/1');
        expect(container.querySelector('[data-map-feature="浦东新区"]')).not.toBeInTheDocument();

        expect(screen.queryByRole('button', {name: '刷新机器状态'})).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '图谱'}));
        const graphPanel = screen.getByRole('region', {name: '主节点、边缘设备与摄像头拓扑'});
        expect(graphPanel.querySelector('.ComputeGraphViewport')).toHaveClass('fit-window');
        const graphStats = graphPanel.querySelector('.ComputeKnowledgeStats');
        expect(graphStats?.querySelector('.online')).toHaveTextContent('0正常');
        expect(graphStats?.querySelector('.warning')).toHaveTextContent('3故障');
        expect(graphStats?.querySelector('.offline')).not.toBeInTheDocument();
        expect(within(graphPanel).getByText('0/2 正常节点')).toBeInTheDocument();
        expect(within(graphPanel).getByText('0/1 正常节点')).toBeInTheDocument();
        const graphNode = within(graphPanel).getByRole('button', {name: '查看 在线节点 节点信息'});
        expect(graphNode).toHaveClass('node-warning');
        expect(within(graphPanel).getByRole('button', {name: '查看 日照节点 节点信息'})).toHaveClass('node-warning');
        fireEvent.mouseEnter(graphNode);
        expect(within(graphPanel).getByText('故障 · 心跳 刚刚')).toHaveClass('warning');
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
        ].map(machine => ({...machine, labels: {
            region: '310000',
            region_name: '上海市',
            district: '310113',
            district_name: '宝山区',
            site: 'shanghai-baoshan-office',
            site_name: '办公室',
        }}));
        machines[1].communication_state = 'fault';
        machines[1].network.tailscale_ssh_available = false;
        machines[1].network.lan_ssh_available = false;
        machines[2].communication_state = 'abnormal';
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
        expect(within(screen.getByRole('combobox', {name: '节点状态'})).getAllByRole('option')
            .map(option => option.textContent)).toEqual(['所有状态', '仅正常', '仅故障']);
        expect(screen.getByRole('combobox', {name: '节点分组'})).toHaveValue('region');
        expect(list.querySelector('.ControlMachineGroupHeading strong')?.textContent).toBe('上海市');
        fireEvent.change(screen.getByRole('combobox', {name: '节点排序'}), {target: {value: 'name'}});
        expect(Array.from(list.querySelectorAll('.ControlMachineItem:not(.overview) strong'))
            .map(item => item.textContent)).toEqual(['Alpha', 'Bravo', 'Charlie']);

        expect(list.querySelectorAll('.ControlMachineGroupHeading')).toHaveLength(1);
        expect(within(list).queryByText('shanghai')).not.toBeInTheDocument();

        fireEvent.change(screen.getByRole('combobox', {name: '节点分组'}), {target: {value: 'platform'}});
        expect(list.querySelectorAll('.ControlMachineGroupHeading')).toHaveLength(2);

        fireEvent.change(screen.getByRole('combobox', {name: '节点状态'}), {target: {value: 'fault'}});
        expect(screen.getByRole('button', {name: /Alpha/})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: /Bravo/})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /Charlie/})).not.toBeInTheDocument();

        fireEvent.change(screen.getByRole('combobox', {name: '节点状态'}), {target: {value: 'normal'}});
        expect(screen.getByRole('button', {name: /Charlie/})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /Alpha/})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /Bravo/})).not.toBeInTheDocument();
    });

    it('opens a registered camera with devices on the left and live view on the right', async () => {
        const machine = node('在线节点', true, true);
        machine.device_inventory.devices[0].capabilities = ['camera.stream.v1'];
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([machine]);
        render(<ControlCenterView language={Language.CHINESE}/>);

        fireEvent.click(await screen.findByRole('button', {name: '打开车间相机实时画面'}));

        const dialog = await screen.findByRole('dialog', {name: '相机实时画面'});
        expect(within(dialog).getByText('左侧选择设备，右侧查看实时画面')).toBeInTheDocument();
        expect(within(dialog).getByRole('tab', {name: /车间相机/})).toHaveAttribute('aria-selected', 'true');
        expect(within(dialog).getByAltText('车间相机 实时画面')).toHaveAttribute(
            'src',
            expect.stringContaining('/nodes/%E5%9C%A8%E7%BA%BF%E8%8A%82%E7%82%B9-id/cameras/camera-1/mjpeg'),
        );
        expect(within(dialog).queryByRole('button', {name: '关闭相机实时画面'})).not.toBeInTheDocument();
        fireEvent.mouseDown(dialog.closest('.DeviceManagementBackdrop') as HTMLElement);
        expect(screen.queryByRole('dialog', {name: '相机实时画面'})).not.toBeInTheDocument();
    });

    it('refreshes the camera cards when a remote camera is saved', async () => {
        const emptyNode = node('在线节点', true);
        const cameraNode = node('在线节点', true, true);
        cameraNode.device_inventory.devices[0].capabilities = ['camera.stream.v1'];
        const nodes = jest.spyOn(ComputeClusterService, 'nodes')
            .mockResolvedValueOnce([emptyNode])
            .mockResolvedValue([cameraNode]);
        render(<ControlCenterView language={Language.CHINESE}/>);

        await screen.findByRole('heading', {name: '在线节点'});
        expect(screen.queryByText('车间相机')).not.toBeInTheDocument();
        fireEvent(window, new CustomEvent('opensight:camera-resource-updated'));

        await waitFor(() => expect(nodes).toHaveBeenCalledTimes(2));
        expect(await screen.findByText('车间相机')).toBeInTheDocument();
    });

    it('requires the camera stream capability without checking the node version', async () => {
        const machine = node('旧版本节点', true, true);
        machine.device_inventory.devices[0].status = 'online';
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([machine]);
        render(<ControlCenterView language={Language.CHINESE}/>);

        const camera = await screen.findByRole('button', {name: '打开车间相机实时画面'});
        expect(camera).toBeDisabled();
        expect(camera).toHaveAttribute('title', '此相机不支持实时画面（需要 camera.stream.v1）');
        fireEvent.click(camera);
        expect(screen.queryByRole('dialog', {name: '相机实时画面'})).not.toBeInTheDocument();
    });

    it('keeps an offline camera hoverable but prevents opening it', async () => {
        const machine = node('在线节点', true, true);
        machine.device_inventory.devices[0].status = 'offline';
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([machine]);
        render(<ControlCenterView language={Language.CHINESE}/>);

        const camera = await screen.findByRole('button', {name: '打开车间相机实时画面'});
        expect(camera).toBeDisabled();
        fireEvent.click(camera);
        expect(screen.queryByRole('dialog', {name: '相机实时画面'})).not.toBeInTheDocument();
    });

    it('keeps camera addition available when a related device already exists', async () => {
        const remoteNode = node('远程节点', true, true);
        remoteNode.control_transport = 'tailscale';
        remoteNode.capabilities.push('task.camera.connect.v1');
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([remoteNode]);
        const updateActivePopupTypeAction = jest.fn();
        render(<ControlCenterView
            language={Language.CHINESE}
            updateActivePopupTypeAction={updateActivePopupTypeAction}
        />);

        expect(await screen.findByLabelText('1 个相关设备')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '添加局域网摄像头'}));

        expect(updateActivePopupTypeAction).toHaveBeenCalledWith(
            PopupWindowType.CAMERA_CONNECT,
            '远程节点-id',
            '远程节点',
            true,
        );
    });

    it('disables camera connection when the node does not advertise it', async () => {
        const machine = node('旧节点', true, true);
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([machine]);
        const updateActivePopupTypeAction = jest.fn();
        render(<ControlCenterView
            language={Language.CHINESE}
            updateActivePopupTypeAction={updateActivePopupTypeAction}
        />);

        const button = await screen.findByRole('button', {name: '添加局域网摄像头'});
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', '此节点不支持连接相机（需要 task.camera.connect.v1）');
        fireEvent.click(button);
        expect(updateActivePopupTypeAction).not.toHaveBeenCalled();
    });

    it.each(['task.camera.discover.v1', 'task.camera.connect.v1'])(
        'opens the empty camera entry when the node advertises %s',
        async capability => {
            const machine = node('兼容节点', true);
            machine.capabilities.push(capability);
            jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([machine]);
            const updateActivePopupTypeAction = jest.fn();
            render(<ControlCenterView
                language={Language.CHINESE}
                updateActivePopupTypeAction={updateActivePopupTypeAction}
            />);

            const button = await screen.findByRole('button', {name: '发现并添加局域网摄像头'});
            expect(button).toBeEnabled();
            fireEvent.click(button);
            expect(updateActivePopupTypeAction).toHaveBeenCalledWith(
                PopupWindowType.CAMERA_CONNECT,
                '兼容节点-id',
                '兼容节点',
                false,
            );
        },
    );

    it('prevents LAN camera discovery from an offline node', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([node('离线节点', false)]);
        const updateActivePopupTypeAction = jest.fn();
        render(<ControlCenterView
            language={Language.CHINESE}
            updateActivePopupTypeAction={updateActivePopupTypeAction}
        />);

        const button = await screen.findByRole('button', {name: '发现并添加局域网摄像头'});
        expect(button).toBeDisabled();
        expect(screen.queryByRole('button', {name: '添加局域网摄像头'})).not.toBeInTheDocument();
        fireEvent.click(button);
        expect(updateActivePopupTypeAction).not.toHaveBeenCalled();
    });

    it('shows a verified Jetson as a fixed card with the Jetson icon', async () => {
        const machine = node('山东节点', true);
        const terminalSession = {
            version: 1 as const,
            session_id: 'terminal-edge-1',
            node_id: machine.node_id,
            node_name: machine.name,
            transport: 'tailscale' as const,
            state: 'running' as const,
            created_at: 1,
            last_activity_at: 1,
            cursor: 0,
            output: '',
            output_truncated: false,
        };
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([machine]);
        jest.spyOn(ComputeClusterService, 'terminalTargets').mockResolvedValue({
            version: 1,
            enabled: true,
            targets: [{
                node_id: machine.node_id,
                node_name: machine.name,
                platform: 'Windows',
                online: true,
                available: true,
                reason: 'available',
            }],
        });
        jest.spyOn(ComputeClusterService, 'startTerminal').mockResolvedValue(terminalSession);
        jest.spyOn(ComputeClusterService, 'terminal').mockImplementation(() => new Promise(() => undefined));
        const terminalInput = jest.spyOn(ComputeClusterService, 'terminalInput').mockResolvedValue(terminalSession);
        jest.spyOn(ComputeClusterService, 'terminalControl').mockResolvedValue({...terminalSession, state: 'closed'});
        const lanAssets = jest.spyOn(ComputeClusterService, 'lanAssets')
            .mockResolvedValueOnce({
                version: 1,
                group_id: 'group-1',
                summary: {total: 0, online: 0, offline: 0, new: 0, changed: 0, networks: 0},
                latest_scans: [],
                assets: [],
            })
            .mockResolvedValue({
                version: 1,
                group_id: 'group-1',
                summary: {total: 1, online: 1, offline: 0, new: 0, changed: 0, networks: 1},
                latest_scans: [],
                assets: [{
                    asset_id: 'ssh-edge-1',
                    node_id: machine.node_id,
                    node_name: machine.name,
                    cidr: '10.168.10.0/24',
                    address: '10.168.10.24',
                    hostname: 'jetson-orin',
                    mac: '3c:6d:66:87:70:30',
                    device_kind: 'edge_compute',
                    display_name: 'jetson-orin',
                    device_model: 'Orin',
                    ssh_username: 'nvidia',
                    ports: [{port: 22, service: 'ssh'}],
                    online: true,
                    first_seen_at: 1,
                    last_seen_at: 1,
                    last_changed_at: 1,
                    change_type: 'unchanged',
                }],
            });

        render(<ControlCenterView language={Language.CHINESE}/>);

        await screen.findByRole('heading', {name: '山东节点'});
        expect(screen.queryByText('jetson-orin')).not.toBeInTheDocument();
        fireEvent(window, new CustomEvent('opensight:edge-device-updated'));
        await waitFor(() => expect(lanAssets).toHaveBeenCalledTimes(2));
        const deviceName = await screen.findByText('jetson-orin');
        const deviceCard = deviceName.closest('.ControlCameraCard') as HTMLElement;
        expect(screen.getByText('Orin · 10.168.10.24')).toBeInTheDocument();
        expect(deviceCard.querySelector('.ControlCameraIcon img')).toHaveAttribute('src', '/ico/jetson-agx-orin.png');
        expect(within(deviceCard).getByText('正常')).toBeInTheDocument();

        fireEvent.click(deviceCard);
        expect(await screen.findByRole('dialog', {name: '边缘设备终端'}))
            .toHaveClass('EdgeDeviceTerminalDialog');
        expect(screen.getByRole('tab', {name: /jetson-orin/})).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('heading', {name: 'jetson-orin · 终端'})).toBeInTheDocument();
        const connectTerminal = await screen.findByRole('button', {name: '连接终端'});
        await waitFor(() => expect(connectTerminal).toBeEnabled());
        fireEvent.click(connectTerminal);
        await waitFor(() => expect(terminalInput).toHaveBeenCalledWith(
            'terminal-edge-1', 'ssh nvidia@10.168.10.24\r',
        ));
        expect(screen.queryByRole('button', {name: '关闭边缘设备终端'})).not.toBeInTheDocument();
        fireEvent.keyDown(window, {key: 'Escape'});
        expect(screen.queryByRole('dialog', {name: '边缘设备终端'})).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '1 个相关设备'}));
        expect(screen.getByRole('dialog', {name: '设备管理'})).toBeInTheDocument();
        expect(screen.getByRole('tab', {name: /边缘计算设备/})).toHaveAttribute('aria-selected', 'true');
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
        const terminalSession = {
            version: 1 as const,
            session_id: 'terminal-session-1',
            node_id: '在线节点-id',
            node_name: '在线节点',
            transport: 'tailscale' as const,
            state: 'running' as const,
            created_at: 1,
            last_activity_at: 1,
            cursor: 0,
            output: '',
            output_truncated: false,
            exit_code: null,
            error: null,
        };
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
        jest.spyOn(ComputeClusterService, 'startTerminal').mockResolvedValue(terminalSession);
        jest.spyOn(ComputeClusterService, 'terminal').mockResolvedValue(terminalSession);
        render(<ControlCenterView language={Language.CHINESE}/>);

        await screen.findByRole('heading', {name: '在线节点'});
        expect(screen.getByRole('button', {name: /SSH 局域网.*打开当前节点终端连接/})).toBeEnabled();
        fireEvent.click(screen.getByRole('button', {name: /Tailscale 远程.*打开当前节点终端连接/}));

        expect(await screen.findByRole('heading', {name: '节点终端连接'})).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('combobox', {name: '目标节点'})).toHaveValue('在线节点-id'));
        await waitFor(() => expect(ComputeClusterService.startTerminal)
            .toHaveBeenCalledWith('在线节点-id', 'tailscale'));
        expect(await screen.findByText('Tailscale · 正常')).toBeInTheDocument();
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

    it('opens Jetson discovery from the edge-device add button', async () => {
        const remoteNode = node('远程节点', true);
        remoteNode.control_transport = 'tailscale';
        remoteNode.capabilities.push('control.jetson.connect.v1');
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([remoteNode]);
        const updateActivePopupTypeAction = jest.fn();
        render(<ControlCenterView
            language={Language.CHINESE}
            updateActivePopupTypeAction={updateActivePopupTypeAction}
        />);

        fireEvent.click(await screen.findByRole('button', {name: '发现并添加局域网边缘计算设备'}));

        expect(updateActivePopupTypeAction).toHaveBeenCalledWith(
            PopupWindowType.JETSON_CONNECT,
            '远程节点-id',
            '远程节点',
            true,
        );
    });

    it('does not treat Jetson scan support as Jetson connection support', async () => {
        const machine = node('扫描节点', true);
        machine.capabilities.push('task.network.lan_discovery.v1');
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([machine]);
        const updateActivePopupTypeAction = jest.fn();
        render(<ControlCenterView
            language={Language.CHINESE}
            updateActivePopupTypeAction={updateActivePopupTypeAction}
        />);

        const button = await screen.findByRole('button', {name: '发现并添加局域网边缘计算设备'});
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', '此节点不支持 SSH 设备认证');
        fireEvent.click(button);
        expect(updateActivePopupTypeAction).not.toHaveBeenCalled();
    });

    it('shows the central group at zero and local groups from one', async () => {
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
        jest.mocked(ComputeClusterService.groups).mockResolvedValue({
            schema_version: 'group-memberships.v1',
            group_count: 2,
            groups: [{
                index: 0,
                group_id: 'central-group',
                group_name: '中央控制群',
                owner_name: 'master-73',
                relationship: 'member',
                scope: 'central',
                joined_at: 1,
                credential_types: ['owner_trust'],
            }, {
                index: 1,
                group_id: 'group-1',
                group_name: 'factory-a',
                owner_name: 'main-250',
                relationship: 'owner',
                scope: 'local',
                joined_at: 2,
                credential_types: ['owner_identity'],
            }],
        });
        render(<ControlCenterView language={Language.CHINESE}/>);

        await screen.findByRole('heading', {name: '在线节点'});
        fireEvent.click(screen.getByText('相关功能'));
        fireEvent.click(screen.getByRole('button', {name: /群查询/}));

        const list = await screen.findByLabelText('当前群列表');
        expect(within(list).getByText(/序号 0.*中央群/)).toBeInTheDocument();
        expect(within(list).getByText(/序号 1.*本地群/)).toBeInTheDocument();
        expect(within(list).getByText('中央控制群')).toBeInTheDocument();
        expect(within(list).getByText('factory-a')).toBeInTheDocument();
        expect(within(list).getByText('group-1')).toBeInTheDocument();

        fireEvent.click(within(list).getByRole('button', {name: /中央控制群/}));
        const members = screen.getByRole('dialog', {name: /群成员/});
        expect(within(members).getByText('成员身份：中央控制端（Master）')).toBeInTheDocument();
        expect(within(members).getByText(/当前安装暂时无法查询此群的成员/)).toBeInTheDocument();
        expect(within(members).queryByText('在线节点')).not.toBeInTheDocument();
        fireEvent.keyDown(members, {key: 'Escape', code: 'Escape', keyCode: 27});

        fireEvent.click(await within(list).findByRole('button', {name: /factory-a/}));
        const localMembers = await screen.findByRole('dialog', {name: '群成员'});
        expect(within(localMembers).getByText('在线节点')).toBeInTheDocument();
        expect(within(localMembers).getByText('本机')).toBeInTheDocument();
        expect(within(localMembers).getByText('成员身份：计算节点（Node）')).toBeInTheDocument();
        expect(within(localMembers).getByText('成员身份：主控制端（Main）')).toBeInTheDocument();
        expect(within(localMembers).getByText('成员状态：已启用')).toBeInTheDocument();
        expect(within(localMembers).getAllByText('操作权限：暂不可查询')).toHaveLength(2);
        expect(within(localMembers).getAllByRole('region').map(region => region.getAttribute('aria-label')))
            .toEqual(['Master', 'Main', 'Node']);
        expect(within(within(localMembers).getByRole('region', {name: 'Main'})).getByText('main-250')).toBeInTheDocument();
        expect(within(within(localMembers).getByRole('region', {name: 'Main'})).queryByText('在线节点')).not.toBeInTheDocument();
        expect(within(within(localMembers).getByRole('region', {name: 'Node'})).getByText('在线节点')).toBeInTheDocument();
        fireEvent.click(within(localMembers).getByRole('button', {name: /在线节点/}));
        expect(await screen.findByRole('heading', {name: '在线节点'})).toBeInTheDocument();
    });
});
