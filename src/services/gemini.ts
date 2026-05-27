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
  }
): Promise<string> {
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
      const ar = extraData?.aspectRatio || "1:1";
      const sizeMap: Record<string, string> = {
        "1:1":  "1024x1024",
        "16:9": "1792x1024",
        "9:16": "1024x1792",
      };

      const technicalPrompt = `You are a professional product photographer and graphic designer creating a technical dimensions sheet for an e-commerce listing.

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
    [key: string]: unknown;
  }
): Promise<string> {
  const title = extraData?.title || "";
  const features = (extraData?.features as string) || "";
  const infoStyle = extraData?.infoStyle || "Pop";
  const ar = (extraData?.aspectRatio as string) || "1:1";

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
    prompt = `GENERATE THIS IMAGE IN EXACTLY ${ar} FORMAT. ${arDescriptions[ar] || ar}. Design everything for this ratio from the start — this is non-negotiable.

You are a world-class lifestyle photographer and art director specializing in premium e-commerce for MercadoLibre. Your goal: create a high-converting, aspirational infographic where the product is shown IN USE in a real scene.

STEP 1 — PRODUCT IN USE (CORE REQUIREMENT):
The product must not merely sit in an environment — it must be actively in use or being interacted with. Show it in a real, believable moment of use:
- Kitchen appliance → someone using it to cook, pour, blend — hands visible, steam, food present
- Tech product → in someone's hands, on a desk being used, screen lit up with relevant content
- Beauty/personal care → being applied, held, used in a bathroom or vanity scene
- Sports/outdoor → in motion, being worn or used during activity, dynamic energy
- Apparel/accessories → worn on a real person in a natural moment, not posed
- Home product → integrated into a lived-in, real interior scene with people or signs of life
The scene must feel like a real photograph taken in a real moment — not a staged product shot.

STEP 2 — SCENE AND COMPOSITION (YOU DECIDE FREELY):
Choose the composition that best showcases the product in use for its specific category. You are completely free:
- Crop: tight on the action, wide establishing shot, medium portrait — whatever shows the use best
- Angle: eye-level, over-the-shoulder, first-person POV, slight high angle — choose the most cinematic
- Lighting: natural window light, warm golden hour, cool studio, dramatic side light — match the mood of the product
- Setting: real location that fits the product's world — a real kitchen, a real gym, a real desk, outdoors, a real bathroom
- Color palette: warm, cool, neutral or bold — derive from the product and scene, not arbitrary

STEP 3 — MANDATORY TEXT ELEMENTS:
TITLE: "${title}"
- Render in ALL CAPS, exactly as written (no word changes, no additions, no omissions — only uppercase conversion)
- Overlay it directly on the image in a position where it reads clearly against the scene
- Use bold, clean sans-serif — large enough to dominate the composition
- Readability technique: strong multi-layer drop shadow, OR a subtle semi-transparent dark/light panel behind the text ONLY if needed for contrast. Choose what looks most premium.

FEATURES — render ALL of the following without exception. Do not select, filter, merge or omit any:
${featureLines.length > 0 ? `${featureList}` : "(no features provided)"}
- Float each feature over the image: ✓ checkmark or relevant icon + bold uppercase text
- Ensure every feature is clearly legible — use drop shadow or a minimal subtle panel for contrast if needed
- Distribute them naturally across the composition; do not stack them all in one corner

STEP 4 — VISUAL QUALITY:
- Hyperrealistic photography quality — not illustrated, not 3D render, not flat design
- Product rendered with 100% fidelity to the attached reference image (same shape, colors, brand, materials, proportions)
- Typography: premium, modern, bold — no generic or default fonts
- Overall mood: aspirational, premium, trustworthy — the kind of image that makes someone stop scrolling
- High contrast between text and background at all times — legibility is mandatory

STEP 5 — CRITICAL TEXT ACCURACY (NON-NEGOTIABLE):
- Title: render every word exactly as given, in ALL CAPS. Do not change, add or remove any word.
- Features: ALL of them rendered exactly as provided. Do not omit, merge, paraphrase or rewrite any.
- Copy every number exactly (do not round or alter).
- Preserve all Spanish accents and special characters (á, é, í, ó, ú, ñ, ü).
- Do NOT invent any text that was not explicitly provided.

PRODUCT FIDELITY (NON-NEGOTIABLE):
The product must be 100% faithful to the attached reference photo — same exact shape, colors, brand markings, materials and proportions. Do not redesign, reimagine or alter it in any way.`;
  } else {
    prompt = `GENERATE THIS IMAGE IN EXACTLY ${ar} FORMAT. ${arDescriptions[ar] || ar}. This is the most critical requirement — design everything for this ratio from the start.

You are an expert in e-commerce, visual neuromarketing and conversion optimization for MercadoLibre. Your mission: create the most effective product infographic possible to maximize clicks, trust and conversions.

STEP 1 — AUTOMATIC PRODUCT ANALYSIS:
Before designing, analyze the attached product image and determine:
- Product category and specific use
- Target audience and their main purchase motivation
- Core problem the product solves
- Visual personality: premium / fun / technical / natural / sporty / etc.
Use this analysis to make every design decision below.

STEP 2 — CREATIVE DIRECTION (YOU DECIDE):
Based on your product analysis, freely choose the most impactful visual composition. You are not locked to any fixed layout. You can choose:
- Background: lifestyle scene, color gradient, abstract pattern, studio white, explosive burst — whatever best serves the product
- Composition: product centered, off-center, hero left/right, diagonal, floating — whatever maximizes visual impact
- Color palette: derive from the product's own colors and brand, or choose a complementary palette that elevates it
- Typography style: 3D bold, clean magazine, handwritten accent, mixed — choose what fits the product's personality
- Badge/feature style: stickers, floating text, checkmarks, icons, minimal lines — choose what fits the visual direction

STEP 3 — MANDATORY TEXT ELEMENTS:
TITLE: "${title}"
- Render in ALL CAPS, exactly as written above (no word changes, no additions, no omissions — only convert to uppercase)
- Make it the dominant typographic element, impossible to miss
- Use an accent line, underline, or decorative element to make it stand out

FEATURES — render ALL of the following without exception. Do not select, filter, merge or omit any:
${featureLines.length > 0 ? `${featureList}` : "(no features provided)"}
- Every feature must be clearly legible and individually distinguishable
- Use icons, checkmarks, or badges to make each feature scannable at a glance

STEP 4 — VISUAL STYLE:
- Photography/rendering: hyperrealistic, high-end commercial quality
- Product must be rendered with 100% fidelity to the attached reference image (same shape, colors, materials, logos)
- Typography: modern, bold, professional — no default or generic fonts
- Overall mood: aspirational, trustworthy, conversion-optimized
- The final image must look like it was designed by a top-tier MercadoLibre conversion specialist

STEP 5 — CRITICAL TEXT ACCURACY (NON-NEGOTIABLE):
- Title: every word rendered exactly as given, in ALL CAPS. Do not change, add or remove any word.
- Features: ALL of them rendered exactly as provided. Do not omit, merge, paraphrase or rewrite any.
- Copy every number exactly (do not round or alter).
- Preserve all Spanish accents and special characters (á, é, í, ó, ú, ñ, ü).
- Do NOT invent any text that was not explicitly provided.

PRODUCT FIDELITY (NON-NEGOTIABLE):
The product in the final image must be 100% faithful to the attached reference photo — same exact shape, colors, brand markings, materials and proportions. Do not redesign, reimagine or alter the product in any way.`;
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