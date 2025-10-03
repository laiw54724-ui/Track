"use client";

import { ReactNode } from "react";
import { uiTokens, AlertTone } from "../styles/tokens";

type AlertProps = {
  tone: AlertTone;
  message: string;
  onDismiss?: () => void;
};

type AppShellProps = {
  topBar: ReactNode;
  children: ReactNode;
  alert?: AlertProps | null;
};

const toneStyles: Record<AlertTone, { container: string; icon: string }> = {
  info: {
    container: "border-sky-500/40 bg-sky-500/10 text-sky-100",
    icon: "text-sky-300",
  },
  success: {
    container: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
    icon: "text-emerald-300",
  },
  error: {
    container: "border-rose-500/40 bg-rose-500/10 text-rose-100",
    icon: "text-rose-300",
  },
};

export function AppShell({ topBar, children, alert }: AppShellProps) {
  return (
    <div className={`min-h-screen ${uiTokens.surface.base} text-slate-100`}> 
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <header>{topBar}</header>
        {alert && alert.message ? (
          <div
            role="status"
            aria-live="polite"
            className={`mt-4 flex items-start gap-3 rounded-2xl border px-4 py-3 ${toneStyles[alert.tone].container}`}
          >
            <span className={`mt-0.5 text-xl ${toneStyles[alert.tone].icon}`}>●</span>
            <div className="flex-1 text-sm leading-relaxed">{alert.message}</div>
            {alert.onDismiss ? (
              <button
                type="button"
                onClick={alert.onDismiss}
                className="rounded-md px-2 py-1 text-xs text-slate-200 transition hover:bg-white/10"
                aria-label="關閉通知"
              >
                關閉
              </button>
            ) : null}
          </div>
        ) : null}
        <main className="mt-6 flex-1">{children}</main>
      </div>
    </div>
  );
}
