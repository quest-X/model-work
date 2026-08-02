import {ProjectRestoreService} from '../ProjectRestoreService';
import {FrameExtractorService} from '../FrameExtractorService';
import {IndexedDBManager, StoredProjectData} from '../../utils/IndexedDBManager';
import {ImageRepository} from '../../logic/imageRepository/ImageRepository';
import {EditorModel} from '../../staticModels/EditorModel';
import {QueueItemStatus, QueueItemType} from '../../store/queue/types';

const mockDispatch = jest.fn();

jest.mock('../../index', () => ({
    store: {
        dispatch: (action: unknown) => mockDispatch(action),
    },
}));

jest.mock('../FrameExtractorService', () => ({
    FrameExtractorService: {
        openSession: jest.fn(),
        fetchFrameRange: jest.fn(),
    },
}));

jest.mock('../../logic/imageRepository/ImageRepository', () => ({
    ImageRepository: {
        setActiveFileId: jest.fn(),
        saveFileCache: jest.fn(),
    },
}));

const metadata = {
    fps: 25,
    duration: 0.12,
    totalFrames: 3,
    width: 1920,
    height: 1080,
};

const storedFrame = (frameIndex: number, annotated: boolean = false) => ({
    id: `frame-id-${frameIndex}`,
    frameIndex,
    isPlaceholder: true,
    fileName: `frame_${String(frameIndex).padStart(6, '0')}.jpg`,
    fileData: new ArrayBuffer(0),
    fileType: 'image/jpeg',
    loadStatus: true,
    labelRects: annotated ? [{id: 'rect-2', labelId: 'hot', rect: {x: 1, y: 2, width: 3, height: 4}}] : [],
    labelPoints: [],
    labelLines: [],
    labelPolygons: [],
    labelNameIds: annotated ? ['hot'] : [],
});

const videoProject = (
    sourceFile?: File,
    datasetId?: string,
    datasetRevision?: number,
): StoredProjectData => ({
    id: 'workspace:test',
    workspaceId: 'test',
    images: [storedFrame(2, true), storedFrame(0)],
    labelNames: [{id: 'hot', name: 'hot'}],
    currentImageIndex: 2,
    lastModified: 10,
    version: '3.0.0-recovery',
    isVideoProject: true,
    extractionMetadata: metadata,
    videoRecovery: {
        mode: 'on-demand',
        sourceQueueItemId: 'video-queue',
        sourceFile,
        metadata,
    },
    queueItems: [{
        id: 'video-queue',
        name: 'coil.mp4',
        type: QueueItemType.VIDEO,
        extractionMetadata: metadata,
        status: QueueItemStatus.COMPLETED,
        uploadedAt: 1,
        datasetId,
        datasetRevision,
    }],
    activeQueueItemId: 'video-queue',
});

const dispatchedAction = (predicate: (action: any) => boolean): any =>
    mockDispatch.mock.calls.map(call => call[0]).find(predicate);

describe('ProjectRestoreService video durability', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        EditorModel.videoSessionId = '';
        EditorModel.videoFrameFiles = [];
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('reopens the original video and preserves sparse frame indices and annotations', async () => {
        const source = new File(['video'], 'coil.mp4', {type: 'video/mp4'});
        const inactiveSource = new File(['image'], 'inactive.jpg', {type: 'image/jpeg'});
        const project = videoProject(source);
        project.queueItems?.push({
            id: 'inactive-image',
            name: 'inactive.jpg',
            type: QueueItemType.IMAGE,
            file: inactiveSource,
            status: QueueItemStatus.COMPLETED,
            uploadedAt: 2,
        });
        project.queueAnnotationSnapshots = [{
            queueItemId: 'inactive-image',
            frames: [{
                id: 'inactive-frame',
                frameIndex: 0,
                fileName: 'inactive.jpg',
                fileType: 'image/jpeg',
                loadStatus: true,
                labelRects: [{id: 'inactive-rect', labelId: 'hot'}],
                labelPoints: [],
                labelLines: [],
                labelPolygons: [],
                labelNameIds: ['hot'],
            }],
        }];
        jest.spyOn(IndexedDBManager, 'loadProject').mockResolvedValue(project);
        (FrameExtractorService.openSession as jest.Mock).mockResolvedValue({
            ...metadata,
            sessionId: 'fresh-session',
        });

        await expect(ProjectRestoreService.restoreProject()).resolves.toBe(true);

        expect(FrameExtractorService.openSession).toHaveBeenCalledWith(source);
        const imageAction = dispatchedAction(action => Array.isArray(action.payload?.imageData));
        expect(imageAction.payload.imageData).toHaveLength(3);
        expect(imageAction.payload.imageData[0].id).toBe('frame-id-0');
        expect(imageAction.payload.imageData[1].fileData.name).toBe('frame_000001.jpg');
        expect(imageAction.payload.imageData[2]).toEqual(expect.objectContaining({
            id: 'frame-id-2',
            labelRects: [expect.objectContaining({id: 'rect-2'})],
        }));

        const videoAction = dispatchedAction(action => action.payload?.videoData);
        expect(videoAction.payload.videoData).toEqual(expect.objectContaining({
            id: 'video-queue',
            fileData: source,
            sessionId: 'fresh-session',
            currentFrame: 2,
        }));
        const queueAction = dispatchedAction(action => Array.isArray(action.payload?.items));
        expect(queueAction.payload.items[0]).toEqual(expect.objectContaining({
            id: 'video-queue',
            videoSessionId: 'fresh-session',
            file: source,
        }));
        expect(ImageRepository.saveFileCache).toHaveBeenCalledWith(
            'video-queue',
            expect.arrayContaining([expect.objectContaining({id: 'frame-id-2'})]),
        );
        expect(ImageRepository.saveFileCache).toHaveBeenCalledWith(
            'inactive-image',
            [expect.objectContaining({
                id: 'inactive-frame',
                fileData: inactiveSource,
                labelRects: [expect.objectContaining({id: 'inactive-rect'})],
            })],
        );
        expect(EditorModel.videoSessionId).toBe('fresh-session');
    });

    it('falls back to browser playback when the engine cannot reopen a local source', async () => {
        const source = new File(['video'], 'coil.mp4', {type: 'video/mp4'});
        jest.spyOn(IndexedDBManager, 'loadProject').mockResolvedValue(videoProject(source));
        (FrameExtractorService.openSession as jest.Mock).mockRejectedValue(new Error('engine offline'));
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        await expect(ProjectRestoreService.restoreProject()).resolves.toBe(true);

        const videoAction = dispatchedAction(action => action.payload?.videoData);
        expect(videoAction.payload.videoData.fileData).toBe(source);
        expect(videoAction.payload.videoData.sessionId).toBeUndefined();
        expect(videoAction.payload.videoData.preExtractedFrames).toBeUndefined();
    });

    it('reconciles the restored timeline to freshly probed video metadata', async () => {
        const source = new File(['video'], 'coil.mp4', {type: 'video/mp4'});
        jest.spyOn(IndexedDBManager, 'loadProject').mockResolvedValue(videoProject(source));
        (FrameExtractorService.openSession as jest.Mock).mockResolvedValue({
            ...metadata,
            totalFrames: 4,
            sessionId: 'fresh-session',
        });

        await expect(ProjectRestoreService.restoreProject()).resolves.toBe(true);

        const imageAction = dispatchedAction(action => Array.isArray(action.payload?.imageData));
        expect(imageAction.payload.imageData).toHaveLength(4);
        expect(imageAction.payload.imageData[2]).toEqual(expect.objectContaining({
            id: 'frame-id-2',
            labelRects: [expect.objectContaining({id: 'rect-2'})],
        }));
        expect(imageAction.payload.imageData[3].fileData.name).toBe('frame_000003.jpg');
    });

    it('rebuilds a video timeline from durable metadata when a transient save had no frames', async () => {
        const source = new File(['video'], 'coil.mp4', {type: 'video/mp4'});
        const project = videoProject(source);
        project.images = [];
        jest.spyOn(IndexedDBManager, 'loadProject').mockResolvedValue(project);
        (FrameExtractorService.openSession as jest.Mock).mockResolvedValue({
            ...metadata,
            sessionId: 'fresh-session',
        });

        await expect(ProjectRestoreService.restoreProject()).resolves.toBe(true);

        const imageAction = dispatchedAction(action => Array.isArray(action.payload?.imageData));
        expect(imageAction.payload.imageData).toHaveLength(metadata.totalFrames);
        expect(imageAction.payload.imageData.map((image: any) => image.fileData.name)).toEqual([
            'frame_000000.jpg',
            'frame_000001.jpg',
            'frame_000002.jpg',
        ]);
    });

    it('does not expose partial Redux state when a server video cannot reconnect', async () => {
        jest.spyOn(IndexedDBManager, 'loadProject').mockResolvedValue(
            videoProject(undefined, 'dataset-video'),
        );
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 503,
            json: jest.fn().mockResolvedValue({detail: 'engine unavailable'}),
        });
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(ProjectRestoreService.restoreProject()).rejects.toThrow('视频源当前不可用');
        expect(mockDispatch).not.toHaveBeenCalled();
        expect(ImageRepository.saveFileCache).not.toHaveBeenCalled();
    });

    it('refuses to attach saved annotations to a different dataset revision', async () => {
        jest.spyOn(IndexedDBManager, 'loadProject').mockResolvedValue(
            videoProject(undefined, 'dataset-video', 3),
        );
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
                sessionId: 'wrong-revision-session',
                metadata,
                dataset: {revision: 4},
            }),
        });
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(ProjectRestoreService.restoreProject()).rejects.toThrow(
            '数据集版本不一致',
        );
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/datasets/dataset-video/video-session?revision=3'),
            {method: 'POST'},
        );
        expect(mockDispatch).not.toHaveBeenCalled();
        expect(ImageRepository.saveFileCache).not.toHaveBeenCalled();
    });

    it('restores an active image from its queue annotation journal when the active list was empty', async () => {
        const source = new File(['image'], 'active.jpg', {type: 'image/jpeg'});
        const project: StoredProjectData = {
            id: 'workspace:image',
            images: [],
            labelNames: [{id: 'hot', name: 'hot'}],
            currentImageIndex: 0,
            lastModified: 20,
            version: '3.0.0-recovery',
            queueItems: [{
                id: 'active-image',
                name: 'active.jpg',
                type: QueueItemType.IMAGE,
                file: source,
                status: QueueItemStatus.COMPLETED,
                uploadedAt: 1,
            }],
            activeQueueItemId: 'active-image',
            queueAnnotationSnapshots: [{
                queueItemId: 'active-image',
                frames: [{
                    id: 'active-frame',
                    frameIndex: 0,
                    fileName: 'active.jpg',
                    fileType: 'image/jpeg',
                    loadStatus: true,
                    labelRects: [{id: 'active-rect', labelId: 'hot'}],
                    labelPoints: [],
                    labelLines: [],
                    labelPolygons: [],
                    labelNameIds: ['hot'],
                }],
            }],
        };
        jest.spyOn(IndexedDBManager, 'loadProject').mockResolvedValue(project);

        await expect(ProjectRestoreService.restoreProject()).resolves.toBe(true);

        const imageAction = dispatchedAction(action => Array.isArray(action.payload?.imageData));
        expect(imageAction.payload.imageData).toEqual([
            expect.objectContaining({
                id: 'active-frame',
                fileData: source,
                labelRects: [expect.objectContaining({id: 'active-rect'})],
            }),
        ]);
    });
});
