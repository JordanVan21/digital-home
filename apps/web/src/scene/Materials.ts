import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
let oak: CanvasTexture | undefined;
/** Deterministic, original oak grain. No external textures or render-time downloads. */
export function oakTexture(): CanvasTexture {
  if (oak) return oak;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d")!;
  let seed = 71;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let row = 0; row < 8; row++) {
    const y = row * 128;
    const offset = row % 2 ? 256 : 0;
    for (let board = -1; board < 3; board++) {
      const x = board * 512 + offset;
      const tone = Math.floor(random() * 17);
      ctx.fillStyle = `rgb(${193 + tone},${153 + tone},${104 + tone})`;
      ctx.fillRect(x, y, 512, 128);
      for (let grain = 0; grain < 500; grain++) {
        const gy = y + random() * 128;
        ctx.strokeStyle = `rgba(${random() > 0.5 ? "255,235,194" : "104,65,32"},${0.025 + random() * 0.075})`;
        ctx.lineWidth = 0.25 + random();
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.bezierCurveTo(
          x + 140,
          gy - 3 + random() * 6,
          x + 350,
          gy + random() * 4,
          x + 512,
          gy,
        );
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(91,62,32,0.2)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, 511, 127);
    }
  }
  oak = new CanvasTexture(canvas);
  oak.wrapS = oak.wrapT = RepeatWrapping;
  oak.repeat.set(0.44, 0.44);
  oak.colorSpace = SRGBColorSpace;
  oak.anisotropy = 8;
  return oak;
}
