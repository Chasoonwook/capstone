// src/app/diary/[photoId]/page.tsx
"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useSearchParams, useParams, useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";
import { ArrowLeft, Save, ImageIcon, Music2 } from "lucide-react";
import { useAuthUser } from "@/hooks/useAuthUser";

type ExistingDiary = {
  id: number;
  subject: string | null;
  content: string | null;
  diary_at: string | null;
  music_title_snapshot?: string | null;
  music_artist_snapshot?: string | null;
};

const buildPhotoSrc = (photoId: string | number) => {
  const id = encodeURIComponent(String(photoId));
  return {
    primary: `${API_BASE}/api/photos/${id}/binary`,
    fallback: `${API_BASE}/photos/${id}/binary`,
  };
};

const fmtKoreanDate = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
};

/** 다양한 곳에서 "정수(>=1)" user_id만 탐색(동기) */
function pickNumericUserIdSync(maybeUser: any): number | null {
  const toNum = (v: unknown) => {
    const n = typeof v === "string" ? Number(v) : (typeof v === "number" ? v : NaN);
    return Number.isFinite(n) && n >= 1 ? n : null;
  };

  // 1) 훅에서 받은 유저
  const fromHook = toNum(maybeUser?.user_id) ?? toNum(maybeUser?.id);
  if (fromHook != null) return fromHook;

  // 2) localStorage 후보들 (guest/빈문자/0은 무시)
  if (typeof window !== "undefined") {
    // ✅ 기존 프로젝트에서 쓰던 'uid'도 함께 확인
    const rawUid = localStorage.getItem("uid") ?? "";
    if (/^[1-9]\d*$/.test(rawUid)) return Number(rawUid);

    const rawAccount = localStorage.getItem("account_id") ?? "";
    if (/^[1-9]\d*$/.test(rawAccount)) return Number(rawAccount);

    try {
      const raw = localStorage.getItem("user") ?? localStorage.getItem("auth_user");
      if (raw) {
        const obj = JSON.parse(raw);
        const fromStored = toNum(obj?.user_id) ?? toNum(obj?.id);
        if (fromStored != null) return fromStored;
      }
    } catch {}
  }
  return null;
}

export default function DiaryPage() {
  const router = useRouter();
  const params = useParams<{ photoId: string }>();
  const qs = useSearchParams();
  const { user } = useAuthUser?.() ?? { user: undefined };

  // ── 파라미터
  const rawPhotoId = params?.photoId ?? "";
  const photoId = Number(rawPhotoId);
  const titleParam = qs.get("title") ?? "제목 없음";
  const artistParam = qs.get("artist") ?? "Various";
  const dateParam = qs.get("date");
  const dateLabel = fmtKoreanDate(dateParam);

  const { primary, fallback } = useMemo(
    () => buildPhotoSrc(Number.isFinite(photoId) ? photoId : 0),
    [photoId]
  );

  // ✅ 로그인 user_id 확정 상태
  const [userId, setUserId] = useState<number | null>(null);
  const [userCheckDone, setUserCheckDone] = useState(false);

  // ── 에디터 상태
  const [subject, setSubject] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [diaryId, setDiaryId] = useState<number | null>(null);

  const storageKey = useMemo(
    () => `diary_draft::${Number.isFinite(photoId) ? photoId : "unknown"}`,
    [photoId]
  );

  // ✅ user_id 동기 소스로만 확정 (서버 fallback 제거)
  useEffect(() => {
    const id = pickNumericUserIdSync(user);
    setUserId(id);
    setUserCheckDone(true);
  }, [user]);

  // ── 로컬 임시 저장 로드
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const draft = JSON.parse(raw) as { subject?: string; content?: string };
        if (typeof draft?.subject === "string") setSubject(draft.subject);
        if (typeof draft?.content === "string") setContent(draft.content);
      }
    } catch {}
  }, [storageKey]);

  // ── 기존 일기 불러오기 (userId 확정 후)
  useEffect(() => {
    if (!Number.isFinite(photoId)) return;
    if (!userCheckDone || userId == null) return;

    (async () => {
      try {
        const url = `${API_BASE}/api/diaries/by-photo?user_id=${userId}&photo_id=${encodeURIComponent(
          String(photoId)
        )}`;
        const r = await fetch(url, { credentials: "include" });
        if (r.ok) {
          const exist = (await r.json()) as ExistingDiary;
          if (exist?.id) setDiaryId(exist.id);
          setSubject((prev) => (prev ? prev : exist?.subject ?? ""));
          setContent((prev) => (prev ? prev : exist?.content ?? ""));
        }
      } catch {}
    })();
  }, [photoId, userId, userCheckDone]);

  // ── 입력 시 자동 임시 저장
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ subject, content }));
    } catch {}
  }, [storageKey, subject, content]);

  // ── 저장
  const saveDiary = useCallback(async () => {
    if (!Number.isFinite(photoId)) {
      setSaveError("잘못된 사진 ID입니다.");
      return;
    }
    if (!userCheckDone) return;
    if (userId == null) {
      setSaveError("로그인 정보가 올바르지 않습니다. 다시 로그인해 주세요.");
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const commonBody = {
        subject,
        content,
        music_title: titleParam,
        music_artist: artistParam,
        diary_at: dateParam || null,
      };

      // 디버그: 실제 전송 값 확인
      console.log("[Diary save] payload", {
        user_id: userId,
        photo_id: photoId,
        diary_at: dateParam || null,
      });

      let res: Response;
      if (diaryId) {
        res = await fetch(`${API_BASE}/api/diaries/${diaryId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(commonBody),
          credentials: "include",
        });
      } else {
        res = await fetch(`${API_BASE}/api/diaries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, photo_id: photoId, ...commonBody }),
          credentials: "include",
        });
      }

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || "저장에 실패했습니다.");
      }

      try {
        const saved = await res.json().catch(() => null);
        if (saved?.id) setDiaryId(saved.id);
      } catch {}

      try {
        localStorage.removeItem(storageKey);
      } catch {}
      router.push("/");
    } catch (e: any) {
      setSaveError(e?.message ?? "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }, [artistParam, dateParam, diaryId, photoId, router, storageKey, subject, titleParam, content, userId, userCheckDone]);

  // ── 단축키 저장
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saving) void saveDiary();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveDiary, saving]);

  // ── 이탈 경고
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (subject || content) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [subject, content]);

  return (
    <div className="min-h-screen bg-background">
      {/* 헤더 */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-border">
        <div className="max-w-lg mx-auto flex items-center gap-2 px-4 h-14">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-lg hover:bg-muted flex items-center justify-center"
            aria-label="뒤로"
            type="button"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-semibold">그림일기 작성</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-4">
        {/* 사진 + 날짜 */}
        <section className="mb-4">
          <div className="relative rounded-2xl overflow-hidden bg-muted">
            <img
              src={primary || "/placeholder.svg"}
              alt="선택한 사진"
              className="w-full h-auto object-cover"
              crossOrigin="anonymous"
              onError={(e) => {
                const img = e.currentTarget as HTMLImageElement & { __fb?: boolean };
                if (!img.__fb) {
                  img.__fb = true;
                  img.src = fallback;
                } else {
                  img.src = "/placeholder.svg";
                }
              }}
            />
            {dateLabel && (
              <span className="absolute bottom-3 right-3 bg-black/70 text-white text-xs px-2 py-1 rounded">
                {dateLabel}
              </span>
            )}
          </div>
        </section>

        {/* 음악 정보 */}
        <section className="mb-6">
          <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Music2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{titleParam}</div>
              <div className="text-xs text-muted-foreground truncate">{artistParam}</div>
            </div>
            <a
              href={`/search?query=${encodeURIComponent(`${titleParam} ${artistParam}`)}`}
              className="ml-auto text-xs underline text-primary"
            >
              더 찾아보기
            </a>
          </div>
        </section>

        {/* 에디터 */}
        <section className="mb-24">
          <label className="block text-xs text-muted-foreground mb-1">일기 제목</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="오늘의 그림일기 제목을 입력하세요"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 mb-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />

          <label className="block text-xs text-muted-foreground mb-1">내용</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="사진과 음악을 보며 느낀 감정을 적어보세요…"
            rows={10}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/40"
          />

          {userCheckDone && userId == null && (
            <p className="mt-2 text-xs text-destructive">
              로그인 정보가 올바르지 않습니다. 다시 로그인해 주세요.
            </p>
          )}
          {saveError && <p className="mt-2 text-xs text-destructive">{saveError}</p>}
        </section>
      </main>

      {/* 하단 액션 */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem(storageKey, JSON.stringify({ subject, content }));
              } catch {}
            }}
            className="flex-1 h-11 rounded-xl border border-input hover:bg-muted text-sm font-medium flex items-center justify-center gap-2"
          >
            <ImageIcon className="w-4 h-4" />
            임시저장
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={saveDiary}
            className="flex-[2] h-11 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            {saving ? "저장 중…" : "저장하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
