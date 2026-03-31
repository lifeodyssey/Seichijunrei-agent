"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  createClient,
  type EmailOtpType,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { pickPreferredLocale } from "../../lib/locale";

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

function buildRedirectPath(locale?: string) {
  if (locale) return `/${locale}/design/`;
  return `/${pickPreferredLocale(undefined)}/design/`;
}

function getMessage(locale: string, key: "loading" | "error" | "notConfigured") {
  const messages = {
    ja: {
      loading: "ログインを完了しています...",
      error: "ログインリンクを確認できませんでした。",
      notConfigured: "ログイン設定がまだ完了していません。",
    },
    zh: {
      loading: "正在完成登录...",
      error: "无法确认登录链接。",
      notConfigured: "登录配置尚未完成。",
    },
  } as const;

  return messages[locale === "zh" ? "zh" : "ja"][key];
}

export function AuthCallbackPage({ locale }: { locale?: string }) {
  const resolvedLocale = locale ?? pickPreferredLocale(undefined);
  const redirectPath = useMemo(() => buildRedirectPath(locale), [locale]);
  const [status, setStatus] = useState<string>(
    getMessage(resolvedLocale, "loading"),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function completeAuth() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const tokenHash = url.searchParams.get("token_hash");
      const type = url.searchParams.get("type");

      try {
        const supabase = getSupabaseClient();
        if (!supabase) {
          throw new Error(getMessage(resolvedLocale, "notConfigured"));
        }

        if (code) {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (tokenHash && type) {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as EmailOtpType,
          });
          if (verifyError) throw verifyError;
        } else {
          throw new Error(getMessage(resolvedLocale, "error"));
        }

        if (!cancelled) {
          setStatus(getMessage(resolvedLocale, "loading"));
          window.location.replace(redirectPath);
        }
      } catch (authError) {
        if (cancelled) return;

        const message =
          authError instanceof Error
            ? authError.message
            : getMessage(resolvedLocale, "error");
        setError(message);
        setStatus(message);
      }
    }

    completeAuth();

    return () => {
      cancelled = true;
    };
  }, [redirectPath, resolvedLocale]);

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
          {error
            ? "Please request a fresh magic link and try again."
            : "You will be redirected automatically after the session is restored."}
        </p>
        <Link
          href={redirectPath}
          className="mt-6 inline-flex rounded-full bg-[var(--color-primary)] px-5 py-2.5 text-sm font-medium text-white"
        >
          Open workspace
        </Link>
      </div>
    </main>
  );
}
