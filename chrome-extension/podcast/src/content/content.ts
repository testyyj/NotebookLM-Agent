/**
 * Content script injected into notebooklm.google.com.
 *
 * Responsibilities:
 * 1. Scrape the page for source titles and AI-generated summary text.
 * 2. Listen for messages from the popup to return scraped data.
 * 3. The popup handles WAV file selection via a manual file input
 *    (intercepting browser-generated blobs is unreliable in MV3).
 */

/** Scrape source titles from the NotebookLM page */
function scrapeSourceTitles(): string[] {
    // NotebookLM renders sources in a list; each source has a title element
    const titles: string[] = [];

    // Strategy 1: Look for source list items with data-source-title or similar attributes
    document.querySelectorAll('[data-sourceinfo] [class*="title"]').forEach((el) => {
        const text = el.textContent?.trim();
        if (text) titles.push(text);
    });

    // Strategy 2: Fallback — look for common source card patterns
    if (!titles.length) {
        document.querySelectorAll('.source-card, [class*="source"] [class*="name"], [class*="source"] [class*="title"]').forEach((el) => {
            const text = el.textContent?.trim();
            if (text && text.length < 200) titles.push(text);
        });
    }

    return titles;
}

/** Scrape the AI-generated summary/outline from the page */
function scrapeAiSummary(): string {
    // Look for the notebook guide / AI summary section
    // NotebookLM typically shows this in a prominent section
    const candidates = [
        // The notebook guide area
        '[class*="guide"] [class*="content"]',
        '[class*="summary"] [class*="content"]',
        '[class*="overview"]',
        // The main content area
        '[class*="notebook-guide"]',
    ];

    for (const selector of candidates) {
        const el = document.querySelector(selector);
        if (el?.textContent?.trim()) {
            return el.textContent.trim().slice(0, 2000); // cap at 2000 chars
        }
    }

    return "";
}

/** Get the notebook title from the page */
function scrapeNotebookTitle(): string {
    // Try the document title first (usually "NotebookLM - {title}")
    const docTitle = document.title.replace(/^NotebookLM\s*[-–—]\s*/, "").trim();
    if (docTitle && docTitle !== "NotebookLM") return docTitle;

    // Try heading elements
    const heading = document.querySelector('h1, [class*="notebook-title"], [class*="notebook-name"]');
    return heading?.textContent?.trim() || "NotebookLM 播客";
}

// ── Message listener: respond to queries from popup / background ──
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "SCRAPE_PAGE_DATA") {
        const data = {
            notebookTitle: scrapeNotebookTitle(),
            sourceTitles: scrapeSourceTitles(),
            aiSummary: scrapeAiSummary(),
        };
        sendResponse({ ok: true, data });
        return false; // synchronous
    }

    // Download audio file using the page's auth cookies
    if (msg.type === "FETCH_AUDIO" && msg.url) {
        (async () => {
            try {
                console.log("[Content] Fetching audio:", msg.url.slice(0, 80) + "...");
                const resp = await fetch(msg.url, { credentials: "include" });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const buffer = await resp.arrayBuffer();
                console.log("[Content] Audio fetched, size:", buffer.byteLength);
                // Convert to plain array for message passing compatibility
                sendResponse({ ok: true, data: Array.from(new Uint8Array(buffer)), size: buffer.byteLength });
            } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : String(err);
                console.error("[Content] Audio fetch failed:", errMsg);
                sendResponse({ ok: false, error: errMsg });
            }
        })();
        return true; // async response
    }

    return false;
});

console.log("[Podcast Content Script] Injected into", window.location.href);
