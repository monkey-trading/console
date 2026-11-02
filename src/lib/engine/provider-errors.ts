/** How a wallet's refusals read: the error codes it answers with and the messages written for the user. */

/** EIP-1193's code for a request the user rejected, and EIP-3085's for a chain the wallet does not know. */
const USER_REJECTED = 4001;
const UNKNOWN_CHAIN = 4902;
/** Some wallets answer an unknown chain as a JSON-RPC server error instead of EIP-3085's 4902. */
const SERVER_ERROR = -32603;

const errorCode = (error: unknown) => (typeof error === "object" && error !== null && "code" in error ? error.code : undefined);

/** The error a wallet's refusal stands for, written for the user. */
export function walletError(error: unknown, action: string): Error {
  if (errorCode(error) === USER_REJECTED) return new Error(`You declined to ${action} in your wallet.`, { cause: error });
  const detail = error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error);
  return new Error(`Your wallet could not ${action}: ${detail}`, { cause: error });
}

/** Whether an error from `walletError` is the user's own refusal, as opposed to a request that failed. */
export const declinedByUser = (error: unknown): boolean => error instanceof Error && errorCode(error.cause) === USER_REJECTED;

/** Whether a chain-switch refusal says the wallet does not know the chain: EIP-3085's 4902, or a -32603 whose message names the chain and reports it unrecognized or unknown, which some wallets answer instead. A generic failure that says neither is a refusal, not an unknown chain. */
export function unknownChain(error: unknown): boolean {
  const code = errorCode(error);
  if (code === UNKNOWN_CHAIN) return true;
  if (code !== SERVER_ERROR) return false;
  const detail = error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  return /chain/i.test(detail) && /unrecognized|unknown/i.test(detail);
}

/** `read`, or a rejection once `ms` has passed without it settling. */
export function withTimeout<T>(read: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Your wallet did not answer in time.")), ms);
    read.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}
