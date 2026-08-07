import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Language} from '../../../data/LanguageConfig';
import {
    CameraManualParameterUpdate,
    CameraParameterComparison,
    CameraParameterService,
    CameraParameterSnapshot,
} from '../../../services/CameraParameterService';
import {CameraTrialService} from '../../../services/CameraTrialService';
import type {CameraTrialStatus} from '../../../services/CameraTrialService';
import './CameraParametersPanel.scss';

interface IProps {
    resourceId: string;
    language: Language;
    onClose: () => void;
}

const AUTO_REFRESH_INTERVAL_MS = 5000;
const SHUTTER_STEPS_US = [100, 250, 500, 1000, 1333, 2000, 2500, 3333, 4000, 5000, 5714, 6667, 8000, 10000];

type EditableField = keyof CameraManualParameterUpdate;
type EditorOption = {value: string; label: string};
type ParameterEditor = {
    field: EditableField;
    type: 'number' | 'select';
    options?: EditorOption[];
    min?: number;
    max?: number;
    requiresManualExposure?: boolean;
};

type ParameterRow = {
    label: string;
    original: unknown;
    current: unknown;
    path: string;
    format?: (value: unknown) => string;
    editor?: ParameterEditor;
};

type PendingEdit = {
    path: string;
    label: string;
    value: string;
    editor: ParameterEditor;
};

interface ICurrentValueProps {
    row: ParameterRow;
    format: (value: unknown) => string;
    edit: PendingEdit | null;
    canEdit: boolean;
    chinese: boolean;
    busy: boolean;
    saving: boolean;
    onStartEdit: (row: ParameterRow) => void;
    onChange: (edit: PendingEdit) => void;
    onCancel: () => void;
    onSave: () => Promise<void>;
}

const CurrentParameterValue: React.FC<ICurrentValueProps> = ({
    row,
    format,
    edit,
    canEdit,
    chinese,
    busy,
    saving,
    onStartEdit,
    onChange,
    onCancel,
    onSave,
}) => {
    if (edit?.path === row.path) {
        return <form className='CameraParameterEditor' onSubmit={event => { event.preventDefault(); void onSave(); }}>
            {edit.editor.type === 'select'
                ? <select aria-label={`${edit.label}${chinese ? '当前值' : ' current value'}`} autoFocus value={edit.value} disabled={saving} onChange={event => onChange({...edit, value: event.target.value})}>
                    {edit.editor.options?.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
                : <input aria-label={`${edit.label}${chinese ? '当前值' : ' current value'}`} autoFocus type='number' min={edit.editor.min} max={edit.editor.max} value={edit.value} disabled={saving} onChange={event => onChange({...edit, value: event.target.value})}/>} 
            <button type='submit' className='save' disabled={saving || edit.value === ''} aria-label={`${chinese ? '确认修改' : 'Save '}${edit.label}`}>✓</button>
            <button type='button' disabled={saving} onClick={onCancel} aria-label={`${chinese ? '取消修改' : 'Cancel '}${edit.label}`}>×</button>
        </form>;
    }
    if (canEdit) {
        return <button type='button' className='CameraParameterEditableValue' disabled={busy} onClick={() => onStartEdit(row)} aria-label={`${chinese ? '编辑' : 'Edit '}${row.label}`}>
            <span>{format(row.current)}</span><i aria-hidden='true'>✎</i>
        </button>;
    }
    return <code>{format(row.current)}</code>;
};

const text = (value: unknown): string => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? '是' : '否';
    return String(value);
};

const number = (digits = 0) => (value: unknown): string =>
    typeof value === 'number' ? value.toFixed(digits) : text(value);

const percent = (value: unknown): string =>
    typeof value === 'number' ? `${Math.round(value * 100)}%` : text(value);

const shutter = (value: unknown): string => {
    if (typeof value !== 'number' || value <= 0) return text(value);
    const denominator = Math.round(1_000_000 / value);
    return denominator > 1 ? `1/${denominator}s (${Math.round(value)} μs)` : `${(value / 1_000_000).toFixed(2)}s`;
};

const time = (value: string): string => {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
};

const channel = (snapshot: CameraParameterSnapshot) =>
    snapshot.channels.find(item => item.id === snapshot.connection.channel_id) || snapshot.channels[0];

// A declarative comparison table is clearer here than splitting each section into stateful components.
// eslint-disable-next-line complexity
const rows = (
    comparison: CameraParameterComparison,
    chinese: boolean,
): Array<{title: string; rows: ParameterRow[]}> => {
    const before = comparison.original;
    const after = comparison.current;
    const beforeChannel = channel(before);
    const afterChannel = channel(after);
    const beforeChannelIndex = Math.max(0, beforeChannel ? before.channels.indexOf(beforeChannel) : 0);
    const beforeExposure = before.controls?.state?.exposure;
    const afterExposure = after.controls?.state?.exposure;
    const beforeFocus = before.controls?.state?.focus;
    const afterFocus = after.controls?.state?.focus;
    const beforeWdr = before.controls?.state?.wdr;
    const afterWdr = after.controls?.state?.wdr;
    const beforeDayNight = before.controls?.state?.day_night;
    const afterDayNight = after.controls?.state?.day_night;
    const beforeMetrics = before.controls?.metrics;
    const afterMetrics = after.controls?.metrics;
    return [
        {
            title: chinese ? '连接参数' : 'Connection',
            rows: [
                {label: chinese ? '管理地址' : 'Management address', original: `${before.connection.scheme}://${before.connection.host}:${before.connection.management_port}`, current: `${after.connection.scheme}://${after.connection.host}:${after.connection.management_port}`, path: 'connection'},
                {label: chinese ? 'RTSP 端口' : 'RTSP port', original: before.connection.rtsp_port, current: after.connection.rtsp_port, path: 'connection.rtsp_port'},
                {label: chinese ? '播放通道' : 'Playback channel', original: before.connection.channel_id, current: after.connection.channel_id, path: 'connection.channel_id'},
            ],
        },
        {
            title: chinese ? '设备信息' : 'Device',
            rows: [
                {label: chinese ? '设备名称' : 'Device name', original: before.device.name, current: after.device.name, path: 'device.name'},
                {label: chinese ? '型号' : 'Model', original: before.device.model, current: after.device.model, path: 'device.model'},
                {label: chinese ? '设备类型' : 'Device type', original: before.device.device_type, current: after.device.device_type, path: 'device.device_type'},
                {label: chinese ? '序列号' : 'Serial number', original: before.device.serial_number, current: after.device.serial_number, path: 'device.serial_number'},
                {label: chinese ? '固件版本' : 'Firmware', original: before.device.firmware_version, current: after.device.firmware_version, path: 'device.firmware_version'},
                {label: 'MAC', original: before.device.mac_address, current: after.device.mac_address, path: 'device.mac_address'},
            ],
        },
        {
            title: chinese ? '当前码流' : 'Selected stream',
            rows: [
                {label: chinese ? '编码' : 'Codec', original: beforeChannel?.codec, current: afterChannel?.codec, path: `channels.${beforeChannelIndex}.codec`},
                {label: chinese ? '分辨率' : 'Resolution', original: beforeChannel && `${beforeChannel.width || '—'}×${beforeChannel.height || '—'}`, current: afterChannel && `${afterChannel.width || '—'}×${afterChannel.height || '—'}`, path: `channels.${beforeChannelIndex}.width|channels.${beforeChannelIndex}.height`},
                {label: chinese ? '帧率' : 'Frame rate', original: beforeChannel?.frame_rate, current: afterChannel?.frame_rate, path: `channels.${beforeChannelIndex}.frame_rate`, format: value => value === null || value === undefined ? '—' : `${value} fps`},
                {label: chinese ? '启用状态' : 'Enabled', original: beforeChannel?.enabled, current: afterChannel?.enabled, path: `channels.${beforeChannelIndex}.enabled`},
            ],
        },
        {
            title: chinese ? '曝光与对焦' : 'Exposure and focus',
            rows: [
                {label: chinese ? '曝光模式' : 'Exposure mode', original: beforeExposure?.mode, current: afterExposure?.mode, path: 'controls.state.exposure.mode', editor: {field: 'exposure_mode', type: 'select', requiresManualExposure: true, options: [{value: 'auto', label: chinese ? '自动' : 'Auto'}, {value: 'manual', label: chinese ? '手动' : 'Manual'}]}},
                {label: chinese ? '快门' : 'Shutter', original: beforeExposure?.shutter_us, current: afterExposure?.shutter_us, path: 'controls.state.exposure.shutter_us', format: shutter, editor: {field: 'shutter_us', type: 'select', requiresManualExposure: true, options: SHUTTER_STEPS_US.map(value => ({value: String(value), label: shutter(value)}))}},
                {label: chinese ? '增益等级' : 'Gain level', original: beforeExposure?.gain_level, current: afterExposure?.gain_level, path: 'controls.state.exposure.gain_level', editor: {field: 'gain_level', type: 'number', min: 0, max: 100, requiresManualExposure: true}},
                {label: chinese ? '对焦模式' : 'Focus mode', original: beforeFocus?.mode, current: afterFocus?.mode, path: 'controls.state.focus.mode', editor: {field: 'focus_mode', type: 'select', options: [{value: 'auto', label: chinese ? '自动' : 'Auto'}, {value: 'manual', label: chinese ? '手动' : 'Manual'}, {value: 'semi_auto', label: chinese ? '半自动' : 'Semi-auto'}]}},
                {label: chinese ? '对焦位置' : 'Focus position', original: beforeFocus?.position, current: afterFocus?.position, path: 'controls.state.focus.position'},
                {label: chinese ? '相对位置' : 'Relative position', original: beforeFocus?.relative_position, current: afterFocus?.relative_position, path: 'controls.state.focus.relative_position'},
                {label: chinese ? '对焦速度' : 'Focus speed', original: beforeFocus?.speed_level, current: afterFocus?.speed_level, path: 'controls.state.focus.speed_level', editor: {field: 'focus_speed_level', type: 'select', options: [1, 2, 3].map(value => ({value: String(value), label: String(value)}))}},
            ],
        },
        {
            title: chinese ? '宽动态与日夜模式' : 'WDR and day/night',
            rows: [
                {label: chinese ? '宽动态模式' : 'WDR mode', original: beforeWdr?.mode, current: afterWdr?.mode, path: 'controls.state.wdr.mode'},
                {label: chinese ? '宽动态等级' : 'WDR level', original: beforeWdr?.level, current: afterWdr?.level, path: 'controls.state.wdr.level'},
                {label: chinese ? '日夜模式' : 'Day/night mode', original: beforeDayNight?.mode, current: afterDayNight?.mode, path: 'controls.state.day_night.mode'},
            ],
        },
        {
            title: chinese ? '画面测量' : 'Image measurements',
            rows: [
                {label: chinese ? '亮度' : 'Luma', original: beforeMetrics?.luma, current: afterMetrics?.luma, path: 'controls.metrics.luma', format: percent},
                {label: chinese ? '暗部比例' : 'Dark areas', original: beforeMetrics?.dark_ratio, current: afterMetrics?.dark_ratio, path: 'controls.metrics.dark_ratio', format: percent},
                {label: chinese ? '过曝比例' : 'Clipped areas', original: beforeMetrics?.saturation_ratio, current: afterMetrics?.saturation_ratio, path: 'controls.metrics.saturation_ratio', format: percent},
                {label: chinese ? '清晰度' : 'Sharpness', original: beforeMetrics?.focus_score, current: afterMetrics?.focus_score, path: 'controls.metrics.focus_score', format: number(0)},
                {label: chinese ? '测量画面' : 'Measurement frame', original: beforeMetrics && `${beforeMetrics.width}×${beforeMetrics.height}`, current: afterMetrics && `${afterMetrics.width}×${afterMetrics.height}`, path: 'controls.metrics.width'},
            ],
        },
    ];
};

// eslint-disable-next-line complexity
const CameraParametersPanel: React.FC<IProps> = ({resourceId, language, onClose}) => {
    const chinese = language === Language.CHINESE;
    const [comparison, setComparison] = useState<CameraParameterComparison | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [edit, setEdit] = useState<PendingEdit | null>(null);
    const [saving, setSaving] = useState(false);
    const [trialAction, setTrialAction] = useState<'apply' | 'revert' | 'close' | null>(null);
    const [confirmApply, setConfirmApply] = useState(false);
    const requestTokenRef = useRef(0);
    const pausePollingRef = useRef(false);
    const trialRef = useRef<CameraTrialStatus | undefined>();

    const refresh = useCallback(async () => {
        const requestToken = ++requestTokenRef.current;
        setLoading(true);
        setError('');
        try {
            const value = await CameraParameterService.compare(resourceId);
            if (requestToken === requestTokenRef.current) setComparison(value);
        } catch (reason) {
            if (requestToken === requestTokenRef.current) {
                setError(reason instanceof Error ? reason.message : String(reason));
            }
        } finally {
            if (requestToken === requestTokenRef.current) setLoading(false);
        }
    }, [resourceId]);

    useEffect(() => {
        let active = true;
        let firstRead = true;
        let timer: number | undefined;

        const poll = async () => {
            if (!active) return;
            if (firstRead || (!document.hidden && !pausePollingRef.current)) await refresh();
            firstRead = false;
            if (active) timer = window.setTimeout(poll, AUTO_REFRESH_INTERVAL_MS);
        };

        void poll();
        return () => {
            active = false;
            if (timer !== undefined) window.clearTimeout(timer);
            requestTokenRef.current += 1;
        };
    }, [refresh]);

    const trial = comparison?.current.controls?.trial;
    useEffect(() => {
        trialRef.current = trial;
    }, [trial]);

    const startEdit = (row: ParameterRow) => {
        if (!row.editor || saving || trialAction) return;
        pausePollingRef.current = true;
        setError('');
        setEdit({
            path: row.path,
            label: row.label,
            value: String(row.current ?? ''),
            editor: row.editor,
        });
    };

    const cancelEdit = () => {
        setEdit(null);
        pausePollingRef.current = false;
    };

    const saveEdit = async () => {
        if (!edit || saving) return;
        const rawValue = edit.editor.type === 'number' || edit.editor.field === 'shutter_us' || edit.editor.field === 'focus_speed_level'
            ? Number(edit.value)
            : edit.value;
        const payload = {[edit.editor.field]: rawValue} as CameraManualParameterUpdate;
        pausePollingRef.current = true;
        setSaving(true);
        setError('');
        try {
            trialRef.current = await CameraParameterService.update(resourceId, payload);
            setEdit(null);
            await refresh();
            pausePollingRef.current = false;
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
            pausePollingRef.current = true;
        } finally {
            setSaving(false);
        }
    };

    const finishTrial = async (action: 'apply' | 'revert') => {
        if (saving || trialAction) return;
        pausePollingRef.current = true;
        setTrialAction(action);
        setError('');
        try {
            if (action === 'apply') await CameraTrialService.apply(resourceId);
            else await CameraTrialService.revert(resourceId);
            trialRef.current = undefined;
            setConfirmApply(false);
            await refresh();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setTrialAction(null);
            pausePollingRef.current = false;
        }
    };

    const closePanel = async () => {
        if (saving || trialAction) return;
        if (trial?.phase !== 'trial') {
            onClose();
            return;
        }
        pausePollingRef.current = true;
        setTrialAction('close');
        setError('');
        try {
            await CameraTrialService.revert(resourceId, true);
            trialRef.current = undefined;
            onClose();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
            setTrialAction(null);
            pausePollingRef.current = false;
        }
    };

    const sections = useMemo(
        () => comparison ? rows(comparison, chinese) : [],
        [comparison, chinese],
    );
    const changed = useMemo(() => new Set(comparison?.changed_paths || []), [comparison]);
    const isChanged = (path: string) => path.split('|').some(candidate => candidate === 'connection'
        ? Array.from(changed).some(item => item.startsWith('connection.'))
        : changed.has(candidate) || Array.from(changed).some(item => item.startsWith(`${candidate}.`)));

    return <aside className='CameraParametersPanel' id='camera-parameters-panel'>
        <header className='CameraParametersHeader'>
            <div>
                <strong>{chinese ? '相机参数' : 'Camera parameters'}</strong>
                <span>{chinese ? '原始值锁定；带铅笔的当前值可试调' : 'Original values are locked; pencil values are editable'}</span>
            </div>
            <div className='CameraParametersActions'>
                <span className={`CameraParametersAutoRefresh${loading ? ' loading' : ''}`} role='status'>
                    <i/>{loading ? (chinese ? '正在刷新' : 'Refreshing') : (chinese ? '自动刷新' : 'Auto refresh')}
                </span>
                <button type='button' className='close' disabled={saving || !!trialAction} onClick={closePanel} aria-label={chinese ? '关闭相机参数' : 'Close camera parameters'}>×</button>
            </div>
        </header>

        {loading && !comparison && <div className='CameraParametersLoading'><span/>{chinese ? '正在读取相机参数…' : 'Reading camera parameters…'}</div>}
        {error && <div className='CameraParametersMessage error'>{error}</div>}

        {comparison && <div className='CameraParametersBody'>
            <div className='CameraParametersSnapshotMeta'>
                <div className='original'>
                    <span>{chinese ? '左侧基准' : 'Left baseline'}</span>
                    <strong>{chinese ? '原始参数 · 已锁定' : 'Original · locked'}</strong>
                    <small>{comparison.original.source === 'connection'
                        ? (chinese ? '接入时快照' : 'Connection snapshot')
                        : (chinese ? '首次读取快照' : 'First-read snapshot')} · {time(comparison.original.captured_at)}</small>
                </div>
                <div className={comparison.current.live ? 'current live' : 'current stale'}>
                    <span>{chinese ? '右侧实时' : 'Right live'}</span>
                    <strong>{comparison.current.live
                        ? (chinese ? '当前参数 · 实时读取' : 'Current · live')
                        : (chinese ? '当前参数 · 未刷新' : 'Current · unavailable')}</strong>
                    <small>{time(comparison.current.captured_at)}</small>
                </div>
            </div>

            {comparison.original.source === 'first_read' && <div className='CameraParametersMessage notice'>
                {chinese
                    ? '该相机早于参数快照功能创建；原始值从本功能首次读取时开始保存。'
                    : 'This camera predates parameter snapshots; its baseline starts at the first parameter read.'}
            </div>}
            {comparison.current.errors.map(message => <div className='CameraParametersMessage warning' key={message}>{message}</div>)}

            {trial?.phase === 'trial' && <div className='CameraParameterTrialBar'>
                {!confirmApply ? <>
                    <div>
                        <strong>{chinese ? '当前参数仅处于临时试调' : 'Parameters are temporarily under trial'}</strong>
                        <span>{chinese ? '未确认下发会自动恢复；下发属于谨慎操作。' : 'Unconfirmed changes auto-revert; applying requires care.'}</span>
                    </div>
                    <button type='button' disabled={!!trialAction || saving} onClick={() => finishTrial('revert')}>
                        {trialAction === 'revert' ? (chinese ? '正在撤销…' : 'Reverting…') : (chinese ? '撤销修改' : 'Revert')}
                    </button>
                    <button type='button' className='danger' disabled={!!trialAction || saving || !trial.dirty} onClick={() => setConfirmApply(true)}>
                        {chinese ? '下发到相机' : 'Apply to camera'}
                    </button>
                </> : <div className='CameraParameterApplyConfirm'>
                    <div>
                        <strong>{chinese ? '确认下发当前参数？' : 'Apply the current parameters?'}</strong>
                        <span>{chinese ? '确认后相机会保留当前设置，平台将停止自动恢复。' : 'The camera will keep these settings and automatic rollback will stop.'}</span>
                    </div>
                    <button type='button' disabled={!!trialAction || saving} onClick={() => setConfirmApply(false)}>
                        {chinese ? '取消' : 'Cancel'}
                    </button>
                    <button type='button' className='danger confirm' disabled={!!trialAction || saving} onClick={() => finishTrial('apply')}>
                        {trialAction === 'apply' ? (chinese ? '正在下发…' : 'Applying…') : (chinese ? '确认下发' : 'Confirm apply')}
                    </button>
                </div>}
            </div>}

            <div className='CameraParametersColumnLabels'>
                <span>{chinese ? '参数' : 'Parameter'}</span>
                <span title={comparison.original.captured_at}>{chinese ? '原始值' : 'Original'}</span>
                <span title={comparison.current.captured_at}>{chinese ? '当前值 · ✎ 可修改' : 'Current · ✎ editable'}</span>
            </div>
            {sections.map(section => <section className='CameraParametersSection' key={section.title}>
                <h3>{section.title}</h3>
                {section.rows.map(row => {
                    const format = row.format || text;
                    const changedRow = isChanged(row.path);
                    const canEdit = !!row.editor && !!comparison.current.controls && comparison.current.live
                        && (!row.editor.requiresManualExposure || comparison.current.controls.capabilities.manual_exposure !== false);
                    const editing = edit?.path === row.path;
                    return <div className={`CameraParameterRow${changedRow ? ' changed' : ''}`} key={row.path}>
                        <span>{row.label}{changedRow && <em>{chinese ? '已变化' : 'Changed'}</em>}</span>
                        <code>{format(row.original)}</code>
                        <CurrentParameterValue
                            row={row}
                            format={format}
                            edit={editing ? edit : null}
                            canEdit={canEdit}
                            chinese={chinese}
                            busy={saving || !!trialAction}
                            saving={saving}
                            onStartEdit={startEdit}
                            onChange={setEdit}
                            onCancel={cancelEdit}
                            onSave={saveEdit}
                        />
                    </div>;
                })}
            </section>)}
        </div>}
    </aside>;
};

export default CameraParametersPanel;
