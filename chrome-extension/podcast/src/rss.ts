/**
 * RSS XML generation and manipulation utilities.
 * Generates Apple Podcasts-compatible RSS 2.0 feeds.
 */
import { Channel } from "./types";

/**
 * Build a skeleton RSS XML string for a new channel (cold start).
 * Contains the <channel> header with no <item> nodes.
 */
export function buildSkeletonRss(channel: Channel): string {
  const coverTag = channel.coverUrl
    ? `\n    <itunes:image href="${escXml(channel.coverUrl)}"/>
    <image>
      <url>${escXml(channel.coverUrl)}</url>
      <title>${escXml(channel.title)}</title>
      <link>${escXml(channel.coverUrl)}</link>
    </image>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escXml(channel.title)}</title>
    <link>${escXml(channel.coverUrl || "https://notebooklm.google.com")}</link>
    <language>${escXml(channel.language)}</language>
    <description>${escXml(channel.description)}</description>
    <itunes:author>${escXml(channel.author)}</itunes:author>
    <itunes:summary>${escXml(channel.description)}</itunes:summary>${coverTag}
    <itunes:category text="${escXml(channel.category)}"/>
    <itunes:type>serial</itunes:type>
    <itunes:explicit>false</itunes:explicit>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  </channel>
</rss>`;
}

/** Escape special XML characters */
export function escXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
