// src/app/api/spotify/callback/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  VERIFIER_COOKIE,
  exchangeCodeForToken,
  setTokenCookies,
} from "@/lib/spotify";

// 필요하면 Node 런타임 고정
// export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");

  // 에러 콜백
  if (err) {
    return NextResponse.redirect(new URL("/?spotify=error", url));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?spotify=missing_code", url));
  }

  // PKCE verifier 쿠키 읽기 (반드시 await cookies())
  const store = await cookies();
  const verifier = store.get(VERIFIER_COOKIE)?.value;
  if (!verifier) {
    return NextResponse.redirect(new URL("/?spotify=missing_verifier", url));
  }

  try {
    // 1) code + verifier로 토큰 교환
    const token = await exchangeCodeForToken(code, verifier);
    // token: { access_token, refresh_token?, token_type, scope?, expires_in }

    // 2) 액세스/리프레시 쿠키 저장 (expires_in은 초 단위)
    await setTokenCookies(token.access_token, token.refresh_token ?? "", token.expires_in);

    // 3) 일회성 verifier 쿠키 제거
    store.set({
      name: VERIFIER_COOKIE,
      value: "",
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: new Date(0),
    });

    // 4) 성공 리다이렉트
    return NextResponse.redirect(new URL("/?spotify=ok", url));
  } catch {
    return NextResponse.redirect(new URL("/?spotify=exchange_failed", url));
  }
}
