/**
 * Centralised timing / lock / TTL configuration.
 *
 * Every duration constant the app uses is defined here, with an env-var
 * override and a sensible default. Set values in `.env` (see
 * `.env.example`) and restart to apply.
 *
 * Naming convention:
 *   • Server-only values use plain env names (read at runtime; updates
 *     pick up after a server restart).
 *   • Values that need to reach the browser bundle use the `NEXT_PUBLIC_`
 *     prefix (inlined at build time; require a rebuild to change).
 *
 * Edit-window precedence:
 *   • Per-workspace overrides (e.g. `Workspace.transactionEditWindowDays`)
 *     win when set.
 *   • Fall back to the env-driven default below.
 *   • A workspace value of 0 disables the window for that workspace
 *     (existing behaviour preserved).
 */

// NOTE: Always read `process.env.FOO` by literal property name below.
// Next.js only inlines `NEXT_PUBLIC_*` vars into the client bundle when they
// are accessed as a static property — a computed `process.env[name]` lookup
// gets erased on the client and silently falls back to the default.
function envInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const SESSION_MAX_AGE_MINUTES = envInt(process.env.SESSION_MAX_AGE_MINUTES, 15);

export const TIMING = {
  // ── Auth & session ────────────────────────────────────────────────
  /** Idle minutes before the session locks (re-auth required). Client-readable. */
  sessionIdleLockMinutes: envInt(process.env.NEXT_PUBLIC_SESSION_IDLE_LOCK_MINUTES, 2),
  /** JWT lifetime in minutes — user has to re-login after this. */
  sessionMaxAgeMinutes: SESSION_MAX_AGE_MINUTES,
  /**
   * How many minutes before expiry to show the "session about to expire"
   * popup. Client-readable.
   */
  sessionExpiryWarningMinutes: envInt(
    process.env.NEXT_PUBLIC_SESSION_EXPIRY_WARNING_MINUTES,
    2,
  ),
  /**
   * Fresh minutes granted when the user clicks "Stay signed in" on the
   * expiry popup. Defaults to the full session lifetime (full reset). Set
   * a smaller value to grant only a partial extension.
   */
  sessionExtendMinutes: envInt(
    process.env.SESSION_EXTEND_MINUTES,
    SESSION_MAX_AGE_MINUTES,
  ),

  // ── Token TTLs ────────────────────────────────────────────────────
  /** Email-verification token expiry. */
  emailVerificationTtlHours: envInt(process.env.EMAIL_VERIFICATION_TTL_HOURS, 24),
  /** Password-reset token expiry. */
  passwordResetTtlMinutes: envInt(process.env.PASSWORD_RESET_TTL_MINUTES, 60),
  /** Workspace invite link expiry. */
  inviteTtlDays: envInt(process.env.INVITE_TTL_DAYS, 7),

  // ── Edit windows ──────────────────────────────────────────────────
  /**
   * Default edit window (days) for transactions / attendance / wage
   * payments. Per-workspace overrides via `Workspace.transactionEditWindowDays`
   * win when set; this env value is the fallback (and the default for new
   * workspaces in future).
   */
  defaultEditWindowDays: envInt(process.env.EDIT_WINDOW_DAYS, 30),
  /** Grace window (days) for editing/deleting the closing EMI of a closed loan. */
  loanEmiGraceDays: envInt(process.env.LOAN_EMI_GRACE_DAYS, 3),

  // ── Dashboard ─────────────────────────────────────────────────────
  /** How far ahead to look for "upcoming dues". */
  dashboardUpcomingDuesDays: envInt(process.env.DASHBOARD_DUES_WINDOW_DAYS, 30),
} as const;

// Convenience exports for ms math used throughout the codebase. Avoids
// the hand-typed `24 * 60 * 60 * 1000` showing up in N files.
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const ONE_HOUR_MS = 60 * 60 * 1000;
export const ONE_MINUTE_MS = 60 * 1000;
