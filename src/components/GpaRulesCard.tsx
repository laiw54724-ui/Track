"use client";

import type { GpaRules } from "../app/page";
import { uiTokens } from "../styles/tokens";

/* eslint-disable no-unused-vars */
type GpaRulesCardProps = {
  values: Record<keyof GpaRules, string>;
  onChange: (key: keyof GpaRules, value: string) => void;
  onCommit: (key: keyof GpaRules) => void;
};
/* eslint-enable no-unused-vars */

export function GpaRulesCard({ values, onChange, onCommit }: GpaRulesCardProps) {
  const fields: Array<{ key: keyof GpaRules; label: string; description: string }> = [
    {
      key: "gradeA",
      label: "A (4.0)",
      description: "達到或超過此分數視為 4.0",
    },
    {
      key: "gradeB",
      label: "B (3.0)",
      description: "達到或超過此分數視為 3.0",
    },
    {
      key: "gradeC",
      label: "C (2.0)",
      description: "達到或超過此分數視為 2.0",
    },
  ];

  return (
    <section
      className={`${uiTokens.surface.card} ${uiTokens.border.subtle} ${uiTokens.shadow.card} ${uiTokens.radius.xl} ${uiTokens.spacing.cardPadding} space-y-6`}
      aria-label="GPA 規則設定"
    >
      <header className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-100">步驟二・設定 GPA 門檻</h2>
        <p className="text-sm text-slate-400">可以輸入小數點，系統會即時更新計算規則。</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        {fields.map((field) => (
          <label
            key={field.key}
            className={`flex flex-col gap-2 border border-white/10 bg-white/5 px-4 py-3 ${uiTokens.radius.lg}`}
          >
            <span className="text-sm font-medium text-slate-100">{field.label}</span>
            <input
              type="text"
              inputMode="decimal"
              value={values[field.key]}
              onChange={(event) => onChange(field.key, event.target.value)}
              onBlur={() => onCommit(field.key)}
              className={`${uiTokens.radius.lg} border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none focus:ring-0`}
              aria-label={`${field.label} 門檻`}
            />
            <span className="text-xs text-slate-400">{field.description}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
