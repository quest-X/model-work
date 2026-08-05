import React, {useEffect, useState} from 'react';
import {CanvasMultiViewStore, CanvasViewLayout} from './CanvasMultiViewStore';
import './CanvasMultiView.scss';

export const CanvasMultiViewTrigger = () => {
    const [layout, setLayout] = useState(CanvasMultiViewStore.get().layout);
    useEffect(() => CanvasMultiViewStore.subscribe(state => setLayout(state.layout)), []);

    return <select
        className='CanvasMultiViewSelect'
        aria-label='视图布局'
        title='视图布局'
        value={layout}
        onChange={event => CanvasMultiViewStore.setLayout(event.target.value as CanvasViewLayout)}
    >
        <option value='1x1'>1 × 1</option>
        <option value='2x2'>2 × 2</option>
        <option value='1x3'>1 × 3</option>
    </select>;
};
