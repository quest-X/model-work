import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Language} from '../../../data/LanguageConfig';
import {CameraResourceService} from '../../../services/CameraResourceService';
import {QueueItem} from '../../../store/queue/types';
import CameraTimeline from '../CameraTimeline/CameraTimeline';
import {CanvasMultiViewStore} from '../MultiView/CanvasMultiViewStore';
import CameraControlPanel from './CameraControlPanel';
import CameraParametersPanel from './CameraParametersPanel';
import './CameraPlayer.scss';

interface IProps {
    item: QueueItem;
    language: Language;
}

const CameraPlayer: React.FC<IProps> = ({item, language}) => {
    const chinese = language === Language.CHINESE;
    const cameraDisplayName = item.cameraHost || item.name;
    const imageRef = useRef<HTMLImageElement>(null);
    const originalImageRef = useRef<HTMLImageElement>(null);
    const frozenFrameRef = useRef<HTMLCanvasElement>(null);
    const originalFrozenFrameRef = useRef<HTMLCanvasElement>(null);
    const sourceIdentity = `${item.cameraResourceId || ''}:${item.cameraChannelId || ''}`;
    const previousSourceIdentityRef = useRef(sourceIdentity);
    const activePlaybackStartedAtRef = useRef<number | null>(null);
    const accumulatedPlaybackSecondsRef = useRef(0);
    const [nonce, setNonce] = useState(Date.now());
    const [state, setState] = useState<'loading' | 'playing' | 'error'>('loading');
    const [originalState, setOriginalState] = useState<'loading' | 'playing' | 'error'>('loading');
    const [isPaused, setIsPaused] = useState(false);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [controlsOpen, setControlsOpen] = useState(false);
    const [parametersOpen, setParametersOpen] = useState(false);
    const [canvasLayout, setCanvasLayout] = useState(CanvasMultiViewStore.get().layout);
    const comparisonMode = canvasLayout === '1x2';
    const adjustedStreamUrl = useMemo(() => CameraResourceService.streamUrl(
        item.cameraResourceId || '',
        item.cameraChannelId,
        nonce,
        'adjusted',
    ), [item.cameraResourceId, item.cameraChannelId, nonce]);
    const originalStreamUrl = useMemo(() => CameraResourceService.streamUrl(
        item.cameraResourceId || '',
        item.cameraChannelId,
        nonce,
        'original',
    ), [item.cameraResourceId, item.cameraChannelId, nonce]);

    useEffect(() => CanvasMultiViewStore.subscribe(value => setCanvasLayout(value.layout)), []);

    useEffect(() => {
        if (previousSourceIdentityRef.current === sourceIdentity) return;
        previousSourceIdentityRef.current = sourceIdentity;
        activePlaybackStartedAtRef.current = null;
        accumulatedPlaybackSecondsRef.current = 0;
        setElapsedSeconds(0);
        setIsPaused(false);
        setState('loading');
        setOriginalState('loading');
        setNonce(previous => previous + 1);
    }, [sourceIdentity]);

    useEffect(() => {
        if (state !== 'playing' || isPaused || activePlaybackStartedAtRef.current === null) return undefined;
        const updateElapsed = () => {
            const startedAt = activePlaybackStartedAtRef.current;
            if (startedAt === null) return;
            setElapsedSeconds(accumulatedPlaybackSecondsRef.current + (performance.now() - startedAt) / 1000);
        };
        updateElapsed();
        const timer = window.setInterval(updateElapsed, 250);
        return () => window.clearInterval(timer);
    }, [state, isPaused]);

    const reconnect = () => {
        activePlaybackStartedAtRef.current = null;
        accumulatedPlaybackSecondsRef.current = 0;
        setElapsedSeconds(0);
        setIsPaused(false);
        setState('loading');
        setOriginalState('loading');
        setNonce(previous => previous + 1);
    };

    const pause = () => {
        const image = imageRef.current;
        const canvas = frozenFrameRef.current;
        if (state !== 'playing' || !image || !canvas || !image.naturalWidth || !image.naturalHeight) return;

        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const originalImage = originalImageRef.current;
        const originalCanvas = originalFrozenFrameRef.current;
        if (
            comparisonMode
            && originalImage
            && originalCanvas
            && originalImage.naturalWidth
            && originalImage.naturalHeight
        ) {
            originalCanvas.width = originalImage.naturalWidth;
            originalCanvas.height = originalImage.naturalHeight;
            originalCanvas.getContext('2d')?.drawImage(
                originalImage,
                0,
                0,
                originalCanvas.width,
                originalCanvas.height,
            );
        }
        const startedAt = activePlaybackStartedAtRef.current;
        if (startedAt !== null) {
            accumulatedPlaybackSecondsRef.current += (performance.now() - startedAt) / 1000;
            activePlaybackStartedAtRef.current = null;
            setElapsedSeconds(accumulatedPlaybackSecondsRef.current);
        }
        setIsPaused(true);
    };

    const resume = () => {
        setIsPaused(false);
        setState('loading');
        setOriginalState('loading');
        setNonce(previous => previous + 1);
    };

    const togglePlayback = () => isPaused ? resume() : pause();

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) return;
            if (event.code !== 'Space' || (!isPaused && state !== 'playing')) return;
            event.preventDefault();
            togglePlayback();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isPaused, state]);

    return <div className='CameraPlayer'>
        <div className='CameraPlayerHeader'>
            <div className='CameraPlayerIdentity'>
                <span className={`CameraLiveDot ${isPaused ? 'paused' : state}`}/>
                <strong>{cameraDisplayName}</strong>
                <span className={`CameraLiveBadge ${isPaused ? 'paused' : ''}`}>
                    {isPaused ? (chinese ? '已暂停' : 'PAUSED') : (state === 'playing' ? 'LIVE' : (chinese ? '连接中' : 'CONNECTING'))}
                </span>
            </div>
            <div className='CameraPlayerMeta'>
                {item.cameraModel && <span>{item.cameraModel}</span>}
                {item.cameraChannelId && <span>{chinese ? '通道' : 'Channel'} {item.cameraChannelId}</span>}
                <button
                    type='button'
                    className={controlsOpen ? 'active' : ''}
                    aria-controls='camera-smart-controls'
                    aria-expanded={controlsOpen}
                    onClick={() => {
                        setParametersOpen(false);
                        setControlsOpen(true);
                    }}
                >
                    {chinese ? '智能调参' : 'Smart controls'}
                </button>
                <button
                    type='button'
                    className={parametersOpen ? 'active' : ''}
                    aria-controls='camera-parameters-panel'
                    aria-expanded={parametersOpen}
                    onClick={() => {
                        setControlsOpen(false);
                        setParametersOpen(true);
                    }}
                >
                    {chinese ? '相机参数' : 'Camera parameters'}
                </button>
                <button type='button' onClick={reconnect}>{chinese ? '重新连接' : 'Reconnect'}</button>
            </div>
        </div>
        <div className={`CameraPlayerStage ${comparisonMode ? 'comparison' : ''}`}>
            <div className={`CameraComparePane original ${comparisonMode ? '' : 'hidden'}`}>
                <div className='CameraCompareLabel'>
                    <strong>{chinese ? '原始画面' : 'Original'}</strong>
                    <span>1011 · {isPaused ? (chinese ? '已暂停' : 'PAUSED') : 'LIVE'}</span>
                </div>
                {originalState === 'loading' && !isPaused && <div className='CameraPlayerNotice'>
                    <span className='CameraPlayerSpinner'/>
                    {chinese ? '正在建立原始画面…' : 'Opening original stream…'}
                </div>}
                {originalState === 'error' && !isPaused && <div className='CameraPlayerNotice error'>
                    <strong>{chinese ? '原始画面连接失败' : 'Unable to open original stream'}</strong>
                    <span>{chinese ? '请检查相机网络、RTSP 端口和码流通道。' : 'Check the camera network, RTSP port, and stream channel.'}</span>
                    <button type='button' onClick={reconnect}>{chinese ? '重试' : 'Retry'}</button>
                </div>}
                <canvas
                    ref={originalFrozenFrameRef}
                    className={isPaused ? 'CameraBaselineFrame visible' : 'CameraBaselineFrame'}
                    aria-label={chinese ? `${item.name} 原始暂停画面` : `${item.name} paused original frame`}
                />
                {!isPaused && <img
                    ref={originalImageRef}
                    key={`original-${nonce}`}
                    src={originalStreamUrl}
                    alt={chinese ? `${item.name} 原始实时画面` : `${item.name} original live stream`}
                    onLoad={() => setOriginalState('playing')}
                    onError={() => setOriginalState('error')}
                    draggable={false}
                />}
            </div>
            <div className='CameraComparePane effect'>
                {comparisonMode && <div className='CameraCompareLabel'>
                    <strong>{chinese ? '调参效果' : 'Adjusted result'}</strong>
                    <span>1012 · {isPaused ? (chinese ? '已暂停' : 'PAUSED') : 'LIVE'}</span>
                </div>}
                {state === 'loading' && <div className='CameraPlayerNotice'>
                    <span className='CameraPlayerSpinner'/>
                    {comparisonMode
                        ? (chinese ? '正在建立调参画面…' : 'Opening adjusted stream…')
                        : (chinese ? '正在建立实时画面…' : 'Opening live stream…')}
                </div>}
                {state === 'error' && <div className='CameraPlayerNotice error'>
                    <strong>{comparisonMode
                        ? (chinese ? '调参画面连接失败' : 'Unable to open adjusted stream')
                        : (chinese ? '实时画面连接失败' : 'Unable to open live stream')}</strong>
                    <span>{chinese ? '请检查相机网络、RTSP 端口和码流通道。' : 'Check the camera network, RTSP port, and stream channel.'}</span>
                    <button type='button' onClick={reconnect}>{chinese ? '重试' : 'Retry'}</button>
                </div>}
                <canvas
                    ref={frozenFrameRef}
                    className={isPaused ? 'CameraFrozenFrame visible' : 'CameraFrozenFrame'}
                    aria-label={chinese ? `${item.name} 暂停画面` : `${item.name} paused frame`}
                />
                {!isPaused && <img
                    ref={imageRef}
                    key={nonce}
                    src={adjustedStreamUrl}
                    alt={comparisonMode
                        ? (chinese ? `${item.name} 调参效果画面` : `${item.name} adjusted live stream`)
                        : (chinese ? `${item.name} 实时画面` : `${item.name} live stream`)}
                    onLoad={() => {
                        if (activePlaybackStartedAtRef.current === null) {
                            activePlaybackStartedAtRef.current = performance.now();
                        }
                        setState('playing');
                    }}
                    onError={() => setState('error')}
                    draggable={false}
                />}
                {controlsOpen && item.cameraResourceId && <CameraControlPanel
                    resourceId={item.cameraResourceId}
                    language={language}
                    onStreamChanged={reconnect}
                    onClose={() => setControlsOpen(false)}
                />}
                {parametersOpen && item.cameraResourceId && <CameraParametersPanel
                    resourceId={item.cameraResourceId}
                    language={language}
                    onStreamChanged={reconnect}
                    onClose={() => setParametersOpen(false)}
                />}
            </div>
        </div>
        <CameraTimeline
            language={language}
            elapsedSeconds={elapsedSeconds}
            fps={10}
            isPlaying={state === 'playing' && !isPaused}
            canPlayPause={isPaused || state === 'playing'}
            onPlayPause={togglePlayback}
        />
    </div>;
};

export default CameraPlayer;
