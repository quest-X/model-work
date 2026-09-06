import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../data/LanguageConfig';
import {TaskManagerPanelComponent} from './TaskManagerPanel';

jest.mock('../../../utils/DefaultBackendUrl', () => ({
    ...jest.requireActual('../../../utils/DefaultBackendUrl'),
    getEngineBaseUrl: () => 'https://core.test/core_service',
}));

jest.mock('../../../services/TaskTracker', () => ({
    TaskTracker: {cancelById: jest.fn()},
}));

const jsonResponse = (body: unknown): Response => ({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
} as unknown as Response);

describe('TaskManagerPanel training jobs', () => {
    it('closes from outside or Escape without rendering an X button', () => {
        global.fetch = jest.fn().mockResolvedValue(jsonResponse({jobs: []}));
        const onClose = jest.fn();
        const {container} = render(<TaskManagerPanelComponent
            tasks={[]}
            language={Language.CHINESE}
            onClose={onClose}
        />);

        expect(container.querySelector('.TaskManagerPanel__close')).not.toBeInTheDocument();
        fireEvent.mouseDown(container.querySelector('.TaskManagerPanel') as HTMLElement);
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.mouseDown(document.body);
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(window, {key: 'Escape'});
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('shows and cancels backend training jobs', async () => {
        global.fetch = jest.fn((input: RequestInfo | URL, options?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/health')) return Promise.resolve(jsonResponse({resources: {cpu_percent: 12}}));
            if (options?.method === 'POST') return Promise.resolve(jsonResponse({status: 'success'}));
            return Promise.resolve(jsonResponse({jobs: [{
                job_id: 'job-1',
                state: 'running',
                dataset_id: 'dataset-1',
                started_at: '2026-09-06T00:00:00Z',
                progress: {epoch: 4, total_epochs: 10},
            }]}));
        }) as jest.Mock;

        const view = render(<TaskManagerPanelComponent
            tasks={[]}
            language={Language.CHINESE}
            onClose={jest.fn()}
        />);

        expect(await screen.findByText('训练任务')).toBeInTheDocument();
        expect(screen.getByText('dataset-1 · 4/10 epochs')).toBeInTheDocument();
        fireEvent.click(screen.getByTitle('取消'));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            'https://core.test/core_service/training/jobs/job-1/cancel',
            {method: 'POST'},
        ));
        view.unmount();
    });
});
