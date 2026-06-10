import React, { useState, useRef, useCallback, useEffect, ChangeEvent, DragEvent } from "react";
import * as XLSX from "xlsx";
import { motion, AnimatePresence } from "motion/react";
import {
  Upload, Sparkles, Image as ImageIcon, Download, RefreshCw, Camera,
  Cloud, Trash2, History, X, Check, Eye, Maximize,
  ChevronLeft, ChevronRight, GripVertical,
  Box, Layers, Ruler, Settings
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { transformImage } from "@/src/services/gemini";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────
type Style = "Ecom" | "LifestyleNoHuman" | "Lifestyle" | "Technical" | "Infographic";
type ActiveTab = "crear" | "lote" | "historial";

interface HistoryItem {
  id: string;
  original: string;
  result: string;
  style: Style;
  timestamp: number;
  fileName: string;
  aspectRatio?: "1:1" | "16:9" | "9:16";
}

interface BatchItem {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "processing" | "completed" | "error";
  result?: string;
  width?: string;
  height?: string;
  depth?: string;
  infoTitle?: string;
  infoFeatures?: string;
  infoScenario?: string;
  lifestylePrompt?: string;
  productDescription?: string;
  aspectRatio?: "1:1" | "16:9" | "9:16";
  infoStyle?: "Pop" | "Elegante";
}

// ─── Style definitions ────────────────────────────────────────────────────────
const STYLES: { id: Style; label: string; short: string; icon: React.ElementType; desc: string }[] = [
  { id: "Ecom",             label: "Producto",   short: "Producto",   icon: Box,       desc: "Fondo blanco de estudio" },
  { id: "LifestyleNoHuman", label: "Portada ML", short: "Portada",    icon: ImageIcon, desc: "Lifestyle sin personas" },
  { id: "Lifestyle",        label: "Lifestyle",  short: "Lifestyle",  icon: Sparkles,  desc: "Ambiente con personas" },
  { id: "Technical",        label: "Medidas",    short: "Medidas",    icon: Ruler,     desc: "Dimensiones del producto" },
  { id: "Infographic",      label: "Infografía", short: "Infografía", icon: Layers,    desc: "Características visuales" },
];

// ─── Comparison Slider ───────────────────────────────────────────────────────
const ComparisonSlider = ({ before, after }: { before: string; after: string }) => {
  const [pos, setPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const calc = (clientX: number) => {
    if (!containerRef.current) return;
    const { left, width } = containerRef.current.getBoundingClientRect();
    setPos(Math.min(100, Math.max(0, ((clientX - left) / width) * 100)));
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full select-none"
      onMouseMove={e => dragging.current && calc(e.clientX)}
      onMouseUp={() => { dragging.current = false; }}
      onMouseLeave={() => { dragging.current = false; }}
      onTouchMove={e => calc(e.touches[0].clientX)}
      onTouchEnd={() => { dragging.current = false; }}
    >
      <img src={after} className="absolute inset-0 w-full h-full object-contain p-8" referrerPolicy="no-referrer" />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={before} className="w-full h-full object-contain p-8 opacity-90" />
      </div>
      <div className="absolute top-0 bottom-0 z-10 flex items-center justify-center"
        style={{ left: `${pos}%`, transform: "translateX(-50%)" }}>
        <div className="absolute inset-y-0 w-[2px] bg-white/80 shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
        <div
          className="relative z-20 w-9 h-9 rounded-full bg-white shadow-xl flex items-center justify-center cursor-col-resize"
          onMouseDown={e => { e.preventDefault(); dragging.current = true; }}
          onTouchStart={() => { dragging.current = true; }}
        >
          <ChevronLeft className="w-3 h-3 text-black absolute left-0.5" />
          <ChevronRight className="w-3 h-3 text-black absolute right-0.5" />
        </div>
      </div>
      <div className="absolute top-3 left-3 z-10 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-full pointer-events-none">
        <span className="text-[9px] text-white/60 uppercase font-black tracking-widest">Original</span>
      </div>
      <div className="absolute top-3 right-3 z-10 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-full pointer-events-none">
        <span className="text-[9px] text-green-400 uppercase font-black tracking-widest">IA Ready</span>
      </div>
    </div>
  );
};

// ─── Output format ────────────────────────────────────────────────────────────
type OutputFormat = "png" | "webp" | "jpeg";

const DEFAULT_FORMAT: Record<Style, OutputFormat> = {
  Ecom:             "png",
  LifestyleNoHuman: "webp",
  Lifestyle:        "webp",
  Technical:        "png",
  Infographic:      "png",
};

const convertToFormat = (base64DataUrl: string, format: OutputFormat, quality = 0.9): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("No 2d context")); return; }
      if (format === "jpeg") { ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL(`image/${format}`, format === "png" ? undefined : quality));
    };
    img.onerror = reject;
    img.src = base64DataUrl;
  });

// ─── Image compression ────────────────────────────────────────────────────────
const compressImage = (file: File, maxWidth = 1024): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        else if (h > maxWidth) { w = Math.round(w * maxWidth / h); h = maxWidth; }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("No 2d context");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      } catch (e) { reject(e); }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [image, setImage]                     = useState<string | null>(null);
  const [originalFileName, setOriginalFileName] = useState("");
  const [mimeType, setMimeType]               = useState("");
  const [isProcessing, setIsProcessing]       = useState(false);
  const [isSavingToDrive, setIsSavingToDrive] = useState(false);
  const [result, setResult]                   = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle]     = useState<Style>("Ecom");
  const [imageAspectRatio, setImageAspectRatio] = useState<"1:1" | "16:9" | "9:16">("1:1");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("png");
  const [showComparison, setShowComparison] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("crear");

  // Style-specific inputs
  const [width, setWidth]               = useState("");
  const [height, setHeight]             = useState("");
  const [depth, setDepth]               = useState("");
  const [infoTitle, setInfoTitle]       = useState("");
  const [infoFeatures, setInfoFeatures] = useState("");
  const [infoScenario, setInfoScenario] = useState("");
  const [infoStyle, setInfoStyle]       = useState<"Pop" | "Elegante">("Pop");
  const [lifestylePrompt, setLifestylePrompt]       = useState("");
  const [productDescription, setProductDescription] = useState("");

  // Batch
  const [batchItems, setBatchItems]       = useState<BatchItem[]>([]);
  const [isBatchMode, setIsBatchMode]     = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const batchStartTime                    = useRef<number | null>(null);
  const [batchTimeInfo, setBatchTimeInfo] = useState<{ elapsed: number; eta: number | null } | null>(null);
  const [csvParsedRows, setCsvParsedRows] = useState<Record<string, string>[]>([]);
  const [csvValidation, setCsvValidation] = useState<{ unmatchedImages: string[]; unmatchedSkus: string[] } | null>(null);

  const formatTime = (s: number) => {
    if (s < 60) return `${Math.round(s)}s`;
    return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  };

  // History
  const [history, setHistory]                       = useState<HistoryItem[]>(() => {
    try { return JSON.parse(localStorage.getItem("proecom_history") || "[]"); } catch { return []; }
  });
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);
  const [isPreviewOpen, setIsPreviewOpen]             = useState(false);

  const isEmbed = new URLSearchParams(window.location.search).get("embed") === "true";

  // Auth
  const [isGoogleAuth, setIsGoogleAuth] = useState(false);

  // Refs
  const fileInputRef        = useRef<HTMLInputElement>(null);
  const cameraInputRef      = useRef<HTMLInputElement>(null);
  const batchInputRef       = useRef<HTMLInputElement>(null);
  const batchCameraInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef         = useRef<HTMLInputElement>(null);
  const [batchDropActive, setBatchDropActive] = useState(false);

  // Drag & drop reorder
  const dragIndex              = useRef<number | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const reorderBatch = (from: number, to: number) => {
    if (from === to) return;
    setBatchItems(prev => {
      const arr = [...prev];
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return arr;
    });
  };

  // ── Persist history ────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const toSave = history.slice(0, 50).map(({ original, ...rest }) => rest);
      localStorage.setItem("proecom_history", JSON.stringify(toSave));
    } catch { /* storage full */ }
  }, [history]);

  // ── Auth check ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/auth/status").then(r => r.json()).then(d => setIsGoogleAuth(d.isAuthenticated)).catch(() => {});
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "OAUTH_AUTH_SUCCESS") { setIsGoogleAuth(true); toast.success("Conectado a Google Drive"); }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // ── Clear result + auto-format on style change ─────────────────────────────
  useEffect(() => {
    if (!isBatchMode) setResult(null);
    setOutputFormat(DEFAULT_FORMAT[selectedStyle]);
    setShowComparison(false);
  }, [selectedStyle, isBatchMode]);

  // ── Batch timer ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isProcessing) { setBatchTimeInfo(null); batchStartTime.current = null; return; }
    const id = setInterval(() => {
      if (!batchStartTime.current) return;
      const elapsed = (Date.now() - batchStartTime.current) / 1000;
      const done    = batchItems.filter(i => i.status === "completed" || i.status === "error").length;
      const pending = batchItems.filter(i => i.status === "pending" || i.status === "processing").length;
      const eta     = done > 0 ? (elapsed / done) * pending : null;
      setBatchTimeInfo({ elapsed, eta });
    }, 1000);
    return () => clearInterval(id);
  }, [isProcessing, batchItems]);

  // ── Keyboard nav for history modal ────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedHistoryItem) return;
      const idx = history.findIndex(i => i.id === selectedHistoryItem.id);
      if (e.key === "ArrowLeft")  setSelectedHistoryItem(history[(idx + 1) % history.length]);
      if (e.key === "ArrowRight") setSelectedHistoryItem(history[(idx - 1 + history.length) % history.length]);
      if (e.key === "Escape")     setSelectedHistoryItem(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedHistoryItem, history]);

  // ── Paste handler ─────────────────────────────────────────────────────────
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image")) { processFile(items[i].getAsFile()!); break; }
    }
  }, []);
  useEffect(() => {
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  // ── File processing ───────────────────────────────────────────────────────
  const processFile = async (file: File) => {
    if (file.type && !file.type.startsWith("image/")) { toast.error("Por favor, sube una imagen válida."); return; }
    setMimeType(file.type || "image/jpeg");
    setOriginalFileName(file.name || "image.jpg");
    try {
      const b64 = await compressImage(file);
      setImage(b64); setMimeType("image/jpeg"); setResult(null);
      if (fileInputRef.current)   fileInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    } catch {
      const reader = new FileReader();
      reader.onload = e => { setImage(e.target?.result as string); setMimeType(file.type || "image/jpeg"); setResult(null); };
      reader.readAsDataURL(file);
    }
  };

  // ── Batch file handler ────────────────────────────────────────────────────
  const applyCSVRows = (items: BatchItem[], rows: Record<string, string>[]) => {
    let matched = 0;
    const updated = items.map(item => {
      const sku = item.file.name.replace(/\.[^/.]+$/, "");
      const row = rows.find(r => r["sku"] === sku);
      if (!row) return item;
      const get = (col: string) => (row[col] || "").trim();
      matched++;
      return {
        ...item,
        infoTitle:          get("titulo")                               || item.infoTitle,
        infoFeatures:       get("caracteristicas").replace(/\|/g, "\n") || item.infoFeatures,
        infoStyle:          (get("estilo") as "Pop" | "Elegante")       || item.infoStyle,
        infoScenario:       get("escenario")                            || item.infoScenario,
        width:              get("ancho")                                || item.width,
        height:             get("alto")                                 || item.height,
        depth:              get("profundo")                             || item.depth,
        productDescription: get("descripcion_producto")                 || item.productDescription,
        lifestylePrompt:    get("entorno")                              || item.lifestylePrompt,
      };
    });
    const imageSkus   = items.map(i => i.file.name.replace(/\.[^/.]+$/, ""));
    const csvSkus     = rows.map(r => r["sku"]).filter(Boolean);
    const unmatchedImages = imageSkus.filter(s => !csvSkus.includes(s));
    const unmatchedSkus   = csvSkus.filter(s => !imageSkus.includes(s));
    return { updated, matched, unmatchedImages, unmatchedSkus };
  };

  const addBatchFiles = (files: File[]) => {
    const newItems: BatchItem[] = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9), file,
      preview: URL.createObjectURL(file), status: "pending" as const,
      width: "", height: "", depth: "", infoTitle: "", infoFeatures: "",
      lifestylePrompt: "", productDescription: ""
    }));
    toast.success(`${files.length} imagen${files.length > 1 ? "es" : ""} cargada${files.length > 1 ? "s" : ""}.`);
    setBatchItems(prev => {
      const merged = [...prev, ...newItems];
      if (csvParsedRows.length > 0) {
        const { updated, matched, unmatchedImages, unmatchedSkus } = applyCSVRows(merged, csvParsedRows);
        setCsvValidation({ unmatchedImages, unmatchedSkus });
        toast.success(`SKU match: ${matched} de ${csvParsedRows.length} filas coincidieron.`);
        return updated;
      }
      return merged;
    });
    setIsBatchMode(true);
  };

  const handleBatchFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    addBatchFiles(files);
    if (batchInputRef.current)       batchInputRef.current.value = "";
    if (batchCameraInputRef.current) batchCameraInputRef.current.value = "";
  };

  const handleBatchDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setBatchDropActive(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    if (!files.length) return;
    addBatchFiles(files);
  };

  // ── Template download ─────────────────────────────────────────────────────
  const getTemplateRows = (): { headers: string[]; example: string[] } => {
    if (selectedStyle === "Technical") return {
      headers: ["sku", "descripcion_producto", "ancho", "alto", "profundo"],
      example: ["producto-001", "Descripción del producto", "30", "20", "15"],
    };
    if (selectedStyle === "Infographic") return {
      headers: ["sku", "descripcion_producto", "titulo", "caracteristicas", "estilo", "escenario"],
      example: ["producto-001", "Descripción del producto", "Mi Producto Premium", "Duradero|Elegante|Económico", "Pop", ""],
    };
    return {
      headers: ["sku", "descripcion_producto", "entorno"],
      example: ["producto-001", "Descripción del producto", "Cocina moderna con luz natural"],
    };
  };

  const downloadCsvTemplate = () => {
    const { headers, example } = getTemplateRows();
    const csv = `${headers.join(",")}\n${example.join(",")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "plantilla_lote.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadXlsxTemplate = () => {
    const { headers, example } = getTemplateRows();
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
    XLSX.writeFile(wb, "plantilla_lote.xlsx");
  };

  // ── CSV / XLSX import ─────────────────────────────────────────────────────
  const processSpreadsheetRows = (rows: Record<string, string>[]) => {
    if (rows.length === 0) { toast.error("La planilla no tiene datos."); return; }
    setCsvParsedRows(rows);
    setBatchItems(prev => {
      const { updated, matched, unmatchedImages, unmatchedSkus } = applyCSVRows(prev, rows);
      setCsvValidation({ unmatchedImages, unmatchedSkus });
      const hasImages = prev.length > 0;
      toast.success(
        hasImages
          ? `Planilla cargada: ${matched} de ${rows.length} SKUs coincidieron.`
          : `Planilla cargada: ${rows.length} filas listas. Ahora cargá las imágenes.`
      );
      return updated;
    });
  };

  const handleCsvImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isXlsx = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
    const reader = new FileReader();
    if (isXlsx) {
      reader.onload = ev => {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
        if (raw.length < 2) { toast.error("La planilla no tiene datos."); return; }
        const headers = raw[0].map(h => String(h).trim().toLowerCase());
        const rows = raw.slice(1)
          .filter(r => r.some(c => c !== undefined && c !== ""))
          .map(r => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? "").trim()])));
        processSpreadsheetRows(rows);
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = ev => {
        const text = ev.target?.result as string;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { toast.error("La planilla no tiene datos."); return; }
        const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
        const rows = lines.slice(1).map(l => {
          const cols = l.split(",");
          return Object.fromEntries(headers.map((h, i) => [h, (cols[i] || "").trim()]));
        });
        processSpreadsheetRows(rows);
      };
      reader.readAsText(file);
    }
    if (csvInputRef.current) csvInputRef.current.value = "";
  };

  // ── Form validation ───────────────────────────────────────────────────────
  const isFormValid = () => {
    if (isBatchMode) {
      if (!batchItems.length) return false;
      return batchItems.every(item => {
        if (selectedStyle === "Technical")   return item.width?.trim() && item.height?.trim() && item.depth?.trim();
        if (selectedStyle === "Infographic") return item.infoTitle?.trim() && item.infoFeatures?.trim();
        return true;
      });
    }
    if (selectedStyle === "Technical")   return width.trim() !== "" && height.trim() !== "" && depth.trim() !== "";
    if (selectedStyle === "Infographic") return infoTitle.trim() !== "" && infoFeatures.trim() !== "";
    return true;
  };

  // ── Filename helper ───────────────────────────────────────────────────────
  const getFormattedFileName = (name: string, style: Style) => {
    const dot = name.lastIndexOf(".");
    const base = dot !== -1 ? name.substring(0, dot) : name;
    const ext  = dot !== -1 ? name.substring(dot) : ".png";
    const suffixes: Partial<Record<Style, string>> = {
      Lifestyle:        " lifestyle",
      LifestyleNoHuman: " portada",
      Technical:        " medidas",
      Infographic:      " infografia",
    };
    return `${base}${suffixes[style] || ""}${ext}`;
  };

  // ── Add to history ────────────────────────────────────────────────────────
  const addToHistory = (orig: string, res: string, style: Style, fileName: string) => {
    setHistory(prev => [{
      id: Math.random().toString(36).substr(2, 9),
      original: orig, result: res, style,
      timestamp: Date.now(), fileName,
      aspectRatio: imageAspectRatio
    }, ...prev]);
  };

  // ── Single transform ──────────────────────────────────────────────────────
  const handleTransform = async () => {
    if (!image) return;
    setIsProcessing(true);
    try {
      const raw = await transformImage(image.split(",")[1], mimeType, selectedStyle, "", {
        width, height, depth,
        title: infoTitle, features: infoFeatures, infoScenario,
        lifestylePrompt, productDescription, aspectRatio: imageAspectRatio,
        infoStyle
      });
      setResult(raw);
      addToHistory(image, raw, selectedStyle, originalFileName);
      toast.success("¡Transformación completada!");
    } catch {
      toast.error("Error al procesar la imagen.");
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Retry helper ──────────────────────────────────────────────────────────
  const withRetry = async <T,>(fn: () => Promise<T>, retries = 2, delay = 2500): Promise<T> => {
    try { return await fn(); }
    catch (e) {
      if (retries <= 0) throw e;
      await new Promise(r => setTimeout(r, delay));
      return withRetry(fn, retries - 1, delay);
    }
  };

  // ── Batch run ─────────────────────────────────────────────────────────────
  const runBatch = async () => {
    if (!batchItems.length || !isFormValid()) return;
    setIsProcessing(true);
    batchStartTime.current = Date.now();
    let done = 0;
    for (let i = 0; i < batchItems.length; i++) {
      if (batchItems[i].status === "completed") continue;
      setBatchItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: "processing" } : it));
      try {
        const item = batchItems[i];
        const b64  = (await compressImage(item.file)).split(",")[1];
        const raw  = await withRetry(() => transformImage(b64, "image/jpeg", selectedStyle, "", {
          width: item.width || width, height: item.height || height, depth: item.depth || depth,
          title: item.infoTitle || infoTitle, features: item.infoFeatures || infoFeatures,
          infoScenario: item.infoScenario || infoScenario,
          lifestylePrompt: item.lifestylePrompt || lifestylePrompt,
          productDescription: item.productDescription || productDescription,
          aspectRatio: item.aspectRatio || imageAspectRatio,
          infoStyle: item.infoStyle || infoStyle
        }));
        setBatchItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: "completed", result: raw } : it));
        addToHistory(`data:image/jpeg;base64,${b64}`, raw, selectedStyle, item.file.name);
        if (isGoogleAuth) await handleSaveToDrive(raw, item.file.name);
      } catch {
        setBatchItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: "error" } : it));
      }
      done++;
      setBatchProgress(done / batchItems.length * 100);
    }
    setIsProcessing(false);
    toast.success("Procesamiento por lotes finalizado");
  };

  // ── Drive ─────────────────────────────────────────────────────────────────
  const handleConnectDrive = async () => {
    const popup = window.open("", "oauth_popup", "width=600,height=700");
    if (!popup) { toast.error("El navegador bloqueó el popup. Permite los popups para este sitio."); return; }
    try {
      const { url } = await fetch("/api/auth/google/url").then(r => r.json());
      if (!url) { popup.close(); toast.error("No se pudo generar la URL de autenticación."); return; }
      popup.location.href = url;
    } catch { popup.close(); toast.error("Error al conectar con Google."); }
  };

  const handleSaveToDrive = async (imgUrl: string, customFileName?: string) => {
    if (!imgUrl) return;
    if (!isGoogleAuth) { handleConnectDrive(); return; }
    setIsSavingToDrive(true);
    try {
      const name = (customFileName || originalFileName || `pro-ecom-${Date.now()}.png`).replace(/([^.]+)$/, (m) => m.includes(".") ? m : `${m}.png`);
      const { success, error } = await fetch("/api/drive/upload", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Image: imgUrl, fileName: name })
      }).then(r => r.json());
      if (success) toast.success(`Guardado en Drive: ${name}`);
      else throw new Error(error);
    } catch { toast.error("Error al guardar en Drive"); setIsGoogleAuth(false); }
    finally { setIsSavingToDrive(false); }
  };

  // ── Download helpers ──────────────────────────────────────────────────────
  const downloadUrl = (url: string, name: string) => {
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  };
  const downloadResult = () => result && downloadUrl(result, getFormattedFileName(originalFileName || `pro-ecom-${Date.now()}`, selectedStyle));
  const downloadBatchItem = (item: BatchItem) => item.result && downloadUrl(item.result, getFormattedFileName(item.file.name, selectedStyle));
  const downloadAllBatch = () => {
    const done = batchItems.filter(i => i.status === "completed" && i.result);
    if (!done.length) { toast.error("No hay imágenes completadas para descargar"); return; }
    done.forEach((item, i) => setTimeout(() => downloadBatchItem(item), i * 200));
    toast.success(`Descargando ${done.length} imágenes`);
  };

  const onDrop = useCallback((e: DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) processFile(f); }, []);

  // ── Batch item inputs ─────────────────────────────────────────────────────
  const renderBatchItemInputs = (item: BatchItem) => {
    const upd = (patch: Partial<BatchItem>) => setBatchItems(prev => prev.map(i => i.id === item.id ? { ...i, ...patch } : i));
    const inputStyle = { height: 36, padding: "0 10px", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, fontSize: 12, color: "rgba(255,255,255,0.92)", width: "100%" };
    const descField = (
      <input style={inputStyle} placeholder="Descripción del Producto (Opcional)"
        value={item.productDescription || ""} onChange={e => upd({ productDescription: e.target.value })} />
    );
    if (selectedStyle === "Ecom") return <div>{descField}</div>;
    if (selectedStyle === "LifestyleNoHuman" || selectedStyle === "Lifestyle") return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {descField}
        <input style={inputStyle} placeholder={selectedStyle === "LifestyleNoHuman" ? "Entorno para portada ML (Opcional)" : "Entorno específico (Opcional)"}
          value={item.lifestylePrompt || ""} onChange={e => upd({ lifestylePrompt: e.target.value })} />
      </div>
    );
    if (selectedStyle === "Technical") return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {descField}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {(["width", "height", "depth"] as const).map((k, i) => (
            <input key={k} style={{ ...inputStyle, borderColor: !item[k]?.trim() ? "rgba(248,113,113,0.4)" : "rgba(255,255,255,0.06)" }}
              placeholder={["Ancho (cm)", "Alto (cm)", "Prof. (cm)"][i]}
              value={item[k] || ""} onChange={e => upd({ [k]: e.target.value })} />
          ))}
        </div>
      </div>
    );
    if (selectedStyle === "Infographic") {
      const itemStyle = item.infoStyle || "Pop";
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {descField}
          <div style={{ display: "flex", gap: 6 }}>
            {(["Pop", "Elegante"] as const).map(s => (
              <button key={s} onClick={() => upd({ infoStyle: s })}
                style={{ flex: 1, height: 30, borderRadius: 8, border: `1px solid ${itemStyle === s ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.06)"}`, background: itemStyle === s ? "rgba(255,255,255,0.1)" : "transparent", color: itemStyle === s ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                {s === "Pop" ? "Pop 🎨" : "Elegante ✨"}
              </button>
            ))}
          </div>
          <input style={{ ...inputStyle, borderColor: !item.infoTitle?.trim() ? "rgba(248,113,113,0.4)" : "rgba(255,255,255,0.06)" }}
            placeholder="Título" value={item.infoTitle || ""} onChange={e => upd({ infoTitle: e.target.value })} />
          <textarea style={{ ...inputStyle, height: 60, padding: "8px 10px", resize: "none", borderColor: !item.infoFeatures?.trim() ? "rgba(248,113,113,0.4)" : "rgba(255,255,255,0.06)" }}
            placeholder={"Característica 1\nCaracterística 2"} value={item.infoFeatures || ""}
            onChange={e => upd({ infoFeatures: e.target.value })} />
          {itemStyle === "Elegante" && (
            <input style={inputStyle} placeholder="Escenario (Opcional)" value={item.infoScenario || ""}
              onChange={e => upd({ infoScenario: e.target.value })} />
          )}
        </div>
      );
    }
    return null;
  };

  // ── Single mode right panel inputs ────────────────────────────────────────
  const renderSingleInputs = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 1.4, color: "#C4B5FD", marginBottom: 8 }}>Descripción del Producto</div>
        <Input placeholder="Ej: Zapatillas deportivas rojas Nike" value={productDescription} onChange={e => setProductDescription(e.target.value)}
          className="h-9 text-xs bg-black/40 border-white/[0.06]" />
        <p style={{ fontSize: 9.5, color: "rgba(255,255,255,0.3)", marginTop: 4, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>Opcional — Ayuda a la IA a identificar el producto</p>
      </div>
      <AnimatePresence mode="wait">
        {(selectedStyle === "Lifestyle" || selectedStyle === "LifestyleNoHuman") && (
          <motion.div key="lifestyle" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 1.4, color: "#C4B5FD", marginBottom: 8 }}>
              {selectedStyle === "LifestyleNoHuman" ? "Entorno para Portada" : "Entorno Preferido"}
            </div>
            <Input placeholder={selectedStyle === "LifestyleNoHuman" ? "Ej: Cocina moderna, escritorio minimalista..." : "Ej: En un parque, en una cocina..."}
              value={lifestylePrompt} onChange={e => setLifestylePrompt(e.target.value)} className="h-9 text-xs bg-black/40 border-white/[0.06]" />
          </motion.div>
        )}
        {selectedStyle === "Technical" && (
          <motion.div key="technical" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 1.4, color: "#C4B5FD", marginBottom: 8 }}>
              Dimensiones <span style={{ color: "#F87171" }}>*</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[["Ancho (cm)", width, setWidth], ["Alto (cm)", height, setHeight], ["Prof. (cm)", depth, setDepth]].map(([label, val, setter]) => (
                <div key={label as string}>
                  <div style={{ fontSize: 9.5, color: "rgba(255,255,255,0.32)", marginBottom: 4, textTransform: "uppercase" as const, letterSpacing: 0.8 }}>{(label as string).split(" ")[0]}</div>
                  <Input placeholder={label as string} value={val as string} onChange={e => (setter as (v: string) => void)(e.target.value)}
                    className={cn("h-9 text-xs bg-black/40", !(val as string).trim() ? "border-red-500/40" : "border-white/[0.06]")} />
                </div>
              ))}
            </div>
          </motion.div>
        )}
        {selectedStyle === "Infographic" && (
          <motion.div key="infographic" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 1.4, color: "#C4B5FD", marginBottom: 8 }}>Estilo Visual</div>
              <div style={{ display: "flex", gap: 6 }}>
                {(["Pop", "Elegante"] as const).map(s => (
                  <button key={s} onClick={() => setInfoStyle(s)}
                    style={{ flex: 1, height: 34, borderRadius: 8, border: `1px solid ${infoStyle === s ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.06)"}`, background: infoStyle === s ? "rgba(255,255,255,0.08)" : "transparent", color: infoStyle === s ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    {s === "Pop" ? "Pop 🎨" : "Elegante ✨"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 1.4, color: "#C4B5FD", marginBottom: 8 }}>Título <span style={{ color: "#F87171" }}>*</span></div>
              <Input placeholder="Ej: El mejor del mercado" value={infoTitle} onChange={e => setInfoTitle(e.target.value)}
                className={cn("h-9 text-xs bg-black/40", !infoTitle.trim() ? "border-red-500/40" : "border-white/[0.06]")} />
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 1.4, color: "#C4B5FD", marginBottom: 8 }}>Características <span style={{ color: "#F87171" }}>*</span></div>
              <Textarea placeholder={"Duradero\nElegante\nEconómico"} value={infoFeatures} onChange={e => setInfoFeatures(e.target.value)}
                className={cn("text-xs h-20 bg-black/40", !infoFeatures.trim() ? "border-red-500/40" : "border-white/[0.06]")} />
              <p style={{ fontSize: 9.5, color: "rgba(255,255,255,0.3)", marginTop: 4, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>Una característica por línea</p>
            </div>
            {infoStyle === "Elegante" && (
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 1.4, color: "#C4B5FD", marginBottom: 8 }}>Escenario</div>
                <Input placeholder="Ej: Mesa de madera con taza humeante" value={infoScenario} onChange={e => setInfoScenario(e.target.value)}
                  className="h-9 text-xs bg-black/40 border-white/[0.06]" />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col" style={{ background: "#050505", color: "rgba(255,255,255,0.92)", fontFamily: "Inter, system-ui, sans-serif" }}>
        <Toaster position="top-center" />

        {/* Hidden file inputs */}
        <input type="file" ref={fileInputRef}        onChange={e => e.target.files?.[0] && processFile(e.target.files[0])} className="hidden" accept="image/*" />
        <input type="file" ref={cameraInputRef}      onChange={e => e.target.files?.[0] && processFile(e.target.files[0])} className="hidden" accept="image/*" capture="environment" />
        <input type="file" ref={batchInputRef}       onChange={handleBatchFiles} className="hidden" accept="image/*" multiple />
        <input type="file" ref={batchCameraInputRef} onChange={handleBatchFiles} className="hidden" accept="image/*" capture="environment" />
        <input type="file" ref={csvInputRef}         onChange={handleCsvImport}  className="hidden" accept=".csv,.xlsx,.xls,text/csv" />

        {/* ── Header ───────────────────────────────────────────────────────── */}
        {!isEmbed && (
          <header
            className="shrink-0 flex items-center justify-between px-[18px]"
            style={{ height: 56, borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(11,11,13,0.85)", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 50 }}
          >
            <div className="flex items-center gap-[18px]">
              {/* LogoMark + Wordmark */}
              <div className="flex items-center gap-[10px]">
                <div style={{ width: 24, height: 24, borderRadius: 6, background: "linear-gradient(135deg,#C4B5FD,#8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 16px rgba(196,181,253,0.25),inset 0 0 0 1px rgba(255,255,255,0.2)", flexShrink: 0 }}>
                  <div style={{ width: 10, height: 10, background: "#050505", borderRadius: 3, transform: "rotate(45deg)" }} />
                </div>
                <span style={{ fontFamily: '"Playfair Display",serif', fontWeight: 700, fontSize: 18, letterSpacing: -0.5, whiteSpace: "nowrap" }}>
                  ProEcom <span style={{ color: "#D4AF37", fontStyle: "italic" }}>AI</span>
                </span>
              </div>
              <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.06)", flexShrink: 0 }} />
              {/* Nav tabs */}
              <nav className="flex gap-1">
                {(["Crear", "Por lote", "Historial"] as const).map(label => {
                  const tab: ActiveTab = label === "Crear" ? "crear" : label === "Por lote" ? "lote" : "historial";
                  const isActive = activeTab === tab;
                  return (
                    <button key={label}
                      onClick={() => { setActiveTab(tab); if (tab === "lote") setIsBatchMode(true); else if (tab === "crear") setIsBatchMode(false); }}
                      style={{ padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", background: isActive ? "rgba(255,255,255,0.07)" : "transparent", color: isActive ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)", transition: "background 0.15s,color 0.15s" }}>
                      {label}
                      {label === "Historial" && history.length > 0 && (
                        <span style={{ marginLeft: 6, fontSize: 11, color: "rgba(255,255,255,0.32)" }}>{history.length}</span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
            {/* Right chips */}
            <div className="flex items-center gap-[10px]">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(212,175,55,0.08)", color: "#D4AF37", border: "1px solid rgba(212,175,55,0.25)", fontSize: 11, padding: "3px 9px", borderRadius: 999, fontWeight: 500 }}>
                <Sparkles size={11} strokeWidth={1.75} /> Gemini 2.5
              </span>
              {isGoogleAuth ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(74,222,128,0.08)", color: "#4ADE80", border: "1px solid rgba(74,222,128,0.25)", fontSize: 11, padding: "3px 9px", borderRadius: 999, fontWeight: 500 }}>
                  <Cloud size={11} strokeWidth={1.75} /> Drive
                </span>
              ) : (
                <button onClick={handleConnectDrive} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 11, padding: "3px 9px", borderRadius: 999, fontWeight: 500, cursor: "pointer" }}>
                  <Cloud size={11} strokeWidth={1.75} /> Conectar Drive
                </button>
              )}
              <div style={{ width: 32, height: 32, borderRadius: 999, background: "linear-gradient(135deg,#C4B5FD,#8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#0A0A0E" }}>P</div>
            </div>
          </header>
        )}

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0" style={{ height: isEmbed ? "100vh" : "calc(100vh - 56px)" }}>

          {/* Style Rail — only in crear/lote tabs */}
          {activeTab !== "historial" && (
            <nav style={{ width: 76, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.06)", background: "rgba(11,11,13,0.4)", padding: "16px 10px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              {STYLES.map(s => {
                const active = selectedStyle === s.id;
                const SIcon = s.icon;
                return (
                  <button key={s.id} onClick={() => setSelectedStyle(s.id)}
                    style={{ width: 56, padding: "10px 0", borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, background: active ? "rgba(255,255,255,0.07)" : "transparent", color: active ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)", border: "none", cursor: "pointer", position: "relative", transition: "background 0.15s,color 0.15s" }}>
                    {active && <div style={{ position: "absolute", left: -10, top: 12, bottom: 12, width: 2.5, borderRadius: 2, background: "#C4B5FD" }} />}
                    <SIcon size={18} strokeWidth={1.75} />
                    <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 0.2 }}>{s.short}</span>
                  </button>
                );
              })}
              <div style={{ flex: 1 }} />
              <button style={{ width: 40, height: 40, borderRadius: 12, border: "none", background: "transparent", color: "rgba(255,255,255,0.55)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Settings size={18} strokeWidth={1.75} />
              </button>
            </nav>
          )}

          {/* ── CREAR TAB ─────────────────────────────────────────────────── */}
          {activeTab === "crear" && (
            <>
              {/* Center stage */}
              <main style={{ flex: 1, display: "flex", flexDirection: "column", padding: 20, gap: 12, minWidth: 0, overflow: "hidden" }}>
                {/* Stage header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#C4B5FD", fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase" }}>
                      Estilo · {STYLES.find(s => s.id === selectedStyle)?.label}
                    </div>
                    <div style={{ fontFamily: '"Playfair Display",serif', fontSize: 22, fontWeight: 700, marginTop: 2 }}>
                      {STYLES.find(s => s.id === selectedStyle)?.desc}
                    </div>
                  </div>
                  {result && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => setShowComparison(v => !v)}
                        style={{ height: 38, padding: "0 14px", borderRadius: 12, border: `1px solid ${showComparison ? "rgba(196,181,253,0.4)" : "rgba(255,255,255,0.08)"}`, background: showComparison ? "rgba(196,181,253,0.1)" : "transparent", color: showComparison ? "#C4B5FD" : "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <Eye size={15} strokeWidth={1.75} /> Comparar
                      </button>
                      <button onClick={() => setIsPreviewOpen(true)}
                        style={{ height: 38, padding: "0 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <Maximize size={15} strokeWidth={1.75} /> Expandir
                      </button>
                    </div>
                  )}
                </div>

                {/* Stage canvas */}
                <div
                  style={{ flex: 1, borderRadius: 20, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)", position: "relative", background: "#0B0B0D", minHeight: 0 }}
                  onDragOver={e => e.preventDefault()} onDrop={onDrop}
                >
                  <AnimatePresence mode="wait">
                    {isProcessing ? (
                      <motion.div key="loading" className="absolute inset-0 flex flex-col items-center justify-center"
                        style={{ background: "linear-gradient(135deg,#0e0e12,#161620)" }}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <div style={{ position: "relative", marginBottom: 28 }}>
                          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                            style={{ width: 84, height: 84, borderRadius: 999, border: "2px solid rgba(255,255,255,0.06)", borderTopColor: "#C4B5FD" }} />
                          <Sparkles className="absolute inset-0 m-auto" size={30} style={{ color: "#C4B5FD" }} />
                        </div>
                        <div style={{ fontFamily: '"Playfair Display",serif', fontSize: 26, fontWeight: 700, color: "#C4B5FD", textAlign: "center" }}>Generando perfección…</div>
                        <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 13.5, marginTop: 10 }}>Analizando el producto y limpiando el fondo.</p>
                        <div style={{ marginTop: 36, display: "flex", gap: 8, alignItems: "center", padding: "10px 18px", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 999 }}>
                          {[{ l: "Analizar", done: true }, { l: "Limpiar", done: true }, { l: "Render", done: false, active: true }, { l: "Refinar", done: false }].map((s, i) => (
                            <React.Fragment key={s.l}>
                              {i > 0 && <div style={{ width: 16, height: 1, background: "rgba(255,255,255,0.06)" }} />}
                              <div style={{ display: "flex", alignItems: "center", gap: 6, color: s.done || s.active ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.32)" }}>
                                <div style={{ width: 16, height: 16, borderRadius: 999, background: s.done ? "#4ADE80" : s.active ? "rgba(196,181,253,0.2)" : "transparent", border: `1px solid ${s.done ? "#4ADE80" : s.active ? "#C4B5FD" : "rgba(255,255,255,0.12)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  {s.done && <Check size={10} style={{ color: "#062E15" }} />}
                                </div>
                                <span style={{ fontSize: 11.5, fontWeight: 600 }}>{s.l}</span>
                              </div>
                            </React.Fragment>
                          ))}
                        </div>
                      </motion.div>
                    ) : !image ? (
                      <motion.div key="empty" className="absolute inset-0 flex flex-col items-center justify-center gap-7"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <div style={{ position: "absolute", inset: 0, border: "1.5px dashed rgba(196,181,253,0.18)", borderRadius: 20, pointerEvents: "none" }} />
                        <div style={{ width: 96, height: 96, borderRadius: 24, background: "radial-gradient(circle at 30% 30%,rgba(196,181,253,0.2),rgba(196,181,253,0.04))", border: "1px solid rgba(196,181,253,0.18)", display: "flex", alignItems: "center", justifyContent: "center", color: "#C4B5FD" }}>
                          <Upload size={36} strokeWidth={1.75} />
                        </div>
                        <div style={{ textAlign: "center", maxWidth: 360 }}>
                          <h2 style={{ fontFamily: '"Playfair Display",serif', fontSize: 30, fontWeight: 700, margin: 0, lineHeight: 1.15 }}>Subí una foto de tu producto</h2>
                          <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, margin: "12px 0 0", lineHeight: 1.5 }}>
                            Arrastrá una imagen acá, pegala con <kbd style={{ fontFamily: "ui-monospace,monospace", padding: "1px 6px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, fontSize: 11, background: "rgba(255,255,255,0.05)" }}>⌘V</kbd>, o usá los botones.
                          </p>
                        </div>
                        <div style={{ display: "flex", gap: 12 }}>
                          <button onClick={() => fileInputRef.current?.click()}
                            style={{ height: 46, padding: "0 18px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.92)", fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <ImageIcon size={17} strokeWidth={1.75} /> Desde galería
                          </button>
                          <button onClick={() => cameraInputRef.current?.click()}
                            style={{ height: 46, padding: "0 18px", borderRadius: 12, border: "none", background: "#C4B5FD", color: "#0A0A0E", fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, boxShadow: "0 10px 28px -10px rgba(196,181,253,0.6),inset 0 1px 0 rgba(255,255,255,0.3)" }}>
                            <Camera size={17} strokeWidth={1.75} /> Tomar foto
                          </button>
                        </div>
                        <div style={{ position: "absolute", bottom: 20, left: 20, right: 20, display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(255,255,255,0.32)" }}>
                          <span>JPG · PNG · WebP · hasta 10 MB</span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <span style={{ width: 6, height: 6, borderRadius: 999, background: "#4ADE80", display: "inline-block" }} /> IA lista
                          </span>
                        </div>
                      </motion.div>
                    ) : result ? (
                      <motion.div key="result" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        {showComparison && image
                          ? <ComparisonSlider before={image} after={result} />
                          : <img src={result} className="w-full h-full object-contain p-8" referrerPolicy="no-referrer" />
                        }
                        <div style={{ position: "absolute", top: 14, right: 14 }}>
                          <span style={{ padding: "4px 10px", borderRadius: 999, background: "rgba(74,222,128,0.95)", color: "#0a3a1c", fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>IA · LISTO</span>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div key="preview" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <img src={image} className="w-full h-full object-contain p-8 opacity-60 grayscale" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", padding: "6px 14px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.08)" }}>
                            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>Vista previa original</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Stage footer */}
                {result && !isProcessing && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5, color: "rgba(255,255,255,0.32)", flexShrink: 0 }}>
                    <span>{originalFileName || "imagen.jpg"}</span>
                    <button onClick={() => { setResult(null); setShowComparison(false); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.32)", fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <RefreshCw size={12} strokeWidth={1.75} /> reiniciar
                    </button>
                  </div>
                )}
              </main>

              {/* Right panel */}
              <aside style={{ width: 340, flexShrink: 0, borderLeft: "1px solid rgba(255,255,255,0.06)", background: "rgba(11,11,13,0.5)", display: "flex", flexDirection: "column" }}>
                <div style={{ flex: 1, padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }} className="custom-scrollbar">

                  {/* Tu foto */}
                  {image && (
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.4, color: "#C4B5FD", marginBottom: 10 }}>Tu foto</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 10, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12 }}>
                        <div style={{ width: 52, height: 52, borderRadius: 10, overflow: "hidden", flexShrink: 0, border: "1px solid rgba(255,255,255,0.08)" }}>
                          <img src={image} className="w-full h-full object-cover" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{originalFileName || "imagen.jpg"}</div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.32)", marginTop: 2 }}>Foto cargada</div>
                        </div>
                        <button onClick={() => fileInputRef.current?.click()}
                          style={{ width: 30, height: 30, borderRadius: 8, background: "transparent", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.55)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                          <RefreshCw size={13} strokeWidth={1.75} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Style-specific inputs */}
                  {renderSingleInputs()}

                  {/* Salida */}
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.4, color: "#C4B5FD", marginBottom: 10 }}>Salida</div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                      {(["1:1", "9:16", "16:9"] as const).map((r, i) => {
                        const dims = [{ w: 14, h: 14 }, { w: 10, h: 16 }, { w: 16, h: 10 }][i];
                        return (
                          <button key={r} onClick={() => setImageAspectRatio(r)}
                            style={{ flex: 1, height: 50, borderRadius: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, background: imageAspectRatio === r ? "rgba(196,181,253,0.08)" : "transparent", border: `1px solid ${imageAspectRatio === r ? "rgba(196,181,253,0.18)" : "rgba(255,255,255,0.06)"}`, cursor: "pointer" }}>
                            <div style={{ width: dims.w, height: dims.h, border: `1.5px solid ${imageAspectRatio === r ? "#C4B5FD" : "rgba(255,255,255,0.32)"}`, borderRadius: 2 }} />
                            <span style={{ fontSize: 10.5, color: imageAspectRatio === r ? "#C4B5FD" : "rgba(255,255,255,0.32)", fontWeight: 600 }}>{r}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {([{ f: "png", l: "PNG", h: "Nítido" }, { f: "webp", l: "WebP", h: "Óptimo" }, { f: "jpeg", l: "JPEG", h: "Compat." }] as { f: OutputFormat, l: string, h: string }[]).map(o => (
                        <button key={o.f} onClick={() => setOutputFormat(o.f)}
                          style={{ flex: 1, padding: "7px 0", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", background: outputFormat === o.f ? "rgba(255,255,255,0.06)" : "transparent", border: `1px solid ${outputFormat === o.f ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"}`, cursor: "pointer" }}>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: outputFormat === o.f ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)" }}>{o.l}</span>
                          <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.32)", marginTop: 1 }}>{o.h}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Fixed footer */}
                <div style={{ padding: 16, borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(5,5,5,0.7)", display: "flex", flexDirection: "column", gap: 8 }}>
                  {result && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={downloadResult}
                        style={{ flex: 1, height: 46, borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.92)", fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                        <Download size={15} strokeWidth={1.75} /> Descargar
                      </button>
                      <button onClick={() => handleSaveToDrive(result)} disabled={isSavingToDrive}
                        style={{ height: 46, padding: "0 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                        {isSavingToDrive ? <RefreshCw size={15} className="animate-spin" /> : <Cloud size={15} strokeWidth={1.75} />} Drive
                      </button>
                    </div>
                  )}
                  <button onClick={handleTransform} disabled={!image || isProcessing || !isFormValid()}
                    style={{ width: "100%", height: 54, borderRadius: 12, border: "none", background: "#C4B5FD", color: "#0A0A0E", fontSize: 14.5, fontWeight: 700, cursor: (!image || !isFormValid()) ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 10px 28px -10px rgba(196,181,253,0.6),inset 0 1px 0 rgba(255,255,255,0.3)", opacity: (!image || isProcessing || !isFormValid()) ? 0.4 : 1, transition: "opacity 0.15s" }}>
                    {isProcessing ? <RefreshCw size={17} className="animate-spin" /> : <Sparkles size={17} strokeWidth={1.75} />}
                    {isProcessing ? "Generando…" : result ? "Regenerar imagen" : "Crear imagen"}
                  </button>
                  {!image && <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.32)", textAlign: "center" }}>Subí una foto para activar</div>}
                </div>
              </aside>
            </>
          )}

          {/* ── LOTE TAB ──────────────────────────────────────────────────── */}
          {activeTab === "lote" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 24, gap: 16, overflowY: "auto" }} className="custom-scrollbar">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 11, color: "#C4B5FD", fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase" }}>Por lote</div>
                  <div style={{ fontFamily: '"Playfair Display",serif', fontSize: 22, fontWeight: 700, marginTop: 2 }}>Procesamiento masivo</div>
                </div>
                {batchItems.length > 0 && (
                  <button onClick={() => { setBatchItems([]); setCsvParsedRows([]); setCsvValidation(null); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "none", background: "transparent", color: "rgba(248,113,113,0.6)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    <Trash2 size={13} strokeWidth={1.75} /> Reiniciar Lote
                  </button>
                )}
              </div>

              {/* Style selector */}
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.4, color: "#C4B5FD", marginBottom: 10 }}>Tipo de imagen</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {STYLES.map(s => {
                    const SIcon = s.icon;
                    return (
                      <button key={s.id} onClick={() => setSelectedStyle(s.id)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 10, border: `1px solid ${selectedStyle === s.id ? "rgba(196,181,253,0.4)" : "rgba(255,255,255,0.06)"}`, background: selectedStyle === s.id ? "rgba(196,181,253,0.1)" : "transparent", color: selectedStyle === s.id ? "#C4B5FD" : "rgba(255,255,255,0.55)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                        <SIcon size={14} strokeWidth={1.75} /> {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Drop zone */}
              <div
                style={{ border: `2px dashed ${batchDropActive ? "#C4B5FD" : "rgba(196,181,253,0.3)"}`, borderRadius: 16, padding: 24, textAlign: "center", background: batchDropActive ? "rgba(196,181,253,0.08)" : "rgba(196,181,253,0.03)", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, transition: "all 0.15s" }}
                onDragOver={e => { e.preventDefault(); setBatchDropActive(true); }}
                onDragLeave={() => setBatchDropActive(false)}
                onDrop={handleBatchDrop}
              >
                <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.92)", margin: 0, textTransform: "uppercase", letterSpacing: 1 }}>
                  {batchDropActive ? "Soltar imágenes aquí" : "Añadir Imágenes"}
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                  <button onClick={() => batchInputRef.current?.click()}
                    style={{ height: 38, padding: "0 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.92)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <ImageIcon size={14} strokeWidth={1.75} /> Galería
                  </button>
                  <button onClick={() => batchCameraInputRef.current?.click()}
                    style={{ height: 38, padding: "0 14px", borderRadius: 10, border: "none", background: "#C4B5FD", color: "#0A0A0E", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <Camera size={14} strokeWidth={1.75} /> Cámara
                  </button>
                  <button onClick={downloadCsvTemplate}
                    style={{ height: 38, padding: "0 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Download size={13} strokeWidth={1.75} /> CSV
                  </button>
                  <button onClick={downloadXlsxTemplate}
                    style={{ height: 38, padding: "0 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Download size={13} strokeWidth={1.75} /> XLSX
                  </button>
                  <button onClick={() => csvInputRef.current?.click()}
                    style={{ height: 38, padding: "0 12px", borderRadius: 10, border: `1px solid ${csvParsedRows.length > 0 ? "rgba(196,181,253,0.4)" : "rgba(255,255,255,0.08)"}`, background: csvParsedRows.length > 0 ? "rgba(196,181,253,0.08)" : "transparent", color: csvParsedRows.length > 0 ? "#C4B5FD" : "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Upload size={13} strokeWidth={1.75} /> {csvParsedRows.length > 0 ? `Planilla (${csvParsedRows.length})` : "Planilla"}
                  </button>
                </div>
              </div>

              {/* CSV validation panel */}
              {csvValidation && (csvValidation.unmatchedImages.length > 0 || csvValidation.unmatchedSkus.length > 0) && (
                <div style={{ borderRadius: 16, border: "1px solid rgba(234,179,8,0.2)", background: "rgba(234,179,8,0.04)", padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.4, color: "#fbbf24" }}>Validación SKU</span>
                    <button onClick={() => setCsvValidation(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.32)", display: "flex" }}><X size={14} /></button>
                  </div>
                  {csvValidation.unmatchedImages.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <p style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: "rgba(251,191,36,0.7)", marginBottom: 6 }}>Imágenes sin SKU en planilla ({csvValidation.unmatchedImages.length})</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {csvValidation.unmatchedImages.map(n => <span key={n} style={{ fontSize: 10, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 999, padding: "2px 8px", color: "rgba(251,191,36,0.8)", fontFamily: "ui-monospace,monospace" }}>{n}</span>)}
                      </div>
                    </div>
                  )}
                  {csvValidation.unmatchedSkus.length > 0 && (
                    <div>
                      <p style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: "rgba(251,146,60,0.7)", marginBottom: 6 }}>SKUs en planilla sin imagen ({csvValidation.unmatchedSkus.length})</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {csvValidation.unmatchedSkus.map(s => <span key={s} style={{ fontSize: 10, background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.2)", borderRadius: 999, padding: "2px 8px", color: "rgba(251,146,60,0.8)", fontFamily: "ui-monospace,monospace" }}>{s}</span>)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Items list */}
              {batchItems.length > 0 && (
                <>
                  <ScrollArea className="pr-2" style={{ maxHeight: 500 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {batchItems.map((item, itemIdx) => (
                        <div key={item.id}
                          draggable
                          onDragStart={() => { dragIndex.current = itemIdx; }}
                          onDragOver={e => { e.preventDefault(); setDragOverId(item.id); }}
                          onDrop={() => { if (dragIndex.current !== null) reorderBatch(dragIndex.current, itemIdx); dragIndex.current = null; setDragOverId(null); }}
                          onDragEnd={() => { dragIndex.current = null; setDragOverId(null); }}
                          style={{ padding: 14, borderRadius: 14, border: `1px solid ${item.status === "completed" ? "rgba(74,222,128,0.4)" : item.status === "error" ? "rgba(248,113,113,0.4)" : dragOverId === item.id ? "rgba(196,181,253,0.5)" : "rgba(255,255,255,0.06)"}`, background: dragOverId === item.id ? "rgba(196,181,253,0.04)" : "rgba(0,0,0,0.25)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <GripVertical size={16} style={{ color: "rgba(255,255,255,0.2)", flexShrink: 0, cursor: "grab" }} />
                            <div style={{ width: 52, height: 52, borderRadius: 10, overflow: "hidden", flexShrink: 0, border: "1px solid rgba(255,255,255,0.08)", cursor: item.status === "completed" ? "pointer" : "default" }}
                              onClick={() => item.status === "completed" && item.result && setSelectedHistoryItem({ id: item.id, original: item.preview, result: item.result, style: selectedStyle, timestamp: Date.now(), fileName: item.file.name })}>
                              <img src={item.status === "completed" && item.result ? item.result : item.preview} className="w-full h-full object-cover" />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", margin: 0 }}>{item.file.name}</p>
                              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginTop: 3, color: item.status === "completed" ? "#4ADE80" : item.status === "processing" ? "#C4B5FD" : item.status === "error" ? "#F87171" : "rgba(255,255,255,0.4)" }}>
                                {item.status === "completed" ? "Listo" : item.status === "processing" ? "Procesando…" : item.status === "error" ? "Error" : "En espera"}
                              </p>
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              {item.status === "completed" && (
                                <button onClick={e => { e.stopPropagation(); downloadBatchItem(item); }}
                                  style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.6)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <Download size={14} strokeWidth={1.75} />
                                </button>
                              )}
                              <button onClick={e => { e.stopPropagation(); setBatchItems(prev => prev.filter(i => i.id !== item.id)); }}
                                style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <X size={14} strokeWidth={1.75} />
                              </button>
                            </div>
                          </div>
                          <div style={{ marginTop: 10 }}>{renderBatchItemInputs(item)}</div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {batchItems.some(i => i.status === "completed") && (
                      <button onClick={downloadAllBatch}
                        style={{ height: 44, borderRadius: 12, border: "1px solid rgba(196,181,253,0.2)", background: "transparent", color: "#C4B5FD", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                        <Download size={15} strokeWidth={1.75} /> Descargar Lote
                      </button>
                    )}
                    {isProcessing && (
                      <div>
                        <Progress value={batchProgress} className="h-1.5" />
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "rgba(255,255,255,0.32)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          <span>{batchTimeInfo ? `Transcurrido: ${formatTime(batchTimeInfo.elapsed)}` : "Iniciando…"}</span>
                          <span style={{ color: "#C4B5FD" }}>{batchTimeInfo?.eta != null ? `~${formatTime(batchTimeInfo.eta)} restantes` : "Calculando…"}</span>
                        </div>
                      </div>
                    )}
                    <button onClick={runBatch}
                      disabled={isProcessing || batchItems.every(i => i.status === "completed") || !isFormValid() || batchItems.length === 0}
                      style={{ width: "100%", height: 54, borderRadius: 12, border: "none", background: "#C4B5FD", color: "#0A0A0E", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 10px 28px -10px rgba(196,181,253,0.6),inset 0 1px 0 rgba(255,255,255,0.3)", opacity: (isProcessing || batchItems.every(i => i.status === "completed") || !isFormValid() || batchItems.length === 0) ? 0.4 : 1 }}>
                      {isProcessing ? <><RefreshCw size={17} className="animate-spin" /> Procesando ({Math.round(batchProgress)}%)…</> : <><Sparkles size={17} strokeWidth={1.75} /> Generar {batchItems.length} imagen{batchItems.length !== 1 ? "es" : ""}</>}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── HISTORIAL TAB ─────────────────────────────────────────────── */}
          {activeTab === "historial" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 28, gap: 20, overflowY: "auto" }} className="custom-scrollbar">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 11, color: "#C4B5FD", fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase" }}>Historial</div>
                  <div style={{ fontFamily: '"Playfair Display",serif', fontSize: 26, fontWeight: 700, marginTop: 2 }}>{history.length} generaciones</div>
                </div>
                {history.length > 0 && (
                  <button onClick={() => setHistory([])}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "none", background: "transparent", color: "rgba(255,255,255,0.2)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    <Trash2 size={13} /> Limpiar todo
                  </button>
                )}
              </div>
              {history.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 12 }}>
                  {history.map(item => (
                    <div key={item.id}
                      style={{ aspectRatio: "1", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)", cursor: "pointer", position: "relative", transition: "border-color 0.15s" }}
                      onClick={() => setSelectedHistoryItem(item)}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(196,181,253,0.4)")}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)")}>
                      <img src={item.result} className="w-full h-full object-cover" />
                      <div style={{ position: "absolute", bottom: 8, left: 8 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "3px 7px", borderRadius: 999, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", color: "rgba(255,255,255,0.8)" }}>
                          {STYLES.find(s => s.id === item.style)?.short ?? item.style}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, opacity: 0.25 }}>
                  <History size={56} strokeWidth={1} />
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, margin: 0 }}>Sin historial</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Preview modal ─────────────────────────────────────────────────── */}
        <AnimatePresence>
          {isPreviewOpen && result && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-10"
              style={{ background: "rgba(0,0,0,0.95)", backdropFilter: "blur(20px)" }}
              onClick={() => setIsPreviewOpen(false)}>
              <button style={{ position: "absolute", top: 24, right: 24, width: 48, height: 48, borderRadius: 999, background: "rgba(255,255,255,0.1)", border: "none", color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={() => setIsPreviewOpen(false)}><X size={24} /></button>
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                className="relative max-w-5xl w-full h-full flex items-center justify-center" onClick={e => e.stopPropagation()}>
                <img src={result} className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" referrerPolicy="no-referrer" />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── History lightbox ──────────────────────────────────────────────── */}
        <AnimatePresence>
          {selectedHistoryItem && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-10"
              style={{ background: "rgba(0,0,0,0.95)", backdropFilter: "blur(20px)" }}
              onClick={() => setSelectedHistoryItem(null)}>
              {history.length > 1 && (
                <>
                  <button style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", width: 64, height: 64, borderRadius: 999, background: "transparent", border: "none", color: "rgba(255,255,255,0.25)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    onClick={e => { e.stopPropagation(); const idx = history.findIndex(i => i.id === selectedHistoryItem.id); setSelectedHistoryItem(history[(idx + 1) % history.length]); }}>
                    <ChevronLeft size={40} />
                  </button>
                  <button style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", width: 64, height: 64, borderRadius: 999, background: "transparent", border: "none", color: "rgba(255,255,255,0.25)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    onClick={e => { e.stopPropagation(); const idx = history.findIndex(i => i.id === selectedHistoryItem.id); setSelectedHistoryItem(history[(idx - 1 + history.length) % history.length]); }}>
                    <ChevronRight size={40} />
                  </button>
                </>
              )}
              <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }}
                style={{ position: "relative", maxWidth: "80vw", width: "100%", background: "rgba(11,11,13,0.9)", borderRadius: 22, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 50px 120px -30px rgba(0,0,0,0.8)", display: "flex", flexDirection: "column" }}
                onClick={e => e.stopPropagation()}>
                <div style={{ position: "absolute", top: 24, right: 24, display: "flex", gap: 10, zIndex: 10 }}>
                  <button style={{ width: 40, height: 40, borderRadius: 999, background: "rgba(255,255,255,0.1)", border: "none", color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    onClick={() => downloadUrl(selectedHistoryItem.result, getFormattedFileName(selectedHistoryItem.fileName || "result", selectedHistoryItem.style))}>
                    <Download size={18} />
                  </button>
                  <button style={{ width: 40, height: 40, borderRadius: 999, background: "rgba(255,255,255,0.1)", border: "none", color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    onClick={() => setSelectedHistoryItem(null)}><X size={18} /></button>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 48px 32px" }}>
                  <img src={selectedHistoryItem.result} style={{ maxWidth: "100%", maxHeight: "65vh", objectFit: "contain", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }} referrerPolicy="no-referrer" />
                </div>
                <div style={{ padding: "20px 32px 28px", background: "rgba(0,0,0,0.4)", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 52, height: 52, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
                      <img src={selectedHistoryItem.original} className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <h4 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{selectedHistoryItem.fileName}</h4>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", margin: "4px 0 0", textTransform: "uppercase", letterSpacing: 1 }}>
                        {new Date(selectedHistoryItem.timestamp).toLocaleString()} · {selectedHistoryItem.style}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button style={{ height: 44, padding: "0 18px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                      onClick={() => { setImage(selectedHistoryItem.original); setResult(selectedHistoryItem.result); setOriginalFileName(selectedHistoryItem.fileName); setActiveTab("crear"); setIsBatchMode(false); setSelectedHistoryItem(null); }}>
                      Editar Ajustes
                    </button>
                    <button style={{ height: 44, padding: "0 22px", borderRadius: 12, border: "none", background: "#C4B5FD", color: "#0A0A0E", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 28px -10px rgba(196,181,253,0.6)" }}
                      onClick={() => downloadUrl(selectedHistoryItem.result, getFormattedFileName(selectedHistoryItem.fileName || "result", selectedHistoryItem.style))}>
                      Descargar HD
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {!isEmbed && (
          <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "20px 0", textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", letterSpacing: 2 }}>
            © 2026 ProEcom AI · Gemini 2.5 Flash · Google Drive Ready
          </footer>
        )}
      </div>
    </TooltipProvider>
  );
}
