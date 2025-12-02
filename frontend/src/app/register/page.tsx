"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Music, Eye, EyeOff, Mail, Lock, User } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { API_BASE } from "@/lib/api"

const DRAFT_KEY = "registerDraft_v1"

export default function SignupPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    gender: "",
    phone: "",
  })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  // 초기 로드 시 임시저장 복구 처리
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const saved = JSON.parse(raw)
      setFormData((prev) => ({
        ...prev,
        name: saved?.formData?.name ?? "",
        email: saved?.formData?.email ?? "",
        gender: saved?.formData?.gender ?? "",
        phone: saved?.formData?.phone ?? "",
      }))
      setAgreeTerms(!!saved?.agreeTerms)
      setAgreePrivacy(!!saved?.agreePrivacy)
    } catch {}
  }, [])

  // 입력 변경 시 임시저장 디바운스 처리
  const saveTimer = useRef<number | null>(null)
  const persistDraft = (nextState: {
    name: string
    email: string
    gender: string
    phone: string
    agreeTerms: boolean
    agreePrivacy: boolean
  }) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            formData: {
              name: nextState.name,
              email: nextState.email,
              gender: nextState.gender,
              phone: nextState.phone,
            },
            agreeTerms: nextState.agreeTerms,
            agreePrivacy: nextState.agreePrivacy,
          }),
        )
      } catch {}
    }, 300)
  }

  // formData 및 동의 체크 변경 시 임시저장 동기화 처리
  useEffect(() => {
    persistDraft({
      name: formData.name,
      email: formData.email,
      gender: formData.gender,
      phone: formData.phone,
      agreeTerms,
      agreePrivacy,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.name, formData.email, formData.gender, formData.phone, agreeTerms, agreePrivacy])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    if (name === "phone") {
      const numbers = value.replace(/[^\d]/g, "")
      let formatted = ""
      if (numbers.length <= 3) formatted = numbers
      else if (numbers.length <= 7) formatted = `${numbers.slice(0, 3)}-${numbers.slice(3)}`
      else formatted = `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`
      setFormData((prev) => ({ ...prev, [name]: formatted }))
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }))
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()

    if (formData.password !== formData.confirmPassword) {
      alert("Passwords do not match.")
      return
    }
    if (!agreeTerms || !agreePrivacy) {
      alert("Please agree to the Terms of Service and Privacy Policy.")
      return
    }
    if (!/^010-\d{4}-\d{4}$/.test(formData.phone) || formData.phone.length !== 13) {
      alert("Enter a valid phone number (010-1234-5678).")
      return
    }

    setIsLoading(true)
    try {
      const url = `${API_BASE}/api/auth/register`
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          email: formData.email.trim(),
          password: formData.password,
          gender: formData.gender || null,
          phone: formData.phone || null,
        }),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => "")
        console.error("register failed:", res.status, text)
        alert(text || `Sign-up failed (status ${res.status}).`)
        return
      }

      const data = await res.json()
      const token: string | undefined = data?.token
      const user = data?.user
      const uid = user?.id ?? user?.user_id ?? data?.user_id ?? data?.id

      if (token) localStorage.setItem("token", token)
      if (uid) localStorage.setItem("uid", String(uid))
      if (user?.email) localStorage.setItem("email", user.email)
      if (user?.name) localStorage.setItem("name", user.name)

      // 성공 시 임시저장 삭제 처리
      localStorage.removeItem(DRAFT_KEY)

      document.cookie = `onboardingDone=0; path=/; max-age=31536000`

      alert("Sign-up completed!")
      router.replace("/onboarding/genres")
    } catch (err) {
      console.error("fetch error:", err)
      alert("An error occurred while communicating with the server.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSocialSignup = (provider: string) => {
    console.log(`${provider} sign up`)
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link
            href="/"
            className="inline-flex items-center space-x-2 text-primary hover:opacity-80 transition-opacity"
          >
            <Music className="h-8 w-8" />
            <span className="text-2xl font-bold text-balance">Music Recommendation System</span>
          </Link>
        </div>

        <div className="bg-gradient-to-br from-primary/10 via-accent/5 to-primary/10 rounded-2xl p-8 shadow-lg border border-border/50">
          <div className="space-y-2 mb-6">
            <h1 className="text-2xl font-bold text-center text-balance">Sign Up</h1>
            <p className="text-center text-muted-foreground text-pretty">
              Create a new account to get personalized music recommendations.
            </p>
          </div>

          <div className="space-y-4">
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    placeholder="Enter your name"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="gender">Gender</Label>
                <select
                  id="gender"
                  name="gender"
                  value={formData.gender}
                  onChange={(e) => setFormData((prev) => ({ ...prev, gender: e.target.value }))}
                  className="w-full px-3 py-2 border border-input bg-background rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-input"
                  required
                >
                  <option value="">Select gender</option>
                  <option value="남">Male</option>
                  <option value="여">Female</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="Enter your email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <div className="relative">
                  <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    />
                  </svg>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    placeholder="010-1234-5678"
                    value={formData.phone}
                    onChange={handleInputChange}
                    className="pl-10"
                    maxLength={13}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={handleInputChange}
                    className="pl-10 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Re-enter your password"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    className="pl-10 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="terms"
                    checked={agreeTerms}
                    onCheckedChange={(c) => setAgreeTerms(c as boolean)}
                  />
                  <Label htmlFor="terms" className="text-sm">
                    <Link
                      href="/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:opacity-80 transition-opacity"
                    >
                      Terms of Service
                    </Link>{" "}
                    I agree (required)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="privacy"
                    checked={agreePrivacy}
                    onCheckedChange={(c) => setAgreePrivacy(c as boolean)}
                  />
                  <Label htmlFor="privacy" className="text-sm">
                    <Link
                      href="/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:opacity-80 transition-opacity"
                    >
                      Privacy Policy
                    </Link>{" "}
                    I agree (required)
                  </Label>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-primary text-primary-foreground hover:opacity-90 transition-opacity rounded-lg"
                disabled={isLoading}
              >
                {isLoading ? "Signing up..." : "Sign Up"}
              </Button>

              <Button variant="outline" className="w-full mt-2" asChild>
                <Link href="/login">Back to Login</Link>
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}