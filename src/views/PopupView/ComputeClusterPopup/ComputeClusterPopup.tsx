import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {connect} from 'react-redux';
import {Language} from '../../../data/LanguageConfig';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeClusterStatus,
    ComputeTask,
    ComputeTaskMode,
} from '../../../services/ComputeClusterService';
import {AppState} from '../../../store';
import './ComputeClusterPopup.scss';

interface IProps {
    language: Language;
}

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
    return <article className={`ComputeTaskCard ${task.state}`}>
        <div className='ComputeTaskIdentity'>
            <span className={`ComputeTaskState ${task.state}`}>{taskState(task.state, zh)}</span>
            <div>
                <strong>{zh ? '等待测试' : 'Wait test'} · {task.node_name}</strong>
                <small>{task.mode === 'online' ? (zh ? '在线任务' : 'Online') : (zh ? '后台任务' : 'Background')} · {task.task_id.slice(0, 8)}</small>
            </div>
        </div>
        <div className='ComputeTaskProgress'>
            <div><i style={{width: `${progress}%`}}/></div>
            <span>{progress.toFixed(0)}%</span>
            <small>{Number(task.progress?.completed ?? task.checkpoint?.elapsed_seconds ?? 0).toFixed(1)} / {Number(task.parameters.seconds ?? task.progress?.total ?? 0).toFixed(1)} s</small>
        </div>
        <div className='ComputeTaskActions'>
            {active && <button type='button' disabled={busy} onClick={() => onControl(task, 'pause')}>{zh ? '暂停' : 'Pause'}</button>}
            {task.state === 'paused' && <button type='button' disabled={busy} onClick={() => onControl(task, 'resume')}>{zh ? '恢复' : 'Resume'}</button>}
            {!finished && <button type='button' className='danger' disabled={busy} onClick={() => onControl(task, 'cancel')}>{zh ? '取消' : 'Cancel'}</button>}
        </div>
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
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [taskError, setTaskError] = useState('');
    const [selectedNode, setSelectedNode] = useState('');
    const [taskMode, setTaskMode] = useState<ComputeTaskMode>('online');
    const [taskSeconds, setTaskSeconds] = useState(20);
    const [submitting, setSubmitting] = useState(false);
    const [controllingTask, setControllingTask] = useState('');
    const mounted = useRef(true);
    const refreshingRef = useRef(false);
    const heartbeats = useRef<Record<string, number>>({});

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
                setSelectedNode(current => current || nextNodes.find(node => node.online)?.node_id || nextNodes[0]?.node_id || '');
                setError('');
            }
            if (nextStatus.task_control?.enabled) {
                try {
                    const response = await ComputeClusterService.tasks(signal);
                    if (mounted.current) {
                        setTasks(response.tasks);
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

    const submitTask = useCallback(async () => {
        if (!selectedNode || submitting || taskSeconds < 0 || taskSeconds > 3600) return;
        setSubmitting(true);
        try {
            await ComputeClusterService.submitTask({
                node_id: selectedNode,
                mode: taskMode,
                seconds: taskSeconds,
                lease_seconds: 60,
            });
            setTaskError('');
            await refresh();
        } catch (reason) {
            setTaskError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            if (mounted.current) setSubmitting(false);
        }
    }, [refresh, selectedNode, submitting, taskMode, taskSeconds]);

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

    const totals = useMemo(() => ({
        total: status?.nodes.total ?? nodes.length,
        online: status?.nodes.online ?? nodes.filter(node => node.online).length,
        gpus: status?.nodes.gpu_total ?? nodes.reduce((sum, node) => sum + node.resources.gpus.length, 0),
        devices: status?.nodes.device_total ?? nodes.reduce((sum, node) => sum + node.device_inventory.devices.length, 0),
        cpu: nodes.reduce((sum, node) => sum + node.resources.cpu_logical, 0),
        activeTasks: tasks.filter(task => task.state === 'queued' || task.state === 'running').length,
    }), [nodes, status, tasks]);

    const taskControlEnabled = status?.task_control?.enabled === true;

    return <div className='ComputeClusterBackdrop'>
        <section className='ComputeClusterPopup' aria-label={zh ? '计算群' : 'Compute Cluster'}>
            <header>
                <div>
                    <span className='ComputeClusterEyebrow'>OpenSight · model-work-node</span>
                    <h2>{zh ? '计算群' : 'Compute Cluster'}</h2>
                    <p>{zh
                        ? '第二阶段：通过签名白名单任务安全下发、查看进度，并支持暂停、恢复和取消。'
                        : 'Phase 2: dispatch signed allowlisted tasks, monitor progress, pause, resume, and cancel.'}</p>
                </div>
                <div className='ComputeClusterHeaderActions'>
                    <span className={`ComputeClusterServiceState ${error ? 'error' : 'ready'}`}>
                        <i/>{error ? (zh ? '连接异常' : 'Unavailable') : `v${status?.version || '0.1.0'}`}
                    </span>
                    <button type='button' disabled={refreshing} onClick={() => void refresh()}>
                        {refreshing ? (zh ? '刷新中…' : 'Refreshing…') : (zh ? '刷新' : 'Refresh')}
                    </button>
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
                {!loading && taskControlEnabled && <section className='ComputeTaskControl'>
                    <div className='ComputeTaskControlHeading'>
                        <div>
                            <span>{zh ? '阶段 2 · 任务分发' : 'Phase 2 · Task dispatch'}</span>
                            <h3>{zh ? '创建安全测试任务' : 'Create a safe test task'}</h3>
                            <p>{zh
                                ? '当前仅开放可暂停的等待任务，用来验收完整控制链路；不会执行 Shell。'
                                : 'Only a pausable wait task is enabled to validate the control path. Shell is never executed.'}</p>
                        </div>
                        <div className='ComputeTaskModeHelp'>
                            <strong>{taskMode === 'online' ? (zh ? '在线任务' : 'Online') : (zh ? '后台任务' : 'Background')}</strong>
                            <span>{taskMode === 'online'
                                ? (zh ? '关闭页面并超过租约后自动取消' : 'Cancels after the lease when this console closes')
                                : (zh ? 'MacBook 离线后节点仍继续执行' : 'Keeps running when the MacBook is offline')}</span>
                        </div>
                    </div>
                    <div className='ComputeTaskForm'>
                        <label>
                            <span>{zh ? '目标节点' : 'Target node'}</span>
                            <select value={selectedNode} onChange={event => setSelectedNode(event.target.value)}>
                                {nodes.map(node => <option value={node.node_id} key={node.node_id} disabled={!node.online}>
                                    {node.name}{node.online ? '' : (zh ? '（离线）' : ' (offline)')}
                                </option>)}
                            </select>
                        </label>
                        <label>
                            <span>{zh ? '运行方式' : 'Mode'}</span>
                            <select value={taskMode} onChange={event => setTaskMode(event.target.value as ComputeTaskMode)}>
                                <option value='online'>{zh ? '在线任务' : 'Online task'}</option>
                                <option value='background'>{zh ? '后台任务' : 'Background task'}</option>
                            </select>
                        </label>
                        <label>
                            <span>{zh ? '持续时间（秒）' : 'Duration (seconds)'}</span>
                            <input
                                type='number'
                                min={0}
                                max={3600}
                                value={taskSeconds}
                                onChange={event => setTaskSeconds(Number(event.target.value))}
                            />
                        </label>
                        <button
                            type='button'
                            disabled={submitting || !selectedNode || !nodes.some(node => node.node_id === selectedNode && node.online)}
                            onClick={() => void submitTask()}
                        >{submitting ? (zh ? '下发中…' : 'Dispatching…') : (zh ? '下发任务' : 'Dispatch task')}</button>
                    </div>

                    <div className='ComputeTaskListHeading'>
                        <strong>{zh ? '最近任务' : 'Recent tasks'}</strong>
                        <span>{tasks.length}</span>
                    </div>
                    {tasks.length === 0 && <div className='ComputeTaskEmpty'>
                        {zh ? '还没有任务。选择节点后下发一个 20 秒测试任务。' : 'No tasks yet. Dispatch a 20-second test task.'}
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
                {!loading && !taskControlEnabled && nodes.length > 0 && <div className='ComputeTaskDisabled'>
                    {zh ? '任务控制令牌尚未配置，当前保持只读监控。' : 'Task control token is not configured; monitoring remains read-only.'}
                </div>}
                {!loading && nodes.length > 0 && <div className='ComputeNodeSectionTitle'>
                    <strong>{zh ? '节点资源' : 'Node resources'}</strong>
                    <span>{nodes.length}</span>
                </div>}
                {!loading && nodes.map(node => <NodeCard key={node.node_id} node={node} zh={zh}/>)}
            </div>
        </section>
    </div>;
};

const mapStateToProps = (state: AppState) => ({language: state.general.language});

export default connect(mapStateToProps)(ComputeClusterPopup);
