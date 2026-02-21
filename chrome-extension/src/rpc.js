/**
 * NotebookLM batchexecute RPC protocol — JavaScript port.
 * Ported from notebooklm-py/rpc/encoder.py + decoder.py
 */

// ── API endpoint ──
export const BATCHEXECUTE_URL =
    "https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute";

// ── RPC Method IDs (reverse-engineered from traffic analysis) ──
export const RPC = Object.freeze({
    // Notebook
    LIST_NOTEBOOKS: "wXbhsf",
    CREATE_NOTEBOOK: "CCqFvf",
    GET_NOTEBOOK: "rLM1Ne",
    RENAME_NOTEBOOK: "s0tc2d",
    DELETE_NOTEBOOK: "WWINqb",
    // Source
    ADD_SOURCE: "izAoDd",
    DELETE_SOURCE: "tGMBJ",
    GET_SOURCE: "hizoJc",
    REFRESH_SOURCE: "FLmJqe",
    // Summary & Guide
    SUMMARIZE: "VfAZjd",
    GET_SOURCE_GUIDE: "tr032e",
    // Artifact
    CREATE_ARTIFACT: "R7cb6c",
    LIST_ARTIFACTS: "gArtLc",
    DELETE_ARTIFACT: "V5N4be",
    RENAME_ARTIFACT: "rc3d8d",
    EXPORT_ARTIFACT: "Krh3pd",
    GET_INTERACTIVE_HTML: "v9rmvd",
    // Research
    START_FAST_RESEARCH: "Ljjv0c",
    POLL_RESEARCH: "e3bVqc",
    IMPORT_RESEARCH: "LBwxtb",
    // Conversation
    GET_CONVERSATION_HISTORY: "hPTbtc",
});

// ── Artifact type codes ──
export const ArtifactType = Object.freeze({
    AUDIO: 1,
    REPORT: 2,
    VIDEO: 3,
    QUIZ: 4,
    MIND_MAP: 5,
    INFOGRAPHIC: 7,
    SLIDE_DECK: 8,
    DATA_TABLE: 9,
});

// ── Encoder ──

/**
 * Encode an RPC request into batchexecute format.
 * Returns triple-nested array: [[[rpcId, jsonParams, null, "generic"]]]
 */
export function encodeRpcRequest(rpcId, params) {
    const paramsJson = JSON.stringify(params);
    return [[[rpcId, paramsJson, null, "generic"]]];
}

/**
 * Build form-encoded request body for batchexecute.
 * @returns {string} URL-encoded body with trailing &
 */
export function buildRequestBody(rpcRequest, csrfToken) {
    const fReq = JSON.stringify(rpcRequest);
    let body = `f.req=${encodeURIComponent(fReq)}`;
    if (csrfToken) {
        body += `&at=${encodeURIComponent(csrfToken)}`;
    }
    body += "&";
    return body;
}

/**
 * Build the full batchexecute URL with query parameters.
 */
export function buildUrl(rpcId, sourcePath = "/", sessionId = null, buildLabel = null) {
    const params = new URLSearchParams({
        rpcids: rpcId,
        "source-path": sourcePath,
        rt: "c",
    });
    if (sessionId) params.set("f.sid", sessionId);
    if (buildLabel) params.set("bl", buildLabel);
    params.set("hl", "zh-CN");
    return `${BATCHEXECUTE_URL}?${params.toString()}`;
}

// ── Decoder ──

/**
 * Strip Google anti-XSSI prefix: )]}' followed by newline.
 */
export function stripAntiXssi(text) {
    const match = text.match(/^\)\]\}'\r?\n/);
    return match ? text.slice(match[0].length) : text;
}

/**
 * Parse chunked response (rt=c mode).
 * Format: alternating lines of byte_count and JSON payload.
 */
export function parseChunkedResponse(text) {
    if (!text || !text.trim()) return [];
    const lines = text.trim().split("\n");
    const chunks = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();
        if (!line) { i++; continue; }
        // Try as byte-count line
        if (/^\d+$/.test(line)) {
            i++;
            if (i < lines.length) {
                try { chunks.push(JSON.parse(lines[i])); } catch { /* skip */ }
            }
            i++;
        } else {
            try { chunks.push(JSON.parse(line)); } catch { /* skip */ }
            i++;
        }
    }
    return chunks;
}

/**
 * Extract result data for a specific RPC ID from parsed chunks.
 * @throws {Error} on RPC error response
 */
export function extractRpcResult(chunks, rpcId) {
    for (const chunk of chunks) {
        if (!Array.isArray(chunk)) continue;
        const items = (chunk.length && Array.isArray(chunk[0])) ? chunk : [chunk];
        for (const item of items) {
            if (!Array.isArray(item) || item.length < 3) continue;
            // Error response
            if (item[0] === "er" && item[1] === rpcId) {
                throw new Error(`RPC error for ${rpcId}: code ${item[2]}`);
            }
            // Success response
            if (item[0] === "wrb.fr" && item[1] === rpcId) {
                const data = item[2];
                if (typeof data === "string") {
                    try { return JSON.parse(data); } catch { return data; }
                }
                return data;
            }
        }
    }
    return null;
}

/**
 * Complete decode pipeline: strip prefix → parse chunks → extract result.
 */
export function decodeResponse(rawText, rpcId) {
    const cleaned = stripAntiXssi(rawText);
    const chunks = parseChunkedResponse(cleaned);
    return extractRpcResult(chunks, rpcId);
}
