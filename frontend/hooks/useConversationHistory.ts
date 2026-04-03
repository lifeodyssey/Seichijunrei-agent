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

  useEffect(() => {
    let active = true;

    void fetchConversations()
      .then((records) => {
        if (!active) return;
        setConversations((prev) => mergeConversationLists(prev, records));
      })
      .catch(() => {});

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

    void patchConversationTitle(sessionId, trimmedTitle).catch(() => {
      void fetchConversations()
        .then((records) => {
          setConversations((prev) => mergeConversationLists(prev, records));
        })
        .catch(() => {});
    });
  }, []);

  return { conversations, upsert, rename };
}
