import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {CanvasMultiViewStore} from '../CanvasMultiViewStore';
import {CanvasMultiViewTrigger} from '../CanvasMultiViewTrigger';

describe('CanvasMultiViewTrigger', () => {
    beforeEach(() => act(() => CanvasMultiViewStore.setLayout('1x1')));
    afterEach(() => act(() => CanvasMultiViewStore.setLayout('1x1')));

    it('offers the side-by-side 1x2 comparison layout', () => {
        render(<CanvasMultiViewTrigger/>);

        const select = screen.getByRole('combobox', {name: '视图布局'});
        expect(screen.getByRole('option', {name: '1 × 2'})).toBeInTheDocument();
        fireEvent.change(select, {target: {value: '1x2'}});

        expect(CanvasMultiViewStore.get().layout).toBe('1x2');
        expect(CanvasMultiViewStore.get().views).toEqual(['original', 'original']);
    });
});
