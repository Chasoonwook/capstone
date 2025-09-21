// src/app/account/spotify/page.tsx
"use client"; // 클라이언트 컴포넌트가 필요하다면 추가

import React from "react";

export default function SpotifyAccountPage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Spotify 계정 연동</h1>
      <p>여기에서 Spotify 계정을 연결하거나 해제할 수 있습니다.</p>

      {/* TODO: 실제 연동 버튼이나 상태 표시 UI를 여기에 추가 */}
    </main>
  );
}
