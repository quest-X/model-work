import React from 'react';
import {QueryGeometryInput} from '../../../services/QuerySnapshotService';
import {
    VisualSearchBBox,
    VisualSearchJobState,
    VisualSearchPolygon,
    VisualSearchResultItem,
    VisualSearchResultGeometry,
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
}

interface ResultCardProps extends ResultsProps {
    item: VisualSearchResultItem;
}

interface ResultMediaProps {
    item: VisualSearchResultItem;
    bbox: VisualSearchBBox | null | undefined;
    bboxResult: boolean;
    chinese: boolean;
}

const VisualSearchResultMedia: React.FC<ResultMediaProps> = ({
    item,
    bbox,
    bboxResult,
    chinese,
}) => <div className='vs-result-media'>
    {item.thumbnail
        ? <img src={item.thumbnail} alt={item.fileName}/>
        : <div className='vs-result-placeholder'>
            {chinese ? '无缩略图' : 'No preview'}
        </div>}
    {item.thumbnail && !bboxResult && item.width && item.height && <GeometryOverlay
        geometry={item.geometry}
        fallbackBbox={bbox}
        width={item.width}
        height={item.height}
    />}
    <span className='vs-rank'>#{item.rank}</span>
    <span className='vs-score'>{scoreLabel(item.score)}</span>
</div>;

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
}

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
                : (chinese ? '接受为标注框' : 'Accept bbox')}
    </button>}
</div>;

const VisualSearchResultCard: React.FC<ResultCardProps> = ({
    job,
    item,
    chinese,
    onAccept,
    acceptanceReason,
    acceptingResultId,
    acceptedResultIds,
}) => {
    const missingAcceptIdentity = !item.assetId || item.width === null || item.height === null;
    const bbox = item.geometry?.bbox ?? item.bbox;
    const bboxResult = job.snapshot.geometry.kind === 'bbox';
    const canAccept = bboxResult && !missingAcceptIdentity && Boolean(bbox);
    const kindLabel = bboxResult
        ? (chinese ? '框选结果 · 裁剪预览' : 'BBox result · crop preview')
        : (chinese ? '整图结果' : 'Full-image result');
    return <article className='vs-result-card'>
        <VisualSearchResultMedia
            item={item}
            bbox={bbox}
            bboxResult={bboxResult}
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
        />)}
    </div>;
};
