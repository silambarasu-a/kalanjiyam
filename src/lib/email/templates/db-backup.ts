import { COLORS, escapeHtml, renderLayout } from "./_layout";

export type BackupObject = {
  key: string;
  size: number;
  /** ISO 8601 UTC timestamp from S3 LastModified. */
  lastModified: string;
  /** 7-day presigned GET URL. */
  downloadUrl: string;
};

type SharedArgs = {
  today: string;
  runUrl: string;
  appUrl: string;
  /** All current backups in S3 with timestamps + presigned URLs. */
  kept: BackupObject[];
  /** If listing S3 failed, the message — surfaced as a small warning row. */
  listError: string | null;
};

export type BackupSuccessArgs = SharedArgs & {
  status: "ok";
  key: string;
  size: number;
  /** Keys of objects deleted in this run (not in S3 anymore, so no URLs). */
  pruned: string[];
};

export type BackupFailureArgs = SharedArgs & {
  status: "fail";
};

export type BackupEmailArgs = BackupSuccessArgs | BackupFailureArgs;

function humanSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} bytes`;
}

function formatIST(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    const fmt = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
    return `${fmt} IST`;
  } catch {
    return iso;
  }
}

function renderChip(
  label: string,
  fg: string,
  bg: string,
  ring: string,
): string {
  return `<div style="margin:0 0 16px 0;"><span style="display:inline-block;padding:4px 10px;background:${bg};color:${fg};border:1px solid ${ring};border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;">${escapeHtml(label)}</span></div>`;
}

function renderButton(label: string, href: string, bg: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0 0;"><tr><td style="background:${bg};border-radius:8px;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 24px;font-size:14px;font-weight:500;color:#FFFFFF;text-decoration:none;letter-spacing:0;">${escapeHtml(label)}</a></td></tr></table>`;
}

function renderBackupTable(
  items: BackupObject[],
  emptyText: string,
  todayKey: string | null,
): string {
  if (items.length === 0) {
    return `<div style="padding:12px 14px;color:#9CA3AF;font-style:italic;font-size:13px;">${escapeHtml(emptyText)}</div>`;
  }
  const header = `
    <tr>
      <th align="left" style="padding:8px 12px;background:#F9FAFB;color:${COLORS.textMuted};font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;border-bottom:1px solid ${COLORS.border};">File</th>
      <th align="left" style="padding:8px 12px;background:#F9FAFB;color:${COLORS.textMuted};font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;border-bottom:1px solid ${COLORS.border};white-space:nowrap;">Created (IST)</th>
      <th align="left" style="padding:8px 12px;background:#F9FAFB;color:${COLORS.textMuted};font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;border-bottom:1px solid ${COLORS.border};white-space:nowrap;">Size</th>
      <th align="right" style="padding:8px 12px;background:#F9FAFB;color:${COLORS.textMuted};font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;border-bottom:1px solid ${COLORS.border};white-space:nowrap;"></th>
    </tr>`;

  const rows = items
    .map((it, idx) => {
      const isLast = idx === items.length - 1;
      const cellBorder = isLast ? "" : `border-bottom:1px solid ${COLORS.border};`;
      const todayChip =
        todayKey && it.key === todayKey
          ? `<span style="display:inline-block;margin-left:8px;padding:1px 7px;background:${COLORS.primaryTint};color:${COLORS.primary};border:1px solid rgba(4,120,87,0.18);border-radius:999px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">New</span>`
          : "";
      return `
        <tr>
          <td style="padding:10px 12px;${cellBorder}font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:${COLORS.textDark};word-break:break-all;">${escapeHtml(it.key)}${todayChip}</td>
          <td style="padding:10px 12px;${cellBorder}font-size:12px;color:${COLORS.textMuted};white-space:nowrap;">${escapeHtml(formatIST(it.lastModified))}</td>
          <td style="padding:10px 12px;${cellBorder}font-size:12px;color:${COLORS.textMuted};white-space:nowrap;">${escapeHtml(humanSize(it.size))}</td>
          <td align="right" style="padding:10px 12px;${cellBorder}white-space:nowrap;"><a href="${escapeHtml(it.downloadUrl)}" style="color:${COLORS.primary};text-decoration:none;font-size:12px;font-weight:600;">Download&nbsp;↓</a></td>
        </tr>`;
    })
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:10px;overflow:hidden;">
      ${header}
      ${rows}
    </table>`;
}

function renderPrunedRow(keys: string[]): string {
  if (keys.length === 0) {
    return `<span style="color:#9CA3AF;font-style:italic;font-size:13px;">none</span>`;
  }
  return keys
    .map(
      (k) =>
        `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:${COLORS.textMuted};line-height:1.7;text-decoration:line-through;word-break:break-all;">${escapeHtml(k)}</div>`,
    )
    .join("");
}

function renderListError(message: string | null): string {
  if (!message) return "";
  return `<div style="margin:0 0 20px 0;padding:10px 14px;background:#FFF7ED;border:1px solid rgba(234,88,12,0.25);border-radius:8px;font-size:12px;color:#9A3412;">
    Couldn't list current backups from S3 (${escapeHtml(message)}). Check that the app's IAM user has <code style="background:#FFEDD5;padding:1px 4px;border-radius:3px;">s3:ListBucket</code> + <code style="background:#FFEDD5;padding:1px 4px;border-radius:3px;">s3:GetObject</code> on the backup prefix.
  </div>`;
}

export function renderBackupEmail(args: BackupEmailArgs): {
  subject: string;
  html: string;
  text: string;
} {
  if (args.status === "ok") {
    const subject = `Kalanjiyam · Backup OK · ${args.today}`;
    const size = humanSize(args.size);

    const bodyHtml = `
      ${renderChip("Database backup", COLORS.primary, COLORS.primaryTint, "rgba(4,120,87,0.13)")}
      <p style="margin:0 0 8px 0;font-size:18px;font-weight:600;color:${COLORS.textDark};line-height:1.4;">Backup completed</p>
      <p style="margin:0 0 20px 0;color:${COLORS.textMuted};">Daily snapshot saved to S3 on <strong style="color:${COLORS.textDark};">${escapeHtml(args.today)}</strong>.</p>

      <div style="background:${COLORS.primaryTint};border:1px solid rgba(4,120,87,0.13);border-radius:10px;padding:14px 18px;margin:0 0 24px 0;font-size:13px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:3px 12px 3px 0;color:${COLORS.textMuted};width:90px;vertical-align:top;">Today's key</td><td style="padding:3px 0;color:${COLORS.textDark};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all;">${escapeHtml(args.key)}</td></tr>
          <tr><td style="padding:3px 12px 3px 0;color:${COLORS.textMuted};vertical-align:top;">Size</td><td style="padding:3px 0;color:${COLORS.textDark};">${escapeHtml(size)}</td></tr>
        </table>
      </div>

      ${renderListError(args.listError)}

      <p style="margin:0 0 8px 0;font-size:13px;font-weight:600;color:${COLORS.textDark};">All backups in S3 (${args.kept.length})</p>
      <p style="margin:0 0 12px 0;font-size:12px;color:${COLORS.textMuted};">Download links are presigned and valid for 7 days.</p>
      ${renderBackupTable(args.kept, "No backups visible in S3 yet.", args.key)}

      ${args.pruned.length > 0 ? `
      <p style="margin:24px 0 8px 0;font-size:13px;font-weight:600;color:${COLORS.textDark};">Pruned in this run (${args.pruned.length})</p>
      <div style="padding:10px 14px;background:#F9FAFB;border:1px solid ${COLORS.border};border-radius:8px;">
        ${renderPrunedRow(args.pruned)}
      </div>` : ""}

      <div style="margin-top:24px;">
        ${renderButton("View workflow run", args.runUrl, COLORS.cta)}
      </div>
    `;

    const html = renderLayout({
      title: subject,
      preheader: `Daily database snapshot saved to S3 on ${args.today}. ${args.kept.length} backup(s) retained.`,
      bodyHtml,
      appUrl: args.appUrl,
    });

    const tableText =
      args.kept.length === 0
        ? "  (no backups visible in S3 yet)"
        : args.kept
            .map(
              (it) =>
                `  • ${it.key}\n    ${formatIST(it.lastModified)} · ${humanSize(it.size)}\n    ${it.downloadUrl}`,
            )
            .join("\n\n");

    const text = [
      `[Kalanjiyam] Database backup completed`,
      ``,
      `Daily snapshot saved to S3 on ${args.today}.`,
      ``,
      `  Today's key: ${args.key}`,
      `  Size:        ${size}`,
      ``,
      `All backups in S3 (${args.kept.length}) — download links valid 7 days:`,
      tableText,
      ``,
      ...(args.pruned.length > 0
        ? [
            `Pruned in this run (${args.pruned.length}):`,
            ...args.pruned.map((k) => `  - ${k}`),
            ``,
          ]
        : []),
      `View workflow run: ${args.runUrl}`,
      ``,
      `— Kalanjiyam · Automated backup notification`,
    ].join("\n");

    return { subject, html, text };
  }

  const subject = `Kalanjiyam · Backup FAILED · ${args.today}`;
  const RED = "#B91C1C";
  const RED_BG = "#FEF2F2";
  const RED_RING = "rgba(185,28,28,0.18)";

  const bodyHtml = `
    ${renderChip("Backup failed", RED, RED_BG, RED_RING)}
    <p style="margin:0 0 8px 0;font-size:18px;font-weight:600;color:${COLORS.textDark};line-height:1.4;">Daily backup did not complete</p>
    <p style="margin:0 0 20px 0;color:${COLORS.textMuted};">The scheduled snapshot for <strong style="color:${COLORS.textDark};">${escapeHtml(args.today)}</strong> failed. Previously-stored backups in S3 are untouched and listed below.</p>

    <div style="background:${RED_BG};border:1px solid ${RED_RING};border-radius:10px;padding:14px 18px;margin:0 0 24px 0;font-size:13px;">
      <p style="margin:0 0 8px 0;color:${COLORS.textDark};font-weight:600;">Triage checklist</p>
      <ul style="margin:0;padding-left:18px;color:${COLORS.textMuted};line-height:1.7;">
        <li>Is the DB reachable from GitHub Actions runners (SSL only, no IP allowlist)?</li>
        <li>Is the <code style="background:#F3F4F6;padding:1px 5px;border-radius:4px;font-size:12px;">postgres:NN</code> image major version &gt;= server major?</li>
        <li>Has <code style="background:#F3F4F6;padding:1px 5px;border-radius:4px;font-size:12px;">AWS_ACCESS_KEY_ID</code> been rotated or scoped away from the bucket?</li>
        <li>Did <code style="background:#F3F4F6;padding:1px 5px;border-radius:4px;font-size:12px;">DB_BACKUP_DATABASE_URL</code> change?</li>
      </ul>
    </div>

    ${renderListError(args.listError)}

    <p style="margin:0 0 8px 0;font-size:13px;font-weight:600;color:${COLORS.textDark};">Last successful backups (${args.kept.length})</p>
    <p style="margin:0 0 12px 0;font-size:12px;color:${COLORS.textMuted};">Download links are presigned and valid for 7 days.</p>
    ${renderBackupTable(args.kept, "No backups visible in S3 yet.", null)}

    <div style="margin-top:24px;">
      ${renderButton("Open failed run", args.runUrl, RED)}
    </div>
  `;

  const html = renderLayout({
    title: subject,
    preheader: `Daily database backup failed on ${args.today}. ${args.kept.length} prior backup(s) still in S3.`,
    bodyHtml,
    appUrl: args.appUrl,
  });

  const tableText =
    args.kept.length === 0
      ? "  (no prior backups in S3)"
      : args.kept
          .map(
            (it) =>
              `  • ${it.key}\n    ${formatIST(it.lastModified)} · ${humanSize(it.size)}\n    ${it.downloadUrl}`,
          )
          .join("\n\n");

  const text = [
    `[Kalanjiyam] Daily backup FAILED for ${args.today}`,
    ``,
    `The scheduled snapshot for ${args.today} did not complete.`,
    `Previously-stored backups in S3 are untouched.`,
    ``,
    `Triage:`,
    `  - Is the DB reachable from GitHub Actions runners (SSL only)?`,
    `  - Is the postgres:NN image major version >= server major?`,
    `  - Has AWS_ACCESS_KEY_ID been rotated?`,
    `  - Did DB_BACKUP_DATABASE_URL change?`,
    ``,
    `Last successful backups (${args.kept.length}) — download links valid 7 days:`,
    tableText,
    ``,
    `Open failed run: ${args.runUrl}`,
    ``,
    `— Kalanjiyam · Automated backup notification`,
  ].join("\n");

  return { subject, html, text };
}
