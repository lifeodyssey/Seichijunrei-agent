"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchConversations, patchConversationTitle } from "../lib/api";
import {
  mergeConversationLists,
  renameConversationRecord,
  upsertConversationRecord,
} from "../lib/conversation-history";
import type { ConversationRecord } from "../lib/types";

export function useConversationHistory() {
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void fetchConversations()
      .then((records) => {
        if (!active) return;
        setConversations((prev) => mergeConversationLists(prev, records));
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        console.error("fetchConversations failed:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load conversations",
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const upsert = useCallback((sessionId: string, firstQuery: string) => {
    setConversations((prev) =>
      upsertConversationRecord(prev, sessionId, firstQuery),
    );
  }, []);

  const rename = useCallback((sessionId: string, title: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setConversations((prev) =>
      renameConversationRecord(prev, sessionId, trimmedTitle),
    );

    void patchConversationTitle(sessionId, trimmedTitle).catch(
      (err: unknown) => {
        console.error("patchConversationTitle failed:", err);
        // Refetch to restore correct state
        void fetchConversations()
          .then((records) => {
            setConversations((prev) =>
              mergeConversationLists(prev, records),
            );
          })
          .catch((refetchErr: unknown) => {
            console.error("refetch after rename failure:", refetchErr);
          });
      },
    );
  }, []);

  return { conversations, upsert, rename, error, isLoading };
}
