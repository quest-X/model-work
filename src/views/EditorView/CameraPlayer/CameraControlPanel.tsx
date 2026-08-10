import React, {useEffect, useMemo, useState} from 'react';
import {Language} from '../../../data/LanguageConfig';
import {
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
    unit?: string;
}> = [
    {field: 'brightness', chinese: '亮度', english: 'Brightness', min: -1, max: 1, step: 0.05},
    {field: 'contrast', chinese: '对比度', english: 'Contrast', min: 0, max: 3, step: 0.05},
    {field: 'gamma', chinese: 'Gamma', english: 'Gamma', min: 0.1, max: 3, step: 0.05},
    {field: 'saturation', chinese: '饱和度', english: 'Saturation', min: 0, max: 3, step: 0.05},
    {field: 'sharpness', chinese: '锐度', english: 'Sharpness', min: 0, max: 5, step: 0.1},
    {field: 'denoise', chinese: '降噪', english: 'Denoise', min: 0, max: 10, step: 0.25},
];

const CameraControlPanel: React.FC<IProps> = ({
    resourceId,
    language,
    onClose,
    onStreamChanged,
}) => {
    const chinese = language === Language.CHINESE;
    const [preview, setPreview] = useState<CameraPreviewState | null>(null);
    const [draft, setDraft] = useState<CameraPreviewSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
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

    const updatePreview = () => {
        if (!draft || !localDirty) return;
        void run(
            () => CameraPreviewService.update(resourceId, draft),
            chinese ? '已更新 1012 调参预览' : 'Updated the 1012 adjusted preview',
            true,
        );
    };

    return <aside className='CameraControlPanel CameraPreviewControlPanel' id='camera-smart-controls'>
        <div className='CameraControlTitle'>
            <div>
                <div className='CameraControlTitleHeading'>
                    <strong>{chinese ? '实时调参' : 'Live adjustments'}</strong>
                    <span className='CameraPreviewSafeBadge'>
                        {chinese ? '物理相机未修改' : 'Physical camera unchanged'}
                    </span>
                </div>
                <span>{chinese
                    ? '同一路物理码流：1011 原始 LIVE / 1012 软件调参 LIVE'
                    : 'Same physical source: original LIVE 1011 / software-adjusted LIVE 1012'}</span>
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
            <div className='CameraPreviewSliders'>
                {FIELD_DEFINITIONS.map(definition => <label key={definition.field}>
                    <span>
                        <strong>{chinese ? definition.chinese : definition.english}</strong>
                        <code>{draft[definition.field].toFixed(definition.step < 0.1 ? 2 : 1)}{definition.unit || ''}</code>
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
                    />
                </label>)}
            </div>
            <div className='CameraPreviewActions'>
                <button type='button' disabled={saving || !localDirty} onClick={updatePreview}>
                    {saving ? (chinese ? '正在重建逻辑流…' : 'Rebuilding streams…') : (chinese ? '更新调参预览' : 'Update preview')}
                </button>
                <button type='button' disabled={saving || !preview?.dirty} onClick={() => void run(
                    () => CameraPreviewService.apply(resourceId),
                    chinese ? '已保存为 OpenSight 方案' : 'Saved as the OpenSight preset',
                    false,
                )}>
                    {chinese ? '保存当前方案' : 'Save current preset'}
                </button>
                <button type='button' disabled={saving || !preview?.dirty} onClick={() => void run(
                    () => CameraPreviewService.revert(resourceId),
                    chinese ? '已恢复上次保存方案' : 'Restored the saved preset',
                    true,
                )}>
                    {chinese ? '恢复已保存' : 'Restore saved'}
                </button>
                <button type='button' disabled={saving} onClick={() => void run(
                    () => CameraPreviewService.reset(resourceId),
                    chinese ? '已恢复中性软件参数' : 'Restored neutral software settings',
                    true,
                )}>
                    {chinese ? '中性参数' : 'Neutral settings'}
                </button>
            </div>
        </>}
    </aside>;
};

export default CameraControlPanel;
