import { NextResponse } from "next/server";
export const runtime = "nodejs";

type SameSite = "lax" | "strict" | "none";
type CookieOpts = { httpOnly?: boolean; secure?: boolean; path?: string; sameSite?: SameSite; maxAge?: number };
function serializeCookie(name: string, value: string, opts: CookieOpts = {}): string {
  const segs = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge !== undefined) segs.push(`Max-Age=${opts.maxAge}`);
  segs.push(`Path=${opts.path ?? "/"}`);
  if (opts.httpOnly) segs.push("HttpOnly");
  if (opts.secure) segs.push("Secure");
  if (opts.sameSite) segs.push(`SameSite=${opts.sameSite}`);
  return segs.join("; ");
}
const isProd = process.env.NODE_ENV === "production";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", serializeCookie("sp_at", "", { path: "/", maxAge: 0, httpOnly: true, secure: isProd, sameSite: "lax" }));
  res.headers.append("Set-Cookie", serializeCookie("sp_rt", "", { path: "/", maxAge: 0, httpOnly: true, secure: isProd, sameSite: "lax" }));
  return res;
}
