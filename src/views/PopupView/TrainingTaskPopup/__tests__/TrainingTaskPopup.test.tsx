import React from 'react';
import {render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {TrainingDatasetSelection} from '../../../../services/TrainingDatasetSelection';
import {TrainingTaskPopup} from '../TrainingTaskPopup';

jest.mock('../../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({title, renderContent}: {title: React.ReactNode; renderContent: () => React.ReactNode}) => (
        <div><h1>{title}</h1>{renderContent()}</div>
    ),
}));

jest.mock('../../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));

jest.mock('../../../../services/TrainingDatasetSelection', () => ({
    TrainingDatasetSelection: {get: jest.fn(), set: jest.fn()},
}));

jest.mock('../../../../utils/DefaultBackendUrl', () => ({
    getEngineBaseUrl: () => 'https://core.test/core_service',
}));

const jsonResponse = (body: unknown): Response => ({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
} as unknown as Response);

describe('TrainingTaskPopup', () => {
    let jobs: unknown[];

    beforeEach(() => {
        jest.clearAllMocks();
        jobs = [];
        (TrainingDatasetSelection.get as jest.Mock).mockReturnValue('dataset-2');
        global.fetch = jest.fn((input: RequestInfo) => {
            const url = String(input);
            if (url.endsWith('/datasets')) {
                return Promise.resolve(jsonResponse({datasets: [
                    {id: 'dataset-1', name: '一号数据', image_count: 10, classes: []},
                    {id: 'dataset-2', name: '二号数据', image_count: 20, classes: []},
                ]}));
            }
            if (url.endsWith('/training/jobs')) return Promise.resolve(jsonResponse({jobs}));
            return Promise.resolve(jsonResponse({status: 'success'}));
        }) as jest.Mock;
    });

    it('preselects the dataset chosen in Resource Center', async () => {
        render(<TrainingTaskPopup language={Language.CHINESE}/>);

        await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('dataset-2'));
        expect(TrainingDatasetSelection.set).toHaveBeenCalledWith('dataset-2');
    });

    it('shows the dataset name for each job and falls back to its dataset id', async () => {
        jobs = [
            {
                job_id: 'job-known',
                name: '二号训练',
                state: 'running',
                dataset_id: 'dataset-2',
                progress: {epoch: 4, total_epochs: 10, metrics: {}},
            },
            {
                job_id: 'job-orphaned',
                state: 'failed',
                dataset_id: 'dataset-removed',
                progress: {epoch: 0, total_epochs: 0, metrics: {}},
            },
        ];

        render(<TrainingTaskPopup language={Language.CHINESE}/>);

        expect(await screen.findByText('二号数据')).toBeInTheDocument();
        expect(screen.getByText('dataset-removed')).toBeInTheDocument();
        expect(document.querySelectorAll('.JobDataset')).toHaveLength(2);
    });
});
