import {getExtensionEngineBaseUrl} from '../utils/DefaultBackendUrl';
import {sha256Bytes} from '../utils/Sha256';
import {ApprovalRequest, authorizationChallenge, canonicalAuthorizationJson, getApprovalIdentity, sensitiveRequestDigest, SignedApproval, signAuthorization} from './ApprovalIdentityService';
import type {
    CameraConnectionProfile,
    CameraConnectResult,
    CameraDiscoveryResponse,
    CameraResource,
} from './CameraResourceService';

export type ComputeGpuResource = {
    index: number;
    uuid: string;
    name: string;
    memory_total_mb: number;
    memory_used_mb: number;
    utilization_percent: number;
    temperature_celsius?: number | null;
};

export type ComputeNodeResources = {
    captured_at: number;
    platform: string;
    architecture: string;
    hardware_model?: string | null;
    cpu_logical: number;
    cpu_percent?: number | null;
    load_average_1m: number | null;
    memory_total_bytes: number | null;
    memory_available_bytes: number | null;
    disk_total_bytes: number;
    disk_free_bytes: number;
    disk_read_bytes_per_second?: number | null;
    disk_write_bytes_per_second?: number | null;
    network_receive_bytes_per_second?: number | null;
    network_send_bytes_per_second?: number | null;
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

export const cameraStreamingAvailable = (camera: ComputeManagedDevice): boolean =>
    (camera.status === 'registered' || camera.status === 'online')
    && camera.capabilities.includes('camera.stream.v1');

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
    role?: 'main' | 'node';
    agent_version: string;
    capabilities: string[];
    control_transport?: 'lan' | 'tailscale' | null;
    communication_state?: 'normal' | 'fault' | 'abnormal' | null;
    network: {
        provider: 'tailscale';
        installed: boolean;
        online: boolean;
        ssh_available?: boolean;
        lan_ssh_available?: boolean | null;
        tailscale_ssh_available?: boolean | null;
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
    labels?: Record<string, string>;
};

export const computeSshAvailability = (node: ComputeClusterNode): {lan: boolean; tailscale: boolean} => {
    const dependency = (id: ComputeNetworkDependency['dependency_id']) =>
        node.network_dependencies.find(item => item.dependency_id === id)?.state;
    const controlSshHealthy = node.network.ssh_available === true
        && (!dependency('control_ssh') || dependency('control_ssh') === 'healthy');
    return {
        lan: node.network.lan_ssh_available
            ?? Boolean(controlSshHealthy && node.control_transport === 'lan'),
        tailscale: node.network.tailscale_ssh_available
            ?? Boolean(controlSshHealthy && node.network.online
                && (!dependency('tailscale') || dependency('tailscale') === 'healthy')),
    };
};

export type ComputeCommunicationState = 'normal' | 'fault' | 'abnormal';

export const aggregateCommunicationStates = (states: ComputeCommunicationState[]): ComputeCommunicationState =>
    states.length && states.every(state => state === 'normal') ? 'normal'
        : states.length && states.every(state => state === 'abnormal') ? 'abnormal' : 'fault';

export const computeLinkStates = (node?: ComputeClusterNode): {lan: ComputeCommunicationState; tailscale: ComputeCommunicationState} => {
    if (node?.communication_state === 'abnormal') return {lan: 'abnormal', tailscale: 'abnormal'};
    if (!node || !node.online || node.network.error || node.communication_state === 'fault') {
        return {lan: 'fault', tailscale: 'fault'};
    }
    const ssh = computeSshAvailability(node);
    const state = (available: boolean, observed?: boolean | null): ComputeCommunicationState =>
        available ? 'normal' : observed === false ? 'abnormal' : 'fault';
    return {
        lan: state(ssh.lan, node.network.lan_ssh_available),
        tailscale: state(ssh.tailscale, node.network.tailscale_ssh_available),
    };
};

export const computeNodeState = (node?: ComputeClusterNode): ComputeCommunicationState =>
    aggregateCommunicationStates(Object.values(computeLinkStates(node)));

export const communicationStateLabel = (state: ComputeCommunicationState, zh: boolean): string => ({
    normal: zh ? '正常' : 'Normal', fault: zh ? '故障' : 'Fault', abnormal: zh ? '异常' : 'Abnormal',
}[state]);

export const computeNodeNormal = (node: ComputeClusterNode): boolean => computeNodeState(node) === 'normal';

export const computeNodeLabel = (node: ComputeClusterNode | undefined, zh: boolean): string =>
    communicationStateLabel(computeNodeState(node), zh);

export type ComputeRuntimeState = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

export type ComputeRuntimeService = {
    service_id: string;
    name: string;
    kind: 'service' | 'worker';
    state: ComputeRuntimeState;
    version: string | null;
    uptime_seconds: number | null;
    restart_count: number | null;
    health: {
        state: ComputeRuntimeState;
        checked_at: number;
        status_code: number | null;
        latency_ms: number | null;
    };
    process: {
        pid: number | null;
        state: 'running' | 'stopped' | 'unknown';
    } | null;
    task_counts?: Record<string, number>;
    execution?: {
        available: boolean;
        pid: number | null;
        task_id: string | null;
        error: string | null;
        gpu_uuids?: string[];
        last_exit: {task_id: string | null; recorded_at: number; attempt: number; pid: number | null; exit_code: number | null; reason: string | null} | null;
    };
};

export type ComputeRuntimeSnapshot = {
    schema_version: 'runtime.snapshot.v1';
    captured_at: number;
    summary: {
        total: number;
        healthy: number;
        degraded: number;
        unavailable: number;
        task_counts: Record<string, number>;
    };
    services: ComputeRuntimeService[];
};

export type ComputeRuntimeInventory = {
    schema_version: 'runtime.inventory.v1';
    captured_at: number;
    processes_available: boolean;
    processes: {
        pid: number;
        name: string;
        cpu_percent: number | null;
        memory_bytes: number;
        state: 'running' | 'sleeping' | 'stopped' | 'zombie' | 'unknown';
    }[];
    startup_services_available: boolean;
    startup_services: {
        name: string;
        display_name: string;
        state: 'running' | 'stopped' | 'paused' | 'pending' | 'unknown';
        start_type: 'automatic';
    }[];
};

export type ComputeRuntimeEvent = {
    cursor: number;
    created_at: number;
    service_id: string;
    level: 'info' | 'warning' | 'error';
    event_type: string;
    message: string;
    task_id: string | null;
};

export type ComputeRuntimeEvents = {
    schema_version: 'runtime.events.v1';
    captured_at: number;
    cursor: number;
    events: ComputeRuntimeEvent[];
    has_more: boolean;
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
        graph_schema?: 'resource-knowledge-graph.v2' | 'resource-knowledge-graph.v3';
        graph_interaction?: boolean;
        network_dependency_health?: boolean;
        managed_device_inventory?: boolean;
        lan_discovery?: boolean;
        lan_asset_inventory?: boolean;
        lan_discovery_schedules?: boolean;
        phase7_complete?: boolean;
        cross_region_recovery?: boolean;
        terminal_sessions?: boolean;
        phase8_terminal?: boolean;
        evidence_projection?: 'metadata-only-v1';
        placement_modes?: ('automatic' | 'manual')[];
    };
    nodes: {total: number; online: number; gpu_total: number; device_total: number};
};

export type ComputeGroupMembership = {
    index: number;
    group_id: string;
    group_name: string | null;
    owner_name: string | null;
    relationship: 'owner' | 'member';
    scope: 'central' | 'local';
    joined_at: number;
    credential_types: ('owner_identity' | 'owner_trust' | 'cluster_credential')[];
};

export type ComputeGroupMemberships = {
    schema_version: 'group-memberships.v1';
    group_count: number;
    groups: ComputeGroupMembership[];
};

export type ComputeFilesystemOperation = 'filesystem.stat' | 'filesystem.list';

export type ComputeFilesystemTarget = {
    kind: 'path';
    path: string;
    source: {kind: 'known_folder'; id: 'public_desktop'};
};

export type ComputeFilesystemAuthorization = {
    version: 1;
    purpose: 'model-work-node.user-authorization.v1';
    authorization_id: string;
    user_id: string;
    user_name: string;
    user_public_key: string;
    target_installation_id: string;
    operation: ComputeFilesystemOperation;
    target: ComputeFilesystemTarget;
    parameters: {limit?: number};
    nonce: string;
    issued_at: number;
    expires_at: number;
    state: 'pending' | 'approved' | 'executing' | 'succeeded' | 'failed' | 'rejected' | 'expired';
    error_code: string | null;
    node_name?: string;
};

export type ComputeFilesystemEntry = {
    name: string;
    type: 'file' | 'directory' | 'symlink' | 'other';
    size: number;
    modified_at: number;
};

export type ComputeFilesystemResult = {
    schema_version: 'filesystem.list-result.v1';
    target: ComputeFilesystemTarget;
    entries: ComputeFilesystemEntry[];
    total: number;
    truncated: boolean;
} | {
    schema_version: 'filesystem.stat-result.v1';
    target: ComputeFilesystemTarget;
    entry: ComputeFilesystemEntry;
};

export type ComputeFilesystemAuthorizationRequest = {
    operation: ComputeFilesystemOperation;
    target: {kind: 'known_folder'; id: 'public_desktop'};
    parameters: {limit?: number};
    user: {user_id: string; user_name: string; user_public_key: string};
    ttl_seconds: number;
};

export type ComputeFilesystemDecision = {
    authorization: ComputeFilesystemAuthorization & {state: 'succeeded'};
    result: ComputeFilesystemResult;
};

export type ComputeUpgradeManifest = {
    version: 1;
    purpose: 'model-work-node.ota-release.v1';
    release_version: string;
    minimum_node_version: string;
    source_revision: string;
    platform: 'linux' | 'windows';
    architecture: 'x86_64' | 'aarch64';
    artifact_url: string;
    sha256: string;
    size_bytes: number;
    signature: string;
};

export type ComputeUpgradeState = 'queued' | 'draining' | 'downloading' | 'prepared'
    | 'installing' | 'checking' | 'rolling_back' | 'recovery_required' | 'succeeded'
    | 'rolled_back' | 'failed' | 'cancelled';

export type ComputeUpgradeEvent = {
    event_id: number;
    state: ComputeUpgradeState;
    created_at: number;
    error_code: string | null;
};

export type ComputeUpgradeResult = {
    job_id: string;
    state: ComputeUpgradeState;
    created_at: number;
    updated_at: number;
    drain_deadline: number;
    error_code: string | null;
    health_task_id: string | null;
    release_version: string;
    events?: ComputeUpgradeEvent[];
    events_truncated?: boolean;
};

export type ComputeUpgradeAuthorization = ApprovalRequest & {
    operation: 'node.upgrade';
    target: {
        kind: 'node_upgrade';
        release_version: string;
        platform: 'linux' | 'windows';
        architecture: 'x86_64' | 'aarch64';
    };
    parameters: {
        job_id: string;
        source_revision: string;
        artifact_sha256: string;
        artifact_size_bytes: number;
        manifest_sha256: string;
        drain_timeout_seconds: number;
    };
    state: 'pending' | 'approved' | 'executing' | 'succeeded' | 'failed' | 'rejected' | 'expired';
    error_code: string | null;
    node_name?: string;
};

export type ComputeUpgradeBatchNode = {
    node_id: string;
    job_id: string;
    manifest: ComputeUpgradeManifest;
    authorization_id: string | null;
    authorization: ComputeUpgradeAuthorization | null;
    delivery_started_at?: number;
    state: 'awaiting_authorization' | 'approval_submitting' | 'rejected'
        | ComputeUpgradeResult['state'];
    error_code: string | null;
    result: ComputeUpgradeResult | null;
};

export type ComputeUpgradeBatch = {
    batch_id: string;
    release_version: string;
    state: 'awaiting_authorization' | 'authorized' | 'approval_submitting' | 'running' | 'succeeded' | 'failed';
    current_index: number;
    created_at: number;
    updated_at: number;
    delivery_started_at?: number;
    error_code: string | null;
    drain_timeout_seconds: number;
    ttl_seconds: number;
    expires_at: number;
    user: {user_id: string; user_name: string; user_public_key: string};
    nodes: ComputeUpgradeBatchNode[];
};

export type ComputeTaskMode = 'online' | 'background';
export type ComputeTaskState = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
export type ComputeTaskType = 'system.wait'
    | 'information.web_fetch'
    | 'network.lan_discovery'
    | 'network.peer_probe'
    | 'camera.connect';

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

export type ComputePeerProbeResult = {
    schema_version: 'peer-probe.console-result.v1';
    peer_id: string;
    transport: 'tailscale';
    path: 'direct' | 'relay' | 'unavailable';
    reachable: boolean;
    ssh_reachable: boolean;
    latency_ms: number | null;
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
    device_kind?: string;
    display_name?: string;
    device_model?: string;
    ssh_username?: string;
    parent_asset_id?: string;
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

export type ComputeJetsonConnectResult = {
    status: 'confirmation_required' | 'connected';
    fingerprint: string;
    device_model?: string | null;
    architecture?: string | null;
    asset?: ComputeLanAsset | null;
};

export type ComputeLanSchedule = {
    schedule_id: string;
    node_id: string;
    node_name: string;
    cidr: string;
    interval_minutes: number;
    enabled: boolean;
    created_at: number;
    updated_at: number;
    next_run_at: number;
    last_run_at?: number | null;
    last_task_id?: string | null;
    last_error?: string | null;
    run_count: number;
};

export type ComputeLanSchedulesResponse = {
    version: 1;
    group_id: string;
    summary: {total: number; enabled: number; paused: number; failed: number};
    schedules: ComputeLanSchedule[];
};

export type ComputeTerminalTarget = {
    node_id: string;
    node_name: string;
    platform: string;
    online: boolean;
    available: boolean;
    active_session_id?: string | null;
    reason: 'available' | 'node_offline' | 'ssh_unavailable';
};

export type ComputeTerminalTargetsResponse = {
    version: 1;
    enabled: boolean;
    targets: ComputeTerminalTarget[];
};

export type ComputeTerminalSession = {
    version: 1;
    session_id: string;
    node_id: string;
    node_name: string;
    transport?: 'lan' | 'tailscale' | null;
    state: 'connecting' | 'running' | 'closed' | 'failed';
    created_at: number;
    last_activity_at: number;
    cursor: number;
    output: string;
    output_truncated: boolean;
    exit_code?: number | null;
    error?: string | null;
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
    result?: {elapsed_seconds: number}
        | ComputeWebFetchResult
        | ComputeLanDiscoveryResult
        | ComputePeerProbeResult
        | CameraConnectResult
        | null;
    error?: string | null;
    attempt: number;
    parameters: {seconds?: number; url?: string; cidr?: string; peer_id?: string};
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
    kind: 'compute_group' | 'compute_region' | 'compute_node' | 'compute_resource' | 'work_agent' | 'managed_device' | 'network_dependency';
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
    region_id?: string | null;
    region_name?: string | null;
    region_source?: 'region_label' | 'site_label' | 'unassigned' | null;
    member_count?: number | null;
    online_member_count?: number | null;
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
    schema_version: 'resource-knowledge-graph.v2' | 'resource-knowledge-graph.v3';
    group_id: string;
    generated_at: number;
    summary: {
        entities: number;
        relations: number;
        online_nodes: number;
        regions?: number;
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

const requestBlob = async (path: string, payload: unknown, signal?: AbortSignal): Promise<Blob> => {
    const response = await fetch(`${baseUrl()}${path}`, {
        method: 'POST',
        signal,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`);
    }
    return response.blob();
};

const CAMERA_COMMAND_PATH = '/extension_service/extensions/camera-connect';
const normalizedCameraCredentials = (profile: CameraConnectionProfile): CameraConnectionProfile => {
    const literal = profile.host.trim().replace(/^\[([^\]]+)\]$/, '$1');
    const host = literal.includes(':') ? new URL(`http://[${literal}]/`).hostname.slice(1, -1) : literal;
    return {
        host, port: profile.port ?? 80, rtsp_port: profile.rtsp_port ?? 554,
        username: profile.username.trim(), password: profile.password, scheme: profile.scheme ?? 'http',
        verify_tls: profile.verify_tls ?? false, timeout_seconds: profile.timeout_seconds ?? 8,
    };
};

const approveConnection = async (
    nodeId: string, operation: 'camera.connect' | 'camera.request' | 'jetson.connect',
    credentials: Record<string, unknown>, signal?: AbortSignal,
): Promise<SignedApproval> => {
    const identity = getApprovalIdentity();
    const challenge = await request<ApprovalRequest & {state: string; error_code: string | null}>(
        `/nodes/${encodeURIComponent(nodeId)}/connections/authorizations`, signal, {
            method: 'POST', body: JSON.stringify({operation, credentials, user: identity.user, ttl_seconds: 120}),
        },
    );
    const target = operation === 'camera.request'
        ? {kind: 'camera_request', method: credentials.method, path: credentials.path}
        : {kind: operation.split('.')[0], host: credentials.host};
    if (challenge.state !== 'pending' || challenge.error_code !== null || challenge.target_installation_id !== nodeId
        || challenge.operation !== operation || canonicalAuthorizationJson(challenge.target) !== canonicalAuthorizationJson(target)
        || canonicalAuthorizationJson(challenge.parameters) !== canonicalAuthorizationJson({request_sha256: await sensitiveRequestDigest(credentials, challenge.nonce)})) {
        throw new Error('授权范围或参数摘要不匹配 / Authorization scope or parameter digest mismatch');
    }
    const visible = operation === 'camera.request' ? credentials.payload as Record<string, unknown> : credentials;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!window.confirm(`批准本次操作 / Approve once\n${identity.user.user_name}\nNode: ${nodeId}\n${operation}\n${canonicalAuthorizationJson({...visible, password: '[不显示 / hidden]'})}\n仅本次有效 / One use only`)) {
        await request(`/authorizations/${encodeURIComponent(challenge.authorization_id)}/reject`, signal, {method: 'POST', body: '{}'});
        throw new Error('你已拒绝本次授权，操作未执行 / Authorization rejected');
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const current = getApprovalIdentity();
    if (current !== identity) throw new Error('授权身份已改变，请重试 / Approval identity changed');
    return {...authorizationChallenge(challenge), signature: await signAuthorization(challenge, current)};
};

export class ComputeClusterService {
    private static readonly activeLanScans = new Map<string, ComputeTask>();

    public static activeLanScan(nodeId: string): ComputeTask | null {
        return this.activeLanScans.get(nodeId) || null;
    }

    public static status(signal?: AbortSignal): Promise<ComputeClusterStatus> {
        return request('/status', signal);
    }

    public static async nodes(signal?: AbortSignal): Promise<ComputeClusterNode[]> {
        const response = await request<{nodes: ComputeClusterNode[]}>('/nodes', signal);
        return response.nodes;
    }

    public static groups(signal?: AbortSignal): Promise<ComputeGroupMemberships> {
        return request('/groups', signal);
    }

    public static runtime(nodeId: string, signal?: AbortSignal): Promise<ComputeRuntimeSnapshot> {
        return request(`/nodes/${encodeURIComponent(nodeId)}/runtime`, signal);
    }

    public static runtimeInventory(nodeId: string, signal?: AbortSignal): Promise<ComputeRuntimeInventory> {
        return request(`/nodes/${encodeURIComponent(nodeId)}/runtime/inventory`, signal);
    }

    public static runtimeEvents(
        nodeId: string,
        cursor = 0,
        limit = 50,
        signal?: AbortSignal,
    ): Promise<ComputeRuntimeEvents> {
        return request(
            `/nodes/${encodeURIComponent(nodeId)}/runtime/events?cursor=${cursor}&limit=${limit}`,
            signal,
        );
    }

    public static createFilesystemAuthorization(
        nodeId: string,
        input: ComputeFilesystemAuthorizationRequest,
        signal?: AbortSignal,
    ): Promise<ComputeFilesystemAuthorization & {state: 'pending'; node_name: string}> {
        return request(`/nodes/${encodeURIComponent(nodeId)}/filesystem/authorizations`, signal, {
            method: 'POST', body: JSON.stringify(input),
        });
    }

    public static approveFilesystemAuthorization(
        authorizationId: string,
        signature: string,
        signal?: AbortSignal,
    ): Promise<ComputeFilesystemDecision> {
        return request(
            `/filesystem/authorizations/${encodeURIComponent(authorizationId)}/approve`,
            signal,
            {method: 'POST', body: JSON.stringify({signature})},
        );
    }

    public static rejectFilesystemAuthorization(
        authorizationId: string,
        signal?: AbortSignal,
    ): Promise<ComputeFilesystemAuthorization & {state: 'rejected'}> {
        return request(
            `/filesystem/authorizations/${encodeURIComponent(authorizationId)}/reject`,
            signal,
            {method: 'POST', body: '{}'},
        );
    }

    public static upgradeReleases(signal?: AbortSignal): Promise<{source: 'main'; releases: ComputeUpgradeManifest[]}> {
        return request('/upgrade-releases', signal);
    }

    public static createMainUpgradeBatch(
        nodeIds: string[], releaseVersion: string, signal?: AbortSignal,
    ): Promise<ComputeUpgradeBatch> {
        const identity = getApprovalIdentity();
        return request('/upgrade-batches/from-main', signal, {
            method: 'POST',
            body: JSON.stringify({node_ids: nodeIds, release_version: releaseVersion,
                drain_timeout_seconds: 300, user: identity.user, ttl_seconds: 14400}),
        });
    }

    public static createUpgradeBatch(
        nodes: {node_id: string; manifest: ComputeUpgradeManifest}[],
        signal?: AbortSignal,
    ): Promise<ComputeUpgradeBatch> {
        const identity = getApprovalIdentity();
        return request('/upgrade-batches', signal, {
            method: 'POST',
            body: JSON.stringify({
                nodes,
                drain_timeout_seconds: 300,
                user: identity.user,
                ttl_seconds: 14400,
            }),
        });
    }

    public static upgradeBatch(batchId: string, signal?: AbortSignal): Promise<ComputeUpgradeBatch> {
        return request(`/upgrade-batches/${encodeURIComponent(batchId)}`, signal);
    }

    public static refreshUpgradeBatch(batchId: string, signal?: AbortSignal): Promise<ComputeUpgradeBatch> {
        return request(`/upgrade-batches/${encodeURIComponent(batchId)}/refresh`, signal, {
            method: 'POST', body: '{}',
        });
    }

    public static async approveUpgradeBatch(
        batch: ComputeUpgradeBatch,
        signal?: AbortSignal,
    ): Promise<ComputeUpgradeBatch> {
        const identity = getApprovalIdentity();
        const remaining = batch.nodes.slice(batch.current_index);
        if (batch.state !== 'awaiting_authorization' || remaining.length < 1 || remaining.length > 64
            || !Number.isInteger(batch.current_index) || batch.current_index < 0
            || new Set(remaining.map(node => node.node_id)).size !== remaining.length
            || new Set(remaining.map(node => node.job_id)).size !== remaining.length
            || !Number.isFinite(batch.expires_at) || batch.expires_at <= Date.now() / 1000) {
            throw new Error('升级批次无效或已过期 / Invalid or expired upgrade batch');
        }
        const approvals = await Promise.all(remaining.map(async node => {
            const challenge = node.authorization;
            if (!challenge || challenge.state !== 'pending'
                || challenge.operation !== 'node.upgrade'
                || challenge.authorization_id !== node.authorization_id
                || challenge.expires_at > batch.expires_at
                || node.manifest.release_version !== batch.release_version
                || challenge.target_installation_id !== node.node_id
                || challenge.parameters.job_id !== node.job_id
                || challenge.parameters.source_revision !== node.manifest.source_revision
                || challenge.parameters.artifact_sha256 !== node.manifest.sha256
                || challenge.parameters.artifact_size_bytes !== node.manifest.size_bytes
                || challenge.parameters.drain_timeout_seconds !== batch.drain_timeout_seconds
                || canonicalAuthorizationJson(challenge.target) !== canonicalAuthorizationJson({
                    kind: 'node_upgrade', release_version: node.manifest.release_version,
                    platform: node.manifest.platform, architecture: node.manifest.architecture,
                })) {
                throw new Error('升级授权范围不匹配 / Upgrade authorization scope mismatch');
            }
            const manifestHash = await sha256Bytes(
                new TextEncoder().encode(canonicalAuthorizationJson(node.manifest)),
            );
            if (challenge.parameters.manifest_sha256 !== manifestHash) {
                throw new Error('升级清单摘要不匹配 / Upgrade manifest digest mismatch');
            }
            const signature = await signAuthorization(challenge, identity);
            return {job_id: node.job_id, authorization_id: challenge.authorization_id, signature};
        }));
        return request(`/upgrade-batches/${encodeURIComponent(batch.batch_id)}/approve`, signal, {
            method: 'POST', body: JSON.stringify({approvals}),
        });
    }

    public static rejectUpgradeBatch(batchId: string, signal?: AbortSignal): Promise<ComputeUpgradeBatch> {
        return request(`/upgrade-batches/${encodeURIComponent(batchId)}/reject`, signal, {
            method: 'POST', body: '{}',
        });
    }

    public static tasks(signal?: AbortSignal, limit?: number): Promise<ComputeTasksResponse> {
        return request(limit ? `/tasks?limit=${limit}` : '/tasks', signal);
    }

    public static taskStatus(
        task: Pick<ComputeTask, 'node_id' | 'task_id'>,
        signal?: AbortSignal,
    ): Promise<ComputeTask> {
        return request(
            `/tasks/${encodeURIComponent(task.node_id)}/${encodeURIComponent(task.task_id)}`,
            signal,
        );
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

    public static async connectJetson(
        assetId: string,
        credentials: {username: string; password: string; expected_fingerprint?: string},
        signal?: AbortSignal,
    ): Promise<ComputeJetsonConnectResult> {
        const asset = (await this.lanAssets(signal)).assets.find(item => item.asset_id === assetId);
        if (!asset) throw new Error('Jetson device is no longer registered');
        const payload = {host: asset.address, port: 22, username: credentials.username.trim(), password: credentials.password, expected_fingerprint: credentials.expected_fingerprint ?? null};
        const authorization = await approveConnection(asset.node_id, 'jetson.connect', payload, signal);
        return request(`/lan-assets/${encodeURIComponent(assetId)}/jetson`, signal, {
            method: 'POST', body: JSON.stringify({username: payload.username, password: payload.password, port: 22, expected_fingerprint: payload.expected_fingerprint, authorization}),
        });
    }

    public static async connectCamera(
        nodeId: string,
        credentials: CameraConnectionProfile,
        signal?: AbortSignal,
    ): Promise<CameraConnectResult> {
        const payload = normalizedCameraCredentials(credentials);
        const authorization = await approveConnection(nodeId, 'camera.connect', payload, signal);
        return request(`/nodes/${encodeURIComponent(nodeId)}/cameras/connect`, signal, {
            method: 'POST', body: JSON.stringify({...payload, authorization}),
        });
    }

    public static discoverCameras(
        nodeId: string,
        timeoutSeconds = 0.35,
        signal?: AbortSignal,
    ): Promise<CameraDiscoveryResponse> {
        return request(`/nodes/${encodeURIComponent(nodeId)}/cameras/discovery`, signal, {
            method: 'POST', body: JSON.stringify({timeout_seconds: timeoutSeconds}),
        });
    }

    public static async snapshotCamera(
        nodeId: string,
        payload: CameraConnectionProfile & {channel_id: string},
        signal?: AbortSignal,
    ): Promise<Blob> {
        const body = {...normalizedCameraCredentials(payload), channel_id: payload.channel_id};
        const authorization = await approveConnection(nodeId, 'camera.request', {method: 'POST', path: `${CAMERA_COMMAND_PATH}/snapshot`, payload: body}, signal);
        return requestBlob(
            `/nodes/${encodeURIComponent(nodeId)}/cameras/snapshot`, {...body, authorization}, signal,
        );
    }

    public static async createCameraResource(
        nodeId: string,
        payload: CameraConnectionProfile & {name: string; channel_id: string},
        signal?: AbortSignal,
    ): Promise<CameraResource> {
        const body = {...normalizedCameraCredentials(payload), name: payload.name, channel_id: payload.channel_id};
        const authorization = await approveConnection(nodeId, 'camera.request', {method: 'POST', path: `${CAMERA_COMMAND_PATH}/resources`, payload: body}, signal);
        return request(`/nodes/${encodeURIComponent(nodeId)}/cameras/resources`, signal, {
            method: 'POST', body: JSON.stringify({...body, authorization}),
        });
    }

    public static updateCameraResource(
        nodeId: string,
        resourceId: string,
        name: string,
        signal?: AbortSignal,
    ): Promise<CameraResource> {
        return request(
            `/nodes/${encodeURIComponent(nodeId)}/cameras/resources/${encodeURIComponent(resourceId)}`,
            signal,
            {method: 'PUT', body: JSON.stringify({name})},
        );
    }

    public static async deleteCameraResource(
        nodeId: string,
        resourceId: string,
        signal?: AbortSignal,
    ): Promise<void> {
        await request(
            `/nodes/${encodeURIComponent(nodeId)}/cameras/resources/${encodeURIComponent(resourceId)}`,
            signal,
            {method: 'DELETE'},
        );
    }

    public static async scanLan(
        nodeId: string,
        signal?: AbortSignal,
        onProgress?: (percent: number, completed?: number, total?: number) => void,
    ): Promise<ComputeLanDiscoveryResult> {
        const targets = await this.lanScanTargets(signal);
        const cidr = targets.nodes.find(entry => entry.node_id === nodeId)?.targets[0]?.cidr;
        if (!cidr) throw new Error('Selected node has no scannable LAN segment');
        const submitted = await this.submitTask({
            node_id: nodeId,
            task_type: 'network.lan_discovery',
            mode: 'background',
            cidr,
            lease_seconds: 60,
        }, signal);
        this.activeLanScans.set(nodeId, submitted);
        try {
            return await this.watchLanScan(submitted, signal, onProgress);
        } catch (reason) {
            if (signal?.aborted) await this.controlTask(submitted, 'cancel').catch(() => undefined);
            throw reason;
        } finally {
            if (this.activeLanScans.get(nodeId)?.task_id === submitted.task_id) {
                this.activeLanScans.delete(nodeId);
            }
        }
    }

    public static async watchLanScan(
        task: Pick<ComputeTask, 'node_id' | 'task_id'>,
        signal?: AbortSignal,
        onProgress?: (percent: number, completed?: number, total?: number) => void,
    ): Promise<ComputeLanDiscoveryResult> {
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
            let current: ComputeTask;
            try {
                // eslint-disable-next-line no-await-in-loop
                current = await this.taskStatus(task, signal);
            } catch (reason) {
                if (signal?.aborted) throw reason;
                // eslint-disable-next-line no-await-in-loop
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
            if (typeof current?.progress?.percent === 'number') {
                onProgress?.(
                    Math.round(Math.max(0, Math.min(100, current.progress.percent))),
                    current.progress.completed,
                    current.progress.total,
                );
            }
            if (current?.state === 'succeeded' && current.result && 'hosts' in current.result) {
                return current.result;
            }
            if (current?.state === 'failed' || current?.state === 'cancelled') {
                throw new Error(current.error || 'LAN scan failed');
            }
            // eslint-disable-next-line no-await-in-loop
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error('LAN scan timed out');
    }

    public static lanSchedules(signal?: AbortSignal): Promise<ComputeLanSchedulesResponse> {
        return request('/lan-schedules', signal);
    }

    public static terminalTargets(signal?: AbortSignal): Promise<ComputeTerminalTargetsResponse> {
        return request('/terminal-targets', signal);
    }

    public static startTerminal(
        nodeId: string,
        transport?: 'lan' | 'tailscale',
        signal?: AbortSignal,
    ): Promise<ComputeTerminalSession> {
        return request('/terminals', signal, {
            method: 'POST', body: JSON.stringify({node_id: nodeId, ...(transport ? {transport} : {})}),
        });
    }

    public static terminal(
        sessionId: string,
        cursor = 0,
        signal?: AbortSignal,
    ): Promise<ComputeTerminalSession> {
        return request(`/terminals/${encodeURIComponent(sessionId)}?cursor=${cursor}`, signal);
    }

    public static terminalInput(
        sessionId: string,
        input: string,
        signal?: AbortSignal,
    ): Promise<ComputeTerminalSession> {
        return request(`/terminals/${encodeURIComponent(sessionId)}/input`, signal, {
            method: 'POST', body: JSON.stringify({input}),
        });
    }

    public static terminalControl(
        sessionId: string,
        action: 'interrupt' | 'close',
        signal?: AbortSignal,
    ): Promise<ComputeTerminalSession> {
        return request(`/terminals/${encodeURIComponent(sessionId)}/${action}`, signal, {
            method: 'POST', body: '{}',
        });
    }

    public static createLanSchedule(
        input: {node_id: string; cidr: string; interval_minutes: number},
        signal?: AbortSignal,
    ): Promise<ComputeLanSchedule> {
        return request('/lan-schedules', signal, {
            method: 'POST', body: JSON.stringify(input),
        });
    }

    public static controlLanSchedule(
        scheduleId: string,
        action: 'run-now' | 'pause' | 'resume',
        signal?: AbortSignal,
    ): Promise<ComputeLanSchedule | {schedule_id: string; task_id?: string | null; accepted: boolean; error?: string | null}> {
        return request(`/lan-schedules/${encodeURIComponent(scheduleId)}/${action}`, signal, {
            method: 'POST', body: '{}',
        });
    }

    public static submitTask(
        input: {
            node_id?: string;
            task_type?: ComputeTaskType;
            mode: ComputeTaskMode;
            seconds?: number;
            url?: string;
            cidr?: string;
            peer_id?: string;
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
