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
        prompt = `STEP 1 — PRODUCT ANALYSIS (automatic, internal):
Analyze the product in the attached image to identify: (1) its category and main use, (2) target audience and purchase motivation, (3) the core problem it solves. Then automatically select the 3 characteristics with the highest visual and commercial impact — ones understandable in under 2 seconds, with high perceived value, that differentiate this product from average listings. These 3 selected features will be shown as the badges in the design.
${featureLines.length > 0 ? `\nUSER-PROVIDED FEATURE CANDIDATES (use as input for your selection):\n${featureList}\n` : ""}
STEP 2 — BACKGROUND:
Create an explosive radial burst / starburst background with sharp rays emanating from the center, filling the entire frame edge to edge. Extract 2–3 highly saturated colors directly from the product (e.g. if the product is red → bright red + yellow; if blue → electric blue + lime). High-contrast rays, no white backgrounds.

STEP 3 — PRODUCT:
Place the product from the attached image as the central hero. Maintain 100% visual fidelity — same shape, color, brand, materials. The product must appear to "pop out" with a strong drop shadow or glow effect behind it.

STEP 4 — TITLE:
Render this exact title in MASSIVE, BOLD 3D lettering. Thick black outline (stroke), strong drop shadow, slight 3D extrusion effect. Heavy condensed sans-serif (Impact / Anton / Bebas Neue), all caps.
TITLE: "${title}"
Copy every character exactly. Do not add, remove or change any letter.

STEP 5 — FEATURE BADGES:
Place the 3 auto-selected features as badges around the product. Each badge: bold rounded rectangle or explosive splat shape, thick 3–4px colored border, strong drop shadow, bold relevant icon + short bold uppercase text. Feel like stickers slapped onto a sports poster.

LAYOUT BY ASPECT RATIO — apply the one matching the requested output:
- 1:1 (square): product perfectly centered, badges arranged around it (e.g. top-left, top-right, bottom-center).
- 9:16 (portrait): title large at the top → product dominant in the center → 3 badges in a row below the product.
- 16:9 (landscape): product on the right two-thirds → title + 3 badges stacked vertically on the left third.

ENERGY: Maximum visual intensity. Sports poster meets comic book cover. Bold, loud, impossible to scroll past.

CRITICAL TEXT ACCURACY (NON-NEGOTIABLE):
- Copy title EXACTLY. Do not paraphrase, translate, summarize or add any word.
- Numbers must be copied exactly. Preserve all accents (á, é, í, ó, ú, ñ, ü).
- Do NOT invent decorative text that was not requested.

PRODUCT FIDELITY (NON-NEGOTIABLE): Never invent accessories, change colors, alter proportions or add fake features to the product.`;
      } else {
        prompt = `STEP 1 — PRODUCT ANALYSIS (automatic, internal):
Analyze the product in the attached image to identify: (1) its category and main use, (2) target audience and purchase motivation, (3) the core problem it solves. Then automatically select the 3 characteristics with the highest visual and commercial impact — ones understandable in under 2 seconds, with high perceived value, that differentiate this product from average listings. These 3 selected features will be rendered as text directly on the photo.
${featureLines.length > 0 ? `\nUSER-PROVIDED FEATURE CANDIDATES (use as input for your selection):\n${featureList}\n` : ""}
STEP 2 — SCENE:
Generate a real, photorealistic lifestyle scene that fills the ENTIRE image edge to edge — natural lighting, real textures, genuine depth of field. Choose a setting appropriate to this product (e.g. kitchen product → marble countertop with warm morning light; tech product → clean wooden desk by a window; beauty product → bathroom vanity with golden-hour glow; sports product → natural outdoor setting). NO solid color backgrounds. NO gradients. A REAL photographed-looking scene. The photo has NO panels, NO color blocks, NO overlays, NO semi-transparent layers of any kind.

STEP 3 — PRODUCT:
Place the product from the attached image naturally in the scene as the undisputed hero. Maintain 100% visual fidelity — same shape, color, brand, materials. Realistic lighting, contact shadow, natural integration. It must look like it was physically present in that scene.

STEP 4 — TITLE:
Float this exact title directly over the photo in large, bold, uppercase, clean sans-serif. White text with a strong drop shadow for readability. NO background, NO box, NO pill, NO color block behind the text — the text sits directly on the photo like a magazine cover.
TITLE: "${title}"
Copy every character exactly. Do not add, remove or change any letter.

STEP 5 — FEATURES:
Float the 3 auto-selected features directly over the photo. Each feature: a ✓ checkmark or shield icon + short bold uppercase white text with strong drop shadow. NO background behind the text, NO panels, NO bordered boxes, NO arrow lines. Text floats over the photo exactly like a magazine cover headline.

LAYOUT BY ASPECT RATIO — apply the one matching the requested output:
- 1:1 (square): title large at the top of the photo → product centered → 3 features at the bottom, spaced horizontally.
- 9:16 (portrait): title at the top of the photo → product large and centered → 3 features in a horizontal row near the bottom.
- 16:9 (landscape): title + 3 features stacked vertically on the left side of the photo → product prominent on the right.

TYPOGRAPHY RULE: Every character of text — title and features — is rendered in pure white (#FFFFFF), bold weight, clean sans-serif, with a strong multi-layer drop shadow (e.g. 2px black shadow + 4px soft black shadow) to ensure legibility over any background. This is the ONLY technique allowed for text readability. No backgrounds of any kind.

MOOD: Aspirational, sophisticated. Premium editorial magazine cover — full-bleed photo, text floating on top.

CRITICAL TEXT ACCURACY (NON-NEGOTIABLE):
- Copy title EXACTLY. Do not paraphrase, translate, summarize or add any word.
- Numbers must be copied exactly. Preserve all accents (á, é, í, ó, ú, ñ, ü).
- NO arrow lines or leader lines. Use ✓ checkmark or shield icons only.
- Do NOT invent decorative text that was not requested.

PRODUCT FIDELITY (NON-NEGOTIABLE): Never invent accessories, change colors, alter proportions or add fake features to the product.`;
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
      responseModalities: ["IMAGE"],
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