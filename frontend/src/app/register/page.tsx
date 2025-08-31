"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import { Music, Eye, EyeOff, Mail, Lock, User } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { API_BASE } from "@/lib/api"

export default function SignupPage() {
  const [formData, setFormData] = useState({
    name: "", email: "", password: "", confirmPassword: "", gender: "", phone: "",
  })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    if (name === "phone") {
      const numbers = value.replace(/[^\d]/g, "")
      let formatted = ""
      if (numbers.length <= 3) formatted = numbers
      else if (numbers.length <= 7) formatted = `${numbers.slice(0,3)}-${numbers.slice(3)}`
      else formatted = `${numbers.slice(0,3)}-${numbers.slice(3,7)}-${numbers.slice(7,11)}`
      setFormData(prev => ({ ...prev, [name]: formatted }))
    } else {
      setFormData(prev => ({ ...prev, [name]: value }))
    }
  }

// ⬇️ 이 함수만 교체
const handleSignup = async (e: React.FormEvent) => {
  e.preventDefault()

  if (formData.password !== formData.confirmPassword) {
    alert("비밀번호가 일치하지 않습니다."); return
  }
  if (!agreeTerms || !agreePrivacy) {
    alert("이용약관과 개인정보처리방침에 동의해주세요."); return
  }
  if (!/^010-\d{4}-\d{4}$/.test(formData.phone) || formData.phone.length !== 13) {
    alert("올바른 전화번호를 입력하세요. (010-1234-5678)"); return
  }

  setIsLoading(true)
  try {
    // ✅ 경로 수정: /api/users/register -> /api/auth/register
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
      // 에러 본문이 text/html일 수도 있어서 text로 먼저 받음
      const text = await res.text().catch(() => "")
      console.error("register failed:", res.status, text)
      alert(text || `회원가입 실패 (status ${res.status})`)
      return
    }

    // ✅ 응답 처리: token / user 추출
    const data = await res.json()
    const token: string | undefined = data?.token
    const user = data?.user
    const uid =
      user?.id ?? user?.user_id ?? data?.user_id ?? data?.id

    if (token) localStorage.setItem("token", token)
    if (uid)   localStorage.setItem("uid", String(uid))
    if (user?.email) localStorage.setItem("email", user.email)
    if (user?.name)  localStorage.setItem("name", user.name)

    // ✅ 온보딩 플래그(선택): 백엔드가 기본 false로 내려오면 쿠키로 표시
    document.cookie = `onboardingDone=0; path=/; max-age=31536000`

    alert("회원가입이 완료되었습니다!")
    // ✅ 온보딩으로 이동
    router.replace("/onboarding/genres")
  } catch (err) {
    console.error("fetch error:", err)
    alert("서버와 통신 중 오류가 발생했습니다.")
  } finally {
    setIsLoading(false)
  }
}


  const handleSocialSignup = (provider: string) => {
    console.log(`${provider} 회원가입`)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center space-x-2 text-purple-600 hover:text-purple-700">
            <Music className="h-8 w-8" />
            <span className="text-2xl font-bold">뮤직 추천 시스템</span>
          </Link>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">회원가입</CardTitle>
            <CardDescription className="text-center">새 계정을 만들어 맞춤 음악 추천을 받아보세요</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">이름</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <Input id="name" name="name" type="text" placeholder="이름을 입력하세요"
                    value={formData.name} onChange={handleInputChange} className="pl-10" required />
                </div>
              </div>

              {/* 성별 */}
              <div className="space-y-2">
                <Label htmlFor="gender">성별</Label>
                <select id="gender" name="gender" value={formData.gender}
                        onChange={(e) => setFormData(prev => ({ ...prev, gender: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500" required>
                  <option value="">성별을 선택하세요</option>
                  <option value="남">남성</option>
                  <option value="여">여성</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">이메일</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <Input id="email" name="email" type="email" placeholder="이메일을 입력하세요"
                         value={formData.email} onChange={handleInputChange} className="pl-10" required />
                </div>
              </div>

              {/* 전화번호 */}
              <div className="space-y-2">
                <Label htmlFor="phone">전화번호</Label>
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  <Input id="phone" name="phone" type="tel" placeholder="010-1234-5678"
                         value={formData.phone} onChange={handleInputChange} className="pl-10" maxLength={13} required />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">비밀번호</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <Input id="password" name="password" type={showPassword ? "text" : "password"}
                         placeholder="비밀번호를 입력하세요" value={formData.password}
                         onChange={handleInputChange} className="pl-10 pr-10" required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">비밀번호 확인</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <Input id="confirmPassword" name="confirmPassword" type={showConfirmPassword ? "text" : "password"}
                         placeholder="비밀번호를 다시 입력하세요" value={formData.confirmPassword}
                         onChange={handleInputChange} className="pl-10 pr-10" required />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox id="terms" checked={agreeTerms} onCheckedChange={(c) => setAgreeTerms(c as boolean)} />
                  <Label htmlFor="terms" className="text-sm">
                    <Link href="/terms" className="text-purple-600 hover:text-purple-700">이용약관</Link> 에 동의합니다 (필수)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="privacy" checked={agreePrivacy} onCheckedChange={(c) => setAgreePrivacy(c as boolean)} />
                  <Label htmlFor="privacy" className="text-sm">
                    <Link href="/privacy" className="text-purple-600 hover:text-purple-700">개인정보처리방침</Link> 에 동의합니다 (필수)
                  </Label>
                </div>
              </div>

              <Button type="submit" className="w-full bg-purple-600 hover:bg-purple-700" disabled={isLoading}>
                {isLoading ? "가입 중..." : "회원가입"}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center"><Separator className="w-full" /></div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-500">또는</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Button variant="outline" onClick={() => handleSocialSignup("Google")} className="w-full">Google</Button>
              <Button variant="outline" onClick={() => handleSocialSignup("Kakao")} className="w-full bg-yellow-400 hover:bg-yellow-500 text-black border-yellow-400">카카오</Button>
            </div>

            <div className="text-center text-sm">
              <span className="text-gray-600">이미 계정이 있으신가요? </span>
              <Link href="/login" className="text-purple-600 hover:text-purple-700 font-medium">로그인</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}