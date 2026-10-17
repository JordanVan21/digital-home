import { create } from "zustand";

export type EditorTool = "select" | "move" | "rotate";

interface InteractionState {
  tool: EditorTool;
  hoveredId: string | null;
  isDragging: boolean;
  inspectorCollapsed: boolean;
  resetViewToken: number;
  topDownToken: number;
  showMeasurements: boolean;

  setTool: (tool: EditorTool) => void;
  setHovered: (id: string | null) => void;
  setDragging: (dragging: boolean) => void;
  toggleInspector: () => void;
  requestResetView: () => void;
  requestTopDownView: () => void;
  toggleMeasurements: () => void;
}

export const useInteractionStore = create<InteractionState>((set) => ({
  tool: "select",
  hoveredId: null,
  isDragging: false,
  inspectorCollapsed: false,
  resetViewToken: 0,
  topDownToken: 0,
  showMeasurements: false,

  setTool: (tool) => set({ tool }),
  setHovered: (id) => set({ hoveredId: id }),
  setDragging: (isDragging) => set({ isDragging }),
  toggleInspector: () => set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed })),
  requestResetView: () => set((s) => ({ resetViewToken: s.resetViewToken + 1 })),
  requestTopDownView: () => set((s) => ({ topDownToken: s.topDownToken + 1 })),
  toggleMeasurements: () => set((s) => ({ showMeasurements: !s.showMeasurements })),
}));
