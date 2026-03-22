"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import AppShell from "../layout/AppShell";

type Tab = "waitlist" | "login";

export default function AuthGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("waitlist");

  // email form state
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes (magic link callback)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // --- Waitlist submission ---
  async function handleWaitlist(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);

    const { error } = await supabase
      .from("waitlist")
      .insert({ email: email.trim().toLowerCase() });

    if (error) {
      if (error.code === "23505") {
        setStatus("この メールアドレスは既に登録されています。");
      } else {
        setStatus(`エラー: ${error.message}`);
      }
    } else {
      setStatus("登録完了！審査通過後にログインリンクをお送りします。");
    }
    setSubmitting(false);
  }

  // --- Magic Link login ---
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);

    const normalizedEmail = email.trim().toLowerCase();

    // Check waitlist status first
    const { data } = await supabase
      .from("waitlist")
      .select("status")
      .eq("email", normalizedEmail)
      .single();

    if (!data) {
      setStatus("このメールアドレスは内部テストに登録されていません。先に申し込んでください。");
      setSubmitting(false);
      return;
    }

    if (data.status !== "approved") {
      setStatus("審査中です。しばらくお待ちください。");
      setSubmitting(false);
      return;
    }

    // Approved — send magic link
    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setStatus(`エラー: ${error.message}`);
    } else {
      setStatus("ログインリンクをメールに送信しました。メールをご確認ください。");
    }
    setSubmitting(false);
  }

  // --- Loading state ---
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg)]">
        <div className="text-[var(--color-muted-fg)]">読み込み中...</div>
      </div>
    );
  }

  // --- Authenticated — show app ---
  if (session) {
    return <AppShell />;
  }

  // --- Not authenticated — show auth gate ---
  return (
    <div className="flex h-screen items-center justify-center bg-[var(--color-bg)]">
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-8 shadow-lg">
        <h1 className="mb-2 text-center text-2xl font-bold text-[var(--color-fg)]">
          聖地巡礼 AI
        </h1>
        <p className="mb-6 text-center text-sm text-[var(--color-muted-fg)]">
          内部テスト版
        </p>

        {/* Tab switcher */}
        <div className="mb-6 flex rounded-lg border border-[var(--color-border)] overflow-hidden">
          <button
            onClick={() => { setTab("waitlist"); setStatus(null); }}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              tab === "waitlist"
                ? "bg-[var(--color-primary)] text-white"
                : "text-[var(--color-muted-fg)] hover:bg-[var(--color-card-hover)]"
            }`}
          >
            テスト申請
          </button>
          <button
            onClick={() => { setTab("login"); setStatus(null); }}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              tab === "login"
                ? "bg-[var(--color-primary)] text-white"
                : "text-[var(--color-muted-fg)] hover:bg-[var(--color-card-hover)]"
            }`}
          >
            ログイン
          </button>
        </div>

        {/* Form */}
        <form onSubmit={tab === "waitlist" ? handleWaitlist : handleLogin}>
          <label
            htmlFor="email"
            className="mb-1 block text-sm font-medium text-[var(--color-fg)]"
          >
            メールアドレス
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mb-4 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-fg)] placeholder:text-[var(--color-muted-fg)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          />
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-[var(--color-primary)] py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting
              ? "送信中..."
              : tab === "waitlist"
                ? "内部テストに申し込む"
                : "ログインリンクを送信"}
          </button>
        </form>

        {/* Status message */}
        {status && (
          <p className="mt-4 rounded-lg bg-[var(--color-bg)] p-3 text-center text-sm text-[var(--color-muted-fg)]">
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
