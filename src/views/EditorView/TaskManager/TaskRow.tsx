import React from 'react';
import {ManagedTask, TaskStatus} from '../../../store/tasks/types';
import {LanguageTexts} from '../../../data/LanguageConfig';
import {TaskTracker} from '../../../services/TaskTracker';

interface IProps {
    task: ManagedTask;
    texts: LanguageTexts['taskManager'];
    onCancel?: (task: ManagedTask) => void;
}

const STATUS_COLOR: Record<TaskStatus, string> = {
    running: '#009efd',
    completed: '#009944',
    error: '#d42245',
    cancelled: '#888',
};

/** 格式化时间戳为 YYYY-MM-DD HH:MM:SS */
function formatTime(ts: number): string {
    const d = new Date(ts);
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

export const TaskRow: React.FC<IProps> = ({task, texts, onCancel}) => {
    const statusLabel = (() => {
        switch (task.status) {
            case 'running': return texts.statusRunning;
            case 'completed': return texts.statusCompleted;
            case 'error': return texts.statusError;
            case 'cancelled': return texts.statusCancelled;
        }
    })();

    const showCancel = task.status === 'running' && task.cancellable;

    // 时间戳：运行中显示开始时间，已完成/失败/取消显示结束时间
    const timestamp = task.finishedAt
        ? formatTime(task.finishedAt)
        : formatTime(task.startedAt);

    return (
        <div className='TaskRow'>
            <div className='TaskRow__head'>
                <div className='TaskRow__title'>{task.title}</div>
                <div className='TaskRow__right'>
                    <span className='TaskRow__time'>{timestamp}</span>
                    <span
                        className='TaskRow__status'
                        style={{backgroundColor: STATUS_COLOR[task.status]}}
                    >
                        {statusLabel}
                    </span>
                    {showCancel && (
                        <button
                            className='TaskRow__cancel'
                            onClick={() => onCancel ? onCancel(task) : TaskTracker.cancelById(task.id)}
                            title={texts.cancel}
                            type='button'
                        >
                            ×
                        </button>
                    )}
                </div>
            </div>
            {task.subtitle && <div className='TaskRow__subtitle'>{task.subtitle}</div>}
            {task.errorMessage && <div className='TaskRow__error'>{task.errorMessage}</div>}
            <div className='TaskRow__progress'>
                {task.progress === undefined && task.status === 'running' ? (
                    <div className='TaskRow__progress--indeterminate'/>
                ) : (
                    <div
                        className='TaskRow__progress--bar'
                        style={{
                            width: `${Math.min(100, Math.max(0, task.progress ?? 0))}%`,
                            backgroundColor: STATUS_COLOR[task.status],
                        }}
                    />
                )}
            </div>
        </div>
    );
};
