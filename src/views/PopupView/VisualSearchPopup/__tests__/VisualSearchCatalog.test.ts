import {
    collectionSupportsQuery,
    normalizeVisualSearchCollection,
    visualSearchCollectionLabel,
} from '../VisualSearchCatalog';

describe('VisualSearchCatalog', () => {
    it('preserves exact profile identity while leaving unknown revisions null', () => {
        const collection = normalizeVisualSearchCollection({
            name: 'line-a/scratch/v3',
            display_name: 'Scratch v3',
            scene_name: 'Line A',
            target_name: 'Scratch',
            version: 3,
            granularity: 'bbox',
            count: 42,
            dataset_id: 'dataset-1',
            dataset_revision: null,
            dataset_revisions: {'dataset-1': 7, 'dataset-2': 'rev-4'},
            collection_revision: null,
            profile: {
                profile_id: 'dinov3-sat',
                model: 'dinov3_vits16',
                model_revision: null,
                granularity: 'bbox',
            },
        });

        expect(collection).not.toBeNull();
        if (!collection) throw new Error('expected a normalized collection');
        expect(collection).toEqual(expect.objectContaining({
            name: 'line-a/scratch/v3',
            profileId: 'dinov3-sat',
            modelName: 'dinov3_vits16',
            modelRevision: null,
            collectionRevision: null,
            datasetId: 'dataset-1',
            datasetRevision: null,
            datasetRevisions: {'dataset-1': 7, 'dataset-2': 'rev-4'},
        }));
        expect(visualSearchCollectionLabel(collection)).toBe(
            'Line A / Scratch / v3 · dinov3-sat',
        );
    });

    it('allows only populated, compatible collections with the exact query kind', () => {
        const base = normalizeVisualSearchCollection({
            name: 'scene/target/v1',
            profile_id: 'profile-1',
            granularity: 'bbox',
            count: 10,
            compatible: true,
        });
        if (!base) throw new Error('expected a normalized collection');

        expect(collectionSupportsQuery(base, 'bbox')).toBe(true);
        expect(collectionSupportsQuery(base, 'image')).toBe(false);
        expect(collectionSupportsQuery(base, 'mask')).toBe(false);
        expect(collectionSupportsQuery({...base, granularity: 'mask'}, 'mask')).toBe(true);
        expect(collectionSupportsQuery({...base, count: 0}, 'bbox')).toBe(false);
        expect(collectionSupportsQuery({...base, compatible: false}, 'bbox')).toBe(false);
    });

    it('fails closed when kind or compatibility metadata is absent', () => {
        expect(normalizeVisualSearchCollection({
            name: 'scene/target/v1',
            profile_id: 'profile-1',
            count: 10,
            compatible: true,
        })).toBeNull();
        const collection = normalizeVisualSearchCollection({
            name: 'scene/target/v1',
            profile_id: 'profile-1',
            granularity: 'image',
            count: 10,
        });
        expect(collection).toEqual(expect.objectContaining({compatible: false}));
        expect(collection && collectionSupportsQuery(collection, 'image')).toBe(false);
    });

    it('drops catalog rows without stable collection and profile identity', () => {
        expect(normalizeVisualSearchCollection({
            name: 'scene/target/v1',
            count: 10,
        })).toBeNull();
        expect(normalizeVisualSearchCollection({
            profile_id: 'profile-1',
            count: 10,
        })).toBeNull();
    });
});
