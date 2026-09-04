import {ContextManager} from '../hotkey/ContextManager';
import {store} from '../../index';
import {updateActivePopupType} from '../../store/general/actionCreators';
import {PopupWindowType} from '../../data/enums/PopupWindowType';

export class PopupActions {
    public static close() {
        store.dispatch(updateActivePopupType(null));
        ContextManager.restoreCtx();
    }

    public static openCameraConnect(nodeId: string | null = null) {
        store.dispatch(updateActivePopupType(PopupWindowType.CAMERA_CONNECT, nodeId));
    }

    public static openJetsonConnect(nodeId: string) {
        store.dispatch(updateActivePopupType(PopupWindowType.JETSON_CONNECT, nodeId));
    }
}
