// src/hooks/useSpotifyPlayer.ts
"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { API_BASE } from "@/lib/api"

// ✅ 전역 Window 타입 보강 (SDK 로더가 참조함)
declare global {
  interface Window {
    Spotify?: any;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

type SpState = {
  deviceId: string | null
  position: number // ms
  duration: number // ms
  paused: boolean
}

const SDK_SRC = "https://sdk.scdn.co/spotify-player.js"

export function useSpotifyPlayer() {
  const [ready, setReady] = useState(false)
  const [deviceId, _setDeviceId] = useState<string | null>(null)
  const deviceIdRef = useRef<string | null>(null)
  const setDeviceId = (id: string | null) => { deviceIdRef.current = id; _setDeviceId(id) }

  const [state, setState] = useState<SpState>({ deviceId: null, position: 0, duration: 0, paused: true })

  const playerRef = useRef<any>(null)          // ← SDK 인스턴스 (타입차이 방지용 any)
  const stateTimerRef = useRef<number | null>(null)
  const secTimerRef   = useRef<number | null>(null)

  // 진행바 보간 기준값
  const basePosRef  = useRef(0)
  const durationRef = useRef(0)
  const pausedRef   = useRef(true)
  const lastTickRef = useRef<number | null>(null)

  /* ── SDK 로드 & 초기화 ─────────────────────────────────── */
  useEffect(() => {
    let cancelled = false

    const loadSdk = () =>
      new Promise<void>((resolve) => {
        if (window.Spotify) return resolve()
        window.onSpotifyWebPlaybackSDKReady ||= () => {}
        const s = document.createElement("script")
        s.src = SDK_SRC
        s.async = true
        s.onload = () => resolve()
        document.head.appendChild(s)
      })

    const getToken = async (): Promise<string | null> => {
      try {
        const r = await fetch(`${API_BASE}/api/spotify/token`, { credentials: "include" })
        if (!r.ok) return null
        const j = await r.json()
        return (j?.access_token as string) || null
      } catch { return null }
    }

    const init = async () => {
      const t = await getToken()
      if (!t || cancelled) return

      await loadSdk()
      if (cancelled || !window.Spotify?.Player) return

      const player: any = new window.Spotify.Player({
        name: "Capstone Web Player",
        volume: 0.8,
        // ✅ cb 타입 명시
        getOAuthToken: async (cb: (token: string) => void) => {
          const nt = await getToken()
          if (nt) cb(nt)
        },
      })

      // ✅ device_id 타입 명시
      player.addListener("ready", ({ device_id }: { device_id: string }) => {
        if (cancelled) return
        setDeviceId(device_id)
        setReady(true)
        setState(s => ({ ...s, deviceId: device_id }))
      })

      player.addListener("not_ready", () => setReady(false))

      // ✅ st 타입 any로 고정(Spotify SDK가 보내는 모양이 종종 달라서)
      player.addListener("player_state_changed", (st: any) => {
        if (!st) return
        const pos = Number(st.position ?? 0)
        const dur = Number(st.duration ?? 0)
        const paused = Boolean(st.paused)

        basePosRef.current  = pos
        durationRef.current = dur
        pausedRef.current   = paused
        lastTickRef.current = performance.now()

        setState({
          deviceId: deviceIdRef.current,
          position: pos,
          duration: dur,
          paused,
        })
      })

      player.addListener("initialization_error", (e: any) => console.error("init_error", e))
      player.addListener("authentication_error", (e: any) => console.error("auth_error", e))
      player.addListener("account_error", (e: any) => console.error("account_error", e))
      player.addListener("playback_error", (e: any) => console.error("playback_error", e))

      await player.connect()
      try { await player.activateElement?.() } catch {}
      playerRef.current = player

      // ⭐ 상태 폴링: 1초마다 실제 재생 위치/길이 동기화
      if (stateTimerRef.current) window.clearInterval(stateTimerRef.current)
      stateTimerRef.current = window.setInterval(async () => {
        try {
          const s: any = await player.getCurrentState()
          if (s) {
            basePosRef.current  = Number(s.position ?? 0)
            durationRef.current = Number(s.duration ?? 0)
            pausedRef.current   = Boolean(s.paused)
            lastTickRef.current = performance.now()
            setState({
              deviceId: deviceIdRef.current,
              position: basePosRef.current,
              duration: durationRef.current,
              paused: pausedRef.current,
            })
          }
        } catch {}
      }, 1000) as unknown as number
    }

    void init()

    return () => {
      cancelled = true
      try { playerRef.current?.disconnect?.() } catch {}
      if (stateTimerRef.current) window.clearInterval(stateTimerRef.current)
      if (secTimerRef.current) window.clearInterval(secTimerRef.current)
    }
  }, [API_BASE])

  /* ── 1초 단위 진행바 보간(시각적으로 착착 이동) ─────────── */
  useEffect(() => {
    const tick = () => {
      const now = performance.now()
      const last = lastTickRef.current
      let pos = basePosRef.current
      if (!pausedRef.current && last != null) pos += now - last
      const rounded = Math.min(durationRef.current || 0, Math.max(0, Math.floor(pos / 1000) * 1000))
      setState(s =>
        s.position !== rounded || s.duration !== durationRef.current || s.paused !== pausedRef.current
          ? { deviceId: s.deviceId, position: rounded, duration: durationRef.current, paused: pausedRef.current }
          : s
      )
      lastTickRef.current = now
    }
    secTimerRef.current = window.setInterval(tick, 1000) as unknown as number
    return () => { if (secTimerRef.current) window.clearInterval(secTimerRef.current) }
  }, [])

  /* ── 준비 대기 헬퍼 ─────────────────────────────────────── */
  const waitReady = useCallback(async (ms = 6000) => {
    const t0 = Date.now()
    while (!(ready && deviceIdRef.current)) {
      if (Date.now() - t0 > ms) throw new Error("spotify_not_ready")
      await new Promise(r => setTimeout(r, 120))
    }
  }, [ready])

  /* ── 컨트롤러 ──────────────────────────────────────────── */
  const transferToThisDevice = useCallback(async (play = false) => {
    await waitReady()
    const id = deviceIdRef.current!
    await fetch(`${API_BASE}/api/spotify/transfer`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: id, play }),
    })
  }, [waitReady, API_BASE])

  const playUris = useCallback(async (uris: string[]) => {
    if (!uris?.length) return
    await transferToThisDevice(false)
    const id = deviceIdRef.current!
    await fetch(`${API_BASE}/api/spotify/play`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: id, uris }),
    })
    basePosRef.current = 0
    pausedRef.current = false
    lastTickRef.current = performance.now()
    setState(s => ({ ...s, position: 0, paused: false }))
  }, [transferToThisDevice, API_BASE])

  const pause = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/pause`, { method: "PUT", credentials: "include" })
    pausedRef.current = true
    setState(s => ({ ...s, paused: true }))
  }, [API_BASE])

  const resume = useCallback(async () => {
    await transferToThisDevice(false)
    const id = deviceIdRef.current!
    await fetch(`${API_BASE}/api/spotify/play`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: id }),
    })
    pausedRef.current = false
    lastTickRef.current = performance.now()
    setState(s => ({ ...s, paused: false }))
  }, [transferToThisDevice, API_BASE])

  const next = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/next`, { method: "POST", credentials: "include" })
  }, [API_BASE])

  const prev = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/previous`, { method: "POST", credentials: "include" })
  }, [API_BASE])

  const seek = useCallback(async (ms: number) => {
    try {
      // ✅ 타입 정의에 없다고 뜨면 any로 안전 캐스팅
      await (playerRef.current as any)?.seek?.(ms)
    } finally {
      basePosRef.current = ms
      lastTickRef.current = performance.now()
      setState(s => ({ ...s, position: Math.floor(ms / 1000) * 1000 }))
    }
  }, [])

  return { ready, deviceId: deviceIdRef.current, state, playUris, pause, resume, next, prev, seek }
}
