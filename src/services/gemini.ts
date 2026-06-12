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
    infoScenario?: string;
  }
): Promise<string> {
  let prompt = "";

  switch (style) {

    // ─── 1. PRODUCTO (fondo blanco de estudio) ───────────────────────────────
    case "Ecom":
      prompt = `${extraData?.productDescription ? `Product description provided by user: "${extraData.productDescription}"\n\n` : ""}You are a professional e-commerce photographer. Analyze the attached image and the product name/description: "${extraData?.productDescription || "product"}".
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
      prompt = `${extraData?.productDescription ? `Product description provided by user: "${extraData.productDescription}"\n\n` : ""}You are a professional lifestyle product photographer. Using the attached product image as an exact reference, generate a lifestyle photograph WITHOUT any people or human body parts.

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
      prompt = `${extraData?.productDescription ? `Product description provided by user: "${extraData.productDescription}"\n\n` : ""}You are a professional lifestyle photographer. Using the attached product image as an exact reference, generate a lifestyle photograph showing the product in use by people.

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
      const ar = extraData?.aspectRatio || "1:1";
      const sizeMap: Record<string, string> = {
        "1:1":  "1024x1024",
        "16:9": "1792x1024",
        "9:16": "1024x1792",
      };

      const technicalPrompt = `${extraData?.productDescription ? `Product description provided by user: "${extraData.productDescription}"\n\n` : ""}You are a professional product photographer and graphic designer creating a technical dimensions sheet for an e-commerce listing.

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

      const techRes = await fetch("/api/generate-image-openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          style: "Technical",
          prompt: technicalPrompt,
          size: sizeMap[ar] || "1024x1024",
          image: base64Image,
          mimeType,
        }),
      });

      if (!techRes.ok) {
        const err = await techRes.text();
        throw new Error(`Technical API error ${techRes.status}: ${err}`);
      }

      const techData = await techRes.json() as { b64_json?: string };
      if (!techData.b64_json) throw new Error("No image returned by API.");
      return `data:image/png;base64,${techData.b64_json}`;
    }

    // ─── 5. INFOGRAFÍA ───────────────────────────────────────────────────────
    case "Infographic": {
      return await generateInfographic(base64Image, mimeType, extraData);
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

  const response = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "image",
      parts: [
        { inlineData: { data: base64Image, mimeType } },
        { text: prompt },
      ],
      config: {
        responseModalities: ["IMAGE"],
        aspectRatio: extraData?.aspectRatio || "1:1",
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json() as { imageData?: string };
  if (!data.imageData) throw new Error("No image was returned by the API.");
  return `data:image/png;base64,${data.imageData}`;
}

// ─── INFOGRAFÍA VIA GPT-IMAGE-1 ──────────────────────────────────────────────
async function generateInfographic(
  base64Image: string,
  mimeType: string,
  extraData?: {
    title?: string;
    features?: string;
    aspectRatio?: "1:1" | "16:9" | "9:16";
    infoStyle?: "Pop" | "Elegante";
    infoScenario?: string;
    [key: string]: unknown;
  }
): Promise<string> {
  const titleProvided = (extraData?.title || "").trim();
  const title = titleProvided;
  const features = (extraData?.features as string) || "";
  const infoStyle: "Pop" | "Elegante" = (extraData?.infoStyle || "").toLowerCase() === "elegante" ? "Elegante" : "Pop";
  const ar = (extraData?.aspectRatio as string) || "1:1";
  const infoScenario = (extraData?.infoScenario as string) || "";
  const productDesc = (extraData?.productDescription as string) || "";
  const descPrefix = productDesc ? `Product description provided by user: "${productDesc}"\n\n` : "";

  const featureLines = features
    .split("\n")
    .map((f: string) => f.trim())
    .filter((f: string) => f.length > 0);

  const featureList = featureLines
    .map((f: string, i: number) => `Feature ${i + 1}: "${f}"`)
    .join("\n");

  const arDescriptions: Record<string, string> = {
    "1:1":  "SQUARE FORMAT (1:1) — equal width and height. Optimize all composition, text sizing and product placement for a perfectly square canvas",
    "9:16": "VERTICAL/PORTRAIT FORMAT (9:16) — tall vertical phone screen. Design for mobile-first vertical scroll, with stacked layout optimized for this tall format",
    "16:9": "HORIZONTAL/LANDSCAPE FORMAT (16:9) — wide horizontal banner. Design for a wide screen with horizontal composition, product on one side and text on the other",
  };

  const autoTitle = infoStyle === "Elegante"
    ? `Write a premium Spanish sales headline (4-6 words, ALL CAPS, bold) that highlights a key benefit or quality. Style: aspirational, sophisticated. Example tone: "DURABILIDAD SIN HUELLAS", "ESTILO SOFT NORDIC DURADERO", "ESTÉTICA & LIMPIEZA PREMIUM".`
    : `Write an energetic Spanish sales headline (4-6 words, ALL CAPS, bold) that highlights a key benefit. Example tone: "FRESCURA QUE DURA TODO EL DÍA", "SABOR PERFECTO SIEMPRE LISTO".`;
  const headlineText = titleProvided ? `"${titleProvided}"` : autoTitle;
  const featuresText = featureLines.length > 0
    ? featureLines.map(f => `• ${f}`).join("\n")
    : "(none provided)";

  const sceneContext = infoScenario
    ? `Scene context: "${infoScenario}"`
    : infoStyle === "Elegante"
      ? "Choose a warm, natural lifestyle context appropriate for this product (kitchen counter, wooden table near window, etc.) with 1-2 complementary props that suggest use."
      : "Choose a clean, well-lit lifestyle context for this product with 1-2 props that suggest its use.";

  let prompt = "";

  if (infoStyle === "Elegante") {
    prompt = `${descPrefix}Professional commercial product photography, ${ar} format, shot on 85mm lens at f/2.0 aperture. Photorealistic, magazine-quality image for a premium e-commerce listing.

SCENE: ${sceneContext} The product rests on a natural surface with 1-2 contextual props (complementary to the product type). Warm natural side-lighting, soft bokeh background. The upper portion of the frame has a clear, light area — wall, window glow or open background — with plenty of negative space for text.

PRODUCT: Render the exact product from the reference image — identical shape, colors, labels, markings and materials. Do not alter it in any way.

TYPOGRAPHY OVERLAY (rendered directly on the photo, on the clear negative space in the upper area, never on the product):
Headline: ${headlineText} — bold uppercase, large, dark color matching the product's palette, clean serif or sans-serif.
Below the headline, as bullet points:
${featuresText}
Bullet style: • symbol, same dark color, clean sans-serif, clearly legible.

The text must look like professional typography cleanly overlaid on a real photograph. No graphic design elements, no boxes, no banners — just text on the natural background of the photo.

Photorealistic lighting, real depth of field, hyperrealistic product rendering. Shot for a high-end Argentine marketplace listing.`;
  } else {
    prompt = `${descPrefix}Professional commercial product photography, ${ar} format, shot on 50mm lens at f/2.8 aperture. Crisp, vibrant, photorealistic image for an e-commerce listing.

SCENE: ${sceneContext} The product is the clear hero, placed center-frame or slightly lower, with 1-2 props that suggest its use. Bright, clean natural lighting. The upper portion of the frame — wall, clean background or open space — provides generous negative space where text will be placed.

PRODUCT: Render the exact product from the reference image — identical shape, colors, labels, markings and materials. Do not alter it in any way.

TYPOGRAPHY OVERLAY (rendered directly on the photo, on the open background area in the upper portion, never touching the product):
Headline: ${headlineText} — very large, bold uppercase, strong dark color that contrasts with the background and matches the product palette, bold modern sans-serif.
Below or beside the headline, as bullet points:
${featuresText}
Bullet style: • symbol, bold sans-serif, same color family as headline, clearly readable.

The text must look like bold professional typography cleanly overlaid on a real photograph. No graphic design elements, no boxes, no banners, no sections — just text floating on the natural background of the photo.

Hyperrealistic product rendering, natural depth of field, commercial photography quality.`;
  }


  const sizeMap: Record<string, string> = {
    "1:1":  "1024x1024",
    "16:9": "1792x1024",
    "9:16": "1024x1792",
  };

  const response = await fetch("/api/generate-image-openai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      size: sizeMap[ar] || "1024x1024",
      image: base64Image,
      mimeType,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Infographic API error ${response.status}: ${err}`);
  }

  const data = await response.json() as { b64_json?: string };
  const b64 = data.b64_json;
  if (!b64) throw new Error("No image returned by infographic API.");
  return `data:image/png;base64,${b64}`;
}

// ─── ANALYZE PRODUCT (para Video 360°) ───────────────────────────────────────
export async function analyzeProduct(
  images: { base64: string; mimeType: string }[],
  userDescription?: string
): Promise<string> {
  const parts = [
    ...images.map((img) => ({
      inlineData: { data: img.base64, mimeType: img.mimeType },
    })),
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
  ];

  const response = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "text", parts }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json() as { text?: string };
  return data.text || "A high-quality commercial product.";
}

// ─── GENERATE VIDEO 360° ─────────────────────────────────────────────────────
export async function generateVideo360(
  description: string,
  images: { base64: string; mimeType: string }[]
): Promise<string> {
  const response = await fetch("/api/gemini-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, images }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Video generation error ${response.status}: ${err}`);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}