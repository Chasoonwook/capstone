"use client"

import { User, LogOut, LogIn } from "lucide-react"
import { useRouter } from "next/navigation"

interface UserHeaderProps {
  user: any
  isLoggedIn: boolean
  onLogout: () => void
  /** 상위 헤더 안에서 함께 쓰는 모드: wrapper header/border 제거 */
  embedded?: boolean
}

export default function UserHeader({ user, isLoggedIn, onLogout, embedded = false }: UserHeaderProps) {
  const router = useRouter()

  // embedded 모드에서는 상위에서 색상을 주입(검정 배경 위 글자 흰색)
  const nameCls = embedded ? "text-white/90" : "text-foreground"
  const logoutBtnCls = embedded
    ? "text-white/70 hover:text-white transition"
    : "w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center transition-colors"

  const Wrapper: React.ElementType = embedded ? "div" : "header"
  const wrapperCls = embedded
    ? "max-w-5xl mx-auto flex items-center justify-between px-4 py-3"
    : "sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border"

  return (
    <Wrapper className={wrapperCls}>
      {!embedded && (
        <div className="flex items-center justify-between h-14 px-4 w-full">
          {/* 아래 div 내용과 동일 */}
          <div className="flex items-center justify-between w-full">
            <h1 className="text-lg font-bold text-foreground">MoodTune</h1>
            <RightPart />
          </div>
        </div>
      )}

      {embedded && (
        <>
          <h1
            className="text-xl font-bold leading-none cursor-pointer"
            onClick={() => router.push("/")}
          >
            MoodTune
          </h1>
          <RightPart />
        </>
      )}
    </Wrapper>
  )

  function RightPart() {
    return (
      <div className="flex items-center gap-2">
        {isLoggedIn ? (
          <>
            <button
              onClick={() => router.push("/account")}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${embedded ? "bg-white/10 hover:bg-white/20" : "bg-primary/10 hover:bg-primary/20"} transition-colors`}
            >
              <User className={`w-4 h-4 ${embedded ? "text-white" : "text-primary"}`} />
              <span className={`text-sm font-medium ${embedded ? "text-white hidden sm:inline" : "text-primary hidden sm:inline"}`}>
                {user?.name || "프로필"}
              </span>
            </button>
            <button
              onClick={onLogout}
              className={logoutBtnCls}
              aria-label="로그아웃"
            >
              <LogOut className={`w-4 h-4 ${embedded ? "text-white/80" : "text-muted-foreground"}`} />
            </button>
          </>
        ) : (
          <button
            onClick={() => router.push("/login")}
            className={embedded
              ? "flex items-center gap-2 px-4 py-1.5 rounded-full bg-white text-black hover:bg-white/90 transition-colors"
              : "flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"}
          >
            <LogIn className="w-4 h-4" />
            <span className="text-sm font-medium">로그인</span>
          </button>
        )}
      </div>
    )
  }
}
