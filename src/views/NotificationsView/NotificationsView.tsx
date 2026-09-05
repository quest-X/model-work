import React, {useState} from 'react';
import './NotificationsView.scss';
import {AppState} from '../../store';
import {connect} from 'react-redux';
import classNames from 'classnames';
import {deleteNotificationById} from '../../store/notifications/actionCreators';
import {INotification} from '../../store/notifications/types';
import {NotificationType} from '../../data/enums/NotificationType';
import {store} from '../../index';
import {Language, LanguageConfig, LanguageTexts} from '../../data/LanguageConfig';

/** Resolve a dot-path like "notifications.detectionCompleted" from LanguageTexts */
function resolveI18n(texts: LanguageTexts, path: string, params?: Record<string, string>): string {
    let value: any = texts;
    for (const key of path.split('.')) {
        value = value?.[key];
    }
    if (typeof value !== 'string') return path;
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            value = value.replace(`{${k}}`, v);
        }
    }
    return value;
}

interface IProps {
    deleteNotificationByIdAction: (id: string) => void
    queue: INotification[]
    language: Language
}

enum NotificationState {
    IN = 'IN',
    DISPLAY = 'DISPLAY',
    OUT = 'OUT',
    IDLE = 'IDLE'
}

enum Animation {
    IN = 'animation-in',
    DISPLAY = 'animation-display',
    OUT = 'animation-out'
}

export const NotificationsView: React.FC<IProps> = (props) => {
    const [ notificationState, setNotificationState ] = useState(NotificationState.IDLE);

    if (props.queue.length > 0 && notificationState === NotificationState.IDLE) {
        setNotificationState(NotificationState.IN)
    }

    const notification: INotification | undefined = props.queue[0]

    const onClose = () => {
        setNotificationState(NotificationState.OUT)
    }

    const onAnimationEnd = (event: React.AnimationEvent<HTMLDivElement>) => {
        switch (event.animationName) {
            case Animation.IN:
                setNotificationState(NotificationState.DISPLAY)
                break
            case Animation.DISPLAY:
                // 推理进度通知：保持显示，不自动消失（等推理完成或手动关闭）
                if (notification?.isInferenceProgress) {
                    // 不做任何事，保持 DISPLAY 状态
                } else {
                    setNotificationState(NotificationState.OUT)
                }
                break
            case Animation.OUT:
                if (notification) props.deleteNotificationByIdAction(notification.id)
                setNotificationState(NotificationState.IDLE)
                break
        }
    }

    const getNotificationWrapperClassName = () => {
        return classNames('notification-wrapper', {
            'in': notificationState === NotificationState.IN,
            'display': notificationState === NotificationState.DISPLAY,
            'out': notificationState === NotificationState.OUT
        })
    }

    const getNotificationClassName = () => {
        return classNames('notification', {
            'error': notification.type === NotificationType.ERROR,
            'success': notification.type === NotificationType.SUCCESS,
            'message': notification.type === NotificationType.MESSAGE,
            'warning': notification.type === NotificationType.WARNING,
            'inference': notification.type === NotificationType.INFERENCE
        })
    }

    const renderNotification = () => {
        // 防御：通知可能在动画期间被删除，queue 已空但 state 未回到 IDLE
        if (!notification) {
            setNotificationState(NotificationState.IDLE);
            return null;
        }

        // 获取国际化文本
        const texts = LanguageConfig[props.language];

        // Resolve i18n keys at render time so language switches are instant
        const header = notification.i18nHeader
            ? resolveI18n(texts, notification.i18nHeader, notification.i18nParams)
            : notification.header;
        const description = notification.i18nDescription
            ? resolveI18n(texts, notification.i18nDescription, notification.i18nParams)
            : notification.description;

        return(
            notification && <div
                className={getNotificationWrapperClassName()}
                key={notification.id}
                onAnimationEnd={onAnimationEnd}
                onClick={onClose}
            >
                <div className={getNotificationClassName()}>
                    <div className='header'>
                        {header}
                    </div>
                    <div className='content'>
                        {notification.isInferenceProgress ? (
                            <div className='inference-progress'>
                                <div className='step-info'>
                                    <div className='step-text'>
                                        {notification.stepDescription}
                                    </div>
                                    <div className='step-counter'>
                                        {(() => {
                                            const language = store.getState().general.language;
                                            const texts = LanguageConfig[language];
                                            return texts.aiInference.stepProgress
                                                .replace('{current}', notification.currentStep?.toString() || '1')
                                                .replace('{total}', notification.totalSteps?.toString() || '3');
                                        })()}
                                    </div>
                                </div>
                                <div className='progress-bar'>
                                    <div 
                                        className='progress-fill'
                                        style={{
                                            width: `${(notification.currentStep / notification.totalSteps) * 100}%`
                                        }}
                                    />
                                </div>
                                <div className='steps-list'>
                                    <div className={`step ${notification.currentStep > 1 ? 'completed' : notification.currentStep === 1 ? 'active' : 'pending'}`}>
                                        <span className='step-name'>{(() => {
                                            const language = store.getState().general.language;
                                            const texts = LanguageConfig[language];
                                            return `1. ${texts.aiInference.steps.preprocessing}`;
                                        })()}</span>
                                        {notification.stepTimes?.stepDurations && notification.stepTimes.stepDurations.length > 0 && (
                                            <span className='step-time'>
                                                {(notification.stepTimes.stepDurations[0] / 1000).toFixed(2)}s
                                            </span>
                                        )}
                                    </div>
                                    <div className={`step ${notification.currentStep > 2 ? 'completed' : notification.currentStep === 2 ? 'active' : 'pending'}`}>
                                        <span className='step-name'>{(() => {
                                            const language = store.getState().general.language;
                                            const texts = LanguageConfig[language];
                                            return `2. ${texts.aiInference.steps.inference}`;
                                        })()}</span>
                                        {notification.stepTimes?.stepDurations && notification.stepTimes.stepDurations.length > 1 && (
                                            <span className='step-time'>
                                                {(notification.stepTimes.stepDurations[1] / 1000).toFixed(2)}s
                                            </span>
                                        )}
                                    </div>
                                    <div className={`step ${notification.currentStep > 3 ? 'completed' : notification.currentStep === 3 ? 'active' : 'pending'}`}>
                                        <span className='step-name'>{(() => {
                                            const language = store.getState().general.language;
                                            const texts = LanguageConfig[language];
                                            return `3. ${texts.aiInference.steps.postprocessing}`;
                                        })()}</span>
                                        {notification.stepTimes?.stepDurations && notification.stepTimes.stepDurations.length > 2 && (
                                            <span className='step-time'>
                                                {(notification.stepTimes.stepDurations[2] / 1000).toFixed(2)}s
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {notification.stepTimes?.totalObjects !== undefined && (
                                    <div className='summary-info'>
                                        <div className='summary-item'>
                                            <span className='summary-label'>{(() => {
                                                const language = store.getState().general.language;
                                                const texts = LanguageConfig[language];
                                                return texts.aiInference.totalTime;
                                            })()}</span>
                                            <span className='summary-value'>
                                                {(notification.stepTimes.stepDurations.reduce((sum, duration) => sum + duration, 0) / 1000).toFixed(2)}s
                                            </span>
                                        </div>
                                        <div className='summary-item'>
                                            <span className='summary-label'>{(() => {
                                                const language = store.getState().general.language;
                                                const texts = LanguageConfig[language];
                                                return texts.aiInference.detectedObjects;
                                            })()}</span>
                                            <span className='summary-value'>
                                                {notification.stepTimes.totalObjects} 个
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            description
                        )}
                    </div>
                    <div className='loader'/>
                </div>
            </div>
        )
    }

    return(notificationState !== NotificationState.IDLE ? renderNotification() : null)
}

const mapDispatchToProps = {
    deleteNotificationByIdAction: deleteNotificationById
};

const mapStateToProps = (state: AppState) => ({
    queue: state.notifications.queue,
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(NotificationsView);
