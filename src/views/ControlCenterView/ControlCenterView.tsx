import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {connect} from 'react-redux';
import {Language} from '../../data/LanguageConfig';
import {Direction} from '../../data/enums/Direction';
import {PopupWindowType} from '../../data/enums/PopupWindowType';
import {updateActivePopupType} from '../../store/general/actionCreators';
import {
    ComputeClusterNode,
    ComputeGroupMembership,
    ComputeLanAsset,
    ComputeManagedDevice,
    ComputeNetworkDependency,
    ComputeResourceGraph,
    ComputeRuntimeInventory,
    ComputeClusterService,
    computeSshAvailability,
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
import {markdownMessage, splitTaskIdLine} from '../Common/AgentSideChat/AgentSideChat';
import {ComputeClusterPopup} from '../PopupView/ComputeClusterPopup/ComputeClusterPopup';
import {DeviceManagementPopup} from '../PopupView/DeviceManagementPopup/DeviceManagementPopup';
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
    updateActivePopupTypeAction?: (
        activePopupType: PopupWindowType,
        activePopupNodeId?: string | null,
        activePopupNodeName?: string | null,
        activePopupNodeRemote?: boolean,
    ) => void;
}

type Tone = 'healthy' | 'offline';
type SidePanel = 'machines' | 'features';
type Workspace = 'node' | 'network' | 'terminal' | 'groups';
type MachineIconKind = 'jetson' | 'windows' | 'linux' | 'macos' | 'computer';
type NodeGrouping = 'none' | 'region' | 'platform';
type NodeOrdering = 'status' | 'activity' | 'name';
type NodeVisibility = 'all' | 'normal' | 'fault';
type OverviewView = 'map' | 'graph';
type MonitorView = 'performance' | 'processes' | 'startup' | 'tasks' | 'conversations';
type ProcessSortKey = 'name' | 'pid' | 'cpu' | 'memory' | 'state';
type StartupSortKey = 'name' | 'identifier' | 'state' | 'startType';
type TaskSortKey = 'task' | 'device' | 'state' | 'updated';
type SortDirection = 'asc' | 'desc';
type TaskHistoryItem = {
    taskId: string;
    taskType: string;
    device: string;
    state: string;
    updatedAt: number;
};
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

const runtimeTime = (timestamp: number, zh: boolean): string => timestamp
    ? new Date(timestamp * 1000).toLocaleString(zh ? 'zh-CN' : 'en-US')
    : (zh ? '未知' : 'Unknown');

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
): string => state === 'running'
    ? (zh ? '正常' : 'Normal')
    : (zh ? '故障' : 'Fault');

const isNodeService = (service: ComputeRuntimeInventory['startup_services'][number]): boolean =>
    service.name === 'ModelWorkNodeAgent' || service.display_name === 'Model Work Node Agent';

const startupServiceName = (
    service: ComputeRuntimeInventory['startup_services'][number],
    zh: boolean,
): string => isNodeService(service) ? (zh ? '节点服务' : 'Node service') : service.display_name;

const startupServiceIdentifier = (
    service: ComputeRuntimeInventory['startup_services'][number],
): string => isNodeService(service) ? 'node-service' : service.name;

const taskStateLabel = (state: string, zh: boolean): string => ({
    queued: zh ? '排队' : 'Queued',
    running: zh ? '运行中' : 'Running',
    paused: zh ? '已暂停' : 'Paused',
    succeeded: zh ? '成功' : 'Succeeded',
    completed: zh ? '成功' : 'Completed',
    failed: zh ? '失败' : 'Failed',
    cancelled: zh ? '已取消' : 'Cancelled',
})[state] || state;

const taskTypeLabel = (type: string, zh: boolean): string => ({
    'system.wait': zh ? '连通测试' : 'Connectivity test',
    'information.web_fetch': zh ? '网页读取' : 'Web fetch',
    'network.lan_discovery': zh ? '局域网发现' : 'LAN discovery',
    'network.peer_probe': zh ? '网络探测' : 'Network probe',
    agent_request: zh ? 'Agent 请求' : 'Agent request',
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
    ? zh ? '正常' : 'Normal'
    : zh ? '故障' : 'Fault';

const machineTone = (node: ComputeClusterNode): Tone => {
    if (!node.online) return 'offline';
    const ssh = computeSshAvailability(node);
    const hasFault = (!ssh.lan && !ssh.tailscale)
        || node.device_inventory.state === 'unavailable'
        || node.device_inventory.devices.some(device => device.status === 'offline' || device.status === 'unavailable');
    return hasFault ? 'offline' : 'healthy';
};

const machineStateLabel = (tone: Tone, zh: boolean): string => tone === 'healthy'
    ? zh ? '正常' : 'Normal'
    : zh ? '故障' : 'Fault';

const cameraTone = (status: ComputeManagedDevice['status']): Tone => status === 'online' ? 'healthy' : 'offline';

const cameraLabel = (status: ComputeManagedDevice['status'], zh: boolean): string => ({
    registered: zh ? '故障' : 'Fault',
    online: zh ? '正常' : 'Normal',
    offline: zh ? '故障' : 'Fault',
    unavailable: zh ? '故障' : 'Fault',
})[status];

const NODE_TAG_LIMIT = 1;
const NODE_TAG_MAX_LENGTH = 32;
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
export const ControlCenterView: React.FC<IProps> = ({
    language,
    imagesData = [],
    onCameraOpened,
    updateActivePopupTypeAction,
}) => {
    const zh = language === Language.CHINESE;
    const [sidePanel, setSidePanel] = useState<SidePanel | null>('machines');
    const [workspace, setWorkspace] = useState<Workspace>('node');
    const [terminalAutoConnect, setTerminalAutoConnect] = useState(false);
    const [terminalTransport, setTerminalTransport] = useState<'lan' | 'tailscale'>();
    const [nodes, setNodes] = useState<ComputeClusterNode[]>([]);
    const [groupMemberships, setGroupMemberships] = useState<ComputeGroupMembership[]>([]);
    const [lanAssets, setLanAssets] = useState<ComputeLanAsset[]>([]);
    const [resourceGraph, setResourceGraph] = useState<ComputeResourceGraph | null>(null);
    const [selectedNodeId, setSelectedNodeId] = useState('');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [graphError, setGraphError] = useState('');
    const [runtimeInventory, setRuntimeInventory] = useState<ComputeRuntimeInventory | null>(null);
    const [runtimeInventoryError, setRuntimeInventoryError] = useState('');
    const [dismissedRefreshWarningKey, setDismissedRefreshWarningKey] = useState('');
    const [inspectedServiceId, setInspectedServiceId] = useState('');
    const [monitorMaximized, setMonitorMaximized] = useState(false);
    const [monitorView, setMonitorView] = useState<MonitorView>('performance');
    const [deviceManagementTab, setDeviceManagementTab] = useState<'camera' | 'edge' | null>(null);
    const [processQuery, setProcessQuery] = useState('');
    const [processSort, setProcessSort] = useState<{key: ProcessSortKey; direction: SortDirection}>({
        key: 'memory',
        direction: 'desc',
    });
    const [startupQuery, setStartupQuery] = useState('');
    const [startupSort, setStartupSort] = useState<{key: StartupSortKey; direction: SortDirection}>({
        key: 'name',
        direction: 'asc',
    });
    const [taskHistory, setTaskHistory] = useState<TaskHistoryItem[]>([]);
    const [taskQuery, setTaskQuery] = useState('');
    const [taskSort, setTaskSort] = useState<{key: TaskSortKey; direction: SortDirection}>({
        key: 'updated',
        direction: 'desc',
    });
    const [taskHistoryLoading, setTaskHistoryLoading] = useState(false);
    const [taskHistoryError, setTaskHistoryError] = useState('');
    const [conversationHistory, setConversationHistory] = useState<AgentConversation[]>([]);
    const [conversationQuery, setConversationQuery] = useState('');
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
    const runtimeInventoryRequest = useRef(0);
    const runtimeInventoryPendingNode = useRef('');
    const runtimeInventoryAbort = useRef<AbortController | null>(null);
    const conversationRequest = useRef(0);

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
            const [nextNodes, graphResult, assetResult, memberships] = await Promise.all([
                ComputeClusterService.nodes(),
                ComputeClusterService.resourceGraph().then(
                    value => ({value, error: ''}),
                    reason => ({
                        value: null,
                        error: reason instanceof Error ? reason.message : String(reason),
                    }),
                ),
                ComputeClusterService.lanAssets().then(
                    value => value.assets,
                    () => [] as ComputeLanAsset[],
                ),
                ComputeClusterService.groups().then(
                    value => value.groups,
                    () => [] as ComputeGroupMembership[],
                ),
            ]);
            if (!mounted.current) return;
            setNodes(nextNodes);
            setLanAssets(assetResult);
            setGroupMemberships(memberships);
            if (graphResult.value) setResourceGraph(graphResult.value);
            setGraphError(graphResult.error);
            setSelectedNodeId(current => overviewSelected.current
                ? ''
                : nextNodes.some(node => node.node_id === current)
                    ? current
                    : nextNodes.find(node => node.online)?.node_id || nextNodes[0]?.node_id || '');
            setQueriedAt(new Date());
            setError('');
            if (!graphResult.error) setDismissedRefreshWarningKey('');
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
        const nodeRegionNames = new Map(entities
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
        return new Map(nodes.map(node => [
            node.node_id,
            regionDisplayName(node.labels?.region_name
                || nodeRegionNames.get(node.node_id)
                || node.labels?.region
                || '', zh)
                || (zh ? '未分配地域' : 'Unassigned'),
        ]));
    }, [nodes, resourceGraph, zh]);
    const organizedNodes = useMemo(() => {
        const visible = nodes.filter(node => {
            if (nodeVisibility === 'all') return true;
            const tone = machineTone(node);
            if (nodeVisibility === 'normal') return tone === 'healthy';
            return tone !== 'healthy';
        });
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
    const runtimeInventoryCapable = Boolean(
        selectedNode?.online && selectedNode.capabilities.includes('runtime.inventory.v1'),
    );
    const currentGroup = resourceGraph?.entities.find(entity => entity.kind === 'compute_group') || null;
    const visibleGroups: ComputeGroupMembership[] = groupMemberships.length
        ? groupMemberships
        : currentGroup ? [{
            index: 1,
            group_id: resourceGraph?.group_id || currentGroup.entity_id,
            group_name: currentGroup.label,
            owner_name: null,
            relationship: 'member',
            scope: 'local',
            joined_at: 0,
            credential_types: [],
        }] : [];
    const currentGroupTone: Tone = currentGroup?.state === 'available' ? 'healthy' : 'offline';
    const normalCount = nodes.filter(node => machineTone(node) === 'healthy').length;
    const terminalAvailable = Boolean(selectedNode?.online && selectedNode.network.ssh_available);
    const toolbarTone: Tone | null = workspace === 'groups'
        ? visibleGroups.length ? currentGroupTone : null
        : workspace === 'network'
            ? (error ? 'offline' : 'healthy')
            : workspace === 'terminal'
                ? (terminalAvailable ? 'healthy' : 'offline')
                : selectedNode
                    ? machineTone(selectedNode)
                    : nodes.length ? (normalCount ? 'healthy' : 'offline') : null;
    const refreshWarningKey = error ? `nodes:${error}` : graphError ? `graph:${graphError}` : '';

    useEffect(() => {
        const nodeChanged = selectedNodeIdRef.current !== selectedNodeId;
        selectedNodeIdRef.current = selectedNodeId;
        if (nodeChanged) {
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
        if (runtimeInventoryCapable) {
            void loadRuntimeInventory(selectedNodeId);
        }
    }, [loadRuntimeInventory, selectedNode, selectedNodeId]);

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
        if (!inspectedServiceId) setMonitorMaximized(false);
    }, [inspectedServiceId]);

    useEffect(() => {
        if (!inspectedServiceId || !selectedNodeId) return undefined;
        const timer = window.setInterval(() => {
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
        loadRuntimeInventory,
        refresh,
        runtimeInventoryCapable,
        selectedNodeId,
    ]);

    useEffect(() => {
        if (!inspectedServiceId || (monitorView !== 'tasks' && monitorView !== 'conversations')) return undefined;
        let active = true;
        const loadTasks = async (showLoading = false) => {
            if (showLoading) setTaskHistoryLoading(true);
            try {
                const [response, agentResponse] = await Promise.all([
                    ComputeClusterService.tasks(undefined, 200),
                    AgentChatService.tasks(200),
                ]);
                if (!active || !mounted.current) return;
                setTaskHistory([
                    ...response.tasks.map(task => ({
                        taskId: task.task_id,
                        taskType: task.task_type,
                        device: task.node_name,
                        state: task.state,
                        updatedAt: task.updated_at,
                    })),
                    ...agentResponse.tasks.map(task => ({
                        taskId: task.id,
                        taskType: task.kind,
                        device: 'OpenSight Agent',
                        state: task.status,
                        updatedAt: Date.parse(task.updated_at) / 1000,
                    })),
                ]);
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

    const sortedProcesses = useMemo(() => (runtimeInventory?.processes || []).filter(process => {
        const query = processQuery.trim().toLocaleLowerCase();
        return !query || [process.name, String(process.pid), processStateLabel(process.state, zh)]
            .some(value => value.toLocaleLowerCase().includes(query));
    }).sort((left, right) => {
        if (processSort.key === 'cpu' && (left.cpu_percent === null || right.cpu_percent === null)) {
            return left.cpu_percent === null ? (right.cpu_percent === null ? left.pid - right.pid : 1) : -1;
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
    }), [processQuery, processSort, runtimeInventory, zh]);

    const sortProcesses = (key: ProcessSortKey) => {
        setProcessSort(current => current.key === key
            ? {key, direction: current.direction === 'asc' ? 'desc' : 'asc'}
            : {key, direction: key === 'name' ? 'asc' : 'desc'});
    };

    const sortedStartupServices = useMemo(() => (runtimeInventory?.startup_services || []).filter(service => {
        const query = startupQuery.trim().toLocaleLowerCase();
        return !query || [
            startupServiceName(service, zh), startupServiceIdentifier(service),
            service.display_name, service.name, startupStateLabel(service.state, zh), zh ? '自动' : 'Automatic',
        ]
            .some(value => value.toLocaleLowerCase().includes(query));
    }).sort((left, right) => {
        const comparison = startupSort.key === 'name'
            ? startupServiceName(left, zh).localeCompare(startupServiceName(right, zh))
            : startupSort.key === 'identifier'
                ? startupServiceIdentifier(left).localeCompare(startupServiceIdentifier(right))
                : startupSort.key === 'state'
                    ? left.state.localeCompare(right.state)
                    : left.start_type.localeCompare(right.start_type);
        return (startupSort.direction === 'asc' ? comparison : -comparison) || left.name.localeCompare(right.name);
    }), [runtimeInventory, startupQuery, startupSort, zh]);

    const sortStartupServices = (key: StartupSortKey) => {
        setStartupSort(current => current.key === key
            ? {key, direction: current.direction === 'asc' ? 'desc' : 'asc'}
            : {key, direction: 'asc'});
    };

    const sortedTaskHistory = useMemo(() => taskHistory.filter(task => {
        const query = taskQuery.trim().toLocaleLowerCase();
        if (!query) return true;
        return [
            task.taskId,
            task.taskType,
            taskTypeLabel(task.taskType, zh),
            task.device,
            task.state,
            taskStateLabel(task.state, zh),
        ].some(value => value.toLocaleLowerCase().includes(query));
    }).sort((left, right) => {
        const comparison = taskSort.key === 'updated'
            ? left.updatedAt - right.updatedAt
            : taskSort.key === 'task'
                ? left.taskType.localeCompare(right.taskType)
                : taskSort.key === 'device'
                    ? left.device.localeCompare(right.device)
                    : left.state.localeCompare(right.state);
        return (taskSort.direction === 'asc' ? comparison : -comparison)
            || right.updatedAt - left.updatedAt;
    }), [taskHistory, taskQuery, taskSort, zh]);

    const sortTasks = (key: TaskSortKey) => {
        setTaskSort(current => current.key === key
            ? {key, direction: current.direction === 'asc' ? 'desc' : 'asc'}
            : {key, direction: key === 'updated' ? 'desc' : 'asc'});
    };

    const filteredConversationHistory = useMemo(() => {
        const query = conversationQuery.trim().toLocaleLowerCase();
        return conversationHistory.filter(conversation => !query || [
            conversation.title || '',
            conversation.id,
        ].some(value => value.toLocaleLowerCase().includes(query)));
    }, [conversationHistory, conversationQuery]);

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
        if (!tag || tag.length > NODE_TAG_MAX_LENGTH || nodeTags.includes(tag)) return;
        const next = [tag];
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
        if (!node.online || camera.status !== 'online' || openingCameraId) return;
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
                <option value='status'>{zh ? '正常优先' : 'Normal first'}</option>
                <option value='activity'>{zh ? '最近活跃' : 'Recent first'}</option>
                <option value='name'>{zh ? '按名称' : 'By name'}</option>
            </select>
            <select
                aria-label={zh ? '节点状态' : 'Node status'}
                value={nodeVisibility}
                onChange={event => setNodeVisibility(event.target.value as NodeVisibility)}
            >
                <option value='all'>{zh ? '所有状态' : 'All states'}</option>
                <option value='normal'>{zh ? '仅正常' : 'Normal only'}</option>
                <option value='fault'>{zh ? '仅故障' : 'Fault only'}</option>
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
                <span className={`ControlMachineState ${normalCount ? 'healthy' : 'offline'}`}>
                    {normalCount} / {nodes.length}
                </span>
            </button>
            {organizedNodes.map(([group, groupNodes]) => <React.Fragment key={group || 'all'}>
                {group && <div className='ControlMachineGroupHeading'>
                    <strong>{group}</strong>
                    <span>{groupNodes.length}</span>
                </div>}
                {groupNodes.map(node => {
                    const tone = machineTone(node);
                    return <button
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
                        <span className={`ControlMachineState ${tone}`}>
                            {machineStateLabel(tone, zh)}
                        </span>
                    </button>;
                })}
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
                    {visibleGroups.length} {zh ? '个群' : visibleGroups.length === 1 ? 'group' : 'groups'}
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
                    {error ? (zh ? '故障' : 'Fault') : (zh ? '正常' : 'Normal')}
                </span>
            </button>
            <button
                type='button'
                className={`ControlMachineItem ${workspace === 'terminal' ? 'selected' : ''}`}
                aria-pressed={workspace === 'terminal'}
                onClick={() => {
                    setTerminalAutoConnect(false);
                    setTerminalTransport(undefined);
                    setWorkspace('terminal');
                }}
            >
                <span className='ControlMachineIcon terminal' aria-hidden='true'>&gt;_</span>
                <span className='ControlMachineIdentity'>
                    <strong>{zh ? '终端连接' : 'Terminal connection'}</strong>
                    <small>{zh ? '受控 SSH · 输入指令' : 'Controlled SSH · command input'}</small>
                </span>
                <span className={`ControlMachineState ${terminalAvailable ? 'healthy' : 'offline'}`}>
                    {terminalAvailable ? (zh ? '正常' : 'Normal') : (zh ? '故障' : 'Fault')}
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
        const monitorTone = selectedNode?.online ? 'healthy' : 'offline';
        const monitorStatus = selectedNode?.online
            ? (zh ? '正常' : 'Normal')
            : (zh ? '故障' : 'Fault');
        return <button
            type='button'
            className='ControlServiceCard ControlRuntimeService'
            aria-label={zh ? '打开资源监视器' : 'Open resource monitor'}
            onClick={() => setInspectedServiceId('node-runtime')}
        >
            <span className={`ControlStatusDot ${monitorTone}`} aria-hidden='true'/>
            <span className='ControlRuntimeIdentity'>
                <span>{monitorStatus}</span>
                <strong>{zh ? '资源监视器' : 'Resource monitor'}</strong>
                <small>CPU · MEM · GPU · DISK · NETWORK</small>
            </span>
            <span className='ControlServiceOpen' aria-hidden='true'>›</span>
        </button>;
    };

    // eslint-disable-next-line complexity
    const renderNode = (node: ComputeClusterNode) => {
        // Dependency health belongs to the latest node snapshot. Once that
        // snapshot expires, an old green state is no longer current evidence.
        const ssh = computeSshAvailability(node);
        const lanState = node.online && ssh.lan
            ? 'healthy' : 'unavailable';
        const tailscaleState = node.online && ssh.tailscale
            ? 'healthy' : 'unavailable';
        const cameras = node.device_inventory.devices.filter(device => device.kind === 'camera');
        const edgeDevices = lanAssets.filter(asset =>
            asset.node_id === node.node_id && asset.device_kind === 'edge_compute'
        );
        const remoteLan = node.control_transport === 'tailscale';
        const hardwareModel = node.resources.hardware_model?.trim();
        const locationTag = (nodeRegions.get(node.node_id) || '').split(' / ')[0];
        const storedWorkArea = nodeTags[0] || '';
        const geographicTags = new Set([
            locationTag,
            regionDisplayName(node.labels?.region_name || node.labels?.region || '', zh),
            node.labels?.city_name || '',
            node.labels?.district_name || '',
        ].filter(Boolean));
        const customWorkArea = geographicTags.has(regionDisplayName(storedWorkArea, zh)) ? '' : storedWorkArea;
        const workAreaTag = customWorkArea || node.labels?.site_name?.trim() || '';
        return <>
            <header className='ControlNodeHeader'>
                <div>
                    <h1>{node.name}</h1>
                    <p>{zh ? '最后检查' : 'Last check'} {runtimeTime(node.resources.captured_at, zh)} · {zh ? '最近心跳' : 'Last heartbeat'} {lastSeen(node.heartbeat_age_seconds, zh)}</p>
                    <div className='ControlNodeTags' aria-label={zh ? '节点标签' : 'Node tags'}>
                        {locationTag && <span className='ControlNodeTag location'>
                            {zh ? `地域(${locationTag})` : `Region (${locationTag})`}
                        </span>}
                        {workAreaTag && <span className={`ControlNodeTag work-area${customWorkArea ? '' : ' static'}`}>
                            {zh ? `作业区(${workAreaTag})` : `Work area (${workAreaTag})`}
                            {customWorkArea && <button
                                type='button'
                                aria-label={zh ? `清除作业区 ${workAreaTag}` : `Clear work area ${workAreaTag}`}
                                title={zh ? '清除作业区' : 'Clear work area'}
                                onClick={() => removeNodeTag(node.node_id, customWorkArea)}
                            >×</button>}
                        </span>}
                        {!workAreaTag && <form
                            className='ControlNodeTagForm'
                            onSubmit={event => {
                                event.preventDefault();
                                addNodeTag(node.node_id);
                            }}
                        >
                            <input
                                value={tagDraft}
                                maxLength={NODE_TAG_MAX_LENGTH}
                                aria-label={zh ? '自定义作业区' : 'Custom work area'}
                                placeholder={zh ? '作业区' : 'Work area'}
                                onChange={event => setTagDraft(event.target.value)}
                            />
                            <button
                                type='submit'
                                disabled={!tagDraft.trim() || nodeTags.includes(tagDraft.trim())}
                                aria-label={zh ? '添加作业区' : 'Add work area'}
                                title={zh ? '添加作业区' : 'Add work area'}
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
                    <div><span>{zh ? '节点服务版本' : 'Node service version'}</span><strong>{node.agent_version && node.agent_version !== 'unknown' ? node.agent_version : '—'}</strong><small>{zh ? '计算群节点服务' : 'compute-cluster node service'}</small></div>
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
                        zh ? '仅使用局域网地址建立 SSH 连接' : 'Uses only the LAN address for SSH',
                        dependencyTone(lanState),
                        () => {
                            setTerminalAutoConnect(true);
                            setTerminalTransport('lan');
                            setWorkspace('terminal');
                        },
                    )}
                    {renderServiceCard(
                        dependencyLabel(tailscaleState, zh),
                        zh ? 'Tailscale 远程' : 'Remote Tailscale',
                        zh ? '仅使用 Tailscale 地址建立 SSH 连接' : 'Uses only the Tailscale address for SSH',
                        dependencyTone(tailscaleState),
                        () => {
                            setTerminalAutoConnect(true);
                            setTerminalTransport('tailscale');
                            setWorkspace('terminal');
                        },
                    )}
                </div>
            </section>

            <section className='ControlSection'>
                <div className='ControlSectionHeading'>
                    <div>
                        <h2>{zh ? '资源监控' : 'Resource monitoring'}</h2>
                    </div>
                </div>
                <div className='ControlServiceGrid'>{renderResourceMonitorCard()}</div>
            </section>

            <section className='ControlSection'>
                <div className='ControlSectionHeading'>
                    <div>
                        <h2>{zh ? '相关设备' : 'Related devices'}</h2>
                        <button
                            type='button'
                            className='ControlSectionCountButton'
                            aria-label={zh
                            ? `${cameras.length + edgeDevices.length} 个相关设备`
                            : `${cameras.length + edgeDevices.length} related devices`
                            }
                            title={zh ? '打开设备管理' : 'Open device management'}
                            onClick={() => setDeviceManagementTab(
                                cameras.length === 0 && edgeDevices.length > 0 ? 'edge' : 'camera',
                            )}
                        >{cameras.length + edgeDevices.length}</button>
                    </div>
                </div>
                <div className='ControlRelatedDeviceGrid'>
                    <div className='ControlRelatedDeviceGroup'>
                        <div className='ControlSubsectionHeading'>
                            <strong>{zh ? '摄像头' : 'Cameras'}</strong>
                            {cameras.length > 0 && <button
                                type='button'
                                className='ControlDeviceCountButton'
                                aria-label={zh ? '添加局域网摄像头' : 'Add LAN camera'}
                                onClick={() => updateActivePopupTypeAction?.(
                                    PopupWindowType.CAMERA_CONNECT,
                                    node.node_id,
                                    node.name,
                                    remoteLan,
                                )}
                            >＋</button>}
                        </div>
                        <div className='ControlCameraGrid'>
                            {cameras.map(camera => <button
                                type='button'
                                className='ControlCameraCard'
                                key={camera.device_id}
                                disabled={!node.online || camera.status !== 'online' || Boolean(openingCameraId)}
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
                            {cameras.length === 0 && <button
                                type='button'
                                className='ControlEmptyBlock ControlRelatedDeviceAdd'
                                aria-label={zh ? '发现并添加局域网摄像头' : 'Discover and add LAN cameras'}
                                title={node.online
                                    ? (zh ? '打开拓展引擎的连接相机' : 'Open extension-engine camera connection')
                                    : (zh ? '节点故障，恢复正常后才能扫描局域网' : 'The node must return to normal before scanning its LAN')}
                                disabled={!node.online}
                                onClick={() => updateActivePopupTypeAction?.(
                                    PopupWindowType.CAMERA_CONNECT,
                                    node.node_id,
                                    node.name,
                                    remoteLan,
                                )}
                            >{zh ? '＋ 连接局域网相机' : '+ Connect LAN camera'}</button>}
                        </div>
                        {cameraError && <div className='ControlCameraError' role='status'>{cameraError}</div>}
                    </div>
                    <div className='ControlRelatedDeviceGroup'>
                        <div className='ControlSubsectionHeading'>
                            <strong>{zh ? '边缘计算设备' : 'Edge computing devices'}</strong>
                            {edgeDevices.length > 0 && <button
                                type='button'
                                className='ControlDeviceCountButton'
                                aria-label={zh ? '添加设备' : 'Add device'}
                                title={zh ? '添加设备' : 'Add device'}
                                onClick={() => updateActivePopupTypeAction?.(
                                    PopupWindowType.JETSON_CONNECT,
                                    node.node_id,
                                    node.name,
                                    remoteLan,
                                )}
                            >＋</button>}
                        </div>
                        <div className='ControlCameraGrid'>
                            {edgeDevices.map(device => <div className='ControlCameraCard' key={device.asset_id}>
                                <div className='ControlCameraIcon' aria-hidden='true'>
                                    {device.device_model?.toLowerCase().includes('jetson')
                                        ? <img src='/ico/jetson-agx-orin.png' alt='Jetson'/>
                                        : '◆'}
                                </div>
                                <div className='ControlCameraIdentity'>
                                    <strong>{device.display_name || device.hostname || device.address}</strong>
                                    <small>{device.device_model || device.address} · {device.address}</small>
                                    <span className={device.online ? 'healthy' : 'offline'}>
                                        <i/> {device.online ? (zh ? '正常' : 'Normal') : (zh ? '故障' : 'Fault')}
                                    </span>
                                </div>
                            </div>)}
                            {edgeDevices.length === 0 && <button
                                type='button'
                                className='ControlEmptyBlock ControlRelatedDeviceAdd'
                                aria-label={zh ? '发现并添加局域网边缘计算设备' : 'Discover and add LAN edge devices'}
                                onClick={() => updateActivePopupTypeAction?.(
                                    PopupWindowType.JETSON_CONNECT,
                                    node.node_id,
                                    node.name,
                                    remoteLan,
                                )}
                            >{zh ? '＋ 连接 NVIDIA Jetson' : '+ Connect NVIDIA Jetson'}</button>}
                        </div>
                    </div>
                </div>
            </section>

            {deviceManagementTab && <DeviceManagementPopup
                language={language}
                node={node}
                cameras={cameras}
                edgeDevices={edgeDevices}
                initialTab={deviceManagementTab}
                onClose={() => setDeviceManagementTab(null)}
                onAddCamera={() => {
                    setDeviceManagementTab(null);
                    updateActivePopupTypeAction?.(
                        PopupWindowType.CAMERA_CONNECT,
                        node.node_id,
                        node.name,
                        remoteLan,
                    );
                }}
                onDiscoverEdge={() => {
                    setDeviceManagementTab(null);
                    updateActivePopupTypeAction?.(
                        PopupWindowType.JETSON_CONNECT,
                        node.node_id,
                        node.name,
                        remoteLan,
                    );
                }}
                onCamerasChanged={() => void refresh()}
            />}
        </>;
    };

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
        ? (zh ? '正常' : 'Normal')
        : (zh ? '故障' : 'Fault');
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
            </>}
            renderContent={sidePanel === 'features' ? renderFeatureList : renderMachineList}
        />
        <main className='EditorWrapper ControlCenterWorkspace'>
            <div className='EditorTopNavigationBar ControlTopNavigationBar'>
                <div className='ControlToolbarGroup'>
                    {toolbarTone && <span className={`ControlStatusDot ${toolbarTone}`} aria-hidden='true'/>}
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
                        ? `${visibleGroups.length} ${zh ? '个群' : visibleGroups.length === 1 ? 'group' : 'groups'}`
                        : `${normalCount} / ${nodes.length} ${zh ? '正常' : 'normal'}`}</span>
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
                            <span>{visibleGroups.length}</span>
                        </div>
                        {visibleGroups.length
                            ? <div className='ControlServiceGrid' aria-label={zh ? '当前群列表' : 'Current groups'}>
                                {visibleGroups.map(group => <article className='ControlServiceCard' key={group.group_id}>
                                    <span className={`ControlStatusDot ${currentGroupTone}`} aria-hidden='true'/>
                                    <div>
                                        <span>{zh ? `序号 ${group.index}` : `Index ${group.index}`} · {group.scope === 'central'
                                            ? (zh ? '中央群' : 'Central')
                                            : (zh ? '本地群' : 'Local')}</span>
                                        <strong>{group.group_name || group.group_id}</strong>
                                        <small>{group.group_id}</small>
                                    </div>
                                </article>)}
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
                        preferredTransport={terminalTransport}
                        autoConnect={terminalAutoConnect}
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
                    {(error || graphError) && dismissedRefreshWarningKey !== refreshWarningKey && <div className='ControlRefreshWarning' role='status'>
                        <span>{error
                                ? (zh ? '本次刷新失败，正在显示上一次数据：' : 'Refresh failed; showing the last snapshot: ')
                                : overviewView === 'map'
                                    ? (zh ? '地域数据刷新失败，正在显示上一次数据：' : 'Region data refresh failed; showing the last snapshot: ')
                                    : (zh ? '图谱刷新失败，正在显示上一次数据：' : 'Graph refresh failed; showing the last snapshot: ')}
                            {error || graphError}</span>
                        <button
                            type='button'
                            aria-label={zh ? '关闭刷新失败提示' : 'Dismiss refresh warning'}
                            title={zh ? '关闭提示' : 'Dismiss warning'}
                            onClick={() => setDismissedRefreshWarningKey(refreshWarningKey)}
                        >×</button>
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
                    <div className='ControlNodeContent'>
                        {error && dismissedRefreshWarningKey !== refreshWarningKey && <div className='ControlRefreshWarning' role='status'>
                            <span>{zh ? '本次刷新失败，正在显示上一次数据：' : 'Refresh failed; showing the last snapshot: '}{error}</span>
                            <button
                                type='button'
                                aria-label={zh ? '关闭刷新失败提示' : 'Dismiss refresh warning'}
                                title={zh ? '关闭提示' : 'Dismiss warning'}
                                onClick={() => setDismissedRefreshWarningKey(refreshWarningKey)}
                            >×</button>
                        </div>}
                        {renderNode(selectedNode)}
                    </div>
                </>}
            </div>
        </main>
        {selectedNode && inspectedServiceId && <div
            className={`ControlResourceMonitorBackdrop${monitorMaximized ? ' maximized' : ''}`}
            onMouseDown={event => {
                if (event.target === event.currentTarget) setInspectedServiceId('');
            }}
        >
            <section
                className={`ControlResourceMonitor${monitorMaximized ? ' maximized' : ''}`}
                role='dialog'
                aria-modal='true'
                aria-label={zh ? `${selectedNode.name} 资源监视器` : `${selectedNode.name} resource monitor`}
            >
                <header>
                    <div>
                        <span>{zh ? '资源监视器' : 'Resource Monitor'}</span>
                        <h2>{selectedNode.name}</h2>
                        <p>{zh ? '资源随节点心跳刷新' : 'Resources refresh with the node heartbeat'}
                        {' · '}{runtimeTime(selectedNode.resources.captured_at, zh)}</p>
                    </div>
                    <div className='ComputeClusterHeaderActions'>
                        <button
                            type='button'
                            className={`window-toggle ${monitorMaximized ? 'restore' : 'maximize'}`}
                            aria-label={monitorMaximized
                                ? (zh ? '还原资源监视器窗口' : 'Restore resource monitor window')
                                : (zh ? '放大资源监视器窗口' : 'Maximize resource monitor window')}
                            aria-pressed={monitorMaximized}
                            onClick={() => setMonitorMaximized(current => !current)}
                        ><i aria-hidden='true'/></button>
                        <button
                            type='button'
                            className='close'
                            autoFocus
                            aria-label={zh ? '关闭资源监视器' : 'Close resource monitor'}
                            onClick={() => setInspectedServiceId('')}
                        >×</button>
                    </div>
                </header>

                <div className='ControlMonitorWorkspace'>
                    <nav className='ControlMonitorNav' aria-label={zh ? '资源监视器导航' : 'Resource monitor navigation'}>
                        {([
                            ['performance', zh ? '性能' : 'Performance'],
                            ['processes', zh ? '进程' : 'Processes'],
                            ['tasks', zh ? '任务' : 'Tasks'],
                            ['conversations', zh ? '对话' : 'Conversations'],
                            ['startup', zh ? '启动应用' : 'Startup apps'],
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
                            <header className='ControlMonitorSearchHeader'>
                                <h3>{zh ? '进程' : 'Processes'}</h3>
                                <div className='ControlMonitorSearchTools'>
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
                            <header className='ControlMonitorSearchHeader'>
                                <h3>{zh ? '启动应用' : 'Startup apps'}</h3>
                                <div className='ControlMonitorSearchTools'>
                                    <input
                                        type='search'
                                        value={startupQuery}
                                        aria-label={zh ? '搜索启动应用' : 'Search startup apps'}
                                        placeholder={zh ? '搜索名称、标识、状态或类型' : 'Search name, identifier, status, or type'}
                                        onChange={event => setStartupQuery(event.target.value)}
                                    />
                                    <span>{startupQuery.trim() ? `${sortedStartupServices.length}/${runtimeInventory.startup_services.length}` : runtimeInventory.startup_services.length}</span>
                                </div>
                            </header>
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
                                    <td>{startupServiceName(service, zh)}</td>
                                    <td>{startupServiceIdentifier(service)}</td>
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
                                <header className='ControlMonitorSearchHeader'>
                                    <h3>{zh ? '提交任务' : 'Submitted tasks'}</h3>
                                    <div className='ControlMonitorSearchTools'>
                                        <input
                                            type='search'
                                            value={taskQuery}
                                            aria-label={zh ? '搜索任务' : 'Search tasks'}
                                            placeholder={zh ? '搜索任务编号、名称、设备或状态' : 'Search task ID, name, device, or status'}
                                            onChange={event => setTaskQuery(event.target.value)}
                                        />
                                        <span>{taskQuery.trim() ? `${sortedTaskHistory.length}/${taskHistory.length}` : taskHistory.length}</span>
                                    </div>
                                </header>
                                {taskHistoryError && <p className='ControlMonitorHistoryError' role='status'>{taskHistoryError}</p>}
                                {taskHistoryLoading && taskHistory.length === 0 ? <div className='ControlMonitorUnavailable'>
                                    <strong>{zh ? '正在读取任务…' : 'Loading tasks…'}</strong>
                                </div> : taskHistory.length === 0 ? <div className='ControlMonitorUnavailable'>
                                    <strong>{zh ? '暂无提交任务' : 'No submitted tasks'}</strong>
                                </div> : sortedTaskHistory.length === 0 ? <div className='ControlMonitorUnavailable'>
                                    <strong>{zh ? '未找到匹配任务' : 'No matching tasks'}</strong>
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
                                    <tbody>{sortedTaskHistory.map(task => <tr key={task.taskId}>
                                        <td><strong>{taskTypeLabel(task.taskType, zh)}</strong><small>{task.taskId}</small></td>
                                        <td>{task.device}</td>
                                        <td><span className={`ControlTaskHistoryState ${task.state}`}>{taskStateLabel(task.state, zh)}</span></td>
                                        <td>{runtimeTime(task.updatedAt, zh)}</td>
                                    </tr>)}</tbody>
                                </table>}
                        </section>}

                        {monitorView === 'conversations' && <section
                            className='ControlMonitorConversationHistory ControlMonitorStandaloneHistory'
                            aria-label={zh ? '过往对话' : 'Past conversations'}
                        >
                                <header className='ControlMonitorSearchHeader'>
                                    <h3>{zh ? '过往对话' : 'Past conversations'}</h3>
                                    <div className='ControlMonitorSearchTools'>
                                        <input
                                            type='search'
                                            value={conversationQuery}
                                            aria-label={zh ? '搜索对话' : 'Search conversations'}
                                            placeholder={zh ? '搜索标题或会话 ID' : 'Search title or conversation ID'}
                                            onChange={event => setConversationQuery(event.target.value)}
                                        />
                                        <span>{conversationQuery.trim()
                                            ? `${filteredConversationHistory.length}/${conversationHistory.length}`
                                            : conversationHistory.length}</span>
                                    </div>
                                </header>
                                {conversationHistoryError && <p className='ControlMonitorHistoryError' role='status'>{conversationHistoryError}</p>}
                                {conversationHistoryLoading && conversationHistory.length === 0 ? <div className='ControlMonitorUnavailable'>
                                    <strong>{zh ? '正在读取对话…' : 'Loading conversations…'}</strong>
                                </div> : conversationHistory.length === 0 ? <div className='ControlMonitorUnavailable'>
                                    <strong>{zh ? '暂无对话记录' : 'No conversation history'}</strong>
                                </div> : filteredConversationHistory.length === 0 ? <div className='ControlMonitorUnavailable'>
                                    <strong>{zh ? '未找到匹配对话' : 'No matching conversations'}</strong>
                                </div> : <div className='ControlConversationWorkspace'>
                                    <nav className='ControlConversationList' aria-label={zh ? '历史对话列表' : 'Conversation history list'}>
                                        {filteredConversationHistory.map(conversation => <button
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
                                        {conversationMessages.length > 0 ? conversationMessages.map(message => {
                                            const persistedTaskId = typeof message.metadata.task_id === 'string'
                                                ? message.metadata.task_id
                                                : undefined;
                                            const {body, taskId} = splitTaskIdLine(
                                                conversationMessage(message.content),
                                                persistedTaskId,
                                                message.role === 'assistant' ? message.id : undefined,
                                                zh,
                                            );
                                            return <article key={message.id} className={message.role}>
                                                <span>{message.role === 'user' ? (zh ? '我' : 'Me') : message.role === 'assistant' ? 'Agent' : message.role}</span>
                                                <div className='ControlConversationMessageContent'>
                                                    {message.role === 'assistant' ? markdownMessage(body) : body}
                                                </div>
                                                {taskId && <small className='ControlConversationTaskId'>{taskId}</small>}
                                            </article>;
                                        }) : <p>{zh ? '暂无消息' : 'No messages'}</p>}
                                    </div>
                                </div>}
                        </section>}

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

export default connect(mapStateToProps, {
    updateActivePopupTypeAction: updateActivePopupType,
})(ControlCenterView);
