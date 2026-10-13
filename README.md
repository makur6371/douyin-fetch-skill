# douyin-fetch-skill

抖音分享链接抓取技能：一条命令拿到**元数据 + 无水印原片 + 关键帧 + 平台原声/完整音轨**。

面向 AI Agent 的 [Agent Skill](SKILL.md) 格式（`SKILL.md` + `scripts/`），也可当普通命令行脚本直接用。

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

## 依赖

| 依赖 | 用途 | 必需 |
|---|---|---|
| Chrome / Edge | 真浏览器环境 | ✓（`CHROME_PATH` 可指定路径） |
| Node.js ≥ 18 | 运行脚本 | ✓ |
| playwright-core | 驱动浏览器 | ✓ |
| ffmpeg | 抽帧 / 转码 | 仅 `--frames` / `--audio` |

## 作为 Skill 安装（AI Agent）

把仓库放进技能目录并软链（以 Claude Code / DSH 为例）：

```powershell
git clone https://github.com/makur6371/douyin-fetch-skill.git "$env:USERPROFILE\.cc-switch\skills\douyin-fetch"
New-Item -ItemType Junction -Path "$env:USERPROFILE\.agents\skills\douyin-fetch" -Target "$env:USERPROFILE\.cc-switch\skills\douyin-fetch"
```

之后 Agent 在对话里收到抖音链接会自动调用本技能。

## 合规提醒

- 仅用于**公开数据**的读取与个人分析
- 转载、商用前需获得原作者授权，并保留出处
- 自动化访问请控制频率，勿用于批量爬取；遵守抖音服务条款
- 抓到的内容版权归原作者所有

## License

MIT
