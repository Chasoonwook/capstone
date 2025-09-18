"use client";

import { Button } from "@/components/ui/button";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";

type Props = {
  isPlaying: boolean;
  busy: boolean;
  currentTime: number;
  duration: number;
  onSeek: (val: number) => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
};

export default function PlayerControls({
  isPlaying,
  busy,
  currentTime,
  duration,
  onSeek,
  onTogglePlay,
  onPrev,
  onNext,
}: Props) {
  return (
    <div className="w-full max-w-md">
      {/* seek bar */}
      <input
        type="range"
        min={0}
        max={duration}
        value={currentTime}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="w-full accent-purple-500 mb-4"
      />
      {/* buttons */}
      <div className="flex items-center justify-center space-x-6">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={busy}
          className="rounded-full bg-white/10 hover:bg-white/20 w-12 h-12 disabled:opacity-50"
          onClick={onPrev}
          aria-label="previous"
        >
          <SkipBack className="h-5 w-5 text-white" />
        </Button>

        <Button
          type="button"
          size="icon"
          disabled={busy}
          className="rounded-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 w-16 h-16 disabled:opacity-50"
          onClick={onTogglePlay}
          aria-label={isPlaying ? "pause" : "play"}
        >
          {isPlaying ? <Pause className="h-7 w-7 text-white" /> : <Play className="h-7 w-7 text-white" />}
        </Button>

        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={busy}
          className="rounded-full bg-white/10 hover:bg-white/20 w-12 h-12 disabled:opacity-50"
          onClick={onNext}
          aria-label="next"
        >
          <SkipForward className="h-5 w-5 text-white" />
        </Button>
      </div>
    </div>
  );
}
