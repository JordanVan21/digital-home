import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { Search, X, ArrowUpRight } from "lucide-react";
import { catalog } from "@house/contracts";
import { editor } from "../state/editor";
import { Button } from "./Button";
export function AssetBrowser() {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("all");
  const replacing = useStore(editor.interaction, (s) => s.replacing);
  const id = useStore(editor.interaction, (s) => s.selectedId);
  const object = useStore(editor.scene, (s) =>
    s.scene.objects.find((o) => o.id === id),
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  const categories = ["all", ...new Set(catalog.map((a) => a.category))];
  const shown = catalog.filter(
    (a) =>
      (!replacing || a.category === object?.category) &&
      (category === "all" || category === a.category) &&
      `${a.title} ${a.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const close = () =>
    editor.interaction.setState({ browser: false, replacing: false });
  return (
    <div className="browser-backdrop" onClick={close}>
      <section
        className="asset-browser glass"
        role="dialog"
        aria-modal="true"
        aria-label={replacing ? "Replace model" : "Furniture library"}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            close();
            return;
          }
          if (e.key !== "Tab") return;
          const nodes = e.currentTarget.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input,select",
          );
          const first = nodes[0],
            last = nodes[nodes.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="browser-heading">
          <div>
            <span className="eyebrow">THE HOUSE COLLECTION</span>
            <h2>
              {replacing
                ? "A fresh look for your piece."
                : "Find its place in your space."}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            title="Close furniture library"
            aria-label="Close furniture library"
            onClick={close}
          >
            <X size={19} />
          </button>
        </div>
        <div className="browser-filters">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Search furniture"
              placeholder="Search furniture…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {!replacing && (
            <select
              aria-label="Furniture category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === "all" ? "All pieces" : c.replaceAll("-", " ")}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="asset-grid">
          {shown.map((a) => (
            <Button
              key={a.id}
              label={`${replacing ? "Replace with" : "Add"} ${a.title}`}
              className="asset-card"
              onClick={() => editor.chooseAsset(a)}
            >
              <div className="asset-image">
                <img loading="lazy" src={a.thumbnailStorageKey} alt="" />
                <span className="asset-arrow">
                  <ArrowUpRight size={16} />
                </span>
              </div>
              <span className="asset-card-title">{a.title}</span>
              <span className="asset-meta">
                {a.dimensionsM.map((d) => d.toFixed(2)).join(" × ")} m
              </span>
              <span className="asset-price">
                ${((a.estimatedPrice?.minor ?? 0) / 100).toLocaleString()}{" "}
                <small>est.</small>
              </span>
            </Button>
          ))}
        </div>
        {!shown.length && (
          <div className="empty-state">
            No pieces found. Try another search.
          </div>
        )}
        <p className="browser-note">
          {replacing
            ? "Keeps the position and rotation of your piece."
            : "New pieces find a free spot near the center of your room."}{" "}
          All placements are checked.
        </p>
      </section>
    </div>
  );
}
