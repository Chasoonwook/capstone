"use client";

import { usePlayer } from "@/contexts/PlayerContext";
import { Play, Pause, SkipBack, SkipForward, Volume2, ListMusic } from "lucide-react";

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

  const title = state.queue[state.index]?.title ?? "—";
  const artist = state.queue[state.index]?.artist ?? "—";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-black/90 text-white border-t border-white/10">
      <div className="mx-auto max-w-5xl px-4 py-3 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="min-w-0">
          <div className="text-sm truncate">{title}</div>
          <div className="text-xs text-white/60 truncate">{artist}</div>
        </div>

        <div className="flex items-center gap-4">
          <button aria-label="prev" onClick={prev} className="p-2 hover:bg-white/10 rounded">
            <SkipBack className="w-5 h-5" />
          </button>
          <button
            aria-label={isPlaying ? "pause" : "play"}
            onClick={isPlaying ? pause : play}
            className="p-3 rounded-full bg-white text-black hover:bg-white/90"
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
          <button aria-label="next" onClick={next} className="p-2 hover:bg-white/10 rounded">
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
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
            className="w-40 accent-white"
          />
          <button aria-label="queue" className="p-2 hover:bg-white/10 rounded">
            <ListMusic className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
