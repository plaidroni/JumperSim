import { Panel } from "./classes/Panel";

interface PanelOptions {
  startMinimized?: boolean;
}

export function setupPanelMinimization(options: PanelOptions = {}) {
  Panel.initialize(options);
}

export function reCenterAllWindows() {
  Panel.reCenterAllWindows();
}
