import { escapeHtml, renderButton, renderLayout, renderSoftPanel } from "./_layout";

type Args = {
  inviterName: string;
  workspaceName: string;
  acceptUrl: string;
  appUrl: string;
  role: string;
  ttlDays: number;
};

export function workspaceInviteTemplate({
  inviterName,
  workspaceName,
  acceptUrl,
  appUrl,
  role,
  ttlDays,
}: Args) {
  const subject = `You're invited to ${workspaceName} on Kalanjiyam`;
  const body = `
    <p style="margin:0 0 16px 0;"><strong>${escapeHtml(inviterName)}</strong> has invited you to join the workspace
      <strong>${escapeHtml(workspaceName)}</strong> on Kalanjiyam as <strong>${escapeHtml(role)}</strong>.</p>
    ${renderSoftPanel(`
      ${renderButton("Accept invite", acceptUrl)}
      <p style="margin:12px 0 0 0;font-size:13px;color:#64748B;text-align:center;">
        This invite expires in ${ttlDays} days. You can belong to up to 3 workspaces.
      </p>
    `)}
    <p style="margin:20px 0 0 0;font-size:13px;color:#64748B;">
      If you don't have a Kalanjiyam account yet, the link will guide you through creating one.
    </p>
  `;
  const html = renderLayout({
    title: subject,
    preheader: `${inviterName} invited you to ${workspaceName}.`,
    bodyHtml: body,
    appUrl,
  });
  const text = [
    `${inviterName} has invited you to join ${workspaceName} on Kalanjiyam as ${role}.`,
    ``,
    `Accept the invite: ${acceptUrl}`,
    ``,
    `This invite expires in ${ttlDays} days.`,
    ``,
    `— Kalanjiyam`,
  ].join("\n");
  return { subject, html, text };
}
