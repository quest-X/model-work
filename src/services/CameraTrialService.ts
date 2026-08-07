import {
    CameraControlResult,
    CameraControlState,
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
        auto_wdr: boolean;
        auto_day_night: boolean;
    };
    started_at: string | null;
    expires_at: string | null;
    applied_at: string | null;
};

export type CameraSmartControlState = CameraControlState & {
    wdr: {
        mode: 'close' | 'open' | 'auto' | 'unknown';
        level: number | null;
    };
    day_night: {
        mode: 'day' | 'night' | 'auto' | 'schedule' | 'unknown';
    };
};

export type CameraSmartActive = CameraTrialStatus['active'];

export type CameraAdvancedParameterValue = string | number | boolean | null;
export type CameraSdkImageState = Record<string, Record<string, CameraAdvancedParameterValue>>;

export type CameraControlsWithTrial = Omit<CameraControls, 'capabilities' | 'active' | 'state'> & {
    capabilities: CameraControls['capabilities'] & {
        auto_wdr: boolean;
        auto_day_night: boolean;
    };
    active?: CameraSmartActive;
    state: CameraSmartControlState & {sdk_image?: CameraSdkImageState};
    trial?: CameraTrialStatus;
};

export type CameraSmartControlResult = Omit<CameraControlResult, 'action' | 'active' | 'state'> & {
    action: CameraControlResult['action'] | 'auto_wdr' | 'auto_day_night' | 'restore_trial_exposure' | 'restore_trial_focus' | 'restore_trial_wdr' | 'restore_trial_day_night' | 'revert_trial' | 'apply_trial';
    active?: CameraSmartActive;
    state: CameraSmartControlState & {sdk_image?: CameraSdkImageState};
    trial?: CameraTrialStatus;
};

export type CameraTrialResult = CameraSmartControlResult & {
    trial: CameraTrialStatus;
};

const cameraBaseUrl = (): string =>
    `${getExtensionEngineBaseUrl()}/extensions/camera-connect`;

const errorDetail = async (response: Response): Promise<string> => {
    const body = await response.json().catch(() => ({}));
    return typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`;
};

export class CameraTrialService {
    private static async post(resourceId: string, path: string): Promise<CameraTrialResult> {
        const response = await fetch(
            `${cameraBaseUrl()}/resources/${encodeURIComponent(resourceId)}${path}`,
            {method: 'POST'},
        );
        if (!response.ok) throw new Error(await errorDetail(response));
        return response.json();
    }

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

    public static autoWdr(resourceId: string): Promise<CameraTrialResult> {
        return CameraTrialService.post(resourceId, '/auto-wdr');
    }

    public static restoreWdr(resourceId: string): Promise<CameraTrialResult> {
        return CameraTrialService.post(resourceId, '/controls/wdr/restore');
    }

    public static autoDayNight(resourceId: string): Promise<CameraTrialResult> {
        return CameraTrialService.post(resourceId, '/auto-day-night');
    }

    public static restoreDayNight(resourceId: string): Promise<CameraTrialResult> {
        return CameraTrialService.post(resourceId, '/controls/day-night/restore');
    }
}
