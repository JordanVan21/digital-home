import { Box } from "lucide-react";
import { editor } from "../state/editor";

/** Left navigation pills. Further sections (designs, versions) arrive with their features. */
export function SideNav() {
  return (
    <nav className="side-nav" aria-label="Sections">
      <button
        className="nav-pill glass"
        aria-label="Objects"
        onClick={() =>
          editor.interaction.setState({ browser: true, replacing: false })
        }
      >
        <span className="nav-icon accent">
          <Box size={19} strokeWidth={1.7} />
        </span>
        <span>Objects</span>
      </button>
    </nav>
  );
}
