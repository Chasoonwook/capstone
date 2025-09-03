"use client"
import { useEffect, useState } from "react"
import type { UserInfo } from "@/types/music"

export function useAuthUser() {
  const [user, setUser] = useState<UserInfo>({})
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    try {
      const token = localStorage.getItem("token")
      const name = localStorage.getItem("name") || undefined
      const email = localStorage.getItem("email") || undefined
      const avatar = (localStorage.getItem("avatar") || "/placeholder.svg?height=32&width=32") as string
      if (token && name && email) {
        setUser({ name, email, avatar })
        setIsLoggedIn(true)
      } else {
        setUser({})
        setIsLoggedIn(false)
      }
    } catch {
      setUser({})
      setIsLoggedIn(false)
    }
  }, [])

  const logout = () => {
    try {
      localStorage.removeItem("token")
      localStorage.removeItem("uid")
      localStorage.removeItem("email")
      localStorage.removeItem("name")
      localStorage.removeItem("avatar")
    } catch {}
    setUser({})
    setIsLoggedIn(false)
  }

  return { user, isLoggedIn, logout }
}
