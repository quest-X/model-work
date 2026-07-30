import type {AppState} from '..';
import {
    VisualSearchJobState,
    VisualSearchResultItem,
    VisualSearchState,
} from '../visualSearch/types';

export const selectVisualSearchState = (state: AppState): VisualSearchState =>
    state.visualSearch;

export const selectVisualSearchJobs = (state: AppState): VisualSearchJobState[] => {
    const visualSearch = selectVisualSearchState(state);
    return visualSearch.jobOrder
        .map(id => visualSearch.jobsById[id])
        .filter(Boolean);
};

export const selectActiveVisualSearchJob = (state: AppState): VisualSearchJobState | null => {
    const visualSearch = selectVisualSearchState(state);
    return visualSearch.activeJobId
        ? visualSearch.jobsById[visualSearch.activeJobId] ?? null
        : null;
};

export const selectRunningVisualSearchJobs = (state: AppState): VisualSearchJobState[] =>
    selectVisualSearchJobs(state).filter(job =>
        job.status === 'submitting' || job.status === 'queued' || job.status === 'running');

export const selectCompletedVisualSearchJobs = (state: AppState): VisualSearchJobState[] =>
    selectVisualSearchJobs(state).filter(job => job.status === 'succeeded');

export const selectSelectedVisualSearchResults = (
    state: AppState,
    clientJobId: string,
): VisualSearchResultItem[] => {
    const job = state.visualSearch.jobsById[clientJobId];
    if (!job?.result) return [];
    const selected = new Set(job.selectedResultIds);
    return job.result.items.filter(item => selected.has(item.resultId));
};

export class VisualSearchSelector {
    public static getAll(state: AppState): VisualSearchJobState[] {
        return selectVisualSearchJobs(state);
    }

    public static getActive(state: AppState): VisualSearchJobState | null {
        return selectActiveVisualSearchJob(state);
    }

    public static getRunning(state: AppState): VisualSearchJobState[] {
        return selectRunningVisualSearchJobs(state);
    }

    public static getCompleted(state: AppState): VisualSearchJobState[] {
        return selectCompletedVisualSearchJobs(state);
    }

    public static getSelectedResults(
        state: AppState,
        clientJobId: string,
    ): VisualSearchResultItem[] {
        return selectSelectedVisualSearchResults(state, clientJobId);
    }
}
