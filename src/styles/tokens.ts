export const uiTokens = {
  radius: {
    lg: "rounded-[14px]",
    xl: "rounded-[16px]",
    full: "rounded-full",
  },
  surface: {
    card: "bg-slate-900/60 backdrop-blur-sm",
    base: "bg-slate-950",
  },
  border: {
    subtle: "border border-white/8",
    accent: "border border-emerald-400/40",
  },
  shadow: {
    card: "shadow-[0_18px_36px_-18px_rgba(8,47,73,0.55)]",
  },
  spacing: {
    cardPadding: "p-6",
    sectionGap: "gap-6",
  },
} as const;

export type AlertTone = "info" | "success" | "error";
