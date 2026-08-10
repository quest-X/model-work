import {getExtensionEngineBaseUrl} from '../utils/DefaultBackendUrl';

export type CameraPreviewSettings = {
    brightness: number;
    contrast: number;
    gamma: number;
    saturation: number;
    sharpness: number;
    denoise: number;
};

export type CameraPreviewState = {
    logical_channels: {original: '1011'; adjusted: '1012'};
    saved: CameraPreviewSettings;
    current: CameraPreviewSettings;
    dirty: boolean;
    created_at: string;
    updated_at: string | null;
    applied_at: string | null;
    physical_camera_unchanged: true;
};

export type CameraPreviewSettingsUpdate = Partial<CameraPreviewSettings>;

const cameraBaseUrl = (): string =>
    `${getExtensionEngineBaseUrl()}/extensions/camera-connect`;

const errorDetail = async (response: Response): Promise<string> => {
    const body = await response.json().catch(() => ({}));
    return typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`;
};

export class CameraPreviewService {
    private static async request(
        resourceId: string,
        suffix: string,
        init?: RequestInit,
    ): Promise<CameraPreviewState> {
        const response = await fetch(
            `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}/preview-settings${suffix}`,
            init,
        );
        if (!response.ok) throw new Error(await errorDetail(response));
        return response.json();
    }

    public static get(resourceId: string): Promise<CameraPreviewState> {
        return CameraPreviewService.request(resourceId, '');
    }

    public static update(
        resourceId: string,
        payload: CameraPreviewSettingsUpdate,
    ): Promise<CameraPreviewState> {
        return CameraPreviewService.request(resourceId, '', {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload),
        });
    }

    public static apply(resourceId: string): Promise<CameraPreviewState> {
        return CameraPreviewService.request(resourceId, '/apply', {method: 'POST'});
    }

    public static revert(resourceId: string): Promise<CameraPreviewState> {
        return CameraPreviewService.request(resourceId, '/revert', {method: 'POST'});
    }

    public static reset(resourceId: string): Promise<CameraPreviewState> {
        return CameraPreviewService.request(resourceId, '/reset', {method: 'POST'});
    }
}
