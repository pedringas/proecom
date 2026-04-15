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
  },
  apiKey?: string
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || "" });
  let prompt = "";
  
  switch (style) {
    case "Ecom":
      prompt = `Analiza la imagen adjunta y el nombre/descripción proporcionado: "${extraData?.productDescription || "Producto"}". 
      Transfórmala en una fotografía de producto de ecommerce de estándar profesional.
      Requisitos clave:
      1. Fidelidad: Mantén un 100% de fidelidad con la forma, colores, materiales y detalles del producto original que se ve en la foto adjunta. Usa la descripción "${extraData?.productDescription}" para asegurar que identificas correctamente el objeto.
      2. Entorno: El producto debe estar centrado sobre un fondo blanco puro (RGB 255,255,255) infinito.
      3. Iluminación: Usa iluminación de estudio fotográfico suave para crear volumen y sombras de contacto realistas en la base. Elimina reflejos feos o ruido.
      4. Formato: La imagen final debe ser cuadrada (aspect ratio 1:1).`;
      break;
      
    case "Lifestyle":
      prompt = `Usando como referencia exacta la imagen del producto adjunta, genera una fotografía de estilo de vida (lifestyle) mostrándolo en uso.
      Requisitos clave:
      1. Entorno: ${extraData?.lifestylePrompt ? `Sitúa la escena en este entorno específico: "${extraData.lifestylePrompt}".` : "Sitúa la escena en un ambiente moderno y realista. Iluminación natural cálida. El entorno debe variar en función del producto (ej: si es una pelota de fútbol, muestra a personas jugando al aire libre; si es un electrodoméstico, en una cocina moderna)."}
      2. Personas: Incluye personas interactando con el producto de forma natural y casual. La interacción debe verse genuina.
      3. Composición: Fotografía profesional con profundidad de campo. El producto es el héroe.
      4. Formato: La imagen final debe ser cuadrada (aspect ratio 1:1).`;
      break;
      
    case "Technical":
      prompt = `Tu misión es generar una ficha técnica de producto con FIDELIDAD ABSOLUTA. 
      
      REGLA DE ORO: El producto generado debe ser IDÉNTICO al de la imagen adjunta. No alteres su forma, color, marca, etiquetas ni detalles. Mantén exactamente el mismo ángulo y perspectiva de la foto original. No intentes "mejorar" o "reimaginar" el producto.
      
      INSTRUCCIONES DE COMPOSICIÓN:
      1. FONDO: Coloca el producto original sobre un fondo blanco puro (#FFFFFF) impecable.
      2. DIAGRAMA TÉCNICO: En la esquina inferior izquierda, incluye un pequeño y discreto diagrama técnico de un cubo en perspectiva (estilo icono). Este cubo debe tener líneas finas y etiquetas claras: "ANCHO" (eje horizontal), "ALTO" (eje vertical) y "PROFUNDO" (eje de profundidad).
      3. LEYENDA PRINCIPAL: En la parte inferior central, renderiza EXACTAMENTE este texto con ortografía perfecta (tipografía Inter):
         "MEDIDAS: ${extraData?.width || "0"} cm (Ancho) x ${extraData?.height || "0"} cm (Alto) x ${extraData?.depth || "0"} cm (Profundo)"
      
      CONTROL DE CALIDAD (ORTOGRAFÍA):
      - Revisa cada letra antes de renderizar. Está terminantemente prohibido escribir "MEDIDES", "Anich", "Ancih", "Profuno" o "Profund".
      - Las únicas palabras permitidas son: "MEDIDAS", "Ancho", "Alto", "Profundo", "cm".
      
      Estética: Limpia, profesional, estilo catálogo industrial minimalista. Formato 1:1.`;
      break;
      
    case "Infographic":
      prompt = `Utilizando la imagen del producto adjunta como centro, crea una infografía de marketing vibrante para e-commerce.
      Requisitos de Diseño:
      1. Estilo: Colores fuertes, saturados y llamativos que atraigan la vista (colores gancho), complementando al producto.
      2. Título: En la parte superior central, RENDERIZA EL TEXTO EXACTO USANDO LA TIPOGRAFÍA "INTER" (SANS-SERIF): "${extraData?.title || "Título del Producto"}".
      3. Características: Alrededor del producto, usa íconos modernos o viñetas dinámicas para destacar estos puntos clave (RENDERIZA CADA PALABRA EXACTAMENTE COMO SE PROPORCIONA USANDO LA TIPOGRAFÍA "INTER"): "${extraData?.features || "Características principales"}".
      4. Legibilidad: Asegura que todo el texto sea perfectamente legible y respete fielmente la ortografía del usuario.
      5. Formato: La imagen final debe ser cuadrada (aspect ratio 1:1).`;
      break;
      
    default:
      prompt = `Transforma esta imagen en una foto de producto profesional de alta calidad.`;
  }

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
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }

  throw new Error("No se pudo generar la imagen profesional.");
}

export async function analyzeProduct(images: { base64: string, mimeType: string }[], userDescription?: string, apiKey?: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || "" });
  const parts = images.map(img => ({
    inlineData: {
      data: img.base64,
      mimeType: img.mimeType
    }
  }));

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        ...parts,
        { text: `Analiza estas imágenes de un mismo producto desde diferentes ángulos. ${userDescription ? `El usuario describe el producto como: "${userDescription}".` : ""} Proporciona una descripción técnica extremadamente detallada y precisa del producto, incluyendo su forma, materiales, colores, texturas, logotipos, etiquetas y cualquier detalle distintivo. Esta descripción se usará para generar un video 360° del producto, así que sé muy minucioso para que la IA pueda reconstruirlo fielmente.` }
      ]
    }
  });

  return response.text || "Un producto comercial de alta calidad.";
}

export async function generateVideo360(
  apiKey: string,
  description: string,
  images: { base64: string, mimeType: string }[]
): Promise<string> {
  const aiInstance = new GoogleGenAI({ apiKey: apiKey || process.env.API_KEY || "" });
  // Use up to 3 reference images for better fidelity as per Veo 3.1 capabilities
  const referenceImagesPayload: VideoGenerationReferenceImage[] = images.slice(0, 3).map(img => ({
    image: {
      imageBytes: img.base64,
      mimeType: img.mimeType,
    },
    referenceType: VideoGenerationReferenceType.ASSET,
  }));

  // Prompt 2 (Cinemática para Veo)
  const videoPrompt = `Cinematic 360-degree product rotation video using the provided processed images as absolute visual references. 
  The product performs a slow, elegant, and smooth full rotation in a clockwise direction. 
  The camera angle is an orbital perspective with a slight high-angle tilt, looking slightly down at the product to showcase its top and sides. 
  The environment must remain a consistent, pure infinite white background (RGB 255,255,255) with soft studio lighting and realistic contact shadows at the base. 
  Maintain 100% visual fidelity to the product's shape, textures, and colors seen in the reference images. 
  The motion must be fluid and steady, completing one full revolution in exactly 6 seconds. 
  The final frame must perfectly match the first frame to create a seamless, infinite loop. 
  Vertical 9:16 aspect ratio (Reels format), high resolution, professional ecommerce commercial style. 
  Technical description context: ${description}`;

  let operation = await aiInstance.models.generateVideos({
    model: 'veo-3.1-generate-preview',
    prompt: videoPrompt,
    config: {
      numberOfVideos: 1,
      referenceImages: referenceImagesPayload,
      resolution: '720p',
      aspectRatio: '16:9' // Must be 16:9 for multiple reference images
    }
  });

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    operation = await aiInstance.operations.getVideosOperation({ operation: operation });
  }

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) {
    console.error("Video generation failed. Operation details:", JSON.stringify(operation, null, 2));
    throw new Error("No se pudo obtener el enlace de descarga del video.");
  }
  
  return downloadLink;
}
