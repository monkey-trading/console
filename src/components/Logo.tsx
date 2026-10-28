/** The supplied Monkey Trading bitmap, framed without altering the source asset. */

import Image from "next/image";

/** A decorative brand mark beside the visible Monkey Trading name. */
export function LogoMark({ className = "size-11" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`relative inline-block shrink-0 overflow-hidden rounded-full ${className}`}>
      <Image src="/monkey-trading-logo.png" alt="" width={780} height={624} unoptimized
        className="absolute top-1/2 left-1/2 h-auto w-[215%] max-w-none -translate-x-1/2 -translate-y-1/2" />
    </span>
  );
}
