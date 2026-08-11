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
    nodes: {total: number; online: number; gpu_total: number; device_total: number};
};

const baseUrl = (): string =>
    `${getExtensionEngineBaseUrl()}/extensions/compute-cluster`;

const request = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
    const response = await fetch(`${baseUrl()}${path}`, {signal});
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
}
