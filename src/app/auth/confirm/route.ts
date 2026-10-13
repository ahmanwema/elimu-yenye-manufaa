import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { getPublicEnv, isSupabaseConfigured } from "@/env";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/config";
import { safeRedirectPath } from "@/lib/safe-redirect";

// Magic-link landing. Supports both Supabase email-link styles:
//   ?token_hash=…&type=email   (recommended template)  → verifyOtp
//   ?code=…                    (PKCE default)           → exchangeCodeForSession
// The post-login destination (`next`) is untrusted and is reduced to a same-origin path.

const LINK_TYPES: readonly EmailOtpType[] = ["email", "magiclink", "signup", "invite"];

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const locale = resolveLocale(request.cookies.get(LOCALE_COOKIE)?.value);
  const fail = (error: string) => NextResponse.redirect(new URL(`/${locale}/sign-in?error=${error}`, request.url));
  if (!isSupabaseConfigured()) return fail("unavailable");

  const destination = safeRedirectPath(url.searchParams.get("next"), `/${locale}/account`);
  const cookieStore = await cookies();
  const env = getPublicEnv();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
      },
    },
  });

  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");

  let ok = false;
  if (tokenHash && type && LINK_TYPES.includes(type)) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }
  if (!ok) return fail("link_invalid");
  return NextResponse.redirect(new URL(destination, request.url));
}
