import React, {useEffect, useRef, useState} from 'react';
import {useSelector} from 'react-redux';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {getEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import {ExporterUtil} from '../../../utils/ExporterUtil';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import './OCRPopup.scss';

interface OCRRegion {
    text: string;
    bbox: [number, number, number, number];
    confidence: number;
}

export const OCRPanel: React.FC<{language: Language}> = ({language}) => {
    const zh = language === Language.CHINESE;
    const [file, setFile] = useState<File | null>(null);
    const [model, setModel] = useState('ppocrv5_mobile');
    const [preview, setPreview] = useState('');
    const [size, setSize] = useState({width: 0, height: 0});
    const [results, setResults] = useState<OCRRegion[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const request = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!file) { setPreview(''); return; }
        const url = URL.createObjectURL(file);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);
    useEffect(() => () => {
        const active = request.current;
        request.current = null;
        active?.abort();
    }, []);

    const recognize = async () => {
        if (!file || busy) return;
        const controller = new AbortController();
        request.current = controller;
        setBusy(true);
        setError('');
        setResults(null);
        const timeout = window.setTimeout(() => controller.abort(), 10 * 60 * 1000);
        try {
            const body = new FormData();
            body.append('file', file);
            body.append('model', model);
            const response = await fetch(`${getEngineBaseUrl()}/ocr`, {method: 'POST', body, signal: controller.signal});
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
            if (!Array.isArray(data.results) || data.results.some((row: OCRRegion) =>
                typeof row.text !== 'string' || !Array.isArray(row.bbox) || row.bbox.length !== 4
                || row.bbox.some(value => !Number.isFinite(value)) || !Number.isFinite(row.confidence))) {
                throw new Error(zh ? '识别结果格式错误' : 'Invalid OCR response');
            }
            if (!controller.signal.aborted) {
                setResults(data.results);
                window.dispatchEvent(new Event('opensight:model-loaded'));
            }
        } catch (failure) {
            if (request.current === controller) setError(controller.signal.aborted
                ? (zh ? '已停止等待；服务端当前推理或下载可能仍在运行。' : 'Stopped waiting; server inference or download may still be running.')
                : (failure instanceof Error ? failure.message : String(failure)));
        } finally {
            window.clearTimeout(timeout);
            if (request.current === controller) { request.current = null; setBusy(false); }
        }
    };

    const exportResults = () => {
        try {
            ExporterUtil.saveAs(JSON.stringify({image: file?.name, model, results}, null, 2), 'ocr-results.json');
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
        }
    };

    const chooseImage = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selected = event.target.files?.[0] || null;
        setResults(null); setSize({width: 0, height: 0});
        if (selected && selected.size > 64 * 1024 * 1024) {
            setFile(null); setError(zh ? '图片不能超过 64 MB' : 'Image must be under 64 MB');
        } else { setFile(selected); setError(''); }
    };
    const renderPreview = () => preview && <div className='OCRPreview'>
        <img src={preview} alt={file?.name || ''} onLoad={event => setSize({
            width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight,
        })}/>
        {size.width > 0 && results && <svg aria-label={zh ? '识别区域' : 'Recognized regions'}
            viewBox={`0 0 ${size.width} ${size.height}`}>
            {results.map((row, index) => <rect key={index} x={row.bbox[0]} y={row.bbox[1]}
                width={row.bbox[2] - row.bbox[0]} height={row.bbox[3] - row.bbox[1]}>
                <title>{row.text}</title>
            </rect>)}
        </svg>}
    </div>;
    const renderResults = () => results !== null && <>
        <p role='status'>{zh ? `识别到 ${results.length} 个文字区域` : `${results.length} text regions found`}</p>
        <table><thead><tr><th>{zh ? '文字' : 'Text'}</th><th>{zh ? '置信度' : 'Confidence'}</th>
            <th>{zh ? '原图坐标 (x1, y1, x2, y2)' : 'Source coordinates (x1, y1, x2, y2)'}</th></tr></thead>
            <tbody>{results.map((row, index) => <tr key={index}><td>{row.text}</td>
                <td>{(row.confidence * 100).toFixed(1)}%</td><td>{row.bbox.map(Math.round).join(', ')}</td></tr>)}</tbody>
        </table>
    </>;

    return <GenericYesNoPopup title={zh ? '文字识别 OCR' : 'Text Recognition OCR'}
        skipAcceptButton rejectLabel={zh ? '关闭' : 'Close'} onReject={() => PopupActions.close()}
        renderContent={() => <div className='OCRPanel'>
            <p>{zh ? '识别图片中的中英文，查看文字、置信度和原图坐标。首次使用会下载模型。'
                : 'Recognize Chinese and English text with confidence and source-image coordinates. Models download on first use.'}</p>
            <div className='OCRControls'>
                <label>{zh ? '图片' : 'Image'}<input type='file' disabled={busy} aria-label={zh ? '图片' : 'Image'}
                    accept='image/png,image/jpeg,image/webp,image/bmp,image/tiff'
                    onChange={chooseImage}/></label>
                <label>{zh ? '模型' : 'Model'}<select value={model} disabled={busy} aria-label={zh ? '模型' : 'Model'}
                    onChange={event => { setModel(event.target.value); setResults(null); setError(''); }}>
                    <option value='ppocrv5_mobile'>PP-OCRv5 Mobile</option>
                    <option value='ppocrv5_server'>PP-OCRv5 Server</option>
                </select></label>
                <button type='button' disabled={!file || busy} onClick={recognize}>{zh ? '识别' : 'Recognize'}</button>
                {busy && <button type='button' onClick={() => request.current?.abort()}>{zh ? '停止等待' : 'Stop waiting'}</button>}
                {results !== null && <button type='button' onClick={exportResults}>{zh ? '导出 JSON' : 'Export JSON'}</button>}
            </div>
            {busy && <p role='status'>{zh ? '正在加载模型或识别图片…' : 'Loading model or recognizing image…'}</p>}
            {error && <p role='alert' className='OCRError'>{error}</p>}
            {renderPreview()}
            {renderResults()}
        </div>}/>;
};

export default function OCRPopup() {
    const language = useSelector((state: AppState) => state.general.language);
    return <OCRPanel language={language}/>;
}
