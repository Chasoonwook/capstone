// src/app/login/page.tsx
"use client"

import type React from "react"
import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Music, Eye, EyeOff, Mail, Lock } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { API_BASE, authHeaders } from "@/lib/api"

type LoginForm = { email: string; password: string }

type LoginUser = {
  id?: number | string
  user_id?: number | string // 백엔드에 따라 존재할 수 있음
  email: string
  name: string
}

type LoginResponse = {
  token: string
  user: LoginUser
  onboarding_done?: boolean
  genre_setup_complete?: boolean
  [key: string]: unknown
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

const hasErrorMessage = (v: unknown): v is { error: string } => isRecord(v) && typeof v.error === "string"

/** 다양한 모양의 id에서 "정수(>=1)"만 추출 */
function pickNumericId(u?: LoginUser | null): number | null {
  const toNum = (v: unknown) => {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : Number.NaN
    return Number.isFinite(n) && n >= 1 ? n : null
  }
  if (!u) return null
  return toNum(u.user_id) ?? toNum(u.id)
}

export default function LoginPage() {
  const [formData, setFormData] = useState<LoginForm>({ email: "", password: "" })
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      // 1) 로그인 호출
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email.trim(),
          password: formData.password,
        }),
      })

      if (!res.ok) {
        let msg = "Invalid email or password."
        try {
          const j: unknown = await res.json()
          if (hasErrorMessage(j)) msg = j.error
        } catch {}
        throw new Error(msg)
      }

      const data = (await res.json()) as LoginResponse
      if (!data?.token || !data?.user) {
        throw new Error("Invalid login response format.")
      }

      const { token, user } = data

      // 2) 숫자형 user_id 확정 및 필수 저장
      const numericUid = pickNumericId(user)
      if (numericUid == null) {
        throw new Error("User ID is missing in login response.")
      }

      // 필수 세션 저장 (일기 작성 페이지에서 사용)
      localStorage.setItem("token", token)
      localStorage.setItem("account_id", String(numericUid)) // 핵심: 숫자 ID 저장
      localStorage.setItem("uid", String(numericUid)) // (기존 호환)
      localStorage.setItem("email", user.email)
      localStorage.setItem("name", user.name)
      try {
        // 참고용 사용자 전체 객체도 저장(필요 시)
        localStorage.setItem("auth_user", JSON.stringify({ ...user, user_id: numericUid }))
      } catch {}

      // 3) 서버에서 최신 사용자 상태(장르 세팅 여부 등) 재조회 (있을 때만)
      let genreDone = false
      try {
        const meRes = await fetch(`${API_BASE}/api/users/me`, {
          headers: { "X-User-Id": String(numericUid), ...(authHeaders?.() as HeadersInit) },
          cache: "no-store",
          credentials: "include",
        })
        if (meRes.ok) {
          const me = await meRes.json()
          genreDone = Boolean(me?.genre_setup_complete)
        }
      } catch {
        // 무시하고 아래 폴백 사용
      }

      // 4) 폴백 플래그 사용
      if (!genreDone) {
        genreDone = Boolean(data.genre_setup_complete ?? data.onboarding_done)
      }

      // 5) (선택) 쿠키로도 기록
      document.cookie = `onboardingDone=${genreDone ? "1" : "0"}; path=/; max-age=31536000`

      // 6) 라우팅
      router.replace(genreDone ? "/" : "/onboarding/genres")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "An error occurred while signing in."
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-foreground hover:opacity-80 transition-opacity">
            <Music className="h-8 w-8" />
            <span className="text-2xl font-bold text-balance">Music Recommendation System</span>
          </Link>
        </div>

        <div className="bg-gradient-to-br from-primary/10 via-accent/5 to-primary/10 rounded-2xl p-6 shadow-sm">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-foreground mb-2 text-balance">Log In</h1>
            <p className="text-sm text-muted-foreground text-pretty">Sign in with your account to get music recommendations.</p>
          </div>

          <div className="space-y-4">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="Enter your email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="pl-10 bg-background"
                    required
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={handleInputChange}
                    className="pl-10 pr-10 bg-background"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-primary text-primary-foreground rounded-lg py-3 px-4 font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Signing in…" : "Log In"}
              </button>
            </form>

            <div className="text-center text-sm">
              <span className="text-muted-foreground">Don't have an account? </span>
              <Link href="/register" className="text-foreground font-medium hover:opacity-80 transition-opacity">
                Sign Up
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
