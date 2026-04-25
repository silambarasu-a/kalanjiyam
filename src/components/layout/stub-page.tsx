export function StubPage({
  title,
  milestone,
  description,
}: {
  title: string;
  milestone: string;
  description: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
        <div className="text-xs font-semibold uppercase tracking-widest text-primary">
          {milestone}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          This section lands in a later milestone.
        </p>
      </div>
    </div>
  );
}
