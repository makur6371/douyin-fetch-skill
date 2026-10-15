#!/usr/bin/env node
/**
 * link-resolve —— 万能链接解析器
 *
 * 丢任何链接进来，自动识别平台并解析：
 *   抖音（分享链/视频页）  → 元数据 + 无水印视频 + 原声/音轨 + 抽帧
 *   微信公众号文章          → 标题/作者/发布时间/正文纯文本 + 图片/视频清单
 *   微信视频号（需登录态）  → 标题/作者/时长/无水印视频
 *   其他网页                → 标题/正文/图片（通用兜底）
 *
 * 原理与 fetch.mjs 一致：用本机真 Chrome 正常加载页面，
 * 偷听页面自己发出的数据（XHR/JSON/RENDER_DATA），签名让浏览器自己算。
 *
 * 用法：
 *   node resolve.mjs <链接> [选项]
 *
 * 选项：
 *   --out <目录>       输出目录（默认 ./out）
 *   --login            用持久档案（首次会弹真窗口让你扫码，之后免登录）
 *   --frames <n>       抖音：抽 n 帧
 *   --json             只输出 JSON
 */

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* 参数                                                                */
/* ------------------------------------------------------------------ */

const opts = {
  url: null,
  out: './out',
  login: false,
  frames: 0,
  json: false,
  wait: 9000,
};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--out') opts.out = process.argv[++i];
  else if (a === '--login') opts.login = true;
  else if (a === '--frames') opts.frames = parseInt(process.argv[++i], 10) || 0;
  else if (a === '--json') opts.json = true;
  else if (a === '--wait') opts.wait = parseInt(process.argv[++i], 10) || 9000;
  else if (!a.startsWith('-')) opts.url = a;
}
if (!opts.url) {
  console.error('用法: node resolve.mjs <链接> [--out 目录] [--login] [--frames n] [--json]');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Chrome 定位                                                         */
/* ------------------------------------------------------------------ */

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const chromePath = CHROME_CANDIDATES.find((p) => p && fs.existsSync(p));
if (!chromePath) {
  console.error('✗ 找不到 Chrome/Edge，用 CHROME_PATH 环境变量指定');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 平台识别                                                            */
/* ------------------------------------------------------------------ */

function detect(u) {
  const s = u.toLowerCase();
  if (s.includes('douyin.com') || s.includes('iesdouyin.com') || s.includes('v.douyin')) return 'douyin';
  if (s.includes('mp.weixin.qq.com')) return 'wx-mp';
  if (s.includes('channels.weixin.qq.com')) return 'wx-channel';
  if (s.includes('weixin.qq.com') || s.includes('wechat')) return 'wx-other';
  return 'web';
}

/* ------------------------------------------------------------------ */
/* 浏览器启动（login 模式用持久档案）                                   */
/* ------------------------------------------------------------------ */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const profileDir = path.join(__dirname, '.profile');

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: !opts.login,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-gpu'],
});
const ctx = await browser.newContext(
  opts.login
    ? { viewport: { width: 1440, height: 900 }, locale: 'zh-CN', userAgent: UA, storageState: undefined }
    : { viewport: { width: 1440, height: 900 }, locale: 'zh-CN', userAgent: UA },
);
// login 模式：先试着恢复之前的登录态
if (opts.login && fs.existsSync(path.join(profileDir, 'state.json'))) {
  await ctx.storageState({ path: path.join(profileDir, 'state.json') }).catch(() => {});
  const restored = await ctx.newPage();
  await restored.goto('https://channels.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await restored.close();
}
const page = await ctx.newPage();

/* ------------------------------------------------------------------ */
/* 数据捕获（网络层偷听，全平台共用）                                    */
/* ------------------------------------------------------------------ */

const captured = { json: [], videos: [], renderData: [] };
page.on('response', async (res) => {
  try {
    const u = res.url();
    const ct = (res.headers()['content-type'] || '').toLowerCase();
    if (ct.includes('json')) {
      const j = await res.json().catch(() => null);
      if (j) captured.json.push({ url: u, body: j });
    }
    if (ct.startsWith('video/') || u.includes('finder.video.qq.com') || /\.mp4(\?|$)/.test(u)) {
      if (!captured.videos.includes(u)) captured.videos.push(u);
    }
    // 微信视频号把数据塞在 window.__RENDER_DATA__ 里
    if (u.includes('channels.weixin.qq.com') && ct.includes('html')) {
      const t = await res.text().catch(() => '');
      const m = t.match(/window\.__RENDER_DATA__\s*=\s*([^<]+)/);
      if (m) {
        const dec = JSON.parse(decodeURIComponent(m[1]).trim());
        captured.renderData.push(dec);
      }
    }
  } catch {
    /* 忽略 */
  }
});

/* ------------------------------------------------------------------ */
/* 打开页面                                                            */
/* ------------------------------------------------------------------ */

let finalUrl = opts.url;
if (!opts.json) console.error(`→ 打开 ${opts.url}`);
try {
  await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(opts.wait);
  finalUrl = page.url();
} catch (e) {
  if (!opts.json) console.error(`⚠ 页面加载异常（继续用已捕获数据）：${e.message}`);
}

/* ------------------------------------------------------------------ */
/* 各平台解析                                                          */
/* ------------------------------------------------------------------ */

const platform = detect(opts.url);
const result = { platform, input: opts.url, resolved: finalUrl };

/** 从任意 JSON 树里找出含指定 key 的第一个对象 */
function deepFind(node, key, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (key in node) return node;
  for (const v of Object.values(node)) {
    const hit = deepFind(v, key, depth + 1);
    if (hit) return hit;
  }
  return null;
}

async function parseWxMp() {
  const d = await page.evaluate(() => {
    const txt = (sel) => document.querySelector(sel)?.innerText?.trim() || '';
    const content = document.querySelector('#js_content');
    return {
      title: document.querySelector('h1#activity-name')?.innerText?.trim() || document.title,
      author: txt('#js_name'),
      publishTime: txt('#publish_time') || null,
      // 正文纯文本
      text: (content?.innerText || '').replace(/\n{3,}/g, '\n\n').trim(),
      // 图片清单（去掉懒加载占位，取 data-src）
      images: [...document.querySelectorAll('#js_content img')].map((im) => im.dataset.src || im.src).filter(Boolean),
      // 内嵌视频（公众号用 iframe 或 video 标签）
      videos: [...document.querySelectorAll('#js_content iframe, #js_content video')].map((v) => v.src || v.dataset.src || v.dataset.vid || null).filter(Boolean),
      readStat: txt('#js_read_area') || null,
    };
  });
  result.title = d.title;
  result.author = d.author;
  result.publishTime = d.publishTime;
  result.text = d.text;
  result.imageUrls = d.images;
  result.videoRefs = d.videos;
}

async function parseWxChannel() {
  // 登录态检查
  const needLogin =
    finalUrl.includes('login') ||
    (await page.evaluate(() => document.body.innerText.includes('扫码登录')).catch(() => false));
  if (needLogin && !opts.login) {
    result.needLogin = true;
    result.hint = '视频号需要登录态。用 --login 重跑，首次会弹窗扫码。';
    return;
  }
  if (needLogin && opts.login) {
    if (!opts.json) console.error('→ 检测到需要登录，请在弹出的窗口里扫码（2 分钟内完成）');
    try {
      await page.waitForResponse((r) => r.url().includes('finder') && r.status() === 200, { timeout: 120000 });
    } catch { /* 超时则用现有数据 */ }
  }
  // __RENDER_DATA__ 或 XHR 里找视频对象
  let v = null;
  for (const rd of captured.renderData) {
    v = deepFind(rd, 'objectDesc') || deepFind(rd, 'media');
    if (v) break;
  }
  if (!v) {
    for (const { body } of captured.json) {
      v = deepFind(body, 'objectDesc');
      if (v) break;
    }
  }
  if (v) {
    result.title = v.objectDesc?.media?.description || v.description || null;
    result.author = v.nickname || v.author?.nickname || null;
    result.durationMs = v.objectDesc?.media?.duration || v.duration || null;
    result.cover = v.objectDesc?.media?.coverUrl || v.coverUrl || null;
    result.videoUrls = captured.videos.filter((u) => u.includes('finder.video.qq.com'));
  } else {
    result.videoUrls = captured.videos.filter((u) => u.includes('finder.video.qq.com'));
    result.note = '从网络层抓到视频流，但页面数据结构未识别（改版？），字段可能不全。';
  }
  const pd = await page
    .evaluate(() => ({
      title: document.title,
      author: document.querySelector('.channel-author')?.innerText || null,
    }))
    .catch(() => ({}));
  if (!result.title && pd.title) result.title = pd.title;
}

async function parseDouyin() {
  // 复用 fetch.mjs 的逻辑：找 aweme/detail XHR
  let detail = null;
  for (const { url, body } of captured.json) {
    if (url.includes('aweme/detail') && body?.aweme_detail) { detail = body.aweme_detail; break; }
  }
  if (detail) {
    result.awemeId = detail.aweme_id;
    result.desc = detail.desc ?? null;
    result.author = detail.author?.nickname ?? null;
    result.durationMs = detail.video?.duration ?? null;
    result.stats = detail.statistics ?? null;
    result.cover = (detail.video?.cover?.url_list || [])[0] ?? null;
    result.playAddr = (detail.video?.play_addr?.url_list || []).slice(0, 4);
    result.music = detail.music
      ? {
          title: detail.music.title ?? null,
          playUrl: (detail.music.play_url?.url_list || []).slice(0, 3),
        }
      : null;
  } else {
    result.note = '未捕获 aweme/detail XHR（页面可能还在加载），仅记录到媒体流地址。';
  }
  result.mediaUrls = captured.videos;
}

async function parseWeb() {
  const d = await page.evaluate(() => {
    // 简易正文抽取：取文本量最大的块
    let best = '';
    for (const el of document.querySelectorAll('article, main, .content, #content, div, section')) {
      const t = el.innerText || '';
      if (t.length > best.length && t.length < 200000) {
        // 只认"叶子级"大块，避免 body 一层包所有
        if (el.children.length === 0 || el.querySelectorAll('p').length > 2) best = t;
      }
    }
    return {
      title: document.title,
      metaDesc: document.querySelector('meta[name="description"]')?.content || '',
      text: best.replace(/\n{3,}/g, '\n\n').slice(0, 50000),
      images: [...document.querySelectorAll('img')].map((im) => im.src).filter((s) => s && !s.startsWith('data:')).slice(0, 30),
    };
  });
  result.title = d.title;
  result.description = d.metaDesc;
  result.text = d.text;
  result.imageUrls = d.images;
}

switch (platform) {
  case 'douyin': await parseDouyin(); break;
  case 'wx-mp': await parseWxMp(); break;
  case 'wx-channel': await parseWxChannel(); break;
  default: await parseWeb();
}

await browser.close();

/* ------------------------------------------------------------------ */
/* 落盘 + 下载                                                         */
/* ------------------------------------------------------------------ */

const slug = (result.awemeId || result.title || 'page').toString().replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60) || 'page';
const outDir = path.resolve(opts.out, slug);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'info.json'), JSON.stringify(result, null, 2), 'utf8');
result.files = { info: path.join(outDir, 'info.json') };

/* 有直链就下载视频（抖音 playAddr / 视频号 finder 流） */
const dlCandidates = result.playAddr || result.videoUrls || [];
if (dlCandidates.length) {
  const vp = path.join(outDir, 'video.mp4');
  for (const u of dlCandidates) {
    try {
      const r = await fetch(u, {
        headers: { 'User-Agent': UA, Referer: 'https://www.douyin.com/' },
      });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 10240) continue;
      fs.writeFileSync(vp, buf);
      result.files.video = vp;
      result.videoBytes = buf.length;
      break;
    } catch { /* 换下一个 */ }
  }
}

/* 公众号：正文 + 图片清单落成 Markdown，图片可选下载 */
if (platform === 'wx-mp' && result.text) {
  const md = [
    `# ${result.title}`,
    '',
    `- 作者：${result.author || '?'}`,
    `- 时间：${result.publishTime || '?'}`,
    `- 来源：${finalUrl}`,
    '',
    '---',
    '',
    result.text,
    '',
    '---',
    `图片 ${result.imageUrls?.length || 0} 张：`,
    ...(result.imageUrls || []).map((u, i) => `${i + 1}. ${u}`),
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'article.md'), md, 'utf8');
  result.files.article = path.join(outDir, 'article.md');
}

/* 抽帧（有视频文件才抽） */
if (opts.frames > 0 && result.files.video) {
  const framesDir = path.join(outDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  try {
    const dur = (result.durationMs || 0) / 1000;
    const step = dur > 0 ? dur / opts.frames : 10;
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', result.files.video, '-vf', `fps=1/${step.toFixed(3)}`, '-q:v', '3', path.join(framesDir, 'f%02d.jpg')], { stdio: 'ignore' });
    result.files.frames = framesDir;
  } catch { if (!opts.json) console.error('⚠ 抽帧失败（ffmpeg 在 PATH？）'); }
}

/* ------------------------------------------------------------------ */
/* 输出                                                                */
/* ------------------------------------------------------------------ */

if (opts.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('');
  console.log(`✓ 平台 ${result.platform}`);
  if (result.title) console.log(`  标题  ${result.title}`);
  if (result.author) console.log(`  作者  ${result.author}`);
  if (result.publishTime) console.log(`  时间  ${result.publishTime}`);
  if (result.desc) console.log(`  文案  ${result.desc.slice(0, 100)}`);
  if (result.videoBytes) console.log(`  视频  ${result.files.video}  (${(result.videoBytes / 1048576).toFixed(1)} MB)`);
  if (result.files.article) console.log(`  正文  ${result.files.article}  (${(result.text || '').length} 字)`);
  if (result.imageUrls?.length) console.log(`  图片  ${result.imageUrls.length} 张（URL 清单见 info.json）`);
  if (result.needLogin) console.log(`  ⚠ ${result.hint}`);
  if (result.note) console.log(`  ℹ ${result.note}`);
  console.log(`  目录  ${outDir}`);
  console.log('');
}
