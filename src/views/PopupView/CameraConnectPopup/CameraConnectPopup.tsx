import React, {useEffect, useMemo, useState} from 'react';
import {connect} from 'react-redux';
import {Language} from '../../../data/LanguageConfig';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {AppState} from '../../../store';
import {ImageData} from '../../../store/labels/types';
import {
    CameraDiscoveryDevice,
    CameraDiscoveryResponse,
    CameraResource,
    CameraResourceService,
} from '../../../services/CameraResourceService';
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

export const CameraConnectPopup: React.FC<IProps> = ({language, imagesData}) => {
    const chinese = language === Language.CHINESE;
    const [scheme, setScheme] = useState<'http' | 'https'>('http');
    const [host, setHost] = useState('');
    const [port, setPort] = useState('80');
    const [rtspPort, setRtspPort] = useState('554');
    const [username, setUsername] = useState('');
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
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = useState('');
    const [discovery, setDiscovery] = useState<CameraDiscoveryResponse | null>(null);
    const [savedResources, setSavedResources] = useState<CameraResource[]>([]);
    const [savedResource, setSavedResource] = useState<CameraResource | null>(null);
    const [loadingCredentials, setLoadingCredentials] = useState(false);

    useEffect(() => () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    }, [previewUrl]);

    useEffect(() => {
        let active = true;
        CameraResourceService.list()
            .then(resources => {
                if (active) setSavedResources(resources);
            })
            .catch(() => {
                // Remembered connections are optional; manual entry must remain available.
            });
        return () => {
            active = false;
        };
    }, []);

    const savedByHost = useMemo(() => {
        const remembered = new Map<string, CameraResource>();
        [...savedResources]
            .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
            .forEach(resource => {
                if (!remembered.has(resource.host)) remembered.set(resource.host, resource);
            });
        return remembered;
    }, [savedResources]);

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

    const manualFormInvalid = !host.trim()
        || !username.trim()
        || !password
        || !Number.isInteger(Number(port))
        || Number(port) < 1
        || Number(port) > 65535
        || !Number.isInteger(Number(rtspPort))
        || Number(rtspPort) < 1
        || Number(rtspPort) > 65535;
    const formInvalid = manualFormInvalid;

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

    const scanCameras = async () => {
        if (scanning) return;
        setScanning(true);
        setScanError('');
        try {
            setDiscovery(await CameraResourceService.discover());
        } catch (scanFailure) {
            setScanError(scanFailure instanceof Error ? scanFailure.message : String(scanFailure));
        } finally {
            setScanning(false);
        }
    };

    const useSavedResource = async (resource: CameraResource) => {
        setLoadingCredentials(true);
        setSavedResource(resource);
        setScheme(resource.scheme);
        setHost(resource.host);
        setPort(String(resource.port));
        setRtspPort(String(resource.rtsp_port));
        setUsername('');
        setPassword('');
        setVerifyTls(false);
        setResult(null);
        setError('');
        setResourceName(resource.name);
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            setPreviewUrl('');
        }
        try {
            const profile = await CameraResourceService.credentials(resource.id);
            setScheme(profile.scheme);
            setHost(profile.host);
            setPort(String(profile.port));
            setRtspPort(String(profile.rtsp_port));
            setUsername(profile.username);
            setPassword(profile.password);
            setVerifyTls(profile.verify_tls);
        } catch (profileError) {
            setError(profileError instanceof Error ? profileError.message : String(profileError));
        } finally {
            setLoadingCredentials(false);
        }
    };

    const useDiscoveredCamera = (camera: CameraDiscoveryDevice) => {
        const remembered = savedByHost.get(camera.host);
        if (remembered) {
            void useSavedResource(remembered);
            return;
        }
        setSavedResource(null);
        setHost(camera.host);
        setScheme(camera.scheme);
        setPort(String(camera.port));
        setRtspPort(String(camera.rtsp_port));
        setUsername('');
        setPassword('');
        setVerifyTls(false);
        setResult(null);
        setError('');
        setResourceName(camera.name || camera.model || camera.host);
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            setPreviewUrl('');
        }
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
            const availableChannels = new Set(connected.channels.map(channel => channel.id));
            const savedChannel = savedResource?.channel_id;
            setChannelId(savedChannel && availableChannels.has(savedChannel)
                ? savedChannel
                : connected.playback_channel || connected.snapshot_channel || connected.channels[0]?.id || '101');
            setResourceName(savedResource?.name || connected.device.name || connected.device.model || host.trim());
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
            const payload = {
                ...requestBody,
                name: resourceName.trim(),
                channel_id: channelId,
            };
            const resource = savedResource
                ? await CameraResourceService.update(savedResource.id, payload)
                : await CameraResourceService.create(payload);
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
                    ? '使用 ISAPI Digest 验证海康网络摄像机。首次确认后会自动记住连接方式；下次选择相机时直接填入账号密码，可自行修改。'
                    : 'Connect with Hikvision ISAPI Digest. Confirmed settings are remembered and filled into the editable form when the camera is selected again.'}
            </div>

            {result && <div className='CameraBanner success CameraConnectionSuccess'>
                {chinese ? '相机连接成功' : 'Camera connected'}
            </div>}

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
                    <input
                        autoFocus
                        value={host}
                        onChange={event => setHost(event.target.value)}
                        onBlur={() => {
                            const remembered = savedByHost.get(host.trim());
                            if (remembered && !savedResource && !password) void useSavedResource(remembered);
                        }}
                        placeholder='192.168.10.64'
                    />
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
                    <input
                        value={username}
                        autoComplete='username'
                        placeholder='admin'
                        onChange={event => setUsername(event.target.value)}
                    />
                </label>
                <label className='wide'>
                    <span>{chinese ? '密码' : 'Password'}</span>
                    <input
                        type='password'
                        value={password}
                        autoComplete='current-password'
                        placeholder='123456'
                        onChange={event => setPassword(event.target.value)}
                    />
                </label>
                {scheme === 'https' && <label className='CameraCheckbox wide'>
                    <input type='checkbox' checked={verifyTls} onChange={event => setVerifyTls(event.target.checked)}/>
                    <span>{chinese ? '校验相机 TLS 证书' : 'Verify camera TLS certificate'}</span>
                </label>}
            </div>

            <section className='CameraDiscoveryPanel' aria-label={chinese ? '局域网相机发现' : 'LAN camera discovery'}>
                <div className='CameraDiscoveryHeader'>
                    <div>
                        <strong>{chinese ? '局域网相机发现' : 'LAN camera discovery'}</strong>
                        <span>{chinese
                            ? '从服务器当前网段发现 ONVIF、RTSP 及常见厂商相机；扫描不会提交账号密码。'
                            : 'Find ONVIF, RTSP, and common vendor cameras on the server LAN without sending credentials.'}</span>
                    </div>
                    <button type='button' onClick={scanCameras} disabled={scanning}>
                        {scanning
                            ? (chinese ? '正在扫描…' : 'Scanning…')
                            : (chinese ? '扫描局域网' : 'Scan LAN')}
                    </button>
                </div>
                {scanError && <div className='CameraDiscoveryError'>{scanError}</div>}
                {discovery && <>
                    <div className='CameraDiscoverySummary'>
                        {chinese
                            ? `已扫描 ${discovery.networks.join('、')} 的 ${discovery.scanned_hosts} 个地址，发现 ${discovery.devices.length} 台相机 · ${(discovery.duration_ms / 1000).toFixed(1)} 秒`
                            : `Scanned ${discovery.scanned_hosts} addresses on ${discovery.networks.join(', ')}; found ${discovery.devices.length} cameras · ${(discovery.duration_ms / 1000).toFixed(1)}s`}
                    </div>
                    {discovery.devices.length === 0
                        ? <div className='CameraDiscoveryEmpty'>
                            {chinese ? '未发现可识别的网络相机，可继续手动填写 IP。' : 'No identifiable network cameras found. You can still enter an IP manually.'}
                        </div>
                        : <div className='CameraDiscoveryResults'>
                            {discovery.devices.map(camera => {
                                const remembered = savedByHost.get(camera.host);
                                const selected = remembered
                                    ? savedResource?.id === remembered.id
                                    : !savedResource && host === camera.host;
                                return <button
                                    type='button'
                                    className={`CameraDiscoveryRow${remembered ? ' remembered' : ''}${selected ? ' selected' : ''}`}
                                    key={camera.host}
                                    onClick={() => useDiscoveredCamera(camera)}
                                    aria-pressed={selected}
                                >
                                    <span className={`CameraDiscoveryDot ${camera.confidence}`}/>
                                    <span className='CameraDiscoveryIdentity'>
                                        <strong>{remembered?.name || camera.name || camera.model || camera.host}</strong>
                                        <span>
                                            {remembered && (chinese ? '已保存连接 · ' : 'Saved connection · ')}
                                            {camera.manufacturer}{camera.model ? ` · ${camera.model}` : ''}
                                        </span>
                                    </span>
                                    <code>{camera.host}</code>
                                    <span className='CameraDiscoveryPorts'>
                                        {camera.open_ports.length ? `${chinese ? '端口' : 'Ports'} ${camera.open_ports.join(' / ')}` : 'ONVIF'}
                                    </span>
                                    <span className={`CameraDiscoveryStatus ${remembered ? 'saved' : 'disconnected'}`}>
                                        {remembered
                                            ? (chinese ? '已保存' : 'Saved')
                                            : (chinese ? '未连接' : 'Not connected')}
                                    </span>
                                </button>;
                            })}
                        </div>}
                </>}
                {error && <div className='CameraBanner error'>{error}</div>}
                {result && <div className='CameraConnectedDetails'>
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
                    <select
                        aria-label={chinese ? '播放通道' : 'Playback channel'}
                        value={channelId}
                        onChange={event => setChannelId(event.target.value)}
                    >
                        {(result.channels.length ? result.channels : [{id: '101'} as CameraChannel]).map(channel =>
                            <option key={channel.id} value={channel.id}>{chinese ? '通道' : 'Channel'} {channel.id}</option>)}
                    </select>
                    <button type='button' onClick={loadSnapshot} disabled={previewing}>
                        {previewing ? (chinese ? '正在抓图…' : 'Loading…') : (chinese ? '抓图预览' : 'Preview snapshot')}
                    </button>
                </div>
                {previewUrl && <img className='CameraPreview' src={previewUrl} alt={chinese ? '相机抓图预览' : 'Camera snapshot'}/>}
                </div>}
            </section>
        </div>
    );

    return <GenericYesNoPopup
        title={chinese ? '连接相机' : 'Connect Camera'}
        renderContent={renderContent}
        acceptLabel={saving
            ? (chinese ? '正在保存…' : 'Saving…')
            : loadingCredentials
                ? (chinese ? '正在读取…' : 'Loading…')
            : connecting
                ? (chinese ? '正在连接…' : 'Connecting…')
                : result ? (chinese ? '确认' : 'Confirm') : (chinese ? '连接' : 'Connect')}
        onAccept={result ? saveCamera : connectCamera}
        disableAcceptButton={formInvalid || loadingCredentials || connecting || saving || (!!result && !resourceName.trim())}
        rejectLabel={chinese ? '关闭' : 'Close'}
        onReject={PopupActions.close}
    />;
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
    imagesData: state.labels.imagesData,
});

export default connect(mapStateToProps)(CameraConnectPopup);
