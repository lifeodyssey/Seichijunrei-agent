"use client";

import { createContext, useContext } from "react";

export interface PointSelectionContextValue {
  selectedIds: Set<string>;
  toggle: (id: string) => void;
  clear: () => void;
}

const defaultValue: PointSelectionContextValue = {
  selectedIds: new Set<string>(),
  toggle: () => {},
  clear: () => {},
};

export const PointSelectionContext =
  createContext<PointSelectionContextValue>(defaultValue);

export function usePointSelectionContext(): PointSelectionContextValue {
  return useContext(PointSelectionContext);
}
