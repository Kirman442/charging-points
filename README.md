# Ladeinfrastruktur in Deutschland

[Interaktive Karte öffnen](https://kirman442.github.io/charging-points/)

Eine interaktive Karte der öffentlich zugänglichen Ladeinfrastruktur in Deutschland. Sie verbindet das Ladesäulenregister mit dem Bestand batterieelektrischer Pkw und zeigt regionale Unterschiede sowie ein experimentelles Straßenmodell für die Autobahnen A1–A9.

## Funktionen

- Ladestandorte, Ladepunkte, AC/DC und Nennleistung auf der Karte und in einer Standortliste erkunden.
- Nach Bundesland, Leistung, DC und Öffnung rund um die Uhr filtern.
- Ladepunkte und Leistung nach Ländern bzw. Kreisen vergleichen, auch je 1.000 BEV.
- Im Autobahnmodus eine Autobahn und Fahrtrichtung wählen, Straßenanbindungen und berechnete Streckenintervalle untersuchen.
- Kartenansicht und Filter über Links teilen; helle und dunkle Darstellung sowie mobile Bedienung nutzen.

## Daten und Quellen

| Grundlage | Quelle | Verwendeter Stand |
| --- | --- | --- |
| Ladeinfrastruktur | [Bundesnetzagentur · Ladesäulenregister](https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/start.html) / NOW GmbH · CC BY 4.0 | Stand 29.10.2026 |
| Pkw- und BEV-Bestand nach Ländern und Zulassungsbezirken | [Kraftfahrt-Bundesamt](https://www.kba.de/DE/Statistik/Fahrzeuge/Bestand/bestand_node.html) · dl-de/by-2-0 | 01.01.2026 |
| Verwaltungsgrenzen VG250 | [© BKG](https://www.bkg.bund.de/) · dl-de/by-2-0 | 01.01.2026 |
| Straßenmodell, gespeicherter Deutschland-Extrakt | [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright) · ODbL, via [Geofabrik](https://download.geofabrik.de/europe/germany.html) | 06.10.2026 |
| Hintergrundkarten Positron und Dark Matter | [© CARTO](https://carto.com/attributions), © OpenStreetMap contributors | Online-Kartendienst |
| Ergänzende Betreiberangaben für ausgewählte Ladeeinrichtungen | EWE Go und E.ON Drive Infrastructure über [Mobilithek](https://mobilithek.info/) · CC0 1.0 | Abruf 07.11.2026 |

Ausführliche Quellen, Lizenzen, Kennzahlendefinitionen und die Methodik stehen in der Anwendung unter **Info**. Ladestandorte, regionale Kennzahlen und Autobahnintervalle werden aus den Ausgangsdaten abgeleitet. Die unterschiedlichen Stichtage bleiben bestehen.

## Einordnung

Die Karte zeigt keine Live-Belegung und keine aktuelle Funktionsfähigkeit von Ladepunkten. Nennleistung beschreibt keine garantierte Leistungsabgabe. BEV bezeichnet batterieelektrische Pkw ohne Plug-in-Hybride.

Der Autobahnmodus ist eine Modellrechnung: Eine berechnete Straßenanbindung bestätigt keine tatsächliche Zufahrt oder Zugangsberechtigung. Die Auswertung ist kein Nachweis der AFIR-Konformität.

## Über diese Veröffentlichung

Dieses Repository enthält die fertig gebaute Webanwendung. Die Entwicklung und interne Dokumentation werden separat geführt. React, deck.gl, MapLibre GL JS, Apache Arrow und Parquet/WASM bilden die technische Grundlage.

Datenschutz und Impressum sind in **Info** sowie als [Datenschutzseite](https://kirman442.github.io/charging-points/datenschutz.html) und [Impressum](https://kirman442.github.io/charging-points/impressum.html) erreichbar. Datenquellen und Bibliotheken unterliegen ihren jeweiligen Lizenzbedingungen.

Die Standortkarten enthalten gruppierte Anschlüsse und Bezahlmöglichkeiten. Zugeordnete Angaben aus OBELIS / NOW GmbH ergänzen einen Teil der Ladeeinrichtungen (Stand 23.10.2026, CC BY 4.0). Preise sind gemeldete Werte, keine bestätigten aktuellen Tarife; Angaben ohne Einheit werden nicht als Eurobeträge interpretiert. Die Auswahl für A1–A9 verbindet die bestätigten Modellrouten mit dem aktualisierten Registerbestand.
