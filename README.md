# 🤖 NotebookLM Agent

> 可扩展 Skill 的命令行 Agent — 无需打开网页，直接在终端操作 NotebookLM

基于 [`notebooklm-py`](https://github.com/teng-lin/notebooklm-py) 非官方 SDK，通过可插拔的 **Skill 系统** 封装所有 NotebookLM 功能。

---

## 📋 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| **Python** | ≥ 3.10 | 使用了 `match` 语句（macOS 自带 3.9 不够） |
| **pip** | ≥ 22.0 | 需要支持 pyproject.toml 构建 |
| **Google 账号** | — | 需要已开通 NotebookLM 的 Google 账号 |
| **Homebrew**（macOS） | — | 用于安装 Python（如系统版本不够） |

---

## 🚀 新用户快速配置（3 步上手）

### 第 1 步：安装 Python 3.10+

如果你的 Python 版本低于 3.10，需要先升级：

```bash
# 检查当前版本
python3 --version

# macOS 用户：通过 Homebrew 安装
brew install python@3.12

# 验证安装
/opt/homebrew/bin/python3.12 --version
```

> 💡 也可以使用 [pyenv](https://github.com/pyenv/pyenv) 管理多版本 Python。

### 第 2 步：创建虚拟环境并安装

```bash
# 进入项目目录
cd /path/to/NotebookLM

# 创建虚拟环境
/opt/homebrew/bin/python3.12 -m venv .venv

# 激活虚拟环境
source .venv/bin/activate

# 升级构建工具
pip install --upgrade pip setuptools wheel hatchling editables

# 安装 nbagent（开发模式）
pip install --no-build-isolation -e "."

# 安装浏览器引擎（登录时需要）
playwright install chromium
```

### 第 3 步：登录 Google 账号

```bash
# 激活虚拟环境（如果还没有）
source .venv/bin/activate

# 首次登录（会打开浏览器窗口）
nbagent login
```

浏览器会自动打开，流程如下：
1. 在浏览器中完成 Google 账号登录
2. **等到看到 NotebookLM 主页**（显示笔记本列表）
3. 回到终端按 **Enter** 键确认

> ⚠️ 确保浏览器已完全加载到 `notebooklm.google.com` 主页面再按 Enter，否则 cookie 可能不完整。

登录成功后，认证信息保存在 `~/.notebooklm/storage_state.json`，后续所有操作**不再需要浏览器**。

### 验证安装

```bash
# 列出笔记本
nbagent run notebook list

# 查看所有 Skill
nbagent skills
```

---

## ✨ 功能

| Skill | 功能 |
|-------|------|
| **notebook** | 笔记本管理 — 创建 / 列出 / 删除 / 重命名 / 摘要 |
| **source** | 数据源管理 — 添加 URL / 文件 / YouTube / 文本 / 刷新 |
| **chat** | RAG 对话 — 基于数据源问答 + 引用来源 |
| **generate** | 内容生成 — 播客 / 视频 / Quiz / 闪卡 / 报告 / 幻灯片 / 思维导图 |
| **research** | 自动研究 — Web / Drive 搜索 + 自动导入数据源 |
| **download** | 制品下载 — MP3 / MP4 / PDF / JSON / CSV / Markdown |

**🔌 自定义 Skill**：支持从任意目录加载，使用 `--skills-dir` 参数或配置 `custom_skills_dir`。

---

## � 使用示例

```bash
# 每次使用前先激活虚拟环境
source .venv/bin/activate

# ═══════════════════════════════════════
# 笔记本管理
# ═══════════════════════════════════════
nbagent run notebook list                          # 列出所有笔记本
nbagent run notebook create "My Research"          # 创建新笔记本
nbagent use <notebook_id>                          # 设置当前活动笔记本

# ═══════════════════════════════════════
# 数据源管理（需要先 use 一个笔记本）
# ═══════════════════════════════════════
nbagent run source add-url "https://example.com"   # 添加网页
nbagent run source add-file "./paper.pdf"          # 添加本地文件
nbagent run source add-youtube "https://youtube.com/watch?v=..."
nbagent run source list                            # 列出数据源

# ═══════════════════════════════════════
# 对话问答
# ═══════════════════════════════════════
nbagent ask "这篇文章的核心观点是什么？"            # 快捷提问
nbagent run chat ask "详细解释第三章"               # 完整命令

# ═══════════════════════════════════════
# 内容生成
# ═══════════════════════════════════════
nbagent run generate audio                         # 生成播客
nbagent run generate quiz                          # 生成测验
nbagent run generate mind-map                      # 生成思维导图

# ═══════════════════════════════════════
# 下载制品
# ═══════════════════════════════════════
nbagent run download audio ./podcast.mp3
nbagent run download quiz ./quiz.json

# ═══════════════════════════════════════
# 自动研究
# ═══════════════════════════════════════
nbagent run research run "AI agents latest"        # 一键搜索+导入

# ═══════════════════════════════════════
# 从外部目录加载自定义 Skill
# ═══════════════════════════════════════
nbagent --skills-dir /path/to/my/skills run my-skill do-something

# ═══════════════════════════════════════
# 配置管理
# ═══════════════════════════════════════
nbagent config show
nbagent config set custom_skills_dir /path/to/skills
```

### 交互式 REPL

```bash
nbagent interactive

# 在 REPL 中：
# nbagent> notebook list
# nbagent> ask 这是什么？
# nbagent> skills
# nbagent> help source
# nbagent> quit
```

---

## 🔌 编写自定义 Skill

在 `custom_skills/` 目录（或任意 `--skills-dir` 指定目录）中创建 Python 文件：

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
                # 使用 self.client 访问 NotebookLM API
                notebooks = await self.client.notebooks.list()
                return {"count": len(notebooks)}
```

Agent 启动时会自动发现并加载。Skill 搜索目录优先级：
1. 配置文件中的 `custom_skills_dir`
2. 项目根目录的 `custom_skills/`
3. CLI `--skills-dir` 参数

---

## 📂 项目结构

```
NotebookLM/
├── pyproject.toml           # 依赖 & CLI 入口
├── nbagent/
│   ├── cli.py               # Click CLI + Rich 输出
│   ├── agent.py             # Agent 核心 (Skill 注册/调度)
│   ├── config.py            # ~/.nbagent/config.yaml
│   └── skills/
│       ├── base.py          # Skill 抽象基类
│       ├── notebook.py      # 笔记本管理
│       ├── source.py        # 数据源管理
│       ├── chat.py          # RAG 对话
│       ├── generate.py      # 内容生成
│       ├── research.py      # 自动研究
│       └── download.py      # 制品下载
└── custom_skills/           # 自定义 Skill（自动加载）
    └── example_skill.py
```

## ⚠️ 注意事项

- 底层使用 **未公开的 Google API**，可能随时变化
- 适合个人使用和原型开发，不建议用于生产环境
- 登录 token 保存在 `~/.notebooklm/storage_state.json`
- Agent 配置保存在 `~/.nbagent/config.yaml`

## License

MIT
