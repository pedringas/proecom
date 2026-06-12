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
  const infoStyle = extraData?.infoStyle || "Pop";
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

  let prompt = "";

  if (infoStyle === "Elegante") {
    prompt = `${descPrefix}GENERATE THIS IMAGE IN EXACTLY ${ar} FORMAT.

━━━ RULE #1 — PRODUCT FIDELITY (ABSOLUTE, NON-NEGOTIABLE) ━━━
The product in the final image MUST BE 100% IDENTICAL to the product in the attached reference photo.
DO NOT regenerate, redesign, reimagine or alter the product in any way.
Same shape, colors, brand markings, labels, materials and proportions — locked.
You may only change: the scene/environment around it, lighting, text overlays.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are a professional product photographer and art director for a premium brand catalog.

MISSION: Create a HYPERREALISTIC PRODUCT LIFESTYLE PHOTO — not a graphic design, not an illustration, not a collage. A real photograph.

PRODUCT IN SCENE (MANDATORY):
Show the exact product from the attached image placed in its natural environment, in use or displayed elegantly. Examples:
- A tea canister: next to a steaming cup and spoon (product unchanged)
- A yerba canister: next to a gourd and thermos (product unchanged)
- A toy: displayed in a real room (product unchanged)
The product must feel ALIVE in the scene — but its appearance must be 100% faithful to the reference.

SCENE:
${infoScenario ? `Use this specific scene: "${infoScenario}"` : "Choose the most aspirational real environment for this product category. Warm natural lighting, soft bokeh background."}

LAYOUT — STRICT ZONES (text must NEVER overlap the product):
- TOP BAND (~20%): Dedicated strip with its own background. Contains ONLY the title. Product NOT visible in this band.
- CENTER (~60%): The product in the scene, clearly visible. ABSOLUTELY NO TEXT on top of the product.
- FEATURES: Placed below the product, on the sides, or in corner areas — NEVER on top of the product.

TITLE (in TOP BAND only, never on the product): ${titleProvided
  ? `"${titleProvided}" in large bold uppercase sans-serif — copy exactly.`
  : `Create a short sales hook in Spanish (6-10 words) that combines an emotional trigger with a key benefit. NOT the product name. Style: premium, aspirational. Examples: "VIVÍ LA DIFERENCIA EN CADA DETALLE", "EL COMPLEMENTO QUE SIEMPRE FALTABA", "CALIDAD QUE SE SIENTE DESDE EL PRIMER USO". Large bold uppercase sans-serif.`
} — choose color that contrasts with the band's background. Title FULLY VISIBLE, never cut off.
- Thin accent line below the title (1-2px, color derived from product)

FEATURES (placed around/below product, NOT on top) — ALL of them, no omissions:
${featureLines.length > 0 ? featureList : "(no features provided)"}
Each feature: bold UPPERCASE label + optional short description. Clean icons. Separated by thin lines.
- ALL feature text must be in UPPERCASE bold — no lowercase anywhere in the feature list.
- ALL features provided above must be shown without exception. If there are many features, reduce font size or adjust layout to fit every single one — never omit any.

STYLE RULES:
- Hyperrealistic photography — not CGI, not illustration
- Soft professional lighting — warm and natural
- Premium catalog quality — like a high-end brand shoot
- NO people, NO hands unless absolutely necessary for context
- Color palette derived from the product itself
- Text must be perfectly legible with strong contrast

CRITICAL TEXT RULES:
- Title ALWAYS in ALL CAPS
- Copy ALL features EXACTLY as provided — no changes, no omissions
- Preserve accents (á, é, í, ó, ú, ñ)

PRODUCT FIDELITY: 100% faithful — same shape, colors, labels, materials. Never alter the product.`;
  } else {
    const titleInstruction = titleProvided
      ? `"${titleProvided}" — copy EXACTLY in ALL CAPS, no changes.`
      : `Create a short sales hook in Spanish (6-10 words) that combines an emotional trigger with a key benefit. Focus on what the customer GAINS or FEELS — NOT just the product name. Style: conversational, energetic, action-oriented. Examples of the tone: "HORAS DE DIVERSIÓN GARANTIZADAS EN FAMILIA", "EL REGALO QUE TUS HIJOS VAN A AMAR", "SENTÍ LA DIFERENCIA DESDE EL PRIMER USO". Render in ALL CAPS.`;

    prompt = `${descPrefix}GENERATE THIS IMAGE IN EXACTLY ${ar} FORMAT. ${arDescriptions[ar] || ar}.

CRITICAL — PRODUCT FIDELITY:
The product in the final image must be 100% identical to the product in the attached photo.
DO NOT alter, redesign, reimagine or replace it. Same shape, colors, markings, materials. Locked asset.

CRITICAL — LAYOUT STRUCTURE (follow exactly, no exceptions):
Design this as a professional e-commerce infographic card with THREE visually distinct, non-overlapping sections:

[SECTION 1 — TOP HEADER BAR, approximately top 18-22% of the image]
- A solid or gradient colored banner/strip that spans the full width.
- This strip has its OWN background color — the product is NOT visible behind it.
- Contains ONLY the headline text, large and bold, centered.
- Think of it like a colored label sticker attached to the TOP of the product card.

[SECTION 2 — PRODUCT AREA, approximately middle 55-65% of the image]
- The product from the reference photo, centered, clean background.
- THIS AREA IS TEXT-FREE. Zero text, zero labels, zero icons inside this section.
- The product must be fully visible and unobscured.

[SECTION 3 — FEATURES AREA, remaining space (sides, bottom, or both)]
- Feature badges/pills placed OUTSIDE the product area: left column, right column, or bottom strip.
- Each feature: icon + short label. Clean, scannable, high contrast.
- Features connect to the product visually via thin lines or arrows pointing TOWARD it from the sides.

HEADLINE (Section 1 only): ${titleInstruction}

FEATURES (Section 3 only) — include ALL, no omissions, no paraphrasing:
${featureLines.length > 0 ? featureList : "(no features provided)"}

STYLE: Bold e-commerce graphic design. Color palette from the product. Professional typography.

TEXT ACCURACY: Copy all features exactly as written. Preserve Spanish accents. Do not invent text.`;
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