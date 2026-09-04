import React, {useState} from 'react';
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
}

const EditorView: React.FC<IProps> = ({activePopupType}) => {
    const [platformMode, setPlatformMode] = useState<'annotation' | 'control'>('control');

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
                onPlatformSwitch={() => setPlatformMode(mode => mode === 'annotation' ? 'control' : 'annotation')}
            />
            {platformMode === 'control'
                ? <ControlCenterView onCameraOpened={() => setPlatformMode('annotation')}/>
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
