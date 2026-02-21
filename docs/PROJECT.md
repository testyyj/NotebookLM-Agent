# NotebookLM Agent — 项目说明文档

> **版本**：v0.4.0  
> **更新日期**：2026-02-21  
> **许可证**：MIT

---

## 1. 项目概述

**NotebookLM Agent** 是一个面向 [Google NotebookLM](https://notebooklm.google.com) 的增强工具套件，旨在通过命令行和浏览器扩展两种方式，将 NotebookLM 的全部功能进行自动化封装，提供远超官方 Web UI 的操作效率和扩展能力。

### 核心价值

| 痛点 | 解决方案 |
|------|----------|
| NotebookLM 仅有 Web UI，操作效率低 | 提供 CLI Agent + 浏览器扩展双入口 |
| 无法批量操作笔记本/数据源/制品 | 支持批量生成、批量下载、批量删除 |
| 播客音频无法直接发布为 RSS Feed | 内置完整播客发布流水线（WAV→MP3→OSS→RSS） |
| 功能不可扩展 | 可插拔 Skill 系统，支持自定义扩展 |

### 目标用户

- 内容创作者（播客制作、知识管理）
- 研究人员（文献整理、RAG 问答）
- 开发者（二次开发、自定义 Skill）

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                       NotebookLM Agent 系统架构                      │
│                                                                     │
│  ┌──────────────────┐       ┌──────────────────────────────────┐    │
│  │   CLI Agent       │       │       Chrome Extension (MV3)      │   │
│  │   (Python)        │       │                                    │   │
│  │                   │       │  ┌──────────┐  ┌──────────────┐   │   │
│  │  ┌─────────────┐ │       │  │  Popup    │  │  Full-Page   │   │   │
│  │  │ Click CLI   │ │       │  │  (Mini)   │  │  UI (Main)   │   │   │
│  │  │ + Rich TUI  │ │       │  └──────────┘  └──────────────┘   │   │
│  │  └──────┬──────┘ │       │         │              │           │   │
│  │         │        │       │         ▼              ▼           │   │
│  │  ┌──────▼──────┐ │       │  ┌─────────────────────────────┐  │   │
│  │  │   Agent     │ │       │  │    Background Service Worker │  │   │
│  │  │  (调度器)    │ │       │  │    (消息路由/播客发布管线)     │  │   │
│  │  └──────┬──────┘ │       │  └──────────────┬──────────────┘  │   │
│  │         │        │       │                 │                  │   │
│  │  ┌──────▼──────┐ │       │  ┌──────────────▼──────────────┐  │   │
│  │  │ Skill 系统  │ │       │  │    API Layer (api.js)        │  │   │
│  │  │ - notebook  │ │       │  │    - RPC 编解码               │  │   │
│  │  │ - source    │ │       │  │    - Auth 管理                │  │   │
│  │  │ - chat      │ │       │  └──────────────┬──────────────┘  │   │
│  │  │ - generate  │ │       │                 │                  │   │
│  │  │ - research  │ │       │  ┌──────────────▼──────────────┐  │   │
│  │  │ - download  │ │       │  │  Podcast Module (TypeScript)  │  │   │
│  │  │ - custom... │ │       │  │  - OSS 上传 - RSS 生成        │  │   │
│  │  └──────┬──────┘ │       │  │  - AI 封面  - WAV→MP3 转码    │  │   │
│  │         │        │       │  └──────────────────────────────┘  │   │
│  └─────────┼────────┘       └──────────────┬─────────────────────┘   │
│            │                               │                         │
│            ▼                               ▼                         │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │           Google NotebookLM (未公开 RPC API)                  │    │
│  └──────────────────────────────────────────────────────────────┘    │
│            │                               │                         │
│            ▼                               ▼                         │
│  ┌─────────────────┐            ┌──────────────────────┐            │
│  │  notebooklm-py  │            │  Aliyun OSS / CDN    │            │
│  │  (Python SDK)   │            │  (播客文件托管)        │            │
│  └─────────────────┘            └──────────────────────┘            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 项目组件详解

### 3.1 CLI Agent（`nbagent/`）

命令行 Agent，基于 Python 构建，通过 `notebooklm-py` SDK 与 NotebookLM 交互。

| 文件 | 职责 |
|------|------|
| `cli.py` | Click 命令行入口 + Rich 终端美化输出 |
| `agent.py` | Agent 核心调度器，管理 Skill 注册与执行 |
| `config.py` | 配置管理（`~/.nbagent/config.yaml`） |
| `skills/base.py` | Skill 抽象基类（`BaseSkill` + `ActionInfo`） |
| `skills/notebook.py` | 笔记本 CRUD（创建/列表/删除/重命名/摘要） |
| `skills/source.py` | 数据源管理（URL/文件/YouTube/文本/刷新） |
| `skills/chat.py` | RAG 对话（基于数据源问答 + 引用来源） |
| `skills/generate.py` | 内容生成（播客/视频/Quiz/闪卡/报告/幻灯片/思维导图） |
| `skills/research.py` | 自动研究（Web/Drive 搜索 + 自动导入数据源） |
| `skills/download.py` | 制品下载（MP3/MP4/PDF/JSON/CSV/Markdown） |

**关键设计模式**：

- **Skill 系统**：所有功能以 Skill 形式注册，每个 Skill 包含多个 Action
- **自动注入**：执行 Action 时自动注入当前活动笔记本 ID
- **自定义扩展**：支持从 `custom_skills/` 目录自动发现并加载自定义 Skill

#### 依赖

```
Python ≥ 3.10
├── notebooklm-py[browser]   # NotebookLM 非官方 SDK
├── click ≥ 8.0              # CLI 框架
├── rich ≥ 13.0              # 终端美化
└── pyyaml ≥ 6.0             # 配置文件解析
```

---

### 3.2 Chrome Extension（`chrome-extension/`）

Manifest V3 浏览器扩展，提供完整的图形化操作界面。

#### 3.2.1 核心文件

| 文件 | 职责 |
|------|------|
| `manifest.json` | 扩展清单（MV3），声明权限和入口 |
| `page.html` / `page.js` / `page.css` | **全页 UI**（主界面，侧边栏+多面板布局） |
| `popup.html` / `popup.js` / `popup.css` | **弹出窗口 UI**（精简版快捷操作） |
| `src/background.js` | Service Worker（消息路由、播客发布管线） |
| `src/api.js` | NotebookLM API 封装层（RPC 调用） |
| `src/rpc.js` | RPC 协议编解码（batchexecute 格式） |
| `src/auth.js` | 认证管理（Cookie 提取） |
| `src/oss-helper.js` | Aliyun OSS 辅助函数（JS 版本） |

#### 3.2.2 全页 UI 功能面板

全页 UI 采用侧边栏导航 + 多面板布局，支持拖拽排序导航项：

| 面板 | Tab 标识 | 功能 |
|------|----------|------|
| 📒 笔记本 | `notebooks` | 笔记本文件夹管理，支持目录树、搜索、排序、拖拽排序 |
| 📎 数据源 | `sources` | 数据源查看/添加/下载/删除，支持按类型和范围筛选 |
| 💬 对话 | `chat` | RAG 问答对话窗口 |
| 🎙️ 生成 | `generate` | 内容生成面板（播客/报告/幻灯片/可视化/测验），支持自定义提示词 |
| 📥 制品 | `artifacts` | 制品管理（查看/下载/删除/重命名），支持跨笔记本搜索 |
| 📡 播客发布 | `podcast-publish` | 播客发布流水线（选择音频→选择频道→批量发布） |
| ⚙️ 系统配置 | `podcast` | 嵌入式频道管理页面（OSS 配置 + 频道 CRUD） |
| 🔗 映射 | `mapping` | 数据源与制品的关联映射视图 |
| 📝 提示管理 | `prompts` | 提示词模板 CRUD，支持按类型分类和导入 |

#### 3.2.3 生成类型

| 类型码 | 名称 | 变体（Variant） |
|--------|------|-----------------|
| 1 | 🎙️ 播客 | `deep_dive` / `brief` / `critique` / `debate` |
| 2 | 📝 报告 | `briefing_doc` / `study_guide` / `blog_post` |
| 3 | 🎬 视频 | 默认 |
| 4 | ❓ 测验/闪卡 | `quiz` / `flashcards` |
| 5 | 🧠 思维导图 | 默认 |
| 7 | 🖼️ 信息图 | 默认 |
| 8 | 📊 幻灯片 | `detailed` / `presenter` |
| 9 | 📋 数据表 | 默认 |

---

### 3.3 播客模块（`chrome-extension/podcast/`）

独立的 TypeScript 子项目，使用 Vite 构建，提供播客频道管理和发布能力。

#### 技术栈

- **Language**: TypeScript
- **Build**: Vite
- **Dependencies**: `uuid`（频道 ID 生成）

#### 核心文件

| 文件 | 职责 |
|------|------|
| `src/types.ts` | 类型定义（AliyunConfig / Channel / EpisodeMetadata / PublishState） |
| `src/oss.ts` | Aliyun OSS REST API 操作（上传/测试/列表/删除，V1 HMAC-SHA1 签名） |
| `src/rss.ts` | RSS XML 生成（Apple Podcasts 兼容的 RSS 2.0 骨架） |
| `src/ai-image.ts` | AI 封面图生成（Gemini `gemini-2.0-flash-exp-image-generation` 模型） |
| `src/storage.ts` | Chrome Storage 存取封装 |
| `src/options/` | 频道管理页面（OSS 配置表单 + 频道 CRUD + 内容管理弹窗） |
| `src/content/` | Content Script（页面数据采集） |
| `src/offscreen/` | Offscreen Document（WAV→MP3 转码） |

#### 播客发布流水线

```
选定播客音频
    │
    ▼
① 获取 WAV 音频 URL
    │
    ▼
② 下载 WAV 数据 → 通过 Offscreen Document 转码为 MP3
    │
    ▼
③ 上传 MP3 到 Aliyun OSS（路径: {channelId}/{uuid}.mp3）
    │
    ▼
④ 拉取当前 RSS XML
    │
    ▼
⑤ 插入新 <item> 节点（含标题/描述/enclosure/pubDate/episode编号）
    │
    ▼
⑥ 重新编号所有 <itunes:episode> 标签（按 pubDate 排序）
    │
    ▼
⑦ 上传更新后的 RSS XML 到 OSS
    │
    ▼
⑧ 发布完成 ✅ → RSS URL 可被 Apple Podcasts / Spotify 等订阅
```

---

## 4. 数据流与通信机制

### 4.1 Chrome Extension 消息架构

```
Content Script ←→ Background SW ←→ Full-Page UI / Popup
                         │
                         ├── chrome.runtime.onMessage   (一次性消息)
                         ├── chrome.runtime.onConnect    (长连接 Port)
                         └── IndexedDB                   (大文件中转)
```

**消息类型**：

| 消息类型 | 方向 | 用途 |
|----------|------|------|
| `TRANSCODE_WAV` | Page → Background → Offscreen | WAV 转 MP3 转码请求 |
| `TRANSCODE_RESULT` | Offscreen → Background → Page | 转码结果回传 |
| `PODCAST_PROGRESS` | Background → Page | 发布进度更新 |
| `GET_PODCAST_CONFIG` | Page → Background | 获取 OSS 配置 + 频道列表 |
| `CREATE_PODCAST_CHANNEL` | Page → Background | 创建新频道 |
| `podcast-publish` (Port) | Page ↔ Background | 长连接保活（防止 SW 休眠） |

### 4.2 API 调用方式

扩展通过逆向工程 Google 的 `batchexecute` RPC 协议与 NotebookLM 交互：

- **认证**：从浏览器 Cookie 提取 token（`SID`, `HSID` 等）
- **请求格式**：`batchexecute` 包装的 RPC 请求
- **响应解析**：Anti-XSSI 前缀剥离 + Chunked 响应解析

### 4.3 存储方案

| 存储位置 | 内容 |
|----------|------|
| `chrome.storage.local` | OSS 配置、频道列表、文件夹映射、导航排序、提示词模板 |
| `~/.notebooklm/storage_state.json` | CLI 登录凭证（Playwright 浏览器状态） |
| `~/.nbagent/config.yaml` | CLI Agent 配置（活动笔记本、自定义 Skill 目录） |
| Aliyun OSS | MP3 音频文件、RSS XML 文件、频道封面图片 |

---

## 5. 开发指南

### 5.1 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Python | ≥ 3.10 | CLI Agent（使用了 `match` 语句） |
| Node.js | ≥ 18 | Podcast 模块构建（Vite） |
| Chrome | ≥ 116 | Manifest V3 扩展运行环境 |
| Google 账号 | — | 需已开通 NotebookLM |

### 5.2 本地开发

#### CLI Agent

```bash
# 创建虚拟环境并安装
python3.12 -m venv .venv
source .venv/bin/activate
pip install --no-build-isolation -e "."
playwright install chromium

# 登录
nbagent login

# 验证
nbagent run notebook list
```

#### Chrome Extension

```bash
# 构建 Podcast 模块
cd chrome-extension/podcast
npm install
npm run build

# 加载扩展
# 1. 打开 chrome://extensions
# 2. 开启"开发者模式"
# 3. 点击"加载已解压的扩展程序"
# 4. 选择 chrome-extension/ 目录
```

#### Podcast 模块开发模式

```bash
cd chrome-extension/podcast
npm run dev     # Vite 开发模式（热更新）
npm run build   # 生产构建
```

### 5.3 自定义 Skill 开发

在 `custom_skills/` 目录下创建 Python 文件即可自动加载：

```python
from nbagent.skills.base import ActionInfo, BaseSkill

class MySkill(BaseSkill):
    name = "my-skill"
    description = "我的自定义 Skill"
    _actions = {
        "do-something": ActionInfo("do-something", "执行操作", {"param": "参数说明"}),
    }

    async def execute(self, action, **kwargs):
        match action:
            case "do-something":
                notebooks = await self.client.notebooks.list()
                return {"count": len(notebooks)}
```

---

## 6. 项目结构一览

```
NotebookLM/
├── pyproject.toml                    # Python 项目配置 & CLI 入口
├── README.md                         # 项目 README
├── nbagent/                          # CLI Agent (Python)
│   ├── __init__.py
│   ├── __main__.py
│   ├── cli.py                        # Click CLI 入口
│   ├── agent.py                      # Agent 核心调度器
│   ├── config.py                     # 配置管理
│   └── skills/                       # Skill 模块
│       ├── __init__.py               # 内置 Skill 注册
│       ├── base.py                   # Skill 抽象基类
│       ├── notebook.py               # 笔记本管理
│       ├── source.py                 # 数据源管理
│       ├── chat.py                   # RAG 对话
│       ├── generate.py               # 内容生成
│       ├── research.py               # 自动研究
│       └── download.py               # 制品下载
├── custom_skills/                    # 自定义 Skill (自动加载)
│   └── example_skill.py
├── chrome-extension/                 # Chrome Extension (MV3)
│   ├── manifest.json                 # 扩展清单
│   ├── page.html / page.js / page.css  # 全页 UI
│   ├── popup.html / popup.js / popup.css  # 弹出窗口 UI
│   ├── icons/                        # 扩展图标
│   ├── src/                          # 扩展核心源码
│   │   ├── background.js             # Service Worker
│   │   ├── api.js                    # NotebookLM API 封装
│   │   ├── rpc.js                    # RPC 协议编解码
│   │   ├── auth.js                   # 认证管理
│   │   └── oss-helper.js             # OSS 辅助函数
│   └── podcast/                      # 播客子模块 (TypeScript/Vite)
│       ├── package.json
│       ├── vite.config.ts
│       ├── tsconfig.json
│       └── src/
│           ├── types.ts              # 类型定义
│           ├── oss.ts                # Aliyun OSS 操作
│           ├── rss.ts                # RSS 生成
│           ├── ai-image.ts           # AI 封面生成
│           ├── storage.ts            # Chrome Storage 封装
│           ├── options/              # 频道管理页面
│           ├── content/              # Content Script
│           ├── offscreen/            # Offscreen Document (转码)
│           └── popup/                # Popup 入口
└── docs/                             # 文档
    ├── PROJECT.md                    # 本文件 — 项目说明文档
    └── USER_MANUAL.md                # 用户使用手册
```

---

## 7. 注意事项

> [!WARNING]
> 底层使用**未公开的 Google API**（逆向工程的 `batchexecute` RPC），可能随 Google 更新而失效。

> [!CAUTION]
> 适合个人使用和原型开发，**不建议用于生产环境**。

| 关注点 | 说明 |
|--------|------|
| API 稳定性 | Google 可能随时更改未公开 API 的格式或行为 |
| 认证有效期 | Cookie/Token 会过期，需重新登录 |
| OSS 安全 | AccessKey 存储在 `chrome.storage.local`，注意安全风险 |
| 并发限制 | 批量操作应控制并发数，避免触发 Google 速率限制 |
