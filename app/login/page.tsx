"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, AlertCircle, LogIn } from "lucide-react";
import { supabase } from "@/lib/supabase";
import AppLogo from "@/components/AppLogo";

export default function LoginPage() {
  const router = useRouter();
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [error,        setError]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }

    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError) {
      setError("Incorrect email or password.");
      setLoading(false);
    } else {
      router.push("/");
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
          <p className="text-slate-500 text-sm">Sign in to your account</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-8">
          <form onSubmit={handleSubmit} noValidate className="space-y-5">

            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-slate-700 mb-2">
                Email
              </label>
              <input
                id="email" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" autoComplete="email"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="password" className="text-sm font-semibold text-slate-700">
                  Password
                </label>
                <Link href="/forgot-password" className="text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password" type={showPassword ? "text" : "password"} value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••" autoComplete="current-password"
                  className="w-full px-4 py-3 pr-12 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <div className="flex items-start gap-3 text-red-700 text-sm font-medium">
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                  {error}
                </div>
                <div className="mt-2 pl-7 text-sm text-slate-500">
                  Forgot your password?{" "}
                  <Link href="/forgot-password" className="font-semibold text-blue-600 hover:text-blue-700 underline transition-colors">
                    Reset it here
                  </Link>
                </div>
              </div>
            )}

            <button
              type="submit" disabled={loading}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-bold tracking-wide transition-all ${
                loading ? "bg-blue-300 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200 active:scale-[0.98]"
              }`}
            >
              <LogIn size={16} />
              {loading ? "Signing in…" : "Sign in"}
            </button>

            <p className="text-center text-sm text-slate-500">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                Create account
              </Link>
            </p>
          </form>
        </div>

        <p className="text-center mt-5 text-xs text-slate-400">
          Travelries · Photo Map &amp; Face Detection
        </p>
      </div>
    </main>
  );
}
