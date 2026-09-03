import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {AUTH_PREVIEW_SIGN_OUT_EVENT, AuthPreview} from '../AuthPreview';

describe('AuthPreview', () => {
    beforeEach(() => window.localStorage.clear());

    it('previews the login-to-workspace flow without persisting credentials', () => {
        render(<AuthPreview><div>workspace preview</div></AuthPreview>);

        fireEvent.change(screen.getByLabelText('账号'), {target: {value: 'admin'}});
        fireEvent.change(screen.getByLabelText('密码'), {target: {value: 'preview'}});
        fireEvent.click(screen.getByRole('button', {name: '登录'}));
        expect(screen.getByRole('alert')).toHaveTextContent('账号或密码错误');
        expect(screen.queryByText('workspace preview')).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('密码'), {target: {value: 'admin'}});
        fireEvent.click(screen.getByRole('button', {name: '登录'}));
        expect(screen.getByText('workspace preview')).toBeInTheDocument();

        act(() => {
            window.dispatchEvent(new Event(AUTH_PREVIEW_SIGN_OUT_EVENT));
        });
        expect(screen.getByRole('heading', {name: '登录到 山东钢铁'})).toBeInTheDocument();
    });

    it('remembers the configured account and auto logs in until manual sign-out', () => {
        const firstView = render(<AuthPreview><div>workspace preview</div></AuthPreview>);

        fireEvent.change(screen.getByLabelText('账号'), {target: {value: 'admin'}});
        fireEvent.change(screen.getByLabelText('密码'), {target: {value: 'admin'}});
        fireEvent.click(screen.getByRole('checkbox', {name: '自动登录'}));
        expect(screen.getByRole('checkbox', {name: '记住密码'})).toBeChecked();
        fireEvent.click(screen.getByRole('button', {name: '登录'}));
        expect(screen.getByText('workspace preview')).toBeInTheDocument();

        firstView.unmount();
        const secondView = render(<AuthPreview><div>workspace preview</div></AuthPreview>);
        expect(screen.getByText('workspace preview')).toBeInTheDocument();

        act(() => {
            window.dispatchEvent(new Event(AUTH_PREVIEW_SIGN_OUT_EVENT));
        });
        expect(screen.getByRole('heading', {name: '登录到 山东钢铁'})).toBeInTheDocument();
        expect(screen.getByLabelText('账号')).toHaveValue('admin');
        expect(screen.getByLabelText('密码')).toHaveValue('admin');

        secondView.unmount();
        render(<AuthPreview><div>workspace preview</div></AuthPreview>);
        expect(screen.getByRole('heading', {name: '登录到 山东钢铁'})).toBeInTheDocument();
    });
});
