import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";

const configuredCalendars = loadCalendarSources();
const calendarCache = new Map();
const calendarRefreshIntervalMs = 5 * 60 * 1000;
let calendarRefreshPromise = null;
const weatherCache = { value: null, fetchedAt: 0 };
const photoCache = { value: null, fetchedAt: 0 };

const colours = {
  Home: "#3867d6",
  Work: "#b04a36",
  Family: "#2d8a62"
};

function loadCalendarSources() {
  if (!process.env.CALENDAR_SOURCES_JSON) return [];
  try {
    const sources = JSON.parse(process.env.CALENDAR_SOURCES_JSON);
    return Array.isArray(sources) ? sources.filter((source) => source && source.url && source.name) : [];
  } catch (error) {
    console.error("Invalid CALENDAR_SOURCES_JSON:", error.message);
    return [];
  }
}

function weatherCodeLabel(code) {
  if (code === 0) return "Clear sky";
  if ([1, 2, 3].includes(code)) return "Partly cloudy";
  if ([45, 48].includes(code)) return "Foggy";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67].includes(code)) return "Rain";
  if ([71, 73, 75, 77].includes(code)) return "Snow";
  if ([80, 81, 82].includes(code)) return "Showers";
  if ([95, 96, 99].includes(code)) return "Thunderstorms";
  return "Mixed conditions";
}

async function getWeather() {
  const latitude = Number(process.env.WEATHER_LATITUDE);
  const longitude = Number(process.env.WEATHER_LONGITUDE);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { configured: false };
  if (weatherCache.value && Date.now() - weatherCache.fetchedAt < 15 * 60 * 1000) return weatherCache.value;
  const timezone = process.env.WEATHER_TIMEZONE || "auto";
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({ latitude, longitude, timezone, forecast_days: "1", current: "temperature_2m,weather_code,wind_speed_10m", hourly: "temperature_2m,precipitation_probability,weather_code" });
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Weather ${response.status} ${response.statusText}`);
  const data = await response.json();
  const current = data.current;
  const hours = data.hourly.time.map((time, index) => ({ time, temperature: data.hourly.temperature_2m[index], precipitationProbability: data.hourly.precipitation_probability[index], condition: weatherCodeLabel(data.hourly.weather_code[index]) })).filter((item) => Date.parse(item.time) >= Date.now()).slice(0, 6);
  const value = { configured: true, timezone: data.timezone, current: { temperature: current.temperature_2m, condition: weatherCodeLabel(current.weather_code), windSpeed: current.wind_speed_10m }, hours };
  weatherCache.value = value;
  weatherCache.fetchedAt = Date.now();
  return value;
}

function metaContent(html, property) {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, "i");
  const match = html.match(pattern);
  return match?.[1] || match?.[2] || "";
}

async function getNationalGeographicPhoto() {
  if (photoCache.value && Date.now() - photoCache.fetchedAt < 24 * 60 * 60 * 1000) return photoCache.value;
  const sourceUrl = process.env.NATGEO_URL || "https://www.nationalgeographic.com/photo-of-the-day";
  const response = await fetch(sourceUrl, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`National Geographic ${response.status} ${response.statusText}`);
  const html = await response.text();
  const image = metaContent(html, "og:image");
  const value = { configured: Boolean(image), sourceUrl, image: image.startsWith("//") ? `https:${image}` : image, title: metaContent(html, "og:title"), description: metaContent(html, "og:description") };
  photoCache.value = value;
  photoCache.fetchedAt = Date.now();
  return value;
}

function dateAt(dayOffset, hour, minute = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function event(id, title, start, end, calendar, location = "") {
  return { id, title, start: start.toISOString(), end: end.toISOString(), calendar, colour: colours[calendar] || "#607080", location };
}

function demoEvents() {
  return [
    event("demo-1", "School run", dateAt(0, 8, 15), dateAt(0, 8, 45), "Family"),
    event("demo-2", "Project check-in", dateAt(0, 10), dateAt(0, 10, 45), "Work", "Study"),
    event("demo-3", "Lunch", dateAt(0, 12, 30), dateAt(0, 13, 15), "Home"),
    event("demo-4", "Dinner", dateAt(0, 18, 30), dateAt(0, 19, 30), "Family"),
    event("demo-5", "Bin collection", dateAt(1, 7), dateAt(1, 7, 15), "Home"),
    event("demo-6", "Dentist", dateAt(2, 15), dateAt(2, 15, 45), "Family", "Town centre")
  ];
}

function unfoldIcs(text) {
  return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/).filter(Boolean);
}

function unescapeIcs(value = "") {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function zonedDateToUtc(year, month, day, hour, minute, second, timeZone) {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, second);
  const fixedOffset = timeZone.match(/^GMT([+-])(\d{2})(?::?(\d{2}))?$/i);
  if (fixedOffset) {
    const offsetMinutes = Number(fixedOffset[2]) * 60 + Number(fixedOffset[3] || 0);
    const sign = fixedOffset[1] === "+" ? 1 : -1;
    return new Date(wallClock - sign * offsetMinutes * 60000);
  }
  let guess = wallClock;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess = wallClock - (rendered - guess);
  }
  return new Date(guess);
}

function parseIcsDate(value, parameters = "") {
  const raw = value.trim();
  if (/^\d{8}$/.test(raw)) {
    return { date: new Date(Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8)))), allDay: true };
  }
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, utc] = match;
  const timeZone = parameters.match(/(?:^|;)TZID="?([^";]+)"?/i)?.[1];
  const date = utc
    ? new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`)
    : timeZone
      ? zonedDateToUtc(Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second), timeZone)
      : new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return { date, allDay: parameters.includes("VALUE=DATE") };
}

function parseIcs(text, source) {
  const lines = unfoldIcs(text);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = {};
    if (!current) continue;
    if (line === "END:VEVENT") {
      const start = parseIcsDate(current.dtstart?.value, current.dtstart?.parameters);
      const end = parseIcsDate(current.dtend?.value, current.dtend?.parameters) || (start ? { date: new Date(start.date.getTime() + (start.allDay ? 86400000 : 3600000)), allDay: start.allDay } : null);
      if (start && end && current.summary) {
        events.push({
          id: `${source.name}-${current.uid || `${start.date.toISOString()}-${current.summary}`}`,
          title: unescapeIcs(current.summary),
          start: start.date.toISOString(),
          end: end.date.toISOString(),
          allDay: start.allDay,
          calendar: source.name,
          colour: source.colour || "#3867d6",
          location: unescapeIcs(current.location || "")
        });
      }
      current = null;
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const left = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const [key, ...parameters] = left.split(";");
    const entry = { value, parameters: parameters.join(";") };
    if (key === "DTSTART" || key === "DTEND") current[key.toLowerCase()] = entry;
    else current[key.toLowerCase()] = unescapeIcs(value);
  }
  return events;
}

async function fetchSource(source) {
  const url = source.url.replace(/^webcal:/i, "https:");
  const response = await fetch(url, { headers: { accept: "text/calendar,text/plain" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return parseIcs(await response.text(), source);
}

async function refreshCalendarSources() {
  if (!configuredCalendars.length || calendarRefreshPromise) return calendarRefreshPromise;
  calendarRefreshPromise = Promise.all(configuredCalendars.map(async (source) => {
    const cached = calendarCache.get(source.name);
    try {
      const events = await fetchSource(source);
      calendarCache.set(source.name, { events, fetchedAt: Date.now(), status: "ok" });
    } catch (error) {
      calendarCache.set(source.name, { events: cached?.events || [], fetchedAt: cached?.fetchedAt || 0, status: "stale", error: error.message });
      console.error(`Calendar source ${source.name} failed:`, error.message);
    }
  })).finally(() => {
    calendarRefreshPromise = null;
  });
  return calendarRefreshPromise;
}

function cachedCalendarEvents() {
  const events = [];
  const statuses = [];
  for (const source of configuredCalendars) {
    const cached = calendarCache.get(source.name);
    if (cached) events.push(...cached.events);
    statuses.push({ name: source.name, status: cached?.status || "loading", ...(cached?.error ? { error: cached.error } : {}) });
  }
  return { events, source: "configured", statuses };
}

async function getCalendarEvents() {
  if (!configuredCalendars.length) return { events: demoEvents(), source: "demo" };
  const cacheIsEmpty = calendarCache.size === 0;
  const cacheIsStale = [...calendarCache.values()].some((entry) => Date.now() - entry.fetchedAt >= calendarRefreshIntervalMs);
  if (cacheIsEmpty) await refreshCalendarSources();
  else if (cacheIsStale) refreshCalendarSources();
  return cachedCalendarEvents();
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
    response.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream", "cache-control": "no-cache" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/api/health") {
    sendJson(response, 200, { status: "ok", service: "parchment", time: new Date().toISOString() });
    return;
  }

  if (url.pathname === "/api/calendar") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const fromTime = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
    const toTime = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
    const calendar = await getCalendarEvents();
    const events = calendar.events.filter((item) => Date.parse(item.end) >= fromTime && Date.parse(item.start) <= toTime);
    sendJson(response, 200, { ...calendar, generatedAt: new Date().toISOString(), events });
    return;
  }

  if (url.pathname === "/api/weather") {
    try {
      sendJson(response, 200, await getWeather());
    } catch (error) {
      sendJson(response, 200, { configured: false, error: error.message });
    }
    return;
  }

  if (url.pathname === "/api/natgeo") {
    try {
      sendJson(response, 200, await getNationalGeographicPhoto());
    } catch (error) {
      sendJson(response, 200, { configured: false, error: error.message });
    }
    return;
  }

  await serveStatic(response, url.pathname);
});

server.listen(port, host, () => {
  console.log(`Parchment listening on http://${host}:${port}`);
  if (configuredCalendars.length) refreshCalendarSources();
});
