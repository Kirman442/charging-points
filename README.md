# Ladeinfrastruktur in Deutschland

Interaktive Karte öffentlicher Ladeinfrastruktur mit regionaler Analyse und einem Autobahnmodus für A1–A9. Oberfläche auf Deutsch und Russisch, mit heller und dunkler Karte.

## Funktionen

- Filter nach Bundesland, Ladepunktleistung, DC und 24/7-Zugang am gesamten Standort.
- Standorte, Stationen und Ladepunkte; Ladepunktleistung und Nennleistung der Stationen werden getrennt dargestellt.
- BEV-Bestand, Ladepunkte und kW je 1.000 BEV sowie Infrastrukturanteile der Betreiber.
- Standortkarten, Kartengruppen, eine Liste nahe der Kartenmitte und Rückkehr zur bisherigen Listenansicht.
- Erreichbarkeit entlang der Autobahnen anhand eines gespeicherten OSM-Straßenmodells.

## Daten und Grenzen

Ladedaten: BNetzA, Stand 01.09.2026. Fahrzeugbestand: KBA, Stand 01.01.2026. Gebietsgeometrien: BKG; Straßenmodell: OpenStreetMap. Es handelt sich um Datenstände, ohne Live-Belegungs- oder Verfügbarkeitsinformationen.

Eine gefundene Modellroute bestätigt keine tatsächliche Zufahrt. Im Autobahnmodell gelten Zufahrt und Rückfahrt von jeweils höchstens 3 km sowie eine Straßenanbindung innerhalb von 60 m. Für die berechneten Strecken werden Standorte mit mindestens 400 kW Nennleistung und mindestens einem DC-Ladepunkt ab 150 kW berücksichtigt. Zufahrtsbedingungen und ungeklärte Straßenanbindungen werden gesondert dargestellt. Physische Unterbrechungen der Autobahnen bleiben erhalten. Dies ist keine Prüfung der AFIR-Konformität.

Die Quellenhinweise und Lizenzangaben sind in der Karte und in den Datenbeschreibungen enthalten. [BNetzA-Ladeinfrastruktur](https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/start.html), [OpenStreetMap-Lizenzhinweise](https://www.openstreetmap.org/copyright).

## Lokal starten

Node.js 24 und npm verwenden:

```sh
npm ci
npm run dev
```

Die von Vite angezeigte Adresse mit dem Pfad `/charging-points/` öffnen. Eine HTML-Datei direkt zu öffnen startet die Anwendung nicht.

```sh
npm run lint
npm test
npm run build
npm run preflight
npm run preview -- --host 127.0.0.1 --port 4175 --strictPort
```

## Veröffentlichung

GitHub Actions prüft und baut die Anwendung bei einem Push auf `main`; veröffentlicht wird ausschließlich `dist`. Die Build-Konfiguration übernimmt nur die benötigten Laufzeitdaten, das Favicon und die Datenbeschreibungen. Referenztabellen für Tests werden nicht auf die Website kopiert.

Offline-Rechenwerkzeuge, Zwischenergebnisse und interne Entwicklungsjournale gehören nicht zu diesem Anwendungsrepository. Die vorhandenen Ergebnisse werden verwendet, ohne beim Build neue Straßenberechnungen auszuführen.

React, deck.gl, MapLibre und Arrow/Parquet; Datenverarbeitung in Web Workers.
