import React from 'react';
import {QueryGeometryInput} from '../../../services/QuerySnapshotService';
import {
    VisualSearchBBox,
    VisualSearchJobState,
    VisualSearchPolygon,
    VisualSearchResultItem,
    VisualSearchResultGeometry,
    VISUAL_SEARCH_MASK_RASTERIZER_REVISION,
} from '../../../store/visualSearch/types';

interface GeometryOverlayProps {
    geometry: QueryGeometryInput | VisualSearchResultGeometry | null;
    width: number;
    height: number;
    fallbackBbox?: VisualSearchBBox | null;
    testId?: string;
}

const usablePolygons = (
    value: unknown,
): ReadonlyArray<VisualSearchPolygon> => {
    if (!Array.isArray(value)) return [];
    return value.filter((polygon): polygon is VisualSearchPolygon =>
        Array.isArray(polygon) &&
        polygon.length >= 3 &&
        polygon.every(point =>
            Array.isArray(point) &&
            point.length === 2 &&
            point.every(coordinate => typeof coordinate === 'number')));
};

export const GeometryOverlay: React.FC<GeometryOverlayProps> = ({
    geometry,
    width,
    height,
    fallbackBbox,
    testId,
}) => {
    if (!geometry || width <= 0 || height <= 0 || geometry.kind === 'image') return null;
    const bbox = geometry.kind === 'bbox'
        ? geometry.bbox ?? fallbackBbox
        : fallbackBbox;
    const polygons = geometry.kind === 'mask'
        ? usablePolygons(geometry.polygons)
        : [];
    if (!bbox && polygons.length === 0) return null;
    return <svg
        className='vs-geometry-overlay'
        data-testid={testId}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio='xMidYMid meet'
        aria-hidden='true'
    >
        {bbox && <rect
            x={bbox[0]}
            y={bbox[1]}
            width={bbox[2] - bbox[0]}
            height={bbox[3] - bbox[1]}
            className='bbox'
        />}
        {polygons.map((polygon, index) => <polygon
            key={index}
            points={polygon.map(point => `${point[0]},${point[1]}`).join(' ')}
            className='mask'
        />)}
    </svg>;
};

interface QueryPreviewProps {
    previewUrl: string | null;
    width: number;
    height: number;
    geometry: QueryGeometryInput;
    alt: string;
    loading: boolean;
    error: string | null;
}

export const VisualSearchQueryPreview: React.FC<QueryPreviewProps> = ({
    previewUrl,
    width,
    height,
    geometry,
    alt,
    loading,
    error,
}) => <div className='vs-query-preview' data-testid='visual-search-query-preview'>
    {previewUrl && <>
        <img src={previewUrl} alt={alt}/>
        <GeometryOverlay
            geometry={geometry}
            width={width}
            height={height}
            testId='visual-search-query-overlay'
        />
    </>}
    {!previewUrl && <div className='vs-preview-placeholder'>
        {loading ? '…' : error || 'No source image'}
    </div>}
</div>;

const scoreLabel = (score: number): string =>
    score >= 0 && score <= 1 ? `${(score * 100).toFixed(1)}%` : score.toFixed(4);

interface ResultsProps {
    job: VisualSearchJobState;
    chinese: boolean;
    onAccept?: (item: VisualSearchResultItem) => void;
    acceptanceReason?: (item: VisualSearchResultItem) => string | null;
    acceptingResultId?: string | null;
    acceptedResultIds?: ReadonlySet<string>;
    seedCandidateStatus?: (item: VisualSearchResultItem) => 'candidate' | 'accepted' | 'rejected';
    seedDecision?: (item: VisualSearchResultItem) => 'positive' | 'negative' | null;
    onSeedDecision?: (item: VisualSearchResultItem, decision: 'positive' | 'negative') => void;
    seedBusy?: boolean;
}

interface ResultCardProps extends ResultsProps {
    item: VisualSearchResultItem;
}

interface ResultMediaProps {
    item: VisualSearchResultItem;
    resultKind: VisualSearchJobState['snapshot']['geometry']['kind'];
    chinese: boolean;
}

const VisualSearchResultMedia: React.FC<ResultMediaProps> = ({
    item,
    resultKind,
    chinese,
}) => {
    // Mask thumbnails retain the full-image coordinate space. Only bbox
    // thumbnails are cropped; never infer a mask crop without wire metadata.
    const maskGeometry = resultKind === 'mask' ? item.geometry : null;
    return <div className='vs-result-media'>
    {item.thumbnail
        ? <img src={item.thumbnail} alt={item.fileName}/>
        : <div className='vs-result-placeholder'>
            {chinese ? '无缩略图' : 'No preview'}
        </div>}
    {item.thumbnail && maskGeometry && item.width && item.height && <GeometryOverlay
        geometry={maskGeometry}
        width={item.width}
        height={item.height}
        testId='visual-search-result-mask-overlay'
    />}
    <span className='vs-rank'>#{item.rank}</span>
    <span className='vs-score'>{scoreLabel(item.score)}</span>
</div>;
};

interface ResultCopyProps {
    item: VisualSearchResultItem;
    bbox: VisualSearchBBox | null | undefined;
    kindLabel: string;
    missingAcceptIdentity: boolean;
    chinese: boolean;
    canAccept: boolean;
    acceptanceReason: string | null;
    accepting: boolean;
    accepted: boolean;
    onAccept?: () => void;
    resultKind: VisualSearchJobState['snapshot']['geometry']['kind'];
    seedCandidateStatus?: 'candidate' | 'accepted' | 'rejected';
    seedDecision?: 'positive' | 'negative' | null;
    onSeedDecision?: (decision: 'positive' | 'negative') => void;
    seedBusy?: boolean;
}

// Copy reflects terminal/identity/geometry/acceptance states without hiding a failure.
// eslint-disable-next-line complexity
const VisualSearchResultCopy: React.FC<ResultCopyProps> = ({
    item,
    bbox,
    kindLabel,
    missingAcceptIdentity,
    chinese,
    canAccept,
    acceptanceReason,
    accepting,
    accepted,
    onAccept,
    resultKind,
    seedCandidateStatus,
    seedDecision,
    onSeedDecision,
    seedBusy,
}) => <div className='vs-result-copy'>
    <strong title={item.fileName || item.path}>{item.fileName || item.path}</strong>
    <span>{kindLabel}</span>
    {bbox && <code>{bbox.map(value => Math.round(value)).join(', ')}</code>}
    <small title={item.resultId}>{item.resultId}</small>
    {missingAcceptIdentity && <em>
        {chinese
            ? '旧索引缺少资产身份或尺寸，仅允许预览'
            : 'Legacy index lacks asset identity or dimensions; preview only'}
    </em>}
    {canAccept && <button
        type='button'
        className='vs-accept-result'
        disabled={Boolean(acceptanceReason) || accepting || accepted}
        title={acceptanceReason ?? undefined}
        onClick={onAccept}
    >
        {accepted
            ? (chinese ? '已接受' : 'Accepted')
            : accepting
                ? (chinese ? '校验并写入…' : 'Verifying…')
                : resultKind === 'mask'
                    ? (chinese ? '接受为分割标注' : 'Accept mask')
            : (chinese ? '接受为标注框' : 'Accept bbox')}
    </button>}
    {resultKind !== 'image' && onSeedDecision && <div className='vs-seed-actions'>
        <button
            type='button'
            className={seedDecision === 'positive' || seedCandidateStatus === 'accepted'
                ? 'positive active'
                : 'positive'}
            disabled={seedBusy || seedCandidateStatus !== 'candidate'}
            onClick={() => onSeedDecision('positive')}
        >{seedCandidateStatus === 'accepted'
                ? (chinese ? '已是正种子' : 'Positive seed')
                : (chinese ? '作为正种子' : 'Use as seed')}</button>
        <button
            type='button'
            className={seedDecision === 'negative' || seedCandidateStatus === 'rejected'
                ? 'negative active'
                : 'negative'}
            disabled={seedBusy || seedCandidateStatus !== 'candidate'}
            onClick={() => onSeedDecision('negative')}
        >{seedCandidateStatus === 'rejected'
                ? (chinese ? '已排除' : 'Rejected')
                : (chinese ? '排除' : 'Reject')}</button>
    </div>}
</div>;

// Same-kind image/bbox/mask cards deliberately keep their contract branches explicit.
// eslint-disable-next-line complexity
const VisualSearchResultCard: React.FC<ResultCardProps> = ({
    job,
    item,
    chinese,
    onAccept,
    acceptanceReason,
    acceptingResultId,
    acceptedResultIds,
    seedCandidateStatus,
    seedDecision,
    onSeedDecision,
    seedBusy,
}) => {
    const resultKind = job.snapshot.geometry.kind;
    const missingMaskGeometry = resultKind === 'mask' && (
        !item.geometrySha256 ||
        !item.geometry?.mask ||
        !item.geometry.polygons?.length ||
        item.geometry.rasterizerRevision !== VISUAL_SEARCH_MASK_RASTERIZER_REVISION
    );
    const missingAcceptIdentity = !item.assetId || !item.contentSha256 ||
        item.width === null || item.height === null || missingMaskGeometry;
    const bbox = item.geometry?.bbox ?? item.bbox;
    const canAccept = (resultKind === 'bbox' || resultKind === 'mask') &&
        !missingAcceptIdentity && Boolean(bbox);
    const kindLabel = resultKind === 'bbox'
        ? (chinese ? '框选结果 · 裁剪预览' : 'BBox result · crop preview')
        : resultKind === 'mask'
            ? (chinese ? '掩码结果 · 裁剪预览' : 'Mask result · crop preview')
            : (chinese ? '整图结果' : 'Full-image result');
    return <article className='vs-result-card'>
        <VisualSearchResultMedia
            item={item}
            resultKind={resultKind}
            chinese={chinese}
        />
        <VisualSearchResultCopy
            item={item}
            bbox={bbox}
            kindLabel={kindLabel}
            missingAcceptIdentity={missingAcceptIdentity}
            chinese={chinese}
            canAccept={canAccept}
            acceptanceReason={canAccept ? acceptanceReason?.(item) ?? null : null}
            accepting={acceptingResultId === item.resultId}
            accepted={acceptedResultIds?.has(item.resultId) ?? false}
            onAccept={onAccept ? () => onAccept(item) : undefined}
            resultKind={resultKind}
            seedCandidateStatus={seedCandidateStatus?.(item)}
            seedDecision={seedDecision?.(item)}
            onSeedDecision={onSeedDecision
                ? decision => onSeedDecision(item, decision)
                : undefined}
            seedBusy={seedBusy}
        />
    </article>;
};

export const VisualSearchResults: React.FC<ResultsProps> = ({
    job,
    chinese,
    onAccept,
    acceptanceReason,
    acceptingResultId,
    acceptedResultIds,
    seedCandidateStatus,
    seedDecision,
    onSeedDecision,
    seedBusy,
}) => {
    const items = job.result?.items ?? [];
    if (job.status !== 'succeeded') return null;
    if (items.length === 0) {
        return <div className='vs-empty-results'>
            {chinese ? '任务完成，没有相似结果。' : 'The task completed with no similar results.'}
        </div>;
    }
    return <div className='vs-result-grid' aria-live='polite'>
        {items.map(item => <VisualSearchResultCard
            key={item.resultId}
            job={job}
            item={item}
            chinese={chinese}
            onAccept={onAccept}
            acceptanceReason={acceptanceReason}
            acceptingResultId={acceptingResultId}
            acceptedResultIds={acceptedResultIds}
            seedCandidateStatus={seedCandidateStatus}
            seedDecision={seedDecision}
            onSeedDecision={onSeedDecision}
            seedBusy={seedBusy}
        />)}
    </div>;
};
