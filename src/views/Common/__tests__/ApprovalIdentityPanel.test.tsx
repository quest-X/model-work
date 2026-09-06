import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {generateKeyPairSync, webcrypto} from 'crypto';
import {saveAs} from 'file-saver';
import {ApprovalIdentityPanel} from '../ApprovalIdentityPanel';
import {clearApprovalIdentity, currentApprovalUser, useAccountApprovalIdentity} from '../../../services/ApprovalIdentityService';

jest.mock('file-saver', () => ({saveAs: jest.fn()}));

describe('approval identity panel', () => {
    beforeEach(() => {
        clearApprovalIdentity();
        jest.clearAllMocks();
        Object.defineProperty(crypto, 'subtle', {configurable: true, value: webcrypto.subtle});
        Object.defineProperty(crypto, 'getRandomValues', {configurable: true, value: webcrypto.getRandomValues.bind(webcrypto)});
    });

    it('stays hidden for the signed-in account identity', () => {
        useAccountApprovalIdentity({user_id: '00000000-0000-4000-8000-000000000099', user_name: 'admin', user_public_key: 'A'.repeat(43) + '='});
        expect(render(<ApprovalIdentityPanel zh={true}/>).container.firstChild).not.toBeVisible();
    });

    it('imports a real identity, exports public fields only and removes the page identity', async () => {
        const key = generateKeyPairSync('ed25519').privateKey.export({format: 'jwk'});
        const user = {user_id: '00000000-0000-4000-8000-000000000099', user_name: 'Operator', user_public_key: `${key.x}=`};
        const document = JSON.stringify({version: 1, user, private_key: `${key.d}=`});
        const file = new File([document], 'operator-private.json', {type: 'application/json'});
        Object.defineProperty(file, 'text', {value: async () => document});
        render(<ApprovalIdentityPanel zh={true}/>);
        fireEvent.change(screen.getByLabelText('导入个人授权身份'), {target: {files: [file]}});
        await waitFor(() => expect(screen.getByText('授权身份：Operator')).toBeInTheDocument());
        expect(currentApprovalUser()).toEqual(user);
        fireEvent.click(screen.getByText('导出公开登记材料'));
        const blob = (saveAs as jest.Mock).mock.calls[0][0] as Blob;
        const exported = await new Promise<string>(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsText(blob);
        });
        expect(JSON.parse(exported)).toEqual(user);
        expect(exported).not.toContain(key.d);
        expect(screen.queryByText(key.d)).toBeNull();
        fireEvent.click(screen.getByText('移除本页身份'));
        expect(currentApprovalUser()).toBeNull();
        expect(screen.getByText('授权身份：请导入')).toBeInTheDocument();
    });

    it('refuses unsupported insecure origins and oversized identity files', async () => {
        const view = render(<ApprovalIdentityPanel zh={false}/>);
        const file = new File(['x'.repeat(8193)], 'oversized.json');
        fireEvent.change(screen.getByLabelText('Import personal approval identity'), {target: {files: [file]}});
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('too large'));
        expect(currentApprovalUser()).toBeNull();
        view.unmount();
        Object.defineProperty(crypto, 'subtle', {configurable: true, value: undefined});
        render(<ApprovalIdentityPanel zh={false}/>);
        expect(screen.getByLabelText('Import personal approval identity')).toBeDisabled();
        expect(screen.getByRole('alert')).toHaveTextContent('HTTPS or localhost');
    });
});
