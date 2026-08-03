import {AIModelsStorageManager} from '../AIModelsStorageManager';
import {
    getDefaultCoreServiceBase,
    getEngineBaseUrl,
    normalizeEngineBaseUrl,
    registerEngineStore,
    resolveEngineBaseUrl,
} from '../DefaultBackendUrl';

describe('engine service URL normalization', () => {
    it('uses the browser origin as the default same-origin gateway', () => {
        expect(getDefaultCoreServiceBase()).toBe('http://localhost/core_service');
    });

    it('adds the core service boundary to legacy server and capability URLs', () => {
        expect(normalizeEngineBaseUrl('https://localhost:58600', 'core'))
            .toBe('https://localhost:58600/core_service');
        expect(normalizeEngineBaseUrl('https://localhost:58600/detect', 'core'))
            .toBe('https://localhost:58600/core_service');
        expect(normalizeEngineBaseUrl('https://localhost:58600/core_service/', 'core'))
            .toBe('https://localhost:58600/core_service');
    });

    it('keeps extension engines on their own service boundary', () => {
        expect(normalizeEngineBaseUrl('https://engine.example.test', 'extension'))
            .toBe('https://engine.example.test/extension_service');
    });

    it('routes a same-deployment direct backend registration through the browser gateway', () => {
        registerEngineStore({
            getState: () => ({
                aimodels: {
                    activeModelId: 'core-engine',
                    models: [{
                        id: 'core-engine',
                        modelType: 'core',
                        url: 'https://localhost:58600/core_service',
                        isActive: true,
                    }],
                },
            }),
        });

        expect(getEngineBaseUrl()).toBe('http://localhost/core_service');
    });

    it('routes an explicitly selected same-deployment engine through the browser gateway', () => {
        expect(resolveEngineBaseUrl('https://localhost:58600', 'core'))
            .toBe('http://localhost/core_service');
    });

    it('preserves a genuinely remote registered engine', () => {
        registerEngineStore({
            getState: () => ({
                aimodels: {
                    activeModelId: 'remote-core',
                    models: [{
                        id: 'remote-core',
                        modelType: 'core',
                        url: 'https://engine.example.test:58600',
                        isActive: true,
                    }],
                },
            }),
        });

        expect(getEngineBaseUrl()).toBe('https://engine.example.test:58600/core_service');
    });
});

describe('stored engine migration', () => {
    beforeEach(() => localStorage.clear());

    it('collapses legacy capability engines into one enabled core registration', () => {
        localStorage.setItem('make-sense-ai-models', JSON.stringify({
            version: '2.1.0',
            models: [
                {
                    id: 'core-first',
                    name: 'Old core',
                    url: 'https://localhost:58600',
                    modelType: 'core',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    isActive: false,
                },
                {
                    id: 'legacy-detection',
                    name: 'Detection',
                    url: 'https://localhost:58600/detect',
                    modelType: 'detection',
                    createdAt: '2026-01-02T00:00:00.000Z',
                    isActive: true,
                },
            ],
        }));

        expect(AIModelsStorageManager.loadModels()).toEqual([
            expect.objectContaining({
                id: 'core-first',
                modelType: 'core',
                url: 'https://localhost:58600/core_service',
                isActive: true,
            }),
        ]);
    });
});
