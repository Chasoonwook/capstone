// src/hooks/useSpotifyPlayer.ts
"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { API_BASE } from "@/lib/api"

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
  const setDeviceId = (id: string | null) => {
    deviceIdRef.current = id
    _setDeviceId(id)
  }

  const [state, setState] = useState<SpState>({
    deviceId: null, position: 0, duration: 0, paused: true,
  })

  const playerRef = useRef<any>(null)
  const tokenRef  = useRef<string | null>(null)

  // ⬇︎ 진행바 보간용 기준값
  const basePosRef   = useRef(0)            // 마지막으로 SDK에서 받은 position(ms)
  const durationRef  = useRef(0)            // 마지막으로 받은 duration(ms)
  const pausedRef    = useRef(true)         // 마지막으로 받은 paused
  const lastTsRef    = useRef<number | null>(null) // RAF delta 기준
  const rafRef       = useRef<number | null>(null)

  // ── SDK 로드 & 초기화 ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    const loadSdk = () =>
      new Promise<void>((resolve) => {
        if ((window as any).Spotify) return resolve()
        // 경고 방지: 스포티파이 스크립트가 이 콜백을 참조하므로 미리 no-op 지정
        if (!(window as any).onSpotifyWebPlaybackSDKReady) {
          (window as any).onSpotifyWebPlaybackSDKReady = () => {}
        }
        const exist = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`)
        if (exist) {
          const t = window.setInterval(() => {
            if ((window as any).Spotify) { window.clearInterval(t); resolve() }
          }, 50)
          return
        }
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
        return j?.access_token || null
      } catch { return null }
    }

    const init = async () => {
      const token = await getToken()
      if (!token || cancelled) return
      tokenRef.current = token

      await loadSdk()
      if (cancelled) return

      const Spotify = (window as any).Spotify
      if (!Spotify || !Spotify.Player) return

      const player = new Spotify.Player({
        name: "Capstone Web Player",
        volume: 0.8,
        getOAuthToken: async (cb: (t: string) => void) => {
          const t = await getToken()
          if (t) { tokenRef.current = t; cb(t) }
        },
      })

      player.addListener("ready", ({ device_id }: any) => {
        if (cancelled) return
        setDeviceId(device_id)
        setReady(true)
        setState(s => ({ ...s, deviceId: device_id }))
      })
      player.addListener("not_ready", () => { setReady(false) })

      player.addListener("player_state_changed", (st: any) => {
        if (!st) return
        const pos = st.position ?? 0
        const dur = st.duration ?? 0
        const paused = !!st.paused

        // 기준값 갱신
        basePosRef.current  = pos
        durationRef.current = dur
        pausedRef.current   = paused
        lastTsRef.current   = performance.now()

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
    }

    init()

    return () => {
      cancelled = true
      try { playerRef.current?.disconnect?.() } catch {}
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // ── 진행바 보간 루프 (requestAnimationFrame) ───────────────
  useEffect(() => {
    const tick = () => {
      const now = performance.now()
      const last = lastTsRef.current
      let newPos = basePosRef.current

      if (!pausedRef.current && last != null) {
        newPos += now - last // ms 단위
        if (durationRef.current > 0) {
          newPos = Math.min(newPos, durationRef.current)
        }
        // 화면 업데이트
        setState((s) => ({
          deviceId: s.deviceId,
          position: newPos,
          duration: durationRef.current,
          paused: false,
        }))
      }
      lastTsRef.current = now
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  // ── REST 헬퍼 ────────────────────────────────────────────
  const transferToThisDevice = useCallback(async (play = false) => {
    const id = deviceIdRef.current
    if (!id) throw new Error("no_device")
    await fetch(`${API_BASE}/api/spotify/transfer`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: id, play }),
    })
  }, [])

  // ── 컨트롤 API ───────────────────────────────────────────
  const playUris = useCallback(async (uris: string[]) => {
    if (!uris?.length) return
    const id = deviceIdRef.current
    if (!id) throw new Error("no_device")
    await transferToThisDevice(false)
    await fetch(`${API_BASE}/api/spotify/play`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: id, uris }),
    })
    // 재생 시작 기준값 리셋
    basePosRef.current = 0
    durationRef.current = durationRef.current // 유지
    pausedRef.current = false
    lastTsRef.current = performance.now()
    setState(s => ({ ...s, position: 0, paused: false }))
  }, [transferToThisDevice])

  const pause = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/pause`, {
      method: "PUT", credentials: "include",
    })
    pausedRef.current = true
    setState(s => ({ ...s, paused: true }))
  }, [])

  const resume = useCallback(async () => {
    const id = deviceIdRef.current
    if (!id) throw new Error("no_device")
    await transferToThisDevice(false)
    await fetch(`${API_BASE}/api/spotify/play`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: id }),
    })
    pausedRef.current = false
    lastTsRef.current = performance.now()
    setState(s => ({ ...s, paused: false }))
  }, [transferToThisDevice])

  const next = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/next`, { method: "POST", credentials: "include" })
    // 다음 곡으로 넘어가면 SDK가 state_changed를 쏴서 기준값이 갱신됨
  }, [])

  const prev = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/previous`, { method: "POST", credentials: "include" })
  }, [])

  const seek = useCallback(async (ms: number) => {
    try {
      await playerRef.current?.seek?.(ms)
    } finally {
      // 사용자 시킹 → 기준값 갱신
      basePosRef.current = ms
      lastTsRef.current = performance.now()
      setState(s => ({ ...s, position: ms }))
    }
  }, [])

  return {
    ready,
    deviceId: deviceIdRef.current,
    state,             // position/duration(ms), paused
    playUris,
    pause,
    resume,
    next,
    prev,
    seek,
  }
}
