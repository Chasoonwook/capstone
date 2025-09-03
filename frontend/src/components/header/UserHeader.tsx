"use client"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Music, UserCircle, CreditCard, User, History as HistoryIcon, Settings, LogOut } from "lucide-react"
import type { UserInfo } from "@/types/music"

type Props = {
  user: UserInfo
  isLoggedIn: boolean
  onLogout: () => void
}

export default function UserHeader({ user, isLoggedIn, onLogout }: Props) {
  return (
    <header className="bg-gradient-to-r from-white/90 via-purple-50/90 to-pink-50/90 backdrop-blur-sm border-b border-purple-100 relative z-10">
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center">
              <Music className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-xl font-medium text-gray-900">Photo_Music</h1>
          </div>
          {isLoggedIn ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={user.avatar || "/placeholder.svg"} alt={user.name || "user"} />
                    <AvatarFallback className="bg-purple-600 text-white">
                      {(user.name?.[0] || "U").toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64" align="end" forceMount>
                <div className="flex items-center justify-start gap-2 p-2">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={user.avatar || "/placeholder.svg"} alt={user.name || "user"} />
                    <AvatarFallback className="bg-purple-600 text-white">
                      {(user.name?.[0] || "U").toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col space-y-1 leading-none">
                    <p className="font-medium">{user.name || "사용자"}</p>
                    <p className="text-xs text-muted-foreground">{user.email || ""}</p>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem><UserCircle className="mr-2 h-4 w-4" /><span>내 채널</span></DropdownMenuItem>
                <DropdownMenuItem><CreditCard className="mr-2 h-4 w-4" /><span>유료 멤버십</span></DropdownMenuItem>
                <DropdownMenuItem><User className="mr-2 h-4 w-4" /><span>개인 정보</span></DropdownMenuItem>
                <DropdownMenuItem><HistoryIcon className="mr-2 h-4 w-4" /><span>시청 기록</span></DropdownMenuItem>
                <DropdownMenuItem><Settings className="mr-2 h-4 w-4" /><span>설정</span></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>로그아웃</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-full px-6 shadow-md hover:shadow-lg transition-all">
              로그인
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
