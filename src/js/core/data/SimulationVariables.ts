import { notificationManager } from "../../classes/NotificationManager";

// callback in function for recalculation procedure
export function askForRefresh(onRecalculate?: () => void) {
  console.log("Asking for recalculation due to env var change");
  notificationManager.warning("Simulation Variables Changed", {
    duration: 0,

    actions: [
      {
        label: "Recalculate",
        callback: () => {
          if (onRecalculate) onRecalculate();
        },
      },
    ],
  });
}
