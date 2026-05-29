"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Mail, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import AppLogo from "@/components/AppLogo";

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    setLoading(true);
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);

    if (authError) {
      setError(authError.message);
    } else {
      setSent(true);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-blue-50 via-white to-emerald-50">
      <div className="w-full max-w-md">

        {/* Branding */}
        <div className="text-center mb-8">
          <div className="relative inline-flex mb-5">
            <div className="absolute inset-0 bg-blue-400/25 blur-2xl rounded-full scale-[1.6]" />
            <AppLogo size="xl" className="relative shadow-xl shadow-blue-300/50" />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 mb-1">
            Travel<span className="bg-gradient-to-r from-blue-600 to-indigo-500 bg-clip-text text-transparent">ries</span>
          </h1>
          <p className="text-slate-500 text-sm">Reset your password</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-8">
          {sent ? (
            /* Success state */
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={28} className="text-emerald-600" />
              </div>
              <h2 className="text-lg font-extrabold text-slate-900 mb-2">Check your inbox</h2>
              <p className="text-sm text-slate-500 mb-1">
                We sent a password reset link to
              </p>
              <p className="text-sm font-semibold text-slate-800 mb-6">{email}</p>
              <p className="text-xs text-slate-400 mb-6">
                Didn&apos;t get it? Check your spam folder, or{" "}
                <button
                  onClick={() => setSent(false)}
                  className="text-blue-600 font-semibold hover:underline"
                >
                  try again
                </button>
                .
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors"
              >
                <ArrowLeft size={15} /> Back to sign in
              </Link>
            </div>
          ) : (
            /* Form state */
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div>
                <p className="text-sm text-slate-500 mb-5">
                  Enter the email address you used to sign up and we&apos;ll send you a link to reset your password.
                </p>
                <label htmlFor="email" className="block text-sm font-semibold text-slate-700 mb-2">
                  Email address
                </label>
                <input
                  id="email" type="email" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com" autoComplete="email" autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>

              {error && (
                <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm font-medium">
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                  {error}
                </div>
              )}

              <button
                type="submit" disabled={loading}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-bold tracking-wide transition-all ${
                  loading ? "bg-blue-300 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200 active:scale-[0.98]"
                }`}
              >
                <Mail size={16} />
                {loading ? "Sending…" : "Send reset link"}
              </button>

              <p className="text-center text-sm text-slate-500">
                Remember your password?{" "}
                <Link href="/login" className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </div>

        <p className="text-center mt-5 text-xs text-slate-400">
          Travelries · Photo Map &amp; Face Detection
        </p>
      </div>
    </main>
  );
}
