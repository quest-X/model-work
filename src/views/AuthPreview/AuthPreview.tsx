import React, {useEffect, useState} from 'react';
import {loginAccount, logoutAccount, refreshAccountSession} from '../../services/AccountService';
import {useAccountApprovalIdentity} from '../../services/ApprovalIdentityService';
import './AuthPreview.scss';

export const AUTH_PREVIEW_SIGN_OUT_EVENT = 'opensight:auth-preview-sign-out';

const AUTH_PREVIEW_PREFERENCES_KEY = 'opensight:auth-preview-preferences';

interface AuthPreviewPreferences {
    username: string;
    rememberPassword: boolean;
    autoLogin: boolean;
}

const savePreferences = (preferences: AuthPreviewPreferences): void => {
    try {
        if (!preferences.rememberPassword && !preferences.autoLogin) {
            window.localStorage.removeItem(AUTH_PREVIEW_PREFERENCES_KEY);
            return;
        }
        window.localStorage.setItem(AUTH_PREVIEW_PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
        // Local preferences are best-effort; login must still work when storage is unavailable.
    }
};

const loadPreferences = (): AuthPreviewPreferences => {
    try {
        const stored = window.localStorage.getItem(AUTH_PREVIEW_PREFERENCES_KEY);
        if (!stored) return {username: '', rememberPassword: false, autoLogin: false};
        const preferences = JSON.parse(stored) as Partial<AuthPreviewPreferences>;
        const autoLogin = preferences.autoLogin === true;
        const sanitized = {
            username: typeof preferences.username === 'string' ? preferences.username : '',
            rememberPassword: autoLogin || preferences.rememberPassword === true,
            autoLogin,
        };
        if ('password' in preferences) savePreferences(sanitized);
        return sanitized;
    } catch {
        return {username: '', rememberPassword: false, autoLogin: false};
    }
};

interface IProps {
    children: React.ReactNode;
}

export const AuthPreview: React.FC<IProps> = ({children}) => {
    const [initialPreferences] = useState(loadPreferences);
    const [username, setUsername] = useState(initialPreferences.rememberPassword ? initialPreferences.username : '');
    const [password, setPassword] = useState('');
    const [rememberPassword, setRememberPassword] = useState(initialPreferences.rememberPassword);
    const [autoLogin, setAutoLogin] = useState(initialPreferences.autoLogin);
    const [signedIn, setSignedIn] = useState(false);
    const [checking, setChecking] = useState(true);
    const [busy, setBusy] = useState(false);
    const [loginError, setLoginError] = useState('');

    useEffect(() => {
        let active = true;
        let restoring = true;
        refreshAccountSession().then(session => {
            if (!active || !restoring) return;
            useAccountApprovalIdentity(session?.user.approval || null);
            setSignedIn(!!session);
            setChecking(false);
        });
        const signOut = async () => {
            restoring = false;
            try { await logoutAccount(); } catch { /* local state must still sign out */ }
            if (!active) return;
            useAccountApprovalIdentity(null);
            const preferences = loadPreferences();
            savePreferences({...preferences, autoLogin: false});
            setAutoLogin(false);
            setPassword('');
            setSignedIn(false);
            setChecking(false);
        };
        window.addEventListener(AUTH_PREVIEW_SIGN_OUT_EVENT, signOut);
        return () => {
            active = false;
            window.removeEventListener(AUTH_PREVIEW_SIGN_OUT_EVENT, signOut);
        };
    }, []);

    if (checking) {
        return <main className='AuthPreview'><p className='AuthPreviewChecking'>正在验证登录…</p></main>;
    }
    if (signedIn) return <>{children}</>;

    return <main className='AuthPreview'>
        <div className='AuthPreviewGlow' aria-hidden='true'/>
        <section className='AuthPreviewCard' aria-labelledby='auth-preview-title'>
            <header className='AuthPreviewHeader'>
                <div className='AuthPreviewBrand'>
                    <span className='AuthPreviewLogo'><img src='/make-sense-ico-transparent.png' alt=''/></span>
                    <span>OpenSight</span>
                </div>
                <span className='AuthPreviewEdition'>AgentOS</span>
            </header>
            <div className='AuthPreviewIntro'>
                <div className='AuthPreviewDevice'><span aria-hidden='true'/>本地边缘计算集群后台</div>
                <h1 id='auth-preview-title'>登录到 OpenSight 16</h1>
                <p>进入设备工作台，管理视觉任务、模型与边缘节点。</p>
            </div>
            <form className='AuthPreviewForm' onSubmit={async event => {
                event.preventDefault();
                setBusy(true);
                setLoginError('');
                try {
                    const session = await loginAccount(username, password, autoLogin);
                    savePreferences({username, rememberPassword, autoLogin});
                    useAccountApprovalIdentity(session.user.approval);
                    setPassword('');
                    setSignedIn(true);
                } catch (error) {
                    setLoginError(error instanceof Error ? error.message : '登录失败');
                } finally {
                    setBusy(false);
                }
            }}>
                <label htmlFor='auth-preview-username'>账号</label>
                <input
                    id='auth-preview-username'
                    name='username'
                    type='text'
                    autoComplete='username'
                    placeholder='请输入账号'
                    value={username}
                    onChange={event => { setUsername(event.currentTarget.value); setLoginError(''); }}
                    required
                />
                <label htmlFor='auth-preview-password'>密码</label>
                <input
                    id='auth-preview-password'
                    name='password'
                    type='password'
                    autoComplete={rememberPassword ? 'current-password' : 'off'}
                    placeholder='请输入密码'
                    value={password}
                    onChange={event => { setPassword(event.currentTarget.value); setLoginError(''); }}
                    required
                />
                {loginError && <span className='AuthPreviewError' role='alert'>{loginError}</span>}
                {/* Keep both user-requested preferences when updating account authentication. */}
                <div className='AuthPreviewPreferences'>
                        <label>
                            <input
                                type='checkbox'
                                checked={rememberPassword}
                                onChange={event => {
                                    setRememberPassword(event.currentTarget.checked);
                                    if (!event.currentTarget.checked) setAutoLogin(false);
                                }}
                            />
                            记住密码
                        </label>
                        <label>
                            <input
                                type='checkbox'
                                checked={autoLogin}
                                onChange={event => {
                                    setAutoLogin(event.currentTarget.checked);
                                    if (event.currentTarget.checked) setRememberPassword(true);
                                }}
                            />
                            自动登录
                        </label>
                </div>
                <button type='submit' disabled={busy}>{busy ? '登录中…' : '登录'}</button>
            </form>
        </section>
    </main>;
};
