import { NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";

function base64url(input: Buffer) {
  return input.toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

export async function GET() {
  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI!;
  const scopes = (process.env.SPOTIFY_SCOPES ?? "").trim();

  if (!clientId || !redirectUri) {
    return NextResponse.json({ ok:false, reason:"missing env" }, { status: 500 });
  }

  // PKCE
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());

  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  if (scopes) url.searchParams.set("scope", scopes);

  const res = NextResponse.redirect(url.toString(), 302);
  res.cookies.set("sp_verifier", verifier, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
