import React, {FormEvent, useCallback, useEffect, useRef, useState} from 'react';
import {
    ComputeClusterService,
    ComputeTerminalSession,
    ComputeTerminalTarget,
} from '../../../services/ComputeClusterService';


interface ComputeTerminalPanelProps {
    zh: boolean;
    preferredNodeId?: string;
    preferredTransport?: 'lan' | 'tailscale';
    autoConnect?: boolean;
    targetLabel?: string;
    initialCommand?: string;
    closeOnUnmount?: boolean;
    onActiveChange?: (active: boolean) => void;
}

const targetReason = (target: ComputeTerminalTarget, zh: boolean): string => {
    return target.available ? (zh ? '正常' : 'Normal') : (zh ? '故障' : 'Fault');
};

const terminalStateLabel = (session: ComputeTerminalSession | null, zh: boolean): string => {
    const state = session?.state === 'running' ? (zh ? '正常' : 'Normal') : (zh ? '故障' : 'Fault');
    if (session?.transport === 'lan') return `${zh ? '局域网 SSH' : 'LAN SSH'} · ${state}`;
    if (session?.transport === 'tailscale') return `Tailscale · ${state}`;
    return state;
};

const terminalTransportClass = (session: ComputeTerminalSession | null): string => {
    if (session?.transport === 'lan') return 'lan';
    if (session?.transport) return 'remote';
    return '';
};

// The terminal surface intentionally owns one bounded connection lifecycle.
// eslint-disable-next-line complexity
export const ComputeTerminalPanel: React.FC<ComputeTerminalPanelProps> = ({
    zh,
    preferredNodeId,
    preferredTransport,
    autoConnect = false,
    targetLabel,
    initialCommand,
    closeOnUnmount = false,
    onActiveChange,
}) => {
    const [targets, setTargets] = useState<ComputeTerminalTarget[]>([]);
    const [targetsReady, setTargetsReady] = useState(false);
    const [selectedNode, setSelectedNode] = useState('');
    const [session, setSession] = useState<ComputeTerminalSession | null>(null);
    const [output, setOutput] = useState('');
    const [command, setCommand] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const cursorRef = useRef(0);
    const sessionIdRef = useRef('');
    const outputRef = useRef<HTMLPreElement | null>(null);
    const autoConnectStartedRef = useRef(false);
    const startedHereRef = useRef(false);
    const initialCommandSessionRef = useRef('');
    const active = Boolean(session && ['connecting', 'running'].includes(session.state));

    const refreshTargets = useCallback(async (signal?: AbortSignal) => {
        try {
            const response = await ComputeClusterService.terminalTargets(signal);
            setTargets(response.targets);
            setSelectedNode(current => current
                || response.targets.find(target => target.node_id === preferredNodeId && target.available)?.node_id
                || response.targets.find(target => target.available)?.node_id
                || '');
            const activeTarget = preferredNodeId
                ? response.targets.find(target => target.node_id === preferredNodeId && target.active_session_id)
                : response.targets.find(target => target.active_session_id);
            if (activeTarget?.active_session_id && activeTarget.active_session_id !== sessionIdRef.current) {
                const restored = await ComputeClusterService.terminal(activeTarget.active_session_id, 0, signal);
                sessionIdRef.current = restored.session_id;
                cursorRef.current = restored.cursor;
                setOutput(restored.output);
                setSession(restored);
            }
            setTargetsReady(true);
            setError('');
        } catch (reason) {
            if ((reason as {name?: string})?.name !== 'AbortError') {
                setError(reason instanceof Error ? reason.message : String(reason));
            }
        }
    }, [preferredNodeId]);

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

    useEffect(() => {
        onActiveChange?.(active);
    }, [active, onActiveChange]);

    useEffect(() => () => {
        if (closeOnUnmount && sessionIdRef.current) {
            void ComputeClusterService.terminalControl(sessionIdRef.current, 'close');
        }
    }, [closeOnUnmount]);

    const connect = useCallback(async () => {
        if (!selectedNode || busy) return;
        setBusy(true);
        try {
            const next = preferredTransport
                ? await ComputeClusterService.startTerminal(selectedNode, preferredTransport)
                : await ComputeClusterService.startTerminal(selectedNode);
            cursorRef.current = next.cursor;
            sessionIdRef.current = next.session_id;
            startedHereRef.current = true;
            setOutput(next.output || '');
            setSession(next);
            if (initialCommand && next.state === 'running') {
                initialCommandSessionRef.current = next.session_id;
                await ComputeClusterService.terminalInput(next.session_id, `${initialCommand}\r`);
            }
            setError('');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    }, [busy, initialCommand, preferredTransport, selectedNode]);

    useEffect(() => {
        if (!autoConnect || autoConnectStartedRef.current || !targetsReady || !selectedNode || session) return;
        autoConnectStartedRef.current = true;
        void connect();
    }, [autoConnect, connect, selectedNode, session, targetsReady]);

    useEffect(() => {
        if (
            !initialCommand
            || !startedHereRef.current
            || session?.state !== 'running'
            || initialCommandSessionRef.current === session.session_id
        ) return;
        initialCommandSessionRef.current = session.session_id;
        void ComputeClusterService.terminalInput(session.session_id, `${initialCommand}\r`)
            .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
    }, [initialCommand, session?.session_id, session?.state]);

    const send = useCallback(async (event: FormEvent) => {
        event.preventDefault();
        const value = command.trimEnd();
        if (!session || !value || busy || session.state !== 'running') return;
        setBusy(true);
        try {
            await ComputeClusterService.terminalInput(session.session_id, `${value}\r`);
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

    return <section className='ComputeTerminalPanel'>
        <div className='ComputeTerminalHeading'>
            <div>
                <h3>{targetLabel
                    ? `${targetLabel} · ${zh ? '终端' : 'Terminal'}`
                    : (zh ? '节点终端连接' : 'Node terminal connection')}</h3>
                <p>{targetLabel
                    ? (zh
                        ? '先连接所属节点，再进入这台局域网设备；密码只在当前终端输入，不会保存。'
                        : 'Connect through the owning node, then enter this LAN device. Password input is never saved.')
                    : (zh
                        ? '连接目标与认证材料由 Mac Client 保管，不通过网页配置或接口返回；终端输出按原样展示。'
                        : 'The Mac Client owns destinations and credentials; they are never configured or returned by the web API, while terminal output is shown verbatim.')}</p>
            </div>
            <div className={`ComputeTerminalState ${session?.state === 'running' ? 'running' : 'failed'} ${terminalTransportClass(session)}`}>
                <i/><strong>{terminalStateLabel(session, zh)}</strong>
            </div>
        </div>

        <div className='ComputeTerminalToolbar'>
            <label>
                <span>{targetLabel ? (zh ? '目标设备' : 'Target device') : (zh ? '目标节点' : 'Target node')}</span>
                <select value={selectedNode} disabled={active} onChange={event => setSelectedNode(event.target.value)}>
                    <option value=''>{zh ? '选择节点' : 'Choose node'}</option>
                    {targets.map(target => <option value={target.node_id} key={target.node_id} disabled={!target.available}>
                        {targetLabel && target.node_id === selectedNode
                            ? `${targetLabel} · ${target.node_name}`
                            : `${target.node_name} · ${target.platform} · ${targetReason(target, zh)}`}
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
        <pre className='ComputeTerminalScreen' ref={outputRef} aria-label={zh ? '终端输出' : 'Terminal output'}>{output || (targetLabel
            ? (zh ? '点击“连接终端”进入设备。' : 'Select “Connect” to enter the device.')
            : (zh
                ? '选择正常节点并连接。故障节点不可选，恢复正常后会自动变为可连接。'
                : 'Choose a normal node. Fault nodes become available after returning to normal.'))}</pre>
        <form className='ComputeTerminalInput' onSubmit={event => void send(event)}>
            <span aria-hidden='true'>$</span>
            <input
                type={/(?:password|密码)[^:\n]*:\s*$/i.test(output) ? 'password' : 'text'}
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
            ? `${targetLabel ? '关闭窗口会断开这次设备终端；' : ''}会话不保存输入内容；单节点最多 1 个终端，空闲 30 分钟或运行 2 小时后自动关闭。`
            : `${targetLabel ? 'Closing this window disconnects the device terminal. ' : ''}Input is not persisted; one terminal per node, closed after 30 idle minutes or 2 hours total.`}</small>
    </section>;
};
