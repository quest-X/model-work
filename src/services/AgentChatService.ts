import {getExtensionEngineBaseUrl} from '../utils/DefaultBackendUrl';

export type AgentChatStatus = {
    status: 'ready' | 'degraded';
    auth_configured: boolean;
    llm_configured: boolean;
    primary_model: string;
};

export type AgentChatResponse = {
    conversation_id: string;
    message: string;
    model: string;
    degraded: boolean;
    tool_calls?: Array<{
        name: string;
        ok: boolean;
        result?: {
            kind?: string;
            node_name?: string;
        };
    }>;
};

export type AgentTraceTask = {
    id: string;
    kind: string;
    title: string;
    status: 'draft' | 'ready' | 'queued' | 'running' | 'succeeded' | 'completed' | 'failed' | 'cancelled';
    revision: number;
    source_message: string | null;
    result: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
};

export type AgentTraceTaskList = {
    tasks: AgentTraceTask[];
    total: number;
};

export type AgentConversation = {
    id: string;
    title: string | null;
    created_at: string;
    updated_at: string;
};

export type AgentConversationMessage = {
    id: string;
    conversation_id: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    metadata: Record<string, unknown>;
    created_at: string;
};

export type AgentConversationDetail = {
    conversation: AgentConversation;
    messages: AgentConversationMessage[];
};

const baseUrl = (): string => `${getExtensionEngineBaseUrl()}/extensions/llm-control`;

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${baseUrl()}${path}`, {
        ...init,
        headers: {
            ...(init?.body ? {'Content-Type': 'application/json'} : {}),
            ...(init?.headers || {}),
        },
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`);
    }
    return response.json();
};

export class AgentChatService {
    public static status(): Promise<AgentChatStatus> {
        return request('/status');
    }

    public static send(message: string, conversationId?: string, taskId?: string): Promise<AgentChatResponse> {
        return request('/chat', {
            method: 'POST',
            body: JSON.stringify({
                message,
                ...(conversationId ? {conversation_id: conversationId} : {}),
                ...(taskId ? {task_id: taskId} : {}),
            }),
        });
    }

    public static startTrace(message: string): Promise<AgentTraceTask> {
        return request('/tasks', {
            method: 'POST',
            body: JSON.stringify({
                kind: 'agent_request',
                title: message.slice(0, 80),
                status: 'running',
                source_message: message,
                spec: {},
            }),
        });
    }

    public static finishTrace(
        task: AgentTraceTask,
        status: 'succeeded' | 'failed',
        result: Record<string, unknown>,
    ): Promise<AgentTraceTask> {
        return request(`/tasks/${encodeURIComponent(task.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({expected_revision: task.revision, status, result}),
        });
    }

    public static tasks(limit = 200): Promise<AgentTraceTaskList> {
        return request(`/tasks?kind=agent_request&limit=${limit}`);
    }

    public static conversations(limit = 50): Promise<AgentConversation[]> {
        return request(`/conversations?limit=${limit}`);
    }

    public static conversation(conversationId: string): Promise<AgentConversationDetail> {
        return request(`/conversations/${encodeURIComponent(conversationId)}`);
    }

    public static async recordTurn(
        userContent: string,
        assistantContent: string,
        conversationId?: string,
    ): Promise<string> {
        const id = conversationId || (await request<AgentConversation>('/conversations', {
            method: 'POST',
            body: JSON.stringify({title: userContent.slice(0, 80)}),
        })).id;
        const addMessage = (role: AgentConversationMessage['role'], content: string) => request(
            `/conversations/${encodeURIComponent(id)}/messages`, {
                method: 'POST',
                body: JSON.stringify({role, content}),
            },
        );
        await addMessage('user', userContent);
        await addMessage('assistant', assistantContent);
        return id;
    }
}
