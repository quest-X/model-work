import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {CameraResourceService} from '../../../../services/CameraResourceService';
import {QueueItem} from '../../../../store/queue/types';
import {CanvasMultiViewStore} from '../../MultiView/CanvasMultiViewStore';
import CameraPlayer from '../CameraPlayer';

jest.mock('../../../../services/CameraResourceService', () => ({
    CameraResourceService: {
        streamUrl: (_resourceId: string, _channelId: string, nonce: number) => `http://camera.test/live?nonce=${nonce}`,
        controls: jest.fn(() => new Promise(() => undefined)),
        autoExposure: jest.fn(),
        autoFocus: jest.fn(),
        restoreExposure: jest.fn(),
        restoreFocus: jest.fn(),
    },
}));

jest.mock('../../../../services/CameraParameterService', () => ({
    CameraParameterService: {
        compare: () => new Promise(() => undefined),
    },
}));

describe('CameraPlayer', () => {
    const drawImage = jest.fn();
    const context = {
        beginPath: jest.fn(),
        clearRect: jest.fn(),
        closePath: jest.fn(),
        drawImage,
        fill: jest.fn(),
        fillRect: jest.fn(),
        fillText: jest.fn(),
        lineTo: jest.fn(),
        moveTo: jest.fn(),
        stroke: jest.fn(),
        fillStyle: '',
        font: '',
        lineWidth: 1,
        strokeStyle: '',
        textAlign: 'start',
    } as unknown as CanvasRenderingContext2D;
    const item = {
        id: 'camera-resource-1',
        name: 'Camera 01',
        cameraResourceId: 'resource-1',
        cameraChannelId: '102',
        cameraHost: '192.168.10.12',
        cameraModel: 'DS-2CD2686FWDA2-IZS',
    } as QueueItem;

    beforeEach(() => {
        act(() => CanvasMultiViewStore.setLayout('1x1'));
        drawImage.mockClear();
        (CameraResourceService.controls as jest.Mock).mockReset().mockImplementation(() => new Promise(() => undefined));
        (CameraResourceService.autoExposure as jest.Mock).mockReset();
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    });

    afterEach(() => {
        act(() => CanvasMultiViewStore.setLayout('1x1'));
        jest.restoreAllMocks();
    });

    it('shows the camera IP beside the live status without repeating it in metadata', () => {
        const {container} = render(<CameraPlayer item={item} language={Language.CHINESE}/>);

        expect(container.querySelector('.CameraPlayerIdentity strong')).toHaveTextContent('192.168.10.12');
        expect(container.querySelector('.CameraPlayerIdentity strong')).not.toHaveTextContent('Camera 01');
        expect(container.querySelector('.CameraPlayerMeta')).not.toHaveTextContent('192.168.10.12');
        expect(container.querySelector('.CameraPlayerMeta')).toHaveTextContent('DS-2CD2686FWDA2-IZS');
    });

    it('uses Smart controls as a panel launcher instead of an on/off switch', () => {
        render(<CameraPlayer item={item} language={Language.CHINESE}/>);

        const openButton = screen.getByRole('button', {name: '智能调节'});
        expect(openButton).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('button', {name: '关闭相机控制'})).not.toBeInTheDocument();

        fireEvent.click(openButton);
        expect(openButton).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('button', {name: '关闭相机控制'})).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '关闭相机控制'}));
        expect(openButton).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('button', {name: '关闭相机控制'})).not.toBeInTheDocument();
    });

    it('opens the camera parameter comparison and closes smart controls', () => {
        render(<CameraPlayer item={item} language={Language.CHINESE}/>);

        fireEvent.click(screen.getByRole('button', {name: '智能调节'}));
        expect(screen.getByRole('button', {name: '关闭相机控制'})).toBeInTheDocument();

        const parametersButton = screen.getByRole('button', {name: '相机参数'});
        expect(parametersButton).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(parametersButton);

        expect(screen.queryByRole('button', {name: '关闭相机控制'})).not.toBeInTheDocument();
        expect(parametersButton).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('button', {name: '关闭相机参数'})).toBeInTheDocument();
    });

    it('locks the original frame on the left across live updates and layout changes', async () => {
        const metrics = {luma: 0.3, saturation_ratio: 0.01, dark_ratio: 0.1, focus_score: 100, width: 640, height: 360};
        const state = {
            exposure: {mode: 'auto', shutter_us: 10000, gain_level: 20},
            focus: {mode: 'auto', position: 0, relative_position: 0, speed_level: 1},
        };
        (CameraResourceService.controls as jest.Mock).mockResolvedValue({
            capabilities: {auto_exposure: true, manual_exposure: true, exposure_metrics: true, auto_focus: true, focus_metrics: true},
            active: {auto_exposure: false, auto_focus: false},
            state,
            metrics,
        });
        (CameraResourceService.autoExposure as jest.Mock).mockResolvedValue({
            action: 'auto_exposure',
            message: 'ok',
            active: {auto_exposure: true, auto_focus: false},
            state,
            after: metrics,
        });
        act(() => CanvasMultiViewStore.setLayout('1x2'));
        render(<CameraPlayer item={item} language={Language.CHINESE}/>);

        expect(screen.getByText('原始画面')).toBeInTheDocument();
        expect(screen.getByText('调节效果')).toBeInTheDocument();
        const liveImage = screen.getByRole('img', {name: 'Camera 01 调节效果画面'});
        Object.defineProperty(liveImage, 'naturalWidth', {configurable: true, value: 640});
        Object.defineProperty(liveImage, 'naturalHeight', {configurable: true, value: 360});
        fireEvent.load(liveImage);

        await waitFor(() => expect(drawImage).toHaveBeenCalledWith(liveImage, 0, 0, 640, 360));
        await waitFor(() => expect(screen.getByLabelText('Camera 01 原始画面')).toHaveClass('visible'));
        expect(screen.getByText('已锁定')).toBeInTheDocument();

        fireEvent.load(liveImage);
        act(() => CanvasMultiViewStore.setLayout('1x1'));
        act(() => CanvasMultiViewStore.setLayout('1x2'));

        expect(screen.getByLabelText('Camera 01 原始画面')).toHaveClass('visible');
        expect(screen.queryByRole('button', {name: '更新原始画面'})).not.toBeInTheDocument();
        expect(drawImage).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', {name: '智能调节'}));
        const exposureButton = await screen.findByRole('button', {name: '自动曝光'});
        await waitFor(() => expect(exposureButton).not.toBeDisabled());
        fireEvent.click(exposureButton);
        await waitFor(() => expect(CameraResourceService.autoExposure).toHaveBeenCalled());
        await screen.findByText('ok');
        expect(drawImage).toHaveBeenCalledTimes(1);
    });

    it('freezes the current frame on pause and reconnects to the latest frame on resume', () => {
        render(<CameraPlayer item={item} language={Language.CHINESE}/>);

        const liveImage = screen.getByRole('img', {name: 'Camera 01 实时画面'});
        Object.defineProperty(liveImage, 'naturalWidth', {configurable: true, value: 640});
        Object.defineProperty(liveImage, 'naturalHeight', {configurable: true, value: 360});
        fireEvent.load(liveImage);

        fireEvent.click(screen.getByRole('button', {name: /暂停/}));
        expect(drawImage).toHaveBeenCalledWith(liveImage, 0, 0, 640, 360);
        expect(screen.queryByRole('img', {name: 'Camera 01 实时画面'})).not.toBeInTheDocument();
        expect(screen.getByLabelText('Camera 01 暂停画面')).toHaveClass('visible');
        expect(screen.getByText('已暂停')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: /播放/}));
        expect(screen.getByRole('img', {name: 'Camera 01 实时画面'})).toBeInTheDocument();
        expect(screen.getByText('连接中')).toBeInTheDocument();
        expect(screen.getByLabelText('相机直播进度条')).toHaveAttribute('height', '80');
    });

    it('keeps playback disabled until the first live frame loads', () => {
        render(<CameraPlayer item={item} language={Language.CHINESE}/>);
        expect(screen.getByRole('button', {name: /播放/})).toBeDisabled();
    });
});
