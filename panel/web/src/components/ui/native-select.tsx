import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "../../lib/utils.js";

function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return <div className="relative w-full"><select data-slot="native-select" className={cn("h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 pr-8 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50", className)} {...props}>{children}</select><ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /></div>;
}
export { NativeSelect };
