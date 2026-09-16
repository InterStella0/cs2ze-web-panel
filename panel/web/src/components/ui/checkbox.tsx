import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "lucide-react";
import { cn } from "../../lib/utils.js";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return <CheckboxPrimitive.Root data-slot="checkbox" className={cn("peer size-4 shrink-0 rounded-[4px] border border-input bg-transparent shadow-xs outline-none transition-shadow focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground", className)} {...props}><CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-content-center text-current"><CheckIcon className="size-3.5" /></CheckboxPrimitive.Indicator></CheckboxPrimitive.Root>;
}
export { Checkbox };
