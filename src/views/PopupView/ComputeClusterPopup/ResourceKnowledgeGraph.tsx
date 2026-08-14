import React, {useMemo, useState} from 'react';
import {
    ComputeClusterNode,
    ComputeResourceGraph,
    ComputeResourceGraphEntity,
} from '../../../services/ComputeClusterService';

interface ResourceKnowledgeGraphProps {
    graph: ComputeResourceGraph;
    nodes: ComputeClusterNode[];
    zh: boolean;
    selectedTaskType?: string;
    onSelectWorkAgent: (
        agent: ComputeResourceGraphEntity,
        candidateNodeIds: string[],
    ) => void;
}

interface GraphPoint {
    x: number;
    y: number;
}

interface GraphRegion {
    entityId: string;
    regionId: string;
    regionName: string;
    state: ComputeResourceGraphEntity['state'];
    memberCount: number;
    onlineMemberCount: number;
    nodeIds: string[];
    left: number;
    width: number;
}

interface OperationsTopology {
    points: Map<string, GraphPoint>;
    regions: GraphRegion[];
}

const heartbeatLabel = (seconds: number | undefined, zh: boolean): string => {
    if (seconds == null || !Number.isFinite(seconds)) return zh ? '时间未知' : 'unknown';
    if (seconds < 10) return zh ? '刚刚' : 'just now';
    if (seconds < 60) return zh ? `${Math.floor(seconds)} 秒前` : `${Math.floor(seconds)}s ago`;
    if (seconds < 3600) return zh ? `${Math.floor(seconds / 60)} 分钟前` : `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return zh ? `${Math.floor(seconds / 3600)} 小时前` : `${Math.floor(seconds / 3600)}h ago`;
    return zh ? `${Math.floor(seconds / 86400)} 天前` : `${Math.floor(seconds / 86400)}d ago`;
};

const spread = (count: number, minimum: number, maximum: number): number[] => {
    if (count <= 0) return [];
    if (count === 1) return [(minimum + maximum) / 2];
    return Array.from({length: count}, (_, index) => minimum + (maximum - minimum) * index / (count - 1));
};

const visibleEntity = (entity: ComputeResourceGraphEntity): boolean =>
    entity.kind === 'compute_node' || entity.kind === 'managed_device';

const deviceClass = (entity: ComputeResourceGraphEntity): 'sensor' | 'controller' | 'actuator' => {
    const kind = (entity.device_kind || '').toLowerCase();
    if (['plc', 'controller', 'control'].includes(kind)) return 'controller';
    if (['actuator', 'motor', 'valve', 'robot'].includes(kind)) return 'actuator';
    return 'sensor';
};

const displayCodes = (entities: ComputeResourceGraphEntity[]): Map<string, string> => {
    const prefix = (entity: ComputeResourceGraphEntity): string => {
        if (entity.kind === 'compute_node') return 'N';
        if (entity.kind === 'work_agent') return 'A';
        if (entity.kind === 'managed_device') {
            const classification = deviceClass(entity);
            return classification === 'sensor' ? 'S' : classification === 'controller' ? 'C' : 'E';
        }
        return '';
    };
    const operational = entities
        .filter(entity => Boolean(prefix(entity)))
        .sort((left, right) => {
            const order: Record<string, number> = {compute_node: 0, managed_device: 1, work_agent: 2};
            return (order[left.kind] ?? 9) - (order[right.kind] ?? 9)
                || left.entity_id.localeCompare(right.entity_id);
        });
    return new Map(operational.map((entity, index) => [
        entity.entity_id,
        `${prefix(entity)}-${String(index + 1).padStart(3, '0')}`,
    ]));
};

const operationsTopology = (
    entities: ComputeResourceGraphEntity[],
    relations: ComputeResourceGraph['relations'],
): OperationsTopology => {
    const points = new Map<string, GraphPoint>();
    const nodes = entities.filter(entity => entity.kind === 'compute_node');
    const devices = entities.filter(entity => entity.kind === 'managed_device');
    const regionEntities = entities.filter(entity => entity.kind === 'compute_region');
    const regionRecords = new Map<string, Omit<GraphRegion, 'left' | 'width'>>();
    regionEntities.forEach(region => regionRecords.set(region.entity_id, {
        entityId: region.entity_id,
        regionId: region.region_id || region.region_name || region.label,
        regionName: region.region_name || region.region_id || region.label,
        state: region.state,
        memberCount: region.member_count || 0,
        onlineMemberCount: region.online_member_count || 0,
        nodeIds: [],
    }));
    nodes.forEach(node => {
        const relation = relations.find(item => item.kind === 'contains'
            && item.target_id === node.entity_id
            && regionRecords.has(item.source_id));
        const fallbackId = `region-fallback:${node.region_id || 'unassigned'}`;
        const regionId = relation?.source_id || fallbackId;
        if (!regionRecords.has(regionId)) {
            regionRecords.set(regionId, {
                entityId: regionId,
                regionId: node.region_id || node.region_name || 'unassigned',
                regionName: node.region_name || node.region_id || '未分配地域',
                state: node.state,
                memberCount: 0,
                onlineMemberCount: 0,
                nodeIds: [],
            });
        }
        const record = regionRecords.get(regionId);
        if (!record) return;
        record.nodeIds.push(node.entity_id);
        if (regionId.startsWith('region-fallback:')) {
            record.memberCount += 1;
            record.onlineMemberCount += Number(node.state === 'available');
        }
    });
    const orderedRegions = [...regionRecords.values()]
        .filter(region => region.nodeIds.length > 0)
        .sort((left, right) => left.regionId.localeCompare(right.regionId) || left.entityId.localeCompare(right.entityId));
    const gap = 2;
    const regionWidth = orderedRegions.length
        ? (96 - gap * Math.max(0, orderedRegions.length - 1)) / orderedRegions.length
        : 96;
    const regions = orderedRegions.map((region, index): GraphRegion => ({
        ...region,
        left: 2 + index * (regionWidth + gap),
        width: regionWidth,
    }));
    regions.forEach(region => {
        const nodeXs = spread(region.nodeIds.length, region.nodeIds.length === 1 ? 50 : 22, region.nodeIds.length === 1 ? 50 : 78);
        region.nodeIds.forEach((nodeId, index) => points.set(nodeId, {
            x: region.left + region.width * nodeXs[index] / 100,
            y: 38,
        }));
    });

    const deviceGroups = new Map<string, ComputeResourceGraphEntity[]>();
    devices.forEach(device => {
        const ownerRelation = relations.find(relation =>
            relation.kind === 'manages' && relation.target_id === device.entity_id,
        );
        const ownerId = ownerRelation?.source_id || `unowned:${device.node_id || 'unknown'}`;
        deviceGroups.set(ownerId, [...(deviceGroups.get(ownerId) || []), device]);
    });

    let unownedIndex = 0;
    deviceGroups.forEach((ownedDevices, ownerId) => {
        const owner = points.get(ownerId);
        const offsets = spread(ownedDevices.length, ownedDevices.length === 1 ? 0 : -9, ownedDevices.length === 1 ? 0 : 9);
        ownedDevices.forEach((device, index) => {
            const fallback = spread(devices.length, 14, 86)[unownedIndex++] ?? 50;
            points.set(device.entity_id, {
                x: Math.max(8, Math.min(92, (owner?.x ?? fallback) + offsets[index])),
                y: 76,
            });
        });
    });
    return {points, regions};
};

const agentLabel = (
    entity: Pick<ComputeResourceGraphEntity, 'label' | 'task_type'>,
    zh: boolean,
): string => {
    if (entity.task_type === 'information.web_fetch') return zh ? '公开信息采集' : 'Public information';
    if (entity.task_type === 'system.wait') return zh ? '等待诊断' : 'Wait diagnostic';
    if (entity.task_type === 'network.lan_discovery') return zh ? '局域网发现' : 'LAN discovery';
    return entity.label;
};

const availabilityLabel = (available: boolean, zh: boolean): string =>
    available ? (zh ? '可用' : 'Available') : (zh ? '不可用' : 'Unavailable');

const sensorKindLabel = (entity: ComputeResourceGraphEntity, zh: boolean): string => {
    const classification = deviceClass(entity);
    if (classification === 'controller') return zh ? '控制器' : 'Controller';
    if (classification === 'actuator') return zh ? '执行器' : 'Actuator';
    if (entity.device_kind === 'camera') return zh ? '摄像头传感器' : 'Camera sensor';
    return zh ? '传感器' : 'Sensor';
};

const deviceStatusLabel = (status: string | null | undefined, zh: boolean): string => {
    const labels: Record<string, [string, string]> = {
        registered: ['已注册', 'Registered'],
        online: ['在线', 'Online'],
        offline: ['离线', 'Offline'],
        unavailable: ['不可用', 'Unavailable'],
    };
    return (labels[status || ''] || [status || '未知', status || 'Unknown'])[zh ? 0 : 1];
};

// The operations canvas intentionally keeps all bilingual visual and hover states in one component.
// eslint-disable-next-line complexity
export const ResourceKnowledgeGraph: React.FC<ResourceKnowledgeGraphProps> = ({
    graph,
    nodes: clusterNodes,
    zh,
}) => {
    const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
    const index = useMemo(
        () => new Map(graph.entities.map(entity => [entity.entity_id, entity])),
        [graph.entities],
    );
    const nodeIndex = useMemo(
        () => new Map(clusterNodes.map(node => [node.node_id, node])),
        [clusterNodes],
    );
    const visibleEntities = useMemo(
        () => graph.entities.filter(visibleEntity),
        [graph.entities],
    );
    const visibleEntityIds = useMemo(
        () => new Set(visibleEntities.map(entity => entity.entity_id)),
        [visibleEntities],
    );
    const visibleRelations = useMemo(
        () => graph.relations.filter(relation =>
            relation.kind === 'manages'
            && visibleEntityIds.has(relation.source_id)
            && visibleEntityIds.has(relation.target_id),
        ),
        [graph.relations, visibleEntityIds],
    );
    const topology = useMemo(
        () => operationsTopology(graph.entities, graph.relations),
        [graph.entities, graph.relations],
    );
    const points = topology.points;
    const codes = useMemo(() => displayCodes(graph.entities), [graph.entities]);
    const graphNodes = visibleEntities.filter(entity => entity.kind === 'compute_node');
    const sensors = visibleEntities.filter(entity => entity.kind === 'managed_device');
    const offlineNodes = graphNodes.filter(entity => entity.state !== 'available').length;
    const sshReachableNodes = graphNodes.filter(entity => {
        const node = entity.node_id ? nodeIndex.get(entity.node_id) : undefined;
        return node?.online && node.network.ssh_available;
    }).length;
    const hoveredEntity = hoveredEntityId ? index.get(hoveredEntityId) : undefined;
    const hoveredPoint = hoveredEntityId ? points.get(hoveredEntityId) : undefined;

    const dependencyFor = (nodeEntity: ComputeResourceGraphEntity, dependencyId: string): boolean => {
        const relation = graph.relations.find(item =>
            item.kind === 'depends_on'
            && item.source_id === nodeEntity.entity_id
            && index.get(item.target_id)?.dependency_id === dependencyId,
        );
        if (relation) return relation.active && index.get(relation.target_id)?.state === 'available';
        const node = nodeEntity.node_id ? nodeIndex.get(nodeEntity.node_id) : undefined;
        if (dependencyId === 'control_ssh') return Boolean(node?.online && node.network.ssh_available);
        if (dependencyId === 'tailscale') return Boolean(node?.online && node.network.online);
        return node?.network_dependencies.some(item => item.dependency_id === dependencyId && item.state === 'healthy') ?? false;
    };

    const callableAgentsFor = (nodeEntity: ComputeResourceGraphEntity): ComputeResourceGraphEntity[] =>
        graph.relations
            .filter(relation => relation.kind === 'can_execute'
                && relation.source_id === nodeEntity.entity_id
                && relation.active)
            .map(relation => index.get(relation.target_id))
            .filter((entity): entity is ComputeResourceGraphEntity => Boolean(entity && entity.kind === 'work_agent'));

    const ownerFor = (device: ComputeResourceGraphEntity): ComputeResourceGraphEntity | undefined => {
        const relation = graph.relations.find(item => item.kind === 'manages' && item.target_id === device.entity_id);
        return relation ? index.get(relation.source_id) : undefined;
    };

    return <section className='ComputeKnowledgePanel' aria-label={zh ? '节点与传感器拓扑' : 'Node and sensor topology'}>
        <div className='ComputeKnowledgeHeading'>
            <div>
                <span>{zh ? '地域拓扑 · 悬浮查看' : 'Regional topology · Hover to inspect'}</span>
                <h3>{zh ? '计算群地域 Graph' : 'Compute cluster regional graph'}</h3>
                <p>{zh
                    ? '计算群按地域归组计算节点，节点再连接传感器；SSH、公网、Tailscale 和 agents 收进节点就近信息卡。'
                    : 'The cluster groups compute nodes by region, then connects their sensors. SSH, public egress, Tailscale, and agents appear beside each node.'}</p>
            </div>
            <div className='ComputeKnowledgeStats'>
                <div><strong>{topology.regions.length}</strong><span>{zh ? '地域' : 'regions'}</span></div>
                <div><strong>{graphNodes.length}</strong><span>{zh ? '计算节点' : 'compute nodes'}</span></div>
                <div className='online'><strong>{graph.summary.online_nodes}</strong><span>{zh ? '在线' : 'online'}</span></div>
                <div className='offline'><strong>{offlineNodes}</strong><span>{zh ? '离线' : 'offline'}</span></div>
                <div><strong>{sshReachableNodes}</strong><span>{zh ? 'SSH 可连接' : 'SSH reachable'}</span></div>
                <div><strong>{sensors.length}</strong><span>{zh ? '传感器' : 'sensors'}</span></div>
            </div>
        </div>

        <div className='ComputeKnowledgeLegend'>
            <span><i className='entity-shape region'/>{zh ? '区域 · 地域' : 'Area · Region'}</span>
            <span><i className='entity-shape circle'/>{zh ? '圆形 · 计算节点' : 'Circle · Compute node'}</span>
            <span><i className='entity-shape rounded-rectangle sensor'/>{zh ? '蓝色 · 传感器' : 'Blue · Sensor'}</span>
            <span><i className='entity-shape rounded-rectangle actuator'/>{zh ? '黄色 · 执行器（预留）' : 'Yellow · Actuator (reserved)'}</span>
            <span><i className='node-state online'/>{zh ? '绿色 · 在线' : 'Green · Online'}</span>
            <span><i className='node-state offline'/>{zh ? '红色 · 离线' : 'Red · Offline'}</span>
            <span><i className='relation sensor-link'/>{zh ? '节点管理传感器' : 'Node manages sensor'}</span>
            <small>{zh ? '网络、资源与 agents 已隐藏，悬浮节点查看' : 'Networks, resources, and agents are hidden; hover a node to inspect'}</small>
        </div>

        <div className='ComputeGraphViewport'>
            <div
                className='ComputeGraphScene operations-only'
                style={{minWidth: `${Math.max(720, topology.regions.length * 390)}px`}}
                role='figure'
                aria-label={zh ? '计算群节点与传感器关系图' : 'Compute cluster node and sensor graph'}
            >
                {topology.regions.map(region => <div
                    key={region.entityId}
                    className={`ComputeGraphRegion state-${region.state}`}
                    style={{left: `${region.left}%`, width: `${region.width}%`}}
                    data-testid='resource-graph-region'
                >
                    <span>{zh ? '地域' : 'Region'}</span>
                    <strong>{zh ? region.regionName : region.regionId}</strong>
                    <small>{region.onlineMemberCount}/{region.memberCount} {zh ? '节点在线' : 'nodes online'}</small>
                </div>)}
                <svg className='ComputeGraphEdges' viewBox='0 0 1000 440' preserveAspectRatio='none' data-testid='resource-node-link-graph' aria-hidden='true'>
                    {visibleRelations.map(relation => {
                        const source = points.get(relation.source_id);
                        const target = points.get(relation.target_id);
                        const targetEntity = index.get(relation.target_id);
                        if (!source || !target || !targetEntity) return null;
                        return <line
                            key={relation.relation_id}
                            x1={source.x * 10}
                            y1={source.y * 4.4}
                            x2={target.x * 10}
                            y2={target.y * 4.4}
                            className={`ComputeGraphEdge manages ${deviceClass(targetEntity)} ${relation.active ? 'active' : 'inactive'}`}
                            data-testid='resource-graph-edge'
                            data-relation-kind='manages'
                        />;
                    })}
                </svg>

                {visibleEntities.map(
                    // Visible node and sensor variants share one accessible interaction path.
                    // eslint-disable-next-line complexity
                    entity => {
                    const point = points.get(entity.entity_id);
                    if (!point) return null;
                    const node = entity.node_id ? nodeIndex.get(entity.node_id) : undefined;
                    const isNode = entity.kind === 'compute_node';
                    const classification = entity.kind === 'managed_device' ? deviceClass(entity) : '';
                    const isHovered = hoveredEntityId === entity.entity_id;
                    return <button
                        type='button'
                        key={entity.entity_id}
                        className={`ComputeGraphNode ${entity.kind} ${classification} state-${entity.state} ${isNode
                            ? (entity.state === 'available' ? 'node-online' : 'node-offline')
                            : 'sensor-node'} ${isHovered ? 'focused' : ''}`}
                        style={{left: `${point.x}%`, top: `${point.y}%`}}
                        onMouseEnter={() => setHoveredEntityId(entity.entity_id)}
                        onMouseLeave={() => setHoveredEntityId(current => current === entity.entity_id ? null : current)}
                        onFocus={() => setHoveredEntityId(entity.entity_id)}
                        onBlur={() => setHoveredEntityId(current => current === entity.entity_id ? null : current)}
                        aria-label={isNode
                            ? `${zh ? '查看' : 'Inspect'} ${entity.label} ${zh ? '节点信息' : 'node details'}`
                            : `${zh ? '查看' : 'Inspect'} ${entity.label} ${zh ? '传感器信息' : 'sensor details'}`}
                        data-testid='resource-graph-node'
                        data-entity-kind={entity.kind}
                        data-entity-shape={isNode ? 'circle' : 'rounded-rectangle'}
                        data-entity-state={entity.state}
                    >
                        <i>{codes.get(entity.entity_id)}</i>
                        <span>{isNode ? (zh ? '计算节点' : 'Compute node') : sensorKindLabel(entity, zh)}</span>
                        <strong>{entity.label}</strong>
                        <small>{isNode
                            ? `${zh ? '心跳' : 'Heartbeat'} ${heartbeatLabel(node?.heartbeat_age_seconds, zh)}`
                            : `${entity.device_model || (zh ? '型号未知' : 'Unknown model')} · ${entity.channels || 0} ${zh ? '通道' : 'channels'}`}</small>
                    </button>;
                    },
                )}

                {hoveredEntity && <aside
                    className='ComputeGraphHoverCard anchored'
                    style={{
                        '--hover-anchor-x': `${hoveredPoint?.x || 50}%`,
                        '--hover-anchor-y': `${hoveredPoint?.y || 50}%`,
                        '--hover-shift-x': hoveredPoint && hoveredPoint.x > 50 ? 'calc(-100% - 58px)' : '58px',
                        '--hover-shift-y': hoveredPoint && hoveredPoint.y < 28 ? '-10%' : hoveredPoint && hoveredPoint.y > 72 ? '-90%' : '-50%',
                    } as React.CSSProperties}
                    role='status'
                    aria-label={`${hoveredEntity.label} ${zh ? '运维信息' : 'operations details'}`}
                >
                    {/* The node card derives transport and agent state from authoritative graph relations. */}
                    {/* eslint-disable-next-line complexity */}
                    {hoveredEntity.kind === 'compute_node' ? (() => {
                        const node = hoveredEntity.node_id ? nodeIndex.get(hoveredEntity.node_id) : undefined;
                        const agents = callableAgentsFor(hoveredEntity);
                        const sshAvailable = dependencyFor(hoveredEntity, 'control_ssh');
                        const publicAvailable = dependencyFor(hoveredEntity, 'public_http');
                        const tailscaleAvailable = dependencyFor(hoveredEntity, 'tailscale');
                        return <>
                            <span>{zh ? `计算节点 ${codes.get(hoveredEntity.entity_id)} · 运维信息` : `Compute node ${codes.get(hoveredEntity.entity_id)} · Operations`}</span>
                            <strong>{hoveredEntity.label}</strong>
                            <small className={node?.online ? 'online' : 'offline'}>{node?.online
                                ? `${zh ? '在线 · 心跳' : 'Online · heartbeat'} ${heartbeatLabel(node.heartbeat_age_seconds, zh)}`
                                : `${zh ? '离线 · 最后心跳' : 'Offline · last heartbeat'} ${heartbeatLabel(node?.heartbeat_age_seconds, zh)}`}</small>
                            <div className='ComputeGraphHoverRoutes'>
                                <div className={sshAvailable ? 'available' : 'unavailable'}>
                                    <span>{zh ? 'SSH 通路' : 'SSH route'}</span><strong>{availabilityLabel(sshAvailable, zh)}</strong>
                                    <small>{node?.network.self_name || node?.network.addresses.join(' · ') || (zh ? '地址待节点上报' : 'Address pending')}</small>
                                </div>
                                <div className={publicAvailable ? 'available' : 'unavailable'}>
                                    <span>{zh ? '公网出口' : 'Public egress'}</span><strong>{availabilityLabel(publicAvailable, zh)}</strong>
                                    <small>{zh ? '公开网络访问' : 'Public network access'}</small>
                                </div>
                                <div className={tailscaleAvailable ? 'available' : 'unavailable'}>
                                    <span>{zh ? 'Tailscale 私有组网' : 'Tailscale private overlay'}</span><strong>{availabilityLabel(tailscaleAvailable, zh)}</strong>
                                    <small>{node?.network.tailnet || (zh ? '私有链路' : 'Private route')}</small>
                                </div>
                            </div>
                            <div className='ComputeGraphHoverAgents'>
                                <span>{zh ? '可调用 agents' : 'Callable agents'}</span>
                                {agents.length ? <div>{agents.map(agent => <em key={agent.entity_id}>{codes.get(agent.entity_id)} · {agentLabel(agent, zh)}</em>)}</div>
                                    : <small>{zh ? '暂无可调用 agent' : 'No callable agent'}</small>}
                            </div>
                        </>;
                    })() : <>
                        <span>{sensorKindLabel(hoveredEntity, zh)} {codes.get(hoveredEntity.entity_id)} · {deviceStatusLabel(hoveredEntity.device_status, zh)}</span>
                        <strong>{hoveredEntity.label}</strong>
                        <small>{hoveredEntity.device_model || (zh ? '型号未知' : 'Unknown model')}</small>
                        <div className='ComputeGraphSensorFacts'>
                            <em>{hoveredEntity.channels || 0} {zh ? '个通道' : 'channels'}</em>
                            <em>{zh ? '接入方式' : 'Provider'} · {hoveredEntity.provider || '—'}</em>
                            <em>{zh ? '归属节点' : 'Owner'} · {ownerFor(hoveredEntity)?.label || (zh ? '未归属' : 'Unassigned')}</em>
                        </div>
                    </>}
                </aside>}
            </div>
        </div>
    </section>;
};
