import React, { useState, useRef, useCallback, useEffect, ChangeEvent, DragEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Upload, Sparkles, Image as ImageIcon, Download, RefreshCw, Camera,
  Cloud, Trash2, History, X, Check, Eye, Maximize,
  ChevronLeft, ChevronRight, Video, GripVertical
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { transformImage, analyzeProduct, generateVideo360 } from "@/src/services/gemini";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────
type Style = "Ecom" | "LifestyleNoHuman" | "Lifestyle" | "Technical" | "Infographic" | "Video360";

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
const STYLES: { id: Style; label: string; desc: string }[] = [
  { id: "Ecom",            label: "1. Producto",       desc: "Fondo blanco de estudio" },
  { id: "LifestyleNoHuman",label: "2. Portada ML",     desc: "Lifestyle sin personas" },
  { id: "Lifestyle",       label: "3. Lifestyle",      desc: "Ambiente con personas" },
  { id: "Technical",       label: "4. Medidas",        desc: "Dimensiones del producto" },
  { id: "Infographic",     label: "5. Infografía",     desc: "Características visuales" },
  { id: "Video360",        label: "6. Video 360°",     desc: "Rotación del producto" },
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
      {/* After — resultado (capa base) */}
      <img src={after} className="absolute inset-0 w-full h-full object-contain p-4 md:p-8" referrerPolicy="no-referrer" />

      {/* Before — original (recortado dinámicamente) */}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={before} className="w-full h-full object-contain p-4 md:p-8 opacity-90" />
      </div>

      {/* Línea + handle */}
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

      {/* Labels */}
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
  Ecom:            "png",
  LifestyleNoHuman:"webp",
  Lifestyle:       "webp",
  Technical:       "png",
  Infographic:     "png",
  Video360:        "webp", // no aplica pero necesita valor
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

  // Video 360
  const [video360Result, setVideo360Result] = useState<string | null>(null);
  const [video360Angles, setVideo360Angles] = useState<{
    frente: BatchItem | null; dorso: BatchItem | null;
    lateral1: BatchItem | null; lateral2: BatchItem | null;
  }>({ frente: null, dorso: null, lateral1: null, lateral2: null });

  // Batch
  const [batchItems, setBatchItems]       = useState<BatchItem[]>([]);
  const [isBatchMode, setIsBatchMode]     = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const batchStartTime                    = useRef<number | null>(null);
  const [batchTimeInfo, setBatchTimeInfo] = useState<{ elapsed: number; eta: number | null } | null>(null);

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

  // ── Persist history (sin `original` para no reventar localStorage) ─────────
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
  const handleBatchFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    setBatchItems(prev => [...prev, ...files.map(file => ({
      id: Math.random().toString(36).substr(2, 9), file,
      preview: URL.createObjectURL(file), status: "pending" as const,
      width: "", height: "", depth: "", infoTitle: "", infoFeatures: "",
      lifestylePrompt: "", productDescription: ""
    }))]);
    setIsBatchMode(true);
    if (batchInputRef.current)       batchInputRef.current.value = "";
    if (batchCameraInputRef.current) batchCameraInputRef.current.value = "";
  };

  // ── Batch drag & drop upload ─────────────────────────────────────────────
  const handleBatchDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setBatchDropActive(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    if (!files.length) return;
    setBatchItems(prev => [...prev, ...files.map(file => ({
      id: Math.random().toString(36).substr(2, 9), file,
      preview: URL.createObjectURL(file), status: "pending" as const,
      width: "", height: "", depth: "", infoTitle: "", infoFeatures: "",
      lifestylePrompt: "", productDescription: ""
    }))]);
    setIsBatchMode(true);
  };

  // ── CSV template download ─────────────────────────────────────────────────
  const downloadCsvTemplate = () => {
    let headers: string;
    let example: string;
    if (selectedStyle === "Technical") {
      headers = "sku,descripcion_producto,ancho,alto,profundo";
      example = "producto-001,Descripción del producto,30,20,15";
    } else if (selectedStyle === "Infographic") {
      headers = "sku,descripcion_producto,titulo,caracteristicas,estilo,escenario";
      example = "producto-001,Descripción del producto,Mi Producto Premium,Duradero|Elegante|Económico,Pop,";
    } else {
      headers = "sku,descripcion_producto,entorno";
      example = "producto-001,Descripción del producto,Cocina moderna con luz natural";
    }
    const csv = `${headers}\n${example}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "plantilla_lote.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ── CSV import & auto-match by SKU ────────────────────────────────────────
  const handleCsvImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { toast.error("El CSV no tiene datos."); return; }
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
      const idx = (col: string) => headers.indexOf(col);
      let matched = 0;
      setBatchItems(prev => prev.map(item => {
        const sku = item.file.name.replace(/\.[^/.]+$/, "");
        const row = lines.slice(1).find(l => {
          const cols = l.split(",");
          return cols[idx("sku")]?.trim() === sku;
        });
        if (!row) return item;
        const cols = row.split(",");
        const get = (col: string) => idx(col) >= 0 ? (cols[idx(col)] || "").trim() : "";
        matched++;
        return {
          ...item,
          infoTitle:          get("titulo")               || item.infoTitle,
          infoFeatures:       get("caracteristicas").replace(/\|/g, "\n") || item.infoFeatures,
          infoStyle:          (get("estilo") as "Pop" | "Elegante") || item.infoStyle,
          infoScenario:       get("escenario")             || item.infoScenario,
          width:              get("ancho")                 || item.width,
          height:             get("alto")                  || item.height,
          depth:              get("profundo")              || item.depth,
          productDescription: get("descripcion_producto")  || item.productDescription,
          lifestylePrompt:    get("entorno")               || item.lifestylePrompt,
        };
      }));
      toast.success(`CSV importado: ${matched} de ${lines.length - 1} items coincidieron.`);
    };
    reader.readAsText(file);
    if (csvInputRef.current) csvInputRef.current.value = "";
  };

  // ── Form validation ───────────────────────────────────────────────────────
  const isFormValid = () => {
    if (selectedStyle === "Video360") return Object.values(video360Angles).some(Boolean);
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

  // ── Video 360 ─────────────────────────────────────────────────────────────
  const handleGenerateVideo360 = async () => {
    if (!Object.values(video360Angles).some(Boolean)) return;
    setIsProcessing(true); setBatchProgress(0); setVideo360Result(null);
    try {
      const ordered = [video360Angles.frente, video360Angles.lateral1, video360Angles.dorso, video360Angles.lateral2].filter(Boolean) as BatchItem[];
      const processed: { base64: string; mimeType: string }[] = [];
      for (const item of ordered) {
        const b64 = item.preview.split(",")[1];
        const url = await transformImage(b64, "image/jpeg", "Ecom", "", { productDescription });
        processed.push({ base64: url.split(",")[1], mimeType: "image/png" });
        setBatchProgress(processed.length / (ordered.length + 2) * 100);
      }
      const desc = await analyzeProduct(processed, productDescription);
      setBatchProgress(80);
      const videoObjectUrl = await generateVideo360(desc, processed);
      setVideo360Result(videoObjectUrl);
      toast.success("¡Video 360° generado con éxito!");
      setBatchProgress(100);
    } catch (e) {
      console.error(e);
      toast.error("Error al generar el video 360°.");
    } finally {
      setIsProcessing(false);
    }
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

  // ── Conditional inputs (single mode) ──────────────────────────────────────
  const renderSingleInputs = () => (
    <>
      <div className="space-y-2 pb-4">
        <Label className="text-[10px] uppercase text-brand-violet/60">Descripción del Producto (Opcional)</Label>
        <Input placeholder="Ej: Zapatillas deportivas rojas Nike" value={productDescription} onChange={e => setProductDescription(e.target.value)} className="input-premium h-10 text-xs" />
        <p className="text-[9px] text-white/30 uppercase tracking-tighter">Ayuda a la IA a identificar el producto con precisión</p>
      </div>
      <AnimatePresence mode="wait">
      {(selectedStyle === "Lifestyle" || selectedStyle === "LifestyleNoHuman") && (
        <motion.div key="lifestyle" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-2 pb-4">
          <Label className="text-[10px] uppercase text-brand-violet/60">
            {selectedStyle === "LifestyleNoHuman" ? "Entorno para la Portada (Opcional)" : "Entorno Preferido (Opcional)"}
          </Label>
          <Input
            placeholder={selectedStyle === "LifestyleNoHuman" ? "Ej: Cocina moderna, escritorio minimalista..." : "Ej: En un parque, en una cocina..."}
            value={lifestylePrompt} onChange={e => setLifestylePrompt(e.target.value)} className="input-premium h-10 text-xs"
          />
          <p className="text-[9px] text-white/30 uppercase tracking-tighter">
            {selectedStyle === "LifestyleNoHuman" ? "Estilo portada recomendada por MercadoLibre" : "Describe dónde quieres ver el producto"}
          </p>
        </motion.div>
      )}
      {selectedStyle === "Technical" && (
        <motion.div key="technical" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-3 pb-4">
          <Label className="text-[10px] uppercase text-brand-violet/60">Medidas del Producto <span className="text-red-500">*</span></Label>
          <div className="grid grid-cols-3 gap-2">
            {[["Ancho (cm)", width, setWidth], ["Alto (cm)", height, setHeight], ["Profundo (cm)", depth, setDepth]].map(([label, val, setter]) => (
              <div key={label as string} className="space-y-1">
                <Label className="text-[9px] uppercase text-white/30">{label as string}</Label>
                <Input placeholder={label as string} value={val as string} onChange={e => (setter as (v: string) => void)(e.target.value)}
                  className={cn("input-premium h-10 text-[10px]", !(val as string).trim() && "border-red-500/50")} />
              </div>
            ))}
          </div>
        </motion.div>
      )}
      {selectedStyle === "Infographic" && (
        <motion.div key="infographic" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4 pb-4">
          <div className="space-y-2">
            <Label className="text-[10px] uppercase text-brand-violet/60">Estilo Visual</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["Pop", "Elegante"] as const).map(s => (
                <Button key={s} onClick={() => setInfoStyle(s)}
                  className={cn("h-9 text-[10px] font-black uppercase tracking-widest border active:scale-95",
                    infoStyle === s ? "bg-white text-black border-white" : "bg-transparent text-white/60 border-brand-violet/20 hover:bg-brand-violet/10")}>
                  {s === "Pop" ? "Pop 🎨" : "Elegante ✨"}
                </Button>
              ))}
            </div>
            <p className="text-[9px] text-white/30 uppercase tracking-tighter">
              {infoStyle === "Pop" ? "Colores vibrantes y llamativos" : "Paleta sofisticada derivada del producto"}
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-[10px] uppercase text-brand-violet/60">Título <span className="text-red-500">*</span></Label>
            <Input placeholder="Ej: El mejor del mercado" value={infoTitle} onChange={e => setInfoTitle(e.target.value)}
              className={cn("input-premium h-10 text-xs", !infoTitle.trim() && "border-red-500/50")} />
          </div>
          <div className="space-y-2">
            <Label className="text-[10px] uppercase text-brand-violet/60">Características <span className="text-red-500">*</span></Label>
            <Textarea placeholder={"Duradero\nElegante\nEconómico"} value={infoFeatures} onChange={e => setInfoFeatures(e.target.value)}
              className={cn("input-premium text-xs h-24", !infoFeatures.trim() && "border-red-500/50")} />
            <p className="text-[9px] text-white/30 uppercase tracking-tighter">Una característica por línea</p>
          </div>
          {infoStyle === "Elegante" && (
            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-brand-violet/60">Escenario (Opcional)</Label>
              <Input placeholder="Ej: Mesa de madera con taza humeante y cuchara" value={infoScenario}
                onChange={e => setInfoScenario(e.target.value)} className="input-premium h-10 text-xs" />
              <p className="text-[9px] text-white/30 uppercase tracking-tighter">Describe la escena donde se usa el producto</p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );

  // ── Batch item inputs (sin duplicado de Infografía) ───────────────────────
  const renderBatchItemInputs = (item: BatchItem) => {
    const upd = (patch: Partial<BatchItem>) => setBatchItems(prev => prev.map(i => i.id === item.id ? { ...i, ...patch } : i));
    const descField = (
      <Input placeholder="Descripción del Producto (Opcional)"
        value={item.productDescription || ""} onChange={e => upd({ productDescription: e.target.value })}
        className="h-9 text-[10px] bg-black/40 border-white/5" />
    );
    if (selectedStyle === "Ecom") return (
      <div className="space-y-2">{descField}</div>
    );
    if (selectedStyle === "LifestyleNoHuman") return (
      <div className="space-y-2">
        {descField}
        <Input placeholder="Entorno para portada ML (Opcional)"
          value={item.lifestylePrompt || ""} onChange={e => upd({ lifestylePrompt: e.target.value })}
          className="h-9 text-[10px] bg-black/40 border-white/5" />
      </div>
    );
    if (selectedStyle === "Lifestyle") return (
      <div className="space-y-2">
        {descField}
        <Input placeholder="Entorno específico (Opcional)" value={item.lifestylePrompt || ""}
          onChange={e => upd({ lifestylePrompt: e.target.value })} className="h-9 text-[10px] bg-black/40 border-white/5" />
      </div>
    );
    if (selectedStyle === "Technical") return (
      <div className="space-y-2">
        {descField}
        <div className="grid grid-cols-3 gap-2">
          {(["width", "height", "depth"] as const).map((k, i) => (
            <Input key={k} placeholder={["Ancho (cm)", "Alto (cm)", "Profundo (cm)"][i]}
              value={item[k] || ""} onChange={e => upd({ [k]: e.target.value })}
              className={cn("h-10 text-[9px] bg-black/40 border-white/5", !item[k]?.trim() && "border-red-500/50")} />
          ))}
        </div>
      </div>
    );
    if (selectedStyle === "Infographic") {
      const itemStyle = item.infoStyle || "Pop";
      return (
        <div className="space-y-2">
          {descField}
          <div className="grid grid-cols-2 gap-2">
            {(["Pop", "Elegante"] as const).map(s => (
              <Button key={s} onClick={() => upd({ infoStyle: s })} size="sm"
                className={cn("h-9 text-[9px] font-black uppercase tracking-widest border",
                  itemStyle === s ? "bg-white text-black border-white" : "bg-transparent text-white/60 border-white/10 hover:bg-white/10")}>
                {s === "Pop" ? "Pop 🎨" : "Elegante ✨"}
              </Button>
            ))}
          </div>
          <Input placeholder="Título" value={item.infoTitle || ""} onChange={e => upd({ infoTitle: e.target.value })}
            className={cn("h-9 text-[10px] bg-black/40 border-white/5", !item.infoTitle?.trim() && "border-red-500/50")} />
          <Textarea placeholder={"Característica 1\nCaracterística 2"} value={item.infoFeatures || ""}
            onChange={e => upd({ infoFeatures: e.target.value })}
            className={cn("h-16 text-[10px] bg-black/40 border-white/5", !item.infoFeatures?.trim() && "border-red-500/50")} />
          {itemStyle === "Elegante" && (
            <Input placeholder="Escenario (Opcional)" value={item.infoScenario || ""}
              onChange={e => upd({ infoScenario: e.target.value })}
              className="h-9 text-[10px] bg-black/40 border-white/5" />
          )}
        </div>
      );
    }
    return null;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col items-center p-4 md:p-8 max-w-7xl mx-auto">
        <Toaster position="top-center" />

        {/* Hidden file inputs */}
        <input type="file" ref={fileInputRef}        onChange={e => e.target.files?.[0] && processFile(e.target.files[0])} className="hidden" accept="image/*" />
        <input type="file" ref={cameraInputRef}      onChange={e => e.target.files?.[0] && processFile(e.target.files[0])} className="hidden" accept="image/*" capture="environment" />
        <input type="file" ref={batchInputRef}       onChange={handleBatchFiles} className="hidden" accept="image/*" multiple />
        <input type="file" ref={batchCameraInputRef} onChange={handleBatchFiles} className="hidden" accept="image/*" capture="environment" />
        <input type="file" ref={csvInputRef}         onChange={handleCsvImport}  className="hidden" accept=".csv,text/csv" />

        {/* Header */}
        {!isEmbed && (
          <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="w-full text-center mb-6 md:mb-12">
            <div className="flex flex-wrap justify-center mb-4 gap-2">
              <Badge variant="outline" className="px-3 py-0.5 border-brand-gold/30 text-brand-gold bg-brand-gold/5 text-[10px] md:text-xs">
                Gemini 2.5 Flash Image
              </Badge>
              {isGoogleAuth ? (
                <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px] md:text-xs">
                  <Cloud className="w-3 h-3 mr-1" /> Drive Conectado
                </Badge>
              ) : (
                <Button variant="outline" size="sm" onClick={handleConnectDrive}
                  className="h-6 md:h-7 text-[9px] md:text-[10px] border-blue-500/30 text-blue-400 hover:bg-blue-500/10">
                  <Cloud className="w-3 h-3 mr-1" /> Conectar Drive
                </Button>
              )}
            </div>
            <h1 className="text-4xl md:text-7xl font-serif font-bold tracking-tight mb-2 md:mb-4">
              ProEcom <span className="text-brand-gold">AI</span>
            </h1>
            <p className="text-white/40 text-sm md:text-lg max-w-2xl mx-auto px-4">
              Optimización masiva de productos para e-commerce con fidelidad total.
            </p>
          </motion.header>
        )}

        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8 items-start">

          {/* ── Main viewport ── */}
          {!isBatchMode && (
            <div className={cn("lg:order-2 space-y-6", isEmbed ? "lg:col-span-7" : "lg:col-span-5")}>
              <Card className="glass-card overflow-hidden bg-black/40 border-white/5 aspect-square relative group shadow-2xl"
                onDragOver={e => e.preventDefault()} onDrop={onDrop}>
                <AnimatePresence mode="wait">
                  {selectedStyle === "Video360" && video360Result ? (
                    <motion.div key="v360" className="w-full h-full relative" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <video src={video360Result} className="w-full h-full object-contain p-4 md:p-8" autoPlay loop muted playsInline />
                      <div className="absolute top-4 right-4 flex gap-2">
                        <Badge className="bg-brand-violet/20 text-brand-violet border-brand-violet/30 backdrop-blur-md">
                          <Sparkles className="w-3 h-3 mr-1" /> 360° Video
                        </Badge>
                        <Button size="icon" className="bg-white/90 hover:bg-white text-black rounded-full shadow-lg h-8 w-8" onClick={() => setIsPreviewOpen(true)}><Maximize className="w-4 h-4" /></Button>
                        <Button size="icon" className="bg-white/90 hover:bg-white text-black rounded-full shadow-lg h-8 w-8" onClick={() => downloadUrl(video360Result!, `360-view-${Date.now()}.mp4`)}><Download className="w-4 h-4" /></Button>
                      </div>
                    </motion.div>
                  ) : isProcessing ? (
                    <motion.div key="loading" className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md z-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <div className="relative w-20 h-20 md:w-24 md:h-24 mb-6">
                        <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }} className="absolute inset-0 border-t-2 border-brand-gold rounded-full" />
                        <Sparkles className="absolute inset-0 m-auto w-8 h-8 text-brand-gold animate-pulse" />
                      </div>
                      <p className="text-brand-gold font-medium animate-pulse text-sm md:text-base">Generando perfección...</p>
                    </motion.div>
                  ) : !image && selectedStyle !== "Video360" ? (
                    <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 flex flex-col items-center justify-center p-8 md:p-12 group">
                      <div className="w-16 h-16 md:w-24 md:h-24 bg-white/5 rounded-3xl flex items-center justify-center mb-6 border border-white/10 group-hover:scale-110 group-hover:border-brand-gold/50 transition-all duration-500">
                        <Upload className="w-8 h-8 md:w-12 md:h-12 text-white/40 group-hover:text-brand-gold transition-colors" />
                      </div>
                      <h3 className="text-xl md:text-3xl font-serif font-bold mb-3 text-white tracking-tight">Cargar Producto</h3>
                      <p className="text-white/50 text-xs md:text-base text-center max-w-[300px] leading-relaxed mb-8">
                        Sube una foto o toma una directamente con tu cámara.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-[300px]">
                        <Button onClick={() => fileInputRef.current?.click()} className="flex-1 bg-white/10 hover:bg-white/20 text-white border border-white/20 h-12 rounded-xl backdrop-blur-md">
                          <ImageIcon className="w-4 h-4 mr-2" /> Galería
                        </Button>
                        <Button onClick={() => cameraInputRef.current?.click()} className="flex-1 bg-brand-violet hover:bg-white text-black h-12 rounded-xl shadow-[0_0_20px_rgba(196,181,253,0.3)]">
                          <Camera className="w-4 h-4 mr-2" /> Cámara
                        </Button>
                      </div>
                    </motion.div>
                  ) : selectedStyle === "Video360" && !video360Result ? (
                    <motion.div key="v360-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 flex flex-col items-center justify-center p-8 md:p-12 text-center">
                      <div className="w-16 h-16 md:w-24 md:h-24 bg-brand-violet/10 rounded-3xl flex items-center justify-center mb-6 border border-brand-violet/20">
                        <Video className="w-8 h-8 md:w-12 md:h-12 text-brand-violet/60" />
                      </div>
                      <h3 className="text-xl md:text-3xl font-serif font-bold mb-3 text-white tracking-tight">Creador Video 360°</h3>
                      <p className="text-white/50 text-xs md:text-base max-w-[300px] leading-relaxed">
                        Sube las fotos de los diferentes ángulos en el panel izquierdo.
                      </p>
                    </motion.div>
                  ) : result ? (
                    <motion.div key="result" className="w-full h-full relative">
                      {showComparison && image ? (
                        <ComparisonSlider before={image} after={result} />
                      ) : (
                        <>
                          <img src={result} className="w-full h-full object-contain p-4 md:p-8" referrerPolicy="no-referrer" />
                          <div className="absolute top-4 right-4">
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 backdrop-blur-md">
                              <Check className="w-3 h-3 mr-1" /> IA Ready
                            </Badge>
                          </div>
                          <div className="absolute inset-0 bg-black/40 md:bg-black/0 md:hover:bg-black/60 transition-all flex flex-col items-center justify-center opacity-100 md:opacity-0 md:hover:opacity-100 group gap-4">
                            <div className="flex gap-3">
                              <Button onClick={() => setIsPreviewOpen(true)} className="bg-white text-black hover:bg-brand-gold font-black uppercase tracking-widest px-6 h-12 shadow-2xl">
                                <Maximize className="w-5 h-5 mr-2" /> Expandir
                              </Button>
                              <Button onClick={() => setShowComparison(true)} className="bg-white/10 text-white hover:bg-white/20 backdrop-blur-md font-black uppercase tracking-widest px-6 h-12 border border-white/20">
                                <Eye className="w-5 h-5 mr-2" /> Comparar
                              </Button>
                            </div>
                            <div className="flex gap-3">
                              <Button onClick={() => fileInputRef.current?.click()} className="bg-white/10 text-white hover:bg-white/20 border border-white/20 font-black uppercase tracking-widest px-6 h-12 backdrop-blur-md">
                                <ImageIcon className="w-5 h-5 mr-2" /> Galería
                              </Button>
                              <Button onClick={() => cameraInputRef.current?.click()} className="bg-brand-violet text-black hover:bg-white font-black uppercase tracking-widest px-6 h-12 shadow-2xl">
                                <Camera className="w-5 h-5 mr-2" /> Cámara
                              </Button>
                            </div>
                          </div>
                        </>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div key="preview" className="w-full h-full relative group">
                      <img src={image!} className="w-full h-full object-contain p-4 md:p-8 opacity-50 grayscale" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-black/40 backdrop-blur-sm px-4 py-2 rounded-full border border-white/10">
                          <p className="text-xs text-white/60 font-medium">Vista previa original</p>
                        </div>
                      </div>
                      <div className="absolute inset-0 bg-black/40 md:bg-black/0 md:hover:bg-black/40 transition-all flex items-center justify-center opacity-100 md:opacity-0 md:hover:opacity-100">
                        <div className="flex gap-3">
                          <Button onClick={() => fileInputRef.current?.click()} className="bg-white/10 text-white hover:bg-white/20 border border-white/20 font-black uppercase tracking-widest px-6 h-12 backdrop-blur-md">
                            <ImageIcon className="w-5 h-5 mr-2" /> Galería
                          </Button>
                          <Button onClick={() => cameraInputRef.current?.click()} className="bg-brand-violet text-black hover:bg-white font-black uppercase tracking-widest px-6 h-12 shadow-2xl">
                            <Camera className="w-5 h-5 mr-2" /> Cámara
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>

              {result && !isBatchMode && (
                <div className="flex flex-col gap-4">
                  <div className="flex gap-4">
                    <Button onClick={downloadResult} className="btn-premium flex-1 h-16 bg-white text-black hover:bg-brand-gold hover:text-black">
                      <Download className="w-6 h-6 mr-3" /> Descargar HD
                    </Button>
                    <Button onClick={() => handleSaveToDrive(result)} disabled={isSavingToDrive}
                      className={cn("btn-premium flex-1 h-16 border border-white/10", isGoogleAuth ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-white/5 hover:bg-white/10 text-white/60")}>
                      {isSavingToDrive ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Cloud className="w-6 h-6 mr-3" />}
                      {isGoogleAuth ? "Guardar en Drive" : "Conectar Drive"}
                    </Button>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="ghost" onClick={() => setShowComparison(v => !v)}
                      className={cn("flex-1 h-10 text-[10px] font-black uppercase tracking-[0.25em] border transition-all",
                        showComparison ? "border-brand-violet/50 text-brand-violet bg-brand-violet/10" : "border-white/5 text-white/40 hover:text-white hover:bg-white/5")}>
                      <Eye className="w-4 h-4 mr-2" /> {showComparison ? "Ocultar comparación" : "Comparar antes/después"}
                    </Button>
                    <Button variant="ghost" onClick={() => { setResult(null); setShowComparison(false); }}
                      className="h-10 px-4 text-[10px] font-black uppercase tracking-[0.25em] text-white/30 hover:text-white hover:bg-white/5 border border-white/5">
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Controls panel ── */}
          <div className={cn("lg:order-1 space-y-6 flex flex-col transition-all duration-500", isBatchMode ? "lg:col-span-9" : "lg:col-span-4")}>
            <Card className="glass-card p-5 md:p-6 shadow-xl flex-1 flex flex-col">

              {/* Mode toggle */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 shrink-0">
                <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-violet">Configuración</h3>
                <div className="flex bg-black/60 p-1 rounded-2xl border border-white/10 gap-1 w-fit shrink-0">
                  {["Individual", "Lote"].map((mode, i) => (
                    <Button key={mode} variant={(!isBatchMode && i === 0) || (isBatchMode && i === 1) ? "secondary" : "ghost"} size="sm"
                      onClick={() => setIsBatchMode(i === 1)}
                      className={cn("h-8 text-[10px] px-3 sm:px-4 font-black uppercase tracking-widest transition-all",
                        ((!isBatchMode && i === 0) || (isBatchMode && i === 1)) ? "bg-white text-black" : "text-white/60 hover:text-white")}>
                      {mode}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Style selector */}
              <div className="space-y-4 mb-6 shrink-0">
                <label className="text-[10px] font-black text-brand-violet uppercase tracking-[0.3em] block">Tipo de Imagen</label>
                <div className="grid grid-cols-2 gap-2">
                  {STYLES.map(s => (
                    <Button key={s.id} onClick={() => setSelectedStyle(s.id)}
                      className={cn("h-auto min-h-[52px] py-2 px-3 text-left flex flex-col items-start transition-all duration-300 border active:scale-95",
                        selectedStyle === s.id ? "bg-white text-black border-white shadow-[0_0_25px_rgba(255,255,255,0.3)]" : "bg-transparent text-white/60 border-brand-violet/20 hover:bg-brand-violet/10")}>
                      <span className="text-[10px] font-black uppercase tracking-widest leading-tight">{s.label}</span>
                      <span className={cn("text-[8px] mt-0.5 font-medium leading-tight", selectedStyle === s.id ? "text-black/50" : "text-white/30")}>{s.desc}</span>
                    </Button>
                  ))}
                </div>
              </div>

              {/* Aspect ratio */}
              {selectedStyle !== "Video360" && (
                <div className="space-y-3 mb-4 shrink-0">
                  <label className="text-[10px] font-black text-brand-violet uppercase tracking-[0.3em] block">Relación de Aspecto</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["1:1", "9:16", "16:9"] as const).map(r => (
                      <Button key={r} onClick={() => setImageAspectRatio(r)}
                        className={cn("h-9 text-[10px] font-black uppercase tracking-widest border active:scale-95",
                          imageAspectRatio === r ? "bg-white text-black border-white" : "bg-transparent text-white/60 border-brand-violet/20 hover:bg-brand-violet/10")}>
                        {r}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Output format */}
              {selectedStyle !== "Video360" && (
                <div className="space-y-3 mb-6 shrink-0">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-brand-violet uppercase tracking-[0.3em]">Formato de Salida</label>
                    <span className="text-[9px] text-white/20 uppercase tracking-wider">
                      {outputFormat === "png"  && "Sin pérdida · más pesado"}
                      {outputFormat === "webp" && "35% más liviano · recomendado"}
                      {outputFormat === "jpeg" && "Alta compatibilidad · fotos"}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { id: "png",  label: "PNG",  hint: "Nítido" },
                      { id: "webp", label: "WebP", hint: "Óptimo" },
                      { id: "jpeg", label: "JPEG", hint: "Compat." },
                    ] as { id: OutputFormat; label: string; hint: string }[]).map(f => (
                      <Button key={f.id} onClick={() => setOutputFormat(f.id)}
                        className={cn("h-auto py-1.5 flex flex-col items-center border active:scale-95 transition-all",
                          outputFormat === f.id ? "bg-white text-black border-white" : "bg-transparent text-white/60 border-brand-violet/20 hover:bg-brand-violet/10")}>
                        <span className="text-[10px] font-black uppercase tracking-widest">{f.label}</span>
                        <span className={cn("text-[8px] font-medium", outputFormat === f.id ? "text-black/40" : "text-white/25")}>{f.hint}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">

                {/* Single mode inputs */}
                {!isBatchMode && selectedStyle !== "Video360" && (
                  <div className="pt-4 border-t border-white/5">{renderSingleInputs()}</div>
                )}

                {/* Video 360 panel */}
                {!isBatchMode && selectedStyle === "Video360" && (
                  <div className="space-y-6 pt-6 border-t border-white/10">
                    <div className="flex justify-between items-center">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-violet">Ángulos del Producto</h3>
                      {Object.values(video360Angles).some(Boolean) && (
                        <Button variant="ghost" size="sm" onClick={() => { setVideo360Angles({ frente: null, dorso: null, lateral1: null, lateral2: null }); setVideo360Result(null); }}
                          className="text-[9px] uppercase font-bold text-red-400/60 hover:text-red-400 h-7">
                          <Trash2 className="w-3 h-3 mr-1" /> Reiniciar
                        </Button>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-bold text-white/40 tracking-widest">Descripción del Producto (Opcional)</Label>
                      <Input placeholder="Ej: Mochila azul con diseño de astronauta..." value={productDescription}
                        onChange={e => setProductDescription(e.target.value)} className="bg-black/40 border-white/5 text-sm" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {(["frente", "dorso", "lateral1", "lateral2"] as const).map(angle => (
                        <div key={angle} className="space-y-2">
                          <Label className="text-[9px] uppercase font-bold text-white/30 tracking-widest">{angle}</Label>
                          <div className={cn("aspect-square rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center overflow-hidden",
                            video360Angles[angle] ? "border-brand-violet/50 bg-brand-violet/5" : "border-white/10 bg-white/5")}>
                            {video360Angles[angle]
                              ? <img src={video360Angles[angle]!.preview} className="w-full h-full object-cover" />
                              : <><ImageIcon className="w-5 h-5 text-white/20 mb-1" /><span className="text-[8px] text-white/20 uppercase">Vacío</span></>
                            }
                          </div>
                          <div className="flex gap-1">
                            {[false, true].map(cam => {
                              const handleUpload = () => {
                                const inp = document.createElement("input");
                                inp.type = "file"; inp.accept = "image/*";
                                if (cam) inp.capture = "environment";
                                inp.onchange = async (e) => {
                                  const file = (e.target as HTMLInputElement).files?.[0];
                                  if (!file) return;
                                  try {
                                    const b64 = await compressImage(file);
                                    setVideo360Angles(prev => ({ ...prev, [angle]: { id: Math.random().toString(36).substr(2, 9), file, preview: b64, status: "pending" } }));
                                  } catch {
                                    const reader = new FileReader();
                                    reader.onload = ev => setVideo360Angles(prev => ({ ...prev, [angle]: { id: Math.random().toString(36).substr(2, 9), file, preview: ev.target?.result as string, status: "pending" } }));
                                    reader.readAsDataURL(file);
                                  }
                                };
                                inp.click();
                              };
                              return (
                                <Button key={String(cam)} size="sm" variant="outline" className="flex-1 h-7 text-[9px] px-0 border-white/10 hover:bg-white/10" onClick={handleUpload}>
                                  {cam ? <><Camera className="w-3 h-3 mr-1" />Cámara</> : <><ImageIcon className="w-3 h-3 mr-1" />Galería</>}
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    <Button className="btn-premium w-full h-16 bg-brand-violet text-black hover:bg-white"
                      disabled={isProcessing || !Object.values(video360Angles).some(Boolean)} onClick={handleGenerateVideo360}>
                      {isProcessing ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Procesando ({Math.round(batchProgress)}%)</> : <><Sparkles className="w-4 h-4 mr-2" />{video360Result ? "Regenerar" : "Generar"} Video 360°</>}
                    </Button>
                    {video360Result && !isProcessing && (
                      <Button variant="outline" className="w-full h-12 border-brand-violet/20 text-brand-violet hover:bg-brand-violet/10 font-black uppercase tracking-widest"
                        onClick={() => downloadUrl(video360Result!, `360-view-${Date.now()}.mp4`)}>
                        <Download className="w-4 h-4 mr-2" /> Descargar Video
                      </Button>
                    )}
                  </div>
                )}

                {/* Batch panel */}
                {isBatchMode && (
                  <div className="space-y-6 pt-6 border-t border-white/10">
                    <div className="flex justify-between items-center">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-violet">Imágenes en Lote</h3>
                      {batchItems.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setBatchItems([])}
                          className="text-[9px] uppercase font-bold text-red-400/60 hover:text-red-400 h-7">
                          <Trash2 className="w-3 h-3 mr-1" /> Reiniciar Lote
                        </Button>
                      )}
                    </div>
                    <div
                      className={cn("border-2 border-dashed rounded-2xl p-6 text-center bg-brand-violet/5 flex flex-col items-center gap-4 transition-colors",
                        batchDropActive ? "border-brand-violet bg-brand-violet/20" : "border-brand-violet/30")}
                      onDragOver={e => { e.preventDefault(); setBatchDropActive(true); }}
                      onDragLeave={() => setBatchDropActive(false)}
                      onDrop={handleBatchDrop}>
                      <p className="text-sm font-bold text-white uppercase tracking-widest">
                        {batchDropActive ? "Soltar imágenes aquí" : "Añadir Imágenes"}
                      </p>
                      <div className="flex gap-3 w-full">
                        <Button variant="outline" onClick={() => batchInputRef.current?.click()}
                          className="flex-1 bg-white/5 hover:bg-white/10 border-white/10 h-10 text-[10px] uppercase">
                          <ImageIcon className="w-4 h-4 mr-2" /> Galería
                        </Button>
                        <Button onClick={() => batchCameraInputRef.current?.click()}
                          className="flex-1 bg-brand-violet hover:bg-white text-black h-10 text-[10px] uppercase">
                          <Camera className="w-4 h-4 mr-2" /> Cámara
                        </Button>
                      </div>
                      {batchItems.length === 0 && (
                        <div className="flex gap-2 w-full">
                          <Button variant="outline" onClick={downloadCsvTemplate}
                            className="flex-1 bg-white/5 hover:bg-white/10 border-white/10 h-9 text-[10px] uppercase">
                            <Download className="w-3 h-3 mr-1.5" /> Modelo CSV
                          </Button>
                          <Button variant="outline" onClick={() => csvInputRef.current?.click()}
                            className="flex-1 bg-white/5 hover:bg-white/10 border-white/10 h-9 text-[10px] uppercase">
                            <Upload className="w-3 h-3 mr-1.5" /> Importar CSV
                          </Button>
                        </div>
                      )}
                    </div>

                    {batchItems.length > 0 && (
                      <>
                        <ScrollArea className="h-[380px] md:h-[450px] pr-4">
                          <div className="space-y-3">
                            {batchItems.map((item, itemIdx) => (
                              <div key={item.id}
                                draggable
                                onDragStart={() => { dragIndex.current = itemIdx; }}
                                onDragOver={e => { e.preventDefault(); setDragOverId(item.id); }}
                                onDrop={() => { if (dragIndex.current !== null) reorderBatch(dragIndex.current, itemIdx); dragIndex.current = null; setDragOverId(null); }}
                                onDragEnd={() => { dragIndex.current = null; setDragOverId(null); }}
                                className={cn("flex flex-col p-4 bg-black/40 rounded-2xl border transition-all",
                                  item.status === "completed" ? "border-green-500/40" : item.status === "error" ? "border-red-500/40" : "border-white/10",
                                  dragOverId === item.id && "border-brand-violet/50 bg-brand-violet/5")}>
                                <div className="flex items-center gap-3">
                                  <GripVertical className="w-4 h-4 text-white/20 shrink-0 cursor-grab active:cursor-grabbing" />
                                  <div className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-white/20 cursor-pointer"
                                    onClick={() => item.status === "completed" && item.result && setSelectedHistoryItem({ id: item.id, original: item.preview, result: item.result, style: selectedStyle, timestamp: Date.now(), fileName: item.file.name })}>
                                    <img src={item.status === "completed" && item.result ? item.result : item.preview} className="w-full h-full object-cover" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold truncate text-white">{item.file.name}</p>
                                    <p className={cn("text-[10px] uppercase font-black tracking-[0.2em] mt-0.5",
                                      item.status === "completed" ? "text-green-400" : item.status === "processing" ? "text-brand-gold animate-pulse" : item.status === "error" ? "text-red-400" : "text-white/40")}>
                                      {item.status === "completed" ? "Listo" : item.status === "processing" ? "Procesando" : item.status === "error" ? "Error" : "En espera"}
                                    </p>
                                  </div>
                                  <div className="flex gap-1">
                                    {item.status === "completed" && (
                                      <Button variant="outline" size="icon" className="h-8 w-8 border-white/10 text-white/60 hover:text-white"
                                        onClick={e => { e.stopPropagation(); downloadBatchItem(item); }}>
                                        <Download className="w-4 h-4" />
                                      </Button>
                                    )}
                                    <Button variant="outline" size="icon" className="h-8 w-8 border-white/10 text-white/30 hover:text-red-400"
                                      onClick={e => { e.stopPropagation(); setBatchItems(prev => prev.filter(i => i.id !== item.id)); }}>
                                      <X className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                                <div className="mt-3">{renderBatchItemInputs(item)}</div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>

                        <div className="space-y-3">
                          {batchItems.some(i => i.status === "completed") && (
                            <Button variant="outline" onClick={downloadAllBatch}
                              className="w-full h-12 text-[11px] border-brand-violet/20 hover:bg-brand-violet/10 font-black uppercase tracking-[0.2em] text-brand-violet">
                              <Download className="w-4 h-4 mr-3" /> Descargar Lote
                            </Button>
                          )}
                          {isProcessing && (
                            <div className="space-y-2">
                              <Progress value={batchProgress} className="h-1.5 bg-brand-violet/10" />
                              <div className="flex justify-between items-center">
                                <span className="text-[9px] text-white/30 uppercase tracking-wider font-bold">
                                  {batchTimeInfo ? `Transcurrido: ${formatTime(batchTimeInfo.elapsed)}` : "Iniciando..."}
                                </span>
                                <span className="text-[9px] uppercase tracking-wider font-bold">
                                  {batchTimeInfo?.eta != null
                                    ? <span className="text-brand-violet/70">~{formatTime(batchTimeInfo.eta)} restantes</span>
                                    : <span className="text-white/20">Calculando...</span>
                                  }
                                </span>
                              </div>
                            </div>
                          )}
                          {!isGoogleAuth && (
                            <Button variant="outline" onClick={handleConnectDrive}
                              className="w-full h-12 text-[11px] border-blue-500/30 text-blue-400 hover:bg-blue-500/10 uppercase font-black tracking-[0.2em]">
                              <Cloud className="w-4 h-4 mr-3" /> Auto-guardado Drive
                            </Button>
                          )}
                          <Button onClick={runBatch} disabled={isProcessing || batchItems.every(i => i.status === "completed") || !isFormValid()}
                            className="btn-premium w-full h-16 bg-brand-violet text-black hover:bg-white">
                            {isProcessing ? "Procesando..." : !isFormValid() ? "Completa los campos" : "Iniciar Lote"}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Single generate button */}
                {!isBatchMode && selectedStyle !== "Video360" && (
                  <div className="pt-6">
                    <Button onClick={handleTransform} disabled={!image || isProcessing || !isFormValid()}
                      className="btn-premium w-full h-16 bg-brand-violet text-black hover:bg-white shadow-[0_20px_40px_-15px_rgba(196,181,253,0.3)]">
                      {isProcessing ? <RefreshCw className="w-6 h-6 animate-spin" /> : !isFormValid() ? "Completa los campos" : "Crear Imagen"}
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* ── History panel ── */}
          {!isEmbed && (
            <div className="lg:col-span-3 lg:order-3 space-y-6 flex flex-col">
              <Card className="glass-card flex flex-col flex-1 min-h-[500px] lg:min-h-0 shadow-xl">
                <div className="p-5 border-b border-brand-violet/10 flex items-center justify-between bg-black/20">
                  <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-brand-violet flex items-center">
                    <History className="w-4 h-4 mr-3" /> Historial
                  </h3>
                  {history.length > 0 && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-white/10 hover:text-red-400" onClick={() => setHistory([])}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
                <ScrollArea className="flex-1 p-4">
                  <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
                    {history.map(item => (
                      <div key={item.id} className="group relative aspect-square lg:aspect-video rounded-xl overflow-hidden border border-white/5 cursor-pointer hover:border-brand-gold/50 transition-all shadow-lg"
                        onClick={() => setSelectedHistoryItem(item)}>
                        <img src={item.result} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-all">
                          <ImageIcon className="w-5 h-5 text-white mb-1" />
                          <span className="text-[9px] uppercase font-bold text-white/60">Ver</span>
                        </div>
                      </div>
                    ))}
                    {!history.length && (
                      <div className="col-span-2 lg:col-span-1 flex flex-col items-center justify-center py-24 text-white/10">
                        <History className="w-8 h-8 opacity-20 mb-3" />
                        <p className="text-[10px] uppercase font-black tracking-[0.3em]">Sin Historial</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </Card>
            </div>
          )}
        </div>

        {/* ── Preview modal ── */}
        <AnimatePresence>
          {isPreviewOpen && (result || video360Result) && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-10 bg-black/95 backdrop-blur-xl"
              onClick={() => setIsPreviewOpen(false)}>
              <Button variant="secondary" size="icon" className="absolute top-6 right-6 rounded-full bg-white/10 hover:bg-white/20 text-white h-12 w-12"
                onClick={() => setIsPreviewOpen(false)}><X className="w-6 h-6" /></Button>
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                className="relative max-w-5xl w-full h-full flex items-center justify-center" onClick={e => e.stopPropagation()}>
                {selectedStyle === "Video360" && video360Result
                  ? <video src={video360Result} className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" autoPlay loop muted playsInline />
                  : <img src={result!} className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" referrerPolicy="no-referrer" />
                }
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── History modal ── */}
        <AnimatePresence>
          {selectedHistoryItem && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-10 bg-black/95 backdrop-blur-xl"
              onClick={() => setSelectedHistoryItem(null)}>
              {history.length > 1 && (
                <>
                  <Button variant="ghost" size="icon" className="absolute left-4 top-1/2 -translate-y-1/2 z-20 hidden md:flex h-16 w-16 rounded-full text-white/20 hover:text-white"
                    onClick={e => { e.stopPropagation(); const idx = history.findIndex(i => i.id === selectedHistoryItem.id); setSelectedHistoryItem(history[(idx + 1) % history.length]); }}>
                    <ChevronLeft className="w-10 h-10" />
                  </Button>
                  <Button variant="ghost" size="icon" className="absolute right-4 top-1/2 -translate-y-1/2 z-20 hidden md:flex h-16 w-16 rounded-full text-white/20 hover:text-white"
                    onClick={e => { e.stopPropagation(); const idx = history.findIndex(i => i.id === selectedHistoryItem.id); setSelectedHistoryItem(history[(idx - 1 + history.length) % history.length]); }}>
                    <ChevronRight className="w-10 h-10" />
                  </Button>
                </>
              )}
              <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative max-w-5xl w-full bg-zinc-900/50 rounded-3xl overflow-hidden border border-white/10 shadow-2xl flex flex-col"
                onClick={e => e.stopPropagation()}>
                <div className="absolute top-6 right-6 z-10 flex gap-3">
                  <Button variant="secondary" size="icon" className="rounded-full bg-white/10 hover:bg-white/20 text-white"
                    onClick={() => downloadUrl(selectedHistoryItem.result, getFormattedFileName(selectedHistoryItem.fileName || "result", selectedHistoryItem.style))}>
                    <Download className="w-5 h-5" />
                  </Button>
                  <Button variant="secondary" size="icon" className="rounded-full bg-white/10 hover:bg-white/20 text-white" onClick={() => setSelectedHistoryItem(null)}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>
                <div className="flex-1 overflow-hidden flex items-center justify-center p-6 md:p-12">
                  <img src={selectedHistoryItem.result} className="max-w-full max-h-[70vh] object-contain rounded-xl shadow-2xl" referrerPolicy="no-referrer" />
                </div>
                <div className="p-4 md:p-8 bg-black/40 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl overflow-hidden border border-white/10 shrink-0">
                      <img src={selectedHistoryItem.original} className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <h4 className="text-white font-bold text-lg">{selectedHistoryItem.fileName}</h4>
                      <p className="text-white/40 text-xs uppercase tracking-widest mt-1">
                        {new Date(selectedHistoryItem.timestamp).toLocaleString()} • {selectedHistoryItem.style}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-4 w-full md:w-auto">
                    <Button variant="outline" className="flex-1 md:flex-none border-white/10 text-white/60 hover:text-white h-12 px-8 rounded-2xl"
                      onClick={() => { setImage(selectedHistoryItem.original); setResult(selectedHistoryItem.result); setOriginalFileName(selectedHistoryItem.fileName); setIsBatchMode(false); setSelectedHistoryItem(null); }}>
                      Editar Ajustes
                    </Button>
                    <Button className="flex-1 md:flex-none bg-brand-violet text-black hover:bg-white h-12 px-10 rounded-2xl font-bold"
                      onClick={() => downloadUrl(selectedHistoryItem.result, getFormattedFileName(selectedHistoryItem.fileName || "result", selectedHistoryItem.style))}>
                      Descargar HD
                    </Button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {!isEmbed && (
          <footer className="w-full mt-12 pt-8 border-t border-white/5 text-center text-white/20 text-[10px] uppercase tracking-widest">
            <p>© 2026 ProEcom AI • Fondo Blanco Puro • Portada ML • Google Drive Ready</p>
          </footer>
        )}
      </div>
    </TooltipProvider>
  );
}
