import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { google } from "googleapis";
import session from "express-session";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { Readable } from "stream";
import { GoogleGenAI, VideoGenerationReferenceType } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(session({
  secret: "proecom-secret-key",
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: true,
    sameSite: 'none',
    httpOnly: true,
  }
}));

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/google/callback`
);

// API Routes
app.get("/api/auth/google/url", (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
    return res.status(500).json({ error: "Credenciales de Google no configuradas" });
  }

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/drive.file"],
    prompt: "consent"
  });
  res.json({ url });
});

app.get(["/auth/google/callback", "/auth/google/callback/"], async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    (req.session as any).tokens = tokens;
    
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Autenticación exitosa. Esta ventana se cerrará automáticamente.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error exchanging code for tokens:", error);
    res.status(500).send("Error en la autenticación");
  }
});

app.get("/api/auth/status", (req, res) => {
  const tokens = (req.session as any).tokens;
  res.json({ isAuthenticated: !!tokens });
});

app.post("/api/drive/upload", async (req, res) => {
  const tokens = (req.session as any).tokens;
  if (!tokens) {
    return res.status(401).json({ error: "No autenticado con Google" });
  }

  const { base64Image, fileName } = req.body;
  if (!base64Image) {
    return res.status(400).json({ error: "Imagen no proporcionada" });
  }

  try {
    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // 1. Find or create the ProEcom AI folder
    let folderId = "";
    const folderName = "ProEcom AI";
    
    const folderSearch = await drive.files.list({
      q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id)",
      spaces: "drive",
    });

    if (folderSearch.data.files && folderSearch.data.files.length > 0) {
      folderId = folderSearch.data.files[0].id!;
    } else {
      const folderMetadata = {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
      };
      const folderResponse = await drive.files.create({
        requestBody: folderMetadata,
        fields: "id",
      });
      folderId = folderResponse.data.id!;
    }

    // 2. Upload the file to that folder
    const buffer = Buffer.from(base64Image.split(",")[1], "base64");
    const fileMetadata = {
      name: fileName || `pro-ecom-${Date.now()}.png`,
      mimeType: "image/png",
      parents: [folderId],
    };
    const media = {
      mimeType: "image/png",
      body: Readable.from(buffer),
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id, webViewLink",
    });

    res.json({ success: true, fileId: response.data.id, link: response.data.webViewLink });
  } catch (error) {
    console.error("Error uploading to Drive:", error);
    res.status(500).json({ error: "Error al subir a Google Drive" });
  }
});

app.post("/api/gemini", async (req, res) => {
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
        if ((part as any).inlineData) {
          return res.json({ imageData: (part as any).inlineData.data });
        }
      }
      return res.status(500).json({ error: "No image returned by Gemini" });
    }

    res.json({ text: response.text || "" });
  } catch (error) {
    console.error("Gemini API error:", error);
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/gemini-video", async (req, res) => {
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
      config: { numberOfVideos: 1, referenceImages, resolution: "720p", aspectRatio: "16:9" },
    });

    while (!operation.done) {
      await new Promise((r) => setTimeout(r, 10000));
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
});

app.post("/api/generate-image-openai", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY not configured on server" });
  }

  const { prompt, size, image, mimeType, style } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });
  if (!image)  return res.status(400).json({ error: "image is required" });

  try {
    const imageBuffer = Buffer.from(image, "base64");
    const imageFile = new File([imageBuffer], "image.png", { type: mimeType || "image/png" });

    const formData = new FormData();
    formData.append("model",  "gpt-image-1");
    formData.append("prompt", prompt);
    formData.append("size",   size || "1024x1024");
    formData.append("n",      "1");
    formData.append("image",  imageFile, "image.png");

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
});

// Vite middleware setup
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
