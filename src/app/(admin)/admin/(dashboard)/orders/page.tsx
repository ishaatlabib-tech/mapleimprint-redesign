import Link from "next/link";
import { createAdminClient } from "@/lib/server/supabaseAdmin";

const PAGE_SIZE = 25;

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { q, status, page } = await searchParams;
  const pageNum = Math.max(1, Number(page) || 1);
  const supabaseAdmin = createAdminClient();

  let query = supabaseAdmin
    .from("MapleOrder")
    .select("id, reference, status, contactName, contactEmail, totalCents, currency, createdAt", { count: "exact" })
    .order("createdAt", { ascending: false })
    .range((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE - 1);

  if (status) query = query.eq("status", status);
  if (q) {
    // `,` and `()` have syntax meaning in PostgREST's .or() filter string — strip them rather than
    // let free-text search input reshape the query being built.
    const safeQ = q.replace(/[,()]/g, "");
    query = query.or(`reference.ilike.%${safeQ}%,contactName.ilike.%${safeQ}%,contactEmail.ilike.%${safeQ}%`);
  }

  const { data: orders, count } = await query;
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink-900">Orders</h1>
      <form className="mt-4 flex gap-3" method="get">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search reference, name, email"
          className="flex-1 rounded-full border border-sand px-4 py-2 text-sm"
        />
        <select name="status" defaultValue={status ?? ""} className="rounded-full border border-sand px-4 py-2 text-sm">
          <option value="">All statuses</option>
          <option value="PENDING_PAYMENT">Pending payment</option>
          <option value="PAID">Paid</option>
          <option value="PAYMENT_FAILED">Payment failed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <button type="submit" className="rounded-full bg-ink-900 px-5 py-2 text-sm font-semibold text-white">
          Filter
        </button>
      </form>

      <div className="mt-6 overflow-x-auto rounded-[24px] bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-sand text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {(orders ?? []).map((order) => (
              <tr key={order.id} className="border-b border-sand last:border-0">
                <td className="px-4 py-3">
                  <Link href={`/admin/orders/${order.reference}`} className="font-semibold text-ink-900 underline-offset-2 hover:underline">
                    {order.reference}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-900">
                  {order.contactName}
                  <div className="text-xs text-muted">{order.contactEmail}</div>
                </td>
                <td className="px-4 py-3">{order.status}</td>
                <td className="px-4 py-3">
                  ${(order.totalCents / 100).toFixed(2)} {order.currency}
                </td>
                <td className="px-4 py-3 text-muted">{new Date(order.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {(orders ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  No orders found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <span>{count ?? 0} total</span>
        <div className="flex gap-3">
          {pageNum > 1 && (
            <Link href={`?${new URLSearchParams({ q: q ?? "", status: status ?? "", page: String(pageNum - 1) })}`}>
              Previous
            </Link>
          )}
          <span>
            Page {pageNum} of {totalPages}
          </span>
          {pageNum < totalPages && (
            <Link href={`?${new URLSearchParams({ q: q ?? "", status: status ?? "", page: String(pageNum + 1) })}`}>
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
