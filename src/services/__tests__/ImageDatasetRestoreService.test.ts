import JSZip from 'jszip';
import {
    IMAGE_WORKSPACE_RESTORE_LIMITS,
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
const GEOMETRY_SHA = 'ae021cc551b133fd969afedd366eba6c3757ff90281a04b9f086499f26cadfa2';

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
    const archiveBlob = new Blob([archive]);
    return {
        ok: true,
        status: 200,
        headers: {get: (name: string) =>
            name.toLowerCase() === 'content-length' ? String(archiveBlob.size) : null},
        blob: jest.fn().mockResolvedValue(archiveBlob),
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
        Object.defineProperty(globalThis, 'createImageBitmap', {
            configurable: true,
            writable: true,
            value: jest.fn().mockResolvedValue({
                width: 16,
                height: 8,
                close: jest.fn(),
            }),
        });
        (QueueActions.switchToQueueItem as jest.Mock).mockResolvedValue(undefined);
        (ImageRepository.getActiveFileId as jest.Mock).mockReturnValue(null);
    });

    afterEach(() => {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
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

    it('matches the backend square geometry SHA golden with pako level-9 zlib bytes', async () => {
        const source = sourceWorkspace();
        const workspace = JSON.parse(JSON.stringify(source.metadata));
        const square = [
            {x: 16, y: 16},
            {x: 48, y: 16},
            {x: 48, y: 48},
            {x: 16, y: 48},
        ];
        const squareSha = '1ca3c978bc3c9f281e2385f87e17900d25f7b1fd74b4f1041f7d1a4c6a6ed62f';
        const provenance = workspace.images[0].regions[0].mask_group.provenance;
        workspace.images[0].regions = [{
            label_id: 'goose',
            bbox: [16, 16, 32, 32],
            shape: 'polygon',
            vertices: square,
            mask_group: {
                schema_version: 1,
                geometry_sha256: squareSha,
                rasterizer_revision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
                component_index: 0,
                component_count: 1,
                provenance: {
                    ...provenance,
                    vertices_signature: visualSearchVerticesSignature(square),
                },
            },
        }];
        (globalThis.createImageBitmap as jest.Mock).mockResolvedValue({
            width: 64,
            height: 64,
            close: jest.fn(),
        });
        global.fetch = jest.fn().mockResolvedValue(await archiveResponse(workspace));

        await expect(ImageDatasetRestoreService.restore(
            DATASET_ID,
            'square-golden-mask',
            3,
            null,
            [],
        )).resolves.toBeDefined();

        const restored = (ImageRepository.saveFileCache as jest.Mock).mock.calls[0][1] as ImageData[];
        expect(parseVisualSearchMaskComponent(restored[0].labelPolygons[0])
            ?.provenance.geometrySha256).toBe(squareSha);
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

    it('recomputes union pixels and rejects a stale geometry SHA after coordinated vertex edits', async () => {
        const source = sourceWorkspace();
        const workspace = JSON.parse(JSON.stringify(source.metadata));
        const first = workspace.images[0].regions[0];
        first.vertices[0].x = 2;
        first.mask_group.provenance.vertices_signature = visualSearchVerticesSignature(
            first.vertices,
        );
        global.fetch = jest.fn().mockResolvedValue(await archiveResponse(workspace));

        await expect(ImageDatasetRestoreService.restore(
            DATASET_ID,
            'stale-mask-identity',
            3,
            null,
            [],
        )).rejects.toThrow('canonical geometry SHA-256 mismatch');

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

    it('rejects an oversized archive from Content-Length before reading its body', async () => {
        const blob = jest.fn();
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: {get: () => String(IMAGE_WORKSPACE_RESTORE_LIMITS.maxArchiveBytes + 1)},
            blob,
            json: jest.fn(),
        } as unknown as Response);

        await expect(ImageDatasetRestoreService.restore(
            DATASET_ID,
            'oversized-archive',
            3,
            null,
            [],
        )).rejects.toThrow('archive exceeds the restore size limit');
        expect(blob).not.toHaveBeenCalled();
        expect(ImageRepository.saveFileCache).not.toHaveBeenCalled();
    });

    it('rejects an oversized declared image before decompressing that entry', async () => {
        const source = sourceWorkspace();
        const response = await archiveResponse(JSON.parse(JSON.stringify(source.metadata)));
        const zip = await JSZip.loadAsync(await response.blob());
        const imageEntry = zip.file('images/z-frame.png') as JSZip.JSZipObject;
        const guardedAsync = jest.fn();
        const mutableEntry = imageEntry as unknown as {
            _data: {uncompressedSize: number};
            async: jest.Mock;
        };
        mutableEntry._data.uncompressedSize =
            IMAGE_WORKSPACE_RESTORE_LIMITS.maxImageBytes + 1;
        mutableEntry.async = guardedAsync;
        const loadAsync = jest.spyOn(JSZip, 'loadAsync').mockResolvedValue(zip);
        global.fetch = jest.fn().mockResolvedValue(response);

        try {
            await expect(ImageDatasetRestoreService.restore(
                DATASET_ID,
                'oversized-image',
                3,
                null,
                [],
            )).rejects.toThrow('per-image restore limit');
            expect(guardedAsync).not.toHaveBeenCalled();
            expect(ImageRepository.saveFileCache).not.toHaveBeenCalled();
        } finally {
            loadAsync.mockRestore();
        }
    });

    it('rejects excessive regions before constructing restored labels', async () => {
        const source = sourceWorkspace();
        const workspace = JSON.parse(JSON.stringify(source.metadata));
        workspace.images[0].regions = Array.from(
            {length: IMAGE_WORKSPACE_RESTORE_LIMITS.maxRegionsPerImage + 1},
            () => ({shape: 'rect', label_id: 'goose', bbox: [0, 0, 1, 1]}),
        );
        global.fetch = jest.fn().mockResolvedValue(await archiveResponse(workspace));

        await expect(ImageDatasetRestoreService.restore(
            DATASET_ID,
            'too-many-regions',
            3,
            null,
            [],
        )).rejects.toThrow('per-image region limit');
        expect(ImageRepository.saveFileCache).not.toHaveBeenCalled();
    });

    it('rejects a polygon above the canonical vertex limit', async () => {
        const source = sourceWorkspace();
        const workspace = JSON.parse(JSON.stringify(source.metadata));
        workspace.images[0].regions = [{
            shape: 'polygon',
            label_id: 'goose',
            bbox: [0, 0, 1, 1],
            vertices: Array.from(
                {length: 8_193},
                (_, index) => ({x: index, y: index}),
            ),
        }];
        global.fetch = jest.fn().mockResolvedValue(await archiveResponse(workspace));

        await expect(ImageDatasetRestoreService.restore(
            DATASET_ID,
            'too-many-vertices',
            3,
            null,
            [],
        )).rejects.toThrow('polygon vertex limit');
        expect(ImageRepository.saveFileCache).not.toHaveBeenCalled();
    });
});
