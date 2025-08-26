import { notificationManager } from "../../classes/NotificationManager";

// Track active refresh prompts by source to prevent duplicates
const activeRefreshBySource = new Map<string, string>();

// callback in function for recalculation procedure
export function askForRefresh(
  onRecalculate?: () => void,
  autoRecalculate: boolean = false,
  source?: string
) {
  console.log("Asking for recalculation due to env var change");
  if (autoRecalculate && onRecalculate) {
    onRecalculate();
    return;
  }
  // If the same source already has an active prompt, don't re-display
  if (source) {
    const existingId = activeRefreshBySource.get(source);
    if (existingId) {
      const el = document.querySelector(
        `[data-notification-id="${existingId}"]`
      );
      if (el) return; // still visible; skip re-showing
      activeRefreshBySource.delete(source);
    }
  }

  const id = notificationManager.warning("Simulation Variables Changed", {
    duration: 0,
    actions: [
      {
        label: "Recalculate",
        callback: () => {
          if (onRecalculate) onRecalculate();
          if (source) activeRefreshBySource.delete(source);
        },
        primary: true,
      },
      {
        label: "Dismiss",
        callback: () => {
          if (source) activeRefreshBySource.delete(source);
        },
      },
    ],
  });

  if (source) activeRefreshBySource.set(source, id);
}
