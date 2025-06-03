async function loadDropzones() {
  const response = await fetch("/src/json/dropzones.json");
  const dropzones = await response.json();

  const select = document.getElementById("dropzone-select");
  const detailsDiv = document.getElementById("dropzone-details");

  dropzones.forEach((dz, index) => {
    const option = document.createElement("option");
    option.value = index;
    option.textContent = dz.name;
    select.appendChild(option);
  });

  select.addEventListener("change", (event) => {
    const selectedIndex = event.target.value;

    if (selectedIndex !== "") {
      const dz = dropzones[selectedIndex];
      (<any>window).selectedDropzone = dz;
      console.log((<any>window).selectedDropzone);
      detailsDiv.innerHTML = `
          <strong>${dz.name}</strong><br>
          Country: ${dz.country}<br>
          Latitude: ${dz.latitude}<br>
          Longitude: ${dz.longitude}
        `;
    } else {
      detailsDiv.innerHTML = "";
    }
  });
}

loadDropzones().catch(console.error);
