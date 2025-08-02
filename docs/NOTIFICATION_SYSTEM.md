# Notification System Documentation

## Overview

The JumperSim notification system provides a modern, user-friendly way to display important information and alerts to users. The system follows Material Design principles and provides auto-dismissing notifications with optional action buttons.

## Features

### ✅ Core Requirements Met
- **Auto-dismiss**: Notifications disappear after 10 seconds by default (configurable)
- **Action buttons**: Support for interactive buttons with callbacks
- **High z-index**: Uses z-index 10000 to appear above all other components
- **Material UI inspired**: Clean, modern design following Material Design principles

### ✅ Additional Features
- **Four notification types**: info (blue), success (green), warning (orange), error (red)
- **Manual dismiss**: Close button on all notifications
- **Smooth animations**: CSS transitions for appear/disappear
- **Responsive design**: Works on mobile and desktop
- **Accessibility**: High contrast and reduced motion support
- **Global access**: Available anywhere via `window.notificationManager`

## Usage Examples

### Basic Notifications
```javascript
// Simple info notification
window.notificationManager.info("Simulation loaded successfully!");

// Success notification
window.notificationManager.success("Formation data loaded!");

// Warning notification  
window.notificationManager.warning("Weather data unavailable - using defaults");

// Error notification
window.notificationManager.error("Connection failed");
```

### Advanced Notifications with Actions
```javascript
// Notification with action button
window.notificationManager.error("Weather data unavailable", {
  duration: 8000, // 8 seconds
  actions: [
    {
      label: "Retry",
      callback: () => {
        console.log("Retrying weather fetch...");
        fetchWeatherData();
      },
      primary: true
    }
  ]
});

// Notification that doesn't auto-dismiss
window.notificationManager.error("Critical error", {
  duration: 0, // No auto-dismiss
  dismissible: true, // Still manually dismissible
  actions: [
    { label: "Retry", callback: retryOperation, primary: true },
    { label: "Report", callback: reportError }
  ]
});
```

### Configuration Options
```typescript
interface NotificationOptions {
  type?: 'info' | 'success' | 'warning' | 'error';
  duration?: number; // in milliseconds, 0 for no auto-dismiss
  actions?: NotificationAction[];
  dismissible?: boolean; // default: true
}

interface NotificationAction {
  label: string;
  callback: () => void;
  primary?: boolean; // primary styling
}
```

## Current Integrations

### 1. Formation Loading
- **Success**: When formations load successfully with jumper count
- **Warning**: When formation loading fails and defaults are used
- **Action**: "View Objects" button to open the Scene Objects panel

### 2. Weather System
- **Success**: When weather data loads successfully from API
- **Error**: When weather API fails with retry functionality
- **Action**: "Retry" button to attempt weather fetch again

### 3. System Status
- Ready for integration with simulation refresh events
- Can be used for save/load operations
- Suitable for settings changes confirmation

## Technical Implementation

### Files Added/Modified
- `src/js/classes/NotificationManager.ts` - Core notification management
- `src/css/notification.css` - Styling and animations
- `index.html` - Added CSS import
- `src/js/scripts.ts` - Integration and global access
- `src/apidata/openMateo.ts` - Weather error notifications

### Architecture
- **Singleton pattern**: One NotificationManager instance
- **DOM management**: Creates/removes notification elements dynamically
- **CSS animations**: Smooth slide-in/slide-out transitions
- **Event handling**: Automatic cleanup of expired notifications

### Z-Index Hierarchy
- Notifications: `z-index: 10000`
- Menu bar: `z-index: 10001` 
- Other panels: `z-index: 9999` and below

## Future Enhancement Ideas

1. **Sound notifications** for critical alerts
2. **Notification history** panel showing past notifications
3. **Notification persistence** across browser sessions
4. **Custom templates** for specific notification types
5. **Push notification integration** for background updates
6. **Notification categories** with filtering options
7. **Bulk operations** (dismiss all, etc.)

## Browser Compatibility

- Modern browsers supporting CSS Grid and Flexbox
- ES6+ JavaScript features (async/await, classes, arrow functions)
- CSS Custom Properties support
- Tested on Chrome, Firefox, Safari, Edge

## Accessibility Features

- **High contrast mode**: Enhanced borders and colors
- **Reduced motion**: Respects `prefers-reduced-motion` media query
- **Keyboard navigation**: Focus management for action buttons
- **Screen reader**: Semantic HTML structure
- **Color coding**: Not relying solely on color for information

## Performance Considerations

- **Lightweight**: Minimal DOM impact
- **Cleanup**: Automatic removal of dismissed notifications
- **Memory management**: No memory leaks from event listeners
- **CSS optimization**: Hardware-accelerated animations