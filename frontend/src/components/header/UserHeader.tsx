"use client"

import { User, LogOut, LogIn } from "lucide-react"
import { useRouter } from "next/navigation"

interface UserHeaderProps {
  user: any
  isLoggedIn: boolean
  onLogout: () => void
}

export default function UserHeader({ user, isLoggedIn, onLogout }: UserHeaderProps) {
  const router = useRouter()

  return (
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
      <div className="flex items-center justify-between h-14 px-4">
        <h1 className="text-lg font-bold text-foreground">MoodTune</h1>

        <div className="flex items-center gap-2">
          {isLoggedIn ? (
            <>
              <button
                onClick={() => router.push("/account")}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors"
              >
                <User className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-primary hidden sm:inline">{user?.name || "프로필"}</span>
              </button>
              <button
                onClick={onLogout}
                className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center transition-colors"
                aria-label="로그아웃"
              >
                <LogOut className="w-4 h-4 text-muted-foreground" />
              </button>
            </>
          ) : (
            <button
              onClick={() => router.push("/login")}
              className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span className="text-sm font-medium">로그인</span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
