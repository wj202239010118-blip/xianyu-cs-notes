'use strict';

// 同行 / 推销话术识别（本机构建新增）
// 目的：把「同行、代运营、刷单、引流」这类非买家咨询挡在自动回复之外 —— 转人工、不自动回。
// 原则：
//   1) 强特征词（代运营 / 互粉 / 刷单 / 加V / 一件代发 …）单命中即拦；
//   2) 弱特征词（合作 / 推广 / 软件 / 对接 …）需同时命中两个以上才拦，避免误伤真实买家；
//   3) 只做「不自动回复 + 记异常队列」，不丢消息、不拉黑、不阻断人工接手。

const STRONG = [
  /代运营|店铺托管|代打理|代上架/,
  /互粉|互赞|互关|涨粉|刷粉|刷人气/,
  /刷单|补单|刷销量|刷好评|刷信誉/,
  /加\s*[vV]|加微信|加微|vx|V信|威信|企鹅号/,
  /一件代发|货源|供货|招商|加盟|招代理/,
  /收徒|培训|课程|教学|带徒/,
  /推广引流|引流推广|流量扶持|曝光量/,
  /同行|商家交流|老板交流/,
];

const WEAK = [
  /合作/, /推广/, /软件/, /脚本/, /工具/, /流量/, /对接/, /资源/, /渠道/,
];

function normalize(text) {
  return String(text || '').replace(/\s+/g, '').toLowerCase();
}

function isPeerPromo(text) {
  const s = normalize(text);
  if (!s || s.length < 2) return { peer: false };
  for (const re of STRONG) {
    if (re.test(s)) return { peer: true, reason: 'STRONG', pattern: String(re) };
  }
  const weak = WEAK.filter((re) => re.test(s));
  if (weak.length >= 2) {
    return { peer: true, reason: 'WEAK_MULTI', pattern: weak.map(String).join(' | ') };
  }
  return { peer: false };
}

module.exports = { isPeerPromo };
