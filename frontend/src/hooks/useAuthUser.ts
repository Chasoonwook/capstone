"use client"
import { useEffect, useState } from "react"
import type { UserInfo } from "@/types/music" // UserInfo 타입 임포트

export function useAuthUser() {
  const [user, setUser] = useState<UserInfo>({}) // 사용자 정보 상태
  const [isLoggedIn, setIsLoggedIn] = useState(false) // 로그인 상태

  useEffect(() => {
    try {
      // 로컬 스토리지에서 사용자 정보 로드 및 상태 설정
      const token = localStorage.getItem("token")
      const name = localStorage.getItem("name") || undefined
      const email = localStorage.getItem("email") || undefined

      // 아바타 URL 설정 (기본값 포함)
      const avatar = (localStorage.getItem("avatar") || "/placeholder.svg?height=32&width=32") as string

      // 토큰, 이름, 이메일이 모두 있을 경우 로그인 처리
      if (token && name && email) {
        setUser({ name, email, avatar })
        setIsLoggedIn(true)
      } else {
        setUser({})
        setIsLoggedIn(false)
      }
    } catch {
      // 에러 발생 시 로그아웃 상태로 초기화
      setUser({})
      setIsLoggedIn(false)
    }
  }, [])

  // 로그아웃 처리
  const logout = () => {
    try {
      // 로컬 스토리지의 인증 정보 삭제
      localStorage.removeItem("token")
      localStorage.removeItem("uid")
      localStorage.removeItem("email")
      localStorage.removeItem("name")
      localStorage.removeItem("avatar")
    } catch { }
    // 상태 초기화
    setUser({})
    setIsLoggedIn(false)
  }

  return { user, isLoggedIn, logout } // 사용자 정보, 로그인 상태, 로그아웃 함수 반환
}