# Device checklist

What the unit tests can't cover: run these on a real iPhone before calling a milestone done.

## Milestone 1

### Login and session

- [ ] Log in with a bare hostname (`music.example.com`): the app finds the API (under `/api` or not).
- [ ] Log in with a LAN address over plain HTTP (`http://192.168.1.10:8080`).
- [ ] A wrong address shows "Serveur Spotifiak introuvable à cette adresse".
- [ ] A wrong password shows the server's message.
- [ ] On a fresh server (no account), the form offers account creation.
- [ ] Revoke the session from the web (log out everywhere, or restart the server with a new secret), then browse: the app returns to Login with the server prefilled.

### Browsing

- [ ] Accueil greets by time of day and shows albums and artists; covers load (file art too, not only Deezer images).
- [ ] Rechercher finds titles, albums and artists as you type; tapping a title plays the results from it.
- [ ] Album: cover, artist link, year, Lecture / Aléatoire, numbered tracks.
- [ ] Artist: picture, albums, tracks.
- [ ] Airplane mode on a screen that loads: "Serveur injoignable" with Réessayer, which works once back online.
- [ ] Long-press a track → "Ajouter à la file d'attente": it plays after the current track.

### Player

- [ ] Play an album, lock the phone: music keeps playing; the lock screen shows title, artist, cover and a moving progress bar.
- [ ] Lock screen and Control Center: play/pause, next, previous and scrubbing all work.
- [ ] AirPods / headphones: unplugging (or taking them off) pauses; double tap skips.
- [ ] A phone call or Siri during playback pauses; music resumes after the call when iOS offers it.
- [ ] Pause, then take a call: music stays paused after hanging up.
- [ ] A queue whose second track fails (file removed on the server): playback skips it with a toast instead of stalling.
- [ ] Revoke the session while music plays: when the next track fails to load, the app returns to Login.
- [ ] Previous within the first 3 seconds goes to the previous track; later it restarts the track.
- [ ] Repeat one loops the track; repeat all wraps from the last track to the first; off stops at the end.
- [ ] Shuffle on keeps the current track; shuffle off continues in album order after it.
- [ ] A track in a format iOS can't read (ogg, opus, wma…) plays after a short delay (server transcode).
- [ ] Kill the app and relaunch: the mini player shows the last track, paused; play resumes it.
