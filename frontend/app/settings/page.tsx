"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";
import ApiKeysPage from "@/components/settings/ApiKeysPage";

export default function SettingsPage() {
  const authClient = getSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(() => authClient !== null);

  useEffect(() => {
    if (!authClient) {
      return;
    }

    authClient.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = authClient.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => subscription.unsubscribe();
  }, [authClient]);

  useEffect(() => {
    if (!loading && !session) {
      window.location.href = "/";
    }
  }, [loading, session]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg)]">
        <div className="text-[var(--color-muted-fg)]">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg)]">
        <div className="text-[var(--color-muted-fg)]">Redirecting...</div>
      </div>
    );
  }

  return <ApiKeysPage />;
}
