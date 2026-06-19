// src/auth.js

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64UrlEncode = (input) => {
    const bytes = typeof input === 'string' ? enc.encode(input) : input;
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) {
        bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const b64UrlDecodeToString = (input) => {
    const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const bin = atob(normalized);
    return dec.decode(new Uint8Array(Array.from(bin).map((c) => c.charCodeAt(0))));
};

const b64UrlDecodeToBytes = (input) => {
    const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const bin = atob(normalized);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
        out[i] = bin.charCodeAt(i);
    }
    return out;
};

const importHmacKey = async (secret) => {
    return await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
    );
};

const constantTimeEqual = (a, b) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
};

const deriveHmacHex = async (secret, data) => {
    const key = await importHmacKey(secret);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
    return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
};

const verifyHmacHex = async (secret, data, expectedHex) => {
    if (typeof expectedHex !== 'string' || !expectedHex) return false;
    const key = await importHmacKey(secret);
    const expectedBytes = new Uint8Array(
        (expectedHex.match(/.{1,2}/g) || []).map((h) => parseInt(h, 16))
    );
    if (expectedBytes.length === 0) return false;
    return await crypto.subtle.verify('HMAC', key, expectedBytes, enc.encode(data));
};

export const verifyPassword = async (password, env) => {
    if (typeof password !== 'string' || !password) return false;
    if (!env.ADMIN_PASSWORD_HASH) return false;

    const salt = enc.encode(env.ADMIN_PASSWORD_SALT || 'secure_default_salt');
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);

    const derivedBits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        baseKey,
        256
    );

    const derivedHex = Array.from(new Uint8Array(derivedBits))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    return constantTimeEqual(derivedHex, String(env.ADMIN_PASSWORD_HASH));
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
    const sig = await deriveHmacHex(env.JWT_SECRET, data);
    const sigBytes = new Uint8Array(sig.match(/.{1,2}/g).map((h) => parseInt(h, 16)));
    const sigSeg = b64UrlEncode(sigBytes);
    return `${data}.${sigSeg}`;
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
    let sigBytes;
    try {
        sigBytes = b64UrlDecodeToBytes(sigSeg);
    } catch {
        return false;
    }
    if (!sigBytes || sigBytes.length === 0) return false;
    const sigHex = Array.from(sigBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    let ok = false;
    try {
        ok = await verifyHmacHex(env.JWT_SECRET, data, sigHex);
    } catch {
        return false;
    }
    if (!ok) return false;

    let payload;
    try {
        payload = JSON.parse(b64UrlDecodeToString(payloadSeg));
    } catch {
        return false;
    }
    if (payload?.role !== 'admin') return false;
    if (Number.isFinite(payload?.exp) && payload.exp * 1000 < Date.now()) return false;
    return true;
};
