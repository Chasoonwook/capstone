// src/components/search/SearchAndRequest.tsx
"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search, X, Play } from "lucide-react" // Play 아이콘 사용
import { useRequestCounter } from "@/hooks/useRequestCounter"
import { API_BASE } from "@/lib/api"
import type { MusicItem } from "@/types/music"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// 플레이어 컨텍스트 연결
import { usePlayer } from "@/contexts/PlayerContext"
import type { Track } from "@/contexts/PlayerContext"

/** 서버 배치 응답 타입 정의 */
type BatchItem = { key: string; albumImage: string | null; title?: string | null; artist?: string | null; trackId?: string | null }
type BatchResponse = { items: BatchItem[] }

/** 단건 검색 축약 타입 (기존 호환성 유지) */
type SpotifyImage = { url: string; height: number; width: number }
type SpotifySearchItem =
  | { id?: string; name?: string; album?: { id?: string; name?: string; images?: SpotifyImage[] } }
  | { trackId?: string; title?: string; artist?: string; albumImage?: string | null }
type SpotifySearchResponse = { items: SpotifySearchItem[]; total?: number }

/** 앨범 아트 캐시 타입 정의 */
type ArtCache = Record<string, string | null>

type Props = {
  musics?: MusicItem[]
  loading?: boolean
  error?: string | null
  size?: "normal" | "wide"
  noOuterMargin?: boolean
}

/** 화면 너비가 좁은 경우 (모바일 뷰) 확인 훅 */
const useIsNarrow = () => {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const fn = () => setNarrow(window.innerWidth < 768)
    fn()
    window.addEventListener("resize", fn)
    return () => window.removeEventListener("resize", fn)
  }, [])
  return narrow
}

/** 캐시 키: 제목 및 가수 소문자/trim 정규화 */
const keyOf = (m: MusicItem) =>
  `${(m.title ?? "").trim().toLowerCase()} - ${(m.artist ?? "").trim().toLowerCase()}`

/** 에디터에서 사용할 곡 메타데이터 타입 */
type EditorSong = {
  id: number | string
  title: string | null
  artist: string | null
  cover: string | null
}

/** 세션 캐시 로딩 (검색 결과 재방문 속도 개선) */
const SESSION_KEY = "albumArtCache_v1"
const loadSessionArt = (): ArtCache => {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "{}")
  } catch {
    return {}
  }
}
/** 세션 캐시 저장 */
const saveSessionArt = (obj: ArtCache) => {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(obj))
  } catch {}
}


export default function SearchAndRequest({
  musics,
  loading,
  error,
  noOuterMargin = false,
  size = "normal",
}: Props) {
  const router = useRouter()
  const isNarrow = useIsNarrow()

  // 플레이어 훅 연결
  const { setQueueAndPlay } = usePlayer()

  /* ── 상태 관리 영역 ───────────────────────────────────────────────── */
  const [q, setQ] = useState("")
  const [overlayOpen, setOverlayOpen] = useState(false)
  const inlineInputRef = useRef<HTMLInputElement | null>(null)
  const overlayInputRef = useRef<HTMLInputElement | null>(null)

  // 전역 이벤트 리스너를 통한 오버레이 열기 처리
  useEffect(() => {
    const open = () => {
      inlineInputRef.current?.blur()
      setOverlayOpen(true)
      setTimeout(() => overlayInputRef.current?.focus(), 0)
    }
    const handler = () => open()
    window.addEventListener("open-search-overlay", handler as EventListener)
    return () => window.removeEventListener("open-search-overlay", handler as EventListener)
  }, [])

  // 검색어 필터링 및 결과 목록 생성
  const results = useMemo(() => {
    const list: MusicItem[] = Array.isArray(musics) ? musics : []
    const s = q.trim().toLowerCase()
    if (!s) return []
    return list
      .filter(
        (m) =>
          (m.title?.toLowerCase() ?? "").includes(s) ||
          (m.artist?.toLowerCase() ?? "").includes(s),
      )
      .slice(0, 30)
  }, [q, musics])

    /* ── 앨범 아트 캐시/로딩 로직 ─────────────────────────────────── */
  const [artCache, setArtCache] = useState<ArtCache>({})
  const [artLoading, setArtLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // 최초 마운트 시 세션 캐시 불러오기
  useEffect(() => {
    setArtCache((prev) => ({ ...loadSessionArt(), ...prev }))
  }, [])

  // 검색 결과에 따른 앨범 아트 로딩
  useEffect(() => {
    if (results.length === 0) return
    const needMusics = results.filter((m) => !(keyOf(m) in artCache))
    if (needMusics.length === 0) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    async function loadArtsBatch() {
      setArtLoading(true)
      try {
        // 화면 상단 우선순위 12개만 처리
        const targets = needMusics.slice(0, 12)

        // 세션 캐시 즉시 반영 처리
        const sess = loadSessionArt()
        const pending = targets.filter((m) => !(keyOf(m) in sess))
        if (Object.keys(sess).length) {
          setArtCache((prev) => ({ ...sess, ...prev }))
        }
        if (pending.length === 0) return

        // Spotify 앨범 아트 배치 호출 처리
        const body = {
          pairs: pending.map((m) => ({
            title: (m.title || "").trim(),
            artist: (m.artist || "").trim(),
          })),
        }

        const r = await fetch("/api/spotify/search/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
          cache: "no-store",
        })
        if (!r.ok) return

        const json = (await r.json()) as BatchResponse | { error?: unknown }
        if ("error" in json) return

        const upd: ArtCache = {}
        for (const it of (json as BatchResponse).items || []) {
          upd[it.key] = it.albumImage ?? null
        }

        setArtCache((prev) => {
          const next = { ...prev, ...upd }
          saveSessionArt(next)
          return next
        })
      } finally {
        setArtLoading(false)
      }
    }

    void loadArtsBatch()
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results])

  /* ── 사진 업로드 유틸리티 ─────────────────────────── */
  async function uploadPhotoToBackend(file: File): Promise<{ photoId: string } | null> {
    const form = new FormData()
    form.append("file", file)
    const uid = localStorage.getItem("uid")
    if (uid) form.append("userId", uid)

    const url = `${API_BASE}/api/photos/analyze`
    try {
      const res = await fetch(url, { method: "POST", body: form })
      if (!res.ok) {
        const txt = await res.text().catch(() => "")
        console.error("[upload] Failed:", res.status, txt)
        return null
      }
      const json = (await res.json()) as { photoId?: string | number }
      const photoId = json?.photoId != null ? String(json.photoId) : null
      if (!photoId) {
        console.error("[upload] No photoId in response:", json)
        return null
      }
      return { photoId }
    } catch (e) {
      console.error("[upload] Request error:", e)
      return null
    }
  }

  /* ── 사진 선택, 서버 업로드, 에디터 이동 처리 ─────────────── */
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingMusicRef = useRef<MusicItem | null>(null)

  // 곡 선택 클릭 핸들러
  const onPickClick = (m: MusicItem) => {
    pendingMusicRef.current = m
    fileInputRef.current?.click()
  }

  // MusicItem을 PlayerContext의 Track 형태로 변환
  const toTrack = (m: MusicItem): Track => {
    const key = keyOf(m)
    return {
      id: m.music_id,
      title: m.title ?? "",
      artist: m.artist ?? "",
      coverUrl: artCache[key] ?? null,
      // audioUrl / spotify_* 속성은 PlayerContext의 resolvePlayableSource가 처리
      selected_from: "sub",
    }
  }

  // 검색 결과에서 선택한 곡 재생
  const playFromSearch = (m: MusicItem) => {
    const queue: Track[] = results.map(toTrack)
    const startIndex = results.findIndex((x) => x.music_id === m.music_id)
    if (queue.length === 0 || startIndex < 0) return
    setQueueAndPlay(queue, startIndex)
    // 재생 시작 후 검색 오버레이 닫기
    setOverlayOpen(false)
  }

  // 파일 선택 완료 및 업로드 로직
  const onFileChosen: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const m = pendingMusicRef.current
    pendingMusicRef.current = null
    e.currentTarget.value = "" // 동일 파일 재선택 가능하도록 인풋 리셋

    try {
      if (file.size > 10 * 1024 * 1024) {
        alert("Image file size is too large. Please upload less than 10MB.")
        return
      }
      const uid = localStorage.getItem("uid")
      if (!uid) {
        alert("Login required.")
        return
      }

      // 1) 서버 사진 업로드
      const uploaded = await uploadPhotoToBackend(file)
      if (!uploaded?.photoId) {
        alert("Failed to upload photo.")
        return
      }

      // 2) 선택된 노래 메타데이터를 에디터용으로 세션 저장
      if (m) {
        const key = keyOf(m)
        const songPayload: EditorSong = {
          id: m.music_id,
          title: m.title ?? null,
          artist: m.artist ?? null,
          cover: artCache[key] ?? null,
        }
        sessionStorage.setItem("editorSong", JSON.stringify(songPayload))
      }

      // 3) 에디터 페이지로 이동 (photoId 및 musicId 쿼리 전달)
      const q = new URLSearchParams()
      q.set("photoId", uploaded.photoId)
      if (m?.music_id != null) q.set("musicId", String(m.music_id))
      q.set("selected_from", "main")
      router.push(`/editor?${q.toString()}`)
    } catch (err) {
      console.error("[editor] Photo upload/navigation failed", err)
      alert("An error occurred during photo upload.")
    }
  }

  /* ── 노래 추가 요청 모달 로직 ───────────────────────────────── */
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [artist, setArtist] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [doneMsg, setDoneMsg] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const { count, loading: countLoading } = useRequestCounter(title, artist, open)

  // 노래 추가 요청 API 호출
  async function submit() {
    setSubmitting(true)
    setDoneMsg(null)
    setErrMsg(null)
    try {
      const uidStr = localStorage.getItem("uid")
      const uid = uidStr ? Number(uidStr) : 0
      if (!uid) throw new Error("Login required.")
      const res = await fetch(`${API_BASE}/api/music-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid, title: title.trim(), artist: artist.trim() }),
      })
      if (res.status === 409) {
        setErrMsg("You have already requested this song.")
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { request_count?: number }
      const latest = typeof data.request_count === "number" ? data.request_count : (count ?? 0) + 1
      setDoneMsg(`Request submitted successfully${latest ? ` (${latest} people currently requesting)` : ""}.`)
    } catch (err: unknown) {
      setErrMsg(err instanceof Error ? err.message : "Request failed")
    } finally {
      setSubmitting(false)
    }
  }

  /* ── 오버레이 열기/닫기 및 ESC 키 처리 ──────────────────────────── */
  const openOverlay = () => {
    inlineInputRef.current?.blur()
    setOverlayOpen(true)
    setTimeout(() => overlayInputRef.current?.focus(), 0)
  }
  const closeOverlay = () => {
    setOverlayOpen(false)
    requestAnimationFrame(() => inlineInputRef.current?.blur())
  }
  // ESC 키로 오버레이 닫기 핸들러
  useEffect(() => {
    if (!overlayOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOverlay()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [overlayOpen])

  /* ── UI 구성 요소 ─────────────────────────────────────────────────── */
  const containerMax = size === "wide" ? "max-w-5xl" : "max-w-xl"
  const resultsMax = size === "wide" ? "max-w-4xl" : "max-w-2xl"

  // 메인 (인라인) 검색창 표시
  const InlineBlock = (
    <>
      <div className={`${containerMax} w-full mx-auto relative`}>
        <Search
          aria-hidden
          className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 z-10 pointer-events-none"
        />
        <Input
          id="global-search-input"
          ref={inlineInputRef}
          placeholder="Search song title or artist"
          value={q}
          readOnly
          onFocus={openOverlay}
          onClick={openOverlay}
          className="z-0 pl-12 pr-4 py-4 text-base border-gray-200 focus:border-purple-300 rounded-2xl bg-white/80 backdrop-blur-sm cursor-pointer
                    text-gray-900 placeholder:text-gray-400 caret-primary
                    dark:bg-neutral-900/80 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </div>
    </>
  )


  // 검색 결과 리스트 공통 렌더링
  const ResultList = (
    <div className={`${resultsMax} w-full mx-auto mt-6`}>
      {loading ? (
        <div className="text-center text-gray-500 py-8 bg-white/70 rounded-xl border">Loading music list...</div>
      ) : error ? (
        <div className="text-center text-red-500 py-8 bg-white/70 rounded-xl border">{error}</div>
      ) : q.trim().length === 0 ? (
        <div className="text-center text-gray-400 py-4 text-sm">Enter a search term to see results.</div>
      ) : results.length === 0 ? (
        <div className="max-w-xl mx-auto bg-white/80 rounded-2xl border p-6 text-center">
          <p className="text-sm text-gray-700">No results found. Please request the song you want.</p>
        </div>
      ) : (
        <ul className="mt-2 space-y-2">
          {results.map((m, idx) => {
            const key = keyOf(m)
            const img = artCache[key] ?? null
            return (
              <li
                key={m.music_id}
                className="bg-white/80 rounded-xl border p-3 flex items-center justify-between gap-3 hover:shadow-sm transition"
                // 항목 더블클릭 시 바로 재생 처리
                onDoubleClick={() => playFromSearch(m)}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {img ? (
                    <div className="relative w-12 h-12 rounded-md overflow-hidden flex-shrink-0">
                      <Image
                        src={img}
                        alt={m.title ?? "album cover"}
                        fill
                        sizes="48px"
                        className="object-cover"
                        priority={idx < 4}
                        onError={(e) => {
                          const el = e.currentTarget as HTMLImageElement
                          el.style.display = "none"
                        }}
                      />
                    </div>
                  ) : (
                    <div className="w-12 h-12 bg-gray-200 rounded-md flex-shrink-0" aria-hidden />
                  )}

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{m.title}</p>
                    <p className="text-xs text-gray-500 truncate">{m.artist || "Unknown"}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {artLoading && <span className="text-xs text-gray-400">Image loading...</span>}

                  {/* 바로 재생 버튼 표시 */}
                  <Button
                    size="sm"
                    className="gap-1"
                    onClick={() => playFromSearch(m)}
                    aria-label="Play"
                    title="Play"
                  >
                    <Play className="w-4 h-4" />
                    Play
                  </Button>

                  {/* 사진 선택(에디터 이동용) 버튼 표시 */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-300 text-gray-800 hover:bg-gray-100 hover:text-gray-900
                              dark:border-gray-600 dark:text-gray-100 dark:hover:bg-neutral-800"
                    onClick={() => onPickClick(m)}
                  >
                    Select
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  // 검색 오버레이 팝업 표시
  const Overlay = overlayOpen ? (
    <div className="fixed inset-0 z-[70]">
      {/* 배경 딤 처리 */}
      <div className="absolute inset-0 bg-black/50" onClick={closeOverlay} />

      {/* 패널 컨테이너 */}
      <div className="absolute inset-x-0 top-0 w-full bg-background rounded-none shadow-2xl border-b border-border overflow-hidden">
        {/* 헤더 영역 */}
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <button
            onClick={closeOverlay}
            className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center"
            aria-label="Close"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>

        <div className="flex-1 max-w-xl mx-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-5 w-5" />
            <Input
              ref={overlayInputRef}
              placeholder="Search song title or artist"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-10 pr-3 py-3 text-base border-gray-200 focus:border-purple-300 rounded-xl bg-white/80
                          text-gray-900 placeholder:text-gray-400 caret-primary
                          dark:bg-neutral-900/80 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>

          <div className="w-9 h-9" />
        </div>

        {/* 본문 및 요청 버튼 영역 */}
        <div className="px-4 pb-6 pt-3">
          <div className="max-w-xl mx-auto text-right">
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              Request Song
            </Button>
          </div>
          {ResultList}
        </div>
      </div>
    </div>
  ) : null

  return (
    <section className={noOuterMargin ? "mb-0" : "mb-16"}>
      {InlineBlock}
      {Overlay}

      {/* 숨겨진 파일 입력기 (사진 선택 용도) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChosen}
      />

      {/* 노래 추가 요청 모달 컴포넌트 */}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) {
            setDoneMsg(null)
            setErrMsg(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request Song</DialogTitle>
            <DialogDescription>Please enter the title and artist of the song you want to add.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            <Input
              placeholder="Song Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-gray-900 placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
            <Input
              placeholder="Artist Name"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              className="text-gray-900 placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>

          <div className="text-xs text-gray-600 mt-2">
            {countLoading ? (
              <span>Checking request count...</span>
            ) : title.trim() && artist.trim() ? (
              typeof count === "number" ? (
                count > 0 ? (
                  <span>Currently <b>{count}</b> people are requesting.</span>
                ) : (
                  <span>No requests yet. Be the first one to request!</span>
                )
              ) : (
                <span>Could not load request count.</span>
              )
            ) : (
              <span>Enter the title and artist to see the current request count.</span>
            )}
            {doneMsg && <p className="text-green-600 mt-1">{doneMsg}</p>}
            {errMsg && <p className="text-red-500 mt-1">{errMsg}</p>}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button onClick={submit} disabled={submitting || !title.trim() || !artist.trim()}>
              {submitting ? "Requesting..." : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}