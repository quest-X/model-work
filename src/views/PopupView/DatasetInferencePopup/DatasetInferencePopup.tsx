import React, {useEffect, useState} from 'react';
import {connect} from 'react-redux';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {getEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import {DatasetInferenceSelection} from '../../../services/DatasetActionSelection';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import './DatasetInferencePopup.scss';

interface DatasetSummary {
    id: string;
    name: string;
    image_count: number;
}

interface InferenceJob {
    job_id: string;
    state: string;
    dataset_id: string;
    name?: string;
    model?: string;
    total_images: number;
    processed_images: number;
    annotated_images: number;
    produced_revision?: number;
    error?: string;
}

interface IProps {
    language: Language;
}

const POLL_INTERVAL_MS = 2000;

export const DatasetInferencePopup: React.FC<IProps> = ({language}) => {
    const zh = language === Language.CHINESE;
    const baseUrl = getEngineBaseUrl();
    const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
    const [selectedDatasetId, setSelectedDatasetId] = useState(() => DatasetInferenceSelection.get() || '');
    const [confidence, setConfidence] = useState(0.25);
    const [overwriteExisting, setOverwriteExisting] = useState(false);
    const [jobs, setJobs] = useState<InferenceJob[]>([]);
    const [createError, setCreateError] = useState<string | null>(null);
    const [queryError, setQueryError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        fetch(`${baseUrl}/datasets`).then(response => response.json()).then(data => {
            if (!Array.isArray(data.datasets)) return;
            setDatasets(data.datasets);
            setSelectedDatasetId(previous => {
                const preferred = DatasetInferenceSelection.get();
                const next = data.datasets.some((dataset: DatasetSummary) => dataset.id === preferred)
                    ? preferred as string
                    : data.datasets.some((dataset: DatasetSummary) => dataset.id === previous)
                        ? previous
                        : data.datasets[0]?.id || '';
                DatasetInferenceSelection.set(next || null);
                return next;
            });
        }).catch(() => setCreateError(zh ? '无法读取数据集' : 'Unable to load datasets'));
    }, [baseUrl, zh]);

    const refreshJobs = () => {
        return fetch(`${baseUrl}/dataset-inference/jobs`).then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        }).then(data => {
            if (Array.isArray(data.jobs)) {
                setJobs(data.jobs);
                setQueryError(null);
                if (data.jobs.some((job: InferenceJob) => job.state === 'completed')) {
                    window.dispatchEvent(new CustomEvent('opensight:data-center-updated'));
                }
            }
        }).catch(error => setQueryError(error.message));
    };

    useEffect(() => {
        refreshJobs();
        const timer = window.setInterval(refreshJobs, POLL_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [baseUrl]);

    const publishInference = () => {
        if (!selectedDatasetId) return;
        setCreateError(null);
        setBusy(true);
        fetch(`${baseUrl}/dataset-inference/jobs`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                dataset_id: selectedDatasetId,
                confidence,
                overwrite_existing: overwriteExisting,
            }),
        }).then(async response => {
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.detail || `${response.status}`);
            }
            return refreshJobs();
        }).catch(error => setCreateError(error.message)).finally(() => setBusy(false));
    };

    const cancelJob = async (jobId: string) => {
        setCreateError(null);
        setBusy(true);
        try {
            const response = await fetch(`${baseUrl}/dataset-inference/jobs/${jobId}/cancel`, {method: 'POST'});
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
            await refreshJobs();
        } catch (error) {
            setCreateError((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const canPublish = !busy && !!selectedDatasetId && confidence >= 0 && confidence <= 1
        && !jobs.some(job => job.dataset_id === selectedDatasetId && ['queued', 'running', 'cancelling', 'saving'].includes(job.state));

    const stateLabel = (state: string): string => {
        const labels: Record<string, [string, string]> = {
            queued: ['排队中', 'Queued'],
            running: ['推理中', 'Running'],
            completed: ['已完成', 'Completed'],
            failed: ['失败', 'Failed'],
            cancelling: ['取消中（等待当前批次结束）', 'Cancelling after current batch'],
            cancelled: ['已取消', 'Cancelled'],
            saving: ['正在保存结果', 'Saving results'],
        };
        return labels[state] ? (zh ? labels[state][0] : labels[state][1]) : state;
    };

    const renderContent = () => <div className='DatasetInferencePopupContent'>
        <section className='InferenceFormSection'>
            <div className='SectionHeader'>{zh ? '发布自动打标任务' : 'Publish Auto-Labelling Job'}</div>
            <div className='FormRow'>
                <label htmlFor='dataset-inference-dataset'>{zh ? '数据集' : 'Dataset'}</label>
                <select id='dataset-inference-dataset' value={selectedDatasetId} onChange={event => {
                    setSelectedDatasetId(event.target.value);
                    DatasetInferenceSelection.set(event.target.value || null);
                }}>
                    {datasets.length === 0 && <option value=''>{zh ? '暂无数据集' : 'No datasets'}</option>}
                    {datasets.map(dataset => <option key={dataset.id} value={dataset.id}>
                        {dataset.name} ({dataset.image_count})
                    </option>)}
                </select>
            </div>
            <div className='FormRow'>
                <label htmlFor='dataset-inference-confidence'>{zh ? '置信度' : 'Confidence'}</label>
                <input id='dataset-inference-confidence' type='number' min={0} max={1} step={0.05} value={confidence}
                    onChange={event => setConfidence(Number(event.target.value))} />
            </div>
            <label className='OverwriteOption'>
                <input type='checkbox' checked={overwriteExisting}
                    onChange={event => setOverwriteExisting(event.target.checked)} />
                <span>{zh ? '覆盖已有标注（默认仅处理空白图片）' : 'Overwrite existing labels (blank images only by default)'}</span>
            </label>
            {createError && <p role='alert' className='errorMessage'>{createError}</p>}
            <button type='button' className='PublishButton' disabled={!canPublish} onClick={publishInference}>
                {zh ? '发布推理任务' : 'Publish Inference Job'}
            </button>
        </section>
        <section className='InferenceJobsSection'>
            <div className='SectionHeader'>{zh ? '自动推理任务' : 'Inference Jobs'}</div>
            {queryError && <p role='alert' className='errorMessage'>{queryError}</p>}
            {jobs.length === 0 && <div className='EmptyHint'>{zh ? '暂无推理任务' : 'No jobs yet'}</div>}
            {jobs.map(job => {
                const progress = job.total_images > 0
                    ? Math.round(job.processed_images / job.total_images * 100)
                    : 0;
                return <article className='InferenceJobRow' key={job.job_id}>
                    <div className='JobHeader'>
                        <strong>{job.name || job.job_id}</strong>
                        <span className={`JobState state-${job.state}`}>{stateLabel(job.state)}</span>
                    </div>
                    <div className='JobMeta'>{job.model || (zh ? '当前检测模型' : 'Current detection model')}</div>
                    {['queued', 'running'].includes(job.state) && <>
                        <div className='ProgressBar'><div style={{width: `${progress}%`}} /></div>
                        <small>{job.processed_images} / {job.total_images}</small>
                        <button className='CancelButton' disabled={busy} onClick={() => cancelJob(job.job_id)}>
                            {zh ? '取消' : 'Cancel'}
                        </button>
                    </>}
                    {job.state === 'completed' && <div className='JobResult'>
                        {zh
                            ? `生成 v${job.produced_revision}，已标注 ${job.annotated_images} 张`
                            : `Produced v${job.produced_revision}, ${job.annotated_images} images annotated`}
                    </div>}
                    {job.error && <p className='errorMessage'>{job.error}</p>}
                </article>;
            })}
        </section>
    </div>;

    return <GenericYesNoPopup
        title={zh ? '推理任务' : 'Inference Task'}
        renderContent={renderContent}
        skipAcceptButton
        rejectLabel={zh ? '关闭' : 'Close'}
        onReject={() => {
            DatasetInferenceSelection.set(null);
            PopupActions.close();
        }}
    />;
};

const mapStateToProps = (state: AppState) => ({language: state.general.language});
export default connect(mapStateToProps)(DatasetInferencePopup);
