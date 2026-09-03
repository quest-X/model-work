import React, {useEffect, useState} from 'react';
import {Settings} from '../../settings/Settings';
import './AuthPreview.scss';

export const AUTH_PREVIEW_SIGN_OUT_EVENT = 'opensight:auth-preview-sign-out';
const AUTH_PREVIEW_PREFERENCES_KEY = 'opensight:auth-preview-preferences';

interface AuthPreviewPreferences {
    username: string;
    password: string;
    rememberPassword: boolean;
    autoLogin: boolean;
}

const loadPreferences = (): AuthPreviewPreferences => {
    try {
        const stored = window.localStorage.getItem(AUTH_PREVIEW_PREFERENCES_KEY);
        if (!stored) return {username: '', password: '', rememberPassword: false, autoLogin: false};
        const preferences = JSON.parse(stored) as Partial<AuthPreviewPreferences>;
        const autoLogin = preferences.autoLogin === true;
        return {
            username: typeof preferences.username === 'string' ? preferences.username : '',
            password: typeof preferences.password === 'string' ? preferences.password : '',
            rememberPassword: autoLogin || preferences.rememberPassword === true,
            autoLogin,
        };
    } catch {
        return {username: '', password: '', rememberPassword: false, autoLogin: false};
    }
};

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

interface IProps {
    children: React.ReactNode;
}

export const AuthPreview: React.FC<IProps> = ({children}) => {
    // ponytail: one configured local account; replace this client gate with server-issued sessions when backend auth exists.
    const [initialPreferences] = useState(loadPreferences);
    const initialAutoLogin = initialPreferences.autoLogin
        && initialPreferences.username === Settings.AUTH_PREVIEW_USERNAME
        && initialPreferences.password === Settings.AUTH_PREVIEW_PASSWORD;
    const [username, setUsername] = useState(initialPreferences.rememberPassword ? initialPreferences.username : '');
    const [password, setPassword] = useState(initialPreferences.rememberPassword ? initialPreferences.password : '');
    const [rememberPassword, setRememberPassword] = useState(initialPreferences.rememberPassword);
    const [autoLogin, setAutoLogin] = useState(initialAutoLogin);
    const [signedIn, setSignedIn] = useState(initialAutoLogin);
    const [loginError, setLoginError] = useState('');

    useEffect(() => {
        const signOut = () => {
            setSignedIn(false);
            setAutoLogin(false);
            savePreferences({username, password, rememberPassword, autoLogin: false});
        };
        window.addEventListener(AUTH_PREVIEW_SIGN_OUT_EVENT, signOut);
        return () => window.removeEventListener(AUTH_PREVIEW_SIGN_OUT_EVENT, signOut);
    }, [password, rememberPassword, username]);

    if (signedIn) return <>{children}</>;

    return (
        <main className='AuthPreview'>
            <div className='AuthPreviewGlow' aria-hidden='true'/>
            <section className='AuthPreviewCard' aria-labelledby='auth-preview-title'>
                <header className='AuthPreviewHeader'>
                    <div className='AuthPreviewBrand'>
                        <span className='AuthPreviewLogo'>
                            <img src='/make-sense-ico-transparent.png' alt=''/>
                        </span>
                        <span>OpenSight</span>
                    </div>
                    <span className='AuthPreviewEdition'>AgentOS</span>
                </header>

                <div className='AuthPreviewIntro'>
                    <div className='AuthPreviewDevice'>
                        <span aria-hidden='true'/>
                        本地边缘计算集群后台
                    </div>
                    <h1 id='auth-preview-title'>登录到 山东钢铁</h1>
                    <p>进入设备工作台，管理视觉任务、模型与边缘节点。</p>
                </div>

                <form
                    className='AuthPreviewForm'
                    onSubmit={event => {
                        event.preventDefault();
                        if (username !== Settings.AUTH_PREVIEW_USERNAME || password !== Settings.AUTH_PREVIEW_PASSWORD) {
                            setLoginError('账号或密码错误');
                            return;
                        }
                        setLoginError('');
                        savePreferences({username, password, rememberPassword, autoLogin});
                        setSignedIn(true);
                    }}
                >
                    <label htmlFor='auth-preview-username'>账号</label>
                    <input
                        id='auth-preview-username'
                        name='username'
                        type='text'
                        autoComplete='username'
                        placeholder='请输入账号'
                        value={username}
                        onChange={event => {
                            setUsername(event.currentTarget.value);
                            setLoginError('');
                        }}
                        required
                    />

                    <label htmlFor='auth-preview-password'>密码</label>
                    <input
                        id='auth-preview-password'
                        name='password'
                        type='password'
                        autoComplete='current-password'
                        placeholder='请输入密码'
                        value={password}
                        onChange={event => {
                            setPassword(event.currentTarget.value);
                            setLoginError('');
                        }}
                        required
                    />

                    {loginError && <span className='AuthPreviewError' role='alert'>{loginError}</span>}
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
                    <button type='submit'>登录</button>
                </form>
            </section>
        </main>
    );
};
