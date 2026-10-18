import { it, expect } from "vitest";
import { catalog } from "@house/contracts";
import { createEditor } from "./editor";
it("adds artwork to a free wall and pendants to the ceiling from the existing library path", () => {
  const e = createEditor();
  e.scene.setState({ scene: { ...e.working(), objects: [] } });
  e.chooseAsset(catalog.find((a) => a.title === "Framed landscape print")!);
  expect(e.selected()?.placement?.support).toBe("wall");
  e.discard();
  e.chooseAsset(catalog.find((a) => a.title === "Modern pendant lamp")!);
  expect(e.selected()?.placement?.support).toBe("ceiling");
  e.dispose();
});
