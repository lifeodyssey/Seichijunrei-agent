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
  const land = dict.landing;
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
    if (!authClient) { setStatus(t.not_configured); return; }
    setSubmitting(true);
    setStatus(null);
    const { error } = await authClient
      .from("waitlist")
      .insert({ email: email.trim().toLowerCase() });
    if (error) {
      setStatus(error.code === "23505" ? t.already_registered : t.error.replace("{message}", error.message));
    } else {
      setStatus(t.waitlist_success);
    }
    setSubmitting(false);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!authClient) { setStatus(t.not_configured); return; }
    setSubmitting(true);
    setStatus(null);
    const normalizedEmail = email.trim().toLowerCase();
    const { data } = await authClient.from("waitlist").select("status").eq("email", normalizedEmail).single();
    if (!data) { setStatus(t.not_registered); setSubmitting(false); return; }
    if (data.status !== "approved") { setStatus(t.pending_review); setSubmitting(false); return; }
    const { error } = await authClient.auth.signInWithOtp({
      email: normalizedEmail,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback/` },
    });
    setStatus(error ? t.error.replace("{message}", error.message) : t.magic_link_sent);
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg)]">
        <div className="text-[var(--color-muted-fg)]">{t.loading}</div>
      </div>
    );
  }

  if (session) return <AppShell />;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)] lg:flex-row">

      {/* ── Left panel: brand ────────────────────────────────────── */}
      <div className="flex flex-1 flex-col justify-between px-10 py-12 lg:px-16 lg:py-16">

        {/* Logo */}
        <div className="flex flex-col gap-0.5">
          <span className="font-[family-name:var(--app-font-display)] text-2xl font-semibold text-[var(--color-fg)]">
            聖地巡礼
          </span>
          <span className="text-[10px] font-light tracking-[0.22em] text-[var(--color-muted-fg)]">
            seichijunrei
          </span>
        </div>

        {/* Hero copy */}
        <div className="space-y-6 py-12 lg:py-0">
          <h1 className="font-[family-name:var(--app-font-display)] text-4xl font-semibold leading-snug text-[var(--color-fg)] lg:text-5xl">
            {land.hero}<br />
            <span className="text-[var(--color-primary)]">{land.hero_accent}</span>
          </h1>
          <p className="max-w-sm text-sm font-light leading-relaxed text-[var(--color-muted-fg)]">
            {dict.chat.welcome_subtitle}
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2 pt-2">
            {land.features.map((f) => (
              <span
                key={f}
                className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs font-light text-[var(--color-muted-fg)]"
              >
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Footer note */}
        <p className="text-[11px] font-light text-[var(--color-border)]">
          {t.subtitle} · {new Date().getFullYear()}
        </p>
      </div>

      {/* ── Divider ───────────────────────────────────────────────── */}
      <div className="hidden w-px bg-[var(--color-border)] lg:block" />
      <div className="h-px bg-[var(--color-border)] lg:hidden" />

      {/* ── Right panel: auth form ────────────────────────────────── */}
      <div className="flex w-full flex-col justify-center px-10 py-12 lg:w-[420px] lg:px-16 lg:py-16">

        <div className="mb-8">
          <h2 className="text-base font-medium text-[var(--color-fg)]">
            {tab === "waitlist" ? t.tab_waitlist : t.tab_login}
          </h2>
          <p className="mt-1 text-xs font-light text-[var(--color-muted-fg)]">
            {t.subtitle}
          </p>
        </div>

        {/* Tab switcher */}
        <div className="mb-6 flex gap-4 border-b border-[var(--color-border)]">
          {(["waitlist", "login"] as Tab[]).map((t_) => (
            <button
              key={t_}
              type="button"
              onClick={() => { setTab(t_); setStatus(null); }}
              className={[
                "pb-2.5 text-xs font-medium transition-colors",
                tab === t_
                  ? "border-b-2 border-[var(--color-primary)] text-[var(--color-primary)]"
                  : "text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]",
              ].join(" ")}
              style={{ marginBottom: "-1px" }}
            >
              {t_ === "waitlist" ? t.tab_waitlist : t.tab_login}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={tab === "waitlist" ? handleWaitlist : handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-medium text-[var(--color-muted-fg)]">
              {t.email_label}
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.email_placeholder}
              className="w-full border-b border-[var(--color-border)] bg-transparent py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-border)] focus:border-[var(--color-primary)] focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !authConfigured}
            className="w-full rounded-lg bg-[var(--color-primary)] py-2.5 text-xs font-medium uppercase tracking-wider text-[var(--color-primary-fg)] transition hover:opacity-90 disabled:opacity-40"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            {submitting ? t.submitting : tab === "waitlist" ? t.btn_waitlist : t.btn_login}
          </button>
        </form>

        {effectiveStatus && (
          <p className="mt-5 text-xs font-light leading-relaxed text-[var(--color-muted-fg)]">
            {effectiveStatus}
          </p>
        )}
      </div>
    </div>
  );
}
