<div align="center">

# douyin-fetch-skill

**抖音分享链接 → 元数据 + 无水印原片 + 原声/音轨 + 抽帧，一条命令**

![Node](https://img.shields.io/badge/node-%E2%89%A518-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Runtime](https://img.shields.io/badge/powered%20by-playwright--core-2EAD33)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

[中文](#快速开始) · [English](#english)

</div>

## 快速开始

```powershell
npm i playwright-core          # 任意目录，或复用已有的 node_modules
node scripts/fetch.mjs "https://v.douyin.com/xxxxx/" --out D:\clips --frames 15 --bgm --audio
```

输出：

```
<out>/<视频id>/
├── info.json      # 作者/文案/赞藏评转数据/封面/直链
├── video.mp4      # 无水印原片
├── frames/f*.jpg  # 关键帧
└── bgm.mp3        # 平台原声（自动 m4a→mp3）
```

## 工作原理

```
真 Chrome（你本机装的）正常打开抖音页面
        │
        ├── 页面自己发 XHR: aweme/v1/web/aweme/detail/
        │      └── 服务器返回完整 JSON（含带签名直链）
        │
        └── 脚本在 page.on('response') 偷听 → 抄下 JSON → 拿直链普通下载
```

- **无需逆向签名**：X-Bogus 签名由真浏览器自己算好，脚本只摘取结果
- **无需处理弹窗**：登录墙/青少年模式是页面层遮挡，数据在网络层已经到手
- **抗改版**：不依赖页面 DOM 结构，只认 XHR 路径和 JSON 字段

## 为什么不用 yt-dlp？

| | 本工具 | yt-dlp |
|---|---|---|
| 抖音支持 | ✅ 专攻抖音 | ⚠️ 需要 Cookie，经常被 403 |
| 签名对抗 | 真浏览器代算，改版影响小 | 纯逆向，抖音一改就失效 |
| 依赖 | 本机 Chrome + playwright-core | 自带，但对抗靠社区更新 |
| 平台通用性 | 仅抖音 | 全平台 |

> yt-dlp 是全能选手，但抖音的对抗最激烈；本工具换了一条更抗造的路线——
> **让真浏览器把最难的部分（过门禁 + 算签名）干完，脚本只负责偷听和下载。**

## 作为 Skill 安装（AI Agent）

把仓库放进技能目录并软链（以 Claude Code / DSH 为例）：

```powershell
git clone https://github.com/makur6371/douyin-fetch-skill.git "$env:USERPROFILE\.cc-switch\skills\douyin-fetch"
New-Item -ItemType Junction -Path "$env:USERPROFILE\.agents\skills\douyin-fetch" -Target "$env:USERPROFILE\.cc-switch\skills\douyin-fetch"
```

之后 Agent 在对话里收到抖音链接会自动调用本技能（触发词：抖音 / 抓视频 / 无水印 / 原声 / BGM / 抽帧）。

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

## 依赖

| 依赖 | 用途 | 必需 |
|---|---|---|
| Chrome / Edge | 真浏览器环境 | ✓（`CHROME_PATH` 可指定路径） |
| Node.js ≥ 18 | 运行脚本 | ✓ |
| playwright-core | 驱动浏览器 | ✓ |
| ffmpeg | 抽帧 / 转码 | 仅 `--frames` / `--audio` |

## 注意

- 直链签名有时效，**当天用当天下**；隔天重跑脚本即可拿新链接
- 页面打不开/抓空时先试 `--wait 15000`
- `music.durationMs` 元数据不可靠，以 ffprobe 实测文件为准

## 合规提醒

- 仅用于**公开数据**的读取与个人分析
- 转载、商用前需获得原作者授权，并保留出处
- 自动化访问请控制频率，勿用于批量爬取；遵守抖音服务条款
- 抓到的内容版权归原作者所有

## English

Fetch Douyin (TikTok China) videos from share links: **metadata + watermark-free MP4 + keyframes + platform BGM / full audio track** in one command. Works by driving your locally-installed real Chrome with `playwright-core` and intercepting the `aweme/detail` XHR — the browser computes all anti-bot signatures itself, so no reverse-engineering is needed and the approach survives Douyin's frequent front-end changes.

```bash
npm i playwright-core
node scripts/fetch.mjs "https://v.douyin.com/xxxxx/" --out ./clips --frames 15 --bgm --audio
```

Public data analysis only; respect Douyin's terms of service and content ownership.

## License

MIT
