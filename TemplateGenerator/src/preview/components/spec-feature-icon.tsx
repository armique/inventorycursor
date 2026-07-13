import type { SpecIconType } from "@/types/template";

type SpecIconProps = {
  type: SpecIconType;
  className?: string;
  size?: number;
};

export function SpecFeatureIcon({ type, className, size = 20 }: SpecIconProps) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };

  switch (type) {
    case "cpu":
      return (
        <svg {...props}>
          <rect x="5" y="5" width="14" height="14" rx="2" />
          <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
          <rect x="9" y="9" width="6" height="6" rx="1" />
        </svg>
      );
    case "ram":
    case "memory":
      return (
        <svg {...props}>
          <rect x="3" y="7" width="18" height="10" rx="1.5" />
          <path d="M7 7V5M11 7V5M15 7V5M19 7V5" />
          <path d="M7 12h2M11 12h2M15 12h2" />
          <rect x="6" y="10" width="3" height="4" rx="0.5" opacity="0.5" />
          <rect x="10.5" y="10" width="3" height="4" rx="0.5" opacity="0.5" />
          <rect x="15" y="10" width="3" height="4" rx="0.5" opacity="0.5" />
        </svg>
      );
    case "socket":
    case "plug":
      return (
        <svg {...props}>
          <rect x="6" y="6" width="12" height="12" rx="2" />
          <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
          <circle cx="14" cy="10" r="1" fill="currentColor" stroke="none" />
          <circle cx="10" cy="14" r="1" fill="currentColor" stroke="none" />
          <circle cx="14" cy="14" r="1" fill="currentColor" stroke="none" />
          <path d="M4 12H6M18 12h2M12 4V6M12 18v2" />
        </svg>
      );
    case "chipset":
    case "circuit":
      return (
        <svg {...props}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M8 8h8M8 12h5M8 16h8" />
          <circle cx="17" cy="12" r="1" fill="currentColor" stroke="none" />
          <path d="M2 8h2M2 16h2M20 8h2M20 16h2" />
        </svg>
      );
    case "pcie":
    case "zap":
      return (
        <svg {...props}>
          <path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" />
        </svg>
      );
    case "storage":
    case "nvme":
    case "hard-drive":
      return (
        <svg {...props}>
          <rect x="4" y="6" width="16" height="12" rx="2" />
          <path d="M8 10h8M8 14h5" />
          <circle cx="17" cy="14" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "wifi":
      return (
        <svg {...props}>
          <path d="M5 12.5a10 10 0 0 1 14 0" />
          <path d="M8.5 16a5.5 5.5 0 0 1 7 0" />
          <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "usb":
      return (
        <svg {...props}>
          <path d="M12 3v6M10 5h4" />
          <rect x="8" y="9" width="8" height="10" rx="2" />
          <path d="M10 14h4" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </svg>
      );
  }
}

export function resolveSpecIconType(id: string, fallback?: string): SpecIconType {
  const map: Record<string, SpecIconType> = {
    cpu: "cpu",
    ram: "ram",
    ddr5: "ram",
    memory: "ram",
    socket: "socket",
    plug: "socket",
    chipset: "chipset",
    circuit: "chipset",
    pcie: "pcie",
    zap: "pcie",
    storage: "storage",
    nvme: "nvme",
    "hard-drive": "nvme",
    wifi: "wifi",
    usbc: "usb",
    usb: "usb",
  };
  return map[id] ?? map[fallback ?? ""] ?? "cpu";
}
