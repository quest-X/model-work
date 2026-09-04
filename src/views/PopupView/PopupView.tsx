import React, { useEffect } from 'react';
import './PopupView.scss';
import { PopupWindowType } from '../../data/enums/PopupWindowType';
import { AppState } from '../../store';
import { connect } from 'react-redux';
import { PopupActions } from '../../logic/actions/PopupActions';
import LoadLabelsPopup from './LoadLabelNamesPopup/LoadLabelNamesPopup';
import InsertLabelNamesPopup from './InsertLabelNamesPopup/InsertLabelNamesPopup';
import ExitProjectPopup from './ExitProjectPopup/ExitProjectPopup';
import LoadMoreMediaPopup from './LoadMoreMediaPopup/LoadMoreMediaPopup';
import SuggestLabelNamesPopup from './SuggestLabelNamesPopup/SuggestLabelNamesPopup';
import { CSSHelper } from '../../logic/helpers/CSSHelper';
import { ClipLoader } from 'react-spinners';
import ImportLabelPopup from './ImportLabelPopup/ImportLabelPopup';
import ExportLabelPopup from './ExportLabelsPopup/ExportLabelPopup';
import CallModelPopup from './CallModelPopup/CallModelPopup';
import LoadDetectionModelPopup from './LoadDetectionModelPopup/LoadDetectionModelPopup';
import ConnectInferenceServerPopup from './ConnectInferenceServerPopup/ConnectInferenceServerPopup';
import ModelEnginePopup from './ModelEnginePopup/ModelEnginePopup';
import ManageAIModelsPopup from './ManageAIModelsPopup/ManageAIModelsPopup';
import KeyboardShortcutsPopup from './KeyboardShortcutsPopup/KeyboardShortcutsPopup';
import ChangelogPopup from './ChangelogPopup/ChangelogPopup';
import PipelinePreprocessPopup from './PipelinePopup/PipelinePreprocessPopup';
import PipelineInferencePopup from './PipelinePopup/PipelineInferencePopup';
import PipelinePostprocessPopup from './PipelinePopup/PipelinePostprocessPopup';
import DataCenterPopup from './DataCenterPopup/DataCenterPopup';
import DatasetExportPopup from './DatasetExportPopup/DatasetExportPopup';
import DatasetInferencePopup from './DatasetInferencePopup/DatasetInferencePopup';
import TrainingTaskPopup from './TrainingTaskPopup/TrainingTaskPopup';
import VectorDbPopup from './VectorDbPopup/VectorDbPopup';
import L2GRetrievalPopup from './L2GRetrievalPopup/L2GRetrievalPopup';
import ModelInspectorPopup, {MODEL_INSPECTOR_ESCAPE_EVENT} from './ModelInspectorPopup/ModelInspectorPopup';
import VisualSearchPopup from './VisualSearchPopup/VisualSearchPopup';
import CameraConnectPopup from './CameraConnectPopup/CameraConnectPopup';
import JetsonConnectPopup from './JetsonConnectPopup/JetsonConnectPopup';
import ComputeClusterPopup from './ComputeClusterPopup/ComputeClusterPopup';
import {clearDatasetActionSelections} from '../../services/DatasetActionSelection';


interface IProps {
    activePopupType: PopupWindowType;
    activePopupNodeId: string | null;
    activePopupNodeName: string | null;
    activePopupNodeRemote: boolean;
}

const PopupView: React.FC<IProps> = (
    { activePopupType, activePopupNodeId, activePopupNodeName, activePopupNodeRemote },
) => {

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && activePopupType) {
                if (activePopupType === PopupWindowType.MODEL_INSPECTOR) {
                    const inspectorEscape = new Event(MODEL_INSPECTOR_ESCAPE_EVENT, {cancelable: true});
                    window.dispatchEvent(inspectorEscape);
                    if (inspectorEscape.defaultPrevented) {
                        event.preventDefault();
                        return;
                    }
                }
                // Only handle if no other element has already handled the event
                if (!event.defaultPrevented) {
                    event.preventDefault();
                    clearDatasetActionSelections();
                    PopupActions.close();
                }
            }
        };

        // Add event listener when popup is active
        if (activePopupType) {
            // Use capture phase to ensure we handle the event early
            window.addEventListener('keydown', handleKeyDown, true);
        }

        // Cleanup event listener
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [activePopupType]);

    const popupComponents: Partial<Record<PopupWindowType, () => any>> = {
        [PopupWindowType.LOAD_LABEL_NAMES]: () => <LoadLabelsPopup />,
        [PopupWindowType.EXPORT_ANNOTATIONS]: () => <ExportLabelPopup />,
        [PopupWindowType.IMPORT_ANNOTATIONS]: () => <ImportLabelPopup />,
        [PopupWindowType.INSERT_LABEL_NAMES]: () => <InsertLabelNamesPopup isUpdate={false} />,
        [PopupWindowType.UPDATE_LABEL]: () => <InsertLabelNamesPopup isUpdate={true} />,
        [PopupWindowType.EXIT_PROJECT]: () => <ExitProjectPopup />,
        [PopupWindowType.IMPORT_IMAGES]: () => <LoadMoreMediaPopup />,
        [PopupWindowType.CALL_MODEL]: () => <CallModelPopup />,
        [PopupWindowType.LOAD_DETECTION_MODEL]: () => <LoadDetectionModelPopup />,
        [PopupWindowType.CONNECT_AI_MODEL_VIA_API]: () => <ConnectInferenceServerPopup />,
        [PopupWindowType.MODEL_ENGINE]: () => <ModelEnginePopup />,
        [PopupWindowType.MANAGE_AI_MODELS]: () => <ManageAIModelsPopup />,
        [PopupWindowType.SUGGEST_LABEL_NAMES]: () => <SuggestLabelNamesPopup />,
        [PopupWindowType.KEYBOARD_SHORTCUTS]: () => <KeyboardShortcutsPopup />,
        [PopupWindowType.CHANGELOG]: () => <ChangelogPopup />,
        [PopupWindowType.PIPELINE_PREPROCESS]: () => <PipelinePreprocessPopup />,
        [PopupWindowType.PIPELINE_INFERENCE]: () => <PipelineInferencePopup />,
        [PopupWindowType.PIPELINE_POSTPROCESS]: () => <PipelinePostprocessPopup />,
        [PopupWindowType.DATA_CENTER]: () => <DataCenterPopup />,
        [PopupWindowType.DATASET_EXPORT]: () => <DatasetExportPopup />,
        [PopupWindowType.DATASET_INFERENCE]: () => <DatasetInferencePopup />,
        [PopupWindowType.TRAINING_TASK]: () => <TrainingTaskPopup />,
        [PopupWindowType.VECTOR_DB]: () => <VectorDbPopup />,
        [PopupWindowType.L2G_RETRIEVAL]: () => <L2GRetrievalPopup />,
        [PopupWindowType.VISUAL_SEARCH]: () => <VisualSearchPopup />,
        [PopupWindowType.MODEL_INSPECTOR]: () => <ModelInspectorPopup />,
        [PopupWindowType.CAMERA_CONNECT]: () => <CameraConnectPopup
            nodeId={activePopupNodeId}
            nodeName={activePopupNodeName}
            remote={activePopupNodeRemote}
        />,
        [PopupWindowType.JETSON_CONNECT]: () => <JetsonConnectPopup
            nodeId={activePopupNodeId}
            nodeName={activePopupNodeName}
            remote={activePopupNodeRemote}
        />,
        [PopupWindowType.COMPUTE_CLUSTER]: () => <ComputeClusterPopup />,
        [PopupWindowType.LOADER]: () => <ClipLoader size={50} color={CSSHelper.getLeadingColor()} loading={true} />,
    };

    const selectPopup = () => {
        const render = popupComponents[activePopupType];
        return render ? render() : null;
    };

    return (
        activePopupType && <div className='PopupView'>
            {selectPopup()}
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    activePopupType: state.general.activePopupType,
    activePopupNodeId: state.general.activePopupNodeId,
    activePopupNodeName: state.general.activePopupNodeName,
    activePopupNodeRemote: state.general.activePopupNodeRemote,
});

export default connect(
    mapStateToProps
)(PopupView);
