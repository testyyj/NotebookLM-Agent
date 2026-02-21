# NotebookLM Agent — 用户使用手册

> **适用版本**：v0.4.0  
> **更新日期**：2026-02-21

---

## 目录

1. [快速入门](#1-快速入门)
2. [Chrome 扩展使用指南](#2-chrome-扩展使用指南)
3. [命令行 Agent 使用指南](#3-命令行-agent-使用指南)
4. [播客发布指南](#4-播客发布指南)
5. [常见问题](#5-常见问题)

---

## 1. 快速入门

### 1.1 环境要求

| 组件 | 需求 |
|------|------|
| Chrome 浏览器 | ≥ 116（推荐最新版） |
| Google 账号 | 已开通 NotebookLM 访问权限 |
| Python（可选） | ≥ 3.10（仅 CLI Agent 需要） |
| 阿里云 OSS（可选） | 仅播客发布功能需要 |

### 1.2 安装 Chrome 扩展

1. 下载或克隆项目代码
2. 构建 Podcast 模块（首次安装需要）：
   ```bash
   cd chrome-extension/podcast
   npm install
   npm run build
   ```
3. 打开 Chrome，进入 `chrome://extensions`
4. 打开右上角 **"开发者模式"**
5. 点击 **"加载已解压的扩展程序"**
6. 选择项目中的 `chrome-extension/` 目录
7. 扩展安装成功，工具栏出现 🤖 图标

### 1.3 首次登录

1. 先在 Chrome 中访问 [notebooklm.google.com](https://notebooklm.google.com) 并完成 Google 账号登录
2. 点击工具栏的 🤖 图标，即可打开全页管理界面
3. 如果看到 **"⚠️ 请先登录"** 提示，请刷新 NotebookLM 页面后再试

---

## 2. Chrome 扩展使用指南

点击工具栏 🤖 图标将打开全页管理界面，左侧为导航栏，右侧为功能面板。

> 💡 **提示**：导航项可通过拖拽重新排列顺序，排列会自动保存。

### 2.1 📒 笔记本管理

**功能**：查看、创建、重命名、删除笔记本，以及文件夹组织。

| 操作 | 说明 |
|------|------|
| **搜索** | 在搜索框输入关键词，实时筛选笔记本 |
| **排序** | 支持按标题或创建时间排序 |
| **新建笔记本** | 点击 **"+ 新建笔记本"** 按钮 |
| **新建目录** | 在文本框输入目录路径（如 `AI/研究`），点击 **"+ 新建目录"** |
| **分配目录** | 在笔记本卡片上选择文件夹 |
| **选择当前笔记本** | 点击笔记本卡片，或使用底部的笔记本选择器 |

**笔记本选择器**（侧边栏底部）：
- 点击底部 **"当前笔记本"** 按钮
- 弹出搜索面板，支持按目录展开/折叠
- 选择后，所有面板将切换到该笔记本的数据

### 2.2 📎 数据源管理

**功能**：查看、添加、下载、删除数据源。

| 操作 | 说明 |
|------|------|
| **添加数据源** | 在 URL 输入框中输入网址，点击 **"➕ 添加"** |
| **范围切换** | 下拉选择 **"当前笔记本"** 或 **"所有笔记本"** |
| **类型筛选** | 按类型筛选（PDF / 网页 / YouTube / 图片等） |
| **搜索** | 输入关键词搜索数据源 |
| **批量下载** | 勾选数据源后点击 **"⬇️ 下载"** 按钮 |
| **批量删除** | 勾选数据源后点击 **"🗑 删除"** 按钮 |

**支持的数据源类型**：
- Google Docs / Slides
- PDF / Word / CSV
- 网页 URL
- YouTube 视频
- Markdown
- 粘贴文本
- 图片

### 2.3 💬 对话（RAG 问答）

**功能**：基于数据源的 RAG 问答对话。

1. 确保已选择笔记本且笔记本中有数据源
2. 在输入框中输入问题
3. 按 **Enter** 或点击 **"发送"** 按钮
4. AI 将基于笔记本数据源回答问题

### 2.4 🎙️ 生成制品

**功能**：一键生成多种类型的 AI 内容。

#### 可生成的内容类型

| 类别 | 类型 | 说明 |
|------|------|------|
| 🎙️ 播客 | 深入探究 / 摘要 / 评论 / 辩论 | AI 双人对话音频 |
| 📝 报告 | 摘要报告 / 学习指南 / 博客文章 | 文本报告 |
| 📊 幻灯片 | 详细演示文稿 / 演示用幻灯片 | 演示文档 |
| 🧩 可视化 | 思维导图 / 信息图 / 数据表 / 视频 | 可视化内容 |
| ❓ 测验 | 测验 / 闪卡 | 互动学习 |

#### 使用步骤

1. 确保已选择笔记本
2. 选择输出语言（中文 / English / 日本語 / 한국어）
3. 点击要生成的内容卡片
4. **自定义提示词**（可选）：点击卡片上的 ✏️ 按钮，输入自定义指令
5. 等待生成完成

#### 按来源批量生成

点击 **"按来源一键生成"** 区域的卡片，可为每个数据源单独生成播客音频。适合将多个独立文档分别生成对应的播客节目。

#### 提示词模板导入

在自定义提示词弹窗中，点击 **"📥 导入模板"** 可快速使用预设的提示词模板。

### 2.5 📥 制品管理

**功能**：管理已生成的所有制品。

| 操作 | 说明 |
|------|------|
| **查看** | 展示制品列表（名称、类型、状态、创建时间） |
| **搜索** | 按名称搜索制品 |
| **类型筛选** | 按类型筛选（播客 / 报告 / 幻灯片等） |
| **范围** | 支持查看当前笔记本或所有笔记本的制品 |
| **下载** | 勾选后批量下载 |
| **删除** | 勾选后批量删除 |
| **重命名** | 双击制品名称即可重命名 |

### 2.6 🔗 数据源与制品映射

**功能**：查看数据源与其对应生成制品的关联关系。

- 展示每个数据源生成了哪些制品
- 统计面板显示：数据源总数、制品总数、已完成数、生成中数
- 支持 **"批量播客重命名"**——将播客制品名称与数据源标题对齐

### 2.7 📝 提示词管理

**功能**：创建和管理可复用的提示词模板。

| 操作 | 说明 |
|------|------|
| **新建模板** | 点击 **"+ 新建模板"**，填写名称、类型和内容 |
| **类型分类** | 支持按类型筛选（播客 / 报告 / 幻灯片 / 视频 / 通用） |
| **使用模板** | 在生成制品时，通过 ✏️ 按钮中的 **"📥 导入模板"** 使用 |
| **编辑/删除** | 在模板列表中直接操作 |

---

## 3. 命令行 Agent 使用指南

### 3.1 安装

```bash
# 1. 安装 Python 3.10+
brew install python@3.12

# 2. 创建虚拟环境
cd /path/to/NotebookLM
python3.12 -m venv .venv
source .venv/bin/activate

# 3. 安装依赖
pip install --upgrade pip setuptools wheel hatchling editables
pip install --no-build-isolation -e "."
playwright install chromium
```

### 3.2 登录

```bash
source .venv/bin/activate
nbagent login
```

浏览器自动打开 → 完成 Google 登录 → 等到 NotebookLM 主页加载完成 → 回终端按 **Enter**

> ⚠️ 确保看到 NotebookLM 主页（笔记本列表）再按 Enter，否则 Cookie 可能不完整。

### 3.3 常用命令速查

#### 笔记本管理
```bash
nbagent run notebook list                    # 列出所有笔记本
nbagent run notebook create "My Research"    # 创建新笔记本
nbagent use <notebook_id>                    # 设置活动笔记本
```

#### 数据源管理
```bash
nbagent run source add-url "https://..."     # 添加网页
nbagent run source add-file "./paper.pdf"    # 添加本地文件
nbagent run source add-youtube "https://youtube.com/watch?v=..."
nbagent run source list                      # 列出数据源
```

#### RAG 问答
```bash
nbagent ask "这篇文章的核心观点是什么？"      # 快捷提问
nbagent run chat ask "详细解释第三章"          # 完整命令
```

#### 内容生成
```bash
nbagent run generate audio                   # 生成播客
nbagent run generate quiz                    # 生成测验
nbagent run generate mind-map               # 生成思维导图
```

#### 制品下载
```bash
nbagent run download audio ./podcast.mp3     # 下载播客
nbagent run download quiz ./quiz.json        # 下载测验
```

#### 自动研究
```bash
nbagent run research run "AI agents latest"  # 一键搜索+导入
```

#### 配置管理
```bash
nbagent config show                          # 查看配置
nbagent config set custom_skills_dir /path   # 设置自定义 Skill 目录
```

### 3.4 交互式 REPL 模式

```bash
nbagent interactive
```

进入 REPL 后：
```
nbagent> notebook list
nbagent> ask 这是什么？
nbagent> skills
nbagent> help source
nbagent> quit
```

### 3.5 查看帮助

```bash
nbagent --help                # 查看全局帮助
nbagent run --help            # 查看 run 命令帮助
nbagent skills                # 列出所有 Skill 及其 Action
```

---

## 4. 播客发布指南

### 4.1 前置准备

播客发布需要以下资源：

| 资源 | 用途 | 获取方式 |
|------|------|----------|
| **阿里云 OSS** | 存储 MP3 和 RSS 文件 | [阿里云控制台](https://oss.console.aliyun.com/) |
| **CDN 域名** | 对外提供 RSS 订阅链接 | 绑定到 OSS Bucket |
| **Gemini API Key**（可选） | AI 自动生成频道封面 | [Google AI Studio](https://ai.google.dev/) |

### 4.2 配置 OSS

进入 **⚙️ 系统配置** 面板（或扩展选项页）：

1. 填写 OSS 配置：
   - **Region**：如 `oss-cn-shanghai`
   - **Bucket**：如 `my-podcast-bucket`
   - **AccessKey ID** / **AccessKey Secret**
   - **CDN 域名**：如 `https://podcast.example.com`
   - **Gemini API Key**（可选）
2. 点击 **"🔍 测试连接"** 验证配置正确
3. 点击 **"💾 保存配置"**

### 4.3 创建播客频道

1. 在频道管理中点击 **"+ 新建频道"**
2. 填写频道信息：
   - **频道名称**（必填）
   - **频道简介**
   - **作者**
   - **语言**（默认 zh-cn）
   - **iTunes 分类**（默认 Education）
   - **封面图片**（可上传 JPG/PNG，或由 AI 自动生成）
3. 点击 **"创建并初始化"**
4. 系统将自动：
   - 上传封面图片到 OSS
   - 创建初始 RSS XML 文件
   - 生成唯一 Feed URL

### 4.4 发布播客

1. 进入 **📡 播客发布** 面板
2. **左栏**：勾选要发布的播客音频（支持批量选择）
   - 可点击 **"🏷️ 批量重命名"** 调整标题
3. **右栏**：选择目标频道
   - 支持直接新建频道和管理频道内容
4. 点击 **"🚀 发布选择的播客"**
5. 观察进度条：
   - 转码（WAV → MP3）
   - 上传 MP3
   - 更新 RSS
6. 发布完成后 ✅

### 4.5 频道管理操作

在频道卡片上有四个操作按钮：

| 按钮 | 功能 |
|------|------|
| **管理内容** | 查看频道内所有文件（MP3/XML），支持删除/扫描重复 |
| **复制 RSS** | 复制 RSS Feed URL，粘贴到 Apple Podcasts 等平台 |
| **编辑** | 修改频道信息和封面 |
| **删除** | 删除频道（OSS 文件不会被删除） |

### 4.6 高级频道操作

在频道内容管理弹窗中，点击 **"⚙️ 高级"** 可执行：

| 操作 | 说明 |
|------|------|
| 🔍 扫描重复 | 检测重复的 MP3 文件 |
| 🔄 同步标题 | 将 RSS 中的标题与 MP3 文件名同步 |
| 🔧 修复连播 | 修复 Apple Podcasts 连续播放所需的标签 |
| 📥 批量补充 RSS | 将 OSS 中有但 RSS 中缺失的 MP3 补充到 Feed |
| 🗑️ 一键删除重复 | 删除检测到的重复文件 |

### 4.7 订阅你的播客

发布成功后，复制频道的 RSS URL，在以下平台添加订阅：

- **Apple Podcasts**：Podcasts > 资料库 > 添加节目的 URL
- **Spotify for Podcasters**：导入 RSS Feed
- **Google Podcasts**：添加 RSS Feed URL
- **小宇宙**（泛用型播客客户端）：添加 RSS 地址

---

## 5. 常见问题

### Q: 打开扩展显示 "请先登录"？

**A**: 先在 Chrome 中打开 [notebooklm.google.com](https://notebooklm.google.com) 并确保已登录 Google 账号，然后刷新扩展页面。

### Q: CLI 提示 "认证失败"？

**A**:
1. 删除旧的凭证文件：`rm ~/.notebooklm/storage_state.json`
2. 重新登录：`nbagent login`
3. 确保在浏览器完全载入 NotebookLM 主页后再按 Enter

### Q: 播客发布失败？

**A**: 检查以下几点：
1. OSS 配置是否正确（点击 "测试连接" 验证）
2. AccessKey 权限是否包含 OSS 读写
3. CDN 域名是否正确绑定到 Bucket
4. 浏览器控制台（F12）查看详细错误信息

### Q: 生成制品时长时间无响应？

**A**:
- 播客音频生成通常需要 2-5 分钟
- 视频生成可能需要更长时间
- 如果超过 10 分钟无进展，请刷新页面并检查 NotebookLM 原始页面上的生成状态

### Q: 如何更新扩展？

**A**:
1. 拉取最新代码：`git pull`
2. 重新构建 Podcast 模块：`cd chrome-extension/podcast && npm run build`
3. 在 `chrome://extensions` 点击扩展卡片上的 **"刷新"** 按钮

### Q: 笔记本列表为空？

**A**:
- 确保 Google 账号已开通 NotebookLM
- 检查是否在正确的 Google 账号下
- 刷新页面重试

### Q: AI 封面生成失败？

**A**:
- 确保已在 OSS 配置中填写了有效的 Gemini API Key
- 检查 API Key 是否有 `gemini-2.0-flash-exp-image-generation` 模型的访问权限
- 可手动上传封面图片替代 AI 生成

---

> 📩 如有其他问题，请在项目 Issues 中提交反馈。
