import {useEffect, useRef} from 'react';

type EscapeCloser = {
    close: () => void;
    order: number;
    priority: number;
};

const escapeClosers = new Map<symbol, EscapeCloser>();
let registrationOrder = 0;
let listening = false;

const closeTopWindow = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || escapeClosers.size === 0) return;
    const top = [...escapeClosers.values()].sort((left, right) =>
        right.priority - left.priority || right.order - left.order)[0];
    event.preventDefault();
    event.stopImmediatePropagation();
    top.close();
};

const updateListener = () => {
    if (escapeClosers.size > 0 && !listening) {
        window.addEventListener('keydown', closeTopWindow, true);
        listening = true;
    } else if (escapeClosers.size === 0 && listening) {
        window.removeEventListener('keydown', closeTopWindow, true);
        listening = false;
    }
};

/** Registers one dismissible window; Escape closes only the highest-priority, newest entry. */
export const useEscapeToClose = (onClose: () => void, enabled = true, priority = 0) => {
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        if (!enabled) return undefined;
        const token = Symbol('escape-closer');
        escapeClosers.set(token, {
            close: () => closeRef.current(),
            order: ++registrationOrder,
            priority,
        });
        updateListener();
        return () => {
            escapeClosers.delete(token);
            updateListener();
        };
    }, [enabled, priority]);
};
