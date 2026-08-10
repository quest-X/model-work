import React, {useEffect, useMemo, useState} from 'react';
import {Language} from '../../../data/LanguageConfig';
import {
    CameraPreviewAutoAction,
    CameraPreviewMetrics,
    CameraPreviewService,
    CameraPreviewSettings,
    CameraPreviewState,
} from '../../../services/CameraPreviewService';
import './CameraControlPanel.scss';

interface IProps {
    resourceId: string;
    language: Language;
    onClose: () => void;
    onStreamChanged?: () => void;
}

type PreviewField = keyof CameraPreviewSettings;

const FIELD_DEFINITIONS: Array<{
    field: PreviewField;
    chinese: string;
    english: string;
    min: number;
    max: number;
    step: number;
}> = [
    {field: 'brightness', chinese: '亮度', english: 'Brightness', min: -1, max: 1, step: 0.05},
    {field: 'contrast', chinese: '对比度', english: 'Contrast', min: 0, max: 3, step: 0.05},
    {field: 'gamma', chinese: 'Gamma', english: 'Gamma', min: 0.1, max: 3, step: 0.05},
    {field: 'saturation', chinese: '饱和度', english: 'Saturation', min: 0, max: 3, step: 0.05},
    {field: 'sharpness', chinese: '锐度', english: 'Sharpness', min: 0, max: 5, step: 0.1},
    {field: 'denoise', chinese: '降噪', english: 'Denoise', min: 0, max: 10, step: 0.25},
];

const percent = (value: number): string => `${Math.round(value * 100)}%`;

const CameraControlPanel: React.FC<IProps> = ({
    resourceId,
    language,
    onClose,
    onStreamChanged,
}) => {
    const chinese = language === Language.CHINESE;
    const [preview, setPreview] = useState<CameraPreviewState | null>(null);
    const [draft, setDraft] = useState<CameraPreviewSettings | null>(null);
    const [metrics, setMetrics] = useState<CameraPreviewMetrics | null>(null);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [runningAuto, setRunningAuto] = useState<{
        action: CameraPreviewAutoAction;
        disabling: boolean;
    } | null>(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        let active = true;
        CameraPreviewService.get(resourceId)
            .then(value => {
                if (!active) return;
                setPreview(value);
                setDraft(value.current);
                setError('');
            })
            .catch(reason => {
                if (active) setError(reason instanceof Error ? reason.message : String(reason));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, [resourceId]);

    const localDirty = useMemo(() => {
        if (!preview || !draft) return false;
        return FIELD_DEFINITIONS.some(({field}) => draft[field] !== preview.current[field]);
    }, [draft, preview]);

    const run = async (
        action: () => Promise<CameraPreviewState>,
        success: string,
        reconnect: boolean,
    ) => {
        if (saving) return;
        setSaving(true);
        setError('');
        setMessage('');
        try {
            const value = await action();
            setPreview(value);
            setDraft(value.current);
            setMessage(success);
            if (reconnect) onStreamChanged?.();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setSaving(false);
        }
    };

    const toggleAuto = async (action: CameraPreviewAutoAction, label: string) => {
        if (saving) return;
        const disabling = preview?.active_automations[action] === true;
        setSaving(true);
        setRunningAuto({action, disabling});
        setError('');
        setMessage('');
        try {
            const value = disabling
                ? await CameraPreviewService.disableAuto(resourceId, action)
                : await CameraPreviewService.autoAdjust(resourceId, action);
            setPreview(value);
            setDraft(value.current);
            if (!disabling && 'auto_adjustment' in value) {
                setMetrics(value.auto_adjustment.metrics);
                setMessage(value.auto_adjustment.message);
            } else {
                setMessage(chinese
                    ? `已关闭${label}，其他自动项保持开启`
                    : `Disabled ${label}; other automatic controls remain active`);
            }
            onStreamChanged?.();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setRunningAuto(null);
            setSaving(false);
        }
    };

    const updatePreview = () => {
        if (!draft || !localDirty || saving) return;
        void run(
            () => CameraPreviewService.update(resourceId, draft),
            chinese ? '已更新 1012 调参预览' : 'Updated the 1012 adjusted preview',
            true,
        );
    };

    const applyToCamera = () => {
        if (!draft || saving || (!localDirty && !preview?.dirty)) return;
        const confirmed = window.confirm(chinese
            ? '确认将当前参数应用到物理相机？\n系统将先备份、写后回读，失败时自动恢复。'
            : 'Apply the current settings to the physical camera?\nOpenSight will back up, verify, and roll back on failure.');
        if (!confirmed) return;
        void run(
            async () => {
                if (localDirty) await CameraPreviewService.update(resourceId, draft);
                return CameraPreviewService.dispatch(resourceId);
            },
            chinese ? '已将当前参数应用到物理相机' : 'Applied the current settings to the physical camera',
            true,
        );
    };

    const autoCards: Array<{
        action: CameraPreviewAutoAction;
        label: string;
        badge: string;
        description: string;
        parameters: Array<{label: string; value: string}>;
    }> = draft ? [
        {
            action: 'exposure',
            label: chinese ? '自动曝光' : 'Auto exposure',
            badge: 'AEC',
            description: chinese ? '分析 1011 亮度，自动补偿 1012；不改物理快门与增益。' : 'Analyzes 1011 and compensates 1012 without changing camera exposure.',
            parameters: [
                {label: chinese ? '亮度' : 'Brightness', value: draft.brightness.toFixed(2)},
                {label: 'Gamma', value: draft.gamma.toFixed(2)},
            ],
        },
        {
            action: 'focus',
            label: chinese ? '自动对焦' : 'Auto focus',
            badge: 'AF',
            description: chinese ? '软件清晰增强，只改变 1012 锐度；不移动物理镜头。' : 'Software clarity enhancement on 1012; the physical lens does not move.',
            parameters: [
                {label: chinese ? '锐度' : 'Sharpness', value: draft.sharpness.toFixed(1)},
                {label: chinese ? '降噪' : 'Denoise', value: draft.denoise.toFixed(1)},
            ],
        },
        {
            action: 'wdr',
            label: chinese ? '自动宽动态' : 'Auto WDR',
            badge: 'WDR',
            description: chinese ? '分析 1011 高亮与暗部，为 1012 计算软件宽动态补偿。' : 'Analyzes highlights and shadows in 1011 for software WDR on 1012.',
            parameters: [
                {label: chinese ? '对比度' : 'Contrast', value: draft.contrast.toFixed(2)},
                {label: 'Gamma', value: draft.gamma.toFixed(2)},
            ],
        },
        {
            action: 'day-night',
            label: chinese ? '自动日夜' : 'Auto day/night',
            badge: 'D/N',
            description: chinese ? '按 1011 环境亮度切换 1012 软件日夜补偿；不切物理红外。' : 'Switches software day/night compensation without changing camera IR.',
            parameters: [
                {label: chinese ? '饱和度' : 'Saturation', value: draft.saturation.toFixed(2)},
                {label: chinese ? '降噪' : 'Denoise', value: draft.denoise.toFixed(1)},
            ],
        },
    ] : [];

    const busyText = runningAuto?.disabling
        ? (chinese ? '正在关闭该自动项…' : 'Disabling automatic control…')
        : runningAuto?.action === 'exposure'
        ? (chinese ? '正在分析画面并自动曝光…' : 'Analyzing automatic exposure…')
        : runningAuto?.action === 'focus'
            ? (chinese ? '正在分析清晰度并增强…' : 'Analyzing software focus…')
            : runningAuto?.action === 'wdr'
                ? (chinese ? '正在分析高亮与暗部…' : 'Analyzing software WDR…')
                : (chinese ? '正在判断日夜场景…' : 'Detecting day/night scene…');

    return <aside className='CameraControlPanel CameraPreviewControlPanel' id='camera-smart-controls'>
        <div className='CameraControlTitle'>
            <div>
                <div className='CameraControlTitleHeading'>
                    <strong>{chinese ? '智能调参' : 'Smart controls'}</strong>
                    <span className='CameraPreviewSafeBadge'>
                        {chinese ? '预览未下发' : 'Preview not dispatched'}
                    </span>
                </div>
                <span>{chinese
                    ? '调参先预览于 1012，确认后可应用到物理相机'
                    : 'Preview adjustments on 1012, then apply them to the physical camera'}</span>
            </div>
            <button type='button' disabled={saving} onClick={onClose} aria-label={chinese ? '关闭相机控制' : 'Close camera controls'}>×</button>
        </div>

        {loading && <div className='CameraControlLoading'><span/>{chinese ? '正在读取预览方案…' : 'Reading preview preset…'}</div>}
        {error && <div className='CameraControlMessage error'>{error}</div>}
        {message && <div className='CameraControlMessage success'>{message}</div>}

        {draft && <>
            <div className='CameraLogicalStreamSummary'>
                <div><span>1011</span><strong>{chinese ? '原始对照' : 'Original'}</strong><em>LIVE</em></div>
                <div><span>1012</span><strong>{chinese ? '调参效果' : 'Adjusted'}</strong><em>LIVE</em></div>
            </div>

            {metrics && <div className='CameraMetricGrid'>
                <div><span>{chinese ? '画面亮度' : 'Luma'}</span><strong>{percent(metrics.luma)}</strong></div>
                <div><span>{chinese ? '过曝区域' : 'Clipped'}</span><strong>{percent(metrics.clipped_ratio)}</strong></div>
                <div><span>{chinese ? '清晰度' : 'Sharpness'}</span><strong>{Math.round(metrics.focus_score)}</strong></div>
                <div><span>{chinese ? '分析画面' : 'Control frame'}</span><strong>{metrics.width}×{metrics.height}</strong></div>
            </div>}

            <div className='CameraAutoControlList'>
                {autoCards.map(card => {
                    const active = preview?.active_automations[card.action] === true;
                    return <section
                        className={`CameraAutoControlSection${active ? ' active' : ''}`}
                        key={card.action}
                    >
                    <div className='CameraAutoControlHeading'>
                        <span><strong>{card.label}</strong><i>{card.badge}</i></span>
                        <em>{active
                            ? (chinese ? '已开启' : 'Enabled')
                            : (chinese ? '未开启' : 'Disabled')}</em>
                    </div>
                    <p>{card.description}</p>
                    <div className='CameraAutoControlParameters'>
                        {card.parameters.map(parameter => <span key={parameter.label}>
                            <small>{parameter.label}</small><b>{parameter.value}</b>
                        </span>)}
                    </div>
                    <button
                        type='button'
                        className={active ? 'active' : ''}
                        aria-label={card.label}
                        aria-pressed={active}
                        disabled={saving}
                        onClick={() => void toggleAuto(card.action, card.label)}
                    >
                        {runningAuto?.action === card.action ? busyText : card.label}
                    </button>
                </section>;})}
            </div>

            <button
                type='button'
                className={`CameraAdvancedToggle${advancedOpen ? ' open' : ''}`}
                aria-label={chinese ? '高级微调' : 'Advanced fine-tuning'}
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen(value => !value)}
            >
                <span>{chinese ? '高级微调' : 'Advanced fine-tuning'}</span>
                <i>{advancedOpen ? '−' : '+'}</i>
            </button>

            {advancedOpen && <div className='CameraAdvancedContent'>
                <div className='CameraPreviewSliders'>
                    {FIELD_DEFINITIONS.map(definition => <label key={definition.field}>
                        <span>
                            <strong>{chinese ? definition.chinese : definition.english}</strong>
                            <code>{draft[definition.field].toFixed(definition.step < 0.1 ? 2 : 1)}</code>
                        </span>
                        <input
                            type='range'
                            aria-label={chinese ? definition.chinese : definition.english}
                            min={definition.min}
                            max={definition.max}
                            step={definition.step}
                            value={draft[definition.field]}
                            disabled={saving}
                            onChange={event => setDraft({
                                ...draft,
                                [definition.field]: Number(event.target.value),
                            })}
                            onPointerUp={updatePreview}
                            onKeyUp={updatePreview}
                            onBlur={updatePreview}
                        />
                    </label>)}
                </div>
                <div className='CameraPreviewActions'>
                    <button type='button' disabled={saving} onClick={() => void run(
                        () => CameraPreviewService.reset(resourceId),
                        chinese ? '已恢复全部软件参数' : 'Restored all software settings',
                        true,
                    )}>
                        {chinese ? '恢复全部参数' : 'Restore all settings'}
                    </button>
                    <button
                        type='button'
                        className='danger'
                        disabled={saving || (!localDirty && !preview?.dirty)}
                        onClick={applyToCamera}
                    >
                        {saving
                            ? (chinese ? '正在处理…' : 'Working…')
                            : (chinese ? '应用到相机' : 'Apply to camera')}
                    </button>
                </div>
            </div>}
        </>}

        {runningAuto && <div className='CameraControlProgress'><span/><b>{busyText}</b></div>}
    </aside>;
};

export default CameraControlPanel;
