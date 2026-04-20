"use client";

import { useDict } from "../../lib/i18n-context";

interface AuthModalProps {
  email: string;
  submitting: boolean;
  sent: boolean;
  effectiveStatus: string | null;
  authConfigured: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  onClose: () => void;
}

export default function AuthModal({
  email,
  submitting,
  sent,
  effectiveStatus,
  authConfigured,
  onEmailChange,
  onSubmit,
  onBack,
  onClose,
}: AuthModalProps) {
  const t = useDict().auth;

  return (
    <div
      data-testid="auth-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative mx-4 w-full max-w-[420px] rounded-xl bg-[var(--color-bg)] p-8 shadow-2xl"
        style={{ animation: "seichi-fade-up 0.3s ease-out" }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 min-h-[44px] min-w-[44px] text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="mb-8">
          <h2 className="text-base font-medium text-[var(--color-fg)]">
            {t.title}
          </h2>
          <p className="mt-1 text-xs font-light text-[var(--color-muted-fg)]">
            {t.subtitle}
          </p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-[var(--color-fg)]">
              {t.check_email_heading}
            </p>
            <p className="text-xs leading-relaxed text-[var(--color-muted-fg)]">
              {t.check_email_body}
            </p>
            <button
              type="button"
              onClick={onBack}
              className="min-h-[44px] text-xs underline text-[var(--color-muted-fg)]"
            >
              {t.back_to_login}
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="auth-email"
                  className="text-xs font-medium text-[var(--color-muted-fg)]"
                >
                  {t.email_label}
                </label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => onEmailChange(e.target.value)}
                  placeholder={t.email_placeholder}
                  className="w-full border-b border-[var(--color-border)] bg-transparent py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-border)] focus:border-[var(--color-primary)] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || !authConfigured}
                className="min-h-[44px] w-full rounded-lg bg-[var(--color-primary)] py-2.5 text-xs font-medium text-[var(--color-primary-fg)] transition hover:opacity-90 disabled:opacity-40"
                style={{ transitionDuration: "var(--duration-fast)" }}
              >
                {submitting ? t.submitting : t.btn_login}
              </button>
            </form>

            {effectiveStatus && (
              <p className="mt-5 text-xs font-light leading-relaxed text-[var(--color-muted-fg)]">
                {effectiveStatus}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
