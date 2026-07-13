import { cn } from "@/lib/utils";

type SectionLabelProps = {
  children: React.ReactNode;
  className?: string;
};

export function SectionLabel({ children, className }: SectionLabelProps) {
  return (
    <p
      className={cn(
        "text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70",
        className
      )}
    >
      {children}
    </p>
  );
}
