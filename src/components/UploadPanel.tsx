"use client";

import { ChangeEvent, DragEvent, useCallback, useState } from "react";
import type { UploadedImage, ProcessingStep } from "../app/page";
import { uiTokens } from "../styles/tokens";

/* eslint-disable no-unused-vars */
type UploadPanelProps = {
  images: UploadedImage[];
  onFilesSelected: (files: FileList | null) => void;
  onRemoveImage: (index: number) => void;
  isProcessing: boolean;
  processingSteps: ProcessingStep[];
  processingPercent: number | null;
};
/* eslint-enable no-unused-vars */

const statusTone: Record<ProcessingStep["status"], { badge: string; icon: string }> = {
  pending: {
    badge: "border-white/10 bg-white/5 text-slate-300",
    icon: "🕒",
  },
  active: {
    badge: "border-sky-400/40 bg-sky-500/15 text-sky-100",
    icon: "⚙️",
  },
  done: {
    badge: "border-emerald-400/40 bg-emerald-500/15 text-emerald-100",
    icon: "✅",
  },
  error: {
    badge: "border-rose-500/40 bg-rose-500/15 text-rose-100",
    icon: "⚠️",
  },
};

export function UploadPanel({
  images,
  onFilesSelected,
  onRemoveImage,
  isProcessing,
  processingSteps,
  processingPercent,
}: UploadPanelProps) {
  const [isDragActive, setIsDragActive] = useState(false);

  const handleFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onFilesSelected(event.target.files);
    },
    [onFilesSelected],
  );

  const preventDefaults = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      preventDefaults(event);
      setIsDragActive(false);
      if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
        onFilesSelected(event.dataTransfer.files);
      }
    },
    [onFilesSelected, preventDefaults],
  );

  const handleDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      preventDefaults(event);
      setIsDragActive(true);
    },
    [preventDefaults],
  );

  const handleDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      preventDefaults(event);
      setIsDragActive(false);
    },
    [preventDefaults],
  );

  return (
    <section
      className={`${uiTokens.surface.card} ${uiTokens.border.subtle} ${uiTokens.shadow.card} ${uiTokens.radius.xl} ${uiTokens.spacing.cardPadding} space-y-6`}
      aria-label="上傳學期成績單"
    >
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">步驟一・上傳成績單</h2>
          <span className="text-xs uppercase tracking-wide text-slate-400">{images.length} files</span>
        </div>
        <p className="text-sm text-slate-400">支援一次多張，拖曳或點擊以下區域即可。</p>
      </header>
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={preventDefaults}
        onDrop={handleDrop}
        className={`relative flex min-h-[180px] flex-col items-center justify-center gap-3 border-2 border-dashed px-6 py-10 text-center transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-400 ${uiTokens.radius.xl} ${
          isDragActive ? "border-emerald-400 bg-emerald-500/10" : "border-white/15 bg-slate-900/40"
        }`}
      >
        <input
          id="transcript-upload"
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileInput}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="選擇成績單圖片"
        />
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/5 text-3xl">
          📄
        </div>
        <div className="space-y-1">
          <p className="text-base font-medium text-slate-100">拖曳檔案到此處或點擊選擇</p>
          <p className="text-xs text-slate-400">支援 PNG / JPG / JPEG 等格式</p>
        </div>
      </div>

      {images.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">已選擇檔案</h3>
          <ul className="grid gap-3 sm:grid-cols-2" aria-live="polite">
            {images.map((image, index) => (
              <li
                key={image.previewUrl}
                className={`flex flex-col gap-3 border border-white/10 bg-white/5 p-3 ${uiTokens.radius.lg}`}
              >
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span className="truncate" title={image.file.name}>
                    {image.termLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveImage(index)}
                    className="rounded-full border border-white/10 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-300 transition hover:bg-white/10"
                    title="移除此檔案"
                  >
                    移除
                  </button>
                </div>
                <div className="relative h-36 overflow-hidden rounded-[12px] border border-white/10 bg-slate-900">
                  <img src={image.previewUrl} alt={image.termLabel} className="h-full w-full object-cover" />
                </div>
                <p className="text-[11px] text-slate-400">{(image.file.size / 1024 / 1024).toFixed(2)} MB</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {processingSteps.length > 0 ? (
        <div className="space-y-3" aria-live="polite">
          <div className="flex items-center justify-between text-sm text-slate-300">
            <span>處理進度</span>
            {typeof processingPercent === "number" ? <span>{processingPercent}%</span> : null}
          </div>
          <ol className="space-y-2">
            {processingSteps.map((step) => (
              <li
                key={step.id}
                className={`flex items-start gap-3 rounded-xl border px-3 py-2 text-sm ${statusTone[step.status].badge}`}
              >
                <span className="pt-0.5" aria-hidden>
                  {statusTone[step.status].icon}
                </span>
                <div className="flex-1">
                  <div className="font-medium text-slate-100">{step.label}</div>
                  {step.detail ? <p className="text-xs text-slate-300">{step.detail}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {isProcessing ? (
        <p className="text-xs text-slate-400" aria-live="polite">
          工作執行緒正在處理中，您可於上方按鈕取消。
        </p>
      ) : null}
    </section>
  );
}
