import {CameraChannel, CameraDevice} from './CameraResourceService';
import type {CameraControlsWithTrial, CameraTrialStatus} from './CameraTrialService';
import {getExtensionEngineBaseUrl} from '../utils/DefaultBackendUrl';

export type CameraParameterSnapshot = {
    captured_at: string;
    control_captured_at?: string;
    source: 'connection' | 'first_read' | 'live';
    live: boolean;
    connection: {
        scheme: 'http' | 'https';
        host: string;
        management_port: number;
        rtsp_port: number;
        channel_id: string;
    };
    device: CameraDevice;
    channels: CameraChannel[];
    controls: CameraControlsWithTrial | null;
    errors: string[];
};

export type CameraParameterComparison = {
    original: CameraParameterSnapshot;
    current: CameraParameterSnapshot;
    changed_paths: string[];
};

export type CameraManualParameterUpdate = {
    exposure_mode?: 'auto' | 'manual';
    shutter_us?: number;
    gain_level?: number;
    focus_mode?: 'auto' | 'manual' | 'semi_auto';
    focus_speed_level?: number;
};

const cameraBaseUrl = (): string =>
    `${getExtensionEngineBaseUrl()}/extensions/camera-connect`;

const errorDetail = async (response: Response): Promise<string> => {
    const body = await response.json().catch(() => ({}));
    return typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`;
};

export class CameraParameterService {
    public static async compare(resourceId: string): Promise<CameraParameterComparison> {
        const response = await fetch(
            `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}/parameters`,
        );
        if (!response.ok) throw new Error(await errorDetail(response));
        return response.json();
    }

    public static async update(
        resourceId: string,
        payload: CameraManualParameterUpdate,
    ): Promise<CameraTrialStatus> {
        const response = await fetch(
            `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}/controls`,
            {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload),
            },
        );
        if (!response.ok) throw new Error(await errorDetail(response));
        const result = await response.json();
        return result.trial;
    }
}
