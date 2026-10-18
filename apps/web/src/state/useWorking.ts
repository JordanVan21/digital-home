import { useStore } from "zustand";
import { editor } from "./editor";

/** A piece as the user currently sees it: from the draft if one exists, else the accepted room. */
export function useWorkingObject(id: string | null) {
  const hasDraft = useStore(editor.draft, (s) => s.scene !== null);
  const fromDraft = useStore(editor.draft, (s) =>
    s.scene?.objects.find((o) => o.id === id),
  );
  const fromAccepted = useStore(editor.scene, (s) =>
    s.scene.objects.find((o) => o.id === id),
  );
  return hasDraft ? fromDraft : fromAccepted;
}
