import React from 'react';
import {act, render} from '@testing-library/react';
import {Language} from '../../data/LanguageConfig';
import {NotificationType} from '../../data/enums/NotificationType';
import {INotification} from '../../store/notifications/types';
import {NotificationsView} from './NotificationsView';

jest.mock('../../index', () => ({store: {getState: () => ({general: {language: 'zh'}})}}));

it('uses completed step durations, even before the first clock tick, and freezes the total', () => {
    jest.useFakeTimers();
    try {
        const props = {language: Language.CHINESE, deleteNotificationByIdAction: jest.fn()};
        const view = render(<NotificationsView {...props} queue={[]}/>);
        act(() => { jest.advanceTimersByTime(250); });
        const notification: INotification = {
            id: 'fast-inference', type: NotificationType.INFERENCE, header: '', description: '',
            isInferenceProgress: true, currentStep: 3, totalSteps: 3, startTime: Date.now(),
            stepTimes: {stepStartTime: Date.now(), stepDurations: [10, 200, 10], totalObjects: 5},
        };
        view.rerender(<NotificationsView {...props} queue={[notification]}/>);
        expect(view.container.querySelector('.summary-value')).toHaveTextContent('0.22s');
        act(() => { jest.advanceTimersByTime(5000); });
        expect(view.container.querySelector('.summary-value')).toHaveTextContent('0.22s');
    } finally {
        jest.useRealTimers();
    }
});
