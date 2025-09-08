import { useEffect, useRef } from "react";

export function useSpotifyPlayer(accessToken: string | null) {
  const deviceIdRef = useRef<string | null>(null);
  const playerRef = useRef<Spotify.Player | null>(null);

  useEffect(() => {
    if (!accessToken) return;

    if (!(window as any).onSpotifyWebPlaybackSDKReady) {
      const s = document.createElement("script");
      s.src = "https://sdk.scdn.co/spotify-player.js";
      s.async = true;
      document.body.appendChild(s);
    }

    (window as any).onSpotifyWebPlaybackSDKReady = () => {
      const player = new (window as any).Spotify.Player({
        name: "ㅇㅈㅇ Web Player",
        getOAuthToken: (cb: (t: string) => void) => cb(accessToken),
        volume: 0.8,
      });
      playerRef.current = player;

      player.addListener("ready", ({ device_id }: any) => { deviceIdRef.current = device_id; });
      player.addListener("account_error", ({ message }: any) => console.error("Account error:", message));
      player.addListener("authentication_error", ({ message }: any) => console.error("Auth error:", message));
      player.addListener("initialization_error", ({ message }: any) => console.error("Init error:", message));
      player.connect();
    };
  }, [accessToken]);

  const transfer = async () => {
    if (!accessToken || !deviceIdRef.current) return;
    await fetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ device_ids: [deviceIdRef.current], play: false }),
    });
  };

  const playUris = async (uris: string[]) => {
    await transfer();
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceIdRef.current}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ uris }),
    });
    // Safari/Chrome 정책: 최초 재생 전 한 번 user-gesture에서
    await (playerRef.current as any)?.activateElement?.();
  };

  const resume = async () => {
    await transfer();
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceIdRef.current}`, {
      method: "PUT", headers: { Authorization: `Bearer ${accessToken}` },
    });
  };
  const pause = async () => fetch("https://api.spotify.com/v1/me/player/pause", { method:"PUT", headers:{ Authorization:`Bearer ${accessToken}` }});
  const next  = async () => fetch("https://api.spotify.com/v1/me/player/next",  { method:"POST", headers:{ Authorization:`Bearer ${accessToken}` }});
  const prev  = async () => fetch("https://api.spotify.com/v1/me/player/previous",{ method:"POST", headers:{ Authorization:`Bearer ${accessToken}` }});

  return { playUris, resume, pause, next, prev };
}
