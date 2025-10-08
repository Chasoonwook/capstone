"use client"

import React, { useEffect, useMemo, useState } from "react"
import { User, LogOut, LogIn, CheckCircle2, PlugZap, History, Settings, Heart } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { API_BASE, authHeaders } from "@/lib/api"
import SpotifyConnectModal from "@/components/modals/SpotifyConnectModal"

interface UserHeaderProps {
  user: any
  isLoggedIn: boolean
  onLogout: () => void
  embedded?: boolean
  isSpotifyConnected?: boolean
  onSpotifyConnect?: () => void
  /** 상위에서 내려오면 우선 사용, 없으면 내부 fetch */
  selectedGenres?: string[] | string | null
}

export default function UserHeader({
  user,
  isLoggedIn,
  onLogout,
  embedded = false,
  isSpotifyConnected = false,
  onSpotifyConnect,
  selectedGenres = [],
}: UserHeaderProps) {
  const router = useRouter()

  const Wrapper: React.ElementType = embedded ? "div" : "header"
  const wrapperCls = embedded
    ? "max-w-5xl mx-auto flex items-center justify-between px-4 py-3"
    : "sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border"

  const displayName =
    (user?.name && String(user.name).trim()) || (user?.email && String(user.email).split("@")[0]) || "Guest"

  // ── 스포티파이 모달 상태
  const [showSpotifyModal, setShowSpotifyModal] = useState(false)

  // ── 유틸: DB/prop/문자열 모두 배열로 정규화
  const normalize = (v: any): string[] => {
    try {
      if (Array.isArray(v)) return v.map(String)
      if (typeof v === "string") {
        const parsed = JSON.parse(v)
        return Array.isArray(parsed) ? parsed.map(String) : []
      }
      // pg jsonb가 이미 객체/배열로 오는 경우
      if (v && typeof v === "object" && Array.isArray((v as any).value)) {
        return (v as any).value.map(String)
      }
      if (v && typeof v === "object" && Array.isArray(v)) {
        return (v as any).map(String)
      }
    } catch {}
    return []
  }

  /** 프론트에서 식별자 강제 세팅: user.user_id → user.id → localStorage('uid') */
  const userIdFromProp = user?.user_id ?? user?.id
  const userIdFromLS = typeof window !== "undefined" ? localStorage.getItem("uid") : null
  const userId: string | undefined = (userIdFromProp ?? userIdFromLS ?? undefined)
    ? String(userIdFromProp ?? userIdFromLS)
    : undefined

  /** 로컬 캐시 키 (캐시만; 표시 값은 항상 DB가 우선) */
  const localKey = userId ? `preferred_genres::${userId}` : undefined

  /** 초기값: 임시 프롭은 보여만 주고, 곧바로 DB로 덮어쓰기 */
  const initialGenres = useMemo(() => normalize(selectedGenres), [selectedGenres])

  const [genres, setGenres] = useState<string[]>(initialGenres ?? [])
  const [menuOpen, setMenuOpen] = useState(false)
  const [loadingFromDB, setLoadingFromDB] = useState<boolean>(false)

  /** 로그인/유저 식별자 바뀌면 DB에서 선제 로딩 */
  useEffect(() => {
    if (!isLoggedIn || !userId) {
      setGenres([])
      return
    }

    const fetchFromDB = async () => {
      setLoadingFromDB(true)
      try {
        // URL + 쿼리(user_id) + 헤더(X-User-Id) 모두 전송 → 어떤 백엔드 케이스든 안전
        const url = new URL(`${API_BASE}/api/users/me`)
        url.searchParams.set("user_id", userId)

        const headers = new Headers(authHeaders?.() as HeadersInit)
        headers.set("X-User-Id", userId)

        const r = await fetch(url.toString(), {
          headers,
          // 쿠키 세션 사용하는 경우 대비 (동일/서로 다른 도메인 환경)
          credentials: "include",
          cache: "no-store",
        })

        if (!r.ok) {
          const text = await r.text().catch(() => "")
          console.warn("[UserHeader] /api/users/me not ok:", r.status, text)
          // 로컬 캐시라도 보여주자 (있을 경우)
          if (localKey) {
            try {
              const cached = localStorage.getItem(localKey)
              const fromLocal = normalize(cached)
              if (fromLocal.length) setGenres(fromLocal)
            } catch {}
          }
          return
        }

        const me = await r.json()
        const fromDb = normalize(me?.preferred_genres)
        setGenres(fromDb)

        // 캐시 저장 (표시는 DB우선)
        if (localKey) {
          try {
            localStorage.setItem(localKey, JSON.stringify(fromDb))
          } catch {}
        }
      } catch (e) {
        console.warn("[UserHeader] load preferred_genres (DB) error:", e)
        // 에러 시에도 캐시 폴백
        if (localKey) {
          try {
            const cached = localStorage.getItem(localKey)
            const fromLocal = normalize(cached)
            if (fromLocal.length) setGenres(fromLocal)
          } catch {}
        }
      } finally {
        setLoadingFromDB(false)
      }
    }

    fetchFromDB()
  }, [isLoggedIn, userId])

  // ── 모달의 "지금 연동" 이동
  const handleSpotifyConnect = () => {
    try {
      setShowSpotifyModal(false)
      if (onSpotifyConnect) onSpotifyConnect()
      else router.push("/account?connect=spotify")
    } catch {}
  }

  return (
    <Wrapper className={wrapperCls}>
      {!embedded && (
        <div className="flex items-center justify-between h-14 px-4 w-full">
          <div className="flex items-center justify-between w-full">
            <h1 className="text-lg font-bold text-foreground">MoodTune</h1>
            <RightPart />
          </div>
        </div>
      )}

      {embedded && (
        <>
          <h1 className="text-xl font-bold leading-none cursor-pointer" onClick={() => router.push("/")}>
            MoodTune
          </h1>
          <RightPart />
        </>
      )}

      <SpotifyConnectModal
        open={showSpotifyModal}
        onClose={() => setShowSpotifyModal(false)}
        onConnect={handleSpotifyConnect}
      />
    </Wrapper>
  )

  function RightPart() {
    if (!isLoggedIn) {
      return (
        <button
          onClick={() => router.push("/login")}
          className={
            embedded
              ? "flex items-center gap-2 px-4 py-1.5 rounded-full bg-white text-black hover:bg-white/90 transition-colors"
              : "flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          }
        >
          <LogIn className="w-4 h-4" />
          <span className="text-sm font-medium">로그인</span>
        </button>
      )
    }

    return (
      <div className="flex items-center gap-2">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className={`h-auto px-3 py-1.5 gap-2 rounded-full ${
                embedded ? "text-white hover:bg-white/20" : "text-primary hover:bg-primary/20"
              }`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <User className={`w-4 h-4 ${embedded ? "text-white" : "text-primary"}`} />
              <span
                className={`text-sm font-medium ${
                  embedded ? "hidden sm:inline text-white" : "hidden sm:inline text-primary"
                }`}
              >
                {displayName}
              </span>
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" sideOffset={8} className="w-80">
            <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">로그인 계정</DropdownMenuLabel>
            <div className="px-2 pb-3">
              <div className="text-sm font-semibold leading-none">{displayName}</div>
              {user?.email && <div className="text-xs text-muted-foreground mt-1.5">{user.email}</div>}
            </div>

            <DropdownMenuSeparator />

            <div className="px-2 py-3">
              <div className="flex items-center gap-2 mb-2">
                {isSpotifyConnected ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-semibold">스포티파이 연동됨</span>
                  </>
                ) : (
                  <>
                    <PlugZap className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">스포티파이 연동</span>
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                {isSpotifyConnected
                  ? "전체 재생을 바로 이용할 수 있어요."
                  : "계정을 연결하면 전체 듣기, 재생목록 연동이 가능해요."}
              </p>
              {!isSpotifyConnected && (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setMenuOpen(false)
                    setShowSpotifyModal(true)
                  }}
                >
                  스포티파이 연결하기
                </Button>
              )}
            </div>

            <DropdownMenuSeparator />

            <div className="px-2 py-3">
              <div className="flex items-center gap-2 mb-2">
                <Heart className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">관심 장르</span>
              </div>

              {loadingFromDB && <div className="text-xs text-muted-foreground">불러오는 중…</div>}

              <div className="flex flex-wrap gap-1.5">
                {!loadingFromDB && genres.length > 0 ? (
                  genres.map((g) => (
                    <Badge
                      key={g}
                      variant="secondary"
                      className="text-xs cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                      onClick={() => router.push("/onboarding/genres?edit=1")}
                    >
                      {g}
                    </Badge>
                  ))
                ) : (
                  !loadingFromDB && (
                    <button
                      onClick={() => router.push("/onboarding/genres?edit=1")}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                    >
                      장르를 선택해주세요
                    </button>
                  )
                )}
              </div>
            </div>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={() => router.push("/history")} className="cursor-pointer">
              <History className="mr-2 h-4 w-4" />
              <span>내 기록 보기</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/account")} className="cursor-pointer">
              <Settings className="mr-2 h-4 w-4" />
              <span>계정 설정</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={onLogout} className="cursor-pointer text-red-600 focus:text-red-700">
              <LogOut className="mr-2 h-4 w-4" />
              <span>로그아웃</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }
}
