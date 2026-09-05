import React, {useEffect, useMemo, useState} from 'react';
import {connect} from 'react-redux';
import {Language} from '../../../data/LanguageConfig';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {AppState} from '../../../store';
import {ImageData} from '../../../store/labels/types';
import {
    CameraChannel,
    CameraConnectResult,
    CameraDiscoveryDevice,
    CameraDiscoveryResponse,
    CameraResource,
    CameraResourceService,
} from '../../../services/CameraResourceService';
import {ComputeClusterService} from '../../../services/ComputeClusterService';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import './CameraConnectPopup.scss';

interface IProps {
    language: Language;
    imagesData: ImageData[];
    // 目标节点 id：由打开入口决定。非空 = 扫描该远程 model-work-node 所在的局域网；
    // 为空/未传 = 保留旧行为，扫描 extension-engine 后端自身所在的局域网。
    nodeId?: string | null;
    nodeName?: string | null;
    remote?: boolean;
}

const discoveryStorageKey = (nodeId: string | null): string =>
    `opensight.camera-discovery.${nodeId || 'local'}`;

type CameraScan = {controller: AbortController; promise: Promise<CameraDiscoveryResponse>};

// ponytail: survives popup remounts only; use a durable backend task if page-reload recovery becomes necessary.
const activeCameraScans = new Map<string, CameraScan>();

const startCameraScan = (key: string, nodeId: string | null): CameraScan => {
    const current = activeCameraScans.get(key);
    if (current) return current;
    const controller = new AbortController();
    const scan = {
        controller,
        promise: nodeId
            ? ComputeClusterService.discoverCameras(nodeId, 0.35, controller.signal)
            : CameraResourceService.discover(0.35, controller.signal),
    };
    activeCameraScans.set(key, scan);
    void scan.promise.then(
        () => {
            if (activeCameraScans.get(key) === scan) activeCameraScans.delete(key);
        },
        () => {
            if (activeCameraScans.get(key) === scan) activeCameraScans.delete(key);
        },
    );
    return scan;
};

const loadDiscovery = (key: string): CameraDiscoveryResponse | null => {
    try {
        const stored = JSON.parse(window.localStorage.getItem(key) || 'null') as CameraDiscoveryResponse | null;
        return stored
            && Array.isArray(stored.networks)
            && typeof stored.scanned_hosts === 'number'
            && typeof stored.duration_ms === 'number'
            && Array.isArray(stored.devices)
            ? stored
            : null;
    } catch {
        return null;
    }
};

// eslint-disable-next-line complexity
export const CameraConnectPopup: React.FC<IProps> = (
    {language, imagesData, nodeId = null, nodeName = null, remote = false},
) => {
    const chinese = language === Language.CHINESE;
    const storageKey = discoveryStorageKey(nodeId);
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
    const [scanning, setScanning] = useState(() => activeCameraScans.has(storageKey));
    const [scanError, setScanError] = useState('');
    const [discovery, setDiscovery] = useState<CameraDiscoveryResponse | null>(() => loadDiscovery(storageKey));
    const [savedResources, setSavedResources] = useState<CameraResource[]>([]);
    const [savedResource, setSavedResource] = useState<CameraResource | null>(null);
    const [loadingCredentials, setLoadingCredentials] = useState(false);

    const showDiscovery = (nextDiscovery: CameraDiscoveryResponse) => {
        const visibleDiscovery = {
            ...nextDiscovery,
            devices: nextDiscovery.devices.filter(({manufacturer}) =>
                /^(?:(?:hikvision|dahua)(?:\b|-)|海康|大华)/i.test(manufacturer),
            ),
        };
        setDiscovery(visibleDiscovery);
        window.localStorage.setItem(storageKey, JSON.stringify(visibleDiscovery));
    };

    useEffect(() => {
        const activeScan = activeCameraScans.get(storageKey);
        if (!activeScan) return undefined;
        let mounted = true;
        setScanning(true);
        setScanError('');
        void activeScan.promise.then(
            nextDiscovery => {
                if (mounted) showDiscovery(nextDiscovery);
            },
            scanFailure => {
                if (mounted && !activeScan.controller.signal.aborted) {
                    setScanError(scanFailure instanceof Error ? scanFailure.message : String(scanFailure));
                }
            },
        ).finally(() => {
            if (mounted) setScanning(false);
        });
        return () => {
            mounted = false;
        };
    }, [storageKey]);

    useEffect(() => () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    }, [previewUrl]);

    useEffect(() => {
        if (nodeId) {
            setSavedResources([]);
            setSavedResource(null);
            return undefined;
        }
        let active = true;
        CameraResourceService.list()
            .then(resources => {
                if (active) setSavedResources(resources);
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, [nodeId]);

    const orderedSavedResources = useMemo(() => [...savedResources]
        .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at)), [savedResources]);

    const savedByHost = useMemo(() => {
        const remembered = new Map<string, CameraResource>();
        orderedSavedResources.forEach(resource => {
                if (!remembered.has(resource.host)) remembered.set(resource.host, resource);
            });
        return remembered;
    }, [orderedSavedResources]);

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

    const scanCameras = async () => {
        if (scanning) return;
        const scan = startCameraScan(storageKey, nodeId);
        setScanning(true);
        setScanError('');
        try {
            showDiscovery(await scan.promise);
        } catch (scanFailure) {
            if (!scan.controller.signal.aborted) {
                setScanError(scanFailure instanceof Error ? scanFailure.message : String(scanFailure));
            }
        } finally {
            setScanning(false);
        }
    };

    const stopCameraScan = () => {
        const scan = activeCameraScans.get(storageKey);
        scan?.controller.abort();
        if (scan) activeCameraScans.delete(storageKey);
        setScanning(false);
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
            const connected = nodeId
                ? await ComputeClusterService.connectCamera(nodeId, requestBody)
                : await CameraResourceService.connect(requestBody);
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
            const blob = nodeId
                ? await ComputeClusterService.snapshotCamera(
                    nodeId, {...requestBody, channel_id: channelId},
                )
                : await CameraResourceService.snapshot({...requestBody, channel_id: channelId});
            const nextUrl = URL.createObjectURL(blob);
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
            const resource = nodeId
                ? await ComputeClusterService.createCameraResource(nodeId, payload)
                : savedResource
                    ? await CameraResourceService.update(savedResource.id, payload)
                    : await CameraResourceService.create(payload);
            setPassword('');
            window.dispatchEvent(new CustomEvent('opensight:camera-resource-updated'));
            if (nodeId) {
                await CameraResourceService.openCluster(nodeId, nodeName || nodeId, {
                    device_id: resource.id,
                    kind: 'camera',
                    provider: 'camera-connect',
                    name: resource.name,
                    model: resource.device.model,
                    status: 'online',
                    channels: resource.channels.length,
                    capabilities: ['camera.registry.v1', 'camera.stream.v1'],
                }, imagesData);
            } else {
                await CameraResourceService.open(resource, imagesData);
            }
            PopupActions.close();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : String(saveError));
        } finally {
            setSaving(false);
        }
    };

    // eslint-disable-next-line complexity
    const renderContent = () => (
        <div className='CameraConnectPopupContent'>
            <div className='CameraIntro'>
                {chinese
                    ? '使用 ISAPI Digest 验证海康网络摄像机。首次确认后会自动记住连接方式；下次输入或扫描到该相机时直接填入账号密码，可自行修改。'
                    : 'Connect with Hikvision ISAPI Digest. Confirmed settings are remembered and filled into the editable form when the camera is entered or discovered again.'}
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
                <div className='CameraCredentials'>
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
                    <label>
                        <span>{chinese ? '密码' : 'Password'}</span>
                        <input
                            type='password'
                            value={password}
                            autoComplete='current-password'
                            placeholder='123456'
                            onChange={event => setPassword(event.target.value)}
                        />
                    </label>
                </div>
                {scheme === 'https' && <label className='CameraCheckbox wide'>
                    <input type='checkbox' checked={verifyTls} onChange={event => setVerifyTls(event.target.checked)}/>
                    <span>{chinese ? '校验相机 TLS 证书' : 'Verify camera TLS certificate'}</span>
                </label>}
            </div>

            <section className='CameraDiscoveryPanel' aria-label={chinese ? '局域网相机发现' : 'LAN camera discovery'}>
                <div className='CameraDiscoveryScope remote'>{nodeId
                    ? (chinese
                        ? `扫描范围：${nodeName ? `${nodeName} 节点` : '所选节点'}所在的${remote ? '远程' : '本地'}局域网`
                        : `Scan scope: ${nodeName ? `${nodeName} node` : 'selected node'} ${remote ? 'remote' : 'local'} LAN`)
                    : (chinese ? '扫描范围：当前服务器所在的本地局域网' : 'Scan scope: the current server local LAN')}</div>
                <div className='CameraDiscoveryHeader'>
                    <div>
                        <strong>{chinese ? '海康、大华相机发现' : 'Hikvision and Dahua camera discovery'}</strong>
                        <span>{scanning
                            ? (chinese ? '后台扫描中；关闭窗口不会停止。' : 'Scanning in the background; closing this window will not stop it.')
                            : discovery
                                ? (chinese ? '扫描已完成；可选择结果或重新扫描。' : 'Scan complete; select a result or scan again.')
                                : (chinese
                                    ? '扫描结果只显示海康、大华相机，其他设备不会显示；扫描不会提交账号密码。'
                                    : 'Scan results show only Hikvision and Dahua cameras; other devices are hidden and no credentials are sent.')}</span>
                    </div>
                    <button
                        type='button'
                        className={scanning ? 'danger' : undefined}
                        onClick={scanning ? stopCameraScan : scanCameras}
                    >
                        {scanning
                            ? (chinese ? '停止' : 'Stop')
                            : discovery
                                ? (chinese ? '重新扫描' : 'Rescan')
                                : (chinese ? '开始扫描' : 'Start scan')}
                    </button>
                </div>
                {scanning && nodeId && <div className='JetsonScanProgress'>
                    <progress aria-label={chinese ? '扫描进度' : 'Scan progress'}/>
                </div>}
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
                            {discovery.devices.map(
                                // eslint-disable-next-line complexity
                                camera => {
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
                                },
                            )}
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
                : result ? (chinese ? '保存' : 'Save') : (chinese ? '连接' : 'Connect')}
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
