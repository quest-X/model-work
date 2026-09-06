export enum Language {
    CHINESE = 'zh',
    ENGLISH = 'en'
}

export interface LanguageTexts {
    // TopNavigationBar
    projectName: string;
    uploadImages: string;
    languageToggle: string;
    account: {
        openMenu: string;
        menuLabel: string;
        displayName: string;
        role: string;
        uploadAvatar: string;
        avatarUploadError: string;
        personalCenter: string;
        switchToControlPlatform: string;
        switchToAnnotationPlatform: string;
        signOut: string;
    };
    
    // EmptyProjectView
    welcomeTitle: string;
    welcomeDescription: string;
    dragActiveMessage: string;
    uploadHints: {
        dragSupport: string;
        formatSupport: string;
        batchSupport: string;
    };
    
    // SideNavigationBar
    images: string;
    labels: string;
    selectAll: string;
    inferenceResults: string;
    queue: string;
    videoMeta: string;   // e.g. "{frames} 帧 @ {fps}fps"
    folderMeta: string;  // e.g. "{count}张图像"
    changelog: {
        title: string;
        close: string;
    };

    // EmptyLabelList
    drawFirstBoundingBox: string;
    markFirstPoint: string;
    drawFirstLine: string;
    drawFirstPolygon: string;
    drawFirstLabel: string;
    noLabelsCreated: string;
    
    // EditorBottomNavigationBar
    imageNavigation: {
        previous: string;
        next: string;
        imageCount: string; // "第 {current} 张，共 {total} 张"
    };
    
    // LabelInputField
    selectLabel: string;
    deleteLabel: string;
    toggleVisibility: string;
    
    // Actions DropDown Menu
    actions: {
        title: string;
        editLabels: {
            name: string;
            description: string;
        };
        uploadFiles: {
            name: string;
            description: string;
        };
        importAnnotations: {
            name: string;
            description: string;
        };
        exportAnnotations: {
            name: string;
            description: string;
        };
        runAILocally: {
            name: string;
            description: string;
        };
        connectAIServer: {
            name: string;
            description: string;
        };
        integrateAIModel: {
            name: string;
            description: string;
        };
    };
    
    // Label Toolkit
    labelTypes: {
        all: string;
        imageRecognition: string;
        rect: string;
        point: string;
        line: string;
        polygon: string;
        // Tool-button tooltip variants (imperative verbs) — differ from sidebar header labels
        toolAll: string;
        toolRect: string;
        toolPolygon: string;
    };
    
    // Popup Windows
    popups: {
        uploadFiles: {
            title: string;
            addNewFiles: string;
            clickToSelect: string;
            oneFileLoaded: string;
            multipleFilesLoaded: string;
            loadButton: string;
            cancelButton: string;
        };
        insertLabelNames: {
            titleCreate: string;
            titleUpdate: string;
            acceptButton: string;
            rejectButton: string;
            insertLabel: string;
            addLabel: string;
            suggestion: string;
            loadFromFile: string;
            messageUpdate: string;
            messageCreate: string;
            emptyListMessage: string;
        };
        exportAnnotations: {
            title: string;
            acceptButton: string;
            rejectButton: string;
            selectFormat: string;
            labelmePackageButton: string;
            labelmePackageDesc: string;
            yoloPackageButton: string;
            yoloPackageDesc: string;
        };
        importAnnotations: {
            title: string;
            acceptButton: string;
            rejectButton: string;
            selectFileFormat: string;
            dropZoneMessage: string;
            dropZoneActive: string;
            importError: string;
            tryAgain: string;
            importReady: string;
            importWarning: string;
        };
        exitProject: {
            title: string;
            content: string;
            acceptButton: string;
            rejectButton: string;
        };
        callModel: {
            title: string;
            selectModel: string;
            acceptButton: string;
            rejectButton: string;
            models: Record<string, never>;
            welcomeMessage: string;
        };
        suggestLabels: {
            title: string;
            acceptButton: string;
            rejectButton: string;
            selectAll: string;
            acceptAll: string;
            rejectAll: string;
        };
        connectServer: {
            title: string;
            acceptButton: string;
            rejectButton: string;
            roboflowModel: string;
            roboflowKey: string;
            testConnection: string;
            roboflowMessage: string;
            modelServiceUrl: string;
            modelTaskType: string;
            modelApiKey: string;
            taskTypeDetection: string;
            taskTypeSegmentation: string;
            customAIMessage: string;
            localYoloMessage: string;
            localYoloUrl: string;
        };
        modelEngine: {
            title: string;
            acceptButton: string;
            rejectButton: string;
            modelUrl: string;
            modelType: string;
            apiKey: string;
            testConnection: string;
            integrationMessage: string;
            taskTypeCore: string;
            taskTypeExtension: string;
        };
    };
    
    // Format Options
    formats: {
        export: {
            yoloRect: string;
            vocRect: string;
            csvGeneric: string;
            vggPolygon: string;
            cocoPolygon: string;
            jsonImageRecognition: string;
            labelmeRect: string;
            labelmePolygon: string;
        };
        import: {
            cocoRect: string;
            cocoPolygon: string;
            yoloRect: string;
            vocRect: string;
            vggPolygon: string;
            labelmeRect: string;
            labelmePolygon: string;
        };
    };
    
    // Feature In Progress
    featureInProgress: {
        newFeature: string;
        comingSoon: string;
    };
    
    // Editor Top Navigation Bar
    editorTopNavBar: {
        zoomIn: string;
        zoomOut: string;
        fitImage: string;
        maxZoom: string;
        imageDragModeOn: string;
        imageDragModeOff: string;
        smartAnnotationOn: string;
        smartAnnotationOff: string;
        smartAnnotationNeedsSAM: string;
        acceptAllDetections: string;
        rejectAllDetections: string;
        enableSegmentation: string;
        disableSegmentation: string;
        segmentationInProgress: string;
        enableDetection: string;
        disableDetection: string;
        detectionInProgress: string;
        cannotSegment: string;
        cannotDetect: string;
    };
    
    // Keyboard Shortcuts Popup
    keyboardShortcuts: {
        title: string;
        close: string;
        functionality: string;
        context: string;
        editor: string;
        popup: string;
        polygonAutocomplete: string;
        cancelPolygonDrawing: string;
        deleteSelectedLabel: string;
        loadPreviousImage: string;
        loadNextImage: string;
        zoomIn: string;
        zoomOut: string;
        moveImage: string;
        switchImage: string;
        selectAll: string;
        save: string;
        selectLabel: string;
        exitPopup: string;
    };
    
    // Queue
    queueStatus: {
        pending: string;
        processing: string;
        completed: string;
        error: string;
    };
    queueDataSync: {
        local: string;
        syncing: string;
        synced: string;
        dirty: string;
        error: string;
        action: string;
    };
    queueEmpty: string;
    queueEmptyHint: string;

    // Video
    video: {
        frame: string;
        pause: string;
        play: string;
        replay: string;
        mute: string;
        unmute: string;
        playerAriaLabel: string;
        shortcutMove1: string;
        shortcutMove10: string;
        shortcutPlayPause: string;
        rangeInference: string;   // "对选区推理"
        rangeFrames: string;      // "{count} 帧"
        rangeClear: string;       // "取消选区"
        rangeHint: string;        // "Shift+拖拽 选择范围"
    };

    // Notifications
    notifications: {
        emptyLabelName: { header: string; description: string };
        nonUniqueLabelNames: { header: string; description: string };
        modelDownloadError: { header: string; description: string };
        modelInferenceError: { header: string; description: string };
        modelLoadError: { header: string; description: string };
        labelsFileUploadError: { header: string; description: string };
        annotationFileParseError: { header: string; description: string };
        annotationImportAssertionError: { header: string; description: string };
        unsupportedInferenceServer: { header: string; description: string };
        roboflowInferenceServerError: { header: string; description: string };
        detectionCompleted: string;
        detectionCompletedMessage: string;
        detectionFailed: string;
        detectionFailedMessage: string;
        detectionInProgress: string;
        batchDetectionProgress: string;
        batchDetectionCompleted: string;
        batchDetectionCompletedMessage: string;
    };

    // AI Model Management
    modelManagement: {
        coreServices: string;
        extensionServices: string;
        callModels: string;   // 原 localModels —— 调用模型
        providedServices: string;   // 引擎管理弹窗内「服务清单」区块标题
        modelEngines: string;
        dataCenter: string;
        trainingTask: string;
        taskCenter: string;
        vectorDb: string;
        l2gRetrieval: string;
        modelInspector: string;
        cameraConnect: string;
        computeCluster: string;
        manage: string;
        noModels: string;
        noModelsHint: string;
        modelName: string;
        modelUrl: string;
        apiKeyOptional: string;
        descriptionOptional: string;
        selectModelHint: string;
        unnamedModel: string;
        none: string;
        noDescription: string;
        manageMessage: string;
        modelDetails: string;
        title: string;
        close: string;
        apiEndpoint: string;
        apiKey: string;
        description: string;
    };

    // Load YOLO Model Popup
    loadYoloModel: {
        title: string; // "Load {model} Model"
        titleFallback: string;
        acceptLabel: string;
        rejectLabel: string;
        active: string;
        downloaded: string;
        uploadMessage: string;
        officialMessage: string; // "Select {name} variants..."
        downloading: string;
        loading: string;
        ready: string;
        errorState: string;
        preparing: string;
        loadFailed: string;
        connectionFailed: string;
        dragModel: string;
        clickToSelect: string;
    };

    // MainView
    mainView: {
        goBack: string;
        getStarted: string;
    };

    // DropZone
    dropZone: {
        dropImages: string;
        or: string;
        clickToSelect: string;
        oneImageLoaded: string;
        multipleImagesLoaded: string;
        objectDetection: string;
        imageRecognition: string;
    };

    // LoadLabelNamesPopup
    loadLabelsPopup: {
        loadingFailed: string;
        tryAgain: string;
        dropLabelsFile: string;
        or: string;
        clickToSelect: string;
        oneLabelFound: string;
        multipleLabelsFound: string;
        message: string;
        title: string;
        startProject: string;
        back: string;
    };

    // TagLabelsList
    emptyLabelList: string;

    // SizeItUpView
    sizeItUp: {
        windowTooSmall: string;
        minimumSize: string;
    };

    // Common
    makeSense: string;
    ok: string;
    cancel: string;
    delete: string;
    edit: string;
    save: string;
    load: string;
    export: string;
    import: string;
    or: string;
    
    // AI Inference Notifications
    aiInference: {
        inProgress: string;
        completed: string;
        failed: string;
        steps: {
            preprocessing: string;
            inference: string;
            postprocessing: string;
            captureFrame: string;  // "捕获帧"
            inferring: string;     // "推理中"
        };
        stepProgress: string; // "步骤 {current}/{total}"
        totalTime: string; // "总耗时："
        detectedObjects: string; // "检测物体："
        completedStep: string; // "推理完成"
        successMessage: string; // "成功检测 {count} 个任务，总耗时 {time}s"
        failedMessage: string;
        results: {
            title: string; // "推理结果"
            noResults: string; // "暂无推理结果"
            noResultsHint: string; // "绘制标注框后将自动触发AI推理"
            confidence: string; // "置信度"
            coordinates: string; // "坐标"
            size: string; // "大小"
            area: string; // "面积"
            thumbnail: string; // "缩略图"
            objectId: string; // "对象ID"
        };
    };

    // Task Manager
    taskManager: {
        title: string;
        tooltip: string; // "任务管理器 ({count})"
        emptyState: string;
        priorityP0: string;
        priorityP1: string;
        priorityP2: string;
        statusRunning: string;
        statusCompleted: string;
        statusError: string;
        statusCancelled: string;
        cancel: string;
        types: {
            autoSave: string;
            frameExtraction: string;
            batchDetect: string;
            batchSegment: string;
            tracking: string;
            training: string;
            export: string;
            queueLoad: string;
            dataSync: string;
        };
        subtitleFrames: string; // "{done}/{total} 帧"
        showCompleted: string; // "显示已完成"
    };
}

export const LanguageConfig: Record<Language, LanguageTexts> = {
    [Language.CHINESE]: {
        // TopNavigationBar
        projectName: '项目名称:',
        uploadImages: '上传图像',
        languageToggle: '中文',
        account: {
            openMenu: '打开账户菜单',
            menuLabel: '账户菜单',
            displayName: '本地管理员',
            role: '管理员账户',
            uploadAvatar: '上传头像',
            avatarUploadError: '请选择不超过 2 MB 的 JPG、PNG 或 WebP 图片',
            personalCenter: '个人中心',
            switchToControlPlatform: '切换到管理平台',
            switchToAnnotationPlatform: '切换到生产平台',
            signOut: '退出登录',
        },
        
        // EmptyProjectView
        welcomeTitle: '欢迎使用 Opensight Platform',
        welcomeDescription: '点击上传或拖拽到此处释放',
        dragActiveMessage: '释放文件以上传图像',
        uploadHints: {
            dragSupport: '• 支持拖拽上传图像文件',
            formatSupport: '• 支持 JPEG、PNG 格式',
            batchSupport: '• 可以批量上传多张图像'
        },
        
        // SideNavigationBar
        images: '图像',
        labels: '标签',
        selectAll: '选中全部',
        inferenceResults: '推理结果',
        queue: '文件队列',
        videoMeta: '{frames} 帧 @ {fps}fps',
        folderMeta: '{count}张图像',
        changelog: {
            title: '更新日志',
            close: '关闭',
        },

        // EmptyLabelList
        drawFirstBoundingBox: '绘制第一个矩形框',
        markFirstPoint: '标记第一个点',
        drawFirstLine: '绘制第一条线',
        drawFirstPolygon: '绘制第一个多边形',
        drawFirstLabel: '查看全部标签',
        noLabelsCreated: '尚未为此图像创建标签',
        
        // EditorBottomNavigationBar
        imageNavigation: {
            previous: '上一张',
            next: '下一张',
            imageCount: '第 {current} 张，共 {total} 张'
        },
        
        // LabelInputField
        selectLabel: '选择标签',
        deleteLabel: '删除标签',
        toggleVisibility: '切换可见性',
        
        // Actions DropDown Menu
        actions: {
            title: '操作',
            editLabels: {
                name: '编辑标签',
                description: '修改标签列表'
            },
            uploadFiles: {
                name: '上传文件',
                description: '上传图像或视频'
            },
            importAnnotations: {
                name: '导入标注',
                description: '从文件导入标注'
            },
            exportAnnotations: {
                name: '导出标注',
                description: '导出标注到文件'
            },
            runAILocally: {
                name: '本地运行AI',
                description: '在浏览器中运行标注模型'
            },
            connectAIServer: {
                name: '连接AI服务器',
                description: '在服务器上运行标注模型'
            },
            integrateAIModel: {
                name: '引擎管理',
                description: '接入本地或远程推理引擎'
            }
        },
        
        // Label Toolkit
        labelTypes: {
            all: '查看全部',
            imageRecognition: '图像识别',
            rect: '检测标签',
            point: '点',
            line: '线条',
            polygon: '分割标签',
            // 顶栏工具按钮 tooltip：祈使句式
            toolAll: '查看所有标签',
            toolRect: '绘制矩形框',
            toolPolygon: '绘制多边形',
        },
        
        // Popup Windows
        popups: {
            uploadFiles: {
                title: '上传文件',
                addNewFiles: '点击上传',
                clickToSelect: '拖拽到此处释放',
                oneFileLoaded: '已加载 1 个文件',
                multipleFilesLoaded: '已加载 {count} 个文件',
                loadButton: '确认',
                cancelButton: '取消'
            },
        insertLabelNames: {
            titleCreate: '创建标签列表',
            titleUpdate: '编辑标签',
            acceptButton: '确认',
            rejectButton: '取消',
            insertLabel: '输入标签',
            addLabel: '添加标签',
            suggestion: '建议',
            loadFromFile: '从文件加载',
            messageUpdate: '您现在可以编辑用于描述照片中对象的标签名称。使用 + 按钮添加新的空文本字段。',
            messageCreate: '在开始之前，您可以创建计划分配给项目中对象的标签列表。您也可以选择暂时跳过这一部分，在进行过程中定义标签名称。',
            emptyListMessage: '点击此处添加第一个标签'
        },
            exportAnnotations: {
                title: '导出标注',
                acceptButton: '确认',
                rejectButton: '取消',
                selectFormat: '选择您要用于导出标注的文件格式。',
                labelmePackageButton: 'LabelMe 标注包',
                labelmePackageDesc: 'LabelMe格式 · 含原图 · 支持二次标注',
                yoloPackageButton: 'YOLO 训练集',
                yoloPackageDesc: 'YOLO格式 · 含原图 · 检测/分割训练集'
            },
            importAnnotations: {
                title: '导入标注',
                acceptButton: '确认',
                rejectButton: '取消',
                selectFileFormat: '选择您要用于导入标签的文件格式。',
                dropZoneMessage: '点击上传',
                dropZoneActive: '拖拽到此处释放',
                importError: '标注导入失败',
                tryAgain: '请重试',
                importReady: '标注已准备好导入',
                importWarning: '导入后您将丢失所有当前标注'
            },
            exitProject: {
                title: '退出项目',
                content: '您确定要退出当前项目吗？所有未保存的更改将丢失。',
                acceptButton: '确认',
                rejectButton: '取消'
            },
            callModel: {
                title: '推理系统',
                selectModel: '选择要加载的模型：',
                acceptButton: '进入',
                rejectButton: '关闭',
                models: {},
                welcomeMessage: '使用AI加速标注过程。别担心，照片仍然安全。为了保护隐私，我们决定不将图像发送到服务器，而是将AI带给您。请确保您有快速稳定的连接 - 加载模型可能需要一些时间。'
            },
            suggestLabels: {
                title: '建议标签',
                acceptButton: '确认',
                rejectButton: '取消',
                selectAll: '全选',
                acceptAll: '接受全部',
                rejectAll: '拒绝全部'
            },
            connectServer: {
                title: '连接AI服务器',
                acceptButton: '确认',
                rejectButton: '取消',
                roboflowModel: 'Roboflow 模型ID',
                roboflowKey: 'Roboflow API密钥',
                testConnection: '测试连接',
                roboflowMessage: '提供您要通过API运行的Roboflow模型的详细信息以及API密钥。',
                modelServiceUrl: '模型服务地址',
                modelTaskType: '模型任务类型',
                modelApiKey: '模型接口密钥',
                taskTypeDetection: '检测模型',
                taskTypeSegmentation: '分割模型',
                customAIMessage: '配置您的AI模型服务连接信息',
                localYoloMessage: '连接本地 YOLO 推理服务（python detect_server.py）',
                localYoloUrl: '服务地址'
            },
            modelEngine: {
                title: '推理引擎',
                acceptButton: '保存',
                rejectButton: '取消',
                modelUrl: '引擎地址',
                modelType: '引擎类型',
                apiKey: '引擎密钥',
                testConnection: '测试连接',
                integrationMessage: '接入核心引擎或拓展引擎。检测、分割和 OCR 均由核心引擎统一提供。',
                taskTypeCore: '核心引擎',
                taskTypeExtension: '拓展引擎'
            }
        },
        
        // Format Options
        formats: {
            export: {
                yoloRect: 'YOLO (.zip) — 每张图一个 .txt，归一化坐标',
                vocRect: 'VOC XML (.zip) — 每张图一个 .xml，像素坐标',
                csvGeneric: 'CSV — 所有标注合并为一个表格',
                vggPolygon: 'VGG JSON — 多边形顶点坐标',
                cocoPolygon: 'COCO JSON — 实例分割标准格式',
                jsonImageRecognition: 'JSON — 图像分类标签',
                labelmeRect: 'LabelMe JSON (.zip) — 矩形标注框',
                labelmePolygon: 'LabelMe JSON (.zip) — 多边形标注'
            },
            import: {
                cocoRect: 'COCO JSON — 检测框标准格式',
                cocoPolygon: 'COCO JSON — 实例分割标准格式',
                yoloRect: 'YOLO (.txt + labels.txt) — 归一化坐标',
                vocRect: 'VOC XML — 像素坐标',
                vggPolygon: 'VGG JSON — 多边形顶点坐标',
                labelmeRect: 'LabelMe JSON — 矩形标注框',
                labelmePolygon: 'LabelMe JSON — 多边形标注'
            }
        },

        // Feature In Progress
        featureInProgress: {
            newFeature: '新功能',
            comingSoon: '即将推出...'
        },
        
        // Editor Top Navigation Bar
        editorTopNavBar: {
            zoomIn: '放大',
            zoomOut: '缩小',
            fitImage: '自适应画布',
            maxZoom: '原尺寸大小',
            imageDragModeOn: '开启拖拽',
            imageDragModeOff: '关闭拖拽',
            smartAnnotationOn: '智能标注',
            smartAnnotationOff: '智能标注',
            smartAnnotationNeedsSAM: '请先加载 SAM 模型',
            acceptAllDetections: '接受所有建议的检测',
            rejectAllDetections: '拒绝所有建议的检测',
            enableSegmentation: '开启分割',
            disableSegmentation: '关闭分割',
            segmentationInProgress: '分割中...',
            enableDetection: '开启推理',
            disableDetection: '关闭推理',
            detectionInProgress: '推理中...',
            cannotSegment: '无法分割',
            cannotDetect: '无法推理'
        },
        
        // Keyboard Shortcuts Popup
        keyboardShortcuts: {
            title: '键盘快捷键',
            close: '关闭',
            functionality: '功能',
            context: '环境',
            editor: '编辑器',
            popup: '弹窗',
            polygonAutocomplete: '多边形自动完成',
            cancelPolygonDrawing: '取消多边形绘制',
            deleteSelectedLabel: '删除选中的标签',
            loadPreviousImage: '加载上一张图像',
            loadNextImage: '加载下一张图像',
            zoomIn: '放大',
            zoomOut: '缩小',
            moveImage: '移动画布',
            switchImage: '切换上/下一张',
            selectAll: '全选图片',
            save: '保存项目',
            selectLabel: '选择标签',
            exitPopup: '退出弹窗'
        },
        
        // Load YOLO Model Popup
        loadYoloModel: {
            title: '加载 {model} 模型',
            titleFallback: '自定义模型',
            acceptLabel: '确认',
            rejectLabel: '返回',
            active: '使用中',
            downloaded: '已下载',
            uploadMessage: '拖拽自定义 {ext} 模型文件到下方区域，上传到推理服务器使用。',
            officialMessage: '选择 {name} 官方预训练模型变体，服务器将自动下载并加载。',
            downloading: '正在下载模型...',
            loading: '正在加载模型...',
            ready: '加载完成',
            errorState: '加载失败',
            preparing: '准备中...',
            loadFailed: '加载失败',
            connectionFailed: '无法连接服务器',
            dragModel: '拖拽 {ext} 模型文件',
            clickToSelect: '点击上传',
        },

        // Queue
        queueStatus: {
            pending: '待处理',
            processing: '加载中',
            completed: '已载入',
            error: '错误',
        },
        queueDataSync: {
            local: '待同步到资源中心',
            syncing: '正在同步数据批次',
            synced: '资源中心 · v{revision}',
            dirty: '标注有更新，待同步',
            error: '数据同步失败',
            action: '同步到资源中心',
        },
        queueEmpty: '队列为空',
        queueEmptyHint: '点击上传或拖拽到此处释放',

        // Video
        video: {
            frame: '帧',
            pause: '暂停',
            play: '播放',
            replay: '重播',
            mute: '静音',
            unmute: '取消静音',
            playerAriaLabel: '视频播放器控制区域，按空格键播放/暂停',
            shortcutMove1: '← →: 移动 1 帧',
            shortcutMove10: 'A D 移动 10 帧',
            shortcutPlayPause: '空格: 播放/暂停',
            rangeInference: '对选区推理',
            rangeFrames: '{count} 帧',
            rangeClear: '✕',
            rangeHint: 'Shift+拖拽: 选择范围',
        },

        // Notifications
        notifications: {
            emptyLabelName: { header: '标签名称为空', description: '您有一个标签没有设置名称。每个标签都必须有唯一的名称。请输入正确的名称或删除空标签后重试。' },
            nonUniqueLabelNames: { header: '标签名称重复', description: '部分标签名称不唯一。唯一的名称对于确保数据正确导出是必要的。请修改名称后重试。' },
            modelDownloadError: { header: '模型加载失败', description: '无法连接推理服务器或模型下载失败。请确认 detect_server.py 已启动，且服务地址正确。' },
            modelInferenceError: { header: '推理失败', description: '无法对当前图片执行推理。请检查推理服务器是否正常运行，或更换模型后重试。' },
            modelLoadError: { header: '模型上传失败', description: '无法将 .pt 模型文件上传到推理服务器。请确认服务器已启动且文件格式正确。' },
            labelsFileUploadError: { header: '标签文件未上传', description: '您似乎忘记上传包含检测类别名称列表的文本文件。我们需要它来映射模型输出。请重新上传所有模型文件。' },
            annotationFileParseError: { header: '标注文件解析失败', description: '标注文件内容不是有效的 JSON、CSV 或 XML。请修复后重试。' },
            annotationImportAssertionError: { header: '标注文件数据无效', description: '导入的标注文件中缺少或包含无效数据。请修复后重试。' },
            unsupportedInferenceServer: { header: '不支持的推理服务器', description: '与所选推理服务器的集成仍在开发中。请关注我们的 GitHub 获取更新。' },
            roboflowInferenceServerError: { header: 'Roboflow 连接失败', description: '无法连接到您的 Roboflow 模型。请确认模型信息和 API 密钥正确。' },
            detectionCompleted: '目标检测完成',
            detectionCompletedMessage: '检测完成：发现 {count} 个对象，耗时 {time} 秒',
            detectionFailed: '目标检测失败',
            detectionFailedMessage: '检测过程中发生错误',
            detectionInProgress: '目标检测中...',
            batchDetectionProgress: '批量检测中：{current}/{total}',
            batchDetectionCompleted: '批量检测完成',
            batchDetectionCompletedMessage: '共检测 {total} 张图像，发现 {count} 个对象，耗时 {time} 秒',
        },

        // AI Model Management
        modelManagement: {
            coreServices: '核心引擎',
            extensionServices: '拓展引擎',
            callModels: '推理系统',
            providedServices: '提供服务',
            modelEngines: '引擎管理',
            dataCenter: '资源中心',
            trainingTask: '训练系统',
            taskCenter: '任务中心',
            vectorDb: '向量数据库',
            l2gRetrieval: '视觉检索',
            modelInspector: '透视',
            cameraConnect: '连接相机',
            computeCluster: '计算群',
            manage: '管理',
            noModels: '暂无推理引擎',
            noModelsHint: '点击添加第一个推理引擎',
            modelName: '引擎名称',
            modelUrl: '引擎地址',
            apiKeyOptional: '引擎密钥 (可选)',
            descriptionOptional: '引擎描述 (可选)',
            selectModelHint: '请选择一个引擎查看详情',
            unnamedModel: '未命名引擎',
            none: '无',
            noDescription: '暂无描述',
            manageMessage: '管理您的推理引擎。您可以添加、编辑或删除引擎，选择要使用的默认引擎。',
            modelDetails: '引擎详情',
            title: '引擎管理',
            close: '关闭',
            apiEndpoint: '引擎地址',
            apiKey: '引擎密钥',
            description: '模型描述',
        },

        // MainView
        mainView: {
            goBack: '返回',
            getStarted: '开始',
        },

        // DropZone
        dropZone: {
            dropImages: '拖拽图像',
            or: '或者',
            clickToSelect: '点击此处选择文件',
            oneImageLoaded: '已加载 1 张图像',
            multipleImagesLoaded: '已加载 {count} 张图像',
            objectDetection: '目标检测',
            imageRecognition: '图像识别',
        },

        // LoadLabelNamesPopup
        loadLabelsPopup: {
            loadingFailed: '标签文件加载失败',
            tryAgain: '请重试',
            dropLabelsFile: '拖拽标签文件',
            or: '或者',
            clickToSelect: '点击此处选择文件',
            oneLabelFound: '找到 1 个标签',
            multipleLabelsFound: '找到 {count} 个标签',
            message: '加载一个包含标签列表的文本文件。每个标签名称应该用换行符分隔。如果你没有准备好的文件，没关系，你可以现在创建自己的列表。',
            title: '加载标签描述文件',
            startProject: '确认',
            back: '返回',
        },

        // TagLabelsList
        emptyLabelList: '标签列表为空',

        // SizeItUpView
        sizeItUp: {
            windowTooSmall: '窗口太小了！',
            minimumSize: '请至少调整为 {width} x {height} 像素。',
        },

        // Common
        makeSense: 'Opensight Platform',
        ok: '确定',
        cancel: '取消',
        delete: '删除',
        edit: '编辑',
        save: '保存',
        load: '加载',
        export: '导出',
        import: '导入',
        or: '或',

        // AI Inference Notifications
        aiInference: {
            inProgress: 'AI推理中',
            completed: '推理完成',
            failed: '推理失败',
            steps: {
                preprocessing: '预处理',
                inference: '推理过程',
                postprocessing: '后处理',
                captureFrame: '捕获帧',
                inferring: '推理中'
            },
            stepProgress: '步骤 {current}/{total}',
            totalTime: '总耗时：',
            detectedObjects: '检测物体：',
            completedStep: '推理完成',
            successMessage: '成功检测 {count} 个目标，总耗时 {time}s',
            failedMessage: '分割推理过程中发生错误，请重试',
            results: {
                title: '推理',
                noResults: '暂无推理结果',
                noResultsHint: '绘制标注框后将自动触发AI推理',
                confidence: '置信度',
                coordinates: '坐标',
                size: '大小',
                area: '面积',
                thumbnail: '缩略图',
                objectId: '对象'
            }
        },
        taskManager: {
            title: '任务管理器',
            tooltip: '任务管理器 ({count})',
            emptyState: '当前没有后台任务',
            priorityP0: 'P0 · 数据安全',
            priorityP1: 'P1 · 重型任务',
            priorityP2: 'P2 · 轻量任务',
            statusRunning: '进行中',
            statusCompleted: '已完成',
            statusError: '失败',
            statusCancelled: '已取消',
            cancel: '取消',
            types: {
                autoSave: '自动保存',
                frameExtraction: '视频拆帧',
                batchDetect: '批量检测',
                batchSegment: '批量分割',
                tracking: '检索跟踪',
                training: '训练任务',
                export: '导出标注',
                queueLoad: '加载队列项',
                dataSync: '同步数据批次'
            },
            subtitleFrames: '{done}/{total} 帧',
            showCompleted: '显示已完成'
        }
    },
    [Language.ENGLISH]: {
        // TopNavigationBar
        projectName: 'Project Name:',
        uploadImages: 'Upload Images',
        languageToggle: 'English',
        account: {
            openMenu: 'Open account menu',
            menuLabel: 'Account menu',
            displayName: 'Local administrator',
            role: 'Administrator account',
            uploadAvatar: 'Upload avatar',
            avatarUploadError: 'Choose a JPG, PNG, or WebP image up to 2 MB',
            personalCenter: 'Account center',
            switchToControlPlatform: 'Switch to Management Platform',
            switchToAnnotationPlatform: 'Switch to Production Platform',
            signOut: 'Sign out',
        },
        
        // EmptyProjectView
        welcomeTitle: 'Welcome to Opensight Platform',
        welcomeDescription: 'Click to upload or drag here to release',
        dragActiveMessage: 'Drop files to upload images',
        uploadHints: {
            dragSupport: '• Support drag and drop image files',
            formatSupport: '• Support JPEG, PNG formats',
            batchSupport: '• Support batch upload multiple images'
        },
        
        // SideNavigationBar
        images: 'Images',
        labels: 'Labels',
        selectAll: 'Select All',
        inferenceResults: 'AI Results',
        queue: 'File Queue',
        videoMeta: '{frames} frames @ {fps}fps',
        folderMeta: '{count} images',
        changelog: {
            title: 'Changelog',
            close: 'Close',
        },

        // EmptyLabelList
        drawFirstBoundingBox: 'draw your first bounding box',
        markFirstPoint: 'mark your first point',
        drawFirstLine: 'draw your first line',
        drawFirstPolygon: 'draw your first polygon',
        drawFirstLabel: 'draw your first label',
        noLabelsCreated: 'no labels created for this image yet',
        
        // EditorBottomNavigationBar
        imageNavigation: {
            previous: 'Previous',
            next: 'Next',
            imageCount: 'Image {current} of {total}'
        },
        
        // LabelInputField
        selectLabel: 'Select Label',
        deleteLabel: 'Delete Label',
        toggleVisibility: 'Toggle Visibility',
        
        // Actions DropDown Menu
        actions: {
            title: 'Actions',
            editLabels: {
                name: 'Edit Labels',
                description: 'Modify labels list'
            },
            uploadFiles: {
                name: 'Upload Files',
                description: 'Upload images or videos'
            },
            importAnnotations: {
                name: 'Import Annotations',
                description: 'Import annotations from file'
            },
            exportAnnotations: {
                name: 'Export Annotations',
                description: 'Export annotations to file'
            },
            runAILocally: {
                name: 'Run AI locally',
                description: 'Run annotation model in browser'
            },
            connectAIServer: {
                name: 'Connect AI server',
                description: 'Run annotation model on server'
            },
            integrateAIModel: {
                name: 'Engine Management',
                description: 'Integrate external AI model services'
            }
        },
        
        // Label Toolkit
        labelTypes: {
            all: 'All labels',
            imageRecognition: 'Image recognition',
            rect: 'Detection labels',
            point: 'Point',
            line: 'Line',
            polygon: 'Segmentation labels',
            // Top-nav tool-button tooltips (imperative)
            toolAll: 'View all labels',
            toolRect: 'Draw rectangles',
            toolPolygon: 'Draw polygons',
        },
        
        // Popup Windows
        popups: {
            uploadFiles: {
                title: 'Upload Files',
                addNewFiles: 'Click to upload',
                clickToSelect: 'drag and drop here',
                oneFileLoaded: '1 file loaded',
                multipleFilesLoaded: '{count} files loaded',
                loadButton: 'Confirm',
                cancelButton: 'Cancel'
            },
        insertLabelNames: {
            titleCreate: 'Create labels list',
            titleUpdate: 'Update labels list',
            acceptButton: 'Confirm',
            rejectButton: 'Cancel',
            insertLabel: 'Insert label',
            addLabel: 'Add label',
            suggestion: 'Suggestion',
            loadFromFile: 'Load from file',
            messageUpdate: 'You can now edit the label names you use to describe the objects in the photos. Use the + button to add a new empty text field.',
            messageCreate: 'Before you start, you can create a list of labels you plan to assign to objects in your project. You can also choose to skip that part for now and define label names as you go.',
            emptyListMessage: 'Click here to add your first label'
        },
            exportAnnotations: {
                title: 'Export annotations',
                acceptButton: 'Confirm',
                rejectButton: 'Cancel',
                selectFormat: 'Select file format you would like to use to export annotations.',
                labelmePackageButton: 'LabelMe Package',
                labelmePackageDesc: 'LabelMe format · with images · for re-annotation',
                yoloPackageButton: 'YOLO Dataset',
                yoloPackageDesc: 'YOLO format · with images · detection/segmentation dataset'
            },
            importAnnotations: {
                title: 'Import annotations',
                acceptButton: 'Confirm',
                rejectButton: 'Cancel',
                selectFileFormat: 'Select file format you would like to use to import labels.',
                dropZoneMessage: 'Click to upload',
                dropZoneActive: 'or drag and drop here',
                importError: 'Annotation import was unsuccessful',
                tryAgain: 'Try again',
                importReady: 'Annotation ready for import',
                importWarning: 'After import you will lose all your current annotations'
            },
            exitProject: {
                title: 'Exit project',
                content: 'Are you sure you want to exit the current project? All unsaved changes will be lost.',
                acceptButton: 'Confirm',
                rejectButton: 'Cancel'
            },
            callModel: {
                title: 'Inference System',
                selectModel: 'Select model to load:',
                acceptButton: 'Next',
                rejectButton: 'Close',
                models: {},
                welcomeMessage: 'Speed up your annotation process using AI. Don\'t worry, your photos are still safe. To take care of your privacy, we decided not to send your images to the server, but instead bring AI to you. Make sure that you have a fast and stable connection - it may take a while to load the model.'
            },
            suggestLabels: {
                title: 'Suggest Labels',
                acceptButton: 'Confirm',
                rejectButton: 'Cancel',
                selectAll: 'Select All',
                acceptAll: 'Accept All',
                rejectAll: 'Reject All'
            },
            connectServer: {
                title: 'Connect AI Server',
                acceptButton: 'Confirm',
                rejectButton: 'Cancel',
                roboflowModel: 'Roboflow Model ID',
                roboflowKey: 'Roboflow API Key',
                testConnection: 'Test Connection',
                roboflowMessage: 'Provide details of the Roboflow model you want to run over the API, as well as your API key.',
                modelServiceUrl: 'Model Service URL',
                modelTaskType: 'Model Task Type',
                modelApiKey: 'Model API Key',
                taskTypeDetection: 'Object Detection',
                taskTypeSegmentation: 'Object Segmentation',
                customAIMessage: 'Configure your AI model service connection',
                localYoloMessage: 'Connect to local YOLO inference server (python detect_server.py)',
                localYoloUrl: 'Server URL'
            },
            modelEngine: {
                title: 'Inference Engine',
                acceptButton: 'Save',
                rejectButton: 'Cancel',
                modelUrl: 'Engine URL',
                modelType: 'Engine Type',
                apiKey: 'Engine Key',
                testConnection: 'Test Connection',
                integrationMessage: 'Connect a core or extension engine. Detection, segmentation, and OCR are all provided by the core engine.',
                taskTypeCore: 'Core Engine',
                taskTypeExtension: 'Extension Engine'
            }
        },
        
        // Format Options
        formats: {
            export: {
                yoloRect: 'YOLO (.zip) — one .txt per image, normalized coords',
                vocRect: 'VOC XML (.zip) — one .xml per image, pixel coords',
                csvGeneric: 'CSV — all annotations in a single table',
                vggPolygon: 'VGG JSON — polygon vertex coordinates',
                cocoPolygon: 'COCO JSON — instance segmentation standard',
                jsonImageRecognition: 'JSON — image classification labels',
                labelmeRect: 'LabelMe JSON (.zip) — rectangle annotations',
                labelmePolygon: 'LabelMe JSON (.zip) — polygon annotations'
            },
            import: {
                cocoRect: 'COCO JSON — detection standard',
                cocoPolygon: 'COCO JSON — instance segmentation standard',
                yoloRect: 'YOLO (.txt + labels.txt) — normalized coords',
                vocRect: 'VOC XML — pixel coords',
                vggPolygon: 'VGG JSON — polygon vertex coordinates',
                labelmeRect: 'LabelMe JSON — rectangle annotations',
                labelmePolygon: 'LabelMe JSON — polygon annotations'
            }
        },

        // Feature In Progress
        featureInProgress: {
            newFeature: 'new feature',
            comingSoon: 'coming soon...'
        },
        
        // Editor Top Navigation Bar
        editorTopNavBar: {
            zoomIn: 'zoom in',
            zoomOut: 'zoom out',
            fitImage: 'Fit to Canvas',
            maxZoom: 'Original Size',
            imageDragModeOn: 'Enable Drag',
            imageDragModeOff: 'Disable Drag',
            smartAnnotationOn: 'Smart annotation',
            smartAnnotationOff: 'Smart annotation',
            smartAnnotationNeedsSAM: 'Load a SAM model first',
            acceptAllDetections: 'accept all proposed detections',
            rejectAllDetections: 'reject all proposed detections',
            enableSegmentation: 'Enable Segmentation',
            disableSegmentation: 'Disable Segmentation',
            segmentationInProgress: 'Segmentation in progress...',
            enableDetection: 'Enable Inference',
            disableDetection: 'Disable Inference',
            detectionInProgress: 'Inference in progress...',
            cannotSegment: 'Cannot Segment',
            cannotDetect: 'Cannot Infer'
        },
        
        // Keyboard Shortcuts Popup
        keyboardShortcuts: {
            title: 'Keyboard Shortcuts',
            close: 'Close',
            functionality: 'Functionality',
            context: 'Context',
            editor: 'Editor',
            popup: 'Popup',
            polygonAutocomplete: 'Polygon autocomplete',
            cancelPolygonDrawing: 'Cancel polygon drawing',
            deleteSelectedLabel: 'Delete currently selected label',
            loadPreviousImage: 'Load previous image',
            loadNextImage: 'Load next image',
            zoomIn: 'Zoom in',
            zoomOut: 'Zoom out',
            moveImage: 'Pan canvas',
            switchImage: 'Previous / next image',
            selectAll: 'Select all images',
            save: 'Save project',
            selectLabel: 'Select Label',
            exitPopup: 'Exit popup'
        },
        
        // Load YOLO Model Popup
        loadYoloModel: {
            title: 'Load {model} Model',
            titleFallback: 'Custom Model',
            acceptLabel: 'Confirm',
            rejectLabel: 'Back',
            active: 'Active',
            downloaded: 'Downloaded',
            uploadMessage: 'Drag and drop a custom {ext} model file to the area below to upload to the inference server.',
            officialMessage: 'Select {name} official pretrained model variant, the server will automatically download and load it.',
            downloading: 'Downloading model...',
            loading: 'Loading model...',
            ready: 'Load complete',
            errorState: 'Load failed',
            preparing: 'Preparing...',
            loadFailed: 'Load failed',
            connectionFailed: 'Cannot connect to server',
            dragModel: 'Drag {ext} model file',
            clickToSelect: 'Click to upload',
        },

        // Queue
        queueStatus: {
            pending: 'Pending',
            processing: 'Loading',
            completed: 'Loaded',
            error: 'Error',
        },
        queueDataSync: {
            local: 'Waiting for Resource Center sync',
            syncing: 'Syncing data batch',
            synced: 'Resource Center · v{revision}',
            dirty: 'Annotations changed; sync required',
            error: 'Data sync failed',
            action: 'Sync to Resource Center',
        },
        queueEmpty: 'Queue is empty',
        queueEmptyHint: 'Click to upload or drag here to release',

        // Video
        video: {
            frame: 'Frame',
            pause: 'Pause',
            play: 'Play',
            replay: 'Replay',
            mute: 'Mute',
            unmute: 'Unmute',
            playerAriaLabel: 'Video player controls, press Space to play/pause',
            shortcutMove1: '← →: Move 1 frame',
            shortcutMove10: 'A D Move 10 frames',
            shortcutPlayPause: 'Space: Play/Pause',
            rangeInference: 'Infer selection',
            rangeFrames: '{count} frames',
            rangeClear: '✕',
            rangeHint: 'Shift+drag: select range',
        },

        // Notifications
        notifications: {
            emptyLabelName: { header: 'Empty label name', description: "Looks like you didn't assign name to one of your labels. Unfortunately it is mandatory for every label to have unique name value. Insert correct name or delete empty label and try again." },
            nonUniqueLabelNames: { header: 'Non unique label names', description: 'Looks like not all your label names are unique. Unique names are necessary to guarantee correct data export when you complete your work. Make your names unique and try again.' },
            modelDownloadError: { header: 'Model load failed', description: 'Unable to connect to inference server or model download failed. Please ensure detect_server.py is running and the server address is correct.' },
            modelInferenceError: { header: 'Inference failed', description: 'Unable to perform inference on the current image. Please check if the inference server is running properly, or try a different model.' },
            modelLoadError: { header: 'Model upload failed', description: 'Unable to upload .pt model file to inference server. Please ensure the server is running and the file format is correct.' },
            labelsFileUploadError: { header: 'Labels file was not uploaded', description: 'Looks like you forgot to upload text file containing list of detected classes names. We need it to map model output to labels. Please re-upload all model files once again.' },
            annotationFileParseError: { header: 'Annotation files could not be parsed', description: 'The contents of an annotation file is not valid JSON, CSV, or XML. Please fix the files selected to import and try again.' },
            annotationImportAssertionError: { header: 'Annotation files did not contain valid data', description: 'Missing or invalid annotations provided during import. Please fix the files selected to import and try again.' },
            unsupportedInferenceServer: { header: 'Selected inference server is not yet supported', description: 'Integration with selected inference server is still under construction. Stay tuned for more updates on our GitHub.' },
            roboflowInferenceServerError: { header: 'Roboflow connection failed', description: 'Looks like we were unable to connect to your Roboflow model. Please make sure that the model specification and Roboflow API key are correct.' },
            detectionCompleted: 'Detection completed',
            detectionCompletedMessage: 'Detection completed: found {count} objects, took {time}s',
            detectionFailed: 'Detection failed',
            detectionFailedMessage: 'An error occurred during detection',
            detectionInProgress: 'Detecting objects...',
            batchDetectionProgress: 'Batch detection: {current}/{total}',
            batchDetectionCompleted: 'Batch detection completed',
            batchDetectionCompletedMessage: 'Detected {total} images, found {count} objects, took {time}s',
        },

        // AI Model Management
        modelManagement: {
            coreServices: 'Core Engines',
            extensionServices: 'Extension Engines',
            callModels: 'Inference System',
            providedServices: 'Provided Services',
            modelEngines: 'Engine Management',
            dataCenter: 'Resource Center',
            trainingTask: 'Training System',
            taskCenter: 'Task Center',
            vectorDb: 'Vector Database',
            l2gRetrieval: 'Visual Retrieval',
            modelInspector: 'Inspect',
            cameraConnect: 'Connect Camera',
            computeCluster: 'Compute Cluster',
            manage: 'Manage',
            noModels: 'No Inference Engines',
            noModelsHint: 'Click to add your first inference engine',
            modelName: 'Engine Name',
            modelUrl: 'Engine URL',
            apiKeyOptional: 'Engine Key (optional)',
            descriptionOptional: 'Description (optional)',
            selectModelHint: 'Select an engine to view details',
            unnamedModel: 'Unnamed Engine',
            none: 'None',
            noDescription: 'No description',
            manageMessage: 'Manage your inference engines. You can add, edit or delete engines, and select a default engine.',
            modelDetails: 'Engine Details',
            title: 'Engine Management',
            close: 'Close',
            apiEndpoint: 'Engine URL',
            apiKey: 'Engine Key',
            description: 'Description',
        },

        // MainView
        mainView: {
            goBack: 'Go Back',
            getStarted: 'Get Started',
        },

        // DropZone
        dropZone: {
            dropImages: 'Drop images',
            or: 'or',
            clickToSelect: 'Click here to select them',
            oneImageLoaded: '1 image loaded',
            multipleImagesLoaded: '{count} images loaded',
            objectDetection: 'Object Detection',
            imageRecognition: 'Image recognition',
        },

        // LoadLabelNamesPopup
        loadLabelsPopup: {
            loadingFailed: 'Loading of labels file was unsuccessful',
            tryAgain: 'Try again',
            dropLabelsFile: 'Drop labels file',
            or: 'or',
            clickToSelect: 'Click here to select it',
            oneLabelFound: 'only 1 label found',
            multipleLabelsFound: '{count} labels found',
            message: 'Load a text file with a list of labels you are planning to use. The names of each label should be separated by new line. If you don\'t have a prepared file, no problem. You can create your own list now.',
            title: 'Load file with labels description',
            startProject: 'Confirm',
            back: 'Back',
        },

        // TagLabelsList
        emptyLabelList: 'Your label list is empty',

        // SizeItUpView
        sizeItUp: {
            windowTooSmall: 'Ops... This window is too tight for me!',
            minimumSize: 'Please... make it at least {width} x {height} px.',
        },

        // Common
        makeSense: 'Opensight Platform',
        ok: 'OK',
        cancel: 'Cancel',
        delete: 'Delete',
        edit: 'Edit',
        save: 'Save',
        load: 'Load',
        export: 'Export',
        import: 'Import',
        or: 'or',

        // AI Inference Notifications
        aiInference: {
            inProgress: 'AI Inference',
            completed: 'Inference Completed',
            failed: 'Inference Failed',
            steps: {
                preprocessing: 'Pre-processing',
                inference: 'Inference',
                postprocessing: 'Post-processing',
                captureFrame: 'Capturing frames',
                inferring: 'Inferring'
            },
            stepProgress: 'Step {current}/{total}',
            totalTime: 'Total Time:',
            detectedObjects: 'Detected:',
            completedStep: 'Completed',
            successMessage: 'Successfully detected {count} objects, total time {time}s',
            failedMessage: 'An error occurred during segmentation inference, please try again',
            results: {
                title: 'Inference Results',
                noResults: 'No inference results',
                noResultsHint: 'Draw annotation boxes to trigger AI inference',
                confidence: 'Confidence',
                coordinates: 'Coords',
                size: 'Size',
                area: 'Area',
                thumbnail: 'Thumbnail',
                objectId: 'Object'
            }
        },
        taskManager: {
            title: 'Task Manager',
            tooltip: 'Task Manager ({count})',
            emptyState: 'No background tasks',
            priorityP0: 'P0 · Data integrity',
            priorityP1: 'P1 · Heavy work',
            priorityP2: 'P2 · Light tasks',
            statusRunning: 'Running',
            statusCompleted: 'Done',
            statusError: 'Error',
            statusCancelled: 'Cancelled',
            cancel: 'Cancel',
            types: {
                autoSave: 'Auto save',
                frameExtraction: 'Video frame extraction',
                batchDetect: 'Batch detection',
                batchSegment: 'Batch segmentation',
                tracking: 'Retrieval',
                training: 'Training job',
                export: 'Export annotations',
                queueLoad: 'Load queue item',
                dataSync: 'Sync data batch'
            },
            subtitleFrames: 'frame {done}/{total}',
            showCompleted: 'Show completed'
        }
    }
};
