import {
    CameraControlResult,
    CameraControls,
} from './CameraResourceService';
import {getExtensionEngineBaseUrl} from '../utils/DefaultBackendUrl';

export type CameraTrialPhase = 'idle' | 'trial' | 'applied';

export type CameraTrialStatus = {
    phase: CameraTrialPhase;
    dirty: boolean;
    active: {
        auto_exposure: boolean;
        auto_focus: boolean;
    };
    started_at: string | null;
    expires_at: string | null;
    applied_at: string | null;
};

export type CameraControlsWithTrial = CameraControls & {
    trial?: CameraTrialStatus;
};

export type CameraTrialResult = Omit<CameraControlResult, 'action'> & {
    action: CameraControlResult['action'] | 'restore_trial_exposure' | 'restore_trial_focus' | 'revert_trial' | 'apply_trial';
    trial: CameraTrialStatus;
};

const cameraBaseUrl = (): string =>
    `${getExtensionEngineBaseUrl()}/extensions/camera-connect`;

const errorDetail = async (response: Response): Promise<string> => {
    const body = await response.json().catch(() => ({}));
    return typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`;
};

export class CameraTrialService {
    public static async revert(resourceId: string, keepalive: boolean = false): Promise<CameraTrialResult> {
        const response = await fetch(
            `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}/controls/trial/revert`,
            {method: 'POST', keepalive},
        );
        if (!response.ok) throw new Error(await errorDetail(response));
        return response.json();
    }

    public static async apply(resourceId: string): Promise<CameraTrialResult> {
        const response = await fetch(
            `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}/controls/trial/apply`,
            {method: 'POST'},
        );
        if (!response.ok) throw new Error(await errorDetail(response));
        return response.json();
    }
}
