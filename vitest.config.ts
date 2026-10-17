import { defineConfig } from "vitest/config";
const file = (path: string) => new URL(path, import.meta.url).pathname;
export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@house/contracts",
        replacement: file("./packages/contracts/src/index.ts"),
      },
      {
        find: "@house/scene-engine",
        replacement: file("./packages/scene-engine/src/index.ts"),
      },
      // Use the same ESM Three/Fiber instances in the GPU-free renderer and app adapters.
      {
        find: /^three$/,
        replacement: file(
          "./apps/web/node_modules/three/build/three.module.js",
        ),
      },
      {
        find: "@react-three/fiber",
        replacement: file(
          "./apps/web/node_modules/@react-three/fiber/dist/react-three-fiber.esm.js",
        ),
      },
      {
        find: "@react-three/test-renderer",
        replacement: file(
          "./apps/web/node_modules/@react-three/test-renderer/dist/react-three-test-renderer.esm.js",
        ),
      },
    ],
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.{ts,tsx}"],
    environment: "node",
    restoreMocks: true,
    server: {
      deps: {
        inline: ["three", "@react-three/fiber", "@react-three/test-renderer"],
      },
    },
  },
});
