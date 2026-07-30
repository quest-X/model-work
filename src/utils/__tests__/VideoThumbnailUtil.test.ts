import {getVideoThumbnailSize} from '../VideoThumbnailUtil';

describe('getVideoThumbnailSize', () => {
    it('preserves a landscape video aspect ratio', () => {
        expect(getVideoThumbnailSize(2560, 1440)).toEqual({width: 200, height: 113});
    });

    it('preserves a portrait video aspect ratio', () => {
        expect(getVideoThumbnailSize(1080, 1920)).toEqual({width: 113, height: 200});
    });

    it('does not upscale a small frame', () => {
        expect(getVideoThumbnailSize(100, 50)).toEqual({width: 100, height: 50});
    });
});
