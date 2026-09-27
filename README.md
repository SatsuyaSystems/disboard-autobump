# DISBOARD Auto-Bump

Ein Node.js-Script zum automatischen Ausführen des DISBOARD `/bump`-Commands.

Das Script erkennt die aktuelle DISBOARD Slash-Command-Version automatisch, wartet auf die Interaction-Response und kann auch ephemere Antworten von DISBOARD auswerten.

> [!WARNING]
> **Dieses Projekt verwendet einen Discord Selfbot.**
>
> Die Automatisierung eines normalen Discord-Benutzeraccounts ist von Discord nicht erlaubt und verstößt gegen die Discord-Richtlinien.
>
> Die Verwendung eines User-Tokens für automatisierte Aktionen kann zur Einschränkung, Sperrung oder Kündigung des Discord-Accounts führen.
>
> **Benutzung auf eigene Gefahr.**
>
> Dieses Projekt ist ausschließlich zu Lern- und Demonstrationszwecken gedacht.

## Features

- Automatisches Ausführen von DISBOARD `/bump`
- Lädt automatisch die aktuelle DISBOARD Command-Version
- Keine fest eingetragene Slash-Command-Version erforderlich
- Discord Gateway-Verbindung
- Erkennt normale DISBOARD Responses
- Erkennt ephemere DISBOARD Responses
- Erkennt den regulären 2-Stunden-Cooldown
- Liest verbleibende Cooldown-Zeit aus DISBOARD Responses
- Passt den nächsten Versuch automatisch an
- Funktioniert auch dann sinnvoll, wenn zwischenzeitlich ein anderer User den Server gebumpt hat
- Automatischer Retry bei unbekannten Fehlern
- Sauberes Logging in der Konsole

## Voraussetzungen

Benötigt werden:

- Node.js 20 oder neuer
- npm
- Ein Discord-Account
- Ein Server, der bei DISBOARD eingerichtet ist
- DISBOARD auf dem entsprechenden Discord-Server

## Installation

Repository herunterladen oder die Dateien in einen neuen Ordner kopieren.

Danach die benötigten Packages installieren:

```bash
npm install
```

Alternativ:

```bash
npm install dotenv discord.js-selfbot-v13
```

## package.json

Beispiel:

```json
{
  "name": "disboard-auto-bump",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "discord.js-selfbot-v13": "^3.7.1",
    "dotenv": "^17.2.2"
  }
}
```

## Konfiguration

Erstelle im Projektordner eine Datei namens:

```text
.env
```

Inhalt:

```env
TOKEN="DEIN_DISCORD_USER_TOKEN"
GUILD_ID="DEINE_SERVER_ID"
CHANNEL_ID="DEINE_CHANNEL_ID"
```

### TOKEN

Der Token des Discord-Benutzeraccounts.

**Wichtig:** Teile diesen Token niemals mit anderen Personen und veröffentliche ihn niemals auf GitHub oder anderen Plattformen.

Wer Zugriff auf deinen Discord-Token besitzt, kann unter Umständen deinen Account verwenden.

### GUILD_ID

Die ID des Discord-Servers, der gebumpt werden soll.

Beispiel:

```env
GUILD_ID="123456789012345678"
```

### CHANNEL_ID

Die ID des Channels, in dem `/bump` ausgeführt werden soll.

Beispiel:

```env
CHANNEL_ID="123456789012345678"
```

## Starten

Mit npm:

```bash
npm start
```

Oder direkt:

```bash
node index.js
```

Beim Start sollte ungefähr folgende Ausgabe erscheinen:

```text
Verbinde mit Discord Gateway...
Gateway bereit als username (123456789012345678)
DISBOARD Auto-Bump gestartet.
Lade Guild Application Command Index...
Command Index geladen: 35 Commands, 3 Apps.
DISBOARD Commands gefunden: 7
DISBOARD /bump gefunden | ID=947088344167366698 | Version=...
Sende /bump mit Version ...
```

## Wie funktioniert es?

Das Script lädt zuerst die aktuell verfügbaren Discord Application Commands des Servers.

Dadurch wird die aktuelle DISBOARD `/bump` Command-Version ermittelt.

Das ist wichtig, weil Discord eine veraltete Command-Version mit einem Fehler wie diesem ablehnt:

```text
INTERACTION_APPLICATION_COMMAND_INVALID_VERSION
This command is outdated
```

Die Command-Version wird deshalb nicht fest im Script hinterlegt, sondern bei jedem Versuch aktuell von Discord geladen.

Anschließend sendet das Script die `/bump` Interaction.

## Interaction Responses

Nach dem Absenden wartet das Script über das Discord Gateway auf die Antwort von DISBOARD.

Dabei werden sowohl normale als auch ephemere Responses erkannt.

### Erfolgreicher Bump

Nach einem erfolgreichen Bump gilt der reguläre DISBOARD-Cooldown von:

```text
2 Stunden
```

Das Script wartet deshalb nach einem erfolgreichen Bump ungefähr:

```text
2 Stunden + kleiner Sicherheitspuffer
```

bevor es erneut versucht zu bumpen.

## Ephemere Cooldown Response

Wenn der Server noch nicht erneut gebumpt werden kann, kann DISBOARD beispielsweise antworten:

```text
Bitte warte noch 24 Minuten bis der Server erneut gebumpt werden kann
```

Diese Nachricht ist normalerweise ephemeral und nur für den Benutzer sichtbar, der `/bump` ausgeführt hat.

Das Script erkennt diese Response über das Discord Gateway und liest die verbleibende Zeit aus.

Beispiel:

```text
DISBOARD Cooldown erkannt: 24m 0s Restzeit.
Server befindet sich bereits im Cooldown.
Nächster Versuch nach DISBOARD-Restzeit in 25m 20s.
```

## Warum wird der Cooldown dynamisch erkannt?

Der Server-Cooldown gehört zum Server und nicht nur zum Script.

Das bedeutet, dass beispielsweise ein Moderator oder ein anderer User `/bump` manuell ausführen kann.

Beispiel:

```text
Script wartet auf nächsten Bump
        ↓
anderer User führt /bump aus
        ↓
Server-Cooldown startet erneut
        ↓
Script versucht später /bump
        ↓
DISBOARD antwortet:
"Bitte warte noch 73 Minuten"
        ↓
Script erkennt die Restzeit
        ↓
Timer wird entsprechend angepasst
```

Dadurch bleibt das Script auch dann synchron, wenn mehrere Personen den Server bumpen.

## Cooldown-Logik

### Erfolgreicher Bump

```text
/bump erfolgreich
↓
2 Stunden warten
↓
erneut versuchen
```

### Server befindet sich bereits im Cooldown

```text
/bump
↓
DISBOARD ephemeral Response
↓
"Bitte warte noch X Minuten"
↓
Restzeit parsen
↓
Restzeit + Sicherheitspuffer warten
↓
erneut versuchen
```

### Unbekannter Fehler

Falls keine verwertbare DISBOARD Response erkannt werden kann:

```text
Fehler
↓
5 Minuten warten
↓
erneut versuchen
```

## Beispiel einer ephemeren Response

```text
============================================================
             DISBOARD EPHEMERAL RESPONSE
============================================================

Ephemeral: JA
Loading: NEIN
Flags: 64

DISBOARD: Die öffentliche Serverliste

Bitte warte noch 24 Minuten bis der Server erneut gebumpt werden kann
============================================================
```

Das Flag:

```text
64
```

kennzeichnet eine ephemere Discord Message.

### Discord Token schützen

Dein Discord User-Token ist ein hochsensibler Zugangsschlüssel.

Veröffentliche ihn niemals in:

- GitHub-Repositories
- Discord-Nachrichten
- Screenshots
- Paste-Seiten
- Logs
- Support-Tickets
- öffentlichen Konfigurationsdateien

Falls ein Token versehentlich veröffentlicht wurde, sollte er als kompromittiert betrachtet werden.

## Discord Selfbot Warnung

Dieses Projekt automatisiert einen normalen Discord-Benutzeraccount und ist damit ein sogenannter **Selfbot**.

Discord untersagt die Automatisierung normaler Benutzeraccounts außerhalb der vorgesehenen Bot- und OAuth2-Schnittstellen.

Die Verwendung dieses Scripts kann deshalb unter anderem zu folgenden Konsequenzen führen:

- Einschränkung des Accounts
- temporärer Sperrung
- dauerhafter Sperrung
- Kündigung des Discord-Accounts

Ein Disclaimer oder der Hinweis auf Lernzwecke hebt die Discord-Regeln nicht auf.

Wenn du eine von Discord offiziell unterstützte Automatisierung entwickeln möchtest, solltest du einen regulären Discord Bot beziehungsweise die offizielle Discord Application API verwenden.

## Disclaimer

Dieses Projekt wird ohne Garantie bereitgestellt.

Der Autor übernimmt keine Verantwortung für:

- gesperrte oder gekündigte Discord-Accounts
- Verstöße gegen Discord-Richtlinien
- Änderungen an der Discord API
- Änderungen an DISBOARD
- verlorene Daten
- Ausfälle
- Rate Limits
- sonstige Schäden durch die Nutzung

Du bist selbst dafür verantwortlich, die Bedingungen und Regeln der verwendeten Dienste einzuhalten.
