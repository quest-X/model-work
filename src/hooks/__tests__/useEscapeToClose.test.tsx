import React from 'react';
import {fireEvent, render} from '@testing-library/react';
import {useEscapeToClose} from '../useEscapeToClose';

const Window = ({onClose, priority}: {onClose: () => void; priority: number}) => {
    useEscapeToClose(onClose, true, priority);
    return <div/>;
};

it('closes only the top registered window on Escape', () => {
    const closeBase = jest.fn();
    const closeTop = jest.fn();
    const {rerender} = render(<>
        <Window onClose={closeBase} priority={0}/>
        <Window onClose={closeTop} priority={20}/>
    </>);

    fireEvent.keyDown(window, {key: 'Escape'});
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeBase).not.toHaveBeenCalled();

    rerender(<Window onClose={closeBase} priority={0}/>);
    fireEvent.keyDown(window, {key: 'Escape'});
    expect(closeBase).toHaveBeenCalledTimes(1);
});
