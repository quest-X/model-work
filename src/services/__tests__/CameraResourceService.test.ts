import {CameraResource, CameraResourceService} from '../CameraResourceService';
import {AutoSaveService} from '../AutoSaveService';
import {QueueActions} from '../../logic/actions/QueueActions';
import {QueueItemType} from '../../store/queue/types';

const dispatch = jest.fn();
const getState = jest.fn();

jest.mock('../../index', () => ({
    store: {dispatch, getState},
}));

jest.mock('../../logic/actions/QueueActions', () => ({
    QueueActions: {switchToQueueItem: jest.fn()},
}));

jest.mock('../AutoSaveService', () => ({
    AutoSaveService: {saveCurrentState: jest.fn()},
}));

const resource: CameraResource = {
    id: 'resource-1',
    name: 'North gate',
    host: '192.168.10.12',
    port: 80,
    rtsp_port: 554,
    scheme: 'http',
    channel_id: '101',
    device: {
        name: 'North gate',
        model: 'DS-2CD2686FWDA2-IZS',
        serial_number: '',
        firmware_version: '',
        device_type: 'IPC',
        mac_address: '',
    },
    channels: [],
    created_at: '2026-08-10T00:00:00Z',
    updated_at: '2026-08-10T00:00:00Z',
};

describe('CameraResourceService persistence', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getState.mockReturnValue({queue: {items: []}});
        (QueueActions.switchToQueueItem as jest.Mock).mockResolvedValue(undefined);
        (AutoSaveService.saveCurrentState as jest.Mock).mockResolvedValue(undefined);
    });

    it('durably saves the camera queue before open completes', async () => {
        await CameraResourceService.open(resource, []);

        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            payload: {item: expect.objectContaining({
                id: 'camera-resource-1',
                type: QueueItemType.CAMERA,
                cameraResourceId: 'resource-1',
                cameraChannelId: '101',
            })},
        }));
        expect(QueueActions.switchToQueueItem).toHaveBeenCalledWith(
            expect.objectContaining({id: 'camera-resource-1'}),
            [],
        );
        expect(AutoSaveService.saveCurrentState).toHaveBeenCalledWith(true);
        expect((QueueActions.switchToQueueItem as jest.Mock).mock.invocationCallOrder[0])
            .toBeLessThan((AutoSaveService.saveCurrentState as jest.Mock).mock.invocationCallOrder[0]);
    });
});
