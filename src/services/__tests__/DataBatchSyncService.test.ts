import {DataBatchSyncService} from '../DataBatchSyncService';
import {ImageData, LabelName} from '../../store/labels/types';
import {QueueItem, QueueItemStatus, QueueItemType} from '../../store/queue/types';
import {updateProjectData} from '../../store/general/actionCreators';
import {ProjectType} from '../../data/enums/ProjectType';
import {store} from '../../index';

const jsonResponse = (body: unknown): Response => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: jest.fn().mockResolvedValue(body),
} as unknown as Response);

describe('DataBatchSyncService', () => {
    it('serializes rectangles and preserves polygon geometry by file index', () => {
        const file = new File(['image'], '炉口.png', {type: 'image/png', lastModified: 1});
        const labels: LabelName[] = [{id: 'hot', name: 'hot'}];
        const image = {
            id: 'image-1',
            fileData: file,
            labelRects: [
                {labelId: 'hot', rect: {x: 10, y: 20, width: 30, height: 40}},
                {labelId: 'hot', rect: {x: 1, y: 1, width: 2, height: 2}, isPrompt: true},
            ],
            labelPolygons: [
                {labelId: 'hot', vertices: [{x: 5, y: 7}, {x: 25, y: 9}, {x: 20, y: 30}]},
            ],
        } as ImageData;

        const metadata = DataBatchSyncService.buildMetadata([file], [image], labels);

        expect(metadata.classes).toEqual([{id: 'hot', name: 'hot'}]);
        expect(metadata.images).toEqual([{
            index: 0,
            regions: [
                {label_id: 'hot', bbox: [10, 20, 30, 40], shape: 'rect'},
                {
                    label_id: 'hot',
                    bbox: [5, 7, 20, 23],
                    shape: 'polygon',
                    vertices: [{x: 5, y: 7}, {x: 25, y: 9}, {x: 20, y: 30}],
                },
            ],
        }]);
    });

    it('persists the current project name instead of the temporary queue label', async () => {
        store.dispatch(updateProjectData({
            type: ProjectType.OBJECT_DETECTION,
            name: 'default-project',
        }));
        const file = new File(['image'], '炉口.png', {type: 'image/png', lastModified: 1});
        const item: QueueItem = {
            id: 'queue-import',
            name: '导入标注',
            type: QueueItemType.IMAGE,
            file,
            status: QueueItemStatus.COMPLETED,
            uploadedAt: 1,
        };
        global.fetch = jest.fn().mockResolvedValue(jsonResponse({
            status: 'success',
            dataset_id: 'dataset-1',
            revision: 1,
        }));

        await DataBatchSyncService.syncQueueItem(item, [], []);

        const request = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
        const form = request.body as FormData;
        expect(form.get('name')).toBe('default-project');
        expect(form.get('project_name')).toBe('default-project');
        expect(form.get('source_id')).toBe('queue-import');
        expect(form.get('operation_type')).toBe('raw');
    });

    it('updates the exact server dataset when syncing an edited working copy', async () => {
        const file = new File(['image'], 'edited.png', {type: 'image/png', lastModified: 1});
        const item: QueueItem = {
            id: 'working-copy',
            name: 'default-project',
            type: QueueItemType.IMAGE,
            file,
            status: QueueItemStatus.COMPLETED,
            uploadedAt: 1,
            datasetId: 'dataset-existing',
            datasetRevision: 3,
        };
        global.fetch = jest.fn().mockResolvedValue(jsonResponse({
            status: 'success',
            dataset_id: 'dataset-existing',
            revision: 4,
        }));

        await DataBatchSyncService.syncQueueItem(item, [], []);

        const request = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
        const form = request.body as FormData;
        expect(form.get('dataset_id')).toBe('dataset-existing');
        expect(form.get('operation_type')).toBe('annotation_edit');
    });

    it('persists an active video session as an annotated frame dataset', async () => {
        const frame = new File([], 'frame_000000.jpg', {type: 'image/jpeg'});
        const labels: LabelName[] = [{id: 'hot', name: 'hot'}];
        const image = {
            id: 'frame-0',
            fileData: frame,
            labelRects: [{labelId: 'hot', rect: {x: 5, y: 6, width: 20, height: 10}}],
            labelPolygons: [],
        } as ImageData;
        const item: QueueItem = {
            id: 'video-queue',
            name: '炉口.mp4',
            type: QueueItemType.VIDEO,
            file: new File(['video'], '炉口.mp4', {type: 'video/mp4'}),
            status: QueueItemStatus.COMPLETED,
            uploadedAt: 1,
        };
        global.fetch = jest.fn().mockResolvedValue(jsonResponse({
            status: 'success',
            dataset_id: 'video-dataset',
            revision: 1,
        }));

        await DataBatchSyncService.syncQueueItem(item, [image], labels, 'session/炉口');

        const [url, request] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
        const form = request.body as FormData;
        expect(url).toContain('/datasets/video-sessions/session%2F%E7%82%89%E5%8F%A3');
        expect(form.getAll('files')).toHaveLength(0);
        expect(form.get('video_filename')).toBe('炉口.mp4');
        expect(JSON.parse(String(form.get('metadata')))).toEqual({
            version: 1,
            classes: [{id: 'hot', name: 'hot'}],
            images: [{
                index: 0,
                regions: [{label_id: 'hot', bbox: [5, 6, 20, 10], shape: 'rect'}],
            }],
        });
    });
});
