// Cross-fade a state change where the platform can, without ever letting the
// animation decide whether the change happens.
//
// The View Transitions API skips a transition started while the document is
// hidden, and rejects `ready` with InvalidStateError when it does. That is a
// reachable state here, not a theoretical one: programmatic tab switches
// (open-doc events, deep links) fire while the window is backgrounded — and
// a question long enough to walk away from is exactly when it is. The update
// callback still runs in that case, so the switch itself is always correct;
// the only casualty is the animation.
//
// Left unhandled, that skip surfaces as an uncaught promise rejection on
// every such switch. A dropped animation is a cosmetic outcome and should be
// silent.

type ViewTransitionLike = {
  ready?: Promise<unknown>;
  finished?: Promise<unknown>;
};

export type TransitionCapableDocument = {
  startViewTransition?: (callback: () => void) => ViewTransitionLike | void;
  hidden?: boolean;
};

/**
 * Apply `update`, cross-fading it when the platform supports transitions and
 * the user has not asked for reduced motion. Never a behaviour fork: `update`
 * runs exactly once on every path.
 */
export function transitionOrJustDo(
  update: () => void,
  doc: TransitionCapableDocument,
  prefersReducedMotion: boolean
): void {
  // A hidden document never reaches a rendering opportunity, and the update
  // callback is tied to one — measured here as the callback simply not
  // running until the page becomes visible again. "Skipped animation" is
  // acceptable; "deferred state change" is not, so a hidden document takes
  // the plain path.
  if (!doc.startViewTransition || prefersReducedMotion || doc.hidden === true) {
    update();
    return;
  }

  const transition = doc.startViewTransition(update);
  if (!transition) return;

  // Swallow both promises. A skipped or interrupted transition is not a
  // failure the user can act on, and the state change has already happened.
  transition.ready?.catch(() => {});
  transition.finished?.catch(() => {});
}
