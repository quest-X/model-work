import React from 'react';
import './EditorView.scss';
import EditorContainer from './EditorContainer/EditorContainer';
import {PopupWindowType} from '../../data/enums/PopupWindowType';
import {AppState} from '../../store';
import {connect} from 'react-redux';
import classNames from 'classnames';
import TopNavigationBar from './TopNavigationBar/TopNavigationBar';
import ControlCenterView from '../ControlCenterView/ControlCenterView';
import AgentSideChat from '../Common/AgentSideChat/AgentSideChat';
import AgentChatTrigger from '../Common/AgentSideChat/AgentChatTrigger';

interface IProps {
    activePopupType: PopupWindowType;
    platformMode: PlatformMode;
    onPlatformSwitch: () => void;
}

export type PlatformMode = 'annotation' | 'control';

const EditorView: React.FC<IProps> = ({activePopupType, platformMode, onPlatformSwitch}) => {

    const getClassName = () => {
        return classNames(
            'EditorView',
            {
                'withPopup': !!activePopupType
            }
        );
    };

    return (
        <div
            className={getClassName()}
            draggable={false}
        >
            <TopNavigationBar
                platformMode={platformMode}
                onPlatformSwitch={onPlatformSwitch}
            />
            {platformMode === 'control'
                ? <ControlCenterView/>
                : <EditorContainer/>}
            <AgentChatTrigger/>
            <AgentSideChat/>
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    activePopupType: state.general.activePopupType
});

export default connect(
    mapStateToProps
)(EditorView);
