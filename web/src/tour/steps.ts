import type * as tour from "@zag-js/tour";
import type { TourTargetKey } from "./tourTargets";

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  /** Typed tour anchor to spotlight; omit for a centered dialog step. */
  target?: TourTargetKey | undefined;
  /**
   * Route the app navigates to when this step activates — the machine
   * waits up to 3s for the target to appear, so client-side page
   * changes land before the spotlight needs them.
   */
  href?: string | undefined;
  placement?: tour.StepPlacement | undefined;
}
