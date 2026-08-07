import React, {useEffect, useMemo, useState} from 'react';
import {connect} from 'react-redux';
import {Language} from '../../../data/LanguageConfig';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {AppState} from '../../../store';
import {ImageData} from '../../../store/labels/types';
import {CameraResourceService} from '../../../services/CameraResourceService';
import {getExtensionEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import './CameraConnectPopup.scss';

type CameraDevice = {
    name: string;
    model: string;
    serial_number: string;
    firmware_version: string;
    device_type: string;
    mac_address: string;
};

type CameraChannel = {
    id: string;
    name: string;
    enabled: boolean;
    codec: string;
    width: number | null;
    height: number | null;
    frame_rate: number | null;
    rtsp_url: string;
};

type CameraConnectResult = {
    status: 'success';
    device: CameraDevice;
    channels: CameraChannel[];
    snapshot_channel: string;
    playback_channel: string;
};

interface IProps {
    language: Language;
    imagesData: ImageData[];
}

const CameraConnectPopup: React.FC<IProps> = ({language, imagesData}) => {
    const chinese = language === Language.CHINESE;
    const [scheme, setScheme] = useState<'http' | 'https'>('http');
    const [host, setHost] = useState('');
    const [port, setPort] = useState('80');
    const [rtspPort, setRtspPort] = useState('554');
    const [username, setUsername] = useState('admin');
    const [password, setPassword] = useState('');
    const [verifyTls, setVerifyTls] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<CameraConnectResult | null>(null);
    const [channelId, setChannelId] = useState('101');
    const [previewUrl, setPreviewUrl] = useState('');
    const [resourceName, setResourceName] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    }, [previewUrl]);

    const requestBody = useMemo(() => ({
        scheme,
        host: host.trim(),
        port: Number(port),
        rtsp_port: Number(rtspPort),
        username: username.trim(),
        password,
        verify_tls: verifyTls,
        timeout_seconds: 8,
    }), [scheme, host, port, rtspPort, username, password, verifyTls]);

    const formInvalid = !host.trim()
        || !username.trim()
        || !password
        || !Number.isInteger(Number(port))
        || Number(port) < 1
        || Number(port) > 65535
        || !Number.isInteger(Number(rtspPort))
        || Number(rtspPort) < 1
        || Number(rtspPort) > 65535;

    const readError = async (response: Response): Promise<string> => {
        try {
            const body = await response.json();
            if (typeof body?.detail === 'string') return body.detail;
            if (Array.isArray(body?.detail)) {
                return body.detail.map((item: any) => item?.msg || String(item)).join('；');
            }
        } catch {
            // Fall through to the status-based message.
        }
        return chinese ? `请求失败（HTTP ${response.status}）` : `Request failed (HTTP ${response.status})`;
    };

    const connectCamera = async () => {
        if (formInvalid || connecting) return;
        setConnecting(true);
        setError('');
        setResult(null);
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            setPreviewUrl('');
        }
        try {
            const response = await fetch(`${getExtensionEngineBaseUrl()}/extensions/camera-connect/connect`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(requestBody),
            });
            if (!response.ok) throw new Error(await readError(response));
            const connected = await response.json() as CameraConnectResult;
            setResult(connected);
            setChannelId(connected.playback_channel || connected.snapshot_channel || connected.channels[0]?.id || '101');
            setResourceName(connected.device.name || connected.device.model || host.trim());
        } catch (connectionError) {
            setError(connectionError instanceof Error ? connectionError.message : String(connectionError));
        } finally {
            setConnecting(false);
        }
    };

    const loadSnapshot = async () => {
        if (!result || previewing) return;
        setPreviewing(true);
        setError('');
        try {
            const response = await fetch(`${getExtensionEngineBaseUrl()}/extensions/camera-connect/snapshot`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({...requestBody, channel_id: channelId}),
            });
            if (!response.ok) throw new Error(await readError(response));
            const nextUrl = URL.createObjectURL(await response.blob());
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(nextUrl);
        } catch (snapshotError) {
            setError(snapshotError instanceof Error ? snapshotError.message : String(snapshotError));
        } finally {
            setPreviewing(false);
        }
    };

    const saveCamera = async () => {
        if (!result || saving || !resourceName.trim()) return;
        setSaving(true);
        setError('');
        try {
            const resource = await CameraResourceService.create({
                ...requestBody,
                name: resourceName.trim(),
                channel_id: channelId,
            });
            setPassword('');
            window.dispatchEvent(new CustomEvent('opensight:camera-resource-updated'));
            await CameraResourceService.open(resource, imagesData);
            PopupActions.close();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : String(saveError));
        } finally {
            setSaving(false);
        }
    };

    const renderContent = () => (
        <div className='CameraConnectPopupContent'>
            <div className='CameraIntro'>
                {chinese
                    ? '使用 ISAPI Digest 验证海康网络摄像机。确认后将相机保存到资源中心，账号密码由服务端加密保存且不会返回浏览器。'
                    : 'Connect with Hikvision ISAPI Digest. Confirm to save the camera in Resource Center; credentials are encrypted server-side and never returned.'}
            </div>

            <div className='CameraForm'>
                <label>
                    <span>{chinese ? '协议' : 'Protocol'}</span>
                    <select value={scheme} onChange={event => {
                        const next = event.target.value as 'http' | 'https';
                        setScheme(next);
                        setPort(current => current === '80' || current === '443' ? (next === 'https' ? '443' : '80') : current);
                    }}>
                        <option value='http'>HTTP</option>
                        <option value='https'>HTTPS</option>
                    </select>
                </label>
                <label className='wide'>
                    <span>{chinese ? '相机 IP' : 'Camera IP'}</span>
                    <input autoFocus value={host} onChange={event => setHost(event.target.value)} placeholder='192.168.10.64'/>
                </label>
                <label>
                    <span>{chinese ? '管理端口' : 'HTTP port'}</span>
                    <input type='number' min='1' max='65535' value={port} onChange={event => setPort(event.target.value)}/>
                </label>
                <label>
                    <span>{chinese ? 'RTSP 端口' : 'RTSP port'}</span>
                    <input type='number' min='1' max='65535' value={rtspPort} onChange={event => setRtspPort(event.target.value)}/>
                </label>
                <label>
                    <span>{chinese ? '用户名' : 'Username'}</span>
                    <input value={username} autoComplete='username' onChange={event => setUsername(event.target.value)}/>
                </label>
                <label className='wide'>
                    <span>{chinese ? '密码' : 'Password'}</span>
                    <input type='password' value={password} autoComplete='new-password' onChange={event => setPassword(event.target.value)}/>
                </label>
                {scheme === 'https' && <label className='CameraCheckbox wide'>
                    <input type='checkbox' checked={verifyTls} onChange={event => setVerifyTls(event.target.checked)}/>
                    <span>{chinese ? '校验相机 TLS 证书' : 'Verify camera TLS certificate'}</span>
                </label>}
            </div>

            {error && <div className='CameraBanner error'>{error}</div>}
            {result && <>
                <div className='CameraBanner success'>
                    {chinese ? '相机连接成功' : 'Camera connected'}
                </div>
                <div className='CameraDeviceGrid'>
                    <div><span>{chinese ? '名称' : 'Name'}</span><strong>{result.device.name || '—'}</strong></div>
                    <div><span>{chinese ? '型号' : 'Model'}</span><strong>{result.device.model || '—'}</strong></div>
                    <div><span>{chinese ? '固件' : 'Firmware'}</span><strong>{result.device.firmware_version || '—'}</strong></div>
                    <div><span>{chinese ? '设备类型' : 'Device type'}</span><strong>{result.device.device_type || '—'}</strong></div>
                </div>
                <div className='CameraChannels'>
                    <div className='CameraSectionTitle'>{chinese ? '发现的码流' : 'Discovered streams'}</div>
                    {result.channels.length === 0
                        ? <div className='CameraEmpty'>{chinese ? '未返回码流配置，可尝试默认通道 101 抓图。' : 'No stream configuration returned. You can still try channel 101.'}</div>
                        : result.channels.map(channel => <div className='CameraChannelRow' key={channel.id}>
                            <span className={channel.enabled ? 'CameraDot ready' : 'CameraDot'}/>
                            <strong>{channel.name || `${chinese ? '通道' : 'Channel'} ${channel.id}`}</strong>
                            <span>{channel.codec || '—'}</span>
                            <span>{channel.width && channel.height ? `${channel.width}×${channel.height}` : '—'}</span>
                            <span>{channel.frame_rate ? `${channel.frame_rate} fps` : '—'}</span>
                            <code title={channel.rtsp_url}>{channel.rtsp_url}</code>
                        </div>)}
                </div>
                <div className='CameraPreviewControls'>
                    <label className='CameraResourceName'>
                        <span>{chinese ? '资源名称' : 'Resource name'}</span>
                        <input value={resourceName} onChange={event => setResourceName(event.target.value)} maxLength={128}/>
                    </label>
                    <select value={channelId} onChange={event => setChannelId(event.target.value)}>
                        {(result.channels.length ? result.channels : [{id: '101'} as CameraChannel]).map(channel =>
                            <option key={channel.id} value={channel.id}>{chinese ? '通道' : 'Channel'} {channel.id}</option>)}
                    </select>
                    <button type='button' onClick={loadSnapshot} disabled={previewing}>
                        {previewing ? (chinese ? '正在抓图…' : 'Loading…') : (chinese ? '抓图预览' : 'Preview snapshot')}
                    </button>
                </div>
                {previewUrl && <img className='CameraPreview' src={previewUrl} alt={chinese ? '相机抓图预览' : 'Camera snapshot'}/>}
            </>}
        </div>
    );

    return <GenericYesNoPopup
        title={chinese ? '连接相机' : 'Connect Camera'}
        renderContent={renderContent}
        acceptLabel={saving
            ? (chinese ? '正在保存…' : 'Saving…')
            : connecting
                ? (chinese ? '正在连接…' : 'Connecting…')
                : result ? (chinese ? '确认' : 'Confirm') : (chinese ? '连接' : 'Connect')}
        onAccept={result ? saveCamera : connectCamera}
        disableAcceptButton={formInvalid || connecting || saving || (!!result && !resourceName.trim())}
        rejectLabel={chinese ? '关闭' : 'Close'}
        onReject={PopupActions.close}
    />;
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
    imagesData: state.labels.imagesData,
});

export default connect(mapStateToProps)(CameraConnectPopup);
