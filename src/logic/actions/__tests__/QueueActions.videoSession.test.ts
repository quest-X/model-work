import {store} from '../../../index';
import {QueueActions} from '../QueueActions';
import {EditorModel} from '../../../staticModels/EditorModel';
import {Action} from '../../../store/Actions';
import {
    QueueItem,
    QueueItemStatus,
    QueueItemType,
} from '../../../store/queue/types';
import {VideoData, VideoState} from '../../../store/video/types';
import {FrameExtractorService} from '../../../services/FrameExtractorService';
import {ImageRepository} from '../../imageRepository/ImageRepository';
import {TaskTracker} from '../../../services/TaskTracker';

jest.mock('../../../index', () => ({
    store: {
        dispatch: jest.fn(),
        getState: jest.fn(),
    },
}));

jest.mock('../../imageRepository/ImageRepository', () => ({
    ImageRepository: {
        clearCurrentDisplay: jest.fn(),
        getActiveFileId: jest.fn().mockReturnValue(null),
        restoreFileCache: jest.fn().mockReturnValue([]),
        saveFileCache: jest.fn(),
        setActiveFileId: jest.fn(),
    },
}));

jest.mock('../../../services/TaskTracker', () => ({
    TaskTracker: {
        startTask: jest.fn().mockReturnValue({
            id: 'queue-load',
            update: jest.fn(),
            complete: jest.fn(),
            fail: jest.fn(),
            cancel: jest.fn(),
        }),
    },
}));

jest.mock('../../../services/FrameExtractorService', () => ({
    FrameExtractorService: {
        openSession: jest.fn(),
    },
}));

const mockedStore = store as unknown as {
    dispatch: jest.Mock;
    getState: jest.Mock;
};

const metadata = {
    fps: 25,
    duration: 0.08,
    totalFrames: 2,
    width: 1920,
    height: 1080,
};

const makeQueueItem = (overrides: Partial<QueueItem> = {}): QueueItem => ({
    id: 'video-a',
    name: 'video-a.mp4',
    type: QueueItemType.VIDEO,
    file: new File(['video-a'], 'video-a.mp4', {type: 'video/mp4'}),
    extractionMetadata: metadata,
    status: QueueItemStatus.COMPLETED,
    uploadedAt: 1,
    ...overrides,
});

const makeVideoData = (id: string, sessionId?: string): VideoData => ({
    id,
    fileData: new File([id], `${id}.mp4`, {type: 'video/mp4'}),
    loadStatus: true,
    duration: metadata.duration,
    fps: metadata.fps,
    totalFrames: metadata.totalFrames,
    videoSize: {width: metadata.width, height: metadata.height},
    currentFrame: 0,
    currentTime: 0,
    isPlaying: false,
    frames: new Map(),
    sessionId,
});

const useItemsState = (items: QueueItem[], video: VideoState): void => {
    mockedStore.getState.mockReturnValue({
        general: {language: 'en'},
        queue: {items, activeQueueItemId: null},
        video,
    });
};

const useState = (item: QueueItem, video: VideoState): void => {
    useItemsState([item], video);
};

const deferred = <T,>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
} => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
};

const makeSessionResult = (sessionId: string) => ({
    ...metadata,
    sessionId,
});

const makeTaskHandle = (id: string) => ({
    id,
    update: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
    cancel: jest.fn(),
});

type TestAction = {
    type: string;
    payload: {
        activeVideoIndex?: number;
        itemId?: string;
        updates?: Partial<QueueItem>;
        videoData?: VideoData;
    };
};

const dispatched = (type: string): TestAction[] => mockedStore.dispatch.mock.calls
    .map(([action]) => action)
    .filter(action => action.type === type);

describe('QueueActions video session ownership', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (ImageRepository.getActiveFileId as jest.Mock).mockReturnValue(null);
        (ImageRepository.restoreFileCache as jest.Mock).mockReturnValue([]);
        (FrameExtractorService.openSession as jest.Mock).mockRejectedValue(new Error('engine offline'));
        global.fetch = jest.fn().mockResolvedValue({ok: true, status: 200});
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        EditorModel.videoSessionId = '';
        EditorModel.videoFrameFiles = [];
        EditorModel.preloadedImageCache = new Map();
        EditorModel.videoFrameImage = null;
        EditorModel.playbackImageData = null;
    });

    it('uses the target queue item session instead of another video global', async () => {
        const targetFrame = new File(['frame-a'], 'frame_000000.jpg', {type: 'image/jpeg'});
        const item = makeQueueItem({
            videoSessionId: 'session-a',
            extractedFrames: [targetFrame],
        });
        const otherVideo = makeVideoData('video-b', 'session-b');
        useState(item, {
            isVideoMode: true,
            activeVideo: otherVideo,
            videos: [otherVideo],
            activeVideoIndex: 0,
        });
        EditorModel.videoSessionId = 'session-b';
        EditorModel.videoFrameFiles = [new File(['foreign'], 'foreign.jpg')];

        await QueueActions.switchToQueueItem(item, []);

        expect(dispatched(Action.ADD_VIDEO_DATA)[0].payload.videoData?.sessionId)
            .toBe('session-a');
        expect(EditorModel.videoSessionId).toBe('session-a');
        expect(EditorModel.videoFrameFiles).toEqual([targetFrame]);
        expect(EditorModel.preloadedImageCache.size).toBe(0);
    });

    it('captures and persists the legacy global only on the initial open', async () => {
        const item = makeQueueItem({status: QueueItemStatus.PENDING});
        useState(item, {
            isVideoMode: false,
            activeVideo: null,
            videos: [],
            activeVideoIndex: -1,
        });
        EditorModel.videoSessionId = 'legacy-session';

        await QueueActions.switchToQueueItem(item, []);

        expect(dispatched(Action.UPDATE_QUEUE_ITEM)).toContainEqual({
            type: Action.UPDATE_QUEUE_ITEM,
            payload: {
                itemId: item.id,
                updates: {videoSessionId: 'legacy-session'},
            },
        });
        expect(dispatched(Action.ADD_VIDEO_DATA)[0].payload.videoData?.sessionId)
            .toBe('legacy-session');
    });

    it('does not inherit a known different video session', async () => {
        const item = makeQueueItem();
        const otherVideo = makeVideoData('video-b', 'session-b');
        useState(item, {
            isVideoMode: true,
            activeVideo: otherVideo,
            videos: [otherVideo],
            activeVideoIndex: 0,
        });
        EditorModel.videoSessionId = 'session-b';

        await QueueActions.switchToQueueItem(item, []);

        expect(dispatched(Action.ADD_VIDEO_DATA)[0].payload.videoData?.sessionId)
            .toBeUndefined();
        expect(EditorModel.videoSessionId).toBe('');
        expect(dispatched(Action.UPDATE_QUEUE_ITEM).some(action =>
            action.payload.updates?.videoSessionId
        )).toBe(false);
    });

    it('reactivates an existing VideoData instead of appending a duplicate', async () => {
        const item = makeQueueItem({videoSessionId: 'session-a'});
        const existingVideo = makeVideoData(item.id, 'session-a');
        useState(item, {
            isVideoMode: true,
            activeVideo: existingVideo,
            videos: [existingVideo],
            activeVideoIndex: 0,
        });

        await QueueActions.switchToQueueItem(item, []);

        expect(dispatched(Action.ADD_VIDEO_DATA)).toHaveLength(0);
        expect(dispatched(Action.UPDATE_ACTIVE_VIDEO_INDEX)).toEqual([{
            type: Action.UPDATE_ACTIVE_VIDEO_INDEX,
            payload: {activeVideoIndex: 0},
        }]);
    });

    it('reopens an inactive local video that has durable metadata but no runtime lease', async () => {
        const item = makeQueueItem({videoSessionId: undefined});
        useState(item, {
            isVideoMode: false,
            activeVideo: null,
            videos: [],
            activeVideoIndex: -1,
        });
        (FrameExtractorService.openSession as jest.Mock).mockResolvedValue({
            ...metadata,
            sessionId: 'reopened-session',
        });

        await QueueActions.switchToQueueItem(item, []);

        expect(FrameExtractorService.openSession).toHaveBeenCalledWith(item.file);
        expect(dispatched(Action.ADD_VIDEO_DATA)[0].payload.videoData?.sessionId)
            .toBe('reopened-session');
        expect(dispatched(Action.UPDATE_QUEUE_ITEM)).toContainEqual({
            type: Action.UPDATE_QUEUE_ITEM,
            payload: {
                itemId: item.id,
                updates: {
                    videoSessionId: 'reopened-session',
                    extractionMetadata: metadata,
                },
            },
        });
    });

    it('validates and replaces a stale persisted runtime lease before committing', async () => {
        const item = makeQueueItem({videoSessionId: 'stale-session'});
        const staleVideo = makeVideoData(item.id, 'stale-session');
        useState(item, {
            isVideoMode: true,
            activeVideo: staleVideo,
            videos: [staleVideo],
            activeVideoIndex: 0,
        });
        EditorModel.videoSessionId = 'stale-session';
        global.fetch = jest.fn().mockResolvedValue({ok: false, status: 404});
        const reopening = deferred<ReturnType<typeof makeSessionResult>>();
        (FrameExtractorService.openSession as jest.Mock).mockReturnValue(reopening.promise);

        const switching = QueueActions.switchToQueueItem(item, []);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/extraction-status/stale-session'),
            {method: 'GET'},
        );
        expect(FrameExtractorService.openSession).toHaveBeenCalledWith(item.file);
        expect(ImageRepository.clearCurrentDisplay).not.toHaveBeenCalled();
        expect(dispatched(Action.SET_ACTIVE_QUEUE_ITEM)).toHaveLength(0);
        expect(EditorModel.videoSessionId).toBe('stale-session');

        reopening.resolve(makeSessionResult('fresh-session'));
        await switching;

        expect(EditorModel.videoSessionId).toBe('fresh-session');
        expect(dispatched(Action.UPDATE_QUEUE_ITEM)).toContainEqual({
            type: Action.UPDATE_QUEUE_ITEM,
            payload: {
                itemId: item.id,
                updates: {
                    videoSessionId: 'fresh-session',
                    extractionMetadata: metadata,
                },
            },
        });
        expect(dispatched(Action.ADD_VIDEO_DATA)[0].payload.videoData?.sessionId)
            .toBe('fresh-session');
    });

    it('reopens an inactive server video from its durable dataset identity', async () => {
        const item = makeQueueItem({
            file: new File([], 'server-video.mp4', {type: 'video/mp4'}),
            videoSessionId: undefined,
            datasetId: 'dataset/video',
        });
        useState(item, {
            isVideoMode: false,
            activeVideo: null,
            videos: [],
            activeVideoIndex: -1,
        });
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
                sessionId: 'dataset-session',
                metadata,
            }),
        });

        await QueueActions.switchToQueueItem(item, []);

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/datasets/dataset%2Fvideo/video-session'),
            {method: 'POST'},
        );
        expect(dispatched(Action.ADD_VIDEO_DATA)[0].payload.videoData?.sessionId)
            .toBe('dataset-session');
    });

    it('keeps the previous editor visible while a video runtime is still opening', async () => {
        const item = makeQueueItem();
        const previousVideo = makeVideoData('video-old', 'old-session');
        useState(item, {
            isVideoMode: true,
            activeVideo: previousVideo,
            videos: [previousVideo],
            activeVideoIndex: 0,
        });
        (ImageRepository.getActiveFileId as jest.Mock).mockReturnValue('video-old');
        EditorModel.videoSessionId = 'old-session';
        const opening = deferred<ReturnType<typeof makeSessionResult>>();
        (FrameExtractorService.openSession as jest.Mock).mockReturnValue(opening.promise);

        const switching = QueueActions.switchToQueueItem(item, []);
        await Promise.resolve();

        expect(FrameExtractorService.openSession).toHaveBeenCalledWith(item.file);
        expect(ImageRepository.clearCurrentDisplay).not.toHaveBeenCalled();
        expect(ImageRepository.setActiveFileId).not.toHaveBeenCalled();
        expect(dispatched(Action.UPDATE_IMAGES_DATA)).toHaveLength(0);
        expect(dispatched(Action.SET_ACTIVE_QUEUE_ITEM)).toHaveLength(0);
        expect(dispatched(Action.UPDATE_QUEUE_ITEM).some(action =>
            action.payload.updates?.status === QueueItemStatus.PROCESSING
        )).toBe(false);
        expect(EditorModel.videoSessionId).toBe('old-session');

        opening.resolve(makeSessionResult('new-session'));
        await switching;

        expect(ImageRepository.clearCurrentDisplay).toHaveBeenCalledTimes(1);
        expect(ImageRepository.setActiveFileId).toHaveBeenCalledWith(item.id);
        expect(EditorModel.videoSessionId).toBe('new-session');
    });

    it('lets B win when A finishes opening after B', async () => {
        const itemA = makeQueueItem({id: 'video-a', name: 'video-a.mp4'});
        const itemB = makeQueueItem({
            id: 'video-b',
            name: 'video-b.mp4',
            file: new File(['video-b'], 'video-b.mp4', {type: 'video/mp4'}),
        });
        const previousVideo = makeVideoData('video-old', 'old-session');
        useItemsState([itemA, itemB], {
            isVideoMode: true,
            activeVideo: previousVideo,
            videos: [previousVideo],
            activeVideoIndex: 0,
        });
        EditorModel.videoSessionId = 'old-session';
        const openingA = deferred<ReturnType<typeof makeSessionResult>>();
        const openingB = deferred<ReturnType<typeof makeSessionResult>>();
        (FrameExtractorService.openSession as jest.Mock).mockImplementation((file: File) =>
            file.name === 'video-a.mp4' ? openingA.promise : openingB.promise
        );
        const taskA = makeTaskHandle('task-a');
        const taskB = makeTaskHandle('task-b');
        (TaskTracker.startTask as jest.Mock)
            .mockReturnValueOnce(taskA)
            .mockReturnValueOnce(taskB);

        const switchingA = QueueActions.switchToQueueItem(itemA, []);
        await Promise.resolve();
        const switchingB = QueueActions.switchToQueueItem(itemB, []);
        await Promise.resolve();

        expect(taskA.cancel).toHaveBeenCalledTimes(1);
        openingB.resolve(makeSessionResult('session-b'));
        await switchingB;

        expect(EditorModel.videoSessionId).toBe('session-b');
        expect(ImageRepository.setActiveFileId).toHaveBeenLastCalledWith(itemB.id);
        expect(taskB.complete).toHaveBeenCalledTimes(1);
        const dispatchCountAfterB = mockedStore.dispatch.mock.calls.length;
        const clearCountAfterB = (ImageRepository.clearCurrentDisplay as jest.Mock).mock.calls.length;

        openingA.resolve(makeSessionResult('session-a'));
        await switchingA;

        expect(mockedStore.dispatch).toHaveBeenCalledTimes(dispatchCountAfterB);
        expect(ImageRepository.clearCurrentDisplay).toHaveBeenCalledTimes(clearCountAfterB);
        expect(ImageRepository.setActiveFileId).toHaveBeenLastCalledWith(itemB.id);
        expect(EditorModel.videoSessionId).toBe('session-b');
        expect(taskA.complete).not.toHaveBeenCalled();
        expect(taskA.fail).not.toHaveBeenCalled();
        expect(dispatched(Action.UPDATE_QUEUE_ITEM).some(action =>
            action.payload.itemId === itemA.id
        )).toBe(false);
    });

    it('rejects a reopened dataset session from a different revision', async () => {
        const item = makeQueueItem({
            datasetId: 'dataset-video',
            datasetRevision: 7,
            videoSessionId: undefined,
        });
        const previousVideo = makeVideoData('video-old', 'old-session');
        useState(item, {
            isVideoMode: true,
            activeVideo: previousVideo,
            videos: [previousVideo],
            activeVideoIndex: 0,
        });
        EditorModel.videoSessionId = 'old-session';
        const task = makeTaskHandle('revision-task');
        (TaskTracker.startTask as jest.Mock).mockReturnValueOnce(task);
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
                sessionId: 'wrong-revision-session',
                metadata,
                dataset: {revision: 8},
            }),
        });

        await QueueActions.switchToQueueItem(item, []);

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/datasets/dataset-video/video-session?revision=7'),
            {method: 'POST'},
        );
        expect(ImageRepository.clearCurrentDisplay).not.toHaveBeenCalled();
        expect(ImageRepository.setActiveFileId).not.toHaveBeenCalled();
        expect(dispatched(Action.SET_ACTIVE_QUEUE_ITEM)).toHaveLength(0);
        expect(dispatched(Action.UPDATE_IMAGES_DATA)).toHaveLength(0);
        expect(EditorModel.videoSessionId).toBe('old-session');
        expect(dispatched(Action.UPDATE_QUEUE_ITEM)).toEqual([{
            type: Action.UPDATE_QUEUE_ITEM,
            payload: {
                itemId: item.id,
                updates: {
                    status: QueueItemStatus.ERROR,
                    error: '数据集版本不匹配：队列项 v7，服务器 v8',
                },
            },
        }]);
        expect(task.fail).toHaveBeenCalledWith(expect.objectContaining({
            message: '数据集版本不匹配：队列项 v7，服务器 v8',
        }));
        expect(task.complete).not.toHaveBeenCalled();
    });
});
