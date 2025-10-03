"use client";

import { uiTokens } from "../styles/tokens";

type StatsSummaryProps = {
  totalCredits: number;
  weightedScore: number;
  averageScore: number;
  gpa: number;
};

function formatNumber(value: number, fractionDigits = 2) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function StatsSummary({ totalCredits, weightedScore, averageScore, gpa }: StatsSummaryProps) {
  const stats = [
    { label: "總學分", value: formatNumber(totalCredits, 1), tone: "text-emerald-200" },
    { label: "加權平均", value: formatNumber(weightedScore), tone: "text-sky-200" },
    { label: "算術平均", value: formatNumber(averageScore), tone: "text-slate-100" },
    { label: "自訂 GPA", value: formatNumber(gpa), tone: "text-amber-200" },
  ];

  return (
    <section
      className={`${uiTokens.surface.card} ${uiTokens.border.subtle} ${uiTokens.shadow.card} ${uiTokens.radius.xl} ${uiTokens.spacing.cardPadding} space-y-4`}
      aria-label="統計資訊"
    >
      <header className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-100">步驟三・統計概覽</h2>
        <p className="text-sm text-slate-400">自動統計所有課程的學分與分數，並套用自訂 GPA 規則。</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        {stats.map((stat) => (
          <article
            key={stat.label}
            className={`flex flex-col gap-1 border border-white/10 bg-white/5 px-4 py-3 ${uiTokens.radius.lg}`}
          >
            <span className="text-xs uppercase tracking-wide text-slate-400">{stat.label}</span>
            <span className={`text-2xl font-semibold ${stat.tone}`}>{stat.value}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
