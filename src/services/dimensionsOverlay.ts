// Dibuja cotas y leyenda de medidas sobre una foto de producto con fondo blanco.
// Los números salen del formulario, no del modelo, así que siempre coinciden.

export interface Dimensions {
  width?: string;
  height?: string;
  depth?: string;
}

const LINE_COLOR = "#555555";
const TEXT_COLOR = "#333333";
const BAR_COLOR = "#F5F5F5";
const FONT_FAMILY = 'Inter, "Helvetica Neue", Arial, sans-serif';

const hasValue = (v?: string) => !!v && v.trim() !== "" && Number(v.replace(",", ".")) !== 0;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// La IA no siempre da blanco puro: se lleva el fondo a #FFFFFF para que no se vea el recuadro
// de la foto achicada. El fondo es la mediana de las 4 esquinas (robusto a una esquina ocupada).
function whitenBackground(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  ctx.drawImage(img, 0, 0);
  const s = 8;
  const corners = [[0, 0], [c.width - s, 0], [0, c.height - s], [c.width - s, c.height - s]].map(([x, y]) => {
    const { data } = ctx.getImageData(x, y, s, s);
    const avg = [0, 0, 0];
    for (let k = 0; k < data.length; k += 4) { avg[0] += data[k]; avg[1] += data[k + 1]; avg[2] += data[k + 2]; }
    return avg.map(v => v / (s * s));
  });
  const bg = [0, 1, 2].map(ch => {
    const vals = corners.map(cr => cr[ch]).sort((x, y) => x - y);
    return Math.max(200, (vals[1] + vals[2]) / 2);
  });
  const imgData = ctx.getImageData(0, 0, c.width, c.height);
  const d = imgData.data;
  for (let k = 0; k < d.length; k += 4) {
    for (let ch = 0; ch < 3; ch++) d[k + ch] = Math.min(255, Math.round(d[k + ch] * 255 / bg[ch]));
    if (d[k] >= 247 && d[k + 1] >= 247 && d[k + 2] >= 247) d[k] = d[k + 1] = d[k + 2] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return c;
}

// Bounding box del producto: filas/columnas con suficientes píxeles no blancos
function findProductBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const { data } = ctx.getImageData(x, y, w, h);
  const cols = new Uint32Array(w);
  const rows = new Uint32Array(h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4;
      if (Math.min(data[k], data[k + 1], data[k + 2]) < 210) { cols[i]++; rows[j]++; }
    }
  }
  const minCol = Math.max(2, Math.round(h * 0.004));
  const minRow = Math.max(2, Math.round(w * 0.004));
  let left = cols.findIndex(c => c >= minCol);
  let top = rows.findIndex(r => r >= minRow);
  if (left < 0 || top < 0) return { left: x, top: y, right: x + w, bottom: y + h };
  let right = w - 1; while (right > left && cols[right] < minCol) right--;
  let bottom = h - 1; while (bottom > top && rows[bottom] < minRow) bottom--;
  return { left: x + left, top: y + top, right: x + right, bottom: y + bottom };
}

// Línea con flechas en ambos extremos y topes perpendiculares
function drawDimensionLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, unit: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = unit * 2.4;
  const cap = unit * 1.6;
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  for (const [px, py, dir] of [[x1, y1, angle], [x2, y2, angle + Math.PI]] as const) {
    ctx.moveTo(px + head * Math.cos(dir + 0.45), py + head * Math.sin(dir + 0.45));
    ctx.lineTo(px, py);
    ctx.lineTo(px + head * Math.cos(dir - 0.45), py + head * Math.sin(dir - 0.45));
    ctx.moveTo(px + cap * Math.cos(dir + Math.PI / 2), py + cap * Math.sin(dir + Math.PI / 2));
    ctx.lineTo(px - cap * Math.cos(dir + Math.PI / 2), py - cap * Math.sin(dir + Math.PI / 2));
  }
  ctx.stroke();
}

export async function drawDimensions(imageDataUrl: string, dims: Dimensions): Promise<string> {
  const img = await loadImage(imageDataUrl);
  const W = img.naturalWidth, H = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2d context");

  const base = Math.min(W, H);
  const unit = base / 200;
  const labelSize = Math.round(base * 0.034);
  const legendSize = Math.round(base * 0.03);
  const font = (size: number) => `500 ${size}px ${FONT_FAMILY}`;
  try { await document.fonts?.load(font(labelSize)); } catch { /* fuente del sistema */ }

  const showW = hasValue(dims.width), showH = hasValue(dims.height), showD = hasValue(dims.depth);
  const legendItems = [
    showW && `Ancho: ${dims.width!.trim()} cm`,
    showH && `Alto: ${dims.height!.trim()} cm`,
    showD && `Profundo: ${dims.depth!.trim()} cm`,
  ].filter(Boolean) as string[];

  // Reservar márgenes para cotas y leyenda; la foto (fondo blanco) se achica dentro
  const barH = legendItems.length ? Math.round(H * 0.085) : 0;
  const barMargin = Math.round(H * 0.035);
  const region = {
    x: Math.round(W * (showD ? 0.2 : 0.08)),
    y: Math.round(H * 0.05),
    w: 0, h: 0,
  };
  region.w = W - region.x - Math.round(W * (showH ? 0.19 : 0.08));
  region.h = H - region.y - (barH ? barH + barMargin * 2 : barMargin) - Math.round(H * (showW ? 0.1 : 0.03));

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);
  const scale = Math.min(region.w / W, region.h / H);
  const dw = Math.round(W * scale), dh = Math.round(H * scale);
  const dx = region.x + Math.round((region.w - dw) / 2);
  const dy = region.y + Math.round((region.h - dh) / 2);
  ctx.drawImage(whitenBackground(img), dx, dy, dw, dh);

  const box = findProductBox(ctx, dx, dy, dw, dh);
  const gap = Math.round(base * 0.035);

  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = Math.max(2, Math.round(unit * 0.8));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = font(labelSize);

  if (showW) {
    const y = box.bottom + gap;
    drawDimensionLine(ctx, box.left, y, box.right, y, unit);
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(`${dims.width!.trim()} cm`, (box.left + box.right) / 2, y + gap * 0.6);
  }

  if (showH) {
    const x = box.right + gap;
    drawDimensionLine(ctx, x, box.top, x, box.bottom, unit);
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(`${dims.height!.trim()} cm`, x + gap * 0.6, (box.top + box.bottom) / 2);
  }

  if (showD) {
    const label = `${dims.depth!.trim()} cm`;
    const ex = box.left - gap * 0.6, ey = box.bottom;
    // Largo limitado para que la etiqueta (a la izquierda del punto medio) entre en el lienzo
    const maxLen = (ex - gap * 0.5 - ctx.measureText(label).width - W * 0.02) / 0.35;
    const len = Math.max(gap * 2, Math.min(Math.min(box.right - box.left, box.bottom - box.top) * 0.32, maxLen));
    const sx = ex - len * 0.7, sy = ey - len * 0.7;
    drawDimensionLine(ctx, sx, sy, ex, ey, unit);
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillText(label, (sx + ex) / 2 - gap * 0.5, (sy + ey) / 2 + gap * 0.4);
  }

  if (legendItems.length) {
    ctx.font = font(legendSize);
    const sep = "   |   ";
    const text = legendItems.join(sep);
    const textW = ctx.measureText(text).width;
    const barW = Math.min(W - barMargin * 2, textW + legendSize * 3);
    const barX = (W - barW) / 2, barY = H - barMargin - barH;
    ctx.fillStyle = BAR_COLOR;
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, W / 2, barY + barH / 2);
  }

  return canvas.toDataURL("image/png");
}
