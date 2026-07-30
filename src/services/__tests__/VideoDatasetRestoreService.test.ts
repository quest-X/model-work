import {VideoDatasetRestoreService} from '../VideoDatasetRestoreService';
import {QueueActions} from '../../logic/actions/QueueActions';
import {ImageRepository} from '../../logic/imageRepository/ImageRepository';
import {EditorModel} from '../../staticModels/EditorModel';
import {QueueItemType} from '../../store/queue/types';
import {store} from '../../index';

jest.mock('../../logic/actions/QueueActions', () => ({
    QueueActions: {switchToQueueItem: jest.fn().mockResolvedValue(undefined)},
}));

jest.mock('../../logic/imageRepository/ImageRepository', () => ({
    ImageRepository: {saveFileCache: jest.fn()},
}));

const jsonResponse = (body: unknown): Response => ({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
} as unknown as Response);

describe('VideoDatasetRestoreService', () => {
    it('recreates a video queue, timeline metadata and frame annotations', async () => {
        global.fetch = jest.fn().mockResolvedValue(jsonResponse({
            sessionId: 'restored-session',
            filename: '炉口.mp4',
            metadata: {
                fps: 25,
                duration: 0.08,
                totalFrames: 2,
                width: 1920,
                height: 1080,
            },
            workspace: {
                classes: [{id: 'hot', name: 'hot'}],
                images: [{
                    index: 0,
                    regions: [{label_id: 'hot', bbox: [10, 20, 30, 40]}],
                }],
            },
        }));

        const item = await VideoDatasetRestoreService.restore(
            'dataset-video',
            '炉口项目',
            3,
            [],
        );

        expect(item.type).toBe(QueueItemType.VIDEO);
        expect(item.datasetId).toBe('dataset-video');
        expect(item.datasetRevision).toBe(3);
        expect(item.file?.name).toBe('炉口.mp4');
        expect(item.file?.size).toBe(0);
        expect(EditorModel.videoSessionId).toBe('restored-session');
        const cachedFrames = (ImageRepository.saveFileCache as jest.Mock).mock.calls[0][1];
        expect(cachedFrames).toHaveLength(2);
        expect(cachedFrames[0].fileData.name).toBe('frame_000000.jpg');
        expect(cachedFrames[0].labelRects[0]).toEqual(expect.objectContaining({
            labelId: 'hot',
            rect: {x: 10, y: 20, width: 30, height: 40},
        }));
        expect(store.getState().labels.labels).toEqual([
            expect.objectContaining({id: 'hot', name: 'hot'}),
        ]);
        expect(QueueActions.switchToQueueItem).toHaveBeenCalledWith(item, []);
    });
});
