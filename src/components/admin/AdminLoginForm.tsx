"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Incorrect password.");
        setSubmitting(false);
        return;
      }
      const next = searchParams.get("next") || "/admin/orders";
      router.push(next);
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-[24px] bg-white p-8">
      <h1 className="font-display text-xl font-semibold text-ink-900">Maple Imprint Admin</h1>
      <p className="mt-2 text-sm text-muted">Staff access only.</p>
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="mt-6 w-full rounded-full border border-sand px-4 py-2.5 text-sm text-ink-900 outline-none focus:border-ink-900"
      />
      {error && <p className="mt-2 text-sm text-crimson">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !password}
        className="mt-4 w-full rounded-full bg-maple-gradient px-6 py-2.5 text-sm font-semibold text-ink-950 disabled:opacity-50"
      >
        {submitting ? "Checking…" : "Log in"}
      </button>
    </form>
  );
}
