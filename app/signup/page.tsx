"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, AlertCircle, UserPlus, CheckCircle2, Mail, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import AppLogo from "@/components/AppLogo";

export default function SignUpPage() {
  const router = useRouter();

  const [name,            setName]            = useState("");
  const [email,           setEmail]           = useState("");
  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword,    setShowPassword]    = useState(false);
  const [showConfirm,     setShowConfirm]     = useState(false);
  const [error,           setError]           = useState("");
  const [loading,         setLoading]         = useState(false);
  const [state,           setState]           = useState<"form" | "otp" | "success">("form");

  // OTP 입력 (6자리)
  const [otp,        setOtp]        = useState(["", "", "", "", "", ""]);
  const [resending,  setResending]  = useState(false);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  function validate(): string {
    if (!name.trim())                               return "Please enter your full name.";
    if (!email.trim())                              return "Please enter your email address.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please enter a valid email address.";
    if (password.length < 6)                        return "Password must be at least 6 characters.";
    if (password !== confirmPassword)               return "Passwords do not match.";
    return "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { name: name.trim() } },
    });
    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    if (data.user && data.session) {
      // 이메일 확인이 꺼진 경우 — 바로 로그인
      await supabase.from("profiles").upsert(
        { id: data.user.id, name: name.trim() },
        { onConflict: "id" }
      );
      setState("success");
      setTimeout(() => router.push("/"), 1200);
    } else {
      // 이메일 확인이 켜진 경우 — OTP 입력 화면으로
      setState("otp");
    }
  }

  function handleOtpChange(index: number, value: string) {
    if (!/^\d*$/.test(value)) return; // 숫자만 허용
    const next = [...otp];
    next[index] = value.slice(-1); // 마지막 한 글자만
    setOtp(next);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      setOtp(pasted.split(""));
      otpRefs.current[5]?.focus();
    }
    e.preventDefault();
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = otp.join("");
    if (code.length !== 6) { setError("Please enter all 6 digits of the code."); return; }

    setError("");
    setLoading(true);
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: "signup",
    });
    setLoading(false);

    if (verifyError) {
      setError("Invalid or expired code. Please check your email and try again.");
      return;
    }

    if (data.user) {
      await supabase.from("profiles").upsert(
        { id: data.user.id, name: name.trim() },
        { onConflict: "id" }
      );
    }
    setState("success");
    setTimeout(() => router.push("/"), 1200);
  }

  async function handleResend() {
    setResending(true);
    setError("");
    await supabase.auth.resend({ type: "signup", email: email.trim() });
    setResending(false);
    setOtp(["", "", "", "", "", ""]);
    otpRefs.current[0]?.focus();
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
          <p className="text-slate-500 text-sm">
            {state === "otp" ? "Email verification" : "Create your account"}
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-8">

          {state === "success" ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center">
                <CheckCircle2 size={28} className="text-emerald-600" />
              </div>
              <p className="text-lg font-bold text-slate-800">Account created!</p>
              <p className="text-sm text-slate-500">Taking you to the app…</p>
            </div>

          ) : state === "otp" ? (
            <form onSubmit={handleOtpSubmit} className="space-y-6">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center">
                  <Mail size={28} className="text-blue-600" />
                </div>
                <p className="text-lg font-bold text-slate-800">Enter verification code</p>
                <p className="text-sm text-slate-500">
                  We sent a 6-digit code to <strong>{email}</strong>.<br />
                  Check your inbox and enter the code below.
                </p>
              </div>

              {/* OTP 6자리 입력 */}
              <div className="flex justify-center gap-2" onPaste={handleOtpPaste}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="w-12 h-14 text-center text-xl font-bold rounded-xl border-2 border-slate-200 bg-slate-50 text-slate-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                ))}
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
                {loading ? "Verifying…" : "Verify"}
              </button>

              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                className="w-full flex items-center justify-center gap-2 py-2 text-sm text-slate-500 hover:text-blue-600 transition-colors"
              >
                <RefreshCw size={14} className={resending ? "animate-spin" : ""} />
                {resending ? "Resending…" : "Resend code"}
              </button>
            </form>

          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-5">

              <div>
                <label htmlFor="name" className="block text-sm font-semibold text-slate-700 mb-2">
                  Full Name
                </label>
                <input
                  id="name" type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith" autoComplete="name"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-slate-700 mb-2">
                  Email
                </label>
                <input
                  id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com" autoComplete="email"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-slate-700 mb-2">
                  Password <span className="text-slate-400 font-normal">(min. 6 characters)</span>
                </label>
                <div className="relative">
                  <input
                    id="password" type={showPassword ? "text" : "password"} value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••" autoComplete="new-password"
                    className="w-full px-4 py-3 pr-12 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                  <button type="button" onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                    aria-label={showPassword ? "Hide password" : "Show password"}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="confirm" className="block text-sm font-semibold text-slate-700 mb-2">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    id="confirm" type={showConfirm ? "text" : "password"} value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••••••" autoComplete="new-password"
                    className="w-full px-4 py-3 pr-12 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                  <button type="button" onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                    aria-label={showConfirm ? "Hide password" : "Show password"}>
                    {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
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
                <UserPlus size={16} />
                {loading ? "Creating account…" : "Create account"}
              </button>

              <p className="text-center text-sm text-slate-500">
                Already have an account?{" "}
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
