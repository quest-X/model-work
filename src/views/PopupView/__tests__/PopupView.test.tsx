import React from 'react';
import {fireEvent, render} from '@testing-library/react';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {PopupView} from '../PopupView';

jest.mock('../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));
jest.mock('../../../index', () => ({
    store: {getState: jest.fn(() => ({general: {language: 0}}))},
}));
jest.mock('../../../logic/helpers/CSSHelper', () => ({
    CSSHelper: {getLeadingColor: jest.fn(() => '#ffffff')},
}));

describe('PopupView dismissal', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => jest.restoreAllMocks());

    it('closes from the outer backdrop or Escape and ignores content clicks', () => {
        const close = jest.spyOn(PopupActions, 'close').mockImplementation(jest.fn());
        const {container} = render(<PopupView
            activePopupType={PopupWindowType.LOADER}
            activePopupNodeId={null}
            activePopupNodeName={null}
            activePopupNodeRemote={false}
        />);
        const backdrop = container.querySelector('.PopupView') as HTMLElement;
        const content = backdrop.firstElementChild as HTMLElement;

        fireEvent.mouseDown(content);
        expect(close).not.toHaveBeenCalled();
        fireEvent.mouseDown(backdrop);
        expect(close).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(window, {key: 'Escape'});
        expect(close).toHaveBeenCalledTimes(2);
    });

    it('treats marked custom backdrops as outside without closing for portal content', () => {
        const close = jest.spyOn(PopupActions, 'close').mockImplementation(jest.fn());
        const {container} = render(<PopupView
            activePopupType={PopupWindowType.LOADER}
            activePopupNodeId={null}
            activePopupNodeName={null}
            activePopupNodeRemote={false}
        />);
        const backdrop = container.querySelector('.PopupView') as HTMLElement;
        const customBackdrop = document.createElement('div');
        customBackdrop.setAttribute('data-popup-backdrop', '');
        backdrop.appendChild(customBackdrop);
        const portalContent = document.createElement('div');
        backdrop.appendChild(portalContent);

        fireEvent.mouseDown(portalContent);
        expect(close).not.toHaveBeenCalled();
        fireEvent.mouseDown(customBackdrop);
        expect(close).toHaveBeenCalledTimes(1);
    });
});
