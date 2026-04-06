import { createElement, type ReactNode } from "react";
import type { RuntimeResponse } from "../../lib/types";
import { isQAData, isRouteData, isSearchData } from "../../lib/types";
import PilgrimageGrid from "./PilgrimageGrid";
import NearbyMap from "./NearbyMap";
import RouteVisualization from "./RouteVisualization";
import RoutePlannerWizard from "./RoutePlannerWizard";
import GeneralAnswer from "./GeneralAnswer";
import Clarification from "./Clarification";

export type ComponentRenderer = (
  response: RuntimeResponse,
  onSuggest?: (text: string) => void,
) => ReactNode;

export const COMPONENT_REGISTRY: Record<string, ComponentRenderer> = {
  PilgrimageGrid: (response) =>
    isSearchData(response.data)
      ? createElement(PilgrimageGrid, { data: response.data })
      : null,
  NearbyMap: (response) =>
    isSearchData(response.data)
      ? createElement(NearbyMap, { data: response.data })
      : null,
  RouteVisualization: (response) =>
    isRouteData(response.data)
      ? createElement(RouteVisualization, { data: response.data })
      : null,
  RoutePlannerWizard: (response) =>
    isRouteData(response.data)
      ? createElement(RoutePlannerWizard, { data: response.data })
      : null,
  GeneralAnswer: (response) =>
    isQAData(response.data)
      ? createElement(GeneralAnswer, { data: response.data })
      : null,
  Clarification: (response, onSuggest) => {
    const data = response.data as unknown as Record<string, unknown>;
    const options =
      Array.isArray(data?.options) ? (data.options as string[]) : undefined;
    return createElement(Clarification, {
      message: response.message,
      options,
      onSuggest,
    });
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
    case "plan_selected":
      return "RoutePlannerWizard";
    case "general_qa":
    case "answer_question":
      return "GeneralAnswer";
    case "clarify":
    case "unclear":
    default:
      return "Clarification";
  }
}

export const VISUAL_COMPONENTS = new Set([
  "PilgrimageGrid",
  "NearbyMap",
  "RouteVisualization",
  "RoutePlannerWizard",
]);

export function isVisualResponse(response: RuntimeResponse | null): boolean {
  if (!response) return false;
  return VISUAL_COMPONENTS.has(
    response.ui?.component ?? intentToComponent(response.intent),
  );
}
