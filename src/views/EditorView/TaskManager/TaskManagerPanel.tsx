import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {connect} from 'react-redux';
import {AppState} from '../../../store';
import {ManagedTask, TaskPriority, TaskStatus, TaskType} from '../../../store/tasks/types';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {TaskRow} from './TaskRow';
import {getEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import {useEscapeToClose} from '../../../hooks/useEscapeToClose';
import './TaskManagerPanel.scss';

interface ResourceStats {
    cpu_percent?: number;
    ram_used_gb?: number;
    ram_total_gb?: number;
    gpu_percent?: number;
}

interface TrainingJobSummary {
    job_id: string;
    state: string;
    name?: string;
    dataset_id?: string;
    started_at?: string;
    finished_at?: string;
    error?: string;
    progress?: {
        epoch?: number;
        total_epochs?: number;
    };
}

interface OwnProps {
    onClose: () => void;
    excludeRef?: React.RefObject<HTMLElement>;
    anchorRef?: React.RefObject<HTMLElement>;
    pinned?: boolean;
}

interface StateProps {
    tasks: ManagedTask[];
    language: Language;
}

type IProps = OwnProps & StateProps;

const PRIORITIES: TaskPriority[] = ['P0', 'P1', 'P2'];

const FINISHED: Set<string> = new Set(['completed', 'cancelled', 'error']);
const TRAINING_TASK_PREFIX = 'training:';
const TRAINING_STATUS: Record<string, TaskStatus> = {
    completed: 'completed',
    failed: 'error',
    cancelled: 'cancelled',
};

// 模块级缓存：面板关闭再打开时立刻显示上次数据，不等首次 poll 返回。
let _cachedResources: ResourceStats = {};

const ResourceChip: React.FC<{label: string; value: string; pct: number}> = ({label, value, pct}) => {
    const color = pct >= 80 ? '#e05c5c' : pct >= 50 ? '#e0a85c' : '#5cc98a';
    return (
        <span className='TaskManagerPanel__resourceChip'>
            <span className='TaskManagerPanel__resourceLabel'>{label}</span>
            <span className='TaskManagerPanel__resourceValue' style={{color}}>{value}</span>
        </span>
    );
};

export const TaskManagerPanelComponent: React.FC<IProps> = ({tasks, language, onClose, excludeRef, anchorRef}) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const t = LanguageConfig[language].taskManager;

    // 已完成任务的显示/隐藏开关，默认隐藏
    const [showCompleted, setShowCompleted] = useState(false);
    const toggleShowCompleted = useCallback(() => setShowCompleted(v => !v), []);

    // 资源监控：用缓存初始化，面板重开时立刻显示旧值；每 1s 轮询刷新。
    const [resources, setResources] = useState<ResourceStats>(_cachedResources);
    useEffect(() => {
        const base = getEngineBaseUrl();
        const poll = () => {
            fetch(`${base}/health`)
                .then(r => r.json())
                .then(data => {
                    if (data.resources) {
                        _cachedResources = data.resources;
                        setResources(data.resources);
                    }
                })
                .catch(() => undefined);
        };
        poll();
        const id = setInterval(poll, 1000);
        return () => clearInterval(id);
    }, []);

    const [trainingTasks, setTrainingTasks] = useState<ManagedTask[]>([]);
    const refreshTrainingTasks = useCallback(() => {
        return fetch(`${getEngineBaseUrl()}/training/jobs`)
            .then(response => response.json())
            .then(data => {
                if (!Array.isArray(data.jobs)) return;
                const mapped = data.jobs.map(
                    (job: TrainingJobSummary): ManagedTask => {
                        const epoch = job.progress?.epoch ?? 0;
                        const totalEpochs = job.progress?.total_epochs ?? 0;
                        const status = TRAINING_STATUS[job.state] ?? 'running';
                        const startedAt = job.started_at ? Date.parse(job.started_at) : Date.now();
                        const finishedAt = job.finished_at ? Date.parse(job.finished_at) : undefined;
                        const progress = totalEpochs > 0 ? Math.round((epoch / totalEpochs) * 100) : undefined;
                        const details = [
                            job.dataset_id,
                            totalEpochs > 0 ? `${epoch}/${totalEpochs} epochs` : undefined,
                        ].filter(Boolean).join(' · ');
                        return {
                            id: `${TRAINING_TASK_PREFIX}${job.job_id}`,
                            type: TaskType.TRAINING,
                            priority: 'P1',
                            title: job.name && job.name !== job.job_id ? job.name : t.types.training,
                            subtitle: details || undefined,
                            progress,
                            status,
                            startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
                            finishedAt: finishedAt !== undefined && Number.isFinite(finishedAt) ? finishedAt : undefined,
                            cancellable: job.state === 'running' || job.state === 'queued',
                            errorMessage: job.error,
                        };
                    },
                );
                setTrainingTasks(mapped);
            })
            .catch(() => undefined);
    }, [t.types.training]);

    useEffect(() => {
        refreshTrainingTasks();
        const id = setInterval(refreshTrainingTasks, 3000);
        return () => clearInterval(id);
    }, [refreshTrainingTasks]);

    const cancelTrainingTask = useCallback((task: ManagedTask) => {
        const jobId = task.id.slice(TRAINING_TASK_PREFIX.length);
        fetch(`${getEngineBaseUrl()}/training/jobs/${encodeURIComponent(jobId)}/cancel`, {method: 'POST'})
            .then(() => refreshTrainingTasks())
            .catch(() => undefined);
    }, [refreshTrainingTasks]);

    // 面板的右下角贴在 anchor（按钮）的左上角。
    // 用 inline style 覆盖 SCSS 里的 bottom/right 默认值。anchor 缺失时退回默认右下角。
    const [anchorStyle, setAnchorStyle] = useState<React.CSSProperties | null>(null);
    useLayoutEffect(() => {
        const compute = () => {
            const el = anchorRef?.current;
            if (!el) { setAnchorStyle(null); return; }
            const rect = el.getBoundingClientRect();
            // gap=0：严格贴边。如果想留 2px 缝，把 0 改 2 即可。
            const gap = 0;
            setAnchorStyle({
                right: Math.max(0, window.innerWidth - rect.left + gap),
                bottom: Math.max(0, window.innerHeight - rect.top + gap),
            });
        };
        compute();
        window.addEventListener('resize', compute);
        return () => window.removeEventListener('resize', compute);
    }, [anchorRef]);

    // Click-outside 关闭。注意排除按钮 ref：mousedown 在按钮 onClick 之前，
    // 否则会出现"点按钮关→onClick 又开"的来回切换。
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            const target = e.target as Node;
            if (panelRef.current && panelRef.current.contains(target)) return;
            if (excludeRef?.current && excludeRef.current.contains(target)) return;
            onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose, excludeRef]);

    useEscapeToClose(onClose, true, 15);

    // 过滤掉已完成的任务（当开关关闭时）
    const allTasks = [...tasks, ...trainingTasks];
    const visibleTasks = showCompleted ? allTasks : allTasks.filter(task => !FINISHED.has(task.status));
    const completedCount = allTasks.filter(task => FINISHED.has(task.status)).length;

    const grouped = PRIORITIES.map(p => ({
        priority: p,
        items: visibleTasks
            .filter(task => task.priority === p)
            .sort((a, b) => {
                // running 在前，按 startedAt 倒序；其它按 finishedAt 倒序
                if (a.status === 'running' && b.status !== 'running') return -1;
                if (a.status !== 'running' && b.status === 'running') return 1;
                if (a.status === 'running') return b.startedAt - a.startedAt;
                return (b.finishedAt ?? 0) - (a.finishedAt ?? 0);
            }),
    }));

    const isEmpty = visibleTasks.length === 0;
    const priorityLabel = (p: TaskPriority) => p === 'P0' ? t.priorityP0 : p === 'P1' ? t.priorityP1 : t.priorityP2;

    return (
        <div className='TaskManagerPanel' ref={panelRef} style={anchorStyle ?? undefined}>
            <div className='TaskManagerPanel__header'>
                <span className='TaskManagerPanel__title'>{t.title}</span>
            </div>
            <div className='TaskManagerPanel__body'>
                {isEmpty ? (
                    <div className='TaskManagerPanel__empty'>{t.emptyState}</div>
                ) : grouped.map(group => (
                    group.items.length === 0 ? null : (
                        <div className='TaskManagerPanel__section' key={group.priority}>
                            <div className='TaskManagerPanel__sectionHeader'>
                                {priorityLabel(group.priority)}
                                <span className='TaskManagerPanel__sectionCount'>({group.items.length})</span>
                            </div>
                            {group.items.map(task => (
                                <TaskRow
                                    key={task.id}
                                    task={task}
                                    texts={t}
                                    onCancel={task.type === TaskType.TRAINING ? cancelTrainingTask : undefined}
                                />
                            ))}
                        </div>
                    )
                ))}
            </div>
            {/* 底栏：资源监控 + 显示已完成开关 */}
            <div className='TaskManagerPanel__footer'>
                <div className='TaskManagerPanel__resources'>
                    {resources.cpu_percent !== undefined && (
                        <ResourceChip
                            label='CPU'
                            value={`${resources.cpu_percent}%`}
                            pct={resources.cpu_percent}
                        />
                    )}
                    {resources.ram_used_gb !== undefined && resources.ram_total_gb !== undefined && (() => {
                        const pct = (resources.ram_used_gb / resources.ram_total_gb) * 100;
                        return <ResourceChip label='RAM' value={`${pct.toFixed(0)}%`} pct={pct}/>;
                    })()}
                    {resources.gpu_percent !== undefined && (
                        <ResourceChip label='GPU' value={`${resources.gpu_percent}%`} pct={resources.gpu_percent}/>
                    )}
                </div>
                <label className='TaskManagerPanel__switch'>
                    <span className='TaskManagerPanel__switchLabel'>
                        {t.showCompleted}{completedCount > 0 ? ` (${completedCount})` : ''}
                    </span>
                    <span
                        className={'TaskManagerPanel__switchTrack' + (showCompleted ? ' on' : '')}
                        onClick={toggleShowCompleted}
                    >
                        <span className='TaskManagerPanel__switchThumb'/>
                    </span>
                </label>
            </div>
        </div>
    );
};

const mapStateToProps = (state: AppState): StateProps => ({
    tasks: state.tasks.tasks,
    language: state.general.language,
});

export const TaskManagerPanel = connect(mapStateToProps)(TaskManagerPanelComponent);
