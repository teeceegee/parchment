# Parchment

Parchment is a local-network household calendar display. The first prototype is a dependency-free Node.js service with a responsive browser UI, suitable for testing on an iPad before selecting the permanent display hardware.

## Run locally

Requires Node.js 20 or newer.

```sh
npm start
```

Open <http://localhost:8080>. To test from another device on the LAN, use the host computer's local IP address.

## Endpoints

- `GET /` — calendar display
- `GET /api/calendar?from=<ISO>&to=<ISO>` — calendar events
- `GET /api/health` — service health

The calendar currently uses clearly marked demo events. The next integration should replace `demoEvents()` with a read-only calendar adapter, while keeping the API and browser UI unchanged.

## Calendar sources

Set `CALENDAR_SOURCES_JSON` in the deployment environment. The value is a JSON array; keep published URLs and credentials out of source control.

```sh
CALENDAR_SOURCES_JSON='[{"name":"Family","url":"webcal://example.invalid/calendar.ics","colour":"#3867d6"}]'
```

The server converts `webcal://` feeds to HTTPS, refreshes them when the API is requested, and uses the last successful result if a source is temporarily unavailable.

Weather requires these deployment variables:

```sh
WEATHER_LATITUDE=51.5000
WEATHER_LONGITUDE=-0.1200
WEATHER_TIMEZONE=Europe/London
```

The weather panel uses Open-Meteo and remains disabled until a location is configured. `NATGEO_URL` may optionally override the default National Geographic Photo of the Day page.

## Container

```sh
docker build -t parchment:dev .
docker run --rm -p 8080:8080 parchment:dev
```
