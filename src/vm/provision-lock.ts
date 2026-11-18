import { RelayError } from "../core/errors.ts";

let held = false;

export function provisionInProgress(): boolean {
  return held;
}

/** Synchronous single-flight lock. Acquire it in the main process before any await. */
export function beginProvision(): () => void {
  if (held) {
    throw new RelayError("busy", "A provision is already running. Its log is on this page. Nothing else was started.", 409);
  }
  held = true;
  return () => {
    held = false;
  };
}
