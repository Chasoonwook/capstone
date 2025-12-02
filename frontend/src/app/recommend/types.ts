// src/app/recommend/types.ts

// 추천 출처 타입 정의
export type SelectedFrom = "main" | "preferred" | "sub" | "search" | "recommend" | "diary";

// 프론트엔드 노래 카드 모델 정의
export type Song = {
  id: number | string;
  title: string;
  artist: string;
  genre?: string;
  duration?: string;
  image?: string | null;
  spotify_uri?: string | null;
  preview_url?: string | null;
  selected_from?: SelectedFrom | null;
};

// 백엔드 및 외부 API 원본 모델 정의
export type BackendSong = {
  music_id?: number | string;
  id?: number | string;
  title?: string;
  artist?: string;
  label?: string;
  genre?: string;
  duration?: number;
  duration_sec?: number;
  duration_ms?: number;
  spotify_uri?: string | null;
  preview_url?: string | null;
};

// 사진 기반 추천 응답 데이터 정의
export type ByPhotoResponse = {
  main_mood?: string | null;
  sub_mood?: string | null;
  main_songs?: BackendSong[];
  sub_songs?: BackendSong[];
  preferred_songs?: BackendSong[];
  preferred_genres?: string[];
};

// 히스토리 생성 요청 바디 정의
export type HistoryCreateRequest = {
  user_id: number;
  photo_id: number;
  music_id: number;
  selected_from?: Extract<SelectedFrom, "main" | "sub"> | null;
};

// 히스토리 항목 응답 모델 정의
export type HistoryItem = {
  history_id: number;
  user_id: number;
  photo_id: number;
  music_id: number;
  title: string;
  artist: string;
  genre: string | null;
  label: string | null;
  selected_from: Extract<SelectedFrom, "main" | "sub"> | null;
  created_at: string;
};