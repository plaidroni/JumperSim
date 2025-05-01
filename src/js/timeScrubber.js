window.isPlaying = false;
window.currentTime = 0;
window.maxTime = 100;
window.playbackInterval = null;

window.playPauseButton = document.getElementById("playPause");
window.scrubber = document.getElementById("scrubber");
window.timeLabel = document.getElementById("timeLabel");
window.rewindButton = document.getElementById("rewind");
window.forwardButton = document.getElementById("forward");
window.startButton = document.getElementById("start");
window.endButton = document.getElementById("end");
window.playbackControlsEl = document.getElementById("playback-controls");
const titlebar = document.getElementById("playback-titlebar");
const playbackBody = document.getElementById("playback-body");

window.updateScrubber = function (value) {
  window.currentTime = Math.max(0, Math.min(window.maxTime, value));
  window.scrubber.value = window.currentTime;
  window.timeLabel.textContent = `${window.currentTime.toFixed(1)}s`;
};

window.play = function () {
  window.isPlaying = true;
  window.playPauseButton.textContent = "⏸️";
  window.playbackInterval = setInterval(() => {
    if (window.currentTime < window.maxTime) {
      window.updateScrubber(window.currentTime + 0.1);
    } else {
      window.pause();
    }
  }, 100);
};

window.pause = function () {
  window.isPlaying = false;
  window.playPauseButton.textContent = "▶️";
  clearInterval(window.playbackInterval);
};

window.playPauseButton.addEventListener("click", () => {
  window.isPlaying ? window.pause() : window.play();
});

window.rewindButton.addEventListener("click", () =>
  window.updateScrubber(window.currentTime - 1)
);
window.forwardButton.addEventListener("click", () =>
  window.updateScrubber(window.currentTime + 1)
);
window.startButton.addEventListener("click", () => window.updateScrubber(0));
window.endButton.addEventListener("click", () =>
  window.updateScrubber(window.maxTime)
);
window.scrubber.addEventListener("input", (e) =>
  window.updateScrubber(parseFloat(e.target.value))
);

window.playback = {
  setMaxTime: (time) => {
    window.maxTime = time;
    window.scrubber.max = time;
  },
  setCurrentTime: window.updateScrubber,
  pause: window.pause,
  play: window.play,
};

// Draggable via title bar
let isDragging = false;
let offsetX = 0;
let offsetY = 0;

titlebar.addEventListener("mousedown", (e) => {
  isDragging = true;
  offsetX = e.clientX - window.playbackControlsEl.offsetLeft;
  offsetY = e.clientY - window.playbackControlsEl.offsetTop;
});

document.addEventListener("mousemove", (e) => {
  if (isDragging) {
    window.playbackControlsEl.style.left = `${e.clientX - offsetX}px`;
    window.playbackControlsEl.style.top = `${e.clientY - offsetY}px`;
  }
});

document.addEventListener("mouseup", () => {
  isDragging = false;
});

document.getElementById("minimize-playback").addEventListener("click", () => {
  playbackBody.style.display =
    playbackBody.style.display === "none" ? "flex" : "none";
});
