import React, {useEffect, useState} from 'react';
import {Language} from '../../../data/LanguageConfig';
import {
    CameraControlResult,
    CameraControls,
    CameraImageMetrics,
    CameraResourceService,
} from '../../../services/CameraResourceService';
import './CameraControlPanel.scss';

interface IProps {
    resourceId: string;
    language: Language;
    onClose: () => void;
}

type RunningAction = 'probe' | 'exposure' | 'focus' | 'restoreExposure' | 'restoreFocus' | null;

const percent = (value: number): string => `${Math.round(value * 100)}%`;

const shutter = (microseconds: number): string => {
    if (!microseconds) return '—';
    const denominator = Math.round(1_000_000 / microseconds);
    return denominator > 1 ? `1/${denominator}s` : `${(microseconds / 1_000_000).toFixed(2)}s`;
};

const CameraControlPanel: React.FC<IProps> = ({resourceId, language, onClose}) => {
    const chinese = language === Language.CHINESE;
    const [controls, setControls] = useState<CameraControls | null>(null);
    const [metrics, setMetrics] = useState<CameraImageMetrics | null>(null);
    const [lastResult, setLastResult] = useState<CameraControlResult | null>(null);
    const [targetLuma, setTargetLuma] = useState(0.35);
    const [running, setRunning] = useState<RunningAction>('probe');
    const [error, setError] = useState('');

    const applyResult = (result: CameraControlResult) => {
        setLastResult(result);
        setMetrics(result.after);
        setControls(previous => previous ? {...previous, state: result.state, metrics: result.after} : previous);
    };

    useEffect(() => {
        let active = true;
        setRunning('probe');
        CameraResourceService.controls(resourceId)
            .then(value => {
                if (!active) return;
                setControls(value);
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

    const execute = async (action: Exclude<RunningAction, 'probe' | null>) => {
        if (running) return;
        setRunning(action);
        setError('');
        setLastResult(null);
        try {
            let result: CameraControlResult;
            if (action === 'exposure') {
                result = await CameraResourceService.autoExposure(resourceId, targetLuma);
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

    const busyText = running === 'exposure'
        ? (chinese ? '正在自动曝光…' : 'Auto exposing…')
        : running === 'focus'
            ? (chinese ? '正在自动对焦…' : 'Auto focusing…')
            : running === 'restoreExposure' || running === 'restoreFocus'
                ? (chinese ? '正在恢复…' : 'Restoring…')
                : (chinese ? '正在读取相机能力…' : 'Reading camera controls…');
    const exposureActive = controls?.state.exposure.mode === 'manual';
    const focusActive = controls?.state.focus.mode === 'manual';

    return <aside className='CameraControlPanel' id='camera-smart-controls'>
        <div className='CameraControlTitle'>
            <div>
                <strong>{chinese ? '智能调节' : 'Smart controls'}</strong>
                <span>{chinese ? '中央重点测光与清晰度分析' : 'Center-weighted metering and focus analysis'}</span>
            </div>
            <button type='button' onClick={onClose} aria-label={chinese ? '关闭相机控制' : 'Close camera controls'}>×</button>
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
            <label className='CameraTargetSlider'>
                <span>{chinese ? '目标亮度' : 'Target luma'} <b>{percent(targetLuma)}</b></span>
                <input
                    type='range'
                    min='0.18'
                    max='0.55'
                    step='0.01'
                    value={targetLuma}
                    onChange={event => setTargetLuma(Number(event.target.value))}
                    disabled={!!running}
                />
            </label>
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

        {running && running !== 'probe' && <div className='CameraControlProgress'><span/><b>{busyText}</b></div>}
    </aside>;
};

export default CameraControlPanel;
