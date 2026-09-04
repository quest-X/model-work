import React, {useState} from 'react';
import {Language} from '../../../data/LanguageConfig';
import {CameraResourceService} from '../../../services/CameraResourceService';
import {ComputeClusterNode, ComputeLanAsset, ComputeManagedDevice} from '../../../services/ComputeClusterService';
import './DeviceManagementPopup.scss';

type DeviceTab = 'camera' | 'edge';
type DeviceStatusFilter = 'all' | 'normal' | 'fault';

interface IProps {
    language: Language;
    node: ComputeClusterNode;
    cameras: ComputeManagedDevice[];
    edgeDevices: ComputeLanAsset[];
    initialTab: DeviceTab;
    onClose: () => void;
    onAddCamera: () => void;
    onDiscoverEdge: () => void;
    onCamerasChanged: () => void;
}

const cameraNormal = (camera: ComputeManagedDevice): boolean => camera.status === 'online';
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
        onAddCamera,
        onDiscoverEdge,
        onCamerasChanged,
    },
) => {
    const zh = language === Language.CHINESE;
    const [tab, setTab] = useState<DeviceTab>(initialTab);
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<DeviceStatusFilter>('all');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [nameDraft, setNameDraft] = useState('');
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState('');
    const normalizedQuery = query.trim().toLocaleLowerCase();

    const filteredCameras = cameras.filter(camera => {
        const normal = cameraNormal(camera);
        return (statusFilter === 'all' || (statusFilter === 'normal') === normal)
            && valuesMatch(normalizedQuery, [
                camera.name,
                camera.model,
                camera.device_id,
                camera.channels,
                ...camera.capabilities,
            ]);
    });
    const filteredEdgeDevices = edgeDevices.filter(device => {
        return (statusFilter === 'all' || (statusFilter === 'normal') === device.online)
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
    const normalCount = tab === 'camera'
        ? cameras.filter(cameraNormal).length
        : edgeDevices.filter(device => device.online).length;
    const visibleCount = tab === 'camera' ? filteredCameras.length : filteredEdgeDevices.length;
    const resourceCount = tab === 'camera'
        ? cameras.reduce((total, camera) => total + camera.channels, 0)
        : edgeDevices.reduce((total, device) => total + device.ports.length, 0);

    const changeTab = (nextTab: DeviceTab) => {
        setTab(nextTab);
        setQuery('');
        setStatusFilter('all');
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
            await CameraResourceService.update(deviceId, {name: nameDraft.trim()});
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
            await CameraResourceService.delete(deviceId);
            setPendingDeleteId(null);
            onCamerasChanged();
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
        } finally {
            setBusyId(null);
        }
    };

    const statusLabel = (normal: boolean): string => normal
        ? (zh ? '正常' : 'Normal')
        : (zh ? '故障' : 'Fault');
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
            onKeyDown={event => {
                if (event.key === 'Escape') onClose();
            }}
        >
            <header className='DeviceManagementHeader'>
                <div>
                    <span>{zh ? '设备管理' : 'Device management'}</span>
                    <h2>{node.name}</h2>
                    <p>{zh ? '管理节点的关联设备、连接状态与设备信息' : 'Manage associated devices, connectivity, and device details'}</p>
                </div>
                <button
                    type='button'
                    className='DeviceManagementClose'
                    aria-label={zh ? '关闭设备管理' : 'Close device management'}
                    onClick={onClose}
                ><svg viewBox='0 0 12 12' aria-hidden='true'><path d='m3 3 6 6m0-6-6 6'/></svg></button>
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
                        <span className={node.online ? 'normal' : 'fault'}><i/> {statusLabel(node.online)}</span>
                    </div>
                </nav>

                <main className='DeviceManagementMain'>
                    <div className='DeviceManagementTitle'>
                        <div>
                            <span>{zh ? '关联设备' : 'Associated devices'}</span>
                            <h3>{tab === 'camera' ? (zh ? '摄像头设备' : 'Camera devices') : (zh ? '边缘计算设备' : 'Edge devices')}</h3>
                            <p>{tab === 'camera'
                                ? (zh
                                    ? '查看设备状态、通道与能力。远程资源需在所属节点更名或删除。'
                                    : 'Review status, channels, and capabilities. Rename or delete remote resources on their owning node.')
                                : (zh ? '设备通过局域网发现自动同步，可在网络视图继续管理。' : 'Devices sync through LAN discovery and can be managed in the network view.')}</p>
                        </div>
                        <div className='DeviceManagementTitleActions'>
                            <button type='button' onClick={onCamerasChanged}>{zh ? '刷新' : 'Refresh'}</button>
                            <button
                                type='button'
                                className='primary'
                                onClick={tab === 'camera' ? onAddCamera : onDiscoverEdge}
                            >{tab === 'camera' ? (zh ? '＋ 添加摄像头' : '+ Add camera') : (zh ? '＋ 发现设备' : '+ Discover devices')}</button>
                        </div>
                    </div>

                    <div className='DeviceManagementSummary' aria-label={zh ? '设备统计' : 'Device summary'}>
                        <div><span>{zh ? '设备总数' : 'Total'}</span><strong>{devices.length}</strong></div>
                        <div><span>{zh ? '正常' : 'Normal'}</span><strong className='normal'>{normalCount}</strong></div>
                        <div><span>{zh ? '故障' : 'Fault'}</span><strong className='fault'>{devices.length - normalCount}</strong></div>
                        <div><span>{tab === 'camera' ? (zh ? '通道' : 'Channels') : (zh ? '开放服务' : 'Open services')}</span><strong>{resourceCount}</strong></div>
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
                        <span>{zh ? `显示 ${visibleCount} / ${devices.length}` : `Showing ${visibleCount} / ${devices.length}`}</span>
                    </div>

                    {error && <div className='DeviceManagementError' role='status'>{error}</div>}

                    <div className='DeviceManagementList'>
                        {tab === 'camera' && filteredCameras.map(
                            // eslint-disable-next-line complexity
                            camera => {
                            const normal = cameraNormal(camera);
                            return <article className='DeviceManagementRow' key={camera.device_id}>
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
                                <span className={`DeviceManagementStatus ${normal ? 'normal' : 'fault'}`}><i/> {statusLabel(normal)}</span>
                                <div className='DeviceManagementActions'>
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
                                                    disabled
                                                    title={zh ? '远程资源需在所属节点编辑' : 'Edit this remote resource on its owning node'}
                                                    onClick={() => startEdit(camera)}
                                                >{zh ? '编辑' : 'Edit'}</button>
                                                <button
                                                    type='button'
                                                    className='danger'
                                                    disabled
                                                    title={zh ? '远程资源需在所属节点删除' : 'Delete this remote resource on its owning node'}
                                                    onClick={() => {
                                                        setError('');
                                                        setEditingId(null);
                                                        setPendingDeleteId(camera.device_id);
                                                    }}
                                                >{zh ? '删除' : 'Delete'}</button>
                                            </>}
                                </div>
                            </article>;
                            },
                        )}

                        {tab === 'edge' && filteredEdgeDevices.map(device => <article className='DeviceManagementRow' key={device.asset_id}>
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
                            <span className={`DeviceManagementStatus ${device.online ? 'normal' : 'fault'}`}><i/> {statusLabel(device.online)}</span>
                            <div className='DeviceManagementActions'>
                                <button type='button' onClick={onDiscoverEdge}>{zh ? '连接 Jetson' : 'Connect Jetson'}</button>
                            </div>
                        </article>)}

                        {visibleCount === 0 && <div className='DeviceManagementEmpty'>
                            <strong>{devices.length === 0
                                ? (zh ? '尚未关联设备' : 'No devices associated')
                                : (zh ? '没有匹配的设备' : 'No matching devices')}</strong>
                            <span>{devices.length === 0
                                ? (tab === 'camera'
                                    ? (zh ? '添加摄像头后，可在这里统一查看状态和维护名称。' : 'Add a camera to monitor status and maintain names here.')
                                    : (zh ? '扫描当前局域网并通过 SSH 连接 NVIDIA Jetson。' : 'Scan the LAN and connect an NVIDIA Jetson over SSH.'))
                                : (zh ? '请调整搜索关键词或状态筛选。' : 'Change the search query or status filter.')}</span>
                            {devices.length === 0 && <button
                                type='button'
                                onClick={tab === 'camera' ? onAddCamera : onDiscoverEdge}
                            >{tab === 'camera' ? (zh ? '添加摄像头' : 'Add camera') : (zh ? '发现设备' : 'Discover devices')}</button>}
                        </div>}
                    </div>
                </main>
            </div>
        </section>
    </div>;
};
