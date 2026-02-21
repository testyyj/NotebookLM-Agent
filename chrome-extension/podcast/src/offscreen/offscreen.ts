/**
 * Offscreen document entry point.
 * Uses @ffmpeg/core WASM directly (no worker wrapper) to avoid Chrome extension
 * CSP issues with dynamic import() in workers.
 *
 * Since the offscreen document is already a background context (no UI to block),
 * running FFmpeg in the main thread is perfectly fine.
 *
 * Communication flow (avoids 64MB message limit):
 *   background sends { wavUrl } → offscreen downloads WAV, transcodes →
 *   stores MP3 in IndexedDB → responds with { dbKey, mp3ByteSize } →
 *   background reads MP3 from IndexedDB
 */

// @ts-expect-error — createFFmpegCore is the emscripten factory
import createFFmpegCore from "@ffmpeg/core";

let ffmpegCore: any = null;
let coreLoading: Promise<any> | null = null;

// ── IndexedDB helpers ──

const DB_NAME = "podcast-transfer";
const STORE_NAME = "blobs";

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function putBlob(key: string, data: Uint8Array): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(data, key);
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

async function getBlob(key: string): Promise<Uint8Array | null> {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    return new Promise((resolve, reject) => {
        req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
        req.onerror = () => { db.close(); reject(req.error); };
    });
}

// ── FFmpeg Core (direct, no worker) ──

async function loadCore(): Promise<any> {
    if (ffmpegCore) return ffmpegCore;

    if (coreLoading) {
        ffmpegCore = await coreLoading;
        return ffmpegCore;
    }

    console.log("[Offscreen] Loading FFmpeg core WASM...");

    const wasmURL = chrome.runtime.getURL("podcast/dist/ffmpeg/ffmpeg-core.wasm");

    // Pre-load WASM binary via XHR (fetch() fails in offscreen documents for
    // chrome-extension:// URLs). Synchronous XHR works fine here since the
    // offscreen document has no UI to block.
    const wasmBinary = await new Promise<ArrayBuffer>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", wasmURL, true);
        xhr.responseType = "arraybuffer";
        xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 0) {
                console.log("[Offscreen] WASM binary loaded:", xhr.response.byteLength, "bytes");
                resolve(xhr.response);
            } else {
                reject(new Error(`Failed to load WASM: HTTP ${xhr.status}`));
            }
        };
        xhr.onerror = () => reject(new Error("XHR failed to load WASM binary"));
        xhr.send();
    });

    coreLoading = createFFmpegCore({
        wasmBinary,
        locateFile: (path: string) => {
            if (path.endsWith(".wasm")) return wasmURL;
            return path;
        },
    });

    ffmpegCore = await coreLoading;
    console.log("[Offscreen] FFmpeg core loaded successfully");
    return ffmpegCore;
}

/**
 * Transcode WAV (Uint8Array) → MP3 (Uint8Array) using FFmpeg core directly.
 */
async function transcodeWavToMp3(wavData: Uint8Array): Promise<{ mp3Data: Uint8Array; mp3ByteSize: number }> {
    const core = await loadCore();

    // Write WAV to virtual filesystem
    core.FS.writeFile("input.wav", wavData);

    // Run FFmpeg command: WAV → MP3 128kbps mono
    core.exec("-i", "input.wav", "-codec:a", "libmp3lame", "-b:a", "128k", "-ac", "1", "-ar", "44100", "output.mp3");

    // Read the output
    const mp3Data: Uint8Array = core.FS.readFile("output.mp3");

    // Cleanup
    core.FS.unlink("input.wav");
    core.FS.unlink("output.mp3");

    return {
        mp3Data,
        mp3ByteSize: mp3Data.byteLength,
    };
}

// ── Message listener ──
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== "TRANSCODE_WAV" || msg.target !== "offscreen") return false;

    (async () => {
        try {
            let wavData: Uint8Array;

            if (msg.wavDbKey) {
                // Primary path: background downloaded audio and stored in IndexedDB
                console.log("[Offscreen] Reading WAV from IndexedDB, key:", msg.wavDbKey);
                const data = await getBlob(msg.wavDbKey);
                if (!data) throw new Error("无法从 IndexedDB 读取 WAV 数据");
                wavData = data;
                console.log("[Offscreen] Read WAV from IndexedDB:", wavData.byteLength, "bytes");
            } else if (msg.wavArrayBuffer) {
                // Popup path: WAV data passed directly as array
                wavData = new Uint8Array(msg.wavArrayBuffer);
            } else {
                throw new Error("Missing wavDbKey or wavArrayBuffer");
            }

            console.log("[Offscreen] Starting transcode, WAV size:", wavData.byteLength);
            const { mp3Data, mp3ByteSize } = await transcodeWavToMp3(wavData);
            console.log("[Offscreen] Transcode complete, MP3 size:", mp3ByteSize);

            const dbKey = `mp3_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            await putBlob(dbKey, mp3Data);
            console.log("[Offscreen] MP3 stored in IndexedDB as:", dbKey);

            sendResponse({
                ok: true,
                dbKey,
                mp3ByteSize,
            });
        } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error("[Offscreen] Error:", errorMsg);
            sendResponse({ ok: false, error: errorMsg });
        }
    })();

    return true;
});

console.log("[Offscreen] Document loaded, ready for transcode requests.");
