/**
 * AI image generation for podcast cover art.
 * Uses Google Gemini API with image generation capabilities.
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-2.0-flash-exp-image-generation";

/**
 * Generate a podcast cover image using Gemini's image generation.
 * @param apiKey   Gemini API key
 * @param title    Channel title (used to design the cover)
 * @param description  Optional channel description for context
 * @returns PNG image as a Blob
 */
export async function generateCoverImage(
    apiKey: string,
    title: string,
    description?: string
): Promise<Blob> {
    const prompt = buildPrompt(title, description);

    const url = `${GEMINI_API_BASE}/${MODEL}:generateContent?key=${apiKey}`;

    const body = {
        contents: [
            {
                parts: [{ text: prompt }],
            },
        ],
        generationConfig: {
            responseModalities: ["IMAGE", "TEXT"],
            responseMimeType: "text/plain",
        },
    };

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        let detail = "";
        try {
            const parsed = JSON.parse(errorText);
            detail = parsed?.error?.message || errorText.slice(0, 200);
        } catch {
            detail = errorText.slice(0, 200);
        }
        throw new Error(`Gemini API 请求失败 (${response.status}): ${detail}`);
    }

    const data = await response.json();

    // Extract the inline image data from the response
    const candidates = data?.candidates;
    if (!candidates?.length) {
        throw new Error("Gemini API 未返回生成结果");
    }

    const parts = candidates[0]?.content?.parts;
    if (!parts?.length) {
        throw new Error("Gemini API 返回内容为空");
    }

    // Look for the inline_data part with image data
    const imagePart = parts.find(
        (p: { inlineData?: { mimeType: string; data: string } }) =>
            p.inlineData?.mimeType?.startsWith("image/")
    );

    if (!imagePart?.inlineData) {
        throw new Error("Gemini API 未返回图片数据，请检查模型是否支持图片生成");
    }

    const { mimeType, data: base64Data } = imagePart.inlineData;

    // Decode base64 to Blob
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }

    return new Blob([bytes], { type: mimeType });
}

/**
 * Build a carefully crafted prompt for podcast cover generation.
 */
function buildPrompt(title: string, description?: string): string {
    const descPart = description
        ? `\nThe podcast is about: ${description}`
        : "";

    return `Generate a professional, modern podcast cover art image for a podcast channel called "${title}".${descPart}

Requirements:
- Square aspect ratio (1:1), suitable for podcast platforms (Apple Podcasts, Spotify)
- Clean, modern design with vibrant colors and bold typography
- The channel title "${title}" should be prominently displayed on the cover
- Professional gradient or abstract background
- No photographs of real people
- High contrast, easily readable at small sizes
- Style: modern, premium, editorial design`;
}
