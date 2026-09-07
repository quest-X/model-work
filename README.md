# OpenSight Platform

**中文** | [English](README_EN.md)

OpenSight 是智能视觉标注平台，支持目标检测、实例分割与视频跟踪。

基于 Skalski 的 [make-sense](https://github.com/SkalskiP/make-sense) 构建。

![OpenSight Platform](docs/preview.png)

**在线演示**：[https://model.work](https://model.work/)

## 功能

- **目标检测** — 支持 YOLO 系列（v8/v9/v10/11/12/26）及自定义 `.pt`/`.onnx` 模型
- **实例分割** — 支持 SAM、SAM 2、SAM 3、MobileSAM、FastSAM 与 YOLO-seg
- **视频模式** — 视频抽帧、时间线导航与逐帧标注
- **视频跟踪** — 使用 SAM 2 跨帧传播标注
- **智能标注** — 在 SAM 提示模式下点击分割
- **批量推理** — 一次检测多张图片
- **自定义脚本** — 上传用于推理流水线的 Python 前置/后置处理钩子
- **导出** — 支持 YOLO、COCO、VOC、CSV 与 VGG 格式
- **导入** — 支持 COCO、YOLO 与 VOC 标注

## 快速开始

```bash
# 前端
npm install
npm start          # http://localhost:3001

# 后端（AI 推理必需）
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 项目结构

```
src/
  ai/                 # AI 检测与分割集成
  views/              # 界面组件（编辑器、弹窗、时间线）
  store/              # Redux 状态管理
  logic/              # 业务逻辑、操作与快捷键
backend/              # FastAPI 推理服务（独立仓库）
  app/
    api/routes.py     # /detect, /segment, /batch_detect, /health
    services/         # detection.py, segmentation.py, tracking.py
    scripts/          # 用户上传的前置/后置处理钩子
```

## 技术栈

- **前端**：React 18 + TypeScript + Redux + Vite + Canvas API
- **后端**：FastAPI + Ultralytics + PyTorch
- **分割**：通过 Ultralytics 使用 SAM 2 / SAM 3

## 环境要求

- Node.js 18+
- Python 3.10+
- PyTorch（可使用 CUDA 或 MPS 进行 GPU 加速）

## 许可证

本项目采用 [GPL-3.0](LICENSE) 许可证，并遵循上游 [make-sense](https://github.com/SkalskiP/make-sense) 的许可要求。
