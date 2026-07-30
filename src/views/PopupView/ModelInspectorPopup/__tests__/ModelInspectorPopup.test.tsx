import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {ImageData} from '../../../../store/labels/types';
import {MODEL_INSPECTOR_ESCAPE_EVENT, ModelInspectorPopup} from '../ModelInspectorPopup';
import {InspectionSession, InspectorStatus, ModelInspectorAPI} from '../ModelInspectorAPI';
import {EditorModel} from '../../../../staticModels/EditorModel';


jest.mock('../../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));

jest.mock('../ModelInspectorAPI', () => {
    const actual = jest.requireActual('../ModelInspectorAPI');
    return {
        ...actual,
        ModelInspectorAPI: {
            status: jest.fn(),
            layers: jest.fn(),
            createSession: jest.fn(),
            deleteSession: jest.fn().mockResolvedValue(undefined),
            createAttribution: jest.fn().mockResolvedValue(undefined),
            mapUrl: jest.fn((_session: string, layer: string) => `data:image/png,${layer}`),
        },
    };
});

const status: InspectorStatus = {
    status: 'ok',
    version: '0.1.0',
    sessions: 0,
    cache_bytes: 0,
    limits: {
        max_upload_mb: 25,
        max_layers: 32,
        max_total_layers: 512,
        max_top_channels: 16,
        max_map_side: 256,
        batch_top_channels: 4,
        batch_map_side: 160,
        session_ttl_seconds: 120,
        max_cache_mb: 128,
    },
    slots: [
        {
            slot: 'detection', state: 'ready', model: 'yolo11n.pt', runtime: 'pytorch',
            family: 'yolo', supports_activations: true, supports_attribution: true, reason: null,
        },
        {
            slot: 'segmentation', state: 'not_loaded', model: '', runtime: 'unknown',
            family: 'unknown', supports_activations: false, supports_attribution: false,
            reason: '该模型 slot 尚未加载模型',
        },
    ],
};

const catalog = {
    status: 'success' as const,
    slot: 'detection' as const,
    model: 'yolo11n.pt',
    family: 'yolo',
    runtime: 'pytorch',
    default_layer_ids: ['layer-a', 'layer-b'],
    layers: [
        {id: 'layer-a', path: 'model.0', type: 'Conv', group: 'Backbone', depth: 2, parameters: 464, default_selected: true},
        {id: 'layer-b', path: 'model.1', type: 'Conv', group: 'Backbone', depth: 2, parameters: 4672, default_selected: true},
    ],
};

const session: InspectionSession = {
    status: 'success', id: 'session-1', slot: 'detection', model: 'yolo11n.pt', family: 'yolo', runtime: 'pytorch',
    filename: 'bus.jpg', original_size: [320, 160], input_size: [320, 160], created_at: 1, expires_at: 121,
    elapsed_ms: 42, warnings: [], predictions: [
        {index: 0, class_id: 5, name: 'bus', confidence: 0.91, bbox: [20, 20, 280, 150]},
    ],
    layers: [
        {
            id: 'layer-a', path: 'model.0', type: 'Conv', group: 'Backbone', output_shape: [1, 16, 80, 160],
            layout: 'NCHW', status: 'ready', reason: null, maps: ['mean_abs', 'max_abs', 'eigen'],
            channels: [{index: 7, score: 0.32}],
        },
        {
            id: 'layer-b', path: 'model.1', type: 'Conv', group: 'Backbone', output_shape: [1, 32, 40, 80],
            layout: 'NCHW', status: 'ready', reason: null, maps: ['mean_abs', 'max_abs', 'eigen'],
            channels: [{index: 3, score: 0.21}],
        },
    ],
};

const activeImage: ImageData = {
    id: 'image-1',
    fileData: new File(['pixels'], 'bus.jpg', {type: 'image/jpeg'}),
    loadStatus: true,
    labelRects: [],
    labelPoints: [],
    labelLines: [],
    labelPolygons: [],
    labelNameIds: [],
    isVisitedByRoboflowAPI: false,
};

describe('ModelInspectorPopup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (ModelInspectorAPI.status as jest.Mock).mockResolvedValue(status);
        (ModelInspectorAPI.layers as jest.Mock).mockResolvedValue(catalog);
        (ModelInspectorAPI.createSession as jest.Mock).mockResolvedValue(session);
        (ModelInspectorAPI.deleteSession as jest.Mock).mockResolvedValue(undefined);
        Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: jest.fn(() => 'blob:source')});
        Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: jest.fn()});
        EditorModel.videoFrameImage = undefined;
        EditorModel.playbackImageData = null;
    });

    it('automatically captures semantic stages, exposes comparison, and cleans the session on unmount', async () => {
        const view = render(<ModelInspectorPopup language={Language.CHINESE} activeImage={activeImage} activeModelTask='detect'/>);

        const capture = await screen.findByTestId('inspector-capture');
        expect(screen.getByText('当前推理模型')).toBeInTheDocument();
        expect(screen.getByText('yolo11n.pt')).toBeInTheDocument();
        expect(await screen.findByTestId('inspector-view-a')).toBeInTheDocument();
        expect(capture).toHaveTextContent('重新生成 2 层透视');
        expect(screen.getAllByText('model.0').length).toBeGreaterThan(0);
        expect(ModelInspectorAPI.createSession).toHaveBeenCalledWith(
            activeImage.fileData,
            'detection',
            ['layer-a', 'layer-b'],
            expect.objectContaining({imgsz: 640, topK: 8, maxSide: 256}),
            expect.any(AbortSignal),
        );
        expect(ModelInspectorAPI.createSession).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText('A/B'));
        expect(await screen.findByTestId('inspector-compare-b')).toBeInTheDocument();
        fireEvent.click(screen.getByText('ch 7'));
        expect(ModelInspectorAPI.mapUrl).toHaveBeenCalled();

        view.unmount();
        await waitFor(() => expect(ModelInspectorAPI.deleteSession).toHaveBeenCalledWith('session-1'));
    });

    it('keeps the current inspection when the wheel scrolls over the viewport', async () => {
        render(<ModelInspectorPopup language={Language.CHINESE} activeImage={activeImage} activeModelTask='detect'/>);

        const capture = await screen.findByTestId('inspector-capture');
        const viewport = await screen.findByTestId('inspector-view-a');
        fireEvent.wheel(viewport, {deltaY: 120});

        expect(screen.getByTestId('inspector-view-a')).toBeInTheDocument();
        expect(capture).toHaveTextContent('重新生成 2 层透视');
        expect(ModelInspectorAPI.createSession).toHaveBeenCalledTimes(1);
        expect(ModelInspectorAPI.deleteSession).not.toHaveBeenCalled();
    });

    it('scrolls the stage ribbon with the wheel and changes layers from the canvas arrows', async () => {
        render(<ModelInspectorPopup language={Language.CHINESE} activeImage={activeImage} activeModelTask='detect'/>);

        const viewport = await screen.findByTestId('inspector-view-a');
        const ribbon = screen.getByTestId('inspector-stage-ribbon');
        Object.defineProperty(ribbon, 'clientWidth', {configurable: true, value: 320});
        Object.defineProperty(ribbon, 'scrollWidth', {configurable: true, value: 960});
        Object.defineProperty(ribbon, 'scrollLeft', {configurable: true, writable: true, value: 0});
        fireEvent.wheel(ribbon, {deltaY: 120});

        expect(ribbon.scrollLeft).toBe(120);
        expect(viewport).toHaveTextContent('model.0');

        fireEvent.click(screen.getByRole('button', {name: '下一层透视'}));
        expect(screen.getByTestId('inspector-view-a')).toHaveTextContent('model.1');
        expect(screen.getByRole('button', {name: '上一层透视'})).not.toBeDisabled();
    });

    it('only exposes the model slot that matches the current inference task', async () => {
        const segmentationStatus: InspectorStatus = {
            ...status,
            slots: [
                status.slots[0],
                {
                    slot: 'segmentation', state: 'ready', model: 'FastSAM-s.pt', runtime: 'pytorch',
                    family: 'fastsam', supports_activations: true, supports_attribution: true, reason: null,
                },
            ],
        };
        (ModelInspectorAPI.status as jest.Mock).mockResolvedValue(segmentationStatus);
        (ModelInspectorAPI.layers as jest.Mock).mockResolvedValue({
            ...catalog,
            slot: 'segmentation',
            model: 'FastSAM-s.pt',
            family: 'fastsam',
        });
        (ModelInspectorAPI.createSession as jest.Mock).mockResolvedValue({
            ...session,
            slot: 'segmentation',
            model: 'FastSAM-s.pt',
            family: 'fastsam',
        });

        render(<ModelInspectorPopup language={Language.CHINESE} activeImage={activeImage} activeModelTask='segment'/>);

        const capture = await screen.findByTestId('inspector-capture');
        expect(screen.getByText('分割模型')).toBeInTheDocument();
        expect(screen.getByText('FastSAM-s.pt')).toBeInTheDocument();
        expect(screen.queryByText('yolo11n.pt')).not.toBeInTheDocument();
        expect(await screen.findByTestId('inspector-view-a')).toBeInTheDocument();
        expect(capture).toHaveTextContent('重新生成 2 层透视');

        expect(ModelInspectorAPI.createSession).toHaveBeenCalledWith(
            activeImage.fileData,
            'segmentation',
            ['layer-a', 'layer-b'],
            expect.objectContaining({imgsz: 640, topK: 8, maxSide: 256}),
            expect.any(AbortSignal),
        );
    });

    it('captures the full-resolution decoded frame for an on-demand video placeholder', async () => {
        const placeholderFrame: ImageData = {
            ...activeImage,
            id: 'video-frame-6230',
            fileData: new File([], 'frame_006230.jpg', {type: 'image/jpeg'}),
        };
        const decodedFrame = new Image();
        decodedFrame.src = 'blob:decoded-video-frame';
        Object.defineProperty(decodedFrame, 'naturalWidth', {configurable: true, value: 1920});
        Object.defineProperty(decodedFrame, 'naturalHeight', {configurable: true, value: 1080});
        EditorModel.videoFrameImage = decodedFrame;
        EditorModel.playbackImageData = placeholderFrame;
        const drawImage = jest.fn();
        const getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext')
            .mockReturnValue({drawImage} as unknown as CanvasRenderingContext2D);
        const toBlob = jest.spyOn(HTMLCanvasElement.prototype, 'toBlob')
            .mockImplementation(callback => callback(new Blob(['frame'], {type: 'image/png'})));

        render(<ModelInspectorPopup
            language={Language.CHINESE}
            activeImage={placeholderFrame}
            activeModelTask='detect'
        />);

        await screen.findByTestId('inspector-view-a');
        expect(drawImage).toHaveBeenCalledWith(decodedFrame, 0, 0, 1920, 1080);
        expect(ModelInspectorAPI.createSession).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'video-frame-6230.png',
                type: 'image/png',
            }),
            'detection',
            ['layer-a', 'layer-b'],
            expect.objectContaining({imgsz: 640, topK: 8, maxSide: 256}),
            expect.any(AbortSignal),
        );

        getContext.mockRestore();
        toBlob.mockRestore();
    });

    it('selects all filtered layers and prepares automatic batches', async () => {
        const manyLayers = Array.from({length: 34}, (_, index) => ({
            id: `layer-${index}`,
            path: `model.${index}`,
            type: 'Conv',
            group: 'Backbone',
            depth: 2,
            parameters: 0,
            default_selected: false,
        }));
        (ModelInspectorAPI.layers as jest.Mock).mockResolvedValue({
            ...catalog,
            layers: manyLayers,
            default_layer_ids: [],
        });

        render(<ModelInspectorPopup language={Language.CHINESE} activeImage={activeImage} activeModelTask='detect'/>);

        const capture = await screen.findByTestId('inspector-capture');
        await waitFor(() => expect(capture).toHaveTextContent('生成 0 层透视'));
        await screen.findByText('model.33');
        fireEvent.click(screen.getByRole('button', {name: /全选/}));

        await waitFor(() => expect(capture).toHaveTextContent('生成 34 层透视 · 2 批'));
        expect(screen.getByText('34 层待捕获 · 自动分 2 批')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        await act(async () => fireEvent.click(capture));
        expect(ModelInspectorAPI.createSession).toHaveBeenCalledWith(
            activeImage.fileData,
            'detection',
            manyLayers.map(layer => layer.id),
            {imgsz: 640, topK: 4, maxSide: 160},
            expect.any(AbortSignal),
        );

        const escapeEvent = new Event(MODEL_INSPECTOR_ESCAPE_EVENT, {cancelable: true});
        act(() => window.dispatchEvent(escapeEvent));
        expect(escapeEvent.defaultPrevented).toBe(true);
        await waitFor(() => expect(capture).toHaveTextContent('生成 0 层透视'));

        const emptyEscapeEvent = new Event(MODEL_INSPECTOR_ESCAPE_EVENT, {cancelable: true});
        act(() => window.dispatchEvent(emptyEscapeEvent));
        expect(emptyEscapeEvent.defaultPrevented).toBe(false);
    });

    it('explains how to enable the plugin when status cannot be reached', async () => {
        (ModelInspectorAPI.status as jest.Mock).mockRejectedValue(new Error('offline'));

        render(<ModelInspectorPopup language={Language.ENGLISH} activeImage={activeImage} activeModelTask='detect'/>);

        expect(await screen.findByText('Plugin unavailable')).toBeInTheDocument();
        expect(screen.getByText('OPENSIGHT_PLUGIN_MODEL_INSPECTOR_ENABLED=true')).toBeInTheDocument();
    });
});
