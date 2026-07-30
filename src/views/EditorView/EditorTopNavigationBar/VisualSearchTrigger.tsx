import React from 'react';
import {Language} from '../../../data/LanguageConfig';
import './VisualSearchTrigger.scss';

interface IProps {
    disabled: boolean;
    hasExtensionEngine: boolean;
    language: Language;
    onOpen: () => void;
}

export const VisualSearchTrigger: React.FC<IProps> = ({
    disabled,
    hasExtensionEngine,
    language,
    onOpen,
}) => {
    if (!hasExtensionEngine) return null;
    const chinese = language === Language.CHINESE;
    return <button
        type='button'
        className='visual-search-trigger'
        data-testid='open-visual-search'
        disabled={disabled}
        onClick={onOpen}
        title={chinese
            ? '以当前整图、选中框或选中掩码发起同类型视觉检索'
            : 'Search by the current image, selected box, or selected mask'}
    >
        <span className='visual-search-trigger-icon' aria-hidden='true'/>
        {chinese ? '视觉检索' : 'Search'}
    </button>;
};
