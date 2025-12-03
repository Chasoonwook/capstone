// src/lib/spotifySdk.ts
// 브라우저에서 Spotify Web Playback SDK를 로드하고 player/deviceId를 반환

type CreateWebPlayerOpts = {
  getOAuthToken: () => Promise<string>;
  name?: string;
  volume?: number; // 0~1
};

// 스크립트 중복 로드 방지 처리
function loadScriptOnce(src: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  
  // 이미 로드된 경우 즉시 반환
  const exists = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (exists) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Spotify SDK load failed")); // 에러 메시지
    document.head.appendChild(s);
  });
}

export async function createWebPlayer(opts: CreateWebPlayerOpts): Promise<{ player: any; deviceId: string }> {
  if (typeof window === "undefined") throw new Error("createWebPlayer must run in browser"); // 에러 메시지

  // 1) SDK 스크립트 로드
  await loadScriptOnce("https://sdk.scdn.co/spotify-player.js");

  // 2) SDK 준비 대기 (onSpotifyWebPlaybackSDKReady 이벤트 처리)
  const waitReady = () =>
    new Promise<void>((resolve) => {
      const w: any = window as any;
      // 플레이어가 이미 준비된 경우 즉시 처리
      if (w.Spotify && w.Spotify.Player) return resolve();
      
      const prev = w.onSpotifyWebPlaybackSDKReady;
      w.onSpotifyWebPlaybackSDKReady = () => {
        // 기존 핸들러 호출
        if (typeof prev === "function") {
          try { prev(); } catch {}
        }
        resolve();
      };
    });

  await waitReady();

  const w: any = window as any;
  const Spotify = w.Spotify;
  if (!Spotify?.Player) throw new Error("Spotify.Player not available"); // 에러 메시지 영문화

  // 3) Player 생성
  const player = new Spotify.Player({
    name: opts.name || "Web Player",
    // 토큰 획득 콜백
    getOAuthToken: async (cb: (t: string) => void) => {
      try { cb(await opts.getOAuthToken()); } catch { /* 토큰 획득 실패 시 무시 */ }
    },
    volume: typeof opts.volume === "number" ? opts.volume : 0.8,
  });

  // 4) device_id 확보 및 플레이어 연결
  const deviceId: string = await new Promise((resolve, reject) => {
    player.addListener("ready", ({ device_id }: any) => resolve(device_id));
    // not_ready는 디바이스 일시 오프라인 상황
    player.addListener("not_ready", () => {});
    // 에러 이벤트 리스너
    player.addListener("initialization_error", (e: any) => reject(e));
    player.addListener("authentication_error", (e: any) => reject(e));
    player.addListener("account_error", (e: any) => reject(e));
    // 연결 시도
    player.connect().catch(reject);
  });

  return { player, deviceId };
}