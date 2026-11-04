import { generateKeyPairSync, verify, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { snowflakeJwt } from './connectors';

describe('Snowflake key-pair JWT', () => {
  it('has the claims and signature the SQL API checks', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const jwt = snowflakeJwt('xy12345.us-east-1', 'alice', pem);
    const [h, p, sig] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    const fp = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    expect(claims.sub).toBe('XY12345.ALICE');
    expect(claims.iss).toBe(`XY12345.ALICE.SHA256:${fp}`);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600);
    expect(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, 'base64url'))).toBe(true);
  });
});
