import React, {useCallback, useEffect, useRef} from 'react';
import {Language} from '../../../data/LanguageConfig';
import '../VideoTimeline/VideoTimeline.scss';
import './CameraTimeline.scss';

interface IProps {
    language: Language;
    elapsedSeconds: number;
    fps: number;
    isPlaying: boolean;
    canPlayPause: boolean;
    onPlayPause: () => void;
}

const WINDOW_SECONDS = 5 * 60;
const VIDEO_TIMELINE_HEIGHT = 80;

const formatTime = (seconds: number): string => {
    const value = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(value / 60);
    return `${minutes}:${(value % 60).toString().padStart(2, '0')}`;
};

const CameraTimeline: React.FC<IProps> = ({
    language,
    elapsedSeconds,
    fps,
    isPlaying,
    canPlayPause,
    onPlayPause,
}) => {
    const chinese = language === Language.CHINESE;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const drawTimeline = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        if (!context) return;

        const width = canvas.width;
        const height = canvas.height;
        const current = Math.max(0, elapsedSeconds);
        const windowStart = Math.max(0, current - WINDOW_SECONDS);
        const visibleDuration = WINDOW_SECONDS;
        const position = current < WINDOW_SECONDS ? current / WINDOW_SECONDS : 1;
        const currentX = Math.min(width, Math.max(0, position * width));

        context.clearRect(0, 0, width, height);
        context.fillStyle = '#1e1e1e';
        context.fillRect(0, 0, width, height);

        context.fillStyle = 'rgba(33, 150, 243, 0.3)';
        context.fillRect(0, 0, currentX, height - 30);

        const labelInterval = width >= 900 ? 30 : 60;
        const tickInterval = labelInterval / 5;
        context.strokeStyle = '#444';
        context.fillStyle = '#999';
        context.font = '10px sans-serif';
        context.textAlign = 'center';
        for (let offset = 0; offset <= visibleDuration; offset += tickInterval) {
            const x = (offset / visibleDuration) * width;
            const isLabelTick = offset % labelInterval === 0;
            const tickHeight = isLabelTick ? 15 : 8;
            context.beginPath();
            context.moveTo(x, height - tickHeight);
            context.lineTo(x, height);
            context.stroke();
            if (isLabelTick) context.fillText(formatTime(windowStart + offset), x, height - 20);
        }

        context.strokeStyle = isPlaying ? '#2196f3' : '#d99a3d';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(currentX, 0);
        context.lineTo(currentX, height);
        context.stroke();
        context.fillStyle = isPlaying ? '#2196f3' : '#d99a3d';
        context.beginPath();
        context.moveTo(currentX, height);
        context.lineTo(currentX - 6, height - 10);
        context.lineTo(currentX + 6, height - 10);
        context.closePath();
        context.fill();

        context.fillStyle = '#fff';
        context.font = '12px sans-serif';
        context.textAlign = 'right';
        context.fillText(`${formatTime(current)} / LIVE`, width - 10, 20);
    }, [elapsedSeconds, isPlaying]);

    useEffect(() => {
        drawTimeline();
    }, [drawTimeline]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return undefined;
        const updateSize = () => {
            const rect = container.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = VIDEO_TIMELINE_HEIGHT;
            drawTimeline();
        };
        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, [drawTimeline]);

    const currentFrame = Math.max(1, Math.floor(elapsedSeconds * fps) + 1);

    return <div className='VideoTimeline CameraTimeline' ref={containerRef}>
        <canvas
            ref={canvasRef}
            className='TimelineCanvas CameraTimelineCanvas'
            aria-label={chinese ? '相机直播进度条' : 'Camera live timeline'}
        />
        <div className='TimelineControls'>
            <div className='LeftInfo'>
                <span>{chinese ? '帧率' : 'FPS'}: {fps}</span>
                <span>{chinese ? '帧' : 'Frame'}: {currentFrame} / LIVE</span>
            </div>
            <div className='CenterControls'>
                <button
                    type='button'
                    onClick={onPlayPause}
                    className='PlayPauseButton'
                    disabled={!canPlayPause}
                >
                    {isPlaying
                        ? `⏸ ${chinese ? '暂停' : 'Pause'}`
                        : `▶ ${chinese ? '播放' : 'Play'}`}
                </button>
                <button
                    type='button'
                    className='MuteButton CameraMuteButton'
                    disabled
                    title={chinese ? '当前相机实时流不包含音频' : 'The current camera stream has no audio'}
                    aria-label={chinese ? '静音（相机无音频）' : 'Muted (camera has no audio)'}
                >
                    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
                        <path d='M16.5 12C16.5 10.23 15.48 8.71 14 7.97V10.18L16.45 12.63C16.48 12.43 16.5 12.22 16.5 12Z' fill='currentColor'/>
                        <path d='M19 12C19 12.94 18.8 13.82 18.46 14.64L19.97 16.15C20.63 14.91 21 13.5 21 12C21 7.72 18.01 4.14 14 3.23V5.29C16.89 6.15 19 8.83 19 12Z' fill='currentColor'/>
                        <path d='M4.27 3L3 4.27L7.73 9H3V15H7L12 20V13.27L16.25 17.52C15.58 18.04 14.83 18.45 14 18.7V20.76C15.38 20.45 16.63 19.81 17.69 18.95L19.73 21L21 19.73L12 10.73L4.27 3ZM12 4L9.91 6.09L12 8.18V4Z' fill='currentColor'/>
                    </svg>
                </button>
            </div>
            <div className='RightInfo'>
                <div className='HelpText'>
                    <span>{chinese ? '直播会话进度' : 'Live session progress'}</span>
                    <span>{chinese ? '空格: 播放/暂停' : 'Space: Play/Pause'}</span>
                </div>
            </div>
        </div>
    </div>;
};

export default CameraTimeline;
