import { ReactNode } from "react";

// Shared shell for the auth pages (login/signup/forgot-password/reset-password):
// the existing soft gradient wash plus two slow-drifting blurred blobs for a
// bit of life behind the static card, without any JS animation cost.
export default function AuthBackdrop({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-blue-50 via-white to-emerald-50 overflow-hidden">
      <div className="auth-blob w-72 h-72 bg-blue-300/30 -top-10 -left-10" />
      <div className="auth-blob w-80 h-80 bg-emerald-300/25 -bottom-16 -right-10" style={{ animationDelay: "-8s" }} />
      <div className="relative w-full max-w-md">{children}</div>
    </main>
  );
}
