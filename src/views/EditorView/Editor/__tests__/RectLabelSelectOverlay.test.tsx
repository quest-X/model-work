import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {RectLabelSelectOverlay} from '../RectLabelSelectOverlay';
import {LabelStatus} from '../../../../data/enums/LabelStatus';
import {EditorData} from '../../../../data/EditorData';
import {publishRectLabelOverlayPosition} from '../../../../utils/RectLabelOverlayPositionBus';

const editorData: EditorData = {
    viewPortContentSize: {width: 400, height: 300},
    mousePositionOnViewPortContent: {x: 0, y: 0},
    activeKeyCombo: [],
    zoom: 1,
    viewPortSize: {width: 400, height: 300},
    defaultRenderImageRect: {x: 10, y: 20, width: 100, height: 50},
    realImageSize: {width: 200, height: 100},
    viewPortContentImageRect: {x: 10, y: 20, width: 100, height: 50},
    absoluteViewPortContentScrollPosition: {x: 0, y: 0},
};

const labelNames = [
    {id: 'bird-id', name: 'bird', color: '#ef2aa7'},
    {id: 'dog-id', name: 'dog', color: '#ff9911'},
];

describe('RectLabelSelectOverlay', () => {
    it('positions a label selector at the rectangle top-left and updates its label', () => {
        const onChange = jest.fn();
        const onActivate = jest.fn();
        const onInteractionChange = jest.fn();

        render(<RectLabelSelectOverlay
            editorData={editorData}
            labelRects={[{
                id: 'rect-1',
                labelId: 'bird-id',
                rect: {x: 100, y: 50, width: 40, height: 20},
                isCreatedByAI: true,
                isVisible: true,
                status: LabelStatus.ACCEPTED,
                suggestedLabel: null,
            }]}
            labelNames={labelNames}
            visible={true}
            onChange={onChange}
            onActivate={onActivate}
            onInteractionChange={onInteractionChange}
        />);

        const trigger = screen.getByRole('button', {name: '修改 bird 标签'});
        const dropdown = trigger.closest('.RectLabelDropdown');
        expect(dropdown).toHaveClass('RectLabelDropdown--style-2');
        expect(dropdown).toHaveStyle({left: '60px', top: '45px'});
        expect(trigger).toHaveStyle({
            backgroundColor: 'rgba(239, 42, 167, 0.8)',
            color: '#fff',
        });
        expect(trigger.querySelector('.RectLabelDropdown__color')).toBeNull();
        expect(trigger.querySelector('.RectLabelDropdown__caret')).toBeNull();

        publishRectLabelOverlayPosition('rect-1', {x: 88, y: 99});
        expect(dropdown).toHaveStyle({left: '88px', top: '99px'});

        fireEvent.focus(trigger);
        expect(onActivate).toHaveBeenCalledWith('rect-1');
        expect(onInteractionChange).toHaveBeenCalledWith(true);

        fireEvent.click(trigger);
        expect(screen.getByRole('listbox', {name: '选择标注标签'})).toBeInTheDocument();
        expect(screen.getByRole('option', {name: 'bird'})).toHaveAttribute('aria-selected', 'true');

        fireEvent.click(screen.getByRole('option', {name: 'dog'}));
        expect(onChange).toHaveBeenCalledWith('rect-1', 'dog-id');
    });

    it('keeps style 1 available while preserving the dropdown interaction', () => {
        render(<RectLabelSelectOverlay
            editorData={editorData}
            labelRects={[{
                id: 'rect-style-1',
                labelId: 'bird-id',
                rect: {x: 100, y: 50, width: 40, height: 20},
                isCreatedByAI: true,
                isVisible: true,
                status: LabelStatus.ACCEPTED,
                suggestedLabel: null,
            }]}
            labelNames={labelNames}
            styleVariant='style-1'
            visible={true}
            onChange={jest.fn()}
            onActivate={jest.fn()}
            onInteractionChange={jest.fn()}
        />);

        const trigger = screen.getByRole('button', {name: '修改 bird 标签'});
        expect(trigger.closest('.RectLabelDropdown')).toHaveClass('RectLabelDropdown--style-1');
        expect(trigger).not.toHaveAttribute('style');
        expect(trigger.querySelector('.RectLabelDropdown__color')).toHaveStyle({backgroundColor: '#ef2aa7'});

        fireEvent.click(trigger);
        expect(screen.getByRole('listbox', {name: '选择标注标签'})).toBeInTheDocument();
    });

    it('does not render hidden or unaccepted rectangles', () => {
        const {container} = render(<RectLabelSelectOverlay
            editorData={editorData}
            labelRects={[{
                id: 'rect-2',
                labelId: 'bird-id',
                rect: {x: 0, y: 0, width: 40, height: 20},
                isCreatedByAI: true,
                isVisible: false,
                status: LabelStatus.ACCEPTED,
                suggestedLabel: null,
            }]}
            labelNames={labelNames}
            visible={true}
            onChange={jest.fn()}
            onActivate={jest.fn()}
            onInteractionChange={jest.fn()}
        />);

        expect(container.querySelector('.RectLabelDropdown')).toBeNull();
    });
});
