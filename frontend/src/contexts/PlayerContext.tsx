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

  play: (track?: Track, index?: number, startFromBeginning?: boolean) => Promise<void>;
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
    const qs = new URLSearchParams({ title: t.title, ...(t.artist ? { artist: t.artist } : {}), limit: "1" });
    let data: any = null;
    lastHit = Date.now();
    const resp = await fetch(`${API_BASE}/api/spotify/search?${qs.toString()}`, { credentials: "include" }).catch(() => null);
    if (resp?.ok) { data = await resp.json(); } else { failCache.set(key, Date.now()); return t; }
    const item = data?.tracks?.items?.[0] || data?.items?.[0] || data?.[0] || null;
    if (!item) { failCache.set(key, Date.now()); return t; }
    const preview = item?.preview_url || item?.previewUrl || item?.audioUrl || null;
    const cover = item?.album?.images?.[0]?.url || item?.albumImage || item?.coverUrl || null;
    const sid = item?.id || item?.trackId || item?.spotify_track_id || null;
    return { ...t, audioUrl: preview ?? t.audioUrl ?? null, coverUrl: cover ?? t.coverUrl ?? null, spotify_track_id: sid ?? t.spotify_track_id ?? null, spotify_uri: sid ? `spotify:track:${sid}` : (t.spotify_uri ?? null) };
  })();
  inflightMap.set(key, p);
  try { return await p; } finally { inflightMap.delete(key); }
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { status: spotifyStatus } = useSpotifyStatus();
  const spotifyPlayer = useSpotifyPlayer();
  const isSpotifyConnected = spotifyStatus.connected && spotifyPlayer.ready;

  const [state, setState] = useState<PlayerState>({ queue: [], index: -1, curMs: 0, durMs: 0, currentTrack: null, playbackSource: null });
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, _setVolume] = useState<number>(() => {
    if (typeof window === "undefined") return 0.8;
    const v = Number(localStorage.getItem("player_volume") || "0.8");
    return isNaN(v) ? 0.8 : Math.min(1, Math.max(0, v));
  });

  const suppressAutoPlayRef = useRef(false);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      console.log("Creating Audio element for previews");
      const a = new Audio(); a.preload = "metadata"; a.volume = volume;
      a.addEventListener("timeupdate", () => { if (state.playbackSource === "preview") { setState((s) => ({ ...s, curMs: a.currentTime * 1000 })); } });
      a.addEventListener("loadedmetadata", () => { if (state.playbackSource === "preview") { setState((s) => ({ ...s, durMs: a.duration && isFinite(a.duration) ? a.duration * 1000 : 0 })); } });
      a.addEventListener("error", (e) => { console.error("Audio Element Error:", e); if (state.playbackSource === "preview") setIsPlaying(false); });
      audioRef.current = a;
    }
    return audioRef.current!;
  }, [volume, state.playbackSource]);

  useEffect(() => {
    if (isSpotifyConnected && state.playbackSource === "spotify") {
      setState((s) => ({ ...s, curMs: spotifyPlayer.state.position, durMs: spotifyPlayer.state.duration }));
      setIsPlaying(!spotifyPlayer.state.paused);
    }
  }, [spotifyPlayer.state, isSpotifyConnected, state.playbackSource]);

  const play = useCallback(
    async (track?: Track, index?: number, startFromBeginning = true) => {
      const baseTrack = track ?? state.queue[index ?? state.index];
      const targetIndex = index ?? state.index;
      if (!baseTrack) {
          console.log("[PlayerContext] Play cancelled: No base track found.");
          return;
       }

      console.log(`[PlayerContext] play() called for track: ${baseTrack.title}, index: ${targetIndex}, startFromBeginning: ${startFromBeginning}`);

      try { // 명시적 중지
        if (state.playbackSource === "spotify" && spotifyPlayer.ready && !spotifyPlayer.state.paused) { await spotifyPlayer.pause(); }
        else if (state.playbackSource === "preview" && audioRef.current && !audioRef.current.paused) { audioRef.current.pause(); if (startFromBeginning) audioRef.current.currentTime = 0; }
        setIsPlaying(false); await wait(50); // 중지 후 잠시 대기
      } catch (e) { console.error("Error pausing previous track:", e); }

      const targetTrack = await resolvePlayableSource(baseTrack);
      const hasSpotify = !!(targetTrack.spotify_uri || targetTrack.spotify_track_id);
      const canPlaySpotify = isSpotifyConnected && hasSpotify;
      const source: "spotify" | "preview" | null = canPlaySpotify ? "spotify" : targetTrack.audioUrl ? "preview" : null;
      console.log(`[PlayerContext] Determined source: ${source || "None"} for track ${targetTrack.title}`);

      // ✨ 상태 업데이트 강화: 재생 시작 직전에 상태를 최종 업데이트 ✨
      setState((s) => ({
        ...s, index: targetIndex, currentTrack: targetTrack, playbackSource: source,
        curMs: startFromBeginning ? 0 : s.curMs,
        durMs: (startFromBeginning || source !== s.playbackSource) ? (targetTrack.duration ? targetTrack.duration * 1000 : 0) : s.durMs,
      }));

      // 실제 재생
      let playInitiated = false; // 재생 시작 여부 플래그
      if (source === "spotify") {
        const uri = targetTrack.spotify_uri || (targetTrack.spotify_track_id ? `spotify:track:${targetTrack.spotify_track_id}` : null);
        if (uri) {
          try {
            console.log(`[PlayerContext] Calling spotifyPlayer.playUris with URI: ${uri}`);
            await spotifyPlayer.playUris([uri]);
            setIsPlaying(true);
            playInitiated = true; // Spotify 재생 시작됨
          } catch (e) { console.error("Spotify playUris failed:", e); setIsPlaying(false); }
        } else { console.log("[PlayerContext] Spotify source selected but no valid URI found."); }
      }
      if (!playInitiated && source === "preview") { // Spotify 재생 실패 시 Preview 시도
        const a = ensureAudio(); const newSrc = targetTrack.audioUrl!; let shouldLoad = a.src !== newSrc;
        if (shouldLoad) { a.src = newSrc; a.load(); }
        const targetTime = (startFromBeginning || shouldLoad) ? 0 : (state.curMs / 1000);
        console.log(`[PlayerContext] Setting preview currentTime to: ${targetTime}`);
        if (a.seekable.length > 0) { try { a.currentTime = targetTime; } catch (e) { console.error("Error setting currentTime:", e); a.currentTime = 0; } }
        else if (targetTime !== 0) { console.warn("Preview audio not seekable yet, starting from 0."); a.currentTime = 0; }
        if (!shouldLoad && !startFromBeginning) setState(s => ({ ...s, curMs: a.currentTime * 1000 }));
        try { if (shouldLoad) { /* canplaythrough 대기 로직 (선택) */ } console.log("[PlayerContext] Calling previewAudio.play()"); await a.play(); setIsPlaying(true); playInitiated = true; // Preview 재생 시작됨
        } catch (err) { console.error("Preview play failed:", err); setIsPlaying(false); }
      }

      // 재생 시작 못 했으면 다음 곡 시도 (단, next() 내부에서 또 play 호출 방지 필요)
      if (!playInitiated) {
        console.warn("No playable source initiated for track:", targetTrack.title);
        setIsPlaying(false);
        // ✨ next() 직접 호출 대신, 인덱스만 변경하여 useEffect가 처리하도록 유도 (무한 루프 방지) ✨
        setState(s => {
            const nextIndex = s.index + 1;
            if (nextIndex < s.queue.length) {
                return { ...s, index: nextIndex, currentTrack: s.queue[nextIndex], curMs: 0 };
            }
            console.log("End of queue reached after failed play attempt.");
            return { ...s, curMs: 0 }; // 마지막 곡 실패 시 처음으로
        });
      }
    },
    // ✨ 의존성 배열 업데이트: 필요한 상태와 함수 포함 ✨
    [ state.queue, state.index, state.playbackSource, state.curMs, isSpotifyConnected, spotifyPlayer, ensureAudio, setIsPlaying ] // next 제거
  );

  const pause = useCallback(async () => {
    if (state.playbackSource === "spotify" && spotifyPlayer.ready) { await spotifyPlayer.pause(); setIsPlaying(false); }
    else if (state.playbackSource === "preview" && audioRef.current) { audioRef.current.pause(); setIsPlaying(false); }
  }, [state.playbackSource, spotifyPlayer]);

  const seek = useCallback(
    (ms: number) => {
      if (state.playbackSource === "spotify" && spotifyPlayer.ready) { spotifyPlayer.seek(ms); }
      else if (state.playbackSource === "preview" && audioRef.current) {
        const a = audioRef.current; const targetTime = Math.max(0, ms / 1000); const duration = a.duration && isFinite(a.duration) ? a.duration : (state.durMs / 1000);
        // seek 시 duration 초과 방지 및 seekable 확인
        if (a.seekable.length > 0 && targetTime <= duration) {
            a.currentTime = Math.min( targetTime, duration > 0 ? duration - 0.01 : 0 );
            setState(s => ({ ...s, curMs: a.currentTime * 1000 }));
        } else {
            console.warn("Seek ignored: invalid time or media not seekable.");
        }
      }
    },
    [state.playbackSource, spotifyPlayer, state.durMs]
  );

  const resume = useCallback(async () => {
    if (state.playbackSource === "spotify" && spotifyPlayer.ready) { await spotifyPlayer.resume(); setIsPlaying(true); }
    else if (state.playbackSource === "preview" && audioRef.current) { try { await audioRef.current.play(); setIsPlaying(true); } catch (err) { console.error("Preview resume failed:", err); setIsPlaying(false); } }
    else if (state.currentTrack) { console.log("Resume fallback: calling play, starting from", state.curMs); suppressAutoPlayRef.current = true; await play(state.currentTrack, state.index, false); suppressAutoPlayRef.current = false; }
  }, [state.playbackSource, spotifyPlayer, state.currentTrack, state.index, state.curMs, play]); // play 추가

  const togglePlayPause = useCallback(async () => { if (isPlaying) { await pause(); } else { await resume(); } }, [isPlaying, pause, resume]);

  // ✨ next 함수 수정: setState 후 직접 play 호출 ✨
  const next = useCallback(() => {
    console.log("[PlayerContext] next() called");
    // setState 콜백을 사용하여 최신 상태 기반으로 다음 인덱스 계산
    setState((s) => {
      if (!s.queue || s.queue.length === 0) return s;
      const nextIndex = s.index + 1;
      if (nextIndex >= s.queue.length) {
        console.log("End of queue reached");
        setIsPlaying(false);
        return { ...s, curMs: 0, index: -1, currentTrack: null }; // 큐 끝이면 인덱스 초기화
      }
      const nextTrack = s.queue[nextIndex];
      console.log(`[PlayerContext] next(): Setting index to ${nextIndex}, track: ${nextTrack?.title}`);

      // ✨ 상태 업데이트 직후 play 호출 예약 ✨
      // setTimeout을 사용하여 setState가 반영된 후 play가 호출되도록 함
      setTimeout(() => {
          if (nextTrack) {
              console.log("[PlayerContext] next(): Calling play for next track");
              void play(nextTrack, nextIndex, true); // true: 처음부터 재생
          }
      }, 0);

      // 상태 업데이트 반환
      return { ...s, index: nextIndex, currentTrack: nextTrack, curMs: 0 };
    });
  }, [play, setIsPlaying]);

  // ✨ prev 함수 로직 재수정 ✨
  const prev = useCallback(() => {
    console.log("[PlayerContext] prev() called");
    if (state.playbackSource === "spotify" && spotifyPlayer.ready) { spotifyPlayer.prev(); return; }

    const currentMs = state.curMs;
    if (currentMs > 3000) {
      console.log("Prev button: Seeking to 0");
      seek(0);
      if (!isPlaying) { resume(); }
      return;
    }

    const prevIndex = Math.max(0, state.index - 1);
    const currentIdx = state.index; // 현재 인덱스 저장

    if (prevIndex !== currentIdx && state.queue[prevIndex]) { // 현재 인덱스와 비교
      console.log(`[PlayerContext] prev(): Setting index to ${prevIndex}`);
      const prevTrack = state.queue[prevIndex];

      // ✨ 상태 업데이트 직후 play 호출 예약 ✨
      setTimeout(() => {
          if (prevTrack) {
               console.log("[PlayerContext] prev(): Calling play for previous track");
              void play(prevTrack, prevIndex, true); // true: 처음부터 재생
          }
      }, 0);

      setState((s) => ({ ...s, index: prevIndex, currentTrack: prevTrack, curMs: 0 }));
    } else {
      console.log("Prev button: Already at the beginning or invalid index. Seeking to 0.");
      seek(0);
      if (!isPlaying) resume();
    }
  }, [state.playbackSource, spotifyPlayer, state.queue, state.index, state.curMs, isPlaying, seek, resume, play]); // play 추가


  const setVolume = useCallback(
    (v: number) => {
      const vv = Math.min(1, Math.max(0, v));
      _setVolume(vv); // 내부 상태 업데이트
      // 로컬 스토리지에 저장
      if (typeof window !== "undefined") {
        try { localStorage.setItem("player_volume", String(vv)); } catch {}
      }
      // HTML Audio 요소 볼륨 조절
      if (audioRef.current) audioRef.current.volume = vv;
      // Spotify SDK 볼륨 조절 (준비된 경우)
      if (spotifyPlayer.ready) {
        spotifyPlayer.setVolume(vv);
      }
    },
    [spotifyPlayer] // spotifyPlayer 객체 참조가 바뀌면 함수 재생성
  );

  const setQueueAndPlay = useCallback(
    (tracks: Track[], startIndex = 0) => {
      console.log(`[PlayerContext] setQueueAndPlay called with ${tracks.length} tracks, starting at index ${startIndex}`);
      const safeIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
      const firstTrack = tracks[safeIndex] || null;

      if (isPlaying) { console.log("[PlayerContext] Pausing before setting new queue"); pause(); }

      // suppressAutoPlayRef.current = true; // 제거

      setState((s) => ({
        ...s, queue: tracks, index: safeIndex, currentTrack: firstTrack,
        curMs: 0, durMs: firstTrack?.duration ? firstTrack.duration * 1000 : 0, playbackSource: null,
      }));
      console.log(`[PlayerContext] State updated for new queue. Index: ${safeIndex}, Track: ${firstTrack?.title}`);

      // ✨ play 호출 지연 시간 조정 ✨
      setTimeout(() => {
        console.log("[PlayerContext] Initiating play for the first track in the new queue");
        void play(firstTrack, safeIndex, true);
        // suppressAutoPlayRef.current = false; // 제거
      }, 100); // 약간 더 지연 (50ms -> 100ms)
    },
    [isPlaying, pause, play]
  );

  useEffect(() => { // preview ended
    const a = ensureAudio(); const handleEnded = () => { if (state.playbackSource === "preview") next(); };
    a.addEventListener("ended", handleEnded); return () => a.removeEventListener("ended", handleEnded);
  }, [ensureAudio, state.playbackSource, next]);

  // ✨ 인덱스/트랙ID 변경 감지 useEffect 최종 ✨
  // useEffect(() => {
  //   const currentIndex = state.index; // 현재 상태의 인덱스를 변수에 저장
  //   const currentQueue = state.queue; // 현재 상태의 큐를 변수에 저장
  //   const currentlyPlayingTrackId = state.currentTrack?.id; // 현재 재생 중인 트랙 ID

  //   console.log(`[PlayerContext] Index/TrackID Effect triggered. Suppressed: ${suppressAutoPlayRef.current}, Index: ${state.index}, CurrentTrack ID: ${state.currentTrack?.id}`);
    
  //   if (suppressAutoPlayRef.current) {return;}

  //   const track = state.queue[state.index]; // 현재 인덱스에 해당하는 트랙

  //   // 인덱스가 유효한 범위 내에 있는지 확인
  //   if (currentIndex < 0 || currentIndex >= currentQueue.length) {
  //     console.log(`[PlayerContext Effect] Invalid index (${currentIndex}). No track to play.`);
  //     return;
  //   }

  //   const targetTrack = currentQueue[currentIndex]; // 목표 트랙 가져오기

  //   // 목표 트랙이 유효하고 ID를 가지고 있는지 확인
  //   const targetTrackIsValid = !!targetTrack && typeof targetTrack === 'object' && typeof targetTrack.id !== 'undefined';
  //   if (!targetTrackIsValid) {
  //       console.log(`[PlayerContext Effect] Track at index ${currentIndex} is invalid.`);
  //       return;
  //   }

  //   const targetTrackId = targetTrack.id; // 목표 트랙 ID

  //   // ✨ 재생 조건: 목표 트랙 ID가 현재 재생 중인 트랙 ID와 다를 때 ✨
  //   const shouldPlay = currentlyPlayingTrackId !== targetTrackId;

  //   console.log(`[PlayerContext Effect] Condition check: targetTrackId=${targetTrackId}, currentlyPlayingTrackId=${currentlyPlayingTrackId}, shouldPlay=${shouldPlay}`);

  //   // 트랙이 유효하고, currentTrack이 없거나 ID가 다를 때 재생 시도
  //   if (shouldPlay) {
  //     console.log(`--> Calling play for Track ID: ${targetTrackId} from beginning`);
  //     // play 함수에 true를 전달하여 처음부터 재생
  //     void play(targetTrack, currentIndex, true);
  //   } else {
  //       console.log(`[PlayerContext Effect] Conditions not met for auto-play (target track ID is same as current).`);
  //   }
  // // ✨ 의존성 배열: state.index와 state.currentTrack?.id만 사용 ✨
  // }, [state.index, state.queue, play]); // play는 유지, seek 제거


  const ctx: Ctx = useMemo(
    () => ({
      state, isPlaying, volume, isSpotifyReady: spotifyPlayer.ready,
      togglePlayPause, play, pause, next, prev, seek, setVolume, setQueueAndPlay,
    }),
    [ state, isPlaying, volume, spotifyPlayer, play, pause, togglePlayPause, next, prev, seek, setVolume, setQueueAndPlay ]
  );

  useEffect(() => { ensureAudio(); }, [ensureAudio]);

  return <PlayerCtx.Provider value={ctx}>{children}</PlayerCtx.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerCtx);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}