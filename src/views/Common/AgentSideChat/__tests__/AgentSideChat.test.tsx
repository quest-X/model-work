import React from 'react';
import {TextEncoder as NodeTextEncoder} from 'util';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {AgentChatService} from '../../../../services/AgentChatService';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeFilesystemAuthorization,
    ComputeTask,
} from '../../../../services/ComputeClusterService';
import {AgentChatTrigger} from '../AgentChatTrigger';
import {
    AGENT_CHAT_TOGGLE_EVENT,
    AgentSideChat,
    canonicalAuthorizationJson,
    filesystemAuthorizationChallenge,
} from '../AgentSideChat';

const filesystemAuthorization = (
    state: ComputeFilesystemAuthorization['state'] = 'pending',
): ComputeFilesystemAuthorization => ({
    version: 1,
    purpose: 'model-work-node.user-authorization.v1',
    authorization_id: 'authorization-1',
    user_id: '00000000-0000-4000-8000-000000000099',
    user_name: 'OpenSight Console User',
    user_public_key: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
    target_installation_id: 'installation-166',
    operation: 'filesystem.list',
    target: {
        kind: 'path',
        path: 'C:\\Users\\Public\\Desktop',
        source: {kind: 'known_folder', id: 'public_desktop'},
    },
    parameters: {limit: 200},
    nonce: 'a'.repeat(64),
    issued_at: Date.now() / 1000 - 1,
    expires_at: Date.now() / 1000 + 120,
    state,
    error_code: null,
    node_name: 'baoxin-166-windows',
});

const mockFilesystemCrypto = () => {
    const subtle = {
        generateKey: jest.fn().mockResolvedValue({
            privateKey: {type: 'private'},
            publicKey: {type: 'public'},
        }),
        exportKey: jest.fn().mockImplementation(async format => new Uint8Array(format === 'raw' ? 32 : 48)
            .fill(format === 'raw' ? 1 : 3).buffer),
        importKey: jest.fn().mockResolvedValue({type: 'private'}),
        sign: jest.fn().mockResolvedValue(new Uint8Array(64).fill(2).buffer),
    };
    Object.defineProperty(globalThis.crypto, 'subtle', {
        configurable: true,
        value: subtle,
    });
    return subtle;
};

const bytesToExpectedSignature = () => Buffer.from(new Uint8Array(64).fill(2)).toString('base64');

const mockDesktopAuthorizationFlow = () => {
    const subtle = mockFilesystemCrypto();
    const node = {
        node_id: 'node-166', installation_id: 'installation-166',
        name: 'baoxin-166-windows', online: true, capabilities: ['filesystem.list.v1'],
    } as ComputeClusterNode;
    jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([node]);
    jest.spyOn(AgentChatService, 'status').mockResolvedValue({
        status: 'ready', auth_configured: true, llm_configured: true, primary_model: 'Qwen3-Coder',
    });
    let challenge!: ComputeFilesystemAuthorization;
    const create = jest.spyOn(ComputeClusterService, 'createFilesystemAuthorization')
        .mockImplementation(async (_nodeId, input) => {
            challenge = {
                ...filesystemAuthorization(),
                user_id: input.user.user_id,
                user_public_key: input.user.user_public_key,
            };
            return challenge as ComputeFilesystemAuthorization & {state: 'pending'; node_name: string};
        });
    return {subtle, create, challenge: () => challenge};
};

const submitDesktopAuthorization = async () => {
    render(<AgentSideChat language={Language.CHINESE}/>);
    act(() => { window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)); });
    const composer = await screen.findByRole('textbox', {name: '发送给 Agent'});
    fireEvent.change(composer, {target: {value: '@baoxin-166-windows 查看桌面有什么'}});
    fireEvent.click(screen.getByRole('button', {name: '发送'}));
    return screen.findByRole('region', {name: '节点操作授权'});
};

describe('AgentSideChat', () => {
    let traceNumber: number;

    beforeAll(() => {
        Object.defineProperty(globalThis, 'TextEncoder', {configurable: true, value: NodeTextEncoder});
    });

    beforeEach(() => {
        sessionStorage.clear();
        traceNumber = 0;
        jest.spyOn(AgentChatService, 'startTrace').mockImplementation(async message => ({
            id: `trace-${++traceNumber}`,
            kind: 'agent_request',
            title: message,
            status: 'running',
            revision: 1,
            source_message: message,
            result: null,
            created_at: '2026-09-03T00:00:00Z',
            updated_at: '2026-09-03T00:00:00Z',
        }));
        jest.spyOn(AgentChatService, 'finishTrace').mockImplementation(async (task, status, result) => ({
            ...task,
            status,
            result,
            revision: task.revision + 1,
        }));
        jest.spyOn(AgentChatService, 'conversations').mockResolvedValue([]);
    });

    afterEach(() => jest.restoreAllMocks());

    it('opens from the global trigger and keeps one backend conversation', async () => {
        const embeddedHost = document.createElement('main');
        embeddedHost.className = 'ControlCenterWorkspace';
        document.body.appendChild(embeddedHost);
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([]);
        jest.spyOn(AgentChatService, 'status').mockResolvedValue({
            status: 'ready',
            auth_configured: true,
            llm_configured: true,
            primary_model: 'Qwen3-Coder',
        });
        const send = jest.spyOn(AgentChatService, 'send').mockResolvedValue({
            conversation_id: 'conversation-1',
            message: '当前有 2 个运行任务。\n- **状态**: running',
            model: 'Qwen3-Coder',
            degraded: false,
        });
        render(<AgentSideChat language={Language.CHINESE}/>);

        act(() => window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)));
        const dialog = await screen.findByRole('dialog', {name: 'Agent 对话'});
        expect(dialog).toBeInTheDocument();
        expect(document.body).toHaveClass('AgentChatOpen');
        expect(dialog).not.toHaveClass('expanded');
        expect(await screen.findByText(/Qwen3-Coder · 正常/)).toBeInTheDocument();
        expect(Array.from(dialog.querySelectorAll('.AgentSideChatWindowControl')).map(button => button.getAttribute('aria-label')))
            .toEqual(['扩大 Agent 对话', '最小化 Agent 对话', '关闭 Agent 对话']);
        expect(screen.getByRole('button', {name: '扩大 Agent 对话'})).toHaveTextContent('↗');

        fireEvent.click(screen.getByRole('button', {name: '最小化 Agent 对话'}));
        expect(screen.getByRole('dialog', {name: 'Agent 对话'})).toHaveClass('minimized');
        fireEvent.click(screen.getByRole('button', {name: '恢复 Agent 小窗'}));
        expect(screen.getByRole('dialog', {name: 'Agent 对话'})).not.toHaveClass('minimized');
        fireEvent.click(screen.getByRole('button', {name: '扩大 Agent 对话'}));
        const embeddedDialog = screen.getByRole('dialog', {name: 'Agent 对话'});
        expect(embeddedDialog).toHaveClass('expanded');
        expect(embeddedHost).toContainElement(embeddedDialog);
        const restoreWindow = screen.getByRole('button', {name: '恢复 Agent 小窗'});
        expect(restoreWindow).toHaveTextContent('↙');
        fireEvent.click(restoreWindow);
        expect(screen.getByRole('dialog', {name: 'Agent 对话'})).not.toHaveClass('expanded');
        fireEvent.click(screen.getByRole('button', {name: '扩大 Agent 对话'}));
        fireEvent.click(screen.getByRole('button', {name: '最小化 Agent 对话'}));
        const minimizedDialog = screen.getByRole('dialog', {name: 'Agent 对话'});
        expect(minimizedDialog).toHaveClass('minimized');
        expect(minimizedDialog).not.toHaveClass('expanded');
        expect(embeddedHost).not.toContainElement(minimizedDialog);
        fireEvent.click(screen.getByRole('button', {name: '扩大 Agent 对话'}));

        fireEvent.change(screen.getByRole('textbox', {name: '发送给 Agent'}), {
            target: {value: '汇报任务'},
        });
        fireEvent.keyDown(screen.getByRole('textbox', {name: '发送给 Agent'}), {key: 'Enter'});

        expect(await screen.findByText(/当前有 2 个运行任务。/)).not.toHaveTextContent('任务编号：trace-1');
        expect(screen.getByText('任务编号：trace-1')).toHaveClass('AgentSideChatTaskId');
        expect(screen.getByText('状态').tagName).toBe('STRONG');
        expect(screen.getByText('状态').closest('.AgentSideChatMessage')).toHaveTextContent('•状态: running');
        expect(send).toHaveBeenCalledWith('汇报任务', undefined, 'trace-1');
        await waitFor(() => expect(screen.queryByText('正在思考…')).not.toBeInTheDocument());

        send.mockResolvedValueOnce({
            conversation_id: 'conversation-1',
            message: '已继续同一个对话。',
            model: 'Qwen3-Coder',
            degraded: false,
        });
        fireEvent.change(screen.getByRole('textbox', {name: '发送给 Agent'}), {
            target: {value: '继续'},
        });
        fireEvent.click(screen.getByRole('button', {name: '发送'}));
        expect(await screen.findByText(/已继续同一个对话。/)).not.toHaveTextContent('任务编号：trace-2');
        expect(screen.getByText('任务编号：trace-2').previousElementSibling).toHaveClass('AgentSideChatMessage');
        expect(send).toHaveBeenLastCalledWith('继续', 'conversation-1', 'trace-2');

        send.mockRejectedValueOnce(new Error('LLM unavailable'));
        fireEvent.change(screen.getByRole('textbox', {name: '发送给 Agent'}), {
            target: {value: '失败也要追踪'},
        });
        fireEvent.click(screen.getByRole('button', {name: '发送'}));
        expect(await screen.findByText(/LLM unavailable/)).toHaveTextContent('任务编号：trace-3');
        await waitFor(() => expect(AgentChatService.finishTrace).toHaveBeenCalledWith(
            expect.objectContaining({id: 'trace-3'}),
            'failed',
            {error: 'LLM unavailable'},
        ));

        fireEvent.click(screen.getByRole('button', {name: '关闭 Agent 对话'}));
        expect(screen.queryByRole('dialog', {name: 'Agent 对话'})).not.toBeInTheDocument();
        expect(document.body).not.toHaveClass('AgentChatOpen');
        act(() => window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)));
        expect(await screen.findByText('有什么需要处理？')).toBeInTheDocument();
        expect(screen.queryByText(/当前有 2 个运行任务。/)).not.toBeInTheDocument();
        embeddedHost.remove();
    });

    it('treats a degraded service as Fault even when it is configured', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([]);
        jest.spyOn(AgentChatService, 'status').mockResolvedValue({
            status: 'degraded',
            auth_configured: true,
            llm_configured: true,
            primary_model: 'Qwen3-Coder',
        });
        render(<AgentSideChat language={Language.ENGLISH}/>);

        act(() => window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)));
        expect(await screen.findByText('Qwen3-Coder · Fault')).toBeInTheDocument();
    });

    it('queues messages while a request is running and sends them in order', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([]);
        jest.spyOn(AgentChatService, 'status').mockResolvedValue({
            status: 'ready',
            auth_configured: true,
            llm_configured: true,
            primary_model: 'Qwen3-Coder',
        });
        let finishFirst!: (value: Awaited<ReturnType<typeof AgentChatService.send>>) => void;
        const sendRequest = jest.spyOn(AgentChatService, 'send')
            .mockImplementationOnce(() => new Promise(resolve => {
                finishFirst = resolve;
            }))
            .mockResolvedValueOnce({
                conversation_id: 'conversation-1',
                message: '第二条完成',
                model: 'Qwen3-Coder',
                degraded: false,
            });
        render(<AgentSideChat language={Language.CHINESE}/>);

        act(() => window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)));
        const composer = await screen.findByRole('textbox', {name: '发送给 Agent'});
        fireEvent.change(composer, {target: {value: '第一条'}});
        fireEvent.click(screen.getByRole('button', {name: '发送'}));
        await waitFor(() => expect(sendRequest).toHaveBeenCalledTimes(1));

        fireEvent.change(composer, {target: {value: '第二条'}});
        const queue = screen.getByRole('button', {name: '排队'});
        expect(queue).toBeEnabled();
        fireEvent.click(queue);
        expect(screen.getByText('第二条')).toBeInTheDocument();
        expect(sendRequest).toHaveBeenCalledTimes(1);

        await act(async () => finishFirst({
            conversation_id: 'conversation-1',
            message: '第一条完成',
            model: 'Qwen3-Coder',
            degraded: false,
        }));
        expect(await screen.findByText(/第一条完成/)).toBeInTheDocument();
        await waitFor(() => expect(sendRequest).toHaveBeenCalledTimes(2));
        expect(sendRequest).toHaveBeenLastCalledWith('第二条', 'conversation-1', 'trace-2');
        expect(await screen.findByText(/第二条完成/)).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '发送'})).toBeDisabled();
    });

    it('opens history, resumes a conversation, and starts a new one', async () => {
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([]);
        jest.spyOn(AgentChatService, 'status').mockResolvedValue({
            status: 'ready',
            auth_configured: true,
            llm_configured: true,
            primary_model: 'Qwen3-Coder',
        });
        jest.mocked(AgentChatService.conversations).mockResolvedValue([{
            id: 'conversation-old',
            title: '设备巡检记录',
            created_at: '2026-09-03T00:00:00Z',
            updated_at: '2026-09-03T01:00:00Z',
        }, {
            id: 'conversation-older',
            title: '昨日巡检记录',
            created_at: '2026-09-02T00:00:00Z',
            updated_at: '2026-09-02T01:00:00Z',
        }]);
        jest.spyOn(AgentChatService, 'conversation').mockResolvedValue({
            conversation: {
                id: 'conversation-old',
                title: '设备巡检记录',
                created_at: '2026-09-03T00:00:00Z',
                updated_at: '2026-09-03T01:00:00Z',
            },
            messages: [{
                id: 'message-user',
                conversation_id: 'conversation-old',
                role: 'user',
                content: '检查节点',
                metadata: {},
                created_at: '2026-09-03T00:00:00Z',
            }, {
                id: 'message-assistant',
                conversation_id: 'conversation-old',
                role: 'assistant',
                content: '节点正常',
                metadata: {},
                created_at: '2026-09-03T00:00:01Z',
            }],
        });
        const send = jest.spyOn(AgentChatService, 'send').mockResolvedValue({
            conversation_id: 'conversation-old',
            message: '继续检查完成',
            model: 'Qwen3-Coder',
            degraded: false,
        });
        render(<AgentSideChat language={Language.CHINESE}/>);

        act(() => window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)));
        const historyButton = await screen.findByRole('button', {name: '历史记录'});
        const newConversationButton = screen.getByRole('button', {name: '新对话'});
        expect(newConversationButton).toHaveTextContent('+');
        expect(newConversationButton.querySelector('svg')).not.toBeInTheDocument();
        fireEvent.click(historyButton);
        expect(await screen.findByRole('button', {name: /设备巡检记录/})).toBeInTheDocument();
        expect(screen.getByRole('heading', {name: '2026年9月3日'})).toBeInTheDocument();
        expect(screen.getByRole('heading', {name: '2026年9月2日'})).toBeInTheDocument();
        const dateToggle = screen.getByRole('button', {name: '2026年9月3日'});
        expect(dateToggle).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(dateToggle);
        expect(screen.queryByRole('button', {name: /设备巡检记录/})).not.toBeInTheDocument();
        expect(dateToggle).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(dateToggle);
        expect(screen.getByRole('button', {name: /设备巡检记录/})).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: /设备巡检记录/}));
        expect(await screen.findByText('检查节点')).toBeInTheDocument();
        expect(screen.getByText('节点正常')).toBeInTheDocument();
        expect(screen.getByText('回复编号：message-assistant')).toHaveClass('AgentSideChatTaskId');

        fireEvent.click(screen.getByRole('button', {name: '扩大 Agent 对话'}));
        expect(await screen.findByRole('searchbox', {name: '搜索历史记录'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: /设备巡检记录/})).toBeInTheDocument();
        expect(screen.getByText('节点正常')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('searchbox', {name: '搜索历史记录'}), {
            target: {value: '不存在'},
        });
        expect(await screen.findByText('未找到匹配记录')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('searchbox', {name: '搜索历史记录'}), {
            target: {value: ''},
        });

        fireEvent.change(screen.getByRole('textbox', {name: '发送给 Agent'}), {
            target: {value: '继续检查'},
        });
        fireEvent.click(screen.getByRole('button', {name: '发送'}));
        await waitFor(() => expect(send).toHaveBeenCalledWith('继续检查', 'conversation-old', 'trace-1'));
        await screen.findByText(/继续检查完成/);

        fireEvent.click(newConversationButton);
        expect(screen.getByText('有什么需要处理？')).toBeInTheDocument();
        expect(screen.queryByText('检查节点')).not.toBeInTheDocument();
    });

    it('mentions a device and dispatches an allowlisted connectivity test', async () => {
        const node = {
            node_id: 'node-166',
            name: 'baoxin-166-windows',
            online: true,
            resources: {
                network_receive_bytes_per_second: 4 * 1024 ** 2,
                network_send_bytes_per_second: 512 * 1024,
            },
        } as ComputeClusterNode;
        const otherNode = {
            node_id: 'node-151',
            name: 'shanghai-151-linux',
            online: true,
            capabilities: ['task.network.peer_probe.v1'],
        } as ComputeClusterNode;
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([node, otherNode]);
        const submitTask = jest.spyOn(ComputeClusterService, 'submitTask').mockResolvedValue({
            task_id: 'task-1',
            state: 'queued',
        } as ComputeTask);
        jest.spyOn(ComputeClusterService, 'tasks').mockResolvedValue({
            tasks: [{
                task_id: 'task-1',
                state: 'succeeded',
                result: {
                    schema_version: 'peer-probe.console-result.v1',
                    peer_id: 'node-166',
                    transport: 'tailscale',
                    path: 'direct',
                    reachable: true,
                    ssh_reachable: true,
                    latency_ms: 12.5,
                },
            } as ComputeTask],
        } as never);
        const recordTurn = jest.spyOn(AgentChatService, 'recordTurn').mockResolvedValue('device-history');
        jest.spyOn(AgentChatService, 'status').mockResolvedValue({
            status: 'ready',
            auth_configured: true,
            llm_configured: true,
            primary_model: 'Qwen3-Coder',
        });
        render(<AgentSideChat language={Language.CHINESE}/>);

        act(() => window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)));
        const composer = await screen.findByRole('textbox', {name: '发送给 Agent'});
        fireEvent.change(composer, {target: {value: '@'}});
        const allDevicesOption = await screen.findByRole('option', {name: '@全部节点'});
        const nodeOption = await screen.findByRole('option', {name: /baoxin-166-windows/});
        expect(allDevicesOption).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(composer, {key: 'ArrowDown'});
        expect(nodeOption).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(composer, {key: 'ArrowUp'});
        expect(allDevicesOption).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(composer, {key: 'ArrowDown'});
        fireEvent.keyDown(composer, {key: 'Enter'});
        expect(composer).toHaveValue('@baoxin-166-windows ');
        expect(document.querySelector('.AgentChatSelectedNode')).toHaveTextContent('@baoxin-166-windows');
        fireEvent.change(composer, {target: {value: '@baoxin-166-windows 查'}});
        expect(screen.queryByRole('button', {name: '测试连通'})).not.toBeInTheDocument();
        expect(document.querySelector('.AgentChatSelectedNode')).toBeInTheDocument();
        fireEvent.change(composer, {target: {value: '@baoxin-166-windows '}});
        fireEvent.click(screen.getByRole('button', {name: '测试连通'}));
        expect(composer).toHaveValue('@baoxin-166-windows 测试连通');
        fireEvent.click(screen.getByRole('button', {name: '发送'}));

        expect(await screen.findByText(/@baoxin-166-windows 连通测试完成/)).toHaveTextContent('延迟：12.5 ms');
        expect(screen.getByText(/@baoxin-166-windows 连通测试完成/)).toHaveTextContent('Tailscale：正常（直连）');
        expect(screen.getByText(/@baoxin-166-windows 连通测试完成/)).toHaveTextContent('SSH：正常');
        expect(screen.getByText(/@baoxin-166-windows 连通测试完成/)).toHaveTextContent('当前下载：4.0 MB/s');
        expect(screen.getByText(/@baoxin-166-windows 连通测试完成/)).toHaveTextContent('当前上传：512 KB/s');
        expect(screen.getByText(/@baoxin-166-windows 连通测试完成/)).toHaveTextContent('执行任务编号：task-1');
        expect(screen.getByText('任务编号：trace-1').previousElementSibling).toHaveTextContent('@baoxin-166-windows 连通测试完成');
        expect(submitTask).toHaveBeenCalledWith({
            node_id: 'node-151',
            task_type: 'network.peer_probe',
            mode: 'online',
            peer_id: 'node-166',
        });
        expect(recordTurn).toHaveBeenCalledWith(
            '@baoxin-166-windows 测试连通',
            expect.stringContaining('延迟：12.5 ms'),
            undefined,
        );
    });

    it('pins an all-devices mention and sends every device snapshot to the LLM', async () => {
        const nodes = [
            {node_id: 'node-166', name: 'baoxin-166-windows', online: true},
            {node_id: 'node-151', name: 'shanghai-151-linux', online: false},
        ] as ComputeClusterNode[];
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue(nodes);
        const send = jest.spyOn(AgentChatService, 'send').mockResolvedValue({
            conversation_id: 'all-devices-conversation',
            message: '已汇总全部设备。',
            model: 'Qwen3-Coder',
            degraded: false,
        });
        jest.spyOn(AgentChatService, 'status').mockResolvedValue({
            status: 'ready',
            auth_configured: true,
            llm_configured: true,
            primary_model: 'Qwen3-Coder',
        });
        render(<AgentSideChat language={Language.CHINESE}/>);

        act(() => window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)));
        const composer = await screen.findByRole('textbox', {name: '发送给 Agent'});
        fireEvent.change(composer, {target: {value: '@'}});
        const allDevicesOption = await screen.findByRole('option', {name: '@全部节点'});
        expect(allDevicesOption).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(allDevicesOption);
        expect(composer).toHaveValue('@全部节点  ');
        fireEvent.change(composer, {target: {value: '@全部节点 汇总状态'}});
        fireEvent.click(screen.getByRole('button', {name: '发送'}));

        await screen.findByText(/已汇总全部设备。/);
        expect(send.mock.calls[0][0]).toContain('"node_id":"node-166"');
        expect(send.mock.calls[0][0]).toContain('"node_id":"node-151"');
        expect(send.mock.calls[0][0]).toContain('用户消息：@全部节点 汇总状态');
    });

    it('quick scans services and basic resources for every device', async () => {
        const nodes = [
            {
                node_id: 'node-166',
                name: 'baoxin-166-windows',
                online: true,
                capabilities: ['runtime.read.v1'],
                network: {online: false, ssh_available: true},
                network_dependencies: [],
                resources: {
                    cpu_logical: 16,
                    cpu_percent: 95,
                    load_average_1m: null,
                    memory_total_bytes: 32 * 1024 ** 3,
                    memory_available_bytes: 3.2 * 1024 ** 3,
                    disk_total_bytes: 1024 ** 4,
                    disk_free_bytes: 50 * 1024 ** 3,
                    network_receive_bytes_per_second: 4 * 1024 ** 2,
                    network_send_bytes_per_second: 1024 ** 2,
                    gpus: [{
                        index: 0,
                        uuid: 'GPU-1',
                        name: 'NVIDIA RTX 4090',
                        memory_total_mb: 24_000,
                        memory_used_mb: 23_000,
                        utilization_percent: 20,
                        temperature_celsius: 90,
                    }],
                },
            },
            {
                node_id: 'node-151',
                name: 'shanghai-151-linux',
                online: false,
                capabilities: ['runtime.read.v1'],
            },
        ] as ComputeClusterNode[];
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue(nodes);
        const runtime = jest.spyOn(ComputeClusterService, 'runtime').mockResolvedValue({
            schema_version: 'runtime.snapshot.v1',
            captured_at: 1,
            summary: {total: 2, healthy: 1, degraded: 1, unavailable: 0, task_counts: {}},
            services: [{
                service_id: 'resource-monitor',
                name: '资源监视器',
                kind: 'service',
                state: 'healthy',
                version: '1',
                uptime_seconds: 60,
                restart_count: 0,
                health: {state: 'healthy', checked_at: 1, status_code: 200, latency_ms: 1},
                process: {pid: 1, state: 'running'},
            }, {
                service_id: 'worker',
                name: '推理服务',
                kind: 'worker',
                state: 'degraded',
                version: '1',
                uptime_seconds: 60,
                restart_count: 0,
                health: {state: 'degraded', checked_at: 1, status_code: 503, latency_ms: 2},
                process: {pid: 2, state: 'running'},
            }],
        });
        const send = jest.spyOn(AgentChatService, 'send');
        const recordTurn = jest.spyOn(AgentChatService, 'recordTurn').mockResolvedValue('scan-history');
        jest.spyOn(AgentChatService, 'status').mockResolvedValue({
            status: 'ready',
            auth_configured: true,
            llm_configured: true,
            primary_model: 'Qwen3-Coder',
        });
        render(<AgentSideChat language={Language.CHINESE}/>);

        act(() => window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)));
        const composer = await screen.findByRole('textbox', {name: '发送给 Agent'});
        fireEvent.change(composer, {target: {value: '@'}});
        fireEvent.click(await screen.findByRole('option', {name: '@全部节点'}));
        fireEvent.click(screen.getByRole('button', {name: '快速扫描'}));
        expect(composer).toHaveValue('@全部节点  快速扫描');
        fireEvent.click(screen.getByRole('button', {name: '发送'}));

        const table = await screen.findByRole('table');
        expect(table).toHaveTextContent('节点服务状态CPUMEMGPUDISKNETWORK结果');
        expect(table).toHaveTextContent('baoxin-166-windows1/295%90%20% · 90°C · 显存 96%95% · 50.0 GB 可用故障');
        expect(table).toHaveTextContent('CPU 95%、内存 90%、GPU 温度 90°C、GPU 显存 96%、磁盘 95%、网络、推理服务');
        expect(table).toHaveTextContent('shanghai-151-linux——————故障：未收到节点心跳');
        expect(runtime).toHaveBeenCalledWith('node-166');
        expect(send).not.toHaveBeenCalled();
        expect(recordTurn).toHaveBeenCalledWith(
            '@全部节点 快速扫描',
            expect.stringContaining('| 节点 | 服务状态 | CPU | MEM | GPU | DISK | NETWORK | 结果 |'),
            undefined,
        );
    });

    it('runs fixed device commands and sends arbitrary device conversation to the LLM', async () => {
        const node = {
            node_id: 'node-151',
            name: 'shanghai-151-linux',
            online: true,
            heartbeat_age_seconds: 12,
            network: {online: true},
            resources: {disk_free_bytes: 1024},
        } as ComputeClusterNode;
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([node]);
        const send = jest.spyOn(AgentChatService, 'send').mockResolvedValue({
            conversation_id: 'device-conversation',
            message: '该设备当前可用磁盘空间为 1 KB。',
            model: 'Qwen3-Coder',
            degraded: false,
        });
        jest.spyOn(AgentChatService, 'recordTurn').mockResolvedValue('device-history');
        jest.spyOn(AgentChatService, 'status').mockResolvedValue({
            status: 'ready',
            auth_configured: true,
            llm_configured: true,
            primary_model: 'Qwen3-Coder',
        });
        render(<AgentSideChat language={Language.CHINESE}/>);

        act(() => window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)));
        const composer = await screen.findByRole('textbox', {name: '发送给 Agent'});
        fireEvent.change(composer, {target: {value: '@shanghai-151-linux 设备信息'}});
        fireEvent.click(screen.getByRole('button', {name: '发送'}));
        expect(await screen.findByText(/状态：正常/)).not.toHaveTextContent('任务编号：trace-1');
        expect(screen.getByText('任务编号：trace-1')).toHaveClass('AgentSideChatTaskId');
        expect(send).not.toHaveBeenCalled();

        fireEvent.change(composer, {target: {value: '@shanghai-151-linux 看下磁盘空间'}});
        fireEvent.click(screen.getByRole('button', {name: '发送'}));
        expect(await screen.findByText(/该设备当前可用磁盘空间为 1 KB。/)).not.toHaveTextContent('任务编号：trace-2');
        expect(screen.getByText('任务编号：trace-2')).toHaveClass('AgentSideChatTaskId');
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0]).toContain('@shanghai-151-linux 看下磁盘空间');
        expect(send.mock.calls[0][0]).toContain('"disk_free_bytes":1024');
    });

    it('dispatches the global OpenSight Agent trigger', () => {
        const toggled = jest.fn();
        window.addEventListener(AGENT_CHAT_TOGGLE_EVENT, toggled);
        render(<AgentChatTrigger language={Language.CHINESE}/>);

        fireEvent.click(screen.getByRole('button', {name: '打开 OpenSight Agent'}));

        expect(toggled).toHaveBeenCalledTimes(1);
        window.removeEventListener(AGENT_CHAT_TOGGLE_EVENT, toggled);
    });

    it('sorts every object level in the signed authorization JSON', () => {
        expect(canonicalAuthorizationJson({z: 1, a: {y: 2, x: 3}, m: [{b: 2, a: 1}]}))
            .toBe('{"a":{"x":3,"y":2},"m":[{"a":1,"b":2}],"z":1}');
    });

    it('retries status and node discovery when the chat is reopened', async () => {
        const status = jest.spyOn(AgentChatService, 'status')
            .mockRejectedValueOnce(new Error('status unavailable'))
            .mockResolvedValue({
                status: 'ready', auth_configured: true, llm_configured: true, primary_model: 'Qwen3-Coder',
            });
        const nodes = jest.spyOn(ComputeClusterService, 'nodes')
            .mockRejectedValueOnce(new Error('nodes unavailable'))
            .mockResolvedValue([{node_id: 'node-166', name: 'baoxin-166-windows', online: true}] as ComputeClusterNode[]);
        render(<AgentSideChat language={Language.CHINESE}/>);

        act(() => { window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)); });
        expect(await screen.findByText('故障')).toBeInTheDocument();
        const composer = screen.getByRole('textbox', {name: '发送给 Agent'});
        fireEvent.change(composer, {target: {value: '@'}});
        expect(await screen.findByText('节点列表不可用')).toBeInTheDocument();

        act(() => { window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)); });
        act(() => { window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)); });
        expect(await screen.findByText(/Qwen3-Coder · 正常/)).toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox', {name: '发送给 Agent'}), {target: {value: '@'}});
        expect(await screen.findByRole('option', {name: /baoxin-166-windows/})).toHaveTextContent('正常');
        expect(status).toHaveBeenCalledTimes(2);
        expect(nodes).toHaveBeenCalledTimes(2);
    });

    it.each([
        {
            name: '旧节点',
            online: true,
            capabilities: [],
            reason: '此节点不支持读取公共桌面（需要 filesystem.list.v1）。',
        },
        {
            name: '离线节点',
            online: false,
            capabilities: ['filesystem.list.v1'],
            reason: '节点当前故障，恢复正常后才能读取公共桌面。',
        },
    ])('blocks public-desktop access before dispatch for $name', async ({name, online, capabilities, reason}) => {
        const machine = {node_id: `${name}-id`, name, online, capabilities} as ComputeClusterNode;
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([machine]);
        const create = jest.spyOn(ComputeClusterService, 'createFilesystemAuthorization');
        jest.spyOn(AgentChatService, 'status').mockResolvedValue({
            status: 'ready', auth_configured: true, llm_configured: true, primary_model: 'Qwen3-Coder',
        });
        render(<AgentSideChat language={Language.CHINESE}/>);

        act(() => { window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)); });
        const composer = await screen.findByRole('textbox', {name: '发送给 Agent'});
        fireEvent.change(composer, {target: {value: '@'}});
        fireEvent.click(await screen.findByRole('option', {name: new RegExp(name)}));
        const action = screen.getByRole('button', {name: '查看公共桌面'});
        expect(action).toBeDisabled();
        expect(action).toHaveAttribute('title', reason);

        fireEvent.change(composer, {target: {value: `@${name} 查看公共桌面`}});
        fireEvent.click(screen.getByRole('button', {name: '发送'}));
        expect(await screen.findByText(reason)).toBeInTheDocument();
        expect(create).not.toHaveBeenCalled();
        expect(AgentChatService.startTrace).not.toHaveBeenCalled();
    });

    it('creates a normalized desktop authorization and signs only the server challenge', async () => {
        const {subtle, create, challenge: currentChallenge} = mockDesktopAuthorizationFlow();
        jest.spyOn(AgentChatService, 'send');
        let approveRequest!: (value: Awaited<ReturnType<typeof ComputeClusterService.approveFilesystemAuthorization>>) => void;
        const approve = jest.spyOn(ComputeClusterService, 'approveFilesystemAuthorization')
            .mockImplementation(() => new Promise(resolve => { approveRequest = resolve; }));
        const card = await submitDesktopAuthorization();
        const challenge = currentChallenge();

        expect(card).toHaveTextContent('baoxin-166-windows');
        expect(card).toHaveTextContent('C:\\Users\\Public\\Desktop');
        expect(card).toHaveTextContent('{"limit":200}');
        expect(card).toHaveTextContent('authorization-1');
        expect(card).toHaveTextContent('trace-1');
        expect(create).toHaveBeenCalledWith('node-166', expect.objectContaining({
            operation: 'filesystem.list',
            target: {kind: 'known_folder', id: 'public_desktop'},
            parameters: {limit: 200},
            ttl_seconds: 120,
            user: expect.objectContaining({user_name: 'OpenSight Console User'}),
        }));
        expect(AgentChatService.send).not.toHaveBeenCalled();

        const approveButton = screen.getByRole('button', {name: '批准并执行'});
        fireEvent.click(approveButton);
        expect(approveButton).toBeDisabled();
        fireEvent.click(approveButton);
        await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
        expect(subtle.sign).toHaveBeenCalledTimes(1);
        const signedPayload = Buffer.from(new Uint8Array(subtle.sign.mock.calls[0][2])).toString('utf8');
        expect(signedPayload).toBe(canonicalAuthorizationJson(filesystemAuthorizationChallenge(challenge)));

        await act(async () => approveRequest({
            authorization: {...challenge, state: 'succeeded', node_name: undefined},
            result: {
                schema_version: 'filesystem.list-result.v1',
                target: challenge.target,
                entries: [{name: 'report.txt', type: 'file', size: 7, modified_at: 1001.5}],
                total: 1,
                truncated: false,
            },
        }));
        expect(await screen.findByText('已完成')).toBeInTheDocument();
        expect(screen.getByText('report.txt')).toBeInTheDocument();
        expect(approve).toHaveBeenCalledWith('authorization-1', bytesToExpectedSignature());
        await waitFor(() => expect(AgentChatService.finishTrace).toHaveBeenCalledWith(
            expect.objectContaining({id: 'trace-1'}),
            'succeeded',
            expect.objectContaining({authorization_id: 'authorization-1'}),
        ));
    });

    it('rejects a desktop authorization once without executing it', async () => {
        const {challenge: currentChallenge} = mockDesktopAuthorizationFlow();
        const approve = jest.spyOn(ComputeClusterService, 'approveFilesystemAuthorization');
        const reject = jest.spyOn(ComputeClusterService, 'rejectFilesystemAuthorization')
            .mockImplementation(async () => ({
                ...currentChallenge(),
                state: 'rejected',
                error_code: 'authorization_rejected',
            }));
        await submitDesktopAuthorization();

        const rejectButton = screen.getByRole('button', {name: '拒绝'});
        fireEvent.click(rejectButton);
        fireEvent.click(rejectButton);

        expect(await screen.findByText('已拒绝')).toBeInTheDocument();
        expect(screen.getByText('你已拒绝本次授权，操作未执行。')).toBeInTheDocument();
        expect(reject).toHaveBeenCalledTimes(1);
        expect(approve).not.toHaveBeenCalled();
        await waitFor(() => expect(AgentChatService.finishTrace).toHaveBeenCalledWith(
            expect.objectContaining({id: 'trace-1'}),
            'failed',
            {authorization_id: 'authorization-1', error_code: 'authorization_rejected'},
        ));
    });

    it.each([
        {
            reason: 'permission_denied: node service cannot access target',
            state: '执行失败',
            message: '节点服务没有访问该路径的权限。 [permission_denied]',
            code: 'permission_denied',
        },
        {
            reason: 'authorization_not_pending: authorization is already expired',
            state: '已过期',
            message: '授权已过期，本次操作未执行。 [authorization_expired]',
            code: 'authorization_expired',
        },
        {
            reason: 'delivery_uncertain: connection was lost after authorization dispatch',
            state: '执行失败',
            message: '操作已投递到节点，但连接随后中断，执行结果不确定；请先核对节点状态，不要直接重试。 [delivery_uncertain]',
            code: 'delivery_uncertain',
        },
    ])('keeps the authorization card and classifies $code', async ({reason, state, message, code}) => {
        mockDesktopAuthorizationFlow();
        jest.spyOn(ComputeClusterService, 'approveFilesystemAuthorization').mockRejectedValue(new Error(reason));
        await submitDesktopAuthorization();

        fireEvent.click(screen.getByRole('button', {name: '批准并执行'}));

        expect(await screen.findByText(state)).toBeInTheDocument();
        expect(screen.getByText(message)).toBeInTheDocument();
        const card = screen.getByRole('region', {name: '节点操作授权'});
        expect(card).toHaveTextContent('authorization-1');
        expect(card).toHaveTextContent('trace-1');
        await waitFor(() => expect(AgentChatService.finishTrace).toHaveBeenCalledWith(
            expect.objectContaining({id: 'trace-1'}),
            'failed',
            expect.objectContaining({authorization_id: 'authorization-1', error_code: code}),
        ));
    });

    it('keeps a network-blocked authorization pending so approval can be retried', async () => {
        const {challenge: currentChallenge} = mockDesktopAuthorizationFlow();
        const approve = jest.spyOn(ComputeClusterService, 'approveFilesystemAuthorization')
            .mockRejectedValueOnce(new Error('waiting_for_network: authorization remains pending until it expires'))
            .mockImplementationOnce(async () => ({
                authorization: {...currentChallenge(), state: 'succeeded'},
                result: {
                    schema_version: 'filesystem.list-result.v1',
                    target: currentChallenge().target,
                    entries: [],
                    total: 0,
                    truncated: false,
                },
            }));
        await submitDesktopAuthorization();

        fireEvent.click(screen.getByRole('button', {name: '批准并执行'}));

        expect(await screen.findByText(
            '节点当前网络不可达，授权仍在等待；可在过期前重试批准。 [waiting_for_network]',
        )).toBeInTheDocument();
        expect(screen.getByText('等待批准')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '批准并执行'})).toBeEnabled();
        expect(AgentChatService.finishTrace).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', {name: '批准并执行'}));
        expect(await screen.findByText('已完成')).toBeInTheDocument();
        expect(approve).toHaveBeenCalledTimes(2);
    });

    it('reports a missing desktop path before showing an authorization card', async () => {
        mockFilesystemCrypto();
        const node = {
            node_id: 'node-166', installation_id: 'installation-166',
            name: 'baoxin-166-windows', online: true, capabilities: ['filesystem.list.v1'],
        } as ComputeClusterNode;
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([node]);
        jest.spyOn(AgentChatService, 'status').mockResolvedValue({
            status: 'ready', auth_configured: true, llm_configured: true, primary_model: 'Qwen3-Coder',
        });
        jest.spyOn(ComputeClusterService, 'createFilesystemAuthorization')
            .mockRejectedValue(new Error('path_not_found: filesystem target does not exist'));
        render(<AgentSideChat language={Language.CHINESE}/>);

        act(() => { window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)); });
        const composer = await screen.findByRole('textbox', {name: '发送给 Agent'});
        fireEvent.change(composer, {target: {value: '@baoxin-166-windows 查看桌面有什么'}});
        fireEvent.click(screen.getByRole('button', {name: '发送'}));

        expect(await screen.findByText(/目标路径不存在。 \[path_not_found\]/)).toBeInTheDocument();
        expect(screen.queryByRole('region', {name: '节点操作授权'})).not.toBeInTheDocument();
        await waitFor(() => expect(AgentChatService.finishTrace).toHaveBeenCalledWith(
            expect.objectContaining({id: 'trace-1'}),
            'failed',
            expect.objectContaining({error_code: 'path_not_found'}),
        ));
    });

    it('recognizes the equivalent English public-desktop command', async () => {
        mockFilesystemCrypto();
        const node = {
            node_id: 'node-166', installation_id: 'installation-166',
            name: 'baoxin-166-windows', online: true, capabilities: ['filesystem.list.v1'],
        } as ComputeClusterNode;
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([node]);
        jest.spyOn(AgentChatService, 'status').mockResolvedValue({
            status: 'ready', auth_configured: true, llm_configured: true, primary_model: 'Qwen3-Coder',
        });
        const create = jest.spyOn(ComputeClusterService, 'createFilesystemAuthorization')
            .mockImplementation(async (_nodeId, input) => ({
                ...filesystemAuthorization(),
                user_id: input.user.user_id,
                user_public_key: input.user.user_public_key,
            }));
        render(<AgentSideChat language={Language.ENGLISH}/>);

        act(() => { window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)); });
        const composer = await screen.findByRole('textbox', {name: 'Message Agent'});
        fireEvent.change(composer, {target: {value: '@baoxin-166-windows what is on the desktop'}});
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));

        expect(await screen.findByRole('region', {name: 'Node operation authorization'})).toBeInTheDocument();
        expect(create).toHaveBeenCalledWith('node-166', expect.objectContaining({
            operation: 'filesystem.list',
            target: {kind: 'known_folder', id: 'public_desktop'},
            parameters: {limit: 200},
        }));
    });

    it('keeps the signing identity only for the same browser-tab session', async () => {
        const subtle = mockFilesystemCrypto();
        const node = {
            node_id: 'node-166', installation_id: 'installation-166',
            name: 'baoxin-166-windows', online: true, capabilities: ['filesystem.list.v1'],
        } as ComputeClusterNode;
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([node]);
        jest.spyOn(AgentChatService, 'status').mockResolvedValue({
            status: 'ready', auth_configured: true, llm_configured: true, primary_model: 'Qwen3-Coder',
        });
        const users: {user_id: string; user_name: string; user_public_key: string}[] = [];
        jest.spyOn(ComputeClusterService, 'createFilesystemAuthorization')
            .mockImplementation(async (_nodeId, input) => {
                users.push(input.user);
                return {
                    ...filesystemAuthorization(),
                    user_id: input.user.user_id,
                    user_public_key: input.user.user_public_key,
                };
            });

        const first = render(<AgentSideChat language={Language.CHINESE}/>);
        act(() => { window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)); });
        let composer = await screen.findByRole('textbox', {name: '发送给 Agent'});
        fireEvent.change(composer, {target: {value: '@baoxin-166-windows 查看桌面有什么'}});
        fireEvent.click(screen.getByRole('button', {name: '发送'}));
        await screen.findByRole('region', {name: '节点操作授权'});
        const stored = JSON.parse(sessionStorage.getItem('opensight.filesystem-identity.v1') || 'null');
        expect(stored).toEqual(expect.objectContaining({version: 1, private_key: expect.any(String)}));
        expect(users[0]).not.toHaveProperty('private_key');
        first.unmount();

        render(<AgentSideChat language={Language.CHINESE}/>);
        act(() => { window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT)); });
        composer = await screen.findByRole('textbox', {name: '发送给 Agent'});
        fireEvent.change(composer, {target: {value: '@baoxin-166-windows 查看桌面有什么'}});
        fireEvent.click(screen.getByRole('button', {name: '发送'}));
        await screen.findByRole('region', {name: '节点操作授权'});

        expect(users[1]).toEqual(users[0]);
        expect(subtle.generateKey).toHaveBeenCalledTimes(1);
        expect(subtle.importKey).toHaveBeenCalledTimes(1);
    });
});
