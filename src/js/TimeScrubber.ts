(<any>window).isPlaying = false;
(<any>window).currentTime = 0;
(<any>window).maxTime = 250;
(<any>window).playbackInterval = null;

(<any>window).playPauseButton = document.getElementById("playPause");
(<any>window).scrubber = document.getElementById("scrubber");
(<any>window).timeLabel = document.getElementById("timeLabel");
(<any>window).rewindButton = document.getElementById("rewind");
(<any>window).forwardButton = document.getElementById("forward");
(<any>window).startButton = document.getElementById("start");
(<any>window).endButton = document.getElementById("end");
(<any>window).playbackControlsEl = document.getElementById("playback-controls");
const titlebar = document.getElementById("playback-titlebar");
const playbackBody = document.getElementById("playback-body");

(<any>window).updateScrubber = function (value) {
  (<any>window).currentTime = Math.max(
    0,
    Math.min((<any>window).maxTime, value)
  );
  (<any>window).scrubber.value = (<any>window).currentTime;
  (<any>window).timeLabel.textContent = `${(<any>window).currentTime.toFixed(
    1
  )}s`;
};

(<any>window).play = function () {
  (<any>window).isPlaying = true;
  (<any>window).playPauseButton.textContent = "⏸";
  (<any>window).playbackInterval = setInterval(() => {
    if ((<any>window).currentTime < (<any>window).maxTime) {
      (<any>window).updateScrubber((<any>window).currentTime + 0.1);
    } else {
      (<any>window).pause();
    }
  }, 100);
};

(<any>window).pause = function () {
  (<any>window).isPlaying = false;
  (<any>window).playPauseButton.textContent = "⏵";
  clearInterval((<any>window).playbackInterval);
};

(<any>window).playPauseButton.addEventListener("click", () => {
  (<any>window).isPlaying ? (<any>window).pause() : (<any>window).play();
});

(<any>window).rewindButton.addEventListener("click", () =>
  (<any>window).updateScrubber((<any>window).currentTime - 1)
);
(<any>window).forwardButton.addEventListener("click", () =>
  (<any>window).updateScrubber((<any>window).currentTime + 1)
);
(<any>window).startButton.addEventListener("click", () =>
  (<any>window).updateScrubber(0)
);
(<any>window).endButton.addEventListener("click", () =>
  (<any>window).updateScrubber((<any>window).maxTime)
);
(<any>window).scrubber.addEventListener("input", (e) =>
  (<any>window).updateScrubber(parseFloat(e.target.value))
);

(<any>window).playback = {
  setMaxTime: (time) => {
    (<any>window).maxTime = time;
    (<any>window).scrubber.max = time;
  },
  setCurrentTime: (<any>window).updateScrubber,
  pause: (<any>window).pause,
  play: (<any>window).play,
};

let isDragging = false;
let offsetX = 0;
let offsetY = 0;

document.addEventListener("mousemove", (e) => {
  if (isDragging) {
    (<any>window).playbackControlsEl.style.left = `${e.clientX - offsetX}px`;
    (<any>window).playbackControlsEl.style.top = `${e.clientY - offsetY}px`;
  }
});

document.addEventListener("mouseup", () => {
  isDragging = false;
});

// document.getElementById("minimize-playback").addEventListener("click", () => {
//   playbackBody.style.display =
//     playbackBody.style.display === "none" ? "flex" : "none";
// });
