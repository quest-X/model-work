import {IPoint} from '../interfaces/IPoint';

interface RectLabelOverlayPositionUpdate {
    rectId: string;
    position: IPoint;
}

type RectLabelOverlayPositionListener = (update: RectLabelOverlayPositionUpdate) => void;

const listeners = new Set<RectLabelOverlayPositionListener>();

export const publishRectLabelOverlayPosition = (rectId: string, position: IPoint): void => {
    listeners.forEach(listener => listener({rectId, position}));
};

export const subscribeRectLabelOverlayPosition = (
    listener: RectLabelOverlayPositionListener,
): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};
