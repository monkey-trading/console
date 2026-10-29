/** Moves focus to the tab panel around `button`, so a control that is about to be removed does not drop the user's place. */
export function keepFocus(button: HTMLElement): void {
  const panel = button.closest('[role="tabpanel"]');
  if (panel instanceof HTMLElement) panel.focus();
}
