import { Panel } from "./Panel";

interface PanelState {
  id: string;
  title: string;
  isMinimized: boolean;
  isVisible: boolean;
}

export class PanelManager {
  
  private panels = new Map<string, Panel>();

  constructor(panelList: NodeListOf<HTMLElement>) {
    panelList?.forEach((panel) => {
      let panelInstance: Panel = new Panel(panel);
      this.panels.set(panelInstance.getId(), panelInstance);
    });
  }

  /**
   * Retrieve a panel by it's id from the manager.
   */
  public getPanel(id: string): Panel | undefined {
    return this.panels.get(id);
  }

  getPanelStates(): PanelState[] {
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

  togglePanelVisibility(id: string): void {
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

  minimizeAllPanels(excludeIds: string[] = []): void {
    this.panels.forEach((panel, id) => {
      if (id === "info-tooltip" || excludeIds.includes(id) || !panel.isVisible()) return;
      panel.minimize();
    });
  }

  reCenterAllPanels() {
    this.panels.forEach((panel, id) => {
      panel.center();
    });
  }
  
  restoreAllPanels(): void {
    this.panels.forEach(panel => {
      if (!panel.isVisible()) panel.maximize();
    });
  }
}

interface PanelOptions {
  startMinimized?: boolean;
}



