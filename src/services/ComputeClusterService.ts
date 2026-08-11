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
    resources: ComputeNodeResources;
    device_inventory: ComputeDeviceInventory;
    enrolled_at: number;
    last_seen_at: number;
    enabled: boolean;
    online: boolean;
    heartbeat_age_seconds: number;
};

export type ComputeClusterStatus = {
    state: string;
    version: string;
    protocol_version: number;
    group_id?: string;
    admin_configured: boolean;
    task_control?: {enabled: boolean; allowed_task_types: string[]};
    nodes: {total: number; online: number; gpu_total: number; device_total: number};
};

export type ComputeTaskMode = 'online' | 'background';
export type ComputeTaskState = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';

export type ComputeTask = {
    task_id: string;
    node_id: string;
    node_name: string;
    task_type: 'system.wait' | string;
    mode: ComputeTaskMode;
    state: ComputeTaskState;
    created_at: number;
    updated_at: number;
    lease_seconds: number;
    lease_expires_at?: number | null;
    control_request?: 'pause' | 'cancel' | null;
    checkpoint?: Record<string, unknown> | null;
    progress?: {completed?: number; total?: number; unit?: string; percent?: number} | null;
    result?: Record<string, unknown> | null;
    error?: string | null;
    attempt: number;
    parameters: {seconds?: number};
};

export type ComputeTasksResponse = {
    version: number;
    group_id: string;
    tasks: ComputeTask[];
    total: number;
    counts: Partial<Record<ComputeTaskState, number>>;
    nodes: {node_id: string; available: boolean; error?: string | null}[];
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

    public static submitTask(
        input: {node_id: string; mode: ComputeTaskMode; seconds: number; lease_seconds?: number},
        signal?: AbortSignal,
    ): Promise<ComputeTask> {
        return request('/tasks', signal, {
            method: 'POST',
            body: JSON.stringify({
                ...input,
                task_type: 'system.wait',
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
