// POST /api/spotify/dismiss-notice
import { NextResponse } from "next/server";
// import { db } from "@/lib/db"; // 프로젝트 DB 클라이언트
// import { getSessionUser } from "@/lib/auth"; // 세션에서 userId 꺼내오기

export async function POST(req: Request) {
  // const user = await getSessionUser();
  // if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { dismissUntil } = body as { dismissUntil?: string }; // ISO string

  // if (!dismissUntil) return NextResponse.json({ ok: false }, { status: 400 });

  // await db.user.update({
  //   where: { id: user.id },
  //   data:  { spotifyDismissUntil: new Date(dismissUntil) }
  // });

  return NextResponse.json({ ok: true });
}

// GET /api/spotify/dismiss-notice
export async function GET() {
  // const user = await getSessionUser();
  // if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  // const row = await db.user.findUnique({ where: { id: user.id }, select: { spotifyDismissUntil: true }});
  // return NextResponse.json({ ok: true, dismissUntil: row?.spotifyDismissUntil ?? null });

  return NextResponse.json({ ok: true, dismissUntil: null });
}
