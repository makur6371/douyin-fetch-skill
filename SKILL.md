---
name: douyin-fetch
description: >
  抓取抖音视频（分享链接或网页链接）：元数据 + 无水印原片 + 抽帧 + 平台原声/完整音轨。
  Use when the user shares a Douyin URL (v.douyin.com / www.douyin.com/video/...),
  asks to 下载/抓取/保存 a Douyin video, extract its BGM or audio track,
  抽帧 for storyboard analysis, or pull video metadata (作者/文案/点赞收藏数据).
  Trigger words: 抖音, douyin, 抓视频, 无水印, 原声, BGM, 音轨, 抽帧, 分享链接.
metadata:
  short-description: "抖音分享链接 → 元数据 + 无水印视频 + 原声/音轨 + 抽帧"
---

# Douyin Fetch

抖音分享链接一键抓取：元数据 JSON、无水印 MP4、关键帧、平台原声 BGM、完整音轨。

## 原理

抖音网页版的视频数据在 `aweme/v1/web/aweme/detail/` 这个 XHR 里。脚本用
**本机已装的真 Chrome**（`playwright-core` 驱动，不下载浏览器）正常加载页面，
在 `page.on('response')` 上监听并抄下这份 JSON —— 其中 `video.play_addr.url_list`
是浏览器自己完成签名（X-Bogus）的带签名直链，普通下载即可，无需逆向签名算法。

登录弹窗、青少年模式等页面层遮挡无需处理：数据在网络层已经到手，
脚本不点击、不填表，弹窗无效。

## 前置条件

1. 本机装有 Chrome 或 Edge（自动探测，找不到时用 `CHROME_PATH` 指定）
2. Node.js 18+
3. `playwright-core` 可 import（在任意含 `node_modules/playwright-core` 的目录运行，或先 `npm i playwright-core`）
4. ffmpeg 在 PATH（仅 `--frames` / `--audio` 需要）

## 用法

```powershell
# 最基本：分享链接 → 元数据 + 无水印视频
node scripts/fetch.mjs "https://v.douyin.com/xxxxx/"

# 完整：输出目录 + 抽 15 帧 + 平台原声 + 兜底音轨
node scripts/fetch.mjs "https://v.douyin.com/xxxxx/" --out D:\clips --frames 15 --bgm --audio

# 只抓元数据（不下载）
node scripts/fetch.mjs "https://v.douyin.com/xxxxx/" --no-download --json
```

输出结构（按视频 id 建目录）：

```
<out>/<aweme_id>/
├── info.json      # 作者/文案/统计数据/封面/直链/原声元数据
├── video.mp4      # 无水印原片
├── frames/f*.jpg  # 关键帧（--frames N）
└── bgm.mp3        # 平台原声（--bgm，m4a 自动转 mp3）
```

## 选项

| 选项 | 说明 |
|---|---|
| `--out <目录>` | 输出根目录（默认 `./out`） |
| `--no-download` | 只抓元数据 |
| `--frames <n>` | 均匀抽 n 帧（需 ffmpeg） |
| `--bgm` | 下载平台"原声"轨道并转 mp3 |
| `--audio` | 原声拿不到时，从视频抽完整音轨兜底 |
| `--wait <毫秒>` | XHR 等待时长（默认 9000，网络慢加大） |
| `--json` | 只输出 JSON 到 stdout |

## 注意

- 直链签名有时效，**当天用当天下**；隔天重跑脚本即可拿新链接
- 页面打不开/抓空时先试 `--wait 15000`
- `music.durationMs` 元数据不可靠，以 ffprobe 实测文件为准
- 仅做公开数据读取与分析；转载/商用前需授权并保留出处
- 自动化访问需遵守抖音服务条款；控制频率，勿用于批量爬取
