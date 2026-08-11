import React, {useMemo} from 'react';
import {
    ComputeResourceGraph,
    ComputeResourceGraphEntity,
} from '../../../services/ComputeClusterService';

interface ResourceKnowledgeGraphProps {
    graph: ComputeResourceGraph;
    zh: boolean;
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
        not_console_allowlisted: ['未接入控制台', 'Not console-enabled'],
    };
    return (labels[reason] || [reason, reason])[zh ? 0 : 1];
};

// Graph entity variants share one visual boundary so relation state stays consistent.
// eslint-disable-next-line complexity
export const ResourceKnowledgeGraph: React.FC<ResourceKnowledgeGraphProps> = ({graph, zh}) => {
    const index = useMemo(
        () => new Map(graph.entities.map(entity => [entity.entity_id, entity])),
        [graph.entities],
    );
    const group = graph.entities.find(entity => entity.kind === 'compute_group');
    const nodes = graph.entities.filter(entity => entity.kind === 'compute_node');
    const resources = graph.entities.filter(entity => entity.kind === 'compute_resource');
    const agents = graph.entities.filter(entity => entity.kind === 'work_agent');
    const devices = graph.entities.filter(entity => entity.kind === 'managed_device');

    return <section className='ComputeKnowledgePanel' aria-label={zh ? '资源知识图谱' : 'Resource knowledge graph'}>
        <div className='ComputeKnowledgeHeading'>
            <div>
                <span>{zh ? '阶段 5 · 资源知识图谱' : 'Phase 5 · Resource knowledge graph'}</span>
                <h3>{zh ? '可调用资源图谱' : 'Callable resource graph'}</h3>
                <p>{zh
                    ? '只呈现经过 Client 白名单验证的关系；节点声明能力不等于控制台可以调用。'
                    : 'Only Client allowlisted relations are callable; advertised capability does not imply console access.'}</p>
            </div>
            <div className='ComputeKnowledgeStats'>
                <div><strong>{graph.summary.entities}</strong><span>{zh ? '实体' : 'entities'}</span></div>
                <div><strong>{graph.summary.relations}</strong><span>{zh ? '关系' : 'relations'}</span></div>
                <div><strong>{graph.summary.callable_work_agents}/{graph.summary.work_agents}</strong><span>{zh ? '可调用 agents' : 'callable agents'}</span></div>
            </div>
        </div>

        <div className='ComputeKnowledgeLegend'>
            <span><i className='callable'/>{zh ? '当前可调用' : 'Callable now'}</span>
            <span><i/>{zh ? '已登记但暂不可调用' : 'Registered, not callable'}</span>
            <code>{graph.schema_version}</code>
        </div>

        <div className='ComputeKnowledgeGraph' role='figure' aria-label={zh ? '计算群到节点再到资源与 agents 的关系' : 'Group-to-node-to-resource and agent relations'}>
            <div className='ComputeKnowledgeColumn group'>
                <span className='ComputeKnowledgeColumnLabel'>{zh ? '计算群' : 'Compute group'}</span>
                {group && <article className={`ComputeKnowledgeEntity group ${group.callable ? 'callable' : ''}`}>
                    <span>{zh ? '群主视图' : 'Owner view'}</span>
                    <strong>{group.label}</strong>
                    <small>{graph.summary.online_nodes}/{nodes.length} {zh ? '个节点在线' : 'nodes online'}</small>
                </article>}
            </div>

            <div className='ComputeKnowledgeConnector'><span>{zh ? '包含' : 'contains'}</span><i/></div>

            <div className='ComputeKnowledgeColumn nodes'>
                <span className='ComputeKnowledgeColumnLabel'>{zh ? '计算节点' : 'Compute nodes'}</span>
                {nodes.map(node => {
                    const executionEdges = graph.relations.filter(relation =>
                        relation.source_id === node.entity_id && relation.kind === 'can_execute'
                    );
                    return <article key={node.entity_id} className={`ComputeKnowledgeEntity node ${node.callable ? 'callable' : ''}`}>
                        <span>{node.state === 'available' ? (zh ? '在线' : 'Online') : (zh ? '离线' : 'Offline')}</span>
                        <strong>{node.label}</strong>
                        <div className='ComputeKnowledgeEdges'>
                            {executionEdges.map(edge => <small className={edge.active ? 'active' : ''} key={edge.relation_id}>
                                {agentLabel(index.get(edge.target_id) || {label: edge.target_id}, zh)} · {reasonLabel(edge.reason, zh)}
                            </small>)}
                        </div>
                    </article>;
                })}
            </div>

            <div className='ComputeKnowledgeConnector'><span>{zh ? '提供 / 执行' : 'provides / executes'}</span><i/></div>

            <div className='ComputeKnowledgeColumn resources'>
                <span className='ComputeKnowledgeColumnLabel'>{zh ? '可用资源与 work agents' : 'Resources and work agents'}</span>
                <div className='ComputeKnowledgeAgentGrid'>
                    {agents.map(agent => <article key={agent.entity_id} className={`ComputeKnowledgeEntity agent ${agent.callable ? 'callable' : ''}`}>
                        <span>{agent.callable ? (zh ? '可调用' : 'Callable') : (zh ? '暂不可调用' : 'Unavailable')}</span>
                        <strong>{agentLabel(agent, zh)}</strong>
                        <small>{agent.available_node_count || 0} {zh ? '个执行节点' : 'executor nodes'} · {agent.modes.map(mode => modeLabel(mode, zh)).join(' / ')}</small>
                    </article>)}
                </div>
                {resources.map(resource => <article key={resource.entity_id} className={`ComputeKnowledgeEntity capacity ${resource.callable ? 'callable' : ''}`}>
                    <span>{resource.platform} · {resource.architecture}</span>
                    <strong>{resource.label}</strong>
                    <small>CPU {resource.cpu_logical || 0} · {zh ? '内存' : 'RAM'} {resource.memory_available_bytes == null ? '—' : `${(resource.memory_available_bytes / 1024 ** 3).toFixed(1)} GB`} · GPU {resource.gpu_count || 0}</small>
                </article>)}
                {devices.map(device => <article key={device.entity_id} className={`ComputeKnowledgeEntity device ${device.callable ? 'callable' : ''}`}>
                    <span>{device.device_kind} · {device.provider}</span>
                    <strong>{device.label}</strong>
                    <small>{device.callable ? (zh ? '可调用' : 'Callable') : (zh ? '已归属，未接入控制台调用' : 'Managed, not console-enabled')}</small>
                </article>)}
            </div>
        </div>
    </section>;
};
