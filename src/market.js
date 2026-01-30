/**
 * 猜测股票前缀
 */
const getFullSymbol = (code) => {
  if (code.length !== 6) return code;
  // 6开头为上证，5开头为基金/ETF，通常归于上海
  if (code.startsWith('6') || code.startsWith('5')) return `sh${code}`;
  // 00, 30, 15, 16 等归于深圳
  return `sz${code}`;
};

/**
* 通用获取并解码 GBK 文本的方法
*/
const fetchRawText = async (url) => {
  try {
      const resp = await fetch(url, {
          headers: { "Referer": "https://finance.sina.com.cn/" }
      });
      if (!resp.ok) return null;
      const buffer = await resp.arrayBuffer();
      return new TextDecoder("gbk").decode(buffer);
  } catch (e) {
      return null;
  }
};

/**
* 解析新浪数据
* 格式: var hq_str_sh600519="贵州茅台,开盘,昨收,现价,...";
*/
const parseSinaData = (text) => {
  const match = text.match(/="([^"]+)"/);
  if (!match) return null;
  const data = match[1].split(',');
  if (data.length < 4) return null;
  const price = parseFloat(data[3]);
  return price > 0 ? { name: data[0], price: price } : null;
};

/**
* 解析腾讯数据
* 格式: v_sh600519="1~贵州茅台~600519~1600.00~...~";
*/
const parseTencentData = (text) => {
  const match = text.match(/="([^"]+)"/);
  if (!match) return null;
  const data = match[1].split('~');
  if (data.length < 4) return null;
  // 腾讯接口索引1是名字，3是当前价
  const price = parseFloat(data[3]);
  return price > 0 ? { name: data[1], price: price } : null;
};

/**
* 从多源获取实时行情（带降级逻辑）
* @param {string} symbolOrCode 
*/
export const fetchStockPrice = async (symbolOrCode) => {
  const symbol = getFullSymbol(symbolOrCode);
  
  // --- 尝试第一源：新浪 ---
  const sinaUrl = `https://hq.sinajs.cn/list=${symbol}`;
  const sinaRaw = await fetchRawText(sinaUrl);
  if (sinaRaw) {
      const result = parseSinaData(sinaRaw);
      if (result) return { ...result, symbol, source: 'sina' };
  }

  // --- 降级到第二源：腾讯 ---
  console.warn(`Sina API failed for ${symbol}, falling back to Tencent...`);
  const tencentUrl = `https://qt.gtimg.cn/q=${symbol}`;
  const tencentRaw = await fetchRawText(tencentUrl);
  if (tencentRaw) {
      const result = parseTencentData(tencentRaw);
      if (result) return { ...result, symbol, source: 'tencent' };
  }

  return null;
};