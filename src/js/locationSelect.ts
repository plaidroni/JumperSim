import { declareParams, fetchWeatherData } from "../apidata/openMateo";
import { getCookie, setCookie } from "./utils";

async function loadDropzones() {
  const response = await fetch("/src/json/dropzones.json");
  const dropzones = await response.json();

  const select = document.getElementById(
    "dropzone-select"
  ) as HTMLSelectElement;
  const detailsDiv = document.getElementById("dropzone-details");

  // Populate dropdown
  dropzones.forEach((dz, index) => {
    const option = document.createElement("option");
    option.value = index.toString();
    option.textContent = dz.name;
    select.appendChild(option);
  });

  // Restore selection from cookie if exists
  const savedIndex = getCookie("selectedDropzoneIndex");
  if (savedIndex && dropzones[savedIndex]) {
    select.value = savedIndex;
    triggerSelection(dropzones, parseInt(savedIndex));
  }

  select.addEventListener("change", (event) => {
    const selectedIndex = (event.target as HTMLSelectElement).value;
    if (selectedIndex !== "") {
      setCookie("selectedDropzoneIndex", selectedIndex, 30); // Save for 30 days
      triggerSelection(dropzones, parseInt(selectedIndex));
    } else {
      detailsDiv.innerHTML = "";
    }
  });

  function triggerSelection(dropzones: any[], index: number) {
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
  }
}

loadDropzones().catch(console.error);
