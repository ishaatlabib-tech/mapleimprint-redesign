import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, isValidSessionCookie } from "@/lib/admin/session";

// Next.js 16 renamed the `middleware` file convention to `proxy` — this is the first file of
// either kind in this repo. Gates the staff admin section added in Phase 2: a missing/invalid
// session cookie redirects page requests to the login screen and 401s API requests, rather than
// each admin route/page having to remember to check auth itself.
const PUBLIC_ADMIN_PATHS = new Set(["/admin/login", "/api/admin/login"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_ADMIN_PATHS.has(pathname)) return NextResponse.next();

  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (isValidSessionCookie(cookie)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
