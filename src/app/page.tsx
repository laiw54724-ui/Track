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

  const bounds: Bounds = {
    x: Math.max(0, left - Math.round(width * 0.01)),
    y: top,
    width: Math.min(width - Math.max(0, left - Math.round(width * 0.01)), right + Math.round(width * 0.01)) -
      Math.max(0, left - Math.round(width * 0.01)),
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

  const handleRuleChange = useCallback((key: keyof GpaRules, value: number) => {
    setGpaRules((prev) => ({ ...prev, [key]: value }));
  }, []);

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
      { id: "load-language", label: "設定辨識參數", status: "pending" },
      { id: "analyze-images", label: "定位成績表格", status: "pending" },
      { id: "recognize", label: "欄位切割與文字辨識", status: "pending" },
      { id: "summary", label: "彙整統計結果", status: "pending" },
    ];
    setProcessingSteps(initialSteps);

    let worker: Worker | null = null;

    try {
      updateProcessingStep("init-worker", { detail: "建立 OCR 工作執行緒..." });
      worker = await createWorker(["eng", "chi_tra"], undefined, {
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
      updateProcessingStep("init-worker", {
        status: "done",
        detail: "OCR 執行緒就緒",
      });

      updateProcessingStep("load-language", {
        status: "active",
        detail: "套用最佳化辨識參數...",
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1",
      });
      updateProcessingStep("load-language", {
        status: "done",
        detail: "參數設定完成",
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
    pending: "border-slate-200 bg-white",
    active: "border-sky-200 bg-sky-50",
    done: "border-emerald-200 bg-emerald-50",
    error: "border-rose-200 bg-rose-50",
  };

  const stepTextTone: Record<ProcessingStep["status"], string> = {
    pending: "text-slate-600",
    active: "text-sky-700",
    done: "text-emerald-700",
    error: "text-rose-700",
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 via-white to-slate-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 py-16">
        <header className="rounded-3xl bg-white/90 p-10 text-center shadow-2xl ring-1 ring-slate-200 backdrop-blur">
          <span className="mx-auto inline-flex items-center gap-2 rounded-full bg-sky-100 px-4 py-1 text-sm font-medium text-sky-700">
            智慧成績單助理 Smart Transcript Assistant
          </span>
          <h1 className="mt-4 text-4xl font-bold leading-tight text-slate-900 sm:text-5xl">
            上傳．校對．彙整．一次完成的智慧成績單流程
          </h1>
          <p className="mx-auto mt-4 max-w-3xl text-base text-slate-600 sm:text-lg">
            依照清楚的步驟完成成績單整理：上傳圖片、校正設定、啟動辨識，系統會自動產出成績排序與自訂 GPA
            報表，幫助你快速掌握學習軌跡。
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3 text-sm font-medium text-slate-500">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">① 上傳成績單</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">② 校對設定</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">③ 智慧辨識</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">④ 產出報告</span>
          </div>
        </header>

        <section className="rounded-3xl bg-white p-8 shadow-xl ring-1 ring-slate-200">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-lg font-semibold text-sky-700">
                1
              </span>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">上傳成績單圖片</h2>
                <p className="text-sm text-slate-500">
                  支援一次匯入多張圖片，建議保留原始彩色檔案，可提升表格定位準確度。
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-400">最多可上傳 20 張 PNG、JPG、JPEG 圖片</p>
          </div>
          <label className="mt-6 flex cursor-pointer flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed border-slate-300 bg-slate-50/80 p-10 text-center shadow-inner transition hover:border-sky-300 hover:bg-sky-50">
            <span className="text-base font-medium text-slate-700">拖曳或點擊選擇檔案</span>
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
              <h3 className="text-lg font-semibold text-slate-900">已選擇的成績單 ({images.length})</h3>
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {images.map((item, index) => (
                  <div
                    key={item.previewUrl}
                    className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-md shadow-slate-200/80 ring-1 ring-slate-200"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">{item.termLabel}</span>
                      <button
                        type="button"
                        className="text-xs font-semibold text-rose-500 transition hover:text-rose-600"
                        onClick={() => handleRemoveImage(index)}
                      >
                        移除
                      </button>
                    </div>
                    <div className="relative h-48 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
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

        <section className="rounded-3xl bg-white p-8 shadow-xl ring-1 ring-slate-200">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-lg font-semibold text-sky-700">
                2
              </span>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">客製化 GPA 規則</h2>
                <p className="text-sm text-slate-500">
                  使用學校常見等第標準（80 分 = 4.0）為預設值，可依個人規則調整臨界點。
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-400">調整後立即影響下方統計資訊</p>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <span className="text-sm font-medium text-slate-600">A (4.0) 門檻</span>
              <input
                type="number"
                value={gpaRules.gradeA}
                onChange={(event) => handleRuleChange("gradeA", Number(event.target.value))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <label className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <span className="text-sm font-medium text-slate-600">B (3.0) 門檻</span>
              <input
                type="number"
                value={gpaRules.gradeB}
                onChange={(event) => handleRuleChange("gradeB", Number(event.target.value))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <label className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <span className="text-sm font-medium text-slate-600">C (2.0) 門檻</span>
              <input
                type="number"
                value={gpaRules.gradeC}
                onChange={(event) => handleRuleChange("gradeC", Number(event.target.value))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
              />
            </label>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-8 shadow-xl ring-1 ring-slate-200">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-lg font-semibold text-sky-700">
                3
              </span>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">啟動智慧辨識流程</h2>
                <p className="text-sm text-slate-500">
                  系統會自動定位表格、進行 OCR、整理課程與統計數據。進度會即時呈現於下方。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={processTranscripts}
              disabled={isProcessing || images.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-200 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isProcessing ? "系統分析中..." : "開始辨識"}
            </button>
          </div>

          <div className="mt-6 space-y-4">
            {statusMessage && (
              <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-700">
                {statusMessage}
              </div>
            )}

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
              <h3 className="text-base font-semibold text-slate-800">即時處理進度</h3>
              <p className="mt-1 text-xs text-slate-500">
                依序顯示每個步驟的狀態與細節說明，便於掌握整體流程。
              </p>
              <ul className="mt-4 space-y-3">
                {processingSteps.length > 0 ? (
                  processingSteps.map((step) => (
                    <li
                      key={step.id}
                      className={`rounded-2xl border px-4 py-3 shadow-sm transition ${stepTone[step.status]}`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-xl" aria-hidden="true">{stepIcons[step.status]}</span>
                        <div>
                          <p className={`text-sm font-semibold ${stepTextTone[step.status]}`}>
                            {step.label}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {step.detail ?? "等待開始"}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))
                ) : (
                  <li className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-5 text-center text-sm text-slate-400">
                    尚未開始辨識。請完成前兩步驟後點擊「開始辨識」。
                  </li>
                )}
              </ul>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-8 shadow-xl ring-1 ring-slate-200">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-lg font-semibold text-sky-700">
                4
              </span>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">彙整成果與成績排序</h2>
                <p className="text-sm text-slate-500">
                  完成辨識後，所有課程會在此呈現，可依任一欄位即時排序並檢視統計概覽。
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-400">已擷取 {records.length} 筆課程資料</p>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">總學分</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(summary.totalCredits, 1)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">加權平均分數</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(summary.weightedScore)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">算術平均分數</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(summary.averageScore)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">自訂 GPA</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(summary.gpa)}</p>
            </div>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm text-slate-700">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">學期</th>
                  {columnLayout.map((column) => (
                    <th
                      key={column.key}
                      className="cursor-pointer px-4 py-3 text-left transition hover:text-sky-500"
                      onClick={() => handleSort(column.key as keyof CourseRecord)}
                    >
                      {column.label}
                      {sortKey === column.key && (
                        <span className="ml-1 text-sky-500">
                          {sortDirection === "asc" ? "▲" : "▼"}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500">{record.term}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{record.courseNumber || "-"}</td>
                    <td className="px-4 py-3">{record.requirement || "-"}</td>
                    <td className="px-4 py-3">{record.courseName || "-"}</td>
                    <td className="px-4 py-3">{record.englishName || "-"}</td>
                    <td className="px-4 py-3">{record.courseCode || "-"}</td>
                    <td className="px-4 py-3">{record.stage || "-"}</td>
                    <td className="px-4 py-3 text-right">
                      {record.credits !== null ? formatNumber(record.credits, 1) : "-"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {record.score !== null ? formatNumber(record.score) : "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{record.remarks || "-"}</td>
                  </tr>
                ))}
                {!records.length && (
                  <tr>
                    <td colSpan={columnLayout.length + 1} className="px-4 py-12 text-center text-sm text-slate-400">
                      尚未有資料，請完成上方流程後重新整理結果。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-8 shadow-xl ring-1 ring-slate-200">
          <h2 className="text-xl font-semibold text-slate-900">最佳使用小撇步</h2>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            <li className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              建議使用彩色版本成績單，綠色標題列較易辨識，能提升表格定位與切割精準度。
            </li>
            <li className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              若文字出現辨識錯誤，可重新裁切圖片或調整清晰度，再次上傳後重新分析。
            </li>
            <li className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              大量成績單需要較長時間處理，請保持網頁開啟，系統會在完成時提示結果。
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

