import { Suspense } from "react"
import EditorClient from "./EditorClient"

export default function EditorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-muted-foreground">Loading…</div>
        </div>
      }
    >
      <EditorClient />
    </Suspense>
  )
}