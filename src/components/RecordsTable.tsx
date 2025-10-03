"use client";

import { uiTokens } from "../styles/tokens";
import type { CourseRecord, ColumnDefinition } from "../app/page";

type SortDirection = "asc" | "desc";

/* eslint-disable no-unused-vars */
type RecordsTableProps = {
  records: CourseRecord[];
  columns: ColumnDefinition[];
  sortKey: keyof CourseRecord;
  sortDirection: SortDirection;
  onSort: (key: keyof CourseRecord) => void;
  dense: boolean;
  onToggleDense: () => void;
};
/* eslint-enable no-unused-vars */

const numericKeys: Array<keyof CourseRecord> = ["credits", "score"];

function SortIndicator({ direction }: { direction: SortDirection }) {
  return (
    <svg aria-hidden className="h-3 w-3" viewBox="0 0 8 8" fill="currentColor">
      {direction === "asc" ? <path d="M4 1l3 4H1z" /> : <path d="M4 7L1 3h6z" />}
    </svg>
  );
}

function formatCellValue(value: CourseRecord[keyof CourseRecord], key: keyof CourseRecord) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (numericKeys.includes(key) && typeof value === "number") {
    const fractionDigits = key === "credits" ? 1 : 2;
    return value.toLocaleString(undefined, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  }
  return value;
}

export function RecordsTable({
  records,
  columns,
  sortKey,
  sortDirection,
  onSort,
  dense,
  onToggleDense,
}: RecordsTableProps) {
  const rowPadding = dense ? "py-2" : "py-3";

  return (
    <section
      className={`${uiTokens.surface.card} ${uiTokens.border.subtle} ${uiTokens.shadow.card} ${uiTokens.radius.xl} ${uiTokens.spacing.cardPadding} space-y-4`}
      aria-label="課程清單"
    >
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">步驟四・課程明細</h2>
          <p className="text-sm text-slate-400">依欄位排序並可切換密集模式，快速檢視成績。</p>
        </div>
        <button
          type="button"
          onClick={onToggleDense}
          className={`flex items-center gap-2 ${uiTokens.radius.lg} border border-white/10 px-3 py-2 text-xs uppercase tracking-wide text-slate-200 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400`}
          title="切換密集模式"
        >
          <span aria-hidden>☰</span>
          <span>{dense ? "還原行距" : "密集模式"}</span>
        </button>
      </header>

      {records.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-white/15 bg-white/5 px-6 py-12 text-center text-sm text-slate-400">
          <svg role="img" aria-label="空狀態" width="120" height="80" viewBox="0 0 120 80" className="text-slate-500/70">
            <rect x="6" y="10" width="108" height="60" rx="12" ry="12" fill="currentColor" opacity="0.1" />
            <path d="M30 32h60v6H30zM30 44h48v6H30z" fill="currentColor" opacity="0.3" />
          </svg>
          <p>尚未擷取到課程資料，完成辨識後會顯示在此。</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="max-h-[480px] overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-950/80 text-xs uppercase tracking-wide text-slate-400 backdrop-blur">
                <tr>
                  <th className="px-3 py-3 text-left">學期</th>
                  {columns.map((column) => {
                    const isActive = sortKey === column.key;
                    const isNumeric = numericKeys.includes(column.key);
                    return (
                      <th key={column.key} scope="col" className={`px-3 py-3 ${isNumeric ? "text-right" : "text-left"}`}>
                        <button
                          type="button"
                          onClick={() => onSort(column.key)}
                          className={`group inline-flex items-center gap-1 text-xs font-medium transition hover:text-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 ${
                            isNumeric ? "justify-end" : ""
                          }`}
                          aria-label={`排序 ${column.label}`}
                        >
                          <span>{column.label}</span>
                          {isActive ? <SortIndicator direction={sortDirection} /> : <span className="text-slate-500 group-hover:opacity-0">—</span>}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-100">
                {records.map((record) => (
                  <tr key={record.id} className={`transition hover:bg-emerald-500/10 ${dense ? "text-xs" : "text-sm"}`}>
                    <td className={`px-3 ${rowPadding} text-slate-300`}>{record.term}</td>
                    {columns.map((column) => {
                      const isNumeric = numericKeys.includes(column.key);
                      const displayValue = formatCellValue(record[column.key], column.key);
                      return (
                        <td
                          key={`${record.id}-${String(column.key)}`}
                          className={`px-3 ${rowPadding} ${isNumeric ? "text-right font-semibold text-emerald-200" : "text-left"}`}
                        >
                          {displayValue}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
