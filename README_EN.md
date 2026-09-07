# OpenSight

[中文](README.md) | **English**

An intelligent visual-data annotation and edge-compute control platform covering annotation, inference, datasets, training, retrieval, and node-resource management.

![OpenSight platform preview](docs/preview.png)

[Live Demo](https://model.work/) · [Issues](https://github.com/quest-X/model-work-frontend/issues) · [Releases](https://github.com/quest-X/model-work-frontend/releases)

## Repository Role

This repository contains the OpenSight web frontend and product interaction layer. AI inference, plugins, and edge-node execution are provided by these repositories:

| Repository | Responsibility |
|------------|----------------|
| [model-work-backend](https://github.com/quest-X/model-work-backend) | Inference, datasets, training, accounts, and extension hosting |
| [model-work-extension](https://github.com/quest-X/model-work-extension) | Retrieval, model inspection, cameras, compute groups, and other plugins |
| [model-work-node](https://github.com/quest-X/model-work-node) | Lynx communication, scheduling, and task execution |
| [model-work-monitor](https://github.com/quest-X/model-work-monitor) | Backend operations and data-status console |

OpenSight continues to evolve from Skalski's [make-sense](https://github.com/SkalskiP/make-sense).

## Core Capabilities

- **Image and Video Annotation** — image management, frame extraction, timeline navigation, and frame-level annotation
- **Intelligent Inference** — detection, batch detection, and OCR with YOLO-family and custom `.pt`/`.onnx` models
- **Segmentation and Tracking** — SAM, SAM 2, SAM 3, MobileSAM, FastSAM, YOLO-seg, and cross-frame propagation
- **Data and Training** — dataset management, batch inference, and training jobs
- **Retrieval and Model Inspection** — similar-image search, model-stage heatmaps, and target attribution
- **Control Center** — inspect compute groups, nodes, resources, cameras, and governed tasks
- **Annotation Exchange** — import COCO, YOLO, VOC, LabelMe, and VGG; export YOLO, COCO, VOC, CSV, LabelMe, VGG, and JSON

## Quick Start

```bash
git clone https://github.com/quest-X/model-work-frontend.git
cd model-work-frontend
npm install
npm start
```

Open `http://localhost:3001`. Full inference and control features also require sibling Backend and Extension checkouts to be running.

## Configuration

The development proxy targets `https://127.0.0.1:58600` by default. To use another backend, set this in `.env.local`:

```env
VITE_OPENSIGHT_BACKEND_TARGET=https://127.0.0.1:58600
```

## Development and Verification

```bash
npm start          # Development server
npm run build      # Production build
npm test           # Jest tests
npm run lint       # TypeScript checks
```

The main source tree is under `src/`: `views/` contains the UI, `services/` connects backend and extension APIs, `store/` owns Redux state, and `logic/` plus `workers/` provide business logic and background tasks.

## Current Boundaries

- This repository does not contain model weights, training data, or the Python inference environment.
- Browser project state becomes available to the Backend, Monitor, and Node only after export or upload.
- Extension availability depends on Backend installation and runtime switches.

## License

This project is licensed under [GPL-3.0](LICENSE), following the upstream [make-sense](https://github.com/SkalskiP/make-sense) license.
