import { drawDimensions } from "./dimensionsOverlay";

export interface TransformationResult {
  imageUrl: string;
}

// Tamaños soportados por gpt-image-2.5-sunburst
const OPENAI_SIZES: Record<string, string> = {
  "1:1":  "1024x1024",
  "16:9": "1536x1024",
  "9:16": "1024x1536",
};

// high solo donde el modelo dibuja texto (Medidas lo dibuja la app); medium cuesta ~4x menos
const HIGH_QUALITY_STYLES = ["Infographic"];

async function generateOpenAIImage(
  style: string,
  prompt: string,
  aspectRatio: string,
  base64Image: string,
  mimeType: string,
): Promise<string> {
  const res = await fetch("/api/generate-image-openai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      style,
      prompt,
      size: OPENAI_SIZES[aspectRatio] || "1024x1024",
      quality: HIGH_QUALITY_STYLES.includes(style) ? "high" : "medium",
      image: base64Image,
      mimeType,
    }),
  });

  if (!res.ok) {
    const raw = await res.text();
    let message = raw;
    try { message = JSON.parse(raw).error || raw; } catch {}
    throw new Error(`OpenAI ${res.status}: ${message}`);
  }

  const data = await res.json() as { b64_json?: string };
  if (!data.b64_json) throw new Error("No image returned by API.");
  return `data:image/png;base64,${data.b64_json}`;
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
      // La IA solo genera la foto; cotas y leyenda las dibuja drawDimensions
      // con los números exactos del formulario (el modelo no copia texto de forma confiable).
      const ar = extraData?.aspectRatio || "1:1";
      const technicalPrompt = `${extraData?.productDescription ? `Product description provided by user: "${extraData.productDescription}"\n\n` : ""}You are a professional e-commerce product photographer.

Place the exact product from the attached image on a pure white background (#FFFFFF). Keep 100% visual fidelity: same shape, angle, colors, brand, labels and materials. Do not alter the product in any way.

COMPOSITION:
- Product centered, shown complete (never cropped), occupying about 75% of the frame.
- Soft, even studio lighting. Only a subtle contact shadow directly under the product.
- Pure white everywhere else: no gradients, no floor line, no props.
- Show ONLY the product: remove any hands, people, packaging or objects from the reference photo that are not part of the product itself.

STRICTLY FORBIDDEN: any text, numbers, measurement lines, arrows, labels, logos added to the scene, watermarks or graphic elements. The output must be a clean product photo only.`;

      const photo = await generateOpenAIImage("Technical", technicalPrompt, ar, base64Image, mimeType);
      return await drawDimensions(photo, {
        width: extraData?.width,
        height: extraData?.height,
        depth: extraData?.depth,
      });
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

  return await generateOpenAIImage(style, prompt, ar, base64Image, mimeType);
}

// ─── INFOGRAFÍA ──────────────────────────────────────────────
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


  return await generateOpenAIImage("Infographic", prompt, ar, base64Image, mimeType);
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