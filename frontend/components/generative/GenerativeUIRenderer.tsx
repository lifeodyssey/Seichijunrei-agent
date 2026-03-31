"use client";

import type { RuntimeResponse } from "../../lib/types";
import { COMPONENT_REGISTRY, intentToComponent } from "./registry";

interface GenerativeUIRendererProps {
  response: RuntimeResponse;
  onSuggest?: (text: string) => void;
}

export default function GenerativeUIRenderer({
  response,
  onSuggest,
}: GenerativeUIRendererProps) {
  const componentName = response.ui?.component ?? intentToComponent(response.intent);
  const renderer = COMPONENT_REGISTRY[componentName];

  if (!renderer) {
    return (
      <p className="text-sm text-[var(--color-muted-fg)]">
        Unknown component: {componentName}
      </p>
    );
  }

  return <>{renderer(response, onSuggest)}</>;
}
