import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {connect} from 'react-redux';
import {Language} from '../../data/LanguageConfig';
import {Direction} from '../../data/enums/Direction';
import {
    ComputeClusterNode,
    ComputeManagedDevice,
    ComputeNetworkDependency,
    ComputeResourceGraph,
    ComputeRuntimeEvent,
    ComputeRuntimeInventory,
    ComputeRuntimeService,
    ComputeRuntimeSnapshot,
    ComputeTask,
    ComputeClusterService,
} from '../../services/ComputeClusterService';
import {
    AgentChatService,
    AgentConversation,
    AgentConversationMessage,
} from '../../services/AgentChatService';
import {CameraResourceService} from '../../services/CameraResourceService';
import {AppState} from '../../store';
import {ImageData} from '../../store/labels/types';
import {SideNavigationBar} from '../EditorView/SideNavigationBar/SideNavigationBar';
import {VerticalEditorButton} from '../EditorView/VerticalEditorButton/VerticalEditorButton';
import {ComputeClusterPopup} from '../PopupView/ComputeClusterPopup/ComputeClusterPopup';
import {ComputeTerminalPanel} from '../PopupView/ComputeClusterPopup/ComputeTerminalPanel';
import {ResourceKnowledgeGraph} from '../PopupView/ComputeClusterPopup/ResourceKnowledgeGraph';
import '../EditorView/EditorContainer/EditorContainer.scss';
import '../EditorView/EditorTopNavigationBar/EditorTopNavigationBar.scss';
import '../PopupView/ComputeClusterPopup/ComputeClusterPopup.scss';
import './ControlCenterView.scss';

const ClusterGeographicMap = React.lazy(() => import('./ClusterGeographicMap')
    .then(module => ({default: module.ClusterGeographicMap})));

interface IProps {
    language: Language;
    imagesData?: ImageData[];
    onCameraOpened?: () => void;
}

type Tone = 'healthy' | 'warning' | 'offline' | 'unknown';
type SidePanel = 'machines' | 'features';
type Workspace = 'node' | 'network' | 'terminal' | 'groups';
type MachineIconKind = 'jetson' | 'windows' | 'linux' | 'macos' | 'computer';
type NodeGrouping = 'none' | 'region' | 'platform';
type NodeOrdering = 'status' | 'activity' | 'name';
type NodeVisibility = 'all' | 'online' | 'offline';
type OverviewView = 'map' | 'graph';
type MonitorView = 'performance' | 'processes' | 'startup' | 'services' | 'tasks' | 'conversations';
type ProcessSortKey = 'name' | 'pid' | 'cpu' | 'memory' | 'state';
type StartupSortKey = 'name' | 'identifier' | 'state' | 'startType';
type TaskSortKey = 'task' | 'device' | 'state' | 'updated';
type SortDirection = 'asc' | 'desc';
type ResourceMetricId = 'cpu' | 'memory' | 'gpu' | 'disk' | 'network';
type ResourceSample = {
    nodeId: string;
    capturedAt: number;
    cpu: number | null;
    memory: number | null;
    gpu: number | null;
    disk: number | null;
    diskRead: number | null;
    diskWrite: number | null;
    networkReceive: number | null;
    networkSend: number | null;
};

const machineIconKind = (node: ComputeClusterNode): MachineIconKind => {
    const model = node.resources.hardware_model?.toLowerCase() || '';
    const platform = node.resources.platform.trim().toLowerCase();
    if (model.includes('jetson')) return 'jetson';
    if (platform.startsWith('win')) return 'windows';
    if (platform.includes('darwin') || platform.includes('mac')) return 'macos';
    if (platform.includes('linux')) return 'linux';
    return 'computer';
};

const MachinePlatformIcon: React.FC<{node: ComputeClusterNode}> = ({node}) => {
    const kind = machineIconKind(node);
    if (kind === 'jetson') return <img
        className='ControlMachineIcon'
        src='/ico/jetson-agx-orin.png'
        alt='Jetson'
        draggable={false}
    />;

    return <span
        className={`ControlMachineIcon ${kind}`}
        role='img'
        aria-label={kind === 'macos' ? 'macOS' : kind === 'computer' ? 'Computer' : `${kind[0].toUpperCase()}${kind.slice(1)}`}
    >
        <svg viewBox='0 0 24 24' aria-hidden='true'>
            {kind !== 'computer' && <image href={`/ico/system-${kind}.svg`} x='3' y='2' width='18' height='20'/>}
            {kind === 'computer' && <><rect x='3' y='4' width='18' height='13' rx='2'/><path d='M8 21h8m-4-4v4'/></>}
        </svg>
    </span>;
};

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

const bytesPerSecond = (value: number | null, zh: boolean): string => value === null
    ? (zh ? '未上报' : 'Not reported')
    : `${bytes(value, zh)}/s`;

const percentUsed = (total: number | null, available: number | null): string => {
    if (!total || available === null) return '—';
    return `${Math.round(Math.max(0, Math.min(1, 1 - available / total)) * 100)}%`;
};

const usedPercent = (total: number | null, available: number | null): number | null => {
    if (!total || available === null) return null;
    return Math.round(Math.max(0, Math.min(1, 1 - available / total)) * 100);
};

const cpuUsedPercent = (node: ComputeClusterNode): number | null => {
    if (Number.isFinite(node.resources.cpu_percent)) {
        return Math.round(Math.max(0, Math.min(100, node.resources.cpu_percent as number)));
    }
    if (node.resources.load_average_1m === null) return null;
    return Math.round(Math.max(0, Math.min(100, node.resources.load_average_1m / node.resources.cpu_logical * 100)));
};

const gpuUsedPercent = (node: ComputeClusterNode): number | null => node.resources.gpus.length
    ? Math.round(node.resources.gpus.reduce((sum, gpu) => sum + gpu.utilization_percent, 0) / node.resources.gpus.length)
    : null;

const resourceSample = (node: ComputeClusterNode): ResourceSample => ({
    nodeId: node.node_id,
    capturedAt: node.resources.captured_at,
    cpu: cpuUsedPercent(node),
    memory: usedPercent(node.resources.memory_total_bytes, node.resources.memory_available_bytes),
    gpu: gpuUsedPercent(node),
    disk: usedPercent(node.resources.disk_total_bytes, node.resources.disk_free_bytes),
    diskRead: node.resources.disk_read_bytes_per_second ?? null,
    diskWrite: node.resources.disk_write_bytes_per_second ?? null,
    networkReceive: node.resources.network_receive_bytes_per_second ?? null,
    networkSend: node.resources.network_send_bytes_per_second ?? null,
});

const ResourceSparkline: React.FC<{
    label: string;
    values: (number | null)[];
    secondaryValues?: (number | null)[];
    color: string;
    secondaryColor?: string;
    emptyLabel: string;
    autoScale?: boolean;
}> = ({label, values, secondaryValues = [], color, secondaryColor, emptyLabel, autoScale = false}) => {
    const reported = [...values, ...secondaryValues]
        .filter((value): value is number => value !== null && Number.isFinite(value));
    const scale = autoScale ? Math.max(1, ...reported) : 100;
    const shape = (series: (number | null)[]) => {
        const readings = series.map((value, index) => value === null
            ? null
            : {index, value: Math.max(0, Math.min(scale, value))}
        ).filter((reading): reading is {index: number; value: number} => reading !== null);
        let coordinates = readings.map(reading => [
            readings.length === 1 ? 0 : reading.index / Math.max(1, series.length - 1) * 160,
            44 - reading.value / scale * 42,
        ]);
        if (coordinates.length === 1) coordinates = [coordinates[0], [160, coordinates[0][1]]];
        const points = coordinates.map(point => point.join(',')).join(' ');
        return {
            points,
            area: coordinates.length > 0
                ? `${coordinates[0][0]},44 ${points} ${coordinates[coordinates.length - 1][0]},44`
                : '',
        };
    };
    const primary = shape(values);
    const secondary = shape(secondaryValues);
    return <div className='ControlMonitorChart'>
        {primary.points || secondary.points
            ? <svg viewBox='0 0 160 44' preserveAspectRatio='none' role='img' aria-label={label}>
                {primary.points && <><polygon points={primary.area} fill={color}/><polyline points={primary.points} stroke={color}/></>}
                {secondary.points && <><polygon points={secondary.area} fill={secondaryColor}/><polyline points={secondary.points} stroke={secondaryColor}/></>}
            </svg>
            : <span className='ControlMonitorChartEmpty'>{emptyLabel}</span>}
    </div>;
};

const lastSeen = (seconds: number, zh: boolean): string => {
    if (seconds < 5) return zh ? '刚刚' : 'Just now';
    if (seconds < 60) return zh ? `${Math.round(seconds)} 秒前` : `${Math.round(seconds)}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return zh ? `${minutes} 分钟前` : `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    return zh ? `${hours} 小时前` : `${hours}h ago`;
};

const runtimeDuration = (seconds: number | null, zh: boolean): string => {
    if (seconds === null || !Number.isFinite(seconds)) return zh ? '未知' : 'Unknown';
    const minutes = Math.floor(Math.max(0, seconds) / 60);
    if (minutes < 1) return zh ? '不足 1 分钟' : '< 1 minute';
    if (minutes < 60) return zh ? `${minutes} 分钟` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    return days > 0
        ? (zh ? `${days} 天 ${hours % 24} 小时` : `${days}d ${hours % 24}h`)
        : (zh ? `${hours} 小时 ${minutes % 60} 分钟` : `${hours}h ${minutes % 60}m`);
};

const runtimeTime = (timestamp: number, zh: boolean): string => timestamp
    ? new Date(timestamp * 1000).toLocaleString(zh ? 'zh-CN' : 'en-US')
    : (zh ? '未知' : 'Unknown');

const runtimeTone = (state: ComputeRuntimeService['state']): Tone => {
    if (state === 'healthy') return 'healthy';
    if (state === 'degraded') return 'warning';
    if (state === 'unavailable') return 'offline';
    return 'unknown';
};

const runtimeStateLabel = (state: ComputeRuntimeService['state'], zh: boolean): string => ({
    healthy: zh ? '正常' : 'Healthy',
    degraded: zh ? '降级' : 'Degraded',
    unavailable: zh ? '不可用' : 'Unavailable',
    unknown: zh ? '未知' : 'Unknown',
})[state];

const processStateLabel = (
    state: ComputeRuntimeInventory['processes'][number]['state'],
    zh: boolean,
): string => ({
    running: zh ? '运行中' : 'Running',
    sleeping: zh ? '休眠' : 'Sleeping',
    stopped: zh ? '已停止' : 'Stopped',
    zombie: zh ? '僵尸进程' : 'Zombie',
    unknown: zh ? '未知' : 'Unknown',
})[state];

const startupStateLabel = (
    state: ComputeRuntimeInventory['startup_services'][number]['state'],
    zh: boolean,
): string => ({
    running: zh ? '已启用' : 'Enabled',
    stopped: zh ? '已禁用' : 'Disabled',
    paused: zh ? '已暂停' : 'Paused',
    pending: zh ? '处理中' : 'Pending',
    unknown: zh ? '未知' : 'Unknown',
})[state];

const taskStateLabel = (state: string, zh: boolean): string => ({
    queued: zh ? '排队' : 'Queued',
    running: zh ? '运行中' : 'Running',
    paused: zh ? '已暂停' : 'Paused',
    succeeded: zh ? '成功' : 'Succeeded',
    failed: zh ? '失败' : 'Failed',
    cancelled: zh ? '已取消' : 'Cancelled',
})[state] || state;

const taskTypeLabel = (type: string, zh: boolean): string => ({
    'system.wait': zh ? '连通测试' : 'Connectivity test',
    'information.web_fetch': zh ? '网页读取' : 'Web fetch',
    'network.lan_discovery': zh ? '局域网发现' : 'LAN discovery',
    'network.peer_probe': zh ? '网络探测' : 'Network probe',
})[type] || type;

const conversationMessage = (content: string): string => {
    for (const marker of ['用户消息：', 'User message: ']) {
        const index = content.lastIndexOf(marker);
        if (index >= 0) return content.slice(index + marker.length).trim();
    }
    return content;
};

const conversationTitle = (title: string | null, zh: boolean): string => {
    if (!title) return zh ? '未命名对话' : 'Untitled conversation';
    if (title.startsWith('以下 OpenSight') || title.startsWith('The OpenSight')) {
        return zh ? '设备对话' : 'Device conversation';
    }
    return title;
};

const historyTime = (value: string, zh: boolean): string => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString(zh ? 'zh-CN' : 'en-US');
};

const REGION_DISPLAY_NAMES: Record<string, string> = {上海: '上海市', 山东: '山东省'};
const regionDisplayName = (name: string, zh: boolean): string => zh
    ? (REGION_DISPLAY_NAMES[name] || name)
    : name;

const dependency = (
    node: ComputeClusterNode,
    id: ComputeNetworkDependency['dependency_id'],
): ComputeNetworkDependency['state'] => node.network_dependencies.find(item => item.dependency_id === id)?.state || 'unknown';

const dependencyTone = (state: ComputeNetworkDependency['state']): Tone => state === 'healthy'
    ? 'healthy'
    : 'offline';

const dependencyLabel = (state: ComputeNetworkDependency['state'], zh: boolean): string => state === 'healthy'
    ? zh ? '正常' : 'Healthy'
    : zh ? '故障' : 'Fault';

const cameraTone = (status: ComputeManagedDevice['status']): Tone => {
    if (status === 'online') return 'healthy';
    if (status === 'registered') return 'warning';
    return 'offline';
};

const cameraLabel = (status: ComputeManagedDevice['status'], zh: boolean): string => ({
    registered: zh ? '已登记 · 运行状态未上报' : 'Registered · runtime not reported',
    online: zh ? '在线' : 'Online',
    offline: zh ? '离线' : 'Offline',
    unavailable: zh ? '不可用' : 'Unavailable',
})[status];

const NODE_TAG_LIMIT = 8;
const NODE_TAG_MAX_LENGTH = 32;
const RUNTIME_ALERT_WINDOW_SECONDS = 24 * 60 * 60;
const nodeTagsKey = (nodeId: string): string => `opensight.control-center.node-tags.${nodeId}`;

const loadNodeTags = (nodeId: string): string[] => {
    try {
        const value = JSON.parse(window.localStorage.getItem(nodeTagsKey(nodeId)) || '[]');
        if (!Array.isArray(value)) return [];
        const tags = value
            .filter((tag): tag is string => typeof tag === 'string')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0 && tag.length <= NODE_TAG_MAX_LENGTH);
        return Array.from(new Set(tags)).slice(0, NODE_TAG_LIMIT);
    } catch {
        return [];
    }
};

const saveNodeTags = (nodeId: string, tags: string[]): void => {
    try {
        window.localStorage.setItem(nodeTagsKey(nodeId), JSON.stringify(tags));
    } catch {
        // Browser storage can be unavailable; the current-page edit still works.
    }
};

// Loading, empty, stale, and selected-node states share one small dashboard boundary.
// eslint-disable-next-line complexity
export const ControlCenterView: React.FC<IProps> = ({language, imagesData = [], onCameraOpened}) => {
    const zh = language === Language.CHINESE;
    const [sidePanel, setSidePanel] = useState<SidePanel | null>('machines');
    const [workspace, setWorkspace] = useState<Workspace>('node');
    const [nodes, setNodes] = useState<ComputeClusterNode[]>([]);
    const [resourceGraph, setResourceGraph] = useState<ComputeResourceGraph | null>(null);
    const [selectedNodeId, setSelectedNodeId] = useState('');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [graphError, setGraphError] = useState('');
    const [runtimeSnapshot, setRuntimeSnapshot] = useState<ComputeRuntimeSnapshot | null>(null);
    const [runtimeInventory, setRuntimeInventory] = useState<ComputeRuntimeInventory | null>(null);
    const [runtimeEventList, setRuntimeEventList] = useState<ComputeRuntimeEvent[]>([]);
    const [runtimeError, setRuntimeError] = useState('');
    const [runtimeInventoryError, setRuntimeInventoryError] = useState('');
    const [runtimeWarningDismissed, setRuntimeWarningDismissed] = useState(false);
    const [dismissedRuntimeAlertKey, setDismissedRuntimeAlertKey] = useState('');
    const [runtimeEventsError, setRuntimeEventsError] = useState('');
    const [inspectedServiceId, setInspectedServiceId] = useState('');
    const [monitorView, setMonitorView] = useState<MonitorView>('performance');
    const [processQuery, setProcessQuery] = useState('');
    const [processSort, setProcessSort] = useState<{key: ProcessSortKey; direction: SortDirection}>({
        key: 'memory',
        direction: 'desc',
    });
    const [startupSort, setStartupSort] = useState<{key: StartupSortKey; direction: SortDirection}>({
        key: 'name',
        direction: 'asc',
    });
    const [taskHistory, setTaskHistory] = useState<ComputeTask[]>([]);
    const [taskSort, setTaskSort] = useState<{key: TaskSortKey; direction: SortDirection}>({
        key: 'updated',
        direction: 'desc',
    });
    const [taskHistoryLoading, setTaskHistoryLoading] = useState(false);
    const [taskHistoryError, setTaskHistoryError] = useState('');
    const [conversationHistory, setConversationHistory] = useState<AgentConversation[]>([]);
    const [conversationMessages, setConversationMessages] = useState<AgentConversationMessage[]>([]);
    const [selectedConversationId, setSelectedConversationId] = useState('');
    const [conversationHistoryLoading, setConversationHistoryLoading] = useState(false);
    const [conversationHistoryError, setConversationHistoryError] = useState('');
    const [resourceHistory, setResourceHistory] = useState<ResourceSample[]>([]);
    const [activeMetricId, setActiveMetricId] = useState<ResourceMetricId>('memory');
    const [cameraError, setCameraError] = useState('');
    const [openingCameraId, setOpeningCameraId] = useState('');
    const [queriedAt, setQueriedAt] = useState<Date | null>(null);
    const [nodeTags, setNodeTags] = useState<string[]>([]);
    const [tagDraft, setTagDraft] = useState('');
    const [nodeGrouping, setNodeGrouping] = useState<NodeGrouping>('region');
    const [nodeOrdering, setNodeOrdering] = useState<NodeOrdering>('status');
    const [nodeVisibility, setNodeVisibility] = useState<NodeVisibility>('all');
    const [overviewView, setOverviewView] = useState<OverviewView>('map');
    const mounted = useRef(true);
    const refreshInFlight = useRef(false);
    const overviewSelected = useRef(false);
    const selectedNodeIdRef = useRef('');
    const runtimeRequest = useRef(0);
    const runtimePendingNode = useRef('');
    const runtimeAbort = useRef<AbortController | null>(null);
    const runtimeInventoryRequest = useRef(0);
    const runtimeInventoryPendingNode = useRef('');
    const runtimeInventoryAbort = useRef<AbortController | null>(null);
    const conversationRequest = useRef(0);

    const loadRuntime = useCallback(async (nodeId: string) => {
        if (runtimePendingNode.current === nodeId) return;
        runtimeAbort.current?.abort();
        const controller = new AbortController();
        runtimeAbort.current = controller;
        runtimePendingNode.current = nodeId;
        const requestId = ++runtimeRequest.current;
        const current = () => mounted.current
            && requestId === runtimeRequest.current
            && selectedNodeIdRef.current === nodeId;
        try {
            const snapshot = await ComputeClusterService.runtime(nodeId, controller.signal);
            if (!current()) return;
            setRuntimeSnapshot(snapshot);
            setRuntimeError('');
            setRuntimeWarningDismissed(false);

            try {
                const events = await ComputeClusterService.runtimeEvents(nodeId, 0, 50, controller.signal);
                if (!current()) return;
                setRuntimeEventList(events.events);
                setRuntimeEventsError('');
            } catch (reason) {
                if (!current()) return;
                setRuntimeEventsError(reason instanceof Error ? reason.message : String(reason));
            }
        } catch (reason) {
            if (!current()) return;
            setRuntimeError(reason instanceof Error ? reason.message : String(reason));
            setRuntimeEventsError('');
        } finally {
            if (runtimeAbort.current === controller) {
                runtimeAbort.current = null;
                runtimePendingNode.current = '';
            }
        }
    }, []);

    const loadRuntimeInventory = useCallback(async (nodeId: string) => {
        if (runtimeInventoryPendingNode.current === nodeId) return;
        runtimeInventoryAbort.current?.abort();
        const controller = new AbortController();
        runtimeInventoryAbort.current = controller;
        runtimeInventoryPendingNode.current = nodeId;
        const requestId = ++runtimeInventoryRequest.current;
        try {
            const inventory = await ComputeClusterService.runtimeInventory(nodeId, controller.signal);
            if (!mounted.current
                || requestId !== runtimeInventoryRequest.current
                || selectedNodeIdRef.current !== nodeId) return;
            setRuntimeInventory(inventory);
            setRuntimeInventoryError('');
        } catch (reason) {
            if (!mounted.current || controller.signal.aborted || requestId !== runtimeInventoryRequest.current) return;
            setRuntimeInventoryError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            if (runtimeInventoryAbort.current === controller) {
                runtimeInventoryAbort.current = null;
                runtimeInventoryPendingNode.current = '';
            }
        }
    }, []);

    const refresh = useCallback(async (initial = false) => {
        if (refreshInFlight.current) return;
        refreshInFlight.current = true;
        if (mounted.current) initial ? setLoading(true) : setRefreshing(true);
        try {
            const [nextNodes, graphResult] = await Promise.all([
                ComputeClusterService.nodes(),
                ComputeClusterService.resourceGraph().then(
                    value => ({value, error: ''}),
                    reason => ({
                        value: null,
                        error: reason instanceof Error ? reason.message : String(reason),
                    }),
                ),
            ]);
            if (!mounted.current) return;
            setNodes(nextNodes);
            if (graphResult.value) setResourceGraph(graphResult.value);
            setGraphError(graphResult.error);
            setSelectedNodeId(current => overviewSelected.current
                ? ''
                : nextNodes.some(node => node.node_id === current)
                    ? current
                    : nextNodes.find(node => node.online)?.node_id || nextNodes[0]?.node_id || '');
            setQueriedAt(new Date());
            setError('');
        } catch (reason) {
            if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            refreshInFlight.current = false;
            if (mounted.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, []);

    useEffect(() => {
        mounted.current = true;
        void refresh(true);
        const timer = window.setInterval(() => void refresh(), 15000);
        return () => {
            mounted.current = false;
            runtimeAbort.current?.abort();
            runtimeInventoryAbort.current?.abort();
            window.clearInterval(timer);
        };
    }, [refresh]);

    useLayoutEffect(() => {
        setNodeTags(selectedNodeId ? loadNodeTags(selectedNodeId) : []);
        setTagDraft('');
    }, [selectedNodeId]);

    const nodeRegions = useMemo(() => {
        const entities = resourceGraph?.entities || [];
        const regionLabels = new Map<string, string>();
        entities.filter(entity => entity.kind === 'compute_region').forEach(entity => {
            const regionId = entity.region_id || entity.region_name;
            const label = (zh ? entity.region_name : entity.region_id) || entity.region_name || entity.region_id;
            if (regionId && label) regionLabels.set(regionId, regionDisplayName(label, zh));
        });
        return new Map(entities
            .filter(entity => entity.kind === 'compute_node' && entity.node_id)
            .map(entity => {
                const regionId = entity.region_id || entity.region_name || '';
                const label = regionLabels.get(regionId)
                    || (zh ? entity.region_name : entity.region_id)
                    || entity.region_name
                    || entity.region_id
                    || (zh ? '未分配地域' : 'Unassigned');
                return [entity.node_id as string, regionDisplayName(label, zh)] as [string, string];
            }));
    }, [resourceGraph, zh]);
    const organizedNodes = useMemo(() => {
        const visible = nodes.filter(node => nodeVisibility === 'all'
            || (nodeVisibility === 'online' ? node.online : !node.online));
        visible.sort((left, right) => {
            if (nodeOrdering === 'activity') {
                return left.heartbeat_age_seconds - right.heartbeat_age_seconds || left.name.localeCompare(right.name);
            }
            if (nodeOrdering === 'name') return left.name.localeCompare(right.name);
            return Number(right.online) - Number(left.online) || left.name.localeCompare(right.name);
        });
        if (nodeGrouping === 'none') return [['', visible] as [string, ComputeClusterNode[]]];
        const groups = new Map<string, ComputeClusterNode[]>();
        visible.forEach(node => {
            const kind = machineIconKind(node);
            const group = nodeGrouping === 'region'
                ? nodeRegions.get(node.node_id) || (zh ? '未分配地域' : 'Unassigned')
                : kind === 'windows' ? 'Windows'
                    : kind === 'macos' ? 'macOS'
                        : kind === 'linux' || kind === 'jetson' ? 'Linux'
                            : (zh ? '其他系统' : 'Other');
            groups.set(group, [...(groups.get(group) || []), node]);
        });
        return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
    }, [nodeGrouping, nodeOrdering, nodeRegions, nodes, nodeVisibility, zh]);
    const selectedNode = nodes.find(node => node.node_id === selectedNodeId) || null;
    const runtimeCapable = Boolean(
        selectedNode?.online && selectedNode.capabilities.includes('runtime.read.v1'),
    );
    const runtimeInventoryCapable = Boolean(
        selectedNode?.online && selectedNode.capabilities.includes('runtime.inventory.v1'),
    );
    const currentGroup = resourceGraph?.entities.find(entity => entity.kind === 'compute_group') || null;
    const currentGroupTone: Tone = currentGroup?.state === 'available'
        ? 'healthy'
        : currentGroup?.state === 'degraded'
            ? 'warning'
            : currentGroup ? 'offline' : 'unknown';
    const onlineCount = nodes.filter(node => node.online).length;
    const terminalAvailable = Boolean(selectedNode?.online && selectedNode.network.ssh_available);
    const lastRuntimeCheck = runtimeSnapshot?.services.reduce(
        (latest, service) => Math.max(latest, service.health.checked_at),
        0,
    ) || 0;
    const runtimeAlerts = runtimeEventList
        .filter(event => event.level !== 'info'
            && event.created_at >= (runtimeSnapshot?.captured_at || 0) - RUNTIME_ALERT_WINDOW_SECONDS)
        .slice(-3);
    const runtimeAlertKey = `${selectedNodeId}:${runtimeAlerts[runtimeAlerts.length - 1]?.cursor || ''}`;

    useEffect(() => {
        const nodeChanged = selectedNodeIdRef.current !== selectedNodeId;
        selectedNodeIdRef.current = selectedNodeId;
        if (nodeChanged || !runtimeCapable) {
            runtimeAbort.current?.abort();
            runtimeAbort.current = null;
            runtimePendingNode.current = '';
            runtimeRequest.current += 1;
            setRuntimeSnapshot(null);
            setRuntimeEventList([]);
            setRuntimeError('');
            setRuntimeWarningDismissed(false);
            setRuntimeEventsError('');
            setInspectedServiceId('');
            setMonitorView('performance');
        }
        if (nodeChanged || !runtimeInventoryCapable) {
            runtimeInventoryAbort.current?.abort();
            runtimeInventoryAbort.current = null;
            runtimeInventoryPendingNode.current = '';
            runtimeInventoryRequest.current += 1;
            setRuntimeInventory(null);
            setRuntimeInventoryError('');
        }
        if (runtimeCapable) {
            void loadRuntime(selectedNodeId);
        }
        if (runtimeInventoryCapable) {
            void loadRuntimeInventory(selectedNodeId);
        }
    }, [loadRuntime, loadRuntimeInventory, selectedNode, selectedNodeId]);

    useEffect(() => {
        if (!selectedNode) return;
        const sample = resourceSample(selectedNode);
        setResourceHistory(current => {
            const latest = current[current.length - 1];
            if (latest?.nodeId === sample.nodeId && latest.capturedAt === sample.capturedAt) return current;
            return latest?.nodeId === sample.nodeId ? [...current, sample].slice(-60) : [sample];
        });
    }, [selectedNode]);

    useEffect(() => {
        if (!inspectedServiceId || !selectedNodeId) return undefined;
        const timer = window.setInterval(() => {
            if (runtimeCapable) void loadRuntime(selectedNodeId);
            if (runtimeInventoryCapable) void loadRuntimeInventory(selectedNodeId);
            void refresh();
        }, 5000);
        const close = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setInspectedServiceId('');
        };
        document.addEventListener('keydown', close);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener('keydown', close);
        };
    }, [
        inspectedServiceId,
        loadRuntime,
        loadRuntimeInventory,
        refresh,
        runtimeCapable,
        runtimeInventoryCapable,
        selectedNodeId,
    ]);

    useEffect(() => {
        if (!inspectedServiceId || (monitorView !== 'tasks' && monitorView !== 'conversations')) return undefined;
        let active = true;
        const loadTasks = async (showLoading = false) => {
            if (showLoading) setTaskHistoryLoading(true);
            try {
                const response = await ComputeClusterService.tasks();
                if (!active || !mounted.current) return;
                setTaskHistory(response.tasks.slice(0, 50));
                setTaskHistoryError('');
            } catch (reason) {
                if (active && mounted.current) setTaskHistoryError(reason instanceof Error ? reason.message : String(reason));
            } finally {
                if (showLoading && active && mounted.current) setTaskHistoryLoading(false);
            }
        };
        const loadConversations = async () => {
            setConversationHistoryLoading(true);
            try {
                const conversations = await AgentChatService.conversations();
                if (!active || !mounted.current) return;
                setConversationHistory(conversations);
                const id = conversations[0]?.id || '';
                setSelectedConversationId(id);
                setConversationMessages([]);
                if (id) {
                    const requestId = ++conversationRequest.current;
                    const detail = await AgentChatService.conversation(id);
                    if (!active || !mounted.current || requestId !== conversationRequest.current) return;
                    setConversationMessages(detail.messages);
                }
                setConversationHistoryError('');
            } catch (reason) {
                if (active && mounted.current) setConversationHistoryError(reason instanceof Error ? reason.message : String(reason));
            } finally {
                if (active && mounted.current) setConversationHistoryLoading(false);
            }
        };
        if (monitorView === 'conversations') {
            void loadConversations();
            return () => {
                active = false;
                conversationRequest.current += 1;
            };
        }
        void loadTasks(true);
        const timer = window.setInterval(() => void loadTasks(), 2000);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, [inspectedServiceId, monitorView]);

    const normalizedProcessQuery = processQuery.trim().toLocaleLowerCase();
    const sortedProcesses = useMemo(() => (runtimeInventory?.processes || []).filter(process => {
        if (!normalizedProcessQuery) return true;
        return [process.name, String(process.pid), processStateLabel(process.state, zh)]
            .some(value => value.toLocaleLowerCase().includes(normalizedProcessQuery));
    }).sort((left, right) => {
        if (processSort.key === 'cpu' && (left.cpu_percent === null || right.cpu_percent === null)) {
            if (left.cpu_percent === right.cpu_percent) return left.pid - right.pid;
            return left.cpu_percent === null ? 1 : -1;
        }
        const comparison = processSort.key === 'name'
            ? left.name.localeCompare(right.name)
            : processSort.key === 'pid'
                ? left.pid - right.pid
                : processSort.key === 'cpu'
                    ? (left.cpu_percent || 0) - (right.cpu_percent || 0)
                    : processSort.key === 'memory'
                        ? left.memory_bytes - right.memory_bytes
                        : left.state.localeCompare(right.state);
        return (processSort.direction === 'asc' ? comparison : -comparison) || left.pid - right.pid;
    }), [normalizedProcessQuery, processSort, runtimeInventory, zh]);

    const sortProcesses = (key: ProcessSortKey) => {
        setProcessSort(current => current.key === key
            ? {key, direction: current.direction === 'asc' ? 'desc' : 'asc'}
            : {key, direction: key === 'name' ? 'asc' : 'desc'});
    };

    const sortedStartupServices = useMemo(() => [...(runtimeInventory?.startup_services || [])].sort((left, right) => {
        const comparison = startupSort.key === 'name'
            ? left.display_name.localeCompare(right.display_name)
            : startupSort.key === 'identifier'
                ? left.name.localeCompare(right.name)
                : startupSort.key === 'state'
                    ? left.state.localeCompare(right.state)
                    : left.start_type.localeCompare(right.start_type);
        return (startupSort.direction === 'asc' ? comparison : -comparison) || left.name.localeCompare(right.name);
    }), [runtimeInventory, startupSort]);

    const sortStartupServices = (key: StartupSortKey) => {
        setStartupSort(current => current.key === key
            ? {key, direction: current.direction === 'asc' ? 'desc' : 'asc'}
            : {key, direction: 'asc'});
    };

    const sortedTaskHistory = useMemo(() => [...taskHistory].sort((left, right) => {
        const comparison = taskSort.key === 'updated'
            ? left.updated_at - right.updated_at
            : taskSort.key === 'task'
                ? left.task_type.localeCompare(right.task_type)
                : taskSort.key === 'device'
                    ? left.node_name.localeCompare(right.node_name)
                    : left.state.localeCompare(right.state);
        return (taskSort.direction === 'asc' ? comparison : -comparison)
            || right.updated_at - left.updated_at;
    }), [taskHistory, taskSort]);

    const sortTasks = (key: TaskSortKey) => {
        setTaskSort(current => current.key === key
            ? {key, direction: current.direction === 'asc' ? 'desc' : 'asc'}
            : {key, direction: key === 'updated' ? 'desc' : 'asc'});
    };

    const selectConversation = async (conversationId: string) => {
        const requestId = ++conversationRequest.current;
        setSelectedConversationId(conversationId);
        setConversationMessages([]);
        try {
            const detail = await AgentChatService.conversation(conversationId);
            if (mounted.current && requestId === conversationRequest.current) {
                setConversationMessages(detail.messages);
                setConversationHistoryError('');
            }
        } catch (reason) {
            if (mounted.current && requestId === conversationRequest.current) {
                setConversationHistoryError(reason instanceof Error ? reason.message : String(reason));
            }
        }
    };

    const toggleSidePanel = (panel: SidePanel) => {
        setSidePanel(current => current === panel ? null : panel);
    };

    const addNodeTag = (nodeId: string) => {
        const tag = tagDraft.trim();
        if (!tag || tag.length > NODE_TAG_MAX_LENGTH || nodeTags.includes(tag) || nodeTags.length >= NODE_TAG_LIMIT) return;
        const next = [...nodeTags, tag];
        setNodeTags(next);
        saveNodeTags(nodeId, next);
        setTagDraft('');
    };

    const removeNodeTag = (nodeId: string, tag: string) => {
        const next = nodeTags.filter(item => item !== tag);
        setNodeTags(next);
        saveNodeTags(nodeId, next);
    };

    const openCamera = async (node: ComputeClusterNode, camera: ComputeManagedDevice) => {
        if (!node.online || openingCameraId) return;
        setOpeningCameraId(camera.device_id);
        setCameraError('');
        try {
            await CameraResourceService.openCluster(node.node_id, node.name, camera, imagesData);
            onCameraOpened?.();
        } catch (reason) {
            setCameraError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            if (mounted.current) setOpeningCameraId('');
        }
    };

    // eslint-disable-next-line complexity
    const renderMachineList = () => <aside className='ControlMachinePanel' aria-label={zh ? '机器列表' : 'Machine list'}>
        <div className='ControlMachineOrganizer' aria-label={zh ? '节点整理' : 'Organize nodes'}>
            <select
                aria-label={zh ? '节点分组' : 'Node grouping'}
                value={nodeGrouping}
                onChange={event => setNodeGrouping(event.target.value as NodeGrouping)}
            >
                <option value='none'>{zh ? '不分组' : 'No groups'}</option>
                <option value='region'>{zh ? '按地域' : 'By region'}</option>
                <option value='platform'>{zh ? '按系统' : 'By system'}</option>
            </select>
            <select
                aria-label={zh ? '节点排序' : 'Node ordering'}
                value={nodeOrdering}
                onChange={event => setNodeOrdering(event.target.value as NodeOrdering)}
            >
                <option value='status'>{zh ? '在线优先' : 'Online first'}</option>
                <option value='activity'>{zh ? '最近活跃' : 'Recent first'}</option>
                <option value='name'>{zh ? '按名称' : 'By name'}</option>
            </select>
            <select
                aria-label={zh ? '节点状态' : 'Node status'}
                value={nodeVisibility}
                onChange={event => setNodeVisibility(event.target.value as NodeVisibility)}
            >
                <option value='all'>{zh ? '所有状态' : 'All states'}</option>
                <option value='online'>{zh ? '仅在线' : 'Online only'}</option>
                <option value='offline'>{zh ? '仅离线' : 'Offline only'}</option>
            </select>
        </div>
        <div className='ControlMachineList'>
            <button
                type='button'
                className={`ControlMachineItem overview ${!selectedNodeId ? 'selected' : ''}`}
                aria-pressed={!selectedNodeId}
                onClick={() => {
                    overviewSelected.current = true;
                    setSelectedNodeId('');
                    setWorkspace('node');
                }}
            >
                <span className='ControlMachineIdentity'>
                    <strong>{zh ? '总览' : 'Overview'}</strong>
                    <small>{zh ? '地图 / 图谱' : 'Map / graph'}</small>
                </span>
                <span className={`ControlMachineState ${onlineCount ? 'healthy' : 'offline'}`}>
                    {onlineCount} / {nodes.length}
                </span>
            </button>
            {organizedNodes.map(([group, groupNodes]) => <React.Fragment key={group || 'all'}>
                {group && <div className='ControlMachineGroupHeading'>
                    <strong>{group}</strong>
                    <span>{groupNodes.length}</span>
                </div>}
                {groupNodes.map(node => <button
                    type='button'
                    key={node.node_id}
                    className={`ControlMachineItem ${node.node_id === selectedNodeId ? 'selected' : ''}`}
                    aria-pressed={node.node_id === selectedNodeId}
                    onClick={() => {
                        overviewSelected.current = false;
                        setSelectedNodeId(node.node_id);
                        setWorkspace('node');
                    }}
                >
                    <MachinePlatformIcon node={node}/>
                    <span className='ControlMachineIdentity'>
                        <strong>{node.name}</strong>
                        <small>{zh ? '活跃于 ' : 'Active '}{lastSeen(node.heartbeat_age_seconds, zh)}</small>
                    </span>
                    <span className={`ControlMachineState ${node.online ? 'healthy' : 'offline'}`}>
                        {node.online ? (zh ? '在线' : 'Online') : (zh ? '离线' : 'Offline')}
                    </span>
                </button>)}
            </React.Fragment>)}
            {!loading && organizedNodes.every(([, groupNodes]) => groupNodes.length === 0) && <p className='ControlMachineEmpty'>
                {nodes.length === 0
                    ? (zh ? '计算群中暂无机器' : 'No machines in the compute cluster')
                    : (zh ? '没有符合条件的机器' : 'No machines match the filter')}
            </p>}
        </div>
    </aside>;

    // eslint-disable-next-line complexity
    const renderFeatureList = () => <aside className='ControlMachinePanel' aria-label={zh ? '相关功能列表' : 'Related features'}>
        <div className='ControlMachineList'>
            <button
                type='button'
                className={`ControlMachineItem ${workspace === 'groups' ? 'selected' : ''}`}
                aria-pressed={workspace === 'groups'}
                onClick={() => setWorkspace('groups')}
            >
                <span className='ControlMachineIcon network' aria-hidden='true'>{zh ? '群' : 'GRP'}</span>
                <span className='ControlMachineIdentity'>
                    <strong>{zh ? '群查询' : 'Groups'}</strong>
                    <small>{zh ? '查看本机所在计算群' : 'View this installation’s groups'}</small>
                </span>
                <span className={`ControlMachineState ${currentGroup ? 'healthy' : 'offline'}`}>
                    {currentGroup ? (zh ? '1 个群' : '1 group') : (zh ? '不可用' : 'Unavailable')}
                </span>
            </button>
            <button
                type='button'
                className={`ControlMachineItem ${workspace === 'network' ? 'selected' : ''}`}
                aria-pressed={workspace === 'network'}
                onClick={() => setWorkspace('network')}
            >
                <span className='ControlMachineIcon network' aria-hidden='true'>LAN</span>
                <span className='ControlMachineIdentity'>
                    <strong>{zh ? '网络资产' : 'Network assets'}</strong>
                    <small>{zh ? '资产台账 · 扫描计划' : 'Inventory · scan schedules'}</small>
                </span>
                <span className={`ControlMachineState ${error ? 'offline' : 'healthy'}`}>
                    {error ? (zh ? '不可用' : 'Unavailable') : (zh ? '可查看' : 'Ready')}
                </span>
            </button>
            <button
                type='button'
                className={`ControlMachineItem ${workspace === 'terminal' ? 'selected' : ''}`}
                aria-pressed={workspace === 'terminal'}
                onClick={() => setWorkspace('terminal')}
            >
                <span className='ControlMachineIcon terminal' aria-hidden='true'>&gt;_</span>
                <span className='ControlMachineIdentity'>
                    <strong>{zh ? '终端连接' : 'Terminal connection'}</strong>
                    <small>{zh ? '受控 SSH · 输入指令' : 'Controlled SSH · command input'}</small>
                </span>
                <span className={`ControlMachineState ${terminalAvailable ? 'healthy' : 'offline'}`}>
                    {terminalAvailable ? (zh ? '可连接' : 'Ready') : (zh ? '不可用' : 'Unavailable')}
                </span>
            </button>
        </div>
    </aside>;

    const renderServiceCard = (
        name: string,
        value: string,
        detail: string,
        tone: Tone,
        onClick?: () => void,
    ) => {
        const content = <>
            <span className={`ControlStatusDot ${tone}`} aria-hidden='true'/>
            <div>
                <span>{name}</span>
                <strong>{value}</strong>
                <small>{detail}</small>
            </div>
        </>;
        return onClick
            ? <button
                type='button'
                className='ControlServiceCard'
                aria-label={zh
                    ? `${name}：${value}；打开当前节点终端连接`
                    : `${name}: ${value}; open terminal for current node`}
                disabled={!terminalAvailable}
                onClick={onClick}
            >{content}</button>
            : <article className='ControlServiceCard'>{content}</article>;
    };

    // eslint-disable-next-line complexity
    const renderResourceMonitorCard = () => {
        const runtimeUnhealthy = Boolean(runtimeSnapshot
            && (runtimeSnapshot.summary.degraded > 0 || runtimeSnapshot.summary.unavailable > 0));
        const monitorTone = runtimeSnapshot
            ? runtimeUnhealthy ? 'warning' : 'healthy'
            : selectedNode?.online ? 'healthy' : 'offline';
        const monitorStatus = runtimeSnapshot
            ? runtimeUnhealthy
                ? (zh ? '部分异常' : 'Partially unavailable')
                : (zh ? '实时状态' : 'Live status')
            : selectedNode?.online
                ? (zh ? '心跳正常' : 'Heartbeat current')
                : (zh ? '心跳中断' : 'Heartbeat lost');
        return <button
            type='button'
            className='ControlServiceCard ControlRuntimeService'
            aria-label={zh ? '打开资源监视器' : 'Open resource monitor'}
            onClick={() => setInspectedServiceId(runtimeSnapshot?.services[0]?.service_id || 'node-runtime')}
        >
            <span className={`ControlStatusDot ${monitorTone}`} aria-hidden='true'/>
            <span className='ControlRuntimeIdentity'>
                <span>{monitorStatus}</span>
                <strong>{zh ? '资源监视器' : 'Resource monitor'}</strong>
                <small>{runtimeSnapshot
                    ? zh ? 'CPU · 内存 · GPU · 磁盘' : 'CPU · Memory · GPU · Disk'
                    : selectedNode?.online
                        ? zh ? '计算群资源心跳有效' : 'Compute-cluster resource heartbeat is current'
                        : zh ? '计算群资源心跳已中断' : 'Compute-cluster resource heartbeat is stale'}</small>
            </span>
            <span className='ControlServiceOpen' aria-hidden='true'>›</span>
        </button>;
    };

    // eslint-disable-next-line complexity
    const renderNode = (node: ComputeClusterNode) => {
        // Dependency health belongs to the latest node snapshot. Once that
        // snapshot expires, an old green state is no longer current evidence.
        const tailscaleState = node.online ? dependency(node, 'tailscale') : 'unknown';
        const controlState = node.online ? dependency(node, 'control_ssh') : 'unknown';
        const lanState = !node.online || !node.control_transport
            ? 'unknown'
            : node.control_transport === 'lan' ? controlState : 'unavailable';
        const cameras = node.device_inventory.devices.filter(device => device.kind === 'camera');
        const hardwareModel = node.resources.hardware_model?.trim();
        return <>
            <header className='ControlNodeHeader'>
                <div>
                    <h1>{node.name}</h1>
                    <p>{zh ? '最后检查' : 'Last check'} {runtimeTime(lastRuntimeCheck, zh)} · {zh ? '最近心跳' : 'Last heartbeat'} {lastSeen(node.heartbeat_age_seconds, zh)}</p>
                    <div className='ControlNodeTags' aria-label={zh ? '节点标签' : 'Node tags'}>
                        {nodeTags.map(tag => <span className='ControlNodeTag' key={tag}>
                            {tag}
                            <button
                                type='button'
                                aria-label={zh ? `删除标签 ${tag}` : `Remove tag ${tag}`}
                                title={zh ? '删除标签' : 'Remove tag'}
                                onClick={() => removeNodeTag(node.node_id, tag)}
                            >×</button>
                        </span>)}
                        {nodeTags.length < NODE_TAG_LIMIT && <form
                            className='ControlNodeTagForm'
                            onSubmit={event => {
                                event.preventDefault();
                                addNodeTag(node.node_id);
                            }}
                        >
                            <input
                                value={tagDraft}
                                maxLength={NODE_TAG_MAX_LENGTH}
                                aria-label={zh ? '新标签' : 'New tag'}
                                placeholder={zh ? '新增标签' : 'Add tag'}
                                onChange={event => setTagDraft(event.target.value)}
                            />
                            <button
                                type='submit'
                                disabled={!tagDraft.trim() || nodeTags.includes(tagDraft.trim())}
                                aria-label={zh ? '添加标签' : 'Add tag'}
                                title={zh ? '添加标签' : 'Add tag'}
                            >+</button>
                        </form>}
                    </div>
                </div>
            </header>

            <section className='ControlSection ControlSectionFirst'>
                <div className='ControlSectionHeading'>
                    <div>
                        <h2>{zh ? '基础信息' : 'Basic information'}</h2>
                    </div>
                </div>
                <div className='ControlSubsectionHeading ControlSubsectionHeadingFirst'>
                    <strong>{zh ? '设备信息' : 'Device information'}</strong>
                </div>
                <div className='ControlResourceStrip ControlDeviceStrip' aria-label={zh ? '设备信息' : 'Device information'}>
                    <div><span>{zh ? '设备型号' : 'Device model'}</span><strong title={hardwareModel}>{hardwareModel || (zh ? '未上报' : 'Not reported')}</strong><small>{hardwareModel ? (zh ? '节点上报' : 'reported by node') : (zh ? '等待节点上报' : 'waiting for node report')}</small></div>
                    <div><span>{zh ? '操作系统' : 'Operating system'}</span><strong>{node.resources.platform || '—'}</strong><small>{zh ? '设备系统' : 'device platform'}</small></div>
                    <div><span>{zh ? '处理器架构' : 'Processor architecture'}</span><strong>{node.resources.architecture || '—'}</strong><small>{zh ? '节点架构' : 'node architecture'}</small></div>
                    <div><span>{zh ? '节点程序版本' : 'Agent version'}</span><strong>{node.agent_version || '—'}</strong><small>{zh ? '计算群节点程序' : 'compute-cluster node software'}</small></div>
                </div>
                <div className='ControlSubsectionHeading'>
                    <strong>{zh ? '计算资源' : 'Compute resources'}</strong>
                </div>
                <div className='ControlResourceStrip' aria-label={zh ? '计算资源' : 'Compute resources'}>
                    <div><span>{zh ? '处理器' : 'CPU'}</span><strong>{node.resources.cpu_logical || '—'}</strong><small>{zh ? '逻辑核心' : 'logical cores'}</small></div>
                    <div><span>{zh ? '内存' : 'Memory'}</span><strong>{percentUsed(node.resources.memory_total_bytes, node.resources.memory_available_bytes)}</strong><small>{bytes(node.resources.memory_total_bytes, zh)}</small></div>
                    <div><span>{zh ? '图形处理器' : 'GPU'}</span><strong>{node.resources.gpus.length}</strong><small>{node.resources.gpus[0]?.name || (zh ? '未上报' : 'Not reported')}</small></div>
                    <div><span>{zh ? '可用磁盘' : 'Available disk'}</span><strong>{bytes(node.resources.disk_free_bytes, zh)}</strong><small>{zh ? `共 ${bytes(node.resources.disk_total_bytes, zh)}` : `${bytes(node.resources.disk_total_bytes, zh)} total`}</small></div>
                </div>
            </section>

            <section className='ControlSection'>
                <div className='ControlSectionHeading'>
                    <div>
                        <h2>{zh ? '网络情况' : 'Network status'}</h2>
                    </div>
                </div>
                <div className='ControlServiceGrid'>
                    {renderServiceCard(
                        dependencyLabel(lanState, zh),
                        zh ? 'SSH 局域网' : 'LAN SSH',
                        zh ? '仅当前 Client 通过局域网 SSH 连接时显示正常' : 'Healthy only while the Client uses a LAN SSH connection',
                        dependencyTone(lanState),
                        () => setWorkspace('terminal'),
                    )}
                    {renderServiceCard(
                        dependencyLabel(tailscaleState, zh),
                        zh ? 'Tailscale 远程' : 'Remote Tailscale',
                        zh ? '由节点 Tailscale 连接状态上报' : 'Reported by the node Tailscale connection status',
                        dependencyTone(tailscaleState),
                        () => setWorkspace('terminal'),
                    )}
                </div>
            </section>

            <section className='ControlSection'>
                <div className='ControlSectionHeading'>
                    <div>
                        <h2>{zh ? '运行服务' : 'Running services'}</h2>
                    </div>
                    {runtimeSnapshot && <span>{runtimeSnapshot.summary.healthy} / {runtimeSnapshot.summary.total}</span>}
                </div>
                {runtimeSnapshot
                    ? <div className='ControlRuntimeServiceGrid'>
                        {renderResourceMonitorCard()}
                    </div>
                    : <div className='ControlServiceGrid'>{renderResourceMonitorCard()}</div>}
            </section>

            <section className='ControlSection'>
                <div className='ControlSectionHeading'>
                    <div>
                        <h2>{zh ? '相关设备' : 'Related devices'}</h2>
                    </div>
                </div>
                <div className='ControlSubsectionHeading'>
                    <strong>{zh ? '摄像头' : 'Cameras'}</strong>
                    <span>{cameras.length}</span>
                </div>
                <div className='ControlCameraGrid'>
                    {cameras.map(camera => <button
                        type='button'
                        className='ControlCameraCard'
                        key={camera.device_id}
                        disabled={!node.online || Boolean(openingCameraId)}
                        aria-label={zh ? `打开${camera.name}实时画面` : `Open live view for ${camera.name}`}
                        onClick={() => void openCamera(node, camera)}
                    >
                        <div className='ControlCameraIcon' aria-hidden='true'>◉</div>
                        <div className='ControlCameraIdentity'>
                            <strong>{camera.name}</strong>
                            <small>{camera.model || camera.device_id}</small>
                            <span className={cameraTone(camera.status)}><i/> {openingCameraId === camera.device_id ? (zh ? '正在打开…' : 'Opening…') : cameraLabel(camera.status, zh)}</span>
                        </div>
                        <div className='ControlCameraChannels'>
                            <strong>{camera.channels}</strong>
                            <small>{zh ? '通道' : camera.channels === 1 ? 'channel' : 'channels'}</small>
                        </div>
                    </button>)}
                    {cameras.length === 0 && <div className='ControlEmptyBlock'>
                        {node.device_inventory.state === 'ready'
                            ? (zh ? '该机器没有上报已登记摄像头' : 'This machine reported no registered cameras')
                            : node.device_inventory.state === 'disabled'
                                ? (zh ? '摄像头注册功能未启用' : 'Camera registry is disabled')
                                : (zh ? '无法读取摄像头注册信息' : 'Camera registry is unavailable')}
                    </div>}
                </div>
                {cameraError && <div className='ControlCameraError' role='status'>{cameraError}</div>}
            </section>
        </>;
    };

    const managedServices = runtimeSnapshot?.services.filter(service => service.kind === 'service') || [];
    const taskExecutor = runtimeSnapshot?.services.find(service => service.service_id === 'task-executor') || null;
    const inspectedService = managedServices.find(
        service => service.service_id === inspectedServiceId,
    ) || managedServices[0] || null;
    const inspectedEvents = runtimeEventList.filter(
        event => event.service_id === inspectedService?.service_id
            || (inspectedService?.service_id === 'node-agent' && event.service_id === 'task-executor'),
    ).slice(-20).reverse();
    const memoryUsed = selectedNode?.resources.memory_total_bytes && selectedNode.resources.memory_available_bytes !== null
        ? selectedNode.resources.memory_total_bytes - selectedNode.resources.memory_available_bytes
        : null;
    const diskUsedPercent = selectedNode
        ? usedPercent(selectedNode.resources.disk_total_bytes, selectedNode.resources.disk_free_bytes)
        : null;
    const memoryUsedPercent = selectedNode
        ? usedPercent(selectedNode.resources.memory_total_bytes, selectedNode.resources.memory_available_bytes)
        : null;
    const cpuUsage = selectedNode ? cpuUsedPercent(selectedNode) : null;
    const gpuUsage = selectedNode ? gpuUsedPercent(selectedNode) : null;
    const gpuMemoryUsedMb = selectedNode?.resources.gpus.reduce((sum, gpu) => sum + gpu.memory_used_mb, 0) || 0;
    const gpuMemoryTotalMb = selectedNode?.resources.gpus.reduce((sum, gpu) => sum + gpu.memory_total_mb, 0) || 0;
    const gpuTemperature = Math.max(
        ...((selectedNode?.resources.gpus || []).map(gpu => gpu.temperature_celsius)
            .filter((value): value is number => Number.isFinite(value))),
        Number.NEGATIVE_INFINITY,
    );
    const controlNetworkState = selectedNode?.online ? dependency(selectedNode, 'control_ssh') : 'unknown';
    const remoteNetworkState = selectedNode?.online ? dependency(selectedNode, 'tailscale') : 'unknown';
    const networkValue = controlNetworkState === 'healthy' && remoteNetworkState === 'healthy'
        ? (zh ? '正常' : 'Healthy')
        : controlNetworkState === 'unavailable' && remoteNetworkState === 'unavailable'
            ? (zh ? '不可用' : 'Unavailable')
            : (zh ? '降级' : 'Degraded');
    const selectedResourceHistory = resourceHistory.filter(sample => sample.nodeId === selectedNode?.node_id);
    const resourceMetrics: {
        id: ResourceMetricId;
        label: string;
        value: string;
        detail: string;
        values: (number | null)[];
        secondaryValues?: (number | null)[];
        color: string;
        secondaryColor?: string;
        autoScale?: boolean;
        emptyLabel: string;
        trendLabel: string;
        scaleLabel?: string;
    }[] = [{
        id: 'cpu',
        label: zh ? '中央处理器' : 'CPU',
        value: cpuUsage === null ? '—' : `${cpuUsage}%`,
        detail: `${selectedNode?.resources.cpu_logical || '—'} ${zh ? '逻辑核心' : 'logical cores'}${cpuUsage === null
            ? (zh ? ' · 利用率未上报' : ' · usage not reported')
            : selectedNode?.resources.cpu_percent === undefined && selectedNode?.resources.load_average_1m !== null
                ? (zh ? ' · 由 1 分钟负载估算' : ' · estimated from 1-minute load')
                : ''}`,
        values: selectedResourceHistory.map(sample => sample.cpu),
        color: '#55b7ff',
        emptyLabel: zh ? '等待利用率数据' : 'Waiting for usage data',
        trendLabel: zh ? 'CPU 使用率趋势' : 'CPU usage trend',
    }, {
        id: 'memory',
        label: zh ? '内存' : 'Memory',
        value: memoryUsedPercent === null ? '—' : `${memoryUsedPercent}%`,
        detail: memoryUsed === null
            ? (zh ? '未上报' : 'Not reported')
            : `${bytes(memoryUsed, zh)} / ${bytes(selectedNode?.resources.memory_total_bytes ?? null, zh)}`,
        values: selectedResourceHistory.map(sample => sample.memory),
        color: '#5dd6a5',
        emptyLabel: zh ? '等待内存数据' : 'Waiting for memory data',
        trendLabel: zh ? '内存使用率趋势' : 'Memory usage trend',
    }, {
        id: 'gpu',
        label: zh ? '图形处理器' : 'GPU',
        value: gpuUsage === null ? '—' : `${gpuUsage}%`,
        detail: selectedNode?.resources.gpus.length
            ? (zh
                ? `${selectedNode.resources.gpus.length} GPU · 显存 ${bytes(gpuMemoryUsedMb * 1024 ** 2, true)} / ${bytes(gpuMemoryTotalMb * 1024 ** 2, true)} · 最高温度 ${Number.isFinite(gpuTemperature) ? `${gpuTemperature}°C` : '未上报'}`
                : `${selectedNode.resources.gpus.length} GPU · Memory ${bytes(gpuMemoryUsedMb * 1024 ** 2, false)} / ${bytes(gpuMemoryTotalMb * 1024 ** 2, false)} · Hottest ${Number.isFinite(gpuTemperature) ? `${gpuTemperature}°C` : 'not reported'}`)
            : (zh ? '未检测到 GPU' : 'No GPU detected'),
        values: selectedResourceHistory.map(sample => sample.gpu),
        color: '#ad83ff',
        emptyLabel: zh ? '等待 GPU 数据' : 'Waiting for GPU data',
        trendLabel: zh ? 'GPU 使用率趋势' : 'GPU usage trend',
    }, {
        id: 'disk',
        label: zh ? '磁盘' : 'Disk',
        value: diskUsedPercent === null ? '—' : `${diskUsedPercent}%`,
        detail: zh
            ? `读取 ${bytesPerSecond(selectedNode?.resources.disk_read_bytes_per_second ?? null, true)} · 写入 ${bytesPerSecond(selectedNode?.resources.disk_write_bytes_per_second ?? null, true)} · ${bytes(selectedNode?.resources.disk_free_bytes ?? null, true)} 可用`
            : `Read ${bytesPerSecond(selectedNode?.resources.disk_read_bytes_per_second ?? null, false)} · Write ${bytesPerSecond(selectedNode?.resources.disk_write_bytes_per_second ?? null, false)} · ${bytes(selectedNode?.resources.disk_free_bytes ?? null, false)} free`,
        values: selectedResourceHistory.map(sample => sample.diskRead),
        secondaryValues: selectedResourceHistory.map(sample => sample.diskWrite),
        color: '#55b7ff',
        secondaryColor: '#f0b965',
        autoScale: true,
        emptyLabel: zh ? '磁盘读写速率未上报' : 'Disk I/O rates are not reported',
        trendLabel: zh ? '磁盘读写趋势' : 'Disk read and write trend',
        scaleLabel: zh ? '蓝色读取 · 橙色写入' : 'Blue read · orange write',
    }, {
        id: 'network',
        label: zh ? '网络' : 'Network',
        value: networkValue,
        detail: zh
            ? `下载 ${bytesPerSecond(selectedNode?.resources.network_receive_bytes_per_second ?? null, true)} · 上传 ${bytesPerSecond(selectedNode?.resources.network_send_bytes_per_second ?? null, true)} · SSH ${dependencyLabel(controlNetworkState, true)} · Tailscale ${dependencyLabel(remoteNetworkState, true)}`
            : `Receive ${bytesPerSecond(selectedNode?.resources.network_receive_bytes_per_second ?? null, false)} · Send ${bytesPerSecond(selectedNode?.resources.network_send_bytes_per_second ?? null, false)} · SSH ${dependencyLabel(controlNetworkState, false)} · Tailscale ${dependencyLabel(remoteNetworkState, false)}`,
        values: selectedResourceHistory.map(sample => sample.networkReceive),
        secondaryValues: selectedResourceHistory.map(sample => sample.networkSend),
        color: '#55b7ff',
        secondaryColor: '#e76f8b',
        autoScale: true,
        emptyLabel: zh ? '实时网络吞吐未上报' : 'Live network throughput is not reported',
        trendLabel: zh ? '网络吞吐趋势' : 'Network throughput trend',
        scaleLabel: zh ? '蓝色下载 · 红色上传' : 'Blue receive · red send',
    }];
    const activeMetric = resourceMetrics.find(metric => metric.id === activeMetricId) || resourceMetrics[0];
    const inspectedProcessState = inspectedService?.process?.state === 'running'
        ? (zh ? '运行中' : 'Running')
        : inspectedService?.process?.state === 'stopped'
            ? (zh ? '已停止' : 'Stopped')
            : (zh ? '未知' : 'Unknown');

    return <div className='EditorContainer ControlCenterView'>
        <SideNavigationBar
            direction={Direction.LEFT}
            isOpen={sidePanel !== null}
            renderCompanion={() => <>
                <VerticalEditorButton
                    label={zh ? '机器' : 'Machines'}
                    image='/ico/api.png'
                    imageAlt={zh ? '机器列表' : 'machines'}
                    onClick={() => toggleSidePanel('machines')}
                    isActive={sidePanel === 'machines'}
                    style={{top: '81px'}}
                />
                <VerticalEditorButton
                    label={zh ? '相关功能' : 'Features'}
                    image='/ico/tasks.png'
                    imageAlt={zh ? '相关功能列表' : 'related features'}
                    onClick={() => toggleSidePanel('features')}
                    isActive={sidePanel === 'features'}
                    style={{top: '167px'}}
                />
                <div className='VersionWatermark'>v2.8.2</div>
                <button
                    type='button'
                    className='AgentChatButtonBottom'
                    aria-label={zh ? '在侧边栏询问 Agent' : 'Ask Agent in side chat'}
                    title={zh ? '在侧边栏询问 Agent' : 'Ask Agent in side chat'}
                    onClick={() => window.dispatchEvent(new Event('opensight:toggle-agent-chat'))}
                >
                    <img
                        draggable={false}
                        alt=''
                        src='/ico/robot.png'
                        style={{
                            width: 14,
                            height: 14,
                            filter: 'brightness(0) invert(48%) sepia(98%) saturate(1500%) hue-rotate(192deg) brightness(1.05)',
                        }}
                    />
                </button>
            </>}
            renderContent={sidePanel === 'features' ? renderFeatureList : renderMachineList}
        />
        <main className='EditorWrapper ControlCenterWorkspace'>
            <div className='EditorTopNavigationBar ControlTopNavigationBar'>
                <div className='ControlToolbarGroup'>
                    <span className={`ControlStatusDot ${workspace === 'groups'
                        ? currentGroupTone
                        : workspace === 'network'
                        ? (error ? 'offline' : 'healthy')
                        : workspace === 'terminal'
                            ? (terminalAvailable ? 'healthy' : 'offline')
                            : selectedNode
                                ? (selectedNode.online ? 'healthy' : 'offline')
                                : nodes.length ? (onlineCount ? 'healthy' : 'offline') : 'unknown'}`} aria-hidden='true'/>
                    <strong>{workspace === 'groups'
                        ? (zh ? '群查询' : 'Groups')
                        : workspace === 'network'
                        ? (zh ? '网络资产' : 'Network assets')
                        : workspace === 'terminal'
                            ? (zh ? '终端连接' : 'Terminal connection')
                            : selectedNode?.name || (overviewView === 'map'
                                ? (zh ? '边缘集群地图' : 'Edge cluster map')
                                : (zh ? '边缘集群图谱' : 'Edge cluster graph'))}</strong>
                    {workspace === 'groups'
                        ? <small>{zh ? '本机群成员关系' : 'Local group memberships'}</small>
                        : workspace === 'network'
                        ? <small>{zh ? '计算群资产台账' : 'Compute-cluster inventory'}</small>
                        : selectedNode && <small>{workspace === 'terminal'
                            ? selectedNode.name
                            : selectedNode.node_id}</small>}
                </div>
                <div className='ControlToolbarGroup right'>
                    {queriedAt && <small>{zh ? '查询于' : 'Checked'} {queriedAt.toLocaleTimeString(zh ? 'zh-CN' : 'en-US')}</small>}
                    <span>{workspace === 'groups'
                        ? (currentGroup ? (zh ? '1 个群' : '1 group') : (zh ? '0 个群' : '0 groups'))
                        : `${onlineCount} / ${nodes.length} ${zh ? '在线' : 'online'}`}</span>
                    {workspace === 'node' && !selectedNode
                        ? <div className='ControlOverviewViewSwitch' role='group' aria-label={zh ? '总览视角' : 'Overview view'}>
                            <button
                                type='button'
                                className={overviewView === 'map' ? 'active' : ''}
                                aria-pressed={overviewView === 'map'}
                                onClick={() => setOverviewView('map')}
                            >{zh ? '地图' : 'Map'}</button>
                            <button
                                type='button'
                                className={overviewView === 'graph' ? 'active' : ''}
                                aria-pressed={overviewView === 'graph'}
                                onClick={() => setOverviewView('graph')}
                            >{zh ? '图谱' : 'Graph'}</button>
                        </div>
                        : <button
                            type='button'
                            title={zh ? '刷新机器状态' : 'Refresh machine status'}
                            aria-label={zh ? '刷新机器状态' : 'Refresh machine status'}
                            onClick={() => void refresh()}
                            disabled={refreshing}
                        >
                            <img src='/ico/refresh.png' alt=''/>
                        </button>}
                </div>
            </div>
            <div className='ControlCenterBody'>
                {workspace === 'groups' && <div className='ControlNodeContent'>
                    <header className='ControlNodeHeader'>
                        <div>
                            <h1>{zh ? '群查询' : 'Groups'}</h1>
                            <p>{zh ? '查看当前安装能够确认的群成员关系' : 'Groups confirmed by this installation'}</p>
                        </div>
                    </header>
                    <section className='ControlSection ControlSectionFirst'>
                        <div className='ControlSectionHeading'>
                            <h2>{zh ? '已加入的群' : 'Joined groups'}</h2>
                            <span>{currentGroup ? 1 : 0}</span>
                        </div>
                        {currentGroup
                            ? <div className='ControlServiceGrid' aria-label={zh ? '当前群列表' : 'Current groups'}>
                                <article className='ControlServiceCard'>
                                    <span className={`ControlStatusDot ${currentGroupTone}`} aria-hidden='true'/>
                                    <div>
                                        <span>{zh ? '序号 1' : 'Index 1'}</span>
                                        <strong>{currentGroup.label}</strong>
                                        <small>{resourceGraph?.group_id}</small>
                                    </div>
                                </article>
                            </div>
                            : <div className='ControlEmptyBlock'>{graphError || (zh ? '当前没有可查询的群' : 'No queryable groups')}</div>}
                    </section>
                </div>}
                {workspace === 'network' && <div className='ControlFeatureWorkspace'>
                    <ComputeClusterPopup
                        key={selectedNodeId || 'network'}
                        language={language}
                        embedded
                        initialWorkspace='network'
                        preferredNodeId={selectedNodeId}
                    />
                </div>}
                {workspace === 'terminal' && <div className='ControlFeatureWorkspace'>
                    <ComputeTerminalPanel
                        key={selectedNodeId || 'terminal'}
                        zh={zh}
                        preferredNodeId={selectedNodeId}
                    />
                </div>}
                {workspace === 'node' && loading && nodes.length === 0 && <div className='ControlCenterMessage'>
                    <strong>{zh ? '正在读取计算群' : 'Loading compute cluster'}</strong>
                    <span>{zh ? '正在获取已加入计算群的机器…' : 'Fetching enrolled machines…'}</span>
                </div>}
                {workspace === 'node' && !loading && !selectedNode && nodes.length === 0 && <div className='ControlCenterMessage error'>
                    <strong>{error ? (zh ? '无法读取计算群' : 'Compute cluster unavailable') : (zh ? '暂无机器' : 'No machines')}</strong>
                    <span>{error || (zh ? '请先将机器加入计算群' : 'Enroll a machine in the compute cluster first')}</span>
                    <button type='button' onClick={() => void refresh()}>{zh ? '重试' : 'Retry'}</button>
                </div>}
                {workspace === 'node' && !loading && !selectedNode && nodes.length > 0 && <div className='ControlNodeContent'>
                    {(error || graphError) && <div className='ControlRefreshWarning' role='status'>
                        {error
                            ? (zh ? '本次刷新失败，正在显示上一次数据：' : 'Refresh failed; showing the last snapshot: ')
                            : overviewView === 'map'
                                ? (zh ? '地域数据刷新失败，正在显示上一次数据：' : 'Region data refresh failed; showing the last snapshot: ')
                                : (zh ? '图谱刷新失败，正在显示上一次数据：' : 'Graph refresh failed; showing the last snapshot: ')}
                        {error || graphError}
                    </div>}
                    {overviewView === 'map'
                        ? <React.Suspense fallback={<div className='ControlCenterMessage'>{zh ? '正在载入地图…' : 'Loading map…'}</div>}>
                            <ClusterGeographicMap graph={resourceGraph} nodes={nodes} zh={zh}/>
                        </React.Suspense>
                        : resourceGraph
                            ? <ResourceKnowledgeGraph
                                graph={resourceGraph}
                                nodes={nodes}
                                zh={zh}
                                onSelectWorkAgent={() => undefined}
                            />
                            : <div className='ControlCenterMessage error'>
                                <strong>{zh ? '边缘集群图谱暂不可用' : 'Edge cluster graph unavailable'}</strong>
                                <span>{graphError || (zh ? '图谱数据尚未就绪' : 'Graph data is not ready')}</span>
                                <button type='button' onClick={() => void refresh()}>{zh ? '重试' : 'Retry'}</button>
                            </div>}
                </div>}
                {workspace === 'node' && selectedNode && <>
                    {runtimeSnapshot && runtimeAlerts.length > 0 && dismissedRuntimeAlertKey !== runtimeAlertKey && <div
                        className='ControlRuntimeAlerts ControlRuntimeAlertsTop'
                        aria-label={zh ? '最近异常' : 'Recent issues'}
                    >
                        <div>
                            <strong>{zh ? '最近异常' : 'Recent issues'}</strong>
                            <ul>{runtimeAlerts.map(event => <li key={event.cursor}>
                                <span>{runtimeTime(event.created_at, zh)}</span>
                                <small>{runtimeSnapshot.services.find(service => service.service_id === event.service_id)?.name || event.service_id} · {event.message}</small>
                            </li>)}</ul>
                        </div>
                        <button
                            type='button'
                            aria-label={zh ? '关闭最近异常' : 'Dismiss recent issues'}
                            title={zh ? '关闭提示' : 'Dismiss notice'}
                            onClick={() => setDismissedRuntimeAlertKey(runtimeAlertKey)}
                        >×</button>
                    </div>}
                    {runtimeError && !runtimeWarningDismissed && <div className='ControlRuntimeWarning' role='status'>
                        <span><strong>{zh ? '运行详情暂不可用' : 'Runtime details unavailable'}</strong>
                            {zh ? `：${runtimeError}` : `: ${runtimeError}`}</span>
                        <button
                            type='button'
                            aria-label={zh ? '关闭运行详情提示' : 'Dismiss runtime details warning'}
                            title={zh ? '关闭提示' : 'Dismiss warning'}
                            onClick={() => setRuntimeWarningDismissed(true)}
                        >×</button>
                    </div>}
                    <div className='ControlNodeContent'>
                        {error && <div className='ControlRefreshWarning' role='status'>
                            {zh ? '本次刷新失败，正在显示上一次数据：' : 'Refresh failed; showing the last snapshot: '}{error}
                        </div>}
                        {renderNode(selectedNode)}
                    </div>
                </>}
            </div>
        </main>
        {selectedNode && inspectedServiceId && <div
            className='ControlResourceMonitorBackdrop'
            onMouseDown={event => {
                if (event.target === event.currentTarget) setInspectedServiceId('');
            }}
        >
            <section
                className='ControlResourceMonitor'
                role='dialog'
                aria-modal='true'
                aria-label={zh ? `${selectedNode.name} 资源监视器` : `${selectedNode.name} resource monitor`}
            >
                <header>
                    <div>
                        <span>{zh ? '资源监视器' : 'Resource Monitor'}</span>
                        <h2>{selectedNode.name}</h2>
                        <p>{runtimeCapable
                            ? (zh ? '运行状态每 5 秒刷新' : 'Runtime refreshes every 5 seconds')
                            : (zh ? '资源随节点心跳刷新' : 'Resources refresh with the node heartbeat')}
                        {' · '}{runtimeTime(runtimeSnapshot?.captured_at || selectedNode.resources.captured_at, zh)}</p>
                    </div>
                    <button
                        type='button'
                        autoFocus
                        aria-label={zh ? '关闭资源监视器' : 'Close resource monitor'}
                        onClick={() => setInspectedServiceId('')}
                    >×</button>
                </header>

                <div className='ControlMonitorWorkspace'>
                    <nav className='ControlMonitorNav' aria-label={zh ? '资源监视器导航' : 'Resource monitor navigation'}>
                        {([
                            ['performance', zh ? '性能' : 'Performance'],
                            ['processes', zh ? '进程' : 'Processes'],
                            ['startup', zh ? '启动应用' : 'Startup apps'],
                            ['services', zh ? '服务' : 'Services'],
                            ['tasks', zh ? '任务' : 'Tasks'],
                            ['conversations', zh ? '对话' : 'Conversations'],
                        ] as [MonitorView, string][]).map(([view, label]) => <button
                            type='button'
                            key={view}
                            aria-current={monitorView === view ? 'page' : undefined}
                            onClick={() => setMonitorView(view)}
                        >{label}</button>)}
                    </nav>

                    <div className='ControlMonitorContent'>
                        {monitorView === 'performance' && <div className='ControlMonitorPerformance'>
                            <aside className='ControlMonitorResourceList' aria-label={zh ? '资源列表' : 'Resource list'}>
                                {resourceMetrics.map(metric => <button
                                    type='button'
                                    key={metric.id}
                                    aria-pressed={metric.id === activeMetricId}
                                    aria-label={`${metric.label} ${metric.value}`}
                                    onClick={() => setActiveMetricId(metric.id)}
                                >
                                    <ResourceSparkline
                                        label={metric.trendLabel}
                                        values={metric.values}
                                        secondaryValues={metric.secondaryValues}
                                        color={metric.color}
                                        secondaryColor={metric.secondaryColor}
                                        autoScale={metric.autoScale}
                                        emptyLabel={metric.emptyLabel}
                                    />
                                    <span className='ControlMonitorMetricIdentity'>
                                        <strong>{metric.label}</strong>
                                        <small>{metric.value}</small>
                                        <small>{metric.detail}</small>
                                    </span>
                                </button>)}
                            </aside>
                            <section
                                className='ControlMonitorMetricDetail'
                                aria-label={zh ? `${activeMetric.label} 性能详情` : `${activeMetric.label} performance details`}
                            >
                                <header>
                                    <div>
                                        <span>{zh ? '性能' : 'Performance'}</span>
                                        <h3>{activeMetric.label}</h3>
                                    </div>
                                    <strong>{activeMetric.value}</strong>
                                </header>
                                <p>{activeMetric.detail}</p>
                                <ResourceSparkline
                                    label={activeMetric.trendLabel}
                                    values={activeMetric.values}
                                    secondaryValues={activeMetric.secondaryValues}
                                    color={activeMetric.color}
                                    secondaryColor={activeMetric.secondaryColor}
                                    autoScale={activeMetric.autoScale}
                                    emptyLabel={activeMetric.emptyLabel}
                                />
                                <footer>
                                    <span>{zh ? `最近 ${activeMetric.values.filter(value => value !== null).length} 次采样` : `Last ${activeMetric.values.filter(value => value !== null).length} samples`}</span>
                                    <span>{activeMetric.scaleLabel || '0–100%'}</span>
                                </footer>
                            </section>
                        </div>}

                        {monitorView === 'processes' && (runtimeInventory?.processes_available ? <section
                            className='ControlMonitorProcesses ControlMonitorInventory'
                            aria-label={zh ? '进程清单' : 'Process list'}
                        >
                            <header className='ControlInventoryHeader'>
                                <h3>{zh ? '进程' : 'Processes'}</h3>
                                <div>
                                    <input
                                        type='search'
                                        value={processQuery}
                                        aria-label={zh ? '搜索进程' : 'Search processes'}
                                        placeholder={zh ? '搜索名称、PID 或状态' : 'Search name, PID, or status'}
                                        onChange={event => setProcessQuery(event.target.value)}
                                    />
                                    <span>{processQuery.trim() ? `${sortedProcesses.length}/${runtimeInventory.processes.length}` : runtimeInventory.processes.length}</span>
                                </div>
                            </header>
                            <table>
                                <thead><tr>{([
                                    ['name', zh ? '名称' : 'Name'],
                                    ['pid', 'PID'],
                                    ['cpu', 'CPU'],
                                    ['memory', zh ? '内存' : 'Memory'],
                                    ['state', zh ? '状态' : 'Status'],
                                ] as [ProcessSortKey, string][]).map(([key, label]) => {
                                    const active = processSort.key === key;
                                    const nextDirection = active
                                        ? (processSort.direction === 'asc' ? 'desc' : 'asc')
                                        : (key === 'name' ? 'asc' : 'desc');
                                    return <th key={key} aria-sort={active ? (processSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                        <button
                                            type='button'
                                            aria-label={zh
                                                ? `按${label}${nextDirection === 'asc' ? '升序' : '降序'}排列`
                                                : `Sort by ${label} ${nextDirection === 'asc' ? 'ascending' : 'descending'}`}
                                            onClick={() => sortProcesses(key)}
                                        >{label}<span aria-hidden='true'>{active ? (processSort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button>
                                    </th>;
                                })}</tr></thead>
                                <tbody>{sortedProcesses.map(process => <tr key={process.pid}>
                                    <td>{process.name}</td>
                                    <td>{process.pid}</td>
                                    <td>{process.cpu_percent === null ? '—' : `${process.cpu_percent.toFixed(1)}%`}</td>
                                    <td>{bytes(process.memory_bytes, zh)}</td>
                                    <td>{processStateLabel(process.state, zh)}</td>
                                </tr>)}</tbody>
                            </table>
                        </section> : <div className='ControlMonitorUnavailable'>
                            <strong>{runtimeInventoryError
                                ? (zh ? '进程清单暂不可用' : 'The process list is unavailable')
                                : runtimeInventoryCapable
                                    ? runtimeInventory
                                        ? (zh ? '节点无法读取进程清单' : 'The node cannot read its process list')
                                        : (zh ? '正在读取进程清单…' : 'Loading process list…')
                                    : (zh ? '节点版本暂不支持进程清单' : 'This node does not support process lists yet')}</strong>
                            <span>{runtimeInventoryError}</span>
                        </div>)}

                        {monitorView === 'startup' && (runtimeInventory?.startup_services_available ? <section
                            className='ControlMonitorProcesses ControlMonitorInventory'
                            aria-label={zh ? '启动应用清单' : 'Startup app list'}
                        >
                            <h3>{zh ? `启动应用（${runtimeInventory.startup_services.length}）` : `Startup apps (${runtimeInventory.startup_services.length})`}</h3>
                            <table>
                                <thead><tr>{([
                                    ['name', zh ? '名称' : 'Name'],
                                    ['identifier', zh ? '标识' : 'Identifier'],
                                    ['state', zh ? '状态' : 'Status'],
                                    ['startType', zh ? '启动类型' : 'Startup type'],
                                ] as [StartupSortKey, string][]).map(([key, label]) => {
                                    const active = startupSort.key === key;
                                    const nextDirection = active && startupSort.direction === 'asc' ? 'desc' : 'asc';
                                    return <th key={key} aria-sort={active ? (startupSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                        <button
                                            type='button'
                                            aria-label={zh
                                                ? `按${label}${nextDirection === 'asc' ? '升序' : '降序'}排列`
                                                : `Sort by ${label} ${nextDirection === 'asc' ? 'ascending' : 'descending'}`}
                                            onClick={() => sortStartupServices(key)}
                                        >{label}<span aria-hidden='true'>{active ? (startupSort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button>
                                    </th>;
                                })}</tr></thead>
                                <tbody>{sortedStartupServices.map((service, index) => <tr key={`${service.name}-${index}`}>
                                    <td>{service.display_name}</td>
                                    <td>{service.name}</td>
                                    <td>{startupStateLabel(service.state, zh)}</td>
                                    <td>{zh ? '自动' : 'Automatic'}</td>
                                </tr>)}</tbody>
                            </table>
                        </section> : <div className='ControlMonitorUnavailable'>
                            <strong>{runtimeInventoryError
                                ? (zh ? '启动应用清单暂不可用' : 'The startup app list is unavailable')
                                : runtimeInventoryCapable
                                    ? runtimeInventory
                                        ? (zh ? '节点无法读取启动应用清单' : 'The node cannot read its startup app list')
                                        : (zh ? '正在读取启动应用清单…' : 'Loading startup app list…')
                                    : (zh ? '节点版本暂不支持启动应用清单' : 'This node does not support startup app lists yet')}</strong>
                            <span>{runtimeInventoryError}</span>
                        </div>)}

                        {monitorView === 'tasks' && <section
                            className='ControlMonitorTaskHistory ControlMonitorStandaloneHistory'
                            aria-label={zh ? '提交任务' : 'Submitted tasks'}
                        >
                                <header>
                                    <div><h3>{zh ? '提交任务' : 'Submitted tasks'}</h3><p>{zh ? '状态每 2 秒刷新' : 'Status refreshes every 2 seconds'}</p></div>
                                    <span>{taskHistory.length}</span>
                                </header>
                                {taskHistoryError && <p className='ControlMonitorHistoryError' role='status'>{taskHistoryError}</p>}
                                {taskHistoryLoading && taskHistory.length === 0 ? <div className='ControlMonitorUnavailable'>
                                    <strong>{zh ? '正在读取任务…' : 'Loading tasks…'}</strong>
                                </div> : taskHistory.length === 0 ? <div className='ControlMonitorUnavailable'>
                                    <strong>{zh ? '暂无提交任务' : 'No submitted tasks'}</strong>
                                </div> : <table>
                                    <thead><tr>{([
                                        ['task', zh ? '任务' : 'Task'],
                                        ['device', zh ? '设备' : 'Device'],
                                        ['state', zh ? '状态' : 'Status'],
                                        ['updated', zh ? '更新时间' : 'Updated'],
                                    ] as [TaskSortKey, string][]).map(([key, label]) => {
                                        const active = taskSort.key === key;
                                        const nextDirection = active && taskSort.direction === 'asc' ? 'desc' : 'asc';
                                        return <th key={key} aria-sort={active ? (taskSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                            <button
                                                type='button'
                                                aria-label={zh
                                                    ? `按${label}${nextDirection === 'asc' ? '升序' : '降序'}排列`
                                                    : `Sort by ${label} ${nextDirection === 'asc' ? 'ascending' : 'descending'}`}
                                                onClick={() => sortTasks(key)}
                                            >{label}<span aria-hidden='true'>{active ? (taskSort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button>
                                        </th>;
                                    })}</tr></thead>
                                    <tbody>{sortedTaskHistory.map(task => <tr key={task.task_id}>
                                        <td><strong>{taskTypeLabel(task.task_type, zh)}</strong><small>{task.task_id}</small></td>
                                        <td>{task.node_name}</td>
                                        <td><span className={`ControlTaskHistoryState ${task.state}`}>{taskStateLabel(task.state, zh)}</span></td>
                                        <td>{runtimeTime(task.updated_at, zh)}</td>
                                    </tr>)}</tbody>
                                </table>}
                        </section>}

                        {monitorView === 'conversations' && <section
                            className='ControlMonitorConversationHistory ControlMonitorStandaloneHistory'
                            aria-label={zh ? '过往对话' : 'Past conversations'}
                        >
                                <header>
                                    <h3>{zh ? '过往对话' : 'Past conversations'}</h3>
                                    <span>{conversationHistory.length}</span>
                                </header>
                                {conversationHistoryError && <p className='ControlMonitorHistoryError' role='status'>{conversationHistoryError}</p>}
                                {conversationHistoryLoading && conversationHistory.length === 0 ? <div className='ControlMonitorUnavailable'>
                                    <strong>{zh ? '正在读取对话…' : 'Loading conversations…'}</strong>
                                </div> : conversationHistory.length === 0 ? <div className='ControlMonitorUnavailable'>
                                    <strong>{zh ? '暂无对话记录' : 'No conversation history'}</strong>
                                </div> : <div className='ControlConversationWorkspace'>
                                    <nav className='ControlConversationList' aria-label={zh ? '历史对话列表' : 'Conversation history list'}>
                                        {conversationHistory.map(conversation => <button
                                            type='button'
                                            key={conversation.id}
                                            aria-current={selectedConversationId === conversation.id ? 'page' : undefined}
                                            onClick={() => void selectConversation(conversation.id)}
                                        >
                                            <strong>{conversationTitle(conversation.title, zh)}</strong>
                                            <small>{historyTime(conversation.updated_at, zh)}</small>
                                        </button>)}
                                    </nav>
                                    <div className='ControlConversationMessages' aria-label={zh ? '对话记录' : 'Conversation messages'}>
                                        {conversationMessages.length > 0 ? conversationMessages.map(message => <article
                                            key={message.id}
                                            className={message.role}
                                        >
                                            <span>{message.role === 'user' ? (zh ? '我' : 'Me') : message.role === 'assistant' ? 'Agent' : message.role}</span>
                                            <p>{conversationMessage(message.content)}</p>
                                        </article>) : <p>{zh ? '暂无消息' : 'No messages'}</p>}
                                    </div>
                                </div>}
                        </section>}

                        {monitorView === 'services' && (runtimeSnapshot && inspectedService ? <div className='ControlMonitorBody'>
                            <section className='ControlMonitorProcesses'>
                                <h3>{zh ? '受管服务' : 'Managed services'}</h3>
                                <table>
                                    <thead><tr>
                                        <th>{zh ? '名称' : 'Name'}</th>
                                        <th>{zh ? '状态' : 'Status'}</th>
                                        <th>PID</th>
                                        <th>{zh ? '运行时间' : 'Uptime'}</th>
                                    </tr></thead>
                                    <tbody>{managedServices.map(service => <tr
                                        key={service.service_id}
                                        className={service.service_id === inspectedService.service_id ? 'selected' : ''}
                                    >
                                        <td><button type='button' onClick={() => setInspectedServiceId(service.service_id)}>
                                            <span className={`ControlStatusDot ${runtimeTone(service.state)}`} aria-hidden='true'/>{service.name}
                                        </button></td>
                                        <td>{runtimeStateLabel(service.state, zh)}</td>
                                        <td>{service.process?.pid ?? '—'}</td>
                                        <td>{runtimeDuration(service.uptime_seconds, zh)}</td>
                                    </tr>)}</tbody>
                                </table>
                            </section>

                            <aside className='ControlMonitorInspector'>
                                <span>{runtimeStateLabel(inspectedService.state, zh)}</span>
                                <h3>{inspectedService.name}</h3>
                                <dl>
                                    <div><dt>{zh ? '进程' : 'Process'}</dt><dd>PID {inspectedService.process?.pid ?? '—'} · {inspectedProcessState}</dd></div>
                                    <div><dt>{zh ? '接口健康' : 'Endpoint health'}</dt><dd>{inspectedService.health.status_code === null ? 'HTTP —' : `HTTP ${inspectedService.health.status_code}`} · {inspectedService.health.latency_ms === null ? (zh ? '延迟未上报' : 'Latency not reported') : `${inspectedService.health.latency_ms} ms`}</dd></div>
                                    <div><dt>{zh ? '版本' : 'Version'}</dt><dd>{inspectedService.version || '—'}</dd></div>
                                    <div><dt>{zh ? '任务执行器' : 'Task executor'}</dt><dd>{taskExecutor ? runtimeStateLabel(taskExecutor.state, zh) : (zh ? '未上报' : 'Not reported')}</dd></div>
                                    <div><dt>{zh ? '任务计数' : 'Task counts'}</dt><dd>{Object.entries(taskExecutor?.task_counts || inspectedService.task_counts || {}).map(([state, count]) => `${taskStateLabel(state, zh)} ${count}`).join(' · ') || (zh ? '未上报' : 'Not reported')}</dd></div>
                                </dl>
                                <div className='ControlRuntimeEvents'>
                                    <strong>{zh ? '最近事件' : 'Recent events'}</strong>
                                    {runtimeEventsError
                                        ? <p role='status'>{zh ? `服务日志暂不可用：${runtimeEventsError}` : `Service log unavailable: ${runtimeEventsError}`}</p>
                                        : inspectedEvents.length > 0
                                            ? <ul>{inspectedEvents.map(event => <li className={event.level} key={event.cursor}>
                                                <span>{runtimeTime(event.created_at, zh)} · {event.event_type}</span>
                                                <small>{event.message}</small>
                                            </li>)}</ul>
                                            : <p>{zh ? '暂无结构化事件' : 'No structured events'}</p>}
                                </div>
                            </aside>
                        </div> : <div className='ControlMonitorUnavailable'>
                            <strong>{runtimeError
                                ? (zh ? '受管服务暂不可用' : 'Managed services are unavailable')
                                : runtimeCapable
                                    ? runtimeSnapshot
                                        ? (zh ? '节点未上报受管服务' : 'The node reported no managed services')
                                        : (zh ? '正在读取受管服务…' : 'Loading managed services…')
                                    : (zh ? '节点版本暂不支持受管服务详情' : 'This node does not support managed service details yet')}</strong>
                            <span>{runtimeError || (!runtimeCapable
                                ? (zh ? '升级节点程序后可查看服务、PID 和事件。' : 'Upgrade the node software to view services, PIDs, and events.')
                                : '')}</span>
                        </div>)}
                    </div>
                </div>
            </section>
        </div>}
    </div>;
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
    imagesData: state.labels.imagesData,
});

export default connect(mapStateToProps)(ControlCenterView);
