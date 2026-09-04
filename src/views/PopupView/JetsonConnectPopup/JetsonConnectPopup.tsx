import React, {useEffect, useRef, useState} from 'react';
import {connect} from 'react-redux';
import {Language} from '../../../data/LanguageConfig';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {
    ComputeClusterService,
    ComputeJetsonConnectResult,
    ComputeLanAsset,
    ComputeLanDiscoveryResult,
} from '../../../services/ComputeClusterService';
import {AppState} from '../../../store';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import '../CameraConnectPopup/CameraConnectPopup.scss';

interface IProps {
    language: Language;
    nodeId?: string | null;
    nodeName?: string | null;
    remote?: boolean;
}

export const JetsonConnectPopup: React.FC<IProps> = ({language, nodeId = null, nodeName = null, remote = false}) => {
    const zh = language === Language.CHINESE;
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [scanning, setScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState(0);
    const [scanCount, setScanCount] = useState({completed: 0, total: 0});
    const [connecting, setConnecting] = useState(false);
    const [discovery, setDiscovery] = useState<ComputeLanDiscoveryResult | null>(null);
    const [candidates, setCandidates] = useState<ComputeLanAsset[]>([]);
    const [selected, setSelected] = useState<ComputeLanAsset | null>(null);
    const [fingerprint, setFingerprint] = useState('');
    const [result, setResult] = useState<ComputeJetsonConnectResult | null>(null);
    const [error, setError] = useState('');
    const scanController = useRef<AbortController | null>(null);

    useEffect(() => () => {
        scanController.current?.abort();
        scanController.current = null;
    }, []);

    const stopScan = () => {
        scanController.current?.abort();
        scanController.current = null;
        setScanning(false);
    };

    const scan = async () => {
        if (!nodeId || scanning) return;
        const controller = new AbortController();
        scanController.current = controller;
        setScanning(true);
        setScanProgress(0);
        setScanCount({completed: 0, total: 0});
        setError('');
        setFingerprint('');
        setResult(null);
        try {
            const nextDiscovery = await ComputeClusterService.scanLan(
                nodeId,
                controller.signal,
                (percent, completed = 0, total = 0) => {
                    setScanProgress(percent);
                    setScanCount({completed, total});
                },
            );
            const inventory = await ComputeClusterService.lanAssets();
            const sshCandidates = inventory.assets.filter(asset =>
                asset.node_id === nodeId
                && asset.online
                && asset.ports.some(service => service.port === 22),
            );
            setDiscovery(nextDiscovery);
            setCandidates(sshCandidates);
            setSelected(current => sshCandidates.find(asset => asset.asset_id === current?.asset_id)
                || sshCandidates[0]
                || null);
        } catch (reason) {
            if (!(reason instanceof Error && reason.name === 'AbortError')) {
                const message = reason instanceof Error ? reason.message : String(reason);
                setError(zh && message === 'Selected node has no scannable LAN segment'
                    ? '该节点没有可扫描的局域网网段（可能故障或没有私有网卡）'
                    : message);
            }
        } finally {
            if (scanController.current === controller) {
                scanController.current = null;
                setScanning(false);
            }
        }
    };

    const connectJetson = async () => {
        if (!selected || !username.trim() || !password || connecting) return;
        setConnecting(true);
        setError('');
        try {
            const response = await ComputeClusterService.connectJetson(selected.asset_id, {
                username: username.trim(),
                password,
                ...(fingerprint ? {expected_fingerprint: fingerprint} : {}),
            });
            if (response.status === 'confirmation_required') {
                setFingerprint(response.fingerprint);
            } else {
                setResult(response);
                setPassword('');
                window.dispatchEvent(new CustomEvent('opensight:jetson-updated'));
            }
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setConnecting(false);
        }
    };

    const choose = (asset: ComputeLanAsset) => {
        setSelected(asset);
        setFingerprint('');
        setResult(null);
        setError('');
    };

    // eslint-disable-next-line complexity
    const renderContent = () => <div className='CameraConnectPopupContent JetsonConnectPopupContent'>
        <div className='CameraIntro'>{zh
            ? '扫描所选节点所在局域网并列出 SSH 候选设备；只有验证为 NVIDIA Jetson 后才会添加，密码不会保存。'
            : 'Scan the selected node LAN for SSH candidates. A device is added only after it is verified as NVIDIA Jetson; passwords are not stored.'}</div>

        {result?.status === 'connected' && <div className='CameraBanner success'>
            {zh ? 'NVIDIA Jetson 已通过 SSH 连接并添加' : 'NVIDIA Jetson connected over SSH and added'}
        </div>}

        <div className='CameraForm JetsonConnectForm'>
            <label className='wide'>
                <span>{zh ? '设备地址' : 'Device address'}</span>
                <input value={selected?.address || ''} disabled placeholder={zh ? '请先扫描并选择设备' : 'Scan and select a device first'}/>
            </label>
            <label className='wide'>
                <span>{zh ? '端口' : 'Port'}</span>
                <input value='22' disabled/>
            </label>
            <label className='wide'>
                <span>{zh ? '用户名' : 'Username'}</span>
                <input autoFocus value={username} autoComplete='username' placeholder='nvidia' onChange={event => setUsername(event.target.value)}/>
            </label>
            <label className='wide'>
                <span>{zh ? '密码' : 'Password'}</span>
                <input type='password' value={password} autoComplete='current-password' onChange={event => setPassword(event.target.value)}/>
            </label>
        </div>

        <section className='CameraDiscoveryPanel' aria-label={zh ? '局域网 Jetson 发现' : 'LAN Jetson discovery'}>
            <div className='CameraDiscoveryScope remote'>{zh
                ? `扫描范围：${nodeName ? `${nodeName} 节点` : '所选节点'}所在的${remote ? '远程' : '本地'}局域网`
                : `Scan scope: ${nodeName ? `${nodeName} node` : 'selected node'} ${remote ? 'remote' : 'local'} LAN`}</div>
            <div className='CameraDiscoveryHeader'>
                <div>
                    <strong>{zh
                        ? `NVIDIA Jetson 发现${scanning ? ` (${scanCount.completed}/${scanCount.total})` : ''}`
                        : `NVIDIA Jetson discovery${scanning ? ` (${scanCount.completed}/${scanCount.total})` : ''}`}</strong>
                    <span>{zh
                        ? '先显示开放 SSH 端口的候选设备，连接后再核验是否为 NVIDIA Jetson。'
                        : 'SSH candidates are shown first and identified as NVIDIA Jetson only after connection.'}</span>
                </div>
                <button
                    type='button'
                    className={scanning ? 'danger' : undefined}
                    onClick={scanning ? stopScan : scan}
                    disabled={!nodeId}
                >
                    {scanning ? (zh ? '停止' : 'Stop') : (zh ? '开始扫描' : 'Start scan')}
                </button>
            </div>
            {scanning && <div className='JetsonScanProgress'>
                <progress aria-label={zh ? '扫描进度' : 'Scan progress'} max={100} value={scanProgress}/>
            </div>}
            {discovery && <div className='CameraDiscoverySummary'>{zh
                ? `已扫描 ${discovery.cidr} 的 ${discovery.addresses_scanned} 个地址，发现 ${candidates.length} 台 SSH 候选设备`
                : `Scanned ${discovery.addresses_scanned} addresses on ${discovery.cidr}; found ${candidates.length} SSH candidates`}</div>}
            {discovery && candidates.length === 0 && <div className='CameraDiscoveryEmpty'>
                {zh ? '未发现开放 SSH 端口的候选设备。' : 'No candidates with an open SSH port were found.'}
            </div>}
            {candidates.length > 0 && <div className='CameraDiscoveryResults'>
                {candidates.map(asset => <button
                    type='button'
                    key={asset.asset_id}
                    className={`CameraDiscoveryRow${selected?.asset_id === asset.asset_id ? ' selected' : ''}`}
                    aria-pressed={selected?.asset_id === asset.asset_id}
                    onClick={() => choose(asset)}
                >
                    <span className={`CameraDiscoveryDot ${asset.device_kind === 'edge_compute' ? 'confirmed' : ''}`}/>
                    <span className='CameraDiscoveryIdentity'>
                        <strong>{asset.display_name || asset.hostname || asset.address}</strong>
                        <span>{asset.device_model || (zh ? '待 SSH 识别型号' : 'Awaiting SSH identification')}</span>
                    </span>
                    <code>{asset.address}</code>
                    <span className='CameraDiscoveryPorts'>SSH 22</span>
                    <span className={`CameraDiscoveryStatus ${asset.device_kind === 'edge_compute' ? 'saved' : 'disconnected'}`}>
                        {asset.device_kind === 'edge_compute' ? (zh ? '已验证' : 'Verified') : (zh ? '未连接' : 'Not connected')}
                    </span>
                </button>)}
            </div>}
            {fingerprint && !result && <div className='CameraDiscoverySummary'>
                <strong>{zh ? 'SSH 主机指纹' : 'SSH host fingerprint'}</strong><br/>
                <code>{fingerprint}</code><br/>
                {zh ? '请在 Jetson 设备上核对；再次点击“信任并连接”后才会提交密码并识别型号。' : 'Verify this on the Jetson, then click “Trust and connect” to authenticate and identify the model.'}
            </div>}
            {result?.status === 'connected' && <div className='CameraDeviceGrid'>
                <div><span>{zh ? '型号' : 'Model'}</span><strong>{result.device_model || '—'}</strong></div>
                <div><span>{zh ? '架构' : 'Architecture'}</span><strong>{result.architecture || '—'}</strong></div>
                <div><span>{zh ? '地址' : 'Address'}</span><strong>{result.asset?.address || selected?.address}</strong></div>
                <div><span>{zh ? '连接方式' : 'Connection'}</span><strong>SSH</strong></div>
            </div>}
            {error && <div className='CameraDiscoveryError'>{error}</div>}
        </section>
    </div>;

    return <GenericYesNoPopup
        title={zh ? '连接边缘计算设备' : 'Connect Edge Computing Device'}
        renderContent={renderContent}
        acceptLabel={result
            ? (zh ? '完成' : 'Done')
            : connecting
                ? (zh ? '正在连接…' : 'Connecting…')
                : fingerprint
                    ? (zh ? '信任并连接' : 'Trust and connect')
                    : (zh ? '检查并连接' : 'Check and connect')}
        onAccept={result ? PopupActions.close : connectJetson}
        disableAcceptButton={!result && (!selected || !username.trim() || !password || connecting)}
        rejectLabel={zh ? '关闭' : 'Close'}
        onReject={PopupActions.close}
    />;
};

const mapStateToProps = (state: AppState) => ({language: state.general.language});

export default connect(mapStateToProps)(JetsonConnectPopup);
