import {
    VisualSearchJobState,
    VisualSearchRemoteError,
    VisualSearchRemoteJob,
    VisualSearchSnapshotMetadata,
} from './types';

export const VisualSearchAction = {
    JOB_STARTED: '@@VISUAL_SEARCH/JOB_STARTED',
    JOB_UPDATED: '@@VISUAL_SEARCH/JOB_UPDATED',
    JOB_FAILED: '@@VISUAL_SEARCH/JOB_FAILED',
    JOB_CANCEL_REQUESTED: '@@VISUAL_SEARCH/JOB_CANCEL_REQUESTED',
    JOB_CANCELLED: '@@VISUAL_SEARCH/JOB_CANCELLED',
    SET_ACTIVE_JOB: '@@VISUAL_SEARCH/SET_ACTIVE_JOB',
    SET_RESULT_SELECTION: '@@VISUAL_SEARCH/SET_RESULT_SELECTION',
    REMOVE_JOB: '@@VISUAL_SEARCH/REMOVE_JOB',
    CLEAR_TERMINAL_JOBS: '@@VISUAL_SEARCH/CLEAR_TERMINAL_JOBS',
} as const;

interface JobStartedAction {
    type: typeof VisualSearchAction.JOB_STARTED;
    payload: {job: VisualSearchJobState};
}

interface JobUpdatedAction {
    type: typeof VisualSearchAction.JOB_UPDATED;
    payload: {
        clientJobId: string;
        remoteJob: VisualSearchRemoteJob;
        updatedAt: number;
    };
}

interface JobFailedAction {
    type: typeof VisualSearchAction.JOB_FAILED;
    payload: {
        clientJobId: string;
        error: VisualSearchRemoteError;
        updatedAt: number;
        backendJobId?: string;
    };
}

interface JobCancelRequestedAction {
    type: typeof VisualSearchAction.JOB_CANCEL_REQUESTED;
    payload: {clientJobId: string; updatedAt: number};
}

interface JobCancelledAction {
    type: typeof VisualSearchAction.JOB_CANCELLED;
    payload: {clientJobId: string; updatedAt: number};
}

interface SetActiveJobAction {
    type: typeof VisualSearchAction.SET_ACTIVE_JOB;
    payload: {clientJobId: string | null};
}

interface SetResultSelectionAction {
    type: typeof VisualSearchAction.SET_RESULT_SELECTION;
    payload: {clientJobId: string; resultIds: string[]};
}

interface RemoveJobAction {
    type: typeof VisualSearchAction.REMOVE_JOB;
    payload: {clientJobId: string};
}

interface ClearTerminalJobsAction {
    type: typeof VisualSearchAction.CLEAR_TERMINAL_JOBS;
}

export type VisualSearchActionTypes =
    | JobStartedAction
    | JobUpdatedAction
    | JobFailedAction
    | JobCancelRequestedAction
    | JobCancelledAction
    | SetActiveJobAction
    | SetResultSelectionAction
    | RemoveJobAction
    | ClearTerminalJobsAction;

export const visualSearchJobStarted = (
    clientJobId: string,
    snapshot: VisualSearchSnapshotMetadata,
    now: number = Date.now(),
): JobStartedAction => ({
    type: VisualSearchAction.JOB_STARTED,
    payload: {
        job: {
            clientJobId,
            snapshot,
            status: 'submitting',
            phase: 'uploading',
            createdAt: now,
            updatedAt: now,
            recoveryCount: 0,
            cancelRequested: false,
            idempotentReplay: false,
            selectedResultIds: [],
        },
    },
});

export const visualSearchJobUpdated = (
    clientJobId: string,
    remoteJob: VisualSearchRemoteJob,
    now: number = Date.now(),
): JobUpdatedAction => ({
    type: VisualSearchAction.JOB_UPDATED,
    payload: {clientJobId, remoteJob, updatedAt: now},
});

export const visualSearchJobFailed = (
    clientJobId: string,
    error: VisualSearchRemoteError,
    now: number = Date.now(),
    backendJobId?: string,
): JobFailedAction => ({
    type: VisualSearchAction.JOB_FAILED,
    payload: {clientJobId, error, updatedAt: now, backendJobId},
});

export const visualSearchJobCancelRequested = (
    clientJobId: string,
    now: number = Date.now(),
): JobCancelRequestedAction => ({
    type: VisualSearchAction.JOB_CANCEL_REQUESTED,
    payload: {clientJobId, updatedAt: now},
});

export const visualSearchJobCancelled = (
    clientJobId: string,
    now: number = Date.now(),
): JobCancelledAction => ({
    type: VisualSearchAction.JOB_CANCELLED,
    payload: {clientJobId, updatedAt: now},
});

export const visualSearchSetActiveJob = (clientJobId: string | null): SetActiveJobAction => ({
    type: VisualSearchAction.SET_ACTIVE_JOB,
    payload: {clientJobId},
});

export const visualSearchSetResultSelection = (
    clientJobId: string,
    resultIds: string[],
): SetResultSelectionAction => ({
    type: VisualSearchAction.SET_RESULT_SELECTION,
    payload: {clientJobId, resultIds},
});

export const visualSearchRemoveJob = (clientJobId: string): RemoveJobAction => ({
    type: VisualSearchAction.REMOVE_JOB,
    payload: {clientJobId},
});

export const visualSearchClearTerminalJobs = (): ClearTerminalJobsAction => ({
    type: VisualSearchAction.CLEAR_TERMINAL_JOBS,
});
