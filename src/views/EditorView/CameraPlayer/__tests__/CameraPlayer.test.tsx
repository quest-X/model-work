import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {QueueItem} from '../../../../store/queue/types';
import {CanvasMultiViewStore} from '../../MultiView/CanvasMultiViewStore';
import CameraPlayer from '../CameraPlayer';

jest.mock('../../../../services/CameraResourceService', () => ({
    CameraResourceService: {
        streamUrl: (_resourceId: string, _channelId: string, nonce: number, branch: string) => `http://camera.test/live?branch=${branch}&nonce=${nonce}`,
    },
}));

jest.mock('../../../../services/CameraPreviewService', () => ({
    CameraPreviewService: {get: () => new Promise(() => undefined)},
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

    it('uses Smart controls as a panel launcher and closes it from outside', () => {
        const {container} = render(<CameraPlayer item={item} language={Language.CHINESE}/>);

        const openButton = screen.getByRole('button', {name: '智能调参'});
        expect(openButton).toHaveAttribute('aria-expanded', 'false');
        expect(container.querySelector('#camera-smart-controls')).not.toBeInTheDocument();

        fireEvent.click(openButton);
        expect(openButton).toHaveAttribute('aria-expanded', 'true');
        expect(container.querySelector('#camera-smart-controls')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '关闭相机控制'})).not.toBeInTheDocument();

        fireEvent.mouseDown(document.body);
        expect(openButton).toHaveAttribute('aria-expanded', 'false');
        expect(container.querySelector('#camera-smart-controls')).not.toBeInTheDocument();
    });

    it('opens the camera parameter comparison and closes smart controls', () => {
        const {container} = render(<CameraPlayer item={item} language={Language.CHINESE}/>);

        fireEvent.click(screen.getByRole('button', {name: '智能调参'}));
        expect(container.querySelector('#camera-smart-controls')).toBeInTheDocument();

        const parametersButton = screen.getByRole('button', {name: '相机参数'});
        expect(parametersButton).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(parametersButton);

        expect(container.querySelector('#camera-smart-controls')).not.toBeInTheDocument();
        expect(parametersButton).toHaveAttribute('aria-expanded', 'true');
        expect(container.querySelector('#camera-parameters-panel')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '关闭相机参数'})).not.toBeInTheDocument();

        fireEvent.keyDown(window, {key: 'Escape'});
        expect(parametersButton).toHaveAttribute('aria-expanded', 'false');
        expect(container.querySelector('#camera-parameters-panel')).not.toBeInTheDocument();
    });

    it('shows two independent LIVE logical branches in comparison mode', () => {
        act(() => CanvasMultiViewStore.setLayout('1x2'));
        render(<CameraPlayer item={item} language={Language.CHINESE}/>);

        expect(screen.getByText('原始画面')).toBeInTheDocument();
        expect(screen.getByText('调参效果')).toBeInTheDocument();
        expect(screen.getByText('1011 · LIVE')).toBeInTheDocument();
        expect(screen.getByText('1012 · LIVE')).toBeInTheDocument();
        expect(screen.getByRole('img', {name: 'Camera 01 原始实时画面'})).toHaveAttribute('src', expect.stringContaining('branch=original'));
        expect(screen.getByRole('img', {name: 'Camera 01 调参效果画面'})).toHaveAttribute('src', expect.stringContaining('branch=adjusted'));
        expect(screen.getByText('正在建立原始画面…')).toBeInTheDocument();
        expect(screen.getByText('正在建立调参画面…')).toBeInTheDocument();
        expect(screen.queryByText('已锁定')).not.toBeInTheDocument();
        expect(drawImage).not.toHaveBeenCalled();

        fireEvent.load(screen.getByRole('img', {name: 'Camera 01 原始实时画面'}));
        expect(screen.queryByText('正在建立原始画面…')).not.toBeInTheDocument();
        expect(screen.getByText('正在建立调参画面…')).toBeInTheDocument();

        fireEvent.load(screen.getByRole('img', {name: 'Camera 01 调参效果画面'}));
        expect(screen.queryByText('正在建立调参画面…')).not.toBeInTheDocument();
    });

    it('reports original and adjusted stream failures independently', () => {
        act(() => CanvasMultiViewStore.setLayout('1x2'));
        render(<CameraPlayer item={item} language={Language.CHINESE}/>);

        fireEvent.error(screen.getByRole('img', {name: 'Camera 01 原始实时画面'}));
        expect(screen.getByText('原始画面连接失败')).toBeInTheDocument();
        expect(screen.getByText('正在建立调参画面…')).toBeInTheDocument();

        fireEvent.error(screen.getByRole('img', {name: 'Camera 01 调参效果画面'}));
        expect(screen.getByText('调参画面连接失败')).toBeInTheDocument();
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
