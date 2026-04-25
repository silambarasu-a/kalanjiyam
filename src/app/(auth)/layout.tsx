export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="h-9 w-9" />
            Kalanjiyam
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Household finance &amp; farm management
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg shadow-sm p-6">{children}</div>
      </div>
    </main>
  );
}
