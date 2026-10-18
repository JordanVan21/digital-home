import type { Vec3 } from '@house/contracts';

export type PhotoCamera = { position: Vec3; target: Vec3; fov: number };

/** Per-scene "Match photo" camera (set by the loader for scenes reproduced from a reference image). */
export const photoCamera: { current: PhotoCamera | null } = { current: null };
