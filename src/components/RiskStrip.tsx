/** The risk notice, kept to one line at the foot of the terminal. */

export function RiskStrip() {
  return (
    <footer className="border-t border-line px-4 py-2 text-label leading-relaxed text-fg-3">
      <span className="tracking-caps text-fg-2 uppercase">Risk notice</span>{" "}
      CFDs are complex, leveraged products, and losses can be rapid. This software is pre-launch, and nothing here is an offer of any product, service, or token. Not available to persons in the United States or in sanctioned jurisdictions.
    </footer>
  );
}
