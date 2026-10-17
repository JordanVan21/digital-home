import { Box, Palette, History, Search, ChevronRight } from "lucide-react";

const SECTIONS = [
  { label: "Objects", Icon: Box },
  { label: "Designs", Icon: Palette },
  { label: "Versions", Icon: History },
  { label: "Search", Icon: Search },
];

/** Section nav — all stubs until the catalog/proposal/version-history phases land. */
export function SideNav() {
  return (
    <div className="side-nav glass">
      {SECTIONS.map(({ label, Icon }) => (
        <button key={label} className="nav-pill" disabled title="Coming in a later phase">
          <span className="icon-circle">
            <Icon size={14} />
          </span>
          <span className="label">{label}</span>
          <ChevronRight size={13} className="chev" />
        </button>
      ))}
    </div>
  );
}
