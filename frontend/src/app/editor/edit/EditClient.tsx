"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { API_BASE } from "@/lib/api"
import { fetchMe } from "@/app/recommend/hooks/useAuthMe"
import { RotateCw, Sun, Pencil, Sticker, RefreshCw, Check, X } from "lucide-react"
import { Stage, Layer, Image as KImage, Line, Group, Transformer } from "react-konva"
import useImage from "use-image"
import Konva from "konva"
import "konva/lib/filters/Brighten"

type StickerMeta = {
  sticker_id: number
  name?: string | null
  mime_type?: string | null
}
type PlacedSticker = {
  id: string
  sticker_id: number
  x: number
  y: number
  rotation: number
  scale: number
  url: string
}

const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 1024, height: 768 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const cr = entry.contentRect
      setSize({
        width: Math.max(320, Math.floor(cr.width)),
        height: Math.max(240, Math.floor(cr.height)),
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, size }
}

function UseImage({
  src,
  brightness,
  onImgReady,
}: {
  src: string
  brightness: number
  onImgReady?: (node: any) => void
}) {
  const [img] = useImage(src, "anonymous")
  const ref = useRef<any>(null)
  useEffect(() => {
    const node = ref.current
    if (!node || !img) return
    node.cache()
    node.filters([Konva.Filters.Brighten])
    const val = (brightness - 100) / 100
    node.brightness(val)
    onImgReady?.(node)
  }, [img, brightness, onImgReady])
  return <KImage ref={ref} image={img || undefined} listening={false} />
}

function useFitSize(naturalW: number | null, naturalH: number | null, maxW: number, maxH: number) {
  return useMemo(() => {
    if (!naturalW || !naturalH) return { w: Math.floor(Math.min(maxW, 640)), h: Math.floor(Math.min(maxH, 480)), scale: 1 }
    const rw = maxW / naturalW
    const rh = maxH / naturalH
    const s = Math.min(rw, rh, 1)
    return { w: Math.floor(naturalW * s), h: Math.floor(naturalH * s), scale: s }
  }, [naturalW, naturalH, maxW, maxH])
}

export default function EditClient() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const photoId = searchParams.get("photoId")
  const musicId = searchParams.get("musicId")
  const selectedFromParam = searchParams.get("selected_from")

  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [rotation, setRotation] = useState<number>(0)
  const [brightness, setBrightness] = useState<number>(100)

  const [brushColor, setBrushColor] = useState<string>("#0095f6")
  const [brushSize, setBrushSize] = useState<number>(6)
  const [isDrawing, setIsDrawing] = useState(false)
  const [lines, setLines] = useState<Array<{ points: number[]; color: string; size: number }>>([])

  const [stickerList, setStickerList] = useState<StickerMeta[]>([])
  const [placed, setPlaced] = useState<PlacedSticker[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [activeTool, setActiveTool] = useState<"rotate" | "brightness" | "draw" | "sticker" | null>(null)

  const stageRef = useRef<any>(null)
  const baseLayerRef = useRef<any>(null)
  const stickerLayerRef = useRef<any>(null)
  const trRef = useRef<any>(null)

  const { ref: canvasBoxRef, size: box } = useElementSize<HTMLDivElement>()

  useEffect(() => {
    if (!photoId) return
    let revokeUrl: string | null = null
    let cancelled = false

    const candidates = [`${API_BASE}/api/photos/${photoId}/binary`, `${API_BASE}/photos/${photoId}/binary`]
    ;(async () => {
      for (const u of candidates) {
        try {
          const r = await fetch(u, { method: "GET" })
          if (!r.ok) continue
          const blob = await r.blob()
          const objectUrl = URL.createObjectURL(blob)
          revokeUrl = objectUrl

          const tmp = new Image()
          tmp.onload = () => {
            if (!cancelled) {
              setNatural({ w: tmp.naturalWidth, h: tmp.naturalHeight })
              setImgUrl(objectUrl)
              setLoading(false)
            }
          }
          tmp.src = objectUrl
          return
        } catch {}
      }
      if (!cancelled) {
        setImgUrl("/placeholder.svg")
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      if (revokeUrl) URL.revokeObjectURL(revokeUrl)
    }
  }, [photoId])

  const maxW = Math.max(320, box.width - 8)
  const maxH = Math.max(240, box.height - 8)
  const fit = useFitSize(natural?.w ?? null, natural?.h ?? null, maxW, maxH)

  const fetchStickers = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/stickers`, { credentials: "include" })
      if (r.ok) {
        const arr: StickerMeta[] = await r.json()
        setStickerList(arr || [])
      }
    } catch {}
  }, [])
  useEffect(() => { fetchStickers() }, [fetchStickers])

  const handleUploadSticker = async (file: File) => {
    const fd = new FormData()
    fd.append("file", file)
    fd.append("name", file.name)
    try {
      const r = await fetch(`${API_BASE}/api/stickers`, {
        method: "POST",
        body: fd,
        credentials: "include",
      })
      if (r.ok) await fetchStickers()
      else alert("스티커 업로드 실패")
    } catch { alert("스티커 업로드 중 오류") }
  }

  const addStickerToStage = (meta: StickerMeta) => {
    const url = `${API_BASE}/api/stickers/${meta.sticker_id}/binary`
    setPlaced((prev) => prev.concat({
      id: uuid(),
      sticker_id: meta.sticker_id,
      x: fit.w / 2 - 64,
      y: fit.h / 2 - 64,
      rotation: 0,
      scale: 1,
      url,
    }))
  }

  const handleMouseDown = (e: any) => {
    if (e.target === e.target.getStage()) setSelectedId(null)
    if (activeTool !== "draw") return
    setIsDrawing(true)
    const pos = e.target.getStage().getPointerPosition()
    if (!pos) return
    setLines((prev) => prev.concat({ points: [pos.x, pos.y], color: brushColor, size: brushSize }))
  }
  const handleMouseMove = (e: any) => {
    if (activeTool !== "draw" || !isDrawing) return
    const stage = e.target.getStage()
    const point = stage.getPointerPosition()
    if (!point) return
    setLines((prev) => {
      const last = prev[prev.length - 1]
      const newLast = { ...last, points: [...last.points, point.x, point.y] }
      return prev.slice(0, prev.length - 1).concat(newLast)
    })
  }
  const handleMouseUp = () => {
    if (activeTool !== "draw") return
    setIsDrawing(false)
  }
  useEffect(() => { if (activeTool !== "draw" && isDrawing) setIsDrawing(false) }, [activeTool, isDrawing])

  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const layer = stickerLayerRef.current
    if (!layer) return
    const node = layer.findOne((n: any) => n.getAttr("nodeId") === selectedId)
    if (node) { tr.nodes([node]); tr.getLayer()?.batchDraw() }
    else { tr.nodes([]); tr.getLayer()?.batchDraw() }
  }, [selectedId, placed])

  const updatePlaced = (id: string, patch: Partial<PlacedSticker>) => {
    setPlaced((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  // canvas to blob
  const stageToBlob = async (): Promise<Blob> => {
    const stage = stageRef.current as any
    const dataURL: string = stage.toDataURL({ pixelRatio: 1, mimeType: "image/png" })
    const res = await fetch(dataURL)
    return await res.blob()
  }

  const resetEdits = () => {
    setRotation(0); setBrightness(100); setLines([]); setPlaced([]); setSelectedId(null); setActiveTool(null)
  }

  const onStickerFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleUploadSticker(f)
    e.currentTarget.value = ""
  }

  const onStageClick = (e: any) => { if (e.target === e.target.getStage()) setSelectedId(null) }

  // ⭐ 편집본 저장: history 생성 → edited-image 업로드 → diaries 업서트
  const handleSaveEdited = async () => {
    if (!photoId) return alert("photoId가 없습니다.")
    if (!musicId) return alert("musicId가 없습니다.")

    setSaving(true)
    try {
      const me = await fetchMe()
      if (!me?.id) { alert("로그인이 필요합니다."); setSaving(false); return }

      // 1) history 확보
      const histRes = await fetch(`${API_BASE}/api/history`, {
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
      if (!histRes.ok) throw new Error("history 저장 실패")
      const hist = await histRes.json()
      const historyId = hist?.history_id
      if (!historyId) throw new Error("history_id 없음")

      // 2) 캔버스 blob 업로드
      const blob = await stageToBlob()
      const fd = new FormData()
      fd.append("file", blob, `edited_${Date.now()}.png`)
      const up = await fetch(`${API_BASE}/api/history/${historyId}/edited-image`, {
        method: "POST",
        credentials: "include",
        body: fd,
      })
      if (!up.ok) throw new Error("편집본 업로드 실패")
      const upJson = await up.json() // { edited_image_url }

      // 3) diaries 업서트
      const diaRes = await fetch(`${API_BASE}/api/diaries`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: me.id,
          photo_id: Number(photoId),
          music_id: Number(musicId),
          subject: "편집한 사진",
          content: `편집본: ${upJson.edited_image_url || ""}`,
        }),
      })
      if (!diaRes.ok) throw new Error("다이어리 저장 실패")

      router.push("/diary")
    } catch (e: any) {
      console.error(e)
      alert(e?.message || "편집 저장 중 오류가 발생했습니다.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="flex items-center justify-between px-4 h-14 border-b border-border bg-background">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="text-foreground hover:bg-accent">
          <X className="h-6 w-6" />
        </Button>
        <h1 className="text-base font-medium">편집</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleSaveEdited}
          disabled={saving || !imgUrl}
          className="text-primary hover:bg-accent disabled:text-muted-foreground"
        >
          <Check className="h-6 w-6" />
        </Button>
      </header>

      <div ref={canvasBoxRef} className="flex-1 flex items-center justify-center p-2 sm:p-4 overflow-hidden bg-muted/30">
        {loading || !imgUrl || !natural ? (
          <div className="text-center text-muted-foreground">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
            이미지 불러오는 중...
          </div>
        ) : (
          <Stage
            ref={stageRef}
            width={fit.w}
            height={fit.h}
            className="shadow-2xl bg-white rounded-lg"
            style={{ cursor: activeTool === "draw" ? "crosshair" : "default" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onTouchStart={handleMouseDown}
            onTouchMove={handleMouseMove}
            onTouchEnd={handleMouseUp}
            onClick={onStageClick}
          >
            <Layer ref={baseLayerRef}>
              <Group
                x={fit.w / 2}
                y={fit.h / 2}
                offset={{ x: natural.w / 2, y: natural.h / 2 }}
                scale={{ x: fit.scale, y: fit.scale }}
                rotation={rotation}
              >
                <UseImage src={imgUrl} brightness={brightness} />
              </Group>
              {lines.map((l, i) => (
                <Line key={i} points={l.points} stroke={l.color} strokeWidth={l.size} tension={0.4} lineCap="round" lineJoin="round" />
              ))}
            </Layer>
            <Layer ref={stickerLayerRef}>
              {placed.map((s) => (
                <StickerNode
                  key={s.id}
                  nodeId={s.id}
                  url={s.url}
                  x={s.x}
                  y={s.y}
                  rotation={s.rotation}
                  scale={s.scale}
                  selected={selectedId === s.id}
                  onSelect={() => setSelectedId(s.id)}
                  onChange={(patch) => updatePlaced(s.id, patch)}
                />
              ))}
              <Transformer
                ref={trRef}
                rotateEnabled
                enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
                anchorCornerRadius={8}
                anchorSize={10}
                borderDash={[4, 4]}
                borderStroke="#0095f6"
              />
            </Layer>
          </Stage>
        )}
      </div>

      <div className="border-t border-border bg-background">
        {activeTool && (
          <div className="px-4 py-4 border-b border-border bg-background">
            {activeTool === "rotate" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">회전</span>
                  <span className="text-foreground font-medium">{rotation}°</span>
                </div>
                <input type="range" min={-180} max={180} value={rotation} onChange={(e) => setRotation(Number(e.target.value))} className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary" />
              </div>
            )}
            {activeTool === "brightness" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">밝기</span>
                  <span className="text-foreground font-medium">{brightness}%</span>
                </div>
                <input type="range" min={50} max={150} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary" />
              </div>
            )}
            {activeTool === "draw" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">색상</span>
                    <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} className="h-8 w-12 rounded border border-border cursor-pointer bg-transparent" />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setLines([])} disabled={lines.length === 0} className="text-primary hover:bg-accent disabled:text-muted-foreground">
                    지우기
                  </Button>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">두께</span>
                    <span className="text-foreground font-medium">{brushSize}px</span>
                  </div>
                  <input type="range" min={2} max={24} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary" />
                </div>
              </div>
            )}
            {activeTool === "sticker" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">스티커</span>
                  <label className="cursor-pointer">
                    <Button variant="ghost" size="sm" asChild className="text-primary hover:bg-accent"><span>업로드</span></Button>
                    <input type="file" accept="image/*" onChange={onStickerFileChange} className="hidden" />
                  </label>
                </div>
                <div className="grid grid-cols-6 gap-2 max-h-[120px] overflow-y-auto">
                  {stickerList.length === 0 ? (
                    <div className="col-span-6 text-center py-4 text-sm text-muted-foreground">스티커가 없습니다</div>
                  ) : (
                    stickerList.map((s) => (
                      <button key={s.sticker_id} onClick={() => addStickerToStage(s)} className="aspect-square bg-muted rounded-md overflow-hidden hover:ring-2 hover:ring-primary transition-all">
                        <img src={`${API_BASE}/api/stickers/${s.sticker_id}/binary`} alt={s.name || String(s.sticker_id)} className="w-full h-full object-contain" crossOrigin="anonymous" />
                      </button>
                    ))
                  )}
                </div>
                {selectedId && (
                  <Button variant="ghost" size="sm" onClick={() => { setPlaced((prev) => prev.filter((p) => p.id !== selectedId)); setSelectedId(null) }} className="w-full text-destructive hover:bg-destructive/10">
                    선택한 스티커 삭제
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-around px-4 py-3">
          <button onClick={() => setActiveTool(activeTool === "rotate" ? null : "rotate")} className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${activeTool === "rotate" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            <RotateCw className="h-6 w-6" /><span className="text-xs">회전</span>
          </button>
          <button onClick={() => setActiveTool(activeTool === "brightness" ? null : "brightness")} className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${activeTool === "brightness" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            <Sun className="h-6 w-6" /><span className="text-xs">밝기</span>
          </button>
          <button onClick={() => setActiveTool(activeTool === "draw" ? null : "draw")} className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${activeTool === "draw" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            <Pencil className="h-6 w-6" /><span className="text-xs">그리기</span>
          </button>
          <button onClick={() => setActiveTool(activeTool === "sticker" ? null : "sticker")} className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${activeTool === "sticker" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            <Sticker className="h-6 w-6" /><span className="text-xs">스티커</span>
          </button>
          <button onClick={resetEdits} className="flex flex-col items-center gap-1 p-2 rounded-lg text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className="h-6 w-6" /><span className="text-xs">초기화</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function StickerNode({
  nodeId, url, x, y, rotation, scale, selected, onSelect, onChange,
}: {
  nodeId: string
  url: string
  x: number
  y: number
  rotation: number
  scale: number
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<{ x: number; y: number; rotation: number; scale: number }>) => void
}) {
  const [img] = useImage(url, "anonymous")
  const ref = useRef<any>(null)
  useEffect(() => { if (ref.current) ref.current.setAttr("nodeId", nodeId) }, [nodeId])

  return (
    <KImage
      ref={ref}
      image={img || undefined}
      x={x}
      y={y}
      rotation={rotation}
      scaleX={scale}
      scaleY={scale}
      draggable
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={() => {
        const node = ref.current
        if (!node) return
        const scaleX = node.scaleX()
        node.scaleX(1); node.scaleY(1)
        onChange({ x: node.x(), y: node.y(), rotation: node.rotation(), scale: scale * scaleX })
      }}
      shadowForStrokeEnabled={false}
      perfectDrawEnabled={false}
      hitStrokeWidth={10}
      listening
    />
  )
}
