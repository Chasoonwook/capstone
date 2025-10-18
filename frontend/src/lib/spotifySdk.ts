// 브라우저에서 Spotify Web Playback SDK를 로드하고 player/deviceId를 돌려준다.
// 타입 충돌을 피하려고 전역 타입 선언은 쓰지 않고 any 캐스팅만 사용한다.

type CreateWebPlayerOpts = {
  getOAuthToken: () => Promise<string>;
  name?: string;
  volume?: number; // 0~1
};

function loadScriptOnce(src: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  // 이미 로드된 경우
  const exists = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (exists) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("spotify sdk load failed"));
    document.head.appendChild(s);
  });
}

export async function createWebPlayer(opts: CreateWebPlayerOpts): Promise<{ player: any; deviceId: string }> {
  if (typeof window === "undefined") throw new Error("createWebPlayer must run in browser");

  // 1) SDK 스크립트 로드
  await loadScriptOnce("https://sdk.scdn.co/spotify-player.js");

  // 2) SDK 준비 기다리기 (중복 핸들러 방지)
  const waitReady = () =>
    new Promise<void>((resolve) => {
      const w: any = window as any;
      if (w.Spotify && w.Spotify.Player) return resolve();
      const prev = w.onSpotifyWebPlaybackSDKReady;
      w.onSpotifyWebPlaybackSDKReady = () => {
        if (typeof prev === "function") {
          try { prev(); } catch {}
        }
        resolve();
      };
    });

  await waitReady();

  const w: any = window as any;
  const Spotify = w.Spotify;
  if (!Spotify?.Player) throw new Error("Spotify.Player not available");

  // 3) Player 생성
  const player = new Spotify.Player({
    name: opts.name || "Web Player",
    getOAuthToken: async (cb: (t: string) => void) => {
      try { cb(await opts.getOAuthToken()); } catch { /* noop */ }
    },
    volume: typeof opts.volume === "number" ? opts.volume : 0.8,
  });

  // 4) device_id 확보
  const deviceId: string = await new Promise((resolve, reject) => {
    player.addListener("ready", ({ device_id }: any) => resolve(device_id));
    player.addListener("not_ready", () => {/* 디바이스가 잠시 offline 일 수 있음 */});
    player.addListener("initialization_error", (e: any) => reject(e));
    player.addListener("authentication_error", (e: any) => reject(e));
    player.addListener("account_error", (e: any) => reject(e));
    player.connect().catch(reject);
  });

  return { player, deviceId };
}
