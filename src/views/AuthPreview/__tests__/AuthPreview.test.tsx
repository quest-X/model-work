import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {
    AccountSession, loginAccount, logoutAccount, refreshAccountSession,
} from '../../../services/AccountService';
import {AUTH_PREVIEW_SIGN_OUT_EVENT, AuthPreview} from '../AuthPreview';

jest.mock('../../../services/AccountService', () => ({
    loginAccount: jest.fn(),
    logoutAccount: jest.fn(),
    refreshAccountSession: jest.fn(),
}));

const session: AccountSession = {
    user: {
        account_id: '11111111-1111-4111-8111-111111111111',
        username: 'admin',
        display_name: '本地管理员',
        role: 'admin',
        password_change_required: false,
        avatar_url: null,
        approval: {
            user_id: '11111111-1111-4111-8111-111111111111',
            user_name: 'admin',
            user_public_key: `${'A'.repeat(43)}=`,
        },
        permissions: ['node.upgrade'],
    },
    csrf_token: 'csrf-token',
    expires_at: 2_000_000_000,
};

describe('AuthPreview', () => {
    it('does not re-enter the workspace when session restoration finishes after sign-out', async () => {
        let resolve!: (value: AccountSession) => void;
        (refreshAccountSession as jest.Mock).mockReturnValueOnce(new Promise(done => { resolve = done; }));
        render(<AuthPreview><div>workspace preview</div></AuthPreview>);
        act(() => { window.dispatchEvent(new Event(AUTH_PREVIEW_SIGN_OUT_EVENT)); });
        await screen.findByLabelText('账号');
        await act(async () => { resolve(session); });
        expect(screen.queryByText('workspace preview')).not.toBeInTheDocument();
        expect(await screen.findByLabelText('账号')).toBeInTheDocument();
    });
    beforeEach(() => {
        window.localStorage.clear();
        jest.resetAllMocks();
        (refreshAccountSession as jest.Mock).mockResolvedValue(null);
        (logoutAccount as jest.Mock).mockResolvedValue(undefined);
    });

    it('uses backend login without persisting the password', async () => {
        render(<AuthPreview><div>workspace preview</div></AuthPreview>);
        await screen.findByRole('heading', {name: '登录到 OpenSight 16'});
        fireEvent.change(screen.getByLabelText('账号'), {target: {value: 'admin'}});
        fireEvent.change(screen.getByLabelText('密码'), {target: {value: 'wrong'}});
        (loginAccount as jest.Mock).mockRejectedValueOnce(new Error('账号或密码错误'));
        fireEvent.click(screen.getByRole('button', {name: '登录'}));
        expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码错误');

        fireEvent.change(screen.getByLabelText('密码'), {target: {value: 'correct-password'}});
        (loginAccount as jest.Mock).mockResolvedValueOnce(session);
        fireEvent.click(screen.getByRole('button', {name: '登录'}));
        expect(await screen.findByText('workspace preview')).toBeInTheDocument();
        expect(window.localStorage.length).toBe(0);

        act(() => { window.dispatchEvent(new Event(AUTH_PREVIEW_SIGN_OUT_EVENT)); });
        await waitFor(() => expect(logoutAccount).toHaveBeenCalledTimes(1));
        expect(await screen.findByRole('heading', {name: '登录到 OpenSight 16'})).toBeInTheDocument();
        expect(screen.getByLabelText('密码')).toHaveValue('');
    });

    it('restores a valid HttpOnly-cookie session on reload', async () => {
        (refreshAccountSession as jest.Mock).mockResolvedValueOnce(session);
        render(<AuthPreview><div>workspace preview</div></AuthPreview>);
        expect(await screen.findByText('workspace preview')).toBeInTheDocument();
        expect(loginAccount).not.toHaveBeenCalled();
    });
    it('keeps both login options using browser passwords and persistent sessions', async () => {
        const view = render(<AuthPreview><div>workspace preview</div></AuthPreview>);
        await screen.findByLabelText('记住密码');
        expect(screen.getAllByRole('checkbox')).toHaveLength(2);
        fireEvent.click(screen.getByLabelText('自动登录'));
        expect(screen.getByLabelText('记住密码')).toBeChecked();
        fireEvent.click(screen.getByLabelText('记住密码'));
        expect(screen.getByLabelText('自动登录')).not.toBeChecked();
        fireEvent.click(screen.getByLabelText('自动登录'));
        fireEvent.change(screen.getByLabelText('账号'), {target: {value: 'admin'}});
        fireEvent.change(screen.getByLabelText('密码'), {target: {value: 'correct-password'}});
        (loginAccount as jest.Mock).mockResolvedValue(session);
        fireEvent.click(screen.getByRole('button', {name: '登录'}));
        await screen.findByText('workspace preview');
        expect(loginAccount).toHaveBeenCalledWith('admin', 'correct-password', true);
        expect(JSON.parse(localStorage.getItem('opensight:auth-preview-preferences')!))
            .toEqual({username: 'admin', rememberPassword: true, autoLogin: true});
        view.unmount();
        (refreshAccountSession as jest.Mock).mockResolvedValueOnce(session);
        render(<AuthPreview><div>workspace preview</div></AuthPreview>);
        await screen.findByText('workspace preview');
        expect(loginAccount).toHaveBeenCalledTimes(1);
        act(() => { window.dispatchEvent(new Event(AUTH_PREVIEW_SIGN_OUT_EVENT)); });
        expect(await screen.findByLabelText('自动登录')).not.toBeChecked();
        expect(screen.getByLabelText('密码')).toHaveValue('');
        expect(screen.getByLabelText('密码')).toHaveAttribute('autocomplete', 'current-password');
    });

    it('removes legacy saved passwords without replaying them', async () => {
        localStorage.setItem('opensight:auth-preview-preferences', JSON.stringify({
            username: 'admin', password: 'legacy-secret', rememberPassword: true, autoLogin: true,
        }));
        render(<AuthPreview><div>workspace preview</div></AuthPreview>);
        expect(await screen.findByLabelText('账号')).toHaveValue('admin');
        expect(screen.getByLabelText('密码')).toHaveValue('');
        expect(localStorage.getItem('opensight:auth-preview-preferences')).not.toContain('legacy-secret');
        expect(JSON.parse(localStorage.getItem('opensight:auth-preview-preferences')!)).not.toHaveProperty('password');
        expect(loginAccount).not.toHaveBeenCalled();
    });
});
