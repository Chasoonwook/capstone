export type HistoryItem = {
  id: string | number
  title: string
  artist?: string
  image?: string | null
  playedAt?: string
  musicId?: string | number
  photoId?: string | number
  selectedFrom?: string | null
  genre?: string | null
  label?: string | null
}

export type MusicItem = {
  music_id: number | string
  title: string
  artist?: string | null
  genre?: string | null
  label?: string | null
  image_url?: string | null
  created_at?: string | null
}

export type UserInfo = {
  name?: string
  email?: string
  avatar?: string
}
