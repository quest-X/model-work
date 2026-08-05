import {store} from '../index';
import {QuerySnapshotService} from './QuerySnapshotService';
import {visualSearchAcceptanceService} from './VisualSearchAcceptanceService';
import {visualSearchJobService} from './VisualSearchJobService';
import {
    createVisualSearchSnapshotInput,
    resolveVisualSearchSource,
} from '../views/PopupView/VisualSearchPopup/VisualSearchPopup';
import {
    collectionSupportsQuery,
    loadVisualSearchCollections,
} from '../views/PopupView/VisualSearchPopup/VisualSearchCatalog';
import {deriveEditorVisualSearchQuery} from '../views/PopupView/VisualSearchPopup/VisualSearchGeometry';
import {SmartAnnotationActions} from '../logic/actions/SmartAnnotationActions';
import {updateActiveLabelId} from '../store/labels/actionCreators';

export interface DirectVisualSearchOptions {
    collectionName: string;
    topK?: number;
}

export interface DirectVisualSearchResult {
    returned: number;
    accepted: number;
    rejected: number;
}

/**
 * Runs the snapshot-based visual-search pipeline without opening its inspection
 * popup, then accepts every exact result geometry into the matching loaded asset.
 */
export const runDirectVisualSearch = async ({
    collectionName,
    topK = 12,
}: DirectVisualSearchOptions): Promise<DirectVisualSearchResult> => {
    let initial = store.getState();
    const activeImageIndex = initial.video.isVideoMode && initial.video.activeVideo
        ? initial.video.activeVideo.currentFrame
        : initial.labels.activeImageIndex;
    let activeImage = initial.labels.imagesData[activeImageIndex] ?? null;
    if (!activeImage) throw new Error('当前没有可检索的图片或视频帧');

    let query = deriveEditorVisualSearchQuery(activeImage, initial.labels.activeLabelId);
    if (query.kind === 'image') {
        const selectedPoint = activeImage.labelPoints.find(
            point => point.id === initial.labels.activeLabelId,
        );
        if (selectedPoint) SmartAnnotationActions.addPoint(selectedPoint.point);
        const promptCount = SmartAnnotationActions.getPromptRects(activeImage).length
            + (selectedPoint ? 1 : 0);
        if (promptCount > 0) {
            const previousPolygonIds = new Set(activeImage.labelPolygons.map(item => item.id));
            await SmartAnnotationActions.runAllPrompts();
            initial = store.getState();
            activeImage = initial.labels.imagesData[activeImageIndex] ?? null;
            const seedMask = activeImage?.labelPolygons.find(
                item => !previousPolygonIds.has(item.id),
            );
            if (activeImage && seedMask) {
                store.dispatch(updateActiveLabelId(seedMask.id));
                query = deriveEditorVisualSearchQuery(activeImage, seedMask.id);
            }
        }
    }
    if (query.kind === 'image') {
        throw new Error('请先选中 bbox/mask，或用 point 生成 seed mask');
    }

    const collections = await loadVisualSearchCollections();
    const selectedCollection = collections.find(item => item.name === collectionName);
    if (!selectedCollection) throw new Error(`向量数据库不存在：${collectionName}`);
    if (!collectionSupportsQuery(selectedCollection, query.kind)) {
        throw new Error(`向量数据库不支持 ${query.kind} 检索，或当前没有可检索向量`);
    }

    const activeQueueItem = initial.queue.items.find(
        item => item.id === initial.queue.activeQueueItemId,
    ) ?? null;
    const className = initial.labels.labels.find(label => label.id === query.labelId)?.name;
    const targetDatasetId = selectedCollection.datasetId ?? activeQueueItem?.datasetId ?? null;
    const targetDatasetRevision = selectedCollection.datasetRevision
        ?? (targetDatasetId ? selectedCollection.datasetRevisions[targetDatasetId] : null)
        ?? null;
    if (!targetDatasetId || targetDatasetRevision === null) {
        throw new Error('所选向量数据库没有当前数据集的权威版本，请重新入库');
    }
    const boundCollection = {
        ...selectedCollection,
        datasetId: targetDatasetId,
        datasetRevision: targetDatasetRevision,
    };
    const source = await resolveVisualSearchSource({
        activeImage,
        activeImageIndex,
        isVideoMode: initial.video.isVideoMode,
        activeVideo: initial.video.activeVideo,
    });

    try {
        const snapshot = await QuerySnapshotService.capture(createVisualSearchSnapshotInput({
            activeImage,
            activeImageIndex,
            activeQueueItem,
            activeVideo: initial.video.activeVideo,
            isVideoMode: initial.video.isVideoMode,
            source,
            selectedCollection: boundCollection,
            query,
            topK,
            className,
        }));
        const run = visualSearchJobService.start(snapshot, {
            title: '视觉检索',
            subtitle: selectedCollection.displayName,
        });
        const remote = await run.done;
        if (remote.state !== 'succeeded') {
            throw new Error(remote.error?.message || `视觉检索任务状态：${remote.state}`);
        }

        const job = store.getState().visualSearch.jobsById[run.clientJobId];
        const items = job?.result?.items ?? [];
        let accepted = 0;
        const failures: string[] = [];
        for (const item of items) {
            try {
                // Keep acceptance sequential: it verifies the exact target asset
                // digest and may decode canonical masks for each result.
                // eslint-disable-next-line no-await-in-loop
                await visualSearchAcceptanceService.accept(run.clientJobId, item.resultId);
                accepted += 1;
            } catch (cause) {
                failures.push(cause instanceof Error ? cause.message : String(cause));
            }
        }
        if (items.length === 0) {
            throw new Error('没有检索到相似目标');
        }
        if (accepted === 0) {
            throw new Error(failures[0] || '检索结果没有可写回的精确 bbox 或 mask');
        }
        return {
            returned: items.length,
            accepted,
            rejected: items.length - accepted,
        };
    } finally {
        source.release();
    }
};
