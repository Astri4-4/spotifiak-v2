# Device checklist

What the unit tests can't cover: run these on a real iPhone before calling a milestone done.

## Milestone 1

### Player

- [ ] Play an album, lock the phone: music keeps playing; the lock screen shows title, artist, cover and a moving progress bar.
- [ ] Lock screen and Control Center: play/pause, next, previous and scrubbing all work.
- [ ] AirPods / headphones: unplugging (or taking them off) pauses; the play/pause gesture works.
- [ ] A phone call or Siri during playback pauses; music resumes after the call when iOS offers it.
- [ ] Previous within the first 3 seconds goes to the previous track; later it restarts the track.
- [ ] Repeat one loops the track; repeat all wraps from the last track to the first; off stops at the end.
- [ ] Shuffle on keeps the current track; shuffle off continues in album order after it.
- [ ] A track in a format iOS can't read (ogg, opus, wma…) plays after a short delay (server transcode).
- [ ] Kill the app and relaunch: the mini player shows the last track, paused; play resumes it.
