export type CanvasViewLayout = '1x1' | '2x2' | '1x3';
export type CanvasViewKind = 'original' | 'heatmap' | 'features' | 'attention';

export interface CanvasMultiViewState {
    layout: CanvasViewLayout;
    views: CanvasViewKind[];
}

const defaults: Record<CanvasViewLayout, CanvasViewKind[]> = {
    '1x1': ['original'],
    '2x2': ['original', 'heatmap', 'features', 'attention'],
    '1x3': ['original', 'heatmap', 'features', 'attention'],
};

let current: CanvasMultiViewState = {layout: '1x1', views: defaults['1x1']};
const listeners = new Set<(state: CanvasMultiViewState) => void>();

const publish = () => listeners.forEach(listener => listener(current));

export const CanvasMultiViewStore = {
    get: (): CanvasMultiViewState => current,
    subscribe(listener: (state: CanvasMultiViewState) => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    setLayout(layout: CanvasViewLayout): void {
        current = {layout, views: [...defaults[layout]]};
        publish();
    },
    setView(index: number, view: CanvasViewKind): void {
        if (index === 0) return;
        const views = [...current.views];
        views[index] = view;
        current = {...current, views};
        publish();
    },
};
