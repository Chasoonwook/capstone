// src/hooks/useSpotifyPlayer.ts
"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { API_BASE } from "@/lib/api"

type SpState = {
  deviceId: string | null
  position: number // 현재 재생 위치 (ms)
  duration: number // 전체 길이 (ms)
  paused: boolean
}

const SDK_SRC = "https://sdk.scdn.co/spotify-player.js"

export function useSpotifyPlayer() {
  const [ready, setReady] = useState(false)
  const [deviceId, _setDeviceId] = useState<string | null>(null)
  const deviceIdRef = useRef<string | null>(null)
  // deviceId 상태 및 ref 동기화 설정
  const setDeviceId = (id: string | null) => { deviceIdRef.current = id; _setDeviceId(id) }

  const [state, setState] = useState<SpState>({ deviceId: null, position: 0, duration: 0, paused: true })

  const playerRef = useRef<any>(null) // Spotify Player 인스턴스
  const stateTimerRef = useRef<number | null>(null) // 실제 상태 동기화 타이머
  const secTimerRef   = useRef<number | null>(null) // 1초 단위 보간 타이머

  // 상태 보간을 위한 참조 값
  const basePosRef  = useRef(0)
  const durationRef = useRef(0)
  const pausedRef   = useRef(true)
  const lastTickRef = useRef<number | null>(null) // 마지막 상태 업데이트 시간

  useEffect(() => {
    let cancelled = false // 언마운트 시 초기화 중단 플래그

    // Spotify SDK 동적 로딩 처리
    const loadSdk = () =>
      new Promise<void>((resolve) => {
        if ((window as any).Spotify) return resolve()
        ;(window as any).onSpotifyWebPlaybackSDKReady ||= () => {}
        const s = document.createElement("script")
        s.src = SDK_SRC
        s.async = true
        s.onload = () => resolve()
        document.head.appendChild(s)
      })

    // Spotify OAuth 토큰 발급 요청
    const getToken = async (): Promise<string | null> => {
      try {
        const r = await fetch(`${API_BASE}/api/spotify/token`, { credentials: "include" })
        if (!r.ok) return null
        const j = await r.json()
        return (j?.access_token as string) || null
      } catch { return null }
    }

    // 플레이어 초기화 및 연결
    const init = async () => {
      const t = await getToken()
      if (!t || cancelled) return

      await loadSdk()
      const SpotifyPlayer = (window as any).Spotify?.Player
      if (cancelled || !SpotifyPlayer) return

      const player: any = new SpotifyPlayer({
        name: "Capstone Web Player",
        volume: 0.8,
        // 토큰 만료 시 재발급 콜백
        getOAuthToken: async (cb: (token: string) => void) => {
          const nt = await getToken()
          if (nt) cb(nt)
        },
      })

      // 이벤트 리스너 설정
      player.addListener("ready", ({ device_id }: { device_id: string }) => {
        if (cancelled) return
        setDeviceId(device_id)
        setReady(true)
        setState(s => ({ ...s, deviceId: device_id }))
      })
      player.addListener("not_ready", () => setReady(false))

      // 재생 상태 변경 처리
      player.addListener("player_state_changed", (st: any) => {
        if (!st) return
        const pos = Number(st.position ?? 0)
        const dur = Number(st.duration ?? 0)
        const paused = Boolean(st.paused)

        // 상태 보간을 위한 ref 업데이트
        basePosRef.current  = pos
        durationRef.current = dur
        pausedRef.current   = paused
        lastTickRef.current = performance.now()

        setState({
          deviceId: deviceIdRef.current,
          position: pos,
          duration: dur,
          paused,
        })
      })

      // 에러 리스너 설정 (로그 영문화)
      player.addListener("initialization_error", (e: any) => console.error("Initialization Error:", e))
      player.addListener("authentication_error", (e: any) => console.error("Authentication Error:", e))
      player.addListener("account_error", (e: any) => console.error("Account Error:", e))
      player.addListener("playback_error", (e: any) => console.error("Playback Error:", e))

      await player.connect()
      // 오토플레이 제약 해제 시도
      try { await player.activateElement?.() } catch {}
      playerRef.current = player

      // 1초마다 실제 플레이어 상태 동기화 (SDK 버그 방지)
      if (stateTimerRef.current) window.clearInterval(stateTimerRef.current)
      stateTimerRef.current = window.setInterval(async () => {
        try {
          const s: any = await player.getCurrentState()
          if (s) {
            // 상태 업데이트 및 ref 동기화
            basePosRef.current  = Number(s.position ?? 0)
            durationRef.current = Number(s.duration ?? 0)
            pausedRef.current   = Boolean(s.paused)
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

    // 클린업: 연결 해제 및 타이머 제거
    return () => {
      cancelled = true
      try { playerRef.current?.disconnect?.() } catch {}
      if (stateTimerRef.current) window.clearInterval(stateTimerRef.current)
      if (secTimerRef.current) window.clearInterval(secTimerRef.current)
    }
  }, [API_BASE])

  // 1초 단위 시간 보간 (화면의 진행바 부드러운 이동)
  useEffect(() => {
    const tick = () => {
      const now = performance.now()
      const last = lastTickRef.current
      let pos = basePosRef.current
      if (!pausedRef.current && last != null) pos += now - last
      
      // 1초 단위로 반올림 처리
      const rounded = Math.min(
        durationRef.current || 0,
        Math.max(0, Math.floor(pos / 1000) * 1000)
      )
      
      // 상태 변경 시에만 업데이트
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

  // 플레이어 준비 대기 로직
  const waitReady = useCallback(async (ms = 6000) => {
    const t0 = Date.now()
    while (!(ready && deviceIdRef.current)) {
      if (Date.now() - t0 > ms) throw new Error("Spotify player not ready") // 에러 메시지 영문화
      await new Promise(r => setTimeout(r, 120))
    }
  }, [ready])

  // 현재 웹 플레이어로 디바이스 전환
  const transferToThisDevice = useCallback(async (play = false) => {
    await waitReady()
    const id = deviceIdRef.current!
    await fetch(`${API_BASE}/api/spotify/transfer`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: id, play }),
    })
  }, [waitReady])

  // URI 목록 재생 요청
  const playUris = useCallback(async (uris: string[]) => {
    if (!uris?.length) return
    await transferToThisDevice(false)
    const id = deviceIdRef.current!
    await fetch(`${API_BASE}/api/spotify/play`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: id, uris }),
    })
    // 재생 시작 시 상태 초기화 및 업데이트
    basePosRef.current = 0
    pausedRef.current = false
    lastTickRef.current = performance.now()
    setState(s => ({ ...s, position: 0, paused: false }))
  }, [transferToThisDevice])

  // 일시 정지 요청
  const pause = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/pause`, { method: "PUT", credentials: "include" })
    pausedRef.current = true
    setState(s => ({ ...s, paused: true }))
  }, [])

  // 재개 요청
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
  }, [transferToThisDevice])

  // 다음 곡 요청
  const next = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/next`, { method: "POST", credentials: "include" })
  }, [])

  // 이전 곡 요청
  const prev = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/previous`, { method: "POST", credentials: "include" })
  }, [])

  // 재생 위치 이동 요청
  const seek = useCallback(async (ms: number) => {
    try { await (playerRef.current as any)?.seek?.(ms) } finally {
      // SDK Seek 호출 성공/실패와 무관하게 상태 업데이트
      basePosRef.current = ms
      lastTickRef.current = performance.now()
      setState(s => ({ ...s, position: Math.floor(ms / 1000) * 1000 }))
    }
  }, [])

  /** SDK 볼륨 제어 (준비 전 조용히 무시) */
  const setVolume = useCallback(async (v01: number) => {
    const v = Math.min(1, Math.max(0, v01))
    try { await (playerRef.current as any)?.setVolume?.(v) } catch {}
  }, [])

  return {
    ready,
    deviceId: deviceIdRef.current,
    state,
    playUris,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
  }
}