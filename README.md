# 🤖 NotebookLM Agent

> 操作 NotebookLM 的终极全能工具包 — 包含 **[Chrome 浏览器扩展](#1-chrome-浏览器扩展-推荐)** 与 **[Python 命令行工具 (nbagent)](#2-python-命令行工具-nbagent)**。

本项目提供了两种方式来灵活操作和扩展 Google NotebookLM 的功能，提升你的生产力：
1. **[Chrome 浏览器扩展](#1-chrome-浏览器扩展-推荐)**：直接在浏览器中侧边栏管理笔记本、数据源、对话，并支持一键生成播客、发布 RSS 和频道管理。
2. **[Python 命令行工具 (nbagent)](#2-python-命令行工具-nbagent)**：基于非官方 SDK 的自动化脚本，支持通过命令行与 NotebookLM 交互，以及自定义 Skill 系统。

---

## 1. Chrome 浏览器扩展 (推荐)

这是一个强大的 Chrome 扩展程序，可在浏览器中直接管理你的 NotebookLM 数据，无需来回切换页面。版本：`v0.4.0`

### ✨ 核心功能
*   **笔记本与数据源操作**：直接在侧边栏创建新笔记本，添加网页、文件、YouTube 链接等作为数据源。
*   **RAG 问答与对话**：内置独立聊天窗口，快捷向当前笔记本提问。
*   **播客生成与发布系统**：
    *   **一键生成播客**：基于你的数据源自动生成并下载相关音频（Deep Dive / Podcast）。
    *   **频道管理与 RSS 发布**：自动将生成的播客整理成专辑，支持自定义频道封面、管理剧集列表，并生成兼容 Apple Podcasts 的标准序列化 RSS Feed 以供直接订阅！
*   **制品管理 (Artifacts)**：方便地查看和管理所有生成的内容及关联数据源。

### 📦 安装方法 (开发者模式)

1. 下载或克隆本项目：
   ```bash
   git clone https://github.com/your-username/NotebookLM-Agent.git
   ```
2. 打开 Chrome 浏览器，访问 `chrome://extensions/`。
3. 开启右上角的 **开发者模式** (Developer mode)。
4. 点击 **加载已解压的扩展程序** (Load unpacked)。
5. 在弹出的文件选择窗口中，选择项目内的 `chrome-extension` 文件夹（**必选选到此层级**）。
6. 安装成功！扩展图标将出现在浏览器右上角，点击即可使用。

---

## 2. Python 命令行工具 (nbagent)

基于 [`notebooklm-py`](https://github.com/teng-lin/notebooklm-py) 封装的 CLI Agent，旨在为无需打开网页的终端死忠粉提供自动化能力。

### 📋 环境要求
*   **Python** ≥ 3.10
*   已开通 NotebookLM 的 **Google 账号**

### 🚀 快速上手

#### 安装

```bash
cd nbagent所在的目录  # /path/to/NotebookLM

# 推荐使用虚拟环境
python3 -m venv .venv
source .venv/bin/activate

# 安装 nbagent 与依赖
pip install --upgrade pip setuptools wheel hatchling editables
pip install --no-build-isolation -e "."
playwright install chromium
```

#### 登录认证
首次使用需通过浏览器登录 Google 账号以获取授权信息：
```bash
nbagent login
# 流程：浏览器自动打开主页 -> 登录你的 Google 账号 -> 等待 NotebookLM 页面加载完成 -> 返回终端按 Enter 确认。
# 之后的操作将不再需要打开浏览器！
```

### ✨ 命令使用示例

**交互式 REPL：**
```bash
nbagent interactive
```

**命令行直调：**
```bash
# 笔记本管理
nbagent run notebook list
nbagent run notebook create "My Research"

# 数据源管理
nbagent run source add-url "https://example.com"
nbagent run source add-file "./paper.pdf"

# 内容生成与下载
nbagent run generate audio
nbagent run download audio ./podcast.mp3

# 自动研究
nbagent run research run "AI agents latest"
```

### 🔌 扩展自定义 Skill
你可以编写自己的 Python Skill，并在运行时通过 `--skills-dir` 或配置文件 `custom_skills_dir` 挂载：
```bash
nbagent --skills-dir /path/to/my/skills run my-skill do-something
```
有关自行编写 Skill 的详细示例，请参考 `custom_skills/example_skill.py`（如果有）以及 `nbagent/skills/base.py`。

---

## 📂 项目结构

```
NotebookLM/
├── chrome-extension/        # Chrome 浏览器扩展核心代码（包含可视化UI、播客与频道管理）
│   ├── manifest.json
│   ├── page.html / page.js  # 扩展主页面
│   ├── popup.html           # 扩展弹窗页面
│   └── podcast/             # 播客面板与相关生成逻辑
├── pyproject.toml           # Python CLI 的项目配置
├── nbagent/                 # Python 命令行工具源码
│   ├── cli.py               # Click 入口
│   └── skills/              # 内置命令行技能 (notebook, source, generate 等)
└── custom_skills/           # （可选）用户放置的 Python 自定义技能目录
```

## ⚠️ 注意事项

* 本项目使用的接口大多为非公开的 Google API，若 NotebookLM 服务发生变更，部分功能可能失效。
* 请勿在生产环境中高频次、大批量请求，以免触发 Google 账号的安全策略拦截。

## License

MIT
