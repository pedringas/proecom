export interface TransformationResult {
  imageUrl: string;
}

export type InfographicLayout = "left_dark_panel" | "top_right_text" | "bottom_cards";

export interface InfographicFeature {
  icon?: string;
  title: string;
  description: string;
}

// ─── SVG overlay helpers ──────────────────────────────────────────────────────

function escXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function splitText(text: string, maxChars = 28): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) { current = word; continue; }
    if (current.length + 1 + word.length <= maxChars) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function featureIconSvg(icon = "circle"): string {
  if (icon === "sun_off") return `
    <circle cx="0" cy="0" r="24" fill="none" stroke="currentColor" stroke-width="2.5"/>
    <circle cx="0" cy="0" r="8" fill="none" stroke="currentColor" stroke-width="2.5"/>
    <line x1="-18" y1="-18" x2="18" y2="18" stroke="currentColor" stroke-width="2.5"/>`;
  if (icon === "droplet_off") return `
    <path d="M0,-18 C10,-8 12,0 12,8 C12,18 5,24 0,24 C-5,24 -12,18 -12,8 C-12,0 -10,-8 0,-18 Z" fill="none" stroke="currentColor" stroke-width="2.5"/>
    <line x1="-18" y1="-18" x2="18" y2="18" stroke="currentColor" stroke-width="2.5"/>`;
  if (icon === "leaf") return `
    <path d="M-16,10 C-12,-12 10,-18 18,-4 C12,14 -4,22 -16,10 Z" fill="none" stroke="currentColor" stroke-width="2.5"/>
    <line x1="-7" y1="9" x2="9" y2="-3" stroke="currentColor" stroke-width="2.5"/>`;
  if (icon === "star") return `
    <polygon points="0,-22 6,-8 20,-8 10,2 14,18 0,10 -14,18 -10,2 -20,-8 -6,-8" fill="none" stroke="currentColor" stroke-width="2.5"/>`;
  if (icon === "check") return `
    <circle cx="0" cy="0" r="22" fill="none" stroke="currentColor" stroke-width="2.5"/>
    <polyline points="-10,0 -2,10 12,-8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>`;
  return `<circle cx="0" cy="0" r="22" fill="none" stroke="currentColor" stroke-width="2.5"/>`;
}

function renderFeatureSvg(feature: InfographicFeature, index: number, iconColor: string): string {
  const startY = 305 + index * 210;
  const descLines = splitText(feature.description || "", 24)
    .slice(0, 3)
    .map((line, i) => `<text x="112" y="${startY + 48 + i * 28}" class="fdesc">${escXml(line)}</text>`)
    .join("\n");
  return `
    <g transform="translate(58, ${startY - 10})" color="${iconColor}">${featureIconSvg(feature.icon)}</g>
    <text x="112" y="${startY}" class="ftitle">${escXml(feature.title.toUpperCase())}</text>
    ${descLines}
    <line x1="48" y1="${startY + 110}" x2="300" y2="${startY + 110}" stroke="${iconColor}" stroke-width="1.5" opacity="0.5"/>`;
}

function buildInfographicSvg(params: {
  title: string;
  subtitle: string;
  features: InfographicFeature[];
  layout: InfographicLayout;
  style: "Pop" | "Elegante";
}): string {
  const isElegante = params.style === "Elegante";
  const panelColor  = isElegante ? "#171615" : "#1a0a2e";
  const iconColor   = isElegante ? "#d8c3ad" : "#C4B5FD";
  const accentColor = isElegante ? "#d4b393" : "#C4B5FD";

  const titleLines    = splitText(params.title.toUpperCase(), 12).slice(0, 3);
  const subtitleLines = splitText(params.subtitle, 25).slice(0, 4);
  const subtitleStartY = 86 + titleLines.length * 58 + 34;
  const dividerY = subtitleStartY + subtitleLines.length * 34 + 24;

  const titleSvg = titleLines
    .map((l, i) => `<text x="48" y="${86 + i * 58}" class="title">${escXml(l)}</text>`)
    .join("\n");
  const subtitleSvg = subtitleLines
    .map((l, i) => `<text x="48" y="${subtitleStartY + i * 34}" class="subtitle">${escXml(l)}</text>`)
    .join("\n");
  const featuresSvg = params.features.slice(0, 3)
    .map((f, i) => renderFeatureSvg(f, i, iconColor))
    .join("\n");

  const baseStyle = `
    <style>
      .title   { font-family: Arial, Helvetica, sans-serif; font-weight: 800; font-size: 56px; letter-spacing: -1px; fill: #ffffff; }
      .subtitle{ font-family: Arial, Helvetica, sans-serif; font-weight: 400; font-size: 26px; fill: #f2e8df; }
      .ftitle  { font-family: Arial, Helvetica, sans-serif; font-weight: 800; font-size: 22px; fill: #ffffff; }
      .fdesc   { font-family: Arial, Helvetica, sans-serif; font-weight: 400; font-size: 20px; fill: #f1e4d8; }
    </style>`;

  if (params.layout === "left_dark_panel") {
    return `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${baseStyle}
  <rect x="0" y="0" width="340" height="1024" fill="${panelColor}" opacity="0.88"/>
  <rect x="48" y="${dividerY}" width="120" height="8" rx="4" fill="${accentColor}"/>
  ${titleSvg}
  ${subtitleSvg}
  ${featuresSvg}
</svg>`;
  }

  if (params.layout === "top_right_text") {
    const trTitleSvg = titleLines
      .map((l, i) => `<text x="648" y="${56 + i * 52}" class="title" style="font-size:48px">${escXml(l)}</text>`)
      .join("\n");
    const trSubStartY = 56 + titleLines.length * 52 + 20;
    const trSubSvg = subtitleLines
      .map((l, i) => `<text x="648" y="${trSubStartY + i * 30}" class="subtitle" style="font-size:22px">${escXml(l)}</text>`)
      .join("\n");
    const panelH = trSubStartY + subtitleLines.length * 30 + 30;
    const featCards = params.features.slice(0, 3).map((f, i) => {
      const cx = 24 + i * 330;
      const descLine = (splitText(f.description || "", 20)[0] || "").slice(0, 28);
      return `
        <rect x="${cx}" y="730" width="315" height="260" rx="14" fill="${panelColor}" opacity="0.88"/>
        <g transform="translate(${cx + 30}, 778)" color="${iconColor}">${featureIconSvg(f.icon)}</g>
        <text x="${cx + 24}" y="842" class="ftitle">${escXml(f.title.toUpperCase())}</text>
        <text x="${cx + 24}" y="872" class="fdesc" style="font-size:18px">${escXml(descLine)}</text>`;
    }).join("\n");
    return `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${baseStyle}
  <rect x="600" y="0" width="424" height="${panelH}" fill="${panelColor}" opacity="0.85"/>
  <rect x="648" y="${panelH - 20}" width="100" height="6" rx="3" fill="${accentColor}"/>
  ${trTitleSvg}
  ${trSubSvg}
  ${featCards}
</svg>`;
  }

  // bottom_cards
  const centerTitleSvg = titleLines
    .map((l, i) => `<text x="512" y="${56 + i * 56}" class="title" text-anchor="middle">${escXml(l)}</text>`)
    .join("\n");
  const centerSubStartY = 56 + titleLines.length * 56 + 20;
  const centerSubSvg = subtitleLines
    .map((l, i) => `<text x="512" y="${centerSubStartY + i * 32}" class="subtitle" text-anchor="middle" style="font-size:24px">${escXml(l)}</text>`)
    .join("\n");
  const centerAccY = centerSubStartY + subtitleLines.length * 32 + 12;
  const featCardsBottom = params.features.slice(0, 3).map((f, i) => {
    const cx = 24 + i * 330;
    const descLine = (splitText(f.description || "", 20)[0] || "").slice(0, 28);
    return `
      <rect x="${cx}" y="726" width="315" height="270" rx="14" fill="${panelColor}" opacity="0.88"/>
      <g transform="translate(${cx + 30}, 770)" color="${iconColor}">${featureIconSvg(f.icon)}</g>
      <text x="${cx + 24}" y="836" class="ftitle">${escXml(f.title.toUpperCase())}</text>
      <text x="${cx + 24}" y="864" class="fdesc" style="font-size:18px">${escXml(descLine)}</text>`;
  }).join("\n");
  return `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${baseStyle}
  ${centerTitleSvg}
  ${centerSubSvg}
  <rect x="462" y="${centerAccY}" width="100" height="6" rx="3" fill="${accentColor}"/>
  ${featCardsBottom}
</svg>`;
}

async function compositeOverlay(
  baseDataUrl: string,
  svgString: string,
  targetW: number,
  targetH: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d")!;
    const baseImg = new Image();
    baseImg.onload = () => {
      ctx.drawImage(baseImg, 0, 0, targetW, targetH);
      const scaledSvg = svgString.replace(
        'width="1024" height="1024"',
        `width="${targetW}" height="${targetH}"`
      );
      const blob = new Blob([scaledSvg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const svgImg = new Image();
      svgImg.onload = () => {
        ctx.drawImage(svgImg, 0, 0, targetW, targetH);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/png"));
      };
      svgImg.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      svgImg.src = url;
    };
    baseImg.onerror = reject;
    baseImg.src = baseDataUrl;
  });
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
    subtitle?: string;
    features?: string;
    structuredFeatures?: InfographicFeature[];
    lifestylePrompt?: string;
    productDescription?: string;
    aspectRatio?: "1:1" | "16:9" | "9:16";
    infoStyle?: "Pop" | "Elegante";
    infoScenario?: string;
    infographicLayout?: InfographicLayout;
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

// ─── INFOGRAFÍA: base visual + overlay por canvas ────────────────────────────
async function generateInfographic(
  base64Image: string,
  mimeType: string,
  extraData?: {
    title?: string;
    subtitle?: string;
    structuredFeatures?: InfographicFeature[];
    features?: string;
    aspectRatio?: "1:1" | "16:9" | "9:16";
    infoStyle?: "Pop" | "Elegante";
    infoScenario?: string;
    infographicLayout?: InfographicLayout;
    productDescription?: string;
    [key: string]: unknown;
  }
): Promise<string> {
  const title    = (extraData?.title    || "").trim();
  const subtitle = (extraData?.subtitle || "").trim();
  const layout: InfographicLayout = (extraData?.infographicLayout as InfographicLayout) || "left_dark_panel";
  const style: "Pop" | "Elegante"  = extraData?.infoStyle === "Elegante" ? "Elegante" : "Pop";
  const ar         = extraData?.aspectRatio || "1:1";
  const infoScenario  = (extraData?.infoScenario  as string) || "";
  const productDesc   = (extraData?.productDescription as string) || "";
  const descPrefix    = productDesc ? `Product description provided by user: "${productDesc}"\n\n` : "";

  // Build features array — structured takes priority, plain text as fallback
  let features: InfographicFeature[];
  if (extraData?.structuredFeatures?.length) {
    features = extraData.structuredFeatures.slice(0, 3);
  } else {
    features = ((extraData?.features as string) || "")
      .split("\n").map(f => f.trim()).filter(Boolean)
      .slice(0, 3)
      .map(f => ({ title: f, description: "", icon: "circle" }));
  }

  const sizeMap: Record<string, string> = { "1:1": "1024x1024", "16:9": "1792x1024", "9:16": "1024x1792" };
  const dimMap:  Record<string, [number, number]> = { "1:1": [1024, 1024], "16:9": [1792, 1024], "9:16": [1024, 1792] };
  const [targetW, targetH] = dimMap[ar] || [1024, 1024];

  const layoutInstructions: Record<InfographicLayout, string> = {
    left_dark_panel: "Reserve the LEFT 30-35% of the image as a completely clean, empty, softly lit zone with no objects. Position the product clearly on the RIGHT side of the frame.",
    top_right_text:  "Reserve the TOP-RIGHT quadrant (roughly the upper 50% of the right half) as a clean, empty, softly lit zone. Position the product in the lower-left area.",
    bottom_cards:    "Reserve the BOTTOM 30% of the image as a clean, empty horizontal strip. Keep the product clearly in the upper portion of the frame.",
  };

  const sceneContext = infoScenario
    ? `Place the scene in: "${infoScenario}".`
    : style === "Elegante"
      ? "Choose a warm natural lifestyle context (kitchen counter, wooden table near a window, etc.) with 1-2 subtle complementary props."
      : "Choose a clean, well-lit lifestyle context with 1-2 props that hint at the product's use.";

  const prompt = `${descPrefix}Create a premium ecommerce product photo for infographic composition. ${ar} format.

PRODUCT FIDELITY (CRITICAL):
- Use the exact product from the attached image as your only reference.
- Preserve its exact shape, proportions, color, material, finish, labels and all visible details.
- Do not redesign, reinvent or alter the product in any way.
- The product must look photographically real, not like a 3D render.

SCENE:
${sceneContext}
Use a warm, minimal and elegant environment with soft natural light.
Keep the background clean and softly blurred.

NO TEXT RULE (NON-NEGOTIABLE):
- Do NOT add any text, titles, labels, bullet points or numbers anywhere in the image.
- Do NOT add icons, badges, banners, graphic overlays or callouts.
- Do NOT add watermarks, measurements or annotations.
- The image must be completely text-free. Any text present is a failure condition.

COMPOSITION:
- ${ar} aspect ratio.
- Product in sharp focus, occupying 45-60% of the frame.
- ${layoutInstructions[layout]}
- Photorealistic, premium ecommerce quality, realistic shadows.`;

  const response = await fetch("/api/generate-image-openai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, size: sizeMap[ar] || "1024x1024", image: base64Image, mimeType }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Infographic API error ${response.status}: ${err}`);
  }

  const data = await response.json() as { b64_json?: string };
  if (!data.b64_json) throw new Error("No image returned by infographic API.");

  const baseDataUrl = `data:image/png;base64,${data.b64_json}`;

  // If nothing to overlay, return base image as-is
  if (!title && !subtitle && features.length === 0) return baseDataUrl;

  const svg = buildInfographicSvg({
    title:    title || "TÍTULO DEL PRODUCTO",
    subtitle: subtitle || "",
    features,
    layout,
    style,
  });

  return compositeOverlay(baseDataUrl, svg, targetW, targetH);
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