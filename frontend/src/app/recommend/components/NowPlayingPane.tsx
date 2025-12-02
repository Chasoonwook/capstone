// src/app/recommend/components/NowPlayingPane.tsx
"use client";

import { Button } from "@/components/ui/button";
import { ThumbsUp, ThumbsDown, RotateCcw } from "lucide-react";
import PlayerControls from "./PlayerControls";
import { formatTime } from "../utils/media";
import type { Song } from "../types";
import React from "react";

type Props = {
  currentSong: Song | null;
  safeImageSrc: string;
  contextMainMood: string | null;
  contextSubMood: string | null;

  // 플레이어 상태/이벤트
  isPlaying: boolean;
  busy: boolean;
  currentTime: number;
  duration: number;
  source: "preview" | "spotify" | null;
  onSeek: (v: number) => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;

  // 추천 목록 관련
  uploadedImage: string | null;
  recommendationsCount: number;
  RecommendationList: React.ReactNode;

  // 새로고침 상태/이벤트
  isRefreshing: boolean;
  onRefresh: () => void;

  // 피드백
  feedback: Record<string | number, 1 | -1 | 0>;
  onFeedback: (val: 1 | -1) => void;

  // 저장 및 편집 (버튼은 기본 숨김)
  onSaveAndEdit: () => void;
  showSaveButtonInPane?: boolean; // 기본값 false
};

export default function NowPlayingPane({
  currentSong,
  safeImageSrc,
  contextMainMood,
  contextSubMood,
  isPlaying,
  busy,
  currentTime,
  duration,
  onSeek,
  onTogglePlay,
  onNext,
  onPrev,
  isRefreshing,
  onRefresh,
  feedback,
  onFeedback,
  onSaveAndEdit,
  RecommendationList,
  recommendationsCount,
  showSaveButtonInPane = false,
}: Props) {
  return (
    <div className="flex flex-col justify-center flex-1 h-full ml-8">
      {/* 곡 정보 */}
      <div className="flex flex-col items-center mb-4">
        <div
          className="w-24 h-24 rounded-lg overflow-hidden mb-4 bg-center bg-cover border border-white/20"
          style={{ backgroundImage: `url(${currentSong?.image ?? safeImageSrc})` }}
        />
        <div className="text-center mb-2">
          <h3 className="text-white text-2xl font-semibold mb-1">
            {currentSong?.title ?? "—"}
          </h3>
          <p className="text-slate-300 text-lg">{currentSong?.artist ?? "—"}</p>
        </div>

        {(contextMainMood || contextSubMood) && (
          <div className="text-xs text-slate-400 mb-2">
            context: {contextMainMood ?? "—"}
            {contextSubMood ? ` / ${contextSubMood}` : ""}
          </div>
        )}

        {currentSong?.selected_from && (
          <div className="text-[11px] text-slate-400 mb-2">
            source: {currentSong.selected_from}
          </div>
        )}

        {/* 타임 라벨 */}
        <div className="w-full max-w-md mb-2 text-slate-300 text-sm flex justify-between">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        {/* 컨트롤 */}
        <PlayerControls
          isPlaying={isPlaying}
          busy={busy}
          currentTime={currentTime}
          duration={duration}
          onSeek={onSeek}
          onTogglePlay={onTogglePlay}
          onNext={onNext}
          onPrev={onPrev}
        />

        {/* 액션: 좋아요/싫어요 (저장 버튼은 필요 시만 표시) */}
        {currentSong && (
          <div className="mt-4 flex items-center gap-3">
            <Button
              type="button"
              title="Like"
              className={`h-9 px-3 border text-white bg-white/10 hover:bg-white/20 border-white/25 ${
                feedback[currentSong.id] === 1 ? "bg-white/30 border-white/40" : ""
              }`}
              onClick={() => onFeedback(1)}
            >
              <ThumbsUp className="h-4 w-4 mr-2" />
              Like
            </Button>
            <Button
              type="button"
              title="Dislike"
              className={`h-9 px-3 border text-white bg-white/10 hover:bg-white/20 border-white/25 ${
                feedback[currentSong.id] === -1 ? "bg-white/30 border-white/40" : ""
              }`}
              onClick={() => onFeedback(-1)}
            >
              <ThumbsDown className="h-4 w-4 mr-2" />
              Dislike
            </Button>

            {showSaveButtonInPane && (
              <Button
                type="button"
                title="Save & Edit Photo"
                className="h-9 px-3 border text-white bg-pink-500/70 hover:bg-pink-500 border-white/25"
                onClick={onSaveAndEdit}
              >
                Save & Edit Photo
              </Button>
            )}
          </div>
        )}
      </div>

      {/* 추천 목록 */}
      <div className="flex-1 bg-black/30 backdrop-blur-sm rounded-2xl p-4 max-h-80">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-lg">Recommended</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="text-slate-200 hover:bg-white/10 border border-white/10"
          >
            <RotateCcw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            <span className="ml-2 text-xs">
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </span>
          </Button>
        </div>

        <div className="overflow-y-auto h-full">
          {recommendationsCount > 0 ? (
            RecommendationList
          ) : (
            <div className="text-center text-slate-400 py-8">No recommendations yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
