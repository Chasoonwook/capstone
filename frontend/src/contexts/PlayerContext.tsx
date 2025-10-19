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

  const next = useCallback(() => {
    console.log("[PlayerContext] next() called");
    setState((s) => {
      if (!s.queue || s.queue.length === 0) return s;
      const nextIndex = s.index + 1;
      if (nextIndex >= s.queue.length) { console.log("End of queue reached"); setIsPlaying(false); return { ...s, curMs: 0 }; }
      const nextTrack = s.queue[nextIndex];
      console.log(`[PlayerContext] next(): Updating index to ${nextIndex}, track: ${nextTrack?.title}`);
      return { ...s, index: nextIndex, currentTrack: nextTrack, curMs: 0 }; // nextTrack 추가 및 curMs: 0 유지
    });
  }, [setIsPlaying]);

  const play = useCallback(
    async (track?: Track, index?: number, startFromBeginning = true) => {
      const baseTrack = track ?? state.queue[index ?? state.index];
      const targetIndex = index ?? state.index;
      if (!baseTrack) return;

      console.log(`[PlayerContext] play() called for track: ${baseTrack.title}, index: ${targetIndex}, startFromBeginning: ${startFromBeginning}`);

      try { // 명시적 중지
        if (state.playbackSource === "spotify" && spotifyPlayer.ready && !spotifyPlayer.state.paused) { await spotifyPlayer.pause(); }
        else if (state.playbackSource === "preview" && audioRef.current && !audioRef.current.paused) { audioRef.current.pause(); if (startFromBeginning) audioRef.current.currentTime = 0; }
        setIsPlaying(false); await wait(50);
      } catch (e) { console.error("Error pausing previous track:", e); }

      const targetTrack = await resolvePlayableSource(baseTrack);
      const hasSpotify = !!(targetTrack.spotify_uri || targetTrack.spotify_track_id);
      const canPlaySpotify = isSpotifyConnected && hasSpotify;
      const source: "spotify" | "preview" | null = canPlaySpotify ? "spotify" : targetTrack.audioUrl ? "preview" : null;
      console.log(`Play request: ${targetTrack.title} (Source: ${source || "None"})`);
      console.log(`[PlayerContext] Determined source: ${source || "None"}`);

      setState((s) => ({
        ...s, index: targetIndex, currentTrack: targetTrack, playbackSource: source,
        curMs: startFromBeginning ? 0 : s.curMs,
        durMs: (startFromBeginning || source !== s.playbackSource) ? (targetTrack.duration ? targetTrack.duration * 1000 : 0) : s.durMs,
      }));

      if (source === "spotify") {
        const uri = targetTrack.spotify_uri || (targetTrack.spotify_track_id ? `spotify:track:${targetTrack.spotify_track_id}` : null);
        if (uri) { 
          try { 
            console.log(`[PlayerContext] Calling spotifyPlayer.playUris with URI: ${uri}`);
            await spotifyPlayer.playUris([uri]); 
            setIsPlaying(true); 
            return; 
          } catch (e) { console.error("Spotify playUris failed:", e); setIsPlaying(false); } 
        } else {console.log("[PlayerContext] Spotify source selected but no valid URI found.");}
      }
      if (source === "preview") {
        const a = ensureAudio(); const newSrc = targetTrack.audioUrl!; let shouldLoad = a.src !== newSrc;
        if (shouldLoad) { a.src = newSrc; a.load(); }
        const targetTime = (startFromBeginning || shouldLoad) ? 0 : (state.curMs / 1000); // ✨ 재생 시간 계산 ✨
        console.log(`[PlayerContext] Setting preview currentTime to: ${targetTime}`); //
        if (a.seekable.length > 0) { // seekable 확인
            try { a.currentTime = targetTime; } catch (e) { console.error("Error setting currentTime:", e); a.currentTime = 0; }
        } else if (targetTime !== 0) {
             // seekable 하지 않으면 경고 후 0초로 (또는 로드 후 설정 시도)
             console.warn("Preview audio not seekable yet, starting from 0.");
             a.currentTime = 0;
        }
        if (!shouldLoad && !startFromBeginning) setState(s => ({ ...s, curMs: a.currentTime * 1000 })); // 즉시 상태 반영 (load 시에는 loadedmetadata에서 처리됨)

        try {
          console.log("[PlayerContext] Calling previewAudio.play()"); // ✨ 로그 추가
          await a.play();
          setIsPlaying(true);
          return;
        } catch (err) { console.error("Preview play failed:", err); setIsPlaying(false); }
      }
      console.warn("No playable source for track:", targetTrack.title); setIsPlaying(false); next();
    },
    [ state.queue, state.index, state.playbackSource, isSpotifyConnected, spotifyPlayer, ensureAudio, next, state.curMs ]
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

  // ✨ prev 함수 로직 재수정 ✨
  const prev = useCallback(() => {
    console.log("[PlayerContext] prev() called");
    // Spotify 재생 시 SDK의 prev 사용
    if (state.playbackSource === "spotify" && spotifyPlayer.ready) {
      spotifyPlayer.prev();
      // Spotify SDK가 상태 업데이트 후 player_state_changed 이벤트를 발생시키므로,
      // 여기서 추가적인 setState나 play 호출은 불필요하며 오히려 충돌을 일으킬 수 있음.
      return;
    }

    // Preview 재생 시 또는 Fallback
    const currentMs = state.curMs; // 현재 시간 확인
    // 3초 이상 재생했으면 현재 곡 처음으로
    if (currentMs > 3000) {
        console.log("Prev button: Seeking to 0");
        seek(0); // seek 함수 호출
        // 만약 멈춘 상태였다면 재생 시작
        if (!isPlaying) {
            resume(); // resume 호출 (0초부터 시작)
        }
        // 이미 재생 중이었다면 seek(0)만으로 충분
        return; // 인덱스 변경은 없으므로 여기서 종료
    }

    // 이전 곡 인덱스 계산 (3초 미만 재생 시)
    const prevIndex = Math.max(0, state.index - 1);

    // 인덱스가 실제로 변경될 경우에만 상태 업데이트 (무한 루프 방지)
    if (prevIndex !== state.index && state.queue[prevIndex]) {
        console.log(`[PlayerContext] prev(): Updating index to ${prevIndex}`);
        // suppressAutoPlayRef 설정은 useEffect에서 처리하므로 여기서 불필요
        setState((s) => {
            const prevTrack = s.queue[prevIndex];
            return {
                ...s,
                index: prevIndex,
                currentTrack: prevTrack, // currentTrack 즉시 업데이트
                curMs: 0 // 이전 곡은 항상 처음부터 재생
            };
        });
        // 실제 play 호출은 index 변경 useEffect에 맡김
    } else {
        console.log("Prev button: Already at the beginning or invalid index. Seeking to 0.");
        // 첫 곡에서 prev 누르거나 유효하지 않은 인덱스면 그냥 처음으로 이동
        seek(0);
        if (!isPlaying) resume(); // 멈춰있었다면 재생 시작
    }

  // ✨ 의존성 배열 재조정: state 관련 항목 제거, 필요한 함수만 포함 ✨
  }, [state.playbackSource, spotifyPlayer, state.queue, state.index, state.curMs, isPlaying, seek, resume]);


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
      console.log(`[PlayerContext] setQueueAndPlay called with ${tracks.length} tracks, starting at index ${startIndex}`); // ✨ 로그 추가
      const safeIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
      const firstTrack = tracks[safeIndex] || null;

      // 현재 재생 중이면 일단 중지
      if (isPlaying) {
          console.log("[PlayerContext] Pausing before setting new queue"); // ✨ 로그 추가
          pause();
      }

      // 인덱스 변경 hook의 자동 재생을 잠시 억제
      suppressAutoPlayRef.current = true;
      console.log("[PlayerContext] Auto-play suppressed"); // ✨ 로그 추가

      // 새로운 큐와 인덱스로 상태 업데이트 (항상 0초부터 시작)
      setState((s) => ({
        ...s,
        queue: tracks,
        index: safeIndex,
        currentTrack: firstTrack,
        curMs: 0,
        durMs: firstTrack?.duration ? firstTrack.duration * 1000 : 0,
        playbackSource: null, // 재생 소스 초기화
      }));
      console.log(`[PlayerContext] State updated for new queue. Index: ${safeIndex}, Track: ${firstTrack?.title}`); // ✨ 로그 추가

      // 약간의 지연 후 첫 곡 재생 시작 (startFromBeginning = true)
      setTimeout(() => {
        console.log("[PlayerContext] Initiating play for the first track in the new queue"); // ✨ 로그 추가
        void play(firstTrack, safeIndex, true); // true 전달 확인
        // ✨ play 함수 호출 직후가 아니라, 약간 더 지연 후 해제 ✨
        setTimeout(() => {
            suppressAutoPlayRef.current = false;
            console.log("[PlayerContext] Auto-play suppression released"); // ✨ 로그 추가
        }, 150); // 총 50ms + 150ms = 200ms 지연 후 해제
      }, 50);
    },
    [isPlaying, pause, play] // play, pause 의존성 유지
  );

  useEffect(() => { // preview ended
    const a = ensureAudio(); const handleEnded = () => { if (state.playbackSource === "preview") next(); };
    a.addEventListener("ended", handleEnded); return () => a.removeEventListener("ended", handleEnded);
  }, [ensureAudio, state.playbackSource, next]);

  // ✨ 인덱스/트랙ID 변경 감지 useEffect 최종 ✨
  useEffect(() => {
    const currentIndex = state.index; // 현재 상태의 인덱스를 변수에 저장
    const currentQueue = state.queue; // 현재 상태의 큐를 변수에 저장
    const currentlyPlayingTrackId = state.currentTrack?.id; // 현재 재생 중인 트랙 ID

    console.log(`[PlayerContext] Index/TrackID Effect triggered. Suppressed: ${suppressAutoPlayRef.current}, Index: ${state.index}, CurrentTrack ID: ${state.currentTrack?.id}`);
    
    if (suppressAutoPlayRef.current) {return;}

    const track = state.queue[state.index]; // 현재 인덱스에 해당하는 트랙

    // 인덱스가 유효한 범위 내에 있는지 확인
    if (currentIndex < 0 || currentIndex >= currentQueue.length) {
      console.log(`[PlayerContext Effect] Invalid index (${currentIndex}). No track to play.`);
      return;
    }

    const targetTrack = currentQueue[currentIndex]; // 목표 트랙 가져오기

    // 목표 트랙이 유효하고 ID를 가지고 있는지 확인
    const targetTrackIsValid = !!targetTrack && typeof targetTrack === 'object' && typeof targetTrack.id !== 'undefined';
    if (!targetTrackIsValid) {
        console.log(`[PlayerContext Effect] Track at index ${currentIndex} is invalid.`);
        return;
    }

    const targetTrackId = targetTrack.id; // 목표 트랙 ID

    // ✨ 재생 조건: 목표 트랙 ID가 현재 재생 중인 트랙 ID와 다를 때 ✨
    const shouldPlay = currentlyPlayingTrackId !== targetTrackId;

    console.log(`[PlayerContext Effect] Condition check: targetTrackId=${targetTrackId}, currentlyPlayingTrackId=${currentlyPlayingTrackId}, shouldPlay=${shouldPlay}`);

    // 트랙이 유효하고, currentTrack이 없거나 ID가 다를 때 재생 시도
    if (shouldPlay) {
      console.log(`--> Calling play for Track ID: ${targetTrackId} from beginning`);
      // play 함수에 true를 전달하여 처음부터 재생
      void play(targetTrack, currentIndex, true);
    } else {
        console.log(`[PlayerContext Effect] Conditions not met for auto-play (target track ID is same as current).`);
    }
  // ✨ 의존성 배열: state.index와 state.currentTrack?.id만 사용 ✨
  }, [state.index, state.queue, play]); // play는 유지, seek 제거


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