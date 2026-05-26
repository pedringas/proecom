import { GoogleGenAI, VideoGenerationReferenceImage, VideoGenerationReferenceType } from "@google/genai";

export interface TransformationResult {
  imageUrl: string;
}

export async function transformImage(
  base64Image: string,
  mimeType: string,
  style: string,
  analysis: string,
  extraData?: {
    measurements?: string;
    width?: string;
    height?: string;
    depth?: string;
    title?: string;
    features?: string;
    lifestylePrompt?: string;
    productDescription?: string;
    aspectRatio?: "1:1" | "16:9" | "9:16";
    infoStyle?: "Pop" | "Elegante";
  },
  apiKey?: string
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || "" });
  let prompt = "";

  switch (style) {

    // ─── 1. PRODUCTO (fondo blanco de estudio) ───────────────────────────────
    case "Ecom":
      prompt = `You are a professional e-commerce photographer. Analyze the attached image and the product name/description: "${extraData?.productDescription || "product"}".
Transform it into a professional e-commerce product photograph.

KEY REQUIREMENTS:
1. FIDELITY: Maintain 100% fidelity to the shape, colors, materials and details of the original product in the attached photo. Use the description to correctly identify the object.
2. BACKGROUND: Pure white background (RGB 255,255,255), infinite, no gradients or shadows on the background itself.
3. LIGHTING: Soft studio lighting to create volume. Realistic contact shadow at the base of the product only.
4. CENTERING: Product perfectly centered, with balanced margins on all sides.
5. DO NOT add any text, watermarks, logos or graphic elements.`;
      break;

    // ─── 2. PORTADA ML (lifestyle SIN humanos) ───────────────────────────────
    case "LifestyleNoHuman":
      prompt = `You are a professional lifestyle product photographer. Using the attached product image as an exact reference, generate a lifestyle photograph WITHOUT any people or human body parts.

KEY REQUIREMENTS:
1. PRODUCT FIDELITY: The product must look exactly like in the attached image — same shape, color, brand, labels, materials. Do NOT redesign or reimagine it.
2. ENVIRONMENT: ${extraData?.lifestylePrompt
        ? `Place the scene in this specific environment: "${extraData.lifestylePrompt}".`
        : "Place the product in a realistic, modern, aspirational environment appropriate to the product type (e.g. a kitchen for a coffee maker, a desk for tech accessories, outdoors for sporting goods). Use warm, natural lighting."
      }
3. NO HUMANS: Absolutely no people, hands, arms, legs or any body part. The product is the sole hero.
4. COMPOSITION: Professional photography with depth of field. The product is sharply in focus. Background slightly blurred (bokeh).
5. MOOD: Aspirational, clean, magazine-quality. This image is intended as the main cover for a MercadoLibre listing.
6. DO NOT add any text, watermarks or graphic overlays.`;
      break;

    // ─── 3. LIFESTYLE (CON personas) ─────────────────────────────────────────
    case "Lifestyle":
      prompt = `You are a professional lifestyle photographer. Using the attached product image as an exact reference, generate a lifestyle photograph showing the product in use by people.

KEY REQUIREMENTS:
1. PRODUCT FIDELITY: The product must look exactly like in the attached image — same shape, color, brand, labels, materials. Do NOT redesign it.
2. ENVIRONMENT: ${extraData?.lifestylePrompt
        ? `Place the scene in this specific environment: "${extraData.lifestylePrompt}".`
        : "Place the scene in a realistic, modern environment appropriate to the product. Use natural warm lighting."
      }
3. PEOPLE: Include people interacting with the product in a natural, casual way. The interaction must look genuine and spontaneous. Diverse, relatable people.
4. COMPOSITION: Professional photography with depth of field. Product is the hero even with people present.
5. DO NOT add any text, watermarks or graphic overlays.`;
      break;

    // ─── 4. MEDIDAS ──────────────────────────────────────────────────────────
    case "Technical": {
      const w = extraData?.width || "0";
      const h = extraData?.height || "0";
      const d = extraData?.depth || "0";

      prompt = `You are a professional product photographer and graphic designer creating a technical dimensions sheet for an e-commerce listing.

STEP 1 — PRODUCT PHOTO:
Place the original product from the attached image on a pure white background (#FFFFFF). Keep 100% visual fidelity: same shape, angle, colors, brand, labels. Do not alter the product in any way.

STEP 2 — DIMENSION LINES:
Add clean, minimal dimension annotation lines directly on the image, similar to architectural or industrial design drawings:
- A horizontal double-headed arrow (↔) below the product, labeled exactly: "${w} cm"
- A vertical double-headed arrow (↕) to the right of the product, labeled exactly: "${h} cm"  
- A diagonal double-headed arrow at the depth axis, labeled exactly: "${d} cm"
Use thin lines (1-2px), color: #555555. Place small perpendicular end caps on each arrow.

STEP 3 — LEGEND BAR:
At the very bottom of the image, add a clean light gray bar (#F5F5F5) with this exact text centered in dark gray (#333333), using a clean sans-serif font (Inter or similar), font size readable at thumbnail:

Ancho: ${w} cm  |  Alto: ${h} cm  |  Profundo: ${d} cm

CRITICAL TEXT RULES:
- Render ONLY these exact words: "Ancho", "Alto", "Profundo", "cm" and the numbers provided.
- Copy the numbers exactly as given: width="${w}", height="${h}", depth="${d}".
- Do NOT change, round, invent or alter any number or word.
- Do NOT use abbreviations. Do NOT add extra words.
- Double-check every character before rendering.`;
      break;
    }

    // ─── 5. INFOGRAFÍA ───────────────────────────────────────────────────────
    case "Infographic": {
      const title = extraData?.title || "";
      const features = extraData?.features || "";
      const style = extraData?.infoStyle || "Pop";

      const featureLines = features
        .split("\n")
        .map(f => f.trim())
        .filter(f => f.length > 0);

      const featureList = featureLines
        .map((f, i) => `Feature ${i + 1}: "${f}"`)
        .join("\n");

      if (style === "Pop") {
        prompt = `You are a professional e-commerce graphic designer creating a VIBRANT POP-STYLE marketing infographic for a product listing.

STEP 1 — PRODUCT:
Use the product from the attached image as the central hero element. Maintain 100% visual fidelity.

STEP 2 — DESIGN (POP STYLE):
Create a bold, energetic, eye-catching infographic layout. Extract the dominant colors directly from the product itself and use their vibrant, highly-saturated versions as the palette. Add complementary accent colors for maximum visual impact. Think bold gradients, dynamic shapes, strong contrasts. Inspired by top e-commerce listings on MercadoLibre and Amazon.

STEP 3 — TITLE TEXT:
At the top center of the image, render this exact title text using a bold sans-serif font (Inter or Montserrat):

TITLE TO RENDER: "${title}"

Copy every character exactly. Do not add, remove or change any letter.

STEP 4 — FEATURE BADGES:
Around the product, place ${featureLines.length} feature badge${featureLines.length !== 1 ? "s" : ""}. Each badge has a colored background pill/chip with an icon and text. Render each feature text EXACTLY as specified below:

${featureList}

CRITICAL TEXT ACCURACY RULES (NON-NEGOTIABLE):
- Copy EXACTLY what is given. Do not paraphrase, translate, summarize or "improve" any word.
- Do not invent words. Do not add decorative text that was not requested.
- Numbers must be copied exactly as provided.
- Accents and special characters (á, é, í, ó, ú, ñ, ü) must be preserved exactly.

LAYOUT: Balanced composition. Product centered. Features distributed evenly around it. Title prominent at top. Use icons relevant to each feature.`;
      } else {
        prompt = `You are a luxury brand graphic designer creating an ELEGANT, SOPHISTICATED marketing infographic for a premium product listing.

STEP 1 — PRODUCT:
Use the product from the attached image as the central hero element. Maintain 100% visual fidelity.

STEP 2 — DESIGN (ELEGANT STYLE):
Create a refined, sophisticated infographic layout. Derive the color palette exclusively from the product's own tones — use muted, desaturated versions of those colors (e.g. if the product is red, use burgundy/rose; if blue, use navy/slate). Combine with neutral whites, warm creams or deep charcoals. Typography must be clean and minimal. Thin elegant lines, generous whitespace, subtle textures. Inspired by luxury brands like Apple, Dyson, or high-end fashion e-commerce.

STEP 3 — TITLE TEXT:
At the top center of the image, render this exact title text using a light-weight or medium serif/sans-serif font (Playfair Display or similar):

TITLE TO RENDER: "${title}"

Copy every character exactly. Do not add, remove or change any letter.

STEP 4 — FEATURE BADGES:
Around the product, place ${featureLines.length} feature badge${featureLines.length !== 1 ? "s" : ""}. Each badge uses a minimal pill or underline style with subtle color derived from the product palette. Render each feature text EXACTLY as specified below:

${featureList}

CRITICAL TEXT ACCURACY RULES (NON-NEGOTIABLE):
- Copy EXACTLY what is given. Do not paraphrase, translate, summarize or "improve" any word.
- Do not invent words. Do not add decorative text that was not requested.
- Numbers must be copied exactly as provided.
- Accents and special characters (á, é, í, ó, ú, ñ, ü) must be preserved exactly.

LAYOUT: Balanced, airy composition. Product centered with generous negative space. Features arranged with elegance. Title subtle but legible at the top.`;
      }
      break;
    }

    default:
      prompt = `Transform this image into a high-quality professional product photo on a pure white background.`;
  }

  // Aspect ratio instruction
  const ar = extraData?.aspectRatio || "1:1";
  const arDesc: Record<string, string> = {
    "1:1":  "1:1 (square — equal width and height, like an Instagram post)",
    "16:9": "16:9 (landscape — wide horizontal format, like a YouTube thumbnail)",
    "9:16": "9:16 (portrait — tall vertical format, like an Instagram Story or TikTok)",
  };
  prompt += `\n\nMANDATORY FINAL REQUIREMENT — OUTPUT ASPECT RATIO: You MUST generate the image in ${arDesc[ar] || ar} aspect ratio. This is non-negotiable. Every element — product, background, badges, title — must be composed and cropped to fit exactly within this ratio. Do NOT output a square image if a different ratio is requested.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Image,
            mimeType: mimeType,
          },
        },
        {
          text: prompt,
        },
      ],
    },
    config: {
      aspectRatio: extraData?.aspectRatio || "1:1",
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }

  throw new Error("No image was returned by the API.");
}

// ─── ANALYZE PRODUCT (para Video 360°) ───────────────────────────────────────
export async function analyzeProduct(
  images: { base64: string; mimeType: string }[],
  userDescription?: string,
  apiKey?: string
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || "" });

  const parts = images.map((img) => ({
    inlineData: {
      data: img.base64,
      mimeType: img.mimeType,
    },
  }));

  const response = await ai.models.generateContent({
    // BUGFIX: modelo corregido (era "gemini-3-flash-preview" — no existe)
    model: "gemini-2.5-flash-image",
    contents: {
      parts: [
        ...parts,
        {
          text: `Analyze these images of the same product taken from different angles. ${
            userDescription
              ? `The user describes the product as: "${userDescription}".`
              : ""
          }
          
Provide an extremely detailed and precise technical description of the product, including:
- Overall shape and silhouette
- Materials and textures (matte, glossy, fabric, metal, plastic, etc.)
- Exact colors and any gradients or patterns
- Any logos, brand names, labels, prints or markings
- Distinctive design details, buttons, zippers, stitching, etc.
- Approximate proportions

This description will be used to generate a 360° product video, so be very thorough so the AI can reconstruct it faithfully.`,
        },
      ],
    },
  });

  return response.text || "A high-quality commercial product.";
}

// ─── GENERATE VIDEO 360° ─────────────────────────────────────────────────────
export async function generateVideo360(
  apiKey: string,
  description: string,
  images: { base64: string; mimeType: string }[]
): Promise<string> {
  const aiInstance = new GoogleGenAI({ apiKey: apiKey || process.env.API_KEY || "" });

  const referenceImagesPayload: VideoGenerationReferenceImage[] = images
    .slice(0, 3)
    .map((img) => ({
      image: {
        imageBytes: img.base64,
        mimeType: img.mimeType,
      },
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

  let operation = await aiInstance.models.generateVideos({
    model: "veo-3.1-generate-preview",
    prompt: videoPrompt,
    config: {
      numberOfVideos: 1,
      referenceImages: referenceImagesPayload,
      resolution: "720p",
      aspectRatio: "16:9",
    },
  });

  while (!operation.done) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    operation = await aiInstance.operations.getVideosOperation({
      operation: operation,
    });
  }

  const downloadLink =
    operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) {
    console.error(
      "Video generation failed. Operation details:",
      JSON.stringify(operation, null, 2)
    );
    throw new Error("Could not get video download link.");
  }

  return downloadLink;
}