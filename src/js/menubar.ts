document.querySelector("#weather-tab-visible");
document.querySelector("#location-tab-visible");
document.querySelector("#playback-controls-tab-visible");
document.querySelector("#formation-tab-visible");
document.querySelector("#plane-tab-visible");
document.querySelector("#scene-tab-visible");
document.querySelector("#speed-tab-visible");
document.querySelector("#credits-tab-visible");

function handleClick(name) {
  console.log(`Clicked: ${name}`);
}

function handleToggle(checkbox, label) {
  console.log(`${label} is now ${checkbox.checked ? "enabled" : "disabled"}`);
}
