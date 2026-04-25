"use client";

import Link from "next/link";
import { useState } from "react";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          workspaceName: workspaceName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Signup failed");
      } else {
        setSuccess(data.message ?? "Check your inbox to verify your email.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Create your account</h1>
      <p className="text-sm text-neutral-500 mb-5">
        Start tracking your household and farm finances.
      </p>

      {success ? (
        <div className="rounded border border-green-300 bg-green-50 p-4 text-sm text-green-800">
          {success}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input label="Name" value={name} onChange={setName} required />
          <Input
            label="Email"
            value={email}
            onChange={setEmail}
            type="email"
            autoComplete="email"
            required
          />
          <Input
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <Input
            label="Workspace name (optional)"
            value={workspaceName}
            onChange={setWorkspaceName}
            placeholder={`${name ? name + "'s" : "Your"} Workspace`}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create account"}
          </button>
        </form>
      )}

      <p className="mt-5 text-sm text-neutral-600">
        Already have an account?{" "}
        <Link href="/login" className="text-neutral-900 font-medium underline">
          Log in
        </Link>
      </p>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-neutral-700 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
        {...rest}
      />
    </label>
  );
}
