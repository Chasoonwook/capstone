"use client"

import { useMemo, useState, useEffect, useCallback, useRef } from "react"
import { useSearchParams, useParams, useRouter } from "next/navigation"
import { API_BASE, apiUrl } from "@/lib/api"
import { ArrowLeft, Save, Music2, Calendar, Play } from "lucide-react"
import { useAuthUser } from "@/hooks/useAuthUser"
import { usePlayer } from "@/contexts/PlayerContext"
import type { Track } from "@/contexts/PlayerContext"

/** 서버 응답 타입(필드가 없을 수도 있어 optional 처리) */
type ExistingDiary = {
  id: number
  subject?: string | null
  content?: string | null
  diary_at?: string | null
  music_title_snapshot?: string | null
  music_artist_snapshot?: string | null
  music_title?: string | null
  music_artist?: string | null
}

type HistoryByPhoto = {
  title_snapshot?: string | null
  artist_snapshot?: string | null
  title?: string | null
  artist?: string | null
  created_at?: string | number | null
  createdAt?: string | number | null
  history_created_at?: string | number | null
  saved_at?: string | number | null
  analyzed_at?: string | number | null
  updated_at?: string | number | null
  timestamp?: string | number | null
  date?: string | number | null
  time?: string | number | null
}

/** 이미지 URL */
const buildPhotoSrc = (photoId: string | number) => {
  const id = encodeURIComponent(String(photoId))
  return {
    primary: `${API_BASE}/api/photos/${id}/binary`,
    fallback: `${API_BASE}/photos/${id}/binary`,
  }
}

/** 히스토리에서 사용하는 날짜 우선순위와 동일하게 ISO로 뽑기 */
function pickDateISO(h: Partial<HistoryByPhoto> | null | undefined): string | null {
  const v =
    h?.created_at ??
    h?.createdAt ??
    h?.history_created_at ??
    h?.saved_at ??
    h?.analyzed_at ??
    h?.updated_at ??
    h?.timestamp ??
    h?.date ??
    h?.time ??
    null
  if (v == null) return null
  const d = typeof v === "number" ? new Date(v) : new Date(String(v))
  if (isNaN(d.getTime())) return null
  return d.toISOString()
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

/** 앨범커버 세션 캐시 */
type ArtCache = Record<string, string | null>
const SESSION_KEY = "albumArtCache_v1"
const loadSessionArt = (): ArtCache => {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "{}")
  } catch {
    return {}
  }
}
const saveSessionArt = (obj: ArtCache) => {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(obj))
  } catch {}
}
const norm = (s?: string | null) =>
  (s || "").replace(/\s+/g, " ").replace(/[[(（【].*?[)\]）】]/g, "").trim().toLowerCase()
const artKeyOf = (title: string, artist: string) => `${norm(title)} - ${norm(artist)}`

export default function DiaryPage() {
  const router = useRouter()
  const params = useParams<{ photoId: string }>()
  const qs = useSearchParams()
  const { user } = useAuthUser?.() ?? { user: undefined }
  const { setQueueAndPlay, state } = usePlayer()

  const rawPhotoId = params?.photoId ?? ""
  const photoId = Number(rawPhotoId)

  // 현재 URL 파라미터
  const urlTitle = (qs.get("title") ?? "").trim()
  const urlArtist = (qs.get("artist") ?? "").trim()
  const urlDate = (qs.get("date") ?? "").trim()

  const { primary, fallback } = useMemo(
    () => buildPhotoSrc(Number.isFinite(photoId) ? photoId : 0),
    [photoId]
  )

  const [userId, setUserId] = useState<number | null>(null)
  const [userCheckDone, setUserCheckDone] = useState(false)

  // 화면에 보여줄 곡 정보(단일 소스)
  const [musicTitle, setMusicTitle] = useState<string>(urlTitle)
  const [musicArtist, setMusicArtist] = useState<string>(urlArtist)
  const [dateISO, setDateISO] = useState<string>(urlDate || "")

  const [subject, setSubject] = useState<string>("")
  const [content, setContent] = useState<string>("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [diaryId, setDiaryId] = useState<number | null>(null)

  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [artTried, setArtTried] = useState(false)
  const autoPlayedRef = useRef(false)
  const [artCache, setArtCache] = useState<ArtCache>({})

  const storageKey = useMemo(
    () => `diary_draft::${Number.isFinite(photoId) ? photoId : "unknown"}`,
    [photoId]
  )

  /** 유저 로드 */
  useEffect(() => {
    const id = pickNumericUserIdSync(user)
    setUserId(id)
    setUserCheckDone(true)
  }, [user])

  /** 세션 캐시 로드 */
  useEffect(() => {
    setArtCache((prev) => ({ ...loadSessionArt(), ...prev }))
  }, [])

  /**
   * ✅ URL 정규화: 진입 시 title/artist 중 하나라도 없으면
   * 1) 다이어리(by-photo)에서 스냅샷/일반필드로 보강
   * 2) 그래도 없으면 히스토리(by-photo)에서 보강 + 날짜 ISO 확보
   * 3) HistoryStrip 과 동일한 쿼리 포맷으로 router.replace()
   */
  useEffect(() => {
    if (!Number.isFinite(photoId)) return

    const needNormalize = !(urlTitle && urlArtist) // 하나라도 비었으면 정규화
    if (!needNormalize) {
      // 이미 쿼리가 갖춰져 있으면 state도 맞춰둠
      setMusicTitle(urlTitle)
      setMusicArtist(urlArtist)
      setDateISO(urlDate || "")
      return
    }

    let cancelled = false
    ;(async () => {
      // 1) 다이어리 우선
      let finalTitle = ""
      let finalArtist = ""
      let finalDateISO: string | null = urlDate || null

      try {
        // 다이어리
        const r = await fetch(
          `${API_BASE}/api/diaries/by-photo?user_id=${userId ?? ""}&photo_id=${encodeURIComponent(
            String(photoId),
          )}`,
          { credentials: "include" },
        )
        if (r.ok) {
          const d = (await r.json()) as ExistingDiary
          finalTitle = d?.music_title_snapshot || d?.music_title || ""
          finalArtist = d?.music_artist_snapshot || d?.music_artist || ""
          // 다이어리에는 날짜가 없을 수 있으므로 그대로 두기
        }
      } catch {}

      // 2) 히스토리 보강(없을 때만 / 또는 날짜 보강)
      if (!finalTitle || !finalArtist || !finalDateISO) {
        try {
          const r2 = await fetch(
            `${API_BASE}/api/history/by-photo?photo_id=${encodeURIComponent(String(photoId))}`,
            { credentials: "include", cache: "no-store" },
          )
          if (r2.ok) {
            const h = (await r2.json()) as HistoryByPhoto
            if (!finalTitle) finalTitle = h?.title_snapshot || h?.title || ""
            if (!finalArtist) finalArtist = h?.artist_snapshot || h?.artist || ""
            if (!finalDateISO) finalDateISO = pickDateISO(h)
          }
        } catch {}
      }

      // 3) 마지막 안전장치(그래도 없으면 기본값)
      if (!finalTitle) finalTitle = "제목 없음"
      if (!finalArtist) finalArtist = "Various"

      // 상태 반영
      if (cancelled) return
      setMusicTitle(finalTitle)
      setMusicArtist(finalArtist)
      setDateISO(finalDateISO ?? "")

      // 4) HistoryStrip 과 동일한 인코딩으로 URL 정규화
      const idEnc = encodeURIComponent(String(photoId))
      const titleEnc = encodeURIComponent(finalTitle)
      const artistEnc = encodeURIComponent(finalArtist)
      const datePart = finalDateISO ? `&date=${encodeURIComponent(finalDateISO)}` : ""
      const next = `/diary/${idEnc}?title=${titleEnc}&artist=${artistEnc}${datePart}`

      // 현재와 다르면 교체(히스토리 추가 없이)
      const cur = typeof window !== "undefined" ? decodeURI(window.location.pathname + window.location.search) : ""
      if (cur !== decodeURI(next)) {
        router.replace(next)
      }
    })()

    return () => {
      cancelled = true
    }
    // urlTitle/urlArtist 가 비어 있는 경우에만 발동하도록 의존성 구성
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoId, userId, userCheckDone])

  /** 다이어리 자체 내용(제목/내용) 로드 */
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

  /** 로컬 임시 저장 불러오기 */
  const draftKey = storageKey
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey)
      if (raw) {
        const draft = JSON.parse(raw) as { subject?: string; content?: string }
        if (typeof draft?.subject === "string") setSubject(draft.subject)
        if (typeof draft?.content === "string") setContent(draft.content)
      }
    } catch {}
  }, [draftKey])

  /** 로컬 임시 저장 저장 */
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ subject, content }))
    } catch {}
  }, [draftKey, subject, content])

  /** 저장 */
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
        music_title: musicTitle || "제목 없음",
        music_artist: musicArtist || "Various",
        diary_at: dateISO || null,
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
        localStorage.removeItem(draftKey)
      } catch {}
      router.push("/")
    } catch (e: any) {
      setSaveError(e?.message ?? "저장에 실패했습니다.")
    } finally {
      setSaving(false)
    }
  }, [diaryId, photoId, router, draftKey, subject, content, userId, userCheckDone, dateISO, musicTitle, musicArtist])

  /** 앨범커버/미리듣기 확보 후 재생 */
  const fetchCoverAndPlay = useCallback(
    async (auto = false) => {
      const title = (musicTitle || "제목 없음").trim()
      const artist = (musicArtist || "Various").trim()
      if (!title || !artist) return

      const keyId = `diary:${photoId}:${title.toLowerCase()}-${artist.toLowerCase()}`
      const cur = state.currentTrack
      if (
        auto &&
        cur &&
        (cur.title?.toLowerCase() ?? "") === title.toLowerCase() &&
        (cur.artist?.toLowerCase() ?? "") === artist.toLowerCase()
      ) {
        return
      }

      const k = artKeyOf(title, artist)
      const cached = artCache[k]
      if (typeof cached !== "undefined") {
        setCoverUrl(cached)
      }

      let cover: string | null = typeof cached !== "undefined" ? cached : null
      let previewUrl: string | null = null
      let spotifyUri: string | null = null

      if (!artTried) {
        setArtTried(true)
        try {
          const body = { pairs: [{ title, artist }] }
          const r = await fetch(apiUrl("/spotify/search/batch"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            cache: "no-store",
            credentials: "include",
          })
          if (r.ok) {
            const json = (await r.json()) as {
              items?: Array<{
                albumImage?: string | null
                previewUrl?: string | null
                spotifyUri?: string | null
              }>
            }
            const item = json?.items?.[0]
            cover = item?.albumImage ?? cover ?? null
            previewUrl = item?.previewUrl ?? null
            spotifyUri = item?.spotifyUri ?? null

            if (cover != null) setCoverUrl(cover)
            setArtCache((prev) => {
              const next = { ...prev, [k]: cover ?? null }
              saveSessionArt(next)
              return next
            })
          }
        } catch {
          // ignore
        }
      }

      const track: Track = {
        id: keyId,
        title,
        artist,
        coverUrl: cover ?? null,
        audioUrl: previewUrl ?? undefined,
        spotify_uri: spotifyUri ?? undefined,
        selected_from: "diary",
      }
      setQueueAndPlay([track], 0)
    },
    [musicTitle, musicArtist, photoId, setQueueAndPlay, state.currentTrack, artTried, artCache],
  )

  /** 자동 재생: 제목+가수 모두 준비된 뒤 1회 */
  useEffect(() => {
    if (!Number.isFinite(photoId)) return
    if (!(musicTitle && musicArtist)) return
    if (autoPlayedRef.current) return
    autoPlayedRef.current = true
    void fetchCoverAndPlay(true)
  }, [photoId, musicTitle, musicArtist, fetchCoverAndPlay])

  /** 단축키: Ctrl/Cmd+S 저장 */
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

  /** 이탈 경고 */
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

  const dateLabel = fmtKoreanDate(dateISO)
  const { primary: imgPrimary, fallback: imgFallback } = useMemo(
    () => buildPhotoSrc(Number.isFinite(photoId) ? photoId : 0),
    [photoId],
  )

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-4 h-16">
          <div className="flex items-center gap-3">
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

          <button
            type="button"
            disabled={saving}
            onClick={saveDiary}
            className="h-10 px-4 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold shadow-md transition-all disabled:opacity-60 flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 pb-8">
        <section className="mb-8">
          <div className="bg-card p-5 rounded-2xl shadow-lg border border-border">
            <div className="relative rounded-xl overflow-hidden bg-muted aspect-[4/3] border-2 border-background">
              <img
                src={imgPrimary || "/placeholder.svg"}
                alt="선택한 사진"
                className="w-full h-full object-cover"
                crossOrigin="anonymous"
                onError={(e) => {
                  const img = e.currentTarget as HTMLImageElement & { __fb?: boolean }
                  if (!img.__fb) {
                    img.__fb = true
                    img.src = imgFallback
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
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt="앨범 커버"
                  className="w-12 h-12 rounded-xl object-cover border shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center shrink-0">
                  <Music2 className="w-6 h-6 text-primary-foreground" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground truncate">
                  {musicTitle || "제목 없음"}
                </div>
                <div className="text-xs text-muted-foreground truncate mt-1">
                  {musicArtist || "Various"}
                </div>
              </div>

              <button
                onClick={() => fetchCoverAndPlay(false)}
                className="px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2"
                aria-label="재생"
                title="재생"
              >
                <Play className="w-4 h-4" />
                재생
              </button>
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

      {saveError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-destructive text-destructive-foreground px-4 py-2 rounded-lg shadow-lg text-sm">
          {saveError}
        </div>
      )}
    </div>
  )
}
