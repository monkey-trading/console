/**
 * What every amount field carries so browsers and password managers leave it alone: an amount is
 * never a credential, and LastPass otherwise draws its button inside a text field in a form.
 */
export const AMOUNT_INPUT = {
  autoComplete: "off",
  "data-lpignore": "true",
  "data-1p-ignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;
