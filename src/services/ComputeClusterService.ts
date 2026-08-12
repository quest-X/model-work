import {getExtensionEngineBaseUrl} from '../utils/DefaultBackendUrl';

export type ComputeGpuResource = {
    index: number;
    uuid: string;
    name: string;
    memory_total_mb: number;
    memory_used_mb: number;
    utilization_percent: number;
};

export type ComputeNodeResources = {
    captured_at: number;
    platform: string;
    architecture: string;
    cpu_logical: number;
    load_average_1m: number | null;
    memory_total_bytes: number | null;
    memory_available_bytes: number | null;
    disk_total_bytes: number;
    disk_free_bytes: number;
    gpus: ComputeGpuResource[];
};

export type ComputeManagedDevice = {
    device_id: string;
    kind: 'camera';
    provider: 'camera-connect';
    name: string;
    model?: string | null;
    status: 'registered' | 'online' | 'offline' | 'unavailable';
    channels: number;
    capabilities: string[];
};

export type ComputeDeviceInventory = {
    state: 'disabled' | 'ready' | 'unavailable';
    devices: ComputeManagedDevice[];
    error?: string | null;
};

export type ComputeNetworkDependency = {
    dependency_id: 'tailscale' | 'control_ssh' | 'public_http';
    kind: 'overlay_network' | 'control_transport' | 'internet_egress';
    state: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
    checked_at: number;
    required_for: ComputeTaskType[];
};

export type ComputeClusterNode = {
    node_id: string;
    installation_id: string;
    name: string;
    agent_version: string;
    capabilities: string[];
    network: {
        provider: 'tailscale';
        installed: boolean;
        online: boolean;
        ssh_available?: boolean;
        backend_state?: string | null;
        self_name?: string | null;
        addresses: string[];
        tailnet?: string | null;
        error?: string | null;
    };
    network_dependencies: ComputeNetworkDependency[];
    resources: ComputeNodeResources;
    device_inventory: ComputeDeviceInventory;
    enrolled_at: number;
    last_seen_at: number;
    enabled: boolean;
    online: boolean;
    heartbeat_age_seconds: number;
    lan_scan_targets?: ComputeLanScanTarget[];
};

export type ComputeClusterStatus = {
    state: string;
    version: string;
    protocol_version: number;
    group_id?: string;
    admin_configured: boolean;
    task_control?: {
        enabled: boolean;
        allowed_task_types: string[];
        resource_orchestration?: boolean;
        work_agent_execution?: boolean;
        resource_knowledge_graph?: boolean;
        graph_schema?: 'resource-knowledge-graph.v2';
        graph_interaction?: boolean;
        network_dependency_health?: boolean;
        managed_device_inventory?: boolean;
        lan_discovery?: boolean;
        lan_asset_inventory?: boolean;
        evidence_projection?: 'metadata-only-v1';
        placement_modes?: ('automatic' | 'manual')[];
    };
    nodes: {total: number; online: number; gpu_total: number; device_total: number};
};

export type ComputeTaskMode = 'online' | 'background';
export type ComputeTaskState = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
export type ComputeTaskType = 'system.wait' | 'information.web_fetch' | 'network.lan_discovery';

export type ComputeLanScanTarget = {
    interface: string;
    address: string;
    cidr: string;
    prefix_length: number;
    interface_cidr: string;
    narrowed: boolean;
    address_count: number;
};

export type ComputeLanDiscoveryResult = {
    schema_version: 'lan-discovery.console-result.v1';
    scan_id: string;
    cidr: string;
    interface: string;
    started_at: number;
    finished_at: number;
    addresses_scanned: number;
    host_count: number;
    ports_scanned: number[];
    hosts: {address: string; hostname: string; mac: string; ports: {port: number; service: string}[]}[];
    truncated: boolean;
};

export type ComputeLanScanTargetsResponse = {
    version: 1;
    group_id: string;
    nodes: {node_id: string; node_name: string; targets: ComputeLanScanTarget[]}[];
};

export type ComputeLanAsset = {
    asset_id: string;
    node_id: string;
    node_name: string;
    cidr: string;
    address: string;
    hostname: string;
    mac: string;
    ports: {port: number; service: string}[];
    online: boolean;
    first_seen_at: number;
    last_seen_at: number;
    last_changed_at: number;
    change_type: 'new' | 'changed' | 'unchanged' | 'offline';
};

export type ComputeLanAssetsResponse = {
    version: 1;
    group_id: string;
    summary: {
        total: number;
        online: number;
        offline: number;
        new: number;
        changed: number;
        networks: number;
    };
    latest_scans: {
        scan_id: string;
        task_id: string;
        node_id: string;
        node_name: string;
        cidr: string;
        interface: string;
        started_at: number;
        finished_at: number;
        addresses_scanned: number;
        host_count: number;
        truncated: boolean;
        changes: {new: number; changed: number; offline: number; unchanged: number};
    }[];
    assets: ComputeLanAsset[];
};

export type ComputeWebFetchResult = {
    schema_version: 'webfetch.console-result.v1';
    request_id: string;
    status: 'fetched' | 'partial' | 'blocked' | 'failed';
    reason_code: string;
    provider: string;
    requested_url: string;
    final_url: string;
    fetched_at: string;
    title: string;
    author: string;
    published_at: string;
    meaningful_chars: number;
    content_sha256: string;
    warnings: string[];
    attempt_count: number;
};

export type ComputeResourceRequest = {
    cpu_cores: number;
    memory_bytes: number;
    disk_bytes: number;
    gpu_count: number;
    gpu_memory_mb: number;
    required_capabilities?: string[];
    required_network_dependencies?: string[];
    required_labels?: Record<string, string>;
};

export type ComputeResourceCapacity = Pick<ComputeResourceRequest,
    'cpu_cores' | 'memory_bytes' | 'disk_bytes' | 'gpu_count' | 'gpu_memory_mb'>;

export type ComputeTask = {
    task_id: string;
    node_id: string;
    node_name: string;
    task_type: ComputeTaskType;
    mode: ComputeTaskMode;
    state: ComputeTaskState;
    created_at: number;
    updated_at: number;
    lease_seconds: number;
    lease_expires_at?: number | null;
    control_request?: 'pause' | 'cancel' | null;
    checkpoint?: Record<string, unknown> | null;
    progress?: {completed?: number; total?: number; unit?: string; percent?: number} | null;
    result?: {elapsed_seconds: number} | ComputeWebFetchResult | ComputeLanDiscoveryResult | null;
    error?: string | null;
    attempt: number;
    parameters: {seconds?: number; url?: string; cidr?: string};
    resources?: Partial<ComputeResourceRequest>;
    placement?: {
        mode: 'automatic' | 'manual';
        policy?: 'most-available-v1' | null;
        reserved: boolean;
        created_at?: number | null;
    };
};

export type ComputeTasksResponse = {
    version: number;
    group_id: string;
    tasks: ComputeTask[];
    total: number;
    counts: Partial<Record<ComputeTaskState, number>>;
    nodes: {node_id: string; available: boolean; error?: string | null}[];
};

export type ComputeSchedulerResponse = {
    version: number;
    group_id: string;
    policy: 'most-available-v1';
    online_nodes: number;
    totals: ComputeResourceCapacity;
    reserved: ComputeResourceCapacity;
    available: ComputeResourceCapacity;
    active_allocations: number;
    allocations: {
        task_id: string;
        node_id: string;
        node_name?: string | null;
        node_online: boolean;
        request: ComputeResourceRequest;
        created_at: number;
        mode: 'automatic' | 'manual';
    }[];
};

export type ComputeResourceGraphEntity = {
    entity_id: string;
    kind: 'compute_group' | 'compute_node' | 'compute_resource' | 'work_agent' | 'managed_device' | 'network_dependency';
    label: string;
    state: 'available' | 'degraded' | 'unavailable';
    callable: boolean;
    node_id?: string | null;
    task_type?: ComputeTaskType | null;
    capability?: string | null;
    category?: 'diagnostic' | 'information' | null;
    platform?: string | null;
    architecture?: string | null;
    cpu_logical?: number | null;
    memory_available_bytes?: number | null;
    disk_free_bytes?: number | null;
    gpu_count?: number | null;
    modes: ComputeTaskMode[];
    available_node_count?: number | null;
    provider?: string | null;
    device_kind?: string | null;
    device_status?: string | null;
    channels?: number | null;
    device_model?: string | null;
    device_capabilities?: string[];
    dependency_id?: string | null;
    dependency_kind?: string | null;
    checked_at?: number | null;
    required_for?: ComputeTaskType[];
    required_network_dependencies?: string[];
    recommended_resources?: ComputeResourceRequest | null;
};

export type ComputeResourceGraphRelation = {
    relation_id: string;
    kind: 'contains' | 'provides' | 'can_execute' | 'manages' | 'depends_on';
    source_id: string;
    target_id: string;
    active: boolean;
    reason: 'available' | 'node_offline' | 'capability_missing' | 'scan_target_unavailable' | 'dependency_unavailable' | 'not_console_allowlisted';
};

export type ComputeResourceGraph = {
    schema_version: 'resource-knowledge-graph.v2';
    group_id: string;
    generated_at: number;
    summary: {
        entities: number;
        relations: number;
        online_nodes: number;
        compute_resources: number;
        managed_devices: number;
        network_dependencies: number;
        healthy_network_dependencies: number;
        work_agents: number;
        callable_work_agents: number;
        interactive_work_agents: number;
    };
    entities: ComputeResourceGraphEntity[];
    relations: ComputeResourceGraphRelation[];
};

const baseUrl = (): string =>
    `${getExtensionEngineBaseUrl()}/extensions/compute-cluster`;

const request = async <T>(path: string, signal?: AbortSignal, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${baseUrl()}${path}`, {
        ...init,
        signal,
        headers: {
            ...(init.body ? {'Content-Type': 'application/json'} : {}),
            ...(init.headers || {}),
        },
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`);
    }
    return response.json();
};

export class ComputeClusterService {
    public static status(signal?: AbortSignal): Promise<ComputeClusterStatus> {
        return request('/status', signal);
    }

    public static async nodes(signal?: AbortSignal): Promise<ComputeClusterNode[]> {
        const response = await request<{nodes: ComputeClusterNode[]}>('/nodes', signal);
        return response.nodes;
    }

    public static tasks(signal?: AbortSignal): Promise<ComputeTasksResponse> {
        return request('/tasks', signal);
    }

    public static scheduler(signal?: AbortSignal): Promise<ComputeSchedulerResponse> {
        return request('/scheduler', signal);
    }

    public static resourceGraph(signal?: AbortSignal): Promise<ComputeResourceGraph> {
        return request('/resource-graph', signal);
    }

    public static lanScanTargets(signal?: AbortSignal): Promise<ComputeLanScanTargetsResponse> {
        return request('/lan-scan-targets', signal);
    }

    public static lanAssets(signal?: AbortSignal): Promise<ComputeLanAssetsResponse> {
        return request('/lan-assets', signal);
    }

    public static submitTask(
        input: {
            node_id?: string;
            task_type?: ComputeTaskType;
            mode: ComputeTaskMode;
            seconds?: number;
            url?: string;
            cidr?: string;
            lease_seconds?: number;
            resources?: ComputeResourceCapacity;
        },
        signal?: AbortSignal,
    ): Promise<ComputeTask> {
        return request('/tasks', signal, {
            method: 'POST',
            body: JSON.stringify({
                ...input,
                task_type: input.task_type ?? 'system.wait',
                lease_seconds: input.lease_seconds ?? 60,
            }),
        });
    }

    public static controlTask(
        task: Pick<ComputeTask, 'node_id' | 'task_id'>,
        action: 'heartbeat' | 'pause' | 'resume' | 'cancel',
        signal?: AbortSignal,
    ): Promise<ComputeTask> {
        const nodeId = encodeURIComponent(task.node_id);
        const taskId = encodeURIComponent(task.task_id);
        return request(`/tasks/${nodeId}/${taskId}/${action}`, signal, {
            method: 'POST',
            body: '{}',
        });
    }
}
