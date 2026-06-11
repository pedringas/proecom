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
type ActiveTab = "crear" | "lote";

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
  const [activeTab, setActiveTab]         = useState<ActiveTab>("crear");
  const [isHistorialOpen, setIsHistorialOpen] = useState(false);
  const [historialSearch, setHistorialSearch] = useState("");

  // Style-specific inputs
  const [width, setWidth]               = useState("");
  const [height, setHeight]             = useState("");
  const [depth, setDepth]               = useState("");
  const [infoTitle, setInfoTitle]       = useState("");
  const [infoFeatures, setInfoFeatures] = useState("");
  const [infoScenario, setInfoScenario] = useState("");
  const [infoStyle, setInfoStyle]         = useState<"Pop" | "Elegante">("Pop");
  const [infoTemplate, setInfoTemplate]   = useState<"laterales" | "tira" | "grilla">("laterales");
  const [lifestylePrompt, setLifestylePrompt]       = useState("");
  const [productDescription, setProductDescription] = useState("");

  // Error / status states
  const [generationError, setGenerationError] = useState<{ message: string; code: string } | null>(null);
  const [uploadError, setUploadError]         = useState<{ fileName: string; reason: string } | null>(null);
  const [isOffline, setIsOffline]             = useState(!navigator.onLine);
  const [isRateLimitOpen, setIsRateLimitOpen] = useState(false);
  const [isDriveOnboardingOpen, setIsDriveOnboardingOpen] = useState(false);

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

  // ── Offline detection ─────────────────────────────────────────────────────
  useEffect(() => {
    const onOnline  = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

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
    const MAX_MB = 10;
    const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
    if (file.type && !file.type.startsWith("image/")) {
      const ext = file.name.split(".").pop()?.toUpperCase() || "archivo";
      setUploadError({ fileName: file.name, reason: `"${file.name}" es un ${ext} — solo se aceptan JPG, PNG y WebP.` });
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      setUploadError({ fileName: file.name, reason: `"${file.name}" pesa ${mb} MB — el máximo es ${MAX_MB} MB.` });
      return;
    }
    setUploadError(null);
    setGenerationError(null);
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
    setGenerationError(null);
    try {
      const raw = await transformImage(image.split(",")[1], mimeType, selectedStyle, "", {
        width, height, depth,
        title: infoTitle, features: infoFeatures, infoScenario,
        lifestylePrompt, productDescription, aspectRatio: imageAspectRatio,
        infoStyle, infoTemplate
      });
      const converted = outputFormat !== "png" ? await convertToFormat(raw, outputFormat) : raw;
      setResult(converted);
      addToHistory(image, converted, selectedStyle, originalFileName);
      toast.success("¡Transformación completada!");
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("rate")) {
        setIsRateLimitOpen(true);
      } else {
        const code = `GEN_ERR · ${Date.now().toString(36).toUpperCase()}`;
        setGenerationError({ message: "El modelo tardó demasiado o no pudo procesar la imagen.", code });
      }
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
        const converted = outputFormat !== "png" ? await convertToFormat(raw, outputFormat) : raw;
        setBatchItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: "completed", result: converted } : it));
        addToHistory(`data:image/jpeg;base64,${b64}`, converted, selectedStyle, item.file.name);
        if (isGoogleAuth) await handleSaveToDrive(converted, item.file.name);
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
  const handleConnectDrive = () => {
    if (!isGoogleAuth) { setIsDriveOnboardingOpen(true); return; }
    proceedConnectDrive();
  };

  const proceedConnectDrive = async () => {
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

  // ── Single mode right panel inputs (required fields first per style) ────────
  const PanelSection = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 1.4, color: "#C4B5FD" }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.32)" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );

  const DescField = () => (
    <PanelSection label="Descripción del Producto" hint="opcional">
      <Input placeholder="Ej: Zapatillas deportivas rojas Nike" value={productDescription} onChange={e => setProductDescription(e.target.value)}
        className="h-9 text-xs bg-black/40 border-white/[0.06]" />
      <p style={{ fontSize: 9.5, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" as const, letterSpacing: 0.5 }}>Ayuda a la IA a identificar el producto</p>
    </PanelSection>
  );

  const renderSingleInputs = () => (
    <AnimatePresence mode="wait">

      {/* ── Ecom: desc only ── */}
      {selectedStyle === "Ecom" && (
        <motion.div key="ecom" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
          <DescField />
        </motion.div>
      )}

      {/* ── Lifestyle / PortadaML: entorno → desc ── */}
      {(selectedStyle === "Lifestyle" || selectedStyle === "LifestyleNoHuman") && (
        <motion.div key="lifestyle" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PanelSection label={selectedStyle === "LifestyleNoHuman" ? "Entorno para Portada" : "Entorno Preferido"} hint="opcional">
            <Input placeholder={selectedStyle === "LifestyleNoHuman" ? "Ej: Cocina moderna, escritorio minimalista…" : "Ej: En un parque, en una cocina…"}
              value={lifestylePrompt} onChange={e => setLifestylePrompt(e.target.value)} className="h-9 text-xs bg-black/40 border-white/[0.06]" />
            <p style={{ fontSize: 9.5, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" as const, letterSpacing: 0.5 }}>
              {selectedStyle === "LifestyleNoHuman" ? "Estilo portada recomendado por MercadoLibre" : "Describe dónde querés ver el producto"}
            </p>
          </PanelSection>
          <DescField />
        </motion.div>
      )}

      {/* ── Technical: dimensiones (req) → desc ── */}
      {selectedStyle === "Technical" && (
        <motion.div key="technical" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PanelSection label="Dimensiones" hint="requerido">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {([["Ancho", width, setWidth], ["Alto", height, setHeight], ["Prof.", depth, setDepth]] as [string, string, (v: string) => void][]).map(([label, val, setter]) => (
                <div key={label}>
                  <div style={{ fontSize: 9.5, color: "rgba(255,255,255,0.4)", marginBottom: 5, textTransform: "uppercase" as const, letterSpacing: 0.8 }}>{label}</div>
                  <div style={{ position: "relative" }}>
                    <Input placeholder="0" value={val} onChange={e => setter(e.target.value)}
                      className={cn("h-9 text-xs bg-black/40 pr-8", !val.trim() ? "border-red-500/40" : "border-white/[0.06]")} />
                    <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "rgba(255,255,255,0.32)", pointerEvents: "none" }}>cm</span>
                  </div>
                </div>
              ))}
            </div>
          </PanelSection>
          <DescField />
        </motion.div>
      )}

      {/* ── Infographic: título + puntos (req) → plantilla → desc ── */}
      {selectedStyle === "Infographic" && (
        <motion.div key="infographic" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Título */}
          <PanelSection label="Título" hint="encabezado">
            <Input placeholder="Ej: Sonido que se siente" value={infoTitle} onChange={e => setInfoTitle(e.target.value)}
              className={cn("h-9 text-xs bg-black/40", !infoTitle.trim() ? "border-red-500/40" : "border-white/[0.06]")} />
          </PanelSection>

          {/* Puntos */}
          <PanelSection label="Puntos a destacar" hint={`máx. 4 · ${infoFeatures.split("\n").filter(l => l.trim()).length}/4`}>
            <Textarea
              placeholder={"Material premium\nBluetooth 5.3\n30h de batería\nResistente IPX5"}
              value={infoFeatures} onChange={e => setInfoFeatures(e.target.value)}
              className={cn("text-xs h-24 bg-black/40", !infoFeatures.trim() ? "border-red-500/40" : "border-white/[0.06]")} />
            <p style={{ fontSize: 9.5, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" as const, letterSpacing: 0.5 }}>Un punto por línea</p>
            <button
              style={{ background: "transparent", border: "1px dashed rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: 600, padding: "8px 12px", borderRadius: 10, cursor: "not-allowed", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: 0.7 }}
              disabled title="Próximamente">
              <Sparkles size={13} strokeWidth={1.75} /> Sugerir con IA
            </button>
          </PanelSection>

          {/* Estilo visual */}
          <PanelSection label="Estilo Visual">
            <div style={{ display: "flex", gap: 6 }}>
              {(["Pop", "Elegante"] as const).map(s => (
                <button key={s} onClick={() => setInfoStyle(s)}
                  style={{ flex: 1, height: 34, borderRadius: 8, border: `1px solid ${infoStyle === s ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.06)"}`, background: infoStyle === s ? "rgba(255,255,255,0.08)" : "transparent", color: infoStyle === s ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  {s === "Pop" ? "Pop 🎨" : "Elegante ✨"}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 9.5, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" as const, letterSpacing: 0.5 }}>
              {infoStyle === "Pop" ? "Colores vibrantes y llamativos" : "Paleta sofisticada derivada del producto"}
            </p>
          </PanelSection>

          {/* Escenario (solo Elegante) */}
          {infoStyle === "Elegante" && (
            <PanelSection label="Escenario" hint="opcional">
              <Input placeholder="Ej: Mesa de madera con taza humeante" value={infoScenario} onChange={e => setInfoScenario(e.target.value)}
                className="h-9 text-xs bg-black/40 border-white/[0.06]" />
            </PanelSection>
          )}

          {/* Plantilla de disposición */}
          <PanelSection label="Plantilla">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {([
                { id: "laterales" as const, label: "Laterales", preview: (
                  <svg width="36" height="26" viewBox="0 0 36 26" fill="none">
                    <rect x="1" y="1" width="34" height="24" rx="3" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="18" cy="13" r="6" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
                    <rect x="3" y="4" width="6" height="5" rx="1" fill="currentColor" opacity="0.6" />
                    <rect x="3" y="17" width="6" height="5" rx="1" fill="currentColor" opacity="0.6" />
                    <rect x="27" y="4" width="6" height="5" rx="1" fill="currentColor" opacity="0.6" />
                    <rect x="27" y="17" width="6" height="5" rx="1" fill="currentColor" opacity="0.6" />
                  </svg>
                )},
                { id: "tira" as const, label: "Tira", preview: (
                  <svg width="36" height="26" viewBox="0 0 36 26" fill="none">
                    <rect x="1" y="1" width="34" height="24" rx="3" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="18" cy="11" r="6" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
                    <rect x="4" y="20" width="28" height="4" rx="1" fill="currentColor" opacity="0.6" />
                  </svg>
                )},
                { id: "grilla" as const, label: "Grilla", preview: (
                  <svg width="36" height="26" viewBox="0 0 36 26" fill="none">
                    <rect x="1" y="1" width="34" height="24" rx="3" stroke="currentColor" strokeWidth="1.5" />
                    <rect x="4" y="4" width="6" height="5" rx="1" fill="currentColor" opacity="0.6" />
                    <rect x="15" y="4" width="6" height="5" rx="1" fill="currentColor" opacity="0.6" />
                    <rect x="26" y="4" width="6" height="5" rx="1" fill="currentColor" opacity="0.6" />
                    <rect x="4" y="17" width="6" height="5" rx="1" fill="currentColor" opacity="0.6" />
                    <rect x="15" y="17" width="6" height="5" rx="1" fill="currentColor" opacity="0.6" />
                    <rect x="26" y="17" width="6" height="5" rx="1" fill="currentColor" opacity="0.6" />
                  </svg>
                )},
              ] as { id: "laterales" | "tira" | "grilla"; label: string; preview: React.ReactNode }[]).map(t => (
                <button key={t.id} onClick={() => setInfoTemplate(t.id)}
                  style={{ borderRadius: 10, padding: "10px 0 8px", background: infoTemplate === t.id ? "rgba(196,181,253,0.08)" : "transparent", border: `1px solid ${infoTemplate === t.id ? "rgba(196,181,253,0.25)" : "rgba(255,255,255,0.06)"}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "pointer", color: infoTemplate === t.id ? "#C4B5FD" : "rgba(255,255,255,0.4)" }}>
                  {t.preview}
                  <span style={{ fontSize: 9.5, fontWeight: 600 }}>{t.label}</span>
                </button>
              ))}
            </div>
          </PanelSection>

          <DescField />
        </motion.div>
      )}
    </AnimatePresence>
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
                {(["Crear", "Por lote"] as const).map(label => {
                  const tab: ActiveTab = label === "Crear" ? "crear" : "lote";
                  const isActive = activeTab === tab;
                  return (
                    <button key={label}
                      onClick={() => { setActiveTab(tab); setIsBatchMode(tab === "lote"); }}
                      style={{ padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", background: isActive ? "rgba(255,255,255,0.07)" : "transparent", color: isActive ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)", transition: "background 0.15s,color 0.15s" }}>
                      {label}
                    </button>
                  );
                })}
                <button
                  onClick={() => setIsHistorialOpen(true)}
                  style={{ padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", background: "transparent", color: "rgba(255,255,255,0.55)", transition: "background 0.15s,color 0.15s", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Historial
                  {history.length > 0 && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.32)" }}>{history.length}</span>}
                </button>
              </nav>
            </div>
            {/* Right chips */}
            <div className="flex items-center gap-[10px]">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(212,175,55,0.08)", color: "#D4AF37", border: "1px solid rgba(212,175,55,0.25)", fontSize: 11, padding: "3px 9px", borderRadius: 999, fontWeight: 500 }}>
                <Sparkles size={11} strokeWidth={1.75} /> Gemini 2.5
              </span>
              {isGoogleAuth ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: isOffline ? "rgba(248,113,113,0.08)" : "rgba(74,222,128,0.08)", color: isOffline ? "#F87171" : "#4ADE80", border: `1px solid ${isOffline ? "rgba(248,113,113,0.25)" : "rgba(74,222,128,0.25)"}`, fontSize: 11, padding: "3px 9px", borderRadius: 999, fontWeight: 500 }}>
                  <span className={isOffline ? "pulse-dot" : ""} style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor", display: "inline-block" }} />
                  Drive{isOffline ? " · sin conexión" : ""}
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

        {/* ── Offline banner ───────────────────────────────────────────────── */}
        <AnimatePresence>
          {isOffline && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 40, opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              style={{ background: "rgba(248,113,113,0.12)", borderBottom: "1px solid rgba(248,113,113,0.25)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", flexShrink: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "#F87171" }}>
                <span className="pulse-dot" style={{ width: 8, height: 8, borderRadius: 999, background: "#F87171", display: "inline-block" }} />
                Sin conexión — reintentando… Tu trabajo está guardado localmente.
              </div>
              <span style={{ fontSize: 11, color: "rgba(248,113,113,0.6)" }}>Reintentando en 5s</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0" style={{ height: isEmbed ? "100vh" : "calc(100vh - 56px)" }}>

          {/* Style Rail — only in crear tab */}
          {activeTab === "crear" && (
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
                    {uploadError ? (
                      <motion.div key="upload-error" className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-10"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <div style={{ position: "absolute", inset: 0, border: "1.5px dashed rgba(248,113,113,0.4)", borderRadius: 20, pointerEvents: "none" }} />
                        <div style={{ width: 72, height: 72, borderRadius: 20, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", display: "flex", alignItems: "center", justifyContent: "center", color: "#F87171" }}>
                          <X size={32} strokeWidth={1.5} />
                        </div>
                        <div style={{ textAlign: "center", maxWidth: 380 }}>
                          <h3 style={{ fontFamily: '"Playfair Display",serif', fontSize: 22, fontWeight: 700, color: "#F87171", margin: "0 0 10px" }}>Archivo rechazado</h3>
                          <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.7)", margin: "0 0 6px", lineHeight: 1.5 }}>{uploadError.reason}</p>
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: 0 }}>Formatos aceptados: JPG · PNG · WebP · hasta 10 MB</p>
                        </div>
                        <button onClick={() => { setUploadError(null); fileInputRef.current?.click(); }}
                          style={{ height: 44, padding: "0 20px", borderRadius: 12, border: "none", background: "#C4B5FD", color: "#0A0A0E", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <Upload size={16} strokeWidth={1.75} /> Elegir otro archivo
                        </button>
                        <button onClick={() => setUploadError(null)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", fontSize: 12 }}>
                          Cancelar
                        </button>
                      </motion.div>
                    ) : generationError ? (
                      <motion.div key="gen-error" className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-10"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <div style={{ width: 72, height: 72, borderRadius: 20, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", display: "flex", alignItems: "center", justifyContent: "center", color: "#F87171" }}>
                          <RefreshCw size={28} strokeWidth={1.5} />
                        </div>
                        <div style={{ textAlign: "center", maxWidth: 400 }}>
                          <h3 style={{ fontFamily: '"Playfair Display",serif', fontSize: 22, fontWeight: 700, margin: "0 0 10px" }}>No pudimos generar la imagen</h3>
                          <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.6)", margin: "0 0 8px", lineHeight: 1.5 }}>{generationError.message}</p>
                          <p style={{ fontSize: 12.5, color: "#4ADE80", margin: 0 }}>Tu foto y tus ajustes están intactos — podés reintentar sin perder nada.</p>
                        </div>
                        <div style={{ display: "flex", gap: 10 }}>
                          <button onClick={() => { setGenerationError(null); handleTransform(); }}
                            style={{ height: 44, padding: "0 20px", borderRadius: 12, border: "none", background: "#C4B5FD", color: "#0A0A0E", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, boxShadow: "0 10px 28px -10px rgba(196,181,253,0.5)" }}>
                            <RefreshCw size={16} strokeWidth={1.75} /> Reintentar
                          </button>
                          <button onClick={() => toast.info("Reporte enviado. Gracias.")}
                            style={{ height: 44, padding: "0 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                            Reportar
                          </button>
                        </div>
                        <div style={{ fontFamily: "ui-monospace,Menlo,monospace", fontSize: 10.5, color: "rgba(255,255,255,0.2)", padding: "6px 12px", background: "rgba(0,0,0,0.4)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)" }}>
                          {generationError.code}
                        </div>
                      </motion.div>
                    ) : isProcessing ? (
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
                    <span style={{ fontFamily: "ui-monospace,Menlo,monospace", fontSize: 11 }}>
                      {originalFileName || "imagen.jpg"} · {outputFormat.toUpperCase()}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <button onClick={() => fileInputRef.current?.click()}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.32)", fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <RefreshCw size={12} strokeWidth={1.75} /> cambiar foto
                      </button>
                      <button onClick={() => { setResult(null); setShowComparison(false); }}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#C4B5FD", fontSize: 11.5 }}>
                        regenerar →
                      </button>
                    </div>
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
            <div style={{ flex: 1, display: "flex", minHeight: 0, minWidth: 0 }}>

            {/* ── Lote center ── */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 20, gap: 14, minWidth: 0, overflow: "hidden" }}>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#C4B5FD", fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase" }}>
                    {isProcessing ? `Procesando lote · ${batchItems.filter(i => i.status === "completed" || i.status === "error").length} de ${batchItems.length}` : `Por lote${batchItems.length > 0 ? ` · ${batchItems.length} productos` : ""}`}
                  </div>
                  <div style={{ fontFamily: '"Playfair Display",serif', fontSize: 22, fontWeight: 700, marginTop: 2, lineHeight: 1.1 }}>
                    {isProcessing ? `Generando ${batchItems.length} imágenes` : batchItems.length > 0 ? "Listo para generar" : "Procesá tu catálogo en una pasada"}
                  </div>
                </div>
                {batchItems.length > 0 && !isProcessing && (
                  <button onClick={() => { setBatchItems([]); setCsvParsedRows([]); setCsvValidation(null); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, border: "none", background: "transparent", color: "rgba(248,113,113,0.6)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    <Trash2 size={13} strokeWidth={1.75} /> Reiniciar
                  </button>
                )}
              </div>

              {/* ── EMPTY STATE: 3 import cards ── */}
              {batchItems.length === 0 && (
                <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 14, minHeight: 0 }}
                  onDragOver={e => { e.preventDefault(); setBatchDropActive(true); }}
                  onDragLeave={() => setBatchDropActive(false)}
                  onDrop={handleBatchDrop}>

                  {/* Big dropzone */}
                  <div style={{ position: "relative", borderRadius: 20, padding: 28, background: batchDropActive ? "rgba(196,181,253,0.08)" : "rgba(15,15,18,0.6)", border: `1.5px dashed ${batchDropActive ? "#C4B5FD" : "rgba(196,181,253,0.18)"}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, textAlign: "center", transition: "all 0.15s" }}>
                    <div style={{ width: 88, height: 88, borderRadius: 24, background: "radial-gradient(circle at 30% 30%,rgba(196,181,253,0.2),rgba(196,181,253,0.04))", border: "1px solid rgba(196,181,253,0.18)", display: "flex", alignItems: "center", justifyContent: "center", color: "#C4B5FD" }}>
                      <Upload size={36} strokeWidth={1.75} />
                    </div>
                    <div style={{ maxWidth: 300 }}>
                      <h2 style={{ fontFamily: '"Playfair Display",serif', fontSize: 24, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>Soltá hasta 200 fotos acá</h2>
                      <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, margin: "10px 0 0", lineHeight: 1.5 }}>Aplicamos el mismo estilo a todas. Después podés ajustar producto por producto.</p>
                    </div>
                    <button onClick={() => batchInputRef.current?.click()}
                      style={{ height: 46, padding: "0 20px", borderRadius: 12, border: "none", background: "#C4B5FD", color: "#0A0A0E", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, boxShadow: "0 10px 28px -10px rgba(196,181,253,0.6),inset 0 1px 0 rgba(255,255,255,0.3)" }}>
                      <Upload size={16} strokeWidth={1.75} /> Seleccionar archivos
                    </button>
                    <div style={{ position: "absolute", bottom: 20, fontSize: 11, color: "rgba(255,255,255,0.32)" }}>JPG · PNG · WebP · hasta 10 MB c/u</div>
                  </div>

                  {/* CSV card */}
                  <div style={{ borderRadius: 20, padding: 22, background: "rgba(11,11,13,0.5)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(212,175,55,0.08)", border: "1px solid rgba(212,175,55,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: "#D4AF37" }}>
                      <Layers size={20} strokeWidth={1.75} />
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Importar planilla</div>
                      <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>
                        Subí un CSV o XLSX con <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: "#C4B5FD" }}>sku · descripción · estilo</span>. Ideal si ya tenés el catálogo en una hoja.
                      </div>
                    </div>
                    <div style={{ flex: 1 }} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={downloadCsvTemplate}
                        style={{ flex: 1, height: 36, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.55)", fontSize: 11.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                        <Download size={13} strokeWidth={1.75} /> CSV
                      </button>
                      <button onClick={downloadXlsxTemplate}
                        style={{ flex: 1, height: 36, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.55)", fontSize: 11.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                        <Download size={13} strokeWidth={1.75} /> XLSX
                      </button>
                    </div>
                    <button onClick={() => csvInputRef.current?.click()}
                      style={{ height: 38, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.92)", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <Upload size={15} strokeWidth={1.75} /> Elegir planilla…
                    </button>
                  </div>

                  {/* Drive card */}
                  <div style={{ borderRadius: 20, padding: 22, background: "rgba(11,11,13,0.5)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: "#4ADE80" }}>
                      <Cloud size={20} strokeWidth={1.75} />
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Desde Drive</div>
                      <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>Elegí una carpeta y las imágenes generadas vuelven a la misma carpeta, en una subcarpeta <em>/IA</em>.</div>
                    </div>
                    <div style={{ flex: 1 }} />
                    <button onClick={handleConnectDrive}
                      style={{ height: 38, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: isGoogleAuth ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.07)", color: isGoogleAuth ? "#4ADE80" : "rgba(255,255,255,0.92)", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <Cloud size={15} strokeWidth={1.75} /> {isGoogleAuth ? "Drive conectado" : "Conectar Drive"}
                    </button>
                  </div>
                </div>
              )}

              {/* ── PROCESSING: progress strip + table ── */}
              {batchItems.length > 0 && isProcessing && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
                  {/* Big fraction strip */}
                  <div style={{ padding: 16, borderRadius: 16, background: "linear-gradient(135deg,rgba(196,181,253,0.08),rgba(196,181,253,0.02))", border: "1px solid rgba(196,181,253,0.18)", display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                        <span style={{ fontFamily: '"Playfair Display",serif', fontSize: 28, fontWeight: 700, color: "#C4B5FD", fontVariantNumeric: "tabular-nums" }}>
                          {batchItems.filter(i => i.status === "completed" || i.status === "error").length} / {batchItems.length}
                        </span>
                        <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.55)" }}>
                          {batchItems.filter(i => i.status === "completed").length} listas
                          {batchItems.filter(i => i.status === "error").length > 0 && ` · ${batchItems.filter(i => i.status === "error").length} fallaron`}
                          {batchItems.filter(i => i.status === "processing").length > 0 && ` · ${batchItems.filter(i => i.status === "processing").length} generando`}
                          {batchItems.filter(i => i.status === "pending").length > 0 && ` · ${batchItems.filter(i => i.status === "pending").length} en cola`}
                        </span>
                      </div>
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.32)", fontVariantNumeric: "tabular-nums" }}>
                        {batchTimeInfo?.eta != null ? `~${formatTime(batchTimeInfo.eta)} restantes` : batchTimeInfo ? `${formatTime(batchTimeInfo.elapsed)} transcurridos` : "Iniciando…"}
                      </span>
                    </div>
                    {/* Multicolor bar */}
                    <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden", display: "flex" }}>
                      <div style={{ width: `${(batchItems.filter(i => i.status === "completed").length / batchItems.length) * 100}%`, background: "linear-gradient(90deg,#C4B5FD,#D4AF37)", transition: "width 0.5s" }} />
                      <div style={{ width: `${(batchItems.filter(i => i.status === "error").length / batchItems.length) * 100}%`, background: "rgba(248,113,113,0.5)" }} />
                    </div>
                  </div>

                  {/* Processing table */}
                  <div style={{ flex: 1, borderRadius: 16, overflow: "hidden", background: "rgba(11,11,13,0.6)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", minHeight: 0 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 120px 1fr 80px", gap: 12, padding: "9px 14px", fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.32)", letterSpacing: 1.2, textTransform: "uppercase", background: "rgba(0,0,0,0.25)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
                      <span />
                      <span>Archivo</span>
                      <span>Estilo</span>
                      <span>Estado</span>
                      <span style={{ textAlign: "right" }}>Acción</span>
                    </div>
                    <ScrollArea style={{ flex: 1 }}>
                      {batchItems.map(item => {
                        const SIcon = STYLES.find(s => s.id === selectedStyle)?.icon || Box;
                        return (
                          <div key={item.id} style={{ display: "grid", gridTemplateColumns: "44px 1fr 120px 1fr 80px", gap: 12, padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.04)", alignItems: "center", background: item.status === "processing" ? "rgba(196,181,253,0.04)" : item.status === "error" ? "rgba(248,113,113,0.04)" : item.status === "completed" ? "rgba(74,222,128,0.025)" : "transparent" }}>
                            <div style={{ position: "relative", width: 40, height: 40, borderRadius: 8, overflow: "hidden", flexShrink: 0, border: "1px solid rgba(255,255,255,0.08)" }}>
                              <img src={item.status === "completed" && item.result ? item.result : item.preview} className="w-full h-full object-cover" />
                              {item.status === "completed" && <div style={{ position: "absolute", inset: 0, background: "rgba(74,222,128,0.18)", display: "flex", alignItems: "center", justifyContent: "center", color: "#4ADE80" }}><Check size={16} /></div>}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.file.name}</div>
                              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.32)", marginTop: 2 }}>{outputFormat.toUpperCase()} · {imageAspectRatio}</div>
                            </div>
                            <div>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(196,181,253,0.08)", color: "#C4B5FD", border: "1px solid rgba(196,181,253,0.25)", fontSize: 11, padding: "3px 8px", borderRadius: 999, fontWeight: 500 }}>
                                <SIcon size={11} strokeWidth={1.75} /> {STYLES.find(s => s.id === selectedStyle)?.short}
                              </span>
                            </div>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
                              {item.status === "completed" && <><span style={{ width: 16, height: 16, borderRadius: 999, background: "#4ADE80", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#062E15", flexShrink: 0 }}><Check size={10} /></span><span style={{ fontWeight: 600, color: "rgba(255,255,255,0.92)" }}>Listo</span></>}
                              {item.status === "processing" && <><motion.span animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }} style={{ width: 16, height: 16, borderRadius: 999, border: "2px solid rgba(255,255,255,0.06)", borderTopColor: "#C4B5FD", display: "inline-block", flexShrink: 0 }} /><span style={{ fontWeight: 600, color: "#C4B5FD" }}>Generando…</span></>}
                              {item.status === "error" && <><span style={{ width: 16, height: 16, borderRadius: 999, background: "rgba(248,113,113,0.15)", border: "1px solid #F87171", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#F87171", flexShrink: 0 }}><X size={10} /></span><span style={{ fontWeight: 600, color: "#F87171" }}>Error</span></>}
                              {item.status === "pending" && <><span style={{ width: 16, height: 16, borderRadius: 999, border: "1px solid rgba(255,255,255,0.12)", flexShrink: 0, display: "inline-block" }} /><span style={{ color: "rgba(255,255,255,0.32)" }}>En cola</span></>}
                            </div>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
                              {item.status === "completed" && (
                                <button onClick={() => downloadBatchItem(item)} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.55)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <Download size={13} strokeWidth={1.75} />
                                </button>
                              )}
                              {item.status === "error" && (
                                <button onClick={() => setBatchItems(prev => prev.map(i => i.id === item.id ? { ...i, status: "pending" } : i))} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid rgba(248,113,113,0.3)", background: "rgba(248,113,113,0.06)", color: "#F87171", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <RefreshCw size={13} strokeWidth={1.75} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </ScrollArea>
                  </div>
                </div>
              )}

              {/* ── QUEUE: table with toolbar ── */}
              {batchItems.length > 0 && !isProcessing && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRadius: 16, overflow: "hidden", background: "rgba(11,11,13,0.6)", border: "1px solid rgba(255,255,255,0.06)", minHeight: 0 }}>

                  {/* Toolbar */}
                  <div style={{ padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,0.3)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{batchItems.length} producto{batchItems.length !== 1 ? "s" : ""}</span>
                      {batchItems.some(i => i.status === "completed") && (
                        <>
                          <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.06)" }} />
                          <button onClick={downloadAllBatch} style={{ background: "transparent", border: "none", color: "#C4B5FD", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <Download size={13} strokeWidth={1.75} /> Descargar completadas ({batchItems.filter(i => i.status === "completed").length})
                          </button>
                        </>
                      )}
                    </div>
                    {/* CSV validation badge */}
                    {csvValidation && (csvValidation.unmatchedImages.length > 0 || csvValidation.unmatchedSkus.length > 0) && (
                      <button onClick={() => setCsvValidation(null)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)", color: "#fbbf24", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        {csvValidation.unmatchedImages.length + csvValidation.unmatchedSkus.length} sin match · ×
                      </button>
                    )}
                  </div>

                  {/* Column headers */}
                  <div style={{ display: "grid", gridTemplateColumns: "44px 1.3fr 1.8fr 110px 64px", gap: 10, padding: "8px 14px", fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.32)", letterSpacing: 1.2, textTransform: "uppercase", background: "rgba(0,0,0,0.15)", flexShrink: 0 }}>
                    <span />
                    <span>Archivo</span>
                    <span>{selectedStyle === "Technical" ? "Dimensiones" : selectedStyle === "Infographic" ? "Título y puntos" : "Descripción"}</span>
                    <span>Estilo</span>
                    <span />
                  </div>

                  {/* Rows */}
                  <ScrollArea style={{ flex: 1 }}>
                    {batchItems.map((item, itemIdx) => {
                      const effectiveStyle = STYLES.find(s => s.id === selectedStyle);
                      const upd = (patch: Partial<BatchItem>) => setBatchItems(prev => prev.map(i => i.id === item.id ? { ...i, ...patch } : i));
                      const iS = { width: "100%", height: 30, padding: "0 8px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 7, fontSize: 11.5, color: "rgba(255,255,255,0.92)", outline: "none" } as React.CSSProperties;
                      const iSErr = { ...iS, borderColor: "rgba(248,113,113,0.4)" };

                      const detailsCell = selectedStyle === "Technical" ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
                            {([["Ancho", "width"], ["Alto", "height"], ["Prof.", "depth"]] as [string, keyof BatchItem][]).map(([label, key]) => (
                              <div key={key}>
                                <div style={{ fontSize: 9.5, color: "rgba(255,255,255,0.35)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
                                <div style={{ position: "relative" }}>
                                  <input value={(item[key] as string) || ""} onChange={e => upd({ [key]: e.target.value })} placeholder="0"
                                    style={!(item[key] as string)?.trim() ? { ...iSErr, paddingRight: 24 } : { ...iS, paddingRight: 24 }} />
                                  <span style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "rgba(255,255,255,0.3)", pointerEvents: "none" }}>cm</span>
                                </div>
                              </div>
                            ))}
                          </div>
                          <input value={item.productDescription || ""} onChange={e => upd({ productDescription: e.target.value })}
                            placeholder="Descripción (opcional)" style={iS} />
                        </div>
                      ) : selectedStyle === "Infographic" ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          <input value={item.infoTitle || ""} onChange={e => upd({ infoTitle: e.target.value })}
                            placeholder="Título *" style={!item.infoTitle?.trim() ? iSErr : iS} />
                          <textarea value={item.infoFeatures || ""} onChange={e => upd({ infoFeatures: e.target.value })}
                            placeholder={"Punto 1\nPunto 2\nPunto 3"} rows={3}
                            style={{ ...(!item.infoFeatures?.trim() ? iSErr : iS), height: 56, padding: "5px 8px", resize: "none" as const, lineHeight: 1.4 }} />
                        </div>
                      ) : (
                        <input value={item.productDescription || ""} onChange={e => upd({ productDescription: e.target.value })}
                          placeholder="Descripción del producto…" style={iS} />
                      );

                      return (
                        <div key={item.id}
                          draggable
                          onDragStart={() => { dragIndex.current = itemIdx; }}
                          onDragOver={e => { e.preventDefault(); setDragOverId(item.id); }}
                          onDrop={() => { if (dragIndex.current !== null) reorderBatch(dragIndex.current, itemIdx); dragIndex.current = null; setDragOverId(null); }}
                          onDragEnd={() => { dragIndex.current = null; setDragOverId(null); }}
                          style={{ display: "grid", gridTemplateColumns: "44px 1.3fr 1.8fr 110px 64px", gap: 10, padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.04)", alignItems: "start", background: dragOverId === item.id ? "rgba(196,181,253,0.04)" : item.status === "completed" ? "rgba(74,222,128,0.025)" : item.status === "error" ? "rgba(248,113,113,0.04)" : "transparent" }}>
                          <div style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", cursor: "grab", flexShrink: 0, marginTop: 2 }}>
                            <img src={item.status === "completed" && item.result ? item.result : item.preview} className="w-full h-full object-cover" />
                          </div>
                          <div style={{ minWidth: 0, paddingTop: 2 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.file.name}</div>
                            <div style={{ fontSize: 10.5, color: item.status === "completed" ? "#4ADE80" : item.status === "error" ? "#F87171" : "rgba(255,255,255,0.32)", marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ width: 5, height: 5, borderRadius: 999, background: "currentColor", display: "inline-block", flexShrink: 0 }} />
                              {item.status === "completed" ? "Listo" : item.status === "error" ? "Error" : "Pendiente"}
                            </div>
                          </div>
                          <div>{detailsCell}</div>
                          <div style={{ paddingTop: 4 }}>
                            {effectiveStyle && (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(196,181,253,0.08)", color: "#C4B5FD", border: "1px solid rgba(196,181,253,0.18)", fontSize: 10.5, padding: "3px 7px", borderRadius: 999, fontWeight: 500, whiteSpace: "nowrap" }}>
                                <effectiveStyle.icon size={10} strokeWidth={1.75} /> {effectiveStyle.short}
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, paddingTop: 2 }}>
                            {item.status === "completed" && (
                              <button onClick={() => downloadBatchItem(item)} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.55)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <Download size={13} strokeWidth={1.75} />
                              </button>
                            )}
                            <button onClick={() => setBatchItems(prev => prev.filter(i => i.id !== item.id))} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "rgba(255,255,255,0.25)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <X size={13} strokeWidth={1.75} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </ScrollArea>

                  {/* Add row footer */}
                  <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                    <button onClick={() => batchInputRef.current?.click()}
                      style={{ background: "transparent", border: "1px dashed rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Upload size={13} strokeWidth={1.75} /> Añadir más fotos
                    </button>
                    <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.32)" }}>{batchItems.length} archivo{batchItems.length !== 1 ? "s" : ""}</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Lote right panel (340px) ── */}
            <aside style={{ width: 340, flexShrink: 0, borderLeft: "1px solid rgba(255,255,255,0.06)", background: "rgba(11,11,13,0.5)", display: "flex", flexDirection: "column" }}>
              <div style={{ flex: 1, padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }} className="custom-scrollbar">

                {/* Estilo por defecto */}
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.4, color: "#C4B5FD", marginBottom: 10 }}>Estilo por defecto</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {STYLES.map(s => {
                      const SIcon = s.icon;
                      const active = selectedStyle === s.id;
                      return (
                        <button key={s.id} onClick={() => setSelectedStyle(s.id)}
                          style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 10, background: active ? "rgba(196,181,253,0.08)" : "rgba(255,255,255,0.02)", border: `1px solid ${active ? "rgba(196,181,253,0.18)" : "rgba(255,255,255,0.06)"}`, color: active ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)", cursor: "pointer" }}>
                          <SIcon size={14} strokeWidth={1.75} style={{ color: active ? "#C4B5FD" : "rgba(255,255,255,0.32)", flexShrink: 0 }} />
                          <span style={{ fontSize: 12, fontWeight: 600 }}>{s.short}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Salida */}
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.4, color: "#C4B5FD", marginBottom: 10 }}>Salida</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {(["1:1", "9:16", "16:9"] as const).map((r, i) => {
                      const dims = [{ w: 14, h: 14 }, { w: 10, h: 16 }, { w: 16, h: 10 }][i];
                      return (
                        <button key={r} onClick={() => setImageAspectRatio(r)}
                          style={{ flex: 1, height: 46, borderRadius: 9, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, background: imageAspectRatio === r ? "rgba(196,181,253,0.08)" : "transparent", border: `1px solid ${imageAspectRatio === r ? "rgba(196,181,253,0.18)" : "rgba(255,255,255,0.06)"}`, cursor: "pointer" }}>
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

                {/* Destino */}
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.4, color: "#C4B5FD", marginBottom: 10 }}>Destino</div>
                  <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", gap: 10 }}>
                    <Cloud size={16} strokeWidth={1.75} style={{ color: isGoogleAuth ? "#4ADE80" : "rgba(255,255,255,0.32)", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{isGoogleAuth ? "Drive · /IA" : "Solo descarga local"}</div>
                      <div style={{ fontSize: 11, color: isGoogleAuth ? "#4ADE80" : "rgba(255,255,255,0.32)", marginTop: 2 }}>
                        {isGoogleAuth ? "Auto-guardado activado" : "Conectá Drive para auto-guardar"}
                      </div>
                    </div>
                    {!isGoogleAuth && (
                      <button onClick={handleConnectDrive} style={{ height: 28, padding: "0 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        Conectar
                      </button>
                    )}
                  </div>
                </div>

                {/* Resumen (solo con items) */}
                {batchItems.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.4, color: "#C4B5FD", marginBottom: 10 }}>Resumen</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {[
                        { l: "Imágenes a generar", v: `${batchItems.filter(i => i.status !== "completed").length}` },
                        { l: "Completadas", v: `${batchItems.filter(i => i.status === "completed").length}` },
                        { l: "Tiempo estimado", v: batchItems.filter(i => i.status !== "completed").length > 0 ? `~${Math.ceil(batchItems.filter(i => i.status !== "completed").length * 4 / 60)} min` : "—", accent: "#C4B5FD" },
                      ].map(row => (
                        <div key={row.l} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{row.l}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: row.accent || "rgba(255,255,255,0.92)", fontVariantNumeric: "tabular-nums" }}>{row.v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* CSV validation (compact) */}
                {csvValidation && (csvValidation.unmatchedImages.length > 0 || csvValidation.unmatchedSkus.length > 0) && (
                  <div style={{ borderRadius: 12, border: "1px solid rgba(234,179,8,0.2)", background: "rgba(234,179,8,0.04)", padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2, color: "#fbbf24" }}>Validación SKU</span>
                      <button onClick={() => setCsvValidation(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.32)" }}><X size={13} /></button>
                    </div>
                    {csvValidation.unmatchedImages.length > 0 && (
                      <p style={{ fontSize: 11, color: "rgba(251,191,36,0.7)", margin: "0 0 4px" }}>{csvValidation.unmatchedImages.length} imagen{csvValidation.unmatchedImages.length !== 1 ? "es" : ""} sin SKU en planilla</p>
                    )}
                    {csvValidation.unmatchedSkus.length > 0 && (
                      <p style={{ fontSize: 11, color: "rgba(251,146,60,0.7)", margin: 0 }}>{csvValidation.unmatchedSkus.length} SKU{csvValidation.unmatchedSkus.length !== 1 ? "s" : ""} en planilla sin imagen</p>
                    )}
                  </div>
                )}
              </div>

              {/* Footer CTA */}
              <div style={{ padding: 16, borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(5,5,5,0.7)", display: "flex", flexDirection: "column", gap: 8 }}>
                {batchItems.some(i => i.status === "completed") && !isProcessing && (
                  <button onClick={downloadAllBatch}
                    style={{ height: 42, borderRadius: 12, border: "1px solid rgba(196,181,253,0.2)", background: "transparent", color: "#C4B5FD", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <Download size={15} strokeWidth={1.75} /> Descargar completadas ({batchItems.filter(i => i.status === "completed").length})
                  </button>
                )}
                <button onClick={runBatch}
                  disabled={isProcessing || batchItems.every(i => i.status === "completed") || batchItems.length === 0}
                  style={{ width: "100%", height: 54, borderRadius: 12, border: "none", background: "#C4B5FD", color: "#0A0A0E", fontSize: 14, fontWeight: 700, cursor: (batchItems.length === 0 || batchItems.every(i => i.status === "completed")) ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 10px 28px -10px rgba(196,181,253,0.6),inset 0 1px 0 rgba(255,255,255,0.3)", opacity: (isProcessing || batchItems.every(i => i.status === "completed") || batchItems.length === 0) ? 0.4 : 1 }}>
                  {isProcessing ? <><RefreshCw size={17} className="animate-spin" /> Procesando…</> : batchItems.length === 0 ? <><Sparkles size={17} strokeWidth={1.75} /> Generar lote</> : <><Sparkles size={17} strokeWidth={1.75} /> Generar {batchItems.filter(i => i.status !== "completed").length} imagen{batchItems.filter(i => i.status !== "completed").length !== 1 ? "es" : ""}</>}
                </button>
                {batchItems.length === 0 && <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.32)", textAlign: "center" }}>Subí al menos 1 imagen para activar</div>}
              </div>
            </aside>

            </div>
          )}

        </div>

        {/* ── HISTORIAL OVERLAY ──────────────────────────────────────────────── */}
        <AnimatePresence>
          {isHistorialOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(5,5,5,0.85)", backdropFilter: "blur(16px)", display: "flex", alignItems: "stretch" }}
              onClick={() => setIsHistorialOpen(false)}
            >
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.2 }}
                style={{ flex: 1, display: "flex", flexDirection: "column", maxWidth: 1200, margin: "40px auto", background: "rgba(11,11,13,0.95)", borderRadius: 22, border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 50px 120px -30px rgba(0,0,0,0.8)", overflow: "hidden" }}
                onClick={e => e.stopPropagation()}
              >
                {/* Modal header */}
                <div style={{ padding: "18px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 16, flexShrink: 0, background: "rgba(0,0,0,0.3)" }}>
                  <History size={18} strokeWidth={1.75} style={{ color: "#C4B5FD" }} />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>Historial</span>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.32)", marginLeft: 10 }}>
                      {history.length} generaciones
                    </span>
                  </div>
                  {/* Search */}
                  <div style={{ position: "relative" }}>
                    <input
                      value={historialSearch}
                      onChange={e => setHistorialSearch(e.target.value)}
                      placeholder="Buscar por nombre…"
                      style={{ height: 34, padding: "0 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 12, color: "rgba(255,255,255,0.92)", outline: "none", width: 200 }}
                    />
                  </div>
                  {/* Filter chips */}
                  <div style={{ display: "flex", gap: 4 }}>
                    {["Todo", ...STYLES.map(s => s.short)].slice(0, 4).map((f, i) => (
                      <span key={f} style={{ padding: "4px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 500, background: i === 0 ? "rgba(255,255,255,0.07)" : "transparent", color: i === 0 ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.4)", border: `1px solid ${i === 0 ? "rgba(255,255,255,0.12)" : "transparent"}`, cursor: "pointer" }}>
                        {f}
                      </span>
                    ))}
                  </div>
                  {history.length > 0 && (
                    <button onClick={() => setHistory([])}
                      style={{ padding: "4px 10px", borderRadius: 8, border: "none", background: "transparent", color: "rgba(255,255,255,0.2)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      Limpiar
                    </button>
                  )}
                  <button onClick={() => setIsHistorialOpen(false)}
                    style={{ width: 36, height: 36, borderRadius: 999, border: "none", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <X size={18} strokeWidth={1.75} />
                  </button>
                </div>

                {/* Grid */}
                <div style={{ flex: 1, overflowY: "auto", padding: 24 }} className="custom-scrollbar">
                  {history.length === 0 ? (
                    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, opacity: 0.25 }}>
                      <History size={64} strokeWidth={1} />
                      <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, margin: 0 }}>Sin historial</p>
                    </div>
                  ) : (() => {
                    const filtered = history.filter(item =>
                      !historialSearch || item.fileName.toLowerCase().includes(historialSearch.toLowerCase())
                    );

                    // Group by date
                    const groups: { label: string; items: HistoryItem[] }[] = [];
                    const now = new Date();
                    const todayStr = now.toDateString();
                    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
                    const yesterdayStr = yesterday.toDateString();

                    filtered.forEach(item => {
                      const d = new Date(item.timestamp);
                      const label = d.toDateString() === todayStr ? "Hoy"
                        : d.toDateString() === yesterdayStr ? "Ayer"
                        : d.toLocaleDateString("es-AR", { day: "numeric", month: "long" });
                      const g = groups.find(g => g.label === label);
                      if (g) g.items.push(item);
                      else groups.push({ label, items: [item] });
                    });

                    return groups.map(group => (
                      <div key={group.label} style={{ marginBottom: 28 }}>
                        <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.4, color: "rgba(255,255,255,0.32)", marginBottom: 12 }}>{group.label}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(148px,1fr))", gap: 10 }}>
                          {group.items.map(item => (
                            <div key={item.id}
                              style={{ aspectRatio: "1", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)", cursor: "pointer", position: "relative", transition: "border-color 0.15s, transform 0.15s" }}
                              onClick={() => { setSelectedHistoryItem(item); }}
                              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(196,181,253,0.5)"; (e.currentTarget as HTMLDivElement).style.transform = "scale(1.02)"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}>
                              <img src={item.result} className="w-full h-full object-cover" />
                              {/* Hover overlay */}
                              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0)", transition: "background 0.15s" }}
                                onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.4)")}
                                onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,0,0,0)")}>
                                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0, transition: "opacity 0.15s" }}
                                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.opacity = "1"; (e.currentTarget.parentElement as HTMLDivElement).style.background = "rgba(0,0,0,0.4)"; }}
                                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.opacity = "0"; (e.currentTarget.parentElement as HTMLDivElement).style.background = "rgba(0,0,0,0)"; }}>
                                  <Eye size={20} style={{ color: "white" }} />
                                </div>
                              </div>
                              <div style={{ position: "absolute", bottom: 7, left: 7, right: 7, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "3px 7px", borderRadius: 999, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", color: "rgba(255,255,255,0.8)" }}>
                                  {STYLES.find(s => s.id === item.style)?.short ?? item.style}
                                </span>
                                <button
                                  onClick={e => { e.stopPropagation(); downloadUrl(item.result, getFormattedFileName(item.fileName || "result", item.style)); }}
                                  style={{ width: 26, height: 26, borderRadius: 7, border: "none", background: "rgba(0,0,0,0.7)", color: "rgba(255,255,255,0.7)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <Download size={12} strokeWidth={1.75} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Rate limit modal ──────────────────────────────────────────────── */}
        <AnimatePresence>
          {isRateLimitOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[110] flex items-center justify-center p-6"
              style={{ background: "rgba(5,5,5,0.85)", backdropFilter: "blur(16px)" }}
              onClick={() => setIsRateLimitOpen(false)}>
              <motion.div initial={{ scale: 0.92, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.92, opacity: 0, y: 16 }}
                style={{ width: "100%", maxWidth: 420, background: "rgba(11,11,13,0.98)", borderRadius: 22, border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 50px 120px -30px rgba(0,0,0,0.8)", padding: "32px 28px", display: "flex", flexDirection: "column", gap: 20 }}
                onClick={e => e.stopPropagation()}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 14, background: "rgba(196,181,253,0.1)", border: "1px solid rgba(196,181,253,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: "#C4B5FD", flexShrink: 0 }}>
                    <History size={20} strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 style={{ fontFamily: '"Playfair Display",serif', fontSize: 20, fontWeight: 700, margin: "0 0 6px" }}>El equipo alcanzó el límite de la hora</h3>
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1.5 }}>La cuota compartida se libera automáticamente. No se perdió ningún trabajo.</p>
                  </div>
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 11.5 }}>
                    <span style={{ color: "rgba(255,255,255,0.55)" }}>Uso del equipo · esta hora</span>
                    <span style={{ color: "#C4B5FD", fontWeight: 600 }}>500 / 500</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                    <div style={{ width: "100%", height: "100%", background: "linear-gradient(90deg,#C4B5FD,#8B5CF6)", borderRadius: 999 }} />
                  </div>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 8, textAlign: "center" }}>Se libera en ~12 min</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button onClick={() => { toast.success("Te avisamos cuando la cuota se libere."); setIsRateLimitOpen(false); }}
                    style={{ height: 48, borderRadius: 12, border: "none", background: "#C4B5FD", color: "#0A0A0E", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 10px 28px -10px rgba(196,181,253,0.5)" }}>
                    Avisarme cuando se libere
                  </button>
                  <button onClick={() => setIsRateLimitOpen(false)}
                    style={{ height: 44, borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    Entendido, vuelvo después
                  </button>
                </div>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", textAlign: "center", margin: 0 }}>
                  ¿Necesitás más capacidad? Escribile a IT.
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Drive onboarding modal ─────────────────────────────────────────── */}
        <AnimatePresence>
          {isDriveOnboardingOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[110] flex items-center justify-center p-6"
              style={{ background: "rgba(5,5,5,0.85)", backdropFilter: "blur(16px)" }}
              onClick={() => setIsDriveOnboardingOpen(false)}>
              <motion.div initial={{ scale: 0.92, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.92, opacity: 0, y: 16 }}
                style={{ width: "100%", maxWidth: 420, background: "rgba(11,11,13,0.98)", borderRadius: 22, border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 50px 120px -30px rgba(0,0,0,0.8)", padding: "32px 28px", display: "flex", flexDirection: "column", gap: 22 }}
                onClick={e => e.stopPropagation()}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ width: 52, height: 52, borderRadius: 16, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: "#4ADE80", margin: "0 auto 16px" }}>
                    <Cloud size={24} strokeWidth={1.75} />
                  </div>
                  <h3 style={{ fontFamily: '"Playfair Display",serif', fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>Conectá tu Google Drive</h3>
                  <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1.5 }}>Hacé tu flujo de trabajo mucho más rápido.</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { icon: "✓", text: "Guardado automático de cada imagen generada" },
                    { icon: "✓", text: "Importá catálogos completos directamente desde una carpeta" },
                    { icon: "✓", text: "Historial sincronizado en todos tus dispositivos" },
                  ].map(b => (
                    <div key={b.text} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <span style={{ width: 20, height: 20, borderRadius: 999, background: "rgba(74,222,128,0.15)", color: "#4ADE80", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{b.icon}</span>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>{b.text}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button onClick={() => { setIsDriveOnboardingOpen(false); proceedConnectDrive(); }}
                    style={{ height: 48, borderRadius: 12, border: "none", background: "#4ADE80", color: "#062E15", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <Cloud size={16} strokeWidth={1.75} /> Conectar con Google
                  </button>
                  <button onClick={() => setIsDriveOnboardingOpen(false)}
                    style={{ height: 40, borderRadius: 12, border: "none", background: "transparent", color: "rgba(255,255,255,0.35)", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>
                    Ahora no · usar solo descargas
                  </button>
                </div>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", textAlign: "center", margin: 0, lineHeight: 1.4 }}>
                  Solo accedemos a la carpeta que vos elegís. Nunca leemos otros archivos de tu Drive.
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

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
                      onClick={() => { setImage(selectedHistoryItem.original); setResult(selectedHistoryItem.result); setOriginalFileName(selectedHistoryItem.fileName); setActiveTab("crear"); setIsBatchMode(false); setSelectedHistoryItem(null); setIsHistorialOpen(false); }}>
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
