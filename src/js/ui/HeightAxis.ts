import * as THREE from "three";

interface HeightAxisOptions {
    maxHeight?: number; // in feet
    minHeight?: number; // in feet
    majorInterval?: number; // interval between major ticks in feet
    minorInterval?: number; // interval between minor ticks in feet
    position?: THREE.Vector3;
    colors?: {
        axis: number;
        labels: number;
        exitRange: number;
        workingRange: number;
        deploymentRange: number;
        landingRange: number;
    };
}

const FEET_TO_METERS = 0.3048;
const GRID_EDGE = 4618 / 2;

const DEFAULT_OPTIONS: Required<HeightAxisOptions> = {
    maxHeight: 550, // ~18000 ft in meters
    minHeight: 0,
    majorInterval: 50, // ~1640 ft in meters
    minorInterval: 25, // ~820 ft in meters
    position: new THREE.Vector3(-2000, 0, -2000),
    colors: {
        axis: 0xFFFFFF,
        labels: 0xFFFFFF,
        exitRange: 0x00FF00,      // Above 3660m (~12,000 ft)
        workingRange: 0x00FFFF,   // 1830-3660m (~6,000-12,000 ft)
        deploymentRange: 0xFFFF00, // 760-1830m (~2,500-6,000 ft)
        landingRange: 0xFF0000    // Below 760m (~2,500 ft)
    }
};

export class HeightAxis {
    private object: THREE.Group;
    private axisLine: THREE.Line;
    private labels: THREE.Sprite[] = [];
    private options: Required<HeightAxisOptions>;

    constructor(options: HeightAxisOptions = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.object = new THREE.Group();
        this.createAxis();
        this.createMarkers();
    }

    private createAxis() {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array([
            GRID_EDGE, this.options.minHeight, 0,
            GRID_EDGE, this.options.maxHeight, 0
        ]);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.LineBasicMaterial({ 
            color: this.options.colors.axis,
            transparent: true,
            opacity: 0.7 
        });

        this.axisLine = new THREE.Line(geometry, material);
        this.object.add(this.axisLine);
    }

    private createMarkers() {
        // Add major ticks
        for (let height = this.options.minHeight; height <= this.options.maxHeight; height += this.options.majorInterval) {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array([
                GRID_EDGE, height, -50,
                GRID_EDGE, height, 50
            ]);
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            
            const material = new THREE.LineBasicMaterial({ 
                color: this.getColorForHeight(height),
                transparent: true,
                opacity: 0.7 
            });
            const tick = new THREE.Line(geometry, material);
            this.object.add(tick);
        }
    }

    private getColorForHeight(height: number): number {
        if (height > 3660) return this.options.colors.exitRange;      // Above ~12,000 ft
        if (height > 1830) return this.options.colors.workingRange;   // Above ~6,000 ft
        if (height > 760) return this.options.colors.deploymentRange; // Above ~2,500 ft
        return this.options.colors.landingRange;
    }

    public getObject(): THREE.Group {
        return this.object;
    }

    public setVisible(visible: boolean) {
        this.object.visible = visible;
    }
}