import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {QueueItem} from '../../../../store/queue/types';
import CameraPlayer from '../CameraPlayer';

jest.mock('../../../../services/CameraResourceService', () => ({
    CameraResourceService: {
        streamUrl: (_resourceId: string, _channelId: string, nonce: number) => `http://camera.test/live?nonce=${nonce}`,
        controls: () => new Promise(() => undefined),
        autoExposure: jest.fn(),
        autoFocus: jest.fn(),
        restoreExposure: jest.fn(),
        restoreFocus: jest.fn(),
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
        drawImage.mockClear();
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    });

    afterEach(() => jest.restoreAllMocks());

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
