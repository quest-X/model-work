export interface DatasetActionTarget {
    id: string;
    name: string;
    projectName?: string | null;
    revision: number;
    imageCount: number;
    classCount: number;
    sourceId?: string | null;
}

let editTarget: DatasetActionTarget | null = null;
let exportTarget: DatasetActionTarget | null = null;
let inferenceDatasetId: string | null = null;

export const DatasetEditSelection = {
    set: (target: DatasetActionTarget | null) => { editTarget = target; },
    get: () => editTarget,
};

export const DatasetExportSelection = {
    set: (target: DatasetActionTarget | null) => { exportTarget = target; },
    get: () => exportTarget,
};

export const DatasetInferenceSelection = {
    set: (datasetId: string | null) => { inferenceDatasetId = datasetId; },
    get: () => inferenceDatasetId,
};

export const clearDatasetActionSelections = () => {
    editTarget = null;
    exportTarget = null;
    inferenceDatasetId = null;
};
