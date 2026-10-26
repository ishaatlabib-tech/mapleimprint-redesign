import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { AdminLogoutButton } from "@/components/admin/AdminLogoutButton";

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-sand bg-white">
        <Container className="flex items-center justify-between py-4">
          <nav className="flex items-center gap-6 text-sm font-semibold text-ink-900">
            <Link href="/admin/orders">Orders</Link>
            <Link href="/admin/quotes">Quotes</Link>
          </nav>
          <AdminLogoutButton />
        </Container>
      </header>
      <Container className="py-10">{children}</Container>
    </>
  );
}
