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
  const pollRef   = useRef<number | null>(null)

  // ── SDK 로드 & 초기화 ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    const loadSdk = () =>
      new Promise<void>((resolve) => {
        if ((window as any).Spotify) return resolve()
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
        // ✅ 절대경로로 호출 (쿠키 포함)
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
      player.addListener("not_ready", () => {
        setReady(false)
      })
      player.addListener("player_state_changed", (st: any) => {
        if (!st) return
        setState({
          deviceId: deviceIdRef.current,
          position: st.position ?? 0,
          duration: st.duration ?? 0,
          paused: st.paused ?? true,
        })
      })
      player.addListener("initialization_error", (e: any) => console.error("init_error", e))
      player.addListener("authentication_error", (e: any) => console.error("auth_error", e))
      player.addListener("account_error", (e: any) => console.error("account_error", e))
      player.addListener("playback_error", (e: any) => console.error("playback_error", e))

      await player.connect()
      // 일부 브라우저는 사용자 제스처 후 활성 필요
      try { await player.activateElement?.() } catch {}

      playerRef.current = player
    }

    init()

    return () => {
      cancelled = true
      try { playerRef.current?.disconnect?.() } catch {}
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [])

  // (옵션) 디바이스 폴링으로 백엔드와 동기화
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/spotify/devices`, { credentials: "include" })
        if (!r.ok) return
        const j = await r.json()
        const exists = (j?.devices || []).some((d: any) => d.id === deviceIdRef.current)
        if (!exists && j?.devices?.[0]) setDeviceId(j.devices[0].id)
      } catch {}
    }
    if (deviceIdRef.current) {
      poll()
      pollRef.current = window.setInterval(poll, 15000) as unknown as number
    }
    return () => { if (pollRef.current) window.clearInterval(pollRef.current) }
  }, [deviceIdRef.current])

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
    // 항상 transfer → play
    await transferToThisDevice(false)
    await fetch(`${API_BASE}/api/spotify/play`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: id, uris }),
    })
    setState(s => ({ ...s, position: 0, paused: false }))
  }, [transferToThisDevice])

  const pause = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/pause`, {
      method: "PUT", credentials: "include",
    })
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
    setState(s => ({ ...s, paused: false }))
  }, [transferToThisDevice])

  const next = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/next`, { method: "POST", credentials: "include" })
  }, [])

  const prev = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/previous`, { method: "POST", credentials: "include" })
  }, [])

  const seek = useCallback(async (ms: number) => {
    try { await playerRef.current?.seek?.(ms) }
    catch { setState(s => ({ ...s, position: ms })) }
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
