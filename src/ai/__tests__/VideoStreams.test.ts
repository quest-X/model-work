import {TextDecoder, TextEncoder} from 'util';
import {waitFor} from '@testing-library/react';
import {DetectSessionAPIService} from '../DetectSessionAPIService';
import {TrackingAPIService} from '../TrackingAPIService';

jest.mock('../../utils/DefaultBackendUrl', () => ({getEngineBaseUrl: () => '/core_service'}));

describe.each(['detect', 'track'])('%s video stream', kind => {
    const previousFetch = global.fetch;
    const previousDecoder = global.TextDecoder;
    afterEach(() => { global.fetch = previousFetch; global.TextDecoder = previousDecoder; });

    it.each([
        ['complete', '{"frame_idx":1,"detections":[],"mask":[]}\n{"done":true,"total":1}', true],
        ['truncated', '{"frame_idx":1,"detections":[],"mask":[]}\n', false],
        ['malformed', '<html>upstream failed</html>', false],
        ['cancelled', '{"cancelled":true,"done":true,"total":0}\n', false],
    ])('%s is not confused with successful completion', async (_case, payload, success) => {
        global.TextDecoder = TextDecoder as typeof global.TextDecoder;
        const encoder = new TextEncoder();
        const reader = {
            read: jest.fn().mockResolvedValueOnce({done: false, value: encoder.encode(payload.slice(0, 7))})
                .mockResolvedValueOnce({done: false, value: encoder.encode(payload.slice(7))})
                .mockResolvedValue({done: true}),
            cancel: jest.fn().mockResolvedValue(undefined), releaseLock: jest.fn(),
        };
        global.fetch = jest.fn().mockResolvedValue({ok: true, body: {getReader: () => reader}});
        const callbacks = {onFrame: jest.fn(), onDone: jest.fn(), onError: jest.fn()};
        if (kind === 'detect') DetectSessionAPIService.streamDetectSession({sessionId: 'fixture', start: 1, end: 2}, callbacks);
        else TrackingAPIService.streamTrack({sessionId: 'fixture', startFrame: 1, endFrame: 1,
            modelName: 'sam2_t.pt', bbox: [0, 0, 10, 10]}, callbacks);
        await waitFor(() => expect(reader.releaseLock).toHaveBeenCalled());
        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(callbacks.onDone).toHaveBeenCalledTimes(success ? 1 : 0);
        expect(callbacks.onError).toHaveBeenCalledTimes(success ? 0 : 1);
        if (success) expect(callbacks.onFrame).toHaveBeenCalledWith({frame_idx: 1, detections: [], mask: []});
    });
});
