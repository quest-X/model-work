import JSZip from 'jszip';
import {v4 as uuidv4} from 'uuid';
import {store} from '../index';
import {QueueActions} from '../logic/actions/QueueActions';
import {ImageRepository} from '../logic/imageRepository/ImageRepository';
import {addQueueItem, updateQueueItem} from '../store/queue/actionCreators';
import {
    QueueDataSyncStatus,
    QueueItem,
    QueueItemStatus,
    QueueItemType,
} from '../store/queue/types';
import {ImageData, LabelName, LabelPolygon} from '../store/labels/types';
import {LabelStatus} from '../data/enums/LabelStatus';
import {updateLabelNames} from '../store/labels/actionCreators';
import {updateProjectData} from '../store/general/actionCreators';
import {
    VISUAL_SEARCH_MASK_LIMITS,
    VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
} from '../store/visualSearch/types';
import {ImageDataUtil} from '../utils/ImageDataUtil';
import {LabelUtil} from '../utils/LabelUtil';
import {getEngineBaseUrl} from '../utils/DefaultBackendUrl';
import {
    validateVisualSearchMaskGroup,
    visualSearchVerticesSignature,
} from '../utils/VisualSearchMaskProvenance';

type JsonObject = Record<string, unknown>;

type WorkspaceAsset = {
    assetId: string;
    relativePath: string;
};

type WorkspaceMaskProvenance = {
    clientJobId: string;
    backendJobId: string;
    resultId: string;
    assetId: string;
    regionId: string | null;
    datasetId: string;
    datasetRevision: string | number;
    verticesSignature: string;
};

type WorkspaceMaskComponent = {
    labelId: string;
    vertices: Array<{x: number; y: number}>;
    geometrySha256: string;
    rasterizerRevision: typeof VISUAL_SEARCH_MASK_RASTERIZER_REVISION;
    componentIndex: number;
    componentCount: number;
    provenance?: WorkspaceMaskProvenance;
};

type DatasetManifest = {
    id: string;
    revision: number;
    imageCount: number;
    format: string;
};

type SizedZipEntry = JSZip.JSZipObject & {
    _data?: {
        uncompressedSize?: number;
        compressedSize?: number;
    };
};

type WorkspaceRestoreBudget = {
    totalRegions: number;
    totalVertices: number;
};

/** Editing limits for restoring an image dataset into the browser workspace.
 * They do not limit server-side vector collections or retrieval corpus size. */
export const IMAGE_WORKSPACE_RESTORE_LIMITS = Object.freeze({
    maxArchiveBytes: 2_147_483_648,
    maxZipEntries: 25_000,
    maxImages: 20_000,
    maxImageBytes: 67_108_864,
    maxTotalImageBytes: 4_294_967_296,
    maxManifestBytes: 1_048_576,
    maxWorkspaceBytes: 67_108_864,
    maxAssetsBytes: 33_554_432,
    maxLabels: 4_096,
    maxRegionsPerImage: 4_096,
    maxTotalRegions: 1_000_000,
    maxVerticesPerImage: 262_144,
    maxTotalVertices: 2_000_000,
});

const objectValue = (value: unknown, field: string): JsonObject => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Invalid image workspace ${field}`);
    }
    return value as JsonObject;
};

const arrayValue = (value: unknown, field: string): unknown[] => {
    if (!Array.isArray(value)) throw new Error(`Invalid image workspace ${field}`);
    return value;
};

const nonEmptyString = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Invalid image workspace ${field}`);
    }
    return value;
};

const integerValue = (value: unknown, field: string): number => {
    if (!Number.isInteger(value)) throw new Error(`Invalid image workspace ${field}`);
    return value as number;
};

const sha256Value = (value: unknown, field: string): string => {
    const digest = nonEmptyString(value, field);
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error(`Invalid image workspace ${field}`);
    return digest;
};

const declaredEntrySize = (entry: JSZip.JSZipObject, field: string): number => {
    const size = (entry as SizedZipEntry)._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || (size as number) < 0) {
        throw new Error(`Image workspace ${field} has no safe declared size`);
    }
    return size as number;
};

const readText = async (
    entry: JSZip.JSZipObject,
    field: string,
    maxBytes: number,
): Promise<string> => {
    if (declaredEntrySize(entry, field) > maxBytes) {
        throw new Error(`Image workspace ${field} exceeds the restore size limit`);
    }
    const value = await entry.async('text');
    if (new Blob([value]).size > maxBytes) {
        throw new Error(`Image workspace ${field} exceeds the restore size limit`);
    }
    return value;
};

const readJson = async (
    zip: JSZip,
    filename: string,
    maxBytes: number,
): Promise<JsonObject> => {
    const entry = zip.file(filename);
    if (!entry) throw new Error(`Image workspace archive is missing ${filename}`);
    return objectValue(JSON.parse(await readText(entry, filename, maxBytes)), filename);
};

const parseManifest = (raw: JsonObject): DatasetManifest => {
    const manifest = {
        id: nonEmptyString(raw.id, 'manifest.id'),
        revision: integerValue(raw.revision, 'manifest.revision'),
        imageCount: integerValue(raw.image_count, 'manifest.image_count'),
        format: nonEmptyString(raw.format, 'manifest.format'),
    };
    if (manifest.imageCount < 1 ||
        manifest.imageCount > IMAGE_WORKSPACE_RESTORE_LIMITS.maxImages) {
        throw new Error('Image workspace exceeds the editor image-count limit');
    }
    return manifest;
};

const parseAssets = async (zip: JSZip): Promise<WorkspaceAsset[]> => {
    const entry = zip.file('assets.jsonl');
    if (!entry) throw new Error('Image workspace archive is missing assets.jsonl');
    const assets: WorkspaceAsset[] = [];
    const seenPaths = new Set<string>();
    (await readText(
        entry,
        'assets.jsonl',
        IMAGE_WORKSPACE_RESTORE_LIMITS.maxAssetsBytes,
    )).split(/\r?\n/).filter(Boolean).forEach((line, index) => {
        const asset = objectValue(JSON.parse(line), `assets.jsonl:${index + 1}`);
        if (asset.role !== 'image') return;
        const relativePath = nonEmptyString(asset.relative_path, `assets[${index}].relative_path`);
        const assetId = nonEmptyString(asset.asset_id, `assets[${index}].asset_id`);
        if (!relativePath.startsWith('images/') || seenPaths.has(relativePath)) {
            throw new Error('Invalid or duplicate image path in assets.jsonl');
        }
        seenPaths.add(relativePath);
        assets.push({assetId, relativePath});
        if (assets.length > IMAGE_WORKSPACE_RESTORE_LIMITS.maxImages) {
            throw new Error('Image workspace exceeds the editor image-count limit');
        }
    });
    if (assets.length === 0) throw new Error('Image workspace archive contains no image assets');
    return assets;
};

const mimeTypeFor = (filename: string): string => {
    const extension = filename.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        bmp: 'image/bmp',
        webp: 'image/webp',
    };
    return types[extension || ''] || 'application/octet-stream';
};

const restoreFiles = async (zip: JSZip, assets: WorkspaceAsset[]): Promise<File[]> => {
    const entries = assets.map(asset => {
        const entry = zip.file(asset.relativePath);
        if (!entry || entry.dir) throw new Error(`Image workspace is missing ${asset.relativePath}`);
        return entry;
    });
    let declaredTotal = 0;
    entries.forEach((entry, index) => {
        const declared = declaredEntrySize(entry, assets[index].relativePath);
        if (declared > IMAGE_WORKSPACE_RESTORE_LIMITS.maxImageBytes) {
            throw new Error(`Image workspace image exceeds the per-image restore limit: ${entry.name}`);
        }
        declaredTotal += declared;
        if (declaredTotal > IMAGE_WORKSPACE_RESTORE_LIMITS.maxTotalImageBytes) {
            throw new Error('Image workspace images exceed the total restore limit');
        }
    });

    const files: File[] = [];
    let actualTotal = 0;
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        // Sequential decompression prevents a valid large workspace from
        // materializing every image buffer in memory at once.
        // eslint-disable-next-line no-await-in-loop
        const blob = await entry.async('blob');
        if (blob.size > IMAGE_WORKSPACE_RESTORE_LIMITS.maxImageBytes) {
            throw new Error(`Image workspace image exceeds the per-image restore limit: ${entry.name}`);
        }
        actualTotal += blob.size;
        if (actualTotal > IMAGE_WORKSPACE_RESTORE_LIMITS.maxTotalImageBytes) {
            throw new Error('Image workspace images exceed the total restore limit');
        }
        const filename = assets[index].relativePath.split('/').pop() || assets[index].relativePath;
        files.push(new File([blob], filename, {type: mimeTypeFor(filename)}));
    }
    return files;
};

const parseLabels = (workspace: JsonObject): LabelName[] => {
    const ids = new Set<string>();
    const values = arrayValue(workspace.classes, 'classes');
    if (values.length > IMAGE_WORKSPACE_RESTORE_LIMITS.maxLabels) {
        throw new Error('Image workspace exceeds the label-count limit');
    }
    return values.map((value, index) => {
        const raw = objectValue(value, `classes[${index}]`);
        const id = nonEmptyString(raw.id, `classes[${index}].id`);
        const name = nonEmptyString(raw.name, `classes[${index}].name`);
        if (ids.has(id)) throw new Error(`Duplicate image workspace label id: ${id}`);
        ids.add(id);
        const created = LabelUtil.createLabelName(name);
        return {
            ...created,
            id,
            ...(typeof raw.color === 'string' && raw.color ? {color: raw.color} : {}),
        };
    });
};

const parseBBox = (value: unknown, field: string): [number, number, number, number] => {
    const bbox = arrayValue(value, field);
    if (bbox.length !== 4 || bbox.some(coordinate => !Number.isFinite(coordinate))) {
        throw new Error(`Invalid image workspace ${field}`);
    }
    const result = bbox as [number, number, number, number];
    if (result[2] <= 0 || result[3] <= 0) throw new Error(`Invalid image workspace ${field}`);
    return result;
};

const parseVertices = (value: unknown, field: string): Array<{x: number; y: number}> => {
    const values = arrayValue(value, field);
    if (values.length > VISUAL_SEARCH_MASK_LIMITS.maxVerticesPerPolygon) {
        throw new Error(`Image workspace ${field} exceeds the polygon vertex limit`);
    }
    const vertices = values.map((point, index) => {
        const raw = objectValue(point, `${field}[${index}]`);
        if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) {
            throw new Error(`Invalid image workspace ${field}[${index}]`);
        }
        return {x: raw.x as number, y: raw.y as number};
    });
    if (vertices.length < 3) throw new Error(`Invalid image workspace ${field}`);
    return vertices;
};

const revisionIsAncestor = (value: unknown, currentRevision: number): value is string | number => {
    const revision = typeof value === 'string' && value.trim() ? Number(value) : value;
    return Number.isInteger(revision) && Number(revision) >= 1 && Number(revision) <= currentRevision;
};

const parseProvenance = (
    value: unknown,
    vertices: Array<{x: number; y: number}>,
    datasetId: string,
    datasetRevision: number,
    field: string,
): WorkspaceMaskProvenance | undefined => {
    if (value === undefined) return undefined;
    const raw = objectValue(value, field);
    if (raw.schema_version !== 1) throw new Error(`Invalid image workspace ${field}.schema_version`);
    const provenance: WorkspaceMaskProvenance = {
        clientJobId: nonEmptyString(raw.client_job_id, `${field}.client_job_id`),
        backendJobId: nonEmptyString(raw.backend_job_id, `${field}.backend_job_id`),
        resultId: nonEmptyString(raw.result_id, `${field}.result_id`),
        assetId: nonEmptyString(raw.asset_id, `${field}.asset_id`),
        regionId: raw.region_id === null || raw.region_id === undefined
            ? null
            : nonEmptyString(raw.region_id, `${field}.region_id`),
        datasetId: nonEmptyString(raw.dataset_id, `${field}.dataset_id`),
        datasetRevision: raw.dataset_revision as string | number,
        verticesSignature: sha256Value(raw.vertices_signature, `${field}.vertices_signature`),
    };
    if (provenance.datasetId !== datasetId ||
        !revisionIsAncestor(provenance.datasetRevision, datasetRevision)) {
        throw new Error('Image workspace mask provenance targets another dataset revision');
    }
    if (visualSearchVerticesSignature(vertices) !== provenance.verticesSignature) {
        throw new Error('Image workspace mask vertices signature mismatch');
    }
    return provenance;
};

const parseMaskComponent = (
    raw: JsonObject,
    labelId: string,
    vertices: Array<{x: number; y: number}>,
    datasetId: string,
    datasetRevision: number,
    field: string,
): WorkspaceMaskComponent => {
    const group = objectValue(raw.mask_group, `${field}.mask_group`);
    if (group.schema_version !== 1) throw new Error(`Invalid image workspace ${field}.mask_group.schema_version`);
    const rasterizerRevision = nonEmptyString(
        group.rasterizer_revision,
        `${field}.mask_group.rasterizer_revision`,
    );
    if (rasterizerRevision !== VISUAL_SEARCH_MASK_RASTERIZER_REVISION) {
        throw new Error('Image workspace mask rasterizer revision is unsupported');
    }
    const componentIndex = integerValue(group.component_index, `${field}.mask_group.component_index`);
    const componentCount = integerValue(group.component_count, `${field}.mask_group.component_count`);
    if (componentIndex < 0 || componentCount < 1 || componentIndex >= componentCount ||
        componentCount > VISUAL_SEARCH_MASK_LIMITS.maxPolygons) {
        throw new Error('Invalid image workspace mask component index');
    }
    return {
        labelId,
        vertices,
        geometrySha256: sha256Value(group.geometry_sha256, `${field}.mask_group.geometry_sha256`),
        rasterizerRevision: VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
        componentIndex,
        componentCount,
        provenance: parseProvenance(
            group.provenance,
            vertices,
            datasetId,
            datasetRevision,
            `${field}.mask_group.provenance`,
        ),
    };
};

const syntheticProvenance = (
    component: WorkspaceMaskComponent,
    datasetId: string,
    datasetRevision: number,
    assetId: string,
): WorkspaceMaskProvenance => ({
    clientJobId: `workspace-restore:${datasetId}:${component.geometrySha256}`,
    backendJobId: `workspace-restore:${datasetId}`,
    resultId: component.geometrySha256,
    assetId,
    regionId: null,
    datasetId,
    datasetRevision,
    verticesSignature: visualSearchVerticesSignature(component.vertices),
});

const sameGroupProvenance = (
    left: WorkspaceMaskProvenance,
    right: WorkspaceMaskProvenance,
): boolean => left.clientJobId === right.clientJobId &&
    left.backendJobId === right.backendJobId &&
    left.resultId === right.resultId &&
    left.assetId === right.assetId &&
    left.regionId === right.regionId &&
    left.datasetId === right.datasetId &&
    String(left.datasetRevision) === String(right.datasetRevision);

const restoreMaskGroup = (
    components: WorkspaceMaskComponent[],
    datasetId: string,
    datasetRevision: number,
    assetId: string,
): LabelPolygon[] => {
    const ordered = [...components].sort((left, right) => left.componentIndex - right.componentIndex);
    const reference = ordered[0];
    if (!reference || ordered.length !== reference.componentCount ||
        ordered.some((component, index) => component.componentIndex !== index ||
            component.componentCount !== reference.componentCount ||
            component.geometrySha256 !== reference.geometrySha256 ||
            component.rasterizerRevision !== reference.rasterizerRevision ||
            component.labelId !== reference.labelId ||
            Boolean(component.provenance) !== Boolean(reference.provenance))) {
        throw new Error('Incomplete or inconsistent image workspace mask group');
    }
    const provenance = ordered.map(component => component.provenance || syntheticProvenance(
        component,
        datasetId,
        datasetRevision,
        assetId,
    ));
    if (provenance.some(item => !sameGroupProvenance(provenance[0], item))) {
        throw new Error('Inconsistent image workspace mask provenance');
    }
    const polygons = ordered.map((component, index): LabelPolygon => ({
        id: `visual-search:${provenance[index].backendJobId}:${provenance[index].resultId}:mask:${index}`,
        labelId: component.labelId,
        vertices: component.vertices,
        isVisible: true,
        isCreatedByAI: true,
        status: LabelStatus.ACCEPTED,
        suggestedLabel: null,
        extra: {visualSearch: {
            schemaVersion: 1,
            clientJobId: provenance[index].clientJobId,
            backendJobId: provenance[index].backendJobId,
            resultId: provenance[index].resultId,
            componentIndex: index,
            componentCount: ordered.length,
            assetId: provenance[index].assetId,
            geometrySha256: component.geometrySha256,
            rasterizerRevision: component.rasterizerRevision,
            regionId: provenance[index].regionId,
            datasetId: provenance[index].datasetId,
            datasetRevision: provenance[index].datasetRevision,
            verticesSignature: provenance[index].verticesSignature,
        }},
    }));
    // Reuse the same validator used by query construction and re-sync. This
    // proves deterministic ids, component ordering and signatures as one unit.
    validateVisualSearchMaskGroup(polygons.map(label => ({
        label,
        provenance: label.extra?.visualSearch,
    })));
    return polygons;
};

const restoreAnnotations = (
    image: ImageData,
    regions: unknown[],
    validLabelIds: Set<string>,
    datasetId: string,
    datasetRevision: number,
    assetId: string,
    imageIndex: number,
    budget: WorkspaceRestoreBudget,
): void => {
    if (regions.length > IMAGE_WORKSPACE_RESTORE_LIMITS.maxRegionsPerImage) {
        throw new Error(`Image workspace images[${imageIndex}] exceeds the per-image region limit`);
    }
    budget.totalRegions += regions.length;
    if (budget.totalRegions > IMAGE_WORKSPACE_RESTORE_LIMITS.maxTotalRegions) {
        throw new Error('Image workspace exceeds the total region limit');
    }
    let imageVertices = 0;
    const grouped = new Map<string, WorkspaceMaskComponent[]>();
    const output: Array<LabelPolygon | {group: string}> = [];
    regions.forEach((value, regionIndex) => {
        const field = `images[${imageIndex}].regions[${regionIndex}]`;
        const raw = objectValue(value, field);
        const labelId = nonEmptyString(raw.label_id, `${field}.label_id`);
        if (!validLabelIds.has(labelId)) throw new Error(`Unknown image workspace label id: ${labelId}`);
        parseBBox(raw.bbox, `${field}.bbox`);
        if (raw.shape === undefined || raw.shape === 'rect') {
            const bbox = parseBBox(raw.bbox, `${field}.bbox`);
            image.labelRects.push(LabelUtil.createLabelRect(labelId, {
                x: bbox[0],
                y: bbox[1],
                width: bbox[2],
                height: bbox[3],
            }));
            return;
        }
        if (raw.shape !== 'polygon') throw new Error(`Unsupported image workspace shape: ${String(raw.shape)}`);
        const vertices = parseVertices(raw.vertices, `${field}.vertices`);
        imageVertices += vertices.length;
        budget.totalVertices += vertices.length;
        if (imageVertices > IMAGE_WORKSPACE_RESTORE_LIMITS.maxVerticesPerImage) {
            throw new Error(`Image workspace images[${imageIndex}] exceeds the per-image vertex limit`);
        }
        if (budget.totalVertices > IMAGE_WORKSPACE_RESTORE_LIMITS.maxTotalVertices) {
            throw new Error('Image workspace exceeds the total vertex limit');
        }
        if (raw.mask_group === undefined) {
            output.push(LabelUtil.createLabelPolygon(labelId, vertices));
            return;
        }
        const component = parseMaskComponent(
            raw,
            labelId,
            vertices,
            datasetId,
            datasetRevision,
            field,
        );
        const key = component.geometrySha256;
        if (!grouped.has(key)) output.push({group: key});
        grouped.set(key, [...(grouped.get(key) || []), component]);
    });
    output.forEach(item => {
        if ('group' in item) {
            image.labelPolygons.push(...restoreMaskGroup(
                grouped.get(item.group) || [],
                datasetId,
                datasetRevision,
                assetId,
            ));
        } else {
            image.labelPolygons.push(item);
        }
    });
    image.labelNameIds = Array.from(new Set(
        [...image.labelRects, ...image.labelPolygons]
            .map(label => label.labelId)
            .filter((labelId): labelId is string => Boolean(labelId)),
    ));
};

const restoreImages = (
    files: File[],
    assets: WorkspaceAsset[],
    workspace: JsonObject,
    labels: LabelName[],
    datasetId: string,
    datasetRevision: number,
): ImageData[] => {
    const rawImages = arrayValue(workspace.images, 'images');
    if (rawImages.length > IMAGE_WORKSPACE_RESTORE_LIMITS.maxImages) {
        throw new Error('Image workspace exceeds the editor image-count limit');
    }
    if (rawImages.length !== files.length) throw new Error('Image workspace image count mismatch');
    const regionsByIndex = new Map<number, unknown[]>();
    rawImages.forEach((value, position) => {
        const raw = objectValue(value, `images[${position}]`);
        const index = integerValue(raw.index, `images[${position}].index`);
        if (index < 0 || index >= files.length || regionsByIndex.has(index)) {
            throw new Error('Invalid or duplicate image workspace index');
        }
        regionsByIndex.set(index, arrayValue(raw.regions, `images[${position}].regions`));
    });
    const validLabelIds = new Set(labels.map(label => label.id));
    const budget: WorkspaceRestoreBudget = {totalRegions: 0, totalVertices: 0};
    return files.map((file, index) => {
        const image = ImageDataUtil.createImageDataFromFileData(file);
        restoreAnnotations(
            image,
            regionsByIndex.get(index) || [],
            validLabelIds,
            datasetId,
            datasetRevision,
            assets[index].assetId,
            index,
            budget,
        );
        return image;
    });
};

const readError = async (response: Response): Promise<string> => {
    const body = await response.json().catch(() => ({}));
    return typeof body.detail === 'string' ? body.detail : `${response.status}`;
};

const loadWorkspaceZip = async (response: Response): Promise<JSZip> => {
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
        const declaredArchiveBytes = Number(contentLength);
        if (!Number.isSafeInteger(declaredArchiveBytes) || declaredArchiveBytes < 0) {
            throw new Error('Image workspace archive has an invalid Content-Length');
        }
        if (declaredArchiveBytes > IMAGE_WORKSPACE_RESTORE_LIMITS.maxArchiveBytes) {
            throw new Error('Image workspace archive exceeds the restore size limit');
        }
    }
    const archive = await response.blob();
    if (!Number.isSafeInteger(archive.size) || archive.size <= 0 ||
        archive.size > IMAGE_WORKSPACE_RESTORE_LIMITS.maxArchiveBytes) {
        throw new Error('Image workspace archive exceeds the restore size limit');
    }
    const zip = await JSZip.loadAsync(archive);
    if (Object.keys(zip.files).length > IMAGE_WORKSPACE_RESTORE_LIMITS.maxZipEntries) {
        throw new Error('Image workspace archive exceeds the entry-count limit');
    }
    return zip;
};

/** Legacy opensight-batch snapshots predate workspace.json and may safely use
 * the existing YOLO compatibility importer because they never persisted rich
 * polygon/mask workspace geometry. Corrupt modern workspaces use ordinary
 * errors and must not take that lossy fallback. */
export class ImageWorkspaceUnavailableError extends Error {
    public readonly code = 'IMAGE_WORKSPACE_UNAVAILABLE';

    public constructor() {
        super('Image dataset predates lossless workspace persistence');
        this.name = 'ImageWorkspaceUnavailableError';
    }
}

export class ImageDatasetRestoreService {
    public static async restore(
        datasetId: string,
        datasetName: string,
        datasetRevision: number,
        sourceId: string | null | undefined,
        currentImagesData: ImageData[],
    ): Promise<QueueItem> {
        const response = await fetch(
            `${getEngineBaseUrl()}/datasets/${encodeURIComponent(datasetId)}/export`,
        );
        if (!response.ok) throw new Error(await readError(response));
        const zip = await loadWorkspaceZip(response);
        const manifest = parseManifest(await readJson(
            zip,
            'manifest.json',
            IMAGE_WORKSPACE_RESTORE_LIMITS.maxManifestBytes,
        ));
        if (manifest.id !== datasetId || manifest.revision !== datasetRevision ||
            manifest.format !== 'opensight-batch') {
            throw new Error('Image workspace dataset identity or revision mismatch');
        }
        if (!zip.file('workspace.json')) throw new ImageWorkspaceUnavailableError();
        const workspace = await readJson(
            zip,
            'workspace.json',
            IMAGE_WORKSPACE_RESTORE_LIMITS.maxWorkspaceBytes,
        );
        const assets = await parseAssets(zip);
        if (assets.length !== manifest.imageCount) throw new Error('Image workspace manifest count mismatch');
        const files = await restoreFiles(zip, assets);
        const labels = parseLabels(workspace);
        const images = restoreImages(
            files,
            assets,
            workspace,
            labels,
            datasetId,
            datasetRevision,
        );

        const existing = store.getState().queue.items.find(item =>
            item.datasetId === datasetId || Boolean(sourceId && item.id === sourceId));
        const queueId = existing?.id || sourceId || uuidv4();
        const shared = {
            id: queueId,
            name: datasetName,
            status: QueueItemStatus.PENDING,
            uploadedAt: Date.now(),
            dataSyncStatus: QueueDataSyncStatus.SYNCED,
            datasetId,
            datasetRevision,
            syncedAt: Date.now(),
            ...(existing?.thumbnail ? {thumbnail: existing.thumbnail} : {}),
        };
        const item: QueueItem = files.length === 1
            ? {...shared, type: QueueItemType.IMAGE, file: files[0]}
            : {...shared, type: QueueItemType.FOLDER, files};

        // Do not let QueueActions save an active stale copy over this freshly
        // restored authoritative server snapshot.
        if (ImageRepository.getActiveFileId() === queueId) {
            ImageRepository.setActiveFileId(null);
        }
        ImageRepository.saveFileCache(queueId, images);
        if (existing) store.dispatch(updateQueueItem(existing.id, item));
        else store.dispatch(addQueueItem(item));
        store.dispatch(updateLabelNames(labels));
        store.dispatch(updateProjectData({
            ...store.getState().general.projectData,
            name: datasetName,
        }));
        await QueueActions.switchToQueueItem(item, currentImagesData);
        return item;
    }
}
