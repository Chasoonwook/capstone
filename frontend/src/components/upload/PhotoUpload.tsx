"use client"
import { useState } from "react"
import Image from "next/image"
import { Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { API_BASE } from "@/lib/api"
import { useRouter } from "next/navigation"

type Props = {
  isLoggedIn: boolean
  selectedGenres: string[]
  onRequireLogin: () => void
}

export default function PhotoUpload({ isLoggedIn, selectedGenres, onRequireLogin }: Props) {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadedPhotoId, setUploadedPhotoId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const router = useRouter()

  async function uploadPhotoToBackend(file: File): Promise<{ photoId: string } | null> {
    const form = new FormData()
    form.append("file", file)
    const uid = localStorage.getItem("uid")
    if (uid) form.append("userId", uid)

    const url = `${API_BASE}/api/photos/analyze`
    try {
      const res = await fetch(url, { method: "POST", body: form })
      if (!res.ok) {
        const txt = await res.text().catch(() => "")
        console.error("[upload] 실패:", res.status, txt)
        return null
      }
      const json = (await res.json()) as { photoId?: string | number }
      const photoId = json?.photoId != null ? String(json.photoId) : null
      if (!photoId) {
        console.error("[upload] 응답에 photoId 없음:", json)
        return null
      }
      return { photoId }
    } catch (e) {
      console.error("[upload] 요청 오류:", e)
      return null
    }
  }

  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const result = e.target?.result
      if (typeof result === "string") {
        setUploadedImage(result)
      }
    }
    reader.readAsDataURL(file)

    setSelectedFile(file)
    setUploadedPhotoId(null)
  }

  const goRecommend = async () => {
    if (!isLoggedIn) {
      alert("로그인이 필요합니다.")
      onRequireLogin()
      return
    }
    setIsSubmitting(true)
    try {
      if (selectedFile) {
        const result = await uploadPhotoToBackend(selectedFile)
        if (!result?.photoId) {
          alert("사진 업로드에 실패했습니다.")
          setIsSubmitting(false)
          return
        }
        setUploadedPhotoId(result.photoId)
        localStorage.setItem("lastPhotoId", result.photoId)
        router.push(`/recommend?photoId=${encodeURIComponent(result.photoId)}`)
        return
      }
      const genres = selectedGenres.join(",")
      if (!genres) {
        alert("사진을 업로드하거나 장르를 선택해주세요.")
        setIsSubmitting(false)
        return
      }
      router.push(`/recommend?genres=${encodeURIComponent(genres)}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="text-center mb-20">
      <h2 className="text-4xl font-light text-gray-900 mb-4">사진으로 음악을 찾아보세요</h2>
      <p className="text-gray-500 mb-12 text-lg font-light max-w-2xl mx-auto">
        사진을 업로드하면 그 순간에 어울리는 음악을 추천해드립니다
      </p>

      <div className="flex justify-center mb-8">
        <label className="cursor-pointer group">
          <input
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            className="hidden"
            disabled={isSubmitting}
          />
          <div className="border-2 border-dashed border-transparent bg-gradient-to-r from-purple-200 via-pink-200 to-blue-200 p-0.5 rounded-3xl hover:from-purple-300 hover:via-pink-300 hover:to-blue-300 transition-all duration-300">
            <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-16 hover:bg-white/90 transition-all">
              {uploadedImage ? (
                <div className="relative">
                  <Image
                    src={uploadedImage || "/placeholder.svg"}
                    alt="업로드된 사진"
                    width={240}
                    height={160}
                    className="rounded-2xl object-cover mx-auto"
                  />
                  {uploadedPhotoId && (
                    <p className="mt-3 text-sm text-gray-500">저장됨 • Photo ID: {uploadedPhotoId}</p>
                  )}
                </div>
              ) : (
                <div className="text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:bg-purple-100 transition-colors">
                    <Upload className="h-8 w-8 text-gray-400 group-hover:text-purple-500" />
                  </div>
                  <p className="text-gray-600 font-light">사진을 업로드하세요</p>
                </div>
              )}
            </div>
          </div>
        </label>
      </div>

      <Button
        onClick={goRecommend}
        size="lg"
        disabled={isSubmitting || (!uploadedImage && selectedGenres.length === 0)}
        className="bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 hover:from-purple-700 hover:via-pink-700 hover:to-blue-700 text-white px-12 py-3 rounded-full font-light disabled:opacity-50 shadow-lg hover:shadow-xl transition-all"
      >
        {isSubmitting ? "처리 중..." : "음악 추천받기"}
      </Button>
    </section>
  )
}
