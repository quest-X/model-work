import {Action} from '../Actions';

export type TaskPriority = 'P0' | 'P1' | 'P2';
export type TaskStatus = 'running' | 'completed' | 'error' | 'cancelled';

export enum TaskType {
    AUTO_SAVE = 'AUTO_SAVE',
    FRAME_EXTRACTION = 'FRAME_EXTRACTION',
    BATCH_DETECT = 'BATCH_DETECT',
    BATCH_SEGMENT = 'BATCH_SEGMENT',
    TRACKING = 'TRACKING',
    TRAINING = 'TRAINING',
    EXPORT = 'EXPORT',
    QUEUE_LOAD = 'QUEUE_LOAD',
    DATA_SYNC = 'DATA_SYNC',
    VISUAL_SEARCH = 'VISUAL_SEARCH',
}

export interface ManagedTask {
    id: string;
    type: TaskType;
    priority: TaskPriority;
    title: string;
    subtitle?: string;
    progress?: number; // 0..100；undefined 表示 indeterminate
    status: TaskStatus;
    startedAt: number;
    finishedAt?: number;
    cancellable: boolean;
    errorMessage?: string;
}

export interface TasksState {
    tasks: ManagedTask[];
}

interface TaskStart {
    type: typeof Action.TASK_START;
    payload: { task: ManagedTask };
}
interface TaskUpdate {
    type: typeof Action.TASK_UPDATE;
    payload: { id: string; progress?: number; subtitle?: string };
}
interface TaskComplete {
    type: typeof Action.TASK_COMPLETE;
    payload: { id: string; finishedAt: number };
}
interface TaskFail {
    type: typeof Action.TASK_FAIL;
    payload: { id: string; finishedAt: number; errorMessage: string };
}
interface TaskCancel {
    type: typeof Action.TASK_CANCEL;
    payload: { id: string; finishedAt: number };
}
interface TaskRemove {
    type: typeof Action.TASK_REMOVE;
    payload: { id: string };
}
interface TasksClearAll {
    type: typeof Action.TASKS_CLEAR_ALL;
}

export type TasksActionTypes =
    | TaskStart
    | TaskUpdate
    | TaskComplete
    | TaskFail
    | TaskCancel
    | TaskRemove
    | TasksClearAll;
