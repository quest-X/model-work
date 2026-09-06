/** Personal approval keys stay in page memory, never in browser storage or requests. */
import {sha256Bytes} from '../utils/Sha256';

export type ApprovalUser = {user_id: string; user_name: string; user_public_key: string};
export type ApprovalIdentity = {privateKey: CryptoKey | null; user: ApprovalUser; source?: 'account'};
export type ApprovalRequest = {
    version: 1;
    purpose: 'model-work-node.user-authorization.v1';
    authorization_id: string;
    user_id: string;
    user_name: string;
    user_public_key: string;
    target_installation_id: string;
    operation: string;
    target: object;
    parameters: object;
    nonce: string;
    issued_at: number;
    expires_at: number;
};
export type SignedApproval = ApprovalRequest & {signature: string};
export const APPROVAL_IDENTITY_CHANGED = 'opensight:approval-identity-changed';
let identity: ApprovalIdentity | null = null;
let generation = 0;

const bytesToBase64 = (value: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(value)));
const base64Url = (value: string): string => value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rawKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9+/_-]{43}=$/.test(value);
const exactKeys = (value: object, keys: string[]): boolean => Object.keys(value).sort().join(',') === keys.sort().join(',');
const validIdentityDocument = (document: {version?: number; user?: ApprovalUser; private_key?: unknown}): boolean => {
    const user = document?.user;
    return !!document && exactKeys(document, ['version', 'user', 'private_key']) && document.version === 1
        && !!user && exactKeys(user, ['user_id', 'user_name', 'user_public_key'])
        && typeof user.user_id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(user.user_id)
        && typeof user.user_name === 'string' && !!user.user_name.trim() && user.user_name === user.user_name.trim() && user.user_name.length <= 128
        && rawKey(user.user_public_key) && rawKey(document.private_key);
};

export const canonicalAuthorizationJson = (value: unknown): string => {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('Authorization contains a non-finite number');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalAuthorizationJson).join(',')}]`;
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalAuthorizationJson(record[key])}`).join(',')}}`;
    }
    throw new Error('Authorization contains an unsupported value');
};

export const authorizationChallenge = (request: ApprovalRequest): ApprovalRequest => ({
    version: request.version, purpose: request.purpose, authorization_id: request.authorization_id,
    user_id: request.user_id, user_name: request.user_name, user_public_key: request.user_public_key,
    target_installation_id: request.target_installation_id, operation: request.operation,
    target: request.target, parameters: request.parameters, nonce: request.nonce,
    issued_at: request.issued_at, expires_at: request.expires_at,
});

export const currentApprovalUser = (): ApprovalUser | null => identity ? {...identity.user} : null;
export const getApprovalIdentity = (): ApprovalIdentity => {
    if (!identity) throw new Error('请先导入个人授权身份 / Import your approval identity first');
    return identity;
};

export const clearApprovalIdentity = (): void => {
    generation += 1;
    identity = null;
    window.dispatchEvent(new Event(APPROVAL_IDENTITY_CHANGED));
};

export const useAccountApprovalIdentity = (user: ApprovalUser | null): void => {
    generation += 1;
    identity = user ? Object.freeze({privateKey: null, user: Object.freeze({...user}), source: 'account'}) : null;
    window.dispatchEvent(new Event(APPROVAL_IDENTITY_CHANGED));
};

export const approvalIdentitySource = (): 'account' | 'file' | null =>
    identity ? (identity.source === 'account' ? 'account' : 'file') : null;

export const importApprovalIdentity = async (text: string): Promise<ApprovalUser> => {
    if (!globalThis.crypto?.subtle) throw new Error('请通过 HTTPS 或 localhost 打开控制台 / Open the console over HTTPS or localhost');
    const importGeneration = ++generation;
    try {
        if (text.length > 8192) throw new Error();
        const document = JSON.parse(text);
        const user = document?.user;
        if (!validIdentityDocument(document)) throw new Error();
        const privateKey = await crypto.subtle.importKey('jwk', {
            kty: 'OKP', crv: 'Ed25519', x: base64Url(user.user_public_key), d: base64Url(document.private_key),
            ext: false, key_ops: ['sign'],
        }, {name: 'Ed25519'}, false, ['sign']);
        const publicKey = await crypto.subtle.importKey('jwk', {
            kty: 'OKP', crv: 'Ed25519', x: base64Url(user.user_public_key), ext: false, key_ops: ['verify'],
        }, {name: 'Ed25519'}, false, ['verify']);
        const proof = crypto.getRandomValues(new Uint8Array(32));
        const signature = await crypto.subtle.sign('Ed25519', privateKey, proof);
        if (!await crypto.subtle.verify('Ed25519', publicKey, signature, proof) || generation !== importGeneration) throw new Error();
        identity = Object.freeze({privateKey, user: Object.freeze({...user})});
        // Remove the obsolete tab-scoped private key, without copying it forward.
        try { sessionStorage.removeItem('opensight.filesystem-identity.v1'); } catch { /* no storage dependency */ }
        window.dispatchEvent(new Event(APPROVAL_IDENTITY_CHANGED));
        return {...user};
    } catch {
        throw new Error('身份文件无效或浏览器不支持 Ed25519 / Invalid identity or Ed25519 unavailable');
    }
};

export const signAuthorization = async (request: ApprovalRequest, selected = getApprovalIdentity()): Promise<string> => {
    const now = Date.now() / 1000;
    if (request.version !== 1 || request.purpose !== 'model-work-node.user-authorization.v1'
        || request.user_id !== selected.user.user_id || request.user_name !== selected.user.user_name
        || request.user_public_key !== selected.user.user_public_key
        || !/^[0-9a-f]{64}$/.test(request.nonce)
        || ![request.issued_at, request.expires_at].every(Number.isFinite)
        || request.issued_at > now + 60 || request.expires_at <= now
        || request.expires_at <= request.issued_at
        || request.expires_at - request.issued_at > (request.operation === 'node.upgrade' ? 28800 : 300)) {
        throw new Error('授权身份或有效期不匹配 / Authorization identity or lifetime mismatch');
    }
    if (selected.source === 'account') {
        const {serverSignAuthorization} = await import('./AccountService');
        return (await serverSignAuthorization(authorizationChallenge(request))).signature;
    }
    if (!selected.privateKey) throw new Error('授权私钥不可用 / Approval key unavailable');
    return bytesToBase64(await crypto.subtle.sign('Ed25519', selected.privateKey,
        new TextEncoder().encode(canonicalAuthorizationJson(authorizationChallenge(request)))));
};

export const sensitiveRequestDigest = async (payload: object, nonce: string): Promise<string> => {
    return sha256Bytes(new TextEncoder().encode(canonicalAuthorizationJson({nonce, payload})));
};
