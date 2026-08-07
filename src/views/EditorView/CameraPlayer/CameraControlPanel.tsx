import React, {useEffect, useRef, useState} from 'react';
import {Language} from '../../../data/LanguageConfig';
import {CameraImageMetrics, CameraResourceService} from '../../../services/CameraResourceService';
import {
    CameraControlsWithTrial,
    CameraSmartControlResult,
    CameraTrialService,
    CameraTrialStatus,
} from '../../../services/CameraTrialService';
import './CameraControlPanel.scss';

interface IProps {
    resourceId: string;
    language: Language;
    onClose: () => void;
    onBeforeAction?: () => void;
}

type RunningAction = 'probe' | 'exposure' | 'focus' | 'wdr' | 'dayNight' | 'restoreExposure' | 'restoreFocus' | 'restoreWdr' | 'restoreDayNight' | 'revertTrial' | 'close' | null;
type ToggleAction = Exclude<RunningAction, 'probe' | 'revertTrial' | 'close' | null>;

const DEFAULT_TARGET_LUMA = 0.35;
const CONTROL_RETRY_INTERVAL_MS = 1500;
const INACTIVE = {
    auto_exposure: false,
    auto_focus: false,
    auto_wdr: false,
    auto_day_night: false,
};
const IDLE_TRIAL: CameraTrialStatus = {
    phase: 'idle',
    dirty: false,
    active: INACTIVE,
    started_at: null,
    expires_at: null,
    applied_at: null,
};

const percent = (value: number): string => `${Math.round(value * 100)}%`;

const CameraControlPanel: React.FC<IProps> = ({resourceId, language, onClose, onBeforeAction}) => {
    const chinese = language === Language.CHINESE;
    const [controls, setControls] = useState<CameraControlsWithTrial | null>(null);
    const [metrics, setMetrics] = useState<CameraImageMetrics | null>(null);
    const [lastResult, setLastResult] = useState<CameraSmartControlResult | null>(null);
    const [running, setRunning] = useState<RunningAction>('probe');
    const [error, setError] = useState('');
    const trialRef = useRef<CameraTrialStatus>(IDLE_TRIAL);

    const applyResult = (result: CameraSmartControlResult) => {
        const trial = result.trial ?? trialRef.current;
        trialRef.current = trial;
        setLastResult(result);
        setMetrics(result.after);
        setControls(previous => previous ? {
            ...previous,
            trial,
            active: result.active ?? trial.active ?? previous.active ?? INACTIVE,
            state: result.state,
            metrics: result.after,
        } : previous);
    };

    useEffect(() => {
        let active = true;
        let retryTimer: number | undefined;
        const loadControls = async () => {
            if (!active) return;
            setRunning('probe');
            try {
                const value = await CameraResourceService.controls(resourceId);
                if (!active) return;
                const smartControls = value as CameraControlsWithTrial;
                setControls(smartControls);
                trialRef.current = smartControls.trial ?? IDLE_TRIAL;
                setMetrics(value.metrics);
                setError('');
            } catch (reason) {
                if (!active) return;
                setError(reason instanceof Error ? reason.message : String(reason));
                retryTimer = window.setTimeout(loadControls, CONTROL_RETRY_INTERVAL_MS);
            } finally {
                if (active) setRunning(null);
            }
        };
        void loadControls();
        return () => {
            active = false;
            if (retryTimer !== undefined) window.clearTimeout(retryTimer);
        };
    }, [resourceId]);

    const execute = async (action: ToggleAction) => {
        if (running || !controls) return;
        if (['exposure', 'focus', 'wdr', 'dayNight'].includes(action)) onBeforeAction?.();
        setRunning(action);
        setError('');
        setLastResult(null);
        try {
            let result: CameraSmartControlResult;
            switch (action) {
                case 'exposure':
                    result = await CameraResourceService.autoExposure(resourceId, DEFAULT_TARGET_LUMA) as unknown as CameraSmartControlResult;
                    break;
                case 'focus':
                    result = await CameraResourceService.autoFocus(resourceId) as unknown as CameraSmartControlResult;
                    break;
                case 'wdr':
                    result = await CameraTrialService.autoWdr(resourceId);
                    break;
                case 'dayNight':
                    result = await CameraTrialService.autoDayNight(resourceId);
                    break;
                case 'restoreExposure':
                    result = await CameraResourceService.restoreExposure(resourceId) as unknown as CameraSmartControlResult;
                    break;
                case 'restoreFocus':
                    result = await CameraResourceService.restoreFocus(resourceId) as unknown as CameraSmartControlResult;
                    break;
                case 'restoreWdr':
                    result = await CameraTrialService.restoreWdr(resourceId);
                    break;
                case 'restoreDayNight':
                    result = await CameraTrialService.restoreDayNight(resourceId);
                    break;
                default:
                    return;
            }
            applyResult(result);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setRunning(null);
        }
    };

    const revertTrial = async () => {
        if (running) return;
        setRunning('revertTrial');
        setError('');
        setLastResult(null);
        try {
            applyResult(await CameraTrialService.revert(resourceId));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setRunning(null);
        }
    };

    const closePanel = async () => {
        if (running && running !== 'probe') return;
        if (trialRef.current.phase !== 'trial') {
            onClose();
            return;
        }
        setRunning('close');
        setError('');
        try {
            applyResult(await CameraTrialService.revert(resourceId));
            onClose();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setRunning(null);
        }
    };

    const busyText = running === 'exposure'
        ? (chinese ? '正在自动曝光…' : 'Auto exposing…')
        : running === 'focus'
            ? (chinese ? '正在自动对焦…' : 'Auto focusing…')
            : running === 'wdr'
                ? (chinese ? '正在开启自动宽动态…' : 'Enabling auto WDR…')
                : running === 'dayNight'
                    ? (chinese ? '正在开启自动日夜…' : 'Enabling auto day/night…')
                    : running?.startsWith('restore')
                        ? (chinese ? '正在恢复…' : 'Restoring…')
                        : running === 'revertTrial' || running === 'close'
                            ? (chinese ? '正在撤销试调…' : 'Reverting trial…')
                            : (chinese ? '正在读取相机能力…' : 'Reading camera controls…');
    const active = controls?.active ?? INACTIVE;
    const trial = controls?.trial ?? IDLE_TRIAL;
    const cards: Array<{
        key: string;
        label: string;
        badge: string;
        active: boolean;
        capability: boolean | undefined;
        enable: ToggleAction;
        disable: ToggleAction;
        detail: string;
    }> = [
        {
            key: 'exposure',
            label: chinese ? '自动曝光' : 'Auto exposure',
            badge: 'AEC',
            active: active.auto_exposure,
            capability: controls?.capabilities.auto_exposure,
            enable: 'exposure',
            disable: 'restoreExposure',
            detail: chinese ? `当前增益 ${controls?.state.exposure.gain_level ?? '—'}` : `Gain ${controls?.state.exposure.gain_level ?? '—'}`,
        },
        {
            key: 'focus',
            label: chinese ? '自动对焦' : 'Auto focus',
            badge: 'AF',
            active: active.auto_focus,
            capability: controls?.capabilities.auto_focus,
            enable: 'focus',
            disable: 'restoreFocus',
            detail: chinese ? `当前模式 ${controls?.state.focus.mode ?? '—'}` : `Mode ${controls?.state.focus.mode ?? '—'}`,
        },
        {
            key: 'wdr',
            label: chinese ? '自动宽动态' : 'Auto WDR',
            badge: 'WDR',
            active: active.auto_wdr,
            capability: controls?.capabilities.auto_wdr,
            enable: 'wdr',
            disable: 'restoreWdr',
            detail: chinese ? `当前模式 ${controls?.state.wdr?.mode ?? '—'}` : `Mode ${controls?.state.wdr?.mode ?? '—'}`,
        },
        {
            key: 'day-night',
            label: chinese ? '自动日夜' : 'Auto day/night',
            badge: 'D/N',
            active: active.auto_day_night,
            capability: controls?.capabilities.auto_day_night,
            enable: 'dayNight',
            disable: 'restoreDayNight',
            detail: chinese ? `当前模式 ${controls?.state.day_night?.mode ?? '—'}` : `Mode ${controls?.state.day_night?.mode ?? '—'}`,
        },
    ];

    return <aside className='CameraControlPanel' id='camera-smart-controls'>
        <div className='CameraControlTitle'>
            <div>
                <strong>{chinese ? '智能调节' : 'Smart controls'}</strong>
                <span>{chinese ? '四项独立试调；到相机参数确认下发' : 'Four independent trials; confirm apply in Camera parameters'}</span>
            </div>
            <button type='button' disabled={!!running && running !== 'probe'} onClick={closePanel} aria-label={chinese ? '关闭相机控制' : 'Close camera controls'}>×</button>
        </div>

        <div className={`CameraTrialState ${trial.phase}`}>
            <strong>{!controls
                ? (error
                    ? (chinese ? '状态读取失败 · 正在重试' : 'State unavailable · retrying')
                    : (chinese ? '正在读取相机状态' : 'Reading camera state'))
                : trial.phase === 'trial'
                ? (chinese ? '试调中 · 临时生效' : 'Trial active · temporary')
                : trial.phase === 'applied'
                    ? (chinese ? '已在相机参数中确认下发' : 'Applied from Camera parameters')
                    : (chinese ? '测试模式 · 尚未修改' : 'Test mode · unchanged')}</strong>
            <span>{!controls
                ? (chinese ? '相机忙碌时会自动重试，读取成功后才能操作' : 'Retries automatically while the camera is busy; controls unlock after a successful read')
                : trial.phase === 'trial'
                ? (chinese ? '可逐项取消或撤销全部；切换面板不会丢失试调' : 'Disable one by one or revert all; switching panels keeps the trial')
                : (chinese ? '点击任一按钮开始可撤销试调' : 'Select any control to start a reversible trial')}</span>
        </div>

        {running === 'probe' && <div className='CameraControlLoading'><span/>{busyText}</div>}
        {error && <div className='CameraControlMessage error'>{error}</div>}
        {lastResult && <div className='CameraControlMessage success'>
            {lastResult.message}
            {lastResult.action === 'auto_focus' && typeof lastResult.improvement === 'number' &&
                <small>{chinese ? '清晰度变化' : 'Focus delta'}: {lastResult.improvement > 0 ? '+' : ''}{lastResult.improvement.toFixed(0)}</small>}
        </div>}

        {metrics && <div className='CameraMetricGrid'>
            <div><span>{chinese ? '画面亮度' : 'Luma'}</span><strong>{percent(metrics.luma)}</strong></div>
            <div><span>{chinese ? '过曝区域' : 'Clipped'}</span><strong>{percent(metrics.saturation_ratio)}</strong></div>
            <div><span>{chinese ? '清晰度' : 'Sharpness'}</span><strong>{Math.round(metrics.focus_score)}</strong></div>
            <div><span>{chinese ? '控制画面' : 'Control frame'}</span><strong>{metrics.width}×{metrics.height}</strong></div>
        </div>}

        <div className='CameraAutoControlGrid'>
            {cards.map(card => <button
                type='button'
                className={`CameraAutoControlCard${card.active ? ' active' : ''}`}
                aria-label={card.label}
                aria-pressed={card.active}
                disabled={!controls || !!running || (!card.active && card.capability === false)}
                onClick={() => execute(card.active ? card.disable : card.enable)}
                key={card.key}
            >
                <span><strong>{card.label}</strong><i>{card.badge}</i></span>
                <em>{card.active ? (chinese ? '已激活' : 'Active') : (chinese ? '未激活' : 'Inactive')}</em>
                <small>{card.detail}</small>
            </button>)}
        </div>

        <div className='CameraTrialActions single'>
            <button type='button' disabled={!!running || trial.phase !== 'trial'} onClick={revertTrial}>
                {running === 'revertTrial' ? busyText : (chinese ? '撤销全部试调' : 'Revert all trials')}
            </button>
        </div>

        {running && running !== 'probe' && <div className='CameraControlProgress'><span/><b>{busyText}</b></div>}
    </aside>;
};

export default CameraControlPanel;
