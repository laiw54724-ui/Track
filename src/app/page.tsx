"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createWorker, PSM, Worker } from "tesseract.js";
import { AppShell } from "../components/AppShell";
import { TopBar } from "../components/TopBar";
import { UploadPanel } from "../components/UploadPanel";
import { GpaRulesCard } from "../components/GpaRulesCard";
import { StatsSummary } from "../components/StatsSummary";
import { RecordsTable } from "../components/RecordsTable";
import type { AlertTone } from "../styles/tokens";

export type UploadedImage = {
  file: File;
  previewUrl: string;
  termLabel: string;
};

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DetectedRow = {
  top: number;
  bottom: number;
  height: number;
  activeRatio: number;
  greenRatio: number;
};

export type CourseRecord = {
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

export type ColumnDefinition = {
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

export type GpaRules = {
  gradeA: number;
  gradeB: number;
  gradeC: number;
};

type OcrWorker = Worker & {
  loadLanguage: Worker["load"];
  initialize: Worker["reinitialize"];
};

export type ProcessingStep = {
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

function normalizeDecimalInput(raw: string): string {
  const collapsedWhitespace = raw.replace(/\s+/g, "");
  const normalizedDigits = collapsedWhitespace
    .replace(/[．。]/g, ".")
    .replace(/[０-９]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xff10 + 0x30));

  let hasDecimalPoint = false;
  let result = "";
  for (const character of normalizedDigits) {
    if (character >= "0" && character <= "9") {
      result += character;
      continue;
    }
    if (character === "." && !hasDecimalPoint) {
      result += character;
      hasDecimalPoint = true;
    }
  }

  return result;
}

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
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
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

function detectTableBounds(imageData: ImageData): Bounds {
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

export default function Home() {
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [records, setRecords] = useState<CourseRecord[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [statusTone, setStatusTone] = useState<AlertTone | null>(null);
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
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [denseMode, setDenseMode] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const cancelRequestedRef = useRef(false);

  const updateProcessingStep = useCallback(
    (id: string, patch: Partial<ProcessingStep>) => {
      setProcessingSteps((previous) => previous.map((step) => (step.id === id ? { ...step, ...patch } : step)));
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
    setStatusTone(null);
    setOcrProgress(null);
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
    setStatusTone(null);
    setOcrProgress(null);
  }, []);

  const handleRuleInputChange = useCallback((key: keyof GpaRules, rawValue: string) => {
    const normalized = normalizeDecimalInput(rawValue);
    if (!decimalInputPattern.test(normalized)) {
      return;
    }

    setGpaRuleInputValues((prev) => ({ ...prev, [key]: normalized }));

    if (normalized === "" || normalized === ".") {
      return;
    }

    const parsed = Number.parseFloat(normalized);
    if (!Number.isNaN(parsed)) {
      setGpaRules((rules) => ({ ...rules, [key]: parsed }));
    }
  }, []);

  const commitRuleInput = useCallback(
    (key: keyof GpaRules) => {
      setGpaRuleInputValues((prev) => {
        const normalized = normalizeDecimalInput(prev[key]);
        if (normalized === "") {
          return { ...prev, [key]: gpaRules[key].toString() };
        }

        const parsed = Number.parseFloat(normalized);
        if (Number.isNaN(parsed)) {
          return { ...prev, [key]: gpaRules[key].toString() };
        }

        setGpaRules((rules) => ({ ...rules, [key]: parsed }));
        return { ...prev, [key]: parsed.toString() };
      });
    },
    [gpaRules],
  );

  const processTranscripts = useCallback(async () => {
    if (!images.length) {
      setStatusMessage("請先上傳至少一張成績單圖片。");
      setStatusTone("info");
      return;
    }

    setIsProcessing(true);
    setStatusTone("info");
    setStatusMessage("準備開始分析，請稍候...");
    setRecords([]);
    setOcrProgress(0);
    cancelRequestedRef.current = false;

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
            setOcrProgress(progress);
            updateProcessingStep("recognize", {
              status: "active",
              detail: `OCR 進度 ${progress}%`,
            });
          }
        },
      });
      workerRef.current = worker;

      updateProcessingStep("init-worker", { status: "done", detail: "工作執行緒建立完成" });

      const extendedWorker = worker as OcrWorker;
      updateProcessingStep("load-language", { status: "active", detail: "載入繁體中文與英文模型..." });
      await extendedWorker.loadLanguage("eng+chi_tra");
      await extendedWorker.initialize("eng+chi_tra");
      await extendedWorker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1",
      });
      updateProcessingStep("load-language", { status: "done", detail: "語言載入完成" });

      const aggregated: CourseRecord[] = [];

      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        updateProcessingStep("analyze-images", {
          status: "active",
          detail: `分析 ${image.termLabel} (${index + 1}/${images.length})`,
        });
        setStatusMessage(`分析 ${image.termLabel} (${index + 1}/${images.length})`);
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

        updateProcessingStep("recognize", {
          status: "active",
          detail: `辨識第 ${index + 1} 張 (${rows.length} 行)`,
        });

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
            const ex = Math.min(bounds.width, Math.ceil(bounds.width * column.end));
            const sw = Math.max(1, ex - sx);
            const sy = Math.max(0, row.top);
            const sh = Math.max(1, rowHeight);
            const rawText = await recognizeCell(worker, tableCanvas, sx, sy, sw, sh);
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
          const looksLikeSummary = /學期成績|平均|Credits|總分/.test(`${course.courseName} ${course.remarks}`);

          if (hasValidCourseNumber && hasValidScore && !looksLikeSummary) {
            aggregated.push(course);
          }
        }
      }

      updateProcessingStep("analyze-images", { status: "done", detail: "表格定位完成" });
      updateProcessingStep("recognize", { status: "done", detail: "文字辨識完成" });

      setRecords(aggregated);
      if (aggregated.length === 0) {
        setStatusMessage("完成辨識，但未偵測到有效的課程資料。請檢查圖片或調整設定。");
        setStatusTone("info");
        updateProcessingStep("summary", {
          status: "error",
          detail: "未偵測到有效資料",
        });
      } else {
        const successMessage = `完成！共擷取 ${aggregated.length} 筆課程資料。`;
        setStatusMessage(successMessage);
        setStatusTone("success");
        updateProcessingStep("summary", {
          status: "done",
          detail: successMessage,
        });
      }
    } catch (error) {
      console.error(error);
      if (cancelRequestedRef.current) {
        setStatusMessage("辨識已取消。");
        setStatusTone("info");
        setProcessingSteps((previous) =>
          previous.map((step) =>
            step.id === "summary"
              ? { ...step, status: "error", detail: "使用者已取消辨識" }
              : step,
          ),
        );
      } else {
        setStatusMessage("辨識過程發生錯誤，請稍後再試或更換圖片。");
        setStatusTone("error");
        setProcessingSteps((previous) =>
          previous.map((step, index) =>
            index === previous.length - 1
              ? { ...step, status: "error", detail: "處理過程發生錯誤" }
              : step,
          ),
        );
      }
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch (terminationError) {
          console.error(terminationError);
        }
        if (workerRef.current === worker) {
          workerRef.current = null;
        }
      }
      setIsProcessing(false);
      setOcrProgress(null);
    }
  }, [images, updateProcessingStep]);

  const cancelProcessing = useCallback(async () => {
    cancelRequestedRef.current = true;
    const activeWorker = workerRef.current;
    if (activeWorker) {
      try {
        await activeWorker.terminate();
      } catch (error) {
        console.error(error);
      }
      workerRef.current = null;
    }
    setIsProcessing(false);
    setOcrProgress(null);
    setStatusMessage("已取消辨識流程。");
    setStatusTone("info");
  }, []);

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

  const handleSort = useCallback(
    (key: keyof CourseRecord) => {
      if (sortKey === key) {
        setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDirection("desc");
      }
    },
    [sortKey],
  );

  useEffect(() => {
    return () => {
      images.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, [images]);

  const dismissAlert = useCallback(() => {
    setStatusMessage("");
    setStatusTone(null);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage((prev) => (prev === "zh" ? "en" : "zh"));
  }, []);

  return (
    <AppShell
      topBar={
        <TopBar
          onPrimaryAction={processTranscripts}
          primaryDisabled={isProcessing || images.length === 0}
          isProcessing={isProcessing}
          onCancel={cancelProcessing}
          processingPercent={ocrProgress}
          language={language}
          onLanguageToggle={toggleLanguage}
        />
      }
      alert={
        statusMessage
          ? {
              tone: statusTone ?? "info",
              message: statusMessage,
              onDismiss: dismissAlert,
            }
          : null
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="space-y-6">
          <UploadPanel
            images={images}
            onFilesSelected={handleFileSelection}
            onRemoveImage={handleRemoveImage}
            isProcessing={isProcessing}
            processingSteps={processingSteps}
            processingPercent={ocrProgress}
          />
          <GpaRulesCard values={gpaRuleInputValues} onChange={handleRuleInputChange} onCommit={commitRuleInput} />
        </div>
        <div className="space-y-6">
          <StatsSummary
            totalCredits={summary.totalCredits}
            weightedScore={summary.weightedScore}
            averageScore={summary.averageScore}
            gpa={summary.gpa}
          />
          <RecordsTable
            records={sortedRecords}
            columns={columnLayout}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={handleSort}
            dense={denseMode}
            onToggleDense={() => setDenseMode((prev) => !prev)}
          />
          <section className="rounded-[16px] border border-white/8 bg-slate-900/60 p-6 text-sm text-slate-300 shadow-[0_18px_36px_-18px_rgba(8,47,73,0.55)]">
            <h2 className="text-base font-semibold text-slate-100">使用小提示</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>彩色成績單有助於準確找到綠色表頭，建議優先使用。</li>
              <li>若辨識結果偏差，可調整 GPA 門檻、重新拍照或裁切圖片。</li>
              <li>進行大量辨識時，可透過取消按鈕終止流程後重新上傳。</li>
            </ul>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
