/**
 * OSS helper for background service worker.
 * Pure JS — uses fetch + HMAC-SHA1 via Web Crypto API.
 *
 * V1 Signature: when using x-oss-date, the Date slot in StringToSign
 * contains the x-oss-date value, and x-oss-date is in CanonicalizedOSSHeaders.
 */

const STORAGE_KEY_ALIYUN = "podcast_aliyun_config";
const STORAGE_KEY_CHANNELS = "podcast_channels";

/**
 * Load Aliyun config from chrome.storage.local.
 */
export async function loadAliyunConfig() {
    const data = await chrome.storage.local.get(STORAGE_KEY_ALIYUN);
    return data[STORAGE_KEY_ALIYUN] ?? null;
}

/**
 * Load channels from chrome.storage.local.
 */
export async function loadChannels() {
    const data = await chrome.storage.local.get(STORAGE_KEY_CHANNELS);
    return data[STORAGE_KEY_CHANNELS] ?? [];
}

/**
 * HMAC-SHA1 signing using Web Crypto API.
 * @returns base64-encoded signature
 */
async function hmacSha1(key, message) {
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(key),
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"]
    );
    const buf = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

/**
 * Upload data to OSS via PUT.
 * @param {object} config - AliyunConfig { region, bucket, accessKeyId, accessKeySecret, cdnDomain }
 * @param {string} ossPath - Object key, e.g. "ch_uuid/audio/file.mp3"
 * @param {Blob|string|ArrayBuffer} data - File data
 * @param {string} contentType
 * @returns {string} CDN URL of the uploaded object
 */
export async function uploadToOss(config, ossPath, data, contentType = "application/octet-stream") {
    const date = new Date().toUTCString();
    const canonicalResource = `/${config.bucket}/${ossPath}`;

    const stringToSign = [
        "PUT", "", contentType, date,
        `x-oss-date:${date}`,
        canonicalResource,
    ].join("\n");

    const signature = await hmacSha1(config.accessKeySecret, stringToSign);
    const host = `${config.bucket}.${config.region}.aliyuncs.com`;

    const body = data instanceof ArrayBuffer ? new Blob([data]) : data;

    const resp = await fetch(`https://${host}/${ossPath}`, {
        method: "PUT",
        headers: {
            "Content-Type": contentType,
            "x-oss-date": date,
            "Authorization": `OSS ${config.accessKeyId}:${signature}`,
        },
        body,
    });

    if (!resp.ok) {
        const txt = await resp.text();
        const msg = txt.match(/<Message>(.*?)<\/Message>/)?.[1] || txt.slice(0, 200);
        throw new Error(`OSS 上传失败 (${resp.status}): ${msg}`);
    }

    return `${config.cdnDomain.replace(/\/+$/, "")}/${ossPath}`;
}

/**
 * List objects in an OSS bucket with a given prefix.
 * @param {object} config - AliyunConfig
 * @param {string} prefix - Object key prefix, e.g. "ch_uuid/audio/"
 * @returns {Array<{key: string, size: number, lastModified: string}>}
 */
export async function listOssObjects(config, prefix) {
    const date = new Date().toUTCString();
    const canonicalResource = `/${config.bucket}/`;

    const stringToSign = [
        "GET", "", "", date,
        `x-oss-date:${date}`,
        canonicalResource,
    ].join("\n");

    const signature = await hmacSha1(config.accessKeySecret, stringToSign);
    const host = `${config.bucket}.${config.region}.aliyuncs.com`;

    const resp = await fetch(`https://${host}/?prefix=${encodeURIComponent(prefix)}&max-keys=1000`, {
        method: "GET",
        headers: {
            "x-oss-date": date,
            "Authorization": `OSS ${config.accessKeyId}:${signature}`,
        },
    });

    if (!resp.ok) {
        const txt = await resp.text();
        const msg = txt.match(/<Message>(.*?)<\/Message>/)?.[1] || txt.slice(0, 200);
        throw new Error(`OSS 列表失败 (${resp.status}): ${msg}`);
    }

    const xmlText = await resp.text();
    const objects = [];
    const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
    let match;
    while ((match = contentsRegex.exec(xmlText)) !== null) {
        const block = match[1];
        const key = block.match(/<Key>(.*?)<\/Key>/)?.[1] || "";
        const size = parseInt(block.match(/<Size>(.*?)<\/Size>/)?.[1] || "0", 10);
        const lastModified = block.match(/<LastModified>(.*?)<\/LastModified>/)?.[1] || "";
        if (key) objects.push({ key, size, lastModified });
    }
    return objects;
}

/**
 * Delete a single object from OSS.
 * @param {object} config - AliyunConfig
 * @param {string} ossPath - Object key to delete
 */
export async function deleteOssObject(config, ossPath) {
    const date = new Date().toUTCString();
    const canonicalResource = `/${config.bucket}/${ossPath}`;

    const stringToSign = [
        "DELETE", "", "", date,
        `x-oss-date:${date}`,
        canonicalResource,
    ].join("\n");

    const signature = await hmacSha1(config.accessKeySecret, stringToSign);
    const host = `${config.bucket}.${config.region}.aliyuncs.com`;

    const resp = await fetch(`https://${host}/${ossPath}`, {
        method: "DELETE",
        headers: {
            "x-oss-date": date,
            "Authorization": `OSS ${config.accessKeyId}:${signature}`,
        },
    });

    if (!resp.ok && resp.status !== 204) {
        const txt = await resp.text();
        const msg = txt.match(/<Message>(.*?)<\/Message>/)?.[1] || txt.slice(0, 200);
        throw new Error(`OSS 删除失败 (${resp.status}): ${msg}`);
    }
}

/**
 * Fetch a file from CDN/OSS by URL.
 * @returns {string} text content
 */
export async function fetchText(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`获取失败: HTTP ${resp.status}`);
    return resp.text();
}

/**
 * Generate a UUID v4 (crypto-based).
 */
export function uuid() {
    return crypto.randomUUID();
}

/**
 * Save channels to chrome.storage.local.
 */
export async function saveChannels(channels) {
    if (!channels || !Array.isArray(channels)) return;
    await chrome.storage.local.set({ [STORAGE_KEY_CHANNELS]: channels });
}

/**
 * Build initial empty RSS XML for a new channel.
 */
export function buildSkeletonRss(channel) {
    const esc = (str) => String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
  <channel>
    <title>${esc(channel.title)}</title>
    <link>https://notebooklm.google.com/</link>
    <language>${esc(channel.language)}</language>
    <itunes:author>${esc(channel.author)}</itunes:author>
    <itunes:summary>${esc(channel.description)}</itunes:summary>
    <description>${esc(channel.description)}</description>
    <itunes:type>serial</itunes:type>
    <itunes:owner>
      <itunes:name>${esc(channel.author)}</itunes:name>
    </itunes:owner>
    ${channel.coverUrl ? `<itunes:image href="${esc(channel.coverUrl)}" />` : ""}
    <itunes:category text="${esc(channel.category)}" />
  </channel>
</rss>`;
}
