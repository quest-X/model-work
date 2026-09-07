# OpenSight Platform

**中文** | [English](README_EN.md)

OpenSight 是面向视觉数据的智能标注与计算节点控制平台，覆盖标注、推理、数据集、训练、检索和边缘资源管理。

项目基于 Skalski 的 [make-sense](https://github.com/SkalskiP/make-sense) 持续演进。

![OpenSight Platform](docs/preview.png)

**在线演示**：[https://model.work](https://model.work/)

## 功能

- **图片与视频标注** — 图片管理、视频抽帧、时间线导航和逐帧标注
- **智能推理** — YOLO 系列及自定义 `.pt`/`.onnx` 模型的检测、批量检测和文字识别
- **实例分割** — SAM、SAM 2、SAM 3、MobileSAM、FastSAM 与 YOLO-seg
- **视频跟踪** — 使用 SAM 2 或 SAM 3 跨帧传播标注
- **数据与训练** — 管理数据集、批量推理和训练任务
- **视觉检索与模型透视** — 相似图像检索、模型阶段热图和目标归因
- **控制中心** — 查看计算群、节点、资源、相机和受控任务
- **标注交换** — 导入 COCO、YOLO、VOC、LabelMe、VGG；导出 YOLO、COCO、VOC、CSV、LabelMe、VGG、JSON

## 快速开始

```bash
npm install
npm start
```

前端默认运行于 `http://localhost:3001`。人工智能推理与控制功能需要同时运行
[model-work-backend](https://github.com/quest-X/model-work-backend) 和
[model-work-extension](https://github.com/quest-X/model-work-extension)。开发代理默认连接
`https://127.0.0.1:58600`，可通过 `VITE_OPENSIGHT_BACKEND_TARGET` 修改。

## 常用命令

```bash
npm start          # 启动开发服务器
npm run build      # 生成生产构建
npm test           # 运行测试
npm run lint       # 检查 TypeScript 源码
```

## 项目结构

```text
src/
  ai/                 # 检测、分割与推理集成
  views/              # 编辑器、控制中心与弹窗
  services/           # 后端及扩展服务客户端
  store/              # Redux 状态管理
  logic/              # 业务逻辑、操作与快捷键
  workers/            # 浏览器后台任务
```

## 技术栈

React 18、TypeScript、Redux、Vite、Material UI、Canvas API。

## 环境要求

- Node.js 18+
- 推理、训练与控制功能所需的后端和扩展服务

## 许可证

本项目采用 [GPL-3.0](LICENSE) 许可证，并遵循上游 [make-sense](https://github.com/SkalskiP/make-sense) 的许可要求。
