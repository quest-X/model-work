import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {connect} from 'react-redux';
import {Language} from '../../../data/LanguageConfig';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeClusterStatus,
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

export const ComputeClusterPopup: React.FC<IProps> = ({language}) => {
    const zh = language === Language.CHINESE;
    const [nodes, setNodes] = useState<ComputeClusterNode[]>([]);
    const [status, setStatus] = useState<ComputeClusterStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const mounted = useRef(true);

    const refresh = useCallback(async (signal?: AbortSignal, initial = false) => {
        if (!initial && mounted.current) setRefreshing(true);
        try {
            const [nextStatus, nextNodes] = await Promise.all([
                ComputeClusterService.status(signal),
                ComputeClusterService.nodes(signal),
            ]);
            if (mounted.current) {
                setStatus(nextStatus);
                setNodes(nextNodes);
                setError('');
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
        }
    }, []);

    useEffect(() => {
        mounted.current = true;
        const controller = new AbortController();
        void refresh(controller.signal, true);
        const timer = window.setInterval(() => void refresh(controller.signal), 5000);
        return () => {
            mounted.current = false;
            controller.abort();
            window.clearInterval(timer);
        };
    }, [refresh]);

    const totals = useMemo(() => ({
        total: status?.nodes.total ?? nodes.length,
        online: status?.nodes.online ?? nodes.filter(node => node.online).length,
        gpus: status?.nodes.gpu_total ?? nodes.reduce((sum, node) => sum + node.resources.gpus.length, 0),
        devices: status?.nodes.device_total ?? nodes.reduce((sum, node) => sum + node.device_inventory.devices.length, 0),
        cpu: nodes.reduce((sum, node) => sum + node.resources.cpu_logical, 0),
    }), [nodes, status]);

    return <div className='ComputeClusterBackdrop'>
        <section className='ComputeClusterPopup' aria-label={zh ? '计算群' : 'Compute Cluster'}>
            <header>
                <div>
                    <span className='ComputeClusterEyebrow'>OpenSight · model-work-node</span>
                    <h2>{zh ? '计算群' : 'Compute Cluster'}</h2>
                    <p>{zh
                        ? '汇总灵析节点的计算资源与心跳状态；0.1 阶段仅监控，不开放远程命令。'
                        : 'Resource and heartbeat overview for Lingxi nodes. Version 0.1 is monitoring-only.'}</p>
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
            </div>

            {error && <div className='ComputeClusterError' role='alert'>{error}</div>}

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
                {!loading && nodes.map(node => <article className={`ComputeNodeCard ${node.online ? 'online' : 'offline'}`} key={node.node_id}>
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
                        <span>Agent v{node.agent_version}</span>
                        <span>{node.capabilities.length} {zh ? '项能力' : 'capabilities'}</span>
                    </footer>
                </article>)}
            </div>
        </section>
    </div>;
};

const mapStateToProps = (state: AppState) => ({language: state.general.language});

export default connect(mapStateToProps)(ComputeClusterPopup);
