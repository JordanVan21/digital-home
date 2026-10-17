import type { Quat } from "@house/contracts";

/** All object rotation in this app is yaw-only (about world Y). */
export function yawDegreesFromQuaternion([x, y, z, w]: Quat): number {
  const yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
  return (yaw * 180) / Math.PI;
}

export function quaternionFromYawDegrees(degrees: number): Quat {
  const rad = (degrees * Math.PI) / 180;
  return [0, Math.sin(rad / 2), 0, Math.cos(rad / 2)];
}
