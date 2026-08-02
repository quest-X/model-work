import {AutoSaveService, buildPersistenceSignature} from '../AutoSaveService';
import {IndexedDBManager, StoredProjectData} from '../../utils/IndexedDBManager';
import {store} from '../../index';
import {QueueItemStatus, QueueItemType} from '../../store/queue/types';
import {LocalStorageManager} from '../../utils/LocalStorageManager';
import {AIStateStorageManager} from '../../utils/AIStateStorageManager';
import {TaskTracker} from '../TaskTracker';
import {ImageRepository} from '../../logic/imageRepository/ImageRepository';

const MEBIBYTE = 1024 * 1024;

const sizedFile = (
    name: string,
    size: number,
    type: string = 'image/jpeg',
    byte: number = 1,
): File => ({
    name,
    size,
    type,
    lastModified: 1,
    arrayBuffer: jest.fn().mockResolvedValue(new Uint8Array([byte]).buffer),
} as unknown as File);

const emptyAIState = () => ({
    segmentationResults: [],
    imageSegmentationResults: new Map(),
    imageAIStates: new Map(),
});

const signatureState = (rectX: number = 1, labelName: string = 'steel', fps: number = 25) => ({
    general: {
        language: 'zh',
        projectData: {name: 'mill', type: 'OBJECT_DETECTION'},
        zoom: 1,
        imageDragMode: false,
        smartAnnotationActive: false,
    },
    labels: {
        activeImageIndex: 0,
        activeLabelType: 'RECT',
        labels: [{id: 'label-1', name: labelName, color: '#fff'}],
        imagesData: [{
            id: 'frame-0',
            fileData: new File([], 'frame_000000.jpg', {type: 'image/jpeg'}),
            labelRects: [{id: 'rect-1', labelId: 'label-1', rect: {x: rectX, y: 2, width: 3, height: 4}}],
            labelPoints: [],
            labelLines: [],
            labelPolygons: [],
            labelNameIds: ['label-1'],
        }],
    },
    video: {
        isVideoMode: true,
        activeVideoIndex: 0,
        activeVideo: {
            id: 'video-1',
            fileData: new File(['source'], 'source.mp4', {type: 'video/mp4'}),
            loadStatus: true,
            duration: 2,
            fps,
            totalFrames: 50,
            videoSize: {width: 1920, height: 1080},
            sessionId: 'runtime-only',
        },
    },
    queue: {items: [], activeQueueItemId: null},
    ai: emptyAIState(),
});

describe('AutoSaveService durability', () => {
    afterEach(async () => {
        jest.restoreAllMocks();
        await AutoSaveService.drain();
        ImageRepository.clearAllCache();
        localStorage.clear();
        Object.assign(AutoSaveService as any, {
            inFlightSave: null,
            pendingSave: false,
            pendingForce: false,
            suspendDepth: 0,
            lastSavedSignature: '',
        });
    });

    it('includes annotation geometry, label properties, and video metadata in its signature', () => {
        const initial = buildPersistenceSignature(signatureState());

        expect(buildPersistenceSignature(signatureState(9))).not.toBe(initial);
        expect(buildPersistenceSignature(signatureState(1, 'coil'))).not.toBe(initial);
        expect(buildPersistenceSignature(signatureState(1, 'steel', 30))).not.toBe(initial);
    });

    it('persists zero-byte video frames as indexed annotation records and stores the source once', async () => {
        const placeholder = new File([], 'frame_000042.jpg', {type: 'image/jpeg'});
        const source = new File(['video-source'], 'coil.mp4', {type: 'video/mp4'});
        const state = signatureState() as any;
        state.labels.imagesData = [{
            id: 'frame-42',
            fileData: placeholder,
            loadStatus: true,
            labelRects: [{id: 'rect-1', labelId: 'label-1', rect: {x: 10, y: 20, width: 30, height: 40}}],
            labelPoints: [],
            labelLines: [],
            labelPolygons: [],
            labelNameIds: ['label-1'],
        }];
        state.video.activeVideo.fileData = source;
        state.queue.activeQueueItemId = 'video-queue';
        state.queue.items = [{
            id: 'video-queue',
            name: 'coil.mp4',
            type: QueueItemType.VIDEO,
            file: source,
            videoSessionId: 'ephemeral-session',
            extractionMetadata: {
                fps: 25,
                duration: 2,
                totalFrames: 50,
                width: 1920,
                height: 1080,
            },
            status: QueueItemStatus.COMPLETED,
            uploadedAt: 1,
        }];
        jest.spyOn(store, 'getState').mockReturnValue(state);
        let savedProject: StoredProjectData | undefined;
        jest.spyOn(IndexedDBManager, 'saveProject').mockImplementation(async project => {
            savedProject = project;
            return true;
        });

        await (AutoSaveService as any).saveProjectData();

        expect(savedProject?.images).toHaveLength(1);
        expect(savedProject?.images[0]).toEqual(expect.objectContaining({
            id: 'frame-42',
            frameIndex: 0,
            isPlaceholder: true,
            labelRects: state.labels.imagesData[0].labelRects,
        }));
        expect((savedProject?.images[0].fileData as ArrayBuffer).byteLength).toBe(0);
        expect(savedProject?.videoRecovery).toEqual(expect.objectContaining({
            mode: 'on-demand',
            sourceQueueItemId: 'video-queue',
            sourceFile: source,
            sessionId: 'ephemeral-session',
        }));
        expect(savedProject?.queueItems?.[0].file).toBeUndefined();
        expect((savedProject?.queueItems?.[0] as any).videoSessionId).toBeUndefined();
    });

    it('never truncates non-video image bytes to satisfy the recovery budget', async () => {
        const state = signatureState() as any;
        state.video = {isVideoMode: false, activeVideo: null, activeVideoIndex: -1};
        state.labels.imagesData = [
            {...state.labels.imagesData[0], id: 'image-a', fileData: sizedFile('a.jpg', 300 * MEBIBYTE, 'image/jpeg', 1)},
            {...state.labels.imagesData[0], id: 'image-b', fileData: sizedFile('b.jpg', 300 * MEBIBYTE, 'image/jpeg', 2)},
        ];
        jest.spyOn(store, 'getState').mockReturnValue(state);
        let savedProject: StoredProjectData | undefined;
        jest.spyOn(IndexedDBManager, 'saveProject').mockImplementation(async value => {
            savedProject = value;
            return true;
        });

        await (AutoSaveService as any).saveProjectData();

        expect(savedProject?.images.map(image => ({
            bytes: (image.fileData as ArrayBuffer).byteLength,
            placeholder: image.isPlaceholder,
        }))).toEqual([
            {bytes: 1, placeholder: false},
            {bytes: 1, placeholder: false},
        ]);
    });

    it('never truncates pre-extracted frames without a durable source or dataset', async () => {
        const state = signatureState() as any;
        const missingSource = sizedFile('source.mp4', 0, 'video/mp4');
        const frames = [
            sizedFile('frame-0.jpg', 300 * MEBIBYTE, 'image/jpeg', 1),
            sizedFile('frame-1.jpg', 300 * MEBIBYTE, 'image/jpeg', 2),
        ];
        state.video.activeVideo.fileData = missingSource;
        state.video.activeVideo.preExtractedFrames = frames;
        state.labels.imagesData = frames.map((fileData, index) => ({
            ...state.labels.imagesData[0],
            id: `frame-${index}`,
            fileData,
        }));
        state.queue.activeQueueItemId = 'local-video';
        state.queue.items = [{
            id: 'local-video',
            name: 'source.mp4',
            type: QueueItemType.VIDEO,
            file: missingSource,
            extractedFrames: frames,
            status: QueueItemStatus.COMPLETED,
            uploadedAt: 1,
        }];
        jest.spyOn(store, 'getState').mockReturnValue(state);
        let savedProject: StoredProjectData | undefined;
        jest.spyOn(IndexedDBManager, 'saveProject').mockImplementation(async value => {
            savedProject = value;
            return true;
        });

        await (AutoSaveService as any).saveProjectData();

        expect(savedProject?.videoRecovery?.sourceFile).toBeUndefined();
        expect(savedProject?.images.every(image => !image.isPlaceholder)).toBe(true);
        expect(savedProject?.images.map(
            image => (image.fileData as ArrayBuffer).byteLength,
        )).toEqual([1, 1]);
    });

    it('stores an oversized video source once and only budgets its rebuildable frame cache', async () => {
        const state = signatureState() as any;
        const source = sizedFile('source.mp4', 600 * MEBIBYTE, 'video/mp4');
        const frames = [
            sizedFile('frame-0.jpg', 300 * MEBIBYTE, 'image/jpeg', 1),
            sizedFile('frame-1.jpg', 300 * MEBIBYTE, 'image/jpeg', 2),
        ];
        state.video.activeVideo.fileData = source;
        state.labels.imagesData = frames.map((fileData, index) => ({
            ...state.labels.imagesData[0],
            id: `frame-${index}`,
            fileData,
        }));
        state.queue.activeQueueItemId = 'video-source';
        state.queue.items = [{
            id: 'video-source',
            name: 'source.mp4',
            type: QueueItemType.VIDEO,
            file: source,
            status: QueueItemStatus.COMPLETED,
            uploadedAt: 1,
        }];
        jest.spyOn(store, 'getState').mockReturnValue(state);
        let savedProject: StoredProjectData | undefined;
        jest.spyOn(IndexedDBManager, 'saveProject').mockImplementation(async value => {
            savedProject = value;
            return true;
        });

        await (AutoSaveService as any).saveProjectData();

        expect(savedProject?.videoRecovery?.sourceFile).toBe(source);
        expect(savedProject?.queueItems?.[0].file).toBeUndefined();
        expect(savedProject?.images.map(image => image.isPlaceholder)).toEqual([false, true]);
        expect(savedProject?.images.map(
            image => (image.fileData as ArrayBuffer).byteLength,
        )).toEqual([1, 0]);
        expect((source.arrayBuffer as jest.Mock)).not.toHaveBeenCalled();
    });

    it('includes inactive queue annotation caches without duplicating source bytes', async () => {
        const state = signatureState() as any;
        state.video = {isVideoMode: false, activeVideo: null, activeVideoIndex: -1};
        state.queue.activeQueueItemId = 'active-image';
        state.queue.items = [
            {
                id: 'active-image',
                name: 'active.jpg',
                type: QueueItemType.IMAGE,
                file: new File(['active'], 'active.jpg', {type: 'image/jpeg'}),
                status: QueueItemStatus.COMPLETED,
                uploadedAt: 1,
            },
            {
                id: 'inactive-image',
                name: 'inactive.jpg',
                type: QueueItemType.IMAGE,
                file: new File(['inactive'], 'inactive.jpg', {type: 'image/jpeg'}),
                status: QueueItemStatus.COMPLETED,
                uploadedAt: 2,
            },
        ];
        const inactiveFrame = {
            ...state.labels.imagesData[0],
            id: 'inactive-frame',
            fileData: state.queue.items[1].file,
            labelRects: [{id: 'inactive-rect', rect: {x: 7, y: 8, width: 9, height: 10}}],
        };
        ImageRepository.saveFileCache('inactive-image', [inactiveFrame]);
        const initialSignature = buildPersistenceSignature(state);
        jest.spyOn(store, 'getState').mockReturnValue(state);
        let savedProject: StoredProjectData | undefined;
        jest.spyOn(IndexedDBManager, 'saveProject').mockImplementation(async value => {
            savedProject = value;
            return true;
        });

        await (AutoSaveService as any).saveProjectData();

        const inactiveSnapshot = savedProject?.queueAnnotationSnapshots?.find(
            snapshot => snapshot.queueItemId === 'inactive-image',
        );
        expect(inactiveSnapshot?.frames[0]).toEqual(expect.objectContaining({
            id: 'inactive-frame',
            frameIndex: 0,
            labelRects: inactiveFrame.labelRects,
        }));
        expect(inactiveSnapshot?.frames[0]).not.toHaveProperty('fileData');
        expect(savedProject?.queueItems?.[1].file).toBe(state.queue.items[1].file);

        ImageRepository.saveFileCache('inactive-image', [{
            ...inactiveFrame,
            labelRects: [{...inactiveFrame.labelRects[0], rect: {x: 70, y: 8, width: 9, height: 10}}],
        }]);
        expect(buildPersistenceSignature(state)).not.toBe(initialSignature);
    });

    it('does not advance lightweight save timestamps when the project commit fails', async () => {
        const state = signatureState() as any;
        localStorage.setItem('make-sense-project-settings', JSON.stringify({
            language: 'zh',
            projectName: 'previous',
            lastSaved: 123,
            zoom: 1,
            imageDragMode: false,
            smartAnnotationActive: false,
            currentImageIndex: 0,
            activeLabelType: 'RECT',
        }));
        jest.spyOn(store, 'getState').mockReturnValue(state);
        jest.spyOn(TaskTracker, 'startTask').mockReturnValue({
            complete: jest.fn(),
            fail: jest.fn(),
        } as any);
        jest.spyOn(AutoSaveService as any, 'saveProjectData').mockResolvedValue(false);
        const saveSettings = jest.spyOn(AutoSaveService as any, 'saveSettings');
        const saveAIState = jest.spyOn(AutoSaveService as any, 'saveAIState');

        await (AutoSaveService as any).performSave(true);

        expect(saveSettings).not.toHaveBeenCalled();
        expect(saveAIState).not.toHaveBeenCalled();
        expect(LocalStorageManager.getLastSavedTime()).toBe(123);
        expect(AIStateStorageManager.getLastSavedTime()).toBe(0);
        expect((AutoSaveService as any).lastSavedSignature).toBe('');
    });

    it('serializes overlapping save requests and coalesces them into one newer write', async () => {
        const releases: Array<() => void> = [];
        let active = 0;
        let maxActive = 0;
        const performSave = jest.spyOn(AutoSaveService as any, 'performSave')
            .mockImplementation(async () => {
                active++;
                maxActive = Math.max(maxActive, active);
                await new Promise<void>(resolve => releases.push(resolve));
                active--;
            });

        const first = AutoSaveService.saveCurrentState();
        await Promise.resolve();
        const second = AutoSaveService.saveCurrentState();
        const third = AutoSaveService.saveCurrentState(true);
        expect(performSave).toHaveBeenCalledTimes(1);

        releases.shift()?.();
        await Promise.resolve();
        await Promise.resolve();
        expect(performSave).toHaveBeenCalledTimes(2);
        expect(performSave.mock.calls[1][0]).toBe(true);

        releases.shift()?.();
        await Promise.all([first, second, third]);
        expect(maxActive).toBe(1);
        expect(performSave).toHaveBeenCalledTimes(2);
    });

    it('drops queued save work across a suspend and drain boundary', async () => {
        let release: (() => void) | undefined;
        const performSave = jest.spyOn(AutoSaveService as any, 'performSave')
            .mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));

        void AutoSaveService.saveCurrentState();
        await Promise.resolve();
        void AutoSaveService.saveCurrentState(true);
        AutoSaveService.suspend();
        release?.();
        await AutoSaveService.drain();
        AutoSaveService.resume();
        await Promise.resolve();

        expect(performSave).toHaveBeenCalledTimes(1);
    });
});
