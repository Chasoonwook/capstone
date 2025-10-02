// src/app/diary/[photoId]/page.tsx
"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useSearchParams, useParams, useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";
import { ArrowLeft, Save, ImageIcon, Music2 } from "lucide-react";

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

export default function DiaryPage() {
  const router = useRouter();
  const params = useParams<{ photoId: string }>();
  const qs = useSearchParams();

  // ── 쿼리/파라미터
  const rawPhotoId = params?.photoId ?? "";
  const photoId = Number(rawPhotoId); // 숫자 변환
  const titleParam = qs.get("title") ?? "제목 없음";
  const artistParam = qs.get("artist") ?? "Various";
  const dateParam = qs.get("date"); // ISO string일 것으로 가정
  const dateLabel = fmtKoreanDate(dateParam);

  const { primary, fallback } = useMemo(
    () => buildPhotoSrc(Number.isFinite(photoId) ? photoId : 0),
    [photoId]
  );

  // ── 에디터 상태
  const [subject, setSubject] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [diaryId, setDiaryId] = useState<number | null>(null); // 기존 일기 ID

  // draft key: photoId별로 구분
  const storageKey = useMemo(
    () => `diary_draft::${Number.isFinite(photoId) ? photoId : "unknown"}`,
    [photoId]
  );

  // ── 로컬 임시 저장 불러오기 (최초 1회)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const draft = JSON.parse(raw) as { subject?: string; content?: string };
        if (typeof draft?.subject === "string") setSubject(draft.subject);
        if (typeof draft?.content === "string") setContent(draft.content);
      }
    } catch {
      // noop
    }
  }, [storageKey]);

  // ── 기존 일기 불러오기(동일 user_id + photo_id 기준 1개)
  useEffect(() => {
    if (!Number.isFinite(photoId)) return;
    (async () => {
      try {
        const userId =
          (typeof window !== "undefined" && localStorage.getItem("account_id")) || "guest";
        const url = `${API_BASE}/api/diaries/by-photo?user_id=${encodeURIComponent(
          userId
        )}&photo_id=${encodeURIComponent(String(photoId))}`;

        const r = await fetch(url, { credentials: "include" });
        if (r.ok) {
          const exist = (await r.json()) as ExistingDiary;
          if (exist?.id) setDiaryId(exist.id);

          // 서버 값 사용하되, 사용자가 이미 draft를 입력했다면 덮어쓰지 않음
          setSubject((prev) => (prev ? prev : exist?.subject ?? ""));
          setContent((prev) => (prev ? prev : exist?.content ?? ""));
        }
        // 404/204 등은 "없음"으로 간주 → 새 작성 모드
      } catch {
        // 조회 실패는 무시 (오프라인/일시 오류 등)
      }
    })();
  }, [photoId]);

  // ── 입력 시 자동 임시 저장
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ subject, content }));
    } catch {
      // noop
    }
  }, [storageKey, subject, content]);

  // ── 저장
  const saveDiary = useCallback(async () => {
    if (!Number.isFinite(photoId)) {
      setSaveError("잘못된 사진 ID입니다.");
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const userId =
        (typeof window !== "undefined" && localStorage.getItem("account_id")) || "guest";

      const commonBody = {
        subject,
        content,
        music_title: titleParam,
        music_artist: artistParam,
        diary_at: dateParam || null, // 없으면 null
      };

      let res: Response;
      if (diaryId) {
        // 기존 일기 수정
        res = await fetch(`${API_BASE}/api/diaries/${diaryId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(commonBody),
          credentials: "include",
        });
      } else {
        // 신규 작성 (백엔드가 UPSERT 처리를 해도, 일단 명시적으로 POST)
        res = await fetch(`${API_BASE}/api/diaries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            photo_id: photoId,
            ...commonBody,
          }),
          credentials: "include",
        });
      }

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || "저장에 실패했습니다.");
      }

      // 성공 응답에서 id 갱신(신규→수정 전환 대비)
      try {
        const saved = await res.json().catch(() => null);
        if (saved?.id) setDiaryId(saved.id);
      } catch {
        // noop
      }

      // draft 제거 후 메인으로 이동
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // noop
      }
      router.push("/");
    } catch (e: any) {
      setSaveError(e?.message ?? "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }, [artistParam, dateParam, diaryId, photoId, router, storageKey, subject, titleParam, content]);

  // ── 단축키: Ctrl/Cmd + S 저장
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

  // ── 이탈 경고 (초간단)
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
        {/* 사진 + 날짜 뱃지 */}
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

          {saveError && <p className="mt-2 text-xs text-destructive">{saveError}</p>}
        </section>
      </main>

      {/* 하단 고정 액션 */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem(storageKey, JSON.stringify({ subject, content }));
              } catch {
                // noop
              }
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
