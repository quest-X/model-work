import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {LabelStatus} from '../../../../data/enums/LabelStatus';
import {
    QuerySnapshotDependencies,
    QuerySnapshotInput,
    QuerySnapshotService,
} from '../../../../services/QuerySnapshotService';
import {ImageData} from '../../../../store/labels/types';
import {
    VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
    VisualSearchJobState,
    VisualSearchResultItem,
    VisualSearchSnapshotMetadata,
} from '../../../../store/visualSearch/types';
import {VideoData} from '../../../../store/video/types';
import {QueueItemStatus, QueueItemType} from '../../../../store/queue/types';
import {VisualSearchCollection} from '../VisualSearchCatalog';
import {
    ResolvedVisualSearchSource,
    resolveVisualSearchSource,
    VisualSearchPopup,
} from '../VisualSearchPopup';

jest.mock('../../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));

jest.mock('../../../../services/VisualSearchJobService', () => ({
    VisualSearchJobService: jest.fn(),
    visualSearchJobService: {
        start: jest.fn(),
        cancelByClientJobId: jest.fn(),
    },
}));

jest.mock('../../../../services/VisualSearchAcceptanceService', () => ({
    VisualSearchAcceptanceService: jest.fn(),
    visualSearchAcceptanceService: {accept: jest.fn()},
    visualSearchAcceptedRectId: (taskId: string, resultId: string) =>
        `visual-search:${taskId}:${resultId}`,
    visualSearchAcceptedMaskPolygonId: (
        taskId: string,
        resultId: string,
        index: number,
    ) => `visual-search:${taskId}:${resultId}:mask:${index}`,
}));

jest.mock('../../../../services/FrameExtractorService', () => ({
    FrameExtractorService: {fetchFrameRange: jest.fn()},
}));

jest.mock('../../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({
        title,
        renderContent,
        rejectLabel,
        onReject,
    }: {
        title: React.ReactNode;
        renderContent: () => React.ReactNode;
        rejectLabel: string;
        onReject: () => void;
    }) => <div>
        <h1>{title}</h1>
        {renderContent()}
        <button type='button' onClick={onReject}>{rejectLabel}</button>
    </div>,
}));

const activeImage = (selected: 'rect' | 'polygon' | 'none' = 'none'): ImageData => ({
    id: 'image-1',
    fileData: new File(['source-pixels'], 'source.png', {type: 'image/png'}),
    loadStatus: true,
    labelRects: selected === 'rect' ? [{
        id: 'rect-1',
        labelId: 'scratch',
        isVisible: true,
        rect: {x: 10, y: 20, width: 30, height: 40},
        isCreatedByAI: false,
        status: LabelStatus.ACCEPTED,
        suggestedLabel: '',
    }] : [],
    labelPoints: [],
    labelLines: [],
    labelPolygons: selected === 'polygon' ? [{
        id: 'polygon-1',
        labelId: 'scratch',
        isVisible: true,
        vertices: [{x: 3, y: 4}, {x: 50, y: 4}, {x: 50, y: 60}],
        isCreatedByAI: false,
        status: LabelStatus.ACCEPTED,
        suggestedLabel: '',
    }] : [],
    labelNameIds: [],
    isVisitedByRoboflowAPI: false,
});

const collection = (
    granularity: 'image' | 'bbox' | 'mask',
    name: string = `scene/${granularity}/v1`,
): VisualSearchCollection => ({
    name,
    displayName: name,
    sceneName: 'Line A',
    targetName: granularity === 'bbox'
        ? 'Scratch boxes'
        : granularity === 'mask' ? 'Scratch masks' : 'Full images',
    version: 1,
    granularity,
    count: 25,
    profileId: `profile-${granularity}`,
    modelName: 'dinov3_vits16',
    modelRevision: null,
    collectionRevision: null,
    datasetId: 'dataset-without-revision',
    datasetRevision: null,
    compatible: true,
    compatibilityReason: null,
});

const source = (): ResolvedVisualSearchSource => ({
    blob: new Blob(['source-pixels'], {type: 'image/png'}),
    previewUrl: 'blob:visual-search-source',
    width: 100,
    height: 80,
    release: jest.fn(),
});

const video = (currentFrame: number): VideoData => ({
    id: 'video-1',
    fileData: new File(['video'], 'clip.mp4', {type: 'video/mp4'}),
    loadStatus: true,
    duration: 10,
    fps: 30,
    totalFrames: 300,
    videoSize: {width: 100, height: 80},
    currentFrame,
    currentTime: currentFrame / 30,
    isPlaying: false,
    frames: new Map(),
});

const metadata = (
    kind: 'image' | 'bbox' | 'mask' = 'image',
): VisualSearchSnapshotMetadata => ({
    snapshotId: `snapshot-${kind}`,
    capturedAt: 100,
    source: {
        imageId: 'image-1',
        fileName: 'source.png',
        mediaKind: 'image',
    },
    profile: {id: `profile-${kind}`, modelRevision: null},
    target: {collection: `scene/${kind}/v1`, collectionRevision: null},
    options: {topK: 12, candidateK: 48, idempotencyKey: `snapshot-${kind}`},
    geometry: kind === 'bbox'
        ? {kind: 'bbox', bbox: [10, 20, 40, 60]}
        : kind === 'mask'
            ? {
                kind: 'mask',
                polygons: [[[10, 20], [30, 20], [30, 40], [10, 40]]],
                bbox: [10, 20, 30, 40],
                maskFileName: 'snapshot-mask.png',
                rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
            }
            : {kind: 'image'},
    image: {
        fileName: 'source.png',
        mimeType: 'image/png',
        size: 13,
        width: 100,
        height: 80,
    },
});

const bboxResult = (
    resultId: string,
    fileName: string,
    score: number,
): VisualSearchResultItem => ({
    resultId,
    assetId: `asset-${resultId}`,
    datasetId: 'dataset-1',
    datasetRevision: 7,
    rank: 1,
    path: `/dataset/${fileName}`,
    fileName,
    width: 100,
    height: 80,
    className: 'goose',
    confidence: 0.8,
    score,
    dinoScore: score,
    bbox: [2, 3, 20, 30],
    thumbnail: null,
    contentSha256: 'a'.repeat(64),
    regionId: `region-${resultId}`,
    granularity: 'bbox',
    regionSource: 'dataset',
    geometrySha256: null,
    acceptanceEligible: null,
    acceptanceReason: null,
    geometry: {kind: 'bbox', bbox: [2, 3, 20, 30]},
});

const completedBBoxJob = (): VisualSearchJobState => ({
    clientJobId: 'completed-bbox-job',
    backendJobId: 'task-bbox',
    snapshot: metadata('bbox'),
    status: 'succeeded',
    phase: 'succeeded',
    createdAt: 100,
    updatedAt: 120,
    finishedAt: 120,
    recoveryCount: 0,
    cancelRequested: false,
    idempotentReplay: false,
    selectedResultIds: [],
    result: {
        collection: 'scene/bbox/v1',
        queryKind: 'bbox',
        queryGeometry: {kind: 'bbox', bbox: [2, 3, 20, 30]},
        profileId: 'profile-bbox',
        modelRevision: 'model-bbox-1',
        collectionRevision: 'collection-bbox-1',
        executedStages: ['dino'],
        stageStatus: {dino: 'succeeded'},
        total: 1,
        elapsedMs: 9,
        items: [bboxResult('result-1', 'first.jpg', 0.91)],
    },
});

const baseProps = () => ({
    language: Language.ENGLISH,
    activeImage: activeImage(),
    activeImageIndex: 0,
    activeLabelId: null,
    activeQueueItem: null,
    isVideoMode: false,
    activeVideo: null,
    jobs: [] as VisualSearchJobState[],
    activeJobId: null,
    acceptedRectIds: [],
    acceptedPolygonIds: [],
    selectJob: jest.fn(),
    collectionLoader: jest.fn().mockResolvedValue([collection('image')]),
    sourceResolver: jest.fn().mockResolvedValue(source()),
    snapshotCapture: jest.fn((
        input: QuerySnapshotInput,
        dependencies: QuerySnapshotDependencies = {},
    ) => QuerySnapshotService.capture(input, {
        ...dependencies,
        createId: () => 'snapshot-test',
        now: () => 100,
        encodeMask: async () => new Blob(['mask-png'], {type: 'image/png'}),
    })),
    jobRunner: {
        start: jest.fn().mockReturnValue({
            clientJobId: 'snapshot-test',
            done: Promise.resolve({
                taskId: 'task-1',
                state: 'queued',
                phase: 'queued',
            }),
            cancel: jest.fn().mockResolvedValue(undefined),
        }),
        cancelByClientJobId: jest.fn().mockResolvedValue(undefined),
    },
    acceptanceRunner: {accept: jest.fn().mockResolvedValue({
        imageId: 'target-image',
        labelRectId: 'visual-search:task-1:result-1',
    })},
    seedGraphRunner: {
        create: jest.fn(),
        expand: jest.fn(),
    },
    onClose: jest.fn(),
});

describe('VisualSearchPopup', () => {
    it('promotes trusted bbox results and renders newly discovered evidence', async () => {
        const props = baseProps();
        props.activeImage = activeImage('rect');
        props.activeLabelId = 'rect-1';
        props.collectionLoader.mockResolvedValue([collection('bbox')]);
        props.jobs = [completedBBoxJob()];
        props.activeJobId = 'completed-bbox-job';
        const initialGraph = {
            graphId: 'seedgraph-one',
            rootTaskId: 'task-bbox',
            collection: 'scene/bbox/v1',
            queryKind: 'bbox' as const,
            profileId: 'profile-bbox',
            collectionRevision: 'collection-bbox-1',
            topK: 12,
            candidateK: 48,
            generation: 0,
            seeds: [{
                seedId: 'seed_root',
                parentSeedId: null,
                resultId: null,
                polarity: 'positive' as const,
                trust: 1,
                generation: 0,
            }],
            candidates: [{
                resultId: 'result-1',
                item: bboxResult('result-1', 'first.jpg', 0.91),
                positiveScore: 0.91,
                negativeScore: 0,
                fusedScore: 0.91,
                discoveredBy: ['seed_root'],
                firstGeneration: 0,
                status: 'candidate' as const,
            }],
            createdAt: '2026-08-04T00:00:00Z',
            updatedAt: '2026-08-04T00:00:00Z',
        };
        props.seedGraphRunner.create.mockResolvedValue(initialGraph);
        props.seedGraphRunner.expand.mockResolvedValue({
            ...initialGraph,
            generation: 1,
            seeds: [
                ...initialGraph.seeds,
                {
                    seedId: 'seed-positive-1',
                    parentSeedId: 'seed_root',
                    resultId: 'result-1',
                    polarity: 'positive' as const,
                    trust: 0.9,
                    generation: 1,
                },
            ],
            candidates: [
                {...initialGraph.candidates[0], status: 'accepted' as const},
                {
                    resultId: 'result-2',
                    item: bboxResult('result-2', 'discovered.jpg', 0.86),
                    positiveScore: 0.774,
                    negativeScore: 0,
                    fusedScore: 0.774,
                    discoveredBy: ['seed-positive-1'],
                    firstGeneration: 1,
                    status: 'candidate' as const,
                },
            ],
        });

        render(<VisualSearchPopup {...props}/>);
        fireEvent.click(await screen.findByRole('button', {name: 'Start seed graph'}));
        fireEvent.click(await screen.findByRole('button', {name: 'Use as seed'}));
        fireEvent.click(screen.getByRole('button', {name: 'Expand with 1 decision(s)'}));

        await waitFor(() => expect(props.seedGraphRunner.expand).toHaveBeenCalledWith(
            'seedgraph-one',
            {
                acceptResultIds: ['result-1'],
                rejectResultIds: [],
                candidateK: 48,
            },
        ));
        expect(await screen.findByText('discovered.jpg')).toBeInTheDocument();
        expect(screen.getByText('Generation 1 · 2 candidates')).toBeInTheDocument();
        expect(screen.getByRole('tree', {name: 'Seed propagation tree'})).toBeInTheDocument();
    });

    it('refuses to mix a moving raw-video frame with frozen frame metadata', async () => {
        await expect(resolveVisualSearchSource({
            activeImage: activeImage(),
            activeImageIndex: 7,
            isVideoMode: true,
            activeVideo: {...video(7), isPlaying: true},
        })).rejects.toThrow('Pause the video');
    });

    it('freezes the selected bbox and exact nullable profile/version binding before submit', async () => {
        const props = baseProps();
        props.activeImage = activeImage('rect');
        props.activeLabelId = 'rect-1';
        props.collectionLoader.mockResolvedValue([
            collection('image', 'scene/images/v1'),
            collection('bbox', 'scene/boxes/v2'),
        ]);
        render(<VisualSearchPopup {...props}/>);

        const submit = screen.getByTestId('submit-visual-search');
        await waitFor(() => expect(submit).toBeEnabled());
        expect(screen.getByTestId('visual-search-query-overlay')).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toHaveValue('scene/boxes/v2');
        fireEvent.change(screen.getByLabelText('Top-K'), {target: {value: '100'}});

        await act(async () => {
            fireEvent.click(submit);
        });
        await waitFor(() => expect(props.snapshotCapture).toHaveBeenCalledTimes(1));
        const input = props.snapshotCapture.mock.calls[0][0] as QuerySnapshotInput;
        expect(input.geometry).toEqual({kind: 'bbox', bbox: [10, 20, 40, 60]});
        expect(input.profile).toEqual({id: 'profile-bbox', modelRevision: null});
        expect(input.options).toEqual(expect.objectContaining({
            topK: 100,
            candidateK: 100,
        }));
        expect(input.target).toEqual({
            collection: 'scene/boxes/v2',
            collectionRevision: null,
        });
        expect(props.jobRunner.start).toHaveBeenCalledWith(
            expect.objectContaining({
                profile: {id: 'profile-bbox', modelRevision: null},
                target: {
                    collection: 'scene/boxes/v2',
                    collectionRevision: null,
                },
                geometry: {kind: 'bbox', bbox: [10, 20, 40, 60]},
            }),
            expect.objectContaining({subtitle: expect.stringContaining('BBox')}),
        );
        expect(props.selectJob).toHaveBeenCalledWith('snapshot-test');
    });

    it('submits polygon masks only to a populated compatible mask collection', async () => {
        const props = baseProps();
        props.activeImage = activeImage('polygon');
        props.activeLabelId = 'polygon-1';
        props.collectionLoader.mockResolvedValue([
            collection('image'),
            collection('bbox'),
            collection('mask', 'scene/masks/v1'),
        ]);
        render(<VisualSearchPopup {...props}/>);

        expect(await screen.findByText('Strict mask search')).toBeInTheDocument();
        expect(screen.getByText(/must contain real mask RLE/)).toBeInTheDocument();
        expect(await screen.findByTestId('visual-search-query-overlay')).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toHaveValue('scene/masks/v1');
        expect(screen.getByTestId('submit-visual-search')).toBeEnabled();
        await act(async () => fireEvent.click(screen.getByTestId('submit-visual-search')));
        await waitFor(() => expect(props.snapshotCapture).toHaveBeenCalledTimes(1));
        const input = props.snapshotCapture.mock.calls[0][0] as QuerySnapshotInput;
        expect(input.geometry).toEqual({
            kind: 'mask',
            polygons: [[[3, 4], [50, 4], [50, 60]]],
        });
        expect(input.target.collection).toBe('scene/masks/v1');
        expect(props.jobRunner.start).toHaveBeenCalledWith(
            expect.objectContaining({
                geometry: expect.objectContaining({kind: 'mask'}),
                maskFile: expect.any(File),
            }),
            expect.objectContaining({subtitle: expect.stringContaining('Mask')}),
        );
    });

    it('freezes one video frame context while later editor state advances', async () => {
        const props = baseProps();
        const frameImage = {
            ...activeImage(),
            id: 'frame-image-7',
            fileData: new File(['video'], 'clip.mp4', {type: 'video/mp4'}),
        };
        props.activeImage = frameImage;
        props.activeImageIndex = 7;
        props.isVideoMode = true;
        props.activeVideo = video(7);
        const view = render(<VisualSearchPopup {...props}/>);

        const submit = screen.getByTestId('submit-visual-search');
        await waitFor(() => expect(submit).toBeEnabled());
        view.rerender(<VisualSearchPopup
            {...props}
            activeImage={{...frameImage, id: 'frame-image-8'}}
            activeImageIndex={8}
            activeVideo={video(8)}
        />);
        await act(async () => {
            fireEvent.click(submit);
        });

        const input = props.snapshotCapture.mock.calls[0][0] as QuerySnapshotInput;
        expect(input.source).toEqual(expect.objectContaining({
            imageId: 'frame-image-7',
            fileName: 'frame_000007.png',
            mediaKind: 'frame',
            frameIndex: 7,
        }));
        expect(props.sourceResolver).toHaveBeenCalledTimes(1);
    });

    it('cancels only on the explicit cancel action, never when the popup closes', async () => {
        const props = baseProps();
        props.jobs = [{
            clientJobId: 'running-job',
            snapshot: metadata('image'),
            status: 'running',
            phase: 'retrieving',
            progress: 40,
            createdAt: 100,
            updatedAt: 110,
            recoveryCount: 0,
            cancelRequested: false,
            idempotentReplay: false,
            selectedResultIds: [],
        }];
        props.activeJobId = 'running-job';
        render(<VisualSearchPopup {...props}/>);
        await screen.findByText('100 × 80');

        fireEvent.click(screen.getByText('Close (task continues)'));
        expect(props.onClose).toHaveBeenCalledTimes(1);
        expect(props.jobRunner.cancelByClientJobId).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', {name: 'Cancel task'}));
        expect(props.jobRunner.cancelByClientJobId).toHaveBeenCalledWith('running-job');
    });

    it('renders legacy results as preview-only when asset identity or size is missing', async () => {
        const props = baseProps();
        props.jobs = [{
            clientJobId: 'completed-job',
            backendJobId: 'task-1',
            snapshot: metadata('bbox'),
            status: 'succeeded',
            phase: 'succeeded',
            createdAt: 100,
            updatedAt: 120,
            finishedAt: 120,
            recoveryCount: 0,
            cancelRequested: false,
            idempotentReplay: false,
            selectedResultIds: [],
            result: {
                collection: 'scene/bbox/v1',
                queryKind: 'bbox',
                queryGeometry: {kind: 'bbox', bbox: [2, 3, 20, 30]},
                profileId: 'profile-bbox',
                modelRevision: 'server-pinned-revision',
                collectionRevision: 'server-pinned-collection',
                executedStages: ['dino'],
                stageStatus: {dino: 'succeeded'},
                total: 1,
                elapsedMs: 9,
                items: [{
                    resultId: 'legacy-result-1',
                    assetId: null,
                    datasetId: null,
                    datasetRevision: null,
                    rank: 1,
                    path: '/legacy/result.jpg',
                    fileName: 'result.jpg',
                    width: 100,
                    height: 80,
                    className: null,
                    confidence: null,
                    score: 0.91,
                    dinoScore: 0.91,
                    bbox: [2, 3, 20, 30],
                    thumbnail: 'data:image/jpeg;base64,cHJldmlldw==',
                    contentSha256: null,
                    regionId: null,
                    granularity: 'bbox',
                    regionSource: null,
                    geometrySha256: null,
                    acceptanceEligible: null,
                    acceptanceReason: null,
                    geometry: {kind: 'bbox', bbox: [2, 3, 20, 30]},
                }],
            },
        }];
        props.activeJobId = 'completed-job';
        render(<VisualSearchPopup {...props}/>);
        await screen.findByText('100 × 80');

        expect(screen.getByText(
            'Legacy index lacks asset identity or dimensions; preview only',
        )).toBeInTheDocument();
        expect(screen.getByRole('img', {name: 'result.jpg'})).toHaveAttribute(
            'src',
            'data:image/jpeg;base64,cHJldmlldw==',
        );
        expect(screen.queryByTestId('visual-search-result-crop')).not.toBeInTheDocument();
        expect(screen.getByText(
            /Only bbox → bbox can be accepted atomically/,
        )).toBeInTheDocument();
        expect(screen.queryByText('Accept')).not.toBeInTheDocument();
    });

    it('offers bbox acceptance only for an exact active dataset revision', async () => {
        const props = baseProps();
        props.activeQueueItem = {
            id: 'queue-1',
            name: 'target',
            type: QueueItemType.IMAGE,
            file: new File(['target'], 'result.jpg', {type: 'image/jpeg'}),
            status: QueueItemStatus.COMPLETED,
            uploadedAt: 100,
            datasetId: 'dataset-1',
            datasetRevision: 7,
        };
        props.acceptanceRunner = {accept: jest.fn().mockResolvedValue({
            imageId: 'target-image',
            labelRectId: 'visual-search:task-1:result-1',
        })};
        const snapshot = metadata('bbox');
        snapshot.target = {
            ...snapshot.target,
            datasetId: 'dataset-1',
            datasetRevision: 7,
        };
        props.jobs = [{
            clientJobId: 'completed-job',
            backendJobId: 'task-1',
            snapshot,
            status: 'succeeded',
            phase: 'succeeded',
            createdAt: 100,
            updatedAt: 120,
            finishedAt: 120,
            recoveryCount: 0,
            cancelRequested: false,
            idempotentReplay: false,
            selectedResultIds: [],
            result: {
                collection: 'scene/bbox/v1',
                queryKind: 'bbox',
                queryGeometry: {kind: 'bbox', bbox: [2, 3, 20, 30]},
                profileId: 'profile-bbox',
                modelRevision: 'server-pinned-revision',
                collectionRevision: 'server-pinned-collection',
                executedStages: ['dino'],
                stageStatus: {dino: 'succeeded'},
                total: 1,
                elapsedMs: 9,
                items: [{
                    resultId: 'result-1',
                    assetId: `sha256:${'a'.repeat(64)}`,
                    datasetId: 'dataset-1',
                    datasetRevision: 7,
                    rank: 1,
                    path: '/dataset/result.jpg',
                    fileName: 'result.jpg',
                    width: 100,
                    height: 80,
                    className: 'goose',
                    confidence: 0.8,
                    score: 0.91,
                    dinoScore: 0.91,
                    bbox: [2, 3, 20, 30],
                    thumbnail: null,
                    contentSha256: 'a'.repeat(64),
                    regionId: 'region-1',
                    granularity: 'bbox',
                    regionSource: 'dataset',
                    geometrySha256: null,
                    acceptanceEligible: null,
                    acceptanceReason: null,
                    geometry: {kind: 'bbox', bbox: [2, 3, 20, 30]},
                }],
            },
        }];
        props.activeJobId = 'completed-job';
        render(<VisualSearchPopup {...props}/>);
        await screen.findByText('100 × 80');

        fireEvent.click(screen.getByRole('button', {name: 'Accept bbox'}));

        await waitFor(() => expect(props.acceptanceRunner.accept).toHaveBeenCalledWith(
            'completed-job',
            'result-1',
        ));
        expect(await screen.findByRole('button', {name: 'Accepted'})).toBeDisabled();
    });

    it('previews full-image mask thumbnails in source coordinates and accepts the mask', async () => {
        const props = baseProps();
        props.activeQueueItem = {
            id: 'queue-1',
            name: 'target',
            type: QueueItemType.IMAGE,
            file: new File(['target'], 'result.jpg', {type: 'image/jpeg'}),
            status: QueueItemStatus.COMPLETED,
            uploadedAt: 100,
            datasetId: 'dataset-1',
            datasetRevision: 7,
        };
        const snapshot = metadata('mask');
        snapshot.target = {...snapshot.target, datasetId: 'dataset-1', datasetRevision: 7};
        props.acceptanceRunner = {accept: jest.fn().mockResolvedValue({
            imageId: 'target-image',
            labelPolygonIds: ['visual-search:task-mask:mask-result:mask:0'],
        })};
        props.jobs = [{
            clientJobId: 'completed-mask-job',
            backendJobId: 'task-mask',
            snapshot,
            status: 'succeeded',
            phase: 'succeeded',
            createdAt: 100,
            updatedAt: 120,
            finishedAt: 120,
            recoveryCount: 0,
            cancelRequested: false,
            idempotentReplay: false,
            selectedResultIds: [],
            result: {
                collection: 'scene/mask/v1',
                queryKind: 'mask',
                queryGeometry: {kind: 'mask', bbox: [10, 20, 31, 41]},
                profileId: 'profile-mask',
                modelRevision: 'model-mask-1',
                collectionRevision: 'collection-mask-1',
                executedStages: ['dino'],
                stageStatus: {dino: 'succeeded'},
                total: 1,
                elapsedMs: 9,
                items: [{
                    resultId: 'mask-result',
                    assetId: '0123456789abcdef0123456789abcdef',
                    datasetId: 'dataset-1',
                    datasetRevision: 7,
                    rank: 1,
                    path: '/dataset/result.jpg',
                    fileName: 'result.jpg',
                    width: 100,
                    height: 80,
                    className: 'goose',
                    confidence: 0.8,
                    score: 0.91,
                    dinoScore: 0.91,
                    bbox: [10, 20, 31, 41],
                    thumbnail: 'data:image/jpeg;base64,cHJldmlldw==',
                    contentSha256: 'a'.repeat(64),
                    regionId: 'mask-region',
                    granularity: 'mask',
                    regionSource: 'workspace_polygon',
                    geometrySha256: 'b'.repeat(64),
                    acceptanceEligible: true,
                    acceptanceReason: null,
                    geometry: {
                        kind: 'mask',
                        bbox: [10, 20, 31, 41],
                        rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
                        polygons: [[[10, 20], [30, 20], [30, 40], [10, 40]]],
                        mask: {
                            encoding: 'binary_rle_varint_zlib_base64_v1',
                            order: 'row-major',
                            size: [80, 100],
                            countsBase64: 'eJw=',
                        },
                    },
                }],
            },
        }];
        props.activeJobId = 'completed-mask-job';
        render(<VisualSearchPopup {...props}/>);
        await screen.findByText('100 × 80');

        const overlay = screen.getByTestId('visual-search-result-mask-overlay');
        expect(overlay).toHaveAttribute('viewBox', '0 0 100 80');
        expect(overlay.querySelector('polygon')).toHaveAttribute(
            'points',
            '10,20 30,20 30,40 10,40',
        );
        expect(screen.getByRole('button', {name: 'Start seed graph'})).toBeEnabled();
        fireEvent.click(screen.getByRole('button', {name: 'Accept mask'}));
        await waitFor(() => expect(props.acceptanceRunner.accept).toHaveBeenCalledWith(
            'completed-mask-job',
            'mask-result',
        ));
        expect(await screen.findByRole('button', {name: 'Accepted'})).toBeDisabled();
    });

    it('keeps an ineligible mask preview-only with the backend reason', async () => {
        const props = baseProps();
        const snapshot = metadata('mask');
        snapshot.target = {...snapshot.target, datasetId: 'dataset-1', datasetRevision: 7};
        props.activeQueueItem = {
            id: 'queue-1',
            name: 'target',
            type: QueueItemType.IMAGE,
            file: new File(['target'], 'result.jpg', {type: 'image/jpeg'}),
            status: QueueItemStatus.COMPLETED,
            uploadedAt: 100,
            datasetId: 'dataset-1',
            datasetRevision: 7,
        };
        props.jobs = [{
            clientJobId: 'preview-mask-job',
            backendJobId: 'task-mask-preview',
            snapshot,
            status: 'succeeded',
            phase: 'succeeded',
            createdAt: 100,
            updatedAt: 120,
            recoveryCount: 0,
            cancelRequested: false,
            idempotentReplay: false,
            selectedResultIds: [],
            result: {
                collection: 'scene/mask/v1',
                queryKind: 'mask',
                queryGeometry: {kind: 'mask', bbox: [10, 20, 31, 41]},
                profileId: 'profile-mask',
                modelRevision: null,
                collectionRevision: 'collection-mask-1',
                executedStages: ['dino'],
                stageStatus: {dino: 'succeeded'},
                total: 1,
                elapsedMs: 9,
                items: [{
                    resultId: 'preview-mask-result',
                    assetId: 'asset-mask',
                    datasetId: 'dataset-1',
                    datasetRevision: 7,
                    rank: 1,
                    path: '/dataset/result.jpg',
                    fileName: 'result.jpg',
                    width: 100,
                    height: 80,
                    className: null,
                    confidence: null,
                    score: 0.9,
                    dinoScore: 0.9,
                    bbox: [10, 20, 31, 41],
                    thumbnail: 'data:image/jpeg;base64,cHJldmlldw==',
                    contentSha256: 'a'.repeat(64),
                    regionId: 'mask-region',
                    granularity: 'mask',
                    regionSource: 'legacy',
                    geometrySha256: 'b'.repeat(64),
                    acceptanceEligible: false,
                    acceptanceReason: 'source_polygon_unavailable',
                    geometry: {
                        kind: 'mask',
                        bbox: [10, 20, 31, 41],
                        rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
                        polygons: [[[10, 20], [30, 20], [30, 40], [10, 40]]],
                        mask: {
                            encoding: 'binary_rle_varint_zlib_base64_v1',
                            order: 'row-major',
                            size: [80, 100],
                            countsBase64: 'eJw=',
                        },
                    },
                }],
            },
        }];
        props.activeJobId = 'preview-mask-job';
        render(<VisualSearchPopup {...props}/>);
        await screen.findByText('100 × 80');

        const button = screen.getByRole('button', {name: 'Accept mask'});
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', expect.stringContaining('source_polygon_unavailable'));
        expect(props.acceptanceRunner.accept).not.toHaveBeenCalled();
    });
});
