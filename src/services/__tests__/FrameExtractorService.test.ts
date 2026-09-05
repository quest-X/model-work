import axios from 'axios';
import JSZip from 'jszip';
import {FrameExtractorService} from '../FrameExtractorService';

jest.mock('axios');
jest.mock('../../utils/DefaultBackendUrl', () => ({getEngineBaseUrl: () => '/core_service'}));
jest.mock('../TaskTracker', () => ({TaskTracker: {}}));
jest.mock('../../index', () => ({store: {}}));

describe('FrameExtractorService response integrity', () => {
    beforeEach(() => jest.clearAllMocks());

    it.each([
        [2, ['frame_000001.jpg', 'frame_000002.jpg'], 2, true],
        [2, ['frame_000003.jpg', 'frame_000004.jpg'], 2, true],
        [3, ['frame_000001.jpg'], 1, false],
        [2, [], 0, false],
        [2, ['frame_000001.jpg'], 2, false],
        [2, ['frame_000001.jpg', 'frame_000003.jpg'], 2, false],
    ])('validates metadata and consecutive ZIP frames %#', async (startFrame, names, batchFrames, valid) => {
        const zip = new JSZip();
        for (const name of names as string[]) zip.file(name, 'frame');
        (axios.get as jest.Mock).mockResolvedValue({
            headers: {'x-frame-metadata': JSON.stringify({startFrame, batchFrames})},
            data: await zip.generateAsync({type: 'arraybuffer'}),
        });
        const result = FrameExtractorService.fetchFrameRange('session', 2, 2);
        if (valid) expect((await result).map(file => file.name)).toEqual(['frame_000002.jpg', 'frame_000003.jpg']);
        else await expect(result).rejects.toThrow(/Missing or misaligned/);
    });

    it('rejects invalid upload metadata before declaring a usable session', async () => {
        (axios.post as jest.Mock).mockResolvedValue({data: {sessionId: 'fixture', metadata: {totalFrames: 0}}});
        await expect(FrameExtractorService.uploadVideo(new File(['video'], 'video.mp4'))).rejects.toThrow(/Invalid video metadata/);
    });
});
