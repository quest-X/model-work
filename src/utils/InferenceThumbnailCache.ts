type ObjectUrlFactory = (blob: Blob) => string;
type ObjectUrlRevoker = (url: string) => void;

type CacheEntry = {
    url: string;
    bytes: number;
};

export class InferenceThumbnailCache {
    private readonly entries = new Map<string, CacheEntry>();
    private readonly pending = new Map<string, Promise<string | null>>();
    private totalBytes = 0;

    public constructor(
        private readonly maxEntries: number = 2048,
        private readonly maxBytes: number = 32 * 1024 * 1024,
        private readonly createObjectUrl: ObjectUrlFactory = (blob: Blob) => URL.createObjectURL(blob),
        private readonly revokeObjectUrl: ObjectUrlRevoker = (url: string) => URL.revokeObjectURL(url)
    ) {}

    public get(key: string): string | null {
        const entry = this.entries.get(key);
        if (!entry) return null;

        // Map insertion order is the LRU order. Reinsert hits as most-recent.
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.url;
    }

    public getOrCreate(key: string, generate: () => Promise<Blob | null>): Promise<string | null> {
        const cachedUrl = this.get(key);
        if (cachedUrl) return Promise.resolve(cachedUrl);

        const pendingJob = this.pending.get(key);
        if (pendingJob) return pendingJob;

        const job = generate()
            .then(blob => blob ? this.store(key, blob) : null)
            .finally(() => this.pending.delete(key));
        this.pending.set(key, job);
        return job;
    }

    public delete(key: string): void {
        const entry = this.entries.get(key);
        if (!entry) return;
        this.entries.delete(key);
        this.totalBytes -= entry.bytes;
        this.revokeObjectUrl(entry.url);
    }

    public clear(): void {
        Array.from(this.entries.keys()).forEach(key => this.delete(key));
    }

    private store(key: string, blob: Blob): string {
        this.delete(key);

        const url = this.createObjectUrl(blob);
        this.entries.set(key, {url, bytes: blob.size});
        this.totalBytes += blob.size;
        this.trim();
        return url;
    }

    private trim(): void {
        while (
            this.entries.size > 1 &&
            (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes)
        ) {
            const oldestKey = this.entries.keys().next().value as string | undefined;
            if (!oldestKey) return;
            this.delete(oldestKey);
        }
    }
}

export const inferenceThumbnailCache = new InferenceThumbnailCache();
