/**
 * Background service worker.
 * Opens the full-page UI in a new tab when extension icon is clicked.
 * Handles message routing and the podcast publish pipeline.
 */
import * as api from "./api.js";
import { loadAliyunConfig, loadChannels, uploadToOss, fetchText, uuid, saveChannels, buildSkeletonRss } from "./oss-helper.js";

// ── IndexedDB helpers (shared transfer medium with offscreen document) ──
const DB_NAME = "podcast-transfer";
const STORE_NAME = "blobs";

function openTransferDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function readBlobFromDb(key) {
    const db = await openTransferDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    return new Promise((resolve, reject) => {
        req.onsuccess = () => {
            db.close();
            resolve(req.result);
        };
        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}

async function putBlobToDb(key, data) {
    const db = await openTransferDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(data, key);
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

async function deleteBlobFromDb(key) {
    try {
        const db = await openTransferDb();
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(key);
        await new Promise((resolve) => { tx.oncomplete = resolve; });
        db.close();
    } catch (_) { /* best-effort cleanup */ }
}

// ── Open full page on icon click ──
chrome.action.onClicked.addListener(async () => {
    const url = chrome.runtime.getURL("page.html");
    const tabs = await chrome.tabs.query({ url });
    if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        await chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
        await chrome.tabs.create({ url });
    }
});

// ── Offscreen document helper ──
async function ensureOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    if (existingContexts.length > 0) return;

    await chrome.offscreen.createDocument({
        url: "podcast/dist/src/offscreen/offscreen.html",
        reasons: ["WORKERS"],
        justification: "FFmpeg WASM transcoding",
    });
}

// ── Send progress ──
// When a port is available (extension page), use it; otherwise try tabs
let activePublishPort = null;

function sendProgress(tabId, state, percent, text) {
    const msg = { type: "PODCAST_PUBLISH_PROGRESS", state, percent, text };
    if (activePublishPort) {
        try { activePublishPort.postMessage(msg); } catch (_) { /* port closed */ }
    } else {
        chrome.tabs.sendMessage(tabId, msg).catch(() => { });
    }
}

/**
 * Re-number all <itunes:episode> tags in RSS XML by pubDate ascending (oldest = 1).
 * Also adds <itunes:episodeType>full if missing.
 */
function renumberEpisodes(xml) {
    const itemRegex = /<item>[\s\S]*?<\/item>/g;
    const items = [];
    let m;
    while ((m = itemRegex.exec(xml)) !== null) {
        const pubM = /<pubDate>([^<]*)<\/pubDate>/.exec(m[0]);
        const pubDate = pubM ? new Date(pubM[1]) : new Date(0);
        items.push({ match: m[0], index: m.index, len: m[0].length, pubDate });
    }
    if (items.length === 0) return xml;

    // Sort by pubDate ascending to assign episode numbers
    const sorted = [...items].sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime());
    const epMap = new Map(); // index → new episode number
    sorted.forEach((item, i) => epMap.set(item.index, i + 1));

    // Replace in reverse order to preserve indices
    const byIndex = [...items].sort((a, b) => b.index - a.index);
    let result = xml;
    for (const item of byIndex) {
        const epNum = epMap.get(item.index);
        let updated = item.match;
        // Update or insert itunes:episode
        if (updated.includes("<itunes:episode>")) {
            updated = updated.replace(/<itunes:episode>\d+<\/itunes:episode>/, `<itunes:episode>${epNum}</itunes:episode>`);
        } else {
            updated = updated.replace("</item>", `      <itunes:episode>${epNum}</itunes:episode>\n    </item>`);
        }
        // Add episodeType full if missing
        if (!updated.includes("<itunes:episodeType>")) {
            updated = updated.replace("</item>", `      <itunes:episodeType>full</itunes:episodeType>\n    </item>`);
        }
        result = result.slice(0, item.index) + updated + result.slice(item.index + item.len);
    }
    return result;
}

// ── Podcast publish pipeline ──
async function publishPodcast(tabId, { wavUrl, channelId, title, description, episodeNumber }) {
    try {
        // Load config & channel
        const config = await loadAliyunConfig();
        if (!config) throw new Error("未配置阿里云 OSS，请先在频道管理中设置");

        const channels = await loadChannels();
        const channel = channels.find(ch => ch.id === channelId);
        if (!channel) throw new Error("找不到选定的频道");

        const epTitle = title || "未命名单集";
        const epDesc = description || epTitle;
        const cdnBase = config.cdnDomain.replace(/\/+$/, "");

        const escXml = (s) => s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");

        // ── Pre-check: detect duplicates before expensive download/transcode ──
        sendProgress(tabId, "fetching_xml", 5, "🔍 正在检查是否已发布...");

        const xmlUrl = `${cdnBase}/${channel.xmlPath}?t=${Date.now()}`;
        const xmlText = await fetchText(xmlUrl);
        if (!xmlText.includes("<channel")) throw new Error("RSS XML 格式错误: 缺少 <channel>");

        // Extract existing episode titles from RSS
        const existingTitles = new Set();
        const titleRegex = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<\/item>/g;
        let titleMatch;
        const unescXml = (s) => s
            .replace(/&apos;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&gt;/g, ">")
            .replace(/&lt;/g, "<")
            .replace(/&amp;/g, "&");
        while ((titleMatch = titleRegex.exec(xmlText)) !== null) {
            existingTitles.add(unescXml(titleMatch[1].trim()));
        }

        // Case 1: Title already exists in RSS
        if (existingTitles.has(epTitle)) {
            // If an episodeNumber was supplied, update the episode number in RSS
            if (episodeNumber) {
                sendProgress(tabId, "updating_xml", 50, `📝 正在更新「${epTitle}」的节目序号为 Ep.${episodeNumber}...`);

                // Find the <item> containing this title and update its <itunes:episode>
                const escapedTitle = escXml(epTitle);
                const itemRegex = /<item>([\s\S]*?)<\/item>/g;
                let updatedXml = xmlText;
                let itemMatch;
                while ((itemMatch = itemRegex.exec(xmlText)) !== null) {
                    const itemContent = itemMatch[0];
                    // Check if this item's title matches (support both CDATA and plain)
                    const titleInItem = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(itemContent);
                    if (titleInItem && unescXml(titleInItem[1].trim()) === epTitle) {
                        let updatedItem = itemContent;
                        if (updatedItem.includes("<itunes:episode>")) {
                            updatedItem = updatedItem.replace(
                                /<itunes:episode>\d+<\/itunes:episode>/,
                                `<itunes:episode>${episodeNumber}</itunes:episode>`
                            );
                        } else {
                            updatedItem = updatedItem.replace(
                                "</item>",
                                `      <itunes:episode>${episodeNumber}</itunes:episode>\n    </item>`
                            );
                        }
                        updatedXml = updatedXml.replace(itemContent, updatedItem);
                        break;
                    }
                }

                // Update lastBuildDate
                const now = new Date().toUTCString();
                if (updatedXml.includes("<lastBuildDate>")) {
                    updatedXml = updatedXml.replace(
                        /<lastBuildDate>[^<]*<\/lastBuildDate>/,
                        `<lastBuildDate>${now}</lastBuildDate>`
                    );
                }

                sendProgress(tabId, "uploading_xml", 80, "📤 正在上传 RSS...");
                await uploadToOss(config, channel.xmlPath, updatedXml, "application/xml; charset=utf-8");
                sendProgress(tabId, "done", 100, `✅ 「${epTitle}」节目序号已更新为 Ep.${episodeNumber}`);
            } else {
                sendProgress(tabId, "done", 100, `✅ 「${epTitle}」已在 RSS 中，无需重复发布`);
            }
            return;
        }

        // Case 2: Check meta.json for existing file not in RSS (OSS has + RSS missing)
        let metaPath = `${channel.id}/audio/meta.json`;
        let meta = {};
        try {
            const metaUrl = `${cdnBase}/${metaPath}?t=${Date.now()}`;
            const metaText = await fetchText(metaUrl);
            meta = JSON.parse(metaText);
        } catch { /* no existing meta.json */ }

        // Find a file in meta.json with matching title
        let existingFileName = null;
        for (const [fileName, info] of Object.entries(meta)) {
            if (info && typeof info === "object" && info.title === epTitle) {
                existingFileName = fileName;
                break;
            }
        }

        if (existingFileName) {
            // OSS has the file but RSS doesn't → just add to RSS
            sendProgress(tabId, "updating_xml", 50, "📝 OSS 已有文件，仅更新 RSS...");

            const mp3CdnUrl = `${cdnBase}/${channel.id}/audio/${existingFileName}`;
            const mp3ByteSize = meta[existingFileName].size || 0;
            const episodeNum = episodeNumber || (existingItemCount + 1);
            const guidVal = uuid();
            const pubDate = meta[existingFileName].publishedAt || new Date().toUTCString();

            const newItem = [
                "    <item>",
                `      <title>${escXml(epTitle)}</title>`,
                `      <description>${escXml(epDesc)}</description>`,
                `      <enclosure url="${escXml(mp3CdnUrl)}" type="audio/mpeg" length="${mp3ByteSize}" />`,
                `      <guid isPermaLink="false">${guidVal}</guid>`,
                `      <pubDate>${pubDate}</pubDate>`,
                `      <itunes:author>${escXml(channel.author)}</itunes:author>`,
                `      <itunes:summary>${escXml(epDesc)}</itunes:summary>`,
                `      <itunes:episode>${episodeNum}</itunes:episode>`,
                `      <itunes:episodeType>full</itunes:episodeType>`,
                `      <itunes:explicit>false</itunes:explicit>`,
                "    </item>",
            ].join("\n");

            let updatedXml = xmlText;
            const firstItemIdx = updatedXml.indexOf("<item>");
            if (firstItemIdx !== -1) {
                updatedXml = updatedXml.slice(0, firstItemIdx) + newItem + "\n" + updatedXml.slice(firstItemIdx);
            } else {
                const closeChannel = updatedXml.indexOf("</channel>");
                if (closeChannel === -1) throw new Error("RSS XML 格式错误: 缺少 </channel>");
                updatedXml = updatedXml.slice(0, closeChannel) + newItem + "\n  " + updatedXml.slice(closeChannel);
            }

            // Update lastBuildDate
            const now = new Date().toUTCString();
            if (updatedXml.includes("<lastBuildDate>")) {
                updatedXml = updatedXml.replace(
                    /<lastBuildDate>[^<]*<\/lastBuildDate>/,
                    `<lastBuildDate>${now}</lastBuildDate>`
                );
            }

            sendProgress(tabId, "uploading_xml", 80, "📤 正在上传 RSS...");
            await uploadToOss(config, channel.xmlPath, updatedXml, "application/xml; charset=utf-8");
            sendProgress(tabId, "done", 100, `✅ 已将「${epTitle}」补充到 RSS（文件已存在于 OSS）`);
            return;
        }

        // ── Case 3: Full pipeline — download, transcode, upload, update RSS ──

        // ── Step 1: Download audio ──
        sendProgress(tabId, "downloading", 10, "📥 正在下载音频...");

        let wavData;
        try {
            const resp = await fetch(wavUrl, { credentials: "include", redirect: "follow" });
            if (!resp.ok) throw new Error(`下载音频失败: HTTP ${resp.status}`);
            const buffer = await resp.arrayBuffer();
            wavData = new Uint8Array(buffer);
            console.log("[Background] Downloaded WAV:", wavData.byteLength, "bytes");
        } catch (err) {
            throw new Error(`下载音频失败: ${err.message}`);
        }

        // Store WAV in IndexedDB for offscreen to read
        const wavDbKey = `wav_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        await putBlobToDb(wavDbKey, wavData);
        sendProgress(tabId, "downloading", 20, "📥 音频下载完成");

        // ── Step 2: Transcode ──
        sendProgress(tabId, "transcoding", 25, "🔄 正在转码 WAV → MP3...");
        await ensureOffscreenDocument();

        const transcodeResp = await chrome.runtime.sendMessage({
            type: "TRANSCODE_WAV",
            target: "offscreen",
            wavDbKey,
        });

        await deleteBlobFromDb(wavDbKey);

        if (!transcodeResp?.ok) {
            throw new Error(transcodeResp?.error || "转码失败");
        }

        const mp3ByteSize = transcodeResp.mp3ByteSize;
        sendProgress(tabId, "transcoding", 45, `🔄 转码完成 (${(mp3ByteSize / 1024 / 1024).toFixed(1)} MB)`);

        const mp3Data = await readBlobFromDb(transcodeResp.dbKey);
        await deleteBlobFromDb(transcodeResp.dbKey);
        if (!mp3Data) throw new Error("无法读取转码后的 MP3 数据");

        // ── Step 3: Upload MP3 to OSS ──
        sendProgress(tabId, "uploading_mp3", 50, "📤 正在上传 MP3...");
        const audioId = uuid();
        const mp3OssPath = `${channel.id}/audio/audio_${audioId}.mp3`;
        const mp3Blob = new Blob([mp3Data], { type: "audio/mpeg" });
        const mp3CdnUrl = await uploadToOss(config, mp3OssPath, mp3Blob, "audio/mpeg");
        sendProgress(tabId, "uploading_mp3", 65, "📤 MP3 上传完成");

        // ── Step 4: Update RSS with new episode ──
        sendProgress(tabId, "updating_xml", 75, "📝 正在更新 RSS...");

        const existingItemCount = (xmlText.match(/<item>/g) || []).length;
        const episodeNum = episodeNumber || (existingItemCount + 1);
        const guidVal = uuid();
        const pubDate = new Date().toUTCString();

        const newItem = [
            "    <item>",
            `      <title>${escXml(epTitle)}</title>`,
            `      <description>${escXml(epDesc)}</description>`,
            `      <enclosure url="${escXml(mp3CdnUrl)}" type="audio/mpeg" length="${mp3ByteSize}" />`,
            `      <guid isPermaLink="false">${guidVal}</guid>`,
            `      <pubDate>${pubDate}</pubDate>`,
            `      <itunes:author>${escXml(channel.author)}</itunes:author>`,
            `      <itunes:summary>${escXml(epDesc)}</itunes:summary>`,
            `      <itunes:episode>${episodeNum}</itunes:episode>`,
            `      <itunes:episodeType>full</itunes:episodeType>`,
            `      <itunes:explicit>false</itunes:explicit>`,
            "    </item>",
        ].join("\n");

        let updatedXml = xmlText;
        const firstItemIdx = updatedXml.indexOf("<item>");
        if (firstItemIdx !== -1) {
            updatedXml = updatedXml.slice(0, firstItemIdx) + newItem + "\n" + updatedXml.slice(firstItemIdx);
        } else {
            const closeChannel = updatedXml.indexOf("</channel>");
            if (closeChannel === -1) throw new Error("RSS XML 格式错误: 缺少 </channel>");
            updatedXml = updatedXml.slice(0, closeChannel) + newItem + "\n  " + updatedXml.slice(closeChannel);
        }

        // Update or insert <lastBuildDate>
        if (updatedXml.includes("<lastBuildDate>")) {
            updatedXml = updatedXml.replace(
                /<lastBuildDate>[^<]*<\/lastBuildDate>/,
                `<lastBuildDate>${pubDate}</lastBuildDate>`
            );
        } else {
            const channelTagEnd = updatedXml.indexOf(">", updatedXml.indexOf("<channel"));
            if (channelTagEnd !== -1) {
                const insertPos = channelTagEnd + 1;
                updatedXml = updatedXml.slice(0, insertPos) +
                    `\n    <lastBuildDate>${pubDate}</lastBuildDate>` +
                    updatedXml.slice(insertPos);
            }
        }

        // ── Step 5: Upload updated RSS XML ──
        sendProgress(tabId, "uploading_xml", 90, "📤 正在上传 RSS...");
        await uploadToOss(config, channel.xmlPath, updatedXml, "application/xml; charset=utf-8");

        // ── Step 6: Update meta.json with episode title ──
        try {
            const mp3FileName = `audio_${audioId}.mp3`;
            meta[mp3FileName] = { title: epTitle, description: epDesc, publishedAt: pubDate, size: mp3ByteSize };
            await uploadToOss(config, metaPath, JSON.stringify(meta, null, 2), "application/json; charset=utf-8");
        } catch (err) {
            console.warn("[Background] Failed to update meta.json:", err);
        }

        // ── Done! ──
        sendProgress(tabId, "done", 100, `✅ 已发布「${epTitle}」到「${channel.title}」`);

    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendProgress(tabId, "error", 0, `❌ ${msg}`);
    }
}

// ── Port-based keepalive for long publish operations ──
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "podcast-publish") return;
    console.log("[Background] Podcast publish port connected (keepalive)");
    activePublishPort = port;

    port.onMessage.addListener((msg) => {
        if (msg.type === "PUBLISH_PODCAST") {
            // Use tabId 0 as a placeholder; progress goes through port
            publishPodcast(0, msg.payload);
        }
    });

    port.onDisconnect.addListener(() => {
        console.log("[Background] Podcast publish port disconnected");
        activePublishPort = null;
    });
});

// ── Message routing ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Podcast: forward transcode requests to offscreen document
    if (msg.type === "TRANSCODE_WAV" && msg.target === "offscreen") {
        return false; // Let it propagate to offscreen
    }

    // Podcast: publish pipeline (fallback for non-port callers)
    if (msg.type === "PUBLISH_PODCAST") {
        const tabId = sender.tab?.id || 0;
        publishPodcast(tabId, msg.payload);
        sendResponse({ ok: true });
        return false;
    }

    // Podcast: load config/channels for page.js
    if (msg.type === "LOAD_PODCAST_CONFIG") {
        (async () => {
            try {
                const config = await loadAliyunConfig();
                const channels = await loadChannels();
                sendResponse({ ok: true, config, channels });
            } catch (err) {
                sendResponse({ ok: false, error: err.message });
            }
        })();
        return true;
    }

    // Podcast: create new channel
    if (msg.type === "CREATE_PODCAST_CHANNEL") {
        (async () => {
            try {
                const config = await loadAliyunConfig();
                if (!config) throw new Error("未配置阿里云 OSS");
                const channels = await loadChannels();

                const { title, description, author, language, category, coverBase64, coverType, coverExt } = msg.payload;
                const channelId = uuid();
                const feedSecret = uuid().replace(/-/g, "").slice(0, 12);
                const xmlPath = `${channelId}/feed_${feedSecret}.xml`;

                let coverUrl = "";
                if (coverBase64) {
                    // Convert base64 to Blob, but since we're in SW we can just buffer it
                    const byteString = atob(coverBase64.split(',')[1] || coverBase64);
                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    for (let i = 0; i < byteString.length; i++) {
                        ia[i] = byteString.charCodeAt(i);
                    }
                    const coverPath = `${channelId}/cover.${coverExt || "jpg"}`;
                    coverUrl = await uploadToOss(config, coverPath, ab, coverType || "image/jpeg");
                }

                const newChannel = {
                    id: channelId,
                    title: title.trim(),
                    description: description.trim(),
                    author: author.trim(),
                    language: language.trim(),
                    category: category.trim(),
                    coverUrl,
                    xmlPath,
                    createdAt: new Date().toISOString(),
                };

                const skeletonXml = buildSkeletonRss(newChannel);
                await uploadToOss(config, xmlPath, skeletonXml, "application/xml; charset=utf-8");

                channels.push(newChannel);
                await saveChannels(channels);

                sendResponse({ ok: true, channel: newChannel });
            } catch (err) {
                sendResponse({ ok: false, error: err.message });
            }
        })();
        return true;
    }

    // Skip messages without an action (e.g. content script responses)
    if (!msg.action) return false;

    handleMessage(msg)
        .then(result => sendResponse({ ok: true, data: result }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
});

async function handleMessage(msg) {
    const { action, payload = {} } = msg;
    switch (action) {
        case "listNotebooks": return await api.listNotebooks();
        case "createNotebook": return await api.createNotebook(payload.title);
        case "deleteNotebook": return await api.deleteNotebook(payload.notebookId);
        case "renameNotebook": return await api.renameNotebook(payload.notebookId, payload.title);
        case "listSources": return await api.listSources(payload.notebookId);
        case "addSourceUrl": return await api.addSourceUrl(payload.notebookId, payload.url);
        case "deleteSource": return await api.deleteSource(payload.notebookId, payload.sourceId);
        case "askQuestion": return await api.askQuestion(payload.notebookId, payload.question);
        case "generateArtifact": return await api.generateArtifact(payload.notebookId, payload.typeCode, payload.variant, payload.instructions, null, payload.lang);
        case "listArtifacts": return await api.listArtifacts(payload.notebookId);
        case "getSummary": return await api.getSummary(payload.notebookId);
        default: throw new Error(`Unknown action: ${action}`);
    }
}
