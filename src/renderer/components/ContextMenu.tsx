import { create } from 'zustand';
import { useEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  onClick?: () => void;
  separator?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  items: MenuItem[];
  show: (x: number, y: number, items: MenuItem[]) => void;
  hide: () => void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  show: (x, y, items) => set({ open: true, x, y, items }),
  hide: () => set({ open: false, items: [] }),
}));

export function ContextMenuRoot() {
  const { open, x, y, items, hide } = useContextMenuStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) hide();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, hide]);

  if (!open) return null;

  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - items.length * 30 - 10);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] panel bg-panel-raised shadow-xl py-1 text-sm"
      style={{ left, top }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 border-t border-panel-border" />
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            className={`w-full text-left px-3 py-1.5 hover:bg-accent-muted/50 transition-colors disabled:opacity-40
              ${item.danger ? 'text-red-400 hover:bg-red-500/20' : 'text-gray-200'}`}
            onClick={() => {
              item.onClick?.();
              hide();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
