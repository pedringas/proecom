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
        prompt = `You are an explosive graphic designer creating a MAXIMUM-IMPACT POP-STYLE e-commerce infographic. Think comic book cover meets sports poster meets street art.

STEP 1 — BACKGROUND:
Create a dramatic radial burst / starburst background with rays emanating from the center of the image. Use 2–3 highly saturated colors extracted directly from the product (e.g. if the product is red, use bright red and yellow; if blue, use electric blue and lime). The rays must be sharp, high-contrast, and fill the entire frame edge to edge. No white backgrounds.

STEP 2 — PRODUCT:
Place the product from the attached image as the central hero, perfectly centered over the burst. Maintain 100% visual fidelity. The product must appear to "pop out" with a strong drop shadow or glow effect behind it.

STEP 3 — TITLE TEXT:
Render this exact title in MASSIVE, BOLD 3D lettering at the top of the image. The text must have: thick black outline (stroke), strong drop shadow, slight 3D extrusion effect. Font style: heavy condensed sans-serif (like Impact, Anton, or Bebas Neue). All caps.

TITLE TO RENDER: "${title}"

Copy every character exactly. Do not add, remove or change any letter.

STEP 4 — FEATURE BADGES:
Around the product, place ${featureLines.length} badge${featureLines.length !== 1 ? "s" : ""}. Each badge must be a bold rounded rectangle or explosive splat shape with: thick 3–4px colored border, strong drop shadow, high-contrast text inside, and a relevant icon. Make them feel like stickers slapped onto the design.

${featureList}

CRITICAL TEXT ACCURACY RULES (NON-NEGOTIABLE):
- Copy EXACTLY what is given. Do not paraphrase, translate, summarize or "improve" any word.
- Do not invent words. Do not add decorative text that was not requested.
- Numbers must be copied exactly as provided.
- Accents and special characters (á, é, í, ó, ú, ñ, ü) must be preserved exactly.

ENERGY: Maximum visual intensity. This should look like the most eye-catching product listing on the page. Bold, loud, impossible to ignore.`;
      } else {
        prompt = `You are a magazine editorial photographer and art director. Create a LIFESTYLE PHOTO of the product in a real natural environment, with title text and feature labels elegantly superimposed on top of the photo. Think high-end magazine spread — like Vogue, Wallpaper*, or a premium brand lookbook.

STEP 1 — LIFESTYLE BACKGROUND SCENE:
Generate a real, photorealistic environment scene appropriate for this product. The scene must look like a genuine photograph — natural lighting, real textures, depth of field. Examples: a product for the kitchen → marble countertop with morning light and herbs; a tech product → clean wooden desk with soft window light; a beauty product → bathroom vanity with warm golden-hour glow; a sports product → outdoor natural setting. NO graphic design backgrounds. NO solid colors. NO gradients. A REAL SCENE.

STEP 2 — PRODUCT PLACEMENT:
Place the product from the attached image naturally within the scene as the clear hero. Maintain 100% visual fidelity to its shape, color, brand and materials. It should look like the product was photographed in that environment — realistic lighting, contact shadow, natural integration.

STEP 3 — TITLE TEXT OVERLAY:
Superimpose this exact title text over the photo using clean, elegant typography (thin or medium weight serif or sans-serif, white or very light color with a subtle text shadow for legibility):

TITLE TO RENDER: "${title}"

Position it at the top or bottom third of the image. Copy every character exactly.

STEP 4 — FEATURE LABELS OVERLAY:
Superimpose ${featureLines.length} minimal feature label${featureLines.length !== 1 ? "s" : ""} over the photo. Each label is a simple horizontal line (leader line) pointing to a relevant part of the product or scene, with a small icon and clean text beside it. Style: white text, thin line, small dot at the product. Like a fashion editorial callout or a product spec overlay in a luxury catalog.

${featureList}

CRITICAL TEXT ACCURACY RULES (NON-NEGOTIABLE):
- Copy EXACTLY what is given. Do not paraphrase, translate, summarize or "improve" any word.
- Do not invent words. Do not add decorative text that was not requested.
- Numbers must be copied exactly as provided.
- Accents and special characters (á, é, í, ó, ú, ñ, ü) must be preserved exactly.

MOOD: Aspirational, sophisticated, real. The photo must feel like it was shot by a professional photographer, not generated by AI. Natural, warm, editorial.`;
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