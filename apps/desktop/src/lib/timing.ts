export const runId = () => `run_${Math.random().toString(16).slice(2, 8)}_${Date.now()}`;

export const artifactId = () => `artifact_${Math.random().toString(16).slice(2, 10)}`;

export const capsuleId = () => `capsule_${Math.random().toString(16).slice(2, 10)}`;

export const packageId = () => `package_${Math.random().toString(16).slice(2, 10)}`;

export const publishJobId = () => `job_${Math.random().toString(16).slice(2, 10)}`;

export const distributionRunId = () => `dist_${Math.random().toString(16).slice(2, 10)}`;

export function nowIso(): string {
  return new Date().toISOString();
}

export function addMinutesIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
