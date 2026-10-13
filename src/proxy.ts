import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured, getPublicEnv } from "@/env";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, localeFromPathname, localeRedirectTarget } from "@/i18n/config";

// 1. Locale routing: paths without a locale prefix are redirected to the remembered
//    locale (cookie) or Kiswahili. Visiting a locale-prefixed page remembers that locale.
// 2. Supabase session-cookie refresh.
// Neither is authorization — that happens on the server next to the data (src/server/authz).
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const remembered = request.cookies.get(LOCALE_COOKIE)?.value;

  const target = localeRedirectTarget(pathname, search, remembered);
  if (target) return NextResponse.redirect(new URL(target, request.url));

  let response = NextResponse.next({ request });

  if (isSupabaseConfigured()) {
    const env = getPublicEnv();
    const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    });
    await supabase.auth.getClaims();
  }

  const current = localeFromPathname(pathname);
  if (current && current !== remembered) {
    response.cookies.set(LOCALE_COOKIE, current, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  }
  return response;
}

export const config = {
  // Skips framework assets, PWA files and the auth callback (which handles its own redirect).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|auth/).*)"],
};
