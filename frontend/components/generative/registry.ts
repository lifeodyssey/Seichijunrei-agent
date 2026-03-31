import { createElement, type ReactNode } from "react";
import type { RuntimeResponse } from "../../lib/types";
import { isQAData, isRouteData, isSearchData } from "../../lib/types";
import PilgrimageGrid from "./PilgrimageGrid";
import NearbyMap from "./NearbyMap";
import RouteVisualization from "./RouteVisualization";
import GeneralAnswer from "./GeneralAnswer";
import Clarification from "./Clarification";

export type ComponentRenderer = (
  response: RuntimeResponse,
  onSuggest?: (text: string) => void,
) => ReactNode;

export const COMPONENT_REGISTRY: Record<string, ComponentRenderer> = {
  PilgrimageGrid: (response) => {
    const uiData = (response.ui?.props as Record<string, unknown> | undefined)
      ?.data as RuntimeResponse["data"] | undefined;
    if (uiData && isSearchData(uiData)) {
      return createElement(PilgrimageGrid, { data: uiData });
    }

    return isSearchData(response.data)
      ? createElement(PilgrimageGrid, { data: response.data })
      : null;
  },
  NearbyMap: (response) => {
    const uiData = (response.ui?.props as Record<string, unknown> | undefined)
      ?.data as RuntimeResponse["data"] | undefined;
    if (uiData && isSearchData(uiData)) {
      return createElement(NearbyMap, { data: uiData });
    }

    return isSearchData(response.data) ? createElement(NearbyMap, { data: response.data }) : null;
  },
  RouteVisualization: (response) => {
    const uiData = (response.ui?.props as Record<string, unknown> | undefined)
      ?.data as RuntimeResponse["data"] | undefined;
    if (uiData && isRouteData(uiData)) {
      return createElement(RouteVisualization, { data: uiData });
    }

    return isRouteData(response.data)
      ? createElement(RouteVisualization, { data: response.data })
      : null;
  },
  GeneralAnswer: (response) => {
    const uiData = (response.ui?.props as Record<string, unknown> | undefined)
      ?.data as RuntimeResponse["data"] | undefined;
    if (uiData && isQAData(uiData)) {
      return createElement(GeneralAnswer, { data: uiData });
    }

    return isQAData(response.data)
      ? createElement(GeneralAnswer, { data: response.data })
      : null;
  },
  Clarification: (response, onSuggest) => {
    const uiMessage = (response.ui?.props as Record<string, unknown> | undefined)?.message;
    const message = typeof uiMessage === "string" && uiMessage.trim() ? uiMessage : response.message;
    return createElement(Clarification, { message, onSuggest });
  },
};

export function intentToComponent(intent: string): string {
  switch (intent) {
    case "search_by_bangumi":
    case "search_bangumi":
      return "PilgrimageGrid";
    case "search_by_location":
    case "search_nearby":
      return "NearbyMap";
    case "plan_route":
      return "RouteVisualization";
    case "general_qa":
    case "answer_question":
      return "GeneralAnswer";
    case "unclear":
    default:
      return "Clarification";
  }
}
