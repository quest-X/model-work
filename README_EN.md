# OpenSight Platform

[中文](README.md) | **English**

OpenSight is an intelligent visual-data annotation and compute-node control platform covering annotation, inference, datasets, training, retrieval, and edge-resource management.

The project continues to evolve from Skalski's [make-sense](https://github.com/SkalskiP/make-sense).

![OpenSight Platform](docs/preview.png)

**Live Demo**: [https://model.work](https://model.work/)

## Features

- **Image and Video Annotation** — image management, frame extraction, timeline navigation, and frame-level annotation
- **Intelligent Inference** — detection, batch detection, and OCR with YOLO-family and custom `.pt`/`.onnx` models
- **Instance Segmentation** — SAM, SAM 2, SAM 3, MobileSAM, FastSAM, and YOLO-seg
- **Video Tracking** — propagate annotations across frames with SAM 2 or SAM 3
- **Data and Training** — manage datasets, batch inference, and training jobs
- **Visual Retrieval and Model Inspection** — similar-image search, model-stage heatmaps, and target attribution
- **Control Center** — inspect compute groups, nodes, resources, cameras, and governed tasks
- **Annotation Exchange** — import COCO, YOLO, VOC, LabelMe, and VGG; export YOLO, COCO, VOC, CSV, LabelMe, VGG, and JSON

## Quick Start

```bash
npm install
npm start
```

The frontend runs at `http://localhost:3001` by default. AI inference and control features also require
[model-work-backend](https://github.com/quest-X/model-work-backend) and
[model-work-extension](https://github.com/quest-X/model-work-extension). The development proxy targets
`https://127.0.0.1:58600` by default; set `VITE_OPENSIGHT_BACKEND_TARGET` to override it.

## Common Commands

```bash
npm start          # Start the development server
npm run build      # Create a production build
npm test           # Run tests
npm run lint       # Check TypeScript sources
```

## Project Structure

```text
src/
  ai/                 # Detection, segmentation, and inference integrations
  views/              # Editor, Control Center, and popups
  services/           # Backend and extension-service clients
  store/              # Redux state management
  logic/              # Business logic, actions, and hotkeys
  workers/            # Browser background tasks
```

## Tech Stack

React 18, TypeScript, Redux, Vite, Material UI, and the Canvas API.

## Requirements

- Node.js 18+
- The backend and extension services for inference, training, and control features

## License

This project is licensed under [GPL-3.0](LICENSE), following the upstream [make-sense](https://github.com/SkalskiP/make-sense) license.
