// src/app/editor/page.tsx
import { Suspense } from "react";
import EditorClient from "./EditorClient";

export default function EditorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black text-white p-6">Loading…</div>}>
      <EditorClient />
    </Suspense>
  );
}
