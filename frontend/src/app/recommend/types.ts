// src/app/recommend/types.ts

/** 추천 출처(메인/선호/서브) */
export type SelectedFrom = "main" | "preferred" | "sub";

/** 프론트에서 사용하는 노래 카드 모델 */
export type Song = {
  id: number | string;
  title: string;
  artist: string;
  genre?: string;
  duration?: string;              // "mm:ss"
  image?: string | null;
  spotify_uri?: string | null;    // 있으면 Spotify SDK로 전체 재생
  preview_url?: string | null;    // 미리듣기 mp3
  selected_from?: SelectedFrom | null; // 추천이 어디에서 왔는지 표시
};

/** 백엔드/외부 API에서 내려오는 원천 모델(유연하게 수용) */
export type BackendSong = {
  music_id?: number | string;
  id?: number | string;
  title?: string;
  artist?: string;
  label?: string;
  genre?: string;
  duration?: number;              // sec
  duration_sec?: number;          // sec
  duration_ms?: number;           // ms (혹시 모를 케이스 대비)
  spotify_uri?: string | null;
  preview_url?: string | null;
};

/** 사진 기반 추천 응답 */
export type ByPhotoResponse = {
  main_mood?: string | null;
  sub_mood?: string | null;
  main_songs?: BackendSong[];
  sub_songs?: BackendSong[];
  preferred_songs?: BackendSong[];
  preferred_genres?: string[];
};

/** /api/history POST 요청 바디 */
export type HistoryCreateRequest = {
  user_id: number;
  photo_id: number;
  music_id: number;
  /** 백엔드 스키마상 저장 가능한 값만 전송 (main | sub), 없으면 null */
  selected_from?: Extract<SelectedFrom, "main" | "sub"> | null;
};

/** /api/history POST 응답(업서트 결과) 및 GET 리스트 아이템 */
export type HistoryItem = {
  history_id: number;
  user_id: number;
  photo_id: number;
  music_id: number;
  title: string;                  // title_snapshot
  artist: string;                 // artist_snapshot
  genre: string | null;           // genre_snapshot
  label: string | null;           // label_snapshot
  selected_from: Extract<SelectedFrom, "main" | "sub"> | null;
  created_at: string;             // ISO datetime
};
