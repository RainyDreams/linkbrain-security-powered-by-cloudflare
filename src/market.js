const A_SHARE_SYMBOL_RE = /^(sh|sz|bj)\d{6}$/;

const normalizeSymbol = (code) => {
    if (typeof code !== 'string') return '';
    const normalized = code.trim().toLowerCase();
    if (A_SHARE_SYMBOL_RE.test(normalized)) return normalized;
    if (!/^\d{6}$/.test(normalized)) return '';
    if (normalized.startsWith('8') || normalized.startsWith('4')) return `bj${normalized}`;
    if (normalized.startsWith('6') || normalized.startsWith('5') || normalized.startsWith('9')) return `sh${normalized}`;
    return `sz${normalized}`;
};

const fetchRawTextGbk = async (url, referer) => {
    try {
        const resp = await fetch(url, {
            headers: {
                Referer: referer
            }
        });
        if (!resp.ok) return null;
        const buffer = await resp.arrayBuffer();
        return new TextDecoder('gbk').decode(buffer);
    } catch {
        return null;
    }
};

const parseSinaData = (text) => {
    const match = String(text || '').match(/="([^"]+)"/);
    if (!match) return null;
    const data = match[1].split(',');
    if (data.length < 4) return null;

    const name = String(data[0] || '').trim();
    const price = Number.parseFloat(data[3]);
    const prevClose = Number.parseFloat(data[2]);
    if (!Number.isFinite(price) || price <= 0) return null;

    return {
        name,
        price,
        prevClose: Number.isFinite(prevClose) && prevClose > 0 ? prevClose : null
    };
};

const parseTencentData = (text) => {
    const match = String(text || '').match(/="([^"]+)"/);
    if (!match) return null;
    const data = match[1].split('~');
    if (data.length < 5) return null;

    const name = String(data[1] || '').trim();
    const price = Number.parseFloat(data[3]);
    const prevClose = Number.parseFloat(data[4]);
    if (!Number.isFinite(price) || price <= 0) return null;

    return {
        name,
        price,
        prevClose: Number.isFinite(prevClose) && prevClose > 0 ? prevClose : null
    };
};

export const fetchStockPrice = async (symbolOrCode) => {
    const symbol = normalizeSymbol(symbolOrCode);
    if (!symbol || !A_SHARE_SYMBOL_RE.test(symbol)) return null;

    const sinaRaw = await fetchRawTextGbk(`https://hq.sinajs.cn/list=${symbol}`, 'https://finance.sina.com.cn/');
    if (sinaRaw) {
        const parsed = parseSinaData(sinaRaw);
        if (parsed) {
            return {
                ...parsed,
                symbol,
                source: 'sina'
            };
        }
    }

    const tencentRaw = await fetchRawTextGbk(`https://qt.gtimg.cn/q=${symbol}`, 'https://qt.gtimg.cn/');
    if (tencentRaw) {
        const parsed = parseTencentData(tencentRaw);
        if (parsed) {
            return {
                ...parsed,
                symbol,
                source: 'tencent'
            };
        }
    }

    return null;
};
