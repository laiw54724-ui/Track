"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createWorker, PSM, Worker } from "tesseract.js";

type UploadedImage = {
  file: File;
  previewUrl: string;
  termLabel: string;
};

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DetectedRow = {
  top: number;
  bottom: number;
  height: number;
  activeRatio: number;
  greenRatio: number;
};

type CourseRecord = {
  id: string;
  term: string;
  courseNumber: string;
  requirement: string;
  courseName: string;
  englishName: string;
  courseCode: string;
  stage: string;
  credits: number | null;
  score: number | null;
  remarks: string;
};

type ColumnDefinition = {
  key: keyof Pick<
    CourseRecord,
    | "courseNumber"
    | "requirement"
    | "courseName"
    | "englishName"
    | "courseCode"
    | "stage"
    | "credits"
    | "score"
    | "remarks"
  >;
  label: string;
  start: number;
  end: number;
};

type GpaRules = {
  gradeA: number;
  gradeB: number;
  gradeC: number;
};

type OcrWorker = Worker & {
  loadLanguage: Worker["load"];
  initialize: Worker["reinitialize"];
};

type ProcessingStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
  detail?: string;
};

const columnLayout: ColumnDefinition[] = [
  { key: "courseNumber", label: "課號", start: 0, end: 0.1 },
  { key: "requirement", label: "必選修", start: 0.1, end: 0.18 },
  { key: "courseName", label: "課程名稱", start: 0.18, end: 0.32 },
  { key: "englishName", label: "English Course", start: 0.32, end: 0.56 },
  { key: "courseCode", label: "課程編碼", start: 0.56, end: 0.66 },
  { key: "stage", label: "階段", start: 0.66, end: 0.72 },
  { key: "credits", label: "學分", start: 0.72, end: 0.78 },
  { key: "score", label: "成績", start: 0.78, end: 0.86 },
  { key: "remarks", label: "備註", start: 0.86, end: 1 },
];

const defaultGpaRules: GpaRules = {
  gradeA: 80,
  gradeB: 70,
  gradeC: 60,
};

type GpaRuleInputs = Record<keyof GpaRules, string>;

const decimalInputPattern = /^(\d+(\.\d*)?|\.\d*)?$/;

const MAX_IMAGE_DIMENSION = 2400;

function cleanupText(value: string): string {
  const withoutControlChars = Array.from(value)
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("");
  return withoutControlChars.replace(/\s+/g, " ").trim();
}

function parseNumber(value: string): number | null {
  const sanitized = value.replace(/[^0-9.]/g, "");
  if (!sanitized) return null;
  const result = Number.parseFloat(sanitized);
  if (Number.isNaN(result)) return null;
  return result;
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (error) => {
      URL.revokeObjectURL(url);
      reject(error);
    };
    img.src = url;
  });
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function scaleImage(image: HTMLImageElement): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to get 2D context");
  }
  context.drawImage(image, 0, 0, width, height);
  return { canvas, context };
}

function detectTableBounds(
  imageData: ImageData,
): Bounds {
  const { width, height, data } = imageData;
  let hasGreen = false;
  let top = 0;
  let bottom = height - 1;
  let left = width;
  let right = 0;

  const isGreenPixel = (r: number, g: number, b: number) => {
    return g > 120 && g > r + 25 && g > b + 10;
  };

  const rowStats: Array<{
    greenRatio: number;
    activeRatio: number;
    minX: number;
    maxX: number;
  }> = [];

  for (let y = 0; y < height; y += 1) {
    let greenCount = 0;
    let activeCount = 0;
    let rowMinX = width;
    let rowMaxX = 0;

    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const isGreen = isGreenPixel(r, g, b);
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      const isActive = brightness < 248;

      if (isGreen) {
        greenCount += 1;
        rowMinX = Math.min(rowMinX, x);
        rowMaxX = Math.max(rowMaxX, x);
      }
      if (isActive) {
        activeCount += 1;
      }
    }

    const greenRatio = greenCount / width;
    const activeRatio = activeCount / width;
    rowStats.push({ greenRatio, activeRatio, minX: rowMinX, maxX: rowMaxX });

    if (greenRatio > 0.05 && !hasGreen) {
      top = Math.max(0, y - Math.round(height * 0.02));
      hasGreen = true;
    }
  }

  if (!hasGreen) {
    return { x: 0, y: 0, width, height };
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    if (rowStats[y].activeRatio > 0.02) {
      bottom = Math.min(height - 1, y + Math.round(height * 0.02));
      break;
    }
  }

  for (const stat of rowStats) {
    if (stat.greenRatio > 0.02) {
      left = Math.min(left, stat.minX);
      right = Math.max(right, stat.maxX);
    }
  }

  if (left >= right) {
    left = 0;
    right = width - 1;
  }

  const horizontalPadding = Math.round(width * 0.01);
  const paddedLeft = Math.max(0, left - horizontalPadding);
  const paddedRight = Math.min(width, right + horizontalPadding);

  const bounds: Bounds = {
    x: paddedLeft,
    y: top,
    width: Math.max(0, paddedRight - paddedLeft),
    height: Math.min(height - top, bottom - top),
  };

  return bounds;
}

function detectRows(imageData: ImageData): DetectedRow[] {
  const { width, height, data } = imageData;
  const rows: DetectedRow[] = [];
  let inside = false;
  let start = 0;
  let quietCounter = 0;

  const analyzeRow = (y: number) => {
    let active = 0;
    let green = 0;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      if (brightness < 248) {
        active += 1;
      }
      if (g > 120 && g > r + 25 && g > b + 10) {
        green += 1;
      }
    }
    return {
      activeRatio: active / width,
      greenRatio: green / width,
    };
  };

  for (let y = 0; y < height; y += 1) {
    const { activeRatio, greenRatio } = analyzeRow(y);

    if (!inside && activeRatio > 0.015) {
      inside = true;
      start = Math.max(0, y - 1);
      quietCounter = 0;
    } else if (inside && activeRatio <= 0.01) {
      quietCounter += 1;
      if (quietCounter >= 2) {
        const bottom = y;
        const rowHeight = bottom - start;
        if (rowHeight > Math.max(12, height * 0.015)) {
          rows.push({
            top: start,
            bottom,
            height: rowHeight,
            activeRatio,
            greenRatio,
          });
        }
        inside = false;
        quietCounter = 0;
      }
    } else if (inside) {
      quietCounter = 0;
    }
  }

  if (inside) {
    const bottom = height - 1;
    const rowHeight = bottom - start;
    if (rowHeight > Math.max(12, height * 0.015)) {
      rows.push({
        top: start,
        bottom,
        height: rowHeight,
        activeRatio: 0.02,
        greenRatio: 0,
      });
    }
  }

  return rows;
}

async function recognizeCell(
  worker: Worker,
  sourceCanvas: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): Promise<string> {
  const cellCanvas = createCanvas(sw || 1, sh || 1);
  const context = cellCanvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to get cell context");
  }
  context.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw || 1, sh || 1);

  const {
    data: { text },
  } = await worker.recognize(cellCanvas);

  return cleanupText(text);
}

function deriveTermLabel(file: File, index: number): string {
  const base = file.name.replace(/\.[^.]+$/, "");
  if (base && base.trim().length > 0) {
    return base.trim();
  }
  return `學期成績單 ${index + 1}`;
}

function calculateGpa(score: number, credits: number, rules: GpaRules): number {
  if (!Number.isFinite(score) || !Number.isFinite(credits)) {
    return 0;
  }
  if (score >= rules.gradeA) return 4 * credits;
  if (score >= rules.gradeB) return 3 * credits;
  if (score >= rules.gradeC) return 2 * credits;
  return 0;
}

function formatNumber(value: number | null, fractionDigits = 2): string {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export default function Home() {
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [records, setRecords] = useState<CourseRecord[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [sortKey, setSortKey] = useState<keyof CourseRecord>("score");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [gpaRules, setGpaRules] = useState<GpaRules>(defaultGpaRules);
  const [gpaRuleInputValues, setGpaRuleInputValues] = useState<GpaRuleInputs>(() => ({
    gradeA: defaultGpaRules.gradeA.toString(),
    gradeB: defaultGpaRules.gradeB.toString(),
    gradeC: defaultGpaRules.gradeC.toString(),
  }));
  const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>([]);

  const updateProcessingStep = useCallback(
    (id: string, patch: Partial<ProcessingStep>) => {
      setProcessingSteps((previous) =>
        previous.map((step) => (step.id === id ? { ...step, ...patch } : step)),
      );
    },
    [],
  );

  const handleFileSelection = useCallback((files: FileList | null) => {
    if (!files) return;
    const newImages: UploadedImage[] = Array.from(files).map((file, index) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      termLabel: deriveTermLabel(file, index),
    }));

    setImages((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return newImages;
    });
    setRecords([]);
    setProcessingSteps([]);
    setStatusMessage("");
  }, []);

  const handleRemoveImage = useCallback((index: number) => {
    setImages((prev) => {
      const clone = [...prev];
      const [removed] = clone.splice(index, 1);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return clone;
    });
    setRecords([]);
    setProcessingSteps([]);
    setStatusMessage("");
  }, []);

  const handleRuleInputChange = useCallback((key: keyof GpaRules, rawValue: string) => {
    if (!decimalInputPattern.test(rawValue)) {
      return;
    }

    setGpaRuleInputValues((prev) => ({ ...prev, [key]: rawValue }));
  }, []);

  const commitRuleInput = useCallback(
    (key: keyof GpaRules) => {
      setGpaRuleInputValues((prev) => {
        const trimmed = prev[key].trim();
        const parsed = trimmed === "" ? Number.NaN : Number.parseFloat(trimmed);

        if (!Number.isNaN(parsed)) {
          setGpaRules((rules) => ({ ...rules, [key]: parsed }));
          return { ...prev, [key]: parsed.toString() };
        }

        return { ...prev, [key]: gpaRules[key].toString() };
      });
    },
    [gpaRules],
  );

  const processTranscripts = useCallback(async () => {
    if (!images.length) {
      setStatusMessage("請先上傳至少一張成績單圖片。");
      return;
    }

    setIsProcessing(true);
    setStatusMessage("準備開始分析，請稍候...");
    setRecords([]);

    const initialSteps: ProcessingStep[] = [
      { id: "init-worker", label: "初始化 OCR 引擎", status: "active" },
      { id: "load-language", label: "載入語言與參數", status: "pending" },
      { id: "analyze-images", label: "定位成績表格", status: "pending" },
      { id: "recognize", label: "欄位切割與文字辨識", status: "pending" },
      { id: "summary", label: "彙整統計結果", status: "pending" },
    ];
    setProcessingSteps(initialSteps);

    let worker: Worker | null = null;

    try {
      updateProcessingStep("init-worker", { detail: "建立 OCR 工作執行緒..." });
      worker = await createWorker(undefined, undefined, {
        logger: (message) => {
          if (message.status === "recognizing text") {
            const progress = Math.round(message.progress * 100);
            setStatusMessage(`辨識中文字中... ${progress}%`);
            updateProcessingStep("recognize", {
              status: "active",
              detail: `OCR 進度 ${progress}%`,
            });
          }
        },
      });
      const activeWorker = worker as OcrWorker;

      updateProcessingStep("init-worker", {
        status: "done",
        detail: "OCR 執行緒就緒",
      });

      updateProcessingStep("load-language", {
        status: "active",
        detail: "下載並初始化語言模型...",
      });
      await activeWorker.loadLanguage("eng+chi_tra");
      await activeWorker.initialize("eng+chi_tra");
      await activeWorker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1",
      });
      updateProcessingStep("load-language", {
        status: "done",
        detail: "語言載入完成，開始辨識",
      });

      updateProcessingStep("analyze-images", {
        status: "active",
        detail: `共 ${images.length} 張成績單圖片`,
      });

      const aggregated: CourseRecord[] = [];

      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        const progressLabel = `分析 ${image.termLabel} (${index + 1}/${images.length})`;
        setStatusMessage(progressLabel);
        updateProcessingStep("analyze-images", {
          status: "active",
          detail: progressLabel,
        });
        updateProcessingStep("recognize", {
          status: "active",
          detail: `辨識 ${image.termLabel} 的表格資料`,
        });

        const htmlImage = await loadImage(image.file);
        const { canvas, context } = scaleImage(htmlImage);
        const baseData = context.getImageData(0, 0, canvas.width, canvas.height);
        const bounds = detectTableBounds(baseData);

        const tableCanvas = createCanvas(bounds.width, bounds.height);
        const tableContext = tableCanvas.getContext("2d");
        if (!tableContext) {
          throw new Error("無法取得表格繪圖環境");
        }
        tableContext.drawImage(
          canvas,
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          0,
          0,
          bounds.width,
          bounds.height,
        );
        const tableData = tableContext.getImageData(0, 0, bounds.width, bounds.height);
        const rows = detectRows(tableData);

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
          const row = rows[rowIndex];
          if (row.greenRatio > 0.1) {
            continue;
          }
          const rowHeight = row.bottom - row.top;
          if (rowHeight < Math.max(18, bounds.height * 0.02)) {
            continue;
          }

          const course: CourseRecord = {
            id: `${image.termLabel}-${index}-${rowIndex}`,
            term: image.termLabel,
            courseNumber: "",
            requirement: "",
            courseName: "",
            englishName: "",
            courseCode: "",
            stage: "",
            credits: null,
            score: null,
            remarks: "",
          };

          for (const column of columnLayout) {
            const sx = Math.max(0, Math.floor(bounds.width * column.start));
            const ex = Math.min(
              bounds.width,
              Math.ceil(bounds.width * column.end),
            );
            const sw = Math.max(1, ex - sx);
            const sy = Math.max(0, row.top);
            const sh = Math.max(1, rowHeight);
            const rawText = await recognizeCell(
              worker,
              tableCanvas,
              sx,
              sy,
              sw,
              sh,
            );
            const cleaned = cleanupText(rawText);
            switch (column.key) {
              case "credits":
                course.credits = parseNumber(cleaned);
                break;
              case "score":
                course.score = parseNumber(cleaned);
                break;
              default:
                (course as Record<string, unknown>)[column.key] = cleaned;
            }
          }

          const hasValidCourseNumber = /\d{4,}/.test(course.courseNumber);
          const hasValidScore = typeof course.score === "number" && course.score !== null;
          const looksLikeSummary = /學期成績|平均|Credits|總分/.test(
            `${course.courseName} ${course.remarks}`,
          );

          if (hasValidCourseNumber && hasValidScore && !looksLikeSummary) {
            aggregated.push(course);
          }
        }
      }

      updateProcessingStep("analyze-images", {
        status: "done",
        detail: `完成 ${images.length} 張圖片分析`,
      });
      updateProcessingStep("recognize", {
        status: "done",
        detail: "OCR 辨識完成",
      });

      updateProcessingStep("summary", {
        status: "active",
        detail: "計算學分與統計資訊...",
      });

      setRecords(aggregated);
      if (aggregated.length === 0) {
        setStatusMessage("完成辨識，但未偵測到有效的課程資料。請檢查圖片或調整設定。");
        updateProcessingStep("summary", {
          status: "error",
          detail: "未偵測到有效資料",
        });
      } else {
        const successMessage = `完成！共擷取 ${aggregated.length} 筆課程資料。`;
        setStatusMessage(successMessage);
        updateProcessingStep("summary", {
          status: "done",
          detail: successMessage,
        });
      }
    } catch (error) {
      console.error(error);
      setStatusMessage("辨識過程發生錯誤，請稍後再試或更換圖片。");
      setProcessingSteps((previous) =>
        previous.map((step, index) =>
          index === previous.length - 1
            ? { ...step, status: "error", detail: "處理過程發生錯誤" }
            : step,
        ),
      );
    } finally {
      if (worker) {
        await worker.terminate();
      }
      setIsProcessing(false);
    }
  }, [images, updateProcessingStep]);

  const sortedRecords = useMemo(() => {
    const clone = [...records];
    clone.sort((a, b) => {
      const direction = sortDirection === "asc" ? 1 : -1;
      const aValue = a[sortKey];
      const bValue = b[sortKey];
      if (typeof aValue === "number" && typeof bValue === "number") {
        return direction * ((aValue ?? 0) - (bValue ?? 0));
      }
      const aText = `${aValue ?? ""}`.toLowerCase();
      const bText = `${bValue ?? ""}`.toLowerCase();
      if (aText < bText) return -1 * direction;
      if (aText > bText) return 1 * direction;
      return 0;
    });
    return clone;
  }, [records, sortDirection, sortKey]);

  const summary = useMemo(() => {
    if (!records.length) {
      return {
        totalCredits: 0,
        weightedScore: 0,
        averageScore: 0,
        gpa: 0,
      };
    }
    let creditSum = 0;
    let weightedScore = 0;
    let gpaSum = 0;
    let countedCourses = 0;

    for (const record of records) {
      if (record.credits && record.score !== null) {
        creditSum += record.credits;
        weightedScore += record.score * record.credits;
        gpaSum += calculateGpa(record.score, record.credits, gpaRules);
      }
      if (record.score !== null) {
        countedCourses += 1;
      }
    }

    const averageScore = countedCourses
      ? records.reduce((acc, current) => acc + (current.score ?? 0), 0) / countedCourses
      : 0;

    const gpa = creditSum > 0 ? gpaSum / creditSum : 0;

    return {
      totalCredits: creditSum,
      weightedScore: creditSum > 0 ? weightedScore / creditSum : 0,
      averageScore,
      gpa,
    };
  }, [records, gpaRules]);

  const handleSort = useCallback((key: keyof CourseRecord) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
  }, [sortKey]);

  useEffect(() => {
    return () => {
      images.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, [images]);

  const stepIcons: Record<ProcessingStep["status"], string> = {
    pending: "🕒",
    active: "⚙️",
    done: "✅",
    error: "⚠️",
  };

  const stepTone: Record<ProcessingStep["status"], string> = {
    pending: "border-slate-700/60 bg-[#0b2234]",
    active: "border-sky-400/40 bg-[#0f2f45]",
    done: "border-emerald-400/40 bg-[#0c362f]",
    error: "border-rose-500/40 bg-[#3b141a]",
  };

  const stepTextTone: Record<ProcessingStep["status"], string> = {
    pending: "text-slate-200",
    active: "text-sky-200",
    done: "text-emerald-200",
    error: "text-rose-200",
  };

  return (
    <div className="min-h-screen bg-[#020b16] text-slate-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-5 py-12 sm:px-8 lg:px-10">
        <header className="rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-[#071b2a] to-[#0b2234] px-8 py-10 text-center shadow-[0_40px_120px_-50px_rgba(16,185,129,0.55)]">
          <span className="mx-auto inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-5 py-2 text-sm font-semibold text-emerald-200">
            智慧成績單助理 Smart Transcript Assistant
          </span>
          <h1 className="mt-5 text-4xl font-semibold leading-snug text-emerald-100 sm:text-5xl">
            成績整理、排序與 GPA 計算，一頁完成
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-slate-300 sm:text-base">
            依照清楚的流程上傳成績單、調整辨識設定、啟動 OCR，系統即時回傳整理好的課程清單與客製化 GPA 統計。
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3 text-xs font-semibold text-emerald-200/80 sm:text-sm">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2">① 上傳成績單</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2">② 設定規則</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2">③ 智慧辨識</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2">④ 彙整結果</span>
          </div>
        </header>

        <section className="rounded-3xl border border-emerald-500/20 bg-[#071b2a] px-6 py-8 sm:px-8 sm:py-9 lg:px-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-500/10 text-lg font-semibold text-emerald-200">
                1
              </span>
              <div>
                <h2 className="text-lg font-semibold text-emerald-100 sm:text-xl">上傳成績單圖片</h2>
                <p className="mt-1 text-xs text-slate-300 sm:text-sm">
                  支援一次匯入多張圖片，保留彩色版本可提升綠色標題列的定位準確度。
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-400">最多 20 張 PNG、JPG 或 JPEG 檔案</p>
          </div>
          <label className="mt-6 flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-emerald-500/35 bg-[#041321] px-8 py-12 text-center transition hover:border-emerald-400/60 hover:bg-[#062035]">
            <span className="text-base font-medium text-emerald-100">拖曳或點擊選擇成績單圖片</span>
            <span className="text-xs text-slate-400">支援 PNG、JPG、JPEG 等常見格式</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => handleFileSelection(event.target.files)}
            />
          </label>
          {images.length > 0 && (
            <div className="mt-8 space-y-5">
              <h3 className="text-sm font-semibold text-emerald-100 sm:text-base">已選擇的成績單 ({images.length})</h3>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {images.map((item, index) => (
                  <div
                    key={item.previewUrl}
                    className="flex flex-col gap-4 rounded-2xl border border-emerald-500/20 bg-[#041321] p-4 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-emerald-100 sm:text-sm">{item.termLabel}</span>
                      <button
                        type="button"
                        className="text-xs font-semibold text-rose-300 transition hover:text-rose-200"
                        onClick={() => handleRemoveImage(index)}
                      >
                        移除
                      </button>
                    </div>
                    <div className="relative h-44 w-full overflow-hidden rounded-xl border border-emerald-500/20 bg-[#020b16]">
                      <img
                        src={item.previewUrl}
                        alt={item.termLabel}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-emerald-500/20 bg-[#071b2a] px-6 py-8 sm:px-8 sm:py-9 lg:px-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-500/10 text-lg font-semibold text-emerald-200">
                2
              </span>
              <div>
                <h2 className="text-lg font-semibold text-emerald-100 sm:text-xl">設定客製化 GPA 規則</h2>
                <p className="mt-1 text-xs text-slate-300 sm:text-sm">
                  預設為 80 分 = 4.0、70 分 = 3.0、60 分 = 2.0，可依校系規定調整臨界值。
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-400">調整後會立即反映於下方統計</p>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-2 rounded-2xl border border-emerald-500/20 bg-[#041321] p-5">
              <span className="text-xs font-semibold text-slate-300 sm:text-sm">A (4.0) 門檻</span>
              <input
                type="text"
                inputMode="decimal"
                value={gpaRuleInputValues.gradeA}
                onChange={(event) => handleRuleInputChange("gradeA", event.target.value)}
                onBlur={() => commitRuleInput("gradeA")}
                className="rounded-lg border border-emerald-500/30 bg-[#020b16] px-3 py-2 text-sm text-emerald-100 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
              />
            </label>
            <label className="flex flex-col gap-2 rounded-2xl border border-emerald-500/20 bg-[#041321] p-5">
              <span className="text-xs font-semibold text-slate-300 sm:text-sm">B (3.0) 門檻</span>
              <input
                type="text"
                inputMode="decimal"
                value={gpaRuleInputValues.gradeB}
                onChange={(event) => handleRuleInputChange("gradeB", event.target.value)}
                onBlur={() => commitRuleInput("gradeB")}
                className="rounded-lg border border-emerald-500/30 bg-[#020b16] px-3 py-2 text-sm text-emerald-100 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
              />
            </label>
            <label className="flex flex-col gap-2 rounded-2xl border border-emerald-500/20 bg-[#041321] p-5">
              <span className="text-xs font-semibold text-slate-300 sm:text-sm">C (2.0) 門檻</span>
              <input
                type="text"
                inputMode="decimal"
                value={gpaRuleInputValues.gradeC}
                onChange={(event) => handleRuleInputChange("gradeC", event.target.value)}
                onBlur={() => commitRuleInput("gradeC")}
                className="rounded-lg border border-emerald-500/30 bg-[#020b16] px-3 py-2 text-sm text-emerald-100 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
              />
            </label>
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-500/20 bg-[#071b2a] px-6 py-8 sm:px-8 sm:py-9 lg:px-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-500/10 text-lg font-semibold text-emerald-200">
                3
              </span>
              <div>
                <h2 className="text-lg font-semibold text-emerald-100 sm:text-xl">啟動智慧辨識流程</h2>
                <p className="mt-1 text-xs text-slate-300 sm:text-sm">
                  自動定位表格、進行 OCR、整理課程與統計數據，進度會即時顯示於下方。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={processTranscripts}
              disabled={isProcessing || images.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-[#041321] shadow-[0_20px_45px_-25px_rgba(16,185,129,0.8)] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
            >
              {isProcessing ? "系統分析中..." : "開始辨識"}
            </button>
          </div>

          <div className="mt-6 space-y-4">
            {statusMessage && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {statusMessage}
              </div>
            )}

            <div className="rounded-2xl border border-emerald-500/20 bg-[#041321] p-6">
              <h3 className="text-sm font-semibold text-emerald-100 sm:text-base">即時處理進度</h3>
              <p className="mt-1 text-xs text-slate-400">
                依序顯示每個步驟的狀態與細節說明，掌握整體辨識過程。
              </p>
              <ul className="mt-4 space-y-3">
                {processingSteps.length > 0 ? (
                  processingSteps.map((step) => (
                    <li
                      key={step.id}
                      className={`rounded-2xl border px-4 py-4 transition ${stepTone[step.status]}`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-xl" aria-hidden="true">{stepIcons[step.status]}</span>
                        <div>
                          <p className={`text-sm font-semibold ${stepTextTone[step.status]}`}>
                            {step.label}
                          </p>
                          <p className="mt-1 text-xs text-slate-300">
                            {step.detail ?? "等待開始"}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))
                ) : (
                  <li className="rounded-2xl border border-dashed border-emerald-500/25 bg-[#020b16] px-4 py-6 text-center text-sm text-slate-400">
                    尚未開始辨識。請完成前兩步驟後點擊「開始辨識」。
                  </li>
                )}
              </ul>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-500/20 bg-[#071b2a] px-6 py-8 sm:px-8 sm:py-9 lg:px-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-500/10 text-lg font-semibold text-emerald-200">
                4
              </span>
              <div>
                <h2 className="text-lg font-semibold text-emerald-100 sm:text-xl">成果總覽與排序</h2>
                <p className="mt-1 text-xs text-slate-300 sm:text-sm">
                  彙整所有課程資料，提供學分統計、成績排序與自訂 GPA 計算。
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-400">點擊欄位標題即可切換排序方式</p>
          </div>

          <div className="mt-6 grid gap-4 rounded-2xl border border-emerald-500/20 bg-[#041321] p-6 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-slate-400">總學分</span>
              <span className="text-2xl font-semibold text-emerald-100">
                {formatNumber(summary.totalCredits, 1)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-slate-400">加權平均分數</span>
              <span className="text-2xl font-semibold text-emerald-100">
                {formatNumber(summary.weightedScore)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-slate-400">算術平均分數</span>
              <span className="text-2xl font-semibold text-emerald-100">
                {formatNumber(summary.averageScore)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-slate-400">自訂 GPA</span>
              <span className="text-2xl font-semibold text-emerald-100">
                {formatNumber(summary.gpa)}
              </span>
            </div>
          </div>
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full divide-y divide-emerald-500/20 text-sm text-slate-200">
              <thead className="bg-[#041b2a] text-xs uppercase tracking-wide text-emerald-200">
                <tr>
                  <th className="px-3 py-3 text-left">學期</th>
                  {columnLayout.map((column) => (
                    <th
                      key={column.key}
                      className="cursor-pointer px-3 py-3 text-left transition hover:text-emerald-200/80"
                      onClick={() => handleSort(column.key as keyof CourseRecord)}
                    >
                      {column.label}
                      {sortKey === column.key && (
                        <span className="ml-1 text-emerald-300">
                          {sortDirection === "asc" ? "▲" : "▼"}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-500/10">
                {sortedRecords.map((record, index) => (
                  <tr
                    key={record.id}
                    className={index % 2 === 0 ? "bg-[#031321]" : "bg-[#04192a]"}
                  >
                    <td className="px-3 py-3 text-slate-300">{record.term}</td>
                    <td className="px-3 py-3 font-medium text-emerald-100">
                      {record.courseNumber || "-"}
                    </td>
                    <td className="px-3 py-3 text-slate-300">{record.requirement || "-"}</td>
                    <td className="px-3 py-3 text-slate-300">{record.courseName || "-"}</td>
                    <td className="px-3 py-3 text-slate-300">{record.englishName || "-"}</td>
                    <td className="px-3 py-3 text-slate-300">{record.courseCode || "-"}</td>
                    <td className="px-3 py-3 text-slate-300">{record.stage || "-"}</td>
                    <td className="px-3 py-3 text-right text-emerald-100">
                      {record.credits !== null ? formatNumber(record.credits, 1) : "-"}
                    </td>
                    <td className="px-3 py-3 text-right text-emerald-100">
                      {record.score !== null ? formatNumber(record.score) : "-"}
                    </td>
                    <td className="px-3 py-3 text-slate-400">{record.remarks || "-"}</td>
                  </tr>
                ))}
                {!records.length && (
                  <tr>
                    <td
                      colSpan={columnLayout.length + 1}
                      className="px-3 py-10 text-center text-slate-400"
                    >
                      尚未有資料，請上傳成績單並開始辨識。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-500/20 bg-[#071b2a] px-6 py-8 sm:px-8 sm:py-9 lg:px-10">
          <h2 className="text-lg font-semibold text-emerald-100 sm:text-xl">使用小提示</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-300">
            <li>建議使用彩色版本成績單，以提升綠色標題列的偵測穩定度。</li>
            <li>若辨識結果偏差，可調整 GPA 門檻、重新拍照或裁切，使表格更清晰。</li>
            <li>處理大量圖片時請耐心等待，OCR 需逐欄辨識以維持高準確度。</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

