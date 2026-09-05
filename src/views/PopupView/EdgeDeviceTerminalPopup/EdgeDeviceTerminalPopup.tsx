import React, {useState} from 'react';
import {Language} from '../../../data/LanguageConfig';
import {ComputeLanAsset} from '../../../services/ComputeClusterService';
import {ComputeTerminalPanel} from '../ComputeClusterPopup/ComputeTerminalPanel';
import '../ComputeClusterPopup/ComputeClusterPopup.scss';
import '../DeviceManagementPopup/DeviceManagementPopup.scss';

interface IProps {
    language: Language;
    devices: ComputeLanAsset[];
    initialDeviceId: string;
    onClose: () => void;
}

const deviceName = (device: ComputeLanAsset): string =>
    device.display_name || device.hostname || device.address;

export const EdgeDeviceTerminalPopup: React.FC<IProps> = ({
    language, devices, initialDeviceId, onClose,
}) => {
    const zh = language === Language.CHINESE;
    const [selectedId, setSelectedId] = useState(initialDeviceId);
    const [terminalActive, setTerminalActive] = useState(false);
    const selected = devices.find(device => device.asset_id === selectedId) || devices[0];

    if (!selected) return null;
    const username = selected.ssh_username || 'nvidia';
    const label = deviceName(selected);

    return <div
        className='DeviceManagementBackdrop'
        onMouseDown={event => {
            if (event.target === event.currentTarget) onClose();
        }}
    >
        <section
            className='DeviceManagementDialog EdgeDeviceTerminalDialog'
            role='dialog'
            aria-modal='true'
            aria-label={zh ? '边缘设备终端' : 'Edge device terminal'}
            onKeyDown={event => {
                if (event.key === 'Escape') onClose();
            }}
        >
            <header className='DeviceManagementHeader'>
                <div>
                    <span>{zh ? 'SSH 终端' : 'SSH terminal'}</span>
                    <h2>{zh ? '边缘计算设备' : 'Edge computing devices'}</h2>
                    <p>{zh ? '左侧选择设备，右侧连接并使用终端' : 'Choose a device on the left and use its terminal on the right'}</p>
                </div>
                <button
                    type='button'
                    className='DeviceManagementClose'
                    aria-label={zh ? '关闭边缘设备终端' : 'Close edge device terminal'}
                    onClick={onClose}
                ><svg viewBox='0 0 12 12' aria-hidden='true'><path d='m3 3 6 6m0-6-6 6'/></svg></button>
            </header>

            <div className='DeviceManagementWorkspace'>
                <nav
                    className='DeviceManagementNav'
                    role='tablist'
                    aria-label={zh ? '边缘计算设备' : 'Edge computing devices'}
                >
                    {devices.map(device => <button
                        type='button'
                        role='tab'
                        key={device.asset_id}
                        aria-current={device.asset_id === selected.asset_id ? 'page' : undefined}
                        aria-selected={device.asset_id === selected.asset_id}
                        disabled={terminalActive && device.asset_id !== selected.asset_id}
                        onClick={() => {
                            setTerminalActive(false);
                            setSelectedId(device.asset_id);
                        }}
                    >
                        <span>{deviceName(device)}</span>
                        <strong>{device.online ? (zh ? '正常' : 'Normal') : (zh ? '故障' : 'Fault')}</strong>
                        <small>{device.device_model || 'SSH'} · {device.address}</small>
                    </button>)}
                    <div className='DeviceManagementNodeState'>
                        <small>{zh ? '所属节点' : 'Owning node'}</small>
                        <strong>{selected.node_name}</strong>
                        <span className={selected.online ? 'normal' : 'fault'}><i/> {selected.online
                            ? (zh ? '正常' : 'Normal')
                            : (zh ? '故障' : 'Fault')}</span>
                    </div>
                </nav>

                <main className='DeviceManagementMain'>
                    <ComputeTerminalPanel
                        key={selected.asset_id}
                        zh={zh}
                        preferredNodeId={selected.node_id}
                        targetLabel={label}
                        initialCommand={`ssh ${username}@${selected.address}`}
                        closeOnUnmount
                        onActiveChange={setTerminalActive}
                    />
                </main>
            </div>
        </section>
    </div>;
};
