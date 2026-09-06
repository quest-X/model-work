import React, {useState} from 'react';
import {Language} from '../../../data/LanguageConfig';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeLanAsset,
    ComputeManagedDevice,
    computeNodeState,
    communicationStateLabel,
} from '../../../services/ComputeClusterService';
import './DeviceManagementPopup.scss';
import {useEscapeToClose} from '../../../hooks/useEscapeToClose';

type DeviceTab = 'camera' | 'edge';
type DeviceTone = 'normal' | 'fault';
type DeviceStatusFilter = 'all' | DeviceTone;

interface IProps {
    language: Language;
    node: ComputeClusterNode;
    cameras: ComputeManagedDevice[];
    edgeDevices: ComputeLanAsset[];
    initialTab: DeviceTab;
    onClose: () => void;
    onAddCamera: () => void;
    onDiscoverEdge: () => void;
    onOpenCamera: (deviceId: string) => void;
    onOpenEdgeDevice: (assetId: string) => void;
    onCamerasChanged: () => void;
}

const cameraTone = (camera: ComputeManagedDevice): DeviceTone =>
    camera.status === 'registered' || camera.status === 'online'
        ? 'normal'
        : 'fault';
const edgeTone = (device: ComputeLanAsset): DeviceTone => device.online ? 'normal' : 'fault';
const valuesMatch = (query: string, values: (string | number | null | undefined)[]): boolean =>
    !query || values.some(value => String(value || '').toLocaleLowerCase().includes(query));

// eslint-disable-next-line complexity
export const DeviceManagementPopup: React.FC<IProps> = (
    {
        language,
        node,
        cameras,
        edgeDevices,
        initialTab,
        onClose,
        onDiscoverEdge,
        onOpenCamera,
        onOpenEdgeDevice,
        onCamerasChanged,
    },
) => {
    const zh = language === Language.CHINESE;
    useEscapeToClose(onClose, true, 20);
    const nodeTone: DeviceTone = computeNodeState(node);
    const [tab, setTab] = useState<DeviceTab>(initialTab);
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<DeviceStatusFilter>('all');
    const [managing, setManaging] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [nameDraft, setNameDraft] = useState('');
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState('');
    const normalizedQuery = query.trim().toLocaleLowerCase();

    const filteredCameras = cameras.filter(camera => {
        return (statusFilter === 'all' || statusFilter === cameraTone(camera))
            && valuesMatch(normalizedQuery, [
                camera.name,
                camera.model,
                camera.device_id,
                camera.channels,
                ...camera.capabilities,
            ]);
    });
    const filteredEdgeDevices = edgeDevices.filter(device => {
        return (statusFilter === 'all' || statusFilter === edgeTone(device))
            && valuesMatch(normalizedQuery, [
                device.display_name,
                device.hostname,
                device.device_model,
                device.address,
                device.mac,
                ...device.ports.flatMap(port => [port.port, port.service]),
            ]);
    });
    const devices = tab === 'camera' ? cameras : edgeDevices;
    const tones = tab === 'camera' ? cameras.map(cameraTone) : edgeDevices.map(edgeTone);
    const normalCount = tones.filter(tone => tone === 'normal').length;
    const faultCount = tones.filter(tone => tone === 'fault').length;
    const visibleCount = tab === 'camera' ? filteredCameras.length : filteredEdgeDevices.length;

    const changeTab = (nextTab: DeviceTab) => {
        setTab(nextTab);
        setQuery('');
        setStatusFilter('all');
        setManaging(false);
        setEditingId(null);
        setPendingDeleteId(null);
        setError('');
    };

    const startEdit = (camera: ComputeManagedDevice) => {
        setError('');
        setPendingDeleteId(null);
        setEditingId(camera.device_id);
        setNameDraft(camera.name);
    };

    const cancelEdit = () => {
        setEditingId(null);
        setNameDraft('');
    };

    const saveEdit = async (deviceId: string) => {
        if (!nameDraft.trim()) return;
        setBusyId(deviceId);
        setError('');
        try {
            await ComputeClusterService.updateCameraResource(node.node_id, deviceId, nameDraft.trim());
            cancelEdit();
            onCamerasChanged();
        } catch (updateError) {
            setError(updateError instanceof Error ? updateError.message : String(updateError));
        } finally {
            setBusyId(null);
        }
    };

    const confirmDelete = async (deviceId: string) => {
        setBusyId(deviceId);
        setError('');
        try {
            await ComputeClusterService.deleteCameraResource(node.node_id, deviceId);
            setPendingDeleteId(null);
            onCamerasChanged();
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
        } finally {
            setBusyId(null);
        }
    };

    const statusLabel = (tone: DeviceTone): string => communicationStateLabel(tone, zh);
    const lastSeen = (timestamp: number): string => timestamp
        ? new Date(timestamp * 1000).toLocaleString(zh ? 'zh-CN' : 'en-US')
        : '—';

    return <div
        className='DeviceManagementBackdrop'
        onMouseDown={event => {
            if (event.target === event.currentTarget) onClose();
        }}
    >
        <section
            className='DeviceManagementDialog'
            role='dialog'
            aria-modal='true'
            aria-label={zh ? '设备管理' : 'Device management'}
        >
            <header className='DeviceManagementHeader'>
                <div>
                    <span>{zh ? '设备管理' : 'Device management'}</span>
                    <h2>{node.name}</h2>
                    <p>{zh ? '管理节点的关联设备、连接状态与设备信息' : 'Manage associated devices, connectivity, and device details'}</p>
                </div>
            </header>

            <div className='DeviceManagementWorkspace'>
                <nav className='DeviceManagementNav' role='tablist' aria-label={zh ? '设备类别' : 'Device categories'}>
                    <button
                        type='button'
                        role='tab'
                        aria-selected={tab === 'camera'}
                        onClick={() => changeTab('camera')}
                    >
                        <span>{zh ? '摄像头' : 'Cameras'}</span>
                        <strong>{cameras.length}</strong>
                        <small>{zh ? '视频采集设备' : 'Video capture devices'}</small>
                    </button>
                    <button
                        type='button'
                        role='tab'
                        aria-selected={tab === 'edge'}
                        onClick={() => changeTab('edge')}
                    >
                        <span>{zh ? '边缘计算设备' : 'Edge devices'}</span>
                        <strong>{edgeDevices.length}</strong>
                        <small>{zh ? '局域网计算资源' : 'LAN compute resources'}</small>
                    </button>
                    <div className='DeviceManagementNodeState'>
                        <small>{zh ? '所属节点' : 'Assigned node'}</small>
                        <strong>{node.name}</strong>
                        <span className={nodeTone}><i/> {statusLabel(nodeTone)}</span>
                    </div>
                </nav>

                <main className='DeviceManagementMain'>
                    <div className='DeviceManagementTitle'>
                        <div>
                            <span>{zh ? '关联设备' : 'Associated devices'}</span>
                            <h3>{tab === 'camera' ? (zh ? '摄像头设备' : 'Camera devices') : (zh ? '边缘计算设备' : 'Edge devices')}</h3>
                            <p>{tab === 'camera'
                                ? (zh
                                    ? '查看设备状态、通道与能力，并通过所属节点更名或删除。'
                                    : 'Review status, channels, and capabilities, then rename or delete through the owning node.')
                                : (zh ? '设备通过局域网发现自动同步，可在网络视图继续管理。' : 'Devices sync through LAN discovery and can be managed in the network view.')}</p>
                        </div>
                        <div className='DeviceManagementTitleActions'>
                            <button
                                type='button'
                                className={managing ? 'primary' : ''}
                                aria-pressed={managing}
                                onClick={() => {
                                    setManaging(current => !current);
                                    setEditingId(null);
                                    setPendingDeleteId(null);
                                }}
                            >{managing ? (zh ? '完成' : 'Done') : (zh ? '管理' : 'Manage')}</button>
                        </div>
                    </div>

                    <div className='DeviceManagementSummary' aria-label={zh ? '设备统计' : 'Device summary'}>
                        <div><span>{zh ? '总数' : 'Total'}</span><strong>{devices.length}</strong></div>
                        <div><span>{zh ? '正常' : 'Normal'}</span><strong className='normal'>{normalCount}</strong></div>
                        <div><span>{zh ? '故障' : 'Fault'}</span><strong className='fault'>{faultCount}</strong></div>
                    </div>

                    <div className='DeviceManagementTools'>
                        <input
                            autoFocus
                            type='search'
                            aria-label={zh ? '搜索设备' : 'Search devices'}
                            placeholder={zh ? '搜索名称、型号、地址或编号' : 'Search name, model, address, or ID'}
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                        />
                        <select
                            aria-label={zh ? '筛选设备状态' : 'Filter device status'}
                            value={statusFilter}
                            onChange={event => setStatusFilter(event.target.value as DeviceStatusFilter)}
                        >
                            <option value='all'>{zh ? '所有状态' : 'All statuses'}</option>
                            <option value='normal'>{zh ? '仅正常' : 'Normal only'}</option>
                            <option value='fault'>{zh ? '仅故障' : 'Fault only'}</option>
                        </select>
                    </div>

                    {error && <div className='DeviceManagementError' role='status'>{error}</div>}

                    <div className='DeviceManagementList'>
                        {tab === 'camera' && filteredCameras.map(
                            // eslint-disable-next-line complexity
                            camera => {
                            const tone = cameraTone(camera);
                            return <article
                                className={`DeviceManagementRow${managing ? '' : ' interactive'}`}
                                key={camera.device_id}
                                role={managing ? undefined : 'button'}
                                tabIndex={managing ? undefined : 0}
                                title={managing ? undefined : (zh ? '双击打开实时画面' : 'Double-click to open live view')}
                                onDoubleClick={() => {
                                    if (!managing) onOpenCamera(camera.device_id);
                                }}
                                onKeyDown={event => {
                                    if (!managing && event.key === 'Enter') onOpenCamera(camera.device_id);
                                }}
                            >
                                <div className='DeviceManagementIcon' aria-hidden='true'>CAM</div>
                                <div className='DeviceManagementIdentity'>
                                    {editingId === camera.device_id
                                        ? <input
                                            autoFocus
                                            aria-label={zh ? '摄像头名称' : 'Camera name'}
                                            value={nameDraft}
                                            maxLength={128}
                                            onChange={event => setNameDraft(event.target.value)}
                                            onKeyDown={event => {
                                                if (event.key === 'Enter') void saveEdit(camera.device_id);
                                                if (event.key === 'Escape') cancelEdit();
                                            }}
                                        />
                                        : <strong>{camera.name}</strong>}
                                    <small>{camera.model || (zh ? '型号未上报' : 'Model not reported')}</small>
                                    <code>{camera.device_id}</code>
                                </div>
                                <div className='DeviceManagementFacts'>
                                    <span><small>{zh ? '通道' : 'Channels'}</small><strong>{camera.channels}</strong></span>
                                    <span><small>{zh ? '能力' : 'Capabilities'}</small><strong>{camera.capabilities.length}</strong></span>
                                </div>
                                <span className={`DeviceManagementStatus ${tone}`}><i/> {statusLabel(tone)}</span>
                                {managing && <div className='DeviceManagementActions'>
                                    {editingId === camera.device_id
                                        ? <>
                                            <button
                                                type='button'
                                                className='primary'
                                                disabled={busyId === camera.device_id || !nameDraft.trim()}
                                                onClick={() => void saveEdit(camera.device_id)}
                                            >{zh ? '保存' : 'Save'}</button>
                                            <button type='button' onClick={cancelEdit}>{zh ? '取消' : 'Cancel'}</button>
                                        </>
                                        : pendingDeleteId === camera.device_id
                                            ? <>
                                                <button
                                                    type='button'
                                                    className='danger'
                                                    disabled={busyId === camera.device_id}
                                                    onClick={() => void confirmDelete(camera.device_id)}
                                                >{zh ? '确认删除' : 'Confirm delete'}</button>
                                                <button type='button' onClick={() => setPendingDeleteId(null)}>{zh ? '取消' : 'Cancel'}</button>
                                            </>
                                            : <>
                                                <button
                                                    type='button'
                                                    onClick={() => startEdit(camera)}
                                                >{zh ? '编辑' : 'Edit'}</button>
                                                <button
                                                    type='button'
                                                    className='danger'
                                                    onClick={() => {
                                                        setError('');
                                                        setEditingId(null);
                                                        setPendingDeleteId(camera.device_id);
                                                    }}
                                                >{zh ? '删除' : 'Delete'}</button>
                                            </>}
                                </div>}
                            </article>;
                            },
                        )}

                        {tab === 'edge' && filteredEdgeDevices.map(device => <article
                            className={`DeviceManagementRow${managing ? '' : ' interactive'}`}
                            key={device.asset_id}
                            role={managing ? undefined : 'button'}
                            tabIndex={managing ? undefined : 0}
                            title={managing ? undefined : (zh ? '双击打开设备终端' : 'Double-click to open terminal')}
                            onDoubleClick={() => {
                                if (!managing) onOpenEdgeDevice(device.asset_id);
                            }}
                            onKeyDown={event => {
                                if (!managing && event.key === 'Enter') onOpenEdgeDevice(device.asset_id);
                            }}
                        >
                            <div className='DeviceManagementIcon edge' aria-hidden='true'>EDGE</div>
                            <div className='DeviceManagementIdentity'>
                                <strong>{device.display_name || device.hostname || device.address}</strong>
                                <small>{device.device_model || (zh ? '型号未上报' : 'Model not reported')}</small>
                                <code>{device.address}{device.mac ? ` · ${device.mac}` : ''}</code>
                            </div>
                            <div className='DeviceManagementFacts'>
                                <span><small>{zh ? '服务' : 'Services'}</small><strong>{device.ports.length}</strong></span>
                                <span className='wide'><small>{zh ? '最后发现' : 'Last seen'}</small><strong>{lastSeen(device.last_seen_at)}</strong></span>
                            </div>
                            <span className={`DeviceManagementStatus ${edgeTone(device)}`}><i/> {statusLabel(edgeTone(device))}</span>
                            {managing && <div className='DeviceManagementActions'>
                                <button type='button' onClick={onDiscoverEdge}>{zh ? '连接设备' : 'Connect device'}</button>
                            </div>}
                        </article>)}

                        {visibleCount === 0 && <div className='DeviceManagementEmpty'>
                            <strong>{devices.length === 0
                                ? (zh ? '尚未关联设备' : 'No devices associated')
                                : (zh ? '没有匹配的设备' : 'No matching devices')}</strong>
                            <span>{devices.length === 0
                                ? (tab === 'camera'
                                    ? (zh ? '添加摄像头后，可在这里统一查看状态和维护名称。' : 'Add a camera to monitor status and maintain names here.')
                                    : (zh ? '扫描当前局域网并通过 SSH 连接边缘计算设备。' : 'Scan the LAN and connect an edge device over SSH.'))
                                : (zh ? '请调整搜索关键词或状态筛选。' : 'Change the search query or status filter.')}</span>
                        </div>}
                    </div>
                </main>
            </div>
        </section>
    </div>;
};
