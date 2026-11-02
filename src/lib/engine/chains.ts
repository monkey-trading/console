/** The names the console gives the chains a custody vault can sit on; any other chain shows its id. */

const NAMES: Readonly<Record<number, string>> = { 1: "Ethereum", 31337: "Anvil", 42161: "Arbitrum One", 421614: "Arbitrum Sepolia" };

/** `Anvil`, `Arbitrum One`; `chain 7` for an id with no name, and the mock's own chain for null. */
export const chainName = (chainId: number | null): string => (chainId === null ? "the mock chain" : (NAMES[chainId] ?? `chain ${chainId}`));
