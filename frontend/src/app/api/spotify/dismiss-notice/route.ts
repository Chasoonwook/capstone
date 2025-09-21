// POST /api/spotify/dismiss-notice
import { NextResponse } from "next/server";
// import { db } from "@/lib/db"; // 프로젝트 DB 클라이언트
// import { getSessionUser } from "@/lib/auth"; // 세션에서 userId 꺼내오기

export async function POST(req: Request) {
  // const user = await getSessionUser();
  // if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const dismissUntilStr = typeof body?.dismissUntil === "string" ? body.dismissUntil : undefined;

  // dismissUntil이 왔다면 최소한의 유효성 체크 (미사용 변수 경고 방지 + 의미 있는 검증)
  if (dismissUntilStr) {
    const d = new Date(dismissUntilStr);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ ok: false, error: "invalid dismissUntil" }, { status: 400 });
    }
    // 실제 DB가 있다면 아래 로직 사용
    // await db.user.update({
    //   where: { id: user.id },
    //   data:  { spotifyDismissUntil: d }
    // });
  }

  return NextResponse.json({ ok: true });
}

// GET /api/spotify/dismiss-notice
export async function GET() {
  // const user = await getSessionUser();
  // if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  // const row = await db.user.findUnique({
  //   where: { id: user.id },
  //   select: { spotifyDismissUntil: true }
  // });
  // return NextResponse.json({ ok: true, dismissUntil: row?.spotifyDismissUntil ?? null });

  return NextResponse.json({ ok: true, dismissUntil: null });
}
