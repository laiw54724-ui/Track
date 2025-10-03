"use client";

import { uiTokens } from "../styles/tokens";

const spinnerClass = "inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent";

type TopBarProps = {
  onPrimaryAction: () => void;
  primaryDisabled: boolean;
  isProcessing: boolean;
  onCancel: () => void;
  processingPercent: number | null;
  language: "zh" | "en";
  onLanguageToggle: () => void;
};

export function TopBar({
  onPrimaryAction,
  primaryDisabled,
  isProcessing,
  onCancel,
  processingPercent,
  language,
  onLanguageToggle,
}: TopBarProps) {
  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-white/5 bg-slate-900/40 px-5 py-4 shadow-[0_10px_40px_-20px_rgba(8,47,73,0.65)] sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <p className="text-sm uppercase tracking-[0.4em] text-slate-400">Smart Transcript</p>
        <h1 className="text-2xl font-semibold text-slate-100 sm:text-3xl">智慧成績單助理</h1>
        <p className="text-sm text-slate-300">上傳、校對、統計一頁完成，支援自訂 GPA 門檻。</p>
      </div>
      <div className="flex flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onLanguageToggle}
          className={`flex items-center justify-center gap-2 ${uiTokens.radius.lg} border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400`}
          title="切換語言"
        >
          <span aria-hidden>🌐</span>
          <span>{language === "zh" ? "中文" : "English"}</span>
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onPrimaryAction}
            disabled={primaryDisabled}
            className={`flex min-w-[10rem] items-center justify-center gap-2 ${uiTokens.radius.lg} border border-emerald-400/60 bg-emerald-500/90 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-slate-300`}
            title={isProcessing ? "正在辨識" : "開始辨識"}
          >
            {isProcessing ? (
              <>
                <span className={spinnerClass} aria-hidden />
                <span>
                  辨識中{typeof processingPercent === "number" ? ` ${processingPercent}%` : ""}
                </span>
              </>
            ) : (
              <>
                <span aria-hidden>🚀</span>
                <span>開始辨識</span>
              </>
            )}
          </button>
          {isProcessing ? (
            <button
              type="button"
              onClick={onCancel}
              className={`hidden items-center justify-center gap-2 ${uiTokens.radius.lg} border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 sm:flex`}
              title="取消辨識"
            >
              <span aria-hidden>✖</span>
              <span>取消</span>
            </button>
          ) : null}
        </div>
        {isProcessing ? (
          <button
            type="button"
            onClick={onCancel}
            className={`flex items-center justify-center gap-2 ${uiTokens.radius.lg} border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 sm:hidden`}
            title="取消辨識"
          >
            <span aria-hidden>✖</span>
            <span>取消</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
