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
type ParameterSource = 'HCNetSDK' | 'ISAPI' | 'OpenSight' | '资源配置' | 'HCNetSDK + ISAPI';
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
    source?: ParameterSource;
};

type ParameterSection = {
    title: string;
    common: boolean;
    source: ParameterSource;
    rows: ParameterRow[];
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
): ParameterSection[] => {
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
    const sdkValue = (snapshot: CameraParameterSnapshot, group: string, key: string) =>
        snapshot.controls?.state?.sdk_image?.[group]?.[key];
    const sdkRow = (label: string, group: string, key: string, format?: (value: unknown) => string): ParameterRow => ({
        label,
        original: sdkValue(before, group, key),
        current: sdkValue(after, group, key),
        path: `controls.state.sdk_image.${group}.${key}`,
        format,
        source: 'HCNetSDK',
    });
    return [
        {
            title: chinese ? '连接参数' : 'Connection',
            common: false,
            source: '资源配置',
            rows: [
                {label: chinese ? '管理地址' : 'Management address', original: `${before.connection.scheme}://${before.connection.host}:${before.connection.management_port}`, current: `${after.connection.scheme}://${after.connection.host}:${after.connection.management_port}`, path: 'connection'},
                {label: chinese ? 'RTSP 端口' : 'RTSP port', original: before.connection.rtsp_port, current: after.connection.rtsp_port, path: 'connection.rtsp_port'},
                {label: chinese ? '播放通道' : 'Playback channel', original: before.connection.channel_id, current: after.connection.channel_id, path: 'connection.channel_id'},
            ],
        },
        {
            title: chinese ? '设备信息' : 'Device',
            common: false,
            source: 'ISAPI',
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
            common: false,
            source: 'ISAPI',
            rows: [
                {label: chinese ? '编码' : 'Codec', original: beforeChannel?.codec, current: afterChannel?.codec, path: `channels.${beforeChannelIndex}.codec`},
                {label: chinese ? '分辨率' : 'Resolution', original: beforeChannel && `${beforeChannel.width || '—'}×${beforeChannel.height || '—'}`, current: afterChannel && `${afterChannel.width || '—'}×${afterChannel.height || '—'}`, path: `channels.${beforeChannelIndex}.width|channels.${beforeChannelIndex}.height`},
                {label: chinese ? '帧率' : 'Frame rate', original: beforeChannel?.frame_rate, current: afterChannel?.frame_rate, path: `channels.${beforeChannelIndex}.frame_rate`, format: value => value === null || value === undefined ? '—' : `${value} fps`},
                {label: chinese ? '启用状态' : 'Enabled', original: beforeChannel?.enabled, current: afterChannel?.enabled, path: `channels.${beforeChannelIndex}.enabled`},
            ],
        },
        {
            title: chinese ? '曝光与对焦' : 'Exposure and focus',
            common: true,
            source: 'HCNetSDK + ISAPI',
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
            common: true,
            source: 'ISAPI',
            rows: [
                {label: chinese ? '宽动态模式' : 'WDR mode', original: beforeWdr?.mode, current: afterWdr?.mode, path: 'controls.state.wdr.mode'},
                {label: chinese ? '宽动态等级' : 'WDR level', original: beforeWdr?.level, current: afterWdr?.level, path: 'controls.state.wdr.level'},
                {label: chinese ? '日夜模式' : 'Day/night mode', original: beforeDayNight?.mode, current: afterDayNight?.mode, path: 'controls.state.day_night.mode'},
            ],
        },
        {
            title: chinese ? '画面测量' : 'Image measurements',
            common: true,
            source: 'OpenSight',
            rows: [
                {label: chinese ? '亮度' : 'Luma', original: beforeMetrics?.luma, current: afterMetrics?.luma, path: 'controls.metrics.luma', format: percent},
                {label: chinese ? '暗部比例' : 'Dark areas', original: beforeMetrics?.dark_ratio, current: afterMetrics?.dark_ratio, path: 'controls.metrics.dark_ratio', format: percent},
                {label: chinese ? '过曝比例' : 'Clipped areas', original: beforeMetrics?.saturation_ratio, current: afterMetrics?.saturation_ratio, path: 'controls.metrics.saturation_ratio', format: percent},
                {label: chinese ? '清晰度' : 'Sharpness', original: beforeMetrics?.focus_score, current: afterMetrics?.focus_score, path: 'controls.metrics.focus_score', format: number(0)},
                {label: chinese ? '测量画面' : 'Measurement frame', original: beforeMetrics && `${beforeMetrics.width}×${beforeMetrics.height}`, current: afterMetrics && `${afterMetrics.width}×${afterMetrics.height}`, path: 'controls.metrics.width'},
            ],
        },
        {
            title: chinese ? '图像效果（SDK）' : 'Image effects (SDK)',
            common: false,
            source: 'HCNetSDK',
            rows: [
                sdkRow(chinese ? '亮度等级' : 'Brightness level', 'video_effect', 'brightness_level'),
                sdkRow(chinese ? '对比度等级' : 'Contrast level', 'video_effect', 'contrast_level'),
                sdkRow(chinese ? '锐度等级' : 'Sharpness level', 'video_effect', 'sharpness_level'),
                sdkRow(chinese ? '饱和度等级' : 'Saturation level', 'video_effect', 'saturation_level'),
                sdkRow(chinese ? '色调等级' : 'Hue level', 'video_effect', 'hue_level'),
                sdkRow(chinese ? '强光抑制' : 'Highlight suppression', 'video_effect', 'strong_light_suppression_enabled'),
                sdkRow(chinese ? '强光抑制等级' : 'Highlight suppression level', 'video_effect', 'strong_light_suppression_level'),
                sdkRow(chinese ? '灰度范围' : 'Gray range', 'video_effect', 'gray_range'),
            ],
        },
        {
            title: chinese ? '白平衡与增益（SDK）' : 'White balance and gain (SDK)',
            common: false,
            source: 'HCNetSDK',
            rows: [
                sdkRow(chinese ? '白平衡模式' : 'White balance mode', 'white_balance', 'mode'),
                sdkRow(chinese ? '红色增益' : 'Red gain', 'white_balance', 'red_gain'),
                sdkRow(chinese ? '蓝色增益' : 'Blue gain', 'white_balance', 'blue_gain'),
                sdkRow(chinese ? 'SDK 增益等级' : 'SDK gain level', 'gain', 'level'),
                sdkRow(chinese ? '自定义增益' : 'Custom gain', 'gain', 'custom_level'),
                sdkRow(chinese ? '最大增益（dB）' : 'Maximum gain (dB)', 'gain', 'maximum_db'),
            ],
        },
        {
            title: chinese ? '高级曝光与日夜（SDK）' : 'Advanced exposure and day/night (SDK)',
            common: false,
            source: 'HCNetSDK',
            rows: [
                sdkRow(chinese ? '自动光圈灵敏度' : 'Auto iris level', 'exposure', 'auto_iris_level'),
                sdkRow(chinese ? '视频曝光上限（μs）' : 'Video exposure limit (μs)', 'exposure', 'video_exposure_us'),
                sdkRow(chinese ? '自定义曝光（μs）' : 'Custom exposure (μs)', 'exposure', 'custom_exposure_us'),
                sdkRow(chinese ? 'Gamma 启用' : 'Gamma enabled', 'gamma', 'enabled'),
                sdkRow(chinese ? 'Gamma 等级' : 'Gamma level', 'gamma', 'level'),
                sdkRow(chinese ? 'SDK 宽动态模式' : 'SDK WDR mode', 'wdr', 'mode'),
                sdkRow(chinese ? '宽动态等级 1' : 'WDR level 1', 'wdr', 'level_1'),
                sdkRow(chinese ? '宽动态等级 2' : 'WDR level 2', 'wdr', 'level_2'),
                sdkRow(chinese ? '宽动态对比度' : 'WDR contrast', 'wdr', 'contrast_level'),
                sdkRow(chinese ? 'SDK 日夜模式' : 'SDK day/night mode', 'day_night', 'mode'),
                sdkRow(chinese ? '日转夜阈值' : 'Day-to-night threshold', 'day_night', 'day_to_night_level'),
                sdkRow(chinese ? '夜转日阈值' : 'Night-to-day threshold', 'day_night', 'night_to_day_level'),
                sdkRow(chinese ? '日夜切换时间（秒）' : 'Day/night filter time (s)', 'day_night', 'filter_time_seconds'),
                sdkRow(chinese ? '日夜计划开始' : 'Day/night schedule start', 'day_night', 'schedule_start'),
                sdkRow(chinese ? '日夜计划结束' : 'Day/night schedule end', 'day_night', 'schedule_end'),
            ],
        },
        {
            title: chinese ? '背光、降噪与增强（SDK）' : 'Backlight, noise and enhancement (SDK)',
            common: false,
            source: 'HCNetSDK',
            rows: [
                sdkRow(chinese ? '背光补偿模式' : 'Backlight mode', 'backlight', 'mode'),
                sdkRow(chinese ? '背光补偿等级' : 'Backlight level', 'backlight', 'level'),
                sdkRow(chinese ? '降噪模式' : 'Noise reduction mode', 'noise_reduction', 'mode'),
                sdkRow(chinese ? '降噪等级' : 'Noise reduction level', 'noise_reduction', 'level'),
                sdkRow(chinese ? '空域降噪' : 'Spatial noise reduction', 'noise_reduction', 'spatial_level'),
                sdkRow(chinese ? '时域降噪' : 'Temporal noise reduction', 'noise_reduction', 'temporal_level'),
                sdkRow(chinese ? '电源频率' : 'Power line frequency', 'enhancement', 'power_line_frequency'),
                sdkRow(chinese ? '光圈模式代码' : 'Iris mode code', 'enhancement', 'iris_mode'),
                sdkRow(chinese ? '镜像模式' : 'Mirror mode', 'enhancement', 'mirror_mode'),
                sdkRow(chinese ? '数字变倍' : 'Digital zoom', 'enhancement', 'digital_zoom'),
                sdkRow(chinese ? '黑电平补偿' : 'Black level compensation', 'enhancement', 'black_level_compensation'),
                sdkRow(chinese ? '动态对比度' : 'Dynamic contrast', 'enhancement', 'dynamic_contrast_enabled'),
                sdkRow(chinese ? '动态对比度等级' : 'Dynamic contrast level', 'enhancement', 'dynamic_contrast_level'),
                sdkRow(chinese ? 'JPEG 质量' : 'JPEG quality', 'enhancement', 'jpeg_quality'),
                sdkRow(chinese ? '滤波开关' : 'Filter enabled', 'enhancement', 'filter_enabled'),
                sdkRow(chinese ? '场景模式代码' : 'Scene mode code', 'enhancement', 'scene_mode'),
                sdkRow(chinese ? '透雾模式' : 'Defog mode', 'enhancement', 'defog_mode'),
                sdkRow(chinese ? '透雾等级' : 'Defog level', 'enhancement', 'defog_level'),
                sdkRow(chinese ? '电子防抖' : 'Stabilization', 'enhancement', 'stabilization_enabled'),
                sdkRow(chinese ? '防抖等级' : 'Stabilization level', 'enhancement', 'stabilization_level'),
                sdkRow(chinese ? '走廊模式' : 'Corridor mode', 'enhancement', 'corridor_mode'),
                sdkRow(chinese ? '阶梯曝光' : 'Exposure segments', 'enhancement', 'exposure_segment_enabled'),
                sdkRow(chinese ? '亮度补偿' : 'Brightness compensation', 'enhancement', 'brightness_compensation'),
                sdkRow(chinese ? '畸变校正' : 'Lens distortion correction', 'enhancement', 'lens_distortion_correction'),
                sdkRow(chinese ? '畸变校正等级' : 'Distortion correction level', 'enhancement', 'distortion_correction_level'),
                sdkRow(chinese ? '水平视场角' : 'Horizontal FOV', 'enhancement', 'horizontal_fov'),
                sdkRow(chinese ? '垂直视场角' : 'Vertical FOV', 'enhancement', 'vertical_fov'),
                sdkRow(chinese ? '亮度突变抑制' : 'Brightness change suppression', 'enhancement', 'brightness_change_suppression'),
            ],
        },
        {
            title: chinese ? '镜头与补光（SDK）' : 'Lens and illumination (SDK)',
            common: false,
            source: 'HCNetSDK',
            rows: [
                sdkRow(chinese ? '自动对焦子模式' : 'Auto-focus sub-mode', 'lens', 'auto_focus_mode'),
                sdkRow(chinese ? '最小对焦距离（cm）' : 'Minimum focus distance (cm)', 'lens', 'minimum_focus_distance_cm'),
                sdkRow(chinese ? '变倍速度' : 'Zoom speed', 'lens', 'zoom_speed_level'),
                sdkRow(chinese ? '光学变倍位置' : 'Optical zoom position', 'lens', 'optical_zoom'),
                sdkRow(chinese ? '数字变倍位置' : 'Digital zoom position', 'lens', 'digital_zoom'),
                sdkRow(chinese ? '光学倍率' : 'Optical zoom level', 'lens', 'optical_zoom_level', number(2)),
                sdkRow(chinese ? '清晰度叠加' : 'Focus definition overlay', 'lens', 'focus_definition_overlay'),
                sdkRow(chinese ? '对焦灵敏度' : 'Focus sensitivity', 'lens', 'focus_sensitivity'),
                sdkRow(chinese ? '智能红外模式' : 'Smart IR mode', 'illumination', 'smart_ir_mode'),
                sdkRow(chinese ? '红外距离' : 'IR distance', 'illumination', 'ir_distance'),
                sdkRow(chinese ? '近光灯距离' : 'Short IR distance', 'illumination', 'short_ir_distance'),
                sdkRow(chinese ? '远光灯距离' : 'Long IR distance', 'illumination', 'long_ir_distance'),
                sdkRow(chinese ? 'P-Iris 模式' : 'P-Iris mode', 'illumination', 'p_iris_mode'),
                sdkRow(chinese ? 'P-Iris 光圈' : 'P-Iris aperture', 'illumination', 'p_iris_aperture'),
            ],
        },
    ];
};

// eslint-disable-next-line complexity
const CameraParametersPanel: React.FC<IProps> = ({resourceId, language, onClose}) => {
    const chinese = language === Language.CHINESE;
    const [advancedExpanded, setAdvancedExpanded] = useState(false);
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
    const commonSections = useMemo(() => sections.filter(section => section.common), [sections]);
    const advancedSections = useMemo(() => sections.filter(section => !section.common), [sections]);
    const visibleSections = useMemo(() => advancedExpanded
        ? [...commonSections, ...advancedSections]
        : commonSections, [advancedExpanded, commonSections, advancedSections]);
    const changed = useMemo(() => new Set(comparison?.changed_paths || []), [comparison]);
    const isChanged = (path: string) => path.split('|').some(candidate => candidate === 'connection'
        ? Array.from(changed).some(item => item.startsWith('connection.'))
        : changed.has(candidate) || Array.from(changed).some(item => item.startsWith(`${candidate}.`)));

    return <aside className='CameraParametersPanel' id='camera-parameters-panel'>
        <header className='CameraParametersHeader'>
            <div>
                <strong>{chinese ? '相机参数' : 'Camera parameters'}</strong>
                <span>{advancedExpanded
                    ? (chinese ? '已展开设备当前可读取的全部参数；原始值始终锁定' : 'All currently readable parameters are expanded; originals stay locked')
                    : (chinese ? '常用调节与画面判断；原始值始终锁定' : 'Everyday tuning and image evaluation; originals stay locked')}</span>
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
                    <small>{comparison.original.source === 'connection'
                        ? (chinese ? '接入时快照' : 'Connection snapshot')
                        : (chinese ? '首次读取快照' : 'First-read snapshot')} · {time(comparison.original.captured_at)}</small>
                </div>
                <div className={comparison.current.live ? 'current live' : 'current stale'}>
                    <span>{chinese ? '右侧实时' : 'Right live'}</span>
                    <small>{time(comparison.current.captured_at)}</small>
                </div>
            </div>

            {advancedExpanded && comparison.original.advanced_control_captured_at && <div className='CameraParametersMessage notice'>
                {chinese
                    ? `新增高级字段的原始值于 ${time(comparison.original.advanced_control_captured_at)} 首次锁定，已有原始字段未被覆盖。`
                    : `New advanced baselines were first locked at ${time(comparison.original.advanced_control_captured_at)}; existing originals were preserved.`}
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
            {visibleSections.map(section => <section className='CameraParametersSection' key={section.title}>
                <h3>{section.title}{advancedExpanded && <small>{section.source}</small>}</h3>
                {/* eslint-disable-next-line complexity */}
                {section.rows.map(row => {
                    const format = row.format || text;
                    const changedRow = isChanged(row.path);
                    const canEdit = !!row.editor && !!comparison.current.controls && comparison.current.live
                        && (!row.editor.requiresManualExposure || comparison.current.controls.capabilities.manual_exposure !== false);
                    const editing = edit?.path === row.path;
                    const supported = row.current !== null && row.current !== undefined && row.current !== '';
                    return <div className={`CameraParameterRow${changedRow ? ' changed' : ''}${supported ? '' : ' unsupported'}`} key={row.path}>
                        <span className='CameraParameterLabel'>
                            <b>{row.label}{changedRow && <em>{chinese ? '已变化' : 'Changed'}</em>}</b>
                            {advancedExpanded && <small>
                                <i>{row.source || section.source}</i>
                                <i className={supported ? 'supported' : 'unavailable'}>{supported ? (chinese ? '已读取' : 'Read') : (chinese ? '未返回' : 'Unavailable')}</i>
                                <i className={row.editor ? 'writable' : 'readonly'}>{row.editor ? (chinese ? '可修改' : 'Writable') : (chinese ? '只读' : 'Read only')}</i>
                            </small>}
                        </span>
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
            <div className='CameraParametersExpand'>
                <button
                    type='button'
                    aria-expanded={advancedExpanded}
                    onClick={() => setAdvancedExpanded(expanded => !expanded)}
                >
                    <strong>{advancedExpanded
                        ? (chinese ? '收起全部参数' : 'Collapse all parameters')
                        : (chinese ? '展开全部参数' : 'Expand all parameters')}</strong>
                    <i aria-hidden='true'>{advancedExpanded ? '⌃' : '⌄'}</i>
                </button>
            </div>
        </div>}
    </aside>;
};

export default CameraParametersPanel;
