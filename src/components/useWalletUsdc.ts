"use client";

import { useEffect } from "react";

import { followWalletUsdc } from "@/lib/store/wallet-usdc";

import { useConsole, useSession } from "./ConsoleProvider";

/** Keeps the connected wallet's USDC read while the calling form is on screen. */
export function useWalletUsdc(): void {
  const { store } = useSession();
  const address = useConsole().wallet?.address;
  useEffect(() => {
    if (address === undefined) return;
    return followWalletUsdc(store, {
      visible: () => document.visibilityState === "visible",
      returned: (listener) => {
        document.addEventListener("visibilitychange", listener);
        window.addEventListener("focus", listener);
        return () => {
          document.removeEventListener("visibilitychange", listener);
          window.removeEventListener("focus", listener);
        };
      },
    });
  }, [store, address]);
}
