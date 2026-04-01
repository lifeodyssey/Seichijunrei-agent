"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient, type EmailOtpType, type SupabaseClient } from "@supabase/supabase-js";
import { useDict } from "../../lib/i18n-context";

let supabaseClient: SupabaseClient | null | undefined;

function getSupabaseClient() {
  if (supabaseClient !== undefined) return supabaseClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    supabaseClient = null;
    return supabaseClient;
  }

  supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { flowType: 'implicit' },
  });
  return supabaseClient;
}

export function AuthCallbackPage() {
  const t = useDict().auth;
  const [status, setStatus] = useState<string>(t.callback_loading);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function completeAuth() {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error(t.not_configured);

        // Implicit flow: Supabase auto-extracts access_token from the URL hash
        // on client init, so getSession() already returns the session.
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          if (!cancelled) window.location.replace("/");
          return;
        }

        // Fallback: PKCE code or OTP token_hash in query params
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as EmailOtpType,
          });
          if (error) throw error;
        } else {
          throw new Error(t.callback_error);
        }

        if (!cancelled) window.location.replace("/");
      } catch (authError) {
        if (cancelled) return;
        const message = authError instanceof Error ? authError.message : t.callback_error;
        setError(message);
        setStatus(message);
      }
    }

    completeAuth();
    return () => { cancelled = true; };
  }, [t]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-6">
      <div className="w-full max-w-md rounded-[28px] border border-[var(--color-border)] bg-[var(--color-card)] p-8 shadow-sm">
        <p className="text-sm uppercase tracking-[0.24em] text-[var(--color-muted-fg)]">
          Seichijunrei
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[var(--color-fg)]">
          {status}
        </h1>
        <p className="mt-4 text-sm leading-7 text-[var(--color-muted-fg)]">
          {error ? t.callback_error_hint : t.callback_redirect_hint}
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-full bg-[var(--color-primary)] px-5 py-2.5 text-sm font-medium text-white"
        >
          {t.callback_open}
        </Link>
      </div>
    </main>
  );
}
