export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const cookieHeader = req.headers.get("cookie") ?? "";
    const hasAccess = /(?:^|;\s*)sp_access=([^;]+)/.test(cookieHeader); // access 쿠키 존재 여부
    return new Response(JSON.stringify({ loggedIn: hasAccess }), {
      headers: { "content-type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ loggedIn: false }), {
      headers: { "content-type": "application/json" },
    });
  }
}
