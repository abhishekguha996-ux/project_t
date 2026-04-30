"use client";

import { Undo2 } from "lucide-react";
import { useEffect, useState } from "react";

import styles from "./reception-workspace.module.css";
import type { UndoAction } from "./types";

type UndoToastProps = {
  action: UndoAction | null;
  onUndo: () => void;
  onDismiss: () => void;
};

export function UndoToast({ action, onUndo, onDismiss }: UndoToastProps) {
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    if (!action) return;
    const total = Math.max(1, action.expiresAt - Date.now());
    const start = Date.now();
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, action.expiresAt - Date.now());
      setProgress(remaining / total);
      if (remaining === 0) {
        window.clearInterval(interval);
      }
    }, 50);
    setProgress(Math.max(0, (action.expiresAt - start) / total));
    return () => window.clearInterval(interval);
  }, [action]);

  if (!action) return null;

  return (
    <div className={styles.undoToast} role="status" aria-live="polite">
      <span className={styles.undoLabel}>{action.label}</span>
      <button
        type="button"
        className={styles.undoButton}
        onClick={() => {
          action.revert();
          onUndo();
        }}
      >
        <Undo2 size={14} />
        Undo
      </button>
      <button
        type="button"
        className={styles.undoDismiss}
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
      <span
        className={styles.undoProgress}
        style={{ transform: `scaleX(${progress})` }}
        aria-hidden
      />
    </div>
  );
}
