"use client";

import type { RuntimeResponse } from "../../lib/types";
import { isSearchData, isRouteData, isQAData } from "../../lib/types";
import PilgrimageGrid from "./PilgrimageGrid";
import NearbyMap from "./NearbyMap";
import RouteVisualization from "./RouteVisualization";
import Clarification from "./Clarification";
import GeneralAnswer from "./GeneralAnswer";

interface IntentRendererProps {
  response: RuntimeResponse;
  onSuggest?: (text: string) => void;
}

export default function IntentRenderer({ response, onSuggest }: IntentRendererProps) {
  const { intent, data } = response;

  switch (intent) {
    case "search_by_bangumi":
      return isSearchData(data) ? <PilgrimageGrid data={data} /> : null;

    case "search_by_location":
      return isSearchData(data) ? <NearbyMap data={data} /> : null;

    case "plan_route":
      return isRouteData(data) ? <RouteVisualization data={data} /> : null;

    case "general_qa":
      return isQAData(data) ? <GeneralAnswer data={data} /> : null;

    case "unclear":
      return <Clarification message={response.message} onSuggest={onSuggest} />;

    default: {
      const _exhaustive: never = intent;
      return <p className="text-sm text-[var(--color-muted-fg)]">Unknown intent: {_exhaustive}</p>;
    }
  }
}
