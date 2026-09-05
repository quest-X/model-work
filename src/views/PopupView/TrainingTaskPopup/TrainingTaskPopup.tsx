import React, {useEffect, useState} from 'react';
import {connect} from 'react-redux';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {getEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import {TrainingDatasetSelection} from '../../../services/TrainingDatasetSelection';
import './TrainingTaskPopup.scss';

interface DatasetSummary {
    id: string;
    name: string;
    image_count: number;
    classes: string[];
}

interface TrainingJobProgress {
    epoch: number;
    total_epochs: number;
    metrics: Record<string, number>;
}

interface TrainingJobStatus {
    job_id: string;
    state: string;
    name?: string;
    dataset_id?: string;
    error?: string;
    progress: TrainingJobProgress;
    produced_model?: string;
}

interface IProps {
    language: Language;
}

const POLL_INTERVAL_MS = 3000;

const validTrainingOptions = (weights: string, epochs: number, imgsz: number, batch: number): boolean =>
    !!weights.trim() && Number.isInteger(epochs) && epochs >= 1 && epochs <= 100000
    && Number.isInteger(imgsz) && imgsz >= 32 && imgsz <= 4096
    && Number.isInteger(batch) && batch >= 1 && batch <= 256;

const requestJson = async (url: string, options?: RequestInit) => {
    const response = await fetch(url, options);
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${response.status}`);
    return body;
};

const getJobDatasetLabel = (
    datasets: DatasetSummary[],
    datasetId: string | undefined,
    zh: boolean,
): string => {
    if (!datasetId) return zh ? '未记录' : 'Not recorded';
    return datasets.find(dataset => dataset.id === datasetId)?.name || datasetId;
};

export const TrainingTaskPopup: React.FC<IProps> = ({language}) => {
    const zh = language === Language.CHINESE;
    const baseUrl = getEngineBaseUrl();
    const weightsHint = zh
        ? '使用已下载或上传的 .pt 模型。框标注用 yolov8n；多边形分割标注用 yolov8n-seg。'
        : 'Use a saved .pt model: yolov8n for boxes, yolov8n-seg for polygon segmentation labels.';

    const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
    const [selectedDatasetId, setSelectedDatasetId] = useState<string>(
        () => TrainingDatasetSelection.get() || '',
    );
    const [epochs, setEpochs] = useState(100);
    const [imgsz, setImgsz] = useState(640);
    const [batch, setBatch] = useState(16);
    const [weights, setWeights] = useState('yolov8n');
    const [device, setDevice] = useState('auto');
    const [jobs, setJobs] = useState<TrainingJobStatus[]>([]);
    const [createError, setCreateError] = useState<string | null>(null);
    const [queryError, setQueryError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [logs, setLogs] = useState<Record<string, string>>({});
    const canStart = !busy && !!selectedDatasetId && validTrainingOptions(weights, epochs, imgsz, batch)
        && !jobs.some(job => ['running', 'queued'].includes(job.state));

    useEffect(() => {
        requestJson(`${baseUrl}/datasets`).then(data => {
            if (Array.isArray(data.datasets)) {
                setDatasets(data.datasets);
                setSelectedDatasetId((previous) => {
                    const preferred = TrainingDatasetSelection.get();
                    const next = data.datasets.some((dataset: DatasetSummary) => dataset.id === preferred)
                        ? preferred as string
                        : data.datasets.some((dataset: DatasetSummary) => dataset.id === previous)
                            ? previous
                            : data.datasets[0]?.id || '';
                    TrainingDatasetSelection.set(next || null);
                    return next;
                });
            }
        }).catch(e => setCreateError(e.message));
    }, [baseUrl]);

    const refreshJobs = () => {
        return requestJson(`${baseUrl}/training/jobs`).then(data => {
            if (!Array.isArray(data.jobs)) throw new Error(zh ? '训练任务响应无效' : 'Invalid jobs response');
            setJobs(data.jobs);
            setQueryError(null);
        }).catch(e => setQueryError(e.message));
    };

    useEffect(() => {
        refreshJobs();
        const timer = setInterval(refreshJobs, POLL_INTERVAL_MS);
        return () => clearInterval(timer);
        // eslint-disable-next-line
    }, [baseUrl]);

    const startTraining = () => {
        if (!selectedDatasetId) return;
        setCreateError(null);
        setBusy(true);
        requestJson(`${baseUrl}/training/jobs`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                dataset_id: selectedDatasetId,
                model_type: weights.trim(),
                device,
                epochs,
                imgsz,
                batch,
            }),
        }).then(refreshJobs).catch((e) => setCreateError(e.message)).finally(() => setBusy(false));
    };

    const cancelJob = (jobId: string) => {
        setCreateError(null);
        setBusy(true);
        requestJson(`${baseUrl}/training/jobs/${jobId}/cancel`, {method: 'POST'})
            .then(refreshJobs).catch(e => setCreateError(e.message)).finally(() => setBusy(false));
    };

    const loadIntoInference = (job: TrainingJobStatus) => {
        if (!job.produced_model) return;
        setCreateError(null);
        setBusy(true);
        setNotice(zh ? '正在加载模型…' : 'Loading model…');
        // switch-model resolves the saved model's slot and waits for actual readiness.
        requestJson(`${baseUrl}/switch-model`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({model: job.produced_model}),
        }).then(() => {
            setNotice(zh ? '模型已加载，可进入推理任务' : 'Model ready for inference');
            window.dispatchEvent(new CustomEvent('opensight:model-loaded'));
        }).catch(e => {
            setNotice('');
            setCreateError(e.message);
        }).finally(() => setBusy(false));
    };

    const readLog = (jobId: string) => {
        requestJson(`${baseUrl}/training/jobs/${jobId}/log`)
            .then(data => setLogs(previous => ({...previous, [jobId]: data.log || (zh ? '暂无日志' : 'No log yet')})))
            .catch(e => setLogs(previous => ({...previous, [jobId]: e.message})));
    };

    const stateLabel = (state: string): string => {
        const map: Record<string, [string, string]> = {
            queued: ['排队中', 'Queued'],
            running: ['训练中', 'Running'],
            completed: ['已完成', 'Completed'],
            failed: ['失败', 'Failed'],
            cancelled: ['已取消', 'Cancelled'],
        };
        const pair = map[state];
        return pair ? (zh ? pair[0] : pair[1]) : state;
    };

    const renderContent = () => (
        <div className='TrainingTaskPopupContent'>
            <div className='FormSection'>
                <div className='SectionHeader'>{zh ? '新建训练任务' : 'New Training Job'}</div>
                <div className='FormRow'>
                    <label htmlFor='training-dataset'>{zh ? '数据集' : 'Dataset'}</label>
                    <select id='training-dataset' value={selectedDatasetId} onChange={(e) => {
                        setSelectedDatasetId(e.target.value);
                        TrainingDatasetSelection.set(e.target.value || null);
                    }}>
                        {datasets.length === 0 && <option value=''>{zh ? '暂无数据集' : 'No datasets'}</option>}
                        {datasets.map(ds => (
                            <option key={ds.id} value={ds.id}>{ds.name} ({ds.image_count})</option>
                        ))}
                    </select>
                </div>
                <div className='FormRow'>
                    <label htmlFor='training-weights'>{zh ? '起始权重' : 'Base weights'}</label>
                    <input id='training-weights' value={weights} onChange={e => setWeights(e.target.value)} />
                </div>
                <p className='EmptyHint'>{weightsHint}</p>
                <div className='FormRow'>
                    <label htmlFor='training-device'>{zh ? '训练设备' : 'Device'}</label>
                    <select id='training-device' value={device} onChange={e => setDevice(e.target.value)}>
                        <option value='auto'>{zh ? '自动选择' : 'Auto'}</option>
                        <option value='cpu'>CPU</option>
                    </select>
                </div>
                <div className='FormRow'>
                    <label htmlFor='training-epochs'>Epochs</label>
                    <input id='training-epochs' type='number' value={epochs} min={1} max={100000} onChange={(e) => setEpochs(Number(e.target.value))} />
                </div>
                <div className='FormRow'>
                    <label htmlFor='training-imgsz'>Imgsz</label>
                    <input id='training-imgsz' type='number' value={imgsz} min={32} max={4096} step={32} onChange={(e) => setImgsz(Number(e.target.value))} />
                </div>
                <div className='FormRow'>
                    <label htmlFor='training-batch'>Batch</label>
                    <input id='training-batch' type='number' value={batch} min={1} max={256} onChange={(e) => setBatch(Number(e.target.value))} />
                </div>
                {createError && <p role='alert' className='errorMessage'>{createError}</p>}
                {notice && <p role='status'>{notice}</p>}
                <button className='StartButton' disabled={!canStart} onClick={startTraining}>
                    {zh ? '开始训练' : 'Start Training'}
                </button>
            </div>
            <div className='JobListSection'>
                <div className='SectionHeader'>{zh ? '训练任务' : 'Jobs'}</div>
                {queryError && <p role='alert' className='errorMessage'>{queryError}</p>}
                {jobs.length === 0 && <div className='EmptyHint'>{zh ? '暂无训练任务' : 'No jobs yet'}</div>}
                {jobs.map(job => {
                    const pct = job.progress.total_epochs > 0
                        ? Math.round((job.progress.epoch / job.progress.total_epochs) * 100)
                        : 0;
                    const datasetLabel = getJobDatasetLabel(datasets, job.dataset_id, zh);
                    return (
                        <div className='JobRow' key={job.job_id}>
                            <div className='JobRowHeader'>
                                <span className='JobName'>{job.name || job.job_id}</span>
                                <span className={`JobState state-${job.state}`}>{stateLabel(job.state)}</span>
                            </div>
                            <div className='JobDataset'>
                                <span>{zh ? '数据集' : 'Dataset'}</span>
                                <strong title={datasetLabel}>{datasetLabel}</strong>
                            </div>
                            {job.state === 'running' && (
                                <div className='ProgressBar'>
                                    <div className='ProgressBarFill' style={{width: `${pct}%`}} />
                                </div>
                            )}
                            {job.state === 'running' && (
                                <span className='JobEpoch'>{job.progress.epoch}/{job.progress.total_epochs}</span>
                            )}
                            {job.error && <p className='errorMessage'>{job.error}</p>}
                            <div className='JobActions'>
                                {['queued', 'running'].includes(job.state) && (
                                    <button disabled={busy} onClick={() => cancelJob(job.job_id)}>{zh ? '取消' : 'Cancel'}</button>
                                )}
                                {job.state === 'completed' && job.produced_model && (
                                    <>
                                        <button disabled={busy} onClick={() => loadIntoInference(job)}>{zh ? '加载到推理任务' : 'Load into Inference'}</button>
                                        <a href={`${baseUrl}/training/jobs/${job.job_id}/model`} download>{zh ? '下载模型' : 'Download model'}</a>
                                    </>
                                )}
                                <button onClick={() => readLog(job.job_id)}>{zh ? '查看 / 刷新日志' : 'View / refresh log'}</button>
                            </div>
                            {logs[job.job_id] !== undefined && <pre className='JobLog'>{logs[job.job_id]}</pre>}
                        </div>
                    );
                })}
            </div>
        </div>
    );

    return (
        <GenericYesNoPopup
            title={zh ? '训练任务' : 'Training Task'}
            renderContent={renderContent}
            skipAcceptButton
            rejectLabel={zh ? '关闭' : 'Close'}
            onReject={() => PopupActions.close()}
        />
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
});

export default connect(mapStateToProps)(TrainingTaskPopup);
