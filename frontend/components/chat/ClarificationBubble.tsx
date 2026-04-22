"use client";

import type { RuntimeResponse } from "../../lib/types";
import { isClarifyData } from "../../lib/types";
import type { ClarifyCandidate } from "../../lib/types";
import Clarification from "../generative/Clarification";
import { useSuggest } from "../../contexts/SuggestContext";

interface ClarificationBubbleProps {
  response: RuntimeResponse;
  onSuggest?: (text: string) => void;
}

export default function ClarificationBubble({
  response,
  onSuggest,
}: ClarificationBubbleProps) {
  const contextSuggest = useSuggest();
  const suggest = onSuggest ?? contextSuggest;
  const data = response.data;
  const clarifyData = isClarifyData(data) ? data : null;
  const options =
    clarifyData != null && Array.isArray(clarifyData.options)
      ? (clarifyData.options as string[])
      : undefined;
  const candidates =
    clarifyData != null && Array.isArray(clarifyData.candidates)
      ? (clarifyData.candidates as ClarifyCandidate[])
      : undefined;

  return (
    <div className="max-w-[480px] rounded-2xl rounded-bl bg-[var(--color-card)] px-4 py-3">
      <Clarification
        message={response.message}
        options={options}
        candidates={candidates}
        onSuggest={suggest}
      />
    </div>
  );
}
