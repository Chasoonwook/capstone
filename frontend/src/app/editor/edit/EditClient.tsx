// src/app/editor/edit/EditorClient.tsx
"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { API_BASE } from "@/lib/api"
import { RotateCw, Sun, Pencil, Sticker, RefreshCw, Check, X } from "lucide-react"
import { Stage, Layer, Image as KImage, Line, Group, Transformer } from "react-konva"
import useImage from "use-image"
import Konva from "konva"
import "konva/lib/filters/Brighten"

/* ---------- 타입 ---------- */
type StickerMeta = { sticker_id: number; name?: string | null }
type PlacedSticker = {
  id: string
  sticker_id: number
  x: number
  y: number
  rotation: number
  scale: number
  url: string
}
type Draft = {
  rotation: number
  brightness: number
  lines: Array<{ points: number[]; color: string; size: number }>
  placed: PlacedSticker[]
}

/* ---------- 유틸 ---------- */
const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 1024, height: 768 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const cr = entry?.contentRect
      if (!cr) return
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

function BaseImage({ src, brightness }: { src: string; brightness: number }) {
  const [img] = useImage(src, "anonymous")
  const ref = useRef<any>(null)
  useEffect(() => {
    if (!img || !ref.current) return
    ref.current.cache()
    ref.current.filters([Konva.Filters.Brighten])
    ref.current.brightness((brightness - 100) / 100)
  }, [img, brightness])
  return <KImage ref={ref} image={img || undefined} listening={false} />
}

const fitRect = (nw: number, nh: number, maxW: number, maxH: number) => {
  const s = Math.min(maxW / nw, maxH / nh, 1)
  return { w: Math.floor(nw * s), h: Math.floor(nh * s), s }
}

/* ================= 메인 컴포넌트 ================= */
export default function EditorClient() {
  const qs = useSearchParams()
  const router = useRouter()

  const photoId = qs.get("photoId")
  const draftKey = useMemo(() => (photoId ? `editor_draft::${photoId}` : ""), [photoId])

  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [rotation, setRotation] = useState(0)
  const [brightness, setBrightness] = useState(100)
  const [brushColor, setBrushColor] = useState("#0095f6")
  const [brushSize, setBrushSize] = useState(6)
  const [isDrawing, setIsDrawing] = useState(false)
  const [lines, setLines] = useState<Array<{ points: number[]; color: string; size: number }>>([])
  const [stickerList, setStickerList] = useState<StickerMeta[]>([])
  const [placed, setPlaced] = useState<PlacedSticker[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tool, setTool] = useState<"rotate" | "brightness" | "draw" | "sticker" | null>(null)

  const stageRef = useRef<any>(null)
  const stickerLayerRef = useRef<any>(null)
  const trRef = useRef<any>(null)

  const { ref: boxRef, size: box } = useElementSize<HTMLDivElement>()

  /* ---------- 원본 이미지 로드 ---------- */
  useEffect(() => {
    if (!photoId) return
    let revoke: string | null = null
    let cancelled = false
    ;(async () => {
      const candidates = [
        `${API_BASE}/api/photos/${photoId}/binary`,
        `${API_BASE}/photos/${photoId}/binary`,
      ]
      for (const u of candidates) {
        try {
          const r = await fetch(u)
          if (!r.ok) continue
          const blob = await r.blob()
          const url = URL.createObjectURL(blob)
          revoke = url
          const tmp = new Image()
          tmp.onload = () => {
            if (cancelled) return
            setNatural({ w: tmp.naturalWidth, h: tmp.naturalHeight })
            setImgUrl(url)
            setLoading(false)
          }
          tmp.src = url
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
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [photoId])

  /* ---------- 스티커 목록 ---------- */
  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/stickers`, { credentials: "include" })
        if (r.ok) setStickerList(await r.json())
      } catch {}
    })()
  }, [])

  /* ---------- 드래프트 로드 ---------- */
  useEffect(() => {
    if (!draftKey) return
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const d = JSON.parse(raw) as Draft
      if (typeof d.rotation === "number") setRotation(d.rotation)
      if (typeof d.brightness === "number") setBrightness(d.brightness)
      if (Array.isArray(d.lines)) setLines(d.lines)
      if (Array.isArray(d.placed)) setPlaced(d.placed)
    } catch {}
    // 저장된 드래프트는 편집이 끝나면(✔/✖) 지웁니다.
  }, [draftKey])

  /* ---------- 드래프트 저장 (변경시) ---------- */
  useEffect(() => {
    if (!draftKey) return
    const draft: Draft = { rotation, brightness, lines, placed }
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft))
    } catch {}
  }, [draftKey, rotation, brightness, lines, placed])

  const clearDraft = useCallback(() => {
    if (!draftKey) return
    try {
      localStorage.removeItem(draftKey)
    } catch {}
  }, [draftKey])

  /* ---------- Stage/도형 핸들러 ---------- */
  const onDown = (e: any) => {
    if (e.target === e.target.getStage()) setSelectedId(null)
    if (tool !== "draw") return
    setIsDrawing(true)
    const pos = e.target.getStage().getPointerPosition()
    if (!pos) return
    setLines((prev) => prev.concat({ points: [pos.x, pos.y], color: brushColor, size: brushSize }))
  }
  const onMove = (e: any) => {
    if (tool !== "draw" || !isDrawing) return
    const pos = e.target.getStage().getPointerPosition()
    if (!pos) return
    setLines((prev) => {
      const last = prev[prev.length - 1]
      const upd = { ...last, points: [...last.points, pos.x, pos.y] }
      return prev.slice(0, -1).concat(upd)
    })
  }
  const onUp = () => tool === "draw" && setIsDrawing(false)
  useEffect(() => {
    if (tool !== "draw" && isDrawing) setIsDrawing(false)
  }, [tool, isDrawing])

  useEffect(() => {
    const tr = trRef.current
    const layer = stickerLayerRef.current
    if (!tr || !layer) return
    const node = layer.findOne((n: any) => n.getAttr("nodeId") === selectedId)
    if (node) tr.nodes([node])
    else tr.nodes([])
    tr.getLayer()?.batchDraw()
  }, [selectedId, placed])

  const addSticker = (meta: StickerMeta) =>
    setPlaced((p) =>
      p.concat({
        id: uuid(),
        sticker_id: meta.sticker_id,
        x: (fit?.w || 640) / 2 - 64,
        y: (fit?.h || 480) / 2 - 64,
        rotation: 0,
        scale: 1,
        url: `${API_BASE}/api/stickers/${meta.sticker_id}/binary`,
      }),
    )

  const patchPlaced = (id: string, patch: Partial<PlacedSticker>) =>
    setPlaced((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  const resetAll = () => {
    setRotation(0)
    setBrightness(100)
    setLines([])
    setPlaced([])
    setSelectedId(null)
    setTool(null)
  }

  /* ---------- 저장(원본 교체) & 나가기 ---------- */
  const stageToBlob = async (): Promise<Blob> => {
    const stage = stageRef.current as any
    const dataURL: string = stage.toDataURL({ pixelRatio: 1, mimeType: "image/png" })
    const res = await fetch(dataURL)
    return res.blob()
  }

  const uploadEdited = async (blob: Blob) => {
    if (!photoId) throw new Error("photoId is missing")
    const urls = [
      `${API_BASE}/api/photos/${photoId}/binary`,
      `${API_BASE}/photos/${photoId}/binary`,
    ]
    const form = () => {
      const fd = new FormData()
      fd.append("file", blob, "edited.png")
      return fd
    }
    for (const u of urls) {
      try {
        let r = await fetch(u, { method: "PUT", body: form(), credentials: "include" })
        if (r.ok) return true
        r = await fetch(u, { method: "POST", body: form(), credentials: "include" })
        if (r.ok) return true
      } catch {}
    }
    return false
  }

  const handleConfirm = async () => {
    if (!imgUrl) return
    setSaving(true)
    setErr(null)
    try {
      const blob = await stageToBlob()
      const ok = await uploadEdited(blob) // ✅ 원본 교체
      if (!ok) throw new Error("편집본 업로드에 실패했습니다.")
      clearDraft()                        // ✅ 드래프트 삭제
      router.push("/")                    // ✅ 메인으로 이동
    } catch (e: any) {
      setErr(e?.message || "저장 중 오류가 발생했습니다.")
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    clearDraft()          // ✅ 취소 시 드래프트 삭제
    router.back()
  }

  /* ---------- 레이아웃/뷰 ---------- */
  const maxW = Math.max(320, box.width - 8)
  const maxH = Math.max(240, box.height - 8)
  const fit = useMemo(
    () => (natural ? fitRect(natural.w, natural.h, maxW, maxH) : { w: 640, h: 480, s: 1 }),
    [natural, maxW, maxH],
  )

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-4 h-14 border-b border-border bg-background">
        <Button variant="ghost" size="icon" onClick={handleCancel} className="hover:bg-accent" aria-label="취소">
          <X className="h-6 w-6" />
        </Button>
        <h1 className="text-base font-medium">편집</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleConfirm}
          disabled={saving || !imgUrl}
          className="text-primary hover:bg-accent disabled:opacity-50"
          aria-label="저장하고 메인으로"
        >
          <Check className="h-6 w-6" />
        </Button>
      </header>

      {/* Canvas */}
      <div ref={boxRef} className="flex-1 flex items-center justify-center p-2 sm:p-4 overflow-hidden bg-muted/30">
        {loading || !imgUrl || !natural ? (
          <div className="text-muted-foreground">이미지 불러오는 중…</div>
        ) : (
          <Stage
            ref={stageRef}
            width={fit.w}
            height={fit.h}
            className="shadow-2xl bg-white rounded-lg"
            style={{ cursor: tool === "draw" ? "crosshair" : "default" }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onTouchStart={onDown}
            onTouchMove={onMove}
            onTouchEnd={onUp}
            onClick={(e) => e.target === e.target.getStage() && setSelectedId(null)}
          >
            <Layer>
              <Group
                x={fit.w / 2}
                y={fit.h / 2}
                offset={{ x: natural.w / 2, y: natural.h / 2 }}
                scale={{ x: fit.s, y: fit.s }}
                rotation={rotation}
              >
                <BaseImage src={imgUrl} brightness={brightness} />
              </Group>
              {lines.map((l, i) => (
                <Line
                  key={i}
                  points={l.points}
                  stroke={l.color}
                  strokeWidth={l.size}
                  tension={0.4}
                  lineCap="round"
                  lineJoin="round"
                />
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
                  onChange={(patch) => patchPlaced(s.id, patch)}
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

      {/* Tool panel */}
      <div className="border-t border-border bg-background">
        {tool && (
          <div className="px-4 py-4 border-b border-border">
            {tool === "rotate" && (
              <SliderLabeled label="회전" value={rotation} min={-180} max={180} onChange={setRotation} suffix="°" />
            )}
            {tool === "brightness" && (
              <SliderLabeled label="밝기" value={brightness} min={50} max={150} onChange={setBrightness} suffix="%" />
            )}
            {tool === "draw" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">색상</span>
                    <input
                      type="color"
                      value={brushColor}
                      onChange={(e) => setBrushColor(e.target.value)}
                      className="h-8 w-12 rounded border"
                    />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setLines([])} className="text-primary">
                    지우기
                  </Button>
                </div>
                <SliderLabeled label="두께" value={brushSize} min={2} max={24} onChange={setBrushSize} suffix="px" />
              </div>
            )}
            {tool === "sticker" && (
              <StickerPanel
                stickers={stickerList}
                onPick={(s) => addSticker(s)}
                onUpload={async (f) => {
                  const fd = new FormData()
                  fd.append("file", f)
                  fd.append("name", f.name)
                  const r = await fetch(`${API_BASE}/api/stickers`, { method: "POST", body: fd, credentials: "include" })
                  if (r.ok) {
                    const list = await fetch(`${API_BASE}/api/stickers`, { credentials: "include" })
                    if (list.ok) setStickerList(await list.json())
                  } else {
                    alert("스티커 업로드 실패")
                  }
                }}
                onDeleteSelected={() => {
                  if (!selectedId) return
                  setPlaced((prev) => prev.filter((p) => p.id !== selectedId))
                  setSelectedId(null)
                }}
                hasSelected={!!selectedId}
              />
            )}
          </div>
        )}

        {/* Tool icons */}
        <div className="flex items-center justify-around px-4 py-3">
          <ToolBtn label="회전"    active={tool === "rotate"}     onClick={() => setTool(tool === "rotate" ? null : "rotate")}    icon={<RotateCw className="h-6 w-6" />} />
          <ToolBtn label="밝기"    active={tool === "brightness"} onClick={() => setTool(tool === "brightness" ? null : "brightness")} icon={<Sun className="h-6 w-6" />} />
          <ToolBtn label="그리기"  active={tool === "draw"}       onClick={() => setTool(tool === "draw" ? null : "draw")}        icon={<Pencil className="h-6 w-6" />} />
          <ToolBtn label="스티커"  active={tool === "sticker"}    onClick={() => setTool(tool === "sticker" ? null : "sticker")}  icon={<Sticker className="h-6 w-6" />} />
          <ToolBtn label="초기화"  onClick={resetAll} icon={<RefreshCw className="h-6 w-6" />} />
        </div>
      </div>

      {err && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-destructive text-destructive-foreground px-4 py-2 rounded-lg shadow-lg text-sm">
          {err}
        </div>
      )}
    </div>
  )
}

/* ---------- 보조 UI ---------- */
function SliderLabeled({
  label, value, min, max, onChange, suffix,
}: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}{suffix ?? ""}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  )
}

function ToolBtn({ label, active, onClick, icon }: { label: string; active?: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      <span className="text-xs">{label}</span>
    </button>
  )
}

function StickerPanel({
  stickers, onPick, onUpload, onDeleteSelected, hasSelected,
}: {
  stickers: StickerMeta[]
  onPick: (s: StickerMeta) => void
  onUpload: (file: File) => void
  onDeleteSelected: () => void
  hasSelected: boolean
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">스티커</span>
        <label className="cursor-pointer">
          <Button variant="ghost" size="sm" asChild className="text-primary"><span>업로드</span></Button>
          <input type="file" accept="image/*" className="hidden"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = "" }} />
        </label>
      </div>
      <div className="grid grid-cols-6 gap-2 max-h-[120px] overflow-y-auto">
        {stickers.length === 0 ? (
          <div className="col-span-6 text-center py-4 text-sm text-muted-foreground">스티커가 없습니다</div>
        ) : (
          stickers.map((s) => (
            <button key={s.sticker_id} onClick={() => onPick(s)}
              className="aspect-square bg-muted rounded-md overflow-hidden hover:ring-2 hover:ring-primary">
              <img src={`${API_BASE}/api/stickers/${s.sticker_id}/binary`} className="w-full h-full object-contain" crossOrigin="anonymous" />
            </button>
          ))
        )}
      </div>
      {hasSelected && (
        <Button variant="ghost" size="sm" onClick={onDeleteSelected} className="w-full text-destructive">
          선택한 스티커 삭제
        </Button>
      )}
    </div>
  )
}

/* ---------- 스티커 노드 ---------- */
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
  onChange: (patch: Partial<PlacedSticker>) => void
}) {
  const [img] = useImage(url, "anonymous")
  const ref = useRef<any>(null)
  useEffect(() => { ref.current?.setAttr("nodeId", nodeId) }, [nodeId])
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
        const sx = node.scaleX()
        node.scaleX(1); node.scaleY(1)
        onChange({ x: node.x(), y: node.y(), rotation: node.rotation(), scale: scale * sx })
      }}
      shadowForStrokeEnabled={false}
      perfectDrawEnabled={false}
      hitStrokeWidth={10}
      listening
    />
  )
}
