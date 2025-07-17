import { declareParams, fetchWeatherData } from "../apidata/openMateo";
import { getCookie, setCookie } from "./utils";
import { loadEnv } from "vite";
import * as THREE from "three";
import { signalMeshReady } from "./scripts";

export async function loadDropzones(scene: THREE.Scene) {
  const response = await fetch("/json/dropzones.json");
  const dropzones = await response.json();

  const select = document.getElementById(
    "dropzone-select"
  ) as HTMLSelectElement;
  const detailsDiv = document.getElementById("dropzone-details");

  dropzones.forEach((dz, index) => {
    const option = document.createElement("option");
    option.value = index.toString();
    option.textContent = dz.name;
    select.appendChild(option);
  });

  // this is for the ready callback for our systems OK in scripts.ts
  // let readyResolve: () => void;
  // const readyPromise = new Promise<void>((resolve) => {
  //   readyResolve = resolve;
  // });

  const savedIndex = getCookie("selectedDropzoneIndex");
  if (savedIndex && dropzones[savedIndex]) {
    select.value = savedIndex;
    triggerSelection(dropzones, parseInt(savedIndex));
  }

  select.addEventListener("change", (event) => {
    const selectedIndex = (event.target as HTMLSelectElement).value;
    if (selectedIndex !== "") {
      setCookie("selectedDropzoneIndex", selectedIndex, 30);
      triggerSelection(dropzones, parseInt(selectedIndex));
    } else {
      detailsDiv.innerHTML = "";
    }
  });

  function loadTexture(url: string): Promise<THREE.Texture> {
    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(url, resolve, undefined, reject);
    });
  }

  async function triggerSelection(dropzones: any[], index: number) {
    console.log("loading selection");
    const dz = dropzones[index];
    (window as any).selectedDropzone = dz;
    console.log("Selected DZ:", dz);

    detailsDiv.innerHTML = `
      <strong>${dz.name}</strong><br>
      Country: ${dz.country}<br>
      Latitude: ${dz.latitude}<br>
      Longitude: ${dz.longitude}
    `;

    declareParams();
    fetchWeatherData();

    const centerLat = dz.latitude;
    const centerLon = dz.longitude;
    const zoom = 14;
    const accessToken = import.meta.env.VITE_MAPBOX;
    const mapStyle = "mapbox/dark-v11";

    const mapUrl = `https://api.mapbox.com/styles/v1/${mapStyle}/static/${centerLon},${centerLat},${zoom}/512x512?access_token=${accessToken}`;

    const loader = new THREE.TextureLoader();
    const texture = await loadTexture(mapUrl);
    const planeSize = 4618;
    const geometry = new THREE.PlaneGeometry(planeSize, planeSize);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const mapPlane = new THREE.Mesh(geometry, material);
    mapPlane.rotation.x = -Math.PI / 2;
    scene.add(mapPlane);

    const gridHelper = new THREE.GridHelper(planeSize, 16);
    scene.add(gridHelper);

    signalMeshReady();
  }
}
