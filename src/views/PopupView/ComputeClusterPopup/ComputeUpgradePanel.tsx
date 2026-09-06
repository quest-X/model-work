import React, {useEffect, useMemo, useState} from 'react';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeUpgradeBatch,
    ComputeUpgradeManifest,
} from '../../../services/ComputeClusterService';
import {ApprovalIdentityPanel} from '../../Common/ApprovalIdentityPanel';

const ACTIVE_BATCH_KEY = 'opensight.compute-upgrade-batch.v1';
const manifestKey = (manifest: ComputeUpgradeManifest): string =>
    `${manifest.platform}/${manifest.architecture}`;
const nodeKey = (node: ComputeClusterNode): string =>
    `${node.resources.platform.toLowerCase()}/${node.resources.architecture.toLowerCase()}`;

// eslint-disable-next-line complexity
const stateLabel = (state: string, zh: boolean): string => ({
    awaiting_authorization: zh ? '等待批次确认' : 'Awaiting batch approval',
    authorized: zh ? '已确认，等待自动升级' : 'Approved, waiting to upgrade',
    approval_submitting: zh ? '正在提交授权' : 'Submitting approval',
    running: zh ? '升级中' : 'Upgrading',
    queued: zh ? '已排队' : 'Queued',
    draining: zh ? '等待任务结束' : 'Draining',
    downloading: zh ? '下载中' : 'Downloading',
    prepared: zh ? '已准备' : 'Prepared',
    installing: zh ? '安装中' : 'Installing',
    checking: zh ? '健康检查' : 'Health check',
    rolling_back: zh ? '正在回退' : 'Rolling back',
    recovery_required: zh ? '需要人工恢复' : 'Recovery required',
    rolled_back: zh ? '已回退' : 'Rolled back',
    succeeded: zh ? '成功' : 'Succeeded',
    failed: zh ? '失败' : 'Failed',
    cancelled: zh ? '已取消' : 'Cancelled',
    rejected: zh ? '已拒绝' : 'Rejected',
}[state] || state);

// The compact panel owns its one batch lifecycle, including restart recovery and approval.
export const ComputeUpgradePanel: React.FC<{
    nodes: ComputeClusterNode[];
    zh: boolean;
}> = ({nodes, zh}) => { // eslint-disable-line complexity
    const [manifests, setManifests] = useState<Record<string, ComputeUpgradeManifest>>({});
    const [selected, setSelected] = useState<string[]>([]);
    const [batch, setBatch] = useState<ComputeUpgradeBatch | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const eligible = useMemo(() => nodes.filter(node => node.online
        && node.capabilities.includes('control.node.upgrade.v1')), [nodes]);

    useEffect(() => {
        const batchId = localStorage.getItem(ACTIVE_BATCH_KEY);
        if (!batchId) return;
        void ComputeClusterService.upgradeBatch(batchId).then(setBatch).catch(reason => {
            // An observation outage is not proof the durable batch disappeared.
            setError(reason instanceof Error ? reason.message : String(reason));
        });
    }, []);

    useEffect(() => {
        if (!batch || !['authorized', 'running', 'approval_submitting'].includes(batch.state)) return undefined;
        let disposed = false;
        let timer: number;
        const poll = async () => {
            try {
                const next = await ComputeClusterService.upgradeBatch(batch.batch_id);
                if (!disposed) setBatch(next);
            } catch (reason) {
                if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
            } finally {
                if (!disposed) timer = window.setTimeout(() => void poll(), 2000);
            }
        };
        timer = window.setTimeout(() => void poll(), 2000);
        return () => { disposed = true; window.clearTimeout(timer); };
    }, [batch?.batch_id, batch?.state]);

    const loadManifests = async (files: FileList | null) => {
        if (!files) return;
        setError('');
        try {
            const next: Record<string, ComputeUpgradeManifest> = {};
            for (const file of Array.from(files)) {
                if (file.size > 16 * 1024) throw new Error(zh ? '发布清单过大' : 'Release manifest is too large');
                // Server and Node perform the authoritative strict validation and signature check.
                // eslint-disable-next-line no-await-in-loop
                const manifest = JSON.parse(await file.text()) as ComputeUpgradeManifest;
                if (manifest?.purpose !== 'model-work-node.ota-release.v1') {
                    throw new Error(zh ? '不是有效的 OTA 发布清单' : 'Not an OTA release manifest');
                }
                next[manifestKey(manifest)] = manifest;
            }
            if (new Set(Object.values(next).map(item => item.release_version)).size !== 1) {
                throw new Error(zh ? '一次批次只能选择同一版本' : 'A batch must use one release version');
            }
            setManifests(next);
        } catch (reason) {
            setManifests({});
            setError(reason instanceof Error ? reason.message : String(reason));
        }
    };

    const start = async () => {
        setBusy(true);
        setError('');
        try {
            const targets = selected.map(nodeId => {
                const node = eligible.find(item => item.node_id === nodeId);
                const manifest = node && manifests[nodeKey(node)];
                if (!node || !manifest) throw new Error(zh ? '所选节点没有匹配的发布清单' : 'A selected node has no matching manifest');
                return {node_id: node.node_id, manifest};
            });
            const created = await ComputeClusterService.createUpgradeBatch(targets);
            localStorage.setItem(ACTIVE_BATCH_KEY, created.batch_id);
            setBatch(created);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    };

    const approve = async () => {
        if (!batch) return;
        const targets = batch.nodes.slice(batch.current_index).map(item => {
            const node = nodes.find(candidate => candidate.node_id === item.node_id);
            return `${node?.name || item.node_id} (${item.node_id})\nv${item.manifest.release_version} · ${item.manifest.platform}/${item.manifest.architecture}\nSHA-256 ${item.manifest.sha256}`;
        }).join('\n\n');
        if (!window.confirm(`${zh ? '一次批准以下整个升级批次' : 'Approve this entire upgrade batch once'}\n\n${targets}\n\n${zh ? '授权截止' : 'Approval expires'}: ${new Date(batch.expires_at * 1000).toLocaleString()}\n${zh ? '等待任务结束上限' : 'Drain timeout'}: ${batch.drain_timeout_seconds}s\n${zh ? '按所列顺序自动逐台升级，失败即停；仅这些机器、这些版本、本批次有效。' : 'Upgrade in the listed order, stop on failure. Only these machines and releases, one use each.'}`)) return;
        setBusy(true);
        setError('');
        try {
            setBatch(await ComputeClusterService.approveUpgradeBatch(batch));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    };

    const reject = async () => {
        if (!batch) return;
        setBusy(true);
        setError('');
        try {
            setBatch(await ComputeClusterService.rejectUpgradeBatch(batch.batch_id));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    };

    const release = Object.values(manifests)[0]?.release_version;
    return <section className='ComputeUpgradePanel'>
        <header>
            <div><span>OTA</span><h3>{zh ? '一键升级节点' : 'One-confirmation node upgrade'}</h3></div>
            <p>{zh ? '一次确认整个批次，服务端自动逐台升级，关闭页面也可继续；上一台验收成功才进入下一台，失败立即停批。' : 'Confirm the batch once. The server continues even after this page closes; each node must pass health acceptance before the next starts.'}</p>
        </header>
        <ApprovalIdentityPanel zh={zh}/>
        {!batch && <>
            <label className='ComputeUpgradeManifestInput'>
                <span>{zh ? '选择签名发布清单' : 'Select signed release manifest(s)'}</span>
                <input type='file' multiple accept='.json,application/json' aria-label={zh ? '选择签名发布清单' : 'Select signed release manifests'} onChange={event => {
                    void loadManifests(event.target.files);
                    event.target.value = '';
                }}/>
                <small>{release ? `v${release} · ${Object.keys(manifests).join(' · ')}` : (zh ? 'Windows / Linux 每种平台选择对应 release.json' : 'Choose the matching release.json for each Windows / Linux platform')}</small>
            </label>
            <div className='ComputeUpgradeNodes'>
                {eligible.map(node => <label key={node.node_id}>
                    <input type='checkbox' checked={selected.includes(node.node_id)} onChange={event => setSelected(current =>
                        event.target.checked ? [...current, node.node_id] : current.filter(id => id !== node.node_id))}/>
                    <strong>{node.name}</strong><small>{node.resources.platform} · {node.resources.architecture} · v{node.agent_version}</small>
                    <span>{manifests[nodeKey(node)] ? (zh ? '清单匹配' : 'Manifest ready') : (zh ? '缺少清单' : 'Manifest missing')}</span>
                </label>)}
                {eligible.length === 0 && <p>{zh ? '没有已启用 OTA 且当前正常的节点。' : 'No normal OTA-enabled nodes.'}</p>}
            </div>
            <button type='button' disabled={busy || selected.length === 0 || selected.some(id => {
                const node = eligible.find(item => item.node_id === id);
                return !node || !manifests[nodeKey(node)];
            })} onClick={() => void start()}>{busy ? (zh ? '创建中…' : 'Creating…') : (zh ? '创建升级批次' : 'Create upgrade batch')}</button>
        </>}
        {batch && <div className='ComputeUpgradeBatch'>
            <div><strong>v{batch.release_version}</strong><span>{stateLabel(batch.state, zh)}</span><code>{batch.batch_id.slice(0, 8)}</code></div>
            {batch.nodes.map((item, index) => <article key={item.job_id} className={index === batch.current_index ? 'current' : ''}>
                <span>{index + 1}</span>
                <div><strong>{nodes.find(node => node.node_id === item.node_id)?.name || item.node_id}</strong><small>{item.manifest.platform} · {item.manifest.architecture}</small></div>
                <span>{stateLabel(item.state, zh)}</span>
                {item.error_code && <code>{item.error_code}</code>}
            </article>)}
            {batch.state === 'awaiting_authorization' && <div className='ComputeUpgradeActions'>
                <button type='button' disabled={busy} onClick={() => void approve()}>{zh ? '确认整个升级批次' : 'Approve entire batch'}</button>
                <button type='button' className='danger' disabled={busy} onClick={() => void reject()}>{zh ? '拒绝并停批' : 'Reject and stop'}</button>
            </div>}
            {['succeeded', 'failed'].includes(batch.state) && <button type='button' onClick={() => {
                localStorage.removeItem(ACTIVE_BATCH_KEY);
                setBatch(null);
            }}>{zh ? '关闭批次记录' : 'Close batch record'}</button>}
        </div>}
        {error && <p className='ComputeClusterError' role='alert'>{error}</p>}
    </section>;
};
