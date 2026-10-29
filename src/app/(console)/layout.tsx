/** The console's layout: the demo session and the shell, which the restricted page does not load. */

import type { ReactNode } from "react";

import { ConsoleProvider } from "@/components/ConsoleProvider";
import { Shell } from "@/components/Shell";

/** Wraps every console screen in the session provider and the shell. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleProvider>
      <Shell>{children}</Shell>
    </ConsoleProvider>
  );
}
