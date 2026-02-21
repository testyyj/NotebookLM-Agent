/**
 * High-level NotebookLM API — wraps RPC calls into friendly methods.
 */
import {
    RPC, ArtifactType,
    encodeRpcRequest, buildRequestBody, buildUrl, decodeResponse,
    stripAntiXssi, parseChunkedResponse,
} from "./rpc.js";
import { getTokens, invalidateTokens } from "./auth.js";

// ── Internal: make an RPC call ──

async function rpcCall(rpcId, params, sourcePath = "/") {
    const { csrfToken, sessionId, buildLabel } = await getTokens();
    const url = buildUrl(rpcId, sourcePath, sessionId, buildLabel);
    const body = buildRequestBody(
        encodeRpcRequest(rpcId, params),
        csrfToken,
    );

    console.log(`[NB Agent] RPC ${rpcId} →`, JSON.stringify(params)?.slice(0, 300));

    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        credentials: "include",
        body,
    });

    if (resp.status === 401 || resp.status === 403) {
        invalidateTokens();
        throw new Error("认证已过期，请刷新页面后重试");
    }
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    const text = await resp.text();
    console.log(`[NB Agent] RPC ${rpcId} response size: ${text.length}`);

    const result = decodeResponse(text, rpcId);
    // Delete/mutation RPCs legitimately return null
    const MUTATION_RPCS = [RPC.DELETE_ARTIFACT, RPC.DELETE_SOURCE, RPC.DELETE_NOTEBOOK, RPC.RENAME_ARTIFACT, RPC.RENAME_NOTEBOOK];
    if (result === null && !MUTATION_RPCS.includes(rpcId)) {
        console.warn(`[NB Agent] RPC ${rpcId} decoded null. Raw response:`, text.slice(0, 500));
    }
    console.log(`[NB Agent] RPC ${rpcId} decoded:`, JSON.stringify(result)?.slice(0, 500));
    return result;
}

// ══════════════════════════════════════
// Notebook API
// ══════════════════════════════════════

export async function listNotebooks() {
    const data = await rpcCall(RPC.LIST_NOTEBOOKS, [null, 1, null, [2]]);
    if (!Array.isArray(data)) return [];

    const notebooks = [];
    const entries = data[0];
    if (!Array.isArray(entries)) return [];

    for (const entry of entries) {
        if (!Array.isArray(entry)) continue;
        try {
            const title = (typeof entry[0] === "string"
                ? entry[0].replace("thought\n", "").trim()
                : "Untitled");
            const id = entry[2];
            if (!id || typeof id !== "string") continue;

            // Extract creation timestamp: scan entry for [seconds, nanoseconds] pairs
            let createdAt = null;
            function findTimestamp(arr, depth) {
                if (depth > 4 || !Array.isArray(arr) || createdAt) return;
                if (arr.length === 2 && typeof arr[0] === "number" && typeof arr[1] === "number"
                    && arr[0] > 1_000_000_000 && arr[0] < 2_000_000_000) {
                    createdAt = arr[0] * 1000; // convert seconds to JS milliseconds
                    return;
                }
                for (const item of arr) {
                    if (Array.isArray(item)) findTimestamp(item, depth + 1);
                }
            }
            findTimestamp(entry, 0);

            // Debug: log raw entry to help identify timestamp location
            console.log("[NB Agent] Raw notebook entry:", id, JSON.stringify(entry).slice(0, 500));

            notebooks.push({ id, title, sourceCount: 0, createdAt });
        } catch { /* skip malformed */ }
    }
    return notebooks;
}

export async function createNotebook(title) {
    return await rpcCall(RPC.CREATE_NOTEBOOK, [title || "Untitled", null, null, [2], [1]]);
}

export async function deleteNotebook(notebookId) {
    return await rpcCall(RPC.DELETE_NOTEBOOK, [[notebookId], [2]]);
}

export async function renameNotebook(notebookId, newTitle) {
    return await rpcCall(RPC.RENAME_NOTEBOOK,
        [notebookId, [[null, null, null, [null, newTitle]]]],
        "/"
    );
}

// ══════════════════════════════════════
// Source API
// ══════════════════════════════════════

/**
 * List sources by calling GET_NOTEBOOK RPC.
 * Python SDK: params = [notebook_id, None, [2], None, 0]
 * Response: data[0][1] = array of sources
 * Each source: src[0] = [sourceId] or sourceId, src[1] = title
 */
export async function listSources(notebookId) {
    const data = await rpcCall(RPC.GET_NOTEBOOK,
        [notebookId, null, [2], null, 0],
        `/notebook/${notebookId}`
    );
    const sources = [];
    try {
        // Response: data[0] = notebook info, data[0][1] = sources array
        if (!Array.isArray(data) || data.length === 0) return sources;
        const nbInfo = data[0];
        if (!Array.isArray(nbInfo) || nbInfo.length < 2) return sources;
        const srcList = nbInfo[1];
        if (!Array.isArray(srcList)) return sources;

        const SOURCE_TYPE_LABELS = {
            1: "Google Docs", 2: "Google Slides", 3: "PDF", 4: "粘贴文本",
            5: "网页", 8: "Markdown", 9: "YouTube", 10: "媒体", 11: "Word",
            13: "图片", 14: "表格", 16: "CSV",
        };

        for (const s of srcList) {
            if (!Array.isArray(s) || s.length === 0) continue;

            // Source ID: s[0] is [sourceId] or sourceId
            let id = null;
            if (Array.isArray(s[0]) && s[0].length > 0) id = s[0][0];
            else if (typeof s[0] === "string") id = s[0];
            if (!id) continue;

            const title = (typeof s[1] === "string") ? s[1] : "Untitled Source";

            // URL at s[2][7][0]
            let url = null;
            if (s.length > 2 && Array.isArray(s[2]) && s[2].length > 7) {
                if (Array.isArray(s[2][7]) && s[2][7].length > 0) {
                    url = s[2][7][0];
                }
            }

            // Source type code at s[2][4]
            let typeCode = null;
            if (s.length > 2 && Array.isArray(s[2]) && s[2].length > 4) {
                typeCode = typeof s[2][4] === "number" ? s[2][4] : null;
            }

            const typeLabel = typeCode ? (SOURCE_TYPE_LABELS[typeCode] || `类型 ${typeCode}`) : "";
            sources.push({ id, title, url, typeCode, typeLabel });
        }
    } catch (e) {
        console.error("[NB Agent] Error parsing sources:", e);
    }
    return sources;
}

export async function addSourceUrl(notebookId, url) {
    const params = [
        [[null, null, [url], null, null, null, null, null]],
        notebookId,
        [2],
        null,
        null,
    ];
    return await rpcCall(RPC.ADD_SOURCE, params, `/notebook/${notebookId}`);
}

export async function deleteSource(notebookId, sourceId) {
    return await rpcCall(RPC.DELETE_SOURCE,
        [[[sourceId]]],
        `/notebook/${notebookId}`
    );
}

/**
 * Get full indexed text of a source.
 * Python SDK: params = [[sourceId], [2], [2]]
 */
export async function getSourceFulltext(notebookId, sourceId) {
    const data = await rpcCall(RPC.GET_SOURCE,
        [[sourceId], [2], [2]],
        `/notebook/${notebookId}`
    );

    let title = "";
    let content = "";
    let url = null;

    if (Array.isArray(data)) {
        // Title at data[0][1]
        if (Array.isArray(data[0]) && data[0].length > 1) {
            title = typeof data[0][1] === "string" ? data[0][1] : "";
            // URL at data[0][2][7][0]
            if (data[0].length > 2 && Array.isArray(data[0][2]) && data[0][2].length > 7) {
                if (Array.isArray(data[0][2][7]) && data[0][2][7].length > 0) {
                    url = data[0][2][7][0];
                }
            }
        }
        // Content blocks at data[3][0]
        if (data.length > 3 && Array.isArray(data[3]) && data[3].length > 0) {
            content = extractAllText(data[3][0]).join("\n");
        }
    }

    return { sourceId, title, content, url, charCount: content.length };
}

function extractAllText(data, depth = 0) {
    if (depth > 100 || !Array.isArray(data)) return [];
    const texts = [];
    for (const item of data) {
        if (typeof item === "string" && item.length > 0) texts.push(item);
        else if (Array.isArray(item)) texts.push(...extractAllText(item, depth + 1));
    }
    return texts;
}

// ══════════════════════════════════════
// Chat (RAG) API
// ══════════════════════════════════════

const QUERY_URL =
    "https://notebooklm.google.com/_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.LabsTailwindOrchestrationService/GenerateFreeFormStreamed";

/**
 * Ask a question — faithfully replicates Python SDK's _chat.py ask() method.
 *
 * Key differences from batchexecute:
 *   - f.req = [null, paramsJson]   (NOT the triple-nested batchexecute format)
 *   - URL needs: bl, hl, _reqid, rt=c, f.sid
 *   - Response is chunked like batchexecute (wrb.fr items)
 */
let _reqidCounter = 100000;

export async function askQuestion(notebookId, question, onChunk = null) {
    const { csrfToken, sessionId, buildLabel } = await getTokens();

    // Get source IDs first
    const sources = await listSources(notebookId);
    const sourceIds = sources.map(s => s.id);
    const sourcesArray = sourceIds.map(sid => [[sid]]);

    // Build conversation-id (new conversation each time in the extension)
    const conversationId = crypto.randomUUID();

    // Build params exactly like Python SDK
    const params = [
        sourcesArray,        // [[[sid1]], [[sid2]], ...]
        question,            // question text
        null,                // conversation_history (null for new conversation)
        [2, null, [1]],      // options
        conversationId,      // conversation_id
    ];

    const paramsJson = JSON.stringify(params);
    const fReq = [null, paramsJson];
    const fReqJson = JSON.stringify(fReq);
    const encodedReq = encodeURIComponent(fReqJson);

    let bodyStr = `f.req=${encodedReq}`;
    if (csrfToken) {
        bodyStr += `&at=${encodeURIComponent(csrfToken)}`;
    }
    bodyStr += "&";

    // Build URL with required params — use dynamic buildLabel from page
    _reqidCounter += 100000;
    const urlParams = new URLSearchParams({
        hl: "en",
        _reqid: String(_reqidCounter),
        rt: "c",
    });
    if (buildLabel) urlParams.set("bl", buildLabel);
    if (sessionId) urlParams.set("f.sid", sessionId);
    const url = `${QUERY_URL}?${urlParams.toString()}`;

    console.log("[NB Agent] Chat →", question.slice(0, 100));

    // Use AbortController to enforce a total timeout
    const controller = new AbortController();
    const TOTAL_TIMEOUT_MS = 90_000; // 90 seconds max
    const timeoutId = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);

    let resp;
    try {
        resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            credentials: "include",
            body: bodyStr,
            signal: controller.signal,
        });
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === "AbortError") throw new Error("请求超时，请稍后重试");
        throw err;
    }

    if (!resp.ok) {
        clearTimeout(timeoutId);
        throw new Error(`Chat HTTP ${resp.status}`);
    }

    // Stream the response — parse each chunk for answer text and call onChunk
    let longestAnswer = "";
    let accumulated = ""; // raw text accumulated so far

    try {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        const CHUNK_TIMEOUT_MS = 30_000; // 30s inactivity timeout

        while (true) {
            const chunkTimer = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("chunk_timeout")), CHUNK_TIMEOUT_MS)
            );
            let result;
            try {
                result = await Promise.race([reader.read(), chunkTimer]);
            } catch (err) {
                console.warn("[NB Agent] Chat stream inactivity timeout, using partial response");
                try { reader.cancel(); } catch (_) { }
                break;
            }
            if (result.done) break;

            accumulated += decoder.decode(result.value, { stream: true });

            // Try to extract answer from accumulated text so far
            const candidate = _extractBestAnswer(accumulated);
            if (candidate && candidate.length > longestAnswer.length) {
                longestAnswer = candidate;
                if (onChunk) onChunk(longestAnswer);
            }
        }
    } catch (err) {
        if (err.name === "AbortError") {
            throw new Error("请求超时，请稍后重试");
        }
        if (!accumulated) throw err;
        console.warn("[NB Agent] Chat stream error, using partial response:", err.message);
    } finally {
        clearTimeout(timeoutId);
    }

    // Final parse of complete accumulated text
    const finalCandidate = _extractBestAnswer(accumulated);
    if (finalCandidate && finalCandidate.length > longestAnswer.length) {
        longestAnswer = finalCandidate;
    }

    console.log("[NB Agent] Chat response size:", accumulated.length, "answer:", longestAnswer.length);
    return longestAnswer || "（未获取到回答，请检查笔记本是否有数据源）";
}

/**
 * Extract the longest answer text from raw streamed response text.
 * Parses the chunked wrb.fr format and finds the longest string in innerData[0][0].
 */
function _extractBestAnswer(rawText) {
    let best = "";
    try {
        const cleaned = stripAntiXssi(rawText);
        const chunks = parseChunkedResponse(cleaned);
        for (const chunk of chunks) {
            if (!Array.isArray(chunk)) continue;
            const items = (chunk.length && Array.isArray(chunk[0])) ? chunk : [chunk];
            for (const item of items) {
                if (!Array.isArray(item) || item.length < 3) continue;
                if (item[0] !== "wrb.fr") continue;
                const innerJson = item[2];
                if (typeof innerJson !== "string") continue;
                try {
                    const innerData = JSON.parse(innerJson);
                    if (Array.isArray(innerData) && innerData.length > 0) {
                        const first = innerData[0];
                        if (Array.isArray(first) && first.length > 0 && typeof first[0] === "string") {
                            if (first[0].length > best.length) {
                                best = first[0];
                            }
                        }
                    }
                } catch { /* skip partial JSON */ }
            }
        }
    } catch { /* parsing error on partial data, ok */ }
    return best;
}

// ══════════════════════════════════════
// Artifact API
// ══════════════════════════════════════

export async function generateArtifact(notebookId, typeCode, variant = null, instructions = null, sourceIds = null, lang = "zh") {
    // Build the inner artifact spec: [null, null, typeCode, sourceIds, ...options]
    // If sourceIds provided, use only those; otherwise fetch all sources
    const sources = sourceIds ? sourceIds : await listSources(notebookId);
    const sourceIdsTriple = sources.map(s => [[s.id]]);

    const spec = [null, null, typeCode, sourceIdsTriple];

    // Add type-specific options per the Python SDK format
    if (typeCode === 2) {
        // Report: spec has options at index [7] → [null, [title, desc, null, sourceIdsDouble, lang, prompt, null, true]]
        const sourceIdsDouble = sources.map(s => [s.id]);
        const reportConfigs = {
            briefing_doc: {
                title: "Briefing Doc",
                description: "Key insights and important quotes",
                prompt: "Create a comprehensive briefing document that includes an Executive Summary, detailed analysis of key themes, important quotes with context, and actionable insights.",
            },
            study_guide: {
                title: "Study Guide",
                description: "Short-answer quiz, essay questions, glossary",
                prompt: "Create a comprehensive study guide that includes key concepts, short-answer practice questions, essay prompts for deeper exploration, and a glossary of important terms.",
            },
            blog_post: {
                title: "Blog Post",
                description: "Insightful takeaways in readable article format",
                prompt: "Write an engaging blog post that presents the key insights in an accessible, reader-friendly format. Include an attention-grabbing introduction, well-organized sections, and a compelling conclusion with takeaways.",
            },
        };
        const cfg = reportConfigs[variant] || reportConfigs.briefing_doc;
        // Pad spec to length 8: [null, null, 2, sources, null, null, null, [null, [...]]]
        spec.push(null, null, null); // indices 4,5,6
        const prompt = instructions || cfg.prompt;
        spec.push([null, [cfg.title, cfg.description, null, sourceIdsDouble, lang, prompt, null, true]]);

    } else if (typeCode === 4) {
        // Quiz/Flashcards: variant "quiz"=2, "flashcards"=1
        const variantCode = variant === "flashcards" ? 1 : 2;
        // Pad spec to length 10: indices 4..9
        spec.push(null, null, null, null, null); // indices 4,5,6,7,8
        spec.push([null, [variantCode, null, null, null, null, null, null, [null, null]]]); // index 9

    } else if (typeCode === 1) {
        // Audio: options at index [6] → [null, [instructions, lengthCode, null, sourceIdsDouble, lang, null, formatCode]]
        // Format codes: deep_dive=1, brief=2, critique=3, debate=4
        const AUDIO_FORMAT = { deep_dive: 1, brief: 2, critique: 3, debate: 4 };
        const formatCode = AUDIO_FORMAT[variant] || null;
        const sourceIdsDouble = sources.map(s => [s.id]);
        spec.push(null, null); // indices 4,5
        spec.push([null, [instructions, null, null, sourceIdsDouble, lang, null, formatCode]]); // index 6

    } else if (typeCode === 3) {
        // Video: options at index [8] → [null, null, [sourceIdsDouble, lang, instructions, null, formatCode, styleCode]]
        const sourceIdsDouble = sources.map(s => [s.id]);
        spec.push(null, null, null, null); // indices 4,5,6,7
        spec.push([null, null, [sourceIdsDouble, lang, instructions, null, null, null]]); // index 8

    } else if (typeCode === 8) {
        // Slide Deck: options at index [16] → [[instructions, lang, formatCode, lengthCode]]
        // Format: detailed=1, presenter=2; Length: DEFAULT=1, SHORT=2 (no LONG)
        const SLIDE_FORMAT = { detailed: 1, presenter: 2 };
        const formatCode = SLIDE_FORMAT[variant] || 1;
        const lengthCode = 1; // DEFAULT (no LONG available, user prefers longest)
        // Pad spec to index 16: indices 4..15 are null
        for (let i = 0; i < 12; i++) spec.push(null);
        spec.push([[instructions, lang, formatCode, lengthCode]]); // index 16

    }
    // For other types (5=mind_map, 7=infographic, 9=data_table), use minimal spec

    const params = [[2], notebookId, spec];
    return await rpcCall(RPC.CREATE_ARTIFACT, params, `/notebook/${notebookId}`);
}

/**
 * Rename an artifact.
 * RPC: rc3d8d, params = [[artifactId, newTitle], [["title"]]]
 * (Derived from Python SDK: notebooklm/_artifacts.py)
 */
export async function renameArtifact(notebookId, artifactId, newTitle) {
    return await rpcCall(RPC.RENAME_ARTIFACT,
        [[artifactId, newTitle], [["title"]]],
        `/notebook/${notebookId}`
    );
}

/**
 * Delete an artifact.
 * RPC: V5N4be (DELETE_STUDIO), params = [[2], artifactId]
 */
export async function deleteArtifact(notebookId, artifactId) {
    return await rpcCall(RPC.DELETE_ARTIFACT,
        [[2], artifactId],
        `/notebook/${notebookId}`
    );
}

/**
 * List artifacts with parsed metadata.
 * Python SDK: params = [[2], notebookId, 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"']
 * Response: result[0] is the actual artifacts array
 */
export async function listArtifacts(notebookId) {
    const data = await rpcCall(RPC.LIST_ARTIFACTS,
        [[2], notebookId, 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"'],
        `/notebook/${notebookId}`
    );

    const artifacts = [];
    try {
        // Response: data is the top-level, data[0] is the array of artifacts
        let artList = data;
        if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
            // Check if data[0] is an artifact (has string ID at [0]) or an array of artifacts
            if (data[0].length > 0 && Array.isArray(data[0][0])) {
                // data[0] is the artifacts array
                artList = data[0];
            }
        }

        if (!Array.isArray(artList)) return artifacts;

        for (const item of artList) {
            if (!Array.isArray(item)) continue;
            const id = item[0];
            if (!id || typeof id !== "string") continue;

            // Debug: log raw item for mapping analysis
            console.log("[NB Agent] Raw artifact item:", id, JSON.stringify(item).slice(0, 500));

            const title = (typeof item[1] === "string") ? item[1] : "";
            const typeCode = (typeof item[2] === "number") ? item[2] : 0;
            const status = (typeof item[4] === "number") ? item[4] : 0;
            // status: 1=processing, 2=pending, 3=completed, 4=failed

            // Extract source IDs: scan item[3] and item[5] for source ID arrays
            // Source IDs are UUID-like strings (e.g. "abc12345-...")
            const sourceIds = extractSourceIds(item);

            // Extract download URL if available
            let downloadUrl = null;
            // Audio: metadata at item[6][5]→ media list, find URL
            if (typeCode === 1 && Array.isArray(item[6]) && item[6].length > 5 && Array.isArray(item[6][5])) {
                for (const m of item[6][5]) {
                    if (Array.isArray(m) && m.length > 0 && typeof m[0] === "string" && m[0].startsWith("http")) {
                        downloadUrl = m[0]; break;
                    }
                }
            }
            // Video: metadata at item[8]
            if (typeCode === 3 && item.length > 8 && Array.isArray(item[8])) {
                for (const sub of item[8]) {
                    if (Array.isArray(sub) && sub.length > 0 && Array.isArray(sub[0]) && typeof sub[0][0] === "string" && sub[0][0].startsWith("http")) {
                        downloadUrl = sub[0][0]; break;
                    }
                }
            }
            // Report: markdown at item[7][0]
            let reportContent = null;
            if (typeCode === 2 && item.length > 7 && Array.isArray(item[7]) && typeof item[7][0] === "string") {
                reportContent = item[7][0];
            }
            // Slide deck: PDF at item[16][3]
            if (typeCode === 8 && item.length > 16 && Array.isArray(item[16]) && item[16].length > 3) {
                const pdfUrl = item[16][3];
                if (typeof pdfUrl === "string" && pdfUrl.startsWith("http")) downloadUrl = pdfUrl;
            }

            // Extract format type for podcasts and slides
            let formatType = null;
            if (typeCode === 1) {
                // Audio format code at item[6][1][6]:
                //   1 = Deep Dive, 2 = Brief, 3 = Critique, 4 = Debate
                //   Missing/undefined → Deep Dive (default)
                const AUDIO_FORMAT_LABELS = { 1: "Deep Dive", 2: "Brief", 3: "Critique", 4: "Debate" };
                try {
                    if (Array.isArray(item[6]) && Array.isArray(item[6][1])) {
                        const meta = item[6][1];
                        if (meta.length > 6 && typeof meta[6] === "number") {
                            formatType = AUDIO_FORMAT_LABELS[meta[6]] || "Deep Dive";
                        } else {
                            // No format code → default Deep Dive
                            formatType = "Deep Dive";
                        }
                    }
                } catch { /* ignore */ }
            } else if (typeCode === 8) {
                // Slide format code at item[16][0][2]:
                //   1 = Detailed, 2 = Presenter
                const SLIDE_FORMAT_LABELS = { 1: "Detailed", 2: "Presenter" };
                try {
                    if (Array.isArray(item[16])) {
                        if (Array.isArray(item[16][0]) && typeof item[16][0][2] === "number") {
                            formatType = SLIDE_FORMAT_LABELS[item[16][0][2]] || null;
                        }
                        if (!formatType && typeof item[16][2] === "number") {
                            formatType = SLIDE_FORMAT_LABELS[item[16][2]] || null;
                        }
                    }
                } catch { /* ignore */ }
            }

            // Extract creation timestamp: item[15] = [seconds, nanoseconds]
            let createdAt = null;
            if (item.length > 15 && Array.isArray(item[15]) && typeof item[15][0] === "number") {
                createdAt = item[15][0] * 1000; // convert to JS milliseconds
            }

            artifacts.push({ id, title, typeCode, status, downloadUrl, reportContent, sourceIds, formatType, createdAt });
        }
    } catch (e) {
        console.error("[NB Agent] Error parsing artifacts:", e);
    }
    return artifacts;
}

/**
 * Scan an artifact item for embedded source IDs.
 * NotebookLM may embed source references as UUID strings in various positions.
 */
function extractSourceIds(item) {
    const ids = new Set();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    function scan(val, depth = 0) {
        if (depth > 6) return; // prevent deep recursion
        if (typeof val === "string" && uuidRegex.test(val)) {
            // Don't add the artifact's own ID
            if (val !== item[0]) ids.add(val);
        }
        if (Array.isArray(val)) {
            for (const v of val) scan(v, depth + 1);
        }
    }

    // Scan likely positions: item[3], item[5] (common places for source refs)
    if (item.length > 3) scan(item[3], 0);
    if (item.length > 5) scan(item[5], 0);

    return [...ids];
}

// ══════════════════════════════════════
// Summary API
// ══════════════════════════════════════

export async function getSummary(notebookId) {
    return await rpcCall(RPC.SUMMARIZE, [notebookId, [2]], `/notebook/${notebookId}`);
}

// ── Re-export ──
export { ArtifactType };
