import React, {useEffect, useRef, useState} from 'react';
import {Language} from '../../../data/LanguageConfig';
import {
    CameraControlResult,
    CameraImageMetrics,
    CameraResourceService,
} from '../../../services/CameraResourceService';
import {
    CameraControlsWithTrial,
    CameraTrialResult,
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

type RunningAction = 'probe' | 'exposure' | 'focus' | 'restoreExposure' | 'restoreFocus' | 'revertTrial' | 'applyTrial' | 'close' | null;
type ToggleAction = 'exposure' | 'focus' | 'restoreExposure' | 'restoreFocus';
const DEFAULT_TARGET_LUMA = 0.35;
const IDLE_TRIAL: CameraTrialStatus = {
    phase: 'idle',
    dirty: false,
    active: {auto_exposure: false, auto_focus: false},
    started_at: null,
    expires_at: null,
    applied_at: null,
};

const percent = (value: number): string => `${Math.round(value * 100)}%`;

const shutter = (microseconds: number): string => {
    if (!microseconds) return '—';
    const denominator = Math.round(1_000_000 / microseconds);
    return denominator > 1 ? `1/${denominator}s` : `${(microseconds / 1_000_000).toFixed(2)}s`;
};

const CameraControlPanel: React.FC<IProps> = ({resourceId, language, onClose, onBeforeAction}) => {
    const chinese = language === Language.CHINESE;
    const [controls, setControls] = useState<CameraControlsWithTrial | null>(null);
    const [metrics, setMetrics] = useState<CameraImageMetrics | null>(null);
    const [lastResult, setLastResult] = useState<CameraTrialResult | CameraControlResult | null>(null);
    const [running, setRunning] = useState<RunningAction>('probe');
    const [error, setError] = useState('');
    const trialRef = useRef<CameraTrialStatus>(IDLE_TRIAL);

    const applyResult = (result: CameraTrialResult | CameraControlResult) => {
        const trial = 'trial' in result && result.trial ? result.trial : trialRef.current;
        trialRef.current = trial;
        setLastResult(result);
        setMetrics(result.after);
        setControls(previous => previous ? {
            ...previous,
            trial,
            active: result.active ?? {
                auto_exposure: result.action === 'auto_exposure'
                    ? true
                    : result.action === 'restore_auto_exposure'
                        ? false
                        : previous.active?.auto_exposure ?? previous.state.exposure.mode === 'manual',
                auto_focus: result.action === 'auto_focus'
                    ? true
                    : result.action === 'restore_auto_focus'
                        ? false
                        : previous.active?.auto_focus ?? false,
            },
            state: result.state,
            metrics: result.after,
        } : previous);
    };

    useEffect(() => {
        let active = true;
        setRunning('probe');
        CameraResourceService.controls(resourceId)
            .then(value => {
                if (!active) return;
                setControls(value);
                trialRef.current = (value as CameraControlsWithTrial).trial ?? IDLE_TRIAL;
                setMetrics(value.metrics);
                setError('');
            })
            .catch(reason => {
                if (active) setError(reason instanceof Error ? reason.message : String(reason));
            })
            .finally(() => {
                if (active) setRunning(null);
            });
        return () => { active = false; };
    }, [resourceId]);

    useEffect(() => () => {
        if (trialRef.current.phase === 'trial') {
            void CameraTrialService.revert(resourceId, true).catch(() => undefined);
        }
    }, [resourceId]);

    const execute = async (action: ToggleAction) => {
        if (running) return;
        if (action === 'exposure' || action === 'focus') onBeforeAction?.();
        setRunning(action);
        setError('');
        setLastResult(null);
        try {
            let result: CameraControlResult;
            if (action === 'exposure') {
                result = await CameraResourceService.autoExposure(resourceId, DEFAULT_TARGET_LUMA);
            } else if (action === 'focus') {
                result = await CameraResourceService.autoFocus(resourceId);
            } else if (action === 'restoreExposure') {
                result = await CameraResourceService.restoreExposure(resourceId);
            } else {
                result = await CameraResourceService.restoreFocus(resourceId);
            }
            applyResult(result);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setRunning(null);
        }
    };

    const finishTrial = async (action: 'revertTrial' | 'applyTrial') => {
        if (running) return;
        setRunning(action);
        setError('');
        setLastResult(null);
        try {
            const result = action === 'revertTrial'
                ? await CameraTrialService.revert(resourceId)
                : await CameraTrialService.apply(resourceId);
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
            const result = await CameraTrialService.revert(resourceId);
            applyResult(result);
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
            : running === 'restoreExposure' || running === 'restoreFocus'
                ? (chinese ? '正在恢复…' : 'Restoring…')
                : running === 'revertTrial' || running === 'close'
                    ? (chinese ? '正在撤销试调…' : 'Reverting trial…')
                    : running === 'applyTrial'
                        ? (chinese ? '正在应用到相机…' : 'Applying to camera…')
                : (chinese ? '正在读取相机能力…' : 'Reading camera controls…');
    const exposureActive = controls?.active?.auto_exposure ?? false;
    const focusActive = controls?.active?.auto_focus ?? false;
    const trial = controls?.trial ?? IDLE_TRIAL;

    return <aside className='CameraControlPanel' id='camera-smart-controls'>
        <div className='CameraControlTitle'>
            <div>
                <strong>{chinese ? '智能调节' : 'Smart controls'}</strong>
                <span>{chinese ? '先试调对比，确认后再固定到相机' : 'Preview first, then apply fixed settings'}</span>
            </div>
            <button type='button' disabled={!!running && running !== 'probe'} onClick={closePanel} aria-label={chinese ? '关闭相机控制' : 'Close camera controls'}>×</button>
        </div>

        <div className={`CameraTrialState ${trial.phase}`}>
            <strong>{trial.phase === 'trial'
                ? (chinese ? '试调中 · 尚未确认' : 'Trial active · not applied')
                : trial.phase === 'applied'
                    ? (chinese ? '已应用到相机' : 'Applied to camera')
                    : (chinese ? '测试模式 · 尚未修改' : 'Test mode · unchanged')}</strong>
            <span>{trial.phase === 'trial'
                ? (chinese ? '关闭面板或撤销试调会恢复原参数' : 'Close or revert to restore the original settings')
                : trial.phase === 'applied'
                    ? (chinese ? '当前效果已作为固定参数保留' : 'The current result is retained as fixed settings')
                    : (chinese ? '自动调节只会先进入可撤销试调' : 'Automatic controls start as a reversible trial')}</span>
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

        <section className='CameraControlSection'>
            <div className='CameraControlSectionHeader'>
                <div><strong>{chinese ? '自动曝光' : 'Auto exposure'}</strong><span>AEC</span></div>
                <em>{exposureActive ? (chinese ? '已激活' : 'Active') : (chinese ? '未激活' : 'Inactive')}</em>
            </div>
            <div className='CameraCurrentValues'>
                <span>{chinese ? '快门' : 'Shutter'} <b>{shutter(controls?.state.exposure.shutter_us || 0)}</b></span>
                <span>{chinese ? '增益' : 'Gain'} <b>{controls?.state.exposure.gain_level ?? '—'}</b></span>
            </div>
            <div className='CameraControlButtons'>
                <button
                    type='button'
                    className={exposureActive ? 'active' : ''}
                    aria-pressed={exposureActive}
                    disabled={!!running || (!exposureActive && controls?.capabilities.auto_exposure === false)}
                    onClick={() => execute(exposureActive ? 'restoreExposure' : 'exposure')}
                >
                    {running === 'exposure' || running === 'restoreExposure'
                        ? busyText
                        : (chinese ? '自动曝光' : 'Auto exposure')}
                </button>
            </div>
        </section>

        <section className='CameraControlSection'>
            <div className='CameraControlSectionHeader'>
                <div><strong>{chinese ? '自动对焦' : 'Auto focus'}</strong><span>AF</span></div>
                <em>{focusActive ? (chinese ? '已激活' : 'Active') : (chinese ? '未激活' : 'Inactive')}</em>
            </div>
            <p>{chinese
                ? '触发镜头自动搜索清晰位置，并用 Tenengrad 指标验证结果。'
                : 'Runs lens one-push focus and verifies the result with a Tenengrad score.'}</p>
            <div className='CameraControlButtons'>
                <button
                    type='button'
                    className={focusActive ? 'active' : ''}
                    aria-pressed={focusActive}
                    disabled={!!running || (!focusActive && controls?.capabilities.auto_focus === false)}
                    onClick={() => execute(focusActive ? 'restoreFocus' : 'focus')}
                >
                    {running === 'focus' || running === 'restoreFocus'
                        ? busyText
                        : (chinese ? '自动对焦' : 'Auto focus')}
                </button>
            </div>
        </section>

        <div className='CameraTrialActions'>
            <button
                type='button'
                disabled={!!running || trial.phase !== 'trial'}
                onClick={() => finishTrial('revertTrial')}
            >
                {running === 'revertTrial' ? busyText : (chinese ? '撤销试调' : 'Revert trial')}
            </button>
            <button
                type='button'
                className='primary'
                disabled={!!running || trial.phase !== 'trial' || !trial.dirty}
                onClick={() => finishTrial('applyTrial')}
            >
                {running === 'applyTrial' ? busyText : (chinese ? '应用到相机' : 'Apply to camera')}
            </button>
        </div>

        {running && running !== 'probe' && <div className='CameraControlProgress'><span/><b>{busyText}</b></div>}
    </aside>;
};

export default CameraControlPanel;
