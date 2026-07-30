import {
    QueueActionTypes,
    QueueDataSyncStatus,
    QueueState,
} from './types';
import { Action } from '../Actions';
import {VisualSearchBBoxAcceptance} from '../labels/types';

type AcceptVisualSearchBBoxAction = {
    type: Action.ACCEPT_VISUAL_SEARCH_BBOX;
    payload: VisualSearchBBoxAcceptance;
};

const initialState: QueueState = {
    items: [],
    activeQueueItemId: null
};

export function queueReducer(
    state = initialState,
    action: QueueActionTypes | AcceptVisualSearchBBoxAction
): QueueState {
    switch (action.type) {
        case Action.ADD_QUEUE_ITEM: {
            // Add to the beginning of the array (newest first)
            return {
                ...state,
                items: [action.payload.item, ...state.items]
            };
        }
        case Action.ADD_QUEUE_ITEMS: {
            // Add all items to the beginning (newest first)
            return {
                ...state,
                items: [...action.payload.items, ...state.items]
            };
        }
        case Action.REMOVE_QUEUE_ITEM: {
            return {
                ...state,
                items: state.items.filter(item => item.id !== action.payload.itemId),
                activeQueueItemId: state.activeQueueItemId === action.payload.itemId 
                    ? null 
                    : state.activeQueueItemId
            };
        }
        case Action.UPDATE_QUEUE_ITEM: {
            return {
                ...state,
                items: state.items.map(item =>
                    item.id === action.payload.itemId
                        ? { ...item, ...action.payload.updates }
                        : item
                )
            };
        }
        case Action.SET_ACTIVE_QUEUE_ITEM: {
            return {
                ...state,
                activeQueueItemId: action.payload.itemId
            };
        }
        case Action.CLEAR_QUEUE: {
            return initialState;
        }
        case Action.ACCEPT_VISUAL_SEARCH_BBOX: {
            return {
                ...state,
                items: state.items.map(item =>
                    item.id === action.payload.queueItemId
                        ? {...item, dataSyncStatus: QueueDataSyncStatus.DIRTY}
                        : item),
            };
        }
        default:
            return state;
    }
}
