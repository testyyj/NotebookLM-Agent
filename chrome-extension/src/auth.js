/**
 * Auth token extraction for Chrome extension.
 *
 * Since the extension runs in the user's browser where they're already
 * logged into Google, we fetch notebooklm.google.com directly and
 * extract CSRF (SNlM0e) + session ID (FdrFJe) from the page HTML.
 *
 * No chrome.cookies API needed — fetch() with credentials: 'include'
 * automatically attaches cookies for host_permissions domains.
 */

const NOTEBOOKLM_URL = "https://notebooklm.google.com/";

/**
 * Fetch CSRF token and session ID from the NotebookLM homepage.
 * The browser cookies are sent automatically via credentials: 'include'.
 *
 * @returns {Promise<{csrfToken: string, sessionId: string}>}
 * @throws {Error} if tokens cannot be extracted (e.g. not logged in)
 */
export async function fetchTokens() {
    const resp = await fetch(NOTEBOOKLM_URL, {
        credentials: "include",
        redirect: "follow",
    });

    if (!resp.ok) {
        throw new Error(`Failed to load NotebookLM (HTTP ${resp.status})`);
    }

    // Check for auth redirect
    const finalUrl = resp.url;
    if (finalUrl.includes("accounts.google.com")) {
        throw new Error(
            "未登录 Google。请先在浏览器中登录 notebooklm.google.com"
        );
    }

    const html = await resp.text();

    // Extract CSRF token: "SNlM0e" : "<token>"
    const csrfMatch = html.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
    if (!csrfMatch) {
        throw new Error("无法提取 CSRF token，可能需要重新登录 Google");
    }

    // Extract session ID: "FdrFJe" : "<session_id>"
    const sidMatch = html.match(/"FdrFJe"\s*:\s*"([^"]+)"/);
    if (!sidMatch) {
        throw new Error("无法提取 Session ID，可能需要重新登录 Google");
    }

    // Extract build label: "cfb2h" : "boq_labs-tailwind-frontend_..."
    const blMatch = html.match(/"cfb2h"\s*:\s*"([^"]+)"/);

    return {
        csrfToken: csrfMatch[1],
        sessionId: sidMatch[1],
        buildLabel: blMatch ? blMatch[1] : null,
    };
}

/**
 * Auth token cache with auto-refresh.
 * Tokens are cached for 10 minutes before re-fetching.
 */
let _cachedTokens = null;
let _cachedAt = 0;
const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function getTokens() {
    const now = Date.now();
    if (_cachedTokens && now - _cachedAt < TOKEN_TTL_MS) {
        return _cachedTokens;
    }
    _cachedTokens = await fetchTokens();
    _cachedAt = now;
    return _cachedTokens;
}

/** Force refresh tokens (e.g. after auth error). */
export function invalidateTokens() {
    _cachedTokens = null;
    _cachedAt = 0;
}
