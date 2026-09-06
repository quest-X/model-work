import React, {useEffect, useState} from 'react';
import './ChangelogPopup.scss';
import {ContextManager} from '../../../logic/hotkey/ContextManager';
import {ContextType} from '../../../data/enums/ContextType';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';

interface ChangelogEntry {
    version: string;
    date: string;
    changes: { zh: string; en: string }[];
}

const CHANGELOG_DATA: ChangelogEntry[] = [
    {
        version: '2.8.2',
        date: '2026-07-20',
        changes: [
            { zh: '【架构】引擎体系拆分为核心引擎与拓展引擎：核心服务统一承载硬件加速、数据中心、推理、训练、检测、分割与 OCR，拓展服务承载向量数据库和高精度检索，并按引擎接入状态控制菜单显示', en: '[Architecture] Split the engine system into core and extension engines: core services now cover hardware acceleration, datasets, inference, training, detection, segmentation, and OCR, while extension services provide vector database and high-precision retrieval; menus are gated by registered engines' },
            { zh: '【功能】新增数据中心与训练任务工作流：支持上传 YOLO 数据集、查看数据集状态、配置训练参数并跟踪训练任务', en: '[Feat] Added dataset center and training workflows for uploading YOLO datasets, reviewing dataset status, configuring training parameters, and tracking training jobs' },
            { zh: '【功能】新增向量数据库与高精度检索（L2G）：支持集合管理、图片入库、相似检索，以及局部到全局的高精度检索流程', en: '[Feat] Added vector database and high-precision retrieval (L2G), including collection management, image ingestion, similarity search, and local-to-global retrieval workflows' },
            { zh: '【功能】新增模型检查工作台，并统一检测、分割、OCR 等模型能力归属核心引擎', en: '[Feat] Added the model inspection workbench and consolidated detection, segmentation, OCR, and related model capabilities under the core engine' },
            { zh: '【界面】统一服务弹窗的响应式宽高、紧凑表单、空状态与页脚布局，修复引擎管理表单随文案收缩的问题', en: '[UI] Standardized responsive popup sizing, compact forms, empty states, and footer layouts, and fixed the engine-management form shrinking with short copy' },
        ],
    },
    {
        version: '2.8.1',
        date: '2026-06-10',
        changes: [
            { zh: '【功能】Electron 桌面客户端封装 + GitHub Actions 三平台（macOS/Windows/Linux）自动构建发布流水线', en: '[Feat] Electron desktop wrapper + GitHub Actions CI for automated three-platform (macOS/Windows/Linux) release builds' },
            { zh: '【功能】支持加载 .mlpackage CoreML/ANE 模型：CallModelPopup 新增选项，LoadDetectionModelPopup 支持目录包拖拽上传至后端', en: '[Feat] Load .mlpackage CoreML/ANE models: new option in CallModelPopup, LoadDetectionModelPopup supports directory-bundle drag-upload to backend' },
            { zh: '【功能】盾牌图标实时显示 backend 连接状态（蓝色=已连接，白色=未连接，绿色闪烁=保存中）', en: '[Feat] Shield icon now reflects live backend connection status (blue=connected, white=disconnected, green flash=saving)' },
            { zh: '【功能】侧边栏文件队列支持拖拽上传：直接拖图片/视频到左侧队列面板即可批量添加', en: '[Feat] Sidebar file queue supports drag-and-drop: drag images/videos directly onto the left queue panel to batch-add files' },
        ],
    },
    {
        version: '2.8.0',
        date: '2026-06-10',
        changes: [
            { zh: '【性能】视频批量检测接入后端流式 detect-session：帧不再经前端中转，后端批量推理 NDJSON 实时回流（同机实测 34ms/帧 → 5.5ms/帧）；旧后端或会话失效自动回退原链路', en: '[Perf] Video batch detection now streams via backend /detect-session: frames no longer round-trip through the frontend, batched inference streams back live (34ms → 5.5ms per frame measured); auto-fallback to the legacy path on old backends or expired sessions' },
            { zh: '【性能】后端事件循环解放：SAM2 跟踪/自动模式/批量推理期间 /health 不再被冻结（压测 p90 87ms → 3.5ms），推理中不再误报"后端断开"', en: '[Perf] Backend event loop liberated: /health no longer freezes during SAM2 tracking / automatic mode / batch inference (p90 87ms → 3.5ms under load) — no more false "backend disconnected" mid-inference' },
            { zh: '【性能】SAM2 自动模式提速底座：后端 /segment 新增 points_stride / points_batch 网格采样参数（stride=8 实测 24.5s → 1.6s，约 15×），参数面板的 UI 暴露方式待定', en: '[Perf] SAM2 automatic-mode groundwork: backend /segment accepts points_stride / points_batch grid-sampling params (24.5s → 1.6s at stride=8, ~15×); panel UI exposure TBD' },
            { zh: '【功能】检测推理参数 half（FP16 半精度）前后端打通：参数面板启用后随请求下发', en: '[Feat] Detection half (FP16) inference param wired end-to-end — sent with requests when enabled in the params panel' },
        ],
    },
    {
        version: '2.7.0',
        date: '2026-05-16',
        changes: [
            { zh: '【修复】模型管理弹窗分割模型已下载计数始终为 0：getLocalDownloadedCount 只查找检测模型列表，现在同时查找分割模型列表', en: '[Fix] ManageAIModelsPopup segmentation model download count always 0: getLocalDownloadedCount now searches both detection and segmentation model families' },
            { zh: '【修复】标签可见性切换后眼睛图标不更新：getAllLabels 每次重建时硬编码 isVisible，忽略 store 中的实际状态', en: '[Fix] Eye icon not updating after toggling label visibility: getAllLabels was hardcoding isVisible on each rebuild, ignoring the actual store state' },
            { zh: '【修复】检索模式只使用当前帧可见的标签作为 seed mask，隐藏的标签不再发送到后端', en: '[Fix] Retrieval mode now only uses visible labels as seed mask; hidden labels are no longer sent to backend' },
            { zh: '【功能】支持反向检索/跟踪：seed 帧离选区末端更近时自动反向传播（从 seed 帧往选区起点方向），适用于中间帧最清晰的场景', en: '[Feat] Reverse retrieval/tracking: when the seed frame is closer to the end of the selection range, tracking automatically propagates backwards toward the start frame' },
            { zh: '【后端】仅保留最大 mask 改为按类别分组：多标签模型每个类别各保留面积最大的 mask，而非全局只保留一个', en: '[Backend] "Keep largest mask only" now groups by class: multi-label models keep the largest mask per class instead of a single global largest' },
        ]
    },
    {
        version: '2.6.9',
        date: '2026-05-12',
        changes: [
            { zh: '【功能】核心引擎类型：新增 core 引擎分类，/core 独立健康验证，检测/分割/OCR 各走 /health', en: '[Feat] Core engine type: new core engine category with independent /core health check; detection/segmentation/OCR each use /health' },
            { zh: '【功能】OCR 引擎类型支持：引擎下拉新增 OCR 选项', en: '[Feat] OCR engine type: engine dropdown now includes OCR option' },
            { zh: '【功能】getEngineBaseUrl 动态引擎 URL：根据引擎类型动态拼接后端地址，支持多引擎多端口部署', en: '[Feat] getEngineBaseUrl dynamic engine URL: dynamically builds backend address per engine type, supporting multi-engine multi-port deployments' },
            { zh: '【优化】自动 HTTPS：前端部署在公网域名时默认使用 https，localhost 开发时保持 http', en: '[Optimize] Auto HTTPS: defaults to https when frontend is deployed on a public domain; stays http for localhost development' },
            { zh: '【部署】GitHub Pages 自动部署：新增 CI workflow，推送 main 自动构建并发布到 GitHub Pages', en: '[Deploy] GitHub Pages auto-deploy: new CI workflow builds and publishes to GitHub Pages on push to main' },
            { zh: '【发布】在线预览版上线 model.work：无需安装即可体验标注功能，README 新增预览截图', en: '[Release] Online preview at model.work: try annotation features without installing; README updated with preview screenshots' },
        ]
    },
    {
        version: '2.6.8',
        date: '2026-05-11',
        changes: [
            { zh: '【功能】时间线 ↔ 图像列表双向选区同步：Shift/Ctrl 多选图像自动显示时间线灰色选区，反之亦然；Ctrl+A 全选/取消全选同步', en: '[Feat] Bidirectional timeline ↔ image list selection sync: Shift/Ctrl multi-select in image list shows grey range on timeline and vice versa; Ctrl+A select/deselect-all syncs both' },
            { zh: '【优化】脚本弹窗：自定义区置顶、"自定义脚本"→"自定义"、规则文本按阶段显示对应签名', en: '[Optimize] Script popup: custom section moved to top, renamed "自定义脚本" → "自定义", contract text shows stage-specific function signature' },
            { zh: '【优化】参数区标题无参数激活时变灰（不禁用交互），避免全部取消勾选后无法重新勾选', en: '[Optimize] Param section title dims when no params are checked (interaction stays enabled), preventing the deadlock where unchecking all made re-checking impossible' },
            { zh: '【修复】CallModelPopup：自定义模型显示绿色已下载标识；分割模型蓝色胶囊实时刷新', en: '[Fix] CallModelPopup: custom models now show green "downloaded" badge; segmentation model blue active-badge refreshes via model-loaded event' },
            { zh: '【调整】分割后处理 max_polygon_points 默认值 50→100', en: '[Tweak] Segmentation post-process max_polygon_points default changed from 50 to 100' },
        ]
    },
    {
        version: '2.6.7',
        date: '2026-05-11',
        changes: [
            { zh: '【功能】自定义脚本管道：支持上传 Python 脚本作为前处理/后处理 hook，检测与分割推理前后可执行用户逻辑（光流计算、阈值过滤等）', en: '[Feat] Custom script pipeline: upload Python scripts as pre/post-process hooks; detection and segmentation can execute user logic before/after inference (optical flow, threshold filtering, etc.)' },
            { zh: '【功能】Canvas Overlay 渲染引擎：新增 OverlayRenderEngine，支持在 canvas 上绘制光流箭头、阈值线、文字等自定义叠加层', en: '[Feat] Canvas overlay render engine: new OverlayRenderEngine draws custom overlays (optical flow arrows, threshold lines, text) directly on the canvas' },
            { zh: '【功能】脚本激活指示器：模型下拉名称旁显示绿色 * 标记，一眼看出 pre/post 脚本是否激活', en: '[Feat] Script activation indicator: green * markers next to model name in the dropdown show at a glance whether pre/post scripts are active' },
            { zh: '【功能】模型下拉显示动态名称：ActiveModel 模块让非 React 组件（SmartAnnotation/Tracking）也能读取当前模型名，下拉按钮显示真实模型名而非硬编码', en: '[Feat] Dynamic model name in dropdown: ActiveModel module shares current model name with non-React components (SmartAnnotation/Tracking); dropdown button shows real model name instead of hardcoded text' },
            { zh: '【优化】工具栏响应式折叠：ButtonWrapper 加 collapsible 类，窄屏时按钮组自动隐藏避免溢出', en: '[Optimize] Responsive toolbar collapse: ButtonWrapper gains collapsible class, auto-hiding button groups on narrow viewports to prevent overflow' },
            { zh: '【优化】任务管理器双击固定 + 资源缓存：双击按钮 pin 面板不被外部点击关闭；重开面板时保留上次资源数据避免闪白', en: '[Optimize] TaskManager double-click pin + resource cache: double-click the button to pin the panel (click-outside won\'t close it); cached resource data avoids a white flash on reopen' },
        ]
    },
    {
        version: '2.6.6',
        date: '2026-05-10',
        changes: [
            { zh: '【功能】任务管理器底栏新增实时资源监控（CPU / RAM / GPU）：后端 /health 新增 resources 字段，前端每秒轮询，按占用率着色（<50% 绿 / 50-80% 橙 / >80% 红）', en: '[Feat] Real-time resource monitor (CPU / RAM / GPU) in TaskManager footer: /health now exposes a resources field, frontend polls every second, colour-coded by utilisation (<50% green / 50-80% orange / >80% red)' },
            { zh: '【功能】GPU 监控使用真实核心占用率：macOS MPS 通过 ioreg Device Utilization % 获取，NVIDIA CUDA 通过 torch.cuda.utilization()，跨平台兼容', en: '[Feat] GPU monitor reports real core utilisation: macOS MPS reads ioreg Device Utilization %, NVIDIA CUDA uses torch.cuda.utilization(), cross-platform' },
        ]
    },
    {
        version: '2.6.5',
        date: '2026-05-10',
        changes: [
            { zh: '【修复】resolve_model_path 对 sam2.1_* 名称解析失败：Path.suffix 把 ".1_b" 误当扩展名导致 .pt 回退失效，改用显式后缀检查（endsWith .pt/.onnx/.pth）', en: '[Fix] resolve_model_path failed for sam2.1_* names: Path.suffix treated ".1_b" as the extension, skipping the .pt fallback. Replaced with explicit endsWith(.pt/.onnx/.pth) check' },
            { zh: '【功能】SAM 模型分组重构：SAM 2 合并 sam2.1 全系列（sam2.1_t/s/b/l），SAM 3 合并 sam3.1_multiplex，默认变更为 sam2.1_b / sam3.1_multiplex', en: '[Feat] SAM model family restructure: SAM 2 now includes sam2.1 series (sam2.1_t/s/b/l); SAM 3 includes sam3.1_multiplex; defaults changed to sam2.1_b and sam3.1_multiplex' },
            { zh: '【修复】本地模型加载显示"正在下载模型"改为"正在加载模型"：detection.py / segmentation.py 识别本地路径后直接进 loading 状态，不再走 downloading', en: '[Fix] Local model load now shows "loading" instead of "downloading": detection.py and segmentation.py now enter loading state immediately when a local path is found, skipping the downloading state' },
            { zh: '【修复】TopNavigationBar 项目名称与左侧导航按钮重叠：移除动态 canvasCenterX ResizeObserver 定位，改回 CSS 静态居中', en: '[Fix] TopNavigationBar project name overlapping left nav buttons: removed dynamic canvasCenterX ResizeObserver positioning, reverted to CSS static centering' },
            { zh: '【功能】批量下载检测模型：支持一键批量拉取 yolo11/yolo12/yolov9/yolov10 全系列模型', en: '[Feat] Batch download detection models: one-click bulk download of full yolo11/yolo12/yolov9/yolov10 model series' },
        ]
    },
    {
        version: '2.6.4',
        date: '2026-05-10',
        changes: [
            { zh: '【修复】模型下载中断后无法重新下载：detection.py / segmentation.py 新增 _purge_corrupt_cache()，load_model() 失败时自动清理 ~/.cache/ultralytics/ 下的残缺 .pt 文件，下次请求可正常重新下载', en: '[Fix] Model re-download blocked after interrupted download: detection.py and segmentation.py now call _purge_corrupt_cache() on load_model() failure, automatically removing corrupt .pt files from ~/.cache/ultralytics/ so the next request can re-download cleanly' },
        ]
    },
    {
        version: '2.6.3',
        date: '2026-05-09',
        changes: [
            { zh: '【性能】图像批量检测切到 /batch_detect：之前是 4 路并发 × N 次 /detect，现在分块（BATCH_SIZE=8）× /batch_detect。后端走真正 batched forward pass，5 张 1440p 实测 22% 提速 + 单次 HTTP 往返代替 N 次。视频路径未改（瓶颈在 sessionId 拉帧）', en: '[Perf] Image batch detection switched to /batch_detect: previously 4-path concurrent × N /detect calls, now chunk-of-8 × /batch_detect. Backend does true batched forward pass, 5×1440p measured 22% faster + single HTTP round trip replaces N. Video path unchanged (bottleneck is sessionId frame pull)' },
            { zh: '【新 API】DetectionAPIDetector.predictBatchFromBlobs：blobs[] + filenames[] → DetectionResult[][]，整批失败抛错让调用方决定 fallback', en: '[New API] DetectionAPIDetector.predictBatchFromBlobs: blobs[] + filenames[] → DetectionResult[][]; throws on whole-batch failure so caller chooses fallback strategy' },
            { zh: '【清理】删 InferenceToggle 注释残留：EditorTopNavigationBar:968-969 引用一个 src 里根本不存在的组件，纯历史污染，删掉', en: '[Cleanup] Removed dead InferenceToggle comments: EditorTopNavigationBar.tsx:968-969 referenced a component that does not exist anywhere in src/ — pure historical noise, deleted' },
            { zh: '【提示】yolov8n 在钢厂监控视频上误检 banana：模型问题不是 v1 代码 bug。生产场景请切换到 luqian_FeiGangDou_GangBao_OCR_0202 / SEG_260123_Gangye_YV8x_Seg_Ep112 等业务模型', en: '[Note] yolov8n misdetects "banana" on steel-plant footage: model issue, not a v1 bug. For production switch to business models like luqian_FeiGangDou_GangBao_OCR_0202 / SEG_260123_Gangye_YV8x_Seg_Ep112' },
        ]
    },
    {
        version: '2.6.2',
        date: '2026-05-09',
        changes: [
            { zh: '【根因修复】ERR_FILE_NOT_FOUND 17×：FileUtil.loadImage 公共入口加 0 字节守卫。v2.6.1 只在 FramePlayer 加守卫不够——FileUtil 是所有图片加载的根入口，给占位文件就直接 createObjectURL → img.src 触发浏览器层失败。这次修在源头', en: '[Root-cause Fix] ERR_FILE_NOT_FOUND 17×: FileUtil.loadImage now guards against 0-byte placeholder Files at the public entry point. v2.6.1\'s guard in FramePlayer wasn\'t enough — FileUtil is the root loader for all image loads; previously it called createObjectURL → img.src on placeholder Files unconditionally, triggering browser-level load failures. Fixed at the source' },
            { zh: '【实测】视频模式 SAM2 推理实际工作正常：清空状态后直接走默认 sam2_l 能正常发起推理。之前测试时遇到的"silent return"是 race condition（先切检测又切回分割），不必现。runInference 入口的 [Infer] entry 诊断日志（v2.6.1 加）下次复现时能立即定位', en: '[Verified] Video-mode SAM2 inference works fine: clean-state default-sam2_l flow correctly triggers segmentBatch. The earlier "silent return" was a race condition (detection → segmentation switch sequence), not always reproducible. v2.6.1\'s [Infer] entry diagnostic log will pinpoint the cause next time it occurs' },
            { zh: '【新基线】/retrieve + /index 完整链路：5 张 1440p 图建索引 40.7s，retrieve 720ms 命中 5 个相似 bird（confidence 0.69-0.73）。1440p 索引构建较慢（~8s/图）但检索本身极快', en: '[New baseline] /retrieve + /index full chain: 5× 1440p images indexed in 40.7s; retrieve takes 720ms returning 5 similar birds (confidence 0.69-0.73). 1440p index-building is the slow step (~8s/image) but retrieval itself is fast' },
            { zh: '【已知限制】完整模式视频导出（标签 + 图像）：15094 帧 × 1440p ≈ 12GB 浏览器侧 zip，必 OOM。本次跳过实测，后续应改走 backend zip 流式导出', en: '[Known limit] Full-mode video export (labels + images): 15094 frames × 1440p ≈ 12GB browser-side zip will OOM. Skipped this round; future work should switch to backend streaming-zip export' },
        ]
    },
    {
        version: '2.6.1',
        date: '2026-05-09',
        changes: [
            { zh: '【修复】视频 on-demand 模式 ERR_FILE_NOT_FOUND 刷屏：FramePlayer.loadFrameImage 入口加 0 字节占位帧守卫，避免给 placeholder File 调 createObjectURL → img.src 触发浏览器加载失败', en: '[Fix] Video on-demand ERR_FILE_NOT_FOUND spam: FramePlayer.loadFrameImage now guards against 0-byte placeholder Files at entry, no longer feeds them through createObjectURL → img.src which triggered ~17× browser load failures during init' },
            { zh: '【修复】AutoSave 占位帧 warn 节流：视频 on-demand 模式下"全占位帧 → 跳过 IDB 写入"路径每 3 分钟触发一次，长时间会话累积上百次刷屏。改为首次和每 20 次 warn，其余静默', en: '[Fix] AutoSave placeholder-filter warn throttle: in video on-demand mode the periodic 3-min autosave kept hitting "all placeholders → skip IDB" and warning every time (100+ during long sessions). Now warns on first occurrence and every 20th, silent otherwise' },
            { zh: '【诊断】runInference 入口加状态日志：视频模式 SAM2 推理偶现 silent return，加 [Infer] entry 日志输出 isSegModel/smartAnnotationActive/trackingMode/activeModelName 几个关键状态，方便下次复现定位', en: '[Diag] runInference entry diagnostic log: video-mode SAM2 inference sometimes silently returns; added [Infer] entry log dumping isSegModel/smartAnnotationActive/trackingMode/activeModelName so the next reproduction immediately shows which branch ate the call' },
        ]
    },
    {
        version: '2.6.0',
        date: '2026-05-09',
        changes: [
            { zh: '【性能】模型轮询从 5s → 30s：health + available-models 共用的轮询定时器间隔放宽 6×，推理时不再每 5 秒打一次后端，trace/排查时网络面板大幅干净', en: '[Perf] Model polling 5s → 30s: the shared health + available-models poll timer is now 6× slower; backend no longer hit every 5s during inference, network panel much cleaner during trace/debug' },
            { zh: '【性能】切模型时强制刷状态：switchModel 调用 /switch-model 后立即触发一次 fetchModels，弥补轮询变慢后的状态延迟', en: '[Perf] Force refresh on model switch: switchModel now triggers an immediate fetchModels after /switch-model, compensating for the slower poll' },
            { zh: '【UX】SAM2 自动模式提示：每会话首次运行批量分割时，弹一次 message 通知告知"无 prompt 时每张约 20 秒（grid sampling），需要更快可先画 bbox/点"，避免用户误以为卡死', en: '[UX] SAM2 automatic-mode hint: a one-shot session-scoped notification explains "~20s per image without prompt (grid sampling); draw a bbox/points first for instant results", so users don\'t mistake the wait for a hang' },
            { zh: '【修复】DrawUtil 14 次/推理的 anchors 警告：anchors < 3 的 polygon 在 AISegmentationActions 直接 filter 掉（isFinite 后剩余顶点不足时），DrawUtil 内部从 console.warn 改为 silent return，控制台不再刷屏', en: '[Fix] DrawUtil "无效的anchors数据" warn spam (14×/inference): polygons with < 3 finite vertices are now filtered in AISegmentationActions before reaching the renderer, and DrawUtil itself silently skips invalid anchors instead of warning' },
            { zh: '【修复】React UNSAFE 生命周期警告：VirtualList 显式加 UNSAFE_ 前缀；ImagePreview 重构 UNSAFE_componentWillUpdate → componentDidUpdate（用 prevProps 对比），消除 strict mode 警告', en: '[Fix] React UNSAFE lifecycle warnings: VirtualList explicitly prefixed with UNSAFE_; ImagePreview refactored from UNSAFE_componentWillUpdate to componentDidUpdate (using prevProps comparison), eliminating strict mode warnings' },
            { zh: '【评估】/batch_detect 端点对比 /detect 4-path 并发：实测 5 图 batch=0.58s vs 并发=0.74s（22% 提速）。改造 detectBatch 风险大、收益有限，本次不实施，留作后续重构', en: '[Assessment] /batch_detect vs /detect 4-path concurrency: 5-image batch 0.58s vs concurrent 0.74s (22% faster). Rewriting detectBatch is high-risk for limited gain — deferred to a future refactor' },
        ]
    },
    {
        version: '2.5.9',
        date: '2026-05-08',
        changes: [
            { zh: '【清理】移除浏览器端 AI 推理：删除 TensorFlow.js（SSD/PoseNet）和 yolov5js 共 8 个依赖包，所有 AI 检测/分割已迁移至后端 API', en: '[Cleanup] Remove browser-side AI inference: deleted TensorFlow.js (SSD/PoseNet) and yolov5js — 8 npm packages removed; all AI detection/segmentation now uses backend API' },
            { zh: '【清理】移除 moment.js 依赖：唯一用处改为原生 Date 格式化，减少 ~300KB 打包体积', en: '[Cleanup] Remove moment.js dependency: replaced with native Date formatting, saving ~300KB bundle size' },
            { zh: '【清理】删除死视图组件：MainView（已跳过）、TextInput、UnderlineTextButton', en: '[Cleanup] Delete dead view components: MainView (bypassed), TextInput, UnderlineTextButton' },
            { zh: '【清理】移除未使用的方法和枚举值：CanvasUtil.getClientRect、EnvironmentUtil.isDev、AcceptedFileType.JSON/XML、EventType.DOUBLE_CLICK、LabelStatus.REJECTED、ContextType.DROPDOWN', en: '[Cleanup] Remove unused methods and enum values: CanvasUtil.getClientRect, EnvironmentUtil.isDev, AcceptedFileType.JSON/XML, EventType.DOUBLE_CLICK, LabelStatus.REJECTED, ContextType.DROPDOWN' },
        ]
    },
    {
        version: '2.5.8',
        date: '2026-05-08',
        changes: [
            { zh: '【性能】VideoCanvas 分辨率自适应：画布从视频原始分辨率（如 2560×1440）降至显示尺寸×DPR，减少 ~27% 像素填充', en: '[Perf] VideoCanvas resolution adapts to display size × DPR instead of native video resolution, reducing pixel fill by ~27%' },
            { zh: '【性能】toDataURL → toBlob：视频帧导出和缩略图生成从同步阻塞改为异步非阻塞，消除主线程卡顿', en: '[Perf] toDataURL → toBlob: video frame export and thumbnail generation switched from synchronous to async, eliminating main-thread stalls' },
            { zh: '【性能】视频帧缩略图降采样：sidebar 缩略图从全尺寸（~15MB/帧解码）降至 200px（~0.1MB），大幅减少内存占用', en: '[Perf] Video frame thumbnail downsampling: sidebar thumbnails reduced from full-size (~15 MB decoded/frame) to 200px max (~0.1 MB), significantly reducing memory usage' },
            { zh: '【性能】Undo/Redo structuredClone 节流：快照间隔限制 300ms，消除快速操作时 2.6 秒的主线程阻塞', en: '[Perf] Undo/Redo structuredClone throttle: snapshot interval capped at 300ms, eliminating 2.6s main-thread block during rapid operations' },
            { zh: '【性能】平台检测单次 toLowerCase：UA 字符串只做一次大小写转换，避免 4× 重复调用', en: '[Perf] Platform detection single-pass: UA string lowercased once instead of 4× separate calls' },
            { zh: '【修复】DrawUtil.clearCanvas 空值守卫：canvas 未挂载时鼠标事件不再抛 TypeError', en: '[Fix] DrawUtil.clearCanvas null guard: mouse events before canvas mount no longer throw TypeError' },
            { zh: '【修复】Editor 跳过 0 字节占位文件加载：视频按需帧的空占位不再触发 FileUtil.loadImage 报错', en: '[Fix] Editor skips loading 0-byte placeholder files: on-demand video frame placeholders no longer trigger FileUtil.loadImage errors' },
        ]
    },
    {
        version: '2.5.7',
        date: '2026-05-08',
        changes: [
            { zh: '【修复】Redux 幂等守卫：generalReducer 标量赋值 case 增加值相等短路返回，阻断 canvas render → dispatch → re-render 无限循环', en: '[Fix] Redux idempotency guards: scalar-assignment cases in generalReducer now short-circuit when value equals current state, preventing canvas render → dispatch → re-render infinite loops' },
            { zh: '【修复】通知动画改用 translateX 替代 width 动画，消除布局抖动（layout thrashing）', en: '[Fix] Notification animation switched from width to translateX, eliminating layout thrashing' },
            { zh: '【UI】任务管理器图标更新', en: '[UI] Task manager icon updated' },
        ]
    },
    {
        version: '2.5.6',
        date: '2026-05-08',
        changes: [
            { zh: '【优化】智能标注 bbox 视觉区分：绘制过程和完成后均显示为白色虚线框（无内部填充），与手动标注实线彩色框一眼可辨', en: '[Optimize] Smart annotation bbox visual distinction: drawing and completed bbox both render as white dashed outline (no fill), clearly distinguishable from manual solid-colored annotation rects' },
            { zh: '【交互】智能标注 bbox 内部可添加 point prompt：点击 bbox 内部新增正/负点，仅边缘拖拽移动 bbox', en: '[UX] Smart annotation bbox interior supports point prompts: click inside to add positive/negative points; only edge dragging moves the bbox' },
            { zh: '【修复】SAM2 bbox 推理 500 报错：bbox-only 路径恢复为 bboxes 参数传递；points+bbox 同时存在时分别推理取最佳结果', en: '[Fix] SAM2 bbox inference 500 error: bbox-only path restored to native bboxes parameter; points+bbox co-exist by running separate inferences and picking the best result' },
            { zh: '【修复】SAM2 模型 variant 名称修正：sam2.1_x → sam2_x，匹配 ultralytics 实际模型名', en: '[Fix] SAM2 model variant names corrected: sam2.1_x → sam2_x to match actual ultralytics model names' },
            { zh: '【修复】多边形顶点交叉：_limit_polygon_points 从 RDP 二分搜索改为等弧长均匀采样，消除凹形轮廓简化后的自交问题', en: '[Fix] Polygon vertex crossing: _limit_polygon_points changed from adaptive RDP binary search to equal-arc-length subsampling, eliminating self-intersections on concave contours' },
            { zh: '【修复】后端 Python 3.9 兼容：routes.py 的 str|None 联合类型改为 Optional[str]', en: '[Fix] Backend Python 3.9 compatibility: str|None union syntax in routes.py replaced with Optional[str]' },
            { zh: '【调整】默认模型变更：检测默认 yolo26x，分割默认 sam2_l；前端模型选择面板同步默认选中', en: '[Adjust] Default models changed: detection defaults to yolo26x, segmentation defaults to sam2_l; frontend model selection panel defaults updated accordingly' },
            { zh: '【调整】推理流程默认：前处理、推理过程默认不激活，仅后处理默认激活', en: '[Adjust] Pipeline defaults: preprocess and inference stages deactivated by default; only postprocess activated' },
            { zh: '【调整】自动保存周期从 15 秒改为 3 分钟（编辑防抖和切标签页 flush 保存不受影响）', en: '[Adjust] Autosave interval changed from 15s to 3 minutes (edit-debounce and visibility-change flush unaffected)' },
            { zh: '【UI】模型引擎详情页去除冒号，与标题行风格统一', en: '[UI] Removed colons from model engine detail labels to match title row style' },
        ]
    },
    {
        version: '2.5.5',
        date: '2026-05-08',
        changes: [
            { zh: '【新功能】SAM 智能标注原生化：prompt 点/框存储为原生 LabelRect（isPrompt 标记），继承拖拽移动、Backspace 删除等全部标签交互', en: '[Feature] SAM smart annotation nativized: prompt points/bboxes stored as native LabelRect (isPrompt flag), inheriting drag-to-move, Backspace delete, and all label interactions' },
            { zh: '【修复】SAM 多点 prompt 形状修正：多点从 (N,2) 改为 (1,N,2)，确保所有点合成一个 prompt 而非 N 个独立 prompt', en: '[Fix] SAM multi-point prompt shape: changed from (N,2) to (1,N,2) so all points form one combined prompt instead of N separate ones' },
            { zh: '【修复】SAM points+bbox 同时传递：ultralytics 不支持同时传 points 和 bboxes，改为将 bbox 转为 label=2/3 的特殊点合并到 points 列表', en: '[Fix] SAM points+bbox simultaneous prompt: ultralytics cannot handle both; bbox corners are now converted to special points (label=2 top-left, label=3 bottom-right) merged into the points list' },
            { zh: '【修复】ALL 视图标签消失：智能标注/橡皮擦/检索模式下强制显示全部标签类型，不受侧栏 tab 过滤', en: '[Fix] Labels disappearing in ALL view: smart annotation / eraser / retrieval modes now force-show all label types regardless of sidebar tab filter' },
            { zh: '【修复】Backspace 在 ALL 视图下无法删除标签：LabelActions.deleteImageLabelById 新增 LabelType.ALL 分支，按 ID 在所有标签类型中查找并删除', en: '[Fix] Backspace not deleting labels in ALL view: LabelActions.deleteImageLabelById now handles LabelType.ALL by searching across all label types' },
            { zh: '【UI】显示/隐藏标签按钮移至绘制工具组（多边形旁边）', en: '[UI] Toggle labels button moved to drawing tools group (next to polygon)' },
            { zh: '【调整】后处理默认值：polygon_epsilon 默认关闭，max_polygon_points 默认 50', en: '[Adjust] Postprocess defaults: polygon_epsilon disabled by default, max_polygon_points default changed to 50' },
        ]
    },
    {
        version: '2.5.4',
        date: '2026-05-07',
        changes: [
            { zh: '【关键修复】1440p+ 长视频推理浏览器崩溃：缓存窗口按视频分辨率自适应（1440p 时从 1500 帧降到 ~80 帧 RGBA），推理并发按分辨率自适应（1440p→1，1080p→2，≤720p→4），从根上消除 OOM 崩溃。9.3GB / 1440p / 25fps / 10min 视频实测稳定', en: '[Critical Fix] 1440p+ long-video inference no longer crashes the browser: frame cache window now adapts to resolution (1440p drops from 1500 to ~80 RGBA frames), inference concurrency adapts to resolution (1440p→1, 1080p→2, ≤720p→4). Eliminates OOM crash on a 9.3 GB / 1440p / 25 fps / 10 min test video' },
            { zh: '【优化】三层缓存独立预算：RGBA 解码层 1.2GB（重，严限）/ JPEG 字节层 600MB（中，~2000 帧大窗口）/ 缩略图自然累积。scrub 在当前帧 ±80 秒内基本无感（命中 JPEG 缓存 ~30ms 解码），远端约 200ms 后端拉取', en: '[Optimize] Three-tier cache with independent budgets: decoded RGBA layer 1.2 GB (heavy, strict) / JPEG byte layer 600 MB (~2000 frames) / thumbnails accumulate naturally. Scrubbing within ±80 s of current frame is near-instant (JPEG hit + ~30 ms decode); farther seeks ~200 ms backend fetch' },
            { zh: '【优化】检测推理路径切到 JPEG q=0.9：单帧检测/批量检测从前端 PNG 编码（80-200ms 主线程阻塞 + ~3MB/帧）切到 JPEG（10-30ms + ~500KB/帧）。分割路径保留 PNG（mask 边界对压缩敏感）', en: '[Optimize] Detection inference now uses JPEG q=0.9: single-frame and batch detection switched from PNG (80-200 ms main-thread block + ~3 MB/frame) to JPEG (10-30 ms + ~500 KB/frame). Segmentation path retains PNG (mask edges are compression-sensitive)' },
            { zh: '【UX】推理流程默认全激活：模型设置弹窗的"前处理 / 推理过程 / 后处理"三阶段默认全部激活，不需手动拖入下方区域', en: '[UX] Pipeline stages activated by default: pre-process / inference / post-process all start active in the model settings popup; no manual drag-to-activate needed' },
        ]
    },
    {
        version: '2.5.3',
        date: '2026-05-07',
        changes: [
            { zh: '【新功能】Shift+拖拽时间轴选区推理：按住 Shift 在时间轴上拖拽选取帧范围，顶部推理按钮自动显示"推理 ×N帧"，点击即可对选定范围执行批量推理', en: '[Feature] Shift+drag timeline range inference: hold Shift and drag on the timeline to select a frame range; the top inference button shows "Infer ×N frames" and runs batch inference on the selection' },
            { zh: '【增强】任务管理器改进：Badge 显示全部任务数量（含已完成）；任务行带完整时间戳（YYYY-MM-DD HH:MM:SS）；自动保存每次创建独立记录不再覆盖；所有任务保留完整历史不再自动移除，底部开关控制已完成任务显示/隐藏', en: '[Enhance] Task Manager improvements: badge shows total task count (including completed); task rows display full timestamps (YYYY-MM-DD HH:MM:SS); each autosave creates an independent record instead of overwriting; all tasks are preserved in history (no auto-remove), with a footer toggle to show/hide completed tasks' },
            { zh: '【UX】推理进度通知可点击关闭：推理过程中的进度条通知现在可以点击标题直接关闭，任务进度仍可在任务管理器查看', en: '[UX] Inference progress notifications are now dismissible: click to close during inference; progress is still visible in the Task Manager' },
            { zh: '【修复】模型下拉与推理按钮高度对齐：统一 22px 高度 + flex 居中', en: '[Fix] Model dropdown and inference button height aligned: unified 22px height + flex centering' },
            { zh: '【优化】自动保存频率降低：防抖从 1s 增加到 5s，移除不必要的依赖项（切帧不再触发保存）', en: '[Optimize] Autosave frequency reduced: debounce increased from 1s to 5s, removed unnecessary deps (frame switching no longer triggers save)' },
        ]
    },
    {
        version: '2.5.2',
        date: '2026-05-07',
        changes: [
            { zh: '【新功能】任务管理器（右下角）：在右侧 sidebar 底部新增任务图标，对称于左下保存图标。点击弹出浮动面板，按 P0（自动保存）/ P1（视频拆帧、批量检测、分割、跟踪）/ P2（YOLO 导出）三档分组展示后台任务，带帧进度与可中断按钮。点击外部 / Esc 关闭', en: '[Feature] Task Manager (bottom-right): new task icon in the right sidebar bottom, mirroring the bottom-left save button. Click to open a floating panel grouping background tasks by P0 (autosave) / P1 (frame extraction, batch detect, segment, track) / P2 (YOLO export), with per-frame progress and a cancel button on cancellable tasks. Closes on click-outside or Esc' },
            { zh: '【UX】任务面板贴角定位：弹框右下角对齐图标左上角，window resize 时自动跟随，不再固定坐标偏移', en: '[UX] Task panel anchors its bottom-right corner to the icon\'s top-left corner; recomputes on window resize instead of using a fixed offset' },
        ]
    },
    {
        version: '2.5.1',
        date: '2026-05-07',
        changes: [
            { zh: '【UX】恢复对话框新增项目名称显示：刷新/重开时的恢复弹窗现在第一行就是项目名，方便确认是不是自己要恢复的那个', en: '[UX] Restore dialog now shows the project name as the first row, making it easier to confirm which session you\'re restoring' },
            { zh: '【功能】空白编辑区拖拽导入标注：直接把 .json / .txt / .xml / .zip 拖进空白区域即可触发导入弹窗，不用再从菜单里找', en: '[Feature] Drag-and-drop annotation import on the empty editor: drop .json / .txt / .xml / .zip files directly onto the canvas to open the import dialog' },
            { zh: '【UX】导入弹窗显示加载摘要：压缩包数量、图像数、标签类别、标注数一目了然，导入前就知道内容对不对', en: '[UX] Import popup shows a loading summary: zip count, image count, label classes, and annotation count at a glance before committing the import' },
            { zh: '【修复】多 zip 批量导入：之前只处理第一个 zip；现在每个 zip 独立解析 + label ID 跨包重映射 + 文件名前缀去重，不再丢图或串标注', en: '[Fix] Multi-zip batch import: previously only the first zip was processed. Each zip is now parsed independently with cross-zip label-ID remapping and filename prefixing to prevent image loss and annotation mismatch' },
        ]
    },
    {
        version: '2.5.0',
        date: '2026-05-07',
        changes: [
            { zh: '【版本】v2.4.9 之后按惯例升 minor。误编号 v2.4.10 已 retag 为 v2.5.0（commit 内容不动）', en: '[Versioning] Per project convention, bumped minor after v2.4.9. Mistakenly numbered v2.4.10 first; retagged to v2.5.0 (commit contents unchanged)' },
            { zh: '【可靠性】后端启动时孤儿临时目录清扫：扫 tempfile.gettempdir() 下所有 opensight_video_* / opensight_track_clip_* / opensight_frames_* 目录全部 rmtree。pkill -9 强杀或意外崩溃后留下的几十个 GB 不再积累。本次启动一次性清掉 19 个孤儿目录，腾出 ~75GB', en: '[Reliability] Backend boot-time orphan temp-dir sweep: scans tempfile.gettempdir() for opensight_video_* / opensight_track_clip_* / opensight_frames_* and rmtree them all. Tens of GB no longer accumulate after pkill -9 or unexpected crashes. This release recovered 19 orphan dirs / ~75GB on first boot' },
            { zh: '【UX】上传视频前 disk preflight：根据 Content-Length × 1.5 + 256MB 工作余量预检 shutil.disk_usage(tempdir).free，不够直接 400 返回"磁盘空间不足：当前可用 N MB，需 M MB"，前端把这条具体提示原样显示给你（不再傻 fallback 到 raw_browser_mode 还看不出原因）', en: '[UX] Disk preflight before video upload: backend checks shutil.disk_usage(tempdir).free against Content-Length × 1.5 + 256MB working room; if short, returns 400 with "disk full: N MB available, need M MB" detail. Frontend surfaces this verbatim instead of silently falling back to raw_browser_mode' },
            { zh: '【UX】写盘失败 ENOSPC 也单独 catch：之前写到一半 OSError errno 28 给 generic 500，现在转 400 + "写到 NMB 时空间耗尽"信息', en: '[UX] Mid-write ENOSPC failures get their own message: was a generic 500 with stack trace, now a 400 with "ran out of space at N MB written"' },
        ]
    },
    {
        version: '2.4.9',
        date: '2026-05-07',
        changes: [
            { zh: '【修复】AutoSave 不再用空数组覆盖 IDB：filter byteLength>0 后如果全空但 Redux 里其实有 entries（典型场景：视频 on-demand 模式占位帧 / 帧未解码完），跳过 IDB 写入而非写 images:[]，避免之前真正有数据的快照被无效覆盖', en: '[Fix] AutoSave no longer overwrites IDB with empty arrays: when byteLength>0 filter empties everything but Redux had entries (typical: on-demand video placeholder frames / frames not yet decoded), skip the IDB write instead of saving images:[] and clobbering a prior valid snapshot' },
            { zh: '【UX】恢复对话框始终显示数量：v2.4.8 之前数量行只在 validImageCount>0 时渲染，导致"saved 但 0 张"看不见原因。现在 0 也显示并标红"无可恢复数据"提示，避免用户点完恢复进到空白编辑器还不知道为什么', en: '[UX] Restore dialog always shows the count row: previously only rendered when validImageCount>0, hiding the "saved but empty" case. Now displays 0 too with a red "no recoverable data" hint, so users aren\'t confused by an empty editor after clicking Restore' },
        ]
    },
    {
        version: '2.4.8',
        date: '2026-05-07',
        changes: [
            { zh: '【修复】"后处理"对目标跟踪不生效：之前 /track 完全没接 polygon_epsilon / min_mask_area / mask_dilate / max_polygon_points，前端 popup 设的全部被忽略；后端 hard-code 一个 2px 的 epsilon 充当兜底。现在 ObjectTrackingActions 读 PipelineStore + SegmentationAPIDetector.getPostprocessParams()，复用 segmentation 那套激活/enabled 双重过滤，POST 到 /track 的 postprocess 字段；tracking.py stream_tracking 复用 segmentation 的 _dilate_polygon / _polygon_area / _simplify_polygon / _limit_polygon_points', en: '[Fix] Post-processing didn\'t apply to object tracking: /track ignored polygon_epsilon / min_mask_area / mask_dilate / max_polygon_points entirely; backend used a hard-coded 2px epsilon as the only safeguard. ObjectTrackingActions now reads PipelineStore + SegmentationAPIDetector.getPostprocessParams() with the same activation+enabled double-filter as /segment, POSTs them as the postprocess field; tracking.py stream_tracking reuses segmentation\'s _dilate_polygon / _polygon_area / _simplify_polygon / _limit_polygon_points helpers' },
        ]
    },
    {
        version: '2.4.7',
        date: '2026-05-07',
        changes: [
            { zh: '【UX】视频缩略图全部常驻（再次回归 v2.3.3 行为）：v2.4.4 把 LRU cap 砍到 1000 是为堵 tracking OOM 的误伤，真正元凶（SAM 2 polygon 顶点数）已经在 v2.4.4 同期被 cv2.approxPolyDP 砍掉 10-20×。现在 cap = min(frames+100, 30000)，8000 帧解码 thumb ≈ 720MB，Chrome 4GB renderer 还有大量余量；30000 帧封顶（≈ 16min@30fps）作为变态视频兜底', en: '[UX] All video thumbnails resident again (back to v2.3.3 behavior). v2.4.4 cut the LRU cap to 1000 to plug a tracking OOM, but the actual culprit (SAM 2 polygon vertex count) was simultaneously fixed by cv2.approxPolyDP server-side. Cap is now min(frames+100, 30000); 8000 decoded thumbs ≈ 720MB, leaving plenty of headroom in Chrome\'s 4GB renderer. 30000 cap (~16min @30fps) as a sanity ceiling for absurd cases' },
        ]
    },
    {
        version: '2.4.6',
        date: '2026-05-07',
        changes: [
            { zh: '【UX】恢复 v2.1.9 行为：IndexedDB 里只要有 settings 或 project 任一就弹"恢复工作"对话框（v2.2.0 期间收紧成 hasProject-only 让设置静默恢复，太被动）', en: '[UX] Restored v2.1.9 behavior: the "restore work" dialog now appears whenever settings OR project data exists in IndexedDB (v2.2.0 narrowed it to hasProject-only and silently restored settings — too passive)' },
            { zh: '【可靠性】AutoSave 更激进：定时间隔 60s → 15s；Redux store subscribe + 3s debounce，编辑停 3 秒就自动存；visibilitychange→hidden 时强制 flush。配合 v2.4.2 的 signature-skip，无变化 tick 仍是 0 序列化', en: '[Reliability] More aggressive AutoSave: interval 60s → 15s; Redux store subscribe + 3s debounce so edits trigger a save 3s after the last action; force-flush on visibilitychange→hidden. v2.4.2 signature-skip still no-ops idle ticks' },
        ]
    },
    {
        version: '2.4.5',
        date: '2026-05-07',
        changes: [
            { zh: '【版本】回溯重编号 v2.3.10..14 + v2.3.15 → v2.4.0..5：按惯例逢 10 进 minor。tag 重指（git tag -d 旧名 + 新名）；commit 内容不变，对应 commit 的 package.json 仍是历史值（不动）。v2.3.0..v2.3.9 保留', en: '[Versioning] Retroactive renumber v2.3.10..14 + v2.3.15 → v2.4.0..5: convention is bump minor at patch ~10. Tags moved (git tag -d + retag); commit contents untouched, so historical commits\' package.json still reads v2.3.10..14 (intentional). v2.3.0..v2.3.9 unchanged' },
            { zh: '【UX】更新日志"加载更多"按钮回归：v2.0 时代的 commit 86971c81 (2026-04-15) 把按钮悄悄换成了滚到底部 80px 自动加载 + 一行 11px / #555 的斜体 hint 文本，对比度太低基本看不见。现在恢复成显式 button（蓝色边框，hover 加深），保留滚动自动加载兼容', en: '[UX] Restored "Load more" button in changelog: an old refactor (commit 86971c81 on 2026-04-15) silently replaced the button with scroll-to-bottom autoload + an 11px/#555 italic hint that was effectively invisible. Now an explicit button (blue outline, deepens on hover) is back; scroll autoload still works as a fallback' },
        ]
    },
    {
        version: '2.4.4',
        date: '2026-05-07',
        changes: [
            { zh: '【内存】跟踪 polygon 后端简化：tracking.py 加 cv2.approxPolyDP(epsilon=2px)，SAM 2 mask 顶点从 500-2000 → 30-100，~10-20× 压缩；NDJSON 流量、前端 Redux 占用、AutoSave 序列化体积同步下降。env 调控：TRACK_POLY_EPSILON_PX', en: '[Memory] Tracking polygons simplified server-side: tracking.py now applies cv2.approxPolyDP(epsilon=2px), so SAM 2 mask vertex count drops from 500-2000 to 30-100 (~10-20× compression). Cuts NDJSON bandwidth, Redux footprint, and AutoSave serialize size in lockstep. Tunable via TRACK_POLY_EPSILON_PX env' },
            { zh: '【内存】视频模式 ImageRepository LRU cap 改回固定 1000 帧（之前 frames+100 = 8298 帧 ≈ 250MB 常驻）。ImagePreview 在 LRU 淘汰后能自动 reload：检测 state.image.src===\'\' 触发 setState({image:null}) + loadImage', en: '[Memory] ImageRepository LRU cap in video mode reset to a fixed 1000 (was frames+100 = 8298 ≈ 250MB resident). ImagePreview auto-reloads after LRU eviction by detecting state.image.src===\'\' and dispatching setState({image:null}) + loadImage' },
            { zh: '【上下文】Chrome Aw-Snap (error code 5) = OOM。v2.3.13 修了 dispatch 风暴但内存基线没动；这次 v2.3.14 才动总量', en: '[Context] Chrome Aw-Snap (error code 5) = OOM. v2.3.13 reduced the dispatch storm but not the base memory footprint; v2.3.14 actually trims it' },
        ]
    },
    {
        version: '2.4.3',
        date: '2026-05-06',
        changes: [
            { zh: '【内存】SAM 2 跟踪不再 dispatch storm：每帧的 polygon 走 ObjectTrackingActions 内的合并器（Map<imgId, ImageData> + requestIdleCallback @ 50ms），700+ 帧 dispatch 从 700 → ~10-20 次单一 updateImageData，避免 8298 行虚拟列表反复 reconcile 导致浏览器崩溃。完成/取消时强制 flush 残留 polygon', en: '[Memory] SAM 2 tracking no longer triggers a dispatch storm: per-frame polygons funnel through an in-module coalescer (Map<imgId, ImageData> + requestIdleCallback @ 50ms), so a 700+-frame run drops from 700 dispatches to ~10-20 batched updateImageData calls. The 8298-row virtual thumbnail list no longer reconciles per frame. Force-flush on done/cancel so trailing polygons land' },
        ]
    },
    {
        version: '2.4.2',
        date: '2026-05-06',
        changes: [
            { zh: '【内存】AutoSaveService 加 signature-based skip：每次 save 前先算个轻量签名（图片数、各 image 的 rect/point/line/polygon 数 + polygon 顶点总和、active idx、video session、queue），与上次比对相同就跳过整个 ArrayBuffer 序列化 + IndexedDB 写入。idle 时（如跟踪完成后）从"每 60s 写 ~400MB"变成 0', en: '[Memory] AutoSaveService now uses signature-based skip: before each save, computes a cheap signature (image count, per-image label/vertex counts, active idx, video session, queue) and compares to the previous; identical → skip the entire ArrayBuffer serialize + IndexedDB write. Idle scenarios (e.g. tracking finished) drop from "~400MB IDB write every 60s" to 0' },
            { zh: '【运维】新增 start_prod.sh + npm run start:prod：vite build → vite preview 模式启动，避免 dev 模式 HMR / source map / 模块缓存随时间增长。长时间挂机或部署用这个；npm run dev 仅用于开发热更新场景', en: '[Ops] Added start_prod.sh + `npm run start:prod`: builds and serves the production bundle via vite preview, avoiding the dev-mode HMR / source-map / module-cache growth that accumulates over hours. Use this for long-running sessions or deployment; reserve `npm run dev` for active development with hot reload' },
        ]
    },
    {
        version: '2.4.1',
        date: '2026-05-06',
        changes: [
            { zh: '【内存】3 处 setInterval 加 Page Visibility 守卫，避免标签页/屏幕休眠时整夜空转：EditorTopNavigationBar (5s 拉 /load-status + /available-models)、EditorBottomNavigationBar (5s 读 localStorage)、AutoSaveService (周期序列化整个 store 写 IndexedDB)。8 小时睡眠从 ~5760 次 fetch + 数百次全 store 序列化 → 0；解决长时间挂起后浏览器崩溃', en: '[Memory] Three setIntervals now guard with Page Visibility API, skipping work while the tab or screen is asleep: EditorTopNavigationBar (5s /load-status + /available-models), EditorBottomNavigationBar (5s localStorage read), AutoSaveService (periodic full-store IndexedDB serialize). 8h idle drops from ~5760 fetches + hundreds of full-store serializes to 0; fixes browser-crashes-while-asleep' },
        ]
    },
    {
        version: '2.4.0',
        date: '2026-05-06',
        changes: [
            { zh: '【UX】拖拽视频时不再蓝染顶部工具栏：拖拽捕获层（zIndex 500）从覆盖整个 EditorWrapper 改为 top:40px 起始（避开 EditorTopNavigationBar 的 40px 高度），工具栏保留原本的 dark theme 背景', en: '[UX] Top toolbar no longer tints blue while dragging a video: the drag-capture overlay (zIndex 500) now starts at top:40px instead of covering the entire EditorWrapper, leaving EditorTopNavigationBar (40px tall) with its normal dark theme background' },
        ]
    },
    {
        version: '2.3.9',
        date: '2026-05-06',
        changes: [
            { zh: '【修复】长视频跟踪报"N frames missing on disk"：tracking.py 还留着旧 guard 校验预拆 JPEG，但 v2.3.8 已经改成 FFmpeg 切视频不需要 JPEG。长视频走 on-demand 模式没全量预拆，guard 误判 501 帧缺失就直接退出。删除 stale guard + 删除不再使用的 _list_frame_paths helper', en: '[Fix] Long-video tracking failed with "N frames missing on disk": tracking.py kept a stale pre-extracted-JPEG existence check, but v2.3.8 switched the predictor source to an FFmpeg-cut subvideo that no longer needs the JPEGs. Long videos use on-demand mode (no full pre-extract), so the guard falsely reported missing frames and aborted. Removed stale guard + unused _list_frame_paths helper' },
        ]
    },
    {
        version: '2.3.8',
        date: '2026-05-06',
        changes: [
            { zh: '【性能】SAM 2 视频跟踪改 FFmpeg 切片流程：之前 SAM2VideoPredictor 从帧 0 walk 到 end_frame 才 yield 第一帧（500 帧请求要预处理 7495 帧 ≈ 3.5 小时）；现在后端先用 FFmpeg 把视频切成 [start_frame, end_frame] 段（libx264 ultrafast，~5-15s），传切片给 predictor，预处理量从 end_frame → (end-start+1)。8298 帧视频上 [6995,7495] 区间，从 ~3.5h 降到 ~15min', en: '[Perf] SAM 2 video tracking now uses an FFmpeg-clipped subvideo: previously SAM2VideoPredictor walked frames 0..end_frame before yielding the first result (500-frame request preprocessed 7495 frames ≈ 3.5h); backend now FFmpeg-cuts the video to [start_frame, end_frame] (libx264 ultrafast, ~5-15s) and passes the clip to the predictor. Preprocessing drops from end_frame to (end-start+1). For [6995,7495] in an 8298-frame video, ~3.5h → ~15min' },
            { zh: '【正确性】bbox prompt 现在应用到正确帧：之前传完整视频时 SAM 2 把 bbox 当作 frame 0 的提示，再 propagate 到 end_frame，跟踪结果可能漂移；切片后 clip frame 0 = 绝对 start_frame，bbox 自然落在用户实际框选的那一帧上', en: '[Correctness] bbox prompt now anchored to the correct frame: passing the full video made SAM 2 treat the bbox as a prompt at frame 0 and propagate to end_frame, which could drift; clip frame 0 = absolute start_frame, so the bbox lands on the frame the user actually drew on' },
            { zh: '【UX】跟踪进度新增 clipping 阶段提示，TrackingAPIService 路由 status 消息到 onStatus 回调', en: '[UX] Tracking progress shows a clipping stage; TrackingAPIService routes status messages via onStatus callback' },
        ]
    },
    {
        version: '2.3.7',
        date: '2026-05-06',
        changes: [
            { zh: '【UX】SAM 2 跟踪进度可见：之前 SAM 2 video predictor 要先 walk 视频从帧 0 到 end_frame 把 memory bank 建好才会 yield 第一帧，看上去像"卡在 0/N"；现在后端在 predict() 调用前 emit `status: preparing`，walk 阶段每 25 帧 emit 一次心跳，前端进度文案从"目标跟踪启动中"换成"预处理中：SAM 2 视频编码 X/Y"', en: '[UX] SAM 2 tracking now shows real progress: previously the SAM 2 video predictor had to walk every frame from 0 to end_frame to build its memory bank before yielding the first result, looking like "stuck at 0/N"; backend now emits `status: preparing` before predict() and a heartbeat every 25 walked frames; frontend renders "Preprocessing: SAM 2 video encoding X/Y" instead' },
            { zh: '【已知】SAM 2 仍会 walk 整段视频从帧 0 开始（预处理 6995 帧才到 start_frame=6995），是 ultralytics SAM2VideoPredictor 的特性；后续 v2.4.0 计划用 FFmpeg 把视频切到 [start_frame, end_frame] 段再传给 predictor，把预处理量从 end_frame 降到 (end_frame - start_frame)', en: '[Known] SAM 2 still walks the full video from frame 0 (it processes 6995 frames before reaching start_frame=6995). This is an ultralytics SAM2VideoPredictor characteristic; v2.4.0 plans to FFmpeg-clip the video to [start_frame, end_frame] before passing to the predictor, reducing preprocessing from end_frame to (end_frame - start_frame)' },
        ]
    },
    {
        version: '2.3.6',
        date: '2026-05-06',
        changes: [
            { zh: '【修复】SAM 家族模型 dispatch 全错位：load_model 把完整路径传给 _create_model，prefix-check `startswith("FastSAM"/"sam2"/...)` 因路径以 / 开头永远不匹配，所有 SAM/FastSAM/MobileSAM 都被错误加载为 ultralytics.YOLO。FastSAM 推理 `bboxes` 报"not a valid YOLO argument"就是这个根因；改为按 basename 匹配', en: '[Fix] SAM-family dispatch was broken: load_model passed an absolute path into _create_model, but the `startswith("FastSAM"/"sam2"/...)` prefix-check never matched a leading `/`, so every SAM / FastSAM / MobileSAM was loaded as ultralytics.YOLO. The "FastSAM bboxes is not a valid YOLO argument" error stemmed from this. Now compares basename instead' },
            { zh: '【数据】下载完整 SAM 家族 11 个模型到 backend/models/segment/：sam_b/l, mobile_sam, sam2_t/s/b/l, sam2.1_t/s/b, FastSAM-s（共 ~3.5GB）', en: '[Data] Downloaded the full SAM family (11 models, ~3.5GB) into backend/models/segment/: sam_b/l, mobile_sam, sam2_t/s/b/l, sam2.1_t/s/b, FastSAM-s' },
        ]
    },
    {
        version: '2.3.5',
        date: '2026-05-06',
        changes: [
            { zh: '【UX】目标跟踪按钮改为条件渲染：仅当已加载 SAM 2 / SAM 3 时才出现，与智能标注按钮（仅 SAM 加载时显示）行为一致；tooltip 也去掉冗余的"需 SAM 2 / SAM 3"说明', en: '[UX] Object-tracking button now conditional: only renders when SAM 2 / SAM 3 is loaded, matching the smart-annotation button pattern; tooltip drops the redundant "needs SAM 2 / SAM 3" qualifier' },
        ]
    },
    {
        version: '2.3.4',
        date: '2026-05-06',
        changes: [
            { zh: '【UX】模型加载失败弹窗显示后端真实错误：之前不论何因都套通用文案"无法连接推理服务器/请确认 detect_server.py 已启动"，掩盖 .pt 文件损坏、torch 解压失败、HF 下载超时等具体原因；现在直接展示后端 /load-status 返回的 error 字段', en: '[UX] Model-load failure dialog now shows the real backend error: previously every failure showed the canned "cannot connect to inference server" text, masking real causes (.pt corruption, torch unzip failure, HF download timeout); now displays the backend /load-status error verbatim' },
            { zh: '【清理】已离队 1 个损坏模型 backend/yolo11x-seg.pt（42MB，正常应 119MB；torch zip central directory 缺失），重命名为 *.broken；后端 loader 不再误用，下次请求 yolo11x-seg 会从 ultralytics 自动下载新副本', en: '[Cleanup] Quarantined corrupted backend/yolo11x-seg.pt (42MB; should be 119MB; torch reported missing zip central directory), renamed to *.broken; backend loader will auto-download a fresh copy from ultralytics on next request' },
        ]
    },
    {
        version: '2.3.3',
        date: '2026-05-06',
        changes: [
            { zh: '【修复】点击长视频缩略图破图：FramePlayer 流式 storeImage 触发 LRU 淘汰，被淘汰帧 src 被清空，下次 isSelected 重渲染读到空 src 显示破图；视频元数据加载时把 cap 抬到 max(frames+100, 300)，所有缩略图常驻', en: '[Fix] Clicked long-video thumbnail showed broken-image icon: FramePlayer streaming storeImage evicted earlier frames via LRU, clearing their src; next isSelected re-render read the empty src. VideoEditor now bumps cap to max(frames+100, 300) on metadata load, keeping all thumbnails resident' },
        ]
    },
    {
        version: '2.3.2',
        date: '2026-05-06',
        changes: [
            { zh: '【修复】v2.3.0+ 长视频"页面无响应"卡死：VideoEditor 缓存重生成路径把 N 次 updateImageDataById 改成单次 bulk updateImageData，8298 帧场景下主线程从锁死 → 一次 dispatch', en: '[Fix] Long-video "page unresponsive" freeze (v2.3.0+): VideoEditor cache regeneration path replaces N updateImageDataById dispatches with a single bulk updateImageData; 8298-frame case goes from main-thread lockup to one dispatch' },
            { zh: '【性能】ImageRepository LRU cap 默认 50 → 300：视频流场景常态滑动数千帧，50 太低导致频繁 evict + revokeObjectURL 抖动主线程', en: '[Perf] ImageRepository LRU cap default 50 → 300: video scenarios scroll through thousands of frames; 50 caused frequent evict + revokeObjectURL main-thread jitter' },
        ]
    },
    {
        version: '2.3.1',
        date: '2026-05-06',
        changes: [
            { zh: '【修复】v2.3.0 长视频体验回归：PREEXTRACT_MAX_DURATION_SEC 从 60s → 600s，10 分钟内的视频回到全量预拆模式（缩略图条秒开）', en: '[Fix] v2.3.0 long-video regression: PREEXTRACT_MAX_DURATION_SEC 60s → 600s; videos under 10 minutes now use full pre-extraction (timeline thumbnails snappy again)' },
            { zh: '【性能】on-demand 模式小请求自动扩成对齐窗口：count<10 时实际拆 50 帧（按 50 倍数对齐）并整窗入 LRU，相邻 count=1 请求命中缓存，FFmpeg 子进程数 ↓50×', en: '[Perf] On-demand small-request auto-expand: count<10 fetches a 50-frame aligned window into LRU; adjacent count=1 fetches hit cache, FFmpeg subprocess count ↓50×' },
            { zh: '【性能】on-demand LRU 容量 2 → 6 个 batch（≈300 帧），随机拖动时间轴更友好', en: '[Perf] On-demand LRU capacity 2 → 6 batches (~300 frames cached); friendlier for random timeline scrubbing' },
        ]
    },
    {
        version: '2.3.0',
        date: '2026-05-05',
        changes: [
            { zh: '【性能】后端新增 /batch_detect：N 张图一次推理，固定开销摊薄', en: '[Perf] Backend /batch_detect: batched ultralytics inference for N images per request' },
            { zh: '【性能】后端新增 /detect-session NDJSON 流式视频推理：消除前后端逐帧 RTT 乒乓', en: '[Perf] Backend /detect-session NDJSON stream: eliminates per-frame RTT ping-pong' },
            { zh: '【性能】CUDA 设备分支补全（cuda > mps > cpu），推理路径全部包 torch.inference_mode()', en: '[Perf] CUDA device branch (cuda > mps > cpu); all inference paths wrapped in torch.inference_mode()' },
            { zh: '【性能】FFmpeg 拆帧参数调优：-q:v 5 -threads 0 -an -sn -pix_fmt yuvj420p（磁盘占用 ↓30~50%）', en: '[Perf] FFmpeg extraction tuning: smaller JPEGs, multi-thread, skip audio/subtitle' },
            { zh: '【性能】长视频（>60s）拆帧改 on-demand + LRU 缓存，避免一次性写出数 GB JPEG', en: '[Perf] Long video (>60s) extraction: on-demand + LRU cache; no more multi-GB JPEG dumps' },
            { zh: '【性能】v1 ZIP 解压挪 Web Worker；Redux dispatch 合并 (requestIdleCallback)，主线程不再阻塞', en: '[Perf] v1: ZIP parsing in Web Worker; Redux dispatch coalesced via requestIdleCallback' },
            { zh: '【性能】v1 图像加载分批解码 + ImageRepository LRU cap，4K 大批量内存占用大幅下降', en: '[Perf] v1: chunked image decode + ImageRepository LRU cap; large 4K batches no longer OOM' },
            { zh: '【性能】v2 移植批量检测（/batch_detect + 4路并发）+ 视频推理路径（/detect-session 流）', en: '[Perf] v2: ported batch detect (concurrency + /batch_detect) + video inference via /detect-session stream' },
            { zh: '【工程】新增 backend/models/ 目录约定 + .gitignore *.pt + 模型清单 README', en: '[Infra] New backend/models/ convention + .gitignore *.pt + model manifest README' },
        ]
    },
    {
        version: '2.2.6',
        date: '2026-04-23',
        changes: [
            { zh: '【修复】on-demand 视频模式推理卡片缩略图缺失：同步从内存 videoFrameImage 裁剪 bbox（零延迟），新增 naturalWidth > 0 校验和 "data:," 过滤防止显示破图', en: '[Fix] Inference card thumbnails missing in on-demand video mode: synchronous bbox crop from in-memory videoFrameImage (zero latency), added naturalWidth > 0 guard and "data:," filter to prevent broken image display' },
            { zh: '【修复】on-demand 视频模式单帧检测失败：0字节占位帧检测直接从后端按帧索引获取原始 blob 发送给推理 API，绕过 canvas 捕获（videoFrameImage 尺寸为 0 时 toBlob 返回 null）', en: '[Fix] Single-frame detection failure in on-demand video mode: 0-byte placeholder frames fetch raw blob from backend by frame index and send directly to inference API, bypassing canvas capture (toBlob returned null when videoFrameImage had zero dimensions)' },
            { zh: '【修复】视频帧侧边栏缩略图显示破图：blob URL 在 img.onload 内提前撤销导致 <img src> 指向已失效 URL；改为仅在加载失败时撤销', en: '[Fix] Video frame sidebar thumbnails showing broken image: blob URL was revoked in img.onload before React rendered the <img src>; now only revoked on error' },
        ]
    },
    {
        version: '2.2.5',
        date: '2026-04-23',
        changes: [
            { zh: '【性能】消除批量推理 dispatch storm：检测与分割路径的 applySingleResult() 中，fullRender() 改为仅在当前展示帧完成时触发（原：每帧一次 → 修复后：批量期间 0-1 次），大幅降低主线程压力', en: '[Perf] Eliminate batch inference dispatch storm: in both detection and segmentation applySingleResult(), fullRender() now only fires when the currently displayed frame finishes inference (was: once per frame → now: 0-1 times during a batch), dramatically reducing main-thread pressure' },
            { zh: '【性能】updateActiveLabelViewType/Type 移出热路径：原每帧 dispatch 一次改为批量开始前统一设置一次，100帧批量节省约 200 次 Redux dispatch', en: '[Perf] updateActiveLabelViewType/Type moved out of the hot path: was dispatched once per frame, now set once before the concurrency loop — saves ~200 Redux dispatches per 100-frame batch' },
            { zh: '【性能】EditorContainer 批量完成检测改为事件驱动：原 setInterval(1000ms) 轮询改为监听 batchInferenceComplete CustomEvent，消除周期性唤醒', en: "[Perf] EditorContainer batch-completion detection changed to event-driven: replaced setInterval(1000ms) polling with a 'batchInferenceComplete' CustomEvent listener, eliminating periodic wakeups" },
            { zh: '【性能】InferenceResultsView 加入 shallowEqual：避免非当前帧的推理结果写入触发不必要的 re-render', en: '[Perf] InferenceResultsView now uses shallowEqual in connect(): prevents unnecessary re-renders triggered by inference results from non-active frames' },
            { zh: '【改进】后处理分割参数按常用度重新排序：最小面积 → 抽稀 epsilon → 最大顶点数 → 膨胀半径 → 仅保留最大', en: '[Improve] Segmentation post-process params reordered by usage frequency: min area → epsilon → max points → dilate → largest only' },
            { zh: '【重命名】导出面板"YOLO 训练包"→"YOLO 训练集"（英文 "YOLO Training Pack" → "YOLO Dataset"）', en: '[Rename] Export panel "YOLO Training Pack" renamed to "YOLO Dataset"' },
            { zh: '【改进】导出标注弹窗根据实际标签类型隐藏无关 tab：仅有检测框时隐藏多边形选项，仅有多边形时隐藏检测框选项', en: '[Improve] Export popup hides irrelevant label-type tabs: polygon tab hidden when only rect labels exist, and vice versa' },
        ]
    },
    {
        version: '2.2.4',
        date: '2026-04-23',
        changes: [
            { zh: '【移除】后处理"修复自交多边形"参数：前端 UI 与后端接口全部清除，减少用户认知负担', en: '[Remove] Post-process "fix self-intersecting polygon" param: removed from both frontend UI and backend API to reduce cognitive overhead' },
            { zh: '【改进】Pipeline 三阶段默认全部不激活：去除 localStorage 持久化，每次打开弹窗均从全关状态开始，避免遗忘激活状态导致误传参数', en: '[Improve] Pipeline three stages default to all inactive: removed localStorage persistence so each popup open starts from a clean off state, preventing accidental param injection' },
            { zh: '【功能】推理结果面板支持检测与分割同时显示：同时加载检测 + 分割引擎时，面板新增"全部 / 检测 / 分割"Tab 切换，不再仅显示最后一次结果', en: '[Feature] Inference results panel now shows detection and segmentation simultaneously: when both engine types are loaded, a tab bar (All / Detection / Segmentation) appears so results from both runs are always visible' },
            { zh: '【功能】多模型后处理参数分区折叠展开：同时加载检测 + 分割引擎时，非当前激活模型对应的参数 Section 自动折叠并置灰不可交互，点击标题行可展开预览', en: '[Feature] Multi-model post-process sections collapse/expand: when both engines are loaded, the inactive model section collapses and dims automatically; click the section title to expand for preview' },
            { zh: '【改进】数值为 0 的参数标题行灰显但输入仍可交互（param-zero 样式）：区别于禁用态（param-disabled），滑块可拖动、数字框可输入，仅视觉上提示"当前无效"', en: '[Improve] Zero-value params show greyed label row (param-zero style) while keeping inputs interactive: distinct from disabled state — sliders are draggable, inputs editable, purely a visual "currently inactive" hint' },
            { zh: '【改进】分割后处理推荐默认值：polygon_epsilon=1.5 px，min_mask_area=200 px²，max_polygon_points=30，mask_dilate=1 px；版本号升至 v3 使旧缓存失效', en: '[Improve] Segmentation post-process recommended defaults: polygon_epsilon=1.5 px, min_mask_area=200 px², max_polygon_points=30, mask_dilate=1 px; cache bumped to v3 to invalidate old stored values' },
            { zh: '【改进】mask_dilate 滑动条起始值改为 1（移除 0），默认不勾选：最小膨胀像素从 1 起计，开箱即用；默认关闭以保持可选性', en: '[Improve] mask_dilate slider minimum changed to 1 (removed 0), unchecked by default: minimum dilation starts at 1 px so enabling it immediately takes effect; off by default to keep it opt-in' },
            { zh: '【改进】关闭态布尔参数（augment / agnostic_nms / retina_masks）标题行置灰，与关闭态数值参数视觉一致', en: '[Improve] Disabled boolean params (augment / agnostic_nms / retina_masks) now grey their label row, matching the visual treatment of zero-value numeric params' },
            { zh: '【改进】classes 参数空值时默认不勾选：避免发送空字符串给后端，与"留空=全部类别"语义一致', en: '[Improve] classes param defaults to unchecked when empty: prevents sending an empty string to the backend; semantically consistent with "empty = all classes"' },
            { zh: '【重命名】"调用模型"→"模型设置"，"流程参数"→"推理流程"：语义更准确，减少歧义', en: '[Rename] "Call Model" → "Model Settings", "Pipeline Params" → "Inference Pipeline": more precise labels, less ambiguity' },
        ]
    },
    {
        version: '2.2.3',
        date: '2026-04-23',
        changes: [
            { zh: '【修复】导出 zip 生成失败静默吞咽：LabelMeExporter 与 YOLOPackExporter 的 simple 模式 zip.generateAsync() 缺少 .catch()，生成失败时用户无任何提示；现均补加 .catch() 并弹出错误通知', en: '[Fix] Export zip generation failure silently swallowed: LabelMeExporter and YOLOPackExporter simple-mode zip.generateAsync() had no .catch(); failures were invisible to the user. Both now have .catch() handlers that show an error notification' },
            { zh: '【修复】COCO 导出崩溃：ImageRepository.getById() 返回 undefined 时直接访问 .width/.height 导致崩溃；现加 null 检查并跳过无图像记录', en: '[Fix] COCO export crash: accessing .width/.height on the undefined result of ImageRepository.getById() caused a runtime crash; now guarded with a null check that skips missing images' },
            { zh: '【修复】COCO 导出 JSON 损坏：labelPolygon.labelId 为 null 时用作 Map key 产生 category_id: undefined；现在 getAnnotationsComponent 中过滤掉 null labelId 的多边形', en: '[Fix] COCO export produced invalid JSON: labelPolygon.labelId can be null; using it as a map key produced category_id: undefined. Polygons with null labelId are now filtered out in getAnnotationsComponent' },
            { zh: '【修复】COCO getCOCOBbox / getCOCOArea 空多边形崩溃：直接访问 vertices[0] 在顶点数组为空时崩溃；现在两个函数均加入空数组守卫', en: '[Fix] COCO getCOCOBbox / getCOCOArea crashed on empty polygons: direct access to vertices[0] crashed when the array was empty; both functions now have an empty-array guard' },
            { zh: '【修复】COCO image/annotation ID 双重独立过滤导致结构脆弱：getImagesComponent 与 getAnnotationsComponent 各自独立过滤 imagesData，日后任一变更均可导致 image_id 错位；改为在 mapImagesDataToCOCOObject 中统一过滤后传入两个函数', en: '[Fix] COCO image/annotation double-filter fragility: getImagesComponent and getAnnotationsComponent each independently filtered imagesData, meaning any future divergence would silently misalign image_id references; now filtered once in mapImagesDataToCOCOObject and passed to both' },
            { zh: '【修复】IndexedDB transaction.onabort 未处理：quota 超限或另一标签页占用 IDB 时事务被中止但 Promise 永远不 resolve，App 卡在恢复画面；四个 IDB 操作（saveProject / loadProject / getProjectMeta / clearProject）均已补加 onabort 处理', en: '[Fix] IndexedDB transaction.onabort unhandled: when a transaction was aborted (quota exceeded, IDB occupied by another tab) the Promise never resolved, hanging the app on the restore screen forever; all four IDB operations (saveProject / loadProject / getProjectMeta / clearProject) now handle onabort' },
            { zh: '【修复】AutoSave 保存失败静默：saveProject() 返回 false 时调用方不检查，onSaveComplete 仍触发给用户"已保存"反馈，数据实际丢失；现检查返回值，失败时仅 console.warn 并跳过成功回调', en: '[Fix] AutoSave silently ignored save failures: saveProject() returning false was not checked; the onSaveComplete callback still fired giving a false "saved" signal while data was lost. Return value is now checked; on failure a console.warn is logged and the success callback is suppressed' },
            { zh: '【修复】导入弹窗取消后 lastBatchInferenceImageCount 未清零：用户取消导入后该静态字段残留非零值，下次真正推理时统计面板错误自动弹出；onReject() 中现重置为 0', en: '[Fix] lastBatchInferenceImageCount not cleared on import cancel: the static field was left non-zero after cancelling an import, causing the statistics panel to spuriously auto-open on the next real inference run; onReject() now resets it to 0' },
            { zh: '【修复】ImportLabelPopup setTimeout 500ms 竞态：全量导入时 addImageDataAction 派发后 500ms 才调 doImport 等待 Redux flush，时序在慢设备上不稳定；改为 800ms 并补注释说明无法在不重构整体导入流程的情况下完全修复', en: '[Fix] ImportLabelPopup 500ms setTimeout race: full import called doImport 500ms after addImageDataAction to wait for Redux flush, fragile on slow devices; increased to 800ms with a comment explaining that a proper fix requires refactoring the full import flow' },
            { zh: '【修复】追踪流 JSON.parse 失败静默跳过：网络中断产生畸形行时 catch { continue } 导致帧静默丢失、进度通知卡死；现检测畸形 JSON 行（以 { 开头）并触发 onError 回调', en: '[Fix] Tracking stream JSON.parse failure silently skipped frames: a network glitch producing a malformed line caused the frame to be silently dropped and the progress notification to stall forever; lines that look like JSON objects (start with {) now trigger onError instead of being silently skipped' },
            { zh: '【修复】追踪会话过期重传时 finalize() 提前调用：重传成功并发起重试前 finalize() 已删除进度通知，导致重传期间无 UI 反馈；改为重试路径中先完成 finalize 再启动新追踪，行为与之前一致但时序正确', en: '[Fix] Tracking session re-upload called finalize() before the retry started: finalize() deleted the progress notification before the re-upload completed, leaving no UI feedback during re-upload; finalize() is now called after the re-upload resolves, then startTracking fires synchronously' },
            { zh: '【修复】VGGExporter 返回类型不安全：mapPolygonToVGG / mapImageDataToVGGFileData / mapImageDataToVGG 返回类型标为非 null 但实际返回 null；三个函数返回类型均修正为 | null', en: '[Fix] VGGExporter unsafe null return types: mapPolygonToVGG / mapImageDataToVGGFileData / mapImageDataToVGG were typed as non-null but returned null; all three return types corrected to include | null' },
            { zh: '【修复】恢复后活跃图像索引越界：过滤 0 字节帧后 validStoredImages 长度可能小于原数组，storedProject.currentImageIndex 可能超出范围；现 clamp 到 [0, restoredImages.length - 1]', en: '[Fix] Active image index out of bounds after restore: filtering 0-byte frames can shorten validStoredImages below the stored currentImageIndex; the index is now clamped to [0, restoredImages.length - 1]' },
        ]
    },
    {
        version: '2.2.2',
        date: '2026-04-23',
        changes: [
            { zh: '【功能】导出默认改为完整模式（含图片），原默认为仅标注的简单模式', en: '[Feature] Export defaults to complete mode (includes images); was previously labels-only simple mode' },
            { zh: '【功能】YOLO 训练包支持重新导入平台：自动识别检测格式（5列：class cx cy w h）与分割格式（>5列：class x1 y1…）并还原为矩形框或多边形', en: '[Feature] YOLO training packs can be re-imported: auto-detects detection format (5 columns: class cx cy w h) vs segmentation format (>5 columns: class x1 y1…) and restores rects or polygons accordingly' },
            { zh: '【功能】所有下拉菜单改为自定义实现：始终朝下展开，光标为默认样式，已选项在末尾显示勾号', en: '[Feature] All dropdowns replaced with custom implementation: always open downward, default cursor, selected item marked with ✓ at end' },
            { zh: '【修复】弹窗内下拉菜单被 overflow:hidden 裁切：改用 position:fixed + getBoundingClientRect() 定位，下拉层完整显示在弹窗之上', en: '[Fix] Popup dropdowns clipped by overflow:hidden container: switched to position:fixed + getBoundingClientRect() so the dropdown renders above the popup stack' },
            { zh: '【修复】模型管理弹窗编号圆圈对齐偏移：.ModelEntry 统一预留 border-left 空间，选中项仅改变边框颜色，不再产生水平偏移', en: '[Fix] Number badge misalignment in ManageAIModelsPopup: .ModelEntry always reserves border-left space; selection only changes border color with no layout shift' },
            { zh: '【功能】分割后处理新增"修复自交多边形"开关：勾选后后端用 fillPoly→findContours 重采样轮廓消除自交（蝴蝶结形状），默认关闭以保留模型原始输出', en: '[Feature] Segmentation postprocess: new "Fix self-intersecting polygon" toggle — backend uses fillPoly→findContours to clean up bowtie artifacts; off by default to preserve raw model output' },
            { zh: '【修复】快捷键 Esc 取消标注改用标准接口：矩形引擎新增 cancelLabelCreation()，替换原有 (as any).startCreateRectPoint = null 的类型规避写法', en: '[Fix] Esc cancel-annotation now uses a proper public API: RectRenderEngine gains cancelLabelCreation(), replacing the (as any).startCreateRectPoint = null workaround' },
            { zh: '【修复】快捷键 Backspace 和 Delete 删除标签全平台兼容：原仅按系统平台注册其中一个键，现两个键均注册同一删除动作，Mac 和 Windows/Linux 均可用', en: '[Fix] Backspace and Delete both delete the active label on all platforms; previously only one key was registered per platform, so the other was silently ignored' },
            { zh: '【修复】Backspace/Delete 删除多边形和折线无效：LabelActions.deleteImageLabelById 原仅处理 POINT 和 RECT，补入 POLYGON 和 LINE 分支', en: '[Fix] Backspace/Delete failed to delete polygons and lines: LabelActions.deleteImageLabelById handled only POINT and RECT; POLYGON and LINE cases now added' },
        ]
    },
    {
        version: '2.2.1',
        date: '2026-04-23',
        changes: [
            { zh: '【修复】恢复工作对话框只在有实际可恢复图像时弹出：原逻辑 hasSettings||hasProject 导致无项目数据时仍弹窗显示 0/0；改为仅 hasProject（validImageCount>0）时弹窗，否则静默恢复设置后直接进入编辑器', en: '[Fix] Restore dialog now only appears when there is actual recoverable project data: the old hasSettings||hasProject trigger caused the dialog to appear with 0/0 when no images were saved; changed to hasProject only (validImageCount>0); if only settings exist they are restored silently and the editor opens directly' },
            { zh: '【修复】恢复对话框已标注图像分母改为 validImageCount（非零条目），原先使用 imageCount（含 0 字节占位帧）导致分母虚高；新增数据丢失橙色警告行（有效条目 < 总条目时显示）', en: '[Fix] Restore dialog annotated count denominator changed to validImageCount (non-zero entries); old imageCount was inflated by 0-byte placeholder frames. Added orange warning row when recoverable count is less than total' },
            { zh: '【功能】导出 zip 新增根目录子文件夹：所有格式（YOLO / VOC / CSV / VGG / COCO / LabelMe）导出 zip 内容统一包在与 zip 同名的子文件夹中，解压后结构更清晰', en: '[Feature] Export zips now wrap all contents in a root subfolder named after the zip file for all formats (YOLO / VOC / CSV / VGG / COCO / LabelMe)' },
            { zh: '【功能】LabelMe / YOLO 导出新增简单/完整模式切换：简单模式仅导出标注 JSON，完整模式同时打包图片', en: '[Feature] LabelMe and YOLO export add a simple/complete mode toggle: simple exports JSON only, complete bundles images alongside' },
            { zh: '【修复】LabelMe 完整导出 zip 内图片路径：改为 flat 结构（图片与 JSON 同层），与 LabelMe 工具标准导入路径一致', en: '[Fix] LabelMe full-export zip layout: images moved to the same level as JSONs (flat) instead of images/ subfolder' },
            { zh: '【修复】重新导入 LabelMe 标注包后推理结果面板与统计面板为空：LabelMeImporter 导入的矩形/多边形/mask 均标记 isCreatedByAI: true；ImportLabelPopup.onAccept 导入完成后统计已标注图像数写入 EditorModel.lastBatchInferenceImageCount 触发统计面板自动弹出', en: '[Fix] Re-importing a LabelMe zip left inference and statistics panels empty: LabelMeImporter marks all imported rects/polygons/masks with isCreatedByAI: true; ImportLabelPopup.onAccept writes annotated count to EditorModel.lastBatchInferenceImageCount to auto-open the statistics panel' },
            { zh: '【功能】VGG JSON 多边形导入：ImporterSpecData 接入 VGGImporter，导入列表新增 VGG JSON 选项', en: '[Feature] VGG JSON polygon import: VGGImporter wired into ImporterSpecData; VGG JSON appears in the import format list' },
            { zh: '【UI】操作菜单顺序：上传文件移至编辑标签前，符合先上传再标注的操作流', en: '[UI] Actions menu reordered: Upload Files moved before Edit Labels to match the natural upload-first workflow' },
            { zh: '【UI】标签下拉菜单：最近使用标签置顶并用灰色分隔线隔开；计数格式改为 (x/y, z%) 浅灰显示', en: '[UI] Label dropdown: most recently used label pinned to top with a gray divider; count format changed to (x/y, z%) in light gray' },
            { zh: '【UI】模型下拉菜单排序固定：自定义 → 检测 → 分割，与工具栏顺序对齐', en: '[UI] Model dropdown order fixed: Custom → Detection → Segmentation' },
        ]
    },
    {
        version: '2.2.0',
        date: '2026-04-22',
        changes: [
            { zh: '【功能】SAM2 / SAM3 视频目标追踪：后端新增 /track 流式 NDJSON 端点，基于 SAM2VideoPredictor / SAM3VideoPredictor 在已上传视频 session 上逐帧生成分割 mask；前端新增追踪弹窗（起止帧 + 模型自动检测）、TrackingAPIService（fetch ReadableStream 客户端）、追踪进度通知；session 过期时自动重新上传视频并重试', en: '[Feature] SAM2 / SAM3 video object tracking: backend /track endpoint streams per-frame segmentation masks via NDJSON (SAM2VideoPredictor / SAM3VideoPredictor on the uploaded video session); frontend adds a tracking popup (start/end frame + auto model detection), TrackingAPIService fetch-based streaming client, and progress notifications; expired sessions are automatically re-uploaded and retried' },
            { zh: '【功能】检测推理参数扩展：detection.py 新增 augment、agnostic_nms、classes（类别过滤）、min_bbox_area（面积下限过滤）、bbox_padding（框外扩像素）参数，routes /detect 一并透传', en: '[Feature] Detection inference params expanded: detection.py gains augment, agnostic_nms, classes filter, min_bbox_area threshold, and bbox_padding expansion; all forwarded through the /detect route' },
            { zh: '【修复】SAM3 模型无法加载：segmentation.py 和 _model_type.py 的 SAM 前缀列表均缺少 sam3，导致 SAM3 被当作 YOLO 模型加载并失败；两处 _SAM_PREFIXES 均已补入 sam3', en: '[Fix] SAM3 model failed to load: both segmentation.py and _model_type.py _SAM_PREFIXES lists were missing the sam3 prefix, causing SAM3 to be dispatched to the YOLO constructor and fail; sam3 added to both lists' },
            { zh: '【功能】LabelMe JSON 导入：支持 rectangle / polygon / mask 三种 shape_type；mask 类型以 bounding box 作为矩形导入；多 JSON 文件自动识别为 LabelMe 格式，单 JSON 文件 async peek 区分 LabelMe vs COCO；zip 文件名以 labelme_ 开头时强制 LabelMe 模式', en: '[Feature] LabelMe JSON import: handles rectangle, polygon, and mask shape_type; mask is imported as bounding-box rect; multiple JSON files auto-detected as LabelMe, single JSON async-peeked for shapes+imagePath keys to distinguish LabelMe from COCO; zip files prefixed labelme_ force LabelMe mode' },
            { zh: '【功能】LabelMe JSON 导出：矩形 / 多边形模式均新增 LabelMe JSON (.zip) 导出选项；简单模式仅导出标注 JSON，完整模式同时导出图片；视频 preExtractedFrames 模式直接用内存帧，sessionId 按需模式从后端批量拉取有标注的帧（相邻帧合并请求），无法获取全分辨率时报错提示，不降级保存缩略图', en: '[Export] LabelMe JSON export added for both rect and polygon label types; simple mode exports annotation JSON only, complete mode bundles images; preExtractedFrames are used directly, sessionId on-demand mode batch-fetches annotated frames from the backend (merging nearby indices into one request); fails with an error notification if full-resolution images are unavailable — never falls back to thumbnails' },
            { zh: '【修复】完整导出（Complete）模式图片 0kb：on-demand 视频模式下 imageData.fileData 为空占位（new File([], ...)），导出时改为按需从后端拉取真实 JPEG 帧；YOLO / VOC / CSV / VGG / COCO 五种导出格式均已修复', en: '[Fix] Complete-mode export produced 0-byte images: in on-demand video mode imageData.fileData is an empty placeholder (new File([], ...)); export now fetches the real JPEG frame from the backend on demand. Fixed for all five formats: YOLO, VOC, CSV, VGG, COCO' },
            { zh: '【修复】完整导出 YOLO/VOC/CSV 坐标归一化错误：ImageRepository 存储的是 150px 缩略图，用其宽高归一化时坐标全部 clamp 到 1.0 导致所有框堆在右边缘；改为优先使用 activeVideo.videoSize（真实分辨率）归一化，普通图片项目不受影响', en: '[Fix] YOLO/VOC/CSV coordinate normalization was wrong in video mode: ImageRepository stores 150-px thumbnails, dividing rect coordinates by thumbnail dimensions clamped all values to 1.0 and collapsed every box to the right edge; normalization now uses activeVideo.videoSize (real resolution) with a fallback to ImageRepository for image-mode projects' },
            { zh: '【UI】恢复工作弹窗重设计：信息区改为 label/value 左右对齐紧凑列表（深色背景块 + 分隔线），按钮色改为低饱和暗色调（暗红/暗绿底 + 浅色文字），整体宽度收窄至 320px', en: '[UI] Restore-work dialog redesign: info section rewritten as compact label/value rows (dark inset card with dividers); button colors toned down to muted dark-red / dark-green with light text; overall width narrowed to 320 px' },
            { zh: '【UI】恢复工作弹窗信息行：第三行由"图像/帧总数"改为"已标注图像 x/y 张"或"已标注帧 x/y 帧"（按项目类型区分单位）；labelCount 统计逻辑修复——原来错误统计的是标签类别数，现改为遍历 IndexedDB 中有实际标注（labelRects/labelPolygons/labelPoints/labelLines 非空）的图像数', en: '[UI] Restore dialog third row changed from total count to "annotated images x/y" or "annotated frames x/y" (unit adapts to project type); labelCount calculation fixed — it was incorrectly returning the number of label class names; now counts images that have at least one annotation (non-empty labelRects / labelPolygons / labelPoints / labelLines) in IndexedDB' },
            { zh: '【修复】"重新开始"不清除旧数据：handleRestoreCancel 中 clearAllStoredData() 被注释，导致点"重新开始"后旧数据留在 IndexedDB，每次刷新仍弹恢复提示；现已启用清除', en: '[Fix] "Start fresh" no longer clears stored data: clearAllStoredData() in handleRestoreCancel was commented out, leaving stale IndexedDB data and causing the restore prompt to reappear on every refresh; the call is now active' },
            { zh: '【修复】恢复失败静默进入空编辑器：原 setShowRestorePrompt(false) 在 try 块顶部立即调用，导致 catch 里的错误 UI 永远不可见；现改为成功后才关闭对话框，失败时保持对话框并显示错误信息 + "清除数据重新开始"按钮', en: '[Fix] Restore failure silently entered an empty editor: setShowRestorePrompt(false) was called at the top of the try block, making the error UI in the catch branch permanently invisible; dialog now stays open on failure with an error message and a "clear data & start fresh" button' },
            { zh: '【功能】恢复进度逐步反馈：恢复过程从"正在加载..."改为分步文字（正在恢复标签信息 → 队列数据 → 图像数据 N 张 → 视频帧 → 恢复完成）', en: '[Feature] Step-by-step restore progress: loading screen now updates through each restore phase (label names → queue → images N → video frames → done) instead of a static "loading…"' },
            { zh: '【优化】IndexedDB 新增 getProjectMeta() 轻量查询：hasStoredProject() 原先加载完整项目记录（含所有帧 ArrayBuffer）仅判断是否存在；现改用 getProjectMeta() 读取同一条记录后只返回 imageCount / labelCount / isVideoProject / lastModified，不保留帧数据引用，大幅减少大型视频项目恢复对话框初始化时的内存压力', en: '[Perf] IndexedDB getProjectMeta() lightweight read: hasStoredProject() used to load the full project record (all frame ArrayBuffers) just to check existence; now uses getProjectMeta() which reads the same record but only extracts imageCount / labelCount / isVideoProject / lastModified and immediately releases the frame data, significantly reducing memory pressure on restore-dialog init for large video projects' },
            { zh: '【修复】ImagePreview / Editor 图像加载错误静默吞咽：handleLoadImageError 原为空函数，加载失败时 isLoading 标志位永远不复位、控制台无任何日志；现已补充错误日志（文件名 + 大小 + 错误对象）并在出错时重置 isLoading=false 允许重试', en: '[Fix] ImagePreview / Editor swallowed image load errors silently: handleLoadImageError was a no-op, leaving isLoading stuck true and printing nothing to console on failure; now logs filename + size + error object and resets isLoading=false to allow retry' },
            { zh: '【修复】恢复工作后图像全部转圈无法加载：按需加载视频模式下未被缓存的帧以 new File([], name) 空占位存储，AutoSaveService 将其序列化为 0 字节 ArrayBuffer 写入 IndexedDB；恢复时 FileUtil.loadImage 对 0 字节 File 静默失败导致所有缩略图转圈。修复：AutoSaveService 保存时过滤掉 byteLength=0 的条目，IndexedDBManager.getProjectMeta() 新增 validImageCount 字段（仅计非零条目），ProjectRestoreService 恢复时跳过 0 字节帧，恢复对话框新增"可恢复帧 X/Y"行（有效条目数 < 总数时才显示），usecount=0 时橙色高亮警告', en: '[Fix] All thumbnails spinning after restore: in on-demand video mode, frames not yet in memory are stored as new File([], name) empty placeholders; AutoSaveService serialized them as 0-byte ArrayBuffers into IndexedDB, and FileUtil.loadImage silently fails on 0-byte Files, leaving all thumbnails in the loading spinner state forever. Fix: AutoSaveService filters out byteLength=0 entries before writing; IndexedDBManager.getProjectMeta() gains a validImageCount field counting only non-zero entries; ProjectRestoreService skips 0-byte frames on restore; the restore dialog shows a "recoverable frames X/Y" row (only when validImageCount differs from imageCount), highlighted in orange when zero' },
        ]
    },
    {
        version: '2.1.9',
        date: '2026-04-19',
        changes: [
            { zh: '【功能】大视频 init 重构：保持"解析中 X%" overlay 直到前 MIN_AHEAD 帧（fps×20 秒，25fps=500）缩略图全部就绪再一次性掀开画面；实现并发预拉所有 batch + 前 20 帧全并发 fast-prefetch + 后续 8-worker pool；VideoEditor 的 FramePlayer 加 key={activeVideo.id} 强制 remount，避免 isLoaded/initDoneRef 等状态跨视频泄漏导致二次上传不显示 overlay', en: '[Feature] Large-video init overhaul: the "解析中 X%" overlay now stays up until all MIN_AHEAD (fps×20s, 500 @ 25fps) thumbnails are ready, then reveals the editor in one shot; init prewarms every batch in parallel, runs 20 concurrent fast-prefetch calls for the first 20 frames, then an 8-worker pool for the rest. VideoEditor attaches key={activeVideo.id} to FramePlayer to force a remount, preventing isLoaded/initDoneRef state from leaking across videos and suppressing the overlay on re-upload' },
            { zh: '【功能】P3 缩略图兜底：init 完成后，滑动窗口 MIN_AHEAD 窗口满且未播放时从头扫描未投递缩略图的帧补齐，侧栏缩略图最终可覆盖整个视频；thumbnailDoneRef 追踪已 onFrameReady 的帧号，p3CursorRef 推进避免重扫', en: '[Feature] P3 background thumbnail sweep: once the MIN_AHEAD window is full and video is paused, a background worker fills thumbnails from frame 0 to end so the sidebar eventually covers the whole video; thumbnailDoneRef tracks delivered frames and p3CursorRef advances past attempts to avoid re-scans' },
            { zh: '【功能】缓冲角标：FramePlayer 右下角新增"缓冲 X/500"角标实时显示 MIN_AHEAD 窗口内已缓存连续帧数；ahead=0（seek 到未缓存段）时升级为半透明全屏 overlay', en: '[Feature] Buffer badge: FramePlayer shows a "缓冲 X/500" pill in the bottom-right reflecting the consecutive frames cached ahead of the playhead; when ahead=0 (seeked into an uncached region) it promotes to a dim full-screen overlay' },
            { zh: '【修复】后端 session 失效处理：FrameExtractorService 新增 SessionExpiredError，404 响应自动抛出；FramePlayer 捕获后设 sessionExpiredRef、终止 maintain 循环并显示"视频会话已失效"提示；不再无限 404 重试', en: '[Fix] Backend session expiry handling: FrameExtractorService throws a new SessionExpiredError on 404 responses; FramePlayer catches it, sets sessionExpiredRef, stops the maintain loop and shows a "视频会话已失效" notice instead of retrying forever' },
            { zh: '【修复】pendingBatchRef 清理的 .finally 衍生链未处理 rejection 导致 Uncaught (in promise) SessionExpiredError：改用 .then(ok, err) 双分支清理，吞掉拒绝', en: '[Fix] pendingBatchRef cleanup via .finally left rejections uncaught (Uncaught in promise SessionExpiredError); rewritten as .then(ok, err) with both branches deleting the entry so rejections are swallowed' },
            { zh: '【UI】顶部模型下拉菜单重写：按 4 类别（自定义分割 / 内置分割 / 自定义检测 / 内置检测）每类最多 1 个代表；当前 slot 内容优先，slot 被自定义占用时从 /available-models 取对应类型的内置代表补位；custom 类别仅显示当前 slot 里的那个，不扫描磁盘上历史上传；统一补全 .pt 后缀避免 <option value> 与 activeModelName 失配', en: '[UI] Top model dropdown rewritten: up to one entry per category (custom-seg / builtin-seg / custom-det / builtin-det). Current slot content takes priority; when the slot is occupied by a custom model, a built-in representative is pulled from /available-models. Custom categories only show the model currently in a slot (no scanning of historical uploads). Names are normalized with .pt suffix so <option value> matches the slot-returned activeModelName' },
            { zh: '【UI】顶部工具栏按钮顺序：查看标签（眼睛）与智能标注（十字光标）交换位置，视觉流左→右为"显示/隐藏 → 智能标注 → 橡皮擦"', en: '[UI] Toolbar button order: the toggle-labels eye button and smart-annotation crosshair are swapped so left-to-right flow is "show/hide → smart annotation → eraser"' },
            { zh: '【修复】推理结果面板对分割模型显示空卡片：InferenceResultsView 的 displayResults 增加 labelPolygons 兜底 —— 当 imageSegmentationResults Map 未命中当前 imageId（智能标注 / dispatch 丢失 / 切帧后 imageId 变更）时，改从 labelPolygons.filter(isCreatedByAI) 重建展示结构（含 bbox / Shoelace 面积），保证"画布上有 AI 多边形就一定有卡片"', en: '[Fix] Inference result panel showed no cards for segmentation: InferenceResultsView.displayResults gains a labelPolygons fallback — when imageSegmentationResults has no entry for the current imageId (smart annotation / missed dispatch / imageId changed after frame swap) it rebuilds display entries from labelPolygons.filter(isCreatedByAI) with bbox + Shoelace area, so any AI polygon on the canvas guarantees a result card' },
        ]
    },
    {
        version: '2.1.8',
        date: '2026-04-19',
        changes: [
            { zh: '【功能】快捷键撤销 Ctrl+Z / Cmd+Z：通过 Redux 中间件维护 imagesData / labels 的深拷贝快照栈（上限 100），覆盖矩形 / 多边形 / 点 / 折线的创建、删除、修改；因 render engine 历史上在 dispatch 前直接 mutate store，中间件缓存上一次 dispatch 后的 pristine 深拷贝，下一次 mutation 到来时推该缓存，避免被已发生的 mutation 污染', en: '[Feature] Undo hotkey Ctrl+Z / Cmd+Z: Redux middleware keeps a deep-cloned snapshot stack of imagesData/labels (cap 100) covering create/delete/modify for rect/polygon/point/line. Because render engines historically mutate store state before dispatching, the middleware caches a pristine deep clone after every dispatch and pushes that cached clone on the next mutation — bypassing the already-dirty live state' },
            { zh: '【修复】视频放大播放 mask 渲染错位（2.1.7 修了画布 resize 但视频层 object-fit 仍在原始尺寸）：VideoPrimaryRenderEngine 播放时不再 early-return，改用 EditorModel.videoFrameImage（FramePlayer 每帧已更新）作为底图源，Editor 画布同时绘制视频帧 + masks，两者共用同一套 zoom 坐标变换', en: '[Fix] Mask misalignment when playing zoomed video (2.1.7 fixed canvas resize but the video layer itself stayed at original size via object-fit): VideoPrimaryRenderEngine no longer early-returns during playback — instead uses EditorModel.videoFrameImage (updated per-frame by FramePlayer) as the image source, so the Editor canvas draws both the video frame and masks under the same zoomed coordinate transform' },
            { zh: '【重构】橡皮擦工具改为 2 状态按钮（整体擦除 / 局部擦除），首次点击进入整体擦除（单击删整个多边形或矩形），再次点击切到局部擦除（拖拽笔刷擦顶点）；替换 v2.1.7 的画布双击检测；新增 Redux eraserFineMode、ERASER / ERASER_FINE cursor，切换其他工具时无条件关闭橡皮擦', en: '[Refactor] Eraser tool is now a 2-state toolbar button (global erase / fine erase): first click activates global erase (single click deletes an entire polygon/rect), clicking again toggles to fine erase (drag brush to remove vertices). Replaces the canvas double-click detection from v2.1.7. Adds Redux eraserFineMode flag + ERASER / ERASER_FINE cursor styles; switching to any other tool unconditionally exits eraser' },
            { zh: '【修复】fast_ffmpeg_mode 按需取帧用错帧：跳帧推理时循环变量 i 与 frameQueue[i].frameIdx 不同（i 是队列下标，frameIdx 是视频中的真实帧号），原代码按 i 批量取帧导致取错帧；现改为按 frameIdx 逐帧 fetch，进度提示同时显示 frame 编号', en: '[Fix] fast_ffmpeg_mode on-demand frame fetch fetched wrong frames when frame-skip > 1: loop index i (queue position) was used as the video frame number instead of frameQueue[i].frameIdx (actual frame). Now fetches by real frameIdx one frame at a time; progress notification displays the frame number' },
            { zh: '【修复】推理完成后强制切到 RECT 工具会打断橡皮擦操作：检测单帧 / 批量推理的工具切换加 eraserMode 守卫，橡皮擦激活时只切 view type 不切 active tool', en: '[Fix] Inference completion forcibly switched to RECT tool, interrupting eraser use: detection single-frame / batch paths now guard the tool switch behind an eraserMode check — when eraser is active only the view type is switched, leaving the active tool untouched' },
            { zh: '【修复】PolygonRenderEngine.eraserClick 与其他方法对齐，优先读 EditorModel.playbackImageData，使视频模式下擦除命中当前显示帧的多边形', en: '[Fix] PolygonRenderEngine.eraserClick now prefers EditorModel.playbackImageData (matching sibling methods), so erasing in video mode hits polygons on the displayed frame' },
        ]
    },
    {
        version: '2.1.7',
        date: '2026-04-18',
        changes: [
            { zh: '【功能】橡皮擦工具：新增双击多边形进入精细擦除模式，按住拖拽笔刷（半径 20px）逐顶点删除；单击仍删整个多边形；点击多边形外退出精细模式', en: '[Feature] Eraser tool: double-click a polygon to enter fine-erase mode — hold and drag the brush (radius 20 px) to remove vertices one by one; single click still deletes the whole polygon; clicking outside exits fine mode' },
            { zh: '【UI】Pipeline 后处理弹窗：根据当前选中模型类型自动设置初始勾选状态——选分割模型时检测参数默认不勾选，选检测模型时分割参数默认不勾选，避免误配置', en: '[UI] Pipeline post-processing popup: initial checkbox states now reflect the selected model type — detection params unchecked when a segmentation model is selected, segmentation params unchecked for detection models, preventing misconfiguration' },
            { zh: '【架构】Redux aimodels store 新增 selectedModelTask 字段（内存态，不持久化），EditorTopNavigationBar 在模型切换时同步更新，供 pipeline popup 读取', en: '[Architecture] Redux aimodels store adds selectedModelTask field (in-memory, not persisted); EditorTopNavigationBar syncs it on model switch for pipeline popups to consume' },
            { zh: '【修复】批量推理跳过规则：检测/分割批量模式在视频模式下之前不会跳过已推理帧，现统一跳过；同时分割单图推理之前误走批量过滤导致已推理图像被拒绝，现改为显式 isBatch 标志路由——批量跳过、单图允许重复推理', en: '[Fix] Batch inference skip rules: detection/segmentation batch in video mode previously did not skip already-inferred frames (now skipped uniformly); single-image segmentation was incorrectly filtered by the batch path (now routed via explicit isBatch flag — batch skips, single allows re-inference)' },
            { zh: '【修复】视频放大后播放时 mask 渲染错位：播放时 Editor.componentDidUpdate 会 early-return 跳过 canvas resize，zoom>1 时 canvas 尺寸与缩放后 viewport 失同步；在 VideoEditor.handleVideoTimeUpdate 的 fullRender 前补上 ViewPortActions.resizeViewPortContent()。手动跳帧不走播放分支所以不受影响', en: '[Fix] Masks mis-rendered when playing a zoomed video: during playback Editor.componentDidUpdate early-returns and skips canvas resize, so when zoom>1 the canvas size drifts out of sync with the scaled viewport. Added ViewPortActions.resizeViewPortContent() before fullRender in VideoEditor.handleVideoTimeUpdate. Manual frame stepping did not hit the playback path so it was unaffected' },
        ]
    },
    {
        version: '2.1.6',
        date: '2026-04-16',
        changes: [
            { zh: '【修复】跳帧时分割 mask 对不上当前帧：PolygonRenderEngine 未使用 playbackImageData，导致多边形渲染滞后于实际显示帧', en: '[Fix] Segmentation mask misaligned when jumping frames: PolygonRenderEngine did not use playbackImageData, causing polygon rendering to lag behind the displayed frame' },
            { zh: '【UI】侧边栏标签重命名：队列→文件队列、推理→推理结果、统计→统计情况', en: '[UI] Sidebar tab labels renamed: Queue→File Queue, Inference→Inference Results, Statistics→Statistics Info' },
            { zh: '【UI】侧边栏按钮间距优化，避免文字紧贴', en: '[UI] Improved sidebar button spacing to prevent labels touching' },
            { zh: '【UI】自定义模型弹窗隐藏下载按钮，YOLO 模型弹窗隐藏上传按钮', en: '[UI] Custom model popup hides download button; YOLO model popup hides upload button' },
            { zh: '【修复】快捷键在点击图片列表/标签面板后失灵：LEFT_NAVBAR / RIGHT_NAVBAR context 现在继承 EDITOR 快捷键，不再清空 actions', en: '[Fix] Hotkeys stopped working after clicking image list or labels panel: LEFT_NAVBAR / RIGHT_NAVBAR contexts now inherit EDITOR hotkeys instead of clearing actions' },
            { zh: '【修复】restoreCtx 空栈防护：防止快速开关弹窗导致 actions 被清空', en: '[Fix] restoreCtx empty stack guard: prevent rapid popup open/close from wiping all hotkeys' },
            { zh: '【修复】分割模型 mask 面积计算：Shoelace 公式从多边形顶点计算真实面积（之前硬编码为 0）', en: '[Fix] Segmentation mask area calculation: Shoelace formula computes real polygon area (was hardcoded to 0)' },
            { zh: '【UI】推理卡片：分割模型隐藏"大小"只显示"面积"，检测模型显示"大小"隐藏"面积"', en: '[UI] Inference cards: segmentation models hide "size" and show "area"; detection models show "size" and hide "area"' },
            { zh: '【UI】名称精简：文件队列→队列、推理结果→推理、结果统计→统计、对象ID→对象', en: '[UI] Shorter labels: File Queue→Queue, Inference Results→Inference, Statistics Info→Statistics, Object ID→Object' },
            { zh: '【UI】统计面板去掉"需要2张以上图像"限制，1张图也能看统计', en: '[UI] Statistics panel removes 2+ image requirement — works with single image' },
            { zh: '【UI】去掉推理空状态的"绘制标注框后将自动触发AI推理"提示', en: '[UI] Removed "draw annotation boxes to trigger AI inference" hint from empty inference view' },
            { zh: '【UI】快捷键说明更新：拆分箭头键说明（切换图片 vs 移动画布），新增 Ctrl+A 全选和 Ctrl+S 保存', en: '[UI] Keyboard shortcuts popup updated: split arrow key descriptions (switch image vs pan canvas), added Ctrl+A select all and Ctrl+S save' },
        ]
    },
    {
        version: '2.1.5',
        date: '2026-04-16',
        changes: [
            { zh: '【严重】修复自定义分割模型推理完全不可用：后端缺少 /segment 端点（前端 SegmentationAPIDetector 调用 → 404）；现已添加完整的 /segment 端点，支持 YOLO-seg mask 提取 + SAM point/bbox prompt', en: '[Critical] Fix custom segmentation model inference completely broken: backend had no /segment endpoint (frontend SegmentationAPIDetector called → 404). Added full /segment endpoint with YOLO-seg mask extraction + SAM point/bbox prompt support' },
            { zh: '【严重】/segment 端点添加 retina_masks=True：没有此参数时 masks[i].xy 返回模型内部分辨率坐标（如 640×640），前端把它当原图坐标叠加导致 mask 缩成一团', en: '[Critical] /segment endpoint now uses retina_masks=True: without it, masks[i].xy returns coordinates at model internal resolution (e.g. 640×640) instead of original image dimensions, causing masks to shrink into a tiny cluster on the canvas' },
            { zh: '【修复】后端 /health 新增 model_task（当前模型的 task 类型）和 model_tasks（所有已加载模型的 task 字典），前端不再纯靠文件名正则猜测模型类型，任意命名的自定义分割模型都能被正确识别', en: '[Fix] Backend /health now returns model_task (active model\'s task type) and model_tasks (task dict for all loaded models). Frontend no longer guesses model type by filename regex — arbitrarily named custom segmentation models are now correctly identified' },
            { zh: '【修复】后端 /upload 返回 service 字段（"detection" / "segmentation"），基于 model.task 属性精确判断；前端 LoadDetectionModelPopup 已有读取 data.service 的逻辑，之前因后端不返回而永远默认 detection', en: '[Fix] Backend /upload now returns service field ("detection" / "segmentation") based on model.task attribute. Frontend LoadDetectionModelPopup already reads data.service but previously always defaulted to detection because backend never sent it' },
            { zh: '【修复】DetectionAPIDetector.syncFromActiveModel 和 SegmentationAPIDetector.syncFromActiveModel 现在接受 custom modelType，之前 custom 类型的模型会被直接拒绝推理', en: '[Fix] DetectionAPIDetector.syncFromActiveModel and SegmentationAPIDetector.syncFromActiveModel now accept custom modelType — previously custom-typed models were rejected outright' },
            { zh: '【优化】模型下拉显示 [seg]/[cls]/[pose] 后缀标识模型类型，方便用户一眼辨认', en: '[Enhancement] Model dropdown shows [seg]/[cls]/[pose] suffix to identify model type at a glance' },
            { zh: '【优化】后端 /upload 支持 .onnx 格式上传（之前只允许 .pt）', en: '[Enhancement] Backend /upload now accepts .onnx format (previously .pt only)' },
            { zh: '【UI】模型引擎弹窗 UI 重构 + 推理结果删除同步修复 + 多处 UI 细节优化', en: '[UI] Model engine popup UI overhaul + inference result deletion sync fix + multiple UI detail improvements' },
        ]
    },
    {
        version: '2.1.4',
        date: '2026-04-15',
        changes: [
            { zh: '【严重】修复局域网跨机访问时上传模型 / 推理 / 取帧全部失败的 bug:前端 6 处硬编码了 `http://localhost:8000`,导致浏览器在 .151 访问部署在 .205 的前端时,所有后端请求被浏览器解析为 .151 自己的 8000 端口(localhost 永远是浏览器所在机),跨机必然失败', en: '[Critical] Fix all cross-machine LAN failures (upload model / inference / frame extraction): the frontend had 6 hardcoded `http://localhost:8000` URLs. When a browser on machine B loaded the frontend served from machine A, every fetch resolved "localhost" to B itself (browsers always resolve localhost to the local machine), so nothing worked across machines' },
            { zh: '【修复】新增 src/utils/DefaultBackendUrl.ts 共享 helper:getDefaultBackendBase() / getDefaultBackendUrl(path) 通过 window.location.hostname + protocol 派生 backend 地址,本地开发得 localhost:8000,局域网得 192.168.x.y:8000,生产得当前域名:8000', en: '[Fix] New shared helper src/utils/DefaultBackendUrl.ts: getDefaultBackendBase() / getDefaultBackendUrl(path) derive the backend URL from window.location.hostname + protocol. Local dev → localhost:8000, LAN → 192.168.x.y:8000, prod → same hostname:8000' },
            { zh: '【修复】替换 6 处 localhost 硬编码:DetectionAPIDetector config / SegmentationAPIDetector config / CallModelPopup _serverUrl + derivedBaseUrl 兜底 / ModelEnginePopup 预填 URL + modelType 切换时同步 / ConnectInferenceServerPopup localYoloUrl / FrameExtractorService API_BASE', en: '[Fix] Replaced 6 localhost hardcodes: DetectionAPIDetector config, SegmentationAPIDetector config, CallModelPopup _serverUrl + derivedBaseUrl fallback, ModelEnginePopup prefilled URL + modelType switch sync, ConnectInferenceServerPopup localYoloUrl, FrameExtractorService API_BASE' },
            { zh: '【模型引擎】切换 modelType 时同步更新 URL 路径:detection → /detect,segmentation → /segment,省得用户自己改', en: '[Model Engine] When switching modelType, URL path auto-updates: detection → /detect, segmentation → /segment — saves the user a manual edit' },
            { zh: '【deploy/start.sh】banner 显示 LAN IP:原来只显示 127.0.0.1 误导用户,现在通过 ifconfig 取第一个非回环 IPv4 地址,同时显示 0.0.0.0 和 LAN IP 两个 URL,方便跨机访问', en: '[deploy/start.sh] Banner now shows LAN IP: used to display misleading 127.0.0.1; now extracts the first non-loopback IPv4 via ifconfig and shows both 0.0.0.0 and the LAN IP for cross-machine access' },
            { zh: '【无后端变更】backend CORS 已经是 allow_origins=["*"] + uvicorn bind 0.0.0.0,跨机访问在网络层本就畅通,问题纯粹是前端 URL', en: '[No backend changes] Backend CORS is already allow_origins=["*"] and uvicorn binds 0.0.0.0, so cross-machine access was always fine at the network layer — the bug was purely in frontend URL derivation' },
        ]
    },
    {
        version: '2.1.3',
        date: '2026-04-15',
        changes: [
            { zh: '【推理下拉】EditorTopNavigationBar 的推理下拉同步应用引擎门控:「检测模型」option 只在已注册检测引擎时显示,「分割模型」option 只在已注册分割引擎时显示。「自定义」option 永远显示。从「CallModelPopup 已做的 section gating」把同样的逻辑延伸到顶栏下拉', en: '[Inference dropdown] EditorTopNavigationBar\'s inference dropdown now applies the same engine gating as CallModelPopup: "Detection" option visible only when a detection engine is registered, "Segmentation" option only when a segmentation engine is registered. "Custom" is always visible. Extends the v2.1.2 CallModelPopup section gate to the top-bar dropdown for consistency' },
            { zh: '【推理下拉】新增 mode 守卫 useEffect:当前选中的 inferenceMode 对应的 option 被隐藏时(用户删掉引擎 / 切换项目等)自动回落到 "both"("自定义"),避免 React warning + 防止「推理」按钮跑到一个不存在的 slot', en: '[Inference dropdown] Added a mode-guard useEffect: when the currently selected inferenceMode\'s option is hidden (user deleted the engine, switched projects, etc.) the state falls back to "both" ("Custom"), preventing React warnings and stopping the Infer button from dispatching to a non-existent slot' },
            { zh: '【推理下拉】mapStateToProps 新增 hasDetectionEngine / hasSegmentationEngine 两个标志,通过 AIModelsSelector.hasModelsOfType(state, type) 读取,和 CallModelPopup 的 hasDetectionEngine / hasSegmentationEngine 保持一致的真值来源', en: '[Inference dropdown] mapStateToProps adds hasDetectionEngine / hasSegmentationEngine flags (via AIModelsSelector.hasModelsOfType), using the same single source of truth as CallModelPopup\'s section gate' },
        ]
    },
    {
        version: '2.1.2',
        date: '2026-04-15',
        changes: [
            { zh: '【调用模型】section 按「已注册的模型引擎类型」动态显隐：接入检测引擎才显示「检测模型」，接入分割引擎才显示「分割模型」，什么都没接入就只剩「自定义」(永远显示)。从"全家桶式"菜单变成"我能跑什么"的聚焦视图', en: '[Call Model] Sections are now gated by registered engine types: "Detection Models" appears only when a detection engine is registered, "Segmentation Models" only when a segmentation engine is registered. No engines → only the "Custom" section (always visible). The popup shifts from a full catalog to a focused "what can I actually run" view' },
            { zh: '【调用模型】移除冗余的「外部模型引擎」section 和「推理服务地址」输入框 —— 引擎的管理/选择由「模型引擎」+「AI 模型管理」两个 popup 负责；base URL 改为从 active 引擎自动推导 (stripInferenceSuffix 剥掉 /detect 或 /segment 后缀)，兜底 localhost:8000', en: '[Call Model] Removed redundant "External Engines" section and "Inference Server URL" text field — engine management/selection is owned by the Model Engine + Manage AI Models popups. Base URL is now auto-derived from the active engine via stripInferenceSuffix (peels /detect or /segment), falling back to localhost:8000' },
            { zh: '【调用模型】CallModelPopup -60 行：清掉 renderEngineOption / isEngineId / engineIdFromRow / openAddEnginePopup / StyledTextField / setActiveAIModelAction / serverUrl state 等引擎选择相关的死代码', en: '[Call Model] CallModelPopup -60 lines: removed renderEngineOption / isEngineId / engineIdFromRow / openAddEnginePopup / StyledTextField / setActiveAIModelAction / serverUrl state — engine-selection dead code gone' },
            { zh: '【模型引擎】新增引擎弹窗打开时默认预填本地检测接口：模型地址 = http://localhost:8000/detect，模型类型 = 目标检测，一键就能接入本地 backend', en: '[Model Engine] The Add Engine popup now pre-fills the local detection endpoint: URL = http://localhost:8000/detect, type = Detection — one click to register the local backend' },
            { zh: '【模型引擎】按模型类型预置默认 API key：检测默认 "123456"，分割默认 "baosight@ABC123!"。切换 modelType 时 apiKey 自动更新到对应默认值，用户可再手改覆盖', en: '[Model Engine] Default API key pre-filled per model type: detection defaults to "123456", segmentation to "baosight@ABC123!". Switching modelType auto-updates apiKey to the matching default; user can still override manually' },
            { zh: '【模型引擎】默认引擎名称按类型生成：目标检测 → "检测模型"，目标分割 → "分割模型" (英文对应 "Detection Model" / "Segmentation Model")，不再用 "AI Model 4/15/2026" 这种带日期的自动名字。用户可在「AI 模型管理」里改名', en: '[Model Engine] Default engine name now generated by type: Detection → "检测模型" / "Detection Model", Segmentation → "分割模型" / "Segmentation Model". No longer uses the stale "AI Model 4/15/2026"-style autoname. Users can rename in the Manage AI Models popup' },
            { zh: '【模型引擎】modelType state 类型从 string 收窄为 "detection" | "segmentation"，TypeScript 帮忙校验只能在合法值间切换；disableAcceptButton 相应移除 modelType === "" 的冗余检查', en: '[Model Engine] modelType state narrowed from string to "detection" | "segmentation" union; TypeScript enforces valid values; disableAcceptButton drops the now-unreachable modelType === "" check' },
        ]
    },
    {
        version: '2.1.1',
        date: '2026-04-15',
        changes: [
            { zh: '【后端】新增 app/services/_model_type.py：按文件名把每个模型打上 custom / detection / segmentation 类型标签（前缀 yolov?\\d+/rtdetr 走内置 detection；带 -seg 或 SAM 家族走 segmentation；其余视为用户上传的 custom）。list_local_models 也抽到这里，detection.py 和 segmentation.py 共用一套目录扫描逻辑，避免 /available-models 每次来回走两遍 ~/.cache/ultralytics', en: '[Backend] New app/services/_model_type.py: classifies each model filename into custom / detection / segmentation. Built-in yolov?\\d+ / rtdetr → detection; -seg suffix or SAM family → segmentation; everything else → user-uploaded custom. list_local_models is also shared from here so detection.py and segmentation.py no longer walk ~/.cache/ultralytics twice per /available-models request' },
            { zh: '【后端】/health 新增 model_type / segmentation_model_type 字段，/load-status 新增 model_type，/available-models 返回形状从 [name, ...] 改为 [{name, type}, ...]（单向升级，前端兼容读取两种形状），/upload 和 /load-model 的响应也一并回显 model_type', en: '[Backend] /health now returns model_type and segmentation_model_type; /load-status returns model_type; /available-models shape upgraded from [name, ...] to [{name, type}, ...] (frontend gracefully handles both); /upload and /load-model responses echo the classified model_type' },
            { zh: '【后端】detection.py / segmentation.py 各自增加 _model_type 模块级常量 + get_model_type() 访问器，load_model 成功后用 classify_model 更新。segmentation.py 顺手补上了之前缺失的 list_available_models()，和 detection 对齐', en: '[Backend] detection.py and segmentation.py each track a _model_type module-level state plus a get_model_type() accessor; load_model updates it via classify_model on success. segmentation.py also gains the previously missing list_available_models() for symmetry with detection.py' },
            { zh: '【前端】本地模型 → 调用模型 全面改名：i18n 键 popups.loadModel → popups.callModel / modelManagement.localModels → modelManagement.callModels；中文 "本地模型" → "调用模型"，英文 "Local Model" → "Call Model"；PopupWindowType.LOAD_AI_MODEL → CALL_MODEL；目录 LoadModelPopup/ → CallModelPopup/ 含文件、class、scss 类名一起搬；所有 10 个消费者路径同步更新', en: '[Frontend] 本地模型 → 调用模型 full rename: i18n key popups.loadModel → popups.callModel, modelManagement.localModels → modelManagement.callModels, zh "本地模型" → "调用模型", en "Local Model" → "Call Model"; PopupWindowType.LOAD_AI_MODEL → CALL_MODEL; directory LoadModelPopup/ → CallModelPopup/ with files, class, scss selectors, and all 10 consumer paths updated together' },
            { zh: '【前端】远程模型 → 模型引擎 全面改名：i18n 键 popups.integrateModel → popups.modelEngine / modelManagement.remoteModels → modelManagement.modelEngines；中文 "远程模型" → "模型引擎"，英文 "Remote Model" → "Model Engine"；PopupWindowType.INTEGRATE_AI_MODEL → MODEL_ENGINE；目录 IntegrateModelPopup/ → ModelEnginePopup/', en: '[Frontend] 远程模型 → 模型引擎 full rename: i18n key popups.integrateModel → popups.modelEngine, modelManagement.remoteModels → modelManagement.modelEngines, zh "远程模型" → "模型引擎", en "Remote Model" → "Model Engine"; PopupWindowType.INTEGRATE_AI_MODEL → MODEL_ENGINE; directory IntegrateModelPopup/ → ModelEnginePopup/' },
            { zh: '【前端】AIModel.modelType 联合类型加入 "custom"：原本 "detection" | "segmentation"，现在 "custom" | "detection" | "segmentation"。AIModelsSelector 的重载签名从硬编码的 literal "detection" 改成 AIModel["modelType"] —— getModelsByType 现在能按三种 type 正确过滤', en: '[Frontend] AIModel.modelType union widened to include "custom": was "detection" | "segmentation", now "custom" | "detection" | "segmentation". AIModelsSelector overload signatures moved from hardcoded literal "detection" to AIModel["modelType"] so getModelsByType can filter across all three types' },
            { zh: '【前端】EditorTopNavigationBar 推理下拉：不再用前端正则猜 custom vs built-in，直接读 /health 返回的 model_type 字段。新增 detModelType / segModelType 状态 + 兜底类型化判断；下拉三个选项 自定义 / 检测模型 / 分割模型 按后端权威类型分组显示；customLabel 计算和 runInference "both" 分支路由保持一致语义', en: '[Frontend] EditorTopNavigationBar inference dropdown: dropped the frontend regex heuristic, now trusts /health model_type / segmentation_model_type fields. Added detModelType / segModelType state; three dropdown options 自定义 / 检测模型 / 分割模型 label drawn from backend-authoritative types; customLabel + runInference "both" routing semantics unchanged' },
            { zh: '【前端】ManageAIModelsPopup /available-models 请求改为兼容两种形状：backend v2.1.1+ 的 [{name, type}] 或 legacy 的 [name]，运行时 typeof 判断自动取 name', en: '[Frontend] ManageAIModelsPopup /available-models fetch now handles both v2.1.1+ typed shape [{name, type}] and legacy bare string[]; extracts name at runtime' },
        ]
    },
    {
        version: '2.1.0',
        date: '2026-04-15',
        changes: [
            { zh: '【清理】命名审计遗留项集中清理 release，无新功能、无架构改动，全部是小范围机械重命名 + 低风险 bug 修复，为下一代 v3 重写做准备（高风险的 LabelType.ALL 拆分、SegmentationResult 统一、EditorModel 拆分等继续保留到 v3）', en: '[Cleanup] Batch cleanup of remaining naming-audit findings — no new features, no architectural changes. Low-risk mechanical renames + standalone bug fixes paving the way for the v3 rewrite. (High-risk items — LabelType.ALL split, SegmentationResult unification, EditorModel split — remain deferred to v3.)' },
            { zh: 'src/logic/context/ → src/logic/hotkey/ 目录重命名：这四个文件 (BaseContext / ContextManager / EditorContext / PopupContext) 实际上是键盘快捷键分发器，不是 React Context 系统，目录名一直和 ContextType 枚举与 React.useContext 混淆；纯目录移动 + 10 处 import 路径更新，类名和 ContextType 枚举未动', en: 'Rename src/logic/context/ → src/logic/hotkey/: the four files (BaseContext / ContextManager / EditorContext / PopupContext) are a keyboard-shortcut dispatcher, not a React-context system; the old directory name collided with the ContextType enum and React.useContext. Pure directory move + 10 import-path updates; class names and the ContextType enum left untouched' },
            { zh: 'ImageActions 导航方法 get* → goTo*：getPreviousImage / getNextImage / getImageByIndex 都是 void 返回的导航动作而不是访问器，名字误导；改名为 goToPreviousImage / goToNextImage / goToImageByIndex 并同步所有调用点', en: 'ImageActions navigators renamed get* → goTo*: getPreviousImage / getNextImage / getImageByIndex are void-returning navigation actions, not accessors; renamed to goToPreviousImage / goToNextImage / goToImageByIndex with all call sites updated' },
            { zh: 'LoadYOLOv5ModelPopup → LoadDetectionModelPopup：此弹窗自 v2.0.3 起已处理 YOLOv8+/SAM/FastSAM/MobileSAM/统一检测后端，YOLOv5 这个名字早就不准了；目录、组件、class、PopupWindowType 枚举成员、调用点全部同步', en: 'LoadYOLOv5ModelPopup → LoadDetectionModelPopup: since v2.0.3 this popup handles YOLOv8+/SAM/FastSAM/MobileSAM/unified detection backend — the YOLOv5 name has been stale. Directory, component, class, PopupWindowType enum member, and all call sites updated together' },
            { zh: 'LoadMoreImagesPopup → LoadMoreMediaPopup：自 v2.0.0 起此弹窗也接收视频文件，不再只是图片', en: 'LoadMoreImagesPopup → LoadMoreMediaPopup: since v2.0.0 this popup also accepts video files, not just images' },
            { zh: 'logic/export 下的文件名一致性：LineLabelExport.ts / PointLabelsExport.ts / TagLabelsExport.ts → *LabelsExporter.ts，和 RectLabelsExporter.ts 对齐；用 git mv 保留历史', en: 'logic/export filename consistency: LineLabelExport.ts / PointLabelsExport.ts / TagLabelsExport.ts → *LabelsExporter.ts aligned with RectLabelsExporter.ts; renames done via git mv to preserve history' },
            { zh: '修复 PointLabelsExporter 的复制粘贴 bug：方法名 wrapRectLabelsIntoCSV 和局部变量 labelRectsString 都是从 RectLabelsExporter 里粘过来的，底层逻辑其实是对的 (读 labelPoints 和 point.x/y)，只是名字错了；已改为 wrapPointLabelsIntoCSV / labelPointsString', en: 'Fix PointLabelsExporter copy-paste bug: method name wrapRectLabelsIntoCSV and local labelRectsString were pasted from RectLabelsExporter — the underlying logic is correct (reads labelPoints and point.x/y) but the names were wrong; now wrapPointLabelsIntoCSV / labelPointsString' },
            { zh: '修复 ExporterUtil 导出文件名时间戳用 moment hh (12 小时无 AM/PM) 导致 12 小时间隔文件名冲突；改为 HH (24 小时)', en: 'Fix ExporterUtil timestamp using moment "hh" (12-hour without AM/PM), causing 12h-apart filename collisions; now uses "HH" (24-hour)' },
            { zh: '修复 VirtualListUtil.calculateAnchorPoints 的行列错位：原本 x 坐标用 rowCount * horizontalMargin + columnCount * childSize.width，x 轴位移错误地按行号而不是列号计算；已修', en: 'Fix VirtualListUtil.calculateAnchorPoints row/column swap: x was computed as rowCount * horizontalMargin + columnCount * childSize.width — x-axis travel was wrongly indexed by row; fixed' },
            { zh: '修复 NotificationsData.ts 的 type ExportFormatDataMap 复制粘贴命名错误 → 改为 NotificationDataMap', en: 'Fix NotificationsData.ts type name ExportFormatDataMap (copy-paste residue) → NotificationDataMap' },
            { zh: '修复 IndexedDBManager.getStorageInfo 的 available 字段实际存放的是 estimate.quota (总配额) 而不是剩余可用空间：改名为 quota 和 Storage API 语义对齐', en: 'Fix IndexedDBManager.getStorageInfo: the "available" field actually held estimate.quota (total quota), not remaining space; renamed to "quota" to match Storage API semantics' },
            { zh: '修复 AIStateStorageManager 的类型签名撒谎：声明 imageAIStates 是 object map 但持久化时 Array.from(map.entries())，类型和磁盘实际形状不一致；改为 Array<[string, ImageAIState]>，load 路径已兼容两种历史格式，现有用户数据不受影响', en: 'Fix AIStateStorageManager type lying: declared imageAIStates as an object map but persisted it as Array.from(map.entries()) — type and on-disk shape mismatched. Now Array<[string, ImageAIState]>; load path already handles both legacy formats so existing user data is preserved' },
            { zh: '存储管理器版本号常量 1.11.0-alpha → 2.1.0：AIModelsStorageManager / IndexedDBManager / AutoSaveService 三个文件里都是纯 metadata 字符串，不触发实际 schema 迁移 (真正的 DB_VERSION=1 未动)', en: 'Storage manager version literal 1.11.0-alpha → 2.1.0 in AIModelsStorageManager / IndexedDBManager / AutoSaveService (pure metadata string, does not trigger any schema migration; actual DB_VERSION=1 is unchanged)' },
            { zh: '删除 ImageRepository 里声明但从未使用的缓存相关常量 MAX_CACHE_FILES / MAX_CACHE_SIZE_MB / BYTES_PER_PIXEL 和 lastAccessed 字段 (LRU 只是设想，从未实现)', en: 'Remove ImageRepository declared-but-unused cache constants MAX_CACHE_FILES / MAX_CACHE_SIZE_MB / BYTES_PER_PIXEL and the lastAccessed field (LRU was aspirational, never implemented)' },
            { zh: '删除 LabelUtil 中注释掉的 createAILabelName 死代码', en: 'Remove commented-out createAILabelName dead code in LabelUtil' },
            { zh: '扩展 AIModel 枚举：原本只有 YOLO_V5_OBJECT_DETECTION / SSD_OBJECT_DETECTION / POSE_DETECTION 三个 2019 年的旧成员；新增 DETECTION_API / SEGMENTATION_API / SAM / SAM_2 / FAST_SAM / MOBILE_SAM 反映 v2.0.3–v2.0.8 接入的模型。枚举目前仅为术语统一未在运行时分发 (运行时模型注册是 v3 工作)', en: 'Expand AIModel enum: previously only YOLO_V5_OBJECT_DETECTION / SSD_OBJECT_DETECTION / POSE_DETECTION (2019-era members); added DETECTION_API / SEGMENTATION_API / SAM / SAM_2 / FAST_SAM / MOBILE_SAM reflecting the models wired in v2.0.3–v2.0.8. Enum is currently terminology-only and not yet used in runtime dispatch (runtime model registry is v3 work)' },
            { zh: 'FrameExtractorService.extractFrames() → openSession()：旧方法名声称提取帧但实际只是打开后端 FFmpeg session 并返回 {frames: [], sessionId, ...}，frames: [] 字段是死的；真正的帧是 fetchFrameRange 按需取。改名并删除 frames 字段，JSDoc 同步更新', en: 'FrameExtractorService.extractFrames() → openSession(): the old name claimed to extract frames but actually just opens a backend FFmpeg session and returns {frames: [], sessionId, ...} — the frames: [] field was dead; real frames are fetched on demand via fetchFrameRange. Renamed and dropped the dead field; JSDoc updated' },
            { zh: '【说明】以下命名审计发现审计时已失效或属于 v3 范围，v2.1.0 未动：AISSD/AIYOLO/AIRoboflow/AIPose 四个 legacy action 文件经过二次核验仍被 AIActions.detect() 在运行时分发调用 (审计原报告来自更激进的 worktree 分支)，不能删；isVisitedBy{Model} 字段仍是 ImageData 的必需字段，删除需要连带改 store 类型和 reducer，归入 v3', en: '[Note] The following audit findings were either stale or belong to v3 scope and were not touched in v2.1.0: the four legacy AISSD/AIYOLO/AIRoboflow/AIPose action files are still dispatched at runtime by AIActions.detect() (the original audit ran on more aggressive worktree branches) and cannot be deleted; the isVisitedBy{Model} fields remain required on ImageData and removing them would require store-type + reducer changes — deferred to v3' },
        ]
    },
    {
        version: '2.0.9',
        date: '2026-04-15',
        changes: [
            { zh: '【修复】命名审计发现的一批潜在 bug 集中修复，无新功能、无重命名、无架构改动', en: '[Fix] Batch fix of latent bugs surfaced by the naming audit — no new features, no renames, no architectural changes' },
            { zh: '修复 ImageActions.setActiveLabelOnActiveImage 硬编码 labelNames[1].id：快捷键 Alt/Ctrl+0~9 切换当前激活 label 时除了 1 号都是错的，现在按 labelIndex 正确取', en: 'Fix ImageActions.setActiveLabelOnActiveImage hardcoded labelNames[1].id — the Alt/Ctrl+0~9 hotkeys for switching the active label were broken for every index except 1; now correctly uses labelIndex' },
            { zh: '修复 LabelActions.removeLabelNames 比对和清空的是 shape.id 而不是 labelId：删除某个类别后所有形状的 id 被错误置空，等价于删除形状；现在正确清空 labelId 引用；顺便补上 labelLines 分支（原本漏了线段类型）', en: 'Fix LabelActions.removeLabelNames comparing/clearing shape.id instead of labelId — deleting a label class blanked out the shape identity instead of the class reference, effectively destroying the shapes; now correctly clears labelId. Also covers labelLines (line shapes were previously skipped)' },
            { zh: '修复 COCOImporter.import 多文件输入缺 early return：用户选多个 JSON 时触发 onFailure 后仍继续读 filesData[0]，现在正确终止', en: 'Fix COCOImporter.import missing early return on multi-file input — when the user selected multiple JSONs, onFailure fired but the reader still continued to read filesData[0]; now bails out correctly' },
            { zh: '修复 VOCImporter 不检查 DOMParser 的 <parsererror> 节点：格式错误的 XML 不会抛异常而是返回带 <parsererror> 的文档，导致解析失败静默通过；现在显式检查', en: 'Fix VOCImporter not detecting DOMParser <parsererror> — malformed XML does not throw, it returns a document containing a <parsererror> element, so parse failures slipped through silently; now explicitly checked' },
            { zh: '修复 YOLOLabelsReadingError.name 复制粘贴错误（写成了 YOLOLabelsLoadingError），导致错误派发根据 name 判断时失效', en: 'Fix YOLOLabelsReadingError.name copy-paste typo (was set to "YOLOLabelsLoadingError"), which broke error dispatch keyed on name' },
            { zh: '修复 XMLSanitizerUtil.sanitize 转义顺序和 /g 标志：原实现先转 < 再转 &，把已经生成的 &lt; 里的 & 又转义成 &amp;lt; 造成二次转义；且缺 /g 只替换首个匹配；现在先转 &，所有规则加全局标志', en: 'Fix XMLSanitizerUtil.sanitize escape order and missing /g flags: previously escaped < before &, so the & in &lt; got escaped again into &amp;lt; (double escape); also only the first match was replaced due to missing /g; now escapes & first and uses global flags throughout' },
            { zh: '修复 PlatformUtil.isSafari 对 Chrome/Chromium/Android 返回 true：Chrome UA 字符串包含 "Safari"，子串匹配命中假阳性；现在排除 chrome/chromium/android', en: 'Fix PlatformUtil.isSafari false positive on Chrome/Chromium/Android — Chrome\'s UA string contains "Safari" so substring match hit a false positive; now excludes chrome/chromium/android' },
            { zh: '修复 DatasetSplitUtil.split 用 sort(() => Math.random() - 0.5) 洗牌：该方法不是均匀洗牌，会造成 train/val/test 拆分偏置；改为标准 Fisher-Yates', en: 'Fix DatasetSplitUtil.split biased shuffle — sort((a,b) => Math.random() - 0.5) is not a uniform shuffle and skewed the train/val/test split; now uses standard Fisher-Yates' },
            { zh: '修复 ContextManager.restoreCtx 在 contextHistory 为空时仍然 pop 并用 undefined 调用 updateCtx，静默把 actions 置空导致所有快捷键失效；现在加空栈保护', en: 'Fix ContextManager.restoreCtx popping an empty history and calling updateCtx(undefined), which silently wiped the actions list and disabled all hotkeys; now guards the empty stack' },
            { zh: '修复 EditorTopNavigationBar.mapStateToProps 把整个 Redux root state 以 aiModels 这个名字传成 prop：不仅名字误导，React.memo 引用比较会每次 dispatch 都触发重渲染，且内部 useMemo([aiModels]) 依赖失效；现在改为在 mapStateToProps 里直接计算 hasDetectionModel 布尔值', en: 'Fix EditorTopNavigationBar.mapStateToProps leaking the entire Redux root state as an "aiModels" prop — not only a misleading name, but React.memo reference-compared it and re-rendered on every dispatch, and the inner useMemo([aiModels]) never memoized; now computes the hasDetectionModel boolean directly in mapStateToProps' },
            { zh: '修复推理模式下拉的 "both" 选项显示为「自定义 / Custom」：实际行为是「先检测再分割」，文案改为「检测+分割 / Detect + Segment」', en: 'Fix inference-mode dropdown: the "both" option was labelled "自定义 / Custom" but actually runs detection followed by segmentation; relabelled to "检测+分割 / Detect + Segment"' },
            { zh: '【说明】DirectionUtil.convertDirectionToVector 的 y 轴是数学空间（y 向上），不是屏幕空间；ArrowUp/Down 的调用方 (EditorContext) 故意传反向 Direction 来补偿。行为未改，仅加注释澄清约定', en: '[Note] DirectionUtil.convertDirectionToVector uses math-space y (up is +1), not screen-space — the ArrowUp/Down callers in EditorContext intentionally pass the opposite Direction to compensate. Behavior unchanged; added a comment clarifying the convention' },
            { zh: '【背景】同时产出一份 16 切片的代码命名审计报告 (docs/audit/)，把剩余架构债 (SegmentationResult 一词多义、LabelType.ALL 含义过载、两代 AI action 共存、isVisitedBy{Model} 硬编码、弹窗字符串键、EditorModel 单例混乱等) 归档到 v3 设计文档，不在 v2 动', en: '[Context] Also produced a 16-slice naming audit (docs/audit/) cataloguing remaining architectural drift (SegmentationResult overloaded, LabelType.ALL conflated, two generations of AI actions co-existing, isVisitedBy{Model} hardcoded, popup string keys, EditorModel singleton sprawl, etc.). Those are parked for v3 and not touched in v2' },
        ]
    },
    {
        version: '2.0.8',
        date: '2026-04-15',
        changes: [
            { zh: '【严重】修复后端推理通道顺序错误：PIL → np.array 得到 RGB，但 ultralytics 8.x LoadPilAndNumpy 的 NumPy 分支「按 BGR 原样保留不翻转」，随后 BasePredictor.preprocess 再无条件 ::-1 BGR→RGB flip，结果模型看到的是 BGR 而不是 RGB，R/B 通道互换。所有检测/分割模型的结果都偏离用 cv2 加载文件路径的参考实现。现在后端改用 cv2.imdecode 直出 BGR numpy，与 ultralytics 文件路径加载行为完全一致', en: '[Critical] Fix backend inference channel-order bug: PIL → np.array produces RGB, but ultralytics 8.x LoadPilAndNumpy\'s NumPy branch keeps it "as-is assuming BGR", then BasePredictor.preprocess unconditionally does ::-1 BGR→RGB flip — so the model saw BGR instead of RGB, with R/B channels swapped. All detection/segmentation results diverged from the reference path (cv2 load from file). Backend now uses cv2.imdecode to produce BGR numpy directly, matching ultralytics\' file-path loader exactly' },
            { zh: '左侧栏标签 tab 和顶部工具栏彻底解耦：左侧 查看全部/检测标签/分割标签 = 视图过滤器 (activeLabelViewType)，决定侧栏列表和画布渲染显示哪类标签；顶部 查看所有标签/绘制矩形框/绘制多边形/智能标注 = 编辑工具 (activeLabelType)，决定画布鼠标行为', en: 'Left-sidebar label tabs fully decoupled from the top toolbar: sidebar 查看全部/检测标签/分割标签 = view filter (activeLabelViewType) deciding what\'s shown in the sidebar list and on the canvas; top toolbar 查看所有标签/绘制矩形框/绘制多边形/智能标注 = editing tool (activeLabelType) deciding canvas mouse behaviour' },
            { zh: 'AllLabelsRenderEngine.render 按 activeLabelViewType 过滤画什么：RECT 视图只画矩形框，POLYGON 视图只画分割 mask，ALL 视图都画。解决智能标注激活后切到检测视图却仍看到分割 mask 泄漏的问题', en: 'AllLabelsRenderEngine.render filters drawing by activeLabelViewType: RECT view draws only rects, POLYGON view draws only masks, ALL view draws both. Fixes the issue where after smart-annotation you switched to detection view but still saw segmentation masks leaking through' },
            { zh: '批量推理（全图检测 / 全图分割）自动切视图时同步 activeLabelType：智能标注未激活时 view 和 tool 一起切，渲染引擎也一并 swap，不再出现 labelType/viewType 不一致导致的画面泄漏', en: 'Batch inference (full-image detection / segmentation) now syncs activeLabelType alongside activeLabelViewType when auto-switching view: when smart annotation is off, view and tool swap together so the render engine follows, eliminating leakage caused by labelType/viewType divergence' },
            { zh: '侧栏 tab 点击行为区分智能标注状态：智能标注激活时只切视图过滤器（工具保持智能标注），未激活时同时切视图 + 工具（检测标签→绘制矩形框、分割标签→绘制多边形、查看全部→ALL 手拖模式）', en: 'Sidebar tab click is now smart-annotation aware: while active, it only changes the view filter (tool stays at Smart Annotation); while inactive, it syncs tool to view (检测标签 → draw rect, 分割标签 → draw polygon, 查看全部 → ALL hand-pan)' },
            { zh: '智能标注关闭时工具跟随当前侧栏视图落地：用户在分割视图里关掉就变成绘制多边形，在检测视图里关掉就变成绘制矩形框，不再用记忆的激活前工具', en: 'Deactivating Smart Annotation now lands on the tool matching the current sidebar view: exiting in the polygon view → draw polygon, exiting in the detection view → draw rect; no longer restores the pre-activation tool' },
            { zh: '顶部工具栏 onToolClick 只改 activeLabelType，不再顺带改 activeLabelViewType（改动方向单向）；点击任一工具会关闭智能标注，三者互斥', en: 'Top toolbar onToolClick now only updates activeLabelType (no longer touches activeLabelViewType); clicking any tool deactivates Smart Annotation, making the three tools mutually exclusive' },
            { zh: '智能标注激活 → 推理下拉自动切到「分割整图」；取消 → 自动切回「检测整图」。推理按钮按当前工具天然适配', en: 'Activating Smart Annotation auto-switches the inference dropdown to "Full Segmentation"; deactivating switches it back to "Full Detection" — the 推理 button naturally matches the current tool' },
            { zh: '智能标注连续交互路径 (source="smart") 不再每次点击都自动抢走视图：用户在 检测标签 视图里点智能标注不会被拽回 分割标签。批量推理 (source="batch") 保留一次性视图切换', en: 'Smart annotation interactive path (source="smart") no longer hijacks the sidebar view on every click — clicking a point while in 检测标签 no longer yanks you back to 分割标签. Batch inference (source="batch") still one-shot switches view' },
            { zh: 'LabelsToolkit (侧栏组件) 清理：移除不再使用的 updateActiveLabelType 依赖，新增 smartAnnotationActive state 映射，headerClickHandler 仅在非智能标注时才同步工具', en: 'LabelsToolkit sidebar component cleanup: removed unused updateActiveLabelType dependency, added smartAnnotationActive state mapping, headerClickHandler only syncs tool when not in smart annotation' },
        ]
    },
    {
        version: '2.0.7',
        date: '2026-04-15',
        changes: [
            { zh: '修复 FastSAM 模型加载失败 ("FastSAM-x.pt is not a supported SAM model")：ultralytics 的 SAM() 类不接受 FastSAM 权重，需要单独的 FastSAM() 类。后端 _create_model 现在按前缀分流：FastSAM-* → FastSAM()，sam_/sam2/mobile_sam → SAM()，其他 → YOLO()', en: 'Fix FastSAM model loading failure ("FastSAM-x.pt is not a supported SAM model"): ultralytics\' SAM() class does not accept FastSAM weights — it has a dedicated FastSAM() class. Backend _create_model now dispatches by prefix: FastSAM-* → FastSAM(), sam_/sam2/mobile_sam → SAM(), others → YOLO()' },
            { zh: '_is_sam_family() 同时识别 SAM 家族和 FastSAM 家族两套前缀，所有 prompt 路径 (point / bbox / 自动) 对 FastSAM 同样生效', en: '_is_sam_family() now recognises both SAM and FastSAM prefix families, so all prompt paths (point / bbox / automatic) work for FastSAM as well' },
            { zh: '修复 FastSAM 智能标注遇到边界坐标时 HTTP 500 ("index N is out of bounds for dimension X with size N")：ultralytics FastSAM 的 point/bbox prompt 路径用 mask[y,x] 做过滤但没 clip 坐标，前端浮点→整数偶尔命中正好等于 W 或 H 的 off-by-one 像素直接抛 IndexError。后端 segment() 现在在调模型前先把 point/bbox clip 到 [0, W-1] × [0, H-1]', en: 'Fix FastSAM smart-annotation HTTP 500 at edge coordinates ("index N is out of bounds for dimension X with size N"): ultralytics FastSAM\'s prompt path indexes mask[y,x] without clipping, and frontend float→int rounding occasionally lands exactly on W or H, hitting IndexError. Backend segment() now clips point/bbox to [0, W-1] × [0, H-1] before calling the model' },
            { zh: '澄清 FastSAM 工作原理：不同于 SAM (真 prompt-driven transformer)，FastSAM 先跑 segment-everything 再用 prompt 过滤包含它的 mask，点不落在分割对象上会返回 0 结果，是 FastSAM 本身的设计 (不是 bug)。推荐交互式点击用 mobile_sam.pt / sam2.1_b.pt', en: 'Clarify FastSAM semantics: unlike SAM (true prompt-driven transformer), FastSAM runs segment-everything first and filters masks by prompt — a point not on any segmented object returns 0 results (FastSAM by design, not a bug). Interactive clicking is best served by mobile_sam.pt / sam2.1_b.pt' },
        ]
    },
    {
        version: '2.0.6',
        date: '2026-04-15',
        changes: [
            { zh: '「查看所有标签」视图改为 hand 拖拽平移模式：鼠标显示手型光标，按下拖动平移画布 (ViewPortHelper 接管 mouseDown/Move/Up)', en: '"View all labels" now enters hand/pan mode: cursor shows a grab hand, mouse drag pans the canvas via ViewPortHelper' },
            { zh: '切换标签 tab 时自动重置 cursor 到 DEFAULT，避免从 ALL 视图切过来时 hand 光标残留让用户以为无法编辑', en: 'Switching label tabs now resets the cursor to DEFAULT, so the hand cursor from the ALL view no longer lingers and confuses users into thinking editing is disabled' },
            { zh: '绘制矩形框 / 绘制多边形 / 智能标注 三者完全互斥：点击任一 tab 会自动停用其他两个，确保用户意图明确', en: 'Draw rect / draw polygon / smart annotation are fully mutually exclusive: clicking any of the three deactivates the others so the active mode is never ambiguous' },
            { zh: '智能标注 tab 在非 SAM 模式下切换到「分割」tab 会关闭智能标注并回到多边形编辑模式；关闭智能标注时把 activeLabelType 同步到当前 viewType，避免引擎错位', en: 'Exiting smart annotation via a tab click now correctly switches the drawing engine to match the current sidebar view (e.g. polygon editor after clicking 分割 tab)' },
            { zh: '智能标注点击容差：起止点位移小于 5px 视为点击 → 发单点 prompt；更大位移才发 bbox prompt。避免手抖产生 1×0 的退化 bbox 让 SAM 返回空结果', en: 'Smart annotation click-vs-drag tolerance: <5px movement is treated as a click (point prompt), larger movement as a drag (bbox prompt). Prevents degenerate 1×0 boxes from mouse jitter that SAM returns no mask for' },
            { zh: '智能标注 pending bbox 指示器改为「半透明白色填充 + 白色描边」一起闪烁，不再只是描边', en: 'Pending bbox indicator now fills with a translucent white AND strokes the outline — both blink together instead of stroke-only' },
            { zh: '「显示/隐藏标签」按钮重构为真·全局开关：隐藏时矩形框和多边形一起消失（包括 AI 生成和手动创建的）；默认可见状态改为 true（reducer lazy-init + 各 RenderEngine 的 fallback 统一）', en: 'Show/Hide Labels toggle refactored into a true global switch: hiding removes both rects and polygons (AI + manual). Default visibility state flipped to true across reducer lazy-init and all render engine fallbacks' },
            { zh: '修复 RectRenderEngine 的 ALL 分支忽略 segmentationLabelsVisible 的 bug（切到其他视图再切回隐藏状态会失效）', en: 'Fix: RectRenderEngine\'s ALL-view branch previously ignored segmentationLabelsVisible, making the Hide toggle leak polygons in ALL mode' },
            { zh: '修复 ALL 视图下多边形填充变深的问题：之前 RectRenderEngine 的 ALL 分支和 AllLabelsRenderEngine 的 polygonEngine 都画了一次多边形，两层 0.2 α 叠加成 0.36。现在只由 polygonEngine.drawExistingLabels 画一次', en: 'Fix darker polygon fill in ALL view: previously both RectRenderEngine\'s ALL branch and AllLabelsRenderEngine\'s polygonEngine drew polygons, stacking 0.2α into ~0.36α. Now polygonEngine.drawExistingLabels is the single source' },
            { zh: '修复 ALL 视图启用 hand 光标引起的 Maximum update depth 无限渲染循环：新增 RectRenderEngine.drawExistingRects 纯绘制方法，AllLabelsRenderEngine 非智能标注分支调用它，避免 rectEngine.render 的 updateCursorStyle 与 GRAB dispatch 互相翻转', en: 'Fix Maximum-update-depth loop caused by enabling hand cursor in ALL view: added RectRenderEngine.drawExistingRects (pure-draw, no cursor dispatch); AllLabelsRenderEngine calls it in non-smart branches instead of rectEngine.render, breaking the GRAB ↔ updateCursorStyle oscillation' },
            { zh: '侧栏分组标题与顶栏工具 tooltip 拆分成两组 i18n 键：labelTypes.all/rect/polygon 给侧栏 (查看全部 / 检测标签 / 分割标签)，labelTypes.toolAll/toolRect/toolPolygon 给工具按钮 (查看所有标签 / 绘制矩形框 / 绘制多边形)', en: 'Split sidebar group headers from toolbar tooltips into two i18n key sets: labelTypes.{all,rect,polygon} for sidebar (noun phrases), labelTypes.tool{All,Rect,Polygon} for toolbar tooltips (imperative verb phrases)' },
            { zh: 'Changelog 弹窗改为固定高度 (max-height 65vh) + 自定义滚动条 + 滚到底部自动懒加载更多条目 (每次加载 3 条)', en: 'Changelog popup uses a fixed height (max-height 65vh), custom scrollbar, and lazy-loads more entries (3 at a time) when scrolled near the bottom' },
        ]
    },
    {
        version: '2.0.5',
        date: '2026-04-14',
        changes: [
            { zh: '智能标注按钮改为 SAM 家族模型加载时才显示 (未加载直接隐藏，不再 disabled 占位)；tooltip 简化为「智能标注」', en: 'Smart Annotation button is now only shown when a SAM-family model is loaded (hidden instead of disabled when absent); tooltip simplified to "Smart Annotation"' },
            { zh: 'SAM 推理期间显示进度通知卡片：预处理 → SAM 推理 → 生成多边形 三阶段 (与检测/批量分割通知一致)', en: 'Show a 3-step progress notification during SAM inference: preprocessing → SAM inference → polygon write-back (matches detection / batch-segmentation style)' },
            { zh: 'Pending prompt 视觉反馈：SAM 推理期间在画布上闪烁显示白色圆点 (point prompt) 或白色半透明填充矩形 (bbox prompt)；推理返回后自动消失', en: 'Pending prompt visual feedback: while SAM is running, a blinking white dot (point prompt) or translucent filled rect (bbox prompt) is rendered on the canvas; cleared when the mask lands' },
            { zh: '智能标注按钮位置从 zoom 旁移至「显示/隐藏标签」眼睛按钮旁，形成 AI-工具分组', en: 'Smart Annotation button moved from next to zoom controls to beside the Show/Hide Labels (eye) button, forming an AI-tool grouping' },
            { zh: '智能标注按钮与「全部标签 / 检测标签 / 分割标签」互斥：激活一方自动停用另一方；点击 tab 会自动关闭智能标注', en: 'Smart Annotation toggle is mutually exclusive with the label tabs (All / Rect / Polygon): activating one deactivates the other; clicking any tab auto-deactivates Smart Annotation' },
            { zh: '智能标注结果落地后自动切换到「分割标签」视图；批量检测推理结果落地后自动切到「检测标签」视图', en: 'Smart-annotation results auto-switch the sidebar to the Polygon view; batch detection results auto-switch to the Rect view' },
            { zh: '「显示/隐藏标签」按钮现在同时控制检测框 (labelRects) 与分割 mask (labelPolygons)：任一类型有 AI 标签即启用，点击同步翻转两个可见性', en: 'The Show/Hide Labels toggle now controls both detection rects and segmentation masks simultaneously: enabled when either has AI labels, click flips both visibility flags' },
            { zh: '眼睛按钮 tooltip 简化为「显示标签 / 隐藏标签」', en: 'Eye-toggle tooltip simplified to "Show Labels" / "Hide Labels"' },
            { zh: '「全部标签」视图改为只读浏览：可看见所有类型标签，但不响应鼠标事件 (不能在此视图创建/编辑)；要编辑请切到「检测标签」或「分割标签」', en: '"All Labels" view is now read-only: shows every label type but does not route mouse events; switch to Rect or Polygon tab to edit' },
            { zh: 'AllLabelsRenderEngine 在 mountSupportRenderingEngine(ALL) 里真正挂上 (之前被直接替换为 RectRenderEngine)；内部组合 rect/point/line/polygon 四个引擎', en: 'AllLabelsRenderEngine is now actually mounted for ALL view in mountSupportRenderingEngine(ALL) — previously silently substituted with RectRenderEngine; it composes rect / point / line / polygon engines internally' },
            { zh: 'AllLabelsRenderEngine 现在也渲染多边形 (polygonEngine.drawExistingLabels)，SAM mask 和全图分割结果在 ALL 视图下直接可见', en: 'AllLabelsRenderEngine now also renders polygons via polygonEngine.drawExistingLabels; SAM masks and full-image segmentation results are directly visible in ALL view' },
            { zh: '多边形渲染改为「始终填充」：不再仅在 active/highlighted 时填充，AI mask 在任何视图下都可见', en: 'Polygon rendering always fills (not just when active/highlighted): AI masks are visible in any view' },
            { zh: 'PolygonRenderEngine.drawExistingLabels 尊重 segmentationLabelsVisible：AI 多边形受显示/隐藏标签开关控制，手动画的多边形不受影响', en: 'PolygonRenderEngine.drawExistingLabels now respects segmentationLabelsVisible: AI-created polygons follow the Show/Hide Labels toggle, manually drawn polygons are unaffected' },
            { zh: '智能标注 (source=\'smart\') 路径保证 segmentationLabelsVisible 为 true，避免 SAM mask 刚生成就被隐藏开关干掉', en: 'Smart-annotation (source=\'smart\') path ensures segmentationLabelsVisible=true so freshly generated SAM masks are not immediately hidden by the visibility toggle' },
            { zh: '视频帧支持：智能标注在 video 项目下通过 FrameExtractorService.fetchFrameRange 实时从 FFmpeg session 取当前帧发送给 SAM', en: 'Video-frame support: in a video project, smart annotation extracts the current frame on demand via FrameExtractorService.fetchFrameRange from the backend FFmpeg session' },
            { zh: '修复 PolygonRenderEngine.render 在 AllLabelsRenderEngine 里触发的 Maximum update depth 无限渲染循环：改为只调用 drawExistingLabels (无 dispatch 副作用)', en: 'Fix "Maximum update depth exceeded" infinite render loop triggered by PolygonRenderEngine.render inside AllLabelsRenderEngine: switched to drawExistingLabels (no dispatch side-effects)' },
            { zh: 'SmartAnnotationActions 使用动态 import 引用 AISegmentationActions，打破 EditorActions → RectRenderEngine → SmartAnnotationActions → AISegmentationActions 的循环依赖 (原本导致 ContextManager 初始化失败)', en: 'SmartAnnotationActions dynamically imports AISegmentationActions to break the EditorActions → RectRenderEngine → SmartAnnotationActions → AISegmentationActions import cycle (previously crashed ContextManager init)' },
            { zh: '智能标注激活时重置到「全部标签」视图，不再强制切换到矩形框工具', en: 'Activating Smart Annotation resets the view to "All Labels"; no longer forces the Rect tool' },
        ]
    },
    {
        version: '2.0.4',
        date: '2026-04-14',
        changes: [
            { zh: '新增智能标注模式：矩形框工具下点击画布发送 SAM 单点前景 prompt，拖框发送 bbox prompt，返回的 mask 作为多边形标签直接渲染', en: 'Add smart annotation mode: under the rect tool, single click sends a SAM foreground point prompt and drag sends a bbox prompt; returned mask renders as a polygon label' },
            { zh: '十字线辅助按钮重构为智能标注开关：开启时强制切到矩形工具，十字线作为视觉准星保留', en: 'Crosshair button rebranded as smart annotation toggle: turning it on forces the rect tool active and keeps the crosshair as a visual targeting reticle' },
            { zh: '未加载 SAM 家族模型时按钮 disabled + tooltip 提示，点击直接打开本地模型加载弹窗引导加载', en: 'Button disabled with tooltip when no SAM-family segmentation model is loaded; clicking it opens the local model popup to guide the user to load SAM' },
            { zh: '后端 /segment 接口新增 point 参数 ("x,y") 与 bbox 并列支持 SAM 单点 prompt；YOLO-seg 路径忽略 point', en: 'Backend /segment now accepts a point form param ("x,y") alongside bbox to support SAM single-point prompts; YOLO-seg path ignores point' },
            { zh: '智能标注的结果只追加到 labelPolygons，不写入推理历史和推理结果面板（不污染 batch inference 的视图）', en: 'Smart annotation results are only appended to labelPolygons; they bypass the inference history and results-panel writes used by batch inference' },
            { zh: 'Redux state general.crossHairVisible 重命名为 smartAnnotationActive 以匹配新语义；持久化字段同步重命名', en: 'Redux state general.crossHairVisible renamed to smartAnnotationActive; persistence (LocalStorage / AutoSave / ProjectRestore) field renamed in sync' },
        ]
    },
    {
        version: '2.0.3',
        date: '2026-04-12',
        changes: [
            { zh: '新增分割模型推理：支持 YOLOv8-seg / YOLO11-seg / SAM 2 / MobileSAM / FastSAM 全图批量分割', en: 'Add segmentation inference: batch full-image segmentation with YOLOv8-seg / YOLO11-seg / SAM 2 / MobileSAM / FastSAM' },
            { zh: '分割结果以填充半透明多边形渲染，segmentationLabelsVisible 独立控制显隐', en: 'Segmentation results rendered as semi-transparent filled polygons, segmentationLabelsVisible toggle independent from detection' },
            { zh: '工具栏推理控件重构：下拉菜单选择推理模式（检测整图/分割整图/自定义）+ 推理按钮（显示选中帧数 x174）', en: 'Toolbar inference controls refactored: dropdown to select mode (Detect All / Segment All / Custom) + Infer button showing selected frame count' },
            { zh: '本地模型弹窗：分割模型区从"即将推出"变为可选，支持 5 个模型家族 + 变体选择 + 下载/加载', en: 'Local model popup: segmentation section now selectable with 5 model families, variant selection, download and load' },
            { zh: '后端分割模型热切换：/load-model 支持 service 参数，SAM 模型用 SAM() 构造器加载', en: 'Backend segmentation model hot-swap: /load-model supports service parameter, SAM models loaded via SAM() constructor' },
            { zh: '自定义模型按文件名前缀自动识别类型：seg_/det_ 前缀或含 seg/sam 关键词', en: 'Custom model type auto-detection by filename prefix: seg_/det_ prefix or seg/sam keyword' },
            { zh: '修复推理通知中 texts.frame 未定义：改为 texts.video.frame', en: 'Fix undefined texts.frame in inference notifications: use texts.video.frame' },
        ]
    },
    {
        version: '2.0.2',
        date: '2026-04-12',
        changes: [
            { zh: '移除推理结果入库时的重复框过滤（IOU>0.7 + 同类名的 rect 不再被静默丢弃）', en: 'Remove duplicate box filtering at inference write-time (rects with IOU>0.7 + same class name are no longer silently dropped)' },
            { zh: '保持模型原生输出：所有 AI 检测结果原样入库，包括同帧高重叠框、与手动框重叠、多次推理叠加', en: 'Preserve raw model output: all AI detection results are stored as-is, including high-IOU overlaps within a frame, overlaps with manual boxes, and multi-pass inference accumulation' },
            { zh: '删除 AIDetectionActions.checkDuplicateLabelRect 方法 + 未使用的 RectUtil import', en: 'Delete AIDetectionActions.checkDuplicateLabelRect method and unused RectUtil import' },
            { zh: '新增 ONNX 模型加载：检测/分割服务都支持 .onnx 权重，自动跳过 torch device 迁移交由 onnxruntime 托管', en: 'Add ONNX model loading: both detection and segmentation services accept .onnx weights, automatically skipping torch device placement and delegating to onnxruntime' },
            { zh: '后端 /upload 接口白名单扩展为 (.pt, .onnx)，/available-models 同时返回缓存目录与 backend/ 下的 .onnx 文件（带后缀以区分运行时）', en: 'Backend /upload now whitelists (.pt, .onnx); /available-models also returns .onnx files from cache and backend/ (with extension preserved to disambiguate runtime)' },
            { zh: '"加载模型"弹窗的"自定义"分组：".onnx 模型文件"从"即将推出"变为可点击，复用同一上传流程；拖拽区域接受 .pt / .onnx', en: 'Load Model popup "Custom" section: ".onnx model file" entry is now clickable (no longer "coming soon"), reusing the same upload flow; dropzone accepts both .pt and .onnx' },
            { zh: '后端依赖新增 onnxruntime 1.19.2 + onnx 1.19.1（用于 ultralytics 内部的 ONNX 推理与导出）', en: 'Backend dependencies: onnxruntime 1.19.2 + onnx 1.19.1 added (used by ultralytics for ONNX inference and export)' },
        ]
    },
    {
        version: '2.0.1',
        date: '2026-04-12',
        changes: [
            { zh: '修复视频播放到最后一帧时画面回弹到帧 0 的闪帧问题', en: 'Fix end-of-play frame flash: picture briefly jumped back to frame 0 before correcting to last frame' },
            { zh: '根因：VideoEditor 传给 FramePlayer 的 frames prop 在 on-demand 模式下 fallback 成新 `[]` 引用，导致 loadFrameImage / drawFrame useCallback 每帧重建、play effect 每帧 re-run，末帧时 isPlaying 的 React state 更新落后于 Redux commit，play effect 在中间 commit 读到 stale `isPlaying=true` + `isVideoEndedRef=true` 错误进入 RESET 分支，dispatch `onTimeUpdate(0, 0)`', en: 'Root cause: `frames={preExtractedFrames || []}` created a new empty array per render, churning the useCallback chain and re-running the play effect every frame. At end-of-play, a split React commit (Redux dispatch before setIsPlaying) let the play effect run with stale `isPlaying=true` after `isVideoEndedRef=true` was set, wrongly triggering the replay reset block' },
            { zh: '修复：模块级 EMPTY_FRAMES 稳定空数组常量，play effect 只在 isPlaying 状态真正变化时 re-run', en: 'Fix: module-level EMPTY_FRAMES stable constant; play effect only re-runs on actual isPlaying transitions' },
        ]
    },
    {
        version: '2.0.0',
        date: '2026-04-11',
        changes: [
            { zh: '修复暂停时点时间轴跳帧：AI 框不再画在错帧上（stale videoFrameImage 导致的底图/标签错位）', en: 'Fix paused timeline seek: AI boxes no longer drawn on wrong frame (stale videoFrameImage caused image/label mismatch)' },
            { zh: 'FramePlayer 外部 seek 先试 drawFrameSync，缓存命中零闪烁，未命中异步补一次 fullRender', en: 'FramePlayer external seek tries drawFrameSync first, zero-flash on cache hit; async drawFrame triggers fullRender fallback on miss' },
            { zh: 'VideoTimeline 合并 onSeek / onFrameChange 为单一入口，消除双 dispatch + currentTime 踩踏', en: 'VideoTimeline merges onSeek / onFrameChange into single entry, eliminates double dispatch + currentTime race' },
            { zh: '时间轴同帧点击跳过，拖动/键盘快捷键统一走 onFrameChange', en: 'Timeline same-frame click is skipped; drag/keyboard shortcuts use onFrameChange only' },
            { zh: 'AI 推理改为只处理选中帧（而非全部帧）', en: 'AI inference now processes selected frames only (not all frames)' },
            { zh: 'AI 推理流式写入：每帧推完立即刷新 UI，取消 Phase 2/3 分段', en: 'Streaming AI inference: each frame writes to UI immediately, Phase 2/3 batching removed' },
            { zh: '工具栏新增"推理结果显隐"开关（eye 按钮 + IOS Switch）', en: 'Toolbar: add AI labels visibility toggle (eye button + IOS switch)' },
            { zh: '推理结果面板缩略图改用原分辨率源（videoFrameImage / VideoCanvas）裁剪，不再走低清 <video>', en: 'Inference results thumbnails crop from native resolution (videoFrameImage / VideoCanvas), no longer low-res <video>' },
            { zh: '侧栏缩略图按标注来源着色：手动/AI/混合/未标注', en: 'Sidebar thumbnails colored by label origin: manual / AI / mixed / unannotated' },
            { zh: '侧栏缩略图多选高亮', en: 'Sidebar thumbnails show multi-select highlight' },
            { zh: '修复切帧后推理结果缩略图不刷新的问题（去重 + activeImage id 校验）', en: 'Fix inference result thumbnails not refreshing after frame change (dedupe + activeImage id check)' },
        ]
    },
    {
        version: '1.9.9',
        date: '2026-04-09',
        changes: [
            { zh: '完整 YOLO 包导入：支持 yolo_full_*.zip 一键导入图像+标注到空项目', en: 'Full YOLO package import: yolo_full_*.zip imports images + annotations into empty project' },
            { zh: '导出文件名区分模式：简单 yolo_simple_*、完整 yolo_full_*（所有格式同理）', en: 'Export filenames distinguish mode: yolo_simple_* vs yolo_full_* (all formats)' },
            { zh: '修复视频帧导出缺失：去掉 loadStatus 检查，未加载帧用 fallback 宽高', en: 'Fix video frame export missing: remove loadStatus check, use fallback dimensions for unloaded frames' },
            { zh: '修复标注框颜色：按类别着色对所有标注生效，不再区分 AI/手动', en: 'Fix annotation box color: per-class coloring applies to all annotations, no longer AI/manual distinction' },
            { zh: '修复 YOLO labels.txt 解析：保留标签名空格（如 fire hydrant），只 trim 两端', en: 'Fix YOLO labels.txt parsing: preserve spaces in label names (e.g. fire hydrant), only trim edges' },
            { zh: '完整导入后自动选中第一张图', en: 'Auto-select first image after full import' },
            { zh: '后台预拆帧：上传视频后自动预提取全部帧，batch 加载提速 100 倍', en: 'Background pre-extraction: auto-extract all frames after upload, 100x faster batch loading' },
            { zh: '工具栏精简：隐藏拖拽和缩放按钮，重排为 原尺寸→自适应→十字线 | 标注工具 | 推理', en: 'Toolbar cleanup: hide drag/zoom buttons, reorder to Original→Fit→Crosshair | Tools | Inference' },
            { zh: '统一 tooltip 文案：检测→推理，标注→十字线辅助', en: 'Unify tooltip text: Detection→Inference, Annotation→Crosshair' },
        ]
    },
    {
        version: '1.9.8',
        date: '2026-04-09',
        changes: [
            { zh: '重构导入标注弹窗：去掉 GenericLabelTypePopup 包裹，改用 GenericYesNoPopup 直接渲染，修复 dropzone 事件失效', en: 'Rewrite import popup: remove GenericLabelTypePopup wrapper, use GenericYesNoPopup directly, fix dropzone events' },
            { zh: '支持 .zip 文件直接导入：自动解压并根据文件名前缀识别格式（yolo_/voc_/coco_/vgg_）', en: 'Support .zip file import: auto-unzip and detect format from filename prefix (yolo_/voc_/coco_/vgg_)' },
            { zh: '自动格式检测回退：labels.txt→YOLO, .xml→VOC, .json→COCO', en: 'Auto format detection fallback: labels.txt→YOLO, .xml→VOC, .json→COCO' },
        ]
    },
    {
        version: '1.9.7',
        date: '2026-04-08',
        changes: [
            { zh: 'FFmpeg 帧提取超时改为无限制，支持 10GB+ 大视频', en: 'FFmpeg frame extraction timeout removed, supports 10GB+ videos' },
            { zh: 'YOLO 导出自动包含 labels.txt（简单/完整模式均支持）', en: 'YOLO export now includes labels.txt in both Simple and Complete modes' },
            { zh: '上传/导入文案调整：点击上传优先展示', en: 'Upload/import text adjusted: click-to-upload shown first' },
        ]
    },
    {
        version: '1.9.6',
        date: '2026-04-08',
        changes: [
            { zh: '导出标注新增简单/完整模式切换：完整模式包含图像 + 标签 + 8:1:1 数据集划分', en: 'Export annotations: add Simple/Complete mode toggle — Complete includes images + labels + 8:1:1 dataset split' },
            { zh: '所有导出格式（YOLO/VOC/COCO/VGG/CSV）均支持完整模式', en: 'All export formats (YOLO/VOC/COCO/VGG/CSV) support Complete mode' },
            { zh: '导入标注简化：去掉格式选择步骤，拖拽文件自动识别格式（.json→COCO, .txt→YOLO, .xml→VOC）', en: 'Simplify import: remove format selection, auto-detect from file extension (.json→COCO, .txt→YOLO, .xml→VOC)' },
            { zh: '导出格式描述简化为格式名 + 简要说明', en: 'Simplify export format labels to name + brief description' },
            { zh: '修复导出/导入弹窗 JSX 多余逗号渲染为文本', en: 'Fix stray comma rendered as text in export/import popups' },
            { zh: '修复推理通知中硬编码中文"帧"，改用 LanguageConfig', en: 'Fix hardcoded Chinese "帧" in inference notifications, use LanguageConfig' },
        ]
    },
    {
        version: '1.9.5',
        date: '2026-04-08',
        changes: [
            { zh: '本地模型弹窗重构为三区布局：自定义 / 检测模型 / 分割模型', en: 'Refactor local model popup into 3-section layout: Custom / Detection / Segmentation' },
            { zh: '自定义区新增 .pt / .onnx / .engine 三种格式选项（后两者占位）', en: 'Custom section adds .pt / .onnx / .engine format options (latter two as placeholders)' },
            { zh: '分割模型区添加 SAM 系列占位（SAM / SAM 2 / SAM 3 / MobileSAM / FastSAM）', en: 'Segmentation section adds SAM family placeholders (SAM / SAM 2 / SAM 3 / MobileSAM / FastSAM)' },
            { zh: '弹窗内容区支持滚动，底部按钮不再被遮挡', en: 'Popup content area now scrollable, footer buttons no longer clipped' },
            { zh: '模型列表已下载数量字号统一', en: 'Unify downloaded model count font size in model list' },
        ]
    },
    {
        version: '1.9.4',
        date: '2026-04-08',
        changes: [
            { zh: '隐藏点标注和线条标注功能（工具栏、侧栏、导入导出弹窗）', en: 'Hide point and line annotation features (toolbar, sidebar, import/export popups)' },
            { zh: '标签类型重命名：矩形框→检测标签，多边形→分割标签', en: 'Rename label types: Rect→Detection, Polygon→Segmentation' },
            { zh: '模型弹窗重命名：加载AI模型→本地模型，接入AI模型→远程模型', en: 'Rename model popups: Load AI Model→Local Model, Integrate AI Model→Remote Model' },
            { zh: '全部标签图标统一使用 all.png', en: 'Unify "All Labels" icon to all.png' },
            { zh: '文件名过长时底栏省略中部显示，悬停查看完整名', en: 'Truncate long filenames in bottom bar with ellipsis, hover for full name' },
            { zh: '推理结果坐标标签缩写为 Coords 防止挤压', en: 'Shorten coordinates label to Coords to prevent overflow' },
            { zh: '修复重新开始后黑屏：PolygonLabelsList 空数据保护', en: 'Fix black screen after fresh start: PolygonLabelsList null-data guard' },
        ]
    },
    {
        version: '1.9.3',
        date: '2026-04-08',
        changes: [
            { zh: '恢复多边形标注功能：从 origin 还原 PolygonRenderEngine、多边形导出器（VGG/COCO）及侧栏列表', en: 'Restore polygon annotation: bring back PolygonRenderEngine, polygon exporters (VGG/COCO) and sidebar list from origin' },
            { zh: '修复导出/导入标注弹窗黑屏：当标签视图为"全部"时打开弹窗不再崩溃', en: 'Fix export/import popup black screen: opening popup in "ALL" label view no longer crashes' },
            { zh: '修复多边形标签列表硬编码英文，改用 LanguageConfig 中英双语', en: 'Fix hardcoded English in PolygonLabelsList, now uses LanguageConfig for i18n' },
            { zh: '恢复弹窗标题文案优化', en: 'Restore dialog title text refinement' },
        ]
    },
    {
        version: '1.9.2',
        date: '2026-04-06',
        changes: [
            { zh: '编辑模式支持边框拖拽移动矩形（对齐 v2），边缘悬停显示抓手光标', en: 'Edit mode supports border drag to move rects (align with v2), edge hover shows grab cursor' },
            { zh: '修复刷新恢复后文件队列丢失：队列项和活动队列 ID 现在持久化到 IndexedDB', en: 'Fix file queue lost after refresh restore: queue items and active queue ID now persisted to IndexedDB' },
            { zh: '修复刷新恢复后推理结果丢失：推理结果按图像 ID 存储，视频批量检测结果也纳入持久化', en: 'Fix inference results lost after refresh restore: results stored per image ID, video batch detection results also persisted' },
        ]
    },
    {
        version: '1.9.1',
        date: '2026-04-06',
        changes: [
            { zh: '修复视频模式缩放：鼠标滚轮缩放时视频帧与检测框同步缩放', en: 'Fix video mode zoom: video frame now scales together with detection boxes on mouse wheel zoom' },
            { zh: '修复文件队列中英文切换不完全：帧数/图像数等备注现在跟随语言动态显示', en: 'Fix incomplete i18n in file queue: frame/image count metadata now updates dynamically with language switch' },
        ]
    },
    {
        version: '1.9.0',
        date: '2026-04-06',
        changes: [
            { zh: '修复缩略图选中蓝色边框上部与右侧宽度不一致（box-sizing 修正）', en: 'Fix thumbnail selection blue border uneven width between top and right (box-sizing fix)' },
            { zh: '点击标签色块直接打开编辑标签弹窗', en: 'Click label color marker to open label editor popup directly' },
            { zh: '关闭按类别着色时，标签文字背景同步关闭颜色', en: 'Label text background respects per-class coloration toggle' },
            { zh: '界面文案优化："更新标签列表"→"编辑标签"，"创建项目"→"确认"', en: 'UI text refinement: "Update labels list" → "Edit labels", "Create project" → "Confirm"' },
        ]
    },
    {
        version: '1.8.9',
        date: '2026-04-06',
        changes: [
            { zh: '修复帧率硬编码：视频 fps 不再写死 30，自动使用原始帧率（支持 120fps/60fps/50fps 等）', en: 'Fix hardcoded fps: video fps no longer forced to 30, auto-detect original frame rate (120/60/50fps etc.)' },
            { zh: '播放引擎重构：setInterval → requestAnimationFrame + 时间驱动，消除异步绘制竞争', en: 'Playback engine rewrite: setInterval → rAF + time-driven, eliminate async draw races' },
            { zh: '修复播放无法到达最后一帧：节流绕过 + 闭包帧号修正 + 最后一帧确保画完再暂停', en: 'Fix playback not reaching last frame: throttle bypass + stale closure fix + ensure last frame drawn before pause' },
            { zh: '帧缓冲区改为 fps 自适应：基于秒数 × fps 动态计算，高帧率视频缓冲更充足', en: 'Frame buffer fps-aware: dynamically calculated as seconds × fps, better buffering for high-fps videos' },
            { zh: 'fps 兜底增加 console.warn，快速定位帧率缺失问题', en: 'Add console.warn for fps fallback, quickly identify missing fps issues' },
        ]
    },
    {
        version: '1.8.8',
        date: '2026-04-05',
        changes: [
            { zh: '帧加载架构重写：available_frames 滑动窗口（前方 500 帧保障 + 2000 帧缓存上限 + 自动淘汰旧帧）', en: 'Frame loading rewrite: available_frames sliding window (500 ahead guarantee + 2000 cache cap + auto-evict old frames)' },
            { zh: '帧完整加载统一：取帧 + 解码 Image + 生成缩略图一体化，不再分开抢资源', en: 'Unified frame loading: fetch + decode + thumbnail in one pass, no more resource contention' },
            { zh: '初始加载 500 帧完成后才允许播放，显示"解析中 X%"进度', en: 'Playback enabled only after initial 500 frames loaded, with "Parsing X%" progress' },
            { zh: '播放时后台加载暂停，全部资源给播放保证流畅', en: 'Background loading paused during playback, all resources dedicated to smooth playback' },
            { zh: '跳播快速缓存 500 帧图片（不生成缩略图），优先保证播放连续', en: 'Seek preloads 500 frame images (skip thumbnails) for immediate playback continuity' },
            { zh: '去掉 EditorContainer 预解码 100 帧，上传完直接交给 FramePlayer 统一处理', en: 'Removed EditorContainer 100-frame pre-decode, upload hands off to FramePlayer directly' },
            { zh: '后端会话自动清理：新上传时清理所有旧会话临时文件', en: 'Backend session auto-cleanup: all old session temp files cleaned on new upload' },
            { zh: '修复大视频推理 500 错误：按需模式帧占位文件为空，改为从已解码 Image 截取像素', en: 'Fix large video detection 500 error: on-demand placeholder files were empty, now captures pixels from decoded Image' },
        ]
    },
    {
        version: '1.8.7',
        date: '2026-04-05',
        changes: [
            { zh: '大视频按需取帧：后端 FFmpeg 用 -frames:v 替代 -t，修复单帧提取失败', en: 'Large video on-demand: backend FFmpeg uses -frames:v instead of -t, fix single-frame extraction failure' },
            { zh: '前端批量取帧（30帧/批）+ 去重，替代逐帧请求，减少 90% HTTP 请求', en: 'Frontend batch frame fetch (30/batch) with dedup, replacing per-frame requests, 90% fewer HTTP calls' },
            { zh: '修复 handleVideoMetadataLoaded 无限循环（imagesData 依赖导致）', en: 'Fix handleVideoMetadataLoaded infinite loop caused by imagesData dependency cycle' },
            { zh: '大视频缩略图改为从后端取帧生成，不再使用慢速 video seek', en: 'Large video thumbnails generated from backend frames instead of slow video seek' },
            { zh: '预加载串行化：逐批加载避免并发 FFmpeg 进程过多', en: 'Serialize preload batches to prevent concurrent FFmpeg process overload' },
            { zh: '修复上传完成时短暂闪回欢迎页的问题', en: 'Fix brief flash-back to welcome page when upload completes' },
        ]
    },
    {
        version: '1.8.6',
        date: '2026-04-05',
        changes: [
            { zh: '视频加载架构升级：fast_ffmpeg_mode（默认）+ raw_browser_mode（回退）双模式', en: 'Video loading architecture: fast_ffmpeg_mode (default) + raw_browser_mode (fallback)' },
            { zh: '大视频（>10K 帧）支持按需取帧，一次上传 + 任意 seek', en: 'Large video (>10K frames) on-demand loading: upload once + seek anywhere' },
            { zh: '3 层智能预取：首屏 P0(0-19) → 播放缓冲 P1(20-499) → 跳帧窗口 P2(-20/+80)', en: '3-tier prefetch: P0 thumbnails(0-19) → P1 playback buffer(20-499) → P2 seek window(-20/+80)' },
            { zh: 'LRU 缓存控制内存（上限 300 帧），自动驱逐远离播放指针的旧帧', en: 'LRU cache memory control (300 frame cap), auto-evict frames far from playhead' },
            { zh: '后端新增 POST /upload-video + GET /frames/{id} API', en: 'Backend: new POST /upload-video + GET /frames/{id} API' },
            { zh: '修复中文文件名导致 HTTP header latin-1 编码失败', en: 'Fix Chinese filename causing HTTP header latin-1 encoding failure' },
            { zh: '大文件流式上传到磁盘（不占后端内存）', en: 'Large file streaming upload to disk (no backend memory usage)' },
        ]
    },
    {
        version: '1.8.5',
        date: '2026-04-05',
        changes: [
            { zh: '修复视频模式恢复工作失败的问题：预拆帧数据现在会保存到 IndexedDB', en: 'Fix video mode restore failure: pre-extracted frames are now saved to IndexedDB' },
            { zh: '恢复时自动重建 preExtractedFrames + extractionMetadata（fps/尺寸等）', en: 'Auto-rebuild preExtractedFrames + extractionMetadata (fps/dimensions) on restore' },
        ]
    },
    {
        version: '1.8.4',
        date: '2026-04-05',
        changes: [
            { zh: '推理结果卡片移除冗余"缩略图"标签', en: 'Remove redundant "Thumbnail" label from inference result cards' },
            { zh: '批量检测通知支持中英双语（捕获帧/推理中）', en: 'Batch detection notifications now support bilingual display (capture/inferring)' },
            { zh: '代码审查：confidence 防御性校验、JSON.parse 容错、帧缓存上限、帧数上限校验', en: 'Code audit: confidence null guard, JSON.parse error handling, frame cache LRU, frame count validation' },
        ]
    },
    {
        version: '1.8.3',
        date: '2026-04-05',
        changes: [
            { zh: '推理结果卡片显示真实置信度（不再显示 0.0%）', en: 'Inference result cards now show real confidence scores (no longer 0.0%)' },
            { zh: '批量检测完成后画面与检测框同步到第一帧', en: 'Canvas and detection boxes sync to frame 1 after batch detection completes' },
            { zh: '视频加载进度直接显示在主画布（上传中 / 解析帧百分比）', en: 'Video loading progress shown directly on main canvas (upload / frame extraction percentage)' },
            { zh: '通知弹窗不再堆叠：新通知立刻替换旧通知', en: 'Notifications no longer stack: new notification immediately replaces the old one' },
        ]
    },
    {
        version: '1.8.2',
        date: '2026-04-05',
        changes: [
            { zh: 'FFmpeg 拆帧后进入视频模式 UI：播放控制栏、时间轴、帧导航完整保留', en: 'FFmpeg extracted frames now enter video mode UI: playback controls, timeline, frame navigation fully preserved' },
            { zh: '新增 FramePlayer 组件：canvas + setInterval 驱动帧播放，不依赖 <video> 元素', en: 'New FramePlayer component: canvas + setInterval driven playback, no <video> element dependency' },
            { zh: '批量检测直接使用预拆帧 JPEG，跳过逐帧 seek+capture，速度大幅提升', en: 'Batch detection uses pre-extracted JPEGs directly, skipping per-frame seek+capture for major speedup' },
            { zh: '缩略图生成使用 createImageBitmap 直接从帧文件生成，无需 video seek', en: 'Thumbnail generation uses createImageBitmap from frame files directly, no video seek needed' },
            { zh: '修复 CORS expose_headers 缺失导致前端无法读取拆帧元数据的问题', en: 'Fix missing CORS expose_headers preventing frontend from reading frame extraction metadata' },
            { zh: '修复播放到末尾后无法重播的问题', en: 'Fix replay not working after playback reaches the end' },
            { zh: '修复视频模式下推理结果面板不随帧切换刷新的问题', en: 'Fix inference results panel not updating when switching frames in video mode' },
        ]
    },
    {
        version: '1.8.1',
        date: '2026-04-05',
        changes: [
            { zh: '后端原生 FFmpeg 拆帧：替换 FFmpeg WASM，174 帧 1920x1440 视频仅需 0.87 秒', en: 'Backend native FFmpeg: replaces WASM, 174 frames of 1920x1440 in 0.87s' },
            { zh: '新增 /extract-frames API：上传视频 → 原生 FFmpeg 拆帧 → ZIP 打包返回', en: 'New /extract-frames API: upload video → native FFmpeg extraction → ZIP response' },
            { zh: '修复 DataCloneError：视频模式下跳过 IndexedDB 保存，防止内存爆炸', en: 'Fix DataCloneError: skip IndexedDB save in video mode, prevent OOM' },
            { zh: '拆帧失败自动回退到传统视频模式', en: 'Auto-fallback to traditional video mode if frame extraction fails' },
        ]
    },
    {
        version: '1.8.0',
        date: '2026-04-04',
        changes: [
            { zh: '【实验性】FFmpeg WASM 前端拆帧（已被 v1.8.1 替换）', en: '[Experimental] FFmpeg WASM frame extraction (superseded by v1.8.1)' },
        ]
    },
    {
        version: '1.7.2',
        date: '2026-04-04',
        changes: [
            { zh: '推理结果面板支持批量检测和恢复后的数据：从 labelRects 自动生成显示卡片', en: 'Inference panel shows results for batch detection and restored projects via labelRects fallback' },
            { zh: '视频帧缩略图从 video 元素直接截取，不再尝试用 img 加载 mp4 文件', en: 'Video frame thumbnails captured from video element directly instead of loading mp4 as image' },
        ]
    },
    {
        version: '1.7.1',
        date: '2026-04-04',
        changes: [
            { zh: '修复恢复工作后缩略图永久转圈：检测视频项目并自动恢复视频模式，重新生成缩略图', en: 'Fix infinite spinner on thumbnails after restore: detect video project and auto-restore video mode' },
            { zh: '修复 IndexedDB 恢复后文件 MIME 类型丢失：同时检查文件扩展名作为兜底', en: 'Fix lost MIME type after IndexedDB restore: fallback to file extension check' },
        ]
    },
    {
        version: '1.7.0',
        date: '2026-04-04',
        changes: [
            { zh: '消除浮点精度丢帧：所有 time→frame 转换改用 Math.round，彻底解决末尾帧差 1-2 帧的问题', en: 'Eliminate float precision frame loss: all time→frame conversions use Math.round, fixing off-by-1-2 frames at video end' },
            { zh: '整数帧号为唯一真相：视频结束帧直接用 totalFrames-1，不再从 duration 浮点重算', en: 'Integer frame as single source of truth: video end frame uses totalFrames-1 directly, no float recomputation' },
            { zh: 'Timeline 标记用帧比例绘制，消除 frame÷fps 浮点误差导致的像素偏移', en: 'Timeline markers use frame ratio for positioning, eliminating frame÷fps float pixel drift' },
            { zh: '批量检测进度实时显示：捕获帧 (n/174)、推理中 (n/174)，步骤指示器同步高亮', en: 'Real-time batch detection progress: capture (n/174), inference (n/174), step indicator synced' },
            { zh: '推理进度通知不再自动消失，直到完成或手动关闭', en: 'Inference progress notification stays until completion or manual dismiss' },
            { zh: '视频末尾自动显示 ↺ 重播按钮', en: 'Auto-show ↺ replay button at video end' },
        ]
    },
    {
        version: '1.6.6',
        date: '2026-04-04',
        changes: [
            { zh: '帧计数改为从 1 开始，最后一帧显示为 174/174 而非 173/174', en: 'Frame counter now starts from 1, last frame shows 174/174 instead of 173/174' },
            { zh: '重播按钮符号统一为 ↺，与播放 ▶ 暂停 ⏸ 风格一致', en: 'Replay button unified to ↺ symbol, consistent with ▶ play and ⏸ pause' },
            { zh: '快捷键提示支持中英双语，新增空格键提示', en: 'Shortcut hints now bilingual, added Space key hint' },
        ]
    },
    {
        version: '1.6.5',
        date: '2026-04-04',
        changes: [
            { zh: '修复通知系统崩溃：检测完成后通知渲染不再报错', en: 'Fix notification crash: detection completion notification no longer throws' },
            { zh: '清理控制台日志噪音：自动保存不再每秒刷屏，控制台只显示有意义的信息', en: 'Clean console logs: auto-save no longer floods console, only meaningful info shown' },
        ]
    },
    {
        version: '1.6.4',
        date: '2026-04-04',
        changes: [
            { zh: '播放流畅性大幅提升：onPlayPauseRef 稳定键盘监听，消除空格键响应丢失', en: 'Major playback smoothness: stable keyboard listener via onPlayPauseRef, no more missed spacebar' },
            { zh: '修复重播卡顿：play effect 用 ref 读取 isVideoEnded，消除 effect 双重触发导致的 rVFC 间隙', en: 'Fix replay stutter: read isVideoEnded from ref to prevent double effect run and rVFC gap' },
            { zh: 'Timeline 进度条可靠同步：每帧 Redux dispatch 保证状态一致，简化架构消除同步 bug', en: 'Reliable timeline sync: per-frame Redux dispatch ensures consistent state, simplified architecture' },
        ]
    },
    {
        version: '1.6.3',
        date: '2026-04-04',
        changes: [
            { zh: '彻底修复批量检测断片：视频模式全帧覆盖，不再依赖选中状态，174/174 帧 0 断片', en: 'Fix batch detection gaps: video mode processes all frames regardless of selection, 174/174 with 0 gaps' },
            { zh: '修复播放时检测框不跟随：onTimeUpdateRef 模式稳定 rVFC 循环，消除每帧重启', en: 'Fix playback box following: onTimeUpdateRef pattern stabilizes rVFC loop, preventing per-frame restarts' },
            { zh: '修复 AI 检测框不显示：批量检测后自动设置 aiLabelsVisible，确保框可见', en: 'Fix AI boxes invisible: auto-set aiLabelsVisible after batch detection via addInferenceHistory' },
            { zh: '修复播放数据过时：EditorModel.latestImagesData 缓存 + fallback，确保立即生效', en: 'Fix stale playback data: EditorModel.latestImagesData cache with fallback for immediate availability' },
            { zh: 'seekVideoToTimeForCapture 增强：readyState 轮询上限 2s，4 次重试，5s 超时保护', en: 'Enhanced seekVideoToTimeForCapture: 2s readyState polling, 4 retries, 5s emergency timeout' },
        ]
    },
    {
        version: '1.6.2',
        date: '2026-04-04',
        changes: [
            { zh: '捕获与推理流水线并行：捕获帧的同时 4 路并发推理，总时间大幅缩短', en: 'Pipeline parallelism: capture and 4-way concurrent inference run simultaneously, greatly reducing total time' },
            { zh: 'seek 改用 requestVideoFrameCallback 确认帧真正渲染后再截图，帧捕获可靠性最大化', en: 'Seek uses requestVideoFrameCallback to confirm actual frame render before capture, maximizing reliability' },
            { zh: '批量写入 Redux：全部推理完成后单次 dispatch 更新所有图像，消除 N 次重渲染', en: 'Batch Redux write: single dispatch after all inference, eliminating N re-renders' },
            { zh: '进度通知实时显示百分比、捕获数、推理数，清晰掌握进度', en: 'Real-time progress with percentage, capture count, and inference count' },
            { zh: '修复 queueMicrotask 导致的批量模式 Redux 数据竞争', en: 'Fix Redux data race in batch mode caused by queueMicrotask async writes' },
        ]
    },
    {
        version: '1.6.1',
        date: '2026-04-04',
        changes: [
            { zh: '推理与渲染分离：播放时直接按帧号读取预计算标注数据，绕过 Redux selector，消除断片', en: 'Decouple inference from rendering: read pre-computed annotation data by frame index during playback, bypass Redux selector, eliminate gaps' },
            { zh: '批量检测增加重试机制和帧就绪等待，确保每帧都能稳定检测', en: 'Batch detection with retry and frame readiness check for reliable per-frame detection' },
            { zh: '视频 seek 增加超时保护和帧解码等待，避免批量检测挂起', en: 'Video seek with timeout protection and frame decode wait to prevent batch detection hangs' },
        ]
    },
    {
        version: '1.6.0',
        date: '2026-04-03',
        changes: [
            { zh: '视频播放时标注框实时同步渲染，无延迟', en: 'Annotation boxes render in real-time during video playback with zero delay' },
            { zh: '修复视频模式检测框坐标偏移（视频模式取消 viewport 边距）', en: 'Fix detection box coordinate misalignment in video mode (remove viewport margin)' },
            { zh: '修复批量检测时所有帧共用同一画面的问题（检测前自动 seek 到对应帧）', en: 'Fix batch detection using same frame for all images (auto-seek to correct frame before capture)' },
            { zh: '批量检测增加重试机制和帧就绪等待，确保不断片', en: 'Batch detection with retry mechanism and frame readiness check to prevent gaps' },
            { zh: '播放时跳过 canvas drawImage 开销，直接显示 video 元素', en: 'Skip canvas drawImage during playback, show video element directly' },
            { zh: '侧边栏更新节流到 5fps，减少播放时 React 重渲染', en: 'Throttle sidebar updates to 5fps during playback to reduce React re-renders' },
            { zh: 'GPU 合成优化：标注层和视频层提升为独立合成器层', en: 'GPU compositing: promote annotation and video layers to separate compositor layers' },
        ]
    },
    {
        version: '1.5.1',
        date: '2026-04-03',
        changes: [
            { zh: '支持批量目标检测：多选图像后点击检测按钮，对所有选中图像依次推理', en: 'Batch object detection: select multiple images then click detect to run inference on all selected' },
            { zh: '已有AI标签的图像自动跳过，避免重复检测', en: 'Skip images with existing AI labels to avoid duplicate detection' },
            { zh: '批量检测实时进度通知和完成汇总统计', en: 'Real-time batch detection progress notification and completion summary' },
        ]
    },
    {
        version: '1.5.0',
        date: '2026-04-03',
        changes: [
            { zh: '视频模式完整支持目标检测：全分辨率截帧发送后端，检测结果与图片模式一致', en: 'Full object detection support in video mode: full-resolution frame capture, results match image mode' },
            { zh: '修复视频模式检测框不渲染问题（Editor 使用全分辨率帧图像而非缩略图）', en: 'Fix detection boxes not rendering in video mode (Editor uses full-res frame instead of thumbnail)' },
            { zh: '切帧后检测框坐标正确对齐视频画面', en: 'Detection box coordinates correctly align with video frame after seeking' },
        ]
    },
    {
        version: '1.4.9',
        date: '2026-04-03',
        changes: [
            { zh: '修复视频模式下目标检测 500 错误（从 canvas 截帧发送，而非发送原始视频文件）', en: 'Fix video mode detection 500 error (send canvas frame instead of raw video file)' },
            { zh: '修复切换图像再切回视频时缩略图转圈圈问题（防止卸载时空缓存覆盖有效缓存）', en: 'Fix video thumbnails spinning on switch back (prevent empty cache overwriting valid cache on unmount)' },
            { zh: '修复 ImagePreview 对视频文件的兼容（跳过无法加载的视频类型文件）', en: 'Fix ImagePreview compatibility with video files (skip unloadable video file types)' },
        ]
    },
    {
        version: '1.4.8',
        date: '2026-04-03',
        changes: [
            { zh: '「导入图像」改为「上传文件」，同时支持上传图像和视频（mp4/mov/avi/webm）', en: '"Import Images" renamed to "Upload Files", now supports both images and videos (mp4/mov/avi/webm)' },
            { zh: '上传的视频文件自动添加到队列，图像直接加入当前项目', en: 'Uploaded videos are added to queue, images are added directly to current project' },
        ]
    },
    {
        version: '1.4.7',
        date: '2026-04-03',
        changes: [
            { zh: '修复矩形框绘制后鼠标松手仍继续绘制的严重 bug（移除未导入的 AISegmentationActions 调用）', en: 'Fix critical bug where rectangle kept drawing after mouse release (removed unimported AISegmentationActions call)' },
            { zh: '恢复矩形绘制引擎核心逻辑与 origin 一致，提升绘制稳定性', en: 'Restore RectRenderEngine core logic to match origin for improved drawing stability' },
        ]
    },
    {
        version: '1.4.6',
        date: '2026-04-02',
        changes: [
            { zh: '缩略图左下角勾标记文件推理状态：推理成功显示绿色勾，未推理显示蓝色勾', en: 'Thumbnail checkbox now indicates inference status: green for inferred, blue for not inferred' },
            { zh: '推理状态颜色采用原版 AI 模式配色（hue-rotate 120deg）', en: 'Inference status color uses original AI mode palette (hue-rotate 120deg)' },
        ]
    },
    {
        version: '1.4.5',
        date: '2026-04-02',
        changes: [
            { zh: '通知弹窗支持实时语言切换（切换语言后通知立即更新）', en: 'Notification popups now update instantly when switching language' },
            { zh: '顶部导航栏"AI Model"按钮文案优化', en: 'Simplified top nav "AI Model" button label' },
            { zh: '中文"队列"改为"文件队列"', en: 'Chinese "Queue" label changed to "File Queue"' },
            { zh: '左右侧边栏按钮间距优化，避免文字重叠', en: 'Improved sidebar button spacing to prevent text overlap' },
        ]
    },
    {
        version: '1.4.4',
        date: '2026-04-02',
        changes: [
            { zh: '全面双语化：修复 40+ 处未国际化的 UI 字符串', en: 'Full i18n: fixed 40+ hardcoded UI strings across the app' },
            { zh: '通知消息支持中英文切换', en: 'Notification messages now support language switching' },
            { zh: '队列面板、视频控件、模型管理弹窗等组件完成双语化', en: 'Queue panel, video controls, model management popup and more are now bilingual' },
            { zh: '消除所有 ternary 语言判断模式，统一使用 LanguageConfig', en: 'Eliminated all ternary language patterns, unified to use LanguageConfig' },
        ]
    },
    {
        version: '1.4.3',
        date: '2026-04-02',
        changes: [
            { zh: '修复模型加载进度条卡在0%的问题（改为后台异步加载）', en: 'Fixed model loading progress stuck at 0% (now loads asynchronously in background)' },
        ]
    },
    {
        version: '1.4.2',
        date: '2026-04-02',
        changes: [
            { zh: '后端新增模型管理API（可用模型列表、模型切换、加载状态查询、自定义模型上传）', en: 'Added backend model management API (available models, model switching, load status, custom model upload)' },
            { zh: '修复前端"模型加载失败"错误（后端缺少 /available-models 等接口）', en: 'Fixed frontend "model load failed" error (backend was missing /available-models endpoints)' },
        ]
    },
    {
        version: '1.4.1',
        date: '2026-04-02',
        changes: [
            { zh: 'Shift 多选后点击第一张红叉可批量删除所有选中图片', en: 'Click delete on first selected image to batch remove all selected images' },
        ]
    },
    {
        version: '1.4.0',
        date: '2026-04-02',
        changes: [
            { zh: '缩略图悬停显示红叉删除按钮', en: 'Show delete button on thumbnail hover' },
            { zh: '统一蓝勾和红叉的大小', en: 'Unified size of selection indicator and delete button' },
        ]
    },
    {
        version: '1.3.7',
        date: '2026-04-02',
        changes: [
            { zh: '修复导航栏按钮 hover 白色背景溢出的问题', en: 'Fixed nav bar button hover background overflowing' },
            { zh: '去除下拉菜单多余间距（顶部和底部）', en: 'Removed extra padding in dropdown menus (top and bottom)' },
        ]
    },
    {
        version: '1.3.6',
        date: '2026-04-02',
        changes: [
            { zh: '推理结果按钮添加图标', en: 'Added icon to inference results button' },
            { zh: '修复底部文件名换行问题', en: 'Fixed filename wrapping in bottom navigation bar' },
        ]
    },
    {
        version: '1.3.5',
        date: '2026-04-02',
        changes: [
            { zh: '左右方向键直接切换上/下一张图片', en: 'ArrowLeft/ArrowRight keys now switch to previous/next image' },
        ]
    },
    {
        version: '1.3.4',
        date: '2026-04-02',
        changes: [
            { zh: '修复项目名称输入框中无法使用方向键和删除键的问题', en: 'Fixed arrow keys and delete key not working inside project name input' },
            { zh: '点击画布自动释放输入框焦点，恢复快捷键', en: 'Clicking canvas auto-blurs input, restoring keyboard shortcuts' },
        ]
    },
    {
        version: '1.3.3',
        date: '2026-04-02',
        changes: [
            { zh: '项目名称在顶部导航栏居中显示', en: 'Project name is now centered in the top navigation bar' },
            { zh: '修复项目名称下划线过长的问题', en: 'Fixed project name underline being wider than the text' },
        ]
    },
    {
        version: '1.3.2',
        date: '2026-04-02',
        changes: [
            { zh: '修复点击画布后空格键触发上传而非播放/暂停的问题', en: 'Fixed Space key triggering upload instead of play/pause after clicking canvas' },
            { zh: '欢迎页面支持点击上传文件', en: 'Welcome page now supports click to upload files' },
        ]
    },
    {
        version: '1.3.1',
        date: '2026-04-01',
        changes: [
            { zh: '修复更新日志展开后窗口变大的问题（展开前锁定高度，改用滚动条）', en: 'Fixed changelog window growing after load more (lock height before expanding, use scrollbar instead)' },
        ]
    },
    {
        version: '1.3.0',
        date: '2026-04-01',
        changes: [
            { zh: '实现文件队列 UI：缩略图列表、状态指示、点击切换文件', en: 'Implemented file queue UI: thumbnail list, status indicators, click to switch files' },
            { zh: '上传新文件自动切换到新内容，无需手动操作', en: 'Auto-switch to newly uploaded content on drop' },
            { zh: '修复拖拽上传在已有图片时被 canvas/Scrollbars 拦截的问题', en: 'Fixed drag-and-drop blocked by canvas/Scrollbars when images are loaded' },
            { zh: '修复切换图集后缩略图转圈不加载的问题', en: 'Fixed thumbnails spinning indefinitely after switching image set' },
            { zh: '修复切换图集后画布灰屏的问题（EditorModel.isLoading 未重置）', en: 'Fixed gray canvas after switching image set (EditorModel.isLoading not reset)' },
            { zh: '修复图片加载失败时 isLoading 永久卡死', en: 'Fixed isLoading stuck on true when image load fails' },
        ]
    },
    {
        version: '1.2.1',
        date: '2026-04-01',
        changes: [
            { zh: '调整模型下拉菜单顺序：本地模型优先，远程模型其次', en: 'Reordered model dropdown: local models first, remote models second' },
            { zh: '移除底部栏"刚刚保存"文字，悬停文件名可查看最后保存时间', en: 'Removed "Just saved" label; hover over filename to see last saved time' },
            { zh: '修复底部栏文件名未居中（左右区域等宽对齐）', en: 'Fixed filename not centered in bottom bar (equal-width left/right sections)' },
        ]
    },
    {
        version: '1.2.0',
        date: '2026-04-01',
        changes: [
            { zh: '修复视频缩略图 URL 内存泄漏', en: 'Fixed video thumbnail URL memory leak' },
            { zh: '修复视频重播竞态条件', en: 'Fixed video replay race condition' },
            { zh: '添加缩略图生成取消机制（切换视频时）', en: 'Added thumbnail generation cancellation on video switch' },
            { zh: '修复播放时 Editor 每帧重新挂载导致卡顿', en: 'Fixed Editor remounting on every frame during playback' },
            { zh: '修复切换视频时缓存误判', en: 'Fixed false cache hit when switching videos' },
            { zh: '修复时间轴标注帧位置计算错误', en: 'Fixed annotated frame position calculation on timeline' },
            { zh: '修复快速拖动时间轴时监听器泄漏', en: 'Fixed seek listener accumulation on rapid scrubbing' },
            { zh: '修复图片预览 Redux 属性直接修改', en: 'Fixed direct prop mutation in ImagePreview' },
        ]
    },
    {
        version: '1.1.6',
        date: '2026-04-01',
        changes: [
            { zh: '修复视频播放到底后需多次点击才能重播', en: 'Fixed replay requiring multiple clicks after video ends' },
        ]
    },
    {
        version: '1.1.5',
        date: '2026-04-01',
        changes: [
            { zh: '修复视频模式光标指示器残留', en: 'Fixed cursor indicator in video mode' },
            { zh: '修复时间轴末尾空白和刷新闪烁', en: 'Fixed timeline gap and flickering at end' },
            { zh: '优化视频帧率检测（元数据快速读取）', en: 'Faster frame rate detection via metadata' },
            { zh: '修复视频总帧数计算偏差', en: 'Fixed total frame count calculation' },
        ]
    },
    {
        version: '1.1.4',
        date: '2026-04-01',
        changes: [
            { zh: '修复视频模式画面叠加问题', en: 'Fixed video mode overlay issue' },
            { zh: '修复视频帧缩略图不加载的问题', en: 'Fixed video frame thumbnail loading' },
            { zh: '优化拖拽上传视觉样式', en: 'Improved drag-and-drop upload visual style' },
        ]
    },
    {
        version: '1.1.2',
        date: '2026-04-01',
        changes: [
            { zh: '添加版本更新日志弹窗', en: 'Added changelog popup' },
            { zh: '点击版本号查看更新历史', en: 'Click version number to view update history' },
        ]
    },
    {
        version: '1.1.1',
        date: '2026-04-01',
        changes: [
            { zh: '添加文件队列管理功能', en: 'Added file queue management' },
            { zh: '支持拖拽上传图片和视频', en: 'Support drag-and-drop upload for images and videos' },
            { zh: '文件缩略图生成与缓存', en: 'File thumbnail generation and caching' },
            { zh: '队列按钮（左侧导航栏）', en: 'Queue button in left sidebar' },
        ]
    },
    {
        version: '1.1.0',
        date: '2026-04-01',
        changes: [
            { zh: '添加视频标注支持', en: 'Added video annotation support' },
            { zh: 'VideoEditor / VideoPlayer / VideoTimeline 组件', en: 'VideoEditor / VideoPlayer / VideoTimeline components' },
            { zh: '视频帧逐帧标注', en: 'Frame-by-frame video annotation' },
            { zh: '时间轴拖动与关键帧标记', en: 'Timeline scrubbing and keyframe marking' },
        ]
    },
    {
        version: '1.0.1',
        date: '2026-03-15',
        changes: [
            { zh: '合并遗留代码功能', en: 'Merged legacy code features' },
        ]
    },
    {
        version: '1.0.0',
        date: '2026-03-01',
        changes: [
            { zh: '初始发布版本', en: 'Initial release' },
        ]
    }
];

interface IProps {
    language: Language;
}

const INITIAL_SHOW_COUNT = 3;
const LOAD_STEP = 3;
const SCROLL_BOTTOM_THRESHOLD = 80; // px

const ChangelogPopup: React.FC<IProps> = ({language}) => {
    const currentTexts = LanguageConfig[language];
    const [status, setMountStatus] = useState(false);
    const [visibleCount, setVisibleCount] = useState(INITIAL_SHOW_COUNT);
    const bodyRef = React.useRef<HTMLDivElement>(null);
    const isZh = language === Language.CHINESE;

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        // 距离底部小于阈值时自动加载更多条目
        if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD) {
            setVisibleCount(c => Math.min(c + LOAD_STEP, CHANGELOG_DATA.length));
        }
    };

    useEffect(() => {
        if (!status) {
            ContextManager.switchCtx(ContextType.POPUP);
            setMountStatus(true);
        }
    }, [status]);

    const visibleEntries = CHANGELOG_DATA.slice(0, visibleCount);
    const hasMore = visibleCount < CHANGELOG_DATA.length;

    const renderContent = () => {
        return (
            <div className="ChangelogContent">
                {visibleEntries.map((entry, idx) => (
                    <div key={entry.version} className={`ChangelogEntry ${idx === 0 ? 'latest' : ''}`}>
                        <div className="EntryHeader">
                            <span className="VersionTag">v{entry.version}</span>
                            <span className="EntryDate">{entry.date}</span>
                        </div>
                        <ul className="ChangesList">
                            {entry.changes.map((change, i) => (
                                <li key={i}>{isZh ? change.zh : change.en}</li>
                            ))}
                        </ul>
                    </div>
                ))}
                {hasMore && (
                    <button
                        className="LoadMoreButton"
                        onClick={() => setVisibleCount(c => Math.min(c + LOAD_STEP, CHANGELOG_DATA.length))}
                        type="button"
                    >
                        {isZh
                            ? `加载更多 (剩余 ${CHANGELOG_DATA.length - visibleCount})`
                            : `Load more (${CHANGELOG_DATA.length - visibleCount} remaining)`}
                    </button>
                )}
            </div>
        );
    };

    return (
        <div className="ChangelogPopup" data-popup-backdrop>
            <div className="ChangelogPanel" data-popup-surface>
                <div className="PanelHeader">
                    <span className="PanelTitle">{currentTexts.changelog.title}</span>
                </div>
                <div
                    className="PanelBody"
                    ref={bodyRef}
                    onScroll={handleScroll}
                >
                    {renderContent()}
                </div>
            </div>
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(mapStateToProps)(ChangelogPopup);
