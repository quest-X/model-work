import {generateKeyPairSync, verify, webcrypto} from 'crypto';
import {TextEncoder} from 'util';
import {spawnSync} from 'child_process';
import {existsSync} from 'fs';
import {resolve} from 'path';
import {
    ApprovalRequest, SignedApproval, authorizationChallenge, canonicalAuthorizationJson, clearApprovalIdentity,
    currentApprovalUser, getApprovalIdentity, importApprovalIdentity, sensitiveRequestDigest, signAuthorization,
} from '../ApprovalIdentityService';
import {ComputeClusterService, ComputeUpgradeBatch, ComputeUpgradeBatchNode, ComputeUpgradeManifest} from '../ComputeClusterService';

const nodeId = '00000000-0000-4000-8000-000000000001';
const credentials = {host: '192.168.50.12', port: 80, rtsp_port: 554, username: 'operator', password: 'do-not-log-me', scheme: 'http' as const, verify_tls: false, timeout_seconds: 8};
const person = () => {
    const {privateKey, publicKey} = generateKeyPairSync('ed25519');
    const key = privateKey.export({format: 'jwk'});
    return {
        publicKey,
        document: {version: 1, private_key: `${key.d}=`, user: {
            user_id: '00000000-0000-4000-8000-000000000099', user_name: 'Test Operator', user_public_key: `${key.x}=`,
        }},
    };
};
const challenge = async (operation = 'camera.connect', payload: Record<string, unknown> = credentials): Promise<ApprovalRequest & {state: string; error_code: null}> => ({
    version: 1, purpose: 'model-work-node.user-authorization.v1', authorization_id: '00000000-0000-4000-8000-000000000003',
    ...getApprovalIdentity().user, target_installation_id: nodeId, operation,
    target: operation === 'camera.request' ? {kind: 'camera_request', method: payload.method, path: payload.path} : {kind: operation.split('.')[0], host: payload.host},
    parameters: {request_sha256: await sensitiveRequestDigest(payload, 'a'.repeat(64))}, nonce: 'a'.repeat(64),
    issued_at: Math.floor(Date.now() / 1000), expires_at: Math.floor(Date.now() / 1000) + 120, state: 'pending', error_code: null,
});

describe('personal approvals with native WebCrypto', () => {
    beforeAll(() => {
        Object.defineProperty(globalThis.crypto, 'subtle', {configurable: true, value: webcrypto.subtle});
        Object.defineProperty(globalThis.crypto, 'getRandomValues', {configurable: true, value: webcrypto.getRandomValues.bind(webcrypto)});
        Object.defineProperty(globalThis, 'TextEncoder', {configurable: true, value: TextEncoder});
    });
    beforeEach(() => { clearApprovalIdentity(); localStorage.clear(); sessionStorage.clear(); });
    afterEach(() => jest.restoreAllMocks());

    const upgradeBatch = async (): Promise<ComputeUpgradeBatch> => {
        const manifest: ComputeUpgradeManifest = {
            version: 1, purpose: 'model-work-node.ota-release.v1', release_version: '1.0.5',
            minimum_node_version: '1.0.4', source_revision: 'a'.repeat(40), platform: 'linux',
            architecture: 'x86_64', artifact_url: 'https://release.example/v1.0.5/model-work-node-1.0.5-linux-x86_64.zip',
            sha256: 'b'.repeat(64), size_bytes: 1000, signature: `${'A'.repeat(86)}==`,
        };
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalAuthorizationJson(manifest)));
        const hash = Buffer.from(digest).toString('hex');
        const now = Math.floor(Date.now() / 1000);
        const nodes = await Promise.all([11, 22].map(async number => {
            const id = `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
            return {
                node_id: id, job_id: id, manifest: {...manifest}, authorization_id: id,
                state: 'awaiting_authorization', error_code: null, result: null,
                authorization: {
                    ...await challenge('node.upgrade'), authorization_id: id, target_installation_id: id,
                    expires_at: now + 14400, operation: 'node.upgrade', state: 'pending',
                    target: {kind: 'node_upgrade', release_version: '1.0.5', platform: 'linux', architecture: 'x86_64'},
                    parameters: {job_id: id, source_revision: manifest.source_revision, artifact_sha256: manifest.sha256,
                        artifact_size_bytes: 1000, manifest_sha256: hash, drain_timeout_seconds: 300},
                },
            } as ComputeUpgradeBatchNode;
        }));
        return {batch_id: nodeId, state: 'awaiting_authorization', release_version: '1.0.5', current_index: 0,
            created_at: now, updated_at: now, expires_at: now + 14400, ttl_seconds: 14400,
            drain_timeout_seconds: 300, error_code: null, user: getApprovalIdentity().user, nodes};
    };

    it('signs every frozen OTA target with native crypto and submits once without persisting keys', async () => {
        const {document, publicKey} = person();
        await importApprovalIdentity(JSON.stringify(document));
        const batch = await upgradeBatch();
        globalThis.fetch = jest.fn(async () => ({ok: true, json: async () => ({...batch, state: 'authorized'})} as Response));
        await ComputeClusterService.approveUpgradeBatch(batch);
        expect(fetch).toHaveBeenCalledTimes(1);
        const body = JSON.parse(String((fetch as jest.Mock).mock.calls[0][1].body));
        expect(body.approvals).toHaveLength(2);
        body.approvals.forEach((approval, index) => {
            expect(approval.job_id).toBe(batch.nodes[index].job_id);
            expect(verify(null, Buffer.from(canonicalAuthorizationJson(authorizationChallenge(batch.nodes[index].authorization))),
                publicKey, Buffer.from(approval.signature, 'base64'))).toBe(true);
        });
        expect(JSON.stringify(body)).not.toContain(document.private_key);
        expect(localStorage.length + sessionStorage.length).toBe(0);
        const camera = await challenge();
        await expect(signAuthorization({...camera, expires_at: camera.issued_at + 301})).rejects.toThrow(/lifetime/);
        await expect(signAuthorization({...batch.nodes[0].authorization,
            expires_at: batch.nodes[0].authorization.issued_at + 28801})).rejects.toThrow(/lifetime/);
    });

    it('rejects a changed later OTA target before submitting any part of the batch', async () => {
        await importApprovalIdentity(JSON.stringify(person().document));
        globalThis.fetch = jest.fn();
        const batch = await upgradeBatch();
        batch.nodes[1].manifest.artifact_url = 'https://another.example/artifact';
        await expect(ComputeClusterService.approveUpgradeBatch(batch)).rejects.toThrow(/digest mismatch/);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('imports a CLI-compatible stable identity without storing or exporting its key', async () => {
        const {document, publicKey} = person();
        await importApprovalIdentity(JSON.stringify(document));
        expect(currentApprovalUser()).toEqual(document.user);
        expect(getApprovalIdentity().privateKey.extractable).toBe(false);
        await expect(crypto.subtle.exportKey('pkcs8', getApprovalIdentity().privateKey)).rejects.toThrow();
        expect(localStorage.length).toBe(0);
        expect(sessionStorage.length).toBe(0);
        const approval = await challenge();
        const signature = await signAuthorization(approval);
        expect(verify(null, Buffer.from(canonicalAuthorizationJson(authorizationChallenge(approval))), publicKey, Buffer.from(signature, 'base64'))).toBe(true);
        clearApprovalIdentity();
        expect(() => getApprovalIdentity()).toThrow(/Import/);
        await importApprovalIdentity(JSON.stringify(document));
        expect(currentApprovalUser()).toEqual(document.user);
    });

    it('rejects mismatched keys, invalid identity files and expired or changed requests', async () => {
        const first = person(), other = person();
        await expect(importApprovalIdentity(JSON.stringify({...first.document, user: other.document.user}))).rejects.toThrow(/Invalid identity/);
        await expect(importApprovalIdentity('{"private_key":"never-echo-this"}')).rejects.not.toThrow(/never-echo-this/);
        expect(currentApprovalUser()).toBeNull();
        await importApprovalIdentity(JSON.stringify(first.document));
        const approval = await challenge();
        await expect(signAuthorization({...approval, expires_at: 1})).rejects.toThrow(/lifetime mismatch/);
        await expect(signAuthorization({...approval, user_id: nodeId})).rejects.toThrow(/identity/);
        await expect(signAuthorization({...approval, issued_at: Infinity})).rejects.toThrow(/lifetime/);
    });

    it.each(['connect', 'snapshot', 'resources'])('requires a checked one-use approval for camera %s', async kind => {
        const {document, publicKey} = person();
        await importApprovalIdentity(JSON.stringify(document));
        const body = kind === 'connect' ? credentials : {...credentials, channel_id: '101', ...(kind === 'resources' ? {name: 'Line'} : {})};
        const payload = kind === 'connect' ? body : {method: 'POST', path: `/extension_service/extensions/camera-connect/${kind}`, payload: body};
        const approval = await challenge(kind === 'connect' ? 'camera.connect' : 'camera.request', payload);
        const requests: {path: string; body: Record<string, unknown> & {authorization?: SignedApproval}}[] = [];
        globalThis.fetch = jest.fn(async (url, options) => {
            requests.push({path: String(url), body: JSON.parse(String(options?.body))});
            return {ok: true, json: async () => requests.length === 1 ? approval : {status: 'success'}, blob: async () => new Blob(['jpeg'])} as Response;
        });
        const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
        if (kind === 'connect') await ComputeClusterService.connectCamera(nodeId, credentials);
        else if (kind === 'snapshot') await ComputeClusterService.snapshotCamera(nodeId, {...credentials, channel_id: '101'});
        else await ComputeClusterService.createCameraResource(nodeId, {...credentials, channel_id: '101', name: 'Line'});
        expect(requests).toHaveLength(2);
        expect(requests[0].body.credentials).toEqual(payload);
        const {authorization, ...sent} = requests[1].body;
        expect(sent).toEqual(body);
        expect(verify(null, Buffer.from(canonicalAuthorizationJson(authorizationChallenge(authorization))), publicKey, Buffer.from(authorization.signature, 'base64'))).toBe(true);
        expect(JSON.stringify(requests)).not.toContain(document.private_key);
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(confirm.mock.calls[0][0]).not.toContain(credentials.password);
    });

    it.each(['connect', 'snapshot', 'resources'])('canonicalizes IPv6 before approving camera %s', async kind => {
        await importApprovalIdentity(JSON.stringify(person().document));
        const normalized = {...credentials, host: 'fd00::12'};
        const input = {...normalized, host: ' [fd00:0:0:0:0:0:0:12] '};
        const body = kind === 'connect' ? normalized : {...normalized, channel_id: '101', ...(kind === 'resources' ? {name: 'Line'} : {})};
        const payload = kind === 'connect' ? body : {method: 'POST', path: `/extension_service/extensions/camera-connect/${kind}`, payload: body};
        const approval = await challenge(kind === 'connect' ? 'camera.connect' : 'camera.request', payload);
        globalThis.fetch = jest.fn()
            .mockResolvedValueOnce({ok: true, json: async () => approval})
            .mockResolvedValueOnce({ok: true, json: async () => ({status: 'success'}), blob: async () => new Blob(['jpeg'])});
        jest.spyOn(window, 'confirm').mockReturnValue(true);
        if (kind === 'connect') await ComputeClusterService.connectCamera(nodeId, input);
        else if (kind === 'snapshot') await ComputeClusterService.snapshotCamera(nodeId, {...input, channel_id: '101'});
        else await ComputeClusterService.createCameraResource(nodeId, {...input, channel_id: '101', name: 'Line'});
        const requests = (fetch as jest.Mock).mock.calls;
        expect(JSON.parse(requests[0][1].body).credentials).toEqual(payload);
        expect(JSON.parse(requests[1][1].body).host).toBe('fd00::12');
    });

    it.each(['reject', 'digest', 'machine', 'identity'])('does not send the operation after %s', async mode => {
        await importApprovalIdentity(JSON.stringify(person().document));
        const approval = await challenge();
        if (mode === 'digest') approval.parameters = {request_sha256: 'b'.repeat(64)};
        if (mode === 'machine') approval.target_installation_id = 'another-node';
        globalThis.fetch = jest.fn().mockResolvedValue({ok: true, json: async () => approval});
        jest.spyOn(window, 'confirm').mockImplementation(() => {
            if (mode === 'identity') clearApprovalIdentity();
            return mode !== 'reject';
        });
        await expect(ComputeClusterService.connectCamera(nodeId, credentials)).rejects.toThrow();
        expect(fetch).toHaveBeenCalledTimes(mode === 'reject' ? 2 : 1);
        if (mode === 'reject') expect(String((fetch as jest.Mock).mock.calls[1][0])).toMatch(/\/authorizations\/.*\/reject$/);
    });

    it.each([undefined, 'SHA256:verified-device-key'])('binds Jetson approval to the discovered machine and fingerprint %s', async fingerprint => {
        const {document, publicKey} = person();
        await importApprovalIdentity(JSON.stringify(document));
        const payload = {host: '192.168.50.21', port: 22, username: 'operator', password: credentials.password, expected_fingerprint: fingerprint ?? null};
        const approval = await challenge('jetson.connect', payload);
        globalThis.fetch = jest.fn()
            .mockResolvedValueOnce({ok: true, json: async () => ({assets: [{asset_id: 'jetson-1', node_id: nodeId, address: payload.host}]})})
            .mockResolvedValueOnce({ok: true, json: async () => approval})
            .mockResolvedValueOnce({ok: true, json: async () => ({status: 'success'})});
        const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
        await ComputeClusterService.connectJetson('jetson-1', {username: ' operator ', password: payload.password, expected_fingerprint: fingerprint});
        const calls = (fetch as jest.Mock).mock.calls;
        expect(JSON.parse(calls[1][1].body).credentials).toEqual(payload);
        const sent = JSON.parse(calls[2][1].body);
        expect(sent.expected_fingerprint).toBe(fingerprint ?? null);
        expect(sent.authorization.target_installation_id).toBe(nodeId);
        expect(verify(null, Buffer.from(canonicalAuthorizationJson(authorizationChallenge(sent.authorization))), publicKey, Buffer.from(sent.authorization.signature, 'base64'))).toBe(true);
        expect(confirm.mock.calls[0][0]).toContain(payload.host);
        expect(confirm.mock.calls[0][0]).not.toContain(payload.password);
        expect(JSON.stringify(calls)).not.toContain(document.private_key);
    });

    const nodeSource = resolve(process.cwd(), '../model-work-node');
    const nodePython = process.env.MODEL_WORK_NODE_PYTHON || (
        process.platform === 'win32' && existsSync(resolve(nodeSource, '.venv/Scripts/python.exe'))
            ? resolve(nodeSource, '.venv/Scripts/python.exe')
            : process.platform === 'win32' ? 'python' : 'python3'
    );
    (existsSync(resolve(nodeSource, 'model_work_node/authorization.py')) ? it : it.skip)('verifies native browser signatures and parameter digests with the actual Python Node', async () => {
        const {document} = person();
        await importApprovalIdentity(JSON.stringify(document));
        const created = spawnSync(nodePython, ['-c', `
import json,sys,time
from model_work_node.authorization import sensitive_request
data=json.load(sys.stdin)
data['payload']['timeout_seconds']=float(data['payload']['timeout_seconds'])
request=sensitive_request(operation='camera.connect',payload=data['payload'],target_installation_id=data['node_id'],now=int(time.time()),**data['user'])
print(json.dumps(request.as_dict()))
`], {cwd: nodeSource, input: JSON.stringify({user: document.user, payload: credentials, node_id: nodeId}), encoding: 'utf8'});
        expect(created.status).toBe(0);
        const approval = JSON.parse(created.stdout);
        expect(approval.parameters).toEqual({request_sha256: await sensitiveRequestDigest(credentials, approval.nonce)});
        const signed = {...approval, signature: await signAuthorization(approval)};
        const checked = spawnSync(nodePython, ['-c', `
import json,sys
from model_work_node.authorization import UserAuthorization,sensitive_parameters,AuthorizationError
data=json.load(sys.stdin); auth=UserAuthorization.from_mapping(data['authorization'])
auth.verify(target_installation_id=data['node_id'],operation='camera.connect',target={'kind':'camera','host':data['payload']['host']},parameters=sensitive_parameters(data['payload'],auth.nonce))
data['payload']['port']=81
try:
 auth.verify(target_installation_id=data['node_id'],operation='camera.connect',target={'kind':'camera','host':data['payload']['host']},parameters=sensitive_parameters(data['payload'],auth.nonce))
except AuthorizationError:
 print('verified and tampering rejected')
else:
 raise RuntimeError('tampering was accepted')
`], {cwd: nodeSource, input: JSON.stringify({authorization: signed, payload: credentials, node_id: nodeId}), encoding: 'utf8'});
        expect(checked.status).toBe(0);
        expect(checked.stdout.trim()).toBe('verified and tampering rejected');
    });
});
