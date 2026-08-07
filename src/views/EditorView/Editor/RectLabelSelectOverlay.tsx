import React, {useEffect, useRef, useState} from 'react';
import {EditorData} from '../../../data/EditorData';
import {LabelName, LabelRect} from '../../../store/labels/types';
import {LabelStatus} from '../../../data/enums/LabelStatus';
import {RenderEngineUtil} from '../../../utils/RenderEngineUtil';
import {subscribeRectLabelOverlayPosition} from '../../../utils/RectLabelOverlayPositionBus';

export type RectLabelStyle = 'style-1' | 'style-2';

interface IProps {
    editorData: EditorData;
    labelRects: LabelRect[];
    labelNames: LabelName[];
    enablePerClassColoration?: boolean;
    styleVariant?: RectLabelStyle;
    visible: boolean;
    onChange: (rectId: string, labelId: string) => void;
    onActivate: (rectId: string) => void;
    onInteractionChange: (active: boolean) => void;
}

const stopPropagation = (event: React.SyntheticEvent) => event.stopPropagation();

const withAlpha = (color: string, alpha: number): string => {
    const hex = color.replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return color;

    return `rgba(${parseInt(hex.substring(0, 2), 16)}, ${parseInt(hex.substring(2, 4), 16)}, ${parseInt(hex.substring(4, 6), 16)}, ${alpha})`;
};

export const RectLabelSelectOverlay: React.FC<IProps> = ({
    editorData,
    labelRects,
    labelNames,
    enablePerClassColoration = true,
    styleVariant = 'style-2',
    visible,
    onChange,
    onActivate,
    onInteractionChange,
}) => {
    const [openRectId, setOpenRectId] = useState<string | null>(null);
    const layerRef = useRef<HTMLDivElement>(null);
    const dropdownRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    useEffect(() => {
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (layerRef.current && !layerRef.current.contains(event.target as Node)) {
                setOpenRectId(null);
                onInteractionChange(false);
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpenRectId(null);
                onInteractionChange(false);
            }
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('mousedown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [onInteractionChange]);

    useEffect(() => subscribeRectLabelOverlayPosition(({rectId, position}) => {
        const dropdown = dropdownRefs.current.get(rectId);
        if (!dropdown) return;

        dropdown.style.left = `${position.x}px`;
        dropdown.style.top = `${position.y}px`;
    }), []);

    if (!visible || !editorData?.viewPortContentImageRect || !editorData?.realImageSize) {
        return null;
    }

    return <div className='RectLabelDropdownLayer' ref={layerRef}>
        {labelRects
            .filter(labelRect => labelRect.isVisible
                && !labelRect.isPrompt
                && labelRect.status === LabelStatus.ACCEPTED)
            .map(labelRect => {
                const assignedLabel = labelNames.find(labelName => labelName.id === labelRect.labelId);
                const suggestedLabel = labelNames.find(labelName =>
                    labelName.name.toLowerCase() === labelRect.suggestedLabel?.toLowerCase());
                const currentLabel = assignedLabel || suggestedLabel;
                const value = currentLabel?.id || '';
                const displayName = currentLabel?.name || labelRect.suggestedLabel || '选择标签';
                const position = RenderEngineUtil.transferPointFromImageToViewPortContent(
                    {x: labelRect.rect.x, y: labelRect.rect.y},
                    editorData,
                );
                const style1 = styleVariant === 'style-1';
                const width = style1
                    ? Math.min(160, Math.max(64, displayName.length * 7.2 + 30))
                    : Math.min(160, Math.max(32, displayName.length * 7.2 + 8));
                const isOpen = openRectId === labelRect.id;
                const labelColor = enablePerClassColoration ? currentLabel?.color : undefined;
                const triggerBackground = labelColor
                    ? withAlpha(labelColor, 0.8)
                    : 'rgba(255, 255, 255, 0.8)';

                return <div
                    className={`RectLabelDropdown RectLabelDropdown--${styleVariant}${isOpen ? ' is-open' : ''}`}
                    data-label-rect-id={labelRect.id}
                    key={labelRect.id}
                    ref={element => {
                        if (element) dropdownRefs.current.set(labelRect.id, element);
                        else dropdownRefs.current.delete(labelRect.id);
                    }}
                    style={{top: position.y, left: position.x, width}}
                    onMouseEnter={() => onInteractionChange(true)}
                    onMouseLeave={() => {
                        if (!isOpen) onInteractionChange(false);
                    }}
                    onMouseDown={stopPropagation}
                    onMouseUp={stopPropagation}
                    onClick={stopPropagation}
                >
                    <button
                        aria-expanded={isOpen}
                        aria-haspopup='listbox'
                        aria-label={`修改 ${displayName} 标签`}
                        className='RectLabelDropdown__trigger'
                        style={style1 ? undefined : {
                            backgroundColor: triggerBackground,
                            color: labelColor ? '#fff' : '#000',
                        }}
                        title='点击切换标注标签'
                        type='button'
                        onClick={() => {
                            onActivate(labelRect.id);
                            onInteractionChange(true);
                            setOpenRectId(isOpen ? null : labelRect.id);
                        }}
                        onFocus={() => {
                            onActivate(labelRect.id);
                            onInteractionChange(true);
                        }}
                        onKeyDown={event => {
                            if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                setOpenRectId(labelRect.id);
                            }
                        }}
                    >
                        {style1 && <span
                            aria-hidden='true'
                            className='RectLabelDropdown__color'
                            style={{backgroundColor: currentLabel?.color || '#ec2aa6'}}
                        />}
                        <span className='RectLabelDropdown__name'>{displayName}</span>
                    </button>
                    {isOpen && <div
                        aria-label='选择标注标签'
                        className='RectLabelDropdown__menu'
                        role='listbox'
                    >
                        {labelNames.map(labelName => {
                            const selected = labelName.id === value;
                            return <button
                                aria-label={labelName.name}
                                aria-selected={selected}
                                className={`RectLabelDropdown__option${selected ? ' is-selected' : ''}`}
                                key={labelName.id}
                                role='option'
                                type='button'
                                onClick={() => {
                                    onChange(labelRect.id, labelName.id);
                                    setOpenRectId(null);
                                    onInteractionChange(false);
                                }}
                            >
                                <span aria-hidden='true' className='RectLabelDropdown__check'>
                                    {selected ? '✓' : ''}
                                </span>
                                <span
                                    aria-hidden='true'
                                    className='RectLabelDropdown__optionColor'
                                    style={{backgroundColor: labelName.color || '#888'}}
                                />
                                <span className='RectLabelDropdown__optionName'>{labelName.name}</span>
                            </button>;
                        })}
                    </div>}
                </div>;
            })}
    </div>;
};
