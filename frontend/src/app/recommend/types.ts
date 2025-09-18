export type Song = {
  id: number | string;
  title: string;
  artist: string;
  genre: string;
  duration?: string;
  image?: string | null;
  spotify_uri?: string | null;   // 있으면 SDK로 전체 재생
  preview_url?: string | null;   // 미리듣기 mp3
};

export type BackendSong = {
  music_id?: number | string;
  id?: number | string;
  title?: string;
  artist?: string;
  label?: string;
  genre?: string;
  duration?: number;
  duration_sec?: number;
  spotify_uri?: string | null;
  preview_url?: string | null;
};

export type ByPhotoResponse = {
  main_mood?: string | null;
  sub_mood?: string | null;
  main_songs?: BackendSong[];
  sub_songs?: BackendSong[];
  preferred_songs?: BackendSong[];
  preferred_genres?: string[];
};
