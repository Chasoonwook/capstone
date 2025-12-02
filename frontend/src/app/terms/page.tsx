// src/app/terms/page.tsx
import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Terms of Service | Photo Emotion-Based Music Recommendation Service",
  description: "Terms of Service for the 3rd project (Photo Emotion-Based Music Recommendation Service)",
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Terms of Service</h1>
          <p className="text-sm text-muted-foreground mt-1">Last Updated: October 18, 2025</p>
        </div>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <h2>Article 1 (Purpose)</h2>
          <p>
            These Terms govern the conditions, procedures, rights, obligations, and responsibilities between users and the operator of the "Photo Emotion-Based Music Recommendation Service" (hereinafter "Service").
          </p>

          <h2>Article 2 (Definitions)</h2>
          <ol>
            <li>“Service” refers to the platform where users upload photos and the AI performs emotional analysis to recommend appropriate music.</li>
            <li>“User” refers to all members and non-members who use the Service.</li>
            <li>“Operator” refers to the individual or entity managing and running the Service.</li>
            <li>“Member” refers to a person who has registered and received an ID and password.</li>
            <li>“Content” includes all data created, stored, or transmitted within the Service, such as photos, text, music data, and AI analysis results.</li>
          </ol>

          <h2>Article 3 (Effect and Amendment of Terms)</h2>
          <ol>
            <li>These Terms take effect upon being posted on the Service page.</li>
            <li>The Operator may amend the Terms within applicable legal boundaries.</li>
            <li>Amended Terms become effective upon announcement, and users who disagree may terminate their membership.</li>
          </ol>

          <h2>Article 4 (Establishment of Service Agreement)</h2>
          <ol>
            <li>The Service Agreement becomes effective when a user agrees to these Terms and completes registration.</li>
            <li>The Operator may restrict registration based on technical or policy needs.</li>
          </ol>

          <h2>Article 5 (User Obligations)</h2>
          <ol>
            <li>No identity theft or false information</li>
            <li>No unauthorized copying or leaking of AI analysis results</li>
            <li>No infringement of copyrights, portrait rights, or other legal rights</li>
            <li>No interference with the Service or actions causing server overload</li>
            <li>No violation of applicable laws</li>
          </ol>

          <h2>Article 6 (Operator Obligations)</h2>
          <ol>
            <li>The Operator shall comply with relevant laws and ensure stable Service usage.</li>
            <li>The Operator shall protect personal data according to a separate Privacy Policy.</li>
          </ol>

          <h2>Article 7 (Service Provision and Changes)</h2>
          <ol>
            <li>The Service is provided 24/7, except during unavoidable maintenance or system issues.</li>
            <li>The Operator may modify the content, features, or UI without prior notice.</li>
          </ol>

          <h2>Article 8 (Service Suspension and Termination)</h2>
          <ol>
            <li>The Service may be suspended due to unavoidable circumstances such as natural disasters or server failures.</li>
            <li>The Operator may partially or fully suspend the Service, generally with prior notice.</li>
          </ol>

          <h2>Article 9 (Copyright and Content Management)</h2>
          <ol>
            <li>Copyrights for photos and content uploaded by users remain with the user.</li>
            <li>Users are deemed to consent to the use of anonymized data for AI improvement.</li>
            <li>The Operator may delete abnormal or illegal content without prior warning.</li>
          </ol>

          <h2>Article 10 (Disclaimer)</h2>
          <ol>
            <li>The Operator does not guarantee the accuracy, reliability, or suitability of results obtained through the Service.</li>
            <li>AI emotional analysis and music recommendations are for reference only.</li>
            <li>The Operator is not responsible for damages caused by user negligence.</li>
          </ol>

          <h2>Article 11 (Governing Law and Dispute Resolution)</h2>
          <ol>
            <li>These Terms shall be interpreted according to the laws of the Republic of Korea.</li>
            <li>Disputes related to these Terms shall be resolved at the court with jurisdiction over the Operator’s location.</li>
          </ol>
        </div>

        <div className="mt-10">
          <Link href="/register" className="text-primary hover:opacity-80">
            ← Back to Sign Up
          </Link>
        </div>
      </div>
    </main>
  )
}