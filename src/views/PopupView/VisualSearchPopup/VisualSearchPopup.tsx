import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {connect} from 'react-redux';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {ImageData} from '../../../store/labels/types';
import {QueueItem} from '../../../store/queue/types';
import {VideoData} from '../../../store/video/types';
import {ImageRepository} from '../../../logic/imageRepository/ImageRepository';
import {EditorModel} from '../../../staticModels/EditorModel';
import {FrameExtractorService} from '../../../services/FrameExtractorService';
import {
    QuerySnapshotPhase,
    QuerySnapshotInput,
    QuerySnapshotService,
} from '../../../services/QuerySnapshotService';
import {
    VisualSearchJobService,
    visualSearchJobService,
} from '../../../services/VisualSearchJobService';
import {
    VisualSearchJobState,
    VisualSearchResultItem,
    VisualSearchRevision,
} from '../../../store/visualSearch/types';
import {visualSearchSetActiveJob} from '../../../store/visualSearch/actionCreators';
import {
    collectionSupportsQuery,
    loadVisualSearchCollections,
    VisualSearchCollection,
    visualSearchCollectionLabel,
} from './VisualSearchCatalog';
import {
    deriveEditorVisualSearchQuery,
    EditorVisualSearchQuery,
    visualSearchKindLabel,
} from './VisualSearchGeometry';
import {
    VisualSearchQueryPreview,
    VisualSearchResults,
} from './VisualSearchPreview';
import {
    VisualSearchAcceptanceService,
    visualSearchAcceptanceService,
    visualSearchAcceptedRectId,
} from '../../../services/VisualSearchAcceptanceService';
import './VisualSearchPopup.scss';

export interface ResolvedVisualSearchSource {
    blob: Blob;
    previewUrl: string;
    width: number;
    height: number;
    release: () => void;
}

export interface VisualSearchSourceContext {
    activeImage: ImageData;
    activeImageIndex: number;
    isVideoMode: boolean;
    activeVideo: VideoData | null;
}

type SourceResolver = (
    context: VisualSearchSourceContext,
) => Promise<ResolvedVisualSearchSource>;
type SnapshotCapture = typeof QuerySnapshotService.capture;
type VisualSearchJobRunner = Pick<
    VisualSearchJobService,
    'start' | 'cancelByClientJobId'
>;
type VisualSearchAcceptanceRunner = Pick<VisualSearchAcceptanceService, 'accept'>;

interface StateProps {
    language: Language;
    activeImage: ImageData | null;
    activeImageIndex: number;
    activeLabelId: string | null;
    activeQueueItem: QueueItem | null;
    isVideoMode: boolean;
    activeVideo: VideoData | null;
    jobs: VisualSearchJobState[];
    activeJobId: string | null;
    acceptedRectIds: string[];
}

interface DispatchProps {
    selectJob: (clientJobId: string | null) => void;
}

interface OwnProps {
    collectionLoader?: typeof loadVisualSearchCollections;
    sourceResolver?: SourceResolver;
    snapshotCapture?: SnapshotCapture;
    jobRunner?: VisualSearchJobRunner;
    acceptanceRunner?: VisualSearchAcceptanceRunner;
    onClose?: () => void;
}

type Props = StateProps & DispatchProps & OwnProps;

const blobFromDrawable = async (
    drawable: CanvasImageSource,
    width: number,
    height: number,
): Promise<Blob> => {
    if (!width || !height) throw new Error('The current image has no usable dimensions');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas is unavailable for source capture');
    context.drawImage(drawable, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to copy current image pixels'));
        }, 'image/png');
    });
};

const blobFromRepository = async (imageData: ImageData): Promise<Blob> => {
    const image = ImageRepository.getById(imageData.id);
    if (!image || !image.src) throw new Error('The current image has no decoded pixels');
    return blobFromDrawable(
        image,
        image.naturalWidth || image.width,
        image.naturalHeight || image.height,
    );
};

const resolveEditorBlob = async (
    context: VisualSearchSourceContext,
): Promise<Blob> => {
    if (context.isVideoMode) {
        if (context.activeVideo?.isPlaying) {
            throw new Error('Pause the video before freezing a visual-search frame');
        }
        const extracted = context.activeVideo?.preExtractedFrames?.[context.activeImageIndex];
        if (extracted?.size) return extracted;
        const sessionId = context.activeVideo?.sessionId;
        if (sessionId) {
            const frames = await FrameExtractorService.fetchFrameRange(
                sessionId,
                context.activeImageIndex,
                1,
            );
            if (frames[0]?.size) return frames[0];
        }
        const video = EditorModel.videoElement;
        if (video?.videoWidth && video.videoHeight) {
            return blobFromDrawable(video, video.videoWidth, video.videoHeight);
        }
        const frameImage = EditorModel.videoFrameImage;
        if (frameImage?.src) {
            return blobFromDrawable(
                frameImage,
                frameImage.naturalWidth || frameImage.width,
                frameImage.naturalHeight || frameImage.height,
            );
        }
        throw new Error('The current video frame has no decoded pixels');
    }
    if (context.activeImage.fileData?.size > 0) return context.activeImage.fileData;
    return blobFromRepository(context.activeImage);
};

const sourceFileName = (
    image: ImageData,
    frameIndex: number,
    isVideoMode: boolean,
    mimeType: string,
): string => {
    const current = image.fileData?.name;
    if (!isVideoMode) return current || `image-${image.id}.png`;
    if (current && /\.(?:avif|bmp|gif|jpe?g|png|tiff?|webp)$/i.test(current)) return current;
    const extension = mimeType === 'image/jpeg'
        ? 'jpg'
        : mimeType === 'image/webp'
            ? 'webp'
            : 'png';
    return `frame_${String(frameIndex).padStart(6, '0')}.${extension}`;
};

const imageDimensions = async (
    blob: Blob,
    previewUrl: string,
): Promise<{width: number; height: number}> => {
    if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(blob);
        const dimensions = {width: bitmap.width, height: bitmap.height};
        bitmap.close();
        return dimensions;
    }
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({
            width: image.naturalWidth || image.width,
            height: image.naturalHeight || image.height,
        });
        image.onerror = () => reject(new Error('Failed to decode current image'));
        image.src = previewUrl;
    });
};

export const resolveVisualSearchSource: SourceResolver = async context => {
    const blob = await resolveEditorBlob(context);
    if (!blob.size) throw new Error('The current image/frame is empty');
    const previewUrl = URL.createObjectURL(blob);
    try {
        const dimensions = await imageDimensions(blob, previewUrl);
        if (!dimensions.width || !dimensions.height) {
            throw new Error('The current image has no usable dimensions');
        }
        return {
            blob,
            previewUrl,
            ...dimensions,
            release: () => URL.revokeObjectURL(previewUrl),
        };
    } catch (cause) {
        URL.revokeObjectURL(previewUrl);
        throw cause;
    }
};

const jobStatusLabel = (
    status: VisualSearchJobState['status'],
    chinese: boolean,
): string => {
    const labels: Record<VisualSearchJobState['status'], [string, string]> = {
        submitting: ['正在提交', 'Submitting'],
        queued: ['等待执行', 'Queued'],
        running: ['正在检索', 'Running'],
        succeeded: ['已完成', 'Completed'],
        failed: ['失败', 'Failed'],
        cancelled: ['已取消', 'Cancelled'],
    };
    return labels[status][chinese ? 0 : 1];
};

const capturePhaseLabel = (
    phase: QuerySnapshotPhase | null,
    chinese: boolean,
): string => {
    if (!phase) return '';
    const labels: Record<QuerySnapshotPhase, [string, string]> = {
        'resolving-source': ['读取原图', 'Reading source'],
        'copying-image': ['冻结像素', 'Freezing pixels'],
        'encoding-mask': ['编码掩码', 'Encoding mask'],
        'freezing-snapshot': ['冻结配置', 'Freezing config'],
        complete: ['提交任务', 'Submitting task'],
    };
    return labels[phase][chinese ? 0 : 1];
};

const errorText = (cause: unknown, fallback: string): string =>
    cause instanceof Error && cause.message ? cause.message : fallback;

const optionalDatasetBinding = (
    datasetId: string | null | undefined,
    datasetRevision: VisualSearchRevision | null | undefined,
): {datasetId?: string; datasetRevision?: VisualSearchRevision} => {
    if (!datasetId || datasetRevision === null || datasetRevision === undefined) return {};
    return {datasetId, datasetRevision};
};

interface SnapshotInputContext {
    activeImage: ImageData;
    activeImageIndex: number;
    activeQueueItem: QueueItem | null;
    activeVideo: VideoData | null;
    isVideoMode: boolean;
    source: ResolvedVisualSearchSource;
    selectedCollection: VisualSearchCollection;
    query: EditorVisualSearchQuery;
    topK: number;
    className: string;
}

const createSnapshotInput = ({
    activeImage,
    activeImageIndex,
    activeQueueItem,
    activeVideo,
    isVideoMode,
    source,
    selectedCollection,
    query,
    topK,
    className,
}: SnapshotInputContext): QuerySnapshotInput => ({
    imageBlob: source.blob,
    width: source.width,
    height: source.height,
    source: {
        imageId: activeImage.id,
        fileName: sourceFileName(
            activeImage,
            activeImageIndex,
            isVideoMode,
            source.blob.type,
        ),
        mediaKind: isVideoMode ? 'frame' : 'image',
        frameIndex: isVideoMode ? activeImageIndex : undefined,
        videoSessionId: isVideoMode ? activeVideo?.sessionId : undefined,
        ...optionalDatasetBinding(
            activeQueueItem?.datasetId,
            activeQueueItem?.datasetRevision,
        ),
    },
    profile: {
        id: selectedCollection.profileId,
        modelRevision: selectedCollection.modelRevision,
    },
    target: {
        collection: selectedCollection.name,
        collectionRevision: selectedCollection.collectionRevision,
        ...optionalDatasetBinding(
            selectedCollection.datasetId,
            selectedCollection.datasetRevision,
        ),
    },
    options: {
        topK,
        candidateK: Math.max(topK, Math.min(100, topK * 4)),
        className: query.kind === 'bbox' ? className : undefined,
    },
    geometry: query.geometry,
});

// This popup coordinates source capture, exact catalog binding and durable job
// history. The individual API, snapshot and task state machines remain in their
// dedicated services.
// eslint-disable-next-line complexity
export const VisualSearchPopup: React.FC<Props> = ({
    language,
    activeImage,
    activeImageIndex,
    activeLabelId,
    activeQueueItem,
    isVideoMode,
    activeVideo,
    jobs,
    activeJobId,
    acceptedRectIds = [],
    selectJob,
    collectionLoader = loadVisualSearchCollections,
    sourceResolver = resolveVisualSearchSource,
    snapshotCapture = QuerySnapshotService.capture,
    jobRunner = visualSearchJobService,
    acceptanceRunner = visualSearchAcceptanceService,
    onClose = PopupActions.close,
}) => {
    const chinese = language === Language.CHINESE;
    const t = useCallback(
        (zhText: string, enText: string) => chinese ? zhText : enText,
        [chinese],
    );
    // The editor can keep advancing video state behind a modal. Freeze one
    // coherent frame/annotation identity when the popup opens so preview and
    // submit never mix pixels from one frame with metadata from another.
    const [editorContext] = useState(() => ({
        activeImage,
        activeImageIndex,
        activeLabelId,
        activeQueueItem,
        isVideoMode,
        activeVideo,
    }));
    const {
        activeImage: queryImage,
        activeImageIndex: queryImageIndex,
        activeLabelId: queryLabelId,
        activeQueueItem: queryQueueItem,
        isVideoMode: queryIsVideoMode,
        activeVideo: queryVideo,
    } = editorContext;
    const query = useMemo(
        () => deriveEditorVisualSearchQuery(queryImage, queryLabelId),
        [queryImage, queryLabelId],
    );
    const [source, setSource] = useState<ResolvedVisualSearchSource | null>(null);
    const [sourceLoading, setSourceLoading] = useState(false);
    const [sourceError, setSourceError] = useState<string | null>(null);
    const [collections, setCollections] = useState<VisualSearchCollection[]>([]);
    const [collectionsLoading, setCollectionsLoading] = useState(false);
    const [collectionsError, setCollectionsError] = useState<string | null>(null);
    const [catalogRevision, setCatalogRevision] = useState(0);
    const [selectedCollectionName, setSelectedCollectionName] = useState('');
    const [topK, setTopK] = useState(12);
    const [className, setClassName] = useState('');
    const [capturePhase, setCapturePhase] = useState<QuerySnapshotPhase | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [acceptingResultId, setAcceptingResultId] = useState<string | null>(null);
    const [acceptanceError, setAcceptanceError] = useState<string | null>(null);
    const [acceptedThisSession, setAcceptedThisSession] = useState<string[]>([]);

    useEffect(() => {
        if (!queryImage) {
            setSource(null);
            setSourceError(t('编辑器中没有活动图片', 'No active editor image'));
            return undefined;
        }
        let disposed = false;
        let resolved: ResolvedVisualSearchSource | null = null;
        setSource(null);
        setSourceLoading(true);
        setSourceError(null);
        sourceResolver({
            activeImage: queryImage,
            activeImageIndex: queryImageIndex,
            isVideoMode: queryIsVideoMode,
            activeVideo: queryVideo,
        }).then(value => {
            resolved = value;
            if (disposed) {
                value.release();
                return;
            }
            setSource(value);
            setSourceLoading(false);
        }).catch(cause => {
            if (disposed) return;
            setSourceError(errorText(
                cause,
                t('无法读取当前原图或视频帧', 'Could not read the current image or frame'),
            ));
            setSourceLoading(false);
        });
        return () => {
            disposed = true;
            resolved?.release();
        };
    }, [
        queryImage,
        queryImageIndex,
        queryIsVideoMode,
        queryVideo,
        sourceResolver,
        t,
    ]);

    useEffect(() => {
        const controller = new AbortController();
        setCollectionsLoading(true);
        setCollectionsError(null);
        collectionLoader(controller.signal).then(value => {
            setCollections(value);
            setCollectionsLoading(false);
        }).catch(cause => {
            if (controller.signal.aborted) return;
            setCollectionsError(errorText(
                cause,
                t('向量版本读取失败', 'Failed to load vector versions'),
            ));
            setCollectionsLoading(false);
        });
        return () => controller.abort();
    }, [catalogRevision, collectionLoader, t]);

    const eligibleCollections = useMemo(
        () => collections.filter(collection => collectionSupportsQuery(collection, query.kind)),
        [collections, query.kind],
    );
    useEffect(() => {
        setSelectedCollectionName(current => {
            if (eligibleCollections.some(collection => collection.name === current)) return current;
            return eligibleCollections[0]?.name ?? '';
        });
    }, [eligibleCollections]);

    const selectedCollection = eligibleCollections.find(
        collection => collection.name === selectedCollectionName,
    ) ?? null;
    const activeJob = jobs.find(job => job.clientJobId === activeJobId) ?? jobs[0] ?? null;
    const acceptedResultIds = useMemo(() => {
        const acceptedIds = new Set(acceptedThisSession);
        if (!activeJob?.backendJobId) return acceptedIds;
        activeJob.result?.items.forEach(item => {
            if (acceptedRectIds.includes(
                visualSearchAcceptedRectId(activeJob.backendJobId as string, item.resultId),
            )) {
                acceptedIds.add(item.resultId);
            }
        });
        return acceptedIds;
    }, [acceptedRectIds, acceptedThisSession, activeJob]);
    const maskUnavailable = query.kind === 'mask';
    const canSubmit = Boolean(
        queryImage &&
        source &&
        selectedCollection &&
        !maskUnavailable &&
        !submitting,
    );

    const submit = async () => {
        if (!queryImage || !source || !selectedCollection || !canSubmit) return;
        setSubmitting(true);
        setSubmitError(null);
        setCapturePhase('resolving-source');
        try {
            const snapshot = await snapshotCapture(createSnapshotInput({
                activeImage: queryImage,
                activeImageIndex: queryImageIndex,
                activeQueueItem: queryQueueItem,
                activeVideo: queryVideo,
                isVideoMode: queryIsVideoMode,
                source,
                selectedCollection,
                query,
                topK,
                className,
            }), {
                onPhase: setCapturePhase,
            });
            const run = jobRunner.start(snapshot, {
                title: t('视觉检索', 'Visual search'),
                subtitle: `${visualSearchKindLabel(query.kind, chinese)} · ${selectedCollection.targetName} v${selectedCollection.version}`,
            });
            selectJob(run.clientJobId);
            void run.done.catch(() => undefined);
            setCapturePhase(null);
        } catch (cause) {
            setSubmitError(errorText(
                cause,
                t('视觉检索任务提交失败', 'Failed to submit visual search'),
            ));
        } finally {
            setSubmitting(false);
        }
    };

    const acceptanceBlockReason = (
        job: VisualSearchJobState,
        item: VisualSearchResultItem,
    ): string | null => {
        if (job.snapshot.geometry.kind !== 'bbox' || job.result?.queryKind !== 'bbox') {
            return t('仅 bbox → bbox 结果可接受', 'Only bbox → bbox results can be accepted');
        }
        if (isVideoMode) {
            return t('视频结果接受尚未启用', 'Acceptance is disabled for video frames');
        }
        const targetDatasetId = job.snapshot.target.datasetId;
        const targetRevision = job.snapshot.target.datasetRevision;
        if (!targetDatasetId || targetRevision === undefined || targetRevision === null) {
            return t(
                '目标版本缺少权威 dataset revision',
                'The target has no authoritative dataset revision',
            );
        }
        if (!activeQueueItem ||
            activeQueueItem.datasetId !== targetDatasetId ||
            String(activeQueueItem.datasetRevision) !== String(targetRevision)) {
            return t(
                '请先在文件队列打开目标数据集的精确版本',
                'Open the exact target dataset revision in the file queue first',
            );
        }
        if (item.datasetId !== targetDatasetId ||
            String(item.datasetRevision) !== String(targetRevision)) {
            return t(
                '结果 dataset revision 与冻结目标不一致',
                'The result dataset revision differs from the frozen target',
            );
        }
        if (!item.assetId || !item.contentSha256) {
            return t('结果缺少 SHA-256 资产身份', 'The result lacks SHA-256 asset identity');
        }
        return null;
    };

    const acceptResult = async (item: VisualSearchResultItem) => {
        if (!activeJob || acceptingResultId) return;
        setAcceptingResultId(item.resultId);
        setAcceptanceError(null);
        try {
            await acceptanceRunner.accept(activeJob.clientJobId, item.resultId);
            setAcceptedThisSession(current =>
                current.includes(item.resultId) ? current : [...current, item.resultId]);
        } catch (cause) {
            setAcceptanceError(errorText(
                cause,
                t('接受标注框失败', 'Failed to accept the bbox'),
            ));
        } finally {
            setAcceptingResultId(null);
        }
    };

    const renderInputPanel = () => <section className='vs-input-panel'>
        <header>
            <span>{t('查询快照', 'Query snapshot')}</span>
            <div className='vs-kind-contract'>
                <b>{visualSearchKindLabel(query.kind, chinese)}</b>
                <i>→</i>
                <b>{visualSearchKindLabel(query.kind, chinese)}</b>
            </div>
        </header>
        <VisualSearchQueryPreview
            previewUrl={source?.previewUrl ?? null}
            width={source?.width ?? 0}
            height={source?.height ?? 0}
            geometry={query.geometry}
            alt={queryImage?.fileData?.name || t('当前查询图', 'Current query')}
            loading={sourceLoading}
            error={sourceError}
        />
        <div className='vs-source-meta'>
            <strong>{queryImage?.fileData?.name || t('未选择图片', 'No image')}</strong>
            <span>{source ? `${source.width} × ${source.height}` : '—'}</span>
            <small>
                {query.annotationId
                    ? `${t('选中标注', 'Selected annotation')} · ${query.annotationId.slice(0, 8)}`
                    : t('未选中框或掩码，使用整图', 'No box or mask selected; using full image')}
            </small>
        </div>
        {maskUnavailable && <div className='vs-notice warning' role='status'>
            <strong>{t('掩码检索暂未启用', 'Mask search is not enabled yet')}</strong>
            <span>{t(
                '当前 DINO-only geometry stage 不具备真实掩码定位器。输入会保持为 mask，绝不会降级成整图；因此本轮禁止提交。',
                'The current DINO-only geometry stage has no real mask locator. The query remains a mask and will never silently fall back to an image, so submission is disabled.',
            )}</span>
        </div>}
    </section>;

    const renderConfigPanel = () => <section className='vs-config-panel'>
        <header>{t('同类型版本绑定', 'Same-kind version binding')}</header>
        <label>
            {t('场景 / 目标 / 版本 / Profile', 'Scene / target / version / profile')}
            <select
                aria-label={t('向量版本', 'Vector version')}
                value={selectedCollectionName}
                disabled={collectionsLoading || maskUnavailable}
                onChange={event => setSelectedCollectionName(event.target.value)}
            >
                {eligibleCollections.length === 0 && <option value=''>
                    {collectionsLoading
                        ? t('正在读取…', 'Loading…')
                        : t('没有同类型可用版本', 'No compatible same-kind version')}
                </option>}
                {eligibleCollections.map(collection => <option
                    key={collection.name}
                    value={collection.name}
                >
                    {visualSearchCollectionLabel(collection)}
                </option>)}
            </select>
        </label>
        {collectionsError && <div className='vs-inline-error' role='alert'>
            <span>{collectionsError}</span>
            <button type='button' onClick={() => setCatalogRevision(value => value + 1)}>
                {t('重试', 'Retry')}
            </button>
        </div>}
        {selectedCollection && <div className='vs-binding-card'>
            <div><span>Profile</span><strong>{selectedCollection.profileId}</strong></div>
            <div><span>Model revision</span><strong>
                {selectedCollection.modelRevision || t('提交时由服务端冻结', 'Pinned by server at submit')}
            </strong></div>
            <div><span>Collection revision</span><strong>
                {selectedCollection.collectionRevision ?? t('提交时由服务端冻结', 'Pinned by server at submit')}
            </strong></div>
            <div><span>{t('向量', 'Vectors')}</span><strong>{selectedCollection.count.toLocaleString()}</strong></div>
        </div>}
        <div className='vs-number-row'>
            <label>
                Top-K
                <input
                    type='number'
                    min={1}
                    max={100}
                    value={topK}
                    onChange={event => setTopK(Math.max(
                        1,
                        Math.min(100, Number(event.target.value) || 12),
                    ))}
                />
            </label>
            {query.kind === 'bbox' && <label>
                {t('类别筛选（可选）', 'Class filter (optional)')}
                <input
                    value={className}
                    onChange={event => setClassName(event.target.value)}
                />
            </label>}
        </div>
        <button
            type='button'
            className='vs-submit'
            data-testid='submit-visual-search'
            disabled={!canSubmit}
            onClick={submit}
        >
            {submitting
                ? capturePhaseLabel(capturePhase, chinese)
                : t('冻结快照并提交', 'Freeze snapshot and submit')}
        </button>
        {!maskUnavailable && !collectionsLoading && eligibleCollections.length === 0 && <p className='vs-help'>
            {t(
                `当前输入为${visualSearchKindLabel(query.kind, true)}，不会自动改用其他粒度。请先在向量数据库创建并入库同类型版本。`,
                `The input is ${visualSearchKindLabel(query.kind, false)}. Other granularities are never substituted; create and ingest a same-kind vector version first.`,
            )}
        </p>}
        {submitError && <div className='vs-notice error' role='alert'>{submitError}</div>}
    </section>;

    const renderJobList = () => <nav className='vs-job-list' aria-label={t('检索任务', 'Search jobs')}>
        <header>
            <span>{t('任务', 'Jobs')}</span>
            <small>{jobs.length}</small>
        </header>
        {jobs.length === 0 && <p>{t('尚未提交检索任务', 'No search jobs yet')}</p>}
        {jobs.map(job => <button
            type='button'
            key={job.clientJobId}
            className={job.clientJobId === activeJob?.clientJobId ? 'active' : ''}
            onClick={() => selectJob(job.clientJobId)}
        >
            <span className={`vs-job-dot ${job.status}`}/>
            <strong>{visualSearchKindLabel(job.snapshot.geometry.kind, chinese)}</strong>
            <small>{jobStatusLabel(job.status, chinese)}</small>
            <em>{new Date(job.createdAt).toLocaleTimeString()}</em>
        </button>)}
    </nav>;

    // Rendering keeps every terminal/running state explicit for operator review.
    // eslint-disable-next-line complexity
    const renderActiveJob = () => <section className='vs-job-detail'>
        {!activeJob && <div className='vs-empty-job'>
            <strong>{t('结果会在这里持续更新', 'Results will keep updating here')}</strong>
            <span>{t(
                '关闭弹窗不会取消任务；重新打开即可继续查看。',
                'Closing this popup does not cancel a task. Reopen it to continue.',
            )}</span>
        </div>}
        {activeJob && <>
            <header className='vs-job-header'>
                <div>
                    <strong>{jobStatusLabel(activeJob.status, chinese)}</strong>
                    <span>{activeJob.phase}</span>
                </div>
                {!activeJob.cancelRequested && (activeJob.status === 'submitting' ||
                    activeJob.status === 'queued' ||
                    activeJob.status === 'running') && <button
                    type='button'
                    onClick={() => void jobRunner.cancelByClientJobId(activeJob.clientJobId)}
                >
                    {t('取消任务', 'Cancel task')}
                </button>}
            </header>
            {(activeJob.status === 'submitting' ||
                activeJob.status === 'queued' ||
                activeJob.status === 'running') && <div className='vs-progress'>
                <i style={{width: `${activeJob.progress ?? 12}%`}}/>
            </div>}
            {activeJob.error && <div className='vs-notice error' role='alert'>
                <strong>{activeJob.error.code}</strong>
                <span>{activeJob.error.code === 'geometry_stage_unavailable'
                    ? t(
                        '几何阶段尚未提供该输入类型的真实定位能力，任务已明确失败且没有降级。',
                        'The geometry stage cannot localize this input type yet. The task failed explicitly and did not fall back.',
                    )
                    : activeJob.error.message}</span>
            </div>}
            <VisualSearchResults
                job={activeJob}
                chinese={chinese}
                onAccept={item => void acceptResult(item)}
                acceptanceReason={item => acceptanceBlockReason(activeJob, item)}
                acceptingResultId={acceptingResultId}
                acceptedResultIds={acceptedResultIds}
            />
            {acceptanceError && <div className='vs-notice error' role='alert'>
                {acceptanceError}
            </div>}
            {activeJob.status === 'succeeded' && <div className='vs-preview-only'>
                {activeJob.snapshot.geometry.kind === 'bbox'
                    ? t(
                        '仅 bbox → bbox 可原子接受；提交前会校验任务、资产 SHA-256 与 dataset revision，一次接受对应一次撤销。',
                        'Only bbox → bbox can be accepted atomically. Task identity, asset SHA-256, and dataset revision are checked before one acceptance creates one undo step.',
                    )
                    : t(
                        '整图结果保持预览/定位用途，不会写入标注。',
                        'Full-image results remain preview/navigation-only and never create annotations.',
                    )}
            </div>}
        </>}
    </section>;

    const content = () => <div className='VisualSearchPopupContent'>
        <div className='vs-contract-banner'>
            <div>
                <span>{t('编辑器本地查询', 'Editor-local query')}</span>
                <strong>{visualSearchKindLabel(query.kind, chinese)}</strong>
            </div>
            <i>→</i>
            <div>
                <span>{t('检索输出', 'Retrieval output')}</span>
                <strong>{visualSearchKindLabel(query.kind, chinese)}</strong>
            </div>
            <p>{t(
                '快照绑定当前像素、几何、Profile 与版本；服务端不会静默迁移到 latest。',
                'The snapshot binds pixels, geometry, profile, and version. The server never silently migrates to latest.',
            )}</p>
        </div>
        <div className='vs-query-workspace'>
            {renderInputPanel()}
            {renderConfigPanel()}
        </div>
        <div className='vs-results-workspace'>
            {renderJobList()}
            {renderActiveJob()}
        </div>
    </div>;

    return <GenericYesNoPopup
        title={t('视觉检索 · 快照任务', 'Visual Search · Snapshot Jobs')}
        renderContent={content}
        skipAcceptButton
        rejectLabel={t('关闭（任务继续）', 'Close (task continues)')}
        onReject={onClose}
    />;
};

const mapStateToProps = (state: AppState): StateProps => {
    const activeImageIndex = state.video.isVideoMode && state.video.activeVideo
        ? state.video.activeVideo.currentFrame
        : state.labels.activeImageIndex;
    const activeImage = state.labels.imagesData[activeImageIndex] ?? null;
    const activeQueueItem = state.queue.items.find(
        item => item.id === state.queue.activeQueueItemId,
    ) ?? null;
    return {
        language: state.general.language,
        activeImage,
        activeImageIndex,
        activeLabelId: state.labels.activeLabelId,
        activeQueueItem,
        isVideoMode: state.video.isVideoMode,
        activeVideo: state.video.activeVideo,
        jobs: state.visualSearch.jobOrder
            .map(id => state.visualSearch.jobsById[id])
            .filter(Boolean),
        activeJobId: state.visualSearch.activeJobId,
        acceptedRectIds: state.labels.imagesData.flatMap(image =>
            image.labelRects
                .map(rect => rect.id)
                .filter(id => id.startsWith('visual-search:'))),
    };
};

const mapDispatchToProps: DispatchProps = {
    selectJob: visualSearchSetActiveJob,
};

export default connect<
    StateProps,
    DispatchProps,
    OwnProps,
    AppState
>(mapStateToProps, mapDispatchToProps)(VisualSearchPopup);
