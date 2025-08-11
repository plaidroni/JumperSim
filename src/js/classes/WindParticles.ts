import * as THREE from "three";
import { WeatherSnapshot } from "../../apidata/OpenMateo";

// Stores original positions and accumulated offsets
type ParticleData = {
    originalX: number;
    originalZ: number;
    offsetX: number;
    offsetZ: number;
};

export function createWindParticles(scene: THREE.Scene, snapshot: WeatherSnapshot): THREE.Points {
    const particleCount = 2000;
    const particles = new THREE.BufferGeometry();
    
    // Create storage for particle data
    const particleData: ParticleData[] = [];
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    // Initialize particles
    for (let i = 0; i < particleCount; i++) {
        const x = (Math.random() - 0.5) * 2000;
        const y = Math.random() * 10000; // 0-10,000m altitude
        const z = (Math.random() - 0.5) * 2000;

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        // Store original positions and initialize offsets
        particleData.push({
            originalX: x,
            originalZ: z,
            offsetX: 0,
            offsetZ: 0
        });

        // Color by altitude (blue to white)
        colors[i * 3] = 0.5 + (y / 10000) * 0.5;
        colors[i * 3 + 1] = 0.5 + (y / 10000) * 0.5;
        colors[i * 3 + 2] = 1.0;
    }

    particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particles.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 6,
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
        sizeAttenuation: true
    });

    const system = new THREE.Points(particles, material);
    system.userData = {
        windData: snapshot,
        particleData: particleData,
        lastUpdateTime: 0
    };

    scene.add(system);
    return system;
}

export function updateWindParticles(particleSystem: THREE.Points, currentTime: number, isPlaying: boolean): void {
    if (!isPlaying) return;

    const { windData, particleData, lastUpdateTime } = particleSystem.userData;
    if (!windData || !particleData) return;

    const positions = particleSystem.geometry.attributes.position.array as Float32Array;
    const deltaTime = currentTime - lastUpdateTime;
    particleSystem.userData.lastUpdateTime = currentTime;

    const mphToMs = 0.44704;
    const movementScale = 5;
    const maxTravelDistance = 1000; // Reset particles after they've moved this far (meters)

    for (let i = 0; i < particleData.length; i++) {
        const { originalX, originalZ } = particleData[i];
        const y = positions[i * 3 + 1]; // Current altitude

        // Check if particle needs reset (moved too far)
        const currentDistance = Math.sqrt(
            Math.pow(particleData[i].offsetX, 2) + 
            Math.pow(particleData[i].offsetZ, 2)
        );

        if (currentDistance > maxTravelDistance) {
            // Reset to original position
            particleData[i].offsetX = 0;
            particleData[i].offsetZ = 0;
            positions[i * 3] = originalX;
            positions[i * 3 + 2] = originalZ;
            continue;
        }

        // Altitude to pressure level mapping
        let level;
        if (y <= 50) level = "10m";
        else if (y <= 300) level = "1000hPa";
        else if (y <= 600) level = "975hPa";
        else if (y <= 900) level = "950hPa";
        else if (y <= 1200) level = "925hPa";
        else if (y <= 1500) level = "900hPa";
        else if (y <= 2000) level = "850hPa";
        else if (y <= 3000) level = "800hPa";
        else if (y <= 4000) level = "700hPa";
        else if (y <= 5000) level = "600hPa";
        else level = "500hPa";

        // Get wind data
        const speedMph = parseFloat((windData.windSpeeds[level] || "0 mph").split(" ")[0]);
        const directionDeg = parseFloat((windData.windDirections[level] || "0°").split("°")[0]);
        const speedMs = speedMph * mphToMs;

        // Calculate wind vector
        const angleRad = THREE.MathUtils.degToRad(directionDeg);
        const windZ = -Math.sin(angleRad) * speedMs * deltaTime * movementScale;
        const windX = -Math.cos(angleRad) * speedMs * deltaTime * movementScale;

        // Accumulate movement
        particleData[i].offsetX += windX;
        particleData[i].offsetZ += windZ;

        // Update positions
        positions[i * 3] = originalX + particleData[i].offsetX;
        positions[i * 3 + 2] = originalZ + particleData[i].offsetZ;
    }

    particleSystem.geometry.attributes.position.needsUpdate = true;
}

// Reset function for when playback restarts
export function resetWindParticles(particleSystem: THREE.Points): void {
    const { particleData } = particleSystem.userData;
    const positions = particleSystem.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < particleData.length; i++) {
        particleData[i].offsetX = 0;
        particleData[i].offsetZ = 0;
        positions[i * 3] = particleData[i].originalX;
        positions[i * 3 + 2] = particleData[i].originalZ;
    }

    particleSystem.geometry.attributes.position.needsUpdate = true;
    particleSystem.userData.lastUpdateTime = 0;
}