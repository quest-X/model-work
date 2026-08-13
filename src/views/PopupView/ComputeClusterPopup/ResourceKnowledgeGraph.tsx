import React, {useMemo, useState} from 'react';
import {
    ComputeClusterNode,
    ComputeResourceGraph,
    ComputeResourceGraphEntity,
    ComputeResourceGraphRelation,
    ComputeTaskType,
} from '../../../services/ComputeClusterService';

interface ResourceKnowledgeGraphProps {
    graph: ComputeResourceGraph;
    nodes: ComputeClusterNode[];
    zh: boolean;
    selectedTaskType?: ComputeTaskType;
    onSelectWorkAgent: (
        agent: ComputeResourceGraphEntity,
        candidateNodeIds: string[],
    ) => void;
}

const heartbeatLabel = (seconds: number | undefined, zh: boolean): string => {
    if (seconds == null || !Number.isFinite(seconds)) return zh ? '时间未知' : 'unknown';
    if (seconds < 10) return zh ? '刚刚' : 'just now';
    if (seconds < 60) return zh ? `${Math.floor(seconds)} 秒前` : `${Math.floor(seconds)}s ago`;
    if (seconds < 3600) return zh ? `${Math.floor(seconds / 60)} 分钟前` : `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return zh ? `${Math.floor(seconds / 3600)} 小时前` : `${Math.floor(seconds / 3600)}h ago`;
    return zh ? `${Math.floor(seconds / 86400)} 天前` : `${Math.floor(seconds / 86400)}d ago`;
};

const networkStateLabel = (node: ComputeClusterNode | undefined, zh: boolean): string => {
    if (!node) return zh ? '状态未知' : 'Unknown';
    if (!node.online) return zh ? '连接不可用' : 'Unavailable';
    return node.network.backend_state === 'Running'
        ? (zh ? '连接正常' : 'Connected')
        : (node.network.backend_state || (zh ? '状态未知' : 'Unknown'));
};

interface GraphPoint {
    x: number;
    y: number;
}

const agentLabel = (
    entity: Pick<ComputeResourceGraphEntity, 'label' | 'task_type'>,
    zh: boolean,
): string => {
    if (entity.task_type === 'information.web_fetch') {
        return zh ? '公开信息采集 agent' : 'Public information agent';
    }
    if (entity.task_type === 'system.wait') {
        return zh ? '等待诊断 agent' : 'Wait diagnostic agent';
    }
    if (entity.task_type === 'network.lan_discovery') {
        return zh ? '局域网发现 agent' : 'LAN discovery agent';
    }
    return entity.label;
};

const modeLabel = (mode: string, zh: boolean): string => mode === 'background'
    ? (zh ? '后台' : 'Background')
    : (zh ? '在线' : 'Online');

const reasonLabel = (reason: string, zh: boolean): string => {
    const labels: Record<string, [string, string]> = {
        available: ['可调用', 'Callable'],
        node_offline: ['节点离线', 'Node offline'],
        capability_missing: ['能力未安装', 'Capability missing'],
        scan_target_unavailable: ['未发现可扫描私网', 'No scannable private LAN'],
        dependency_unavailable: ['网络依赖不可用', 'Network dependency unavailable'],
        not_console_allowlisted: ['未接入控制台', 'Not console-enabled'],
    };
    return (labels[reason] || [reason, reason])[zh ? 0 : 1];
};

const relationLabel = (relation: ComputeResourceGraphRelation, zh: boolean): string => {
    const labels: Record<ComputeResourceGraphRelation['kind'], [string, string]> = {
        contains: ['包含', 'contains'],
        provides: ['提供', 'provides'],
        can_execute: ['可执行', 'can execute'],
        manages: ['管理', 'manages'],
        depends_on: ['依赖', 'depends on'],
    };
    return labels[relation.kind][zh ? 0 : 1];
};

const entityKindLabel = (entity: ComputeResourceGraphEntity, zh: boolean): string => {
    const labels: Record<ComputeResourceGraphEntity['kind'], [string, string]> = {
        compute_group: ['计算群', 'Compute group'],
        compute_node: ['计算节点', 'Compute node'],
        compute_resource: ['计算资源', 'Compute resource'],
        work_agent: ['WORK AGENT', 'WORK AGENT'],
        managed_device: ['托管设备', 'Managed device'],
        network_dependency: ['网络依赖', 'Network dependency'],
    };
    return labels[entity.kind][zh ? 0 : 1];
};

const dependencyLabel = (entity: ComputeResourceGraphEntity, zh: boolean): string => {
    const labels: Record<string, [string, string]> = {
        tailscale: ['Tailscale 组网', 'Tailscale network'],
        control_ssh: ['SSH 控制链路', 'SSH control'],
        public_http: ['公网出口', 'Public egress'],
    };
    const key = entity.dependency_id || entity.label;
    return (labels[key] || [entity.label, entity.label])[zh ? 0 : 1];
};

const spread = (count: number, minimum: number, maximum: number): number[] => {
    if (count <= 0) return [];
    if (count === 1) return [(minimum + maximum) / 2];
    return Array.from({length: count}, (_, index) => minimum + (maximum - minimum) * index / (count - 1));
};

const graphLayout = (entities: ComputeResourceGraphEntity[]): Map<string, GraphPoint> => {
    const points = new Map<string, GraphPoint>();
    const group = entities.find(entity => entity.kind === 'compute_group');
    const nodes = entities.filter(entity => entity.kind === 'compute_node');
    const resources = entities.filter(entity => entity.kind === 'compute_resource');
    const agents = entities.filter(entity => entity.kind === 'work_agent');
    const devices = entities.filter(entity => entity.kind === 'managed_device');
    const dependencies = entities.filter(entity => entity.kind === 'network_dependency');

    if (group) points.set(group.entity_id, {x: 50, y: 45});
    const nodeXs = spread(nodes.length, nodes.length === 1 ? 50 : 20, nodes.length === 1 ? 50 : 80);
    nodes.forEach((node, index) => points.set(node.entity_id, {x: nodeXs[index], y: 25}));

    const pointForNodeId = (nodeId?: string | null): GraphPoint | undefined => {
        const owner = nodes.find(node => node.node_id === nodeId);
        return owner ? points.get(owner.entity_id) : undefined;
    };

    resources.forEach((resource, index) => {
        const parent = pointForNodeId(resource.node_id);
        points.set(resource.entity_id, {x: parent?.x ?? spread(resources.length, 16, 84)[index], y: 8});
    });

    nodes.forEach(node => {
        const parent = points.get(node.entity_id);
        const owned = dependencies.filter(dependency => dependency.node_id === node.node_id);
        const offsets = spread(owned.length, -13, 13);
        owned.forEach((dependency, index) => points.set(dependency.entity_id, {
            x: Math.max(7, Math.min(93, (parent?.x ?? 50) + offsets[index])),
            y: 60,
        }));
    });

    agents.forEach((agent, index) => points.set(agent.entity_id, {
        x: spread(agents.length, agents.length === 1 ? 50 : 24, agents.length === 1 ? 50 : 76)[index],
        y: 79,
    }));

    devices.forEach((device, index) => {
        const parent = pointForNodeId(device.node_id);
        const siblingIndex = devices.filter(item => item.node_id === device.node_id).indexOf(device);
        points.set(device.entity_id, {
            x: Math.max(10, Math.min(90, (parent?.x ?? spread(devices.length, 18, 82)[index]) + siblingIndex * 12)),
            y: 93,
        });
    });

    entities.filter(entity => !points.has(entity.entity_id)).forEach((entity, index, unknown) => {
        points.set(entity.entity_id, {x: spread(unknown.length, 12, 88)[index], y: 92});
    });
    return points;
};

const entityLabel = (entity: ComputeResourceGraphEntity, zh: boolean): string => {
    if (entity.kind === 'work_agent') return agentLabel(entity, zh);
    if (entity.kind === 'network_dependency') return dependencyLabel(entity, zh);
    return entity.label;
};

// Every graph entity keeps its compact visual summary in one place.
// eslint-disable-next-line complexity
const entitySummary = (
    entity: ComputeResourceGraphEntity,
    zh: boolean,
    node?: ComputeClusterNode,
): string => {
    if (entity.kind === 'compute_group') return zh ? '群主控制域' : 'Owner control domain';
    if (entity.kind === 'compute_node') {
        const heartbeat = heartbeatLabel(node?.heartbeat_age_seconds, zh);
        return entity.state === 'available'
            ? `${zh ? '在线' : 'Online'} · ${zh ? '心跳' : 'heartbeat'} ${heartbeat}`
            : `${zh ? '离线' : 'Offline'} · ${zh ? '最后心跳' : 'last heartbeat'} ${heartbeat}`;
    }
    if (entity.kind === 'compute_resource') {
        const ram = entity.memory_available_bytes == null
            ? '—'
            : `${(entity.memory_available_bytes / 1024 ** 3).toFixed(1)}G`;
        const resources = `CPU ${entity.cpu_logical || 0} · RAM ${ram} · GPU ${entity.gpu_count || 0}`;
        return node && !node.online ? `${zh ? '上次上报' : 'Last reported'} · ${resources}` : resources;
    }
    if (entity.kind === 'work_agent') {
        return `${entity.available_node_count || 0} ${zh ? '个执行节点' : 'executors'} · ${entity.modes.map(mode => modeLabel(mode, zh)).join(' / ')}`;
    }
    if (entity.kind === 'managed_device') {
        return `${entity.device_model || (zh ? '型号未知' : 'Unknown model')} · ${entity.channels || 0} ${zh ? '通道' : 'channels'}`;
    }
    return entity.callable ? (zh ? '链路健康' : 'Healthy') : (zh ? '链路不可用' : 'Unavailable');
};

const graphNodeCode = (entity: ComputeResourceGraphEntity): string => {
    const codes: Record<ComputeResourceGraphEntity['kind'], string> = {
        compute_group: 'OS',
        compute_node: 'N',
        compute_resource: 'R',
        work_agent: 'A',
        managed_device: 'D',
        network_dependency: 'NET',
    };
    return codes[entity.kind];
};

// Graph entity variants share one interactive canvas so relation state stays consistent.
// eslint-disable-next-line complexity
export const ResourceKnowledgeGraph: React.FC<ResourceKnowledgeGraphProps> = ({
    graph,
    nodes: clusterNodes,
    zh,
    selectedTaskType,
    onSelectWorkAgent,
}) => {
    const [focusedEntityId, setFocusedEntityId] = useState<string | null>(null);
    const index = useMemo(
        () => new Map(graph.entities.map(entity => [entity.entity_id, entity])),
        [graph.entities],
    );
    const points = useMemo(() => graphLayout(graph.entities), [graph.entities]);
    const nodes = graph.entities.filter(entity => entity.kind === 'compute_node');
    const nodeIndex = useMemo(
        () => new Map(clusterNodes.map(node => [node.node_id, node])),
        [clusterNodes],
    );
    const offlineNodes = Math.max(0, nodes.length - graph.summary.online_nodes);
    const focusedEntity = focusedEntityId ? index.get(focusedEntityId) : undefined;
    const focusedRelations = focusedEntityId
        ? graph.relations.filter(relation => relation.source_id === focusedEntityId || relation.target_id === focusedEntityId)
        : [];

    return <section className='ComputeKnowledgePanel' aria-label={zh ? '资源知识图谱' : 'Resource knowledge graph'}>
        <div className='ComputeKnowledgeHeading'>
            <div>
                <span>{zh ? '资源关系 · 可交互' : 'Resource relations · Interactive'}</span>
                <h3>{zh ? '计算群资源 Graph' : 'Compute cluster resource graph'}</h3>
                <p>{zh
                    ? '节点和连线表达真实资源关系；点击实体可追踪上下游，点击可调用 work agent 可带入调度表单。'
                    : 'Nodes and edges show authoritative resource relations. Inspect any entity or select a callable work agent to fill the dispatch form.'}</p>
            </div>
            <div className='ComputeKnowledgeStats'>
                <div><strong>{graph.summary.entities}</strong><span>{zh ? '实体' : 'entities'}</span></div>
                <div><strong>{graph.summary.relations}</strong><span>{zh ? '关系' : 'relations'}</span></div>
                <div className='online'><strong>{graph.summary.online_nodes}</strong><span>{zh ? '在线节点' : 'online nodes'}</span></div>
                <div className='offline'><strong>{offlineNodes}</strong><span>{zh ? '离线节点' : 'offline nodes'}</span></div>
                <div><strong>{graph.summary.callable_work_agents}/{graph.summary.work_agents}</strong><span>{zh ? '可调用 agents' : 'callable agents'}</span></div>
                <div><strong>{graph.summary.healthy_network_dependencies}/{graph.summary.network_dependencies}</strong><span>{zh ? '健康网络依赖' : 'healthy dependencies'}</span></div>
            </div>
        </div>

        <div className='ComputeKnowledgeLegend'>
            <span><i className='relation contains'/>{zh ? '群组包含节点' : 'Group contains node'}</span>
            <span><i className='relation capability'/>{zh ? '提供 / 执行' : 'Provides / executes'}</span>
            <span><i className='relation dependency'/>{zh ? '依赖 / 管理' : 'Depends / manages'}</span>
            <span><i className='node-state online'/>{zh ? '节点在线' : 'Node online'}</span>
            <span><i className='node-state offline'/>{zh ? '节点离线' : 'Node offline'}</span>
            <span><i className='callable'/>{zh ? '当前可调用' : 'Callable now'}</span>
            <code>{graph.schema_version}</code>
        </div>

        <div className='ComputeGraphViewport'>
            <div
                className={`ComputeGraphScene ${focusedEntityId ? 'has-focus' : ''}`}
                role='figure'
                aria-label={zh ? '计算群资源节点关系图' : 'Compute cluster resource node-link graph'}
                tabIndex={0}
                onClick={event => {
                    if (event.target === event.currentTarget) setFocusedEntityId(null);
                }}
            >
                <svg className='ComputeGraphEdges' viewBox='0 0 1000 520' preserveAspectRatio='none' data-testid='resource-node-link-graph' aria-hidden='true'>
                    {graph.relations.map(relation => {
                        const source = points.get(relation.source_id);
                        const target = points.get(relation.target_id);
                        if (!source || !target) return null;
                        const connected = focusedEntityId === relation.source_id || focusedEntityId === relation.target_id;
                        const muted = Boolean(focusedEntityId) && !connected;
                        return <line
                            key={relation.relation_id}
                            x1={source.x * 10}
                            y1={source.y * 5.2}
                            x2={target.x * 10}
                            y2={target.y * 5.2}
                            className={`ComputeGraphEdge ${relation.kind} ${relation.active ? 'active' : 'inactive'} ${connected ? 'focused' : ''} ${muted ? 'muted' : ''}`}
                            data-testid='resource-graph-edge'
                            data-relation-kind={relation.kind}
                        />;
                    })}
                </svg>

                {graph.entities.map(
                    // The compact graph node keeps entity-specific interaction and status in one render path.
                    // eslint-disable-next-line complexity
                    entity => {
                    const point = points.get(entity.entity_id);
                    if (!point) return null;
                    const candidateNodeIds = entity.kind === 'work_agent'
                        ? graph.relations
                            .filter(relation => relation.kind === 'can_execute'
                                && relation.target_id === entity.entity_id
                                && relation.active)
                            .map(relation => index.get(relation.source_id)?.node_id)
                            .filter((nodeId): nodeId is string => Boolean(nodeId))
                        : [];
                    const selected = entity.kind === 'work_agent' && selectedTaskType === entity.task_type;
                    const focused = focusedEntityId === entity.entity_id;
                    const node = entity.node_id ? nodeIndex.get(entity.node_id) : undefined;
                    const nodeStateClass = entity.kind === 'compute_node'
                        ? (entity.state === 'available' ? 'node-online' : 'node-offline')
                        : '';
                    const action = entity.kind === 'work_agent' && entity.callable && candidateNodeIds.length
                        ? (zh ? '选择' : 'Select')
                        : (zh ? '查看' : 'Inspect');
                    return <button
                        type='button'
                        key={entity.entity_id}
                        className={`ComputeGraphNode ${entity.kind} state-${entity.state} ${entity.callable ? 'callable' : 'unavailable'} ${nodeStateClass} ${selected ? 'selected' : ''} ${focused ? 'focused' : ''}`}
                        style={{left: `${point.x}%`, top: `${point.y}%`}}
                        onClick={() => {
                            setFocusedEntityId(entity.entity_id);
                            if (entity.kind === 'work_agent' && entity.callable && candidateNodeIds.length) {
                                onSelectWorkAgent(entity, candidateNodeIds);
                            }
                        }}
                        aria-label={`${action} ${entityLabel(entity, zh)}`}
                        aria-pressed={focused}
                        data-testid='resource-graph-node'
                        data-entity-state={entity.state}
                    >
                        <i>{graphNodeCode(entity)}</i>
                        {entity.kind === 'compute_node' && <em className='ComputeGraphNodeState'>
                            <i/>{entity.state === 'available' ? (zh ? '在线' : 'Online') : (zh ? '离线' : 'Offline')}
                        </em>}
                        <span>{entityKindLabel(entity, zh)}</span>
                        <strong>{entityLabel(entity, zh)}</strong>
                        <small>{entity.kind === 'compute_group'
                            ? `${graph.summary.online_nodes}/${nodes.length} ${zh ? '节点在线' : 'nodes online'}`
                            : entitySummary(entity, zh, node)}</small>
                    </button>;
                    },
                )}

            </div>
            <aside className={`ComputeGraphInspector ${focusedEntity ? 'visible' : ''}`} aria-live='polite'>
                {focusedEntity ? <>
                    <span>{entityKindLabel(focusedEntity, zh)} · {focusedEntity.callable ? (zh ? '可调用' : 'Callable') : (zh ? '只读' : 'Read only')}</span>
                    <strong>{entityLabel(focusedEntity, zh)}</strong>
                    <small>{entitySummary(
                        focusedEntity,
                        zh,
                        focusedEntity.node_id ? nodeIndex.get(focusedEntity.node_id) : undefined,
                    )}</small>
                    {focusedEntity.kind === 'compute_node' && (() => {
                        const node = focusedEntity.node_id ? nodeIndex.get(focusedEntity.node_id) : undefined;
                        return <div className='ComputeGraphInspectorFacts'>
                            <em className={node?.online ? 'online' : 'offline'}>{node?.online
                                ? (zh ? '在线并参与调度' : 'Online and schedulable')
                                : (zh ? '离线，不参与调度' : 'Offline, excluded from scheduling')}</em>
                            <em>{zh ? '最近心跳' : 'Last heartbeat'} · {heartbeatLabel(node?.heartbeat_age_seconds, zh)}</em>
                            <em>{zh ? '网络状态' : 'Network'} · {networkStateLabel(node, zh)}</em>
                        </div>;
                    })()}
                    <div>{focusedRelations.map(relation => <em key={relation.relation_id} className={relation.active ? 'active' : ''}>
                        {relationLabel(relation, zh)} · {reasonLabel(relation.reason, zh)}
                    </em>)}</div>
                </> : <>
                    <span>{zh ? '关系导航' : 'Relation navigation'}</span>
                    <strong>{zh ? '点击任一节点' : 'Select any node'}</strong>
                    <small>{zh ? '高亮上下游关系；点击图谱空白处取消聚焦。' : 'Highlight upstream and downstream relations; select empty canvas space to clear focus.'}</small>
                </>}
            </aside>
        </div>
    </section>;
};
