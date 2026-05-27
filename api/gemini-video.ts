import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, VideoGenerationReferenceType } from "@google/genai";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

  const { description, images } = req.body as {
    description: string;
    images: { base64: string; mimeType: string }[];
  };

  if (!description) return res.status(400).json({ error: "description is required" });
  if (!images?.length) return res.status(400).json({ error: "images are required" });

  try {
    const ai = new GoogleGenAI({ apiKey });

    const referenceImages = images.slice(0, 3).map((img) => ({
      image: { imageBytes: img.base64, mimeType: img.mimeType },
      referenceType: VideoGenerationReferenceType.ASSET,
    }));

    const videoPrompt = `Cinematic 360-degree product rotation video using the provided processed images as absolute visual references.
The product performs a slow, elegant, and smooth full rotation in a clockwise direction.
The camera angle is an orbital perspective with a slight high-angle tilt, looking slightly down at the product to showcase its top and sides.
The environment must remain a consistent, pure infinite white background (RGB 255,255,255) with soft studio lighting and realistic contact shadows at the base.
Maintain 100% visual fidelity to the product's shape, textures, and colors seen in the reference images.
The motion must be fluid and steady, completing one full revolution in exactly 6 seconds.
The final frame must perfectly match the first frame to create a seamless, infinite loop.
High resolution, professional ecommerce commercial style.
Technical description context: ${description}`;

    let operation = await ai.models.generateVideos({
      model: "veo-3.1-generate-preview",
      prompt: videoPrompt,
      config: {
        numberOfVideos: 1,
        referenceImages,
        resolution: "720p",
        aspectRatio: "16:9",
      },
    });

    while (!operation.done) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      operation = await ai.operations.getVideosOperation({ operation });
    }

    const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!videoUri) throw new Error("Could not get video download link.");

    const videoRes = await fetch(videoUri, { headers: { "x-goog-api-key": apiKey } });
    if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.status}`);

    const buffer = await videoRes.arrayBuffer();
    res.setHeader("Content-Type", "video/mp4");
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Video generation error:", error);
    res.status(500).json({ error: String(error) });
  }
}
