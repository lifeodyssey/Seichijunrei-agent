"use client";

import { createContext, useContext } from "react";

export interface SuggestContextValue {
  onSuggest: (text: string) => void;
}

const defaultValue: SuggestContextValue = {
  onSuggest: () => {},
};

export const SuggestContext = createContext<SuggestContextValue>(defaultValue);

export function useSuggest(): (text: string) => void {
  return useContext(SuggestContext).onSuggest;
}
