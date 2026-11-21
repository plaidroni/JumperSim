/**
 * Playback state for the timeline bar. `window.currentTime` is the one sim clock:
 * the render loop (Scripts.ts → advancePlayback) moves it forward while playing, and
 * the scrubber can be dragged at any time — while it's held, playback waits at the
 * dragged time and carries on from there when it's released.
 */

const w = window as any;

w.isPlaying = false;
w.isScrubbing = false;
w.currentTime = 0;
w.maxTime = 250;
w.playbackSpeed = 1; // set by the timeline speed selector

w.playPauseButton = document.getElementById("playPause");
w.scrubber = document.getElementById("scrubber");
w.timeLabel = document.getElementById("timeLabel");
w.rewindButton = document.getElementById("rewind");
w.forwardButton = document.getElementById("forward");
w.startButton = document.getElementById("start");
w.endButton = document.getElementById("end");
w.playbackControlsEl = document.getElementById("playback-controls");

/** Set the sim time (clamped) and show it on the bar. */
w.updateScrubber = function (value: number) {
  const t = Math.max(0, Math.min(w.maxTime, Number(value) || 0));
  w.currentTime = t;
  // don't yank the thumb out from under the pointer while it's being dragged
  if (!w.isScrubbing) w.scrubber.value = t;
  w.timeLabel.textContent = `${t.toFixed(1)}s`;
};

/** Called once per rendered frame with the real seconds since the last one. */
w.advancePlayback = function (dt: number) {
  if (!w.isPlaying || w.isScrubbing) return w.currentTime;
  const next = w.currentTime + dt * (w.playbackSpeed || 1);
  if (next >= w.maxTime) {
    w.updateScrubber(w.maxTime);
    w.pause();
  } else {
    w.updateScrubber(next);
  }
  return w.currentTime;
};

w.play = function () {
  if (w.currentTime >= w.maxTime) w.updateScrubber(0); // replay from the start
  w.isPlaying = true;
  w.playPauseButton.textContent = "⏸";
};

w.pause = function () {
  w.isPlaying = false;
  w.playPauseButton.textContent = "▶";
};

w.playPauseButton.addEventListener("click", () => (w.isPlaying ? w.pause() : w.play()));
w.rewindButton.addEventListener("click", () => w.updateScrubber(w.currentTime - 1));
w.forwardButton.addEventListener("click", () => w.updateScrubber(w.currentTime + 1));
w.startButton.addEventListener("click", () => w.updateScrubber(0));
w.endButton.addEventListener("click", () => w.updateScrubber(w.maxTime));

// Scrubbing: hold the time while the thumb is down, resume playing from the release point.
const scrubber = w.scrubber as HTMLInputElement;
scrubber.addEventListener("pointerdown", () => {
  w.isScrubbing = true;
});
const endScrub = () => {
  if (!w.isScrubbing) return;
  w.isScrubbing = false;
  w.updateScrubber(parseFloat(scrubber.value));
};
scrubber.addEventListener("pointerup", endScrub);
scrubber.addEventListener("pointercancel", endScrub);
scrubber.addEventListener("lostpointercapture", endScrub);
scrubber.addEventListener("change", endScrub);
scrubber.addEventListener("input", () => w.updateScrubber(parseFloat(scrubber.value)));

w.playback = {
  setMaxTime: (time: number) => {
    w.maxTime = time;
    scrubber.max = String(time);
    const total = document.getElementById("timeTotal");
    if (total) total.textContent = ` / ${Math.round(time)} s`;
  },
  setCurrentTime: w.updateScrubber,
  pause: w.pause,
  play: w.play,
};
