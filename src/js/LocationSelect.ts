import { declareParams, fetchWeatherData } from "../apidata/OpenMateo";
import { getCookie, setCookie } from "./Utils";
import { loadEnv } from "vite";
import * as THREE from "three";
import { signalMeshReady } from "./Scripts";

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
  // if no cookie is found, then load Skydive Perris
  if (!savedIndex) {
    select.value = "2";
    triggerSelection(dropzones, 2);
  }
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
    const mapUrl = `/.netlify/functions/mapbox-proxy?lat=${centerLat}&lon=${centerLon}&zoom=${zoom}`;
    const planeSize = 4618;

    const gridHelper = new THREE.GridHelper(planeSize, 16);
    (window as any).gridHelper = gridHelper;
    scene.add(gridHelper);

    try {
      const response = await fetch(mapUrl);
      if (!response.ok) throw new Error("Failed to load map image");

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const loader = new THREE.TextureLoader();
      const texture = await new Promise((resolve, reject) => {
        loader.load(objectUrl, resolve, undefined, reject);
      });

      const geometry = new THREE.PlaneGeometry(planeSize, planeSize);
      let material = new THREE.MeshBasicMaterial({ map: texture });

      const mapPlane = new THREE.Mesh(geometry, material);

      (window as any).mapPlane = mapPlane;
      mapPlane.rotation.x = -Math.PI / 2;

      scene.add(mapPlane);
      signalMeshReady();
    } catch (err) {
      const geometry = new THREE.PlaneGeometry(planeSize, planeSize);

      const material = new THREE.MeshBasicMaterial({
        wireframe: true,
      });

      const mapPlane = new THREE.Mesh(geometry, material);
      (window as any).mapPlane = mapPlane;
      mapPlane.rotation.x = -Math.PI / 2;
      scene.add(mapPlane);
      console.error("Map texture load failed. Did you check the API Key?", err);
      signalMeshReady();
    }
  }
}
