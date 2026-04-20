"use client";

interface ResultAnchorProps {
  label: string;
  subtitle: string;
  messageId: string;
  onActivate?: (messageId: string) => void;
  isActive: boolean;
  onOpenDrawer?: () => void;
}

export default function ResultAnchor({
  label,
  subtitle,
  messageId,
  onActivate,
  isActive,
  onOpenDrawer,
}: ResultAnchorProps) {
  return (
    <button
      type="button"
      onClick={() => {
        onActivate?.(messageId);
        onOpenDrawer?.();
      }}
      className={[
        "group/anchor flex w-full max-w-[320px] items-center gap-3 rounded-xl border p-3 text-left transition-all",
        isActive
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5 shadow-sm"
          : "border-[var(--color-border)] bg-[var(--color-card)] hover:border-[var(--color-primary)]/60 hover:-translate-y-0.5 hover:shadow-sm",
      ].join(" ")}
      style={{ transitionDuration: "var(--duration-fast)", transitionTimingFunction: "var(--ease-out-quint)" }}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)] text-sm text-white">
        {"\uD83D\uDCCD"}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-[var(--color-fg)]">{label}</span>
        <span className="text-[11px] text-[var(--color-muted-fg)]">{subtitle}</span>
      </span>
      <span className="shrink-0 text-sm text-[var(--color-muted-fg)] transition-transform group-hover/anchor:translate-x-0.5" style={{ transitionDuration: "var(--duration-fast)" }}>
        {"\u203A"}
      </span>
    </button>
  );
}
