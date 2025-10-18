"use client";

import { usePlayer } from "@/contexts/PlayerContext";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  ListMusic,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

export function GlobalNowPlayingBar() {
  const {
    state,
    isPlaying,
    play,
    pause,
    next,
    prev,
    volume,
    setVolume,
  } = usePlayer();

  const router = useRouter();

  const title = state.queue[state.index]?.title ?? "—";
  const artist = state.queue[state.index]?.artist ?? "—";

  // 검은 바(바깥 영역) 클릭 시 recommend(또는 마지막 플레이어 경로)로 이동
  const goToPlayer = useCallback(() => {
    const last =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("lastPlayerRoute")
        : null;
    router.push(last || "/recommend");
  }, [router]);

  // 내부 컨트롤 클릭 시 바깥으로 이벤트 전파 방지
  const stop: React.MouseEventHandler = (e) => e.stopPropagation();

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-black/90 text-white border-t border-white/10"
      role="button"
      aria-label="플레이어로 이동"
      onClick={goToPlayer}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") goToPlayer();
      }}
      tabIndex={0}
      style={{ backdropFilter: "blur(6px)" }}
    >
      {/* ⬇️ 내부 컨텐츠는 클릭 전파 차단 */}
      <div
        className="mx-auto max-w-5xl px-4 py-3 grid grid-cols-[1fr_auto_1fr] items-center gap-4"
        onClick={stop}
      >
        <div className="min-w-0">
          <div className="text-sm truncate">{title}</div>
          <div className="text-xs text-white/60 truncate">{artist}</div>
        </div>

        <div className="flex items-center gap-4">
          <button
            aria-label="prev"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            className="p-2 hover:bg-white/10 rounded"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            aria-label={isPlaying ? "pause" : "play"}
            onClick={(e) => {
              e.stopPropagation();
              isPlaying ? pause() : play();
            }}
            className="p-3 rounded-full bg-white text-black hover:bg-white/90"
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>

          <button
            aria-label="next"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            className="p-2 hover:bg-white/10 rounded"
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        <div className="hidden md:flex items-center gap-3 justify-end">
          <Volume2 className="w-4 h-4" />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => {
              e.stopPropagation();
              setVolume(Number(e.target.value) / 100);
            }}
            className="w-40 accent-white"
          />
          <button
            aria-label="queue"
            className="p-2 hover:bg-white/10 rounded"
            onClick={(e) => e.stopPropagation()}
          >
            <ListMusic className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
