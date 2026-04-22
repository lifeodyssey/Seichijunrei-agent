"use client";

import { useEffect, useState } from "react";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api-keys";
import type { ApiKey } from "@/lib/api-keys";

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listApiKeys().then(setKeys).catch((e) => setError(e.message));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setCreating(true);
    setError(null);
    setNewRawKey(null);
    try {
      const { rawKey, id } = await createApiKey(newKeyName.trim());
      setNewRawKey(rawKey);
      setNewKeyName("");
      setKeys((prev) => [
        { id, name: newKeyName.trim(), created_at: new Date().toISOString(), last_used_at: null, revoked: false },
        ...prev,
      ]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create key");
    }
    setCreating(false);
  }

  async function handleRevoke(id: string) {
    setError(null);
    try {
      await revokeApiKey(id);
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to revoke key");
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-xl font-semibold text-[var(--color-fg)]">API Keys</h1>
      <p className="mb-6 text-sm text-[var(--color-muted-fg)]">
        Use API keys to call the runtime from CLI tools, scripts, or AI agents.
        The key is shown once — save it immediately.
      </p>

      <form onSubmit={handleCreate} className="mb-8 flex gap-2">
        <input
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          placeholder="Key name (e.g. My CLI Agent)"
          className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-muted-fg)] focus:border-[var(--color-primary)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={creating || !newKeyName.trim()}
          className="rounded-[var(--r-lg)] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-fg)] disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create key"}
        </button>
      </form>

      {newRawKey && (
        <div className="mb-6 rounded-xl border border-[var(--color-primary)] bg-[var(--color-card)] p-4">
          <p className="mb-2 text-xs font-medium text-[var(--color-primary)]">
            Save this key — it will not be shown again.
          </p>
          <code className="block break-all rounded bg-[var(--color-bg)] p-3 text-xs text-[var(--color-fg)]">
            {newRawKey}
          </code>
          <button
            onClick={() => navigator.clipboard.writeText(newRawKey)}
            className="mt-2 text-xs text-[var(--color-muted-fg)] hover:text-[var(--color-primary)]"
          >
            Copy to clipboard
          </button>
        </div>
      )}

      {keys.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-fg)]">No API keys yet.</p>
      ) : (
        <ul className="space-y-2">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-[var(--color-fg)]">{key.name}</p>
                <p className="text-xs text-[var(--color-muted-fg)]">
                  Created {new Date(key.created_at).toLocaleDateString()}
                  {key.last_used_at && (
                    <> · Last used {new Date(key.last_used_at).toLocaleDateString()}</>
                  )}
                </p>
              </div>
              <button
                onClick={() => handleRevoke(key.id)}
                className="ml-4 text-xs text-[var(--color-muted-fg)] hover:text-red-400"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </div>
  );
}
