const getFullSymbol = (code: string) => {
  if (code.length !== 6) return code;
  if (code.startsWith('6') || code.startsWith('5')) return `sh${code}`;
  return `sz${code}`;
};

const fetchRawText = async (url: string) => {
  try {
      const resp = await fetch(url, { headers: { "Referer": "https://finance.sina.com.cn/" } });
      if (!resp.ok) return null;
      const buffer = await resp.arrayBuffer();
      // 简易处理：浏览器环境 TextDecoder 默认支持 utf-8，gbk 可能需要 polyfill，
      // 但腾讯接口通常返回兼容格式。这里为演示简化，生产环境建议后端代理。
      return new TextDecoder("gbk").decode(buffer);
  } catch (e) { return null; }
};

const parseTencentData = (text: string) => {
  const match = text.match(/="([^"]+)"/);
  if (!match) return null;
  const data = match[1].split('~');
  if (data.length < 4) return null;
  const price = parseFloat(data[3]);
  const name = data[1];
  const yest_close = parseFloat(data[4]);
  return price > 0 ? { name, price, yest_close } : null;
};

export const fetchStockPrice = async (code: string) => {
  const symbol = getFullSymbol(code);
  // 优先使用腾讯源，支持 CORS 的可能性较小，通常建议在 vite proxy 配置代理
  // 这里假设浏览器允许或已通过代理转发
  const tencentUrl = `https://qt.gtimg.cn/q=${symbol}`; 
  const tencentRaw = await fetchRawText(tencentUrl);
  if (tencentRaw) {
      return parseTencentData(tencentRaw);
  }
  return null;
};