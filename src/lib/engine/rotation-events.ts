/** The stream events after which who runs the node may have changed (monkey-trading/console#280): a read of the operator follows each. */

export const ROTATION_EVENTS: ReadonlySet<string> = new Set(["operator_elected", "rotation_switched", "rotation_set_adopted", "turn_assigned", "turn_refused", "turn_taken"]);
