"use client";

import { useEffect, useState } from "react";

import { CHECK_GRACE_MS, disagrees, verdict, type Checkpoint } from "@/lib/monkey/verdict";

/** `checkpoint` as a claim panel may say it: a disagreement between the vault and the node's proof reads as checking until it has lasted the grace period. */
export function useVerdict(checkpoint: Checkpoint): Checkpoint | "checking" {
  const unsettled = disagrees(checkpoint);
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!unsettled) return;
    const timer = setTimeout(() => setElapsed(true), CHECK_GRACE_MS);
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [unsettled]);
  return verdict(checkpoint, elapsed);
}
