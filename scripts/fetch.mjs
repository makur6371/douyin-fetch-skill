#!/usr/bin/env node
/**
 * douyin-fetch —— 解析抖音分享链接
 *
 * 原理：抖音网页版的视频数据放在 `aweme/v1/web/aweme/detail/` 这个 XHR 里。
 * 用真实浏览器（本机 Chrome）加载页面，监听 response 就能拿到完整 JSON，
 * 其中 video.play_addr.url_list 是带签名的无水印直链，可以直接下载。
 *
 * 用法：
 *   node fetch.mjs <分享链接或视频URL> [选项]
 *
 * 选项：
 *   --out <目录>      输出根目录（默认 ./out）
 *   --no-download     只抓元数据，不下载视频
 *   --frames <n>      抽 n 帧（需要 ffmpeg 在 PATH 里）
 *   --wait <毫秒>     XHR 等待时长（默认 9000，网络慢就加大）
 *   --json            只输出 JSON 到 stdout，不打印人类可读摘要
 *
 * 例：
 *   node fetch.mjs "https://v.douyin.com/3Xc4ThIidaI/"
 *   node fetch.mjs "https://www.douyin.com/video/7690973351082881939" --frames 15 --out D:\clips
 */

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/* ------------------------------------------------------------------ */
/* 参数                                                                */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = {
    url: null,
    out: './out',
    download: true,
    frames: 0,
    wait: 9000,
    json: false,
    bgm: false,        // 抓平台"原声"轨道（干净的 BGM）
    audioTrack: false, // 抓不到原声时，从视频抽完整音轨兜底
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--no-download') opts.download = false;
    else if (a === '--frames') opts.frames = parseInt(argv[++i], 10) || 0;
    else if (a === '--wait') opts.wait = parseInt(argv[++i], 10) || 9000;
    else if (a === '--json') opts.json = true;
    else if (a === '--bgm') opts.bgm = true;
    else if (a === '--audio') { opts.bgm = true; opts.audioTrack = true; }
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (!a.startsWith('-')) opts.url = a;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.help || !opts.url) {
  console.log(`douyin-fetch —— 解析抖音分享链接

用法: node fetch.mjs <分享链接或视频URL> [选项]

选项:
  --out <目录>      输出根目录（默认 ./out）
  --no-download     只抓元数据，不下载视频
  --frames <n>      抽 n 帧（需要 ffmpeg）
  --bgm             额外下载平台"原声"轨道（通常是干净的 BGM，自动转 mp3）
  --audio           --bgm + 抓不到原声时从视频抽完整音轨兜底
  --wait <毫秒>     XHR 等待时长（默认 9000）
  --json            只输出 JSON

例:
  node fetch.mjs "https://v.douyin.com/3Xc4ThIidaI/"
  node fetch.mjs "https://v.douyin.com/xxxx/" --bgm --frames 15`);
  process.exit(opts.help ? 0 : 1);
}

/* ------------------------------------------------------------------ */
/* 找到本机 Chrome                                                      */
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
  console.error('✗ 找不到 Chrome/Edge。用 CHROME_PATH 环境变量指定可执行文件路径。');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 抓取                                                                */
/* ------------------------------------------------------------------ */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-gpu'],
});

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
  userAgent: UA,
});
const page = await ctx.newPage();

const detail = [];
const mediaUrls = [];

page.on('response', async (res) => {
  try {
    const u = res.url();
    const ct = (res.headers()['content-type'] || '').toLowerCase();
    if (ct.includes('json') && u.includes('aweme/detail')) {
      const j = await res.json().catch(() => null);
      const d = j?.aweme_detail;
      if (d && !detail.some((x) => x.awemeId === d.aweme_id)) {
        detail.push({
          awemeId: d.aweme_id,
          desc: d.desc ?? null,
          author: d.author?.nickname ?? null,
          authorId: d.author?.unique_id ?? d.author?.short_id ?? null,
          durationMs: d.video?.duration ?? null,
          createTime: d.create_time ?? null,
          stats: d.statistics ?? null,
          cover: (d.video?.cover?.url_list || [])[0] ?? null,
          playAddr: (d.video?.play_addr?.url_list || []).slice(0, 4),
          // 平台"原声"轨道：通常是干净的 BGM，比从视频抽音轨好得多
          music: d.music
            ? {
                id: d.music.id_str ?? d.music.id ?? null,
                title: d.music.title ?? null,
                author: d.music.author ?? null,
                durationMs: d.music.duration ?? null,
                isOriginal: d.music.is_original ?? null,
                playUrl: (d.music.play_url?.url_list || []).slice(0, 3),
                cover: (d.music.cover_large?.url_list || [])[0] ?? null,
              }
            : null,
        });
      }
    }
    if (ct.startsWith('video/') || /\.mp4(\?|$)/.test(u)) {
      if (!mediaUrls.includes(u)) mediaUrls.push(u);
    }
  } catch {
    /* 忽略解析失败的响应 */
  }
});

if (!opts.json) console.error(`→ 打开 ${opts.url}`);

let finalUrl = opts.url;
try {
  await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(opts.wait);
  finalUrl = page.url();
} catch (e) {
  if (!opts.json) console.error(`⚠ 页面加载异常（继续尝试已捕获的数据）：${e.message}`);
}

const pageInfo = await page
  .evaluate(() => {
    const v = document.querySelector('video');
    return {
      title: document.title,
      metaDesc: document.querySelector('meta[name="description"]')?.content || '',
      videoTagSrc: v ? v.currentSrc || v.src || null : null,
      bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1200),
    };
  })
  .catch(() => ({}));

await browser.close();

const meta = detail[0] || null;
if (!meta && mediaUrls.length === 0) {
  console.error('✗ 没抓到任何视频数据。可能是链接失效、需要登录，或页面结构变了。');
  console.error('  试试加大 --wait，或换一个视频链接验证脚本是否还工作。');
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* 落盘                                                                */
/* ------------------------------------------------------------------ */

const id = meta?.awemeId || 'unknown';
const outDir = path.resolve(opts.out, String(id));
fs.mkdirSync(outDir, { recursive: true });

const result = {
  source: { input: opts.url, resolved: finalUrl },
  meta,
  pageInfo,
  mediaUrls,
  files: {},
};

fs.writeFileSync(
  path.join(outDir, 'info.json'),
  JSON.stringify(result, null, 2),
  'utf8',
);
result.files.info = path.join(outDir, 'info.json');

/* 下载视频 */
if (opts.download && meta?.playAddr?.length) {
  const videoPath = path.join(outDir, 'video.mp4');
  let ok = false;
  for (const url of meta.playAddr) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: 'https://www.douyin.com/' },
      });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 10240) continue; // 太小，多半是错误页
      fs.writeFileSync(videoPath, buf);
      result.files.video = videoPath;
      result.videoBytes = buf.length;
      ok = true;
      break;
    } catch {
      /* 换下一个镜像地址 */
    }
  }
  if (!ok && !opts.json) console.error('⚠ 所有播放地址都下载失败（签名可能已过期）');
}

/* 抽帧 */
if (opts.frames > 0 && result.files.video) {
  const durSec = (meta.durationMs || 0) / 1000;
  const step = durSec > 0 ? durSec / opts.frames : 10;
  const framesDir = path.join(outDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  try {
    execFileSync(
      'ffmpeg',
      [
        '-y', '-v', 'error',
        '-i', result.files.video,
        '-vf', `fps=1/${step.toFixed(3)}`,
        '-q:v', '3',
        path.join(framesDir, 'f%02d.jpg'),
      ],
      { stdio: 'ignore' },
    );
    const n = fs.readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).length;
    result.files.frames = framesDir;
    result.frameCount = n;
  } catch {
    if (!opts.json) console.error('⚠ 抽帧失败（ffmpeg 不在 PATH 里？）');
  }
}

/* 下载原声轨道（干净的 BGM，优先于从视频抽音轨） */
if (opts.bgm && meta?.music?.playUrl?.length) {
  const bgmPath = path.join(outDir, 'bgm.m4a');
  let ok = false;
  for (const url of meta.music.playUrl) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: 'https://www.douyin.com/' },
      });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 4096) continue;
      fs.writeFileSync(bgmPath, buf);
      result.files.bgm = bgmPath;
      result.bgmBytes = buf.length;
      ok = true;
      break;
    } catch {
      /* 换下一个镜像地址 */
    }
  }
  if (ok) {
    // 若是 m4a/aac，顺手转成 mp3 方便直接用；转不了就保留原格式
    const mp3Path = path.join(outDir, 'bgm.mp3');
    try {
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', bgmPath, '-vn',
        '-c:a', 'libmp3lame', '-q:a', '2', mp3Path], { stdio: 'ignore' });
      if (fs.existsSync(mp3Path) && fs.statSync(mp3Path).size > 4096) {
        result.files.bgmMp3 = mp3Path;
        fs.unlinkSync(bgmPath);
        delete result.files.bgm;
      }
    } catch {
      /* 没有 libmp3lame 就保留原始 m4a */
    }
  } else if (!opts.json) {
    console.error('⚠ 原声轨道下载失败（签名可能已过期，或该视频没有独立原声）');
  }
}

/* 从视频抽音轨（兜底：原声拿不到时，至少留下完整音轨） */
if (opts.audioTrack && result.files.video && !result.files.bgmMp3 && !result.files.bgm) {
  const aPath = path.join(outDir, 'audio.m4a');
  try {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', result.files.video,
      '-vn', '-c:a', 'copy', aPath], { stdio: 'ignore' });
    if (fs.existsSync(aPath) && fs.statSync(aPath).size > 4096) {
      result.files.audioTrack = aPath;
      result.audioTrackBytes = fs.statSync(aPath).size;
    }
  } catch {
    if (!opts.json) console.error('⚠ 从视频抽音轨失败');
  }
}

/* ------------------------------------------------------------------ */
/* 输出                                                                */
/* ------------------------------------------------------------------ */

if (opts.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const mm = Math.floor((meta.durationMs || 0) / 60000);
  const ss = Math.floor(((meta.durationMs || 0) % 60000) / 1000);
  console.log('');
  console.log(`✓ ${meta.author || '?'}  ·  ${mm}:${String(ss).padStart(2, '0')}  ·  id ${id}`);
  console.log(`  发布  ${meta.createTime ? new Date(meta.createTime * 1000).toLocaleString('zh-CN') : '?'}`);
  if (meta.stats) {
    console.log(
      `  数据  ${meta.stats.digg_count ?? 0} 赞 · ${meta.stats.collect_count ?? 0} 收藏 · ` +
        `${meta.stats.comment_count ?? 0} 评论 · ${meta.stats.share_count ?? 0} 转发`,
    );
  }
  console.log('');
  console.log(`  文案  ${(meta.desc || '').replace(/\n/g, ' ').slice(0, 200)}`);
  console.log('');
  for (const [k, v] of Object.entries(result.files)) {
    console.log(`  ${k.padEnd(7)} ${v}`);
  }
  if (result.videoBytes) console.log(`  ${'大小'.padEnd(6)} ${(result.videoBytes / 1048576).toFixed(1)} MB`);
  if (result.frameCount) console.log(`  ${'帧数'.padEnd(6)} ${result.frameCount}`);
  console.log('');
}
