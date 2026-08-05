/**
 * 推导默认 backend 地址 —— 使用浏览器当前页面的同源网关。
 *
 * 浏览器只连接承载前端的 HTTP origin；`/core_service` 与
 * `/extension_service` 由 OpenSight gateway 转发到宿主机内部的 HTTPS backend。
 * 因此任意内网机器部署后都不需要让客户端信任自签名证书。
 *
 * Electron/file:// 没有可用 origin，保留直连 localhost backend 的兼容回退。
 */

const DEFAULT_BACKEND_PORT = 58600;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** 返回不带路径的同源 gateway base，例如 `http://192.168.1.205:3001`。 */
export const getDefaultBackendBase = (): string => {
    if (typeof window === 'undefined' || !window.location) {
        return `https://localhost:${DEFAULT_BACKEND_PORT}`;
    }
    const {protocol, origin} = window.location;
    if ((protocol === 'http:' || protocol === 'https:') && origin && origin !== 'null') {
        return origin;
    }
    return `https://localhost:${DEFAULT_BACKEND_PORT}`;
};

/** Legacy bare-server helper. Service calls should use a service-specific base below. */
export const getDefaultBackendUrl = (path: string = ''): string => {
    const base = getDefaultBackendBase();
    if (!path) return base;
    return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
};

export type ServiceEngineType = 'core' | 'extension';

const SERVICE_PATH_BY_TYPE: Record<ServiceEngineType, string> = {
    core: 'core_service',
    extension: 'extension_service',
};

/** Canonicalise legacy root/capability URLs to the new service boundary. */
export const normalizeEngineBaseUrl = (url: string, type: ServiceEngineType): string => {
    const servicePath = SERVICE_PATH_BY_TYPE[type];
    let base = url.trim().replace(/\/+$/, '');
    if (!base) return base;
    if (base.endsWith(`/${servicePath}`)) return base;
    base = base.replace(/\/(?:core_service|extension_service|core|extension|detect|segment|ocr)$/i, '');
    return `${base}/${servicePath}`;
};

export const getDefaultCoreServiceBase = (): string =>
    normalizeEngineBaseUrl(getDefaultBackendBase(), 'core');

export const getDefaultExtensionServiceBase = (): string =>
    normalizeEngineBaseUrl(getDefaultBackendBase(), 'extension');

export const getDefaultCoreServiceUrl = (path: string = ''): string => {
    const base = getDefaultCoreServiceBase();
    if (!path) return base;
    return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
};

/**
 * Old engine registrations often point directly at the self-signed backend,
 * for example `https://192.168.10.205:58600`. When the UI is already served
 * by that host's gateway, keep browser traffic same-origin so certificates
 * and CORS cannot make otherwise healthy services look unavailable.
 */
export const resolveEngineBaseUrl = (url: string, type: ServiceEngineType): string => {
    const normalized = normalizeEngineBaseUrl(url, type);
    if (typeof window === 'undefined' || !window.location) return normalized;

    const {protocol, hostname} = window.location;
    if (protocol !== 'http:' && protocol !== 'https:') return normalized;

    try {
        const registered = new URL(normalized);
        const directBackend = registered.port === String(DEFAULT_BACKEND_PORT);
        const sameDeployment = registered.hostname === hostname || LOOPBACK_HOSTS.has(registered.hostname);
        if (directBackend && sameDeployment) {
            return type === 'core' ? getDefaultCoreServiceBase() : getDefaultExtensionServiceBase();
        }
    } catch {
        // Invalid custom URLs keep their existing normalized form and fail visibly at the caller.
    }
    return normalized;
};

// 由 index.tsx 在 store 初始化后注入,避免循环依赖 + require() 不可用的问题。
let _storeRef: { getState: () => any } | null = null;

/** index.tsx 在 store 创建后调用一次,之后 getEngineBaseUrl() 就能读到正确的 store 状态。 */
export const registerEngineStore = (s: { getState: () => any }): void => {
    _storeRef = s;
};

/**
 * 优先使用用户在「引擎管理」配置的对应引擎地址。
 *
 * 解决"model.work 前端 + 远程/本地后端"场景:getDefaultBackendBase() 在公网域名下
 * 回退到 localhost,但用户手动配的引擎 URL 才是正确的后端地址。
 *
 * Core capabilities call getEngineBaseUrl(); optional services call
 * getExtensionEngineBaseUrl(). The two service boundaries never fall back to
 * each other's registered engine.
 */
const getRegisteredEngineBaseUrl = (type: ServiceEngineType): string | null => {
    try {
        if (_storeRef) {
            const state = _storeRef.getState();
            const models: any[] = state.aimodels?.models ?? [];
            const matchingModels = models.filter((m: any) => m.modelType === type && m.url);
            const activeId = state.aimodels?.activeModelId;
            if (activeId) {
                const active = matchingModels.find((m: any) => m.id === activeId);
                if (active?.url) return resolveEngineBaseUrl(active.url, type);
            }
            const enabled = matchingModels.find((m: any) => m.isActive);
            if (enabled?.url) return resolveEngineBaseUrl(enabled.url, type);
            if (matchingModels[0]?.url) return resolveEngineBaseUrl(matchingModels[0].url, type);
        }
    } catch {
        // store 访问失败
    }
    return null;
};

/** Core engine base used by detection, segmentation, OCR and core services. */
export const getEngineBaseUrl = (): string =>
    getRegisteredEngineBaseUrl('core') ?? getDefaultCoreServiceBase();

/** Extension engine base used by vector search and other optional services. */
export const getExtensionEngineBaseUrl = (): string =>
    getRegisteredEngineBaseUrl('extension') ?? getDefaultExtensionServiceBase();
