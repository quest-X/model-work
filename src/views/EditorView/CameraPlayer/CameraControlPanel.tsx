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

type RunningAction = 'probe' | 'exposure' | 'focus' | 'wdr' | 'dayNight' | 'restoreExposure' | 'restoreFocus' | 'restoreWdr' | 'restoreDayNight' | 'close' | null;
type ToggleAction = Exclude<RunningAction, 'probe' | 'close' | null>;

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
const formatShutter = (microseconds: number | undefined): string => {
    if (!microseconds || microseconds <= 0) return '—';
    if (microseconds < 1_000_000) return `1/${Math.max(1, Math.round(1_000_000 / microseconds))}s`;
    const seconds = microseconds / 1_000_000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
};
const formatParameter = (value: number | null | undefined): string =>
    value === null || value === undefined ? '—' : String(value);

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
                        : running === 'close'
                            ? (chinese ? '正在撤销试调…' : 'Reverting trial…')
                            : (chinese ? '正在读取相机能力…' : 'Reading camera controls…');
    const active = controls?.active ?? INACTIVE;
    const trial = controls?.trial ?? IDLE_TRIAL;
    const modeLabel = (mode: string | undefined): string => {
        if (!mode) return '—';
        const labels: Record<string, string> = chinese ? {
            auto: '自动',
            manual: '手动',
            semi_auto: '半自动',
            open: '开启',
            close: '关闭',
            day: '白天',
            night: '夜间',
            schedule: '定时',
            unknown: '未知',
        } : {
            auto: 'Auto',
            manual: 'Manual',
            semi_auto: 'Semi-auto',
            open: 'Open',
            close: 'Closed',
            day: 'Day',
            night: 'Night',
            schedule: 'Schedule',
            unknown: 'Unknown',
        };
        return labels[mode] ?? mode;
    };
    const cards: Array<{
        key: string;
        label: string;
        badge: string;
        active: boolean;
        capability: boolean | undefined;
        enable: ToggleAction;
        disable: ToggleAction;
        description: string;
        parameters: Array<{label: string; value: string}>;
    }> = [
        {
            key: 'exposure',
            label: chinese ? '自动曝光' : 'Auto exposure',
            badge: 'AEC',
            active: active.auto_exposure,
            capability: controls?.capabilities.auto_exposure,
            enable: 'exposure',
            disable: 'restoreExposure',
            description: chinese ? '根据画面亮度自动计算快门与增益。' : 'Calculates shutter and gain from scene brightness.',
            parameters: [
                {label: chinese ? '模式' : 'Mode', value: modeLabel(controls?.state.exposure.mode)},
                {label: chinese ? '快门' : 'Shutter', value: formatShutter(controls?.state.exposure.shutter_us)},
                {label: chinese ? '增益' : 'Gain', value: formatParameter(controls?.state.exposure.gain_level)},
            ],
        },
        {
            key: 'focus',
            label: chinese ? '自动对焦' : 'Auto focus',
            badge: 'AF',
            active: active.auto_focus,
            capability: controls?.capabilities.auto_focus,
            enable: 'focus',
            disable: 'restoreFocus',
            description: chinese ? '自动搜索清晰位置，并用清晰度指标验证结果。' : 'Searches for a sharp lens position and verifies the result.',
            parameters: [
                {label: chinese ? '模式' : 'Mode', value: modeLabel(controls?.state.focus.mode)},
                {label: chinese ? '镜头位置' : 'Position', value: formatParameter(controls?.state.focus.position)},
                {label: chinese ? '速度级别' : 'Speed', value: formatParameter(controls?.state.focus.speed_level)},
            ],
        },
        {
            key: 'wdr',
            label: chinese ? '自动宽动态' : 'Auto WDR',
            badge: 'WDR',
            active: active.auto_wdr,
            capability: controls?.capabilities.auto_wdr,
            enable: 'wdr',
            disable: 'restoreWdr',
            description: chinese ? '自动平衡高亮与暗部细节，适合逆光场景。' : 'Balances highlights and shadows for backlit scenes.',
            parameters: [
                {label: chinese ? '模式' : 'Mode', value: modeLabel(controls?.state.wdr?.mode)},
                {label: chinese ? '强度' : 'Level', value: formatParameter(controls?.state.wdr?.level)},
            ],
        },
        {
            key: 'day-night',
            label: chinese ? '自动日夜' : 'Auto day/night',
            badge: 'D/N',
            active: active.auto_day_night,
            capability: controls?.capabilities.auto_day_night,
            enable: 'dayNight',
            disable: 'restoreDayNight',
            description: chinese ? '根据环境光线自动切换日间与夜间成像。' : 'Switches day and night imaging from ambient light.',
            parameters: [
                {label: chinese ? '模式' : 'Mode', value: modeLabel(controls?.state.day_night?.mode)},
                {
                    label: chinese ? '控制来源' : 'Control',
                    value: active.auto_day_night
                        ? (chinese ? '平台试调' : 'Platform trial')
                        : (chinese ? '相机原设' : 'Camera default'),
                },
            ],
        },
    ];

    return <aside className='CameraControlPanel' id='camera-smart-controls'>
        <div className='CameraControlTitle'>
            <div>
                <div className='CameraControlTitleHeading'>
                    <strong>{chinese ? '智能调参' : 'Smart controls'}</strong>
                    {trial.phase === 'trial' && <span className='CameraDebugBadge'>
                        {chinese ? '调试中' : 'Debugging'}
                    </span>}
                </div>
                <span>{chinese ? '四项独立试调；到相机参数确认下发' : 'Four independent trials; confirm apply in Camera parameters'}</span>
            </div>
            <button type='button' disabled={!!running && running !== 'probe'} onClick={closePanel} aria-label={chinese ? '关闭相机控制' : 'Close camera controls'}>×</button>
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

        <div className='CameraAutoControlList'>
            {cards.map(card => <section
                className={`CameraAutoControlSection${card.active ? ' active' : ''}`}
                key={card.key}
            >
                <div className='CameraAutoControlHeading'>
                    <span><strong>{card.label}</strong><i>{card.badge}</i></span>
                    <em>{card.capability === false
                        ? (chinese ? '设备不支持' : 'Unsupported')
                        : card.active
                            ? (chinese ? '已激活' : 'Active')
                            : (chinese ? '未激活' : 'Inactive')}</em>
                </div>
                <p>{card.description}</p>
                <div className='CameraAutoControlParameters'>
                    {card.parameters.map(parameter => <span key={parameter.label}>
                        <small>{parameter.label}</small>
                        <b>{parameter.value}</b>
                    </span>)}
                </div>
                <button
                    type='button'
                    className={card.active ? 'active' : ''}
                    aria-label={card.label}
                    aria-pressed={card.active}
                    disabled={!controls || !!running || (!card.active && card.capability === false)}
                    onClick={() => execute(card.active ? card.disable : card.enable)}
                >
                    {card.label}
                </button>
            </section>)}
        </div>

        {running && running !== 'probe' && <div className='CameraControlProgress'><span/><b>{busyText}</b></div>}
    </aside>;
};

export default CameraControlPanel;
