import React, {FormEvent, useCallback, useEffect, useRef, useState} from 'react';
import {
    ComputeClusterService,
    ComputeTerminalSession,
    ComputeTerminalTarget,
} from '../../../services/ComputeClusterService';


interface ComputeTerminalPanelProps {
    zh: boolean;
}

const targetReason = (target: ComputeTerminalTarget, zh: boolean): string => {
    if (target.reason === 'node_offline') return zh ? '节点离线' : 'Node offline';
    if (target.reason === 'ssh_unavailable') return zh ? 'SSH 未就绪' : 'SSH unavailable';
    return zh ? '可连接' : 'Ready';
};

// The terminal surface intentionally owns one bounded connection lifecycle.
// eslint-disable-next-line complexity
export const ComputeTerminalPanel: React.FC<ComputeTerminalPanelProps> = ({zh}) => {
    const [targets, setTargets] = useState<ComputeTerminalTarget[]>([]);
    const [selectedNode, setSelectedNode] = useState('');
    const [session, setSession] = useState<ComputeTerminalSession | null>(null);
    const [output, setOutput] = useState('');
    const [command, setCommand] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const cursorRef = useRef(0);
    const sessionIdRef = useRef('');
    const outputRef = useRef<HTMLPreElement | null>(null);

    const refreshTargets = useCallback(async (signal?: AbortSignal) => {
        try {
            const response = await ComputeClusterService.terminalTargets(signal);
            setTargets(response.targets);
            setSelectedNode(current => current || response.targets.find(target => target.available)?.node_id || '');
            const activeTarget = response.targets.find(target => target.active_session_id);
            if (activeTarget?.active_session_id && activeTarget.active_session_id !== sessionIdRef.current) {
                const restored = await ComputeClusterService.terminal(activeTarget.active_session_id, 0, signal);
                sessionIdRef.current = restored.session_id;
                cursorRef.current = restored.cursor;
                setOutput(restored.output);
                setSession(restored);
            }
            setError('');
        } catch (reason) {
            if ((reason as {name?: string})?.name !== 'AbortError') {
                setError(reason instanceof Error ? reason.message : String(reason));
            }
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void refreshTargets(controller.signal);
        const timer = window.setInterval(() => void refreshTargets(controller.signal), 5000);
        return () => {
            controller.abort();
            window.clearInterval(timer);
        };
    }, [refreshTargets]);

    useEffect(() => {
        if (!session || !['connecting', 'running'].includes(session.state)) return undefined;
        const controller = new AbortController();
        const poll = async () => {
            try {
                const next = await ComputeClusterService.terminal(
                    session.session_id,
                    cursorRef.current,
                    controller.signal,
                );
                cursorRef.current = next.cursor;
                if (next.output_truncated) setOutput(next.output);
                else if (next.output) setOutput(current => current + next.output);
                setSession(next);
                if (!['connecting', 'running'].includes(next.state)) sessionIdRef.current = '';
                if (next.error) setError(next.error);
            } catch (reason) {
                if ((reason as {name?: string})?.name !== 'AbortError') {
                    setError(reason instanceof Error ? reason.message : String(reason));
                }
            }
        };
        const timer = window.setInterval(() => void poll(), 500);
        void poll();
        return () => {
            controller.abort();
            window.clearInterval(timer);
        };
    }, [session?.session_id, session?.state]);

    useEffect(() => {
        if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }, [output]);

    const connect = useCallback(async () => {
        if (!selectedNode || busy) return;
        setBusy(true);
        try {
            const next = await ComputeClusterService.startTerminal(selectedNode);
            cursorRef.current = next.cursor;
            sessionIdRef.current = next.session_id;
            setOutput(next.output || '');
            setSession(next);
            setError('');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    }, [busy, selectedNode]);

    const send = useCallback(async (event: FormEvent) => {
        event.preventDefault();
        const value = command.trimEnd();
        if (!session || !value || busy || session.state !== 'running') return;
        setBusy(true);
        try {
            await ComputeClusterService.terminalInput(session.session_id, `${value}\n`);
            setCommand('');
            setError('');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    }, [busy, command, session]);

    const control = useCallback(async (action: 'interrupt' | 'close') => {
        if (!session || busy) return;
        setBusy(true);
        try {
            const next = await ComputeClusterService.terminalControl(session.session_id, action);
            setSession(next);
            if (action === 'close') sessionIdRef.current = '';
            setError(next.error || '');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    }, [busy, session]);

    const active = session && ['connecting', 'running'].includes(session.state);
    return <section className='ComputeTerminalPanel'>
        <div className='ComputeTerminalHeading'>
            <div>
                <span>{zh ? '阶段 8 · 受控 SSH' : 'Phase 8 · Controlled SSH'}</span>
                <h3>{zh ? '节点终端连接' : 'Node terminal connection'}</h3>
                <p>{zh
                    ? '连接目标与认证材料由 Mac Client 保管，不通过网页配置或接口返回；终端输出按原样展示。'
                    : 'The Mac Client owns destinations and credentials; they are never configured or returned by the web API, while terminal output is shown verbatim.'}</p>
            </div>
            <div className={`ComputeTerminalState ${session?.state || 'idle'}`}>
                <i/><strong>{session
                    ? session.state === 'running' ? (zh ? '已连接' : 'Connected')
                        : session.state === 'connecting' ? (zh ? '连接中' : 'Connecting')
                            : session.state === 'failed' ? (zh ? '连接失败' : 'Failed')
                                : (zh ? '已断开' : 'Closed')
                    : (zh ? '未连接' : 'Disconnected')}</strong>
            </div>
        </div>

        <div className='ComputeTerminalToolbar'>
            <label>
                <span>{zh ? '目标节点' : 'Target node'}</span>
                <select value={selectedNode} disabled={Boolean(active)} onChange={event => setSelectedNode(event.target.value)}>
                    <option value=''>{zh ? '选择节点' : 'Choose node'}</option>
                    {targets.map(target => <option value={target.node_id} key={target.node_id} disabled={!target.available}>
                        {target.node_name} · {target.platform} · {targetReason(target, zh)}
                    </option>)}
                </select>
            </label>
            {!active && <button type='button' disabled={!selectedNode || busy} onClick={() => void connect()}>{zh ? '连接终端' : 'Connect'}</button>}
            {active && <>
                <button type='button' disabled={busy || session?.state !== 'running'} onClick={() => void control('interrupt')}>Ctrl+C</button>
                <button type='button' className='danger' disabled={busy} onClick={() => void control('close')}>{zh ? '断开' : 'Disconnect'}</button>
            </>}
        </div>

        {error && <div className='ComputeTerminalError' role='alert'>{error}</div>}
        <pre className='ComputeTerminalScreen' ref={outputRef} aria-label={zh ? '终端输出' : 'Terminal output'}>{output || (zh
            ? '选择在线节点并连接。山东节点离线时不可选，恢复在线后会自动变为可连接。'
            : 'Choose an online node. Offline nodes become available automatically after reconnecting.')}</pre>
        <form className='ComputeTerminalInput' onSubmit={event => void send(event)}>
            <span aria-hidden='true'>$</span>
            <input
                aria-label={zh ? '终端指令' : 'Terminal command'}
                value={command}
                disabled={!session || session.state !== 'running' || busy}
                autoComplete='off'
                spellCheck={false}
                placeholder={zh ? '输入指令后按 Enter' : 'Type a command and press Enter'}
                onChange={event => setCommand(event.target.value)}
            />
            <button type='submit' disabled={!session || session.state !== 'running' || !command.trim() || busy}>{zh ? '发送' : 'Send'}</button>
        </form>
        <small className='ComputeTerminalBoundary'>{zh
            ? '会话不保存输入内容；单节点最多 1 个终端，空闲 30 分钟或运行 2 小时后自动关闭。'
            : 'Input is not persisted; one terminal per node, closed after 30 idle minutes or 2 hours total.'}</small>
    </section>;
};
