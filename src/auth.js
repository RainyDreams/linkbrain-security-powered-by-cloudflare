import jwt from 'jsonwebtoken';

export const verifyPassword = async (password, env) => {
    if (typeof password !== 'string' || !password) return false;
    if (!env.ADMIN_PASSWORD_HASH) return false;

    const encoder = new TextEncoder();
    const salt = encoder.encode(env.ADMIN_PASSWORD_SALT || 'secure_default_salt');
    const baseKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);

    const derivedBits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        baseKey,
        256
    );

    const derivedHex = Array.from(new Uint8Array(derivedBits))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    let diff = 0;
    const hash = String(env.ADMIN_PASSWORD_HASH);
    const maxLen = Math.max(derivedHex.length, hash.length);
    for (let i = 0; i < maxLen; i++) {
        const left = i < derivedHex.length ? derivedHex.charCodeAt(i) : 0;
        const right = i < hash.length ? hash.charCodeAt(i) : 0;
        diff |= left ^ right;
    }
    return diff === 0 && derivedHex.length === hash.length;
};

export const signToken = (env) => {
    return jwt.sign({ role: 'admin', jti: crypto.randomUUID() }, env.JWT_SECRET, { expiresIn: '12h' });
};

export const verifyAuth = (request, env) => {
    const token = request.headers.get('Authorization')?.split(' ')[1];
    if (!token) return false;
    try {
        const decoded = jwt.verify(token, env.JWT_SECRET);
        return decoded.role === 'admin';
    } catch {
        return false;
    }
};

