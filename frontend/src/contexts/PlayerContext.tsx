"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSpotifyPlayer } from "@/hooks/useSpotifyPlayer";

export type PlayerTrack = {
  id: string | number;
  title: string;
  artist: string;
  audioUrl?: string | null;
  coverUrl?: string | null;
  duration?: number | null;
  spotify_track_id?: string | null;
  spotify_uri?: string | null;
};

type PlayerState = {
  /** ms */
  position: number;
  /** ms */
  duration: number;
  paused: boolean;
  isSpotify: boolean;
};

type Ctx = {
  /** 현재 Queue */
  queue: PlayerTrack[];
  /** 현재 재생 중인 인덱스 (없으면 -1) */
  index: number;
  /** 전역 재생 상태 */
  state: PlayerState;

  /** 볼륨(0~1) */
  volume: number;
  setVolume: (v01: number) => void;

  /** 추천리스트 등으로부터 Queue 전체 교체 */
  setQueueFromRecommend: (tracks: PlayerTrack[]) => void;

  /** 해당 인덱스에서 재생 시작 (Spotify/Preview 자동 판단) */
  playAt: (i: number) => Promise<void>;

  /** 재생/일시정지 토글 */
  toggle: () => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  /** position(ms) 로 이동 */
  seek: (ms: number) => Promise<void>;
};

/* ---------------------------------------- */

const PlayerContext = createContext<Ctx | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const sp = useSpotifyPlayer(); // Spotify Web Playback SDK 컨트롤
  // <audio>는 전역 싱글톤으로 숨겨서 미리듣기(Preview) 담당
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [index, setIndex] = useState(-1);

  // 전역 상태
  const [state, setState] = useState<PlayerState>({
    position: 0,
    duration: 0,
    paused: true,
    isSpotify: false,
  });

  // 전역 볼륨
  const [volume, _setVolume] = useState<number>(() => {
    const saved = Number((typeof window !== "undefined" && localStorage.getItem("player_volume")) || "0.8");
    return isNaN(saved) ? 0.8 : Math.min(1, Math.max(0, saved));
  });

  // 오디오 엘리먼트 준비
  useEffect(() => {
    if (!audioRef.current) {
      const el = document.createElement("audio");
      el.preload = "metadata";
      el.crossOrigin = "anonymous";
      el.volume = volume;
      audioRef.current = el;

      const onTime = () => {
        setState((s) => ({ ...s, position: Math.floor(el.currentTime * 1000), duration: Math.floor((el.duration || 0) * 1000) }));
      };
      const onEnded = () => {
        void next(); // 끝나면 자동 다음곡
      };
      const onPause = () => setState((s) => ({ ...s, paused: true }));
      const onPlay = () => setState((s) => ({ ...s, paused: false }));

      el.addEventListener("timeupdate", onTime);
      el.addEventListener("ended", onEnded);
      el.addEventListener("pause", onPause);
      el.addEventListener("play", onPlay);
    }
  }, []); // 최초 1회

  // 볼륨 동기화(Spotify 및 <audio>)
  const setVolume = useCallback((v01: number) => {
    const v = Math.min(1, Math.max(0, v01));
    _setVolume(v);
    if (typeof window !== "undefined") localStorage.setItem("player_volume", String(v));
    try { sp.setVolume?.(v); } catch {}
    if (audioRef.current) audioRef.current.volume = v;
  }, [sp]);

  // Spotify 상태를 1초에 한 번 반영 (useSpotifyPlayer가 내부에서 이미 보간/폴링)
  useEffect(() => {
    setState((s) => ({
      ...s,
      position: sp.state.position ?? s.position,
      duration: sp.state.duration ?? s.duration,
      paused: sp.state.paused ?? s.paused,
      // isSpotify는 playAt/preview 선택 시 업데이트
    }));
  }, [sp.state.position, sp.state.duration, sp.state.paused]);

  /* ------------------------ 컨트롤 헬퍼 ------------------------ */

  const setQueueFromRecommend: Ctx["setQueueFromRecommend"] = (tracks) => {
    setQueue(tracks);
    setIndex(tracks.length ? 0 : -1);
  };

  const playPreview = async (t: PlayerTrack) => {
    const el = audioRef.current!;
    // Spotify는 멈춤
    try { await sp.pause(); } catch {}
    el.pause();
    if (!t.audioUrl) return;

    el.src = t.audioUrl;
    await el.load();
    await el.play();

    setState((s) => ({ ...s, isSpotify: false }));
  };

  const playSpotify = async (t: PlayerTrack) => {
    const uri =
      (t.spotify_uri && t.spotify_uri.startsWith("spotify:") ? t.spotify_uri : null) ||
      (t.spotify_track_id ? `spotify:track:${t.spotify_track_id}` : null);

    if (!uri) {
      // Spotify 재생 정보 없음 → 프리뷰로 폴백
      await playPreview(t);
      return;
    }

    // <audio>는 멈춤
    if (audioRef.current) audioRef.current.pause();

    // Spotify 전송 + 재생
    await sp.playUris([uri]);
    setState((s) => ({ ...s, isSpotify: true }));
  };

  const playAt = useCallback<Ctx["playAt"]>(async (i) => {
    if (i < 0 || i >= queue.length) return;
    setIndex(i);
    const t = queue[i];

    if (t.spotify_uri || t.spotify_track_id) {
      await playSpotify(t);
    } else if (t.audioUrl) {
      await playPreview(t);
    } else {
      // 아무것도 없으면 정지 상태
      setState((s) => ({ ...s, paused: true }));
    }
  }, [queue, sp]);

  const toggle: Ctx["toggle"] = async () => {
    if (state.isSpotify) {
      if (sp.state.paused) await sp.resume();
      else await sp.pause();
      // 상태는 위의 sp.state 변경 감지가 반영
    } else {
      const el = audioRef.current!;
      if (!el.src) {
        // 재생 시작되지 않았다면 현재 index에서 재생
        await playAt(index >= 0 ? index : 0);
      } else {
        if (el.paused) await el.play();
        else el.pause();
      }
    }
  };

  const next: Ctx["next"] = async () => {
    if (!queue.length) return;
    const n = (index + 1 < queue.length) ? index + 1 : index; // 마지막이면 멈춤
    await playAt(n);
  };

  const prev: Ctx["prev"] = async () => {
    if (!queue.length) return;
    const p = index > 0 ? index - 1 : 0;
    await playAt(p);
  };

  const seek: Ctx["seek"] = async (ms) => {
    if (state.isSpotify) {
      await sp.seek(ms);
    } else {
      const el = audioRef.current!;
      if (!el.src) return;
      el.currentTime = Math.max(0, ms / 1000);
      setState((s) => ({ ...s, position: Math.floor(el.currentTime * 1000) }));
    }
  };

  const value = useMemo<Ctx>(() => ({
    queue, index, state, volume,
    setVolume,
    setQueueFromRecommend,
    playAt, toggle, next, prev, seek,
  }), [queue, index, state, volume, setVolume, setQueueFromRecommend, playAt, toggle, next, prev, seek]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): Ctx {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
