import React from 'react';
import {connect} from 'react-redux';
import {Language} from '../../../data/LanguageConfig';
import {AppState} from '../../../store';
import {AGENT_CHAT_TOGGLE_EVENT} from './AgentSideChat';
import './AgentSideChat.scss';

interface IProps {
    language: Language;
}

export const AgentChatTrigger: React.FC<IProps> = ({language}) => {
    const zh = language === Language.CHINESE;
    return <button
        type='button'
        className='AgentChatTrigger'
        aria-label={zh ? '打开 OpenSight Agent' : 'Open OpenSight Agent'}
        title={zh ? '打开 OpenSight Agent' : 'Open OpenSight Agent'}
        onClick={() => window.dispatchEvent(new Event(AGENT_CHAT_TOGGLE_EVENT))}
    >
        <img draggable={false} alt='' src='/ico/agent-chat.svg'/>
    </button>;
};

const mapStateToProps = (state: AppState) => ({language: state.general.language});

export default connect(mapStateToProps)(AgentChatTrigger);
