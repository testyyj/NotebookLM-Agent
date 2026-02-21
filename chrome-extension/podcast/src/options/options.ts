/**
 * Options page entry point.
 * Handles: Aliyun OSS config form, Channel CRUD, and cold-start initialization.
 */
import "./options.css";
import { v4 as uuidv4 } from "uuid";
import { AliyunConfig, Channel } from "../types";
import { loadAliyunConfig, saveAliyunConfig, loadChannels, saveChannels } from "../storage";
import { uploadToOss, testOssConnection, listOssObjects, deleteOssObject, OssObject } from "../oss";
import { buildSkeletonRss } from "../rss";
import { generateCoverImage } from "../ai-image";

// ── DOM references ──
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const formAliyun = $<HTMLFormElement>("#form-aliyun");
const ossRegion = $<HTMLInputElement>("#oss-region");
const ossBucket = $<HTMLInputElement>("#oss-bucket");
const ossAkId = $<HTMLInputElement>("#oss-ak-id");
const ossAkSecret = $<HTMLInputElement>("#oss-ak-secret");
const ossCdn = $<HTMLInputElement>("#oss-cdn");
const geminiApiKeyInput = $<HTMLInputElement>("#gemini-api-key");
const ossStatus = $<HTMLDivElement>("#oss-status");
const btnTestOss = $<HTMLButtonElement>("#btn-test-oss");

const channelList = $<HTMLDivElement>("#channel-list");
const btnNewChannel = $<HTMLButtonElement>("#btn-new-channel");

const channelDialog = $<HTMLDialogElement>("#channel-dialog");
const formChannel = $<HTMLFormElement>("#form-channel");
const dialogTitle = $<HTMLHeadingElement>("#dialog-title");
const dialogSubmitText = $<HTMLSpanElement>("#dialog-submit-text");
const dialogStatus = $<HTMLDivElement>("#dialog-status");
const btnCancelDialog = $<HTMLButtonElement>("#btn-cancel-dialog");

const chId = $<HTMLInputElement>("#ch-id");
const chTitle = $<HTMLInputElement>("#ch-title");
const chDesc = $<HTMLTextAreaElement>("#ch-desc");
const chAuthor = $<HTMLInputElement>("#ch-author");
const chLang = $<HTMLInputElement>("#ch-lang");
const chCategory = $<HTMLInputElement>("#ch-category");
const chCover = $<HTMLInputElement>("#ch-cover");
const chCoverPreview = $<HTMLDivElement>("#ch-cover-preview");
const chCoverPreviewImg = $<HTMLImageElement>("#ch-cover-preview-img");
const chCoverRegen = $<HTMLInputElement>("#ch-cover-regen");
const chCoverRegenLabel = $<HTMLElement>("#ch-cover-regen-label");

// ── State ──
let aliyunConfig: AliyunConfig | null = null;
let channels: Channel[] = [];

// ── Compact Mode ──
const isCompact = new URLSearchParams(window.location.search).get("mode") === "compact";
if (isCompact) {
    document.body.classList.add("compact-mode");
    const header = document.getElementById("page-header");
    const aliyunSection = document.getElementById("aliyun-config-section");
    const mainContainer = document.getElementById("main-container");
    if (header) header.style.display = "none";
    if (aliyunSection) aliyunSection.style.display = "none";
    if (mainContainer) {
        mainContainer.classList.remove("py-10", "px-6");
        mainContainer.classList.add("py-2", "px-2");
    }
}

// ═══════════════════════════════════════
// Aliyun Config
// ═══════════════════════════════════════

/** Show a status message near the Aliyun form */
function showOssStatus(msg: string, type: "success" | "error" | "info") {
    ossStatus.textContent = msg;
    ossStatus.className = `status-msg ${type}`;
    ossStatus.classList.remove("hidden");
}

/** Collect config from form inputs */
function collectConfig(): AliyunConfig {
    return {
        region: ossRegion.value.trim(),
        bucket: ossBucket.value.trim(),
        accessKeyId: ossAkId.value.trim(),
        accessKeySecret: ossAkSecret.value.trim(),
        cdnDomain: ossCdn.value.trim().replace(/\/+$/, ""),
        geminiApiKey: geminiApiKeyInput.value.trim() || undefined,
    };
}

/** Populate form from loaded config */
function populateConfig(cfg: AliyunConfig) {
    ossRegion.value = cfg.region;
    ossBucket.value = cfg.bucket;
    ossAkId.value = cfg.accessKeyId;
    ossAkSecret.value = cfg.accessKeySecret;
    ossCdn.value = cfg.cdnDomain;
    geminiApiKeyInput.value = cfg.geminiApiKey || "";
}

// Save config
formAliyun.addEventListener("submit", async (e) => {
    e.preventDefault();
    aliyunConfig = collectConfig();
    await saveAliyunConfig(aliyunConfig);
    showOssStatus("✅ 配置已保存", "success");
});

// Test connection
btnTestOss.addEventListener("click", async () => {
    const cfg = collectConfig();
    showOssStatus("🔄 正在测试连接...", "info");
    try {
        await testOssConnection(cfg);
        showOssStatus("✅ 连接成功！Bucket 可访问", "success");
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showOssStatus(`❌ ${msg}`, "error");
    }
});

// ═══════════════════════════════════════
// Channel List
// ═══════════════════════════════════════

/** Render all channels into the list */
function renderChannels() {
    if (!channels.length) {
        channelList.innerHTML = `<div class="text-zinc-600 text-sm text-center py-8">暂无频道，点击"新建频道"开始</div>`;
        return;
    }

    channelList.innerHTML = channels
        .map(
            (ch) => `
    <div class="channel-card" data-id="${ch.id}">
      <img class="channel-cover" src="${ch.coverUrl || ""}" alt="">
      <div class="channel-info">
        <div class="channel-name">${escHtml(ch.title)}</div>
        <div class="channel-meta">
          <span>${escHtml(ch.author)}</span>
          <span>${escHtml(ch.category)}</span>
          <code>${ch.xmlPath}</code>
        </div>
        <div class="channel-tip">💡 添加首个播客后，可在播客客户端中订阅此 RSS</div>
      </div>
      <div class="channel-actions">
        <button class="btn btn-ghost btn-sm" data-action="manage" data-id="${ch.id}" title="管理内容">📁</button>
        <button class="btn btn-ghost btn-sm" data-action="copy-rss" data-id="${ch.id}" title="复制 RSS 链接">📋</button>
        <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${ch.id}" title="编辑">✏️</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${ch.id}" title="删除">🗑️</button>
      </div>
    </div>
  `
        )
        .join("");

    // Hide broken cover images (programmatic handler to comply with MV3 CSP)
    channelList.querySelectorAll<HTMLImageElement>(".channel-cover").forEach((img) => {
        img.addEventListener("error", () => { img.style.display = "none"; });
    });
}

/** Handle clicks on channel action buttons */
channelList.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id!;

    if (action === "copy-rss") {
        const ch = channels.find((c) => c.id === id);
        if (!ch || !aliyunConfig) return;
        const rssUrl = `${aliyunConfig.cdnDomain}/${ch.xmlPath}`;
        try {
            await navigator.clipboard.writeText(rssUrl);
            btn.textContent = "✅";
            setTimeout(() => { btn.textContent = "📋"; }, 2000);
        } catch {
            // Fallback: prompt with the URL
            prompt("RSS 链接:", rssUrl);
        }
    } else if (action === "manage") {
        const ch = channels.find((c) => c.id === id);
        if (!ch) return;
        openContentDialog(ch);
    } else if (action === "edit") {
        const ch = channels.find((c) => c.id === id);
        if (!ch) return;
        openEditDialog(ch);
    } else if (action === "delete") {
        const ch = channels.find((c) => c.id === id);
        if (!ch || !confirm(`确定要删除频道「${ch.title}」吗？\n（OSS 上的文件不会被删除）`)) return;
        channels = channels.filter((c) => c.id !== id);
        await saveChannels(channels);
        renderChannels();
    }
});

// ═══════════════════════════════════════
// Channel Dialog (Create / Edit)
// ═══════════════════════════════════════

/** Open dialog for new channel */
btnNewChannel.addEventListener("click", () => {
    if (!aliyunConfig) {
        showOssStatus("⚠️ 请先保存 OSS 配置", "error");
        return;
    }
    dialogTitle.textContent = "新建频道";
    dialogSubmitText.textContent = "创建并初始化";
    formChannel.reset();
    chId.value = "";
    chAuthor.value = "NotebookLM Agent";
    chLang.value = "zh-cn";
    chCategory.value = "Education";
    // Hide cover preview for new channel
    chCoverPreview.classList.add("hidden");
    chCoverRegenLabel.classList.add("hidden");
    chCoverRegen.checked = false;
    dialogStatus.classList.add("hidden");
    channelDialog.showModal();
});

/** Open dialog for editing existing channel */
function openEditDialog(ch: Channel) {
    dialogTitle.textContent = "编辑频道";
    dialogSubmitText.textContent = "保存修改";
    chId.value = ch.id;
    chTitle.value = ch.title;
    chDesc.value = ch.description;
    chAuthor.value = ch.author;
    chLang.value = ch.language;
    chCategory.value = ch.category;
    // Show existing cover preview if available
    if (ch.coverUrl) {
        chCoverPreviewImg.src = ch.coverUrl;
        chCoverPreview.classList.remove("hidden");
    } else {
        chCoverPreview.classList.add("hidden");
    }
    // Show regenerate option if Gemini API key is configured
    if (aliyunConfig?.geminiApiKey) {
        chCoverRegenLabel.classList.remove("hidden");
    } else {
        chCoverRegenLabel.classList.add("hidden");
    }
    chCoverRegen.checked = false;
    chCover.value = "";
    dialogStatus.classList.add("hidden");
    channelDialog.showModal();
}

/** Close dialog */
btnCancelDialog.addEventListener("click", () => channelDialog.close());
channelDialog.addEventListener("click", (e) => {
    if (e.target === channelDialog) channelDialog.close();
});

/** Show dialog status message */
function showDialogStatus(msg: string, type: "success" | "error" | "info") {
    dialogStatus.textContent = msg;
    dialogStatus.className = `status-msg ${type}`;
    dialogStatus.classList.remove("hidden");
}

/** Handle channel form submission (create or update) */
formChannel.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!aliyunConfig) {
        showDialogStatus("⚠️ 请先保存 OSS 配置", "error");
        return;
    }

    const isEdit = !!chId.value;
    const submitBtn = formChannel.querySelector<HTMLButtonElement>('[type="submit"]')!;
    submitBtn.disabled = true;

    try {
        if (isEdit) {
            // ── Update existing channel ──
            const idx = channels.findIndex((c) => c.id === chId.value);
            if (idx === -1) throw new Error("频道不存在");

            let coverUrl = channels[idx].coverUrl;
            const coverFile = chCover.files?.[0];
            const wantsRegen = chCoverRegen.checked;

            if (coverFile) {
                // User uploaded a new cover — upload it
                showDialogStatus("🔄 正在上传封面图片...", "info");
                const coverExt = coverFile.name.split(".").pop() || "jpg";
                const coverPath = `${channels[idx].id}/cover.${coverExt}`;
                const coverBlob = new Blob([await coverFile.arrayBuffer()], { type: coverFile.type });
                coverUrl = await uploadToOss(aliyunConfig, coverPath, coverBlob, coverFile.type);
            } else if (wantsRegen && aliyunConfig.geminiApiKey) {
                // User explicitly requested regeneration
                showDialogStatus("🎨 AI 正在重新生成封面图片...", "info");
                try {
                    const generatedBlob = await generateCoverImage(
                        aliyunConfig.geminiApiKey,
                        chTitle.value.trim(),
                        chDesc.value.trim() || undefined
                    );
                    const mimeType = generatedBlob.type || "image/png";
                    const ext = mimeType.includes("jpeg") ? "jpg" : "png";
                    const coverPath = `${channels[idx].id}/cover.${ext}`;
                    showDialogStatus("🔄 正在上传 AI 生成的封面...", "info");
                    coverUrl = await uploadToOss(aliyunConfig, coverPath, generatedBlob, mimeType);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.warn("AI 封面生成失败:", msg);
                    showDialogStatus(`⚠️ AI 封面生成失败: ${msg}`, "info");
                }
            } else if (!coverUrl && aliyunConfig.geminiApiKey) {
                // No existing cover and no upload — auto-generate with AI
                showDialogStatus("🎨 AI 正在生成封面图片...", "info");
                try {
                    const generatedBlob = await generateCoverImage(
                        aliyunConfig.geminiApiKey,
                        chTitle.value.trim(),
                        chDesc.value.trim() || undefined
                    );
                    const mimeType = generatedBlob.type || "image/png";
                    const ext = mimeType.includes("jpeg") ? "jpg" : "png";
                    const coverPath = `${channels[idx].id}/cover.${ext}`;
                    showDialogStatus("🔄 正在上传 AI 生成的封面...", "info");
                    coverUrl = await uploadToOss(aliyunConfig, coverPath, generatedBlob, mimeType);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.warn("AI 封面生成失败:", msg);
                    showDialogStatus(`⚠️ AI 封面生成失败: ${msg}`, "info");
                }
            }

            channels[idx] = {
                ...channels[idx],
                title: chTitle.value.trim(),
                description: chDesc.value.trim(),
                author: chAuthor.value.trim(),
                language: chLang.value.trim(),
                category: chCategory.value.trim(),
                coverUrl,
            };
            await saveChannels(channels);
            renderChannels();
            channelDialog.close();
        } else {
            // ── Create new channel (cold start) ──
            const channelId = uuidv4();
            const feedSecret = uuidv4().replace(/-/g, "").slice(0, 12);
            const xmlPath = `${channelId}/feed_${feedSecret}.xml`;

            showDialogStatus("🔄 正在处理封面图片...", "info");

            // 1. Upload cover image (user-provided or AI-generated)
            let coverUrl = "";
            const coverFile = chCover.files?.[0];
            if (coverFile) {
                // User uploaded a cover — use it directly
                showDialogStatus("🔄 正在上传封面图片...", "info");
                const coverExt = coverFile.name.split(".").pop() || "jpg";
                const coverPath = `${channelId}/cover.${coverExt}`;
                const coverBlob = new Blob([await coverFile.arrayBuffer()], { type: coverFile.type });
                coverUrl = await uploadToOss(aliyunConfig, coverPath, coverBlob, coverFile.type);
            } else if (aliyunConfig.geminiApiKey) {
                // No cover uploaded — generate one with AI
                showDialogStatus("🎨 AI 正在生成封面图片...", "info");
                try {
                    const generatedBlob = await generateCoverImage(
                        aliyunConfig.geminiApiKey,
                        chTitle.value.trim(),
                        chDesc.value.trim() || undefined
                    );
                    const mimeType = generatedBlob.type || "image/png";
                    const ext = mimeType.includes("jpeg") ? "jpg" : "png";
                    const coverPath = `${channelId}/cover.${ext}`;
                    showDialogStatus("🔄 正在上传 AI 生成的封面...", "info");
                    coverUrl = await uploadToOss(aliyunConfig, coverPath, generatedBlob, mimeType);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.warn("AI 封面生成失败，将继续创建频道（无封面）:", msg);
                    showDialogStatus(`⚠️ AI 封面生成失败: ${msg}，继续创建频道...`, "info");
                    // Continue without cover — don't block channel creation
                }
            }

            // 2. Build the Channel object
            const newChannel: Channel = {
                id: channelId,
                title: chTitle.value.trim(),
                description: chDesc.value.trim(),
                author: chAuthor.value.trim(),
                language: chLang.value.trim(),
                category: chCategory.value.trim(),
                coverUrl,
                xmlPath,
                createdAt: new Date().toISOString(),
            };

            // 3. Generate and upload skeleton RSS XML
            showDialogStatus("🔄 正在生成并上传 RSS XML...", "info");
            const skeletonXml = buildSkeletonRss(newChannel);
            await uploadToOss(aliyunConfig, xmlPath, skeletonXml, "application/xml; charset=utf-8");

            // 4. Save to storage
            channels.push(newChannel);
            await saveChannels(channels);
            renderChannels();

            showDialogStatus(
                `✅ 频道已创建！\nRSS: ${aliyunConfig.cdnDomain}/${xmlPath}\n💡 添加首个播客后，可在播客客户端（如 Apple Podcasts）中订阅`,
                "success"
            );

            // Close dialog after a short delay so user can see the success message
            setTimeout(() => channelDialog.close(), 1500);
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showDialogStatus(`❌ 操作失败: ${msg}`, "error");
    } finally {
        submitBtn.disabled = false;
    }
});

// ═══════════════════════════════════════
// Helpers
// ═══════════════════════════════════════

function escHtml(str: string): string {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

/** Decode XML/HTML entities back to plain text */
function unescapeXml(str: string): string {
    return str
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");  // &amp; must be last
}

function deleteArtifact(baseKey: string, extIdx: number) {
    chrome.runtime.sendMessage({
        type: "podcastPublish",
        action: "deleteArtifactFile",
        id: "", // not strictly needed
        artifactBaseKey: baseKey,
        extensionIndex: extIdx
    });
}

// ═══════════════════════════════════════
// Content Management Dialog
// ═══════════════════════════════════════

const contentDialog = $<HTMLDialogElement>("#content-dialog");
const contentDialogTitle = $<HTMLHeadingElement>("#content-dialog-title");
const contentList = $<HTMLDivElement>("#content-list");
const contentStatus = $<HTMLDivElement>("#content-status");
const contentSummary = $<HTMLElement>("#content-summary");
const btnCloseContent = $<HTMLButtonElement>("#btn-close-content");
const btnAdvanced = $<HTMLButtonElement>("#btn-advanced");
const advancedMenu = $<HTMLDivElement>("#advanced-menu");

// Backup & Restore
const backupStatus = $<HTMLDivElement>("#backup-status");
const btnExportSettings = $<HTMLButtonElement>("#btn-export-settings");
const importSettingsFile = $<HTMLInputElement>("#import-settings-file");

function showBackupStatus(msg: string, type: "success" | "error" | "info") {
    backupStatus.textContent = msg;
    backupStatus.className = `status-msg msg-${type} mt-4`; // remove hidden
    setTimeout(() => {
        backupStatus.classList.add("hidden");
    }, 4000);
}

btnExportSettings.addEventListener("click", async () => {
    try {
        btnExportSettings.disabled = true;
        btnExportSettings.textContent = "⏳ 导出中...";
        const allData = await chrome.storage.local.get(null);

        const blob = new Blob([JSON.stringify(allData, null, 2)], { type: "application/json" });
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const suggestedName = `notebooklm-agent-config-${dateStr}.json`;

        if ('showSaveFilePicker' in window) {
            const handle = await (window as any).showSaveFilePicker({
                suggestedName,
                types: [{
                    description: 'JSON Files',
                    accept: { 'application/json': ['.json'] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = suggestedName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        showBackupStatus("✅ 配置导出成功", "success");
    } catch (err: any) {
        if (err.name !== 'AbortError') {
            showBackupStatus(`⚠️ 导出失败: ${err.message}`, "error");
        } else {
            showBackupStatus("ℹ️ 已取消导出", "info");
        }
    } finally {
        btnExportSettings.disabled = false;
        btnExportSettings.textContent = "📤 导出全部配置";
    }
});

importSettingsFile.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const jsonText = e.target?.result as string;
            const parsedData = JSON.parse(jsonText);

            if (typeof parsedData !== "object" || parsedData === null) {
                throw new Error("无效的配置文件格式");
            }

            if (!confirm(`⚠️ 确定要导入此文件吗？\n这将会覆盖你当前本地所有的频道、目录分类设置以及其他选项。覆盖后无法撤销！`)) {
                importSettingsFile.value = ""; // Reset input
                return;
            }

            // Clear current storage and set new one
            await chrome.storage.local.clear();
            await chrome.storage.local.set(parsedData);

            showBackupStatus("✅ 导入成功，正在刷新页面...", "success");

            setTimeout(() => {
                // If in an iframe, let the parent reload to refresh everything. Otherwise reload self.
                if (window.parent && window.parent !== window) {
                    window.parent.location.reload();
                } else {
                    window.location.reload();
                }
            }, 1000);

        } catch (err: any) {
            importSettingsFile.value = ""; // Reset input
            showBackupStatus(`⚠️ 导入失败: ${err.message}`, "error");
        }
    };
    reader.readAsText(file);
});

interface FileEntry {
    obj: OssObject;
    status: "ok" | "duplicate" | "orphan";
    referenced: boolean;  // referenced in RSS
    dupGroup: number;     // 0 = no group, >0 = group id
    isKeep: boolean;      // true = the one we keep in dup group
    episodeTitle: string; // title from RSS <item>, empty if not found
}

let currentContentChannel: Channel | null = null;
let currentFiles: FileEntry[] = [];
let currentRssEnclosures: Set<string> = new Set();

/** Close content dialog */
btnCloseContent.addEventListener("click", () => contentDialog.close());
contentDialog.addEventListener("click", (e) => {
    if (e.target === contentDialog) contentDialog.close();
});

/** Open content management dialog for a channel */
async function openContentDialog(ch: Channel) {
    currentContentChannel = ch;
    contentDialogTitle.textContent = `📁 ${ch.title} — 内容管理`;
    contentList.innerHTML = `<div class="text-zinc-600 text-sm text-center py-8">⏳ 正在加载文件列表...</div>`;
    contentSummary.textContent = "";
    contentStatus.classList.add("hidden");
    contentDialog.showModal();

    try {
        if (!aliyunConfig) throw new Error("未配置 OSS");

        // 1. List audio files for this channel
        const objects = await listOssObjects(aliyunConfig, `${ch.id}/audio/`);

        // 2. Fetch RSS to check references and extract episode titles
        currentRssEnclosures = new Set();
        const urlToTitle = new Map<string, string>();
        try {
            const cdnBase = aliyunConfig.cdnDomain.replace(/\/+$/, "");
            const xmlUrl = `${cdnBase}/${ch.xmlPath}?t=${Date.now()}`;
            const xmlResp = await fetch(xmlUrl);
            if (xmlResp.ok) {
                const xmlText = await xmlResp.text();
                // Extract all enclosure URLs
                const encRegex = /url="([^"]*)"/g;
                let m: RegExpExecArray | null;
                while ((m = encRegex.exec(xmlText)) !== null) {
                    currentRssEnclosures.add(m[1]);
                }
                // Extract <item> blocks to map enclosure URL → episode title
                const itemRegex = /<item>[\s\S]*?<\/item>/g;
                let itemMatch: RegExpExecArray | null;
                while ((itemMatch = itemRegex.exec(xmlText)) !== null) {
                    const itemBlock = itemMatch[0];
                    const titleM = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(itemBlock);
                    const urlM = /url="([^"]*)"/.exec(itemBlock);
                    if (titleM && urlM) {
                        urlToTitle.set(urlM[1], unescapeXml(titleM[1].trim()));
                    }
                }
            }
        } catch { /* RSS fetch failed — treat all as unreferenced */ }

        // 2b. Fetch meta.json for additional title data (covers unpublished files)
        const fileNameToTitle = new Map<string, string>();
        try {
            const cdnBase = aliyunConfig.cdnDomain.replace(/\/+$/, "");
            const metaUrl = `${cdnBase}/${ch.id}/audio/meta.json?t=${Date.now()}`;
            const metaResp = await fetch(metaUrl);
            if (metaResp.ok) {
                const meta = await metaResp.json();
                for (const [fileName, info] of Object.entries(meta)) {
                    if (info && typeof info === "object" && (info as { title?: string }).title) {
                        fileNameToTitle.set(fileName, (info as { title: string }).title);
                    }
                }
            }
        } catch { /* meta.json not available */ }

        // 3. Build file entries with initial "ok" status
        const cdnBase = aliyunConfig.cdnDomain.replace(/\/+$/, "");
        currentFiles = objects
            .filter(o => o.key.endsWith(".mp3"))  // Only audio files
            .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
            .map(obj => {
                const cdnUrl = `${cdnBase}/${obj.key}`;
                const referenced = currentRssEnclosures.has(cdnUrl);
                const shortKey = obj.key.split("/").pop() || obj.key;
                // RSS title takes precedence, then meta.json title
                const title = urlToTitle.get(cdnUrl) || fileNameToTitle.get(shortKey) || "";
                return {
                    obj,
                    status: "ok" as const,
                    referenced,
                    dupGroup: 0,
                    isKeep: false,
                    episodeTitle: title,
                };
            });

        // Auto-scan for duplicates
        scanDuplicates();
        renderContentList();
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        contentList.innerHTML = `<div class="text-zinc-600 text-sm text-center py-8">❌ ${escHtml(msg)}</div>`;
    }
}

/** Scan for duplicate files by size */
function scanDuplicates() {
    // Reset all statuses
    currentFiles.forEach(f => { f.status = "ok"; f.dupGroup = 0; f.isKeep = false; });

    // Group by file size
    const sizeGroups = new Map<number, FileEntry[]>();
    currentFiles.forEach(f => {
        const group = sizeGroups.get(f.obj.size) || [];
        group.push(f);
        sizeGroups.set(f.obj.size, group);
    });

    let groupId = 0;
    sizeGroups.forEach(group => {
        if (group.length > 1) {
            groupId++;
            // Find the one to keep: prefer the one that's referenced in RSS.
            // If multiple referenced, keep the oldest (earliest upload).
            // If none referenced, keep the oldest.
            const sorted = [...group].sort(
                (a, b) => new Date(a.obj.lastModified).getTime() - new Date(b.obj.lastModified).getTime()
            );
            const referencedOnes = sorted.filter(f => f.referenced);
            const keeper = referencedOnes.length > 0 ? referencedOnes[0] : sorted[0];

            group.forEach(f => {
                f.dupGroup = groupId;
                if (f === keeper) {
                    f.status = "duplicate";
                    f.isKeep = true;
                } else {
                    f.status = f.referenced ? "duplicate" : "orphan";
                    f.isKeep = false;
                }
            });
        }
    });
}

/** Render the content file list table */
function renderContentList() {
    if (!currentFiles.length) {
        contentList.innerHTML = `<div class="text-zinc-600 text-sm text-center py-8">该频道暂无音频文件</div>`;
        contentSummary.textContent = "";
        return;
    }

    const dupCount = currentFiles.filter(f => (f.status === "duplicate" || f.status === "orphan") && !f.isKeep).length;
    const unrefCount = currentFiles.filter(f => !f.referenced).length;
    const totalSize = currentFiles.reduce((s, f) => s + f.obj.size, 0);
    let summaryParts = [`共 ${currentFiles.length} 个文件`, formatSize(totalSize)];
    if (unrefCount > 0) summaryParts.push(`${unrefCount} 个未在 RSS 中`);
    if (dupCount > 0) summaryParts.push(`${dupCount} 个可删除`);
    contentSummary.textContent = summaryParts.join(" · ");

    contentList.innerHTML = `
    <table class="content-table">
      <thead>
        <tr>
          <th>文件</th>
          <th>主题</th>
          <th>大小</th>
          <th>上传时间</th>
          <th>状态</th>
          <th class="col-actions">操作</th>
        </tr>
      </thead>
      <tbody>
        ${currentFiles.map((f, i) => {
        const shortKey = f.obj.key.split("/").pop() || f.obj.key;
        const rowClass = f.status === "orphan" ? "row-orphan" : (f.status === "duplicate" && !f.isKeep) ? "row-duplicate" : "";
        const badge = f.status === "ok"
            ? `<span class="badge badge-ok">正常</span>`
            : f.isKeep
                ? `<span class="badge badge-dup">重复·保留</span>`
                : f.status === "orphan"
                    ? `<span class="badge badge-orphan">重复·孤立</span>`
                    : `<span class="badge badge-dup">重复</span>`;
        const refIcon = f.referenced ? "🔗" : "";
        const titleDisplay = f.episodeTitle ? escHtml(f.episodeTitle) : `<span class="text-zinc-600">—</span>`;
        const date = new Date(f.obj.lastModified).toLocaleString("zh-CN", {
            month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit",
        });
        return `
            <tr class="${rowClass}" data-index="${i}">
              <td><span class="file-key" title="${escHtml(f.obj.key)}">${escHtml(shortKey)}</span> ${refIcon}</td>
              <td class="episode-title" title="${f.episodeTitle ? escHtml(f.episodeTitle) : ''}">${titleDisplay}</td>
              <td>${formatSize(f.obj.size)}</td>
              <td>${date}</td>
              <td>${badge}</td>
              <td class="col-actions">
                <button class="btn btn-danger btn-sm" data-action="delete-file" data-index="${i}" title="删除">🗑️</button>
              </td>
            </tr>`;
    }).join("")}
      </tbody>
    </table>`;
}

/** Handle clicks within the content list (delete individual files) */
contentList.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action='delete-file']");
    if (!btn || !aliyunConfig || !currentContentChannel) return;

    const index = parseInt(btn.dataset.index!, 10);
    const file = currentFiles[index];
    if (!file) return;

    const shortKey = file.obj.key.split("/").pop() || file.obj.key;
    if (!confirm(`确定要删除文件「${shortKey}」吗？\n${file.referenced ? "⚠️ 该文件被 RSS 引用，删除将同时移除对应的播客单集" : "此文件未被 RSS 引用"}`)) return;

    btn.disabled = true;
    btn.textContent = "⏳";

    try {
        // Delete from OSS
        await deleteOssObject(aliyunConfig, file.obj.key);

        // If referenced in RSS, remove the corresponding <item>
        if (file.referenced) {
            await removeEpisodeFromRss(file.obj.key);
        }

        // Remove from local list and re-render
        currentFiles.splice(index, 1);
        scanDuplicates();
        renderContentList();
        showContentStatus(`✅ 已删除 ${shortKey}`, "success");
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showContentStatus(`❌ 删除失败: ${msg}`, "error");
        btn.disabled = false;
        btn.textContent = "🗑️";
    }
});

// ═══════════════════════════════════════
// Advanced Dropdown Menu
// ═══════════════════════════════════════

/** Toggle dropdown */
btnAdvanced.addEventListener("click", (e) => {
    e.stopPropagation();
    advancedMenu.classList.toggle("hidden");
});

/** Close dropdown on outside click */
document.addEventListener("click", () => {
    advancedMenu.classList.add("hidden");
});

/** Dispatch dropdown menu actions */
advancedMenu.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
    if (!btn) return;
    advancedMenu.classList.add("hidden");

    const action = btn.dataset.action;
    switch (action) {
        case "scan-dup": handleScanDup(); break;
        case "sync-titles": await handleSyncTitles(); break;
        case "fix-serial": await handleFixSerial(); break;
        case "fix-rss": await handleFixRss(); break;
        case "delete-dups": await handleDeleteDups(); break;
    }
});

/** Scan for duplicate files */
function handleScanDup() {
    scanDuplicates();
    renderContentList();
    const dupCount = currentFiles.filter(f => (f.status === "duplicate" || f.status === "orphan") && !f.isKeep).length;
    showContentStatus(
        dupCount > 0 ? `🔍 发现 ${dupCount} 个可删除的重复文件` : "✅ 未发现重复文件",
        dupCount > 0 ? "info" : "success"
    );
}

/** Sync titles from RSS to meta.json */
async function handleSyncTitles() {
    if (!aliyunConfig || !currentContentChannel) return;

    showContentStatus("🔄 正在从 RSS 同步标题到 meta.json...", "info");

    try {
        const ch = currentContentChannel;
        const cdnBase = aliyunConfig.cdnDomain.replace(/\/+$/, "");

        const xmlUrl = `${cdnBase}/${ch.xmlPath}?t=${Date.now()}`;
        const xmlResp = await fetch(xmlUrl);
        if (!xmlResp.ok) throw new Error(`获取 RSS 失败: HTTP ${xmlResp.status}`);
        const xmlText = await xmlResp.text();

        const rssUrlToTitle = new Map<string, { title: string; description: string }>();
        const itemRegex = /<item>[\s\S]*?<\/item>/g;
        let itemMatch: RegExpExecArray | null;
        while ((itemMatch = itemRegex.exec(xmlText)) !== null) {
            const block = itemMatch[0];
            const titleM = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(block);
            const descM = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/.exec(block);
            const urlM = /url="([^"]*)"/.exec(block);
            if (titleM && urlM) {
                rssUrlToTitle.set(urlM[1], {
                    title: titleM[1].trim(),
                    description: descM ? descM[1].trim() : titleM[1].trim(),
                });
            }
        }

        if (rssUrlToTitle.size === 0) {
            showContentStatus("⚠️ RSS 中没有找到任何播客单集", "info");
            return;
        }

        const metaPath = `${ch.id}/audio/meta.json`;
        let meta: Record<string, { title: string; description: string; publishedAt?: string }> = {};
        try {
            const metaUrl = `${cdnBase}/${metaPath}?t=${Date.now()}`;
            const metaResp = await fetch(metaUrl);
            if (metaResp.ok) {
                meta = await metaResp.json();
            }
        } catch { /* start fresh */ }

        let synced = 0;
        for (const [url, info] of rssUrlToTitle) {
            const fileName = url.split("/").pop();
            if (!fileName) continue;
            if (!meta[fileName] || !meta[fileName].title) {
                meta[fileName] = { title: info.title, description: info.description };
                synced++;
            }
        }

        await uploadToOss(aliyunConfig, metaPath, JSON.stringify(meta, null, 2), "application/json; charset=utf-8");

        const fileNameToTitle = new Map<string, string>();
        for (const [fn, info] of Object.entries(meta)) {
            if (info?.title) fileNameToTitle.set(fn, info.title);
        }
        currentFiles.forEach(f => {
            if (!f.episodeTitle) {
                const shortKey = f.obj.key.split("/").pop() || f.obj.key;
                const title = fileNameToTitle.get(shortKey);
                if (title) f.episodeTitle = title;
            }
        });
        renderContentList();

        showContentStatus(
            synced > 0
                ? `✅ 已从 RSS 同步 ${synced} 个标题到 meta.json（共 ${rssUrlToTitle.size} 个单集）`
                : `✅ meta.json 已是最新，无需同步（共 ${rssUrlToTitle.size} 个单集）`,
            "success"
        );
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showContentStatus(`❌ 同步失败: ${msg}`, "error");
    }
}

/** Batch fix: add unreferenced MP3 files to RSS */
async function handleFixRss() {
    if (!aliyunConfig || !currentContentChannel) return;

    const unreferenced = currentFiles.filter(f => !f.referenced);
    if (!unreferenced.length) {
        showContentStatus("✅ 所有文件已在 RSS 中", "success");
        return;
    }

    if (!confirm(`将为 ${unreferenced.length} 个未引用的 MP3 文件补充 RSS 条目，是否继续？`)) return;

    showContentStatus(`🔄 正在补充 ${unreferenced.length} 个文件到 RSS...`, "info");

    try {
        const ch = currentContentChannel;
        const cdnBase = aliyunConfig.cdnDomain.replace(/\/+$/, "");

        const xmlUrl = `${cdnBase}/${ch.xmlPath}?t=${Date.now()}`;
        const xmlResp = await fetch(xmlUrl);
        if (!xmlResp.ok) throw new Error(`获取 RSS 失败: HTTP ${xmlResp.status}`);
        let xmlText = await xmlResp.text();

        if (!xmlText.includes("<channel")) throw new Error("RSS XML 格式错误: 缺少 <channel>");

        const now = new Date().toUTCString();
        let addedCount = 0;

        for (const file of unreferenced) {
            const shortKey = file.obj.key.split("/").pop() || file.obj.key;
            const cdnUrl = `${cdnBase}/${file.obj.key}`;

            const epTitle = file.episodeTitle || shortKey.replace(/\.mp3$/i, "").replace(/^audio_/, "");
            const epDesc = epTitle;
            const guidVal = uuidv4();
            const pubDate = file.obj.lastModified
                ? new Date(file.obj.lastModified).toUTCString()
                : now;

            const newItem = [
                "    <item>",
                `      <title>${escHtml(epTitle)}</title>`,
                `      <description>${escHtml(epDesc)}</description>`,
                `      <enclosure url="${escHtml(cdnUrl)}" type="audio/mpeg" length="${file.obj.size}" />`,
                `      <guid isPermaLink="false">${guidVal}</guid>`,
                `      <pubDate>${pubDate}</pubDate>`,
                `      <itunes:author>${escHtml(ch.author)}</itunes:author>`,
                `      <itunes:summary>${escHtml(epDesc)}</itunes:summary>`,
                `      <itunes:episodeType>full</itunes:episodeType>`,
                `      <itunes:explicit>false</itunes:explicit>`,
                "    </item>",
            ].join("\n");

            const firstItemIdx = xmlText.indexOf("<item>");
            if (firstItemIdx !== -1) {
                xmlText = xmlText.slice(0, firstItemIdx) + newItem + "\n" + xmlText.slice(firstItemIdx);
            } else {
                const closeChannel = xmlText.indexOf("</channel>");
                if (closeChannel === -1) throw new Error("RSS XML 格式错误: 缺少 </channel>");
                xmlText = xmlText.slice(0, closeChannel) + newItem + "\n  " + xmlText.slice(closeChannel);
            }
            addedCount++;
        }

        if (xmlText.includes("<lastBuildDate>")) {
            xmlText = xmlText.replace(
                /<lastBuildDate>[^<]*<\/lastBuildDate>/,
                `<lastBuildDate>${now}</lastBuildDate>`
            );
        }

        showContentStatus(`🔄 正在上传更新后的 RSS...`, "info");
        await uploadToOss(aliyunConfig, ch.xmlPath, xmlText, "application/xml; charset=utf-8");

        showContentStatus(`✅ 已为 ${addedCount} 个文件补充 RSS 条目，正在刷新...`, "success");
        await openContentDialog(ch);

        showContentStatus(
            `✅ 完成！已将 ${addedCount} 个文件补充到 RSS。Apple Podcasts 可能需要几小时刷新。`,
            "success"
        );
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showContentStatus(`❌ 补充失败: ${msg}`, "error");
    }
}

/** Batch delete all duplicate files */
async function handleDeleteDups() {
    if (!aliyunConfig || !currentContentChannel) return;

    const toDelete = currentFiles.filter(f => (f.status === "duplicate" || f.status === "orphan") && !f.isKeep);
    if (!toDelete.length) {
        showContentStatus("✅ 未发现可删除的重复文件", "success");
        return;
    }

    if (!confirm(`确定要删除 ${toDelete.length} 个重复文件吗？\n将保留每组中最早上传且被 RSS 引用的文件`)) return;

    showContentStatus(`🔄 正在删除 ${toDelete.length} 个文件...`, "info");

    let deleted = 0;
    let failed = 0;

    for (const file of toDelete) {
        try {
            await deleteOssObject(aliyunConfig, file.obj.key);
            if (file.referenced) {
                await removeEpisodeFromRss(file.obj.key);
            }
            deleted++;
        } catch {
            failed++;
        }
    }

    const deletedKeys = new Set(toDelete.filter((_, i) => i < deleted).map(f => f.obj.key));
    currentFiles = currentFiles.filter(f => !deletedKeys.has(f.obj.key));
    scanDuplicates();
    renderContentList();

    showContentStatus(
        failed > 0
            ? `⚠️ 已删除 ${deleted} 个文件，${failed} 个失败`
            : `✅ 已删除 ${deleted} 个重复文件`,
        failed > 0 ? "error" : "success"
    );
}

/** Fix RSS: change itunes:type to serial and add itunes:episode numbers */
async function handleFixSerial() {
    if (!aliyunConfig || !currentContentChannel) return;

    showContentStatus("🔄 正在修复 RSS 为连续播放模式...", "info");

    try {
        const ch = currentContentChannel;
        const cdnBase = aliyunConfig.cdnDomain.replace(/\/+$/, "");

        const xmlUrl = `${cdnBase}/${ch.xmlPath}?t=${Date.now()}`;
        const xmlResp = await fetch(xmlUrl);
        if (!xmlResp.ok) throw new Error(`获取 RSS 失败: HTTP ${xmlResp.status}`);
        let xmlText = await xmlResp.text();

        let changes = 0;

        if (xmlText.includes("<itunes:type>episodic</itunes:type>")) {
            xmlText = xmlText.replace(
                "<itunes:type>episodic</itunes:type>",
                "<itunes:type>serial</itunes:type>"
            );
            changes++;
        } else if (!xmlText.includes("<itunes:type>")) {
            const insertBefore = xmlText.indexOf("<item>");
            if (insertBefore !== -1) {
                xmlText = xmlText.slice(0, insertBefore) + "    <itunes:type>serial</itunes:type>\n" + xmlText.slice(insertBefore);
            } else {
                const closeChannel = xmlText.indexOf("</channel>");
                if (closeChannel !== -1) {
                    xmlText = xmlText.slice(0, closeChannel) + "    <itunes:type>serial</itunes:type>\n  " + xmlText.slice(closeChannel);
                }
            }
            changes++;
        }

        const itemRegex = /<item>[\s\S]*?<\/item>/g;
        const items: { match: string; pubDate: Date; index: number }[] = [];
        let m: RegExpExecArray | null;
        while ((m = itemRegex.exec(xmlText)) !== null) {
            const pubM = /<pubDate>([^<]*)<\/pubDate>/.exec(m[0]);
            const pubDate = pubM ? new Date(pubM[1]) : new Date(0);
            items.push({ match: m[0], pubDate, index: m.index });
        }

        const sorted = [...items].sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime());

        const replacements = new Map<number, string>();
        sorted.forEach((item, i) => {
            const epNum = i + 1;
            let newItem = item.match;
            if (!newItem.includes("<itunes:episode>")) {
                newItem = newItem.replace(
                    "</item>",
                    `      <itunes:episode>${epNum}</itunes:episode>\n    </item>`
                );
                changes++;
            } else {
                newItem = newItem.replace(
                    /<itunes:episode>\d+<\/itunes:episode>/,
                    `<itunes:episode>${epNum}</itunes:episode>`
                );
            }
            // Add episodeType full if missing
            if (!newItem.includes("<itunes:episodeType>")) {
                newItem = newItem.replace(
                    "</item>",
                    `      <itunes:episodeType>full</itunes:episodeType>\n    </item>`
                );
                changes++;
            }
            replacements.set(item.index, newItem);
        });

        const sortedByIndex = [...items].sort((a, b) => b.index - a.index);
        for (const item of sortedByIndex) {
            const replacement = replacements.get(item.index);
            if (replacement && replacement !== item.match) {
                xmlText = xmlText.slice(0, item.index) + replacement + xmlText.slice(item.index + item.match.length);
            }
        }

        const now = new Date().toUTCString();
        if (xmlText.includes("<lastBuildDate>")) {
            xmlText = xmlText.replace(
                /<lastBuildDate>[^<]*<\/lastBuildDate>/,
                `<lastBuildDate>${now}</lastBuildDate>`
            );
        }

        if (changes === 0) {
            showContentStatus("✅ RSS 已经是连续播放模式，无需修复", "success");
            return;
        }

        await uploadToOss(aliyunConfig, ch.xmlPath, xmlText, "application/xml; charset=utf-8");

        showContentStatus(
            `✅ 已修复 RSS 为连续播放 (serial) 模式，共更新 ${changes} 处。Apple Podcasts 可能需要几小时刷新。`,
            "success"
        );
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showContentStatus(`❌ 修复失败: ${msg}`, "error");
    }
}

/** Remove an episode from RSS XML by its audio file key */
async function removeEpisodeFromRss(audioKey: string) {
    if (!aliyunConfig || !currentContentChannel) return;

    const cdnBase = aliyunConfig.cdnDomain.replace(/\/+$/, "");
    const audioUrl = `${cdnBase}/${audioKey}`;

    // Fetch current RSS
    const xmlUrl = `${cdnBase}/${currentContentChannel.xmlPath}?t=${Date.now()}`;
    const xmlResp = await fetch(xmlUrl);
    if (!xmlResp.ok) return;
    let xmlText = await xmlResp.text();

    // Remove <item> blocks that reference this audio URL
    // Match <item>...</item> blocks containing the URL
    const escapedUrl = audioUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const itemRegex = new RegExp(`\\s*<item>[\\s\\S]*?${escapedUrl}[\\s\\S]*?</item>`, "g");
    const newXml = xmlText.replace(itemRegex, "");

    if (newXml !== xmlText) {
        // Update lastBuildDate
        const now = new Date().toUTCString();
        const updatedXml = newXml.replace(
            /<lastBuildDate>[^<]*<\/lastBuildDate>/,
            `<lastBuildDate>${now}</lastBuildDate>`
        );
        await uploadToOss(aliyunConfig, currentContentChannel.xmlPath, updatedXml, "application/xml; charset=utf-8");
    }
}

/** Show content dialog status */
function showContentStatus(msg: string, type: "success" | "error" | "info") {
    contentStatus.textContent = msg;
    contentStatus.className = `status-msg ${type}`;
    contentStatus.classList.remove("hidden");
}

/** Format byte size to human readable */
function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ═══════════════════════════════════════
// Init
// ═══════════════════════════════════════
async function init() {
    // Load saved Aliyun config
    aliyunConfig = await loadAliyunConfig();
    if (aliyunConfig) {
        populateConfig(aliyunConfig);
        showOssStatus("✅ 已加载保存的配置", "success");
    }

    // Load channels
    channels = await loadChannels();
    renderChannels();
}

init();

// ═══════════════════════════════════════
// Parent-page Communication (postMessage)
// ═══════════════════════════════════════
window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object" || msg.source !== "podcast-publish") return;

    const action = msg.action as string;
    const channelId = msg.channelId as string | undefined;

    if (action === "open-manage" && channelId) {
        const ch = channels.find(c => c.id === channelId);
        if (ch) openContentDialog(ch);
    } else if (action === "open-edit" && channelId) {
        const ch = channels.find(c => c.id === channelId);
        if (ch) openEditDialog(ch);
    } else if (action === "open-new") {
        btnNewChannel.click();
        const notebookName = (msg as { notebookName?: string }).notebookName;
        if (notebookName) {
            chTitle.value = notebookName;
        }
    }
});
