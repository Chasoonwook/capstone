"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { API_BASE } from "@/lib/api"
import { ArrowLeft, Save, Sparkles } from "lucide-react"

// ✅ RecommendClient에서 쓰던 인증 유틸 그대로 사용
import { buildAuthHeaderFromLocalStorage, fetchMe } from "@/app/recommend/hooks/useAuthMe"

type HistoryRow = {
  history_id: number
  user_id: number
  photo_id: number
  music_id: number
  title?: string | null
  artist?: string | null
  genre?: string | null
  label?: string | null
  selected_from?: "main" | "sub" | null
  created_at?: string
}

export default function EditorClient() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const photoId = searchParams.get("photoId")
  const historyId = searchParams.get("historyId")
  const musicId = searchParams.get("musicId")
  const selectedFromParam = searchParams.get("selected_from")

  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // SearchAndRequest에서 저장한 곡 메타가 필요하면 읽어서 UI에 사용할 수 있음
  // const [songMeta, setSongMeta] = useState<{title:string|null;artist:string|null;cover:string|null}|null>(null)
  // useEffect(() => {
  //   const raw = sessionStorage.getItem("editorSong")
  //   if (raw) { try { const s = JSON.parse(raw); setSongMeta({title:s.title, artist:s.artist, cover:s.cover}); } catch {} }
  // }, [])

  const candidates = useMemo(() => {
    if (!photoId) return []
    return [`${API_BASE}/api/photos/${photoId}/binary`, `${API_BASE}/photos/${photoId}/binary`]
  }, [photoId])

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!photoId) {
        setImgUrl(null)
        return
      }
      for (const u of candidates) {
        try {
          const r = await fetch(u, { method: "GET" })
          if (!alive) return
          if (r.ok) {
            setImgUrl(u)
            return
          }
        } catch {
          // try next
        }
      }
      setImgUrl("/placeholder.svg")
    })()
    return () => {
      alive = false
    }
  }, [photoId, candidates])

  /* ---------------- 저장 로직 (RecommendClient 방식) ---------------- */
  const saveHistory = useCallback(async (): Promise<number | null> => {
    if (!photoId) {
      setErrorMsg("photoId가 없습니다.")
      return null
    }
    if (!musicId) {
      setErrorMsg("musicId가 없습니다.")
      return null
    }

    setSaving(true)
    setErrorMsg(null)
    try {
      const me = await fetchMe()
      if (!me?.id) {
        const authHeader = buildAuthHeaderFromLocalStorage()
        if (!authHeader.Authorization) {
          setErrorMsg("로그인이 필요합니다.")
          return null
        }
      }

      const selected_from =
        selectedFromParam === "preferred" ? null : selectedFromParam === "sub" ? "sub" : "main"

      const payload = {
        user_id: me?.id ?? undefined,
        photo_id: Number(photoId),
        music_id: Number(musicId),
        selected_from,
      }

      let res = await fetch(`${API_BASE}/api/history`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const authHeader = buildAuthHeaderFromLocalStorage()
        if (!authHeader.Authorization) {
          const errText = await res.text().catch(() => "")
          throw new Error(errText || `히스토리 저장 실패 (HTTP ${res.status})`)
        }
        res = await fetch(`${API_BASE}/api/history`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ ...payload }),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          throw new Error(errText || `히스토리 저장 실패 (HTTP ${res.status})`)
        }
      }

      const data: HistoryRow = await res.json()
      if (!data?.history_id) {
        throw new Error("서버 응답에 history_id가 없습니다.")
      }
      return data.history_id
    } catch (e: any) {
      setErrorMsg(e?.message || "네트워크 오류가 발생했습니다.")
      return null
    } finally {
      setSaving(false)
    }
  }, [photoId, musicId, selectedFromParam])

  /* ---------------- 버튼 동작 ---------------- */
  const handleCancel = () => {
    try {
      router.back()
    } catch {
      router.push("/")
    }
  }

  const handleSaveAsIs = async () => {
    const newId = await saveHistory()
    if (newId) {
      router.push("/")
    }
  }

  const handleGoEdit = () => {
    const q = new URLSearchParams()
    if (photoId) q.set("photoId", String(photoId))
    if (historyId) q.set("historyId", String(historyId))
    if (musicId) q.set("musicId", String(musicId))
    if (selectedFromParam) q.set("selected_from", selectedFromParam)
    router.push(`/editor/edit?${q.toString()}`)
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={handleCancel}
            disabled={saving}
            className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center transition-colors disabled:opacity-50"
            aria-label="뒤로가기"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="text-lg font-semibold text-foreground">추억 저장하기</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-6">
          <p className="text-muted-foreground text-sm">추억을 그대로 저장하거나 꾸며서 저장할 수 있어요</p>
        </div>

        <div className="bg-card rounded-2xl shadow-lg overflow-hidden mb-6 border border-border">
          <div className="relative w-full bg-muted flex items-center justify-center min-h-[400px] max-h-[70vh]">
            {imgUrl ? (
              <Image
                src={imgUrl || "/placeholder.svg"}
                alt="uploaded photo"
                width={1280}
                height={960}
                className="object-contain w-full h-full"
                priority
              />
            ) : (
              <div className="p-12 text-muted-foreground text-sm">이미지를 불러오는 중…</div>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
            <p className="text-sm text-destructive">{errorMsg}</p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={saving}
            className="sm:w-auto w-full bg-transparent"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            돌아가기
          </Button>

          <Button
            variant="outline"
            onClick={handleSaveAsIs}
            disabled={saving}
            className="sm:w-auto w-full border-primary/20 hover:bg-primary/5 bg-transparent"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? "저장 중…" : "바로 저장하기"}
          </Button>

          <Button
            onClick={handleGoEdit}
            disabled={saving}
            className="sm:w-auto w-full bg-primary hover:bg-primary/90"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            꾸미기
          </Button>
        </div>
      </main>
    </div>
  )
}
