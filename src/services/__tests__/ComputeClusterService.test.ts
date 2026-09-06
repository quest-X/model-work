import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeTask,
    computeSshAvailability,
    computeNodeState,
    computeLinkStates,
    aggregateCommunicationStates,
    communicationStateLabel,
    computeNodeLabel,
} from '../ComputeClusterService';

const task = {
    task_id: 'task-1',
    node_id: 'node-1',
    node_name: 'local-node',
    task_type: 'network.lan_discovery',
    mode: 'background',
    state: 'running',
    created_at: 1,
    updated_at: 1,
    lease_seconds: 60,
    attempt: 1,
    parameters: {cidr: '192.168.1.0/24'},
} as ComputeTask;

const scanTargets = {
    version: 1 as const,
    group_id: 'group-1',
    nodes: [{
        node_id: 'node-1',
        node_name: 'local-node',
        targets: [{
            interface: 'eth0',
            address: '192.168.1.2',
            cidr: '192.168.1.0/24',
            prefix_length: 24,
            interface_cidr: '192.168.1.0/24',
            narrowed: false,
            address_count: 254,
        }],
    }],
};

describe('ComputeClusterService LAN scan', () => {
    afterEach(() => jest.restoreAllMocks());

    it('cancels the submitted task when the caller aborts', async () => {
        const controller = new AbortController();
        jest.spyOn(ComputeClusterService, 'lanScanTargets').mockResolvedValue(scanTargets);
        jest.spyOn(ComputeClusterService, 'submitTask').mockResolvedValue(task);
        jest.spyOn(ComputeClusterService, 'taskStatus').mockImplementation((_task, signal) => {
            expect(ComputeClusterService.activeLanScan('node-1')).toEqual(task);
            if (signal?.aborted) return Promise.reject(signal.reason);
            return new Promise((_resolve, reject) => {
                signal?.addEventListener('abort', () => reject(signal.reason));
            });
        });
        const cancel = jest.spyOn(ComputeClusterService, 'controlTask').mockResolvedValue(task);

        const scan = ComputeClusterService.scanLan('node-1', controller.signal);
        await Promise.resolve();
        await Promise.resolve();
        controller.abort();

        await expect(scan).rejects.toMatchObject({name: 'AbortError'});
        expect(cancel).toHaveBeenCalledWith(task, 'cancel');
        expect(ComputeClusterService.activeLanScan('node-1')).toBeNull();
    });

    it('does not cancel the task when a watcher detaches', async () => {
        const controller = new AbortController();
        jest.spyOn(ComputeClusterService, 'taskStatus').mockImplementation((_task, signal) => {
            if (signal?.aborted) return Promise.reject(signal.reason);
            return new Promise((_resolve, reject) => {
                signal?.addEventListener('abort', () => reject(signal.reason));
            });
        });
        const cancel = jest.spyOn(ComputeClusterService, 'controlTask').mockResolvedValue(task);

        const scan = ComputeClusterService.watchLanScan(task, controller.signal);
        controller.abort();

        await expect(scan).rejects.toMatchObject({name: 'AbortError'});
        expect(cancel).not.toHaveBeenCalled();
    });

    it('reports the real task progress', async () => {
        const result = {
            schema_version: 'lan-discovery.console-result.v1' as const,
            scan_id: 'scan-1', cidr: '192.168.1.0/24', interface: 'eth0',
            started_at: 1, finished_at: 2, addresses_scanned: 254, host_count: 0,
            ports_scanned: [22], hosts: [], truncated: false,
        };
        jest.spyOn(ComputeClusterService, 'lanScanTargets').mockResolvedValue(scanTargets);
        jest.spyOn(ComputeClusterService, 'submitTask').mockResolvedValue(task);
        jest.spyOn(ComputeClusterService, 'taskStatus').mockResolvedValue({
            ...task, state: 'succeeded', progress: {percent: 42, completed: 106, total: 253}, result,
        });
        const onProgress = jest.fn();

        await expect(ComputeClusterService.scanLan('node-1', undefined, onProgress)).resolves.toEqual(result);
        expect(onProgress).toHaveBeenCalledWith(42, 106, 253);
    });

    it('retries a transient task status failure', async () => {
        const result = {
            schema_version: 'lan-discovery.console-result.v1' as const,
            scan_id: 'scan-1', cidr: '192.168.1.0/24', interface: 'eth0',
            started_at: 1, finished_at: 2, addresses_scanned: 254, host_count: 0,
            ports_scanned: [22], hosts: [], truncated: false,
        };
        jest.spyOn(ComputeClusterService, 'lanScanTargets').mockResolvedValue(scanTargets);
        jest.spyOn(ComputeClusterService, 'submitTask').mockResolvedValue(task);
        const status = jest.spyOn(ComputeClusterService, 'taskStatus')
            .mockRejectedValueOnce(new Error('node task control is unavailable'))
            .mockResolvedValue({...task, state: 'succeeded', result});

        await expect(ComputeClusterService.scanLan('node-1')).resolves.toEqual(result);
        expect(status).toHaveBeenCalledTimes(2);
    });
});

describe('ComputeClusterService filesystem authorization', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it('uses only the dedicated create, approve, and reject routes', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({}),
        } as Response);
        const request = {
            operation: 'filesystem.list' as const,
            target: {kind: 'known_folder' as const, id: 'public_desktop' as const},
            parameters: {limit: 200},
            user: {
                user_id: '00000000-0000-4000-8000-000000000099',
                user_name: 'OpenSight Console User',
                user_public_key: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
            },
            ttl_seconds: 120,
        };

        await ComputeClusterService.createFilesystemAuthorization('node/1', request);
        await ComputeClusterService.approveFilesystemAuthorization('authorization/1', 'signature');
        await ComputeClusterService.rejectFilesystemAuthorization('authorization/1');

        expect(global.fetch).toHaveBeenNthCalledWith(
            1,
            expect.stringMatching(/\/nodes\/node%2F1\/filesystem\/authorizations$/),
            expect.objectContaining({method: 'POST', body: JSON.stringify(request)}),
        );
        expect(global.fetch).toHaveBeenNthCalledWith(
            2,
            expect.stringMatching(/\/filesystem\/authorizations\/authorization%2F1\/approve$/),
            expect.objectContaining({method: 'POST', body: JSON.stringify({signature: 'signature'})}),
        );
        expect(global.fetch).toHaveBeenNthCalledWith(
            3,
            expect.stringMatching(/\/filesystem\/authorizations\/authorization%2F1\/reject$/),
            expect.objectContaining({method: 'POST', body: '{}'}),
        );
    });
});

describe('ComputeClusterService remote camera management', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it('routes rename and delete through the owning node', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({}),
        } as Response);

        await ComputeClusterService.updateCameraResource('node/1', 'camera/1', '新名称');
        await ComputeClusterService.deleteCameraResource('node/1', 'camera/1');

        const path = /\/nodes\/node%2F1\/cameras\/resources\/camera%2F1$/;
        expect(global.fetch).toHaveBeenNthCalledWith(
            1,
            expect.stringMatching(path),
            expect.objectContaining({method: 'PUT', body: JSON.stringify({name: '新名称'})}),
        );
        expect(global.fetch).toHaveBeenNthCalledWith(
            2,
            expect.stringMatching(path),
            expect.objectContaining({method: 'DELETE'}),
        );
    });
});

describe('computeSshAvailability', () => {
    const node = (transport: 'lan' | 'tailscale'): ComputeClusterNode => ({
        control_transport: transport,
        network: {
            provider: 'tailscale', installed: true, online: true, ssh_available: true,
            lan_ssh_available: null, tailscale_ssh_available: null, addresses: [],
        },
        network_dependencies: [
            {dependency_id: 'control_ssh', kind: 'control_transport', state: 'healthy', checked_at: 1, required_for: []},
            {dependency_id: 'tailscale', kind: 'overlay_network', state: 'healthy', checked_at: 1, required_for: []},
        ],
    } as ComputeClusterNode);

    it('falls back to the v0.9.1 control route when split SSH fields are absent', () => {
        expect(computeSshAvailability(node('lan'))).toEqual({lan: true, tailscale: true});
        expect(computeSshAvailability(node('tailscale'))).toEqual({lan: false, tailscale: true});
    });
});

describe('node communication state', () => {
    const node = (online = true): ComputeClusterNode => ({
        online,
        network: {online: false, lan_ssh_available: true, tailscale_ssh_available: false},
        network_dependencies: [{dependency_id: 'control_ssh', state: 'healthy'}],
        device_inventory: {state: 'unavailable', devices: [{status: 'offline'}]},
    } as ComputeClusterNode);
    it.each([
        [true, false, 'normal', 'fault', 'fault'],
        [false, true, 'fault', 'normal', 'fault'],
        [false, false, 'fault', 'fault', 'fault'],
        [true, true, 'normal', 'normal', 'normal'],
    ] as const)('maps LAN %s and Tailscale %s to binary health', (lan, tailscale, lanState, tailscaleState, state) => {
        const current = {...node(), network: {...node().network, lan_ssh_available: lan, tailscale_ssh_available: tailscale}};
        expect(computeNodeState(current)).toBe(state);
        expect(computeLinkStates(current)).toEqual({lan: lanState, tailscale: tailscaleState});
    });
    it('treats missing or legacy offline evidence as faulty', () => {
        expect(computeNodeState()).toBe('fault');
        expect(computeNodeState(node(false))).toBe('fault');
        expect(computeNodeState({...node(), network: {...node().network, error: 'refresh failed'}})).toBe('fault');
    });
    it.each([['normal', '正常'], ['fault', '故障'], ['abnormal', '故障']] as const)(
        'uses authoritative %s state even with cached online flags', (state, label) => {
            const current = {...node(), network: {...node().network, tailscale_ssh_available: true}, communication_state: state};
            expect(computeNodeLabel(current, true)).toBe(label);
            expect(communicationStateLabel(state, false)).toBe(state === 'normal' ? 'Normal' : 'Fault');
            expect(current.communication_state).toBe(state);
        },
    );
});

describe('communication aggregation', () => {
    it.each([
        [['normal', 'normal'], 'normal'],
        [['abnormal', 'abnormal'], 'fault'],
        [['normal', 'abnormal'], 'fault'],
        [['normal', 'normal', 'abnormal'], 'fault'],
        [['normal', 'fault'], 'fault'],
        [['abnormal', 'fault'], 'fault'],
        [[], 'fault'],
    ])('aggregates %j as %s without majority voting', (states, expected) => {
        expect(aggregateCommunicationStates(states as ('normal' | 'fault' | 'abnormal')[])).toBe(expected);
    });
});
