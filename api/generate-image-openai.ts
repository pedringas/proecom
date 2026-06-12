import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY not configured on server" });
  }

  const { prompt, size, image, mimeType, style } = req.body as {
    prompt?: string;
    size?: string;
    image?: string;
    mimeType?: string;
    style?: string;
  };

  if (!prompt) return res.status(400).json({ error: "prompt is required" });
  if (!image)  return res.status(400).json({ error: "image is required" });

  try {
    const imageBuffer = Buffer.from(image, "base64");
    const imageFile = new File([imageBuffer], "image.png", { type: mimeType || "image/png" });

    const formData = new FormData();
    formData.append("model",   "gpt-image-1");
    formData.append("prompt",  prompt);
    formData.append("size",    size || "1024x1024");
    formData.append("quality", "high");
    formData.append("n",       "1");
    formData.append("image",   imageFile, "image.png");

    const openaiRes = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: formData,
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.text();
      return res.status(openaiRes.status).json({ error: err });
    }

    const data = await openaiRes.json() as { data?: { b64_json?: string }[] };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return res.status(500).json({ error: "No image returned by OpenAI" });

    res.json({ b64_json: b64 });
  } catch (error) {
    console.error(`OpenAI error [style=${style || "unknown"}]:`, error);
    res.status(500).json({ error: "Error generating image" });
  }
}
