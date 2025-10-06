"use client"

import { useMemo, useState, useEffect, useCallback } from "react"
import { useSearchParams, useParams, useRouter } from "next/navigation"
import { API_BASE } from "@/lib/api"
import { ArrowLeft, Save, Music2, Calendar } from "lucide-react"
import { useAuthUser } from "@/hooks/useAuthUser"

type ExistingDiary = {
  id: number
  subject: string | null
  content: string | null
  diary_at: string | null
  music_title_snapshot?: string | null
  music_artist_snapshot?: string | null
}

const buildPhotoSrc = (photoId: string | number) => {
  const id = encodeURIComponent(String(photoId))
  return {
    primary: `${API_BASE}/api/photos/${id}/binary`,
    fallback: `${API_BASE}/photos/${id}/binary`,
  }
}

const fmtKoreanDate = (iso?: string | null) => {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  })
}

function pickNumericUserIdSync(maybeUser: any): number | null {
  const toNum = (v: unknown) => {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : Number.NaN
    return Number.isFinite(n) && n >= 1 ? n : null
  }

  const fromHook = toNum(maybeUser?.user_id) ?? toNum(maybeUser?.id)
  if (fromHook != null) return fromHook

  if (typeof window !== "undefined") {
    const rawUid = localStorage.getItem("uid") ?? ""
    if (/^[1-9]\d*$/.test(rawUid)) return Number(rawUid)

    const rawAccount = localStorage.getItem("account_id") ?? ""
    if (/^[1-9]\d*$/.test(rawAccount)) return Number(rawAccount)

    try {
      const raw = localStorage.getItem("user") ?? localStorage.getItem("auth_user")
      if (raw) {
        const obj = JSON.parse(raw)
        const fromStored = toNum(obj?.user_id) ?? toNum(obj?.id)
        if (fromStored != null) return fromStored
      }
    } catch {}
  }
  return null
}

export default function DiaryPage() {
  const router = useRouter()
  const params = useParams<{ photoId: string }>()
  const qs = useSearchParams()
  const { user } = useAuthUser?.() ?? { user: undefined }

  const rawPhotoId = params?.photoId ?? ""
  const photoId = Number(rawPhotoId)
  const titleParam = qs.get("title") ?? "제목 없음"
  const artistParam = qs.get("artist") ?? "Various"
  const dateParam = qs.get("date")
  const dateLabel = fmtKoreanDate(dateParam)

  const { primary, fallback } = useMemo(() => buildPhotoSrc(Number.isFinite(photoId) ? photoId : 0), [photoId])

  const [userId, setUserId] = useState<number | null>(null)
  const [userCheckDone, setUserCheckDone] = useState(false)

  const [subject, setSubject] = useState<string>("")
  const [content, setContent] = useState<string>("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [diaryId, setDiaryId] = useState<number | null>(null)

  const storageKey = useMemo(() => `diary_draft::${Number.isFinite(photoId) ? photoId : "unknown"}`, [photoId])

  useEffect(() => {
    const id = pickNumericUserIdSync(user)
    setUserId(id)
    setUserCheckDone(true)
  }, [user])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const draft = JSON.parse(raw) as { subject?: string; content?: string }
        if (typeof draft?.subject === "string") setSubject(draft.subject)
        if (typeof draft?.content === "string") setContent(draft.content)
      }
    } catch {}
  }, [storageKey])

  useEffect(() => {
    if (!Number.isFinite(photoId)) return
    if (!userCheckDone || userId == null) return
    ;(async () => {
      try {
        const url = `${API_BASE}/api/diaries/by-photo?user_id=${userId}&photo_id=${encodeURIComponent(String(photoId))}`
        const r = await fetch(url, { credentials: "include" })
        if (r.ok) {
          const exist = (await r.json()) as ExistingDiary
          if (exist?.id) setDiaryId(exist.id)
          setSubject((prev) => (prev ? prev : (exist?.subject ?? "")))
          setContent((prev) => (prev ? prev : (exist?.content ?? "")))
        }
      } catch {}
    })()
  }, [photoId, userId, userCheckDone])

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ subject, content }))
    } catch {}
  }, [storageKey, subject, content])

  const saveDiary = useCallback(async () => {
    if (!Number.isFinite(photoId)) {
      setSaveError("잘못된 사진 ID입니다.")
      return
    }
    if (!userCheckDone) return
    if (userId == null) {
      setSaveError("로그인 정보가 올바르지 않습니다. 다시 로그인해 주세요.")
      return
    }

    setSaving(true)
    setSaveError(null)

    try {
      const commonBody = {
        subject,
        content,
        music_title: titleParam,
        music_artist: artistParam,
        diary_at: dateParam || null,
      }

      let res: Response
      if (diaryId) {
        res = await fetch(`${API_BASE}/api/diaries/${diaryId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(commonBody),
          credentials: "include",
        })
      } else {
        res = await fetch(`${API_BASE}/api/diaries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, photo_id: photoId, ...commonBody }),
          credentials: "include",
        })
      }

      if (!res.ok) {
        const t = await res.text().catch(() => "")
        throw new Error(t || "저장에 실패했습니다.")
      }

      try {
        const saved = await res.json().catch(() => null)
        if (saved?.id) setDiaryId(saved.id)
      } catch {}

      try {
        localStorage.removeItem(storageKey)
      } catch {}
      router.push("/")
    } catch (e: any) {
      setSaveError(e?.message ?? "저장에 실패했습니다.")
    } finally {
      setSaving(false)
    }
  }, [
    artistParam,
    dateParam,
    diaryId,
    photoId,
    router,
    storageKey,
    subject,
    titleParam,
    content,
    userId,
    userCheckDone,
  ])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        if (!saving) void saveDiary()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [saveDiary, saving])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (subject || content) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [subject, content])

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-2xl mx-auto flex items-center gap-3 px-4 h-16">
          <button
            onClick={() => router.back()}
            className="w-10 h-10 rounded-full bg-muted hover:bg-muted/80 hover:scale-105 flex items-center justify-center transition-all"
            aria-label="뒤로"
            type="button"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="text-lg font-bold text-foreground">그림일기 작성</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 pb-32">
        <section className="mb-8">
          <div className="bg-card p-5 rounded-2xl shadow-lg border border-border">
            <div className="relative rounded-xl overflow-hidden bg-muted aspect-[4/3] border-2 border-background">
              <img
                src={primary || "/placeholder.svg"}
                alt="선택한 사진"
                className="w-full h-full object-cover"
                crossOrigin="anonymous"
                onError={(e) => {
                  const img = e.currentTarget as HTMLImageElement & { __fb?: boolean }
                  if (!img.__fb) {
                    img.__fb = true
                    img.src = fallback
                  } else {
                    img.src = "/placeholder.svg"
                  }
                }}
              />
            </div>

            {dateLabel && (
              <div className="mt-4 flex items-center justify-center gap-2 text-muted-foreground">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-primary" />
                </div>
                <span className="text-sm font-medium text-foreground">{dateLabel}</span>
              </div>
            )}
          </div>
        </section>

        <section className="mb-8">
          <div className="bg-primary/5 rounded-2xl p-4 border border-primary/10">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center shrink-0">
                <Music2 className="w-6 h-6 text-primary-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground truncate">{titleParam}</div>
                <div className="text-xs text-muted-foreground truncate mt-1">{artistParam}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">제목</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="오늘의 이야기..."
              className="w-full bg-card border border-border focus:border-primary rounded-xl px-4 py-3 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">내용</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="사진을 보며 떠오른 생각과 감정을 자유롭게 적어보세요..."
              rows={12}
              className="w-full bg-card border border-border focus:border-primary rounded-xl px-4 py-3 text-base leading-relaxed placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </section>
      </main>

      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur-xl shadow-lg">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem(storageKey, JSON.stringify({ subject, content }))
              } catch {}
            }}
            className="flex-1 h-11 rounded-xl border border-border hover:border-primary bg-card hover:bg-muted text-sm font-medium text-foreground transition-all"
          >
            임시저장
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={saveDiary}
            className="flex-[2] h-11 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold shadow-md transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            {saving ? "저장 중..." : "저장하기"}
          </button>
        </div>
      </div>

      {saveError && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-destructive text-destructive-foreground px-4 py-2 rounded-lg shadow-lg text-sm">
          {saveError}
        </div>
      )}
    </div>
  )
}
