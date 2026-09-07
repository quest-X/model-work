# OpenSight

**中文** | [English](README_EN.md)

面向视觉数据的智能标注与边缘计算控制平台，覆盖标注、推理、数据集、训练、检索和节点资源管理。

![OpenSight 平台预览](docs/preview.png)

[在线演示](https://model.work/) · [问题反馈](https://github.com/quest-X/model-work-frontend/issues) · [版本发布](https://github.com/quest-X/model-work-frontend/releases)

## 项目定位

本仓库是 OpenSight 的 Web 前端和产品交互层。人工智能推理、插件能力和边缘节点执行分别由以下仓库提供：

| 仓库 | 职责 |
|------|------|
| [model-work-backend](https://github.com/quest-X/model-work-backend) | 推理、数据集、训练、账户及扩展宿主 |
| [model-work-extension](https://github.com/quest-X/model-work-extension) | 检索、模型透视、相机和计算群等插件 |
| [model-work-node](https://github.com/quest-X/model-work-node) | 灵汐节点（Lynx）的通讯、调度和任务执行 |
| [model-work-monitor](https://github.com/quest-X/model-work-monitor) | 后端运维与数据状态控制台 |

OpenSight 基于 Skalski 的 [make-sense](https://github.com/SkalskiP/make-sense) 持续演进。

## 核心能力

- **图片与视频标注** — 图片管理、视频抽帧、时间线导航和逐帧标注
- **智能推理** — YOLO 系列及自定义 `.pt`/`.onnx` 模型的检测、批量检测和文字识别
- **实例分割与跟踪** — SAM、SAM 2、SAM 3、MobileSAM、FastSAM、YOLO-seg 及跨帧传播
- **数据与训练** — 数据集管理、批量推理和训练任务
- **检索与模型透视** — 相似图像检索、模型阶段热图和目标归因
- **控制中心** — 查看计算群、节点、资源、相机和受控任务
- **标注交换** — 导入 COCO、YOLO、VOC、LabelMe、VGG；导出 YOLO、COCO、VOC、CSV、LabelMe、VGG、JSON

## 快速开始

```bash
git clone https://github.com/quest-X/model-work-frontend.git
cd model-work-frontend
npm install
npm start
```

浏览器访问 `http://localhost:3001`。完整推理和控制功能需要同时运行相邻的 Backend 与 Extension 仓库。

## 配置

开发代理默认连接 `https://127.0.0.1:58600`。如后端位于其他地址，在 `.env.local` 中设置：

```env
VITE_OPENSIGHT_BACKEND_TARGET=https://127.0.0.1:58600
```

## 开发与验证

```bash
npm start          # 开发服务器
npm run build      # 生产构建
npm test           # Jest 测试
npm run lint       # TypeScript 代码检查
```

主要源码位于 `src/`：`views/` 负责界面，`services/` 连接后端与扩展服务，`store/` 管理 Redux 状态，`logic/` 和 `workers/` 承担业务逻辑与后台任务。

## 当前边界

- 本仓库不包含模型权重、训练数据或 Python 推理环境。
- 浏览器端保存的项目状态只有导出或上传后才能被后端、Monitor 和 Node 使用。
- 各扩展是否可用取决于 Backend 的安装状态和运行开关。

## 许可证

本项目采用 [GPL-3.0](LICENSE) 许可证，并遵循上游 [make-sense](https://github.com/SkalskiP/make-sense) 的许可要求。
