import React, {useState, useEffect, useCallback, useRef} from 'react';
import {connect} from 'react-redux';
import {Direction} from '../../../data/enums/Direction';
import {ISize} from '../../../interfaces/ISize';
import {Settings} from '../../../settings/Settings';
import {AppState} from '../../../store';
import {ImageData} from '../../../store/labels/types';
import {VideoData} from '../../../store/video/types';
import ImagesList from '../SideNavigationBar/ImagesList/ImagesList';
import QueueList from '../SideNavigationBar/QueueList/QueueList';
import LabelsToolkit from '../SideNavigationBar/LabelsToolkit/LabelsToolkit';
import {SideNavigationBar} from '../SideNavigationBar/SideNavigationBar';
import {VerticalEditorButton} from '../VerticalEditorButton/VerticalEditorButton';
import './EditorContainer.scss';
import Editor from '../Editor/Editor';
import VideoEditor from '../VideoEditor/VideoEditor';
import {ContextManager} from '../../../logic/hotkey/ContextManager';
import {ContextType} from '../../../data/enums/ContextType';
import EditorBottomNavigationBar from '../EditorBottomNavigationBar/EditorBottomNavigationBar';
import EditorTopNavigationBar from '../EditorTopNavigationBar/EditorTopNavigationBar';
import {ProjectType} from '../../../data/enums/ProjectType';
import {useDropzone, DropzoneOptions} from 'react-dropzone';
import {addImageData, updateImageData, updateActiveImageIndex} from '../../../store/labels/actionCreators';
import {updateActivePopupType} from '../../../store/general/actionCreators';
import {addVideoData, updateVideoMode} from '../../../store/video/actionCreators';
import {addQueueItems, setActiveQueueItem, updateQueueItem} from '../../../store/queue/actionCreators';
import {QueueActions} from '../../../logic/actions/QueueActions';
import {QueueDataSyncStatus, QueueItem, QueueItemType, QueueItemStatus} from '../../../store/queue/types';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {ImageDataUtil} from '../../../utils/ImageDataUtil';
import {sortBy} from 'lodash';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import InferenceResultsButton from '../InferenceResultsButton/InferenceResultsButton';
import InferenceResultsView from '../InferenceResultsView/InferenceResultsView';
import BatchStatisticsView from '../BatchStatisticsView/BatchStatisticsView';
import {AutoSaveService} from '../../../services/AutoSaveService';
import {TaskManagerButton} from '../TaskManager/TaskManagerButton';
import {TaskManagerPanel} from '../TaskManager/TaskManagerPanel';
import {v4 as uuidv4} from 'uuid';
import {ImageRepository} from '../../../logic/imageRepository/ImageRepository';
import {FrameExtractorService} from '../../../services/FrameExtractorService';
import {EditorModel} from '../../../staticModels/EditorModel';
import {store} from '../../../index';
import {submitNewNotification, updateNotificationById, deleteNotificationById} from '../../../store/notifications/actionCreators';
import {NotificationUtil} from '../../../utils/NotificationUtil';
import {PendingImportFiles} from '../../../utils/PendingImportFiles';
import {DataBatchSyncService} from '../../../services/DataBatchSyncService';
import {getDatasetContentSignature} from '../../../services/DatasetContentSignature';
// import {inferenceEventEmitter, InferenceResultsEvent} from '../../../logic/actions/AISegmentationActions';

interface IProps {
    windowSize: ISize;
    activeImageIndex: number;
    imagesData: ImageData[];
    activeContext: ContextType;
    projectType: ProjectType;
    language: Language;
    isVideoMode: boolean;
    activeVideo: VideoData | null;
    queueItems: QueueItem[];
    activeQueueItemId: string | null;
    addImageDataAction: (imageData: ImageData[]) => any;
    updateImageDataAction: (imageData: ImageData[]) => any;
    updateActiveImageIndexAction: (activeImageIndex: number) => any;
    updateActivePopupTypeAction: (activePopupType: PopupWindowType) => any;
    addVideoDataAction: (videoData: VideoData) => any;
    updateVideoModeAction: (isVideoMode: boolean) => any;
    addQueueItemsAction: (items: QueueItem[]) => any;
    setActiveQueueItemAction: (itemId: string | null) => any;
    updateQueueItemAction: (itemId: string, updates: Partial<QueueItem>) => any;
}

const EditorContainer: React.FC<IProps> = (
    {
        windowSize,
        activeImageIndex,
        imagesData,
        activeContext,
        projectType,
        language,
        isVideoMode,
        activeVideo,
        queueItems,
        activeQueueItemId,
        addImageDataAction,
        updateImageDataAction,
        updateActiveImageIndexAction,
        updateActivePopupTypeAction,
        addVideoDataAction,
        updateVideoModeAction,
        addQueueItemsAction,
        setActiveQueueItemAction,
        updateQueueItemAction
    }) => {
    const [leftTabStatus, setLeftTabStatus] = useState(true);
    const [rightTabStatus, setRightTabStatus] = useState(true);
    const [showInferenceResults, setShowInferenceResults] = useState<boolean>(false);
    const [showBatchStatistics, setShowBatchStatistics] = useState<boolean>(false);
    const [showQueueList, setShowQueueList] = useState<boolean>(false);
    const [isWindowDragActive, setIsWindowDragActive] = useState(false);
    const [videoProcessing, setVideoProcessing] = useState<{phase: string; progress: number; fileName: string} | null>(null);

    // Task Manager 浮动面板开关 + 固定状态 + 按钮 ref
    const [taskPanelOpen, setTaskPanelOpen] = useState(false);
    const [taskPanelPinned, setTaskPanelPinned] = useState(false);
    const taskButtonRef = useRef<HTMLDivElement>(null);
    const taskClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const previousDatasetSignatureRef = useRef<string>(getDatasetContentSignature(imagesData));
    const previousActiveQueueItemIdRef = useRef<string | null>(activeQueueItemId);

    const handleTaskButtonClick = useCallback(() => {
        if (taskClickTimer.current !== null) {
            // 双击：固定/取消固定
            clearTimeout(taskClickTimer.current);
            taskClickTimer.current = null;
            setTaskPanelOpen(true);
            setTaskPanelPinned(p => !p);
        } else {
            taskClickTimer.current = setTimeout(() => {
                taskClickTimer.current = null;
                // 单击：切换开关，关闭时清除固定
                setTaskPanelOpen(o => {
                    if (o) setTaskPanelPinned(false);
                    return !o;
                });
            }, 220);
        }
    }, []);

    useEffect(() => {
        const openTaskCenter = () => {
            setTaskPanelOpen(true);
            setTaskPanelPinned(true);
        };
        window.addEventListener('opensight:open-task-center', openTaskCenter);
        return () => window.removeEventListener('opensight:open-task-center', openTaskCenter);
    }, []);

    useEffect(() => {
        const activeItem = queueItems.find(item => item.id === activeQueueItemId);
        const sameBatch = previousActiveQueueItemIdRef.current === activeQueueItemId;
        const currentSignature = getDatasetContentSignature(imagesData);
        const annotationsChanged = previousDatasetSignatureRef.current !== currentSignature;
        if (sameBatch && annotationsChanged && activeItem?.dataSyncStatus === QueueDataSyncStatus.SYNCED) {
            updateQueueItemAction(activeItem.id, {dataSyncStatus: QueueDataSyncStatus.DIRTY});
        }
        previousDatasetSignatureRef.current = currentSignature;
        previousActiveQueueItemIdRef.current = activeQueueItemId;
    }, [activeQueueItemId, imagesData, queueItems, updateQueueItemAction]);

    // 手动保存
    const [lastSavedTime, setLastSavedTime] = useState<Date | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const triggerSaveFlash = useCallback(() => {
        setLastSavedTime(new Date());
        setIsSaving(true);
        setTimeout(() => setIsSaving(false), 800);
    }, []);

    const handleSave = useCallback(() => {
        AutoSaveService.saveCurrentState();
    }, []);

    useEffect(() => {
        AutoSaveService.onSaveComplete = triggerSaveFlash;
        return () => { AutoSaveService.onSaveComplete = null; };
    }, [triggerSaveFlash]);

    // 盾牌颜色：绿色 = backend 已连接，灰色 = 未连接
    const [backendConnected, setBackendConnected] = useState(false);
    useEffect(() => {
        const handler = (e: Event) =>
            setBackendConnected((e as CustomEvent<{connected: boolean}>).detail.connected);
        window.addEventListener('opensight:backend-status', handler);
        return () => window.removeEventListener('opensight:backend-status', handler);
    }, []);

    const formatSavedTime = (d: Date): string => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const h = d.getHours();
        const min = String(d.getMinutes()).padStart(2, '0');
        const sec = String(d.getSeconds()).padStart(2, '0');
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${yyyy}/${mm}/${dd} ${h12}:${min}:${sec} ${ampm}`;
    };

    const saveTooltip = language === Language.CHINESE
        ? `保存标注 (Ctrl+S)\n${lastSavedTime ? '上次保存: ' + formatSavedTime(lastSavedTime) : '尚未保存'}`
        : `Save (Ctrl+S)\n${lastSavedTime ? 'Last saved: ' + formatSavedTime(lastSavedTime) : 'Not saved yet'}`;

    // 监听 window 级别的拖拽，确保 canvas/Scrollbars 不会阻断 drop 事件
    useEffect(() => {
        let dragCounter = 0;
        const onDragEnter = () => { dragCounter++; setIsWindowDragActive(true); };
        const onDragLeave = () => { dragCounter--; if (dragCounter <= 0) { dragCounter = 0; setIsWindowDragActive(false); } };
        const onDrop = () => { dragCounter = 0; setIsWindowDragActive(false); };
        window.addEventListener('dragenter', onDragEnter);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('drop', onDrop);
        return () => {
            window.removeEventListener('dragenter', onDragEnter);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop', onDrop);
        };
    }, []);
    
    const currentTexts = LanguageConfig[language];
    
    // 监听推理完成事件，自动切换到推理结果视图
    useEffect(() => {
        const handleInferenceResults = (event: any) => {
            if (event.type === 'SHOW_INFERENCE_RESULTS' && event.results.length > 0) {
                // 自动切换到推理结果视图
                setRightTabStatus(true);
                setShowInferenceResults(true);
                if (activeContext !== ContextType.RIGHT_NAVBAR) {
                    ContextManager.switchCtx(ContextType.RIGHT_NAVBAR);
                }
                console.log('Auto-switched to inference results view with', event.results.length, 'objects');
            }
        };
        
        // inferenceEventEmitter.addListener(handleInferenceResults);
        
        return () => {
            // inferenceEventEmitter.removeListener(handleInferenceResults);
        };
    }, [activeContext]);

    // 批量推理完成后自动弹出统计面板
    useEffect(() => {
        const handleBatchComplete = (e: Event) => {
            const count = (e as CustomEvent).detail?.count ?? 0;
            if (count > 2) {
                EditorModel.lastBatchInferenceImageCount = 0;
                setRightTabStatus(true);
                setShowBatchStatistics(true);
                setShowInferenceResults(false);
            }
        };
        window.addEventListener('batchInferenceComplete', handleBatchComplete);
        return () => window.removeEventListener('batchInferenceComplete', handleBatchComplete);
    }, []);

    // 监听标注数据变化并触发自动保存
    // 5 秒防抖：只有 imagesData 引用变化（标注增删改）才触发，
    // 切帧(activeImageIndex)和切语言不触发保存。
    const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (imagesData.length > 0) {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }

            saveTimeoutRef.current = setTimeout(() => {
                AutoSaveService.saveCurrentState();
                saveTimeoutRef.current = null;
            }, 5000); // 5秒防抖，避免频繁保存
        }

        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = null;
            }
        };
    }, [imagesData]); // eslint-disable-line react-hooks/exhaustive-deps

    // 生成缩略图辅助函数
    const generateThumbnail = async (file: File): Promise<string | undefined> => {
        return new Promise((resolve) => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        const maxSize = 100;
                        let width = img.width;
                        let height = img.height;
                        
                        if (width > height) {
                            if (width > maxSize) {
                                height *= maxSize / width;
                                width = maxSize;
                            }
                        } else {
                            if (height > maxSize) {
                                width *= maxSize / height;
                                height = maxSize;
                            }
                        }
                        
                        canvas.width = width;
                        canvas.height = height;
                        ctx?.drawImage(img, 0, 0, width, height);
                        resolve(canvas.toDataURL());
                    };
                    img.src = e.target?.result as string;
                };
                reader.readAsDataURL(file);
            } else if (file.type.startsWith('video/')) {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.onloadedmetadata = () => {
                    video.currentTime = 0;
                };
                const videoUrl = URL.createObjectURL(file);
                video.onseeked = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const maxSize = 100;
                    let width = video.videoWidth;
                    let height = video.videoHeight;

                    if (width > height) {
                        if (width > maxSize) {
                            height *= maxSize / width;
                            width = maxSize;
                        }
                    } else {
                        if (height > maxSize) {
                            width *= maxSize / height;
                            height = maxSize;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    ctx?.drawImage(video, 0, 0, width, height);
                    URL.revokeObjectURL(videoUrl);
                    resolve(canvas.toDataURL());
                };
                video.onerror = () => {
                    URL.revokeObjectURL(videoUrl);
                    resolve(undefined);
                };
                video.src = videoUrl;
            } else {
                resolve(undefined);
            }
        });
    };

    // 从文件路径提取文件夹名称
    const getFolderName = (path: string): string | null => {
        const parts = path.split('/');
        if (parts.length > 1) {
            return parts[parts.length - 2];
        }
        return null;
    };

    // 拖拽上传功能 - 支持图片和视频（仅拖拽，不支持点击）
    // handleFileDrop 也被 QueueList 侧边栏的 opensight:drop-files 事件复用
    const handleFileDrop = useCallback(async (files: File[]) => {
            if (files.length > 0) {
                const sortedFiles = sortBy(files, (item: File) => item.name);

                // 标注文件优先：拦截并转交导入弹窗
                const ANNOTATION_EXTS = ['.json', '.txt', '.xml', '.zip'];
                const annotationFiles = sortedFiles.filter(f =>
                    ANNOTATION_EXTS.some(ext => f.name.toLowerCase().endsWith(ext))
                );
                if (annotationFiles.length > 0) {
                    PendingImportFiles.set(annotationFiles);
                    updateActivePopupTypeAction(PopupWindowType.IMPORT_ANNOTATIONS);
                    return;
                }

                // 检查是否包含视频文件
                const videoFiles = sortedFiles.filter(file => file.type.startsWith('video/'));
                const imageFiles = sortedFiles.filter(file => file.type.startsWith('image/'));
                
                // 按照文件路径分组图像
                const filesByFolder = new Map<string, File[]>();
                for (const file of imageFiles) {
                    const folderPath = (file as any).webkitRelativePath || file.name;
                    const folderName = getFolderName(folderPath) || 'images';
                    
                    if (!filesByFolder.has(folderName)) {
                        filesByFolder.set(folderName, []);
                    }
                    filesByFolder.get(folderName)!.push(file);
                }

                // 添加到队列
                const newQueueItems: QueueItem[] = [];
                
                // Video files: backend FFmpeg extraction -> fast_ffmpeg_mode (FramePlayer)
                for (const videoFile of videoFiles) {
                    try {
                        console.log(`[FFmpeg] 开始拆帧: ${videoFile.name}`);
                        setVideoProcessing({ phase: '上传视频...', progress: 0, fileName: videoFile.name });

                        const result = await FrameExtractorService.openSession(
                            videoFile, 0,
                            (phase, current, total) => {
                                const pct = total > 0 ? Math.round((current / total) * 100) : 0;
                                if (phase === '上传视频') {
                                    setVideoProcessing({ phase: `上传中 ${pct >= 100 ? 99 : pct}%`, progress: pct, fileName: videoFile.name });
                                } else if (phase === '解压帧') {
                                    setVideoProcessing({ phase: `上传中 ${pct >= 100 ? 99 : pct}%`, progress: pct, fileName: videoFile.name });
                                } else {
                                    setVideoProcessing({ phase, progress: 0, fileName: videoFile.name });
                                }
                            }
                        );
                        const isOnDemand = !!result.sessionId;
                        console.log(`[FFmpeg] Done: fast_ffmpeg_mode (${isOnDemand ? 'on-demand' : 'full-load'}), ${result.totalFrames} frames`);

                        // Initialize global frame pool for fast_ffmpeg_mode (FramePlayer handles decoding)
                        EditorModel.preloadedImageCache = new Map();
                        if (isOnDemand) {
                            EditorModel.videoSessionId = result.sessionId!;
                        }
                        EditorModel.videoFrameFiles = [];

                        // 缩略图从第 0 帧文件生成
                        let thumbnail: string | undefined;
                        if (EditorModel.videoFrameFiles?.[0]) {
                            thumbnail = await generateThumbnail(EditorModel.videoFrameFiles[0]);
                        } else if (isOnDemand) {
                            // 大视频：取第 0 帧生成缩略图
                            try {
                                const batch = await FrameExtractorService.fetchFrameRange(result.sessionId!, 0, 1);
                                if (batch.length > 0) {
                                    EditorModel.videoFrameFiles[0] = batch[0];
                                    thumbnail = await generateThumbnail(batch[0]);
                                }
                            } catch { /* skip */ }
                        }

                        const item: QueueItem = {
                            id: uuidv4(),
                            name: videoFile.name,
                            type: QueueItemType.VIDEO,
                            file: videoFile,
                            extractedFrames: undefined,
                            extractionMetadata: {
                                fps: result.fps,
                                duration: result.duration,
                                totalFrames: result.totalFrames,
                                width: result.width,
                                height: result.height,
                            },
                            status: QueueItemStatus.PENDING,
                            uploadedAt: Date.now(),
                            thumbnail
                        };
                        newQueueItems.push(item);
                        setVideoProcessing(null);
                    } catch (err) {
                        console.error('[FFmpeg] Extraction failed, falling back to raw_browser_mode:', err);
                        setVideoProcessing(null);
                        // Surface the backend's real error (e.g. "磁盘空间不足") instead of
                        // a generic "FFmpeg failed" — axios attaches it on .response.data.detail.
                        const detail = (err as any)?.response?.data?.detail;
                        const description = typeof detail === 'string' && detail.trim()
                            ? `${detail}\n（已回退到 raw_browser_mode）`
                            : '已回退到 raw_browser_mode';
                        const errorNotification = NotificationUtil.createErrorNotification({
                            header: `视频上传失败: ${videoFile.name}`,
                            description,
                        });
                        store.dispatch(submitNewNotification(errorNotification));
                        // Linger 12s for actionable error (disk message), 5s for generic.
                        const ttl = typeof detail === 'string' && detail.trim() ? 12000 : 5000;
                        setTimeout(() => store.dispatch(deleteNotificationById(errorNotification.id)), ttl);
                        // Fallback: raw_browser_mode (browser-native <video> element, no pre-extracted frames)
                        const thumbnail = await generateThumbnail(videoFile);
                        const item: QueueItem = {
                            id: uuidv4(),
                            name: videoFile.name,
                            type: QueueItemType.VIDEO,
                            file: videoFile,
                            status: QueueItemStatus.PENDING,
                            uploadedAt: Date.now(),
                            thumbnail
                        };
                        newQueueItems.push(item);
                    }
                }

                // 添加图像文件（按文件夹分组）
                for (const [folderName, files] of filesByFolder.entries()) {
                    if (files.length === 1) {
                        const file = files[0];
                        const thumbnail = await generateThumbnail(file);
                        const item: QueueItem = {
                            id: uuidv4(),
                            name: file.name,
                            type: QueueItemType.IMAGE,
                            file: file,
                            status: QueueItemStatus.PENDING,
                            uploadedAt: Date.now(),
                            thumbnail
                        };
                        newQueueItems.push(item);
                    } else {
                        const sortedFolderFiles = files.sort((a, b) => a.name.localeCompare(b.name));
                        const thumbnail = await generateThumbnail(sortedFolderFiles[0]);
                        const item: QueueItem = {
                            id: uuidv4(),
                            name: folderName,
                            type: QueueItemType.FOLDER,
                            files: sortedFolderFiles,
                            status: QueueItemStatus.PENDING,
                            uploadedAt: Date.now(),
                            thumbnail
                        };
                        newQueueItems.push(item);
                    }
                }

                addQueueItemsAction(newQueueItems);

                // 始终自动切换到新上传的第一个队列项
                if (newQueueItems.length > 0) {
                    await QueueActions.switchToQueueItem(newQueueItems[0], imagesData);
                }

                const activeBatchData = store.getState().labels.imagesData;
                const labelNames = store.getState().labels.labels;
                newQueueItems
                    .filter(item => item.type !== QueueItemType.VIDEO)
                    .forEach((item, index) => {
                        DataBatchSyncService.syncQueueItem(
                            item,
                            index === 0 ? activeBatchData : [],
                            labelNames,
                        ).catch(() => undefined);
                    });
                
                // 上传后立即触发保存
                setTimeout(() => {
                    AutoSaveService.saveCurrentState();
                }, 500);
            }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [imagesData, addQueueItemsAction, updateActivePopupTypeAction]);

    const {acceptedFiles, getRootProps, getInputProps, isDragActive, open: openFileDialog} = useDropzone({
        noClick: true,
        noKeyboard: true,
        accept: {
            'image/*': ['.jpeg', '.png', '.jpg'],
            'video/*': ['.mp4', '.mov', '.avi', '.webm'],
            'application/json': ['.json'],
            'text/plain': ['.txt'],
            'application/xml': ['.xml'],
            'text/xml': ['.xml'],
            'application/zip': ['.zip'],
            'application/x-zip-compressed': ['.zip'],
            'application/octet-stream': ['.zip'],
        },
        onDrop: handleFileDrop,
    } as DropzoneOptions);

    useEffect(() => {
        const handler = (e: Event) => handleFileDrop((e as CustomEvent<File[]>).detail);
        window.addEventListener('opensight:drop-files', handler);
        return () => window.removeEventListener('opensight:drop-files', handler);
    }, [handleFileDrop]);

    const calculateEditorSize = (): ISize => {
        if (windowSize) {
            const leftTabWidth = leftTabStatus ? Settings.SIDE_NAVIGATION_BAR_WIDTH_OPEN_PX : Settings.SIDE_NAVIGATION_BAR_WIDTH_CLOSED_PX;
            const rightTabWidth = rightTabStatus ? Settings.SIDE_NAVIGATION_BAR_WIDTH_OPEN_PX : Settings.SIDE_NAVIGATION_BAR_WIDTH_CLOSED_PX;
            return {
                width: windowSize.width - leftTabWidth - rightTabWidth,
                height: windowSize.height - Settings.TOP_NAVIGATION_BAR_HEIGHT_PX
                    - Settings.EDITOR_BOTTOM_NAVIGATION_BAR_HEIGHT_PX - Settings.EDITOR_TOP_NAVIGATION_BAR_HEIGHT_PX,
            }
        }
        else
            return null;
    };

    const leftSideBarButtonOnClick = () => {
        // 如果左侧导航栏关闭，则打开并显示图像
        if (!leftTabStatus) {
            setLeftTabStatus(true);
            setShowQueueList(false);
            ContextManager.switchCtx(ContextType.LEFT_NAVBAR);
        }
        // 如果左侧导航栏打开且当前显示图像，则关闭导航栏
        else if (leftTabStatus && !showQueueList) {
            setLeftTabStatus(false);
            ContextManager.restoreCtx();
        }
        // 如果左侧导航栏打开但显示队列，则切换到图像
        else {
            setShowQueueList(false);
        }
    };

    const queueButtonOnClick = () => {
        // 如果左侧导航栏关闭，则打开并显示队列
        if (!leftTabStatus) {
            setLeftTabStatus(true);
            setShowQueueList(true);
            ContextManager.switchCtx(ContextType.LEFT_NAVBAR);
        }
        // 如果左侧导航栏打开且当前显示队列，则关闭导航栏
        else if (leftTabStatus && showQueueList) {
            setLeftTabStatus(false);
            setShowQueueList(false);
            ContextManager.restoreCtx();
        }
        // 如果左侧导航栏打开但显示图像，则切换到队列
        else {
            setShowQueueList(true);
        }
    };

    const leftSideBarCompanionRender = () => {
        return <>
            <VerticalEditorButton
                label={currentTexts.images}
                image={'/ico/camera.png'}
                imageAlt={'images'}
                onClick={leftSideBarButtonOnClick}
                isActive={leftTabStatus && !showQueueList}
                style={{top: '81px'}}
            />
            <VerticalEditorButton
                label={currentTexts.queue}
                image={'/ico/files.png'}
                imageAlt={'queue'}
                onClick={queueButtonOnClick}
                isActive={leftTabStatus && showQueueList}
                style={{top: '167px'}}
            />
            <div className='VersionWatermark' onClick={() => updateActivePopupTypeAction(PopupWindowType.CHANGELOG)}>v2.8.2</div>
            <div
                className='SaveButtonBottom'
                onClick={handleSave}
                title={saveTooltip}
            >
                <img
                    draggable={false}
                    alt='save'
                    src='ico/shield.png'
                    style={{
                        width: 14, height: 14,
                        filter: isSaving
                            ? 'brightness(0) invert(35%) sepia(90%) saturate(800%) hue-rotate(115deg) brightness(1.1)'
                            : backendConnected
                                ? 'brightness(0) invert(48%) sepia(98%) saturate(1500%) hue-rotate(192deg) brightness(1.05)'
                                : 'brightness(0) invert(1)',
                        opacity: (isSaving || backendConnected) ? 1 : 0.4,
                        transition: 'filter 0.4s ease, opacity 0.4s ease',
                    }}
                />
            </div>
        </>
    };

    const leftSideBarRender = () => {
        return showQueueList ? <QueueList/> : <ImagesList/>
    };

    type RightPanel = 'labels' | 'inference' | 'statistics';
    const activeRightPanel: RightPanel = showBatchStatistics ? 'statistics' : showInferenceResults ? 'inference' : 'labels';

    const switchRightPanel = (target: RightPanel) => {
        if (!rightTabStatus) {
            setRightTabStatus(true);
            ContextManager.switchCtx(ContextType.RIGHT_NAVBAR);
        } else if (activeRightPanel === target) {
            setRightTabStatus(false);
            ContextManager.restoreCtx();
            // reset
            setShowInferenceResults(false);
            setShowBatchStatistics(false);
            return;
        }
        setShowInferenceResults(target === 'inference');
        setShowBatchStatistics(target === 'statistics');
    };

    const rightSideBarButtonOnClick = () => switchRightPanel('labels');
    const inferenceResultsButtonOnClick = () => switchRightPanel('inference');
    const batchStatisticsButtonOnClick = () => switchRightPanel('statistics');

    const rightSideBarCompanionRender = () => {
        return <>
            <VerticalEditorButton
                label={currentTexts.labels}
                image={'/ico/tags.png'}
                imageAlt={'labels'}
                onClick={rightSideBarButtonOnClick}
                isActive={rightTabStatus && activeRightPanel === 'labels'}
                style={{top: '81px'}}
            />
            <InferenceResultsButton
                onToggle={inferenceResultsButtonOnClick}
                isActive={rightTabStatus && activeRightPanel === 'inference'}
            />
            <VerticalEditorButton
                label={language === Language.CHINESE ? '统计情况' : 'Statistics'}
                image={'/ico/stats.png'}
                imageAlt={'batch statistics'}
                onClick={batchStatisticsButtonOnClick}
                isActive={rightTabStatus && activeRightPanel === 'statistics'}
                style={{top: '253px'}}
            />
            <TaskManagerButton
                buttonRef={taskButtonRef}
                isActive={taskPanelOpen}
                isPinned={taskPanelPinned}
                onClick={handleTaskButtonClick}
            />
        </>
    };

    const rightSideBarRender = () => {
        if (showBatchStatistics) return <BatchStatisticsView/>;
        if (showInferenceResults) return <InferenceResultsView/>;
        return <LabelsToolkit/>;
    };

    return (
        <div className='EditorContainer'>
            <SideNavigationBar
                direction={Direction.LEFT}
                isOpen={leftTabStatus}
                isWithContext={activeContext === ContextType.LEFT_NAVBAR}
                renderCompanion={leftSideBarCompanionRender}
                renderContent={leftSideBarRender}
                key='left-side-navigation-bar'
            />
            <div 
                {...getRootProps({
                    className: `EditorWrapper ${isVideoMode ? 'VideoMode' : ''} ${isDragActive ? 'drag-active' : ''}`,
                    onMouseDown: (e) => {
                        // 只有在非拖拽状态下才切换上下文
                        if (!isDragActive) {
                            ContextManager.switchCtx(ContextType.EDITOR);
                        }
                    }
                })}
                key='editor-wrapper'
            >
                <input {...getInputProps()} style={{ display: 'none' }} />
                {/* 拖拽捕获层：当 canvas/Scrollbars 存在时确保 drop 事件能被 dropzone 接收。
                    top: 40px 让 EditorTopNavigationBar（高度即 40px）保留自己的背景，
                    避免拖拽时整条工具栏也被蓝色蒙层覆盖。 */}
                {isWindowDragActive && (
                    <div style={{
                        position: 'absolute',
                        top: projectType === ProjectType.OBJECT_DETECTION ? 40 : 0,
                        left: 0, right: 0, bottom: 0,
                        zIndex: 500, pointerEvents: 'all',
                        backgroundColor: isDragActive ? 'rgba(0, 120, 212, 0.08)' : 'transparent'
                    }} />
                )}
                {projectType === ProjectType.OBJECT_DETECTION && <EditorTopNavigationBar
                    key='editor-top-navigation-bar'
                />}
                {isVideoMode && activeVideo ? (
                    // 视频编辑模式
                    <VideoEditor
                        editorSize={calculateEditorSize()}
                        key='video-editor'
                    />
                ) : imagesData.length > 0 && activeImageIndex < imagesData.length && imagesData[activeImageIndex] ? (
                    // 图片编辑模式
                    <>
                        <Editor
                            size={calculateEditorSize()}
                            imageData={imagesData[activeImageIndex]}
                            key='editor'
                        />
                        <EditorBottomNavigationBar
                            imageData={imagesData[activeImageIndex]}
                            size={calculateEditorSize()}
                            totalImageCount={imagesData.length}
                            key='editor-bottom-navigation-bar'
                        />
                    </>
                ) : videoProcessing ? (
                    <div className='EmptyProjectView' style={{cursor: 'default'}}>
                        <div className='EmptyProjectContent'>
                            <div className='VideoProcessingOverlay'>
                                <div className='ProcessingSpinner'></div>
                                <h2>{videoProcessing.fileName}</h2>
                                <p>{videoProcessing.phase}</p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className={`EmptyProjectView ${isDragActive ? 'drag-active' : ''}`} onClick={openFileDialog} style={{cursor: 'pointer'}}>
                        <div className='EmptyProjectContent'>
                            <img
                                draggable={false}
                                alt={'empty-project'}
                                src={'ico/box-opened.png'}
                            />
                            <h2>{currentTexts.welcomeTitle}</h2>
                            <p>{isDragActive ? currentTexts.dragActiveMessage : currentTexts.welcomeDescription}</p>
                        </div>
                    </div>
                )}
            </div>
            <SideNavigationBar
                direction={Direction.RIGHT}
                isOpen={rightTabStatus}
                isWithContext={activeContext === ContextType.RIGHT_NAVBAR}
                renderCompanion={rightSideBarCompanionRender}
                renderContent={rightSideBarRender}
                key='right-side-navigation-bar'
            />
            {taskPanelOpen && (
                <TaskManagerPanel
                    onClose={() => { setTaskPanelOpen(false); setTaskPanelPinned(false); }}
                    excludeRef={taskButtonRef}
                    anchorRef={taskButtonRef}
                    pinned={taskPanelPinned}
                />
            )}
        </div>
    );
};

const mapDispatchToProps = {
    addImageDataAction: addImageData,
    updateImageDataAction: updateImageData,
    updateActiveImageIndexAction: updateActiveImageIndex,
    updateActivePopupTypeAction: updateActivePopupType,
    addVideoDataAction: addVideoData,
    updateVideoModeAction: updateVideoMode,
    addQueueItemsAction: addQueueItems,
    setActiveQueueItemAction: setActiveQueueItem,
    updateQueueItemAction: updateQueueItem
};

const mapStateToProps = (state: AppState) => ({
    windowSize: state.general.windowSize,
    activeImageIndex: state.labels.activeImageIndex,
    imagesData: state.labels.imagesData,
    activeContext: state.general.activeContext,
    projectType: state.general.projectData.type,
    language: state.general.language,
    isVideoMode: state.video?.isVideoMode || false,
    activeVideo: state.video?.activeVideo || null,
    queueItems: state.queue?.items || [],
    activeQueueItemId: state.queue?.activeQueueItemId || null
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditorContainer);
