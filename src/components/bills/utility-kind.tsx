import { Cable, Droplet, Flame, Phone, Tv, Wifi, Zap, Plug } from "lucide-react";

export type UtilityKindValue =
  | "ELECTRICITY"
  | "INTERNET"
  | "MOBILE_POSTPAID"
  | "MOBILE_PREPAID"
  | "DTH"
  | "GAS"
  | "WATER"
  | "OTHER";

export const UTILITY_KINDS: { value: UtilityKindValue; label: string }[] = [
  { value: "ELECTRICITY", label: "Electricity" },
  { value: "INTERNET", label: "Internet / Broadband" },
  { value: "MOBILE_POSTPAID", label: "Mobile postpaid" },
  { value: "MOBILE_PREPAID", label: "Mobile prepaid" },
  { value: "DTH", label: "DTH / Cable" },
  { value: "GAS", label: "Gas (piped)" },
  { value: "WATER", label: "Water" },
  { value: "OTHER", label: "Other" },
];

export function utilityKindLabel(k: UtilityKindValue): string {
  return UTILITY_KINDS.find((u) => u.value === k)?.label ?? k;
}

/**
 * Stable component renderer for utility-kind icons. Use this in JSX as
 * `<UtilityKindIcon kind="ELECTRICITY" />` rather than picking the
 * icon ref at render time — the React compiler treats
 * locally-assigned component references as fresh components.
 */
export function UtilityKindIcon({
  kind,
  className,
}: {
  kind: UtilityKindValue;
  className?: string;
}) {
  switch (kind) {
    case "ELECTRICITY":
      return <Zap className={className} />;
    case "INTERNET":
      return <Wifi className={className} />;
    case "MOBILE_POSTPAID":
    case "MOBILE_PREPAID":
      return <Phone className={className} />;
    case "DTH":
      return <Tv className={className} />;
    case "GAS":
      return <Flame className={className} />;
    case "WATER":
      return <Droplet className={className} />;
    case "OTHER":
      return <Plug className={className} />;
    default:
      return <Cable className={className} />;
  }
}
