// src/app/editor/edit/EditClient.tsx
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/api";
import { fetchMe } from "@/app/recommend/hooks/useAuthMe";

/* Konva */
import { Stage, Layer, Image as KImage, Line, Group, Transformer } from "react-konva";
import useImage from "use-image";
import Konva from "konva";
import "konva/lib/filters/Brighten";

/* ------------------------------ 타입 ------------------------------ */
type StickerMeta = {
  sticker_id: number;
  name?: string | null;
  mime_type?: string | null;
};

/* 스테이지에 올린 스티커 1개 */
type PlacedSticker = {
  id: string;                // uuid-like
  sticker_id: number;        // 서버상의 스티커 id
  x: number;
  y: number;
  rotation: number;
  scale: number;
  url: string;               // /api/stickers/:id/binary
};

/* ------------------------------ 유틸 ------------------------------ */
const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/* Konva용 이미지 로더 (원본 사진, 스티커 공용) */
function UseImage({ src, brightness, rotation, onImgReady }: {
  src: string;
  brightness: number; // 50~150
  rotation: number;   // deg
  onImgReady?: (node: any) => void;
}) {
  const [img] = useImage(src, "anonymous");
  const ref = useRef<any>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !img) return;

    // 필터 등록 및 적용
    node.cache(); // 필터 적용 전 cache 필수
    node.filters([Konva.Filters.Brighten]);

    // Konva Brighten은 -1..1 범위
    const val = (brightness - 100) / 100;
    node.brightness(val);

    onImgReady?.(node);
  }, [img, brightness, onImgReady]);

  return (
    <KImage
      ref={ref}
      image={img || undefined}
      rotation={rotation}
      listening={false}
    />
  );
}

/* 미리보기 사이즈(스테이지 크기) 계산: 원본 이미지 비율 유지 */
function useFitSize(naturalW: number | null, naturalH: number | null, maxW = 1024, maxH = 768) {
  return useMemo(() => {
    if (!naturalW || !naturalH) return { w: 640, h: 480, scale: 1 };
    const rw = maxW / naturalW;
    const rh = maxH / naturalH;
    const s = Math.min(rw, rh, 1); // 확대는 하지 않음
    return { w: Math.floor(naturalW * s), h: Math.floor(naturalH * s), scale: s };
  }, [naturalW, naturalH, maxW, maxH]);
}

/* ------------------------------ 메인 컴포넌트 ------------------------------ */
export default function EditClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const photoId = searchParams.get("photoId");
  const historyId = searchParams.get("historyId");
  const musicId = searchParams.get("musicId");

  /* 원본 이미지 로드(Blob URL로 교체하여 CORS 오염 방지) */
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /* 편집 상태 */
  const [rotation, setRotation] = useState<number>(0);     // -180..180
  const [brightness, setBrightness] = useState<number>(100); // 50..150

  /* 드로잉 상태 */
  const [brushColor, setBrushColor] = useState<string>("#ff5c93");
  const [brushSize, setBrushSize] = useState<number>(6);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lines, setLines] = useState<Array<{ points: number[]; color: string; size: number }>>([]);

  /* 스티커 상태 */
  const [stickerList, setStickerList] = useState<StickerMeta[]>([]);
  const [placed, setPlaced] = useState<PlacedSticker[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* 스테이지/레이어 참조 */
  const stageRef = useRef<any>(null);
  const baseLayerRef = useRef<any>(null);
  const stickerLayerRef = useRef<any>(null);
  const trRef = useRef<any>(null);

  /* 원본 이미지 불러오기(Blob URL) */
  useEffect(() => {
    if (!photoId) return;
    let revokeUrl: string | null = null;
    let cancelled = false;

    const candidates = [
      `${API_BASE}/api/photos/${photoId}/binary`,
      `${API_BASE}/photos/${photoId}/binary`,
    ];

    (async () => {
      for (const u of candidates) {
        try {
          const r = await fetch(u, { method: "GET" });
          if (!r.ok) continue;
          const blob = await r.blob();
          const objectUrl = URL.createObjectURL(blob);
          revokeUrl = objectUrl;

          // natural size 추출
          const tmp = new Image();
          tmp.onload = () => {
            if (!cancelled) {
              setNatural({ w: tmp.naturalWidth, h: tmp.naturalHeight });
              setImgUrl(objectUrl);
              setLoading(false);
            }
          };
          tmp.src = objectUrl;
          return;
        } catch {}
      }
      if (!cancelled) {
        setImgUrl("/placeholder.svg");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [photoId]);

  const fit = useFitSize(natural?.w ?? null, natural?.h ?? null, 1024, 768);

  /* 스티커 목록 불러오기 */
  const fetchStickers = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/stickers`, { credentials: "include" });
      if (r.ok) {
        const arr: StickerMeta[] = await r.json();
        setStickerList(arr || []);
      }
    } catch {}
  }, []);
  useEffect(() => {
    fetchStickers();
  }, [fetchStickers]);

  /* 스티커 업로드 → stickers 테이블 저장 (multipart: file, name) */
  const handleUploadSticker = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", file.name);
    try {
      let r = await fetch(`${API_BASE}/api/stickers`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (r.ok) {
        await fetchStickers();
      } else {
        alert("스티커 업로드 실패");
      }
    } catch {
      alert("스티커 업로드 중 오류");
    }
  };

  /* 스티커 추가(캔버스에 올리기) */
  const addStickerToStage = (meta: StickerMeta) => {
    const url = `${API_BASE}/api/stickers/${meta.sticker_id}/binary`;
    setPlaced((prev) => prev.concat({
      id: uuid(),
      sticker_id: meta.sticker_id,
      x: fit.w / 2 - 64,
      y: fit.h / 2 - 64,
      rotation: 0,
      scale: 1,
      url,
    }));
  };

  /* 드로잉 핸들러 */
  const handleMouseDown = (e: any) => {
    // 스티커 선택 해제(빈 곳 클릭 시)
    if (e.target === e.target.getStage()) setSelectedId(null);

    setIsDrawing(true);
    const pos = e.target.getStage().getPointerPosition();
    if (!pos) return;
    setLines((prev) => prev.concat({ points: [pos.x, pos.y], color: brushColor, size: brushSize }));
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing) return;
    const stage = e.target.getStage();
    const point = stage.getPointerPosition();
    if (!point) return;
    setLines((prev) => {
      const last = prev[prev.length - 1];
      const newLast = { ...last, points: [...last.points, point.x, point.y] };
      const copy = prev.slice(0, prev.length - 1).concat(newLast);
      return copy;
    });
  };

  const handleMouseUp = () => setIsDrawing(false);

  /* 트랜스포머 선택/적용 */
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const layer = stickerLayerRef.current;
    if (!layer) return;

    const node = layer.findOne((n: any) => n.getAttr("nodeId") === selectedId);
    if (node) {
      tr.nodes([node]);
      tr.getLayer()?.batchDraw();
    } else {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
    }
  }, [selectedId, placed]);

  /* 스티커 노드 업데이트(드래그/스케일/회전 후 상태 반영) */
  const updatePlaced = (id: string, patch: Partial<PlacedSticker>) => {
    setPlaced((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  /* 캔버스로 렌더 → Blob → 업로드 */
  const stageToBlob = async (): Promise<Blob> => {
    const stage = stageRef.current as any;
    const dataURL: string = stage.toDataURL({ pixelRatio: 1, mimeType: "image/png" });

    // dataURL → Blob
    const res = await fetch(dataURL);
    const blob = await res.blob();
    return blob;
  };

  /* PUT→실패시 POST 업로드 */
  const tryUploadEdited = async (blob: Blob) => {
    const targets = [
      `${API_BASE}/api/photos/${photoId}/binary`,
      `${API_BASE}/photos/${photoId}/binary`,
    ];
    const makeBody = () => {
      const fd = new FormData();
      fd.append("file", blob, "edited.png");
      return fd;
    };
    for (const url of targets) {
      try {
        let r = await fetch(url, { method: "PUT", body: makeBody(), credentials: "include" });
        if (r.ok) return true;
        r = await fetch(url, { method: "POST", body: makeBody(), credentials: "include" });
        if (r.ok) return true;
      } catch {}
    }
    return false;
  };

  /* 편집 저장 */
  const handleSaveEdited = async () => {
    if (!photoId) return alert("photoId가 없습니다.");
    if (!musicId) return alert("musicId가 없습니다. 이전 화면에서 선택한 곡과 함께 진입해야 합니다.");

    setSaving(true);
    try {
      // 권한 확인
      const me = await fetchMe();
      if (!me?.id) {
        alert("로그인이 필요합니다.");
        setSaving(false);
        return;
      }

      // 1) 스테이지 → Blob
      const blob = await stageToBlob();

      // 2) 편집본 업로드
      const ok = await tryUploadEdited(blob);
      if (!ok) {
        alert("편집본 업로드에 실패했습니다.");
        setSaving(false);
        return;
      }

      // 3) history 업서트
      const payload = {
        user_id: me.id,
        photo_id: Number(photoId),
        music_id: Number(musicId),
      };
      const r = await fetch(`${API_BASE}/api/history`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        alert("편집 저장(history) 요청에 실패했습니다.");
        setSaving(false);
        return;
      }

      router.push("/");
    } catch (e) {
      console.error(e);
      alert("편집 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  /* 리셋 */
  const resetEdits = () => {
    setRotation(0);
    setBrightness(100);
    setLines([]);
    setPlaced([]);
    setSelectedId(null);
  };

  /* 스티커 파일 업로드 입력 핸들러 */
  const onStickerFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleUploadSticker(f);
    e.currentTarget.value = "";
  };

  /* 스테이지 클릭 시 선택 해제 */
  const onStageClick = (e: any) => {
    if (e.target === e.target.getStage()) setSelectedId(null);
  };

  return (
    <div className="min-h-screen w-full bg-black text-white flex flex-col items-center py-8">
      <h1 className="text-2xl font-bold mb-2">사진 편집</h1>
      {historyId && (
        <p className="text-xs text-slate-400 mb-4">historyId: {historyId}</p>
      )}

      <div className="w-[64rem] max-w-[92vw]">
        {/* 편집 캔버스 / 사이드 툴 */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-6 items-start">
          {/* ====== 캔버스 ====== */}
          <div className="rounded-2xl overflow-hidden bg-white/5 p-3">
            {loading || !imgUrl || !natural ? (
              <div className="py-16 text-slate-400 text-center">이미지 불러오는 중…</div>
            ) : (
              <div className="flex justify-center">
                <Stage
                  ref={stageRef}
                  width={fit.w}
                  height={fit.h}
                  className="bg-black"
                  onMouseDown={handleMouseDown}
                  onMousemove={handleMouseMove}
                  onMouseup={handleMouseUp}
                  onTouchStart={handleMouseDown}
                  onTouchMove={handleMouseMove}
                  onTouchEnd={handleMouseUp}
                  onClick={onStageClick}
                >
                  {/* 배경 레이어 (원본 이미지 + 밝기/회전 반영) */}
                  <Layer ref={baseLayerRef}>
                    <Group
                      x={fit.w / 2}
                      y={fit.h / 2}
                      offset={{ x: natural.w / 2, y: natural.h / 2 }}
                      scale={{ x: fit.scale, y: fit.scale }}
                    >
                      <UseImage
                        src={imgUrl}
                        brightness={brightness}
                        rotation={rotation}
                      />
                    </Group>

                    {/* 드로잉 라인 */}
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

                  {/* 스티커 레이어 (드래그/회전/스케일) */}
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
                      enabledAnchors={[
                        "top-left",
                        "top-right",
                        "bottom-left",
                        "bottom-right",
                      ]}
                      anchorCornerRadius={8}
                      anchorSize={10}
                      borderDash={[4, 4]}
                    />
                  </Layer>
                </Stage>
              </div>
            )}
          </div>

          {/* ====== 사이드 툴 ====== */}
          <div className="bg-white/5 rounded-2xl p-4 space-y-4">
            <div>
              <div className="text-sm mb-2">회전 (도)</div>
              <input
                type="range"
                min={-180}
                max={180}
                value={rotation}
                onChange={(e) => setRotation(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-right text-xs mt-1">{rotation}°</div>
            </div>

            <div>
              <div className="text-sm mb-2">밝기 (%)</div>
              <input
                type="range"
                min={50}
                max={150}
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-right text-xs mt-1">{brightness}%</div>
            </div>

            <div className="border-t border-white/10 pt-3">
              <div className="text-sm font-semibold mb-2">펜(드로잉)</div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-slate-300">색상</label>
                <input
                  type="color"
                  value={brushColor}
                  onChange={(e) => setBrushColor(e.target.value)}
                  className="h-8 w-10 rounded"
                />
                <label className="text-xs text-slate-300 ml-3">두께</label>
                <input
                  type="range"
                  min={2}
                  max={24}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                />
                <span className="text-xs w-6 text-right">{brushSize}</span>
              </div>
              <div className="flex gap-2 mt-2">
                <Button variant="secondary" onClick={() => setLines([])}>
                  드로잉 지우기
                </Button>
              </div>
            </div>

            <div className="border-t border-white/10 pt-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold">스티커</div>
                <label className="text-xs underline cursor-pointer">
                  업로드
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onStickerFileChange}
                    className="hidden"
                  />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-2 max-h-[220px] overflow-auto pr-1">
                {stickerList.length === 0 && (
                  <div className="col-span-3 text-xs text-slate-400">
                    스티커가 없습니다. 이미지를 업로드해 추가하세요.
                  </div>
                )}
                {stickerList.map((s) => (
                  <button
                    key={s.sticker_id}
                    onClick={() => addStickerToStage(s)}
                    className="bg-white/10 rounded-md overflow-hidden hover:bg-white/20"
                    title={s.name || `#${s.sticker_id}`}
                  >
                    {/* 미리보기 이미지 */}
                    <img
                      src={`${API_BASE}/api/stickers/${s.sticker_id}/binary`}
                      alt={s.name || String(s.sticker_id)}
                      className="w-full h-16 object-contain bg-black"
                      crossOrigin="anonymous"
                    />
                  </button>
                ))}
              </div>
              {selectedId && (
                <div className="flex gap-2 mt-2">
                  <Button
                    variant="destructive"
                    onClick={() =>
                      setPlaced((prev) => prev.filter((p) => p.id !== selectedId))
                    }
                  >
                    선택 스티커 삭제
                  </Button>
                  <Button variant="secondary" onClick={() => setSelectedId(null)}>
                    선택 해제
                  </Button>
                </div>
              )}
            </div>

            <div className="border-t border-white/10 pt-3 flex items-end justify-between">
              <Button variant="secondary" onClick={resetEdits}>
                초기화
              </Button>
              <Button
                className="bg-pink-500 hover:bg-pink-600 text-white"
                onClick={handleSaveEdited}
                disabled={saving || !imgUrl}
              >
                {saving ? "저장 중…" : "편집 저장"}
              </Button>
            </div>

            <div className="pt-1">
              <Button
                onClick={() => router.back()}
                className="w-full bg-white !text-slate-900 hover:bg-white/90 border border-white/20 shadow-sm mt-2"
              >
                뒤로가기
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ 스티커 노드 ------------------------------ */
/* 드래그/스케일/회전 가능한 스티커 1개 */
function StickerNode({
  nodeId,
  url,
  x,
  y,
  rotation,
  scale,
  selected,
  onSelect,
  onChange,
}: {
  nodeId: string;
  url: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<{
    x: number; y: number; rotation: number; scale: number;
  }>) => void;
}) {
  const [img] = useImage(url, "anonymous");
  const ref = useRef<any>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.setAttr("nodeId", nodeId); // 트랜스포머 타겟팅 용
    }
  }, [nodeId]);

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
      onTransformEnd={(e) => {
        const node = ref.current;
        if (!node) return;
        const scaleX = node.scaleX();
        // Konva는 자유 스케일(비율 변형)이라, 균일 스케일로 묶음
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          x: node.x(),
          y: node.y(),
          rotation: node.rotation(),
          scale: scale * scaleX,
        });
      }}
      shadowForStrokeEnabled={false}
      perfectDrawEnabled={false}
      hitStrokeWidth={10}
      listening
    />
  );
}
