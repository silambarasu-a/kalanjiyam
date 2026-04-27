import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

const PROTECTED_PAGE_PREFIXES = [
  "/dashboard",
  "/workspaces",
  "/contacts",
  "/categories",
  "/accounts",
  "/cards",
  "/transactions",
  "/transfers",
  "/crops",
  "/livestock",
  "/leases",
  "/workers",
  "/wages",
  "/loans",
  "/investments",
  "/reminders",
  "/reports",
  "/settings",
  "/onboarding",
];

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => req.cookies.get(name)?.value);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Protected pages: cookie presence only; server components call auth() for details.
  if (PROTECTED_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    if (!hasSessionCookie(req)) {
      const login = new URL("/login", req.url);
      login.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
      return NextResponse.redirect(login);
    }
  }

  // API routes (except /api/auth/*): enforce idle-lock via JWT claim if present.
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/auth/")) {
    const { getToken } = await import("next-auth/jwt");
    const token = (await getToken({
      req,
      secret: process.env.AUTH_SECRET,
      cookieName: SESSION_COOKIE_NAMES.find((n) => req.cookies.get(n)?.value),
    })) as { reverifyRequiredAt?: number | null } | null;
    if (token?.reverifyRequiredAt) {
      return NextResponse.json(
        { error: "Reverification required", code: "REVERIFY_REQUIRED" },
        { status: 423 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"],
};
