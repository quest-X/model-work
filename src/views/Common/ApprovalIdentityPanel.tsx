import React, {useEffect, useState} from 'react';
import {saveAs} from 'file-saver';
import {
    APPROVAL_IDENTITY_CHANGED, clearApprovalIdentity, currentApprovalUser, importApprovalIdentity,
} from '../../services/ApprovalIdentityService';

export const ApprovalIdentityPanel: React.FC<{zh: boolean}> = ({zh}) => {
    const [user, setUser] = useState(currentApprovalUser);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const update = () => setUser(currentApprovalUser());
        window.addEventListener(APPROVAL_IDENTITY_CHANGED, update);
        return () => window.removeEventListener(APPROVAL_IDENTITY_CHANGED, update);
    }, []);
    const supported = !!globalThis.crypto?.subtle;
    return <details style={{padding: '8px 12px', gridColumn: '1 / -1'}}>
        <summary>{zh ? '授权身份' : 'Approval identity'}：{user?.user_name || (zh ? '请导入' : 'Import required')}</summary>
        <p>{zh ? '导入 CLI 生成的个人身份文件；私钥仅留在当前页面内存，刷新后需重新导入。公开材料须由管理员登记到 Main 和 Node。'
            : 'Import a CLI-generated personal identity. Its private key stays in page memory; re-import after refresh. An administrator must register the public identity on Main and Node.'}</p>
        <label>{zh ? '导入个人授权身份' : 'Import personal approval identity'}
            <input type='file' accept='.json,application/json' disabled={busy || !supported} onChange={async event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                setBusy(true);
                setError('');
                try {
                    if (file.size > 8192) throw new Error(zh ? '身份文件过大' : 'Identity file is too large');
                    await importApprovalIdentity(await file.text());
                } catch (reason) {
                    setError(reason instanceof Error ? reason.message : 'Identity import failed');
                } finally { setBusy(false); }
            }}/>
        </label>
        {!supported && <p role='alert'>{zh ? '当前地址不能安全签名，请使用 HTTPS 或 localhost。' : 'Signing is unavailable at this address. Use HTTPS or localhost.'}</p>}
        {user && <div>
            <p>{user.user_id}</p>
            <button type='button' onClick={() => saveAs(new Blob([JSON.stringify(user, null, 2)], {type: 'application/json'}), 'model-work-node-authorizer.public.json')}>
                {zh ? '导出公开登记材料' : 'Export public registration'}
            </button>
            <button type='button' onClick={clearApprovalIdentity}>{zh ? '移除本页身份' : 'Remove page identity'}</button>
        </div>}
        {error && <p role='alert'>{error}</p>}
    </details>;
};
