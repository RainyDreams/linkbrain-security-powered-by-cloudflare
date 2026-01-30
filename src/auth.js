import jwt from 'jsonwebtoken';

export const verifyPassword = async (password, env) => {
    const encoder = new TextEncoder();
    console.log(env.ADMIN_PASSWORD_SALT,env)
    const salt = encoder.encode(env.ADMIN_PASSWORD_SALT || "secure_default_salt");
    const baseKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    
    const derivedBits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        baseKey, 256
    );

    const derivedHex = Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
    
    // 恒定时间比较，防止计时攻击
    let diff = 0;
    const hash = env.ADMIN_PASSWORD_HASH;
    for (let i = 0; i < derivedHex.length; i++) {
        diff |= derivedHex.charCodeAt(i) ^ hash.charCodeAt(i);
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
    } catch { return false; }
};