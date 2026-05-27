import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

  const { type, parts, config } = req.body;
  if (!parts?.length) return res.status(400).json({ error: "parts is required" });

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: { parts },
      ...(config ? { config } : {}),
    });

    if (type === "image") {
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return res.json({ imageData: part.inlineData.data });
        }
      }
      return res.status(500).json({ error: "No image returned by Gemini" });
    }

    res.json({ text: response.text || "" });
  } catch (error) {
    console.error("Gemini API error:", error);
    res.status(500).json({ error: String(error) });
  }
}
