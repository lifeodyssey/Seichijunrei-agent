"use client";

import { useEffect, useState } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useDict, useLocale } from "../../lib/i18n-context";
import AppShell from "../layout/AppShell";

type Tab = "waitlist" | "login";

let supabaseClient: SupabaseClient | null | undefined;

function getSupabaseClient() {
  if (supabaseClient !== undefined) return supabaseClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    supabaseClient = null;
    return supabaseClient;
  }

  supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  return supabaseClient;
}

export default function AuthGate() {
  const dict = useDict();
  const locale = useLocale();
  const t = dict.auth;
  const authClient = getSupabaseClient();
  const authConfigured = !!authClient;

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(authConfigured);
  const [tab, setTab] = useState<Tab>("waitlist");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const effectiveStatus = status ?? (!authConfigured ? t.not_configured : null);

  useEffect(() => {
    if (!authClient) return;

    authClient.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = authClient.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, [authClient]);

  async function handleWaitlist(e: React.FormEvent) {
    e.preventDefault();
    if (!authClient) {
      setStatus(t.not_configured);
      return;
    }

    setSubmitting(true);
    setStatus(null);

    const { error } = await authClient
      .from("waitlist")
      .insert({ email: email.trim().toLowerCase() });

    if (error) {
      if (error.code === "23505") {
        setStatus(t.already_registered);
      } else {
        setStatus(t.error.replace("{message}", error.message));
      }
    } else {
      setStatus(t.waitlist_success);
    }
    setSubmitting(false);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!authClient) {
      setStatus(t.not_configured);
      return;
    }

    setSubmitting(true);
    setStatus(null);

    const normalizedEmail = email.trim().toLowerCase();

    const { data } = await authClient
      .from("waitlist")
      .select("status")
      .eq("email", normalizedEmail)
      .single();

    if (!data) {
      setStatus(t.not_registered);
      setSubmitting(false);
      return;
    }

    if (data.status !== "approved") {
      setStatus(t.pending_review);
      setSubmitting(false);
      return;
    }

    const { error } = await authClient.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/${locale}/auth/callback/`,
      },
    });

    if (error) {
      setStatus(t.error.replace("{message}", error.message));
    } else {
      setStatus(t.magic_link_sent);
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg)]">
        <div className="text-[var(--color-muted-fg)]">{t.loading}</div>
      </div>
    );
  }

  if (session) {
    return <AppShell />;
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--color-bg)]">
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-8 shadow-lg">
        <h1 className="mb-2 text-center text-2xl font-bold text-[var(--color-fg)]">
          {t.title}
        </h1>
        <p className="mb-6 text-center text-sm text-[var(--color-muted-fg)]">
          {t.subtitle}
        </p>

        <div className="mb-6 flex rounded-lg border border-[var(--color-border)] overflow-hidden">
          <button
            onClick={() => { setTab("waitlist"); setStatus(null); }}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              tab === "waitlist"
                ? "bg-[var(--color-primary)] text-white"
                : "text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)]"
            }`}
          >
            {t.tab_waitlist}
          </button>
          <button
            onClick={() => { setTab("login"); setStatus(null); }}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              tab === "login"
                ? "bg-[var(--color-primary)] text-white"
                : "text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)]"
            }`}
          >
            {t.tab_login}
          </button>
        </div>

        <form onSubmit={tab === "waitlist" ? handleWaitlist : handleLogin}>
          <label
            htmlFor="email"
            className="mb-1 block text-sm font-medium text-[var(--color-fg)]"
          >
            {t.email_label}
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t.email_placeholder}
            className="mb-4 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-fg)] placeholder:text-[var(--color-muted-fg)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          />
          <button
            type="submit"
            disabled={submitting || !authConfigured}
            className="w-full rounded-lg bg-[var(--color-primary)] py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting
              ? t.submitting
              : tab === "waitlist"
                ? t.btn_waitlist
                : t.btn_login}
          </button>
        </form>

        {effectiveStatus && (
          <p className="mt-4 rounded-lg bg-[var(--color-bg)] p-3 text-center text-sm text-[var(--color-muted-fg)]">
            {effectiveStatus}
          </p>
        )}
      </div>
    </div>
  );
}
