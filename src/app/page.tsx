"use client";

import NextImage from "next/image";
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
  whitelist?: string;
};

type GpaRules = {
  gradeA: number;
  gradeB: number;
  gradeC: number;
};

const columnLayout: ColumnDefinition[] = [
  { key: "courseNumber", label: "課號", start: 0, end: 0.1, whitelist: "0123456789" },
  { key: "requirement", label: "必選修", start: 0.1, end: 0.18 },
  { key: "courseName", label: "課程名稱", start: 0.18, end: 0.32 },
  { key: "englishName", label: "English Course", start: 0.32, end: 0.56 },
  { key: "courseCode", label: "課程編碼", start: 0.56, end: 0.66 },
  { key: "stage", label: "階段", start: 0.66, end: 0.72 },
  { key: "credits", label: "學分", start: 0.72, end: 0.78, whitelist: "0123456789." },
  { key: "score", label: "成績", start: 0.78, end: 0.86, whitelist: "0123456789." },
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
  whitelist?: string,
): Promise<string> {
  const cellCanvas = createCanvas(sw || 1, sh || 1);
  const context = cellCanvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to get cell context");
  }
  context.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw || 1, sh || 1);

  if (whitelist) {
    await worker.setParameters({ tessedit_char_whitelist: whitelist });
  } else {
    await worker.setParameters({ tessedit_char_whitelist: "" });
  }

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
  const [status, setStatus] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [sortKey, setSortKey] = useState<keyof CourseRecord>("score");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [gpaRules, setGpaRules] = useState<GpaRules>(defaultGpaRules);

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
  }, []);

  const handleRuleChange = useCallback((key: keyof GpaRules, value: number) => {
    setGpaRules((prev) => ({ ...prev, [key]: value }));
  }, []);

  const processTranscripts = useCallback(async () => {
    if (!images.length) {
      setStatus("請先上傳至少一張成績單圖片。");
      return;
    }

    setIsProcessing(true);
    setStatus("初始化 OCR 引擎中...");
    setRecords([]);

    const worker = await createWorker(["eng", "chi_tra"], undefined, {
      logger: (message) => {
        if (message.status === "recognizing text") {
          setStatus(`辨識中文字中... ${Math.round(message.progress * 100)}%`);
        }
      },
    });

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1",
      });

      const aggregated: CourseRecord[] = [];

      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        setStatus(`分析 ${image.termLabel} (${index + 1}/${images.length})`);
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
            // Skip header rows with large green area.
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
              column.whitelist,
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

      setRecords(aggregated);
      if (aggregated.length === 0) {
        setStatus("完成辨識，但未偵測到有效的課程資料。請檢查圖片或調整設定。");
      } else {
        setStatus(`完成！共擷取 ${aggregated.length} 筆課程資料。`);
      }
    } catch (error) {
      console.error(error);
      setStatus("辨識過程發生錯誤，請稍後再試或更換圖片。");
    } finally {
      await worker.terminate();
      setIsProcessing(false);
    }
  }, [images]);

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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-4 text-center sm:text-left">
          <h1 className="text-3xl font-bold text-emerald-300 sm:text-4xl">
            智慧成績單助理 Smart Transcript Assistant
          </h1>
          <p className="text-base text-slate-300 sm:text-lg">
            上傳多張學期成績單，系統將自動定位表格、切割欄位、進行 OCR 辨識，並生成跨學期彙整、成績排序與客製化 GPA 分析。
          </p>
        </header>

        <section className="grid gap-6 rounded-2xl border border-emerald-500/30 bg-slate-900/60 p-6 shadow-xl">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold text-emerald-200">1. 上傳成績單圖片</h2>
            <p className="text-sm text-slate-300">
              支援一次上傳多張圖片。建議保留原始彩色檔案，可提高綠色標題列的偵測準確度。
            </p>
          </div>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-emerald-400/50 bg-slate-950/70 p-8 text-center transition hover:border-emerald-300 hover:bg-slate-900/70">
            <span className="text-base font-medium text-emerald-200">
              點擊或拖曳檔案至此處
            </span>
            <span className="text-xs text-slate-400">
              支援 PNG、JPG、JPEG 等常見圖片格式
            </span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => handleFileSelection(event.target.files)}
            />
          </label>
          {images.length > 0 && (
            <div className="grid gap-4">
              <h3 className="text-lg font-semibold text-emerald-200">已選擇的圖片</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {images.map((item, index) => (
                  <div
                    key={item.previewUrl}
                    className="flex flex-col gap-3 rounded-xl border border-slate-700/60 bg-slate-950/60 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-emerald-100">
                        {item.termLabel}
                      </span>
                      <button
                        type="button"
                        className="text-xs text-rose-300 transition hover:text-rose-200"
                        onClick={() => handleRemoveImage(index)}
                      >
                        移除
                      </button>
                    </div>
                    <div className="relative h-48 w-full overflow-hidden rounded-lg border border-slate-800">
                      <NextImage
                        src={item.previewUrl}
                        alt={item.termLabel}
                        fill
                        className="object-cover"
                        sizes="(max-width: 640px) 100vw, 50vw"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="grid gap-6 rounded-2xl border border-emerald-500/30 bg-slate-900/60 p-6 shadow-xl">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold text-emerald-200">2. 設定 GPA 規則</h2>
            <p className="text-sm text-slate-300">
              預設規則：80 分以上 = 4.0、70 分以上 = 3.0、60 分以上 = 2.0。您可依需求微調門檻值。
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-2 rounded-xl border border-slate-700/60 bg-slate-950/60 p-4">
              <span className="text-sm text-slate-300">A (4.0) 門檻</span>
              <input
                type="number"
                value={gpaRules.gradeA}
                onChange={(event) => handleRuleChange("gradeA", Number(event.target.value))}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-400 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-2 rounded-xl border border-slate-700/60 bg-slate-950/60 p-4">
              <span className="text-sm text-slate-300">B (3.0) 門檻</span>
              <input
                type="number"
                value={gpaRules.gradeB}
                onChange={(event) => handleRuleChange("gradeB", Number(event.target.value))}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-400 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-2 rounded-xl border border-slate-700/60 bg-slate-950/60 p-4">
              <span className="text-sm text-slate-300">C (2.0) 門檻</span>
              <input
                type="number"
                value={gpaRules.gradeC}
                onChange={(event) => handleRuleChange("gradeC", Number(event.target.value))}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-400 focus:outline-none"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={processTranscripts}
            disabled={isProcessing || images.length === 0}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-emerald-500/40 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-600"
          >
            {isProcessing ? "分析中..." : "開始辨識與彙整"}
          </button>
          {status && (
            <div className="rounded-xl border border-emerald-400/40 bg-slate-950/60 p-4 text-sm text-emerald-100">
              {status}
            </div>
          )}
        </section>

        <section className="grid gap-6 rounded-2xl border border-emerald-500/30 bg-slate-900/60 p-6 shadow-xl">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-semibold text-emerald-200">3. 成績統計與排序</h2>
            <p className="text-sm text-slate-300">
              共 {records.length} 門課程，依照任一欄位點擊即可排序。
            </p>
          </div>
          <div className="grid gap-4 rounded-xl border border-slate-700/60 bg-slate-950/60 p-4 sm:grid-cols-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-slate-400">總學分</span>
              <span className="text-xl font-semibold text-emerald-200">
                {formatNumber(summary.totalCredits, 1)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-slate-400">加權平均分數</span>
              <span className="text-xl font-semibold text-emerald-200">
                {formatNumber(summary.weightedScore)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-slate-400">算術平均分數</span>
              <span className="text-xl font-semibold text-emerald-200">
                {formatNumber(summary.averageScore)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-slate-400">自訂 GPA</span>
              <span className="text-xl font-semibold text-emerald-200">
                {formatNumber(summary.gpa)}
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-950/80 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-3 text-left">學期</th>
                  {columnLayout.map((column) => (
                    <th
                      key={column.key}
                      className="cursor-pointer px-3 py-3 text-left transition hover:text-emerald-200"
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
              <tbody className="divide-y divide-slate-800 text-slate-100">
                {sortedRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-800/40">
                    <td className="px-3 py-3 text-slate-300">{record.term}</td>
                    <td className="px-3 py-3 font-medium text-emerald-100">
                      {record.courseNumber || "-"}
                    </td>
                    <td className="px-3 py-3">{record.requirement || "-"}</td>
                    <td className="px-3 py-3">{record.courseName || "-"}</td>
                    <td className="px-3 py-3">{record.englishName || "-"}</td>
                    <td className="px-3 py-3">{record.courseCode || "-"}</td>
                    <td className="px-3 py-3">{record.stage || "-"}</td>
                    <td className="px-3 py-3 text-right">
                      {record.credits !== null ? formatNumber(record.credits, 1) : "-"}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {record.score !== null ? formatNumber(record.score) : "-"}
                    </td>
                    <td className="px-3 py-3 text-slate-300">{record.remarks || "-"}</td>
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

        <section className="grid gap-4 rounded-2xl border border-emerald-500/30 bg-slate-900/60 p-6 shadow-xl">
          <h2 className="text-xl font-semibold text-emerald-200">使用小提示</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300">
            <li>建議使用彩色版本成績單，以提升綠色標題列的偵測穩定度。</li>
            <li>若辨識結果偏差，可調整 GPA 門檻、重新拍照或裁切，使表格更清晰。</li>
            <li>處理大量圖片時請耐心等待，OCR 需逐欄辨識以維持高準確度。</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

