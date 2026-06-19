// src/auth.js
//
// 自实现 JWT (HS256) 验证。
// 关键点：必须与 jsonwebtoken 库字节级兼容（用同一种 base64url 编码 + Buffer 签名）。
// 之前用 Web Crypto 的实现因为底层编码细节差异（特别是 base64url 边缘字符处理）
// 在 Cloudflare Workers 上验证失败（返回 401），所以这里改用 node:crypto + node:buffer。
//
// 在 wrangler.toml 的 compatibility_flags = ["nodejs_compat"] 下，
// node:crypto / node:buffer 在 Workers 中完全可用，并且与 jsonwebtoken 行为完全一致。

import { createHmac, timingSafeEqual } from 'node:crypto';

const enc = new TextEncoder();

const b64UrlEncode = (input) => {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
    return buf.toString('base64url');
};

const b64UrlDecode = (input) => {
    return Buffer.from(String(input), 'base64url').toString('utf8');
};

const b64UrlDecodeToBuffer = (input) => {
    return Buffer.from(String(input), 'base64url');
};

const hmacSignBase64Url = (data, secret) => {
    return createHmac('sha256', secret).update(data, 'utf8').digest('base64url');
};

const hmacVerify = (data, secret, expectedB64Url) => {
    const computed = createHmac('sha256', secret).update(data, 'utf8').digest();
    const expected = b64UrlDecodeToBuffer(expectedB64Url);
    if (computed.length !== expected.length) return false;
    try {
        return timingSafeEqual(computed, expected);
    } catch {
        return false;
    }
};

const constantTimeEqualString = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    try {
        return timingSafeEqual(bufA, bufB);
    } catch {
        return false;
    }
};

export const verifyPassword = async (password, env) => {
    if (typeof password !== 'string' || !password) return false;
    if (!env.ADMIN_PASSWORD_HASH) return false;

    const salt = env.ADMIN_PASSWORD_SALT || 'secure_default_salt';
    const baseKey = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
        baseKey,
        256
    );
    const derivedHex = Array.from(new Uint8Array(derivedBits))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    return constantTimeEqualString(derivedHex, String(env.ADMIN_PASSWORD_HASH));
};

export const signToken = async (env) => {
    const header = { alg: 'HS256', typ: 'JWT' };
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresIn = 12 * 60 * 60;
    const payload = {
        role: 'admin',
        jti: crypto.randomUUID(),
        iat: issuedAt,
        exp: issuedAt + expiresIn
    };
    const headerSeg = b64UrlEncode(JSON.stringify(header));
    const payloadSeg = b64UrlEncode(JSON.stringify(payload));
    const data = `${headerSeg}.${payloadSeg}`;
    const signature = hmacSignBase64Url(data, env.JWT_SECRET);
    return `${data}.${signature}`;
};

export const verifyAuth = async (request, env) => {
    const header = request.headers.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return false;

    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerSeg, payloadSeg, sigSeg] = parts;
    if (!headerSeg || !payloadSeg || !sigSeg) return false;

    const data = `${headerSeg}.${payloadSeg}`;
    if (!hmacVerify(data, env.JWT_SECRET, sigSeg)) return false;

    let payload;
    try {
        payload = JSON.parse(b64UrlDecode(payloadSeg));
    } catch {
        return false;
    }
    if (payload?.role !== 'admin') return false;
    if (Number.isFinite(payload?.exp) && payload.exp * 1000 < Date.now()) return false;
    return true;
};
