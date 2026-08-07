import {IPoint} from '../../interfaces/IPoint';
import {IRect} from '../../interfaces/IRect';
import {RectUtil} from '../../utils/RectUtil';
import {DrawUtil} from '../../utils/DrawUtil';
import {store} from '../..';
import {ImageData, LabelRect} from '../../store/labels/types';
import {
    updateActiveLabelId,
    updateFirstLabelCreatedFlag,
    updateHighlightedLabelId,
    updateImageDataById
} from '../../store/labels/actionCreators';
import {PointUtil} from '../../utils/PointUtil';
import {RectAnchor} from '../../data/RectAnchor';
import {RenderEngineSettings} from '../../settings/RenderEngineSettings';
import {Direction} from '../../data/enums/Direction';
import {updateCustomCursorStyle} from '../../store/general/actionCreators';
import {CustomCursorStyle} from '../../data/enums/CustomCursorStyle';
import {LabelsSelector} from '../../store/selectors/LabelsSelector';
import {EditorData} from '../../data/EditorData';
import {BaseRenderEngine} from './BaseRenderEngine';
import {RenderEngineUtil} from '../../utils/RenderEngineUtil';
import {LabelType} from '../../data/enums/LabelType';
import {EditorActions} from '../actions/EditorActions';
import {EditorModel} from '../../staticModels/EditorModel';
import {GeneralSelector} from '../../store/selectors/GeneralSelector';
import {LabelStatus} from '../../data/enums/LabelStatus';
import {LabelUtil} from '../../utils/LabelUtil';
import {Settings} from '../../settings/Settings';
import {SmartAnnotationActions} from '../actions/SmartAnnotationActions';
import {LabelActions} from '../actions/LabelActions';
import {publishRectLabelOverlayPosition} from '../../utils/RectLabelOverlayPositionBus';

export class RectRenderEngine extends BaseRenderEngine {

    // =================================================================================================================
    // STATE
    // =================================================================================================================

    private startCreateRectPoint: IPoint;
    private startResizeRectAnchor: RectAnchor;
    private startMoveRectPoint: IPoint;
    private moveRectId: string;
    
    // 多边形移动相关状态
    private movePolygonId: string;
    private startMovePolygonPoint: IPoint;

    // SAM prompt 拖拽：复用 startMoveRectPoint / moveRectId 来移动 prompt rect


    public constructor(canvas: HTMLCanvasElement) {
        super(canvas);
        this.labelType = LabelType.RECT;
    }

    public cancelLabelCreation(): void {
        this.startCreateRectPoint = null;
    }

    // =================================================================================================================
    // EVENT HANDLERS
    // =================================================================================================================

    public mouseDownHandler = (data: EditorData) => {
        const isMouseOverImage: boolean = RenderEngineUtil.isMouseOverImage(data);
        const isMouseOverCanvas: boolean = RenderEngineUtil.isMouseOverCanvas(data);
        const isInLabelDragMode: boolean = GeneralSelector.getImageDragModeStatus();

        // 只处理左键点击 (button === 0)，忽略中键和右键
        const mouseEvent = data.event as MouseEvent;
        if (mouseEvent && mouseEvent.button !== 0) {
            return;
        }

        if (isMouseOverCanvas) {
            if (isInLabelDragMode) {
                // 标签拖拽模式：优先检查锚点，然后检查整个矩形区域
                const rectUnderMouseEdge: LabelRect = this.getRectUnderMouse(data);
                if (!!rectUnderMouseEdge) {
                    const rect: IRect = this.calculateRectRelativeToActiveImage(rectUnderMouseEdge.rect, data);
                    const anchorUnderMouse: RectAnchor = this.getAnchorUnderMouseByRect(rect, data.mousePositionOnViewPortContent, data.viewPortContentImageRect);

                    store.dispatch(updateActiveLabelId(rectUnderMouseEdge.id));

                    if (!!anchorUnderMouse && rectUnderMouseEdge.status === LabelStatus.ACCEPTED) {
                        this.startRectResize(anchorUnderMouse);
                        return;
                    }
                }

                const rectUnderMouseDrag: LabelRect = this.getRectUnderMouseForDrag(data);
                if (!!rectUnderMouseDrag && rectUnderMouseDrag.status === LabelStatus.ACCEPTED) {
                    store.dispatch(updateActiveLabelId(rectUnderMouseDrag.id));
                    this.startRectMove(data.mousePositionOnViewPortContent, rectUnderMouseDrag.id);
                } else {
                    const activeLabelViewType = LabelsSelector.getActiveLabelViewType();
                    if (activeLabelViewType === LabelType.ALL) {
                        const polygonUnderMouse = this.getPolygonUnderMouse(data);
                        if (!!polygonUnderMouse && polygonUnderMouse.status === LabelStatus.ACCEPTED) {
                            store.dispatch(updateActiveLabelId(polygonUnderMouse.id));
                            this.startPolygonMove(data.mousePositionOnViewPortContent, polygonUnderMouse.id);
                        }
                    }
                }
            } else {
                // 智能标注模式：先检查是否命中已有 prompt rect（拖拽/删除），否则新建 prompt
                if (GeneralSelector.getSmartAnnotationActiveStatus()) {
                    if (isMouseOverImage) {
                        const hitRect = this.getPromptRectUnderMouse(data);
                        if (hitRect) {
                            // 命中已有 prompt → 复用原生矩形移动机制
                            store.dispatch(updateActiveLabelId(hitRect.id));
                            this.startRectMove(data.mousePositionOnViewPortContent, hitRect.id);
                        } else {
                            this.startRectCreation(data.mousePositionOnViewPortContent);
                        }
                    }
                    return;
                }
                // 编辑模式：先检查锚点，然后只在边缘可以拖拽，内部可以创建新矩形
                const rectUnderMouseEdge: LabelRect = this.getRectUnderMouse(data);
                if (!!rectUnderMouseEdge) {
                    const rect: IRect = this.calculateRectRelativeToActiveImage(rectUnderMouseEdge.rect, data);
                    const anchorUnderMouse: RectAnchor = this.getAnchorUnderMouseByRect(rect, data.mousePositionOnViewPortContent, data.viewPortContentImageRect);

                    store.dispatch(updateActiveLabelId(rectUnderMouseEdge.id));

                    if (!!anchorUnderMouse && rectUnderMouseEdge.status === LabelStatus.ACCEPTED) {
                        // 锚点优先级最高 - 调整大小
                        this.startRectResize(anchorUnderMouse);
                    } else if (rectUnderMouseEdge.status === LabelStatus.ACCEPTED) {
                        // 在边缘但不在锚点上 - 拖拽移动
                        this.startRectMove(data.mousePositionOnViewPortContent, rectUnderMouseEdge.id);
                    }
                } else if (isMouseOverImage) {
                    // 不在任何矩形边缘上（包括内部区域）- 创建新矩形
                    this.startRectCreation(data.mousePositionOnViewPortContent);
                }
            }
        }
    };

    public mouseUpHandler = (data: EditorData) => {
        if (!!data.viewPortContentImageRect) {
            const mousePositionSnapped: IPoint = RectUtil.snapPointToRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
            const activeLabelRect: LabelRect = LabelsSelector.getActiveRectLabel();

            // ── 智能标注劫持：click → SAM 单点 prompt；drag → SAM bbox prompt ──
            // 注意：如果 mouseDown 命中了已有 prompt rect，会进入 startRectMove 路径，
            // 由下方「处理矩形框移动」分支自动完成拖拽/删除。
            if (GeneralSelector.getSmartAnnotationActiveStatus() && !!this.startCreateRectPoint) {
                const startInImage: IPoint = RenderEngineUtil.transferPointFromViewPortContentToImage(this.startCreateRectPoint, data);
                const endInImage: IPoint = RenderEngineUtil.transferPointFromViewPortContentToImage(mousePositionSnapped, data);
                // 容差判断：起止点在视口空间内小于 5px 的位移视为点击（避免 1-2px 鼠标抖动被当成拖框）
                const dxView = this.startCreateRectPoint.x - mousePositionSnapped.x;
                const dyView = this.startCreateRectPoint.y - mousePositionSnapped.y;
                const isClick = (dxView * dxView + dyView * dyView) < 25; // 5px 半径
                if (isClick) {
                    const isNegative = GeneralSelector.getSamNegativeMode();
                    SmartAnnotationActions.addPoint(startInImage, isNegative);
                } else {
                    const rectInImage: IRect = {
                        x: Math.min(startInImage.x, endInImage.x),
                        y: Math.min(startInImage.y, endInImage.y),
                        width: Math.abs(endInImage.x - startInImage.x),
                        height: Math.abs(endInImage.y - startInImage.y),
                    };
                    SmartAnnotationActions.addBbox(rectInImage);
                }
                this.endRectTransformation();
                return;  // 阻断后续 addRectLabel 路径
            }

            if (!!this.startCreateRectPoint && !PointUtil.equals(this.startCreateRectPoint, mousePositionSnapped)) {

                const minX: number = Math.min(this.startCreateRectPoint.x, mousePositionSnapped.x);
                const minY: number = Math.min(this.startCreateRectPoint.y, mousePositionSnapped.y);
                const maxX: number = Math.max(this.startCreateRectPoint.x, mousePositionSnapped.x);
                const maxY: number = Math.max(this.startCreateRectPoint.y, mousePositionSnapped.y);

                const rect = {x: minX, y: minY, width: maxX - minX, height: maxY - minY};
                this.addRectLabel(RenderEngineUtil.transferRectFromImageToViewPortContent(rect, data));
            }

            if (!!this.startResizeRectAnchor && !!activeLabelRect) {
                const rect: IRect = this.calculateRectRelativeToActiveImage(activeLabelRect.rect, data);
                const startAnchorPosition: IPoint = PointUtil.add(this.startResizeRectAnchor.position,
                    data.viewPortContentImageRect);
                const delta: IPoint = PointUtil.subtract(mousePositionSnapped, startAnchorPosition);
                const resizeRect: IRect = RectUtil.resizeRect(rect, this.startResizeRectAnchor.type, delta);
                const scale: number = RenderEngineUtil.calculateImageScale(data);
                const scaledRect: IRect = RectUtil.scaleRect(resizeRect, scale);

                const imageData = LabelsSelector.getActiveImageData();
                imageData.labelRects = imageData.labelRects.map((labelRect: LabelRect) => {
                    if (labelRect.id === activeLabelRect.id) {
                        return {
                            ...labelRect,
                            rect: scaledRect
                        };
                    }
                    return labelRect;
                });
                store.dispatch(updateImageDataById(imageData.id, imageData));
            }

            // 处理矩形框移动
            if (!!this.startMoveRectPoint && !!this.moveRectId && !!data.mousePositionOnViewPortContent) {
                const delta: IPoint = PointUtil.subtract(data.mousePositionOnViewPortContent, this.startMoveRectPoint);
                const distSq = delta.x * delta.x + delta.y * delta.y;

                const imageData = LabelsSelector.getActiveImageData();
                if (imageData) {
                    const rectToMove = imageData.labelRects.find(rect => rect.id === this.moveRectId);
                    if (!!rectToMove) {
                        // prompt rect: 点击不移动时什么都不做（不再自动删除）
                        if (rectToMove.isPrompt && distSq < 25) {
                            // no-op：用户可通过橡皮擦或 Delete 键删除 prompt
                        } else {
                            const scale: number = RenderEngineUtil.calculateImageScale(data);
                            const deltaOnImage: IPoint = PointUtil.multiply(delta, scale);
                            const movedRect: IRect = RectUtil.translate(rectToMove.rect, deltaOnImage);
                            imageData.labelRects = imageData.labelRects.map((labelRect: LabelRect) => {
                                if (labelRect.id === this.moveRectId) {
                                    return {
                                        ...labelRect,
                                        rect: movedRect
                                    };
                                }
                                return labelRect;
                            });
                            store.dispatch(updateImageDataById(imageData.id, imageData));
                        }
                    }
                }
            }
        }
        this.endRectTransformation();
    };

    public mouseMoveHandler = (data: EditorData) => {
        if (!!data.viewPortContentImageRect && !!data.mousePositionOnViewPortContent) {
            const isOverImage: boolean = RenderEngineUtil.isMouseOverImage(data);

            // 处理多边形移动
            if (this.isPolygonMoveInProgress()) {
                this.updatePolygonMove(data);
            }

            if (isOverImage && !this.startResizeRectAnchor) {
                const labelRect: LabelRect = this.getRectUnderMouse(data);
                if (!!labelRect && !this.isInProgress()) {
                    if (LabelsSelector.getHighlightedLabelId() !== labelRect.id) {
                        store.dispatch(updateHighlightedLabelId(labelRect.id))
                    }
                } else {
                    if (LabelsSelector.getHighlightedLabelId() !== null) {
                        store.dispatch(updateHighlightedLabelId(null))
                    }
                }
            }
        }
    };

    // =================================================================================================================
    // RENDERING
    // =================================================================================================================

    /**
     * 绘制已存在矩形 + 在建 bbox 预览（用于目标跟踪/智能标注的 drag 可视化）。
     * 不 dispatch cursor，避免 React 无限渲染。
     */
    public drawRectsAndInProgress(data: EditorData): void {
        this.drawExistingRects(data);
        if (!!data.mousePositionOnViewPortContent && !!data.viewPortContentImageRect) {
            this.drawCurrentlyCreatedRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
        }
    }

    /**
     * 纯绘制矩形框（不更新 cursor，不处理在建矩形）。
     * 供 AllLabelsRenderEngine 在非智能标注模式下调用 —— 避免 updateCursorStyle
     * 每帧 dispatch cursor 触发 React 无限渲染。
     */
    public drawExistingRects(data: EditorData): void {
        if (!data.viewPortContentImageRect || !data.realImageSize) return;
        const imageData: ImageData = EditorModel.playbackImageData || LabelsSelector.getActiveImageData();
        if (!imageData || !imageData.labelRects) return;
        let aiLabelsVisible = true;
        const aiState = store.getState().ai.imageAIStates.get(imageData.id);
        if (aiState) aiLabelsVisible = aiState.aiLabelsVisible;
        if (!aiLabelsVisible) return;
        const activeLabelId: string = LabelsSelector.getActiveLabelId();
        imageData.labelRects.forEach((labelRect: LabelRect) => {
            if (!labelRect.isVisible) return;
            if (labelRect.isPrompt) {
                this.drawPromptRect(labelRect, data);
                return;
            }
            if (labelRect.status === LabelStatus.ACCEPTED && labelRect.id === activeLabelId) {
                this.drawActiveRect(labelRect, data);
            } else {
                this.drawInactiveRect(labelRect, data);
            }
        });
    }

    public render(data: EditorData) {
        // 确保基础数据完整才开始渲染
        if (!data.viewPortContentImageRect || !data.realImageSize) {
            return; // 图像还没有加载完成，跳过渲染
        }

        const activeLabelId: string = LabelsSelector.getActiveLabelId();
        // 播放时直接使用预设的帧数据，绕过 Redux activeImageIndex 查找
        const imageData: ImageData = EditorModel.playbackImageData || LabelsSelector.getActiveImageData();
        
        // 获取当前图片的AI标签显示状态（默认可见）
        let aiLabelsVisible = true;
        let segmentationLabelsVisible = true;
        let currentImageAIState = null;
        if (imageData) {
            const imageAIStates = store.getState().ai.imageAIStates;
            currentImageAIState = imageAIStates.get(imageData.id);
            aiLabelsVisible = currentImageAIState ? currentImageAIState.aiLabelsVisible : true;
            segmentationLabelsVisible = currentImageAIState ? currentImageAIState.segmentationLabelsVisible : true;
        }

        // 渲染矩形框标签
        if (imageData && imageData.labelRects) {
            imageData.labelRects.forEach((labelRect: LabelRect) => {
                // 显示/隐藏标签开关：aiLabelsVisible 为 false 时隐藏所有矩形框（不分 AI 或手动）
                const shouldShow = labelRect.isVisible && aiLabelsVisible;

                if (shouldShow) {
                    if (labelRect.isPrompt) {
                        this.drawPromptRect(labelRect, data);
                    } else if (labelRect.status === LabelStatus.ACCEPTED && labelRect.id === activeLabelId) {
                        this.drawActiveRect(labelRect, data)
                    } else {
                        this.drawInactiveRect(labelRect, data);
                    }
                }
            });
            this.drawCurrentlyCreatedRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
            this.updateCursorStyle(data);
        }
        
        // 只有在"全部标签"视图时才渲染其他类型的标签
        const activeLabelViewType = LabelsSelector.getActiveLabelViewType();
        if (imageData && activeLabelViewType === LabelType.ALL) {

            // 注：多边形由 AllLabelsRenderEngine 通过 polygonEngine.drawExistingLabels 渲染，
            // 这里不再重复画（否则 ALL 视图下会出现两次填充，透明度叠加变浓）

            // 渲染点标签（受 aiLabelsVisible 控制，与矩形框一致）
            if (imageData.labelPoints && aiLabelsVisible) {
                imageData.labelPoints.forEach((labelPoint) => {
                    const shouldShow = labelPoint.isVisible &&
                                       labelPoint.status === LabelStatus.ACCEPTED;

                    if (shouldShow) {
                        const pointColor = BaseRenderEngine.resolveLabelLineColor(labelPoint.labelId, true, labelPoint.isCreatedByAI);
                        const transformedPoint = RenderEngineUtil.transferPointFromImageToViewPortContent(labelPoint.point, data);
                        const standardizedPoint = RenderEngineUtil.setPointBetweenPixels(transformedPoint);
                        DrawUtil.drawCircleWithFill(this.canvas, standardizedPoint, Settings.RESIZE_HANDLE_DIMENSION_PX/2, pointColor);
                    }
                });
            }
            
            // 渲染线条标签
            if (imageData.labelLines) {
                imageData.labelLines.forEach((labelLine) => {
                    // 受 aiLabelsVisible 控制
                    const shouldShow = aiLabelsVisible &&
                                       labelLine.isVisible &&
                                       labelLine.status === LabelStatus.ACCEPTED;

                    if (shouldShow) {
                        const lineColor = BaseRenderEngine.resolveLabelLineColor(labelLine.labelId, true, labelLine.isCreatedByAI);
                        const transformedStart = RenderEngineUtil.transferPointFromImageToViewPortContent(labelLine.line.start, data);
                        const transformedEnd = RenderEngineUtil.transferPointFromImageToViewPortContent(labelLine.line.end, data);
                        const startPoint = RenderEngineUtil.setPointBetweenPixels(transformedStart);
                        const endPoint = RenderEngineUtil.setPointBetweenPixels(transformedEnd);
                        DrawUtil.drawLine(this.canvas, startPoint, endPoint, lineColor, RenderEngineSettings.LINE_THICKNESS);
                    }
                });
            }
        }
    }

    private drawCurrentlyCreatedRect(mousePosition: IPoint, imageRect: IRect) {
        if (!!this.startCreateRectPoint) {
            const mousePositionSnapped: IPoint = RectUtil.snapPointToRect(mousePosition, imageRect);
            const activeRect: IRect = {
                x: this.startCreateRectPoint.x,
                y: this.startCreateRectPoint.y,
                width: mousePositionSnapped.x - this.startCreateRectPoint.x,
                height: mousePositionSnapped.y - this.startCreateRectPoint.y
            };
            const activeRectBetweenPixels = RenderEngineUtil.setRectBetweenPixels(activeRect);

            if (GeneralSelector.getSmartAnnotationActiveStatus()) {
                // 智能标注模式 → 白色虚线框
                const ctx = this.canvas.getContext('2d');
                if (ctx) {
                    ctx.save();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([6, 4]);
                    ctx.strokeRect(
                        activeRectBetweenPixels.x, activeRectBetweenPixels.y,
                        activeRectBetweenPixels.width, activeRectBetweenPixels.height
                    );
                    ctx.restore();
                }
            } else {
                const lineColor: string = BaseRenderEngine.resolveLabelLineColor(null, true, false)
                DrawUtil.drawRect(this.canvas, activeRectBetweenPixels, lineColor, RenderEngineSettings.LINE_THICKNESS);
            }
        }
    }

    /**
     * 绘制 SAM prompt rect:
     * - 有 promptLabel 的小 rect → 绘制为彩色圆点 + 外环（正点绿色、负点红色）
     * - 没有 promptLabel 的正常 rect → 绘制为白色虚线框
     * - 推理中时半透明闪烁
     * - 如果正在被拖拽（moveRectId 匹配），跟随鼠标偏移渲染
     */
    private drawPromptRect(labelRect: LabelRect, data: EditorData): void {
        const ctx = this.canvas.getContext('2d');
        if (!ctx) return;

        // 推理中闪烁
        const isInferring = (window as any).__openSightPromptInferring === true;
        let alpha = 1;
        if (isInferring) {
            const phase = (Math.sin(Date.now() / 150) + 1) / 2;
            alpha = 0.25 + 0.75 * phase;
        }

        // 如果这个 prompt 正在被拖拽，应用鼠标偏移
        let rectForDraw = labelRect.rect;
        if (this.moveRectId === labelRect.id && this.startMoveRectPoint && data.mousePositionOnViewPortContent) {
            // 计算视口空间的偏移，再转换到图像空间
            const delta: IPoint = PointUtil.subtract(data.mousePositionOnViewPortContent, this.startMoveRectPoint);
            const scale: number = RenderEngineUtil.calculateImageScale(data);
            const deltaOnImage: IPoint = PointUtil.multiply(delta, scale);
            rectForDraw = RectUtil.translate(rectForDraw, deltaOnImage);
        }

        ctx.save();
        ctx.globalAlpha = alpha;

        if (labelRect.promptLabel) {
            // ── 点 prompt → 圆点 + 外环 ──
            const center: IPoint = {
                x: rectForDraw.x + rectForDraw.width / 2,
                y: rectForDraw.y + rectForDraw.height / 2,
            };
            const vp = RenderEngineUtil.transferPointFromImageToViewPortContent(center, data);
            const color = labelRect.promptLabel === 'negative' ? '#ff4444' : '#44ff88';

            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            // 实心内圆
            ctx.beginPath();
            ctx.arc(vp.x, vp.y, 5, 0, Math.PI * 2);
            ctx.fill();
            // 外环
            ctx.beginPath();
            ctx.arc(vp.x, vp.y, 11, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            // ── bbox prompt → 白色虚线框 ──
            const tl = RenderEngineUtil.transferPointFromImageToViewPortContent(
                {x: rectForDraw.x, y: rectForDraw.y}, data);
            const br = RenderEngineUtil.transferPointFromImageToViewPortContent(
                {x: rectForDraw.x + rectForDraw.width, y: rectForDraw.y + rectForDraw.height}, data);
            const w = br.x - tl.x;
            const h = br.y - tl.y;

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(tl.x, tl.y, w, h);
        }

        ctx.restore();
    }

    private drawInactiveRect(labelRect: LabelRect, data: EditorData) {
        const rectOnImage: IRect = RenderEngineUtil.transferRectFromViewPortContentToImage(labelRect.rect, data)
        const highlightedLabelId: string = LabelsSelector.getHighlightedLabelId()
        const displayAsActive: boolean = labelRect.status === LabelStatus.ACCEPTED && labelRect.id === highlightedLabelId;
        const lineColor: string = BaseRenderEngine.resolveLabelLineColor(labelRect.labelId, displayAsActive, labelRect.isCreatedByAI)
        const anchorColor: string = BaseRenderEngine.resolveLabelAnchorColor(displayAsActive);
        this.renderRect(rectOnImage, displayAsActive, lineColor, anchorColor);
        
        // 为所有有标签的标注框添加标签文字
        this.drawLabelText(labelRect, rectOnImage, data);
    }

    private drawActiveRect(labelRect: LabelRect, data: EditorData) {
        let rect: IRect = this.calculateRectRelativeToActiveImage(labelRect.rect, data);
        
        if (!!this.startResizeRectAnchor) {
            const startAnchorPosition: IPoint = PointUtil.add(this.startResizeRectAnchor.position, data.viewPortContentImageRect);
            const endAnchorPositionSnapped: IPoint = RectUtil.snapPointToRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
            const delta = PointUtil.subtract(endAnchorPositionSnapped, startAnchorPosition);
            rect = RectUtil.resizeRect(rect, this.startResizeRectAnchor.type, delta);
        } else if (!!this.startMoveRectPoint && labelRect.id === this.moveRectId) {
            // 移动预览：显示矩形框跟随鼠标移动
            const delta: IPoint = PointUtil.subtract(data.mousePositionOnViewPortContent, this.startMoveRectPoint);
            rect = RectUtil.translate(rect, delta);
        }
        
        const rectOnImage: IRect = RectUtil.translate(rect, data.viewPortContentImageRect);
        const isTransforming = !!this.startResizeRectAnchor ||
            (!!this.startMoveRectPoint && labelRect.id === this.moveRectId);
        if (isTransforming) {
            publishRectLabelOverlayPosition(labelRect.id, {x: rectOnImage.x, y: rectOnImage.y});
        }
        const lineColor: string = BaseRenderEngine.resolveLabelLineColor(labelRect.labelId, true, labelRect.isCreatedByAI)
        const anchorColor: string = BaseRenderEngine.resolveLabelAnchorColor(true);
        this.renderRect(rectOnImage, true, lineColor, anchorColor);
        
        // 为活跃的标注框也显示标签文字
        this.drawLabelText(labelRect, rectOnImage, data);
    }

    private renderRect(rectOnImage: IRect, isActive: boolean, lineColor: string, anchorColor: string) {
        const rectBetweenPixels = RenderEngineUtil.setRectBetweenPixels(rectOnImage);
        DrawUtil.drawRectWithFill(this.canvas, rectBetweenPixels, DrawUtil.hexToRGB(lineColor, 0.2));
        DrawUtil.drawRect(this.canvas, rectBetweenPixels, lineColor, RenderEngineSettings.LINE_THICKNESS);
        if (isActive) {
            const handleCenters: IPoint[] = RectUtil.mapRectToAnchors(rectOnImage).map((rectAnchor: RectAnchor) => rectAnchor.position);
            handleCenters.forEach((center: IPoint) => {
                const handleRect: IRect = RectUtil.getRectWithCenterAndSize(center, RenderEngineSettings.anchorSize);
                const handleRectBetweenPixels: IRect = RenderEngineUtil.setRectBetweenPixels(handleRect);
                DrawUtil.drawRectWithFill(this.canvas, handleRectBetweenPixels, anchorColor);
            })
        }
    }

    private updateCursorStyle(data: EditorData) {
        if (!!this.canvas && !!data.mousePositionOnViewPortContent) {
            const isInLabelDragMode: boolean = GeneralSelector.getImageDragModeStatus();
            const rectUnderMouse: LabelRect = this.getRectUnderMouse(data);
            const rectAnchorUnderMouse: RectAnchor = this.getAnchorUnderMouse(data);

            if (isInLabelDragMode) {
                // 标签拖拽模式下：
                if (!!this.startMoveRectPoint && !!this.moveRectId) {
                    store.dispatch(updateCustomCursorStyle(CustomCursorStyle.GRABBING));
                } else if (!!rectAnchorUnderMouse && rectUnderMouse) {
                    store.dispatch(updateCustomCursorStyle(CustomCursorStyle.MOVE));
                } else {
                    const rectForDrag: LabelRect = this.getRectUnderMouseForDrag(data);
                    if (!!rectForDrag) {
                        store.dispatch(updateCustomCursorStyle(CustomCursorStyle.GRAB));
                    } else {
                        RenderEngineUtil.wrapDefaultCursorStyleInCancel(data);
                    }
                }
            } else if (!!this.startResizeRectAnchor) {
                store.dispatch(updateCustomCursorStyle(CustomCursorStyle.MOVE));
            } else if (!!this.startMoveRectPoint && !!this.moveRectId) {
                // 编辑模式下的移动操作，使用 GRABBING
                store.dispatch(updateCustomCursorStyle(CustomCursorStyle.GRABBING));
            } else if (!!rectAnchorUnderMouse && rectUnderMouse && rectUnderMouse.status === LabelStatus.ACCEPTED) {
                store.dispatch(updateCustomCursorStyle(CustomCursorStyle.MOVE));
            } else if (!!rectUnderMouse && rectUnderMouse.status === LabelStatus.ACCEPTED) {
                // 鼠标在矩形边缘上（但不在锚点上），显示 GRAB 表示可以拖拽
                store.dispatch(updateCustomCursorStyle(CustomCursorStyle.GRAB));
            } else if (RenderEngineUtil.isMouseOverCanvas(data)) {
                if (!RenderEngineUtil.isMouseOverImage(data) && !!this.startCreateRectPoint)
                    store.dispatch(updateCustomCursorStyle(CustomCursorStyle.MOVE));
                else
                    RenderEngineUtil.wrapDefaultCursorStyleInCancel(data);
                this.canvas.style.cursor = 'none';
            } else {
                this.canvas.style.cursor = 'default';
            }
        }
    }

    // =================================================================================================================
    // HELPERS
    // =================================================================================================================

    public isInProgress(): boolean {
        return !!this.startCreateRectPoint || !!this.startResizeRectAnchor || !!this.startMoveRectPoint || this.isPolygonMoveInProgress();
    }

    private calculateRectRelativeToActiveImage(rect: IRect, data: EditorData):IRect {
        const scale: number = RenderEngineUtil.calculateImageScale(data);
        return RectUtil.scaleRect(rect, 1/scale);
    }

    private addRectLabel = (rect: IRect) => {
        const activeLabelId = LabelsSelector.getActiveLabelNameId();
        const imageData: ImageData = LabelsSelector.getActiveImageData();
        if (!imageData) return;
        const labelRect: LabelRect = LabelUtil.createLabelRect(activeLabelId, rect);
        imageData.labelRects.push(labelRect);
        store.dispatch(updateImageDataById(imageData.id, imageData));
        store.dispatch(updateFirstLabelCreatedFlag(true));
        store.dispatch(updateActiveLabelId(labelRect.id));
    };

    /**
     * 橡皮擦模式：点击命中的矩形框 → 删除，返回 true；否则返回 false。
     */
    public eraserClick(data: EditorData): boolean {
        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData || !imageData.labelRects) return false;
        const aiState = store.getState().ai.imageAIStates.get(imageData.id);
        const aiLabelsVisible = aiState ? aiState.aiLabelsVisible : false;
        // 从后往前，优先命中最上层
        for (let i = imageData.labelRects.length - 1; i >= 0; i--) {
            const rect = imageData.labelRects[i];
            const shouldShow = rect.isVisible && (rect.isCreatedByAI ? aiLabelsVisible : true);
            if (shouldShow && this.isMouseOverEntireRect(rect.rect, data)) {
                LabelActions.deleteRectLabelById(imageData.id, rect.id);
                EditorActions.fullRender();
                return true;
            }
        }
        return false;
    }

    /**
     * 检测鼠标是否命中已有的 prompt LabelRect。
     * 点 prompt（tiny rect）: 视口空间 15px 半径；bbox prompt: 点击在框内部。
     */
    private getPromptRectUnderMouse(data: EditorData): LabelRect | null {
        const imageData: ImageData = LabelsSelector.getActiveImageData();
        if (!imageData) return null;
        const prompts = imageData.labelRects.filter(r => r.isPrompt);
        const HIT_RADIUS_SQ = 15 * 15;
        for (const p of prompts) {
            if (p.promptLabel) {
                // 点 prompt — 用中心点做距离检测
                const center: IPoint = {
                    x: p.rect.x + p.rect.width / 2,
                    y: p.rect.y + p.rect.height / 2,
                };
                const vpPt = RenderEngineUtil.transferPointFromImageToViewPortContent(center, data);
                const dx = vpPt.x - data.mousePositionOnViewPortContent.x;
                const dy = vpPt.y - data.mousePositionOnViewPortContent.y;
                if (dx * dx + dy * dy < HIT_RADIUS_SQ) return p;
            } else {
                // bbox prompt — 仅边缘命中（内部留给点击添加 point prompt）
                const EDGE_TOLERANCE = 6; // px
                const tl = RenderEngineUtil.transferPointFromImageToViewPortContent(
                    {x: p.rect.x, y: p.rect.y}, data);
                const br = RenderEngineUtil.transferPointFromImageToViewPortContent(
                    {x: p.rect.x + p.rect.width, y: p.rect.y + p.rect.height}, data);
                const mx = data.mousePositionOnViewPortContent.x;
                const my = data.mousePositionOnViewPortContent.y;
                // 先判断在外接矩形扩展区域内
                if (mx >= tl.x - EDGE_TOLERANCE && mx <= br.x + EDGE_TOLERANCE &&
                    my >= tl.y - EDGE_TOLERANCE && my <= br.y + EDGE_TOLERANCE) {
                    // 再排除远离边缘的内部区域
                    const nearLeft   = Math.abs(mx - tl.x) <= EDGE_TOLERANCE;
                    const nearRight  = Math.abs(mx - br.x) <= EDGE_TOLERANCE;
                    const nearTop    = Math.abs(my - tl.y) <= EDGE_TOLERANCE;
                    const nearBottom = Math.abs(my - br.y) <= EDGE_TOLERANCE;
                    if (nearLeft || nearRight || nearTop || nearBottom) return p;
                }
            }
        }
        return null;
    }

    private getRectUnderMouse(data: EditorData): LabelRect {
        const activeRectLabel: LabelRect = LabelsSelector.getActiveRectLabel();
        if (!!activeRectLabel && activeRectLabel.isVisible && this.isMouseOverRectEdges(activeRectLabel.rect, data)) {
            return activeRectLabel;
        }

        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData || !imageData.labelRects) {
            return null;
        }
        
        const labelRects: LabelRect[] = imageData.labelRects;
        
        // 获取当前图片的AI标签显示状态（优化版）
        const aiState = store.getState().ai.imageAIStates.get(imageData.id);
        const aiLabelsVisible = aiState ? aiState.aiLabelsVisible : false;
        
        for (const labelRect of labelRects) {
            const shouldShow = labelRect.isVisible && 
                (labelRect.isCreatedByAI ? aiLabelsVisible : true);
                
            if (shouldShow && this.isMouseOverRectEdges(labelRect.rect, data)) {
                return labelRect;
            }
        }
        return null;
    }


    private getRectUnderMouseForDrag(data: EditorData): LabelRect {
        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData || !imageData.labelRects) {
            return null;
        }
        
        const labelRects: LabelRect[] = imageData.labelRects;
        
        // 从后往前检查（最上层优先）
        // 获取当前图片的AI标签显示状态
        const imageAIStates = store.getState().ai.imageAIStates;
        const currentImageAIState = imageAIStates.get(imageData.labelRects[0]?.id ? imageData.id : '');
        const aiLabelsVisible = currentImageAIState ? currentImageAIState.aiLabelsVisible : false;
        
        for (let i = labelRects.length - 1; i >= 0; i--) {
            const labelRect = labelRects[i];
            const shouldShow = labelRect.isVisible && 
                (labelRect.isCreatedByAI ? aiLabelsVisible : true);
                
            if (shouldShow && this.isMouseOverEntireRect(labelRect.rect, data)) {
                return labelRect;
            }
        }
        return null;
    }

    private isMouseOverEntireRect(rect: IRect, data: EditorData): boolean {
        if (!rect || !data.mousePositionOnViewPortContent || !data.viewPortContentImageRect) return false;
        
        try {
            // 使用与原有方法相同的坐标转换逻辑
            const rectRelativeToImage: IRect = this.calculateRectRelativeToActiveImage(rect, data);
            const rectOnImage: IRect = RectUtil.translate(rectRelativeToImage, data.viewPortContentImageRect);
            return RectUtil.isPointInside(rectOnImage, data.mousePositionOnViewPortContent);
        } catch (error) {
            console.warn('Rectangle coordinate conversion error:', error);
            return false;
        }
    }

    private isMouseOverRectEdges(rect: IRect, data: EditorData): boolean {
        if (!rect || !data.viewPortContentImageRect || !data.mousePositionOnViewPortContent) {
            return false;
        }
        
        const rectOnImage: IRect = RectUtil.translate(
            this.calculateRectRelativeToActiveImage(rect, data), data.viewPortContentImageRect);

        const outerRectDelta: IPoint = {
            x: RenderEngineSettings.anchorHoverSize.width / 2,
            y: RenderEngineSettings.anchorHoverSize.height / 2
        };
        const outerRect: IRect = RectUtil.expand(rectOnImage, outerRectDelta);

        const innerRectDelta: IPoint = {
            x: - RenderEngineSettings.anchorHoverSize.width / 2,
            y: - RenderEngineSettings.anchorHoverSize.height / 2
        };
        const innerRect: IRect = RectUtil.expand(rectOnImage, innerRectDelta);

        return (RectUtil.isPointInside(outerRect, data.mousePositionOnViewPortContent) &&
            !RectUtil.isPointInside(innerRect, data.mousePositionOnViewPortContent));
    }

    private getAnchorUnderMouseByRect(rect: IRect, mousePosition: IPoint, imageRect: IRect): RectAnchor {
        const rectAnchors: RectAnchor[] = RectUtil.mapRectToAnchors(rect);
        for (let i = 0; i < rectAnchors.length; i++) {
            const anchorRect: IRect = RectUtil.translate(RectUtil.getRectWithCenterAndSize(rectAnchors[i].position, RenderEngineSettings.anchorHoverSize), imageRect);
            if (!!mousePosition && RectUtil.isPointInside(anchorRect, mousePosition)) {
                return rectAnchors[i];
            }
        }
        return null;
    }

    private getAnchorUnderMouse(data: EditorData): RectAnchor {
        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData || !imageData.labelRects) {
            return null;
        }
        
        const labelRects: LabelRect[] = imageData.labelRects;
        
        // 获取当前图片的AI标签显示状态（优化版）
        const aiState = store.getState().ai.imageAIStates.get(imageData.id);
        const aiLabelsVisible = aiState ? aiState.aiLabelsVisible : false;
        
        for (let i = 0; i < labelRects.length; i++) {
            const labelRect = labelRects[i];
            const shouldShow = labelRect.isVisible && 
                (labelRect.isCreatedByAI ? aiLabelsVisible : true);
                
            if (shouldShow) {
                const rect: IRect = this.calculateRectRelativeToActiveImage(labelRect.rect, data);
                const rectAnchor = this.getAnchorUnderMouseByRect(rect, data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
                if (!!rectAnchor) return rectAnchor;
            }
        }
        return null;
    }

    private startRectCreation(mousePosition: IPoint) {
        this.startCreateRectPoint = mousePosition;
        store.dispatch(updateActiveLabelId(null));
        EditorActions.setViewPortActionsDisabledStatus(true);
    }

    private startRectResize(activatedAnchor: RectAnchor) {
        this.startResizeRectAnchor = activatedAnchor;
        EditorActions.setViewPortActionsDisabledStatus(true);
    }

    private startRectMove(mousePosition: IPoint, rectId: string) {
        this.startMoveRectPoint = mousePosition;
        this.moveRectId = rectId;
        EditorActions.setViewPortActionsDisabledStatus(true);
    }

    private endRectTransformation() {
        this.startCreateRectPoint = null;
        this.startResizeRectAnchor = null;
        this.startMoveRectPoint = null;
        this.moveRectId = null;
        
        // 清理多边形移动状态
        this.movePolygonId = null;
        this.startMovePolygonPoint = null;
        
        EditorActions.setViewPortActionsDisabledStatus(false);
    }

    // =================================================================================================================
    // AI LABEL TEXT DRAWING
    // =================================================================================================================
    
    private drawLabelText(labelRect: LabelRect, rectOnImage: IRect, data: EditorData): void {
        // Accepted rectangles use the interactive DOM dropdown rendered by Editor.
        // Drawing the legacy canvas label as well makes both labels overlap.
        if (labelRect.status === LabelStatus.ACCEPTED) return;

        // 获取标签文字：优先使用已分配的标签名称，其次使用建议标签
        let labelText = '';
        if (labelRect.labelId) {
            const labelName = LabelsSelector.getLabelNameById(labelRect.labelId);
            if (labelName) {
                labelText = labelName.name;
            }
        } else if (labelRect.suggestedLabel) {
            labelText = labelRect.suggestedLabel;
        }
        
        if (!labelText) return;
        const labelPosition: IPoint = {
            x: rectOnImage.x,
            y: rectOnImage.y + 12  // 标签在标注框内部，上边缘对齐
        };
        
        // 绘制标签背景
        const textWidth = this.estimateTextWidth(labelText, 12);
        const labelBg: IRect = {
            x: labelPosition.x, // 与标注框左边缘完全对齐，不偏移
            y: rectOnImage.y, // 标签背景上边缘与标注框上边缘对齐
            width: textWidth + 8,
            height: 16
        };
        
        // 获取标签颜色：检查 perClassColoration 设置
        let bgColor = 'rgba(255, 255, 255, 0.8)'; // 默认白色背景
        const perClassColor = GeneralSelector.getEnablePerClassColorationStatus();
        if (perClassColor && labelRect.labelId) {
            const labelName = LabelsSelector.getLabelNameById(labelRect.labelId);
            if (labelName && labelName.color) {
                const hex = labelName.color.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);
                bgColor = `rgba(${r}, ${g}, ${b}, 0.8)`;
            }
        }

        DrawUtil.drawRectWithFill(this.canvas, labelBg, bgColor);

        // 绘制标签文字（在背景内完全居中）
        const textPosition: IPoint = {
            x: labelBg.x + labelBg.width / 2,
            y: labelBg.y + labelBg.height / 2
        };
        DrawUtil.drawText(
            this.canvas,
            labelText,
            12,
            textPosition,
            perClassColor ? '#FFFFFF' : '#000000',
            true,
            'center'
        );
    }
    
    private estimateTextWidth(text: string, fontSize: number): number {
        // 简单的文字宽度估算
        return text.length * fontSize * 0.6;
    }

    // =================================================================================================================
    // POLYGON SUPPORT (for ALL view)
    // =================================================================================================================

    private getPolygonUnderMouse(data: EditorData): any | null {
        const mouseOnCanvas = data.mousePositionOnViewPortContent;
        if (!mouseOnCanvas) return null;

        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData || !imageData.labelPolygons) return null;

        const labelPolygons = imageData.labelPolygons.filter((labelPolygon: any) => labelPolygon.isVisible);
        const radius = RenderEngineSettings.anchorHoverSize.width / 2;

        for (const labelPolygon of labelPolygons) {
            const verticesOnCanvas = RenderEngineUtil
                .transferPolygonFromImageToViewPortContent(labelPolygon.vertices, data);
            if (RenderEngineUtil.isMouseOverPolygon(mouseOnCanvas, verticesOnCanvas, radius)) {
                return labelPolygon;
            }
        }
        return null;
    }

    private startPolygonMove(mousePosition: IPoint, polygonId: string): void {
        this.startMovePolygonPoint = mousePosition;
        this.movePolygonId = polygonId;
        EditorActions.setViewPortActionsDisabledStatus(true);
    }

    private isPolygonMoveInProgress(): boolean {
        return this.movePolygonId !== null;
    }

    private updatePolygonMove(data: EditorData): void {
        if (!!this.startMovePolygonPoint) {
            const mousePositionSnapped: IPoint = RectUtil.snapPointToRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
            const moveDelta: IPoint = {
                x: mousePositionSnapped.x - this.startMovePolygonPoint.x,
                y: mousePositionSnapped.y - this.startMovePolygonPoint.y
            };

            // 将移动增量转换为图像坐标系
            const imageDelta: IPoint = RenderEngineUtil.transferPointFromViewPortContentToImage(moveDelta, data);
            
            // 获取当前多边形标签
            const imageData = LabelsSelector.getActiveImageData();
            const activePolygon = imageData.labelPolygons.find(polygon => polygon.id === this.movePolygonId);
            
            if (activePolygon) {
                // 计算新的顶点位置
                const newVertices: IPoint[] = activePolygon.vertices.map((vertex: IPoint) => ({
                    x: vertex.x + imageDelta.x,
                    y: vertex.y + imageDelta.y
                }));

                // 更新多边形位置
                const newImageData = {
                    ...imageData,
                    labelPolygons: imageData.labelPolygons.map((labelPolygon: any) =>
                        labelPolygon.id === this.movePolygonId ? { ...labelPolygon, vertices: newVertices } : labelPolygon
                    )
                };
                store.dispatch(updateImageDataById(imageData.id, newImageData));
                this.startMovePolygonPoint = mousePositionSnapped;
            }
        }
    }
}
