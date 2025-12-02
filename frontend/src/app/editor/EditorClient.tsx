"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { API_BASE } from "@/lib/api"
import { ArrowLeft, Save, Sparkles } from "lucide-react"
import { fetchMe } from "@/app/recommend/hooks/useAuthMe"

type HistoryRow = {
  history_id: number
  user_id: number
  photo_id: number
  music_id: number
  created_at?: string
}

export default function EditorClient() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const photoId = searchParams.get("photoId")
  const historyId = searchParams.get("historyId") // 기존 값이 있으면 유지
  const musicId = searchParams.get("musicId")
  const selectedFromParam = searchParams.get("selected_from")

  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

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
        } catch {}
      }
      setImgUrl("/placeholder.svg")
    })()
    return () => { alive = false }
  }, [photoId, candidates])

  // history 저장(없으면 생성) → diaries 업서트
  const saveHistoryAndDiary = useCallback(async (): Promise<number | null> => {
    if (!photoId) { setErrorMsg("photoId is missing."); return null }
    if (!musicId) { setErrorMsg("musicId is missing."); return null }

    setSaving(true); setErrorMsg(null)
    try {
      const me = await fetchMe()
      if (!me?.id) { setErrorMsg("Login required."); return null }

      // 1) history (스냅샷)
      const resHist = await fetch(`${API_BASE}/api/history`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: me.id,
          photo_id: Number(photoId),
          music_id: Number(musicId),
          selected_from: (selectedFromParam === "main" || selectedFromParam === "sub") ? selectedFromParam : null,
        }),
      })
      if (!resHist.ok) throw new Error("Failed to save history")
      const hist: HistoryRow = await resHist.json()
      const hid = hist?.history_id
      if (!hid) throw new Error("Missing history_id.")

      // 2) diaries 업서트
      const resDia = await fetch(`${API_BASE}/api/diaries`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: me.id,
          photo_id: Number(photoId),
          music_id: Number(musicId),
          subject: "Save Photo",
          content: "Saved without editing.",
        }),
      })
      if (!resDia.ok) throw new Error("Failed to save diary")

      return hid
    } catch (e: any) {
      setErrorMsg(e?.message || "An error occurred while saving.")
      return null
    } finally {
      setSaving(false)
    }
  }, [photoId, musicId, selectedFromParam])

  const handleCancel = () => {
    try { router.back() } catch { router.push("/") }
  }

  const handleSaveAsIs = async () => {
    const newId = await saveHistoryAndDiary()
    if (newId) router.push("/")   // 저장 후 메인으로 이동
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
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="text-lg font-semibold text-foreground">Save Memory</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-6">
          <p className="text-muted-foreground text-sm">Save as-is or decorate before saving.</p>
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
              <div className="p-12 text-muted-foreground text-sm">Loading image…</div>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
            <p className="text-sm text-destructive">{errorMsg}</p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button variant="outline" onClick={handleCancel} disabled={saving} className="sm:w-auto w-full bg-transparent">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>

          <Button
            variant="outline"
            onClick={handleSaveAsIs}
            disabled={saving}
            className="sm:w-auto w-full border-primary/20 hover:bg-primary/5 bg-transparent"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving…" : "Save as is"}
          </Button>

          <Button onClick={handleGoEdit} disabled={saving} className="sm:w-auto w-full bg-primary hover:bg-primary/90">
            <Sparkles className="w-4 h-4 mr-2" />
            Edit
          </Button>
        </div>
      </main>
    </div>
  )
}
