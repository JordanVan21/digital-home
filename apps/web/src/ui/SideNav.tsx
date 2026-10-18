import { Box, Search } from 'lucide-react';
import { useEditor } from '../state/store';
import { searchInputId } from './TopBar';

/** Left navigation pills. Further sections (designs, versions) arrive with their features. */
export function SideNav() {
  return (
    <nav className="side-nav" aria-label="Sections">
      <button className="nav-pill glass" aria-label="Objects" onClick={() => useEditor.setState({ libraryOpen: true, replacing: false })}>
        <span className="nav-icon accent"><Box size={19} strokeWidth={1.7} /></span>
        <span>Objects</span>
      </button>
      <button className="nav-pill glass" aria-label="Search" onClick={() => document.getElementById(searchInputId)?.focus()}>
        <span className="nav-icon"><Search size={19} strokeWidth={1.7} /></span>
        <span>Search</span>
      </button>
    </nav>
  );
}
