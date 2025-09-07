"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search } from "lucide-react"
import { useRequestCounter } from "@/hooks/useRequestCounter"
import { API_BASE } from "@/lib/api"
import type { MusicItem } from "@/types/music"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"

/** Spotify 응답 (요약 타입) */
type SpotifyImage = { url: string; height: number; width: number }
type SpotifyTrackItem = {
  id: string
  name: string
  album: { id?: string; name?: string; images: SpotifyImage[] }
}
type SpotifySearchResponse = { items: SpotifyTrackItem[]; total: number }

type ArtCache = Record<string, string | null>

type Props = {
  musics?: MusicItem[]        // ← 가드 위해 optional
  loading?: boolean
  error?: string | null
}

export default function SearchAndRequest({ musics, loading, error }: Props) {
  /* ── 검색 상태 (UI는 그대로) ───────────────────────────────── */
  const [q, setQ] = useState("")

  const results = useMemo(() => {
    const list: MusicItem[] = Array.isArray(musics) ? musics : []   // ✅ 가드
    const s = q.trim().toLowerCase()
    if (!s) return []
    return list
      .filter((m) =>
        (m.title?.toLowerCase() ?? "").includes(s) ||
        (m.artist?.toLowerCase() ?? "").includes(s)
      )
      .slice(0, 30)
  }, [q, musics])

  /* ── 앨범 아트 캐시/로딩 ───────────────────────────────────── */
  const [artCache, setArtCache] = useState<ArtCache>({})
  const [artLoading, setArtLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const keyOf = (m: MusicItem) => `${(m.title ?? "").trim()} - ${(m.artist ?? "").trim()}`

  useEffect(() => {
    if (results.length === 0) return

    const needKeys = results.map(keyOf).filter((k) => !(k in artCache))
    if (needKeys.length === 0) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    async function loadArts() {
      setArtLoading(true)
      try {
        const targets = results.slice(0, 10)
        const tasks = targets.map(async (m) => {
          const key = keyOf(m)
          if (key in artCache) return { key, url: artCache[key] }

          const term = [m.title ?? "", m.artist ?? ""].join(" ").trim()
          if (!term) return { key, url: null }

          const url = `${API_BASE}/api/spotify/search?query=${encodeURIComponent(term)}&limit=1`
          const r = await fetch(url, { signal: controller.signal })
          if (!r.ok) return { key, url: null }

          const json = (await r.json()) as SpotifySearchResponse | { error?: unknown }
          if ("error" in json) return { key, url: null }

          const item = (json as SpotifySearchResponse).items?.[0]
          const img =
            item?.album?.images?.[1]?.url ??
            item?.album?.images?.[0]?.url ??
            item?.album?.images?.[2]?.url ??
            null

          return { key, url: img }
        })

        const arr = await Promise.all(tasks)
        setArtCache((prev) => {
          const next: ArtCache = { ...prev }
          for (const { key, url } of arr) next[key] = url
          return next
        })
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          // 네트워크 오류 등은 조용히 무시
        }
      } finally {
        setArtLoading(false)
      }
    }

    void loadArts()
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results])

  /* ── 노래 추가 요청 모달 (기존 유지) ──────────────────────── */
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [artist, setArtist] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [doneMsg, setDoneMsg] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const { count, loading: countLoading } = useRequestCounter(title, artist, open)

  async function submit() {
    setSubmitting(true); setDoneMsg(null); setErrMsg(null)
    try {
      const uidStr = localStorage.getItem("uid")
      const uid = uidStr ? Number(uidStr) : 0
      if (!uid) throw new Error("로그인이 필요합니다.")
      const res = await fetch(`${API_BASE}/api/music-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid, title: title.trim(), artist: artist.trim() })
      })
      if (res.status === 409) { setErrMsg("이미 이 곡을 요청하셨습니다."); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { request_count?: number }
      const latest = typeof data.request_count === "number" ? data.request_count : (count ?? 0) + 1
      setDoneMsg(`요청이 접수되었습니다${latest ? ` (현재 ${latest}명이 요청 중)` : ""}.`)
    } catch (err: unknown) {
      setErrMsg(err instanceof Error ? err.message : "요청 실패")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="mb-16">
      {/* 검색 입력 (UI 변경 없음) */}
      <div className="max-w-xl mx-auto relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 h-5 w-5" />
        <Input
          placeholder="노래 제목 또는 가수 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-12 pr-4 py-4 text-base border-gray-200 focus:border-purple-300 rounded-2xl bg-white/80 backdrop-blur-sm"
        />
      </div>

      {/* 항상 보이는 '노래 추가 요청' 버튼 */}
      <div className="max-w-xl mx-auto mt-2 text-right">
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          노래 추가 요청
        </Button>
      </div>

      {/* 검색 결과 */}
      <div className="max-w-2xl mx-auto mt-6">
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
                    <Button variant="ghost" size="sm" onClick={() => console.log("[pick]", m.music_id)}>
                      선택
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* 노래 추가 요청 모달 */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setDoneMsg(null); setErrMsg(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>노래 추가 요청</DialogTitle>
            <DialogDescription>추가하고 싶은 노래의 제목과 가수를 입력해 주세요.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            <Input placeholder="노래 제목" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input placeholder="가수 이름" value={artist} onChange={(e) => setArtist(e.target.value)} />
          </div>

          <div className="text-xs text-gray-600 mt-2">
            {countLoading ? (
              <span>요청 수 확인 중…</span>
            ) : title.trim() && artist.trim() ? (
              typeof count === "number" ? (
                count > 0 ? <span>현재 <b>{count}</b>명이 요청 중이에요.</span> : <span>아직 요청이 없습니다. 첫 요청을 남겨보세요!</span>
              ) : (
                <span>요청 수를 불러오지 못했습니다.</span>
              )
            ) : (
              <span>제목과 가수를 입력하면 현재 요청 수를 보여드려요.</span>
            )}
          </div>

          {doneMsg && <div className="text-sm text-green-600 mt-2">{doneMsg}</div>}
          {errMsg && <div className="text-sm text-red-600 mt-2">{errMsg}</div>}

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
