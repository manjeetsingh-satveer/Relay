import * as React from "react";
import { cn } from "@/lib/utils";

export function Label(props: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={cn("text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]", props.className)} />;
}
