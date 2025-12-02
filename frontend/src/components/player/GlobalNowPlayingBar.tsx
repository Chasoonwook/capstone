// src/components/player/GlobalNowPlayingBar.tsx
"use client";

import { usePlayer } from "@/contexts/PlayerContext";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  ListMusic,
  VolumeX,
  Volume1,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { Slider } from "@/components/ui/slider";

export function GlobalNowPlayingBar() {
  const {
    state,
    isPlaying,
    togglePlayPause,
    next,
    prev,
    seek,
    volume,
    setVolume,
  } = usePlayer();

  const router = useRouter();

  const currentTrack = state.currentTrack;
  const title = currentTrack?.title ?? "—";
  const artist = currentTrack?.artist ?? "—";
  const coverUrl = currentTrack?.coverUrl ?? "/placeholder.svg";

  // 현재 트랙 재생 가능 여부 확인 로직
  const isPlayable = useMemo(() => {
    if (!currentTrack) return false;
    return (
      (state.playbackSource === "spotify" && !!currentTrack.spotify_uri) ||
      (state.playbackSource !== "spotify" && !!currentTrack.audioUrl)
    );
  }, [currentTrack, state.playbackSource]);

  // 메인 플레이어 페이지로 이동하는 함수
  const goToPlayer = useCallback(() => {
    const last =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("lastPlayerRoute")
        : null;

    router.push(last || "/");
  }, [router]);

  // 이벤트 버블링 중단 함수
  const stop: React.MouseEventHandler = (e) => e.stopPropagation();

  // 현재 재생 진행률 계산
  const progressPercent = state.durMs > 0 ? (state.curMs / state.durMs) * 100 : 0;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-black/90 text-white border-t border-white/10 backdrop-blur-md"
      role="button"
      aria-label="Go to Player"
      onClick={goToPlayer}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") goToPlayer();
      }}
      tabIndex={0}
    >
      {/* 진행 바 영역 */}
      <div className="h-[3px] w-full bg-white/10 group" onClick={stop}>
        <Slider
          value={[progressPercent]}
          max={100}
          step={0.1}
          className="absolute bottom-[calc(100%-1.5px)] w-full h-[3px] cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity [&>span]:bg-white/30 [&>span>span]:bg-white [&>span>span>span]:hidden"
          onValueChange={(value) => {
            if (state.durMs > 0) {
              seek((value[0] / 100) * state.durMs);
            }
          }}
          disabled={!currentTrack || state.durMs <= 0}
        />
        <div
          className="h-[3px] bg-white/70"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* 내부 컨텐츠 영역 */}
      <div
        className="mx-auto max-w-5xl px-4 py-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3"
        onClick={stop}
      >
        {/* 좌측: 앨범 아트 및 곡 정보 섹션 */}
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={goToPlayer} className="flex-shrink-0">
            <img
              src={coverUrl}
              alt={title}
              className="w-10 h-10 rounded-sm bg-white/10 object-cover"
            />
          </button>
          <div className="min-w-0 flex-1">
            <button onClick={goToPlayer} className="text-left w-full">
              <div className="text-sm font-medium truncate">{title}</div>
              <div className="text-xs text-white/60 truncate">{artist}</div>
            </button>
          </div>
        </div>

        {/* 중앙: 재생 컨트롤 버튼 섹션 */}
        <div className="flex items-center gap-4">
          <button
            aria-label="Previous Track"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            className="p-2 hover:bg-white/10 rounded disabled:opacity-50"
            disabled={!currentTrack || state.index <= 0}
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={(e) => {
              e.stopPropagation();
              togglePlayPause();
            }}
            className="p-3 rounded-full bg-white text-black hover:bg-white/90 disabled:opacity-50 disabled:bg-gray-400"
            disabled={!isPlayable}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-black" />
            ) : (
              <Play className="w-5 h-5 fill-black" />
            )}
          </button>

          <button
            aria-label="Next Track"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            className="p-2 hover:bg-white/10 rounded disabled:opacity-50"
            disabled={!currentTrack || state.index >= state.queue.length - 1}
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        {/* 우측: 볼륨 및 목록 (데스크탑 뷰) */}
        <div className="hidden md:flex items-center gap-3 justify-end">
          <button
            aria-label="Playlist"
            onClick={(e) => {
              e.stopPropagation();
              goToPlayer();
            }}
            className="p-2 hover:bg-white/10 rounded"
          >
            <ListMusic className="w-5 h-5" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setVolume(volume > 0 ? 0 : 0.8);
            }}
            className="p-1 hover:bg-white/10 rounded"
            aria-label="Toggle Mute"
          >
            {volume === 0 ? (
              <VolumeX className="w-4 h-4" />
            ) : volume < 0.5 ? (
              <Volume1 className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
          <Slider
            value={[Math.round(volume * 100)]}
            max={100}
            step={1}
            className="w-24 h-1 cursor-pointer [&>span]:bg-white/30 [&>span>span]:bg-white [&>span>span>span]:hidden"
            onValueChange={(value) => {
              setVolume(value[0] / 100);
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label="Volume Control"
          />
        </div>

        {/* 우측: 목록 버튼 (모바일 뷰) */}
        <div className="flex md:hidden items-center gap-3 justify-end">
          <button
            aria-label="Playlist"
            onClick={(e) => {
              e.stopPropagation();
              goToPlayer();
            }}
            className="p-2 hover:bg-white/10 rounded"
          >
            <ListMusic className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}