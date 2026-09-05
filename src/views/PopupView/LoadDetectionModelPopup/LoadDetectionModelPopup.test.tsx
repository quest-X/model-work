import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {Language} from '../../../data/LanguageConfig';
import {LoadDetectionModelPopup} from './LoadDetectionModelPopup';

jest.mock('../../../index', () => ({store: {dispatch: jest.fn(), getState: () => ({})}}));

jest.mock('../CallModelPopup/CallModelPopup', () => ({
    getSelectedModelFamily: () => ({id: 'sam2', name: 'SAM2', variants: ['sam2_b'], defaultVariant: 'sam2_b'}),
    getSelectedCustomExt: () => 'pt',
    getServerUrl: () => '/core_service',
    SEG_MODEL_FAMILIES: [{id: 'sam2'}],
}));

jest.mock('../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({onAccept, disableAcceptButton}: {onAccept: () => void; disableAcceptButton: boolean}) => (
        <button onClick={onAccept} disabled={disableAcceptButton}>load</button>
    ),
}));

describe('model loading status', () => {
    const previousFetch = global.fetch;

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        global.fetch = previousFetch;
    });

    it.each(['error', 'missing_dep', 'not_loaded', 'http_error'])(
        'stops polling and reports %s rather than waiting indefinitely', async (state) => {
            const notify = jest.fn();
            global.fetch = jest.fn().mockImplementation(async (url: string) => ({
                ok: !url.includes('load-status') || state !== 'http_error',
                status: 503,
                json: async () => url.includes('load-status')
                    ? {state, error: 'fixture model failure'}
                    : {},
            }));
            const view = render(<LoadDetectionModelPopup
                language={Language.CHINESE}
                updateActivePopupTypeAction={jest.fn()}
                submitNewNotificationAction={notify}
            />);
            await act(async () => { fireEvent.click(screen.getByText('load')); });
            await act(async () => { jest.advanceTimersByTime(500); });

            expect(global.fetch).toHaveBeenCalledWith('/core_service/load-status?service=segmentation');
            expect(notify).toHaveBeenCalledTimes(1);
            expect(screen.getByText('load')).not.toBeDisabled();
            const fetchCount = (global.fetch as jest.Mock).mock.calls.length;
            await act(async () => { jest.advanceTimersByTime(1000); });
            expect(global.fetch).toHaveBeenCalledTimes(fetchCount);
            view.unmount();
        },
    );
});
