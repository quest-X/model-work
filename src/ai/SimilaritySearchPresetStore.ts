export type SimilaritySearchMode = 'dino' | 'l2g';

export interface SimilaritySearchPreset {
    mode: SimilaritySearchMode;
    sceneId: string;
    sceneName: string;
    targetId: string;
    targetName: string;
    collectionName: string;
    collectionVersion: number;
    dataVersion: number;
    datasetId?: string;
    queryFile: File;
}

let pendingPreset: SimilaritySearchPreset | null = null;

export const queueSimilaritySearchPreset = (preset: SimilaritySearchPreset): void => {
    pendingPreset = preset;
};

export const consumeSimilaritySearchPreset = (): SimilaritySearchPreset | null => {
    const preset = pendingPreset;
    pendingPreset = null;
    return preset;
};
