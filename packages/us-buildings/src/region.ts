// Launch region: Texas and the states that border it. Building data is only ingested and shown for
// these states until the pipeline is verified for accuracy and licensing.
export const LAUNCH_REGION = ['TX', 'OK', 'NM', 'AR', 'LA'] as const;
export type LaunchState = (typeof LAUNCH_REGION)[number];

export function isLaunchState(abbr: string): abbr is LaunchState {
  return (LAUNCH_REGION as readonly string[]).includes(abbr.trim().toUpperCase());
}

export function requireLaunchState(abbr: string): LaunchState {
  if (!isLaunchState(abbr)) {
    throw new RangeError(`"${abbr}" is outside the launch region (Texas and bordering states).`);
  }
  return abbr.trim().toUpperCase() as LaunchState;
}
