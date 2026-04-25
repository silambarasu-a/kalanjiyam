import Link from "next/link";
import { auth } from "@/lib/auth";
import { readInvite } from "@/lib/auth/invite-tokens";
import { AcceptInviteButton } from "./accept-invite-button";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const rawToken = decodeURIComponent(token);
  const invite = await readInvite(rawToken);
  const session = await auth();
  // eslint-disable-next-line react-hooks/purity -- server component, called once per request
  const nowMs = Date.now();

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md bg-card border border-border rounded-lg p-6 shadow-sm">
        <div className="mb-5 text-center">
          <div className="flex items-center justify-center gap-1.5 text-sm font-semibold tracking-tight text-foreground">
            <span className="h-4 w-1 bg-primary rounded-full" />
            Kalanjiyam
          </div>
          <h1 className="mt-2 text-xl font-semibold">Workspace invite</h1>
        </div>

        {!invite ? (
          <Message title="Invite not found" body="This link is invalid." />
        ) : invite.cancelledAt ? (
          <Message title="Invite cancelled" body="The workspace owner cancelled this invite." />
        ) : invite.acceptedAt ? (
          <Message title="Invite already used" body="You have already accepted this invite." />
        ) : invite.expiresAt.getTime() < nowMs ? (
          <Message
            title="Invite expired"
            body="Ask the inviter to send a new invite."
          />
        ) : (
          <div className="space-y-4">
            <div className="rounded border border-neutral-200 bg-background p-4 text-sm">
              <div className="text-muted-foreground">
                <strong>{invite.invitedByUser.name}</strong> has invited you to join
              </div>
              <div className="mt-1 text-lg font-semibold">{invite.workspace.name}</div>
              <div className="mt-1 text-xs uppercase tracking-widest text-primary">
                as {invite.role}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Invited email: {invite.email}
              </div>
            </div>

            {!session?.user ? (
              <div className="space-y-2 text-sm">
                <p>
                  Sign in with <strong>{invite.email}</strong> to accept.
                </p>
                <div className="flex gap-2">
                  <Link
                    href={`/login?callbackUrl=${encodeURIComponent(`/invites/${token}`)}`}
                    className="flex-1 text-center rounded-md bg-primary text-primary-foreground py-2"
                  >
                    Sign in
                  </Link>
                  <Link
                    href={`/signup?callbackUrl=${encodeURIComponent(`/invites/${token}`)}`}
                    className="flex-1 text-center rounded-md border border-input py-2"
                  >
                    Create account
                  </Link>
                </div>
              </div>
            ) : session.user.email?.toLowerCase() !== invite.email.toLowerCase() ? (
              <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                This invite was sent to <strong>{invite.email}</strong>, but you&apos;re signed in
                as <strong>{session.user.email}</strong>. Sign out and use the invited address.
              </div>
            ) : (
              <AcceptInviteButton token={token} />
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <Link
        href="/login"
        className="mt-4 inline-block rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm"
      >
        Go to login
      </Link>
    </div>
  );
}
