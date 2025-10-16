"use client";

import { useMemo } from "react";
import { usePlayer } from "@/contexts/PlayerContext";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, SkipBack, SkipForward, Volume2 } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";

function msToMMSS(ms: number) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function NowPlayingBar() {
  const {
    queue,
    index,
    state,              // { position(ms), duration(ms), paused, isSpotify }
    volume,
    setVolume,
    toggle,
    next,
    prev,
    seek,
  } = usePlayer();

  const current = index >= 0 && index < queue.length ? queue[index] : null;

  // 위치/길이 (초 단위 슬라이더용)
  const curMs = state.position ?? 0;
  const durMs = state.duration ?? 0;
  const curSec = Math.floor(curMs / 1000);
  const durSec = Math.max(0, Math.floor(durMs / 1000));

  // 아무것도 없으면 바 숨김 (원하면 skeleton 그려도 OK)
  if (!current) return null;

  const cover = current.coverUrl || "/placeholder.svg";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-black/90 backdrop-blur border-t border-white/10">
      <div className="mx-auto max-w-5xl px-4 py-2 flex items-center gap-3 text-white">

        {/* 앨범 커버 + 텍스트 */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 relative flex-shrink-0 overflow-hidden rounded">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover} alt={current.title} className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{current.title}</div>
            <div className="text-xs text-white/70 truncate">{current.artist}</div>
          </div>
        </div>

        {/* 컨트롤 */}
        <div className="flex items-center gap-2 ml-2">
          <button
            className="p-2 rounded hover:bg-white/10"
            onClick={prev}
            title="이전"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            className="p-2 rounded bg-white text-black hover:bg-white/90"
            onClick={toggle}
            title={state.paused ? "재생" : "일시정지"}
          >
            {state.paused ? <Play className="w-5 h-5 ml-0.5" /> : <Pause className="w-5 h-5" />}
          </button>

          <button
            className="p-2 rounded hover:bg-white/10"
            onClick={next}
            title="다음"
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        {/* 진행바 */}
        <div className="flex-1 flex items-center gap-2 min-w-[180px]">
          <span className="text-xs tabular-nums w-10 text-right">{msToMMSS(curMs)}</span>
          <Slider
            value={[Math.min(curSec, durSec)]}
            max={Math.max(durSec, 0)}
            step={1}
            onValueChange={(vals) => seek((vals?.[0] ?? 0) * 1000)}
            className="flex-1"
          />
          <span className="text-xs tabular-nums w-10">{msToMMSS(durMs)}</span>
        </div>

        {/* 볼륨 */}
        <div className="hidden sm:flex items-center gap-2 w-[140px]">
          <Volume2 className="w-4 h-4" />
          <Slider
            value={[Math.round((volume ?? 0) * 100)]}
            min={0}
            max={100}
            step={1}
            onValueChange={(vals) => setVolume((vals?.[0] ?? 0) / 100)}
          />
        </div>
      </div>
    </div>
  );
}
