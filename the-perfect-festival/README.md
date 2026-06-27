# The Perfect Festival

Statische Browser-Game-Seite (HTML/CSS/JS + `data.json`). Kein Backend.

## Lokal testen
`data.json` wird per fetch geladen, daher braucht es einen lokalen Server (nicht `file://`):
```
python3 -m http.server
# dann http://localhost:8000
```

## Auf GitHub Pages hosten
Wichtig: Der **Inhalt dieses Ordners** muss im Repo-Root liegen (also `index.html`,
`data.json`, `index_files/` direkt im Wurzelverzeichnis), damit die relativen Pfade passen.

```
git init
git add .
git commit -m "The Perfect Festival"
git branch -M main
git remote add origin https://github.com/<DEIN-USER>/perfect-festival.git
git push -u origin main
```
Dann im Repo: **Settings → Pages → Source: "Deploy from a branch" → main / (root) → Save.**
Nach ~1 Minute ist die Seite unter `https://<DEIN-USER>.github.io/perfect-festival/` live.

Die `.nojekyll`-Datei verhindert, dass GitHubs Jekyll-Build die Dateien anfasst.

## Noch anzupassen
- Share-Link-Platzhalter in `index_files/app.js` (`https://theperfectfestival.example`)
  auf deine echte Pages-URL ändern.
- Optional eigene Domain unter Settings → Pages → Custom domain.
