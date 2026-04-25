export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-2xl font-bold tracking-widest text-neutral-900">
            KALANJIYAM
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            Household finance & farm management
          </div>
        </div>
        <div className="bg-white border border-neutral-200 rounded-lg shadow-sm p-6">
          {children}
        </div>
      </div>
    </main>
  );
}
