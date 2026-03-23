"use client";

import type { QAData } from "../../lib/types";

interface GeneralAnswerProps {
  data: QAData;
}

export default function GeneralAnswer({ data }: GeneralAnswerProps) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <p className="text-sm text-[var(--color-fg)] leading-relaxed">{data.message}</p>
    </div>
  );
}
