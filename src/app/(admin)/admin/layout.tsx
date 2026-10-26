import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Maple Imprint Admin",
  robots: { index: false, follow: false },
};

// Shared by /admin/login (no nav chrome) and the (dashboard) group (which adds its own nav) — see
// src/app/(admin)/admin/(dashboard)/layout.tsx. Mirrors (studio)'s existing pattern of a route
// group with no marketing Header/Footer in its layout tree at all.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-canvas">{children}</div>;
}
