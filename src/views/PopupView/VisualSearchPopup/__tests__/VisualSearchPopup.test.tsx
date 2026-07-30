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
    VisualSearchJobState,
    VisualSearchSnapshotMetadata,
} from '../../../../store/visualSearch/types';
import {VideoData} from '../../../../store/video/types';
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
    granularity: 'image' | 'bbox',
    name: string = `scene/${granularity}/v1`,
): VisualSearchCollection => ({
    name,
    displayName: name,
    sceneName: 'Line A',
    targetName: granularity === 'bbox' ? 'Scratch boxes' : 'Full images',
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
    kind: 'image' | 'bbox' = 'image',
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
        : {kind: 'image'},
    image: {
        fileName: 'source.png',
        mimeType: 'image/png',
        size: 13,
        width: 100,
        height: 80,
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
    onClose: jest.fn(),
});

describe('VisualSearchPopup', () => {
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

    it('keeps mask geometry visible but disables submission without a real mask stage', async () => {
        const props = baseProps();
        props.activeImage = activeImage('polygon');
        props.activeLabelId = 'polygon-1';
        props.collectionLoader.mockResolvedValue([
            collection('image'),
            collection('bbox'),
        ]);
        render(<VisualSearchPopup {...props}/>);

        expect(await screen.findByText('Mask search is not enabled yet')).toBeInTheDocument();
        expect(screen.getByText(/never silently fall back to an image/)).toBeInTheDocument();
        expect(await screen.findByTestId('visual-search-query-overlay')).toBeInTheDocument();
        expect(screen.getByTestId('submit-visual-search')).toBeDisabled();
        fireEvent.click(screen.getByTestId('submit-visual-search'));
        expect(props.snapshotCapture).not.toHaveBeenCalled();
        expect(props.jobRunner.start).not.toHaveBeenCalled();
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
            'Results are preview-only; accepting annotations is not connected yet.',
        )).toBeInTheDocument();
        expect(screen.queryByText('Accept')).not.toBeInTheDocument();
    });
});
