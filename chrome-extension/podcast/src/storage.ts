/**
 * Chrome storage helpers for podcast configuration.
 */
import { AliyunConfig, Channel, STORAGE_KEYS } from "./types";

/** Load Aliyun OSS config from chrome.storage.local */
export async function loadAliyunConfig(): Promise<AliyunConfig | null> {
    const data = await chrome.storage.local.get(STORAGE_KEYS.ALIYUN_CONFIG);
    return data[STORAGE_KEYS.ALIYUN_CONFIG] ?? null;
}

/** Save Aliyun OSS config to chrome.storage.local */
export async function saveAliyunConfig(config: AliyunConfig): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.ALIYUN_CONFIG]: config });
}

/** Load all podcast channels from chrome.storage.local */
export async function loadChannels(): Promise<Channel[]> {
    const data = await chrome.storage.local.get(STORAGE_KEYS.CHANNELS);
    return data[STORAGE_KEYS.CHANNELS] ?? [];
}

/** Save all podcast channels to chrome.storage.local */
export async function saveChannels(channels: Channel[]): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.CHANNELS]: channels });
}
