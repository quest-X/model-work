import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {connect} from 'react-redux';
import {Language} from '../../../data/LanguageConfig';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeClusterStatus,
    ComputeLanDiscoveryResult,
    ComputeLanAssetsResponse,
    ComputeLanSchedule,
    ComputeLanScanTarget,
    ComputeResourceGraph,
    ComputeResourceGraphEntity,
    ComputeSchedulerResponse,
    ComputeTask,
    ComputeTaskMode,
    ComputeTaskType,
    ComputeWebFetchResult,
} from '../../../services/ComputeClusterService';
import {AppState} from '../../../store';
import './ComputeClusterPopup.scss';
import {ResourceKnowledgeGraph} from './ResourceKnowledgeGraph';
import {ComputeTerminalPanel} from './ComputeTerminalPanel';

interface IProps {
    language: Language;
}

const AUTO_PLACEMENT = '__automatic__';
type ComputeWorkspace = 'graph' | 'tasks' | 'network' | 'nodes' | 'terminal';

const bytes = (value: number | null, zh: boolean): string => {
    if (value === null || !Number.isFinite(value)) return zh ? '未知' : 'Unknown';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = Math.max(0, value);
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
    }
    return `${size >= 100 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
};

const percentUsed = (total: number | null, available: number | null): string => {
    if (!total || available === null) return '—';
    return `${Math.round(Math.max(0, Math.min(1, 1 - available / total)) * 100)}%`;
};

const lastSeen = (seconds: number, zh: boolean): string => {
    if (seconds < 5) return zh ? '刚刚' : 'Just now';
    if (seconds < 60) return zh ? `${Math.round(seconds)} 秒前` : `${Math.round(seconds)}s ago`;
    const minutes = Math.round(seconds / 60);
    return zh ? `${minutes} 分钟前` : `${minutes}m ago`;
};

const taskState = (state: ComputeTask['state'], zh: boolean): string => {
    const labels: Record<ComputeTask['state'], [string, string]> = {
        queued: ['排队中', 'Queued'],
        running: ['运行中', 'Running'],
        paused: ['已暂停', 'Paused'],
        succeeded: ['已完成', 'Succeeded'],
        failed: ['失败', 'Failed'],
        cancelled: ['已取消', 'Cancelled'],
    };
    return labels[state][zh ? 0 : 1];
};

const taskProgress = (task: ComputeTask): number => {
    if (task.state === 'succeeded') return 100;
    const reported = task.progress?.percent;
    if (typeof reported === 'number' && Number.isFinite(reported)) {
        return Math.max(0, Math.min(100, reported));
    }
    const elapsed = Number(task.checkpoint?.elapsed_seconds);
    const total = Number(task.parameters.seconds);
    return total > 0 && Number.isFinite(elapsed) ? Math.max(0, Math.min(100, elapsed / total * 100)) : 0;
};

const webFetchResult = (task: ComputeTask): ComputeWebFetchResult | null => {
    const result = task.result;
    return result && 'schema_version' in result && result.schema_version === 'webfetch.console-result.v1'
        ? result
        : null;
};

const lanDiscoveryResult = (task: ComputeTask): ComputeLanDiscoveryResult | null => {
    const result = task.result;
    return result && 'schema_version' in result && result.schema_version === 'lan-discovery.console-result.v1'
        ? result
        : null;
};

const publicUrlValid = (value: string): boolean => {
    try {
        const parsed = new URL(value);
        return ['http:', 'https:'].includes(parsed.protocol)
            && !parsed.username
            && !parsed.password
            && !parsed.hash
            && value.length <= 4096;
    } catch {
        return false;
    }
};

const resourceRequestValid = (
    cpu: number,
    memoryGb: number,
    diskGb: number,
    gpu: number,
    gpuMemoryMb: number,
): boolean => [cpu, memoryGb, diskGb, gpu, gpuMemoryMb].every(value => value >= 0)
    && (gpuMemoryMb === 0 || gpu >= 1);

interface TaskCardProps {
    task: ComputeTask;
    zh: boolean;
    busy: boolean;
    onControl: (task: ComputeTask, action: 'pause' | 'resume' | 'cancel') => void;
}

// State-specific controls stay together so every task card exposes one consistent lifecycle.
// eslint-disable-next-line complexity
const TaskCard: React.FC<TaskCardProps> = ({task, zh, busy, onControl}) => {
    const progress = taskProgress(task);
    const active = task.state === 'queued' || task.state === 'running';
    const finished = ['succeeded', 'failed', 'cancelled'].includes(task.state);
    const informationTask = task.task_type === 'information.web_fetch';
    const discoveryTask = task.task_type === 'network.lan_discovery';
    const evidence = webFetchResult(task);
    const discovery = lanDiscoveryResult(task);
    return <article className={`ComputeTaskCard ${task.state}`}>
        <div className='ComputeTaskIdentity'>
            <span className={`ComputeTaskState ${task.state}`}>{taskState(task.state, zh)}</span>
            <div>
                <strong>{informationTask
                    ? (zh ? '公开信息抓取' : 'Public information fetch')
                    : discoveryTask
                        ? (zh ? '局域网设备发现' : 'LAN device discovery')
                        : (zh ? '等待测试' : 'Wait test')} · {task.node_name}</strong>
                <small>{task.mode === 'online' ? (zh ? '在线任务' : 'Online') : (zh ? '后台任务' : 'Background')} · {task.task_id.slice(0, 8)}</small>
                {task.placement && <small className='ComputeTaskPlacement'>
                    {task.placement.mode === 'automatic'
                        ? (zh ? '自动调度' : 'Auto placed')
                        : (zh ? '图谱定向调度' : 'Graph-directed')} · CPU {task.resources?.cpu_cores ?? 0} · {bytes(task.resources?.memory_bytes ?? 0, zh)}
                    {task.placement.reserved ? (zh ? ' · 已预留' : ' · reserved') : ''}
                </small>}
            </div>
        </div>
        <div className='ComputeTaskProgress'>
            <div><i style={{width: `${progress}%`}}/></div>
            <span>{progress.toFixed(0)}%</span>
            <small>{informationTask
                ? (evidence
                    ? `${evidence.meaningful_chars} ${zh ? '有效字符' : 'meaningful chars'}`
                    : (zh ? '节点执行并保存证据' : 'Node execution and evidence'))
                : discoveryTask
                    ? `${discovery?.host_count ?? 0} ${zh ? '台设备' : 'hosts'} · ${Number(task.progress?.completed ?? 0)} / ${Number(task.progress?.total ?? 0)} ${zh ? '地址' : 'addresses'}`
                    : `${Number(task.progress?.completed ?? task.checkpoint?.elapsed_seconds ?? 0).toFixed(1)} / ${Number(task.parameters.seconds ?? task.progress?.total ?? 0).toFixed(1)} s`}</small>
        </div>
        <div className='ComputeTaskActions'>
            {active && !informationTask && !discoveryTask && <button type='button' disabled={busy} onClick={() => onControl(task, 'pause')}>{zh ? '暂停' : 'Pause'}</button>}
            {task.state === 'paused' && !informationTask && !discoveryTask && <button type='button' disabled={busy} onClick={() => onControl(task, 'resume')}>{zh ? '恢复' : 'Resume'}</button>}
            {!finished && <button type='button' className='danger' disabled={busy} onClick={() => onControl(task, 'cancel')}>{zh ? '取消' : 'Cancel'}</button>}
        </div>
        {informationTask && <div className='ComputeTaskEvidence'>
            <span className={`ComputeEvidenceState ${evidence?.status || 'pending'}`}>
                {evidence?.status || (zh ? '等待证据' : 'Pending evidence')}
            </span>
            <div>
                <strong>{evidence?.title || task.parameters.url || (zh ? '等待抓取结果' : 'Waiting for result')}</strong>
                <small>{evidence
                    ? `${evidence.provider || '—'} · ${evidence.reason_code} · ${evidence.attempt_count} ${zh ? '次尝试' : 'attempts'}`
                    : (zh ? '正文与原始响应保留在执行节点' : 'Content and raw responses remain on the Node')}</small>
            </div>
            {evidence?.content_sha256 && <code title={evidence.content_sha256}>SHA-256 {evidence.content_sha256.slice(0, 12)}…</code>}
        </div>}
        {discoveryTask && <div className='ComputeLanResult'>
            <div>
                <strong>{discovery?.cidr || task.parameters.cidr}</strong>
                <small>{discovery
                    ? `${discovery.interface} · ${discovery.addresses_scanned} ${zh ? '个地址已扫描' : 'addresses scanned'}`
                    : (zh ? '扫描由目标节点的局域网网卡发出' : 'Scan originates from the target node LAN')}</small>
            </div>
            {discovery?.hosts.map(host => <div className='ComputeLanHost' key={host.address}>
                <strong>{host.address}</strong>
                <span>{host.hostname || host.mac || (zh ? '在线设备' : 'Online device')}</span>
                <small>{host.ports.length
                    ? host.ports.map(port => `${port.port}/${port.service}`).join(' · ')
                    : (zh ? '未发现白名单 TCP 服务' : 'No allowlisted TCP service')}</small>
            </div>)}
        </div>}
        {task.error && <p>{task.error}</p>}
    </article>;
};

interface NodeCardProps {
    node: ComputeClusterNode;
    zh: boolean;
}

// Resource, network, GPU, and device variants are one presentational node boundary.
// eslint-disable-next-line complexity
const NodeCard: React.FC<NodeCardProps> = ({node, zh}) => <article className={`ComputeNodeCard ${node.online ? 'online' : 'offline'}`}>
    <div className='ComputeNodeHeading'>
        <div className='ComputeNodeIdentity'>
            <span className='ComputeNodeStatus'><i/>{node.online ? (zh ? '在线' : 'Online') : (zh ? '离线' : 'Offline')}</span>
            <h3>{node.name}</h3>
            <code>{node.node_id.slice(0, 8)}</code>
        </div>
        <div className='ComputeNodeHeartbeat'>
            <span>{zh ? '最近心跳' : 'Last heartbeat'}</span>
            <strong>{lastSeen(node.heartbeat_age_seconds, zh)}</strong>
        </div>
    </div>

    <div className='ComputeNodeResourceGrid'>
        <div><span>CPU</span><strong>{node.resources.cpu_logical}</strong><small>{zh ? '逻辑核心' : 'logical cores'}</small></div>
        <div><span>{zh ? '内存' : 'Memory'}</span><strong>{percentUsed(node.resources.memory_total_bytes, node.resources.memory_available_bytes)}</strong><small>{bytes(node.resources.memory_total_bytes, zh)}</small></div>
        <div><span>{zh ? '磁盘可用' : 'Disk free'}</span><strong>{bytes(node.resources.disk_free_bytes, zh)}</strong><small>{bytes(node.resources.disk_total_bytes, zh)} {zh ? '总计' : 'total'}</small></div>
        <div><span>GPU</span><strong>{node.resources.gpus.length}</strong><small>{node.resources.platform} · {node.resources.architecture}</small></div>
    </div>

    {node.resources.gpus.length > 0 && <div className='ComputeNodeGpuList'>
        {node.resources.gpus.map(gpu => <div key={gpu.uuid}>
            <div><strong>{gpu.name}</strong><span>GPU {gpu.index}</span></div>
            <div className='ComputeGpuUsage'>
                <span><i style={{width: `${Math.min(100, gpu.memory_total_mb ? gpu.memory_used_mb / gpu.memory_total_mb * 100 : 0)}%`}}/></span>
                <small>{gpu.memory_used_mb} / {gpu.memory_total_mb} MB · {gpu.utilization_percent}%</small>
            </div>
        </div>)}
    </div>}

    <div className='ComputeNodeDeviceSection'>
        <div className='ComputeNodeDeviceHeading'>
            <strong>{zh ? '节点设备' : 'Node devices'}</strong>
            <span>{node.device_inventory.devices.length}</span>
            <small>{node.device_inventory.state === 'unavailable'
                ? (zh ? '设备源暂不可用' : 'Device source unavailable')
                : (zh ? '由本节点服务管理' : 'Managed by services on this node')}</small>
        </div>
        {node.device_inventory.devices.length > 0 && <div className='ComputeNodeDeviceList'>
            {node.device_inventory.devices.map(device => <div key={device.device_id}>
                <span className='ComputeDeviceKind'>{device.kind === 'camera' ? (zh ? '相机' : 'Camera') : device.kind}</span>
                <div>
                    <strong>{device.name}</strong>
                    <small>{device.model || (zh ? '型号未知' : 'Unknown model')}</small>
                </div>
                <div className='ComputeDeviceMeta'>
                    <span>{device.channels} {zh ? '个通道' : 'channels'}</span>
                    <small>{device.provider}</small>
                </div>
                <span className={`ComputeDeviceStatus ${device.status}`}>{device.status === 'registered'
                    ? (zh ? '已归属' : 'Assigned')
                    : device.status}</span>
            </div>)}
        </div>}
    </div>

    <footer>
        <span>Tailscale: {node.network.online ? (zh ? '已连接' : 'Connected') : (zh ? '未连接' : 'Disconnected')}</span>
        <span className={node.network.ssh_available ? 'ssh-ready' : ''}>SSH: {node.network.ssh_available
            ? (zh ? '可连接' : 'Ready')
            : (zh ? '未就绪' : 'Unavailable')}</span>
        <span>Agent v{node.agent_version}</span>
        <span>{node.capabilities.length} {zh ? '项能力' : 'capabilities'}</span>
    </footer>
</article>;

// This container intentionally owns the polling lifecycle and the complete modal state.
// eslint-disable-next-line complexity
export const ComputeClusterPopup: React.FC<IProps> = ({language}) => {
    const zh = language === Language.CHINESE;
    const [nodes, setNodes] = useState<ComputeClusterNode[]>([]);
    const [status, setStatus] = useState<ComputeClusterStatus | null>(null);
    const [tasks, setTasks] = useState<ComputeTask[]>([]);
    const [scheduler, setScheduler] = useState<ComputeSchedulerResponse | null>(null);
    const [resourceGraph, setResourceGraph] = useState<ComputeResourceGraph | null>(null);
    const [loading, setLoading] = useState(true);
    const [maximized, setMaximized] = useState(false);
    const [activeWorkspace, setActiveWorkspace] = useState<ComputeWorkspace>('graph');
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [taskError, setTaskError] = useState('');
    const [selectedNode, setSelectedNode] = useState(AUTO_PLACEMENT);
    const [taskType, setTaskType] = useState<ComputeTaskType>('information.web_fetch');
    const [taskMode, setTaskMode] = useState<ComputeTaskMode>('background');
    const [taskSeconds, setTaskSeconds] = useState(20);
    const [taskUrl, setTaskUrl] = useState('https://example.com/');
    const [taskCpu, setTaskCpu] = useState(1);
    const [taskMemoryGb, setTaskMemoryGb] = useState(1);
    const [taskDiskGb, setTaskDiskGb] = useState(0);
    const [taskGpu, setTaskGpu] = useState(0);
    const [taskGpuMemoryMb, setTaskGpuMemoryMb] = useState(0);
    const [graphSelection, setGraphSelection] = useState<{
        taskType: ComputeTaskType;
        nodeId: string;
    } | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [controllingTask, setControllingTask] = useState('');
    const [lanTargets, setLanTargets] = useState<Record<string, ComputeLanScanTarget[]>>({});
    const [lanAssets, setLanAssets] = useState<ComputeLanAssetsResponse | null>(null);
    const [lanSchedules, setLanSchedules] = useState<ComputeLanSchedule[]>([]);
    const [scheduleInterval, setScheduleInterval] = useState(60);
    const [scheduleBusy, setScheduleBusy] = useState('');
    const [scanCidr, setScanCidr] = useState('');
    const mounted = useRef(true);
    const refreshingRef = useRef(false);
    const heartbeats = useRef<Record<string, number>>({});
    const taskFormRef = useRef<HTMLDivElement | null>(null);

    // The refresh is one atomic snapshot transaction: directory, tasks, and online leases.
    // eslint-disable-next-line complexity
    const refresh = useCallback(async (signal?: AbortSignal, initial = false) => {
        if (refreshingRef.current) return;
        refreshingRef.current = true;
        if (!initial && mounted.current) setRefreshing(true);
        try {
            const [nextStatus, nextNodes] = await Promise.all([
                ComputeClusterService.status(signal),
                ComputeClusterService.nodes(signal),
            ]);
            if (mounted.current) {
                setStatus(nextStatus);
                setNodes(nextNodes);
                if (!nextStatus.task_control?.allowed_task_types.includes('information.web_fetch')) {
                    setTaskType('system.wait');
                    setTaskMode('online');
                }
                setSelectedNode(current => {
                    if (nextStatus.task_control?.resource_orchestration) {
                        return current || AUTO_PLACEMENT;
                    }
                    if (current && current !== AUTO_PLACEMENT) return current;
                    return nextNodes.find(node => node.online)?.node_id || nextNodes[0]?.node_id || '';
                });
                setError('');
            }
            if (nextStatus.task_control?.enabled) {
                try {
                    const [response, schedulerResponse, graphResponse, lanResponse, assetResponse, scheduleResponse] = await Promise.all([
                        ComputeClusterService.tasks(signal),
                        nextStatus.task_control.resource_orchestration
                            ? ComputeClusterService.scheduler(signal)
                            : Promise.resolve(null),
                        nextStatus.task_control.resource_knowledge_graph
                            ? ComputeClusterService.resourceGraph(signal)
                            : Promise.resolve(null),
                        nextStatus.task_control.lan_discovery
                            ? ComputeClusterService.lanScanTargets(signal)
                            : Promise.resolve(null),
                        nextStatus.task_control.lan_asset_inventory
                            ? ComputeClusterService.lanAssets(signal)
                            : Promise.resolve(null),
                        nextStatus.task_control.lan_discovery_schedules
                            ? ComputeClusterService.lanSchedules(signal)
                            : Promise.resolve(null),
                    ]);
                    if (mounted.current) {
                        setTasks(response.tasks);
                        setScheduler(schedulerResponse);
                        setResourceGraph(graphResponse);
                        const nextTargets = Object.fromEntries(
                            (lanResponse?.nodes || []).map(node => [node.node_id, node.targets])
                        );
                        setLanTargets(nextTargets);
                        setLanAssets(assetResponse);
                        setLanSchedules(scheduleResponse?.schedules || []);
                        setScanCidr(current => current || Object.values(nextTargets)[0]?.[0]?.cidr || '');
                        setTaskError('');
                    }
                    const now = Date.now();
                    const renewable = response.tasks.filter(task =>
                        task.mode === 'online'
                        && (task.state === 'queued' || task.state === 'running')
                        && now - (heartbeats.current[task.task_id] || 0) >= 10000
                    );
                    renewable.forEach(task => { heartbeats.current[task.task_id] = now; });
                    await Promise.allSettled(renewable.map(task =>
                        ComputeClusterService.controlTask(task, 'heartbeat', signal)
                    ));
                } catch (reason) {
                    if ((reason as {name?: string})?.name !== 'AbortError' && mounted.current) {
                        setTaskError(reason instanceof Error ? reason.message : String(reason));
                    }
                }
            } else if (mounted.current) {
                setTasks([]);
                setScheduler(null);
                setResourceGraph(null);
                setLanAssets(null);
                setLanSchedules([]);
            }
        } catch (reason) {
            if ((reason as {name?: string})?.name !== 'AbortError') {
                if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
            }
        } finally {
            if (mounted.current) {
                setLoading(false);
                setRefreshing(false);
            }
            refreshingRef.current = false;
        }
    }, []);

    useEffect(() => {
        mounted.current = true;
        const controller = new AbortController();
        void refresh(controller.signal, true);
        const timer = window.setInterval(() => void refresh(controller.signal), 2000);
        return () => {
            mounted.current = false;
            controller.abort();
            window.clearInterval(timer);
        };
    }, [refresh]);

    // Task variants share one strictly typed dispatch boundary.
    // eslint-disable-next-line complexity
    const submitTask = useCallback(async () => {
        const automatic = selectedNode === AUTO_PLACEMENT;
        const informationTask = taskType === 'information.web_fetch';
        const discoveryTask = taskType === 'network.lan_discovery';
        if (
            !selectedNode
            || submitting
            || (discoveryTask
                ? selectedNode === AUTO_PLACEMENT || !scanCidr
                : (informationTask ? !publicUrlValid(taskUrl) : taskSeconds < 0 || taskSeconds > 3600))
            || !resourceRequestValid(taskCpu, taskMemoryGb, taskDiskGb, taskGpu, taskGpuMemoryMb)
        ) return;
        setSubmitting(true);
        try {
            await ComputeClusterService.submitTask({
                node_id: automatic ? undefined : selectedNode,
                task_type: taskType,
                mode: informationTask || discoveryTask ? 'background' : taskMode,
                seconds: informationTask || discoveryTask ? undefined : taskSeconds,
                url: informationTask ? taskUrl : undefined,
                cidr: discoveryTask ? scanCidr : undefined,
                lease_seconds: 60,
                resources: {
                    cpu_cores: taskCpu,
                    memory_bytes: Math.round(taskMemoryGb * 1024 ** 3),
                    disk_bytes: Math.round(taskDiskGb * 1024 ** 3),
                    gpu_count: taskGpu,
                    gpu_memory_mb: taskGpuMemoryMb,
                },
            });
            setTaskError('');
            await refresh();
        } catch (reason) {
            setTaskError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            if (mounted.current) setSubmitting(false);
        }
    }, [
        refresh,
        selectedNode,
        submitting,
        taskCpu,
        taskDiskGb,
        taskGpu,
        taskGpuMemoryMb,
        taskMemoryGb,
        taskMode,
        taskSeconds,
        taskType,
        taskUrl,
        scanCidr,
    ]);

    const selectWorkAgent = useCallback((
        agent: ComputeResourceGraphEntity,
        candidateNodeIds: string[],
    ) => {
        if (!agent.callable || !agent.task_type || candidateNodeIds.length === 0) return;
        const selectedTaskType = agent.task_type;
        const resources = agent.recommended_resources;
        setTaskType(selectedTaskType);
        setTaskMode(selectedTaskType === 'information.web_fetch' || selectedTaskType === 'network.lan_discovery' ? 'background' : (agent.modes[0] || 'online'));
        setSelectedNode(candidateNodeIds[0]);
        if (selectedTaskType === 'network.lan_discovery') {
            setScanCidr(lanTargets[candidateNodeIds[0]]?.[0]?.cidr || '');
        }
        if (resources) {
            setTaskCpu(resources.cpu_cores);
            setTaskMemoryGb(Number((resources.memory_bytes / 1024 ** 3).toFixed(4)));
            setTaskDiskGb(Number((resources.disk_bytes / 1024 ** 3).toFixed(4)));
            setTaskGpu(resources.gpu_count);
            setTaskGpuMemoryMb(resources.gpu_memory_mb);
        }
        setGraphSelection({taskType: selectedTaskType, nodeId: candidateNodeIds[0]});
        setActiveWorkspace('tasks');
        setTaskError('');
        window.requestAnimationFrame(() => {
            taskFormRef.current?.scrollIntoView?.({behavior: 'smooth', block: 'center'});
        });
    }, [lanTargets]);

    const controlTask = useCallback(async (
        task: ComputeTask,
        action: 'pause' | 'resume' | 'cancel',
    ) => {
        const key = `${task.task_id}:${action}`;
        setControllingTask(key);
        try {
            await ComputeClusterService.controlTask(task, action);
            setTaskError('');
            await refresh();
        } catch (reason) {
            setTaskError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            if (mounted.current) setControllingTask('');
        }
    }, [refresh]);

    const createSchedule = useCallback(async () => {
        if (!selectedNode || selectedNode === AUTO_PLACEMENT || !scanCidr || scheduleBusy) return;
        setScheduleBusy('create');
        try {
            await ComputeClusterService.createLanSchedule({
                node_id: selectedNode, cidr: scanCidr, interval_minutes: scheduleInterval,
            });
            setTaskError('');
            await refresh();
        } catch (reason) {
            setTaskError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            if (mounted.current) setScheduleBusy('');
        }
    }, [refresh, scanCidr, scheduleBusy, scheduleInterval, selectedNode]);

    const controlSchedule = useCallback(async (
        schedule: ComputeLanSchedule,
        action: 'run-now' | 'pause' | 'resume',
    ) => {
        setScheduleBusy(`${schedule.schedule_id}:${action}`);
        try {
            await ComputeClusterService.controlLanSchedule(schedule.schedule_id, action);
            setTaskError('');
            await refresh();
        } catch (reason) {
            setTaskError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            if (mounted.current) setScheduleBusy('');
        }
    }, [refresh]);

    const totals = useMemo(() => ({
        total: status?.nodes.total ?? nodes.length,
        online: status?.nodes.online ?? nodes.filter(node => node.online).length,
        gpus: status?.nodes.gpu_total ?? nodes.reduce((sum, node) => sum + node.resources.gpus.length, 0),
        devices: status?.nodes.device_total ?? nodes.reduce((sum, node) => sum + node.device_inventory.devices.length, 0),
        cpu: nodes.reduce((sum, node) => sum + node.resources.cpu_logical, 0),
        activeTasks: tasks.filter(task => task.state === 'queued' || task.state === 'running').length,
    }), [nodes, status, tasks]);

    const taskControlEnabled = status?.task_control?.enabled === true;
    const orchestrationEnabled = taskControlEnabled
        && status?.task_control?.resource_orchestration === true;
    const informationWorkAgentEnabled = taskControlEnabled
        && status?.task_control?.work_agent_execution === true
        && status.task_control.allowed_task_types.includes('information.web_fetch');
    const informationTask = taskType === 'information.web_fetch';
    const discoveryTask = taskType === 'network.lan_discovery';
    const discoveryEnabled = taskControlEnabled
        && status?.task_control?.lan_discovery === true
        && status.task_control.allowed_task_types.includes('network.lan_discovery');
    const automaticPlacement = selectedNode === AUTO_PLACEMENT;
    const selectedNodeOnline = automaticPlacement
        ? nodes.some(node => node.online)
        : nodes.some(node => node.node_id === selectedNode && node.online);
    const resourcesValid = resourceRequestValid(
        taskCpu,
        taskMemoryGb,
        taskDiskGb,
        taskGpu,
        taskGpuMemoryMb,
    );
    const taskInputValid = discoveryTask
        ? discoveryEnabled && !automaticPlacement && Boolean(scanCidr)
        : informationTask
        ? informationWorkAgentEnabled && publicUrlValid(taskUrl)
        : taskSeconds >= 0 && taskSeconds <= 3600;

    const windowToggleLabel = maximized
        ? (zh ? '还原计算群窗口' : 'Restore compute cluster window')
        : (zh ? '放大计算群窗口' : 'Maximize compute cluster window');
    const serviceState = error ? 'error' : loading || refreshing ? 'syncing' : 'ready';
    const serviceStateLabel = error
        ? (zh ? '连接异常，正在自动重试' : 'Connection unavailable, retrying automatically')
        : loading || refreshing
            ? (zh ? '正在自动同步' : 'Synchronizing automatically')
            : (zh ? '自动刷新正常' : 'Automatic refresh healthy');
    const serviceVersion = `v${status?.version || '0.1.0'}`;

    return <div className={`ComputeClusterBackdrop${maximized ? ' maximized' : ''}`}>
        <section className={`ComputeClusterPopup${maximized ? ' maximized' : ''}`} aria-label={zh ? '计算群' : 'Compute Cluster'}>
            <header>
                <div>
                    <span className='ComputeClusterEyebrow'>OpenSight · model-work-node</span>
                    <h2>{zh ? '计算群' : 'Compute Cluster'}</h2>
                    <p>{zh
                        ? '统一查看资源关系、工作调度、网络资产、节点状态与终端连接。'
                        : 'View resource relationships, work scheduling, network assets, node status, and terminal access.'}</p>
                </div>
                <div className='ComputeClusterHeaderActions'>
                    <span
                        className={`ComputeClusterServiceState ${serviceState}`}
                        role='status'
                        aria-live='polite'
                        aria-label={`${serviceStateLabel} · ${serviceVersion}`}
                        title={`${serviceStateLabel} · ${zh ? '每 2 秒同步' : 'syncs every 2 seconds'}`}
                    >
                        <i aria-hidden='true'/><span>{serviceVersion}</span>
                    </span>
                    <button
                        type='button'
                        className='window-toggle'
                        aria-label={windowToggleLabel}
                        aria-pressed={maximized}
                        title={windowToggleLabel}
                        onClick={() => setMaximized(current => !current)}
                    ><i aria-hidden='true'/></button>
                    <button type='button' className='close' onClick={() => PopupActions.close()} aria-label={zh ? '关闭计算群' : 'Close compute cluster'}>×</button>
                </div>
            </header>

            <div className='ComputeClusterSummary'>
                <div><span>{zh ? '节点' : 'Nodes'}</span><strong>{totals.total}</strong></div>
                <div><span>{zh ? '在线' : 'Online'}</span><strong className='online'>{totals.online}</strong></div>
                <div><span>{zh ? '逻辑 CPU' : 'Logical CPUs'}</span><strong>{totals.cpu}</strong></div>
                <div><span>GPU</span><strong>{totals.gpus}</strong></div>
                <div><span>{zh ? '设备' : 'Devices'}</span><strong>{totals.devices}</strong></div>
                <div><span>{zh ? '运行任务' : 'Active tasks'}</span><strong>{totals.activeTasks}</strong></div>
            </div>

            {error && <div className='ComputeClusterError' role='alert'>{error}</div>}
            {taskError && <div className='ComputeClusterError' role='alert'>{taskError}</div>}

            <nav className='ComputeWorkspaceNav' aria-label={zh ? '计算群工作区' : 'Compute cluster workspaces'}>
                {([
                    ['graph', zh ? '资源与关系' : 'Resources & relations', resourceGraph?.summary.entities ?? 0],
                    ['tasks', zh ? '工作调度' : 'Work scheduling', tasks.length],
                    ['network', zh ? '网络资产' : 'Network assets', lanAssets?.summary.total ?? 0],
                    ['nodes', zh ? '节点详情' : 'Node details', nodes.length],
                    ['terminal', zh ? '终端连接' : 'Terminal', nodes.filter(node => node.online && node.network.ssh_available).length],
                ] as Array<[ComputeWorkspace, string, number]>).map(([workspace, label, count]) => <button
                    type='button'
                    key={workspace}
                    className={activeWorkspace === workspace ? 'active' : ''}
                    aria-current={activeWorkspace === workspace ? 'page' : undefined}
                    onClick={() => setActiveWorkspace(workspace)}
                ><span>{label}</span><strong>{count}</strong></button>)}
            </nav>

            <div className='ComputeClusterContent'>
                {loading && <div className='ComputeClusterLoading'><span/>{zh ? '正在读取节点…' : 'Loading nodes…'}</div>}
                {!loading && nodes.length === 0 && <div className='ComputeClusterEmpty'>
                    <div className='ComputeClusterEmptyIcon'><i/><i/><i/></div>
                    <h3>{zh ? '尚未注册计算节点' : 'No compute nodes registered'}</h3>
                    <p>{zh
                        ? '由管理员签发一次性注册令牌，再在目标机器执行 model-work-node cluster join。'
                        : 'Mint a one-time enrollment token, then run model-work-node cluster join on the target machine.'}</p>
                    <code>model-work-node cluster join --control-url &lt;OpenSight URL&gt; --enrollment-token-file &lt;secret file&gt;</code>
                </div>}
                {!loading && activeWorkspace === 'graph' && <>
                    {orchestrationEnabled && scheduler && <section className='ComputeSchedulerPanel'>
                    <div className='ComputeSchedulerHeading'>
                        <div>
                            <span>{zh ? '资源池' : 'Resource pool'}</span>
                            <h3>{zh ? '计算群调度池' : 'Compute-group scheduler'}</h3>
                            <p>{zh
                                ? '按任务预留各节点容量；统一调配不等于把多台机器的物理内存合并。'
                                : 'Capacity is reserved per task; unified placement does not merge physical memory across machines.'}</p>
                        </div>
                        <div className='ComputeSchedulerPolicy'>
                            <strong>{zh ? '优先选择余量充足节点' : 'Most available node'}</strong>
                            <span>{scheduler.policy} · {scheduler.online_nodes} {zh ? '个在线成员' : 'online members'}</span>
                        </div>
                    </div>
                    <div className='ComputeSchedulerCapacity'>
                        <div><span>CPU</span><strong>{scheduler.available.cpu_cores} / {scheduler.totals.cpu_cores}</strong><small>{zh ? '核可用' : 'cores available'}</small></div>
                        <div><span>{zh ? '内存' : 'Memory'}</span><strong>{bytes(scheduler.available.memory_bytes, zh)}</strong><small>/ {bytes(scheduler.totals.memory_bytes, zh)}</small></div>
                        <div><span>{zh ? '磁盘' : 'Disk'}</span><strong>{bytes(scheduler.available.disk_bytes, zh)}</strong><small>/ {bytes(scheduler.totals.disk_bytes, zh)}</small></div>
                        <div><span>GPU</span><strong>{scheduler.available.gpu_count} / {scheduler.totals.gpu_count}</strong><small>{bytes(scheduler.available.gpu_memory_mb * 1024 ** 2, zh)} {zh ? '显存' : 'VRAM'}</small></div>
                        <div><span>{zh ? '活动预留' : 'Allocations'}</span><strong>{scheduler.active_allocations}</strong><small>{zh ? '随任务终态释放' : 'released at terminal state'}</small></div>
                    </div>
                    </section>}
                    {resourceGraph && <ResourceKnowledgeGraph
                        graph={resourceGraph}
                        zh={zh}
                        selectedTaskType={graphSelection?.taskType}
                        onSelectWorkAgent={selectWorkAgent}
                    />}
                </>}
                {!loading && activeWorkspace === 'tasks' && taskControlEnabled && <section className='ComputeTaskControl' ref={taskFormRef}>
                    <div className='ComputeTaskControlHeading'>
                        <div>
                            <span>{zh ? '任务执行 · work agent' : 'Task execution · Work agent'}</span>
                            <h3>{zh ? '分发节点工作' : 'Dispatch node work'}</h3>
                            <p>{zh
                                ? '可下发公开信息抓取与受限局域网发现；扫描范围由目标节点实时上报，拒绝公网、自定义端口、凭据与 Shell。'
                                : 'Dispatch public-information fetches or bounded LAN discovery; target nodes advertise the scan range, while public networks, custom ports, credentials, and Shell are rejected.'}</p>
                        </div>
                        <div className='ComputeTaskModeHelp'>
                            <strong>{informationTask || discoveryTask || taskMode === 'background' ? (zh ? '后台任务' : 'Background') : (zh ? '在线任务' : 'Online')}</strong>
                            <span>{!informationTask && !discoveryTask && taskMode === 'online'
                                ? (zh ? '关闭页面并超过租约后自动取消' : 'Cancels after the lease when this console closes')
                                : (zh ? '群主离线后节点仍继续执行' : 'Keeps running when the owner is offline')}</span>
                        </div>
                    </div>
                    {graphSelection && <div className='ComputeGraphSelection' role='status'>
                        <strong>{zh ? '已从图谱带入' : 'Filled from graph'}</strong>
                        <span>{graphSelection.taskType === 'information.web_fetch'
                            ? (zh ? '公开信息采集 agent' : 'Public information agent')
                            : graphSelection.taskType === 'network.lan_discovery'
                                ? (zh ? '局域网发现 agent' : 'LAN discovery agent')
                                : (zh ? '等待诊断 agent' : 'Wait diagnostic agent')}</span>
                        <span>{nodes.find(node => node.node_id === graphSelection.nodeId)?.name || graphSelection.nodeId}</span>
                        <span>CPU {taskCpu} · {taskMemoryGb} GB RAM · {taskDiskGb} GB Disk · GPU {taskGpu}</span>
                    </div>}
                    <div className='ComputeTaskForm'>
                        <label>
                            <span>{zh ? '工作类型' : 'Work type'}</span>
                            <select value={taskType} onChange={event => {
                                const next = event.target.value as ComputeTaskType;
                                setTaskType(next);
                                setTaskMode(next === 'system.wait' ? 'online' : 'background');
                                if (next === 'network.lan_discovery') {
                                    const candidate = nodes.find(node => node.online && (lanTargets[node.node_id]?.length || 0) > 0);
                                    setSelectedNode(candidate?.node_id || '');
                                    setScanCidr(candidate ? lanTargets[candidate.node_id][0].cidr : '');
                                } else if (!selectedNode) {
                                    setSelectedNode(orchestrationEnabled ? AUTO_PLACEMENT : (nodes.find(node => node.online)?.node_id || ''));
                                }
                                setGraphSelection(null);
                            }}>
                                <option value='information.web_fetch' disabled={!informationWorkAgentEnabled}>{zh ? '公开信息抓取' : 'Public information fetch'}</option>
                                <option value='network.lan_discovery' disabled={!discoveryEnabled}>{zh ? '局域网设备发现' : 'LAN device discovery'}</option>
                                <option value='system.wait'>{zh ? '等待测试' : 'Wait test'}</option>
                            </select>
                        </label>
                        <label>
                            <span>{zh ? '节点选择' : 'Node placement'}</span>
                            <select value={selectedNode} onChange={event => {
                                setSelectedNode(event.target.value);
                                const target = lanTargets[event.target.value]?.[0];
                                setScanCidr(target?.cidr || '');
                                setGraphSelection(null);
                            }}>
                                {orchestrationEnabled && !discoveryTask && <option value={AUTO_PLACEMENT}>{zh ? '计算群自动调度（推荐）' : 'Automatic group placement (recommended)'}</option>}
                                {nodes.map(node => <option value={node.node_id} key={node.node_id} disabled={!node.online}>
                                    {node.name}{node.online ? '' : (zh ? '（离线）' : ' (offline)')}
                                </option>)}
                            </select>
                        </label>
                        <label>
                            <span>{zh ? '运行方式' : 'Mode'}</span>
                            <select value={informationTask || discoveryTask ? 'background' : taskMode} disabled={informationTask || discoveryTask} onChange={event => setTaskMode(event.target.value as ComputeTaskMode)}>
                                <option value='online'>{zh ? '在线任务' : 'Online task'}</option>
                                <option value='background'>{zh ? '后台任务' : 'Background task'}</option>
                            </select>
                        </label>
                        <label>
                            <span>{informationTask ? (zh ? '公开信息 URL' : 'Public information URL') : discoveryTask ? (zh ? '扫描网段' : 'Scan network') : (zh ? '持续时间（秒）' : 'Duration (seconds)')}</span>
                            {informationTask
                                ? <input type='url' value={taskUrl} onChange={event => setTaskUrl(event.target.value)} placeholder='https://example.com/article'/>
                                : discoveryTask
                                    ? <select value={scanCidr} onChange={event => setScanCidr(event.target.value)}>
                                        {(lanTargets[selectedNode] || []).map(target => <option value={target.cidr} key={target.cidr}>
                                            {target.cidr} · {target.interface}{target.narrowed ? (zh ? '（已收窄）' : ' (bounded)') : ''}
                                        </option>)}
                                    </select>
                                : <input type='number' min={0} max={3600} value={taskSeconds} onChange={event => setTaskSeconds(Number(event.target.value))}/>}
                        </label>
                        <button
                            type='button'
                            disabled={submitting || !selectedNode || !selectedNodeOnline || !resourcesValid || !taskInputValid}
                            onClick={() => void submitTask()}
                        >{submitting ? (zh ? '调度中…' : 'Scheduling…') : (automaticPlacement ? (zh ? '自动调度' : 'Auto place') : (zh ? '定向下发' : 'Dispatch'))}</button>
                    </div>

                    {orchestrationEnabled && <div className='ComputeResourceRequestForm'>
                        <label><span>CPU {zh ? '核心' : 'cores'}</span><input type='number' min={0} step={0.1} value={taskCpu} onChange={event => setTaskCpu(Number(event.target.value))}/></label>
                        <label><span>{zh ? '内存（GB）' : 'Memory (GB)'}</span><input type='number' min={0} step={0.25} value={taskMemoryGb} onChange={event => setTaskMemoryGb(Number(event.target.value))}/></label>
                        <label><span>{zh ? '磁盘（GB）' : 'Disk (GB)'}</span><input type='number' min={0} step={0.0625} value={taskDiskGb} onChange={event => setTaskDiskGb(Number(event.target.value))}/></label>
                        <label><span>GPU {zh ? '数量' : 'count'}</span><input type='number' min={0} step={1} value={taskGpu} onChange={event => setTaskGpu(Number(event.target.value))}/></label>
                        <label><span>{zh ? '显存（MB）' : 'VRAM (MB)'}</span><input type='number' min={0} step={256} value={taskGpuMemoryMb} onChange={event => setTaskGpuMemoryMb(Number(event.target.value))}/></label>
                        <p>{discoveryTask
                            ? (zh ? '只扫描节点实时上报的私有网段，固定常用端口，最多 256 个地址；不执行漏洞、口令或公网扫描。' : 'Only live node-advertised private networks and fixed common ports are scanned, up to 256 addresses; no exploits, credentials, or public scans.')
                            : informationTask
                            ? (zh ? '正文、原始响应和节点路径留在执行节点；控制台仅显示来源、状态与内容哈希。' : 'Content, raw responses, and paths stay on the Node; the console shows only source, status, and digest.')
                            : (zh ? '调度器会排除离线、过期、能力不匹配或资源不足的节点。' : 'Offline, stale, incompatible, or undersized nodes are excluded.')}</p>
                    </div>}

                    <div className='ComputeTaskListHeading'>
                        <strong>{zh ? '最近任务' : 'Recent tasks'}</strong>
                        <span>{tasks.length}</span>
                    </div>
                    {tasks.length === 0 && <div className='ComputeTaskEmpty'>
                        {zh ? '还没有任务。使用默认公开 URL，点击“自动调度”即可验收 work agent。' : 'No tasks yet. Keep the public URL and click Auto place to validate the work agent.'}
                    </div>}
                    {tasks.length > 0 && <div className='ComputeTaskList'>
                        {tasks.map(task => <TaskCard
                            key={`${task.node_id}:${task.task_id}`}
                            task={task}
                            zh={zh}
                            busy={controllingTask.startsWith(task.task_id)}
                            onControl={(currentTask, action) => void controlTask(currentTask, action)}
                        />)}
                    </div>}
                </section>}
                {!loading && activeWorkspace === 'tasks' && !taskControlEnabled && nodes.length > 0 && <div className='ComputeTaskDisabled'>
                    {zh ? '任务控制令牌尚未配置，当前保持只读监控。' : 'Task control token is not configured; monitoring remains read-only.'}
                </div>}
                {!loading && activeWorkspace === 'network' && status?.task_control?.lan_discovery_schedules && <section className='ComputeLanSchedules'>
                    <div className='ComputeLanAssetsHeading'>
                        <div>
                            <span>{zh ? '自动发现' : 'Automated discovery'}</span>
                            <h3>{zh ? '局域网扫描计划' : 'LAN discovery schedules'}</h3>
                            <p>{zh ? '计划由 Mac Client 后台运行；关闭 OpenSight 后仍继续，最短间隔 15 分钟。' : 'Schedules run in the Mac Client background after OpenSight closes; minimum interval is 15 minutes.'}</p>
                        </div>
                        <div className='ComputeLanScheduleCreate'>
                            <select aria-label={zh ? '计划节点' : 'Schedule node'} value={selectedNode === AUTO_PLACEMENT ? '' : selectedNode} onChange={event => {
                                setSelectedNode(event.target.value);
                                setScanCidr(lanTargets[event.target.value]?.[0]?.cidr || '');
                            }}>
                                <option value=''>{zh ? '选择节点' : 'Choose node'}</option>
                                {nodes.filter(node => node.online && (lanTargets[node.node_id]?.length || 0) > 0).map(node => <option value={node.node_id} key={node.node_id}>{node.name}</option>)}
                            </select>
                            <select aria-label={zh ? '计划网段' : 'Schedule network'} value={scanCidr} onChange={event => setScanCidr(event.target.value)}>
                                {(lanTargets[selectedNode] || []).map(target => <option value={target.cidr} key={target.cidr}>{target.cidr}</option>)}
                            </select>
                            <select aria-label={zh ? '扫描间隔' : 'Scan interval'} value={scheduleInterval} onChange={event => setScheduleInterval(Number(event.target.value))}>
                                <option value={15}>{zh ? '每 15 分钟' : 'Every 15 minutes'}</option>
                                <option value={60}>{zh ? '每小时' : 'Hourly'}</option>
                                <option value={360}>{zh ? '每 6 小时' : 'Every 6 hours'}</option>
                                <option value={1440}>{zh ? '每天' : 'Daily'}</option>
                            </select>
                            <button type='button' disabled={!selectedNode || selectedNode === AUTO_PLACEMENT || !scanCidr || Boolean(scheduleBusy)} onClick={() => void createSchedule()}>{zh ? '创建计划' : 'Create schedule'}</button>
                        </div>
                    </div>
                    {lanSchedules.length === 0 && <div className='ComputeLanAssetsEmpty'>{zh ? '尚无定时计划。' : 'No schedules yet.'}</div>}
                    {lanSchedules.length > 0 && <div className='ComputeLanScheduleList'>{lanSchedules.map(schedule => <article key={schedule.schedule_id}>
                        <span className={`ComputeLanAssetState ${schedule.enabled ? '' : 'offline'}`}>{schedule.enabled ? (zh ? '运行中' : 'Enabled') : (zh ? '已暂停' : 'Paused')}</span>
                        <div><strong>{schedule.node_name}</strong><small>{schedule.cidr}</small></div>
                        <div><strong>{zh ? `每 ${schedule.interval_minutes} 分钟` : `Every ${schedule.interval_minutes} minutes`}</strong><small>{zh ? `已执行 ${schedule.run_count} 次` : `${schedule.run_count} run(s)`}</small></div>
                        <div><strong>{zh ? '下次执行' : 'Next run'}</strong><small>{new Date(schedule.next_run_at * 1000).toLocaleString()}</small></div>
                        {schedule.last_error && <small className='ComputeLanScheduleError'>{schedule.last_error}</small>}
                        <div className='ComputeLanScheduleActions'>
                            <button type='button' disabled={Boolean(scheduleBusy)} onClick={() => void controlSchedule(schedule, 'run-now')}>{zh ? '立即执行' : 'Run now'}</button>
                            <button type='button' disabled={Boolean(scheduleBusy)} onClick={() => void controlSchedule(schedule, schedule.enabled ? 'pause' : 'resume')}>{schedule.enabled ? (zh ? '暂停' : 'Pause') : (zh ? '恢复' : 'Resume')}</button>
                        </div>
                    </article>)}</div>}
                </section>}
                {!loading && activeWorkspace === 'network' && status?.task_control?.lan_asset_inventory && lanAssets && <section className='ComputeLanAssets'>
                    <div className='ComputeLanAssetsHeading'>
                        <div>
                            <span>{zh ? '资产台账' : 'Asset inventory'}</span>
                            <h3>{zh ? '节点局域网资产' : 'Node LAN assets'}</h3>
                            <p>{zh
                                ? '每次安全扫描都会与该节点上一次结果比较；历史资产不会因节点暂时离线而消失。'
                                : 'Each bounded scan is compared with the node previous result; history remains when a node is temporarily offline.'}</p>
                        </div>
                        <div className='ComputeLanAssetStats'>
                            <strong>{lanAssets.summary.online}</strong><span>{zh ? '在线' : 'online'}</span>
                            <strong>{lanAssets.summary.new}</strong><span>{zh ? '新增' : 'new'}</span>
                            <strong>{lanAssets.summary.changed}</strong><span>{zh ? '变化' : 'changed'}</span>
                            <strong>{lanAssets.summary.offline}</strong><span>{zh ? '离线' : 'offline'}</span>
                        </div>
                    </div>
                    {lanAssets.assets.length === 0 && <div className='ComputeLanAssetsEmpty'>
                        {zh ? '尚无资产记录。完成一次“局域网设备发现”后会自动建立台账。' : 'No assets yet. Run LAN device discovery once to build the inventory.'}
                    </div>}
                    {lanAssets.assets.length > 0 && <div className='ComputeLanAssetList'>
                        {lanAssets.assets.map(asset => <article key={asset.asset_id} className={asset.online ? 'online' : 'offline'}>
                            <span className={`ComputeLanAssetState ${asset.change_type}`}>{asset.online
                                ? asset.change_type === 'new' ? (zh ? '新增' : 'New')
                                    : asset.change_type === 'changed' ? (zh ? '变化' : 'Changed')
                                        : (zh ? '在线' : 'Online')
                                : (zh ? '离线' : 'Offline')}</span>
                            <div><strong>{asset.hostname || asset.address}</strong><small>{asset.address} · {asset.cidr}</small></div>
                            <div><strong>{asset.node_name}</strong><small>{asset.mac || (zh ? '未获取 MAC' : 'MAC unavailable')}</small></div>
                            <div className='ComputeLanAssetPorts'>{asset.ports.length
                                ? asset.ports.map(port => <code key={port.port}>{port.service}:{port.port}</code>)
                                : <small>{zh ? '未发现常用服务' : 'No common service found'}</small>}</div>
                        </article>)}
                    </div>}
                </section>}
                {!loading && activeWorkspace === 'terminal' && status?.task_control?.terminal_sessions && <ComputeTerminalPanel zh={zh}/>}
                {!loading && activeWorkspace === 'terminal' && !status?.task_control?.terminal_sessions && <div className='ComputeTaskDisabled'>
                    {zh ? 'Mac Client 尚未启用终端控制。' : 'Terminal control is not enabled on the Mac Client.'}
                </div>}
                {!loading && activeWorkspace === 'nodes' && nodes.length > 0 && <div className='ComputeNodeSectionTitle'>
                    <strong>{zh ? '节点资源' : 'Node resources'}</strong>
                    <span>{nodes.length}</span>
                </div>}
                {!loading && activeWorkspace === 'nodes' && nodes.map(node => <NodeCard key={node.node_id} node={node} zh={zh}/>)}
            </div>
        </section>
    </div>;
};

const mapStateToProps = (state: AppState) => ({language: state.general.language});

export default connect(mapStateToProps)(ComputeClusterPopup);
