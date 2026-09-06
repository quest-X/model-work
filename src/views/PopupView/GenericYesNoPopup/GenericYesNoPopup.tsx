import React, {useEffect, useState} from 'react'
import './GenericYesNoPopup.scss'
import {TextButton} from '../../Common/TextButton/TextButton';
import {ContextManager} from '../../../logic/hotkey/ContextManager';
import {ContextType} from '../../../data/enums/ContextType';
import {store} from '../../../index';
import {LanguageConfig} from '../../../data/LanguageConfig';

interface IProps {
    title: React.ReactNode;
    renderContent: () => any;
    acceptLabel?: string;
    onAccept?: () => any;
    skipAcceptButton?: boolean;
    disableAcceptButton?: boolean;
    rejectLabel?: string;
    onReject?: () => any;
    skipRejectButton?: boolean;
    disableRejectButton?: boolean;
    footerContent?: React.ReactNode;
}

export const GenericYesNoPopup: React.FC<IProps> = (
    {
        title,
        renderContent,
        acceptLabel,
        onAccept,
        skipAcceptButton,
        disableAcceptButton,
        rejectLabel,
        onReject,
        skipRejectButton,
        disableRejectButton,
        footerContent
    }) => {

    const [status, setMountStatus] = useState(false);
    useEffect(() => {
        if (!status) {
            ContextManager.switchCtx(ContextType.POPUP);
            setMountStatus(true);
        }
    }, [status]);

    const language = store.getState().general.language;
    const texts = LanguageConfig[language];

    return (
        <div className='GenericYesNoPopup' data-popup-surface>
            <div className='Header'>
                {title}
            </div>
            <div className='Content'>
                {renderContent()}
            </div>
            <div className={`Footer${footerContent ? ' withContent' : ''}`}>
                {footerContent && <div className='FooterContent'>{footerContent}</div>}
                {!skipRejectButton && <TextButton
                    label={rejectLabel ? rejectLabel : texts.cancel}
                    onClick={onReject}
                    externalClassName={'reject'}
                    isDisabled={disableRejectButton}
                />}
                {!skipAcceptButton && <TextButton
                    label={acceptLabel ? acceptLabel : texts.ok}
                    onClick={onAccept}
                    externalClassName={'accept'}
                    isDisabled={disableAcceptButton}
                />}
            </div>
        </div>
    )
};
