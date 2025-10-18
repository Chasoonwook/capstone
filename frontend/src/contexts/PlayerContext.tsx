// src/contexts/PlayerContext.tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSpotifyStatus } from "./SpotifyStatusContext"; // Spotify 연결 상태 훅
import { useSpotifyPlayer } from "@/hooks/useSpotifyPlayer"; // Spotify 플레이어 훅

/** 트랙 모델 (spotify_uri, selected_from 추가) */
export type Track = {
  id: string | number;
  title: string;
  artist: string;
  audioUrl?: string | null; // 미리듣기
  spotify_uri?: string | null; // Spotify 전체 재생용
  coverUrl?: string | null; // 앨범 아트
  duration?: number | null; // 곡 길이 (초)
  selected_from?: "main" | "sub" | "preferred" | null;
  spotify_track_id?: string | null; // ✅ 오류 수정: 속성 추가
};

export type PlayerState = {
  queue: Track[];
  index: number; // 현재 재생 중인 곡의 queue 내 인덱스
  curMs: number; // 현재 재생 시간 (ms)
  durMs: number; // 전체 곡 길이 (ms)
  currentTrack: Track | null; // 현재 재생 중인 트랙 정보
  playbackSource: "preview" | "spotify" | null; // 현재 재생 소스
};

type Ctx = {
  /** 현재 플레이어 상태 */
  state: PlayerState;
  /** 재생중 여부 */
  isPlaying: boolean;
  /** 볼륨(0~1) - 미리듣기 전용 */
  volume: number;
  /** Spotify SDK 준비 여부 */
  isSpotifyReady: boolean;

  /** 재생/일시정지/탐색/볼륨/이동 제어 */
  play: (track?: Track, index?: number) => Promise<void>; // 특정 곡 재생 기능 추가
  pause: () => Promise<void>;
  togglePlayPause: () => Promise<void>; // 재생/일시정지 토글 추가
  next: () => void;
  prev: () => void;
  seek: (ms: number) => void;
  setVolume: (v: number) => void; // 미리듣기 볼륨 설정

  /** 큐 설정 */
  setQueueAndPlay: (tracks: Track[], startIndex?: number) => void; // 함수 이름 변경 및 통합
};

const PlayerCtx = createContext<Ctx | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  // --- 훅 & 상태 ---
  const audioRef = useRef<HTMLAudioElement | null>(null); // 미리듣기용 오디오 요소
  const { status: spotifyStatus } = useSpotifyStatus(); // Spotify 연결 상태
  const spotifyPlayer = useSpotifyPlayer(); // Spotify SDK 플레이어 훅

  const isSpotifyConnected = spotifyStatus.connected && spotifyPlayer.ready; // SDK까지 준비되어야 함

  // --- 통합 플레이어 상태 ---
  const [state, setState] = useState<PlayerState>({
    queue: [],
    index: -1, // 초기값 -1 (선택된 곡 없음)
    curMs: 0,
    durMs: 0,
    currentTrack: null,
    playbackSource: null,
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, _setVolume] = useState<number>(() => { // 미리듣기 볼륨
    if (typeof window === "undefined") return 0.8;
    const v = Number(localStorage.getItem("player_volume") || "0.8");
    return isNaN(v) ? 0.8 : Math.min(1, Math.max(0, v));
  });

  // --- 오디오 요소 관리 (next/play/prev 의존성 추가) ---
  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      console.log("Creating Audio element for previews");
      const a = new Audio();
      a.preload = "metadata";
      a.volume = volume;

      a.addEventListener("timeupdate", () => {
        if (state.playbackSource === "preview") {
          setState((s) => ({
            ...s,
            curMs: a.currentTime * 1000,
            durMs: a.duration && isFinite(a.duration) ? a.duration * 1000 : s.durMs,
          }));
        }
      });
      a.addEventListener("loadedmetadata", () => {
        if (state.playbackSource === "preview") {
          setState((s) => ({
            ...s,
            durMs: a.duration && isFinite(a.duration) ? a.duration * 1000 : s.durMs,
          }));
        }
      });
      
      // 'ended' 이벤트 리스너는 아래 useEffect에서 설정
      
      a.addEventListener("error", (e) => {
         console.error("Audio Element Error:", e);
         if (state.playbackSource === "preview") {
             setIsPlaying(false);
             // next(); // next()를 직접 호출하는 대신 상태를 변경하여 useEffect가 처리하도록 유도
         }
      });
      audioRef.current = a;
    }
    return audioRef.current!;
  }, [volume, state.playbackSource]);

  // --- 상태 동기화: Spotify -> Context ---
  useEffect(() => {
    if (isSpotifyConnected && state.playbackSource === "spotify") {
      setState((s) => ({
        ...s,
        curMs: spotifyPlayer.state.position,
        durMs: spotifyPlayer.state.duration,
      }));
      setIsPlaying(!spotifyPlayer.state.paused);
    }
  }, [spotifyPlayer.state, isSpotifyConnected, state.playbackSource]);

  
  // --- 재생 제어 함수 (통합) ---
  
  // next/prev/play 함수를 먼저 선언 (상호 의존성 때문)
  const next = useCallback(() => {
    setState((s) => {
      if (!s.queue || s.queue.length === 0) return s;
      const nextIndex = s.index + 1;
      if (nextIndex >= s.queue.length) {
        console.log("End of queue reached");
        setIsPlaying(false);
        return { ...s, curMs: 0 }; // 시간만 리셋
      }
      const nextTrack = s.queue[nextIndex];
      return { ...s, index: nextIndex, currentTrack: nextTrack, curMs: 0 };
    });
  }, []);

  const play = useCallback(async (track?: Track, index?: number) => {
    const targetTrack = track ?? state.queue[index ?? state.index];
    const targetIndex = index ?? state.index;

    if (!targetTrack) return;

    const canPlaySpotify = isSpotifyConnected && targetTrack.spotify_uri;
    const source: "spotify" | "preview" | null = canPlaySpotify
      ? "spotify"
      : targetTrack.audioUrl
      ? "preview"
      : null;

    console.log(`Play request: ${targetTrack.title} (Source: ${source || 'None'})`);

    // 즉시 상태 업데이트
    setState(s => ({ ...s, index: targetIndex, currentTrack: targetTrack, playbackSource: source }));

    // 다른 소스 정지
    if (source === "spotify" && audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        audioRef.current.src = "";
        console.log("Paused preview player");
    }
    if (source === "preview" && spotifyPlayer.ready && !spotifyPlayer.state.paused) {
        await spotifyPlayer.pause();
        console.log("Paused Spotify player");
    }

    // 새 소스 재생
    if (source === "spotify") {
      await spotifyPlayer.playUris([targetTrack.spotify_uri!]);
      setIsPlaying(true);
    } else if (source === "preview") {
      const a = ensureAudio();
      if (a.src !== targetTrack.audioUrl) {
         a.src = targetTrack.audioUrl!;
         a.load();
      }
      try {
        await a.play();
        setIsPlaying(true);
      } catch (err) {
        console.error("Preview play failed:", err);
        setIsPlaying(false);
      }
    } else {
      console.warn("No playable source for track:", targetTrack.title);
      setIsPlaying(false);
      // 재생 실패 시 잠시 후 다음 곡 (무한 루프 방지)
      setTimeout(() => next(), 100);
    }
  }, [state.index, state.queue, isSpotifyConnected, spotifyPlayer, ensureAudio, next]);

  const pause = useCallback(async () => {
    console.log("Pause request. Current source:", state.playbackSource);
    if (state.playbackSource === "spotify" && spotifyPlayer.ready) {
      await spotifyPlayer.pause();
      setIsPlaying(false);
    } else if (state.playbackSource === "preview" && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, [state.playbackSource, spotifyPlayer]);

  const togglePlayPause = useCallback(async () => {
    if (isPlaying) {
      await pause();
    } else {
      await play(state.currentTrack ?? state.queue[0], state.index === -1 ? 0 : state.index);
    }
  }, [isPlaying, pause, play, state.currentTrack, state.index, state.queue]);

  const prev = useCallback(() => {
    if (state.playbackSource === "spotify" && spotifyPlayer.ready) {
        spotifyPlayer.prev();
        return;
    }

    if (state.playbackSource === "preview" && audioRef.current) {
        const a = audioRef.current;
        if (a.currentTime > 3) {
            a.currentTime = 0;
            setState((s) => ({ ...s, curMs: 0 }));
            if (!isPlaying) play();
        } else {
            setState((s) => {
                const prevIndex = Math.max(0, s.index - 1);
                const prevTrack = s.queue[prevIndex];
                return { ...s, index: prevIndex, currentTrack: prevTrack, curMs: 0 };
            });
        }
    }
  }, [state.playbackSource, spotifyPlayer, isPlaying, play, state.queue]);

  const seek = useCallback((ms: number) => {
    if (state.playbackSource === "spotify" && spotifyPlayer.ready) {
      spotifyPlayer.seek(ms);
    } else if (state.playbackSource === "preview" && audioRef.current) {
      const a = audioRef.current;
      const targetTime = Math.max(0, ms / 1000);
      const duration = a.duration && isFinite(a.duration) ? a.duration : (state.durMs / 1000);
      a.currentTime = Math.min(targetTime, duration > 0 ? duration - 0.1 : 0);
    }
  }, [state.playbackSource, spotifyPlayer, state.durMs]);

  const setVolume = useCallback((v: number) => {
    const vv = Math.min(1, Math.max(0, v));
    _setVolume(vv);
    if (typeof window !== "undefined") {
      try { localStorage.setItem("player_volume", String(vv)); } catch {}
    }
    if (audioRef.current) audioRef.current.volume = vv;
    if (isSpotifyConnected) {
       spotifyPlayer.setVolume(vv);
    }
  }, [isSpotifyConnected, spotifyPlayer]);

  const setQueueAndPlay = useCallback((tracks: Track[], startIndex = 0) => {
    const safeIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
    const firstTrack = tracks[safeIndex] || null;

    console.log(`Setting queue with ${tracks.length} tracks, starting at index ${safeIndex}`);

    if (isPlaying) {
        pause();
    }

    setState(s => ({
       ...s,
       queue: tracks,
       index: safeIndex,
       currentTrack: firstTrack,
       curMs: 0,
       durMs: firstTrack?.duration ? firstTrack.duration * 1000 : 0,
       playbackSource: null,
    }));

    setTimeout(() => {
        play(firstTrack, safeIndex);
    }, 50); // 상태 반영 후 재생
  }, [isPlaying, pause, play]);

  // --- 미리듣기 'ended' 이벤트 핸들러 ---
  useEffect(() => {
    const a = ensureAudio();
    const handleEnded = () => {
      if (state.playbackSource === "preview") {
        console.log("Preview ended, playing next");
        next();
      }
    };
    a.addEventListener("ended", handleEnded);
    return () => a.removeEventListener("ended", handleEnded);
  }, [ensureAudio, state.playbackSource, next]);

  // --- 큐 인덱스 변경 시 자동 재생 ---
  useEffect(() => {
    // 큐가 설정되고, 인덱스가 유효하며, 현재 재생 중이 아닐 때
    // (setQueueAndPlay에서 이미 play를 호출하므로 중복 방지)
    const track = state.queue[state.index];
    if (track && state.currentTrack?.id !== track.id) {
       console.log("Index changed, auto-playing new track");
       play(track, state.index);
    }
  }, [state.index, state.queue, play, state.currentTrack]);


  // --- Context 값 Memoization ---
  const ctx: Ctx = useMemo(
    () => ({
      state,
      isPlaying,
      volume,
      isSpotifyReady: spotifyPlayer.ready,
      play,
      pause,
      togglePlayPause,
      next,
      prev,
      seek,
      setVolume,
      setQueueAndPlay,
    }),
    [
      state,
      isPlaying,
      volume,
      spotifyPlayer.ready,
      play,
      pause,
      togglePlayPause,
      next,
      prev,
      seek,
      setVolume,
      setQueueAndPlay,
    ]
  );
  
  useEffect(() => {
      ensureAudio();
  }, [ensureAudio]);

  return <PlayerCtx.Provider value={ctx}>{children}</PlayerCtx.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerCtx);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}