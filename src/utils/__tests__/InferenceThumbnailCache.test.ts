import {InferenceThumbnailCache} from '../InferenceThumbnailCache';

describe('InferenceThumbnailCache', () => {
    const blob = (size: number) => new Blob(['x'.repeat(size)], {type: 'image/jpeg'});

    it('deduplicates concurrent generation and reuses the cached object URL', async () => {
        const createObjectUrl = jest.fn(() => 'blob:thumb-1');
        const revokeObjectUrl = jest.fn();
        const cache = new InferenceThumbnailCache(10, 1024, createObjectUrl, revokeObjectUrl);
        const generate = jest.fn(async () => blob(10));

        const [first, second] = await Promise.all([
            cache.getOrCreate('image:annotation', generate),
            cache.getOrCreate('image:annotation', generate),
        ]);

        expect(first).toBe('blob:thumb-1');
        expect(second).toBe('blob:thumb-1');
        expect(generate).toHaveBeenCalledTimes(1);
        expect(cache.get('image:annotation')).toBe('blob:thumb-1');
    });

    it('evicts the least-recently-used entry and revokes its object URL', async () => {
        let sequence = 0;
        const revokeObjectUrl = jest.fn();
        const cache = new InferenceThumbnailCache(
            2,
            1024,
            () => `blob:thumb-${++sequence}`,
            revokeObjectUrl
        );

        await cache.getOrCreate('a', async () => blob(10));
        await cache.getOrCreate('b', async () => blob(10));
        expect(cache.get('a')).toBe('blob:thumb-1');
        await cache.getOrCreate('c', async () => blob(10));

        expect(cache.get('b')).toBeNull();
        expect(cache.get('a')).toBe('blob:thumb-1');
        expect(cache.get('c')).toBe('blob:thumb-3');
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:thumb-2');
    });

    it('does not memoize failures, so a later attempt can succeed', async () => {
        const cache = new InferenceThumbnailCache(10, 1024, () => 'blob:retry', jest.fn());
        const generate = jest.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(blob(10));

        expect(await cache.getOrCreate('retry', generate)).toBeNull();
        expect(await cache.getOrCreate('retry', generate)).toBe('blob:retry');
        expect(generate).toHaveBeenCalledTimes(2);
    });
});
