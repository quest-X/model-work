import React, { useState, useEffect, useCallback } from 'react';
import './ImportLabelPopup.scss';
import { LabelType } from '../../../data/enums/LabelType';
import { EditorModel } from '../../../staticModels/EditorModel';
import { PopupActions } from '../../../logic/actions/PopupActions';
import { AppState } from '../../../store';
import { connect } from 'react-redux';
import { useDropzone } from 'react-dropzone';
import { ImageData, LabelName } from '../../../store/labels/types';
import { updateActiveLabelType, updateImageData, updateLabelNames } from '../../../store/labels/actionCreators';
import { QueueDataSyncStatus, QueueItem, QueueItemType, QueueItemStatus } from '../../../store/queue/types';
import { addQueueItems, updateQueueItem } from '../../../store/queue/actionCreators';
import { ImporterSpecData } from '../../../data/ImporterSpecData';
import { ImageDataUtil } from '../../../utils/ImageDataUtil';
import { YOLOUtils } from '../../../logic/import/yolo/YOLOUtils';
import { FileUtil } from '../../../utils/FileUtil';
import { LabelsSelector } from '../../../store/selectors/LabelsSelector';
import { AnnotationFormatType } from '../../../data/enums/AnnotationFormatType';
import { submitNewNotification } from '../../../store/notifications/actionCreators';
import { NotificationUtil } from '../../../utils/NotificationUtil';
import { NotificationsDataMap } from '../../../data/info/NotificationsData';
import { DocumentParsingError } from '../../../logic/import/voc/VOCImporter';
import { Notification } from '../../../data/enums/Notification';
import { LabelNamesNotUniqueError } from '../../../logic/import/yolo/YOLOErrors';
import { Language, LanguageConfig } from '../../../data/LanguageConfig';
import { GenericYesNoPopup } from '../GenericYesNoPopup/GenericYesNoPopup';
import JSZip from 'jszip';
import { v4 as uuidv4 } from 'uuid';
import { ArrayUtil } from '../../../utils/ArrayUtil';
import { Settings } from '../../../settings/Settings';
import { LabelUtil } from '../../../utils/LabelUtil';
import { PendingImportFiles } from '../../../utils/PendingImportFiles';
import {DataBatchSyncService} from '../../../services/DataBatchSyncService';
import {ImageRepository} from '../../../logic/imageRepository/ImageRepository';
import {QueueActions} from '../../../logic/actions/QueueActions';
import {DatasetEditSelection} from '../../../services/DatasetActionSelection';
import {updateProjectData} from '../../../store/general/actionCreators';
import {ProjectData} from '../../../store/general/types';

interface IProps {
    activeLabelType: LabelType;
    updateImageDataAction: (imageData: ImageData[]) => any;
    updateLabelNamesAction: (labels: LabelName[]) => any;
    updateActiveLabelTypeAction: (activeLabelType: LabelType) => any;
    addQueueItemsAction: (items: QueueItem[]) => any;
    updateQueueItemAction: (itemId: string, updates: Partial<QueueItem>) => any;
    updateProjectDataAction: (projectData: ProjectData) => any;
    queueItems: QueueItem[];
    projectData: ProjectData;
    language: Language;
}

const ImportLabelPopup: React.FC<IProps> = ({
    activeLabelType,
    updateImageDataAction,
    updateLabelNamesAction,
    updateActiveLabelTypeAction,
    addQueueItemsAction,
    updateQueueItemAction,
    queueItems,
    projectData,
    updateProjectDataAction,
    language
}) => {
    const currentTexts = LanguageConfig[language];
    const labelType = activeLabelType === LabelType.ALL ? LabelType.RECT : activeLabelType;

    const [loadedLabelNames, setLoadedLabelNames] = useState<LabelName[]>([]);
    const [loadedImageData, setLoadedImageData] = useState<ImageData[]>([]);
    const [annotationsLoadedError, setAnnotationsLoadedError] = useState<Error | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [sourceInfo, setSourceInfo] = useState<{zipCount: number; looseCount: number}>({zipCount: 0, looseCount: 0});
    const [editTarget] = useState(() => DatasetEditSelection.get());
    const hasImportPayload = loadedImageData.length !== 0 && (loadedLabelNames.length !== 0 || !!editTarget);

    const resolveNotification = (error: Error): Notification => {
        if (error instanceof DocumentParsingError) return Notification.ANNOTATION_FILE_PARSE_ERROR;
        if (error instanceof LabelNamesNotUniqueError) return Notification.NON_UNIQUE_LABEL_NAMES_ERROR;
        return Notification.ANNOTATION_IMPORT_ASSERTION_ERROR;
    };

    const onAnnotationLoadSuccess = (imagesData: ImageData[], labelNames: LabelName[]) => {
        setLoadedLabelNames(labelNames);
        setLoadedImageData(imagesData);
        setAnnotationsLoadedError(null);
        setIsProcessing(false);
    };

    const onAnnotationsLoadFailure = (error?: Error) => {
        setLoadedLabelNames([]);
        setLoadedImageData([]);
        setAnnotationsLoadedError(error);
        setIsProcessing(false);
        const notification = resolveNotification(error);
        submitNewNotification(NotificationUtil.createErrorNotification(NotificationsDataMap[notification]));
    };

    // Detect format and mode from zip filename prefix
    const detectFromZipName = (name: string): { format: AnnotationFormatType | null; isFull: boolean } => {
        const lower = name.toLowerCase();
        // yolo_train_* = full pack with images; yolo_simple_* = labels only
        if (lower.startsWith('yolo_')) return { format: AnnotationFormatType.YOLO, isFull: !lower.startsWith('yolo_simple') };
        const isFull = lower.includes('_full');
        if (lower.startsWith('voc_')) return { format: AnnotationFormatType.VOC, isFull };
        if (lower.startsWith('coco_')) return { format: AnnotationFormatType.COCO, isFull };
        if (lower.startsWith('vgg_')) return { format: AnnotationFormatType.VGG, isFull };
        if (lower.startsWith('csv_')) return { format: AnnotationFormatType.CSV, isFull };
        if (lower.startsWith('labelme_')) return { format: AnnotationFormatType.LABELME, isFull };
        return { format: null, isFull: false };
    };

    // Detect format from file extensions (synchronous; JSON defaults to COCO for zip-internal use)
    const detectFormatFromFiles = (files: File[]): AnnotationFormatType | null => {
        const names = files.map(f => f.name.toLowerCase());
        if (names.some(n => n === 'labels.txt')) return AnnotationFormatType.YOLO;
        const exts = names.map(n => n.split('.').pop());
        if (exts.some(e => e === 'xml')) return AnnotationFormatType.VOC;
        if (exts.some(e => e === 'json')) return AnnotationFormatType.COCO;
        if (exts.some(e => e === 'txt')) return AnnotationFormatType.YOLO;
        return null;
    };

    // Async JSON format detection: peek inside to distinguish LabelMe vs COCO
    const detectJsonFormat = (jsonFiles: File[]): Promise<AnnotationFormatType> => {
        if (jsonFiles.length > 1) return Promise.resolve(AnnotationFormatType.LABELME);
        return FileUtil.readFile(jsonFiles[0]).then(text => {
            try {
                const obj = JSON.parse(text);
                if (obj.shapes !== undefined && obj.imagePath !== undefined) {
                    return AnnotationFormatType.LABELME;
                }
            } catch {
                // Fall back to COCO when the JSON payload cannot be inspected.
            }
            return AnnotationFormatType.COCO;
        });
    };

    const loadImageDimensions = (file: File): Promise<{ file: File; width: number; height: number }> => {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve({ file, width: img.width, height: img.height });
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error(`Failed to load image: ${file.name}`));
            };
            img.src = url;
        });
    };

    type ImportResult = { imageData: ImageData[]; labelNames: LabelName[] };

    // Ultralytics 导出的类别名文件名不固定：labels.txt（本工具原生格式）、
    // classes.txt（同样一行一个类名）、data.yaml/dataset.yaml（names 字段）。
    const findLabelsSource = (annotationFiles: File[]): { file: File; isYaml: boolean } | null => {
        const byName = (name: string) => annotationFiles.find(f => f.name.toLowerCase() === name);
        const labelsTxt = byName('labels.txt');
        if (labelsTxt) return { file: labelsTxt, isYaml: false };
        const classesTxt = byName('classes.txt');
        if (classesTxt) return { file: classesTxt, isYaml: false };
        const yamlFile = byName('data.yaml') || byName('dataset.yaml');
        if (yamlFile) return { file: yamlFile, isYaml: true };
        return null;
    };

    const importYOLOAsync = (imageFiles: File[], annotationFiles: File[]): Promise<ImportResult> => {
        const labelsSource = findLabelsSource(annotationFiles);
        if (!labelsSource) return Promise.reject(new Error('labels.txt/classes.txt/data.yaml not found in zip'));

        const labelsPromise = FileUtil.readFile(labelsSource.file).then(content =>
            labelsSource.isYaml
                ? YOLOUtils.parseLabelsNamesFromYamlString(content)
                : YOLOUtils.parseLabelsNamesFromString(content)
        );
        const imagesPromise = Promise.all(imageFiles.map(f => loadImageDimensions(f)));
        const labelsSourceName = labelsSource.file.name.toLowerCase();
        const txtFiles = annotationFiles.filter(f => f.name.toLowerCase() !== labelsSourceName && f.name.endsWith('.txt'));
        const txtContentsPromise = Promise.all(txtFiles.map(f => FileUtil.readFile(f)));

        return Promise.all([labelsPromise, imagesPromise, txtContentsPromise])
            .then(([labelNames, loadedImages, txtContents]) => {
                const annotationMap: Record<string, string> = {};
                txtFiles.forEach((f, i) => {
                    const baseName = f.name.replace(/\.[^/.]+$/, '');
                    annotationMap[baseName] = txtContents[i];
                });

                const resultImageData: ImageData[] = loadedImages.map(({ file, width, height }) => {
                    const imageData = ImageDataUtil.createImageDataFromFileData(file);
                    const baseName = file.name.replace(/\.[^/.]+$/, '');
                    const content = annotationMap[baseName];
                    if (content) {
                        content.split(/[\r\n]/).filter(Boolean).forEach(line => {
                            const parts = line.trim().split(' ');
                            const classIdx = parseInt(parts[0]);
                            const labelId = labelNames[classIdx]?.id;
                            if (!labelId) return;
                            if (parts.length === 5) {
                                imageData.labelRects.push(LabelUtil.createLabelRect(labelId, {
                                    x: (parseFloat(parts[1]) - parseFloat(parts[3]) / 2) * width,
                                    y: (parseFloat(parts[2]) - parseFloat(parts[4]) / 2) * height,
                                    width: parseFloat(parts[3]) * width,
                                    height: parseFloat(parts[4]) * height,
                                }));
                            } else if (parts.length > 5 && (parts.length - 1) % 2 === 0) {
                                const vertices = [];
                                for (let i = 1; i < parts.length; i += 2) {
                                    vertices.push({ x: parseFloat(parts[i]) * width, y: parseFloat(parts[i + 1]) * height });
                                }
                                imageData.labelPolygons.push(LabelUtil.createLabelPolygon(labelId, vertices));
                            }
                        });
                    }
                    return imageData;
                });
                return { imageData: resultImageData, labelNames };
            });
    };

    const importLabelMeAsync = (imageFiles: File[], annotationFiles: File[]): Promise<ImportResult> => {
        const jsonFiles = annotationFiles.filter(f => f.name.toLowerCase().endsWith('.json'));
        return Promise.all(jsonFiles.map(f =>
            FileUtil.readFile(f).then(text => JSON.parse(text))
        )).then(annotations => {
            const allLabels = new Set<string>();
            annotations.forEach((ann: any) => (ann.shapes || []).forEach((s: any) => allLabels.add(s.label)));

            let colorIdx = 0;
            const labelNameMap: Record<string, LabelName> = {};
            allLabels.forEach(name => {
                labelNameMap[name] = {
                    id: uuidv4(),
                    name,
                    color: ArrayUtil.getByInfiniteIndex(Settings.LABEL_COLORS_PALETTE, colorIdx++)
                };
            });

            const imageDataByName: Record<string, ImageData> = {};
            const resultImageData: ImageData[] = imageFiles.map(file => {
                const imgData = ImageDataUtil.createImageDataFromFileData(file);
                imageDataByName[file.name] = imgData;
                return imgData;
            });

            const pushRect = (imgData: ImageData, labelId: string, points: [number, number][]) => {
                const [[x1, y1], [x2, y2]] = points;
                imgData.labelRects.push(LabelUtil.createLabelRect(labelId, {
                    x: Math.min(x1, x2), y: Math.min(y1, y2),
                    width: Math.abs(x2 - x1), height: Math.abs(y2 - y1)
                }));
            };

            for (const ann of annotations) {
                const baseName = ann.imagePath?.split('/').pop() || ann.imagePath;
                const imgData = imageDataByName[baseName];
                if (!imgData) continue;
                for (const shape of (ann.shapes || [])) {
                    const labelId = labelNameMap[shape.label]?.id;
                    if (!labelId) continue;
                    if (shape.shape_type === 'rectangle') {
                        pushRect(imgData, labelId, shape.points);
                    } else if (shape.shape_type === 'polygon') {
                        imgData.labelPolygons.push(LabelUtil.createLabelPolygon(
                            labelId, shape.points.map(([x, y]: [number, number]) => ({ x, y }))
                        ));
                    } else if (shape.shape_type === 'mask' && shape.points.length >= 2) {
                        pushRect(imgData, labelId, shape.points);
                    }
                }
            }
            return { imageData: resultImageData, labelNames: Object.values(labelNameMap) };
        });
    };

    const importGenericAsync = (files: File[], format: AnnotationFormatType): Promise<ImportResult> => {
        if (!ImporterSpecData[format]) return Promise.reject(new Error('Unsupported file format'));
        return new Promise((resolve, reject) => {
            const importer = new (ImporterSpecData[format])([labelType]);
            importer.import(files,
                (imageData: ImageData[], labelNames: LabelName[]) => resolve({ imageData, labelNames }),
                (error?: Error) => reject(error || new Error('Import failed'))
            );
        });
    };

    const doImport = (files: File[], format: AnnotationFormatType) => {
        importGenericAsync(files, format)
            .then(r => onAnnotationLoadSuccess(r.imageData, r.labelNames))
            .catch(err => onAnnotationsLoadFailure(err instanceof Error ? err : new Error(String(err))));
    };

    const handleFiles = useCallback((accepted: File[]) => {
        if (accepted.length === 0) return;
        setIsProcessing(true);
        setAnnotationsLoadedError(null);
        const zips = accepted.filter(f => f.name.toLowerCase().endsWith('.zip'));
        const loose = accepted.filter(f => !f.name.toLowerCase().endsWith('.zip'));
        setSourceInfo({zipCount: zips.length, looseCount: loose.length});

            if (zips.length > 0) {
                const annotationExts = ['.json', '.txt', '.xml', '.yaml', '.yml'];
                const imageExts = ['.jpg', '.jpeg', '.png', '.bmp', '.webp'];
                const mimeMap: Record<string, string> = {
                    '.json': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml',
                    '.yaml': 'text/yaml', '.yml': 'text/yaml',
                };
                const imageMimeMap: Record<string, string> = {
                    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                    '.png': 'image/png', '.bmp': 'image/bmp', '.webp': 'image/webp',
                };

                const processOneZip = (zipFile: File): Promise<ImportResult> => {
                    const { format: zipFormat, isFull } = detectFromZipName(zipFile.name);
                    return JSZip.loadAsync(zipFile).then(zip => {
                        const annPromises: Promise<File>[] = [];
                        const imgPromises: Promise<File>[] = [];
                        zip.forEach((path, entry) => {
                            if (entry.dir) return;
                            const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
                            const fileName = path.split('/').pop();
                            if (annotationExts.includes(ext)) {
                                annPromises.push(entry.async('arraybuffer').then(buf =>
                                    new File([buf], fileName!, { type: mimeMap[ext] || 'text/plain' })));
                            } else if (isFull && imageExts.includes(ext)) {
                                imgPromises.push(entry.async('arraybuffer').then(buf =>
                                    new File([buf], fileName!, { type: imageMimeMap[ext] || 'image/jpeg' })));
                            }
                        });
                        return Promise.all([Promise.all(annPromises), Promise.all(imgPromises)]);
                    }).then(([annFiles, imgFiles]) => {
                        if (isFull && imgFiles.length > 0 && zipFormat === AnnotationFormatType.YOLO) {
                            return importYOLOAsync(imgFiles, annFiles);
                        } else if (isFull && imgFiles.length > 0 && zipFormat === AnnotationFormatType.LABELME) {
                            return importLabelMeAsync(imgFiles, annFiles);
                        } else if (isFull && imgFiles.length > 0) {
                            const newImageData = imgFiles.map(f => ImageDataUtil.createImageDataFromFileData(f));
                            const format = zipFormat || detectFormatFromFiles(annFiles);
                            if (!format) return Promise.reject(new Error('Cannot detect annotation format'));
                            return importGenericAsync(annFiles, format).then(r => ({
                                imageData: [...newImageData, ...r.imageData],
                                labelNames: r.labelNames,
                            }));
                        } else {
                            const format = zipFormat || detectFormatFromFiles(annFiles);
                            if (!format) return Promise.reject(new Error('Cannot detect annotation format'));
                            return importGenericAsync(annFiles, format);
                        }
                    });
                };

                Promise.all(zips.map(processOneZip))
                    .then(results => {
                        const labelNameMap = new Map<string, LabelName>();
                        const idRemap = new Map<string, string>();
                        results.forEach(r => r.labelNames.forEach(ln => {
                            if (!labelNameMap.has(ln.name)) labelNameMap.set(ln.name, ln);
                            idRemap.set(ln.id, labelNameMap.get(ln.name)!.id);
                        }));

                        const allImageData: ImageData[] = [];
                        const remap = (id: string | null) => (id && idRemap.has(id)) ? idRemap.get(id)! : id;

                        results.forEach((r, zipIdx) => {
                            const prefix = zips.length > 1
                                ? zips[zipIdx].name.replace(/\.[^/.]+$/, '') + '_'
                                : '';
                            for (const img of r.imageData) {
                                for (const rect of img.labelRects) rect.labelId = remap(rect.labelId);
                                for (const poly of img.labelPolygons) poly.labelId = remap(poly.labelId);
                                for (const pt of img.labelPoints) pt.labelId = remap(pt.labelId);
                                for (const ln of img.labelLines) ln.labelId = remap(ln.labelId);
                                if (prefix) {
                                    img.fileData = new File([img.fileData], prefix + img.fileData.name, { type: img.fileData.type });
                                }
                                allImageData.push(img);
                            }
                        });

                        allImageData.sort((a, b) => a.fileData.name.localeCompare(b.fileData.name, undefined, { numeric: true }));
                        onAnnotationLoadSuccess(allImageData, Array.from(labelNameMap.values()));
                    })
                    .catch(err => {
                        onAnnotationsLoadFailure(err instanceof Error ? err : new Error(String(err)));
                    });
            } else {
                const jsonFiles = accepted.filter(f => f.name.toLowerCase().endsWith('.json'));
                if (jsonFiles.length > 0) {
                    detectJsonFormat(jsonFiles).then(format => {
                        doImport(accepted, format);
                    }).catch(() => onAnnotationsLoadFailure(new Error('Cannot read annotation file')));
                } else {
                    const format = detectFormatFromFiles(accepted);
                    if (!format) {
                        onAnnotationsLoadFailure(new Error('Cannot detect annotation format'));
                        return;
                    }
                    doImport(accepted, format);
                }
            }
    }, [labelType]);

    useEffect(() => {
        const files = PendingImportFiles.take();
        if (files && files.length > 0) handleFiles(files);
    }, []);

    const { getRootProps, getInputProps } = useDropzone({
        accept: {
            'application/json': ['.json'],
            'text/plain': ['.txt'],
            'application/xml': ['.xml'],
            'text/xml': ['.xml'],
            'application/zip': ['.zip'],
            'application/x-zip-compressed': ['.zip'],
            'application/octet-stream': ['.zip'],
        },
        multiple: true,
        onDrop: handleFiles,
    });

    // 与 EditorContainer/LoadMoreMediaPopup 里的同名函数一致：生成 100px 缩略图，
    // 让导入批次在文件队列面板里也有封面图，而不是退化成类型图标
    const generateThumbnail = (file: File): Promise<string | undefined> => {
        return new Promise((resolve) => {
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
                        if (width > maxSize) { height *= maxSize / width; width = maxSize; }
                    } else {
                        if (height > maxSize) { width *= maxSize / height; height = maxSize; }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    ctx?.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL());
                };
                img.onerror = () => resolve(undefined);
                img.src = e.target?.result as string;
            };
            reader.onerror = () => resolve(undefined);
            reader.readAsDataURL(file);
        });
    };

    // eslint-disable-next-line complexity
    const onAccept = async () => {
        EditorModel.lastBatchInferenceImageCount = 0;
        if (hasImportPayload) {
            // If loaded images have fileData (from full import), add them; otherwise update existing
            const existingIds = new Set(LabelsSelector.getImagesData().map(e => e.id));
            const newImages = loadedImageData.filter(d => d.fileData && d.id && !existingIds.has(d.id));
            const hasNewImages = newImages.length > 0;
            if (hasNewImages) {
                // 完整标注包形成独立批次；标注缓存与文件队列项使用同一个 id。
                const thumbnail = await generateThumbnail(newImages[0].fileData);
                const existingItem = editTarget
                    ? queueItems.find(item => item.datasetId === editTarget.id || (
                        !!editTarget.sourceId && item.id === editTarget.sourceId
                    ))
                    : undefined;
                const itemId = existingItem?.id || editTarget?.sourceId || uuidv4();
                const importItem: QueueItem = newImages.length === 1
                    ? {
                        id: itemId,
                        name: editTarget?.name || newImages[0].fileData.name,
                        type: QueueItemType.IMAGE,
                        file: newImages[0].fileData,
                        status: QueueItemStatus.COMPLETED,
                        uploadedAt: Date.now(),
                        thumbnail,
                        ...(editTarget ? {
                            dataSyncStatus: QueueDataSyncStatus.SYNCING,
                            datasetId: editTarget.id,
                            datasetRevision: editTarget.revision,
                            syncedAt: Date.now(),
                        } : {}),
                    }
                    : {
                        id: itemId,
                        name: editTarget?.name || currentTexts.popups.importAnnotations.title,
                        type: QueueItemType.FOLDER,
                        files: newImages.map(d => d.fileData),
                        status: QueueItemStatus.COMPLETED,
                        uploadedAt: Date.now(),
                        thumbnail,
                        ...(editTarget ? {
                            dataSyncStatus: QueueDataSyncStatus.SYNCING,
                            datasetId: editTarget.id,
                            datasetRevision: editTarget.revision,
                            syncedAt: Date.now(),
                        } : {}),
                    };
                if (editTarget) {
                    const restoredProjectName = (editTarget.projectName || editTarget.name).trim();
                    updateProjectDataAction({
                        ...projectData,
                        name: restoredProjectName || editTarget.name,
                    });
                }
                // Re-opening the same active server dataset intentionally replaces
                // its stale workspace snapshot. Prevent QueueActions from saving the
                // old active data back over the freshly imported cache first.
                if (ImageRepository.getActiveFileId() === importItem.id) {
                    ImageRepository.setActiveFileId(null);
                }
                ImageRepository.saveFileCache(importItem.id, newImages);
                if (existingItem) {
                    updateQueueItemAction(existingItem.id, importItem);
                } else {
                    addQueueItemsAction([importItem]);
                }
                await QueueActions.switchToQueueItem(importItem, LabelsSelector.getImagesData());
                if (editTarget) {
                    await new Promise<void>(resolve => {
                        if (typeof requestAnimationFrame === 'function') {
                            requestAnimationFrame(() => resolve());
                        } else {
                            setTimeout(resolve, 0);
                        }
                    });
                    updateQueueItemAction(importItem.id, {
                        dataSyncStatus: QueueDataSyncStatus.SYNCED,
                    });
                    DatasetEditSelection.set(null);
                } else {
                    DataBatchSyncService.syncQueueItem(importItem, newImages, loadedLabelNames)
                        .catch(() => undefined);
                }
            } else {
                updateImageDataAction(loadedImageData);
            }
            updateLabelNamesAction(loadedLabelNames);
            const hasPolygons = loadedImageData.some(d => d.labelPolygons.length > 0);
            const hasRects = loadedImageData.some(d => d.labelRects.length > 0);
            const resolvedLabelType = hasPolygons ? LabelType.POLYGON : hasRects ? LabelType.RECT : labelType;
            updateActiveLabelTypeAction(resolvedLabelType);

            // 导入后若有 AI 标注（isCreatedByAI），触发统计面板自动展开
            const annotatedCount = loadedImageData.filter(img =>
                img.labelRects.some(r => r.isCreatedByAI) ||
                img.labelPolygons.some(p => p.isCreatedByAI)
            ).length;
            if (annotatedCount > 0) {
                EditorModel.lastBatchInferenceImageCount = annotatedCount;
            }

            PopupActions.close();
        }
    };

    const onReject = () => {
        EditorModel.lastBatchInferenceImageCount = 0;
        DatasetEditSelection.set(null);
        PopupActions.close();
    };

    // eslint-disable-next-line complexity
    const getDropZoneContent = () => {
        if (isProcessing) {
            return <>
                <img draggable={false} alt={'processing'} src={'ico/box-opened.png'} />
                <p className='extraBold'>{language === Language.CHINESE ? '正在解析...' : 'Processing...'}</p>
            </>;
        } else if (annotationsLoadedError) {
            return <>
                <input {...getInputProps()} />
                <img draggable={false} alt={'error'} src={'ico/box-opened.png'} />
                <p className='extraBold'>{currentTexts.popups.importAnnotations.importError}</p>
                <p className='errorMessage'>{annotationsLoadedError.message}</p>
                <p className='extraBold'>{currentTexts.popups.importAnnotations.tryAgain}</p>
            </>;
        } else if (hasImportPayload) {
            const totalRects = loadedImageData.reduce((s, d) => s + d.labelRects.length, 0);
            const totalPolygons = loadedImageData.reduce((s, d) => s + d.labelPolygons.length, 0);
            const newImages = loadedImageData.filter(d => d.fileData).length;
            const zh = language === Language.CHINESE;
            const sourceRows: [string, string][] = [];
            if (sourceInfo.zipCount > 0)
                sourceRows.push([zh ? '压缩包' : 'Archives', `${sourceInfo.zipCount}`]);
            if (sourceInfo.looseCount > 0)
                sourceRows.push([zh ? '散列文件' : 'Files', `${sourceInfo.looseCount}`]);

            const contentRows: [string, string][] = [];
            if (newImages > 0)
                contentRows.push([zh ? '图像' : 'Images', `${newImages} ${zh ? '张' : ''}`]);
            contentRows.push([zh ? '标注图像' : 'Annotated', `${loadedImageData.length} ${zh ? '张' : ''}`]);
            contentRows.push([zh ? '标签类别' : 'Classes', `${loadedLabelNames.length} ${zh ? '个' : ''}`]);
            if (totalRects > 0)
                contentRows.push([zh ? '检测框' : 'Boxes', `${totalRects} ${zh ? '个' : ''}`]);
            if (totalPolygons > 0)
                contentRows.push([zh ? '多边形' : 'Polygons', `${totalPolygons} ${zh ? '个' : ''}`]);

            return <div className='import-summary'>
                {sourceRows.length > 0 && (
                    <div className='summary-section'>
                        {sourceRows.map(([label, value]) => (
                            <div className='summary-row' key={label}>
                                <span className='summary-label'>{label}</span>
                                <span className='summary-value'>{value}</span>
                            </div>
                        ))}
                    </div>
                )}
                <div className='summary-section'>
                    {contentRows.map(([label, value]) => (
                        <div className='summary-row' key={label}>
                            <span className='summary-label'>{label}</span>
                            <span className='summary-value'>{value}</span>
                        </div>
                    ))}
                </div>
                <div className='summary-footer'>{currentTexts.popups.importAnnotations.importWarning}</div>
            </div>;
        } else {
            return <>
                <input {...getInputProps()} />
                <img draggable={false} alt={'upload'} src={'ico/box-opened.png'} />
                <p className='extraBold'>{currentTexts.popups.importAnnotations.dropZoneMessage}</p>
                <p>{currentTexts.or}</p>
                <p className='extraBold'>{currentTexts.popups.importAnnotations.dropZoneActive}</p>
            </>;
        }
    };

    const renderContent = () => {
        return (<div className='ImportLabelPopupContent'>
            <div {...getRootProps({ className: 'DropZone' })}>
                {getDropZoneContent()}
            </div>
        </div>);
    };

    return (
        <GenericYesNoPopup
            title={editTarget
                ? `${language === Language.CHINESE ? '编辑数据集' : 'Edit Dataset'} · ${editTarget.name}`
                : hasImportPayload
                    ? currentTexts.popups.importAnnotations.importReady
                    : currentTexts.popups.importAnnotations.title}
            renderContent={renderContent}
            acceptLabel={editTarget
                ? (language === Language.CHINESE ? '打开数据集' : 'Open Dataset')
                : currentTexts.popups.importAnnotations.acceptButton}
            disableAcceptButton={!hasImportPayload || !!annotationsLoadedError || isProcessing}
            onAccept={onAccept}
            rejectLabel={currentTexts.popups.importAnnotations.rejectButton}
            onReject={onReject}
        />
    );
};

const mapDispatchToProps = {
    updateImageDataAction: updateImageData,
    updateLabelNamesAction: updateLabelNames,
    updateActiveLabelTypeAction: updateActiveLabelType,
    addQueueItemsAction: addQueueItems,
    updateQueueItemAction: updateQueueItem,
    updateProjectDataAction: updateProjectData,
};

const mapStateToProps = (state: AppState) => ({
    activeLabelType: state.labels.activeLabelType,
    language: state.general.language,
    projectData: state.general.projectData,
    queueItems: state.queue.items,
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ImportLabelPopup);
