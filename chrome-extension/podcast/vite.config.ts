import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync } from "fs";

// Custom plugin: copy FFmpeg WASM core files to dist/ffmpeg/
function copyFfmpegCore() {
    return {
        name: "copy-ffmpeg-core",
        closeBundle() {
            const src = resolve(__dirname, "node_modules/@ffmpeg/core/dist/esm");
            const dest = resolve(__dirname, "dist/ffmpeg");
            mkdirSync(dest, { recursive: true });
            copyFileSync(resolve(src, "ffmpeg-core.js"), resolve(dest, "ffmpeg-core.js"));
            copyFileSync(resolve(src, "ffmpeg-core.wasm"), resolve(dest, "ffmpeg-core.wasm"));
            console.log("✓ Copied FFmpeg WASM core to dist/ffmpeg/");
        },
    };
}

export default defineConfig({
    plugins: [tailwindcss(), copyFfmpegCore()],
    base: "./", // Relative paths — required for Chrome extension context
    build: {
        outDir: "dist",
        emptyDirFirst: true,
        rollupOptions: {
            input: {
                options: resolve(__dirname, "src/options/options.html"),
                popup: resolve(__dirname, "src/popup/popup.html"),
                offscreen: resolve(__dirname, "src/offscreen/offscreen.html"),
                content: resolve(__dirname, "src/content/content.ts"),
            },
            output: {
                // Content script must be a single file (no code-splitting)
                entryFileNames: (chunkInfo) => {
                    if (chunkInfo.name === "content") return "content.js";
                    return "assets/[name]-[hash].js";
                },
                chunkFileNames: "assets/[name]-[hash].js",
                assetFileNames: "assets/[name]-[hash].[ext]",
            },
        },
    },
});
