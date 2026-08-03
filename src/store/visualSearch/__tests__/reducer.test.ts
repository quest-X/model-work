import type {AppState} from '../..';
import {
    visualSearchJobStarted,
    visualSearchJobUpdated,
    visualSearchSetResultSelection,
} from '../actionCreators';
import {initialVisualSearchState, visualSearchReducer} from '../reducer';
import {VisualSearchSnapshotMetadata, VisualSearchState} from '../types';
import {
    selectActiveVisualSearchJob,
    selectRunningVisualSearchJobs,
    selectSelectedVisualSearchResults,
} from '../../selectors/VisualSearchSelector';

const metadata: VisualSearchSnapshotMetadata = {
    snapshotId: 'snapshot-1',
    capturedAt: 100,
    source: {
        imageId: 'image-1',
        fileName: 'query.jpg',
        mediaKind: 'image',
    },
    profile: {id: 'profile-1', modelRevision: 'model-rev-1'},
    target: {collection: 'collection-1', collectionRevision: 'collection-rev-1'},
    options: {topK: 10, candidateK: 20, idempotencyKey: 'snapshot-1'},
    geometry: {kind: 'image'},
    image: {
        fileName: 'query.jpg',
        mimeType: 'image/jpeg',
        size: 10,
        width: 100,
        height: 80,
    },
};

const appState = (visualSearch: VisualSearchState): AppState =>
    ({visualSearch} as AppState);

describe('visualSearchReducer and selectors', () => {
    it('retains immutable metadata while advancing a job to results', () => {
        let state = visualSearchReducer(
            initialVisualSearchState,
            visualSearchJobStarted('snapshot-1', metadata, 100),
        );
        expect(selectRunningVisualSearchJobs(appState(state))).toHaveLength(1);

        state = visualSearchReducer(state, visualSearchJobUpdated('snapshot-1', {
            taskId: 'task-1',
            state: 'succeeded',
            phase: 'completed',
            progress: 100,
            result: {
                collection: 'collection-1',
                queryKind: 'image',
                queryGeometry: {kind: 'image'},
                profileId: 'profile-1',
                modelRevision: 'model-rev-1',
                collectionRevision: 'collection-rev-1',
                executedStages: ['dino'],
                stageStatus: {dino: 'succeeded'},
                total: 2,
                elapsedMs: 30,
                items: [
                    {
                        resultId: 'result-1',
                        assetId: 'asset-1',
                        datasetId: 'dataset-1',
                        datasetRevision: 2,
                        rank: 1,
                        path: '/one.jpg',
                        fileName: 'one.jpg',
                        width: 100,
                        height: 80,
                        className: null,
                        confidence: null,
                        score: 0.9,
                        dinoScore: 0.9,
                        bbox: null,
                        thumbnail: null,
                        contentSha256: 'sha256:one',
                        regionId: null,
                        granularity: 'image',
                        regionSource: null,
                        geometrySha256: null,
                        acceptanceEligible: null,
                        acceptanceReason: null,
                        geometry: {kind: 'image'},
                    },
                    {
                        resultId: 'result-2',
                        assetId: 'asset-2',
                        datasetId: 'dataset-1',
                        datasetRevision: 2,
                        rank: 2,
                        path: '/two.jpg',
                        fileName: 'two.jpg',
                        width: 100,
                        height: 80,
                        className: null,
                        confidence: null,
                        score: 0.8,
                        dinoScore: 0.8,
                        bbox: null,
                        thumbnail: null,
                        contentSha256: 'sha256:two',
                        regionId: null,
                        granularity: 'image',
                        regionSource: null,
                        geometrySha256: null,
                        acceptanceEligible: null,
                        acceptanceReason: null,
                        geometry: {kind: 'image'},
                    },
                ],
            },
        }, 200));

        expect(selectActiveVisualSearchJob(appState(state))).toEqual(
            expect.objectContaining({
                clientJobId: 'snapshot-1',
                backendJobId: 'task-1',
                status: 'succeeded',
                snapshot: metadata,
            }),
        );

        state = visualSearchReducer(
            state,
            visualSearchSetResultSelection(
                'snapshot-1',
                ['result-2', 'missing', 'result-2'],
            ),
        );
        expect(selectSelectedVisualSearchResults(appState(state), 'snapshot-1'))
            .toEqual([expect.objectContaining({resultId: 'result-2'})]);
    });

    it('does not let late polling responses overwrite terminal state', () => {
        let state = visualSearchReducer(
            initialVisualSearchState,
            visualSearchJobStarted('snapshot-1', metadata, 100),
        );
        state = visualSearchReducer(state, visualSearchJobUpdated('snapshot-1', {
            taskId: 'task-1',
            state: 'cancelled',
            phase: 'cancelled',
        }, 200));
        const terminal = state;

        state = visualSearchReducer(state, visualSearchJobUpdated('snapshot-1', {
            taskId: 'task-1',
            state: 'succeeded',
            phase: 'completed',
        }, 300));

        expect(state).toBe(terminal);
        expect(state.jobsById['snapshot-1'].status).toBe('cancelled');
    });
});
