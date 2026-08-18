import { GoldAcquisitionForm } from "@/components/investments/gold/gold-acquisition-form";

export default function NewGoldPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add gold</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A jeweller bill with one or more ornaments, a gift, or gold you
          already own.
        </p>
      </div>
      <GoldAcquisitionForm />
    </div>
  );
}
