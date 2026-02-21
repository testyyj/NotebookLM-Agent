/**
 * Aliyun OSS upload helper.
 * Uses direct REST API calls with V1 signature (HMAC-SHA1) — no SDK dependency.
 * Uses x-oss-date instead of Date header (Date is a forbidden header in Fetch API).
 *
 * V1 Signature StringToSign format:
 *   VERB + "\n" + Content-MD5 + "\n" + Content-Type + "\n" + Date + "\n"
 *   + CanonicalizedOSSHeaders + CanonicalizedResource
 *
 * When x-oss-date is used:
 *   - The Date field contains the x-oss-date value
 *   - x-oss-date is also listed in CanonicalizedOSSHeaders
 */
import { AliyunConfig } from "./types";

/**
 * Upload a file (Blob/string) to OSS via PUT request.
 * @returns The full CDN URL of the uploaded object.
 */
export async function uploadToOss(
    config: AliyunConfig,
    ossPath: string,
    data: Blob | string,
    contentType = "application/octet-stream"
): Promise<string> {
    const date = new Date().toUTCString();
    const canonicalResource = `/${config.bucket}/${ossPath}`;

    // x-oss-date value goes in BOTH the Date slot and CanonicalizedOSSHeaders
    const stringToSign = [
        "PUT",
        "",                        // Content-MD5 (empty)
        contentType,               // Content-Type
        date,                      // Date (= x-oss-date value)
        `x-oss-date:${date}`,      // CanonicalizedOSSHeaders
        canonicalResource,         // CanonicalizedResource
    ].join("\n");

    const signature = await hmacSha1(config.accessKeySecret, stringToSign);

    const host = `${config.bucket}.${config.region}.aliyuncs.com`;
    const url = `https://${host}/${ossPath}`;

    const response = await fetch(url, {
        method: "PUT",
        headers: {
            "Content-Type": contentType,
            "x-oss-date": date,
            "Authorization": `OSS ${config.accessKeyId}:${signature}`,
        },
        body: data,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OSS 上传失败 (${response.status}): ${extractOssError(errorText)}`);
    }

    const cdnBase = config.cdnDomain.replace(/\/+$/, "");
    return `${cdnBase}/${ossPath}`;
}

/**
 * Test connection by listing objects (max 1).
 */
export async function testOssConnection(config: AliyunConfig): Promise<boolean> {
    const date = new Date().toUTCString();
    const canonicalResource = `/${config.bucket}/`;

    const stringToSign = [
        "GET",
        "",                        // Content-MD5
        "",                        // Content-Type (none for GET)
        date,                      // Date (= x-oss-date value)
        `x-oss-date:${date}`,      // CanonicalizedOSSHeaders
        canonicalResource,         // CanonicalizedResource
    ].join("\n");

    const signature = await hmacSha1(config.accessKeySecret, stringToSign);

    const host = `${config.bucket}.${config.region}.aliyuncs.com`;
    const url = `https://${host}/?max-keys=1`;

    const response = await fetch(url, {
        method: "GET",
        headers: {
            "x-oss-date": date,
            "Authorization": `OSS ${config.accessKeyId}:${signature}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OSS 连接失败 (${response.status}): ${extractOssError(errorText)}`);
    }

    return true;
}

/** A single object returned from OSS listing */
export interface OssObject {
    key: string;
    size: number;
    lastModified: string;
}

/**
 * List objects in an OSS bucket with a given prefix.
 * Returns up to 1000 objects (single page — sufficient for podcast use).
 */
export async function listOssObjects(
    config: AliyunConfig,
    prefix: string
): Promise<OssObject[]> {
    const date = new Date().toUTCString();
    const canonicalResource = `/${config.bucket}/`;

    const stringToSign = [
        "GET",
        "",                        // Content-MD5
        "",                        // Content-Type (none for GET)
        date,                      // Date (= x-oss-date value)
        `x-oss-date:${date}`,      // CanonicalizedOSSHeaders
        canonicalResource,         // CanonicalizedResource
    ].join("\n");

    const signature = await hmacSha1(config.accessKeySecret, stringToSign);

    const host = `${config.bucket}.${config.region}.aliyuncs.com`;
    const url = `https://${host}/?prefix=${encodeURIComponent(prefix)}&max-keys=1000`;

    const response = await fetch(url, {
        method: "GET",
        headers: {
            "x-oss-date": date,
            "Authorization": `OSS ${config.accessKeyId}:${signature}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OSS 列表失败 (${response.status}): ${extractOssError(errorText)}`);
    }

    const xmlText = await response.text();
    const objects: OssObject[] = [];

    // Parse <Contents> elements from the response XML
    const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
    let match: RegExpExecArray | null;
    while ((match = contentsRegex.exec(xmlText)) !== null) {
        const block = match[1];
        const key = block.match(/<Key>(.*?)<\/Key>/)?.[1] || "";
        const size = parseInt(block.match(/<Size>(.*?)<\/Size>/)?.[1] || "0", 10);
        const lastModified = block.match(/<LastModified>(.*?)<\/LastModified>/)?.[1] || "";
        if (key) {
            objects.push({ key, size, lastModified });
        }
    }

    return objects;
}

/**
 * Delete a single object from OSS.
 */
export async function deleteOssObject(
    config: AliyunConfig,
    ossPath: string
): Promise<void> {
    const date = new Date().toUTCString();
    const canonicalResource = `/${config.bucket}/${ossPath}`;

    const stringToSign = [
        "DELETE",
        "",                        // Content-MD5
        "",                        // Content-Type
        date,                      // Date (= x-oss-date value)
        `x-oss-date:${date}`,      // CanonicalizedOSSHeaders
        canonicalResource,         // CanonicalizedResource
    ].join("\n");

    const signature = await hmacSha1(config.accessKeySecret, stringToSign);

    const host = `${config.bucket}.${config.region}.aliyuncs.com`;
    const url = `https://${host}/${ossPath}`;

    const response = await fetch(url, {
        method: "DELETE",
        headers: {
            "x-oss-date": date,
            "Authorization": `OSS ${config.accessKeyId}:${signature}`,
        },
    });

    // OSS returns 204 No Content on successful delete, or 200
    if (!response.ok && response.status !== 204) {
        const errorText = await response.text();
        throw new Error(`OSS 删除失败 (${response.status}): ${extractOssError(errorText)}`);
    }
}

/**
 * HMAC-SHA1 signing using Web Crypto API.
 * Returns base64-encoded signature.
 */
async function hmacSha1(key: string, message: string): Promise<string> {
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(key),
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
    return btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
}

/** Extract readable error message from OSS XML error response */
function extractOssError(xmlText: string): string {
    const match = xmlText.match(/<Message>(.*?)<\/Message>/);
    return match?.[1] || xmlText.slice(0, 200);
}
