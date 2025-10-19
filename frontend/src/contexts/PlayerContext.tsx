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
import { useSpotifyStatus } from "./SpotifyStatusContext";
import { useSpotifyPlayer } from "@/hooks/useSpotifyPlayer";
import { API_BASE } from "@/lib/api";

/** 트랙 모델 */
export type Track = {
  id: string | number;
  title: string;
  artist: string;
  audioUrl?: string | null;           // 30초 미리듣기
  spotify_uri?: string | null;        // spotify:track:<id>
  coverUrl?: string | null;
  duration?: number | null;           // 초
  selected_from?: "main" | "sub" | "preferred" | null;
  spotify_track_id?: string | null;   // 순수 ID만
};

export type PlayerState = {
  queue: Track[];
  index: number;                      // 현재 인덱스
  curMs: number;                      // 현재 재생 위치(ms)
  durMs: number;                      // 전체 길이(ms)
  currentTrack: Track | null;
  playbackSource: "preview" | "spotify" | null;
};

type Ctx = {
  state: PlayerState;
  isPlaying: boolean;
  volume: number;
  isSpotifyReady: boolean;

  play: (track?: Track, index?: number, startFromBeginning?: boolean) => Promise<void>; // startFromBeginning 추가
  pause: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  next: () => void;
  prev: () => void;
  seek: (ms: number) => void;
  setVolume: (v: number) => void;

  setQueueAndPlay: (tracks: Track[], startIndex?: number) => void;
};

const PlayerCtx = createContext<Ctx | null>(null);

/* =======================
   검색 중복 방지/실패 캐시/스로틀
   ======================= */
const inflightMap = new Map<string, Promise<Track>>();
const failCache = new Map<string, number>();
const FAIL_TTL_MS = 3 * 60 * 1000;
const MIN_GAP_MS = 800;
let lastHit = 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function resolvePlayableSource(t: Track): Promise<Track> {
    // ... (resolvePlayableSource 함수 내용은 기존과 동일) ...
  if (!t || t.audioUrl || t.spotify_uri || t.spotify_track_id || !t.title) return t;

  const key = `${t.title}|${t.artist ?? ""}`.trim().toLowerCase();

  const lastFail = failCache.get(key) || 0;
  if (Date.now() - lastFail < FAIL_TTL_MS) return t;

  const inflight = inflightMap.get(key);
  if (inflight) return { ...t, ...(await inflight) };

  const p = (async (): Promise<Track> => {
    const gap = Date.now() - lastHit;
    if (gap < MIN_GAP_MS) await wait(MIN_GAP_MS - gap);

    const qs = new URLSearchParams({
      title: t.title,
      ...(t.artist ? { artist: t.artist } : {}),
      limit: "1",
    });

    let data: any = null;

    lastHit = Date.now();
    const resp = await fetch(`${API_BASE}/api/spotify/search?${qs.toString()}`, {
      credentials: "include",
    }).catch(() => null);

    if (resp?.ok) {
      data = await resp.json();
    } else {
      failCache.set(key, Date.now());
      return t;
    }

    const item =
      data?.tracks?.items?.[0] ||
      data?.items?.[0] ||
      data?.[0] ||
      null;

    if (!item) {
      failCache.set(key, Date.now());
      return t;
    }

    const preview =
      item?.preview_url || item?.previewUrl || item?.audioUrl || null;
    const cover =
      item?.album?.images?.[0]?.url || item?.albumImage || item?.coverUrl || null;
    const sid =
      item?.id || item?.trackId || item?.spotify_track_id || null;

    return {
      ...t,
      audioUrl: preview ?? t.audioUrl ?? null,
      coverUrl: cover ?? t.coverUrl ?? null,
      spotify_track_id: sid ?? t.spotify_track_id ?? null,
      spotify_uri: sid ? `spotify:track:${sid}` : (t.spotify_uri ?? null),
    };
  })();

  inflightMap.set(key, p);
  try {
    return await p;
  } finally {
    inflightMap.delete(key);
  }
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { status: spotifyStatus } = useSpotifyStatus();
  const spotifyPlayer = useSpotifyPlayer();
  const isSpotifyConnected = spotifyStatus.connected && spotifyPlayer.ready;

  const [state, setState] = useState<PlayerState>({
    queue: [],
    index: -1,
    curMs: 0,
    durMs: 0,
    currentTrack: null,
    playbackSource: null,
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, _setVolume] = useState<number>(() => {
    if (typeof window === "undefined") return 0.8;
    const v = Number(localStorage.getItem("player_volume") || "0.8");
    return isNaN(v) ? 0.8 : Math.min(1, Math.max(0, v));
  });

  const suppressAutoPlayRef = useRef(false);

  const ensureAudio = useCallback(() => {
    // ... (ensureAudio 함수 내용은 기존과 동일) ...
    if (!audioRef.current) {
      console.log("Creating Audio element for previews");
      const a = new Audio();
      a.preload = "metadata";
      a.volume = volume;

      a.addEventListener("timeupdate", () => {
        if (state.playbackSource === "preview") {
          setState((s) => ({ ...s, curMs: a.currentTime * 1000 }));
            // duration 업데이트는 loadedmetadata에서만 처리하는 것이 더 안정적일 수 있음
        }
      });
      a.addEventListener("loadedmetadata", () => {
        if (state.playbackSource === "preview") {
          setState((s) => ({
            ...s,
            durMs: a.duration && isFinite(a.duration) ? a.duration * 1000 : 0 // 0으로 초기화
          }));
        }
      });
      a.addEventListener("error", (e) => {
        console.error("Audio Element Error:", e);
        if (state.playbackSource === "preview") setIsPlaying(false);
      });
      audioRef.current = a;
    }
    return audioRef.current!;
  }, [volume, state.playbackSource]);

  // Spotify 상태 동기화
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

  const next = useCallback(() => {
    setState((s) => {
      if (!s.queue || s.queue.length === 0) return s;
      const nextIndex = s.index + 1;
      if (nextIndex >= s.queue.length) {
        console.log("End of queue reached");
        setIsPlaying(false);
        return { ...s, curMs: 0 };
      }
      const nextTrack = s.queue[nextIndex];
      return { ...s, index: nextIndex, currentTrack: nextTrack, curMs: 0 };
    });
  }, [setIsPlaying]); // 의존성 배열 유지

  // ✨ play 함수 수정: startFromBeginning 플래그 추가 및 명시적 중지 로직 ✨
  const play = useCallback(
    async (track?: Track, index?: number, startFromBeginning = true) => {
      const baseTrack = track ?? state.queue[index ?? state.index];
      const targetIndex = index ?? state.index;
      if (!baseTrack) return;

      // ✨ 명시적으로 현재 재생 중지 ✨
      try {
        if (state.playbackSource === "spotify" && spotifyPlayer.ready && !spotifyPlayer.state.paused) {
          await spotifyPlayer.pause();
        } else if (state.playbackSource === "preview" && audioRef.current && !audioRef.current.paused) {
          audioRef.current.pause();
          if (startFromBeginning) audioRef.current.currentTime = 0; // 처음부터 재생 시 시간 초기화
        }
        setIsPlaying(false); // 상태 즉시 업데이트
        await wait(50); // 잠시 대기
      } catch (e) {
        console.error("Error pausing previous track:", e);
      }

      const targetTrack = await resolvePlayableSource(baseTrack);

      const hasSpotify = !!(targetTrack.spotify_uri || targetTrack.spotify_track_id);
      const canPlaySpotify = isSpotifyConnected && hasSpotify;
      const source: "spotify" | "preview" | null = canPlaySpotify
        ? "spotify"
        : targetTrack.audioUrl
        ? "preview"
        : null;

      console.log(
        `Play request: ${targetTrack.title} (Source: ${source || "None"})`
      );

      // ✨ 상태 업데이트 시 startFromBeginning 고려 ✨
      setState((s) => ({
        ...s,
        index: targetIndex,
        currentTrack: targetTrack,
        playbackSource: source,
        curMs: startFromBeginning ? 0 : s.curMs, // 처음부터 재생 플래그 반영
        durMs: (startFromBeginning || source !== s.playbackSource)
               ? (targetTrack.duration ? targetTrack.duration * 1000 : 0) // 새 곡/소스면 duration 초기화 시도
               : s.durMs,
      }));

      // 실제 재생
      if (source === "spotify") {
        const uri = targetTrack.spotify_uri || (targetTrack.spotify_track_id ? `spotify:track:${targetTrack.spotify_track_id}` : null);
        if (uri) {
          try {
            await spotifyPlayer.playUris([uri]); // playUris는 항상 처음부터 재생
            setIsPlaying(true);
            return;
          } catch (e) {
             console.error("Spotify playUris failed:", e);
             setIsPlaying(false);
          }
        }
      }

      if (source === "preview") {
        const a = ensureAudio();
        const newSrc = targetTrack.audioUrl!;
        let shouldLoad = a.src !== newSrc;

        if (shouldLoad) {
          a.src = newSrc;
          a.load();
        }

        // ✨ 재생 시간 설정 ✨
        if (startFromBeginning || shouldLoad) {
            a.currentTime = 0;
            // 상태 업데이트는 timeupdate 리스너에 맡기거나 여기서 강제
            if (!shouldLoad) setState(s => ({ ...s, curMs: 0 }));
        } else if (state.curMs > 0) {
            // 이어서 재생 시 현재 시간 설정 시도
            a.currentTime = state.curMs / 1000;
        }

        try {
          // shouldLoad 시 canplaythrough 기다리는 로직 추가 (선택 사항)
          if (shouldLoad) {
              await new Promise((resolve, reject) => {
                  const canPlayHandler = () => { /* ... 리스너 제거 및 resolve ... */ };
                  const errorHandler = (e: ErrorEvent) => { /* ... 리스너 제거 및 reject ... */ };
                  a.addEventListener('canplaythrough', canPlayHandler, { once: true });
                  a.addEventListener('error', errorHandler, { once: true });
              });
          }
          await a.play();
          setIsPlaying(true);
          return;
        } catch (err) {
          console.error("Preview play failed:", err);
          setIsPlaying(false);
        }
      }

      console.warn("No playable source for track:", targetTrack.title);
      setIsPlaying(false);
      next(); // 실패 시 다음 곡 시도
    },
    // ✨ 의존성 배열 업데이트 ✨
    [ state.queue, state.index, state.playbackSource, isSpotifyConnected, spotifyPlayer, ensureAudio, next, state.curMs ] // state.curMs 추가
  );

  const pause = useCallback(async () => {
    // ... (pause 함수 내용은 기존과 동일) ...
    if (state.playbackSource === "spotify" && spotifyPlayer.ready) {
      await spotifyPlayer.pause();
      setIsPlaying(false);
    } else if (state.playbackSource === "preview" && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, [state.playbackSource, spotifyPlayer]);

  const seek = useCallback(
    // ... (seek 함수 내용은 기존과 동일) ...
    (ms: number) => {
      if (state.playbackSource === "spotify" && spotifyPlayer.ready) {
        spotifyPlayer.seek(ms);
      } else if (state.playbackSource === "preview" && audioRef.current) {
        const a = audioRef.current;
        const targetTime = Math.max(0, ms / 1000);
        const duration =
          a.duration && isFinite(a.duration) ? a.duration : state.durMs / 1000;
        // seek 시 duration 초과 방지
        a.currentTime = Math.min( targetTime, duration > 0 ? duration - 0.01 : 0 );
         setState(s => ({ ...s, curMs: a.currentTime * 1000 }));
      }
    },
    [state.playbackSource, spotifyPlayer, state.durMs]
  );

  // ✨ resume 함수 수정: play 대신 내부 플레이어 resume 사용 ✨
  const resume = useCallback(async () => {
    if (state.playbackSource === "spotify" && spotifyPlayer.ready) {
      await spotifyPlayer.resume(); // Spotify SDK의 resume 사용
      setIsPlaying(true);
    } else if (state.playbackSource === "preview" && audioRef.current) {
      try {
        await audioRef.current.play(); // Audio 요소의 play는 멈춘 지점부터 재생
        setIsPlaying(true);
      } catch (err) {
        console.error("Preview resume failed:", err);
        setIsPlaying(false);
      }
    } else if (state.currentTrack) {
        // Fallback: 재생 소스가 활성 상태가 아닐 때 (예: 페이지 로드 직후)
        console.log("Resume fallback: calling play, starting from", state.curMs);
        suppressAutoPlayRef.current = true;
        // play 함수에 false를 전달하여 이어서 재생하도록 요청
        await play(state.currentTrack, state.index, false);
        suppressAutoPlayRef.current = false;
    }
  // ✨ 의존성 배열에서 play 제거 ✨
  }, [state.playbackSource, spotifyPlayer, state.currentTrack, state.index, state.curMs]);


  const togglePlayPause = useCallback(async () => {
    if (isPlaying) {
      await pause();
    } else {
      await resume(); // play 대신 resume 사용
    }
  }, [isPlaying, pause, resume]);

  // ✨ prev 함수 수정: seek(0) 사용 및 play 직접 호출 제거 ✨
  const prev = useCallback(() => {
    if (state.playbackSource === "spotify" && spotifyPlayer.ready) {
      spotifyPlayer.prev(); // Spotify는 자체 처리
      return;
    }
    if (state.playbackSource === "preview" && audioRef.current) {
      const a = audioRef.current;
      if (a.currentTime > 3) {
        seek(0); // 현재 곡 처음으로 이동
        if (!isPlaying) {
            // 멈춘 상태였다면 resume 호출 (0초부터 시작)
            resume();
        }
        // 이미 재생 중이었다면 seek(0)만으로 충분
        return;
      } 
    }

    const prevIndex = Math.max(0, state.index - 1);    

    if (prevIndex !== state.index && state.queue[prevIndex]) {
        console.log(`Prev button: Moving to index ${prevIndex}`); // 디버깅 로그
        // suppressAutoPlayRef 설정 불필요 (useEffect에서 처리)
        setState((s) => {
            const prevTrack = s.queue[prevIndex];
            return {
                ...s,
                index: prevIndex,
                currentTrack: prevTrack, // currentTrack도 업데이트
                curMs: 0 // 이전 곡은 항상 처음부터 재생
            };
        });
        // 실제 play 호출은 index 변경 useEffect에 맡김
    } else {
        console.log("Prev button: Already at the beginning or invalid index."); // 디버깅 로그
        // 첫 곡에서 prev 누르면 처음으로 이동 (선택적 동작)
        if (state.index === 0 && state.curMs > 0) {
            seek(0);
            if (!isPlaying) resume();
        }
    }

  // ✨ 의존성 배열 업데이트: isPlaying, resume, seek 추가 ✨
  }, [state.playbackSource, spotifyPlayer, state.queue, state.index, state.curMs, isPlaying, seek, resume]);


  const setVolume = useCallback(
    // ... (setVolume 함수 내용은 기존과 동일) ...
    (v: number) => {
      const vv = Math.min(1, Math.max(0, v));
      _setVolume(vv);
      if (typeof window !== "undefined") {
        try { localStorage.setItem("player_volume", String(vv)); } catch {}
      }
      if (audioRef.current) audioRef.current.volume = vv;
      if (spotifyPlayer.ready) { // isSpotifyConnected -> spotifyPlayer.ready
        spotifyPlayer.setVolume(vv);
      }
    },
    [spotifyPlayer] // 의존성 변경
  );

  const setQueueAndPlay = useCallback(
    // ... (setQueueAndPlay 함수 내용은 기존과 동일, 내부에서 play(..., true) 호출) ...
    (tracks: Track[], startIndex = 0) => {
      const safeIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
      const firstTrack = tracks[safeIndex] || null;

      if (isPlaying) pause(); // 재생 중이면 일단 멈춤

      suppressAutoPlayRef.current = true; // 자동 재생 억제 시작

      setState((s) => ({
        ...s,
        queue: tracks,
        index: safeIndex,
        currentTrack: firstTrack,
        curMs: 0, // 새 큐는 항상 처음부터
        durMs: firstTrack?.duration ? firstTrack.duration * 1000 : 0,
        playbackSource: null, // 재생 소스 초기화
      }));

      // 약간의 지연 후 첫 곡 재생 시작 (startFromBeginning = true)
      setTimeout(() => {
        void play(firstTrack, safeIndex, true);
        suppressAutoPlayRef.current = false; // 자동 재생 억제 해제
      }, 50);
    },
    [isPlaying, pause, play] // play 의존성 유지
  );

  // preview ended → next
  useEffect(() => {
    // ... (preview ended useEffect 내용은 기존과 동일) ...
    const a = ensureAudio();
    const handleEnded = () => {
      if (state.playbackSource === "preview") next();
    };
    a.addEventListener("ended", handleEnded);
    return () => a.removeEventListener("ended", handleEnded);
  }, [ensureAudio, state.playbackSource, next]);

  // ✨ 인덱스 변경 시 자동 재생 useEffect 수정 ✨
  useEffect(() => {
    if (suppressAutoPlayRef.current) return; // 억제 중이면 실행 안 함

    const track = state.queue[state.index]; // 현재 인덱스의 트랙

    // 트랙이 유효하고, 현재 재생 중인 트랙이 없거나 ID가 다를 때만 실행
    if (track && (!state.currentTrack || state.currentTrack.id !== track.id)) {
      console.log(`Index changed to ${state.index}, playing new track ID: ${track.id} from beginning`);
      // play 함수에 true를 전달하여 처음부터 재생하도록 함 (seek(0) 불필요)
      void play(track, state.index, true);
    }
    // ✨ 의존성 배열에서 seek 제거 ✨
  }, [state.index, state.queue, play, state.currentTrack?.id]);


  const ctx: Ctx = useMemo(
    () => ({
      state,
      isPlaying,
      volume,
      isSpotifyReady: spotifyPlayer.ready,
      togglePlayPause,
      play, // 수정된 play
      pause,
      // resume, // resume은 노출 안 함
      next,
      prev, // 수정된 prev
      seek,
      setVolume,
      setQueueAndPlay,
    }),
    [ // ✨ 의존성 배열 업데이트 ✨
      state,
      isPlaying,
      volume,
      spotifyPlayer, // 객체 자체
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