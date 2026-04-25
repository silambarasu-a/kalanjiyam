"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  BadgeCheck,
  Briefcase,
  Calendar,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  ShieldAlert,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";

type Profile = {
  id: string;
  name: string;
  email: string;
  emailVerified: string | null;
  activeWorkspaceId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  workspaces: Array<{
    id: string;
    name: string;
    role: "OWNER" | "ADMIN" | "MEMBER" | "SUPER_ADMIN";
  }>;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function ProfilePage() {
  const { data, isLoading } = useSWR<Profile>("/api/auth/profile", fetcher);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account details, password, and the workspaces you belong to.
        </p>
      </div>

      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <IdentityCard profile={data} />
          <PasswordCard />
          <WorkspacesCard profile={data} />
        </>
      )}
    </div>
  );
}

function initialsOf(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("") || "?"
  );
}

function IdentityCard({ profile }: { profile: Profile }) {
  const { update } = useSession();
  const [name, setName] = useState(profile.name);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resync local input when server profile changes (e.g. after save).
    setName(profile.name);
  }, [profile.name]);

  const trimmed = name.trim();
  const dirty = trimmed.length > 0 && trimmed !== profile.name;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Failed to update profile");
        return;
      }
      await globalMutate("/api/auth/profile");
      await update();
      toast.success("Profile updated");
    } finally {
      setSaving(false);
    }
  }

  const lastLogin = profile.lastLoginAt
    ? new Date(profile.lastLoginAt).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-4 border-b bg-muted/30 px-6 py-5">
        <Avatar size="lg" className="size-16 shrink-0">
          <AvatarFallback className="bg-primary text-primary-foreground text-lg font-semibold">
            {initialsOf(profile.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold leading-tight">
            {profile.name}
          </h2>
          <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{profile.email}</span>
          </div>
        </div>
        {profile.emailVerified ? (
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-emerald-600 sm:inline-flex dark:text-emerald-400">
            <BadgeCheck className="h-3 w-3" /> Verified
          </span>
        ) : (
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-600 sm:inline-flex dark:text-amber-400">
            <ShieldAlert className="h-3 w-3" /> Unverified
          </span>
        )}
      </div>

      <div className="space-y-5 px-6 py-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium">Display name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Your name"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Shown to other workspace members.
            </p>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium">Email</span>
            <Input value={profile.email} disabled readOnly />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Used to sign in. Cannot be changed.
            </p>
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            disabled={!dirty || saving}
            onClick={() => setName(profile.name)}
          >
            Reset
          </Button>
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-1 divide-y border-t bg-muted/20 text-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <MetaCell
          icon={<Calendar className="h-3.5 w-3.5" />}
          label="Member since"
          value={formatDate(profile.createdAt)}
        />
        <MetaCell
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Last sign-in"
          value={lastLogin}
        />
        <MetaCell
          icon={<BadgeCheck className="h-3.5 w-3.5" />}
          label="Email verified"
          value={profile.emailVerified ? formatDate(profile.emailVerified) : "—"}
        />
      </dl>
    </section>
  );
}

function MetaCell({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="px-6 py-3">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setShowCurrent(false);
    setShowNext(false);
    setError(null);
  }

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit =
    current.length > 0 && next.length >= 8 && confirm.length > 0 && next === confirm;

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to change password");
        return;
      }
      reset();
      toast.success("Password changed. We've emailed you a confirmation.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card px-6 py-6">
      <div className="mb-5 flex items-start gap-3">
        <div className="rounded-md bg-muted p-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-base font-semibold leading-tight">Change password</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Use a strong password you don&apos;t use anywhere else.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium">Current password</span>
          <PasswordField
            value={current}
            onChange={setCurrent}
            show={showCurrent}
            onToggle={() => setShowCurrent((s) => !s)}
            autoComplete="current-password"
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium">New password</span>
            <PasswordField
              value={next}
              onChange={setNext}
              show={showNext}
              onToggle={() => setShowNext((s) => !s)}
              autoComplete="new-password"
            />
            {tooShort && (
              <p className="mt-1.5 text-xs text-destructive">
                Must be at least 8 characters.
              </p>
            )}
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium">Confirm new password</span>
            <PasswordField
              value={confirm}
              onChange={setConfirm}
              show={showNext}
              onToggle={() => setShowNext((s) => !s)}
              autoComplete="new-password"
            />
            {mismatch && (
              <p className="mt-1.5 text-xs text-destructive">
                Passwords don&apos;t match.
              </p>
            )}
          </label>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={reset} disabled={saving}>
            Clear
          </Button>
          <Button onClick={save} disabled={!canSubmit || saving}>
            {saving ? "Updating…" : "Update password"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function PasswordField({
  value,
  onChange,
  show,
  onToggle,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  autoComplete: string;
}) {
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="pr-10"
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function WorkspacesCard({ profile }: { profile: Profile }) {
  return (
    <section className="rounded-xl border bg-card px-6 py-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-muted p-2">
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-base font-semibold leading-tight">Workspaces</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              You belong to {profile.workspaces.length} of 3 allowed workspaces.
            </p>
          </div>
        </div>
        <Link
          href="/workspaces"
          className="shrink-0 text-xs font-medium text-primary hover:underline"
        >
          Manage
        </Link>
      </div>

      <ul className="divide-y rounded-lg border">
        {profile.workspaces.map((w) => {
          const isActive = w.id === profile.activeWorkspaceId;
          return (
            <li
              key={w.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{w.name}</span>
                {isActive && (
                  <span className="text-[10px] uppercase tracking-widest text-primary">
                    active
                  </span>
                )}
              </div>
              <RoleChip role={w.role} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RoleChip({ role }: { role: Profile["workspaces"][number]["role"] }) {
  const cls =
    role === "OWNER"
      ? "bg-primary/10 text-primary"
      : role === "ADMIN"
        ? "bg-secondary text-secondary-foreground"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-widest ${cls}`}
    >
      {role}
    </span>
  );
}
