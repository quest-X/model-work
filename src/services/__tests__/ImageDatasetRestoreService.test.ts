import JSZip from 'jszip';
import {
    ImageDatasetRestoreService,
    ImageWorkspaceUnavailableError,
} from '../ImageDatasetRestoreService';
import {DataBatchSyncService} from '../DataBatchSyncService';
import {QueueActions} from '../../logic/actions/QueueActions';
import {ImageRepository} from '../../logic/imageRepository/ImageRepository';
import {ImageData, LabelName, LabelPolygon} from '../../store/labels/types';
import {QueueItemType} from '../../store/queue/types';
import {LabelStatus} from '../../data/enums/LabelStatus';
import {VISUAL_SEARCH_MASK_RASTERIZER_REVISION} from '../../store/visualSearch/types';
import {
    parseVisualSearchMaskComponent,
    visualSearchVerticesSignature,
} from '../../utils/VisualSearchMaskProvenance';

jest.mock('../../logic/actions/QueueActions', () => ({
    QueueActions: {switchToQueueItem: jest.fn().mockResolvedValue(undefined)},
}));

jest.mock('../../logic/imageRepository/ImageRepository', () => ({
    ImageRepository: {
        getActiveFileId: jest.fn().mockReturnValue(null),
        setActiveFileId: jest.fn(),
        saveFileCache: jest.fn(),
    },
}));

const DATASET_ID = 'dataset-mask-restore';
const GEOMETRY_SHA = 'c'.repeat(64);

const maskPolygon = (
    componentIndex: number,
    vertices: Array<{x: number; y: number}>,
): LabelPolygon => ({
    id: `visual-search:task-mask:result-mask:mask:${componentIndex}`,
    labelId: 'goose',
    vertices,
    isVisible: true,
    isCreatedByAI: true,
    status: LabelStatus.ACCEPTED,
    suggestedLabel: null,
    extra: {visualSearch: {
        schemaVersion: 1,
        clientJobId: 'client-mask',
        backendJobId: 'task-mask',
        resultId: 'result-mask',
        componentIndex,
        componentCount: 2,
        assetId: 'vector-asset-mask',
        geometrySha256: GEOMETRY_SHA,
        rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        regionId: 'region-mask',
        datasetId: DATASET_ID,
        datasetRevision: 2,
        verticesSignature: visualSearchVerticesSignature(vertices),
    }},
});

const sourceWorkspace = () => {
    const first = new File([new Uint8Array([1, 2, 3])], 'z-frame.png', {type: 'image/png'});
    const second = new File([new Uint8Array([4, 5, 6, 7])], 'a-frame.png', {type: 'image/png'});
    const labels: LabelName[] = [{id: 'goose', name: 'goose'}];
    const images = [{
        id: 'source-image-0',
        fileData: first,
        labelRects: [],
        labelPoints: [],
        labelLines: [],
        labelPolygons: [
            maskPolygon(0, [{x: 1, y: 1}, {x: 5, y: 1}, {x: 3, y: 4}]),
            maskPolygon(1, [{x: 8, y: 2}, {x: 12, y: 2}, {x: 10, y: 6}]),
        ],
        labelNameIds: ['goose'],
        loadStatus: false,
        isVisitedByRoboflowAPI: false,
    }, {
        id: 'source-image-1',
        fileData: second,
        labelRects: [],
        labelPoints: [],
        labelLines: [],
        labelPolygons: [],
        labelNameIds: [],
        loadStatus: false,
        isVisitedByRoboflowAPI: false,
    }] as ImageData[];
    return {
        files: [first, second],
        labels,
        images,
        metadata: DataBatchSyncService.buildMetadata([first, second], images, labels),
    };
};

const archiveResponse = async (
    workspace: unknown,
    revision: number = 3,
): Promise<Response> => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
        id: DATASET_ID,
        name: 'goose-mask',
        revision,
        image_count: 2,
        format: 'opensight-batch',
    }));
    if (workspace !== undefined) zip.file('workspace.json', JSON.stringify(workspace));
    // Asset row order is authoritative and intentionally differs from lexical
    // filename order, proving workspace indices remain bound to image bytes.
    zip.file('assets.jsonl', [
        JSON.stringify({
            role: 'image',
            asset_id: 'sha256:first',
            relative_path: 'images/z-frame.png',
        }),
        JSON.stringify({
            role: 'image',
            asset_id: 'sha256:second',
            relative_path: 'images/a-frame.png',
        }),
    ].join('\n'));
    zip.file('images/z-frame.png', new Uint8Array([1, 2, 3]));
    zip.file('images/a-frame.png', new Uint8Array([4, 5, 6, 7]));
    const archive = await zip.generateAsync({type: 'uint8array'});
    return {
        ok: true,
        status: 200,
        blob: jest.fn().mockResolvedValue(archive),
        json: jest.fn().mockResolvedValue({}),
    } as unknown as Response;
};

const fileBytes = (file: File): Promise<number[]> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
});

describe('ImageDatasetRestoreService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (QueueActions.switchToQueueItem as jest.Mock).mockResolvedValue(undefined);
        (ImageRepository.getActiveFileId as jest.Mock).mockReturnValue(null);
    });

    it('round-trips multipart mask metadata, image order and dataset binding losslessly', async () => {
        const source = sourceWorkspace();
        const workspace = JSON.parse(JSON.stringify(source.metadata));
        workspace.images[0].regions.reverse();
        global.fetch = jest.fn().mockResolvedValue(await archiveResponse(workspace));

        const item = await ImageDatasetRestoreService.restore(
            DATASET_ID,
            'goose-mask',
            3,
            'queue-mask',
            [],
        );

        expect(item.type).toBe(QueueItemType.FOLDER);
        expect(item.datasetId).toBe(DATASET_ID);
        expect(item.datasetRevision).toBe(3);
        expect(item.id).toBe('queue-mask');
        expect(item.files?.map(file => [file.name, file.size])).toEqual([
            ['z-frame.png', 3],
            ['a-frame.png', 4],
        ]);
        expect(await fileBytes(item.files?.[0] as File)).toEqual([1, 2, 3]);
        expect(await fileBytes(item.files?.[1] as File)).toEqual([4, 5, 6, 7]);
        const [cacheId, restoredImages] = (ImageRepository.saveFileCache as jest.Mock).mock.calls[0] as [
            string,
            ImageData[],
        ];
        expect(cacheId).toBe('queue-mask');
        expect(restoredImages[0].labelRects).toHaveLength(0);
        expect(restoredImages[0].labelPolygons.map(polygon => polygon.vertices)).toEqual(
            source.images[0].labelPolygons.map(polygon => polygon.vertices),
        );
        expect(restoredImages[0].labelPolygons.map(polygon => polygon.extra?.visualSearch)).toEqual(
            source.images[0].labelPolygons.map(polygon => polygon.extra?.visualSearch),
        );
        const restoredMetadata = DataBatchSyncService.buildMetadata(
            item.files || [],
            restoredImages,
            source.labels,
        );
        expect(restoredMetadata).toEqual(source.metadata);
        expect(QueueActions.switchToQueueItem).toHaveBeenCalledWith(item, []);
    });

    it('upgrades legacy mask_group v1 without provenance to a deterministic queryable group', async () => {
        const source = sourceWorkspace();
        const workspace = JSON.parse(JSON.stringify(source.metadata));
        workspace.images[0].regions.forEach((region: {mask_group?: {provenance?: unknown}}) => {
            if (region.mask_group) delete region.mask_group.provenance;
        });
        global.fetch = jest.fn().mockResolvedValue(await archiveResponse(workspace));

        const item = await ImageDatasetRestoreService.restore(
            DATASET_ID,
            'legacy-goose-mask',
            3,
            null,
            [],
        );

        const restored = (ImageRepository.saveFileCache as jest.Mock).mock.calls[0][1] as ImageData[];
        const components = restored[0].labelPolygons.map(parseVisualSearchMaskComponent);
        expect(components.every(Boolean)).toBe(true);
        expect(components.map(component => component?.provenance.componentIndex)).toEqual([0, 1]);
        expect(components.map(component => component?.provenance.geometrySha256)).toEqual([
            GEOMETRY_SHA,
            GEOMETRY_SHA,
        ]);
        expect(components[0]?.provenance.datasetId).toBe(DATASET_ID);
        expect(components[0]?.provenance.datasetRevision).toBe(3);
        const upgraded = DataBatchSyncService.buildMetadata(
            item.files || [],
            restored,
            source.labels,
        );
        expect(upgraded.images[0].regions.every(region =>
            region.shape === 'polygon' && Boolean(region.mask_group?.provenance))).toBe(true);
    });

    it('fails closed when persisted mask provenance no longer matches its vertices', async () => {
        const source = sourceWorkspace();
        const workspace = JSON.parse(JSON.stringify(source.metadata));
        workspace.images[0].regions[0].mask_group.provenance.vertices_signature = 'd'.repeat(64);
        global.fetch = jest.fn().mockResolvedValue(await archiveResponse(workspace));

        await expect(ImageDatasetRestoreService.restore(
            DATASET_ID,
            'corrupt-goose-mask',
            3,
            null,
            [],
        )).rejects.toThrow('vertices signature mismatch');

        expect(ImageRepository.saveFileCache).not.toHaveBeenCalled();
        expect(QueueActions.switchToQueueItem).not.toHaveBeenCalled();
    });

    it('marks only pre-workspace archives as eligible for the legacy importer', async () => {
        global.fetch = jest.fn().mockResolvedValue(await archiveResponse(undefined));

        await expect(ImageDatasetRestoreService.restore(
            DATASET_ID,
            'legacy-bbox-only',
            3,
            null,
            [],
        )).rejects.toBeInstanceOf(ImageWorkspaceUnavailableError);

        expect(ImageRepository.saveFileCache).not.toHaveBeenCalled();
    });
});
