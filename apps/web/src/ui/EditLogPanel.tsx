import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import { useEditor } from '../state/store';
import type { OpSource } from '../state/opLog';

const SOURCE_LABEL: Record<OpSource, string> = {
  suggest: 'suggest', accept: 'accept', immediate: 'apply', undo: 'undo', redo: 'redo', discard: 'discard', revert: 'revert',
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false });

/**
 * Visible proof that every mutation — drag, inspector field, keyboard, library, lock, undo —
 * flows through one path as schema-typed contract ops (the shape an agent will produce too).
 * Click an entry to see its ops as JSON.
 */
export function EditLogPanel() {
  const log = useEditor((s) => s.opLog);
  const walk = useEditor((s) => s.walkMode);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [open, log.length]);
  if (walk) return null;
  const edits = log.filter((e) => e.ops.length || e.source !== 'immediate');
  return (
    <section className={`edit-log glass ${open ? 'open' : ''}`} aria-label="Edit log">
      <button className="edit-log-header" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Terminal size={13} />
        <span>Edit log</span>
        <span className="count">{edits.length}</span>
        {open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
      </button>
      {open && (
        <div className="edit-log-body" ref={body}>
          {log.length === 0 && <p className="section-note">No edits yet. Every scene operation, schema-typed and validated, appears here.</p>}
          {log.map((e) => (
            <div key={e.id} className="edit-log-entry">
              <button className="edit-log-row" onClick={() => setExpanded(expanded === e.id ? null : e.id)} disabled={!e.ops.length}>
                <span className="edit-log-time">{timeOf(e.at)}</span>
                <span className={`edit-log-source ${e.source}`}>{SOURCE_LABEL[e.source]}</span>
                <span className="edit-log-summary">{e.summary}</span>
              </button>
              {expanded === e.id && <pre className="edit-log-json">{JSON.stringify(e.ops, null, 2)}</pre>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
