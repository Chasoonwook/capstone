// src/hooks/useSpotifyPlayer.ts
"use client"
import { useEffect, useRef, useState, useCallback } from "react"
import { API_BASE } from "@/lib/api"

type SpState = {
  deviceId: string | null
  position: number
  duration: number
  paused: boolean
}

export function useSpotifyPlayer() {
  const [ready, setReady] = useState(false)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [state, setState] = useState<SpState>({ deviceId: null, position: 0, duration: 0, paused: true })
  const tick = useRef<number | null>(null)

  // SDK 준비 + 디바이스 아이디 주기적으로 확인
  useEffect(() => {
    let alive = true

    const pollDevice = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/spotify/devices`, { credentials: "include" })
        if (!r.ok) throw new Error(String(r.status))
        const j = await r.json()
        const active = (j?.devices || []).find((d: any) => d.is_active) || j?.devices?.[0] || null
        if (!alive) return
        setDeviceId(active?.id ?? null)
        setReady(!!active?.id)
      } catch {
        if (!alive) return
        setReady(false)
        setDeviceId(null)
      }
    }

    pollDevice()
    const id = window.setInterval(pollDevice, 5000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  // position 업데이트 (간단 폴링)
  useEffect(() => {
    if (tick.current) window.clearInterval(tick.current)
    tick.current = window.setInterval(() => {
      setState((s) => s.paused ? s : { ...s, position: Math.min(s.position + 1000, s.duration) })
    }, 1000) as unknown as number
    return () => { if (tick.current) window.clearInterval(tick.current) }
  }, [])

  const syncFromPlayer = useCallback((posMs: number, durMs: number, paused: boolean) => {
    setState((s) => ({ ...s, position: posMs, duration: durMs, paused }))
  }, [])

  const transfer = useCallback(async (play = false) => {
    if (!deviceId) return
    await fetch(`${API_BASE}/api/spotify/transfer`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId, play }),
    })
  }, [deviceId])

  const playUris = useCallback(async (uris: string[]) => {
    if (!uris?.length) return
    // 장치 전송 보장
    await transfer(true)
    await fetch(`${API_BASE}/api/spotify/play`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris, device_id: deviceId }),
    })
    syncFromPlayer(0, state.duration || 0, false)
  }, [deviceId, transfer, state.duration, syncFromPlayer])

  const pause = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/pause`, { method: "PUT", credentials: "include" })
    syncFromPlayer(state.position, state.duration, true)
  }, [state.position, state.duration, syncFromPlayer])

  const resume = useCallback(async () => {
    // resume은 서버에서 현재 큐 기준으로 play
    await fetch(`${API_BASE}/api/spotify/play`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId }),
    })
    syncFromPlayer(state.position, state.duration, false)
  }, [deviceId, state.position, state.duration, syncFromPlayer])

  const next = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/next`, { method: "POST", credentials: "include" })
    syncFromPlayer(0, state.duration, false)
  }, [state.duration, syncFromPlayer])

  const prev = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/previous`, { method: "POST", credentials: "include" })
    syncFromPlayer(0, state.duration, false)
  }, [state.duration, syncFromPlayer])

  const seek = useCallback(async (ms: number) => {
    // Spotify의 seek는 /me/player/seek?position_ms= 이지만
    // 서버 프록시(spotify.js)에서 지원하지 않는다면 생략 또는 구현 필요
    // 여기서는 클라이언트 측 위치값만 맞춰줍니다.
    syncFromPlayer(ms, state.duration, state.paused)
  }, [state.duration, state.paused, syncFromPlayer])

  return {
    ready, deviceId, state,
    playUris, pause, resume, next, prev, seek,
  }
}
