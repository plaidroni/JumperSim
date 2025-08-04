export interface NotificationAction {
  label: string;
  callback: () => void;
  primary?: boolean;
}

export interface NotificationOptions {
  type?: "info" | "success" | "warning" | "error";
  duration?: number; // in milliseconds, 0 for no auto-dismiss
  autoDismiss?: boolean;
  actions?: NotificationAction[];
  dismissible?: boolean;
}

export interface Notification {
  id: string;
  message: string;
  options: NotificationOptions;
  element: HTMLElement;
  timer?: NodeJS.Timeout;
}

export class NotificationManager {
  private static instance: NotificationManager;
  private container: HTMLElement;
  private notifications: Map<string, Notification> = new Map();
  private nextId: number = 1;

  private constructor() {
    this.createContainer();
  }

  public static getInstance(): NotificationManager {
    if (!NotificationManager.instance) {
      NotificationManager.instance = new NotificationManager();
    }
    return NotificationManager.instance;
  }

  private createContainer(): void {
    this.container = document.createElement("div");
    this.container.id = "notification-container";
    this.container.className = "notification-container";
    document.body.appendChild(this.container);
  }

  public show(message: string, options: NotificationOptions = {}): string {
    const id = `notification-${this.nextId++}`;
    const defaultOptions: NotificationOptions = {
      type: "info",
      duration: 10000,
      dismissible: true,
      ...options,
    };

    const notification: Notification = {
      id,
      message,
      options: defaultOptions,
      element: this.createElement(id, message, defaultOptions),
    };

    this.notifications.set(id, notification);
    this.container.appendChild(notification.element);

    // Trigger animation
    requestAnimationFrame(() => {
      notification.element.classList.add("notification-enter");
    });

    // Set auto-dismiss timer
    if (defaultOptions.duration && defaultOptions.duration > 0) {
      notification.timer = setTimeout(() => {
        this.dismiss(id);
      }, defaultOptions.duration);
    }

    return id;
  }

  public dismiss(id: string): void {
    const notification = this.notifications.get(id);
    if (!notification) return;

    // Clear timer if exists
    if (notification.timer) {
      clearTimeout(notification.timer);
    }

    // Animate out
    notification.element.classList.add("notification-exit");

    // Remove after animation
    setTimeout(() => {
      if (notification.element.parentNode) {
        notification.element.parentNode.removeChild(notification.element);
      }
      this.notifications.delete(id);
    }, 300); // Match CSS transition duration
  }

  public dismissAll(): void {
    this.notifications.forEach((_, id) => {
      this.dismiss(id);
    });
  }

  private createElement(
    id: string,
    message: string,
    options: NotificationOptions
  ): HTMLElement {
    const element = document.createElement("div");
    element.className = `notification notification-${options.type}`;
    element.setAttribute("data-notification-id", id);

    const icon = this.getIcon(options.type!);

    const content = document.createElement("div");
    content.className = "notification-content";

    const messageEl = document.createElement("div");
    messageEl.className = "notification-message";
    messageEl.textContent = message;

    content.appendChild(messageEl);

    // Add actions if provided
    if (options.actions && options.actions.length > 0) {
      const actionsEl = document.createElement("div");
      actionsEl.className = "notification-actions";

      options.actions.forEach((action) => {
        const button = document.createElement("button");
        button.className = `notification-action ${
          action.primary ? "primary" : "secondary"
        }`;
        button.textContent = action.label;
        button.onclick = () => {
          action.callback();
          this.dismiss(id);
        };
        actionsEl.appendChild(button);
      });

      content.appendChild(actionsEl);
    }

    // Add dismiss button if dismissible
    if (options.dismissible) {
      const dismissBtn = document.createElement("button");
      dismissBtn.className = "notification-dismiss";
      dismissBtn.innerHTML = "×";
      dismissBtn.onclick = () => this.dismiss(id);
      element.appendChild(dismissBtn);
    }

    element.appendChild(content);

    return element;
  }

  private getIcon(type: string): string {
    const icons = {
      info: "ℹ",
      success: "✓",
      warning: "⚠",
      error: "✕",
    };
    return icons[type] || icons.info;
  }

  // Convenience methods
  public info(
    message: string,
    options?: Omit<NotificationOptions, "type">
  ): string {
    return this.show(message, { ...options, type: "info" });
  }

  public success(
    message: string,
    options?: Omit<NotificationOptions, "type">
  ): string {
    return this.show(message, { ...options, type: "success" });
  }

  public warning(
    message: string,
    options?: Omit<NotificationOptions, "type">
  ): string {
    return this.show(message, { ...options, type: "warning" });
  }

  public error(
    message: string,
    options?: Omit<NotificationOptions, "type">
  ): string {
    return this.show(message, { ...options, type: "error" });
  }
}

// Export singleton instance for easy access
export const notificationManager = NotificationManager.getInstance();
