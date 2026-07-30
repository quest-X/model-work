import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {VisualSearchTrigger} from '../VisualSearchTrigger';

describe('VisualSearchTrigger', () => {
    it('is hidden without the extension engine', () => {
        render(<VisualSearchTrigger
            disabled={false}
            hasExtensionEngine={false}
            language={Language.ENGLISH}
            onOpen={jest.fn()}
        />);

        expect(screen.queryByTestId('open-visual-search')).not.toBeInTheDocument();
    });

    it('is disabled when the editor has no image', () => {
        render(<VisualSearchTrigger
            disabled
            hasExtensionEngine
            language={Language.ENGLISH}
            onOpen={jest.fn()}
        />);

        expect(screen.getByTestId('open-visual-search')).toBeDisabled();
    });

    it('opens the popup without probing or mutating the current image', () => {
        const onOpen = jest.fn();
        render(<VisualSearchTrigger
            disabled={false}
            hasExtensionEngine
            language={Language.CHINESE}
            onOpen={onOpen}
        />);

        fireEvent.click(screen.getByTestId('open-visual-search'));
        expect(onOpen).toHaveBeenCalledTimes(1);
    });
});
