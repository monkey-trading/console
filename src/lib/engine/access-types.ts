/** Why screening refused a request. */

/**
 * As `engine_core::access::AccessReject` serializes it. The first group are the screening
 * source's decisions about the trader; the second say the request could not be checked, from the server's side.
 */
export type AccessReject =
  | "united_states" | "sanctioned_jurisdiction" | "eligibility_required" | "already_attested"
  | "jurisdiction_unknown" | "account_sanctioned" | "account_unknown" | "payer_sanctioned" | "payer_unknown" | "payer_missing" | "deposit_held" | "deposit_pending"
  | "protocol_inactive" | "policy_missing" | "evidence_missing" | "source_not_configured" | "peer_unknown" | "source_unavailable" | "source_invalid" | "evidence_mismatch" | "evidence_stale";
