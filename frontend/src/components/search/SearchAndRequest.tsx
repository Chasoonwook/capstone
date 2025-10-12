// src/components/search/SearchAndRequest.tsx
"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search, X } from "lucide-react"
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

/** Spotify 응답 (요약 타입) */
type SpotifyImage = { url: string; height: number; width: number }
type SpotifySearchItem =
  | { id?: string; name?: string; album?: { id?: string; name?: string; images?: SpotifyImage[] } } // Spotify 원형
  | { trackId?: string; title?: string; artist?: string; albumImage?: string | null }               // 백엔드 축약형
type SpotifySearchResponse = { items: SpotifySearchItem[]; total?: number }

type ArtCache = Record<string, string | null>

type Props = {
  musics?: MusicItem[]
  loading?: boolean
  error?: string | null
  size?: "normal" | "wide"
  noOuterMargin?: boolean
}

/** 화면이 좁으면(=앱뷰/모바일) true */
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

/** 캐시 키: 제목/가수 소문자+trim 정규화 */
const keyOf = (m: MusicItem) =>
  `${(m.title ?? "").trim().toLowerCase()} - ${(m.artist ?? "").trim().toLowerCase()}`

/** 에디터에서 사용할 곡 메타 */
type EditorSong = {
  id: number | string
  title: string | null
  artist: string | null
  cover: string | null
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

  /* ── 상태 ───────────────────────────────────────────────── */
  const [q, setQ] = useState("")
  const [overlayOpen, setOverlayOpen] = useState(false)
  const inlineInputRef = useRef<HTMLInputElement | null>(null)
  const overlayInputRef = useRef<HTMLInputElement | null>(null)

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

  /* ── 앨범 아트 캐시/로딩 ─────────────────────────────────── */
  const [artCache, setArtCache] = useState<ArtCache>({})
  const [artLoading, setArtLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (results.length === 0) return
    const needMusics = results.filter((m) => !(keyOf(m) in artCache))
    if (needMusics.length === 0) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    async function loadArts() {
      setArtLoading(true)
      try {
        const targets = needMusics.slice(0, 12)
        const tasks = targets.map(async (m) => {
          const key = keyOf(m)
          if (key in artCache) return { key, url: artCache[key] }

          const title = (m.title ?? "").trim()
          const artist = (m.artist ?? "").trim()
          if (!title && !artist) return { key, url: null }

          const url = `/api/spotify/search?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(
            artist,
          )}&limit=1`

          try {
            const r = await fetch(url, { signal: controller.signal, cache: "no-store" })
            if (!r.ok) return { key, url: null }

            const json = (await r.json()) as SpotifySearchResponse | { error?: unknown }
            if ("error" in json) return { key, url: null }

            const item = (json as SpotifySearchResponse).items?.[0] as any
            const img: string | null =
              item?.albumImage ??
              item?.album?.images?.[1]?.url ??
              item?.album?.images?.[0]?.url ??
              item?.album?.images?.[2]?.url ??
              null

            return { key, url: img }
          } catch {
            return { key, url: null }
          }
        })

        const arr = await Promise.all(tasks)
        setArtCache((prev) => {
          const next: ArtCache = { ...prev }
          for (const { key, url } of arr) next[key] = url
          return next
        })
      } finally {
        setArtLoading(false)
      }
    }

    void loadArts()
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results])

  /* ── 메인과 동일한 업로드 유틸 ─────────────────────────── */
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
        console.error("[upload] 실패:", res.status, txt)
        return null
      }
      const json = (await res.json()) as { photoId?: string | number }
      const photoId = json?.photoId != null ? String(json.photoId) : null
      if (!photoId) {
        console.error("[upload] 응답에 photoId 없음:", json)
        return null
      }
      return { photoId }
    } catch (e) {
      console.error("[upload] 요청 오류:", e)
      return null
    }
  }

  /* ── 사진 선택 → 서버 업로드 → 에디터 이동 ─────────────── */
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingMusicRef = useRef<MusicItem | null>(null)

  const onPickClick = (m: MusicItem) => {
    pendingMusicRef.current = m
    fileInputRef.current?.click()
  }

  const onFileChosen: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const m = pendingMusicRef.current
    pendingMusicRef.current = null
    e.currentTarget.value = "" // 같은 파일 다시 선택 가능하게 리셋

    try {
      if (file.size > 10 * 1024 * 1024) {
        alert("이미지 용량이 큽니다. 10MB 이하로 업로드해 주세요.")
        return
      }
      const uid = localStorage.getItem("uid")
      if (!uid) {
        alert("로그인이 필요합니다.")
        return
      }

      // 1) 서버 업로드
      const uploaded = await uploadPhotoToBackend(file)
      if (!uploaded?.photoId) {
        alert("사진 업로드에 실패했습니다.")
        return
      }

      // 2) 선택한 노래 메타를 에디터용으로 저장
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

      // 3) 이동 (photoId & musicId 쿼리 전달)
      const q = new URLSearchParams()
      q.set("photoId", uploaded.photoId)
      if (m?.music_id != null) q.set("musicId", String(m.music_id))
      q.set("selected_from", "main")
      router.push(`/editor?${q.toString()}`)
    } catch (err) {
      console.error("[editor] 사진 업로드/이동 실패", err)
      alert("사진 업로드 중 오류가 발생했습니다.")
    }
  }

  /* ── 노래 추가 요청 모달 ───────────────────────────────── */
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [artist, setArtist] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [doneMsg, setDoneMsg] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const { count, loading: countLoading } = useRequestCounter(title, artist, open)

  async function submit() {
    setSubmitting(true)
    setDoneMsg(null)
    setErrMsg(null)
    try {
      const uidStr = localStorage.getItem("uid")
      const uid = uidStr ? Number(uidStr) : 0
      if (!uid) throw new Error("로그인이 필요합니다.")
      const res = await fetch(`${API_BASE}/api/music-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid, title: title.trim(), artist: artist.trim() }),
      })
      if (res.status === 409) {
        setErrMsg("이미 이 곡을 요청하셨습니다.")
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { request_count?: number }
      const latest = typeof data.request_count === "number" ? data.request_count : (count ?? 0) + 1
      setDoneMsg(`요청이 접수되었습니다${latest ? ` (현재 ${latest}명이 요청 중)` : ""}.`)
    } catch (err: unknown) {
      setErrMsg(err instanceof Error ? err.message : "요청 실패")
    } finally {
      setSubmitting(false)
    }
  }

  /* ── 오버레이 열기/닫기 & ESC ──────────────────────────── */
  const openOverlay = () => {
    inlineInputRef.current?.blur()
    setOverlayOpen(true)
    setTimeout(() => overlayInputRef.current?.focus(), 0)
  }
  const closeOverlay = () => {
    setOverlayOpen(false)
    requestAnimationFrame(() => inlineInputRef.current?.blur())
  }
  useEffect(() => {
    if (!overlayOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOverlay()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [overlayOpen])

  /* ── UI ─────────────────────────────────────────────────── */
  const containerMax = size === "wide" ? "max-w-5xl" : "max-w-xl"
  const resultsMax = size === "wide" ? "max-w-4xl" : "max-w-2xl"

  // 메인(인라인) — 검색창만 보여줌
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
          placeholder="노래 제목 또는 가수 검색"
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

  // 검색 리스트 공통 렌더
  const ResultList = (
    <div className={`${resultsMax} w-full mx-auto mt-6`}>
      {loading ? (
        <div className="text-center text-gray-500 py-8 bg-white/70 rounded-xl border">음악 목록 불러오는 중…</div>
      ) : error ? (
        <div className="text-center text-red-500 py-8 bg-white/70 rounded-xl border">{error}</div>
      ) : q.trim().length === 0 ? (
        <div className="text-center text-gray-400 py-4 text-sm">검색어를 입력하면 결과가 표시됩니다.</div>
      ) : results.length === 0 ? (
        <div className="max-w-xl mx-auto bg-white/80 rounded-2xl border p-6 text-center">
          <p className="text-sm text-gray-700">검색 결과가 없습니다. 원하시는 노래를 요청해 주세요.</p>
        </div>
      ) : (
        <ul className="mt-2 space-y-2">
          {results.map((m) => {
            const key = keyOf(m)
            const img = artCache[key] ?? null
            return (
              <li
                key={m.music_id}
                className="bg-white/80 rounded-xl border p-3 flex items-center justify-between gap-3 hover:shadow-sm transition"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {img ? (
                    <Image
                      src={img}
                      alt={m.title ?? "album cover"}
                      width={48}
                      height={48}
                      className="rounded-md flex-shrink-0"
                      onError={(e) => {
                        const el = e.currentTarget as HTMLImageElement
                        el.style.display = "none"
                      }}
                    />
                  ) : (
                    <div className="w-12 h-12 bg-gray-200 rounded-md flex-shrink-0" aria-hidden />
                  )}

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{m.title}</p>
                    <p className="text-xs text-gray-500 truncate">{m.artist || "Unknown"}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {artLoading && <span className="text-xs text-gray-400">이미지 로딩…</span>}
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-300 text-gray-800 hover:bg-gray-100 hover:text-gray-900
                               dark:border-gray-600 dark:text-gray-100 dark:hover:bg-neutral-800"
                    onClick={() => onPickClick(m)}
                  >
                    선택
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  // 오버레이 – 메인 위에 뜸
  const Overlay = overlayOpen ? (
    <div className="fixed inset-0 z-[70]">
      {/* 배경 딤 */}
      <div className="absolute inset-0 bg-black/50" onClick={closeOverlay} />

      {/* 패널 */}
      <div className="absolute inset-x-0 top-0 w-full bg-background rounded-none shadow-2xl border-b border-border overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <button
            onClick={closeOverlay}
            className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center"
            aria-label="닫기"
            title="닫기"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex-1 max-w-xl mx-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-5 w-5" />
            <Input
              ref={overlayInputRef}
              placeholder="노래 제목 또는 가수 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-10 pr-3 py-3 text-base border-gray-200 focus:border-purple-300 rounded-xl bg-white/80
                         text-gray-900 placeholder:text-gray-400 caret-primary
                         dark:bg-neutral-900/80 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>

          <div className="w-9 h-9" />
        </div>

        {/* 본문 */}
        <div className="px-4 pb-6 pt-3">
          <div className="max-w-xl mx-auto text-right">
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              노래 추가 요청
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

      {/* 숨겨진 파일 입력기: 노래 선택 시 사진 선택용 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChosen}
      />

      {/* 노래 추가 요청 모달 */}
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
            <DialogTitle>노래 추가 요청</DialogTitle>
            <DialogDescription>추가하고 싶은 노래의 제목과 가수를 입력해 주세요.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            <Input
              placeholder="노래 제목"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-gray-900 placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
            <Input
              placeholder="가수 이름"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              className="text-gray-900 placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>

          <div className="text-xs text-gray-600 mt-2">
            {countLoading ? (
              <span>요청 수 확인 중…</span>
            ) : title.trim() && artist.trim() ? (
              typeof count === "number" ? (
                count > 0 ? (
                  <span>현재 <b>{count}</b>명이 요청 중이에요.</span>
                ) : (
                  <span>아직 요청이 없습니다. 첫 요청을 남겨보세요!</span>
                )
              ) : (
                <span>요청 수를 불러오지 못했습니다.</span>
              )
            ) : (
              <span>제목과 가수를 입력하면 현재 요청 수를 보여드려요.</span>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>닫기</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "요청 중…" : "요청 보내기"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
