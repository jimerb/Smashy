import { GEOMETRY } from "../core";

/** Long bank shots retain the exact traced path without several seconds of waiting. */
export const MAX_FLIGHT_SECONDS = 1.8;
export function flightPresentationSpeed(distance: number): number {
  return Math.max(GEOMETRY.speed, distance / MAX_FLIGHT_SECONDS);
}
