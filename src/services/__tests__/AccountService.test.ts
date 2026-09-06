import {currentAccountSession, loginAccount, logoutAccount, refreshAccountSession, updateAccountProfile,
    uploadAccountAvatar, changeAccountPassword, serverSignAuthorization} from '../AccountService';

const session = {user: {account_id: 'account-1', display_name: 'Admin',
    approval: {user_id: 'account-1', user_name: 'Admin', user_public_key: 'public-key'}},
csrf_token: 'csrf-1', expires_at: 2000000000};
const response = (body: unknown, status = 200) => ({ok: status < 400, status, json: async () => body});

describe('AccountService', () => {
    beforeEach(async () => {
        global.fetch = jest.fn().mockResolvedValue(response({}, 204));
        await logoutAccount();
        (fetch as jest.Mock).mockClear();
    });

    it('sends cookie credentials and the current CSRF token for mutations', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(response(session));
        await loginAccount('admin', 'password', true);
        expect(fetch).toHaveBeenLastCalledWith('/core_service/account/login', expect.objectContaining({
            credentials: 'same-origin', body: JSON.stringify({username: 'admin', password: 'password', remember: true}),
        }));
        (fetch as jest.Mock).mockResolvedValueOnce(response({user: {...session.user, display_name: 'Updated'}}));
        await updateAccountProfile('Updated');
        expect(fetch).toHaveBeenLastCalledWith('/core_service/account/profile', expect.objectContaining({
            method: 'PATCH', headers: expect.objectContaining({'X-CSRF-Token': 'csrf-1'}),
        }));
        expect(currentAccountSession()?.user.display_name).toBe('Updated');
        (fetch as jest.Mock).mockResolvedValueOnce(response({signature: 'signed'}));
        await expect(serverSignAuthorization({nonce: 'challenge'})).resolves.toEqual({signature: 'signed'});
        expect(fetch).toHaveBeenLastCalledWith('/core_service/account/authorization/sign', expect.objectContaining({
            body: JSON.stringify({request: {nonce: 'challenge'}}),
        }));
    });

    it('lets the browser set the multipart boundary for avatar uploads', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(response({user: session.user}));
        const file = new File(['image'], 'avatar.png', {type: 'image/png'});
        await uploadAccountAvatar(file);
        const options = (fetch as jest.Mock).mock.calls[0][1];
        expect(options.body.get('avatar')).toBe(file);
        expect(options.headers['Content-Type']).toBeUndefined();
    });

    it('does not restore a stale session after logout', async () => {
        let resolve!: (value: unknown) => void;
        (fetch as jest.Mock).mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const pending = refreshAccountSession();
        await logoutAccount();
        resolve(response(session));
        await pending;
        expect(currentAccountSession()).toBeNull();
    });

    it('keeps validation error payloads readable', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(response({detail: [{msg: 'Invalid input'}]}, 422));
        await expect(loginAccount('admin', 'password', false)).rejects.toThrow('HTTP 422');
    });

    it.each([
        ['profile', () => updateAccountProfile('Old account')],
        ['avatar', () => uploadAccountAvatar(new File(['image'], 'avatar.png'))],
        ['password', () => changeAccountPassword('old-password', 'new-password')],
    ])('ignores a late %s response after switching accounts', async (_name, mutate) => {
        (fetch as jest.Mock).mockResolvedValueOnce(response(session));
        await loginAccount('admin', 'password', true);
        let resolve!: (value: unknown) => void;
        (fetch as jest.Mock).mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const pending = (mutate as () => Promise<unknown>)();
        await logoutAccount();
        const next = {...session, user: {...session.user, account_id: 'account-2', password_change_required: true}};
        (fetch as jest.Mock).mockResolvedValueOnce(response(next));
        await loginAccount('other', 'password', true);
        resolve(response({user: {...session.user, display_name: 'Old account'}}));
        await pending;
        expect(currentAccountSession()).toEqual(next);
    });

    it('rejects malformed session responses without publishing a signed-in account', async () => {
        (fetch as jest.Mock).mockResolvedValue(response({status: 'ready'}));
        await expect(refreshAccountSession()).resolves.toBeNull();
        await expect(loginAccount('admin', 'password', false)).rejects.toThrow('Invalid account session');
        expect(currentAccountSession()).toBeNull();
    });
});
