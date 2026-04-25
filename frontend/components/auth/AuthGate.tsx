"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useDict } from "../../lib/i18n-context";
import { getSupabaseClient } from "../../lib/supabase";
import AppShell from "../layout/AppShell";
import LandingPage from "./LandingPage";
import AuthModal from "./AuthModal";

export default function AuthGate() {
  const t = useDict().auth;
  const authClient = getSupabaseClient();
  const authConfigured = !!authClient;

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(authConfigured);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    if (!authClient) return;
    authClient.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
    });
    const { data: { subscription } } = authClient.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, [authClient]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!authClient) { setStatus(t.not_configured); return; }
    setSubmitting(true);
    setStatus(null);
    const normalizedEmail = email.trim().toLowerCase();
    const { error } = await authClient.auth.signInWithOtp({
      email: normalizedEmail,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback/` },
    });
    if (error) { setStatus(t.error.replace("{message}", error.message)); } else { setSent(true); }
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
    <>
      <LandingPage onOpenAuth={() => setShowAuthModal(true)} />
      {showAuthModal && (
        <AuthModal
          email={email}
          submitting={submitting}
          sent={sent}
          effectiveStatus={status ?? (!authConfigured ? t.not_configured : null)}
          authConfigured={authConfigured}
          onEmailChange={setEmail}
          onSubmit={handleLogin}
          onBack={() => { setSent(false); setStatus(null); }}
          onClose={() => setShowAuthModal(false)}
        />
      )}
    </>
  );
}
