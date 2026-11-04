/** Which of the Staking page's delegation forms is open, and what its Move form holds (monkey-trading/console#302). */

/** The delegation whose form is open and in which mode, and the Move form's chosen and typed destination. */
export interface DelegationForm {
  editing: { candidate: string; mode: "move" | "undelegate" } | null;
  moveTo: string | null;
  typedMove: string;
}

export const CLOSED_FORM: DelegationForm = { editing: null, moveTo: null, typedMove: "" };

/**
 * The forms once `next` opens, or null closes them. A destination chosen or an address typed under
 * another delegation is not this one's, so opening another delegation's form starts it afresh;
 * `fresh` says so, for the amounts typed, which the panel keeps.
 */
export function openForm(form: DelegationForm, next: DelegationForm["editing"]): { form: DelegationForm; fresh: boolean } {
  const fresh = next?.candidate !== form.editing?.candidate;
  return { form: fresh ? { editing: next, moveTo: null, typedMove: "" } : { ...form, editing: next }, fresh };
}
