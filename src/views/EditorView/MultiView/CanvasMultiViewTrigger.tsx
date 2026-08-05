import React, {useEffect, useRef, useState} from 'react';
import {CanvasMultiViewStore, CanvasViewLayout} from './CanvasMultiViewStore';
import './CanvasMultiView.scss';

const layouts: Array<{id: CanvasViewLayout; label: string}> = [
    {id: '1x1', label: '1 × 1'},
    {id: '2x2', label: '2 × 2'},
    {id: '1x3', label: '1 × 3'},
];

export const CanvasMultiViewTrigger = () => {
    const [open, setOpen] = useState(false);
    const [layout, setLayout] = useState(CanvasMultiViewStore.get().layout);
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => CanvasMultiViewStore.subscribe(state => setLayout(state.layout)), []);
    useEffect(() => {
        const close = (event: MouseEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, []);

    return <div className='CanvasMultiViewTrigger' ref={root}>
        <button className={layout !== '1x1' ? 'active' : ''} title='视图布局' onClick={() => setOpen(!open)}>
            <span className='CanvasMultiViewIcon'><i/><i/><i/><i/></span>
        </button>
        {open && <div className='CanvasMultiViewMenu'>
            <div className='title'>视图布局</div>
            {layouts.map(item => <button
                key={item.id}
                className={layout === item.id ? 'selected' : ''}
                onClick={() => { CanvasMultiViewStore.setLayout(item.id); setOpen(false); }}
            >
                <span className={`layout-preview ${item.id}`}><i/><i/><i/><i/></span>
                {item.label}
            </button>)}
        </div>}
    </div>;
};
