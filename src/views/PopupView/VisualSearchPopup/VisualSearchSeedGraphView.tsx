import React from 'react';

import {
    VisualSearchSeedCandidate,
    VisualSearchSeedEvidence,
    VisualSearchSeedGraph,
    VisualSearchSeedNode,
} from '../../../services/VisualSearchSeedGraphService';

interface Props {
    graph: VisualSearchSeedGraph;
    chinese: boolean;
}

const compactIdentity = (value: string): string =>
    value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value;

const nodeTitle = (
    seed: VisualSearchSeedNode,
    candidate: VisualSearchSeedCandidate | undefined,
    chinese: boolean,
): string => {
    if (seed.seedId === 'seed_root') return chinese ? '原始人工查询' : 'Original query';
    return candidate?.item.fileName || compactIdentity(seed.resultId || seed.seedId);
};

const nodePolarity = (seed: VisualSearchSeedNode, chinese: boolean): string =>
    seed.polarity === 'positive'
        ? (chinese ? '正种子' : 'Positive')
        : (chinese ? '负种子' : 'Negative');

const evidenceLabel = (
    evidence: VisualSearchSeedEvidence | undefined,
    chinese: boolean,
): string => {
    if (!evidence) return chinese ? '根任务证据' : 'Root task evidence';
    return chinese
        ? `${evidence.items.length}/${evidence.candidateK} 条已缓存`
        : `${evidence.items.length}/${evidence.candidateK} cached`;
};

export const VisualSearchSeedGraphView: React.FC<Props> = ({graph, chinese}) => {
    const candidates = new Map(
        graph.candidates.map(candidate => [candidate.resultId, candidate]),
    );
    const evidence = new Map(
        (graph.evidence ?? []).map(item => [item.seedId, item]),
    );
    const orderedSeeds = [...graph.seeds].sort((left, right) =>
        left.generation - right.generation || left.seedId.localeCompare(right.seedId));

    return <section className='vs-seed-tree' aria-label={chinese ? '种子传播树' : 'Seed propagation tree'}>
        <header>
            <div>
                <strong>{chinese ? '种子传播树' : 'Seed propagation tree'}</strong>
                <span>{graph.queryKind.toUpperCase()} · {chinese
                    ? `已缓存 ${graph.evidence?.length ?? 0} 次种子检索`
                    : `${graph.evidence?.length ?? 0} cached seed searches`}</span>
            </div>
            <small>{chinese
                ? '每个节点独立检索；同一深度直接复用证据。'
                : 'Each node searches independently; equal-depth evidence is reused.'}</small>
        </header>
        <div
            className='vs-seed-tree-list'
            role='tree'
            aria-label={chinese ? '种子传播树' : 'Seed propagation tree'}
        >
            {orderedSeeds.map(seed => {
                const candidate = seed.resultId ? candidates.get(seed.resultId) : undefined;
                const cached = evidence.get(seed.seedId);
                const title = nodeTitle(seed, candidate, chinese);
                const polarityLabel = nodePolarity(seed, chinese);
                return <div
                    key={seed.seedId}
                    role='treeitem'
                    aria-level={seed.generation + 1}
                    aria-label={`${title} · ${polarityLabel}`}
                    className={`vs-seed-tree-node ${seed.polarity}`}
                    style={{marginLeft: `${Math.min(seed.generation, 8) * 18}px`}}
                >
                    <i aria-hidden='true'/>
                    <div>
                        <strong title={seed.resultId || seed.seedId}>{title}</strong>
                        <span>
                            G{seed.generation} · {polarityLabel} · {chinese ? '可信度' : 'trust'} {seed.trust.toFixed(2)}
                        </span>
                        {seed.parentSeedId && <small title={seed.parentSeedId}>
                            {chinese ? '来源' : 'from'} {compactIdentity(seed.parentSeedId)}
                        </small>}
                    </div>
                    <em>{evidenceLabel(cached, chinese)}</em>
                </div>;
            })}
        </div>
    </section>;
};
