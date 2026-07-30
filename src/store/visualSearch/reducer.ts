import {VisualSearchAction, VisualSearchActionTypes} from './actionCreators';
import {VisualSearchJobState, VisualSearchState} from './types';

export const initialVisualSearchState: VisualSearchState = {
    jobsById: {},
    jobOrder: [],
    activeJobId: null,
};

const isTerminal = (job: VisualSearchJobState): boolean =>
    job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled';

type JobStartedAction = Extract<
    VisualSearchActionTypes,
    {type: typeof VisualSearchAction.JOB_STARTED}
>;
type JobUpdatedAction = Extract<
    VisualSearchActionTypes,
    {type: typeof VisualSearchAction.JOB_UPDATED}
>;
type JobFailedAction = Extract<
    VisualSearchActionTypes,
    {type: typeof VisualSearchAction.JOB_FAILED}
>;
type JobCancelRequestedAction = Extract<
    VisualSearchActionTypes,
    {type: typeof VisualSearchAction.JOB_CANCEL_REQUESTED}
>;
type JobCancelledAction = Extract<
    VisualSearchActionTypes,
    {type: typeof VisualSearchAction.JOB_CANCELLED}
>;
type SetActiveJobAction = Extract<
    VisualSearchActionTypes,
    {type: typeof VisualSearchAction.SET_ACTIVE_JOB}
>;
type SetSelectionAction = Extract<
    VisualSearchActionTypes,
    {type: typeof VisualSearchAction.SET_RESULT_SELECTION}
>;
type RemoveJobAction = Extract<
    VisualSearchActionTypes,
    {type: typeof VisualSearchAction.REMOVE_JOB}
>;

const reduceJobStarted = (
    state: VisualSearchState,
    action: JobStartedAction,
): VisualSearchState => {
    const {job} = action.payload;
    const alreadyExists = Boolean(state.jobsById[job.clientJobId]);
    return {
        jobsById: {...state.jobsById, [job.clientJobId]: job},
        jobOrder: alreadyExists ? state.jobOrder : [job.clientJobId, ...state.jobOrder],
        activeJobId: job.clientJobId,
    };
};

const reduceJobUpdated = (
    state: VisualSearchState,
    action: JobUpdatedAction,
): VisualSearchState => {
    const current = state.jobsById[action.payload.clientJobId];
    if (!current || isTerminal(current)) return state;
    const remote = action.payload.remoteJob;
    const resultIds = new Set(remote.result?.items.map(item => item.resultId) ?? []);
    const updated: VisualSearchJobState = {
        ...current,
        backendJobId: remote.taskId,
        status: remote.state,
        phase: remote.phase,
        progress: remote.progress,
        updatedAt: action.payload.updatedAt,
        startedAt: remote.startedAt ?? current.startedAt,
        serverUpdatedAt: remote.updatedAt ?? current.serverUpdatedAt,
        finishedAt: remote.finishedAt,
        recoveryCount: remote.recoveryCount ?? current.recoveryCount,
        cancelRequested: remote.cancelRequested ?? current.cancelRequested,
        idempotentReplay: remote.idempotentReplay ?? current.idempotentReplay,
        result: remote.result ?? current.result,
        error: remote.error,
        selectedResultIds: current.selectedResultIds.filter(id => resultIds.has(id)),
    };
    return {...state, jobsById: {...state.jobsById, [current.clientJobId]: updated}};
};

const reduceJobFailed = (
    state: VisualSearchState,
    action: JobFailedAction,
): VisualSearchState => {
    const current = state.jobsById[action.payload.clientJobId];
    if (!current || isTerminal(current)) return state;
    const updated: VisualSearchJobState = {
        ...current,
        backendJobId: action.payload.backendJobId ?? current.backendJobId,
        status: 'failed',
        phase: 'failed',
        error: action.payload.error,
        updatedAt: action.payload.updatedAt,
        finishedAt: action.payload.updatedAt,
    };
    return {...state, jobsById: {...state.jobsById, [current.clientJobId]: updated}};
};

const reduceJobCancelRequested = (
    state: VisualSearchState,
    action: JobCancelRequestedAction,
): VisualSearchState => {
    const current = state.jobsById[action.payload.clientJobId];
    if (!current || isTerminal(current)) return state;
    const updated: VisualSearchJobState = {
        ...current,
        phase: 'cancelling',
        cancelRequested: true,
        updatedAt: action.payload.updatedAt,
    };
    return {...state, jobsById: {...state.jobsById, [current.clientJobId]: updated}};
};

const reduceJobCancelled = (
    state: VisualSearchState,
    action: JobCancelledAction,
): VisualSearchState => {
    const current = state.jobsById[action.payload.clientJobId];
    if (!current || isTerminal(current)) return state;
    const updated: VisualSearchJobState = {
        ...current,
        status: 'cancelled',
        phase: 'cancelled',
        cancelRequested: true,
        updatedAt: action.payload.updatedAt,
        finishedAt: action.payload.updatedAt,
    };
    return {...state, jobsById: {...state.jobsById, [current.clientJobId]: updated}};
};

const reduceSetActiveJob = (
    state: VisualSearchState,
    action: SetActiveJobAction,
): VisualSearchState => {
    const requested = action.payload.clientJobId;
    const activeJobId = requested && state.jobsById[requested] ? requested : null;
    return {...state, activeJobId};
};

const reduceSetSelection = (
    state: VisualSearchState,
    action: SetSelectionAction,
): VisualSearchState => {
    const current = state.jobsById[action.payload.clientJobId];
    if (!current?.result) return state;
    const available = new Set(current.result.items.map(item => item.resultId));
    const selection = Array.from(new Set(action.payload.resultIds))
        .filter(id => available.has(id));
    return {
        ...state,
        jobsById: {
            ...state.jobsById,
            [current.clientJobId]: {...current, selectedResultIds: selection},
        },
    };
};

const reduceRemoveJob = (
    state: VisualSearchState,
    action: RemoveJobAction,
): VisualSearchState => {
    if (!state.jobsById[action.payload.clientJobId]) return state;
    const jobsById = {...state.jobsById};
    delete jobsById[action.payload.clientJobId];
    const jobOrder = state.jobOrder.filter(id => id !== action.payload.clientJobId);
    const activeJobId = state.activeJobId === action.payload.clientJobId
        ? jobOrder[0] ?? null
        : state.activeJobId;
    return {jobsById, jobOrder, activeJobId};
};

const reduceClearTerminalJobs = (state: VisualSearchState): VisualSearchState => {
    const retainedIds = state.jobOrder.filter(id => {
        const job = state.jobsById[id];
        return job && !isTerminal(job);
    });
    const jobsById = retainedIds.reduce<Record<string, VisualSearchJobState>>((acc, id) => {
        acc[id] = state.jobsById[id];
        return acc;
    }, {});
    const activeJobId = state.activeJobId && jobsById[state.activeJobId]
        ? state.activeJobId
        : retainedIds[0] ?? null;
    return {jobsById, jobOrder: retainedIds, activeJobId};
};

export function visualSearchReducer(
    state: VisualSearchState = initialVisualSearchState,
    action: VisualSearchActionTypes,
): VisualSearchState {
    switch (action.type) {
        case VisualSearchAction.JOB_STARTED:
            return reduceJobStarted(state, action);
        case VisualSearchAction.JOB_UPDATED:
            return reduceJobUpdated(state, action);
        case VisualSearchAction.JOB_FAILED:
            return reduceJobFailed(state, action);
        case VisualSearchAction.JOB_CANCEL_REQUESTED:
            return reduceJobCancelRequested(state, action);
        case VisualSearchAction.JOB_CANCELLED:
            return reduceJobCancelled(state, action);
        case VisualSearchAction.SET_ACTIVE_JOB:
            return reduceSetActiveJob(state, action);
        case VisualSearchAction.SET_RESULT_SELECTION:
            return reduceSetSelection(state, action);
        case VisualSearchAction.REMOVE_JOB:
            return reduceRemoveJob(state, action);
        case VisualSearchAction.CLEAR_TERMINAL_JOBS:
            return reduceClearTerminalJobs(state);
        default:
            return state;
    }
}
