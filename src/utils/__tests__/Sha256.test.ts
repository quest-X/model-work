import {createHash} from 'crypto';
import {sha256File, sha256HexFallback} from '../Sha256';

const bytes = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'utf8'));

describe('SHA-256 fallback', () => {
    it.each([
        ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
        ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
        [
            'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
            '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
        ],
    ])('matches the published vector %#', (input, expected) => {
        expect(sha256HexFallback(bytes(input))).toBe(expected);
    });

    it('handles a one-million-byte multi-block published vector', () => {
        expect(sha256HexFallback(new Uint8Array(1_000_000).fill(0x61))).toBe(
            'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
        );
    });

    it('hashes a 2MB+ File through the no-WebCrypto path without upload', async () => {
        const payload = new Uint8Array(2 * 1024 * 1024 + 137);
        payload.forEach((_value, index) => {
            payload[index] = (index * 31 + 17) & 0xff;
        });
        const expected = createHash('sha256').update(payload).digest('hex');
        const file = {
            arrayBuffer: jest.fn().mockResolvedValue(payload.buffer),
        } as unknown as File;
        await expect(sha256File(file, null)).resolves.toBe(expected);
        expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
    });
});
