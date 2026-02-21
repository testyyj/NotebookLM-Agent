/**
 * Popup entry point.
 * Orchestrates: channel selection, metadata editing, WAV file input,
 * and triggers the full publish pipeline (transcode → upload MP3 → update RSS).
 */
import "./popup.css";
import { v4 as uuidv4 } from "uuid";
import { AliyunConfig, Channel, PublishState } from "../types";
import { loadAliyunConfig, loadChannels } from "../storage";
import { uploadToOss } from "../oss";

// ── DOM references ──
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const noConfig = $<HTMLDivElement>("#no-config");
const linkOptions = $<HTMLAnchorElement>("#link-options");
const btnOptions = $<HTMLButtonElement>("#btn-options");

const selChannel = $<HTMLSelectElement>("#sel-channel");
const epTitle = $<HTMLInputElement>("#ep-title");
const epDesc = $<HTMLTextAreaElement>("#ep-desc");

const dropZone = $<HTMLDivElement>("#drop-zone");
const wavFileInput = $<HTMLInputElement>("#wav-file");
const dropLabel = $<HTMLDivElement>("#drop-label");
const fileInfo = $<HTMLDivElement>("#file-info");
const fileName = $<HTMLSpanElement>("#file-name");
const fileSize = $<HTMLSpanElement>("#file-size");
const btnClearFile = $<HTMLButtonElement>("#btn-clear-file");

const btnScrape = $<HTMLButtonElement>("#btn-scrape");
const btnPublish = $<HTMLButtonElement>("#btn-publish");

const progressSection = $<HTMLDivElement>("#progress-section");
const progressBar = $<HTMLDivElement>("#progress-bar");
const progressText = $<HTMLDivElement>("#progress-text");

const resultSection = $<HTMLDivElement>("#result-section");
const resultMsg = $<HTMLDivElement>("#result-msg");

// ── State ──
let aliyunConfig: AliyunConfig | null = null;
let channels: Channel[] = [];
let selectedWavFile: File | null = null;

// ═══════════════════════════════════════
// Init
// ═══════════════════════════════════════

async function init() {
    aliyunConfig = await loadAliyunConfig();
    channels = await loadChannels();

    if (!aliyunConfig || !channels.length) {
        noConfig.classList.remove("hidden");
    }

    // Populate channel dropdown
    channels.forEach((ch) => {
        const opt = document.createElement("option");
        opt.value = ch.id;
        opt.textContent = ch.title;
        selChannel.appendChild(opt);
    });

    updatePublishButton();
}

init();

// ═══════════════════════════════════════
// Options link
// ═══════════════════════════════════════

btnOptions.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
});

linkOptions.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
});

// ═══════════════════════════════════════
// Page Scraping
// ═══════════════════════════════════════

btnScrape.addEventListener("click", async () => {
    try {
        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !tab.url?.includes("notebooklm.google.com")) {
            showResult("⚠️ 请先打开一个 NotebookLM 笔记本页面", "error");
            return;
        }

        // Send message to content script
        const response = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_PAGE_DATA" });
        if (response?.ok && response.data) {
            const { notebookTitle, aiSummary } = response.data;
            if (notebookTitle && !epTitle.value) {
                epTitle.value = notebookTitle;
            }
            if (aiSummary && !epDesc.value) {
                epDesc.value = aiSummary;
            }
            showResult("✅ 已从页面抓取标题和摘要", "success");
        } else {
            showResult("⚠️ 未能从页面抓取数据", "error");
        }
    } catch {
        showResult("⚠️ 无法连接内容脚本，请确保已打开 NotebookLM 页面并刷新", "error");
    }
});

// ═══════════════════════════════════════
// File Input / Drag & Drop
// ═══════════════════════════════════════

function handleFileSelect(file: File | null) {
    selectedWavFile = file;
    if (file) {
        dropLabel.classList.add("hidden");
        fileInfo.classList.remove("hidden");
        fileName.textContent = file.name;
        fileSize.textContent = formatSize(file.size);
    } else {
        dropLabel.classList.remove("hidden");
        fileInfo.classList.add("hidden");
        fileName.textContent = "";
        fileSize.textContent = "";
    }
    updatePublishButton();
}

wavFileInput.addEventListener("change", () => {
    handleFileSelect(wavFileInput.files?.[0] ?? null);
});

btnClearFile.addEventListener("click", (e) => {
    e.stopPropagation();
    wavFileInput.value = "";
    handleFileSelect(null);
});

// Drag & drop
dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file && (file.type === "audio/wav" || file.type === "audio/x-wav" || file.name.endsWith(".wav"))) {
        handleFileSelect(file);
    } else {
        showResult("⚠️ 请选择 .wav 格式的音频文件", "error");
    }
});

// ═══════════════════════════════════════
// Publish Button State
// ═══════════════════════════════════════

function updatePublishButton() {
    const canPublish = !!(selChannel.value && selectedWavFile && aliyunConfig);
    btnPublish.disabled = !canPublish;
}

selChannel.addEventListener("change", updatePublishButton);

// ═══════════════════════════════════════
// Publish Pipeline
// ═══════════════════════════════════════

/** Progress update helper */
function setProgress(state: PublishState, percent: number, text: string) {
    progressSection.classList.remove("hidden");
    progressBar.style.width = `${percent}%`;
    progressText.textContent = text;

    if (state === "done" || state === "error") {
        btnPublish.disabled = false;
    }
}

/** Show result message */
function showResult(msg: string, type: "success" | "error") {
    resultSection.classList.remove("hidden");
    resultMsg.textContent = msg;
    resultMsg.className = `result-msg ${type}`;
}

btnPublish.addEventListener("click", async () => {
    if (!aliyunConfig || !selectedWavFile || !selChannel.value) return;

    const channel = channels.find((ch) => ch.id === selChannel.value);
    if (!channel) return;

    btnPublish.disabled = true;
    resultSection.classList.add("hidden");

    try {
        // ── Step 1: Transcode WAV → MP3 ──
        setProgress("transcoding", 10, "🔄 正在转码 WAV → MP3...");

        const wavBuffer = await selectedWavFile.arrayBuffer();

        // Send WAV to offscreen document for FFmpeg transcoding
        let mp3ArrayBuffer: ArrayBuffer;
        let mp3ByteSize: number;

        try {
            // Ensure offscreen document is created
            await ensureOffscreenDocument();

            const response = await chrome.runtime.sendMessage({
                type: "TRANSCODE_WAV",
                target: "offscreen",
                wavArrayBuffer: Array.from(new Uint8Array(wavBuffer)),
            });

            if (!response?.ok) {
                throw new Error(response?.error || "转码失败");
            }

            mp3ArrayBuffer = new Uint8Array(response.mp3Data).buffer;
            mp3ByteSize = response.mp3ByteSize;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`转码失败: ${msg}`);
        }

        // ── Step 2: Upload MP3 to OSS ──
        setProgress("uploading_mp3", 40, "📤 正在上传 MP3...");

        const audioId = uuidv4();
        const mp3OssPath = `${channel.id}/audio/audio_${audioId}.mp3`;
        const mp3Blob = new Blob([mp3ArrayBuffer], { type: "audio/mpeg" });
        const mp3CdnUrl = await uploadToOss(aliyunConfig, mp3OssPath, mp3Blob, "audio/mpeg");

        // ── Step 3: Fetch existing RSS XML ──
        setProgress("fetching_xml", 60, "📥 正在获取现有 RSS...");

        const cdnBase = aliyunConfig.cdnDomain.replace(/\/+$/, "");
        const xmlUrl = `${cdnBase}/${channel.xmlPath}?t=${Date.now()}`; // cache bust
        const xmlResp = await fetch(xmlUrl);
        if (!xmlResp.ok) throw new Error(`获取 RSS 失败: HTTP ${xmlResp.status}`);
        const xmlText = await xmlResp.text();

        // ── Step 4: Parse XML and insert new <item> ──
        setProgress("updating_xml", 75, "📝 正在更新 RSS...");

        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, "application/xml");
        const channelNode = doc.querySelector("channel");
        if (!channelNode) throw new Error("RSS XML 格式错误: 缺少 <channel>");

        // Build new <item> using proper namespace-aware DOM methods
        const ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd";
        const item = doc.createElement("item");
        const title = epTitle.value.trim() || "未命名单集";
        const description = epDesc.value.trim() || title;
        const guid = uuidv4();
        const pubDate = new Date().toUTCString();

        const addEl = (parent: Element, tag: string, text: string, ns?: string) => {
            const el = ns ? doc.createElementNS(ns, tag) : doc.createElement(tag);
            el.textContent = text;
            parent.appendChild(el);
            return el;
        };

        addEl(item, "title", title);
        addEl(item, "description", description);

        const enclosure = doc.createElement("enclosure");
        enclosure.setAttribute("url", mp3CdnUrl);
        enclosure.setAttribute("type", "audio/mpeg");
        enclosure.setAttribute("length", String(mp3ByteSize));
        item.appendChild(enclosure);

        const guidEl = doc.createElement("guid");
        guidEl.setAttribute("isPermaLink", "false");
        guidEl.textContent = guid;
        item.appendChild(guidEl);

        addEl(item, "pubDate", pubDate);
        addEl(item, "itunes:author", channel.author, ITUNES_NS);
        addEl(item, "itunes:summary", description, ITUNES_NS);
        addEl(item, "itunes:explicit", "false", ITUNES_NS);


        // Prepend new item (newest first)
        const firstItem = channelNode.querySelector("item");
        if (firstItem) {
            channelNode.insertBefore(item, firstItem);
        } else {
            channelNode.appendChild(item);
        }

        // Update lastBuildDate
        let lastBuild = channelNode.querySelector("lastBuildDate");
        if (!lastBuild) {
            lastBuild = doc.createElement("lastBuildDate");
            channelNode.appendChild(lastBuild);
        }
        lastBuild.textContent = pubDate;

        // ── Step 5: Serialize and upload XML ──
        setProgress("uploading_xml", 90, "📤 正在上传更新的 RSS...");

        const serializer = new XMLSerializer();
        const updatedXml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
            serializer.serializeToString(doc.documentElement);
        await uploadToOss(aliyunConfig, channel.xmlPath, updatedXml, "application/xml; charset=utf-8");

        // ── Step 6: Update meta.json with episode title ──
        try {
            const metaPath = `${channel.id}/audio/meta.json`;
            let meta: Record<string, { title: string; description: string; publishedAt: string }> = {};
            try {
                const metaUrl = `${cdnBase}/${metaPath}?t=${Date.now()}`;
                const metaResp = await fetch(metaUrl);
                if (metaResp.ok) {
                    meta = await metaResp.json();
                }
            } catch { /* no existing meta.json, start fresh */ }
            const mp3FileName = `audio_${audioId}.mp3`;
            meta[mp3FileName] = { title, description, publishedAt: pubDate };
            await uploadToOss(aliyunConfig, metaPath, JSON.stringify(meta, null, 2), "application/json; charset=utf-8");
        } catch (err) {
            console.warn("Failed to update meta.json:", err);
            // Non-fatal — don't block the publish
        }

        // ── Done! ──
        setProgress("done", 100, "✅ 发布完成！");
        showResult(`✅ 已发布「${title}」到「${channel.title}」`, "success");

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setProgress("error", 0, `❌ ${msg}`);
        showResult(`❌ ${msg}`, "error");
    }
});

// ═══════════════════════════════════════
// Offscreen Document Helper
// ═══════════════════════════════════════

async function ensureOffscreenDocument() {
    // Check if offscreen document already exists
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });

    if (existingContexts.length > 0) return;

    // Create it
    await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL("podcast/dist/src/offscreen/offscreen.html"),
        reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification: "FFmpeg WASM transcoding of WAV to MP3",
    });
}

// ═══════════════════════════════════════
// Helpers
// ═══════════════════════════════════════

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escXml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
