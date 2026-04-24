import * as THREE from "three";
import mapboxgl from "mapbox-gl";

// Load environment variables in development
const env = import.meta.env;
if (env.VITE_MAPBOX_TOKEN) {
  mapboxgl.accessToken = env.VITE_MAPBOX_TOKEN;
}

export class MapboxCanvasRenderer {
  private map: mapboxgl.Map | null = null;
  private canvas: HTMLCanvasElement | null = null;
  public texture: THREE.CanvasTexture | null = null;
  private container: HTMLElement | null = null;
  private isReady: boolean = false;

  /**
   * Initialize the Mapbox GL renderer with a hidden canvas
   * @param lat - Latitude for map center
   * @param lon - Longitude for map center
   * @param zoom - Zoom level (default: 14)
   * @returns Promise that resolves when map is loaded
   */
  async initialize(lat: number, lon: number, zoom: number = 14): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Check for Mapbox token
        if (!mapboxgl.accessToken) {
          console.warn("Mapbox token not set. Using fallback.");
          this.isReady = false;
          resolve();
          return;
        }

        // Create hidden container for Mapbox GL
        this.container = document.createElement("div");
        this.container.id = "mapbox-canvas-container";
        this.container.style.position = "absolute";
        this.container.style.top = "-9999px";
        this.container.style.width = "512px";
        this.container.style.height = "512px";
        document.body.appendChild(this.container);

        // Initialize Mapbox GL map
        this.map = new mapboxgl.Map({
          container: this.container,
          style: "mapbox://styles/mapbox/dark-v11",
          center: [lon, lat],
          zoom: zoom,
          pitch: 0,
          bearing: 0,
          interactive: false,
          antialias: true,
          preserveDrawingBuffer: true,
        });

        // Wait for map to load
        this.map.on("load", () => {
          this.canvas = this.map!.getCanvas();
          this.texture = new THREE.CanvasTexture(this.canvas!);
          this.texture.magFilter = THREE.LinearFilter;
          this.texture.minFilter = THREE.LinearFilter;
          this.isReady = true;
          resolve();
        });

        // Handle errors
        this.map.on("error", (e: any) => {
          console.error("Mapbox GL error:", e);
          this.isReady = false;
          resolve(); // Resolve anyway to allow fallback
        });
      } catch (err) {
        console.error("Failed to initialize Mapbox renderer:", err);
        this.isReady = false;
        resolve(); // Resolve to allow fallback
      }
    });
  }

  /**
   * Get the canvas texture for use in THREE.js
   */
  getTexture(): THREE.CanvasTexture | null {
    return this.texture;
  }

  /**
   * Check if renderer is ready
   */
  isInitialized(): boolean {
    return this.isReady && this.map !== null && this.canvas !== null;
  }

  /**
   * Update canvas texture (call each frame)
   */
  updateCanvasTexture(): void {
    if (this.texture && this.isReady) {
      this.texture.needsUpdate = true;
    }
  }

  /**
   * Update map position (useful for camera-based interactions)
   */
  setCenter(lat: number, lon: number): void {
    if (this.map && this.isReady) {
      this.map.setCenter([lon, lat]);
    }
  }

  /**
   * Update map zoom level
   */
  setZoom(zoom: number): void {
    if (this.map && this.isReady) {
      this.map.setZoom(zoom);
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }

    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
      this.container = null;
    }

    this.canvas = null;
    this.isReady = false;
  }
}
