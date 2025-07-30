import { Panel } from "./Panel";

interface PanelState {
  id: string;
  title: string;
  isMinimized: boolean;
  isVisible: boolean;
}

export class PanelManager {
  private static panels = new Map<string, Panel>();

  static registerPanel(id: string, panel: Panel): void {
    this.panels.set(id, panel);
  }

  static unregisterPanel(id: string): void {
    this.panels.delete(id);
  }

  static getPanel(id: string): Panel | undefined {
    return this.panels.get(id);
  }

  static getPanelStates(): PanelState[] {
    const states: PanelState[] = [];
    this.panels.forEach((panel, id) => {
      // Skip the tooltip
      if (id === "info-tooltip") return;

      const title = panel.getTitle();
      const isMinimized = panel.isMinimizedState();
      const isVisible = panel.isVisible();
      states.push({ id, title, isMinimized, isVisible });
    });
    return states;
  }

  static togglePanelVisibility(id: string): void {
    const panel = this.panels.get(id);
    if (!panel) return;

    if (panel.isVisible()) {
      console.log(`${panel.getTitle()} closed.`);
      panel.close();
    } else {
      console.log(`${panel.getTitle()} shown.`);
      panel.show();
    }
  }

  static minimizeAllPanels(excludeIds: string[] = []): void {
    this.panels.forEach((panel, id) => {
      if (id === "info-tooltip" || excludeIds.includes(id) || !panel.isVisible()) return;
      panel.minimize(panel.getTitle());
    });
  }

  static restoreAllPanels(): void {
    this.panels.forEach(panel => panel.maximize());
  }
}

interface PanelOptions {
  startMinimized?: boolean;
}

export function setupPanels(options: PanelOptions = {}) {
  Panel.initialize(options);
}

export function reCenterAllWindows() {
  Panel.reCenterAllWindows();
}

export function minimizeAllWindows() {
  Panel.minimizeWindows();
}