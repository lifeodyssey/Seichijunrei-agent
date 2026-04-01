"use client";

import type { QAData } from "../../lib/types";

interface GeneralAnswerProps {
  data: QAData;
}

export default function GeneralAnswer({ data }: GeneralAnswerProps) {
  return (
    <div className="py-2">
      <p className="max-w-[65ch] text-sm font-light leading-loose text-[var(--color-fg)]">
        {data.message}
      </p>
    </div>
  );
}
