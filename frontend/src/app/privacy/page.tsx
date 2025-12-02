// src/app/privacy/page.tsx
import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Privacy Policy | Photo Emotion-Based Music Recommendation Service",
  description: "3rd Project (Photo Emotion-Based Music Recommendation Service) Privacy Policy",
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground mt-1">Last Updated: October 18, 2025</p>
        </div>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <h2>1. Information We Collect</h2>
          <ul>
            <li><strong>Required</strong>: Name, Email, Password, Gender, Phone Number</li>
            <li><strong>Optional</strong>: Profile Photo, Preferred Genres, Emotion Feedback Data</li>
            <li><strong>Automatically Collected</strong>: IP Address, Device Information, Access Logs, Usage Records</li>
          </ul>

          <h2>2. Purpose of Collecting Personal Information</h2>
          <ol>
            <li>User Registration and Identity Verification</li>
            <li>Service Provision (Photo Analysis, Music Recommendation, etc.)</li>
            <li>Personalized Music Recommendations and Data Analysis</li>
            <li>User Support and Inquiry Handling</li>
            <li>Fraud Prevention and Security Enhancement</li>
          </ol>

          <h2>3. Retention Period</h2>
          <ol>
            <li>We retain personal data until account deletion or as required by applicable laws.</li>
            <li>De-identified data for service improvement may be retained separately.</li>
          </ol>

          <h2>4. Third-Party Sharing</h2>
          <p>We do not share personal information with third parties without user consent, except in the following cases:</p>
          <ol>
            <li>When required by law or requested by investigative authorities</li>
            <li>When necessary for service provision (such as external AI servers or music APIs like Spotify or Deezer)</li>
          </ol>

          <h2>5. Outsourcing of Personal Information Processing</h2>
          <p>We may outsource certain tasks to external providers, and such details will be disclosed on the website or app.</p>

          <h2>6. User and Legal Guardian Rights</h2>
          <p>Users may request to view, modify, or delete their personal information at any time. Users under the age of 14 require guardian consent.</p>

          <h2>7. Destruction of Personal Information</h2>
          <ol>
            <li>Personal data is deleted without delay once the retention period expires.</li>
            <li>Electronic files are deleted irreversibly; paper documents are shredded or incinerated.</li>
          </ol>

          <h2>8. Protection Measures</h2>
          <ul>
            <li>Encrypted Storage (Passwords, Tokens, etc.)</li>
            <li>Access Control and Permission Management</li>
            <li>Use of Security Protocols (HTTPS)</li>
            <li>Regular Security Audits</li>
          </ul>

          <h2>9. Use of Cookies</h2>
          <p>
            We use cookies to maintain login status and improve recommendation accuracy.
            Users can manage cookie preferences through browser settings.
          </p>

          <h2>10. Personal Information Protection Officer</h2>
          <ul>
            <li>Name: Soonwook Cha</li>
            <li>Email: support@photo-mood-music.com</li>
            <li>Role: Personal Information Protection and User Inquiry Handling</li>
          </ul>
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