import React from 'react';
import './InferenceResultsView.scss';
import {connect, shallowEqual} from 'react-redux';
import {AppState} from '../../../store';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {SegmentationResult} from '../../../store/ai/types';
import {ImageData, LabelName, LabelPolygon} from '../../../store/labels/types';
import {updateSegmentationResults as updateSegmentationResultsAction} from '../../../store/ai/actionCreators';
import {updateActiveLabelId as updateActiveLabelIdAction} from '../../../store/labels/actionCreators';
import {LabelActions} from '../../../logic/actions/LabelActions';
import {EditorActions} from '../../../logic/actions/EditorActions';
import {EditorModel} from '../../../staticModels/EditorModel';
import {inferenceThumbnailCache} from '../../../utils/InferenceThumbnailCache';

type DisplayResult = SegmentationResult & {
    _labelRectId?: string;
    _labelPolygonId?: string;
};

const THUMBNAIL_SIZE = 60;
const THUMBNAIL_CONCURRENCY = 3;

// 把 labelPolygons（分割标注）映射成展示用结构，兜底 segmentationResults Map 为空的情况
// 返回 shape 与 SegmentationAPIDetector.convertToUnifiedFormat 一致
function polygonsToDisplay(polys: LabelPolygon[], labelNames: LabelName[]): DisplayResult[] {
    return polys.map((p, idx) => {
        const labelName = labelNames.find(ln => ln.id === p.labelId);
        const name = labelName?.name || p.suggestedLabel || 'unknown';
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        const maskData: [number, number][] = [];
        for (const v of p.vertices) {
            if (v.x < x1) x1 = v.x;
            if (v.y < y1) y1 = v.y;
            if (v.x > x2) x2 = v.x;
            if (v.y > y2) y2 = v.y;
            maskData.push([v.x, v.y]);
        }
        if (!isFinite(x1)) { x1 = y1 = x2 = y2 = 0; }
        // Shoelace area
        let area = 0;
        for (let i = 0; i < maskData.length; i++) {
            const [ax, ay] = maskData[i];
            const [bx, by] = maskData[(i + 1) % maskData.length];
            area += ax * by - bx * ay;
        }
        area = Math.abs(area) / 2;
        return {
            class_id: idx,
            class_name: name,
            confidence: p.confidence || 0,
            info: { id: idx, name, confidence: p.confidence || 0 },
            bbox: { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 },
            mask: { area, mask_data: maskData },
            _labelPolygonId: p.id,
        };
    });
}

function getThumbnailKey(imageId: string, result: DisplayResult): string {
    const linkedAnnotationId = result._labelRectId || result._labelPolygonId;
    const className = (result.info?.name || result.class_name || 'unknown').trim().toLowerCase();
    const {x1, y1, x2, y2} = result.bbox;
    const geometryKey = `${x1},${y1},${x2},${y2},${result.mask?.area || 0}`;
    return `${imageId}:${linkedAnnotationId || `${className}:${geometryKey}`}`;
}

function getReadyFrameSource(): CanvasImageSource | null {
    const frameImage = EditorModel.videoFrameImage;
    if (frameImage && (frameImage.naturalWidth > 0 || frameImage.width > 0)) return frameImage;

    const videoCanvas = document.querySelector('.VideoCanvas') as HTMLCanvasElement | null;
    if (videoCanvas && videoCanvas.width > 0 && videoCanvas.height > 0) return videoCanvas;

    const video = EditorModel.videoElement || document.querySelector('video');
    if (video && video.readyState >= 2 && video.videoWidth > 0) return video;
    return null;
}

async function resolveThumbnailSource(
    imageData: ImageData,
    isCancelled: () => boolean
): Promise<CanvasImageSource | null> {
    const fileData = imageData.fileData;
    if (!fileData) return null;

    const isVideo = fileData.type?.startsWith('video/') ||
        /\.(mp4|webm|mov|avi|mkv)$/i.test(fileData.name || '');
    const isOnDemandFrame = fileData instanceof File &&
        fileData.size === 0 &&
        !!EditorModel.videoSessionId;

    if (isVideo || isOnDemandFrame) {
        // Frame extraction and React state commit are asynchronous. Wait for the
        // native-resolution source instead of permanently memoizing an early miss.
        const waitForFrameSource = async (attempt: number): Promise<CanvasImageSource | null> => {
            if (isCancelled() || attempt >= 20) return null;
            const source = getReadyFrameSource();
            if (source) return source;
            await new Promise(resolve => setTimeout(resolve, 150));
            return waitForFrameSource(attempt + 1);
        };
        return waitForFrameSource(0);
    }

    return new Promise<CanvasImageSource | null>((resolve) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        let objectUrl: string | null = null;
        const finish = (source: CanvasImageSource | null) => {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            resolve(isCancelled() ? null : source);
        };
        image.onload = () => finish(image);
        image.onerror = () => finish(null);

        if (typeof fileData === 'string') {
            image.src = fileData;
        } else if (fileData instanceof File || fileData instanceof Blob) {
            objectUrl = URL.createObjectURL(fileData);
            image.src = objectUrl;
        } else {
            finish(null);
        }
    });
}

function cropThumbnail(source: CanvasImageSource, result: DisplayResult): Promise<Blob | null> {
    return new Promise(resolve => {
        try {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) {
                resolve(null);
                return;
            }

            canvas.width = THUMBNAIL_SIZE;
            canvas.height = THUMBNAIL_SIZE;
            const {x1, y1, x2, y2} = result.bbox;
            const width = x2 - x1;
            const height = y2 - y1;
            if (width <= 0 || height <= 0) {
                resolve(null);
                return;
            }

            const maskPolygon: [number, number][] | undefined =
                Array.isArray(result.mask) ? result.mask
                : result.mask?.mask_data ? result.mask.mask_data
                : undefined;

            if (maskPolygon && maskPolygon.length > 2) {
                context.fillStyle = '#000';
                context.fillRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
                context.save();
                context.beginPath();
                const scaleX = THUMBNAIL_SIZE / width;
                const scaleY = THUMBNAIL_SIZE / height;
                maskPolygon.forEach(([maskX, maskY], index) => {
                    const canvasX = (maskX - x1) * scaleX;
                    const canvasY = (maskY - y1) * scaleY;
                    if (index === 0) context.moveTo(canvasX, canvasY);
                    else context.lineTo(canvasX, canvasY);
                });
                context.closePath();
                context.clip();
                context.drawImage(
                    source,
                    x1,
                    y1,
                    width,
                    height,
                    0,
                    0,
                    THUMBNAIL_SIZE,
                    THUMBNAIL_SIZE
                );
                context.restore();
            } else {
                context.drawImage(
                    source,
                    x1,
                    y1,
                    width,
                    height,
                    0,
                    0,
                    THUMBNAIL_SIZE,
                    THUMBNAIL_SIZE
                );
            }

            canvas.toBlob(resolve, 'image/jpeg', 0.84);
        } catch {
            resolve(null);
        }
    });
}

function renderThumbnail(
    thumbnailUrl: string | undefined,
    hasFileData: boolean,
    thumbnailFailed: boolean,
    alt: string
): React.ReactNode {
    if (thumbnailUrl) {
        return <img src={thumbnailUrl} alt={alt} className="ThumbnailImage"/>;
    }
    if (hasFileData && !thumbnailFailed) {
        return <div className="LoadingThumbnail"><span>⏳</span></div>;
    }
    return <div className="NoThumbnail"><span>📷</span></div>;
}

interface IProps {
    language: Language;
    suggestedLabelList: string[];
    segmentationResults: SegmentationResult[];
    activeImageData: ImageData | null;
    labelNames: LabelName[];
    isVideoMode: boolean;
    updateSegmentationResults: (results: SegmentationResult[]) => void;
    updateActiveLabelId: (activeLabelId: string | null) => void;
}

const InferenceResultsView: React.FC<IProps> = ({language, suggestedLabelList, segmentationResults, activeImageData, labelNames, isVideoMode, updateSegmentationResults, updateActiveLabelId}) => {
    const currentTexts = LanguageConfig[language];
    const zh = language === Language.CHINESE;

    const [activeTab, setActiveTab] = React.useState<'all' | 'detect' | 'segment'>('all');

    const handleDeleteSegmentationResult = (result: SegmentationResult, index: number) => {
        const newSegmentationResults = segmentationResults.filter((_, i) => i !== index);
        updateSegmentationResults(newSegmentationResults, activeImageData?.id);

        if (!activeImageData) return;

        const resultName = (result.info?.name || result.class_name).toLowerCase();
        const resultCenterX = result.bbox.x1 + result.bbox.width / 2;
        const resultCenterY = result.bbox.y1 + result.bbox.height / 2;

        // ── 分割结果（有 mask）→ 删对应的 labelPolygon ──
        if (result.mask) {
            const candidates = activeImageData.labelPolygons.filter(polygon => {
                if (!polygon.isCreatedByAI) return false;
                const labelName = labelNames.find(ln => ln.id === polygon.labelId);
                if (labelName && labelName.name.toLowerCase() === resultName) return true;
                if (polygon.suggestedLabel && polygon.suggestedLabel.toLowerCase() === resultName) return true;
                return false;
            });
            if (candidates.length > 0) {
                let bestMatch = candidates[0];
                let minDistance = Number.MAX_VALUE;
                candidates.forEach(polygon => {
                    if (polygon.vertices.length === 0) return;
                    const cx = polygon.vertices.reduce((s, v) => s + v.x, 0) / polygon.vertices.length;
                    const cy = polygon.vertices.reduce((s, v) => s + v.y, 0) / polygon.vertices.length;
                    const d = Math.sqrt(Math.pow(resultCenterX - cx, 2) + Math.pow(resultCenterY - cy, 2));
                    if (d < minDistance) { minDistance = d; bestMatch = polygon; }
                });
                LabelActions.deletePolygonLabelById(activeImageData.id, bestMatch.id);
                EditorActions.fullRender();
            }
            return;
        }

        // ── 检测结果（_labelRectId 直接对应 labelRect）→ 直接删 ──
        if ((result as any)._labelRectId) {
            LabelActions.deleteRectLabelById(activeImageData.id, (result as any)._labelRectId);
            return;
        }

        // ── 普通检测结果 → 按类名 + bbox 重心距离匹配 labelRect ──
        const candidateLabelRects = activeImageData.labelRects.filter(labelRect => {
            if (!labelRect.isCreatedByAI) return false;
            const labelName = labelNames.find(ln => ln.id === labelRect.labelId);
            if (labelName && labelName.name.toLowerCase() === resultName) return true;
            if (labelRect.suggestedLabel && labelRect.suggestedLabel.toLowerCase() === resultName) return true;
            return false;
        });
        if (candidateLabelRects.length > 0) {
            let bestMatch = candidateLabelRects[0];
            let minDistance = Number.MAX_VALUE;
            candidateLabelRects.forEach(labelRect => {
                const rectCenterX = labelRect.rect.x + labelRect.rect.width / 2;
                const rectCenterY = labelRect.rect.y + labelRect.rect.height / 2;
                const d = Math.sqrt(Math.pow(resultCenterX - rectCenterX, 2) + Math.pow(resultCenterY - rectCenterY, 2));
                if (d < minDistance) { minDistance = d; bestMatch = labelRect; }
            });
            LabelActions.deleteRectLabelById(activeImageData.id, bestMatch.id);
        }
    };

    /** 返回与 result 最匹配的标注对象的 ID（labelPolygon 或 labelRect），找不到返回 null */
    const findBestMatchingLabelId = (result: SegmentationResult): string | null => {
        if (!activeImageData) return null;
        const resultName = (result.info?.name || result.class_name).toLowerCase();
        const resultCenterX = result.bbox.x1 + result.bbox.width / 2;
        const resultCenterY = result.bbox.y1 + result.bbox.height / 2;

        // 分割结果 → 找 labelPolygon
        if (result.mask) {
            const candidates = activeImageData.labelPolygons.filter(polygon => {
                if (!polygon.isCreatedByAI) return false;
                const labelName = labelNames.find(ln => ln.id === polygon.labelId);
                if (labelName && labelName.name.toLowerCase() === resultName) return true;
                if (polygon.suggestedLabel && polygon.suggestedLabel.toLowerCase() === resultName) return true;
                return false;
            });
            if (candidates.length === 0) return null;
            let best = candidates[0];
            let minD = Number.MAX_VALUE;
            candidates.forEach(polygon => {
                if (polygon.vertices.length === 0) return;
                const cx = polygon.vertices.reduce((s, v) => s + v.x, 0) / polygon.vertices.length;
                const cy = polygon.vertices.reduce((s, v) => s + v.y, 0) / polygon.vertices.length;
                const d = Math.sqrt(Math.pow(resultCenterX - cx, 2) + Math.pow(resultCenterY - cy, 2));
                if (d < minD) { minD = d; best = polygon; }
            });
            return best.id;
        }

        // 检测结果（_labelRectId 直接对应）
        if ((result as any)._labelRectId) return (result as any)._labelRectId;

        // 普通检测结果 → 找 labelRect
        const candidateLabelRects = activeImageData.labelRects.filter(labelRect => {
            if (!labelRect.isCreatedByAI) return false;
            const labelName = labelNames.find(ln => ln.id === labelRect.labelId);
            if (labelName && labelName.name.toLowerCase() === resultName) return true;
            if (labelRect.suggestedLabel && labelRect.suggestedLabel.toLowerCase() === resultName) return true;
            return false;
        });
        if (candidateLabelRects.length === 0) return null;
        let bestRect = candidateLabelRects[0];
        let minD = Number.MAX_VALUE;
        candidateLabelRects.forEach(labelRect => {
            const rectCenterX = labelRect.rect.x + labelRect.rect.width / 2;
            const rectCenterY = labelRect.rect.y + labelRect.rect.height / 2;
            const d = Math.sqrt(Math.pow(resultCenterX - rectCenterX, 2) + Math.pow(resultCenterY - rectCenterY, 2));
            if (d < minD) { minD = d; bestRect = labelRect; }
        });
        return bestRect.id;
    };

    const handleClickSegmentationResult = (result: SegmentationResult, index: number) => {
        updateActiveLabelId(findBestMatchingLabelId(result));
    };

    const handleMouseEnterSegmentationResult = (result: SegmentationResult, index: number) => {
        const id = findBestMatchingLabelId(result);
        if (id) updateActiveLabelId(id);
    };

    const handleMouseLeaveSegmentationResult = () => {
        updateActiveLabelId(null);
    };

    const getLabelColor = (className: string): string => {
        if (!className) return '#00c2ff';
        const matchingLabel = labelNames.find(label => label?.name?.toLowerCase() === className.toLowerCase());
        return matchingLabel?.color || '#00c2ff';
    };

    const getConfidenceColor = (confidence: number): string => {
        const pct = confidence * 100;
        if (pct >= 80) return '#28a745';
        if (pct >= 60) return '#ffc107';
        return '#dc3545';
    };

    const getConfidenceBackgroundColor = (confidence: number): string => {
        const pct = confidence * 100;
        if (pct >= 80) return 'rgba(40, 167, 69, 0.2)';
        if (pct >= 60) return 'rgba(255, 193, 7, 0.2)';
        return 'rgba(220, 53, 69, 0.2)';
    };

    const currentLabelIds = React.useMemo(
        () => new Set(labelNames.map(labelName => labelName.id)),
        [labelNames]
    );
    const currentLabelNames = React.useMemo(
        () => new Set(labelNames.map(labelName => labelName.name.trim().toLowerCase()).filter(Boolean)),
        [labelNames]
    );
    const matchesCurrentLabel = React.useCallback((labelId: string | null, suggestedLabel?: string) => {
        if (labelId && currentLabelIds.has(labelId)) return true;
        const normalizedSuggestedLabel = suggestedLabel?.trim().toLowerCase();
        return !!normalizedSuggestedLabel && currentLabelNames.has(normalizedSuggestedLabel);
    }, [currentLabelIds, currentLabelNames]);

    // 检测结果：从 labelRects 读取 AI 创建且仍对应现有类别的矩形
    const allDetResults = React.useMemo(() => {
        if (!activeImageData) return [];
        const aiRects = activeImageData.labelRects.filter(
            rect => rect.isCreatedByAI && matchesCurrentLabel(rect.labelId, rect.suggestedLabel)
        );
        return aiRects.map((rect, idx) => {
            const name = labelNames.find(ln => ln.id === rect.labelId)?.name || rect.suggestedLabel || 'unknown';
            return {
                class_id: idx,
                class_name: name,
                confidence: rect.confidence || 0,
                info: { id: idx, name, confidence: rect.confidence || 0 },
                bbox: { x1: rect.rect.x, y1: rect.rect.y, x2: rect.rect.x + rect.rect.width, y2: rect.rect.y + rect.rect.height, width: rect.rect.width, height: rect.rect.height },
                mask: null,
                _labelRectId: rect.id,
            };
        });
    }, [activeImageData, labelNames, matchesCurrentLabel]);

    // 分割结果：优先 Redux 缓存；过滤已删除/已改名类别后再回退 labelPolygons
    const allSegResults = React.useMemo(() => {
        const currentCachedResults = segmentationResults.filter(result => {
            const className = (result.info?.name || result.class_name || '').trim().toLowerCase();
            // Detection is already represented by labelRects. Keeping mask-less
            // cached detections here produced duplicate cards and duplicate crops.
            return !!result.mask && currentLabelNames.has(className);
        });
        if (currentCachedResults.length > 0) return currentCachedResults;
        if (!activeImageData) return [];
        const aiPolys = activeImageData.labelPolygons.filter(
            polygon => polygon.isCreatedByAI && matchesCurrentLabel(polygon.labelId, polygon.suggestedLabel)
        );
        return aiPolys.length > 0 ? polygonsToDisplay(aiPolys, labelNames) : [];
    }, [segmentationResults, activeImageData, labelNames, currentLabelNames, matchesCurrentLabel]);

    // 合并并按 activeTab 过滤
    const displayResults = React.useMemo(() => {
        const all = [...allSegResults, ...allDetResults];
        if (activeTab === 'detect') return all.filter(r => !r.mask);
        if (activeTab === 'segment') return all.filter(r => !!r.mask);
        return all;
    }, [allSegResults, allDetResults, activeTab]);

    const hasDet = allDetResults.length > 0;
    const hasSeg = allSegResults.length > 0;
    const showTabs = hasDet && hasSeg;

    const [thumbnails, setThumbnails] = React.useState<Record<string, string>>({});
    const [failedThumbnailKeys, setFailedThumbnailKeys] = React.useState<Record<string, boolean>>({});
    const imageId = activeImageData?.id;

    React.useEffect(() => {
        setActiveTab('all');
    }, [imageId]);

    React.useEffect(() => {
        if (!imageId || !activeImageData || displayResults.length === 0) {
            setThumbnails({});
            setFailedThumbnailKeys({});
            return;
        }

        let cancelled = false;
        const thumbnailJobs = displayResults.map(result => {
            const displayResult = result as DisplayResult;
            return {
                result: displayResult,
                key: getThumbnailKey(imageId, displayResult),
            };
        });
        const cachedThumbnails: Record<string, string> = {};
        const uncachedJobs = thumbnailJobs.filter(job => {
            const cachedUrl = inferenceThumbnailCache.get(job.key);
            if (!cachedUrl) return true;
            cachedThumbnails[job.key] = cachedUrl;
            return false;
        });
        setThumbnails(cachedThumbnails);
        setFailedThumbnailKeys({});

        if (uncachedJobs.length === 0) {
            return;
        }

        const generateMissingThumbnails = async () => {
            const source = await resolveThumbnailSource(activeImageData, () => cancelled);
            if (cancelled) return;
            if (!source) {
                const failures = Object.fromEntries(uncachedJobs.map(job => [job.key, true]));
                setFailedThumbnailKeys(failures);
                return;
            }

            let cursor = 0;
            const worker = async (): Promise<void> => {
                if (cancelled || cursor >= uncachedJobs.length) return;
                const job = uncachedJobs[cursor++];
                const url = await inferenceThumbnailCache.getOrCreate(
                    job.key,
                    () => cropThumbnail(source, job.result)
                );
                if (cancelled) return;
                if (url) {
                    setThumbnails(previous => ({...previous, [job.key]: url}));
                } else {
                    setFailedThumbnailKeys(previous => ({...previous, [job.key]: true}));
                }
                return worker();
            };
            const workerCount = Math.min(THUMBNAIL_CONCURRENCY, uncachedJobs.length);
            await Promise.all(Array.from({length: workerCount}, () => worker()));
        };

        void generateMissingThumbnails();
        return () => {
            cancelled = true;
        };
    }, [activeImageData, displayResults, imageId]);

    return (
        <div className="InferenceResultsView">
            <div className="Header">
                <div className="HeaderText">{currentTexts.aiInference.results.title}</div>
            </div>
            {showTabs && (
                <div className="TabBar">
                    <button className={`Tab${activeTab === 'all' ? ' active' : ''}`} onClick={() => setActiveTab('all')}>
                        {zh ? '全部' : 'All'}
                    </button>
                    <button className={`Tab${activeTab === 'detect' ? ' active' : ''}`} onClick={() => setActiveTab('detect')}>
                        {zh ? '检测' : 'Detection'}
                    </button>
                    <button className={`Tab${activeTab === 'segment' ? ' active' : ''}`} onClick={() => setActiveTab('segment')}>
                        {zh ? '分割' : 'Segmentation'}
                    </button>
                </div>
            )}
            <div className="Content">
                {displayResults.length > 0 ? (
                    <div className="SegmentationResultsList">
                        {displayResults.map((result, index) => {
                            const displayResult = result as DisplayResult;
                            const thumbnailKey = imageId ? getThumbnailKey(imageId, displayResult) : '';
                            const thumbnailUrl = thumbnails[thumbnailKey];
                            const thumbnailFailed = failedThumbnailKeys[thumbnailKey];
                            return (
                            <div key={`${thumbnailKey}:${index}`} className="SegmentationResultItem"
                                onClick={() => handleClickSegmentationResult(result, index)}
                                onMouseEnter={() => handleMouseEnterSegmentationResult(result, index)}
                                onMouseLeave={handleMouseLeaveSegmentationResult}
                                style={{ cursor: 'pointer' }}>
                                <button className="DeleteButton"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteSegmentationResult(result, index); }}
                                    title="删除此推理结果">×</button>
                                <div className="ResultHeader">
                                    <div className="ClassName" style={{color: getLabelColor(result.info?.name || result.class_name)}}>
                                        {result.info?.name || result.class_name}
                                    </div>
                                    <div className="Confidence" style={{
                                        color: getConfidenceColor(result.info?.confidence || result.confidence || 0),
                                        backgroundColor: getConfidenceBackgroundColor(result.info?.confidence || result.confidence || 0)
                                    }}>
                                        {(((result.info?.confidence ?? result.confidence ?? 0) || 0) * 100).toFixed(1)}%
                                    </div>
                                </div>
                                <div className="ResultContent">
                                    <div className="ThumbnailContainer">
                                        <div className="Thumbnail">
                                            {renderThumbnail(
                                                thumbnailUrl,
                                                !!activeImageData?.fileData,
                                                thumbnailFailed,
                                                `${result.info?.name || result.class_name} thumbnail`
                                            )}
                                        </div>
                                    </div>
                                    <div className="ResultDetails">
                                        <div className="DetailRow">
                                            <span className="DetailLabel">{currentTexts.aiInference.results.objectId}:</span>
                                            <span className="DetailValue">{result.class_id}</span>
                                        </div>
                                        <div className="DetailRow">
                                            <span className="DetailLabel">{currentTexts.aiInference.results.coordinates}:</span>
                                            <span className="DetailValue">({Math.round(result.bbox.x1)},{Math.round(result.bbox.y1)},{Math.round(result.bbox.x2)},{Math.round(result.bbox.y2)})</span>
                                        </div>
                                        {!result.mask && (
                                        <div className="DetailRow">
                                            <span className="DetailLabel">{currentTexts.aiInference.results.size}:</span>
                                            <span className="DetailValue">{Math.round(result.bbox.width)} × {Math.round(result.bbox.height)}</span>
                                        </div>
                                        )}
                                        {result.mask && (
                                            <div className="DetailRow">
                                                <span className="DetailLabel">{currentTexts.aiInference.results.area}:</span>
                                                <span className="DetailValue">{Math.round(result.mask.area)}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            );
                        })}
                    </div>
                ) : suggestedLabelList && suggestedLabelList.length > 0 ? (
                    <div className="ResultsList">
                        <div className="SectionTitle">{language === 'zh' ? '建议标签' : 'Suggested Labels'}</div>
                        {suggestedLabelList.map((label, index) => (
                            <div key={index} className="ResultItem"><div className="ResultLabel">{label}</div></div>
                        ))}
                    </div>
                ) : (
                    <div className="EmptyResults">
                        <img src="/ico/brain.png" alt="AI" className="EmptyIcon"/>
                        <div className="EmptyText">{currentTexts.aiInference.results.noResults}</div>
                    </div>
                )}
            </div>
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
    suggestedLabelList: state.ai.suggestedLabelList,
    segmentationResults: (() => {
        const imageId = state.labels.imagesData[state.labels.activeImageIndex]?.id;
        if (imageId && state.ai.imageSegmentationResults.has(imageId)) {
            return state.ai.imageSegmentationResults.get(imageId)!;
        }
        return [];
    })(),
    activeImageData: state.labels.imagesData[state.labels.activeImageIndex] || null,
    labelNames: state.labels.labels,
    isVideoMode: state.video?.isVideoMode || false
});

const mapDispatchToProps = {
    updateSegmentationResults: updateSegmentationResultsAction,
    updateActiveLabelId: updateActiveLabelIdAction
};

export default connect(mapStateToProps, mapDispatchToProps, null, { areStatePropsEqual: shallowEqual })(InferenceResultsView);
