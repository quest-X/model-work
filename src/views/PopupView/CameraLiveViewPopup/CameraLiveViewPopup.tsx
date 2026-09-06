import React, {useState} from 'react';
import {Language} from '../../../data/LanguageConfig';
import {
    cameraStreamingAvailable,
    ComputeClusterNode,
    ComputeManagedDevice,
} from '../../../services/ComputeClusterService';
import {QueueDataSyncStatus, QueueItemStatus, QueueItemType} from '../../../store/queue/types';
import CameraPlayer from '../../EditorView/CameraPlayer/CameraPlayer';
import {useEscapeToClose} from '../../../hooks/useEscapeToClose';
import '../DeviceManagementPopup/DeviceManagementPopup.scss';

interface IProps {
    language: Language;
    node: ComputeClusterNode;
    cameras: ComputeManagedDevice[];
    initialCameraId: string;
    onClose: () => void;
}

export const CameraLiveViewPopup: React.FC<IProps> = ({
    language, node, cameras, initialCameraId, onClose,
}) => {
    const zh = language === Language.CHINESE;
    useEscapeToClose(onClose, true, 20);
    const [selectedId, setSelectedId] = useState(initialCameraId);
    const selected = cameras.find(camera => camera.device_id === selectedId) || cameras[0];

    if (!selected) return null;

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
            aria-label={zh ? '相机实时画面' : 'Camera live view'}
        >
            <header className='DeviceManagementHeader'>
                <div>
                    <span>{zh ? '实时画面' : 'Live view'}</span>
                    <h2>{zh ? '相机设备' : 'Camera devices'}</h2>
                    <p>{zh ? '左侧选择设备，右侧查看实时画面' : 'Choose a device on the left and view its live stream on the right'}</p>
                </div>
            </header>

            <div className='DeviceManagementWorkspace'>
                <nav
                    className='DeviceManagementNav'
                    role='tablist'
                    aria-label={zh ? '相机设备' : 'Camera devices'}
                >
                    {cameras.map(camera => {
                        const available = cameraStreamingAvailable(camera);
                        return <button
                            type='button'
                            role='tab'
                            key={camera.device_id}
                            aria-selected={camera.device_id === selected.device_id}
                            disabled={!available}
                            onClick={() => setSelectedId(camera.device_id)}
                        >
                            <span>{camera.name}</span>
                            <span className={`DeviceManagementStatus ${available ? 'normal' : 'fault'}`}><i/> {available ? (zh ? '正常' : 'Normal') : (zh ? '故障' : 'Fault')}</span>
                            <small>{camera.model || camera.device_id} · {camera.channels} {zh ? '通道' : 'channels'}</small>
                        </button>;
                    })}
                    <div className='DeviceManagementNodeState'>
                        <small>{zh ? '所属节点' : 'Owning node'}</small>
                        <strong>{node.name}</strong>
                        <span className={node.online ? 'normal' : 'fault'}><i/> {node.online
                            ? (zh ? '正常' : 'Normal')
                            : (zh ? '故障' : 'Fault')}</span>
                    </div>
                </nav>

                <main className='DeviceManagementMain CameraLiveViewMain'>
                    <CameraPlayer
                        key={selected.device_id}
                        language={language}
                        item={{
                            id: `camera-${node.node_id}-${selected.device_id}`,
                            name: selected.name,
                            type: QueueItemType.CAMERA,
                            status: QueueItemStatus.COMPLETED,
                            uploadedAt: Date.now(),
                            dataSyncStatus: QueueDataSyncStatus.SYNCED,
                            cameraNodeId: node.node_id,
                            cameraResourceId: selected.device_id,
                            cameraModel: selected.model || undefined,
                        }}
                    />
                </main>
            </div>
        </section>
    </div>;
};
