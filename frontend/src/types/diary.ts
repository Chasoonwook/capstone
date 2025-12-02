// src/types/diary.ts
export interface Diary {
  id: number
  user_id: number
  photo_id: number | null
  music_id?: number | null

  // 서버 필드 별칭 매핑
  music_title?: string | null
  music_artist?: string | null

  subject?: string | null
  content?: string | null

  diary_at?: string | null
  created_at?: string
  updated_at?: string

  // 이전 프론트엔드 호환성 필드
  title?: string
  emotion?: string
  photoId?: number | string
  createdAt?: string | number
  updatedAt?: string | number
}