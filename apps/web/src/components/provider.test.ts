import { describe, expect, it } from "vitest";
import { catalog } from "@house/contracts";
import { providerLabel } from "./provider";

const byTitle = (title: string) => catalog.find((a) => a.title === title)!;
describe("asset provider labels", () => {
  it("names the real source of every catalog model", () => {
    expect(providerLabel(byTitle("Linen sofa"))).toBe("FurniMesh");
    expect(providerLabel(byTitle("Classic fabric sofa"))).toBe(
      "Poly Haven · CC0",
    );
    expect(providerLabel(byTitle("Boucle barrel chair"))).toBe(
      "House original · CC0",
    );
    for (const a of catalog) expect(providerLabel(a)).not.toBe("");
  });
});
