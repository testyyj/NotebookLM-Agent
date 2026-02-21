/**
 * Shared TypeScript types for the podcast sub-system.
 */

/** Aliyun OSS connection configuration */
export interface AliyunConfig {
    region: string;         // e.g. "oss-cn-shanghai"
    bucket: string;         // e.g. "my-podcast-bucket"
    accessKeyId: string;
    accessKeySecret: string;
    cdnDomain: string;      // e.g. "https://cdn.example.com"
    geminiApiKey?: string;  // Gemini API key for AI cover image generation
}

/** Podcast channel definition */
export interface Channel {
    id: string;             // UUID v4
    title: string;          // Channel display name
    description: string;    // Channel description for RSS <description>
    author: string;         // iTunes author name
    language: string;       // BCP 47 language tag, default "zh-cn"
    category: string;       // iTunes category, default "Education"
    coverUrl: string;       // Full CDN URL to cover image, e.g. https://cdn/ch_uuid/cover.jpg
    xmlPath: string;        // OSS relative path, e.g. ch_uuid/secret_feed_xxx.xml
    createdAt: string;      // ISO 8601 timestamp
}

/** Episode metadata collected from NotebookLM page + user edits */
export interface EpisodeMetadata {
    title: string;
    description: string;
    channelId: string;
}

/** Publish pipeline state machine */
export type PublishState =
    | "idle"
    | "transcoding"
    | "uploading_mp3"
    | "fetching_xml"
    | "updating_xml"
    | "uploading_xml"
    | "done"
    | "error";

/** Message types for communication between content script ↔ popup ↔ offscreen */
export interface TranscodeRequest {
    type: "TRANSCODE_WAV";
    wavArrayBuffer: ArrayBuffer;
}

export interface TranscodeResponse {
    type: "TRANSCODE_RESULT";
    mp3ArrayBuffer: ArrayBuffer;
    mp3ByteSize: number;
}

export interface ScrapedPageData {
    sourceTitle: string;
    aiSummary: string;
}

/** Storage keys used in chrome.storage.local */
export const STORAGE_KEYS = {
    ALIYUN_CONFIG: "podcast_aliyun_config",
    CHANNELS: "podcast_channels",
} as const;
