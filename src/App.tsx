import React, { useState, useRef, useCallback, useEffect, ChangeEvent, DragEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Upload, 
  Sparkles, 
  Image as ImageIcon, 
  CheckCircle2, 
  Download, 
  RefreshCw, 
  Camera,
  ArrowRight,
  ShoppingBag,
  Box,
  Layers,
  Cloud,
  Trash2,
  History,
  Plus,
  X,
  Check,
  Eye,
  Maximize,
  ChevronLeft,
  ChevronRight,
  Video
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { transformImage, analyzeProduct, generateVideo360 } from "@/src/services/gemini";
import { GoogleGenAI } from "@google/genai";
import { cn } from "@/lib/utils";
import * as gifshot from 'gifshot';

const compressImage = (file: File, maxWidth = 1500): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else if (height > maxWidth) {
          width = Math.round((width * maxWidth) / height);
          height = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error("No 2d context available");
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      } catch (e) {
        reject(e);
      }
    };
    
    img.onerror = (error) => {
      URL.revokeObjectURL(objectUrl);
      reject(error);
    };
    
    img.src = objectUrl;
  });
};

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Style = "Ecom" | "Lifestyle" | "Technical" | "Infographic" | "Video360";

interface HistoryItem {
  id: string;
  original: string;
  result: string;
  style: Style;
  timestamp: number;
  fileName: string;
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
  lifestylePrompt?: string;
  productDescription?: string;
}

export default function App() {
  // Single processing states
  const [image, setImage] = useState<string | null>(null);
  const [originalFileName, setOriginalFileName] = useState<string>("");
  const [mimeType, setMimeType] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSavingToDrive, setIsSavingToDrive] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<Style>("Ecom");
  
  // Extra data for technical and infographic
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [depth, setDepth] = useState("");
  const [infoTitle, setInfoTitle] = useState("");
  const [infoFeatures, setInfoFeatures] = useState("");
  const [lifestylePrompt, setLifestylePrompt] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [video360Items, setVideo360Items] = useState<BatchItem[]>([]);
  const [video360Result, setVideo360Result] = useState<string | null>(null);
  const [video360Angles, setVideo360Angles] = useState<{
    frente: BatchItem | null;
    dorso: BatchItem | null;
    lateral1: BatchItem | null;
    lateral2: BatchItem | null;
  }>({
    frente: null,
    dorso: null,
    lateral1: null,
    lateral2: null,
  });
  
  // Batch processing states
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  
  // History
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const isEmbed = new URLSearchParams(window.location.search).get('embed') === 'true';
  
  const [isGoogleAuth, setIsGoogleAuth] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [userApiKey, setUserApiKey] = useState(() => localStorage.getItem('gemini_api_key') || "");
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const batchInputRef = useRef<HTMLInputElement>(null);
  const batchCameraInputRef = useRef<HTMLInputElement>(null);
  const video360InputRef = useRef<HTMLInputElement>(null);

  const checkAuthStatus = async () => {
    try {
      const res = await fetch("/api/auth/status");
      const data = await res.json();
      setIsGoogleAuth(data.isAuthenticated);
    } catch (error) {
      console.error("Error checking auth status:", error);
    }
  };

  useEffect(() => {
    checkAuthStatus();
    
    const checkApiKey = async () => {
      // @ts-ignore
      if (window.aistudio?.hasSelectedApiKey) {
        // @ts-ignore
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      } else {
        setHasApiKey(!!localStorage.getItem('gemini_api_key'));
      }
    };
    checkApiKey();
    
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsGoogleAuth(true);
        toast.success("Conectado a Google Drive");
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    if (!isBatchMode) {
      setResult(null);
    }
  }, [selectedStyle, isBatchMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedHistoryItem) return;

      const currentIndex = history.findIndex(item => item.id === selectedHistoryItem.id);
      if (currentIndex === -1) return;

      if (e.key === "ArrowLeft") {
        const prevIndex = (currentIndex + 1) % history.length;
        setSelectedHistoryItem(history[prevIndex]);
      } else if (e.key === "ArrowRight") {
        const nextIndex = (currentIndex - 1 + history.length) % history.length;
        setSelectedHistoryItem(history[nextIndex]);
      } else if (e.key === "Escape") {
        setSelectedHistoryItem(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedHistoryItem, history]);

  const handleConnectDrive = async () => {
    // Open popup immediately to avoid browser blocking
    const popup = window.open('', 'oauth_popup', 'width=600,height=700');
    
    if (!popup) {
      toast.error("El navegador bloqueó la ventana emergente. Por favor, permite los popups para este sitio.");
      return;
    }

    try {
      const res = await fetch("/api/auth/google/url");
      if (!res.ok) throw new Error("Failed to get auth URL");
      const { url } = await res.json();
      
      if (!url) {
        popup.close();
        toast.error("Error: No se pudo generar la URL de autenticación. Verifica las credenciales en el servidor.");
        return;
      }
      
      popup.location.href = url;
    } catch (error) {
      popup.close();
      toast.error("Error al conectar con Google. Asegúrate de que las credenciales estén configuradas.");
    }
  };

  const handleSaveToDrive = async (imgUrl: string, customFileName?: string) => {
    if (!imgUrl) return;
    if (!isGoogleAuth) {
      handleConnectDrive();
      return;
    }

    setIsSavingToDrive(true);
    try {
      const nameToUse = customFileName || originalFileName || `pro-ecom-${Date.now()}.png`;
      const finalName = nameToUse.includes('.') ? nameToUse : `${nameToUse}.png`;

      const res = await fetch("/api/drive/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64Image: imgUrl,
          fileName: finalName
        })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Imagen guardada en Drive: ${finalName}`);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      toast.error("Error al guardar en Drive");
      setIsGoogleAuth(false);
    } finally {
      setIsSavingToDrive(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = async (file: File) => {
    if (file.type && !file.type.startsWith("image/")) {
      toast.error("Por favor, sube una imagen válida.");
      return;
    }

    setMimeType(file.type || "image/jpeg");
    setOriginalFileName(file.name || "image.jpg");
    
    try {
      const compressedBase64 = await compressImage(file);
      setImage(compressedBase64);
      setMimeType("image/jpeg"); // compressImage always returns jpeg
      setResult(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    } catch (error) {
      console.error("Error compressing image, falling back to original", error);
      // Fallback to original file if compression fails
      const reader = new FileReader();
      reader.onload = (e) => {
        setImage(e.target?.result as string);
        setMimeType(file.type || "image/jpeg");
        setResult(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleBatchFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    const newItems: BatchItem[] = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      preview: URL.createObjectURL(file),
      status: "pending",
      width: "",
      height: "",
      depth: "",
      infoTitle: "",
      infoFeatures: "",
      lifestylePrompt: "",
      productDescription: ""
    }));
    setBatchItems(prev => [...prev, ...newItems]);
    setIsBatchMode(true);
    // Reset input value to allow selecting the same files again
    if (batchInputRef.current) batchInputRef.current.value = "";
    if (batchCameraInputRef.current) batchCameraInputRef.current.value = "";
  };

  const handleVideo360Files = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    const newItems: BatchItem[] = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      preview: URL.createObjectURL(file),
      status: "pending",
      width: "",
      height: "",
      depth: "",
      infoTitle: "",
      infoFeatures: "",
      lifestylePrompt: "",
      productDescription: ""
    }));
    setVideo360Items(prev => [...prev, ...newItems]);
    // Reset input value
    if (video360InputRef.current) video360InputRef.current.value = "";
  };

  const ensureApiKey = async (): Promise<boolean> => {
    // @ts-ignore
    if (window.aistudio?.hasSelectedApiKey) {
      // @ts-ignore
      const selected = await window.aistudio.hasSelectedApiKey();
      if (!selected) {
        // @ts-ignore
        await window.aistudio.openSelectKey();
        setHasApiKey(true);
        return false;
      }
      return true;
    } else {
      if (!userApiKey) {
        setShowApiKeyModal(true);
        return false;
      }
      return true;
    }
  };

  const handleGenerateVideo360 = async () => {
    const angles = Object.values(video360Angles).filter(Boolean) as BatchItem[];
    if (angles.length === 0) {
      toast.error("Por favor, sube al menos una imagen.");
      return;
    }
    
    if (!(await ensureApiKey())) return;

    setIsProcessing(true);
    setBatchProgress(0);
    setVideo360Result(null);
    
    try {
      // Orden lógico: Frente (0°), Lateral 1 (90°), Dorso (180°), Lateral 2 (270°)
      const orderedAngles = [
        video360Angles.frente,
        video360Angles.lateral1,
        video360Angles.dorso,
        video360Angles.lateral2
      ].filter(Boolean) as BatchItem[];

      // PASO 1: Estandarización de Imágenes (Módulo Image-to-Image)
      const processedImages: { base64: string, mimeType: string }[] = [];
      const totalSteps = orderedAngles.length + 2; // +1 analysis +1 video
      let currentStep = 0;

      for (const item of orderedAngles) {
        // Use the already compressed preview base64
        const base64 = item.preview.split(",")[1];

        // Transformar imagen de celular en profesional (Prompt 1)
        const resUrl = await transformImage(base64, "image/jpeg", "Ecom", "", {
          productDescription: productDescription
        }, userApiKey);
        
        // Convertir el resultado (data URL) de vuelta a base64 para Veo
        const processedBase64 = resUrl.split(",")[1];
        processedImages.push({ base64: processedBase64, mimeType: "image/png" });
        
        currentStep++;
        setBatchProgress((currentStep / totalSteps) * 100);
      }

      // PASO 2: Generación de Video 360º (Módulo Multi-Image-to-Video)
      
      // 2.1 Analizar producto para descripción técnica detallada
      const description = await analyzeProduct(processedImages, productDescription, userApiKey);
      console.log("Product Description for Veo:", description);
      currentStep++;
      setBatchProgress((currentStep / totalSteps) * 100);

      // 2.2 Generar Video con Veo (Prompt 2)
      const videoUri = await generateVideo360(
        userApiKey,
        description,
        processedImages
      );

      // 3. Descargar video
      const response = await fetch(videoUri, {
        method: 'GET',
        headers: {
          'x-goog-api-key': process.env.API_KEY || "",
        },
      });

      if (!response.ok) throw new Error("Error al descargar el video generado.");
      
      const blob = await response.blob();
      const videoUrl = URL.createObjectURL(blob);
      
      setVideo360Result(videoUrl);
      toast.success("¡Video 360° generado con éxito!");
      setIsProcessing(false);
      setBatchProgress(100);

    } catch (error) {
      console.error(error);
      toast.error("Error al generar el video 360°. Verifica tu conexión y clave de API.");
      setIsProcessing(false);
    }
  };

  const handleTransform = async () => {
    if (!image) return;
    
    if (!(await ensureApiKey())) return;

    setIsProcessing(true);
    const base64Data = image.split(",")[1];

    try {
      const transformedUrl = await transformImage(base64Data, mimeType, selectedStyle, "", {
        width: width,
        height: height,
        depth: depth,
        title: infoTitle,
        features: infoFeatures,
        lifestylePrompt: lifestylePrompt,
        productDescription: productDescription
      }, userApiKey);
      setResult(transformedUrl);
      
      // Add to history
      const newItem: HistoryItem = {
        id: Math.random().toString(36).substr(2, 9),
        original: image,
        result: transformedUrl,
        style: selectedStyle,
        timestamp: Date.now(),
        fileName: originalFileName
      };
      setHistory(prev => [newItem, ...prev]);
      toast.success("¡Transformación completada!");
    } catch (error) {
      toast.error("Error al procesar la imagen.");
    } finally {
      setIsProcessing(false);
    }
  };

  const isFormValid = () => {
    if (selectedStyle === "Video360") {
      return video360Items.length >= 2;
    }
    if (isBatchMode) {
      if (batchItems.length === 0) return false;
      return batchItems.every(item => {
        if (selectedStyle === "Technical") {
          return (item.width?.trim() || "") !== "" && (item.height?.trim() || "") !== "" && (item.depth?.trim() || "") !== "";
        }
        if (selectedStyle === "Infographic") {
          return (item.infoTitle?.trim() || "") !== "" && (item.infoFeatures?.trim() || "") !== "";
        }
        return true;
      });
    }

    if (selectedStyle === "Technical") {
      return width.trim() !== "" && height.trim() !== "" && depth.trim() !== "";
    }
    if (selectedStyle === "Infographic") {
      return infoTitle.trim() !== "" && infoFeatures.trim() !== "";
    }
    return true;
  };

  const runBatch = async () => {
    if (batchItems.length === 0 || !isFormValid()) return;

    if (!(await ensureApiKey())) return;

    setIsProcessing(true);
    let completed = 0;

    for (let i = 0; i < batchItems.length; i++) {
      if (batchItems[i].status === "completed") continue;
      
      setBatchItems(prev => prev.map((item, idx) => 
        idx === i ? { ...item, status: "processing" } : item
      ));

      try {
        const file = batchItems[i].file;
        const compressedBase64 = await compressImage(file);
        const base64Data = compressedBase64.split(",")[1];
        
        const item = batchItems[i];
        const transformedUrl = await transformImage(base64Data, "image/jpeg", selectedStyle, "", {
          width: item.width || width,
          height: item.height || height,
          depth: item.depth || depth,
          title: item.infoTitle || infoTitle,
          features: item.infoFeatures || infoFeatures,
          lifestylePrompt: item.lifestylePrompt || lifestylePrompt,
          productDescription: item.productDescription || productDescription
        }, userApiKey);
        
        setBatchItems(prev => prev.map((item, idx) => 
          idx === i ? { ...item, status: "completed", result: transformedUrl } : item
        ));
        
        // Add to history
        const historyItem: HistoryItem = {
          id: Math.random().toString(36).substr(2, 9),
          original: compressedBase64,
          result: transformedUrl,
          style: selectedStyle,
          timestamp: Date.now(),
          fileName: file.name
        };
        setHistory(prev => [historyItem, ...prev]);
        
        // Auto-save to drive if authenticated
        if (isGoogleAuth) {
          await handleSaveToDrive(transformedUrl, file.name);
        }
      } catch (error) {
        setBatchItems(prev => prev.map((item, idx) => 
          idx === i ? { ...item, status: "error" } : item
        ));
      }
      
      completed++;
      setBatchProgress((completed / batchItems.length) * 100);
    }
    setIsProcessing(false);
    toast.success("Procesamiento por lotes finalizado");
  };

  const getFormattedFileName = (originalName: string, style: Style) => {
    const dotIndex = originalName.lastIndexOf('.');
    const name = dotIndex !== -1 ? originalName.substring(0, dotIndex) : originalName;
    const extension = dotIndex !== -1 ? originalName.substring(dotIndex) : '.png';
    
    switch (style) {
      case "Ecom":
        return `${name}${extension}`;
      case "Lifestyle":
        return `${name} lifestyle${extension}`;
      case "Technical":
        return `${name} medidas${extension}`;
      case "Infographic":
        return `${name} infografia${extension}`;
      default:
        return originalName;
    }
  };

  const downloadResult = () => {
    if (!result) return;
    const link = document.createElement("a");
    link.href = result;
    const nameToUse = getFormattedFileName(originalFileName || `pro-ecom-${Date.now()}`, selectedStyle);
    link.download = nameToUse;
    link.click();
  };

  const downloadBatchItem = (item: BatchItem) => {
    if (!item.result) return;
    const link = document.createElement("a");
    link.href = item.result;
    const nameToUse = getFormattedFileName(item.file.name, selectedStyle);
    link.download = nameToUse;
    link.click();
  };

  const downloadAllBatch = () => {
    const completedItems = batchItems.filter(item => item.status === 'completed' && item.result);
    if (completedItems.length === 0) {
      toast.error("No hay imágenes completadas para descargar");
      return;
    }
    
    completedItems.forEach((item, index) => {
      setTimeout(() => {
        downloadBatchItem(item);
      }, index * 200); // Stagger downloads to avoid browser blocks
    });
    toast.success(`Iniciando descarga de ${completedItems.length} imágenes`);
  };

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, []);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const file = items[i].getAsFile();
          if (file) processFile(file);
          break;
        }
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col items-center p-4 md:p-8 max-w-7xl mx-auto">
        <Toaster position="top-center" />
        
        {/* Hidden Inputs */}
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} 
          className="hidden" 
          accept="image/*" 
        />
        <input 
          type="file" 
          ref={cameraInputRef} 
          onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} 
          className="hidden" 
          accept="image/*" 
          capture="environment"
        />
        <input 
          type="file" 
          ref={batchInputRef} 
          multiple 
          onChange={handleBatchFiles} 
          className="hidden" 
          accept="image/*" 
        />
        <input 
          type="file" 
          ref={batchCameraInputRef} 
          onChange={handleBatchFiles} 
          className="hidden" 
          accept="image/*" 
          capture="environment"
        />
        <input 
          type="file" 
          ref={video360InputRef} 
          multiple 
          onChange={handleVideo360Files} 
          className="hidden" 
          accept="image/*" 
        />
        
        {/* Header */}
        {!isEmbed && (
          <motion.header 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full text-center mb-6 md:mb-12"
          >
            <div className="flex flex-wrap justify-center mb-4 gap-2">
              <Badge variant="outline" className="px-3 py-0.5 border-brand-gold/30 text-brand-gold bg-brand-gold/5 text-[10px] md:text-xs">
                Gemini 2.5 Flash Image
              </Badge>
              {isGoogleAuth ? (
                <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px] md:text-xs">
                  <Cloud className="w-3 h-3 mr-1" /> Drive Conectado
                </Badge>
              ) : (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleConnectDrive}
                  className="h-6 md:h-7 text-[9px] md:text-[10px] border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                >
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
          
          {/* Main Viewport - Middle on desktop, Top on mobile */}
          {!isBatchMode && (
            <div className={cn("lg:order-2 space-y-6", isEmbed ? "lg:col-span-7" : "lg:col-span-5")}>
              <Card 
                className="glass-card overflow-hidden bg-black/40 border-white/5 aspect-square relative group shadow-2xl"
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
              >
                <AnimatePresence mode="wait">
                  {selectedStyle === "Video360" && video360Result ? (
                    <motion.div key="video360" className="w-full h-full relative" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <video 
                        src={video360Result} 
                        className="w-full h-full object-contain p-4 md:p-8" 
                        autoPlay 
                        loop 
                        muted 
                        playsInline
                      />
                      <div className="absolute top-4 right-4 flex gap-2">
                        <Badge className="bg-brand-violet/20 text-brand-violet border-brand-violet/30 backdrop-blur-md">
                          <Sparkles className="w-3 h-3 mr-1" /> 360° Video
                        </Badge>
                        <Button 
                          size="icon" 
                          className="bg-white/90 hover:bg-white text-black rounded-full shadow-lg h-8 w-8"
                          onClick={() => setIsPreviewOpen(true)}
                        >
                          <Maximize className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="icon" 
                          className="bg-white/90 hover:bg-white text-black rounded-full shadow-lg h-8 w-8"
                          onClick={() => {
                            const link = document.createElement("a");
                            link.href = video360Result!;
                            link.download = `360-view-${Date.now()}.mp4`;
                            link.click();
                          }}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
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
                    <motion.div 
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 flex flex-col items-center justify-center p-8 md:p-12 transition-all group"
                    >
                      <div className="w-16 h-16 md:w-24 md:h-24 bg-white/5 rounded-3xl flex items-center justify-center mb-6 border border-white/10 group-hover:scale-110 group-hover:border-brand-gold/50 transition-all duration-500 shadow-[0_0_30px_-5px_rgba(255,255,255,0.05)]">
                        <Upload className="w-8 h-8 md:w-12 md:h-12 text-white/40 group-hover:text-brand-gold transition-colors" />
                      </div>
                      <h3 className="text-xl md:text-3xl font-serif font-bold mb-3 text-white tracking-tight">Cargar Producto</h3>
                      <p className="text-white/50 text-xs md:text-base text-center max-w-[300px] leading-relaxed mb-8">
                        Sube una foto de alta calidad o toma una directamente con tu cámara.
                      </p>
                      
                      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-[300px]">
                        <Button 
                          onClick={() => fileInputRef.current?.click()}
                          className="flex-1 bg-white/10 hover:bg-white/20 text-white border border-white/20 h-12 rounded-xl backdrop-blur-md"
                        >
                          <ImageIcon className="w-4 h-4 mr-2" /> Galería
                        </Button>
                        <Button 
                          onClick={() => cameraInputRef.current?.click()}
                          className="flex-1 bg-brand-violet hover:bg-white text-black h-12 rounded-xl shadow-[0_0_20px_rgba(196,181,253,0.3)]"
                        >
                          <Camera className="w-4 h-4 mr-2" /> Cámara
                        </Button>
                      </div>
                    </motion.div>
                  ) : selectedStyle === "Video360" && !video360Result ? (
                    <motion.div 
                      key="video360-empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 flex flex-col items-center justify-center p-8 md:p-12 text-center"
                    >
                      <div className="w-16 h-16 md:w-24 md:h-24 bg-brand-violet/10 rounded-3xl flex items-center justify-center mb-6 border border-brand-violet/20">
                        <Video className="w-8 h-8 md:w-12 md:h-12 text-brand-violet/60" />
                      </div>
                      <h3 className="text-xl md:text-3xl font-serif font-bold mb-3 text-white tracking-tight">Creador Video 360°</h3>
                      <p className="text-white/50 text-xs md:text-base max-w-[300px] leading-relaxed">
                        Sube las fotos de los diferentes ángulos en el panel izquierdo para generar tu video interactivo.
                      </p>
                    </motion.div>
                  ) : result ? (
                    <motion.div key="result" className="w-full h-full relative">
                      <img src={result} className="w-full h-full object-contain p-4 md:p-8" referrerPolicy="no-referrer" />
                      <div className="absolute top-4 right-4 flex gap-2">
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 backdrop-blur-md">
                          <Check className="w-3 h-3 mr-1" /> IA Ready
                        </Badge>
                      </div>
                      
                      {/* Result Actions Overlay */}
                      <div className="absolute inset-0 bg-black/40 md:bg-black/0 md:hover:bg-black/60 transition-all flex flex-col items-center justify-center opacity-100 md:opacity-0 md:hover:opacity-100 group gap-4">
                        <div className="flex gap-3 scale-100 md:scale-90 md:group-hover:scale-100 transition-all">
                          <Button 
                            onClick={() => setIsPreviewOpen(true)}
                            className="bg-white text-black hover:bg-brand-gold font-black uppercase tracking-widest px-6 h-12 shadow-2xl"
                          >
                            <Maximize className="w-5 h-5 mr-2" /> Expandir
                          </Button>
                          <Button 
                            onClick={() => setResult(null)}
                            className="bg-white/10 text-white hover:bg-white/20 backdrop-blur-md font-black uppercase tracking-widest px-6 h-12 border border-white/20"
                          >
                            <Eye className="w-5 h-5 mr-2" /> Ver Original
                          </Button>
                        </div>
                        <div className="flex gap-3 scale-100 md:scale-90 md:group-hover:scale-100 transition-all">
                          <Button 
                            onClick={() => fileInputRef.current?.click()}
                            className="bg-white/10 text-white hover:bg-white/20 border border-white/20 font-black uppercase tracking-widest px-6 h-12 shadow-2xl backdrop-blur-md"
                          >
                            <ImageIcon className="w-5 h-5 mr-2" /> Galería
                          </Button>
                          <Button 
                            onClick={() => cameraInputRef.current?.click()}
                            className="bg-brand-violet text-black hover:bg-white font-black uppercase tracking-widest px-6 h-12 shadow-2xl"
                          >
                            <Camera className="w-5 h-5 mr-2" /> Cámara
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="preview" className="w-full h-full relative group">
                      <img src={image} className="w-full h-full object-contain p-4 md:p-8 opacity-50 grayscale" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-black/40 backdrop-blur-sm px-4 py-2 rounded-full border border-white/10">
                          <p className="text-xs text-white/60 font-medium">Vista previa original</p>
                        </div>
                      </div>
                      
                      {/* Change Image Button Overlay */}
                      <div className="absolute inset-0 bg-black/40 md:bg-black/0 md:hover:bg-black/40 transition-all flex items-center justify-center opacity-100 md:opacity-0 md:hover:opacity-100">
                        <div className="flex flex-col sm:flex-row gap-3 scale-100 md:scale-90 md:group-hover:scale-100 transition-all">
                          <Button 
                            onClick={() => fileInputRef.current?.click()}
                            className="bg-white/10 text-white hover:bg-white/20 border border-white/20 font-black uppercase tracking-widest px-6 h-12 shadow-2xl backdrop-blur-md"
                          >
                            <ImageIcon className="w-5 h-5 mr-2" /> Galería
                          </Button>
                          <Button 
                            onClick={() => cameraInputRef.current?.click()}
                            className="bg-brand-violet text-black hover:bg-white font-black uppercase tracking-widest px-6 h-12 shadow-2xl"
                          >
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
                <div className="flex flex-col sm:flex-row gap-4">
                  <Button onClick={downloadResult} className="btn-premium flex-1 h-16 bg-white text-black hover:bg-brand-gold hover:text-black shadow-[0_20px_40px_-15px_rgba(255,255,255,0.1)]">
                    <Download className="w-6 h-6 mr-3" /> Descargar HD
                  </Button>
                  <Button 
                    onClick={() => handleSaveToDrive(result)} 
                    disabled={isSavingToDrive}
                    className={cn(
                      "btn-premium flex-1 h-16 border border-white/10",
                      isGoogleAuth ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-white/5 hover:bg-white/10 text-white/60"
                    )}
                  >
                    {isSavingToDrive ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Cloud className="w-6 h-6 mr-3" />}
                    {isGoogleAuth ? 'Guardar en Drive' : 'Conectar Drive'}
                  </Button>
                </div>
                <Button 
                  variant="ghost" 
                  onClick={() => setResult(null)}
                  className="w-full h-12 text-[10px] font-black uppercase tracking-[0.3em] text-white/40 hover:text-white hover:bg-white/5 border border-white/5"
                >
                  <Eye className="w-4 h-4 mr-2" /> Volver a la Imagen Original
                </Button>
              </div>
            )}
          </div>
        )}

          {/* Controls & Batch - Left on desktop, Middle on mobile */}
          <div className={cn(
            "lg:order-1 space-y-6 flex flex-col transition-all duration-500",
            isBatchMode ? "lg:col-span-9" : "lg:col-span-4"
          )}>
            <Card className="glass-card p-5 md:p-6 shadow-xl flex-1 flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 shrink-0">
                <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-violet">Configuración</h3>
                <div className="flex bg-black/60 p-1 rounded-2xl border border-white/10 gap-1 w-fit shrink-0">
                  <Button 
                    variant={!isBatchMode ? "secondary" : "ghost"} 
                    size="sm" 
                    onClick={() => setIsBatchMode(false)}
                    className={cn(
                      "h-8 text-[10px] px-3 sm:px-4 font-black uppercase tracking-widest transition-all", 
                      !isBatchMode ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.2)]" : "text-white/60 hover:text-white"
                    )}
                  >
                    Individual
                  </Button>
                  <Button 
                    variant={isBatchMode ? "secondary" : "ghost"} 
                    size="sm" 
                    onClick={() => setIsBatchMode(true)}
                    className={cn(
                      "h-8 text-[10px] px-3 sm:px-4 font-black uppercase tracking-widest transition-all", 
                      isBatchMode ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.2)]" : "text-white/60 hover:text-white"
                    )}
                  >
                    Lote
                  </Button>
                </div>
              </div>

              <div className="space-y-4 mb-8 shrink-0">
                <label className="text-[10px] font-black text-brand-violet uppercase tracking-[0.3em] mb-2 block">Tipo de Imagen</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'Ecom', label: '1. Producto' },
                    { id: 'Lifestyle', label: '2. Lifestyle' },
                    { id: 'Technical', label: '3. Medidas' },
                    { id: 'Infographic', label: '4. Infografía' },
                    { id: 'Video360', label: '5. Video 360°' }
                  ].map((style) => (
                    <Button
                      key={style.id}
                      onClick={() => setSelectedStyle(style.id as Style)}
                      className={cn(
                        "h-11 text-[10px] font-black uppercase tracking-widest transition-all duration-300 border active:scale-95",
                        selectedStyle === style.id 
                          ? "bg-white text-black shadow-[0_0_25px_rgba(255,255,255,0.3)] border-white" 
                          : "bg-transparent text-white/60 border-brand-violet/20 hover:bg-brand-violet/10"
                      )}
                    >
                      {style.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex-1 space-y-10 overflow-y-auto pr-2 custom-scrollbar">

                {/* Conditional Inputs */}
                {!isBatchMode && (
                  <div className="mt-12 pt-6 border-t border-white/5">
                    <AnimatePresence mode="wait">
                      {(selectedStyle === "Ecom" || selectedStyle === "Video360") && (
                        <motion.div 
                          key="ecom-inputs"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                          className="space-y-4 pb-4"
                        >
                          <div className="space-y-2">
                            <Label className="text-[10px] uppercase text-brand-violet/60 flex items-center">
                              Nombre/Descripción del Producto
                            </Label>
                            <Input 
                              placeholder="Ej: Zapatillas deportivas rojas, Cafetera de acero... (Opcional)" 
                              value={productDescription}
                              onChange={(e) => setProductDescription(e.target.value)}
                              className="input-premium h-10 text-xs"
                            />
                            <p className="text-[9px] text-white/30 uppercase tracking-tighter">Ayuda a la IA a identificar el producto con precisión</p>
                          </div>
                        </motion.div>
                      )}

                      {selectedStyle === "Lifestyle" && (
                        <motion.div 
                          key="lifestyle-inputs"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                          className="space-y-4 pb-4"
                        >
                          <div className="space-y-2">
                            <Label className="text-[10px] uppercase text-brand-violet/60">Entorno Preferido (Opcional)</Label>
                            <Input 
                              placeholder="Ej: En una cocina moderna, en un parque..." 
                              value={lifestylePrompt}
                              onChange={(e) => setLifestylePrompt(e.target.value)}
                              className="input-premium h-10 text-xs"
                            />
                            <p className="text-[9px] text-white/30 uppercase tracking-tighter">Describe dónde quieres ver el producto</p>
                          </div>
                        </motion.div>
                      )}

                      {selectedStyle === "Technical" && (
                        <motion.div 
                          key="technical-inputs"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                          className="space-y-3 pb-4"
                        >
                          <Label className="text-[10px] uppercase text-brand-violet/60 flex items-center">
                            Medidas del Producto <span className="text-red-500 ml-1">*</span>
                          </Label>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[9px] uppercase text-white/30">Ancho (cm)</Label>
                              <Input 
                                placeholder="Ancho (cm)" 
                                value={width}
                                onChange={(e) => setWidth(e.target.value)}
                                className={cn(
                                  "input-premium h-10 text-[10px]",
                                  width.trim() === "" && "border-red-500/50 focus:border-red-500"
                                )}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[9px] uppercase text-white/30">Alto (cm)</Label>
                              <Input 
                                placeholder="Alto (cm)" 
                                value={height}
                                onChange={(e) => setHeight(e.target.value)}
                                className={cn(
                                  "input-premium h-10 text-[10px]",
                                  height.trim() === "" && "border-red-500/50 focus:border-red-500"
                                )}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[9px] uppercase text-white/30">Profundo (cm)</Label>
                              <Input 
                                placeholder="Profundo (cm)" 
                                value={depth}
                                onChange={(e) => setDepth(e.target.value)}
                                className={cn(
                                  "input-premium h-10 text-[10px]",
                                  depth.trim() === "" && "border-red-500/50 focus:border-red-500"
                                )}
                              />
                            </div>
                          </div>
                        </motion.div>
                      )}

                      {selectedStyle === "Infographic" && (
                        <motion.div 
                          key="infographic-inputs"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                          className="space-y-4 pb-4"
                        >
                          <div className="space-y-2">
                            <Label className="text-[10px] uppercase text-brand-violet/60 flex items-center">
                              Título de la Infografía <span className="text-red-500 ml-1">*</span>
                            </Label>
                            <Input 
                              placeholder="Ej: El mejor del mercado" 
                              value={infoTitle}
                              onChange={(e) => setInfoTitle(e.target.value)}
                              className={cn(
                                "input-premium h-10 text-xs",
                                infoTitle.trim() === "" && "border-red-500/50 focus:border-red-500"
                              )}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-[10px] uppercase text-brand-violet/60 flex items-center">
                              Características <span className="text-red-500 ml-1">*</span>
                            </Label>
                            <Textarea 
                              placeholder="Ej: Duradero\nElegante\nEconómico" 
                              value={infoFeatures}
                              onChange={(e) => setInfoFeatures(e.target.value)}
                              className={cn(
                                "input-premium text-xs h-24",
                                infoFeatures.trim() === "" && "border-red-500/50 focus:border-red-500"
                              )}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {isBatchMode ? (
                  <div className="space-y-6 pt-8 border-t border-white/10">
                    <div className="flex justify-between items-center">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-violet">Imágenes en Lote</h3>
                      {batchItems.length > 0 && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => setBatchItems([])}
                          className="text-[9px] uppercase font-bold text-red-400/60 hover:text-red-400 hover:bg-red-400/5 h-7"
                        >
                          <Trash2 className="w-3 h-3 mr-2" /> Reiniciar Lote
                        </Button>
                      )}
                    </div>
                    <div className="border-2 border-dashed border-brand-violet/30 rounded-2xl p-6 text-center bg-brand-violet/5 flex flex-col items-center justify-center gap-4">
                      <div>
                        <p className="text-sm font-bold text-white uppercase tracking-widest">Añadir Imágenes</p>
                        <p className="text-[10px] text-white/40 mt-1 uppercase tracking-tighter">Agrega más productos al lote</p>
                      </div>
                      <div className="flex gap-3 w-full">
                        <Button 
                          variant="outline"
                          onClick={() => batchInputRef.current?.click()}
                          className="flex-1 bg-white/5 hover:bg-white/10 border-white/10 h-10 text-[10px] uppercase tracking-wider"
                        >
                          <ImageIcon className="w-4 h-4 mr-2" /> Galería
                        </Button>
                        <Button 
                          onClick={() => batchCameraInputRef.current?.click()}
                          className="flex-1 bg-brand-violet hover:bg-white text-black h-10 text-[10px] uppercase tracking-wider"
                        >
                          <Camera className="w-4 h-4 mr-2" /> Cámara
                        </Button>
                      </div>
                    </div>
                    
                    {batchItems.length > 0 && (
                      <div className="space-y-3">
                        <ScrollArea className="h-[450px] pr-4">
                          <div className="space-y-3">
                            {batchItems.map((item) => (
                              <div 
                                key={item.id} 
                                className={cn(
                                  "flex flex-col p-4 bg-black/40 rounded-2xl border transition-all mb-3",
                                  item.status === 'completed' ? "border-green-500/40" : "border-white/20"
                                )}
                              >
                                <div className="flex items-center gap-4">
                                  <div 
                                    className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-white/20 cursor-pointer shadow-md group/thumb"
                                    onClick={() => {
                                      if (item.status === 'completed' && item.result) {
                                        setSelectedHistoryItem({
                                          id: item.id,
                                          original: item.preview,
                                          result: item.result,
                                          style: selectedStyle,
                                          timestamp: Date.now(),
                                          fileName: item.file.name
                                        });
                                      }
                                    }}
                                  >
                                    <img src={item.status === 'completed' && item.result ? item.result : item.preview} className="w-full h-full object-cover transition-transform duration-500 group-hover/thumb:scale-110" />
                                    {item.status === 'completed' && (
                                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
                                        <Eye className="w-5 h-5 text-white" />
                                      </div>
                                    )}
                                    {item.status === 'completed' && !item.result && (
                                      <div className="absolute inset-0 bg-green-500/40 flex items-center justify-center">
                                        <Check className="w-4 h-4 text-white" />
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold truncate text-white">{item.file.name}</p>
                                    <p className={`text-[10px] uppercase font-black tracking-[0.2em] mt-0.5 ${
                                      item.status === 'completed' ? 'text-green-400' : 
                                      item.status === 'processing' ? 'text-brand-gold animate-pulse' : 
                                      'text-white/40'
                                    }`}>
                                      {item.status === 'completed' ? 'Listo' : item.status === 'processing' ? 'Procesando' : 'En espera'}
                                    </p>
                                  </div>
                                  <div className="flex gap-1">
                                    {item.status === 'completed' && (
                                      <Button 
                                        variant="outline" 
                                        size="icon" 
                                        className="h-8 w-8 border-white/10 text-white/60 hover:text-white hover:bg-white/10"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          downloadBatchItem(item);
                                        }}
                                      >
                                        <Download className="w-4 h-4" />
                                      </Button>
                                    )}
                                    <Button 
                                      variant="outline" 
                                      size="icon" 
                                      className="h-8 w-8 border-white/10 text-white/30 hover:text-red-400 hover:bg-red-400/10"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setBatchItems(prev => prev.filter(i => i.id !== item.id));
                                      }}
                                    >
                                      <X className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>

                                {/* Individual Inputs for Batch Item */}
                                <div className="mt-4 space-y-3">
                                  {selectedStyle === "Ecom" && (
                                    <div className="grid grid-cols-1 gap-2">
                                      <Input 
                                        placeholder="Nombre/Descripción del Producto (Opcional)" 
                                        value={item.productDescription || ""}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setBatchItems(prev => prev.map(i => i.id === item.id ? { ...i, productDescription: val } : i));
                                        }}
                                        className="h-8 text-[10px] bg-black/40 border-white/5"
                                      />
                                    </div>
                                  )}
                                  {selectedStyle === "Lifestyle" && (
                                    <div className="grid grid-cols-1 gap-2">
                                      <Input 
                                        placeholder="Entorno específico (Opcional)" 
                                        value={item.lifestylePrompt}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setBatchItems(prev => prev.map(i => i.id === item.id ? { ...i, lifestylePrompt: val } : i));
                                        }}
                                        className="h-8 text-[10px] bg-black/40 border-white/5"
                                      />
                                    </div>
                                  )}
                                  {selectedStyle === "Technical" && (
                                    <div className="grid grid-cols-3 gap-2">
                                      <Input 
                                        placeholder="Ancho (cm)" 
                                        value={item.width || ""}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setBatchItems(prev => prev.map(i => i.id === item.id ? { ...i, width: val } : i));
                                        }}
                                        className={cn(
                                          "h-8 text-[9px] bg-black/40 border-white/5",
                                          (!item.width || item.width.trim() === "") && "border-red-500/50 focus:border-red-500"
                                        )}
                                      />
                                      <Input 
                                        placeholder="Alto (cm)" 
                                        value={item.height || ""}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setBatchItems(prev => prev.map(i => i.id === item.id ? { ...i, height: val } : i));
                                        }}
                                        className={cn(
                                          "h-8 text-[9px] bg-black/40 border-white/5",
                                          (!item.height || item.height.trim() === "") && "border-red-500/50 focus:border-red-500"
                                        )}
                                      />
                                      <Input 
                                        placeholder="Profundo (cm)" 
                                        value={item.depth || ""}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setBatchItems(prev => prev.map(i => i.id === item.id ? { ...i, depth: val } : i));
                                        }}
                                        className={cn(
                                          "h-8 text-[9px] bg-black/40 border-white/5",
                                          (!item.depth || item.depth.trim() === "") && "border-red-500/50 focus:border-red-500"
                                        )}
                                      />
                                    </div>
                                  )}
                                  {selectedStyle === "Infographic" && (
                                    <div className="space-y-2">
                                      <Input 
                                        placeholder="Título" 
                                        value={item.infoTitle || ""}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setBatchItems(prev => prev.map(i => i.id === item.id ? { ...i, infoTitle: val } : i));
                                        }}
                                        className={cn(
                                          "h-8 text-[10px] bg-black/40 border-white/5",
                                          (!item.infoTitle || item.infoTitle.trim() === "") && "border-red-500/50 focus:border-red-500"
                                        )}
                                      />
                                      <Textarea 
                                        placeholder="Características" 
                                        value={item.infoFeatures || ""}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setBatchItems(prev => prev.map(i => i.id === item.id ? { ...i, infoFeatures: val } : i));
                                        }}
                                        className={cn(
                                          "h-16 text-[10px] bg-black/40 border-white/5",
                                          (!item.infoFeatures || item.infoFeatures.trim() === "") && "border-red-500/50 focus:border-red-500"
                                        )}
                                      />
                                    </div>
                                  )}
                                  {selectedStyle === "Infographic" && (
                                    <div className="grid grid-cols-1 gap-2">
                                      <Input 
                                        placeholder="Título de infografía" 
                                        value={item.infoTitle}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setBatchItems(prev => prev.map(i => i.id === item.id ? { ...i, infoTitle: val } : i));
                                        }}
                                        className="h-8 text-[10px] bg-black/40 border-white/5"
                                      />
                                      <Textarea 
                                        placeholder="Características (una por línea)" 
                                        value={item.infoFeatures}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setBatchItems(prev => prev.map(i => i.id === item.id ? { ...i, infoFeatures: val } : i));
                                        }}
                                        className="text-[10px] bg-black/40 border-white/5 min-h-[60px] py-2"
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>

                        <div className="pt-6 space-y-4">
                          {batchItems.some(i => i.status === 'completed') && (
                            <Button 
                              variant="outline" 
                              onClick={downloadAllBatch}
                              className="w-full h-12 text-[11px] border-brand-violet/20 hover:bg-brand-violet/10 font-black uppercase tracking-[0.2em] shadow-xl text-brand-violet"
                            >
                              <Download className="w-4 h-4 mr-3" /> Descargar Lote
                            </Button>
                          )}
                          
                          {isProcessing && <Progress value={batchProgress} className="h-1.5 bg-brand-violet/10" />}
                          
                          {!isGoogleAuth && (
                            <Button 
                              variant="outline" 
                              onClick={handleConnectDrive}
                              className="w-full h-12 text-[11px] border-blue-500/30 text-blue-400 hover:bg-blue-500/10 uppercase font-black tracking-[0.2em] shadow-xl"
                            >
                              <Cloud className="w-4 h-4 mr-3" /> Auto-guardado Drive
                            </Button>
                          )}

                          <Button 
                            onClick={runBatch} 
                            disabled={isProcessing || batchItems.every(i => i.status === 'completed') || !isFormValid()}
                            className="btn-premium w-full h-16 bg-brand-violet text-black hover:bg-white shadow-[0_20px_60px_-15px_rgba(196,181,253,0.4)] mt-4"
                          >
                            {isProcessing ? "Procesando..." : !isFormValid() ? "Completa los campos" : "Iniciar Lote"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : selectedStyle === "Video360" ? (
                  <div className="space-y-6 pt-8 border-t border-white/10">
                    <div className="flex justify-between items-center">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-violet">Configuración Video 360°</h3>
                      {Object.values(video360Angles).some(Boolean) && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => {
                            setVideo360Angles({ frente: null, dorso: null, lateral1: null, lateral2: null });
                            setVideo360Result(null);
                          }}
                          className="text-[9px] uppercase font-bold text-red-400/60 hover:text-red-400 hover:bg-red-400/5 h-7"
                        >
                          <Trash2 className="w-3 h-3 mr-2" /> Reiniciar
                        </Button>
                      )}
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-[10px] uppercase font-bold text-white/40 tracking-widest">Descripción del Producto (Opcional)</Label>
                        <Input 
                          placeholder="Ej: Mochila azul con diseño de astronauta..." 
                          value={productDescription}
                          onChange={(e) => setProductDescription(e.target.value)}
                          className="bg-black/40 border-white/5 text-sm"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {(['frente', 'dorso', 'lateral1', 'lateral2'] as const).map((angle) => {
                          const handleAngleUpload = (useCamera: boolean) => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = 'image/*';
                            if (useCamera) {
                              input.capture = 'environment';
                            }
                            input.onchange = async (e) => {
                              const file = (e.target as HTMLInputElement).files?.[0];
                              if (file) {
                                try {
                                  const compressedBase64 = await compressImage(file);
                                  setVideo360Angles(prev => ({
                                    ...prev,
                                    [angle]: {
                                      id: Math.random().toString(36).substr(2, 9),
                                      file,
                                      preview: compressedBase64,
                                      status: 'pending'
                                    }
                                  }));
                                } catch (err) {
                                  console.error("Error compressing 360 angle, using original", err);
                                  const reader = new FileReader();
                                  reader.onload = (ev) => {
                                    setVideo360Angles(prev => ({
                                      ...prev,
                                      [angle]: {
                                        id: Math.random().toString(36).substr(2, 9),
                                        file,
                                        preview: ev.target?.result as string,
                                        status: 'pending'
                                      }
                                    }));
                                  };
                                  reader.readAsDataURL(file);
                                }
                              }
                            };
                            input.click();
                          };

                          return (
                            <div key={angle} className="space-y-2">
                              <Label className="text-[9px] uppercase font-bold text-white/30 tracking-widest">{angle}</Label>
                              <div 
                                className={cn(
                                  "aspect-square rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center relative overflow-hidden group",
                                  video360Angles[angle] 
                                    ? "border-brand-violet/50 bg-brand-violet/5" 
                                    : "border-white/10 bg-white/5"
                                )}
                              >
                                {video360Angles[angle] ? (
                                  <>
                                    <img src={video360Angles[angle]!.preview} className="w-full h-full object-cover" />
                                  </>
                                ) : (
                                  <>
                                    <ImageIcon className="w-5 h-5 text-white/20 mb-1" />
                                    <span className="text-[8px] text-white/20 uppercase">Vacío</span>
                                  </>
                                )}
                              </div>
                              <div className="flex gap-1">
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="flex-1 h-7 text-[9px] px-0 border-white/10 hover:bg-white/10"
                                  onClick={() => handleAngleUpload(false)}
                                >
                                  <ImageIcon className="w-3 h-3 mr-1" /> Galería
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="flex-1 h-7 text-[9px] px-0 border-white/10 hover:bg-white/10"
                                  onClick={() => handleAngleUpload(true)}
                                >
                                  <Camera className="w-3 h-3 mr-1" /> Cámara
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="pt-4 space-y-4">
                      {!hasApiKey && (
                        <div className="p-4 bg-brand-violet/5 border border-brand-violet/20 rounded-xl space-y-3">
                          <p className="text-[10px] text-brand-violet font-medium leading-relaxed">
                            Para generar videos de alta calidad, necesitas configurar una clave de API de Google Cloud (Paid).
                          </p>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full h-8 text-[10px] border-brand-violet/30 text-brand-violet hover:bg-brand-violet/10"
                            onClick={async () => {
                              await ensureApiKey();
                            }}
                          >
                            Configurar API Key
                          </Button>
                        </div>
                      )}

                      <Button 
                        className="btn-premium w-full h-16 bg-brand-violet text-black hover:bg-white shadow-[0_20px_60px_-15px_rgba(196,181,253,0.4)]"
                        disabled={isProcessing || !Object.values(video360Angles).some(Boolean)}
                        onClick={handleGenerateVideo360}
                      >
                        {isProcessing ? (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                            Procesando ({Math.round(batchProgress)}%)
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4 mr-2" />
                            {video360Result ? "Regenerar Video 360°" : "Generar Video 360°"}
                          </>
                        )}
                      </Button>

                      {video360Result && !isProcessing && (
                        <Button 
                          variant="outline"
                          className="w-full h-12 border-brand-violet/20 text-brand-violet hover:bg-brand-violet/10 font-black uppercase tracking-widest"
                          onClick={() => {
                            const link = document.createElement("a");
                            link.href = video360Result!;
                            link.download = `360-view-${Date.now()}.mp4`;
                            link.click();
                          }}
                        >
                          <Download className="w-4 h-4 mr-2" /> Descargar Video
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 pt-8 shrink-0">
                    <Button 
                      onClick={handleTransform} 
                      disabled={!image || isProcessing || !isFormValid()}
                      className="btn-premium w-full h-16 bg-brand-violet text-black hover:bg-white hover:text-black shadow-[0_20px_40px_-15px_rgba(196,181,253,0.3)]"
                    >
                      {isProcessing ? <RefreshCw className="w-6 h-6 animate-spin" /> : !isFormValid() ? "Completa los campos" : "Crear Imagen"}
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Right: History - Bottom on mobile */}
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
                    {history.map((item) => (
                      <div 
                        key={item.id} 
                        className="group relative aspect-square lg:aspect-video rounded-xl overflow-hidden border border-white/5 cursor-pointer hover:border-brand-gold/50 transition-all shadow-lg"
                        onClick={() => {
                          setSelectedHistoryItem(item);
                        }}
                      >
                        <img src={item.result} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 md:bg-black/60 opacity-100 md:opacity-0 md:group-hover:opacity-100 flex flex-col items-center justify-center transition-all duration-300">
                          <ImageIcon className="w-5 h-5 text-white mb-2" />
                          <span className="text-[9px] uppercase font-bold text-white/60">Ver</span>
                        </div>
                      </div>
                    ))}
                    {history.length === 0 && (
                      <div className="col-span-2 lg:col-span-1 flex flex-col items-center justify-center py-24 text-white/10">
                        <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center mb-4 border border-white/5">
                          <History className="w-6 h-6 opacity-20" />
                        </div>
                        <p className="text-[10px] uppercase font-black tracking-[0.3em] text-white/20">Sin Historial</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </Card>
            </div>
          )}
        </div>

        {/* Result Preview Modal */}
        <AnimatePresence>
          {isPreviewOpen && (result || video360Result) && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-10 bg-black/95 backdrop-blur-xl"
              onClick={() => setIsPreviewOpen(false)}
            >
              <div className="absolute top-6 right-6 z-10">
                <Button 
                  variant="secondary" 
                  size="icon" 
                  className="rounded-full bg-white/10 hover:bg-white/20 border-white/10 text-white backdrop-blur-md h-12 w-12"
                  onClick={() => setIsPreviewOpen(false)}
                >
                  <X className="w-6 h-6" />
                </Button>
              </div>

              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="relative max-w-5xl w-full h-full flex items-center justify-center"
                onClick={(e) => e.stopPropagation()}
              >
                {selectedStyle === "Video360" && video360Result ? (
                  <video 
                    src={video360Result} 
                    className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" 
                    autoPlay 
                    loop 
                    muted 
                    playsInline
                  />
                ) : (
                  <img 
                    src={result!} 
                    className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" 
                    referrerPolicy="no-referrer"
                  />
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        {!isEmbed && (
          <footer className="w-full mt-12 pt-8 border-t border-white/5 text-center text-white/20 text-[10px] uppercase tracking-widest">
            <p>© 2026 ProEcom AI • 100% Fidelidad • Fondo Blanco Puro • Google Drive Ready</p>
          </footer>
        )}

        {/* History Modal */}
        <AnimatePresence>
          {selectedHistoryItem && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-10 bg-black/95 backdrop-blur-xl"
              onClick={() => setSelectedHistoryItem(null)}
            >
              <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20 hidden md:block">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-16 w-16 rounded-full text-white/20 hover:text-white hover:bg-white/5"
                  onClick={(e) => {
                    e.stopPropagation();
                    const currentIndex = history.findIndex(item => item.id === selectedHistoryItem.id);
                    const prevIndex = (currentIndex + 1) % history.length;
                    setSelectedHistoryItem(history[prevIndex]);
                  }}
                >
                  <ChevronLeft className="w-10 h-10" />
                </Button>
              </div>

              <div className="absolute right-4 top-1/2 -translate-y-1/2 z-20 hidden md:block">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-16 w-16 rounded-full text-white/20 hover:text-white hover:bg-white/5"
                  onClick={(e) => {
                    e.stopPropagation();
                    const currentIndex = history.findIndex(item => item.id === selectedHistoryItem.id);
                    const nextIndex = (currentIndex - 1 + history.length) % history.length;
                    setSelectedHistoryItem(history[nextIndex]);
                  }}
                >
                  <ChevronRight className="w-10 h-10" />
                </Button>
              </div>

              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative max-w-5xl w-full bg-zinc-900/50 rounded-3xl overflow-hidden border border-white/10 shadow-2xl flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="absolute top-6 right-6 z-10 flex gap-3">
                  <Button 
                    variant="secondary" 
                    size="icon" 
                    className="rounded-full bg-white/10 hover:bg-white/20 border-white/10 text-white backdrop-blur-md"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = selectedHistoryItem.result;
                      link.download = getFormattedFileName(selectedHistoryItem.fileName || 'result', selectedHistoryItem.style);
                      link.click();
                    }}
                  >
                    <Download className="w-5 h-5" />
                  </Button>
                  <Button 
                    variant="secondary" 
                    size="icon" 
                    className="rounded-full bg-white/10 hover:bg-white/20 border-white/10 text-white backdrop-blur-md"
                    onClick={() => setSelectedHistoryItem(null)}
                  >
                    <X className="w-5 h-5" />
                  </Button>
                </div>

                <div className="flex-1 overflow-hidden flex items-center justify-center p-6 md:p-12">
                  <img 
                    src={selectedHistoryItem.result} 
                    className="max-w-full max-h-[70vh] object-contain rounded-xl shadow-2xl" 
                    referrerPolicy="no-referrer"
                  />
                </div>

                <div className="p-8 bg-black/40 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-6">
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
                    <Button 
                      variant="outline"
                      className="flex-1 md:flex-none border-white/10 text-white/60 hover:text-white hover:bg-white/5 h-12 px-8 rounded-2xl"
                      onClick={() => {
                        setImage(selectedHistoryItem.original);
                        setResult(selectedHistoryItem.result);
                        setOriginalFileName(selectedHistoryItem.fileName);
                        setIsBatchMode(false);
                        setSelectedHistoryItem(null);
                      }}
                    >
                      Editar Ajustes
                    </Button>
                    <Button 
                      className="flex-1 md:flex-none bg-brand-violet text-black hover:bg-white h-12 px-10 rounded-2xl font-bold"
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = selectedHistoryItem.result;
                        link.download = getFormattedFileName(selectedHistoryItem.fileName || 'result', selectedHistoryItem.style);
                        link.click();
                      }}
                    >
                      Descargar HD
                    </Button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        {/* API Key Modal */}
        <AnimatePresence>
          {showApiKeyModal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/95 backdrop-blur-xl"
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative max-w-md w-full bg-zinc-900 rounded-3xl overflow-hidden border border-white/10 shadow-2xl p-8 space-y-6"
              >
                <div className="space-y-2 text-center">
                  <h2 className="text-xl font-bold text-white">Configurar API Key</h2>
                  <p className="text-xs text-white/50">
                    Para usar esta aplicación fuera de AI Studio, necesitas tu propia clave de API de Gemini (Google AI Studio).
                  </p>
                </div>
                
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-white/70">API Key de Gemini</Label>
                    <Input 
                      type="password"
                      placeholder="AIzaSy..."
                      value={userApiKey}
                      onChange={(e) => setUserApiKey(e.target.value)}
                      className="bg-black/50 border-white/10 text-white"
                    />
                  </div>
                  
                  <div className="flex gap-3 pt-4">
                    <Button 
                      variant="outline" 
                      className="flex-1 border-white/10 text-white hover:bg-white/5"
                      onClick={() => setShowApiKeyModal(false)}
                    >
                      Cancelar
                    </Button>
                    <Button 
                      className="flex-1 bg-brand-violet text-black hover:bg-white"
                      onClick={() => {
                        if (userApiKey.trim()) {
                          localStorage.setItem('gemini_api_key', userApiKey.trim());
                          setHasApiKey(true);
                          setShowApiKeyModal(false);
                          toast.success("API Key guardada correctamente");
                        } else {
                          toast.error("Por favor ingresa una clave válida");
                        }
                      }}
                    >
                      Guardar
                    </Button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </TooltipProvider>
  );
}
