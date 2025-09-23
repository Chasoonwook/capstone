// src/app/editor/edit/EditClient.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/api";
import { fetchMe } from "@/app/recommend/hooks/useAuthMe";

export default function EditClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const photoId = searchParams.get("photoId");
  const historyId = searchParams.get("historyId");
  const musicId = searchParams.get("musicId"); // 업서트에 필요

  // 화면용 이미지 URL(Blob URL) — CORS taint 방지
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 간단 편집 상태
  const [rotation, setRotation] = useState<number>(0);
  const [brightness, setBrightness] = useState<number>(100);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /* 이미지 불러오기: 원격 이미지를 fetch -> Blob -> ObjectURL 로 변환해서 표시 */
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
          const r = await fetch(u, { method: "GET", mode: "cors" });
          if (!r.ok) continue;
          const blob = await r.blob();
          const objectUrl = URL.createObjectURL(blob);
          revokeUrl = objectUrl;
          if (!cancelled) {
            setImgUrl(objectUrl); // Blob URL → 캔버스 오염 X
            setLoading(false);
          }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoId]);

  /* 캔버스 렌더링 */
  const renderToCanvas = async () => {
    const imgEl = imgRef.current;
    const canvas = canvasRef.current;
    if (!imgEl || !canvas) return null;

    try {
      // @ts-ignore: 일부 브라우저는 decode 미지원
      if (imgEl.decode) await imgEl.decode();
    } catch {
      if (!imgEl.complete || !imgEl.naturalWidth) {
        await new Promise<void>((res) => {
          imgEl.onload = () => res();
        });
      }
    }

    // 회전 고려 크기 계산
    const rad = (rotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const w = imgEl.naturalWidth;
    const h = imgEl.naturalHeight;

    const outW = Math.floor(w * cos + h * sin);
    const outH = Math.floor(w * sin + h * cos);

    canvas.width = outW;
    canvas.height = outH;

    const ctx = canvas.getContext("2d")!;
    ctx.save();
    const b = brightness / 100;
    ctx.filter = `brightness(${b})`;
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(rad);
    ctx.drawImage(imgEl, -w / 2, -h / 2);
    ctx.restore();

    return canvas;
  };

  /* 편집본 업로드: FormData(file)로 PUT→실패시 POST */
  const tryUploadEdited = async (blob: Blob) => {
    const targets = [
      `${API_BASE}/api/photos/${photoId}/binary`,
      `${API_BASE}/photos/${photoId}/binary`,
    ];

    // FormData에 file 필드로 넣기 (multer.single("file")와 매칭)
    const makeBody = () => {
      const fd = new FormData();
      fd.append("file", blob, "edited.png");
      return fd;
    };

    for (const url of targets) {
      try {
        let r = await fetch(url, {
          method: "PUT",
          body: makeBody(),
          credentials: "include",
        });
        if (r.ok) return true;

        r = await fetch(url, {
          method: "POST",
          body: makeBody(),
          credentials: "include",
        });
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
      // 1) 캔버스로 렌더
      const canvas = await renderToCanvas();
      if (!canvas) {
        alert("이미지를 준비하지 못했습니다.");
        setSaving(false);
        return;
      }

      // 2) Blob으로 변환
      const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png", 0.92)
      );

      // 3) 이미지 업로드 (PUT → 실패시 POST)
      const uploaded = await tryUploadEdited(blob);
      if (!uploaded) {
        alert("편집본 업로드에 실패했습니다.");
        setSaving(false);
        return;
      }

      // 4) history 업서트
      const me = await fetchMe();
      if (!me?.id) {
        alert("로그인이 필요합니다.");
        setSaving(false);
        return;
      }
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

      // 완료
      router.push("/");
    } catch (e) {
      console.error(e);
      alert("편집 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const resetEdits = () => {
    setRotation(0);
    setBrightness(100);
  };

  const previewStyle = useMemo(
    () => ({
      transform: `rotate(${rotation}deg)`,
      filter: `brightness(${brightness}%)`,
      transition: "transform 120ms ease, filter 120ms ease",
    }),
    [rotation, brightness]
  );

  return (
    <div className="min-h-screen w-full bg-black text-white flex flex-col items-center py-8">
      <h1 className="text-2xl font-bold mb-2">사진 편집</h1>
      {historyId && (
        <p className="text-xs text-slate-400 mb-4">historyId: {historyId}</p>
      )}

      <div className="w-[64rem] max-w-[92vw]">
        {/* 미리보기 */}
        <div className="w-full rounded-2xl overflow-hidden bg-white/5 flex items-center justify-center min-h-[320px]">
          {loading ? (
            <div className="py-16 text-slate-400">이미지 불러오는 중…</div>
          ) : (
            imgUrl && (
              <img
                ref={imgRef}
                src={imgUrl}
                alt="preview"
                className="max-h-[70vh] object-contain"
                style={previewStyle as any}
                crossOrigin="anonymous" // 안전장치
              />
            )
          )}
        </div>

        {/* 편집 컨트롤 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="bg-white/5 rounded-xl p-4">
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
          <div className="bg-white/5 rounded-xl p-4">
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
          <div className="bg-white/5 rounded-xl p-4 flex items-end justify-between">
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
        </div>

        {/* 숨김 캔버스(저장용) */}
        <canvas ref={canvasRef} className="hidden" />

        {/* 하단 내비게이션 */}
        <div className="flex justify-center gap-3 mt-6">
          <Button
            onClick={() => router.back()}
            className="bg-white !text-slate-900 hover:bg-white/90 border border-white/20 shadow-sm"
          >
            뒤로가기
          </Button>
        </div>
      </div>
    </div>
  );
}
