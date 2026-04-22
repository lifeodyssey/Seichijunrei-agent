"use client";

import type { RuntimeResponse } from "../../lib/types";
import { isSearchData } from "../../lib/types";
import NearbyBubble from "../generative/NearbyBubble";
import { useSuggest } from "../../contexts/SuggestContext";

export default function NearbyBubbleWrapper({ response }: { response: RuntimeResponse }) {
  const suggest = useSuggest();
  if (!isSearchData(response.data)) return null;
  return (
    <div className="max-w-[480px] rounded-2xl rounded-bl bg-[var(--color-card)] px-4 py-3">
      <NearbyBubble data={response.data} onSuggest={suggest} />
    </div>
  );
}
