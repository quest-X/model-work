import axios from 'axios';
import {DetectionAPIDetector} from '../DetectionAPIDetector';
import {SegmentationAPIDetector} from '../SegmentationAPIDetector';

jest.mock('axios', () => ({
    __esModule: true,
    default: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

jest.mock('../../index', () => ({
    store: {
        getState: jest.fn(() => ({})),
    },
}));

jest.mock('../../store/selectors/AIModelsSelector', () => ({
    AIModelsSelector: {
        getActiveModelByType: jest.fn(() => ({
            id: 'legacy-core',
            name: 'Legacy core engine',
            modelType: 'core',
            url: 'https://localhost:58600/core_service',
        })),
    },
}));

jest.mock('../../utils/DefaultBackendUrl', () => ({
    getDefaultCoreServiceUrl: (path: string = '') =>
        `http://192.168.10.205:3001/core_service${path}`,
    getEngineBaseUrl: () => 'http://192.168.10.205:3001/core_service',
}));

describe('inference gateway routing', () => {
    const post = axios.post as jest.Mock;

    beforeEach(() => {
        post.mockReset().mockResolvedValue({
            data: {status: 'success', results: []},
        });
    });

    it('routes segmentation through the canonical same-origin core service', async () => {
        await SegmentationAPIDetector.predictFromBlob(
            new Blob(['pixels'], {type: 'image/jpeg'}),
            'frame.jpg'
        );

        expect(post).toHaveBeenCalledWith(
            'http://192.168.10.205:3001/core_service/segment',
            expect.any(FormData),
            expect.any(Object)
        );
    });

    it('routes batch detection through the canonical same-origin core service', async () => {
        await DetectionAPIDetector.predictBatchFromBlobs(
            [new Blob(['pixels'], {type: 'image/jpeg'})],
            ['frame.jpg']
        );

        expect(post).toHaveBeenCalledWith(
            'http://192.168.10.205:3001/core_service/batch_detect',
            expect.any(FormData),
            expect.any(Object)
        );
    });
});
