import classNames from "classnames";
import React from 'react';
import { connect } from "react-redux";
import { ClipLoader } from "react-spinners";
import { ImageLoadManager } from "../../../../logic/imageRepository/ImageLoadManager";
import { IRect } from "../../../../interfaces/IRect";
import { ISize } from "../../../../interfaces/ISize";
import { ImageRepository } from "../../../../logic/imageRepository/ImageRepository";
import { AppState } from "../../../../store";
import { updateImageDataById, deleteImageById, deleteSelectedImages } from "../../../../store/labels/actionCreators";
import { ImageData } from "../../../../store/labels/types";
import { FileUtil } from "../../../../utils/FileUtil";
import { RectUtil } from "../../../../utils/RectUtil";
import { EditorModel } from "../../../../staticModels/EditorModel";
import { FrameExtractorService } from "../../../../services/FrameExtractorService";
import './ImagePreview.scss';
import { CSSHelper } from "../../../../logic/helpers/CSSHelper";
import {getVideoThumbnailSize} from "../../../../utils/VideoThumbnailUtil";

interface IProps {
    imageData: ImageData;
    style: React.CSSProperties;
    size: ISize;
    isScrolling?: boolean;
    isChecked?: boolean;
    isInferred?: boolean;
    onClick?: () => any;
    isSelected?: boolean;
    isMultiSelected?: boolean;
    isFirstSelected?: boolean;
    updateImageDataById: (id: string, newImageData: ImageData) => any;
    deleteImageById: (id: string) => any;
    deleteSelectedImages: () => any;
}

interface IState {
    image: HTMLImageElement;
}

export class ImagePreview extends React.Component<IProps, IState> {
    private isLoading: boolean = false;
    private loadingImageId: string | null = null;
    private loadingGeneration: number = 0;
    private requestGeneration: number = 0;
    private mounted: boolean = false;

    constructor(props) {
        super(props);

        this.state = {
            image: null,
        }
    }

    public componentDidMount(): void {
        this.mounted = true;
        ImageLoadManager.addAndRun(this.loadImage(this.props.imageData, this.props.isScrolling));
    }

    public componentWillUnmount(): void {
        this.mounted = false;
        this.requestGeneration++;
        this.isLoading = false;
        this.loadingImageId = null;
    }

    public componentDidUpdate(prevProps: Readonly<IProps>): void {
        if (prevProps.imageData.id !== this.props.imageData.id) {
            this.setState({ image: null });
            ImageLoadManager.addAndRun(this.loadImage(this.props.imageData, this.props.isScrolling));
        }
        else if (!prevProps.imageData.loadStatus && this.props.imageData.loadStatus) {
            ImageLoadManager.addAndRun(this.loadImage(this.props.imageData, this.props.isScrolling));
        }
        // Evicted-detection: when LRU drops this image (src cleared) we still
        // hold the stale HTMLImageElement reference; on the NEXT re-render the
        // <img src=""> would render as broken. Drop our reference + reload.
        else if (
            this.state.image &&
            !this.state.image.getAttribute('src') &&
            this.loadingImageId !== this.props.imageData.id
        ) {
            this.setState({ image: null });
            ImageLoadManager.addAndRun(this.loadImage(this.props.imageData, this.props.isScrolling));
        }

        if (prevProps.isScrolling && !this.props.isScrolling) {
            ImageLoadManager.addAndRun(this.loadImage(this.props.imageData, false));
        }
    }

    shouldComponentUpdate(nextProps: Readonly<IProps>, nextState: Readonly<IState>, nextContext: any): boolean {
        return (
            this.props.imageData.id !== nextProps.imageData.id ||
            this.props.imageData.loadStatus !== nextProps.imageData.loadStatus ||
            this.props.imageData.isSelected !== nextProps.imageData.isSelected ||
            this.props.imageData.isVisitedByRoboflowAPI !== nextProps.imageData.isVisitedByRoboflowAPI ||
            this.props.imageData.labelRects?.length !== nextProps.imageData.labelRects?.length ||
            this.props.imageData.labelPolygons?.length !== nextProps.imageData.labelPolygons?.length ||
            this.state.image !== nextState.image ||
            this.props.isSelected !== nextProps.isSelected ||
            this.props.isChecked !== nextProps.isChecked ||
            this.props.isMultiSelected !== nextProps.isMultiSelected
        )
    }

    private loadImage = async (imageData: ImageData, isScrolling: boolean) => {
        if (isScrolling && this.isLoading && this.loadingImageId === imageData.id) return;
        const generation = ++this.requestGeneration;
        if (imageData.loadStatus) {
            const image = ImageRepository.getById(imageData.id);
            if (image && this.state.image !== image) {
                this.setState({ image });
                return;
            }
            if (!image) this.loadMissingImage(imageData, generation);
            return;
        }
        this.loadMissingImage(imageData, generation);
    };

    private loadMissingImage = (imageData: ImageData, generation: number) => {
        const file = imageData.fileData;
        if (!file) return;
        // 0字节占位文件 = on-demand 视频帧；即使 Redux 仍标记 loadStatus=true，
        // LRU 淘汰后也必须从后端重新生成缩略图。
        if (file.size === 0) {
            this.loadVideoFrameThumbnail(imageData, generation);
            return;
        }
        // 视频文件无法通过 FileUtil.loadImage 加载；同时检查扩展名以兼容
        // IndexedDB 恢复后 MIME type 丢失的情况。
        if (file.type.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv|m4v|ogg)$/i.test(file.name)) return;
        this.startLoading(imageData.id, generation);
        FileUtil.loadImage(file)
            .then((image: HTMLImageElement) => this.saveLoadedImage(image, imageData, generation))
            .catch((error) => this.handleLoadImageError(imageData, generation, error));
    };

    private loadVideoFrameThumbnail = async (imageData: ImageData, generation: number) => {
        const sessionId = EditorModel.videoSessionId;
        if (
            !sessionId ||
            this.loadingImageId === imageData.id && this.loadingGeneration === generation
        ) return;

        const match = imageData.fileData?.name?.match(/frame_(\d+)/);
        if (!match) return;
        const frameIdx = parseInt(match[1], 10);

        this.startLoading(imageData.id, generation);
        try {
            const frames = await FrameExtractorService.fetchFrameRange(sessionId, frameIdx, 1);
            if (!this.isCurrentRequest(imageData.id, generation)) return;
            if (!frames || frames.length === 0) { this.finishLoading(imageData.id, generation); return; }
            const blob = frames[0] as Blob;
            const fullUrl = URL.createObjectURL(blob);
            const fullImg = new Image();
            fullImg.onload = () => {
                if (!this.isCurrentRequest(imageData.id, generation)) {
                    URL.revokeObjectURL(fullUrl);
                    return;
                }
                // Downscale to thumbnail size (~200px) to save memory.
                // Full-size frames (e.g. 2560×1440 ≈ 15MB decoded) are wasteful
                // for sidebar thumbnails displayed at ~150×84px.
                const thumbnailSize = getVideoThumbnailSize(fullImg.naturalWidth, fullImg.naturalHeight);
                const thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = thumbnailSize.width;
                thumbCanvas.height = thumbnailSize.height;
                const ctx = thumbCanvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(fullImg, 0, 0, thumbnailSize.width, thumbnailSize.height);
                }
                URL.revokeObjectURL(fullUrl); // Release full-size blob

                // Async toBlob instead of sync toDataURL to avoid blocking main thread
                thumbCanvas.toBlob((thumbBlob) => {
                    if (!this.isCurrentRequest(imageData.id, generation)) return;
                    if (!thumbBlob) { this.handleLoadImageError(imageData, generation); return; }
                    const blobUrl = URL.createObjectURL(thumbBlob);
                    const thumbImg = new Image();
                    // 不撤销 blobUrl：<img src={image.src}> 渲染仍指向它，撤销会变破图
                    thumbImg.onload = () => this.saveLoadedImage(thumbImg, imageData, generation);
                    thumbImg.onerror = () => {
                        URL.revokeObjectURL(blobUrl);
                        this.handleLoadImageError(imageData, generation);
                    };
                    thumbImg.src = blobUrl;
                }, 'image/jpeg', 0.6);
            };
            fullImg.onerror = () => {
                URL.revokeObjectURL(fullUrl);
                this.handleLoadImageError(imageData, generation);
            };
            fullImg.src = fullUrl;
        } catch (error) {
            this.handleLoadImageError(imageData, generation, error);
        }
    };

    private startLoading = (imageId: string, generation: number) => {
        this.isLoading = true;
        this.loadingImageId = imageId;
        this.loadingGeneration = generation;
    };

    private finishLoading = (imageId: string, generation: number) => {
        if (this.loadingImageId !== imageId || this.loadingGeneration !== generation) return;
        this.isLoading = false;
        this.loadingImageId = null;
    };

    private isCurrentRequest = (imageId: string, generation: number): boolean =>
        this.mounted && generation === this.requestGeneration && imageId === this.props.imageData.id;

    private discardLoadedImage = (image: HTMLImageElement) => {
        const source = image.getAttribute('src');
        if (source?.startsWith('blob:')) URL.revokeObjectURL(source);
        image.src = '';
    };

    private saveLoadedImage = (image: HTMLImageElement, imageData: ImageData, generation: number) => {
        if (!this.isCurrentRequest(imageData.id, generation)) {
            this.discardLoadedImage(image);
            return;
        }
        const updated = { ...imageData, loadStatus: true };
        this.props.updateImageDataById(updated.id, updated);
        ImageRepository.storeImage(imageData.id, image);
        if (imageData.id === this.props.imageData.id) {
            this.setState({ image });
        }
        this.finishLoading(imageData.id, generation);
    };

    private getStyle = () => {
        const { size } = this.props;

        const containerRect: IRect = {
            x: 0.15 * size.width,
            y: 0.15 * size.height,
            width: 0.7 * size.width,
            height: 0.7 * size.height
        };

        const imageRect: IRect = {
            x: 0,
            y: 0,
            width: this.state.image.width,
            height: this.state.image.height
        };

        const imageRatio = RectUtil.getRatio(imageRect);
        const imagePosition: IRect = RectUtil.fitInsideRectWithRatio(containerRect, imageRatio);

        return {
            width: imagePosition.width,
            height: imagePosition.height,
            left: imagePosition.x,
            top: imagePosition.y
        }
    };

    private handleLoadImageError = (imageData?: ImageData, generation?: number, error?: any) => {
        if (imageData && generation !== undefined) this.finishLoading(imageData.id, generation);
        else {
            this.isLoading = false;
            this.loadingImageId = null;
        }
        if (imageData) {
            console.error(`[ImagePreview] 图像加载失败: ${imageData.fileData?.name} (size=${imageData.fileData?.size})`, error);
        }
    };

    private hasAnyLabels = (): boolean => {
        const { imageData } = this.props;
        return (imageData.labelRects?.length > 0) ||
               (imageData.labelPoints?.length > 0) ||
               (imageData.labelPolygons?.length > 0) ||
               (imageData.labelLines?.length > 0);
    };

    // 返回 'manual' | 'ai' | 'none'
    // 混合标注优先 manual（蓝色）
    private getLabelOrigin = (): 'manual' | 'ai' | 'none' => {
        const { imageData } = this.props;
        const allLabels = [
            ...(imageData.labelRects || []),
            ...(imageData.labelPoints || []),
            ...(imageData.labelPolygons || []),
            ...(imageData.labelLines || []),
        ];
        if (allLabels.length === 0) return 'none';
        const hasManual = allLabels.some((l: any) => !l.isCreatedByAI);
        if (hasManual) return 'manual';
        return 'ai';
    };

    private isAIProcessedImage = (): boolean => {
        const { imageData } = this.props;
        return imageData.isVisitedByRoboflowAPI;
    };

    private getClassName = () => {
        return classNames(
            "ImagePreview",
            {
                "selected": this.props.isSelected || this.props.isMultiSelected,
            }
        );
    };

    public render() {
        const {
            isChecked,
            style,
            onClick
        } = this.props;
        const imageReady = Boolean(
            this.state.image?.getAttribute('src') &&
            this.state.image.width > 0 &&
            this.state.image.height > 0
        );

        return (
            <div
                className={this.getClassName()}
                style={style}
                onClick={onClick ? onClick : undefined}
            >
                {imageReady ?
                    [
                        <div
                            className="Foreground"
                            key={"Foreground"}
                            style={this.getStyle()}
                        >
                            <img
                                className="Image"
                                draggable={false}
                                src={this.state.image.src}
                                alt={this.state.image.alt}
                                style={{ ...this.getStyle(), left: 0, top: 0 }}
                            />
                            <div
                                className="DeleteButton"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (this.props.isMultiSelected && this.props.isFirstSelected) {
                                        this.props.deleteSelectedImages();
                                    } else {
                                        this.props.deleteImageById(this.props.imageData.id);
                                    }
                                }}
                            >
                                ✕
                            </div>
                            {this.getLabelOrigin() !== 'none' && (
                                <div className={
                                    this.getLabelOrigin() === 'manual' ? "ManualLabelIndicator" : "AILabelIndicator"
                                }>
                                    ✓
                                </div>
                            )}
                        </div>,
                        <div
                            className={`Background${this.getLabelOrigin() === 'manual' ? ' has-manual-labels' : this.getLabelOrigin() === 'ai' ? ' has-ai-labels' : ''}`}
                            key={"Background"}
                            style={this.getStyle()}
                        />
                    ] :
                    <ClipLoader
                        size={30}
                        color={CSSHelper.getLeadingColor()}
                        loading={true}
                    />}
            </div>)
    }
}

const mapDispatchToProps = {
    updateImageDataById,
    deleteImageById,
    deleteSelectedImages
};

const mapStateToProps = (state: AppState) => ({});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ImagePreview);
