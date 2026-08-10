import {
    QueueDataSyncStatus,
    QueueItem,
    QueueItemStatus,
    QueueItemType,
} from '../store/queue/types';
import {ImageData} from '../store/labels/types';
import {getExtensionEngineBaseUrl} from '../utils/DefaultBackendUrl';

export type CameraDevice = {
    name: string;
    model: string;
    serial_number: string;
    firmware_version: string;
    device_type: string;
    mac_address: string;
};

export type CameraChannel = {
    id: string;
    name: string;
    enabled: boolean;
    codec: string;
    width: number | null;
    height: number | null;
    frame_rate: number | null;
    rtsp_url: string;
};

export type CameraResource = {
    id: string;
    name: string;
    host: string;
    port: number;
    rtsp_port: number;
    scheme: 'http' | 'https';
    channel_id: string;
    device: CameraDevice;
    channels: CameraChannel[];
    created_at: string;
    updated_at: string;
};

export type CameraConnectionProfile = {
    host: string;
    port: number;
    rtsp_port: number;
    username: string;
    password: string;
    scheme: 'http' | 'https';
    verify_tls: boolean;
    timeout_seconds: number;
};

export type CameraDiscoveryDevice = {
    host: string;
    name: string;
    manufacturer: string;
    model: string;
    scheme: 'http' | 'https';
    port: number;
    rtsp_port: number;
    sdk_port: number | null;
    open_ports: number[];
    services: string[];
    discovery_methods: string[];
    confidence: 'confirmed' | 'probable';
};

export type CameraDiscoveryResponse = {
    networks: string[];
    scanned_hosts: number;
    duration_ms: number;
    devices: CameraDiscoveryDevice[];
};

export type CameraImageMetrics = {
    luma: number;
    saturation_ratio: number;
    dark_ratio: number;
    focus_score: number;
    width: number;
    height: number;
};

export type CameraControlState = {
    exposure: {
        mode: 'auto' | 'manual';
        shutter_us: number;
        gain_level: number;
    };
    focus: {
        mode: 'auto' | 'manual' | 'semi_auto' | 'unknown';
        position: number;
        relative_position: number;
        speed_level: number;
    };
};

export type CameraControls = {
    capabilities: {
        auto_exposure: boolean;
        manual_exposure: boolean;
        exposure_metrics: boolean;
        auto_focus: boolean;
        focus_metrics: boolean;
    };
    active?: {
        auto_exposure: boolean;
        auto_focus: boolean;
    };
    state: CameraControlState;
    metrics: CameraImageMetrics;
};

export type CameraControlResult = {
    action: 'auto_exposure' | 'auto_focus' | 'restore_auto_exposure' | 'restore_auto_focus';
    message: string;
    active?: {
        auto_exposure: boolean;
        auto_focus: boolean;
    };
    before?: CameraImageMetrics;
    after: CameraImageMetrics;
    state: CameraControlState;
    converged?: boolean;
    iterations?: number;
    target_luma?: number;
    improvement?: number;
};

const cameraBaseUrl = (): string =>
    `${getExtensionEngineBaseUrl()}/extensions/camera-connect`;

const errorDetail = async (response: Response): Promise<string> => {
    const body = await response.json().catch(() => ({}));
    return typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`;
};

export class CameraResourceService {
    public static async discover(timeoutSeconds: number = 0.35): Promise<CameraDiscoveryResponse> {
        const response = await fetch(`${cameraBaseUrl()}/discovery`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({timeout_seconds: timeoutSeconds}),
        });
        if (!response.ok) throw new Error(await errorDetail(response));
        return response.json();
    }

    public static async list(): Promise<CameraResource[]> {
        const response = await fetch(`${cameraBaseUrl()}/resources`);
        if (!response.ok) throw new Error(await errorDetail(response));
        const payload = await response.json();
        return Array.isArray(payload.resources) ? payload.resources : [];
    }

    public static async create(payload: Record<string, unknown>): Promise<CameraResource> {
        const response = await fetch(`${cameraBaseUrl()}/resources`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await errorDetail(response));
        return response.json();
    }

    public static async credentials(resourceId: string): Promise<CameraConnectionProfile> {
        const response = await fetch(
            `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}/credentials`,
        );
        if (!response.ok) throw new Error(await errorDetail(response));
        return response.json();
    }

    public static async update(resourceId: string, payload: Record<string, unknown>): Promise<CameraResource> {
        const response = await fetch(
            `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}`,
            {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload),
            },
        );
        if (!response.ok) throw new Error(await errorDetail(response));
        return response.json();
    }

    public static async delete(resourceId: string): Promise<void> {
        const response = await fetch(
            `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}`,
            {method: 'DELETE'},
        );
        if (!response.ok && response.status !== 404) throw new Error(await errorDetail(response));
    }

    public static async controls(resourceId: string): Promise<CameraControls> {
        const response = await fetch(
            `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}/controls`,
        );
        if (!response.ok) throw new Error(await errorDetail(response));
        return response.json();
    }

    public static async autoExposure(resourceId: string, targetLuma: number): Promise<CameraControlResult> {
        const response = await fetch(
            `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}/auto-exposure`,
            {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({target_luma: targetLuma}),
            },
        );
        if (!response.ok) throw new Error(await errorDetail(response));
        return response.json();
    }

    public static async autoFocus(resourceId: string): Promise<CameraControlResult> {
        const response = await fetch(
            `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}/auto-focus`,
            {method: 'POST'},
        );
        if (!response.ok) throw new Error(await errorDetail(response));
        return response.json();
    }

    public static async restoreExposure(resourceId: string): Promise<CameraControlResult> {
        const response = await fetch(
            `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}/controls/exposure/restore`,
            {method: 'POST'},
        );
        if (!response.ok) throw new Error(await errorDetail(response));
        return response.json();
    }

    public static async restoreFocus(resourceId: string): Promise<CameraControlResult> {
        const response = await fetch(
            `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}/controls/focus/restore`,
            {method: 'POST'},
        );
        if (!response.ok) throw new Error(await errorDetail(response));
        return response.json();
    }

    public static snapshotUrl(resourceId: string, channelId?: string): string {
        const query = channelId ? `?channel_id=${encodeURIComponent(channelId)}` : '';
        return `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}/snapshot${query}`;
    }

    public static streamUrl(
        resourceId: string,
        channelId?: string,
        nonce?: number,
        branch: 'original' | 'adjusted' = 'adjusted',
    ): string {
        const params = new URLSearchParams({fps: '10'});
        if (channelId) params.set('channel_id', channelId);
        params.set('branch', branch);
        if (nonce) params.set('_', String(nonce));
        return `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}/mjpeg?${params}`;
    }

    public static toQueueItem(resource: CameraResource): QueueItem {
        return {
            id: `camera-${resource.id}`,
            name: resource.name,
            type: QueueItemType.CAMERA,
            status: QueueItemStatus.COMPLETED,
            uploadedAt: Date.parse(resource.created_at) || Date.now(),
            thumbnail: CameraResourceService.snapshotUrl(resource.id, resource.channel_id),
            dataSyncStatus: QueueDataSyncStatus.SYNCED,
            cameraResourceId: resource.id,
            cameraChannelId: resource.channel_id,
            cameraHost: resource.host,
            cameraModel: resource.device.model,
        };
    }

    public static async open(resource: CameraResource, imagesData: ImageData[]): Promise<void> {
        const [
            {store},
            {QueueActions},
            {addQueueItem, updateQueueItem},
        ] = await Promise.all([
            import('../index'),
            import('../logic/actions/QueueActions'),
            import('../store/queue/actionCreators'),
        ]);
        const item = CameraResourceService.toQueueItem(resource);
        const existing = store.getState().queue.items.find(candidate => candidate.id === item.id);
        if (existing) {
            store.dispatch(updateQueueItem(existing.id, item));
        } else {
            store.dispatch(addQueueItem(item));
        }
        await QueueActions.switchToQueueItem(existing ? {...existing, ...item} : item, imagesData);
    }
}
