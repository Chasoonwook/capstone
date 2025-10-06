export interface Diary {
  id: number
  user_id: number
  photo_id: number | null
  music_id?: number | null

  // 서버에서 별칭으로 내려옴(SELECT_ALIAS에서 매핑)
  music_title?: string | null
  music_artist?: string | null

  subject?: string | null
  content?: string | null

  diary_at?: string | null
  created_at?: string
  updated_at?: string

  // 이전 프론트 잔재 호환
  title?: string
  emotion?: string
  photoId?: number | string
  createdAt?: string | number
  updatedAt?: string | number
}
