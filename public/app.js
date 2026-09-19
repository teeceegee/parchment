const state = { view: "agenda", offset: 0, events: [] };
const $ = (selector) => document.querySelector(selector);
let pullStartY = null;

const formatDate = (date, options) => new Intl.DateTimeFormat(undefined, options).format(date);
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));

function weatherIcon(condition, small = false) {
  const name = condition.toLowerCase();
  const slug = name.includes("partly") ? "partly-cloudy-day"
    : name.includes("thunder") ? "thunderstorms"
    : name.includes("snow") ? "snow"
    : name.includes("drizzle") ? "drizzle"
    : name.includes("rain") || name.includes("showers") ? "rain"
    : name.includes("fog") ? "fog"
    : name.includes("cloud") ? "cloudy"
    : "clear-day";
  return `<img class="weather-icon${small ? " weather-icon-small" : ""}" src="/weather-icons/${slug}.svg" alt="" aria-hidden="true">`;
}

document.addEventListener("touchstart", (event) => {
  if (event.touches.length === 1 && event.touches[0].clientY <= 32 && window.scrollY === 0) {
    pullStartY = event.touches[0].clientY;
  }
}, { passive: true });

document.addEventListener("touchend", (event) => {
  if (pullStartY !== null && event.changedTouches.length === 1 && event.changedTouches[0].clientY - pullStartY >= 96) {
    window.location.reload();
  }
  pullStartY = null;
}, { passive: true });

function updateClock() {
  const now = new Date();
  $("#time").textContent = formatDate(now, { hour: "2-digit", minute: "2-digit" });
  $("#date").innerHTML = [
    formatDate(now, { weekday: "long", day: "numeric" }),
    formatDate(now, { month: "long" }),
    formatDate(now, { year: "numeric" }),
  ].map((part) => `<span>${escapeHtml(part)}</span>`).join("");
}

function rangeForState() {
  const base = startOfDay(new Date());
  base.setDate(base.getDate() + state.offset);
  if (state.view === "month") {
    const monthStart = new Date(base.getFullYear(), base.getMonth(), 1);
    const gridStart = new Date(monthStart);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    const gridEnd = new Date(gridStart);
    gridEnd.setDate(gridEnd.getDate() + 42);
    return { start: gridStart, end: gridEnd, monthStart };
  }
  const end = new Date(base);
  end.setDate(end.getDate() + (state.view === "week" ? 7 : 1));
  return { start: base, end };
}

function weatherDateForState() {
  const date = startOfDay(new Date());
  if (state.view !== "month") date.setDate(date.getDate() + state.offset);
  return dateKey(date);
}

function renderHeading(range) {
  const label = state.view === "month" ? "MONTH" : state.view === "week" ? "WEEK" : "DAY";
  $("#range-label").textContent = label;
  $("#heading").textContent = state.view === "month"
    ? formatDate(range.monthStart, { month: "long", year: "numeric" })
    : state.view === "week"
    ? `${formatDate(range.start, { day: "numeric", month: "short" })} – ${formatDate(new Date(range.end - 1), { day: "numeric", month: "short" })}`
    : state.offset === 0 ? "Today" : formatDate(range.start, { weekday: "long", day: "numeric", month: "long" });
}

function renderLegend(events) {
  const calendars = [...new Map(events.map((item) => [item.calendar, item])).values()];
  $("#legend").innerHTML = calendars.map((item) => `<span class="legend-item"><span class="legend-dot" style="background:${item.colour}"></span>${item.calendar}</span>`).join("");
}

function renderEvents(events) {
  const container = $("#events");
  if (!events.length) {
    container.innerHTML = '<div class="empty">Nothing scheduled. A clear day.</div>';
    return;
  }
  let previousDay = "";
  container.innerHTML = events.map((item) => {
    const start = new Date(item.start);
    const end = new Date(item.end);
    const location = item.location ? ` · ${item.location}` : "";
    const dayKey = dateKey(start);
    const dayHeading = state.view === "week" && dayKey !== previousDay
      ? `<h3 class="event-day-heading">${formatDate(start, { weekday: "long", day: "numeric", month: "long" })}</h3>`
      : "";
    previousDay = dayKey;
    return `${dayHeading}<article class="event" style="--event-colour:${escapeHtml(item.colour)}">
      <time class="event-time" datetime="${item.start}">${formatDate(start, { hour: "numeric", minute: "2-digit" })}<br><span>to ${formatDate(end, { hour: "numeric", minute: "2-digit" })}</span></time>
      <span class="event-bar" aria-hidden="true"></span>
      <div><h3 class="event-title">${escapeHtml(item.title)}</h3><p class="event-meta">${escapeHtml(item.calendar)}${escapeHtml(location)}</p></div>
    </article>`;
  }).join("");
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function binReminderForDate(date) {
  const day = startOfDay(date);
  const mainCollectionAnchor = new Date(2026, 8, 23); // Waste collection
  const gardenCollectionAnchor = new Date(2026, 8, 26);
  const daysFromMainAnchor = Math.round((day - mainCollectionAnchor) / 86400000);
  const daysFromGardenAnchor = Math.round((day - gardenCollectionAnchor) / 86400000);
  const mainCollection = day.getDay() === 3;
  const gardenCollection = day.getDay() === 6 && daysFromGardenAnchor >= 0 && daysFromGardenAnchor % 14 === 0;

  if (mainCollection) {
    const bin = Math.abs(daysFromMainAnchor / 7) % 2 === 0 ? "Waste" : "Recycling";
    return { kind: "collection", text: `Bin collection today: ${bin} & Food Waste` };
  }
  if (day.getDay() === 2) {
    const tomorrow = new Date(day);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowOffset = Math.round((tomorrow - mainCollectionAnchor) / 86400000);
    const bin = Math.abs(tomorrowOffset / 7) % 2 === 0 ? "Waste" : "Recycling";
    return { kind: "put-out", text: `Put out this evening: ${bin} & Food Waste` };
  }
  if (gardenCollection) return { kind: "collection", text: "Bin collection today: Garden Waste" };
  if (day.getDay() === 5) {
    const tomorrow = new Date(day);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowOffset = Math.round((tomorrow - gardenCollectionAnchor) / 86400000);
    if (tomorrowOffset >= 0 && tomorrowOffset % 14 === 0) return { kind: "put-out", text: "Put out this evening: Garden Waste" };
  }
  return null;
}

function renderBinReminders(range) {
  const container = $("#bin-reminders");
  if (state.view === "month") {
    container.innerHTML = "";
    return;
  }
  const days = state.view === "week"
    ? Array.from({ length: 7 }, (_, index) => {
      const date = new Date(range.start);
      date.setDate(date.getDate() + index);
      return date;
    })
    : [range.start];
  const reminders = days.map((date) => ({ date, reminder: binReminderForDate(date) })).filter((item) => item.reminder);
  container.innerHTML = reminders.map(({ date, reminder }) => `<p class="bin-reminder bin-reminder-${reminder.kind}"><span>${state.view === "week" ? `${formatDate(date, { weekday: "short", day: "numeric", month: "short" })} · ` : ""}</span>${escapeHtml(reminder.text)}</p>`).join("");
}

function renderMonth(events, range) {
  const eventsByDay = new Map();
  for (const item of events) {
    const start = new Date(item.start);
    const end = new Date(item.end);
    const cursor = startOfDay(start);
    const last = startOfDay(end);
    while (cursor <= last) {
      const key = dateKey(cursor);
      const days = eventsByDay.get(key) || new Map();
      days.set(item.calendar, item.colour);
      eventsByDay.set(key, days);
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const todayKey = dateKey(new Date());
  const monthKey = `${range.monthStart.getFullYear()}-${range.monthStart.getMonth()}`;
  const days = [];
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(range.start);
    day.setDate(day.getDate() + index);
    const key = dateKey(day);
    const coloursForDay = [...(eventsByDay.get(key)?.values() || [])];
    const muted = `${day.getFullYear()}-${day.getMonth()}` !== monthKey;
    const today = key === todayKey;
    const indicators = coloursForDay.map((colour) => `<span class="month-indicator" style="background:${escapeHtml(colour)}"></span>`).join("");
    days.push(`<button class="month-day${muted ? " muted" : ""}${today ? " today" : ""}" data-date="${key}" aria-label="${formatDate(day, { weekday: "long", day: "numeric", month: "long" })}${coloursForDay.length ? `, ${coloursForDay.length} calendar${coloursForDay.length === 1 ? "" : "s"} with events` : ", no events"}"><span>${day.getDate()}</span><span class="month-indicators">${indicators}</span></button>`);
  }

  $("#events").innerHTML = `<div class="month-grid"><div class="weekday-row">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<span>${day}</span>`).join("")}</div><div class="month-days">${days.join("")}</div></div>`;
  document.querySelectorAll(".month-day").forEach((button) => button.addEventListener("click", () => {
    const selected = new Date(`${button.dataset.date}T00:00:00`);
    const today = startOfDay(new Date());
    state.offset = Math.round((selected - today) / 86400000);
    state.view = "day";
    document.querySelectorAll(".view-button").forEach((item) => item.classList.toggle("active", item.dataset.view === "day"));
    loadCalendar();
  }));
}

async function loadCalendar() {
  const range = rangeForState();
  renderHeading(range);
  $("#status").textContent = "Updating…";
  loadWeather();
  try {
    const query = new URLSearchParams({ from: range.start.toISOString(), to: range.end.toISOString() });
    const response = await fetch(`/api/calendar?${query}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.events = data.events;
    renderLegend(state.events);
    if (state.view === "month") renderMonth(state.events, range);
    else renderEvents(state.events);
    renderBinReminders(range);
    const stale = data.statuses?.some((item) => item.status !== "ok");
    $("#status").textContent = `${stale ? "Showing cached calendar data · " : ""}Last updated ${formatDate(new Date(), { hour: "numeric", minute: "2-digit" })}`;
  } catch (error) {
    $("#status").textContent = "Unable to update calendar";
  }
}

async function loadWeather() {
  try {
    const selectedDate = weatherDateForState();
    const today = dateKey(new Date());
    const response = await fetch(`/api/weather?date=${selectedDate}`);
    const data = await response.json();
    if (!data.configured) {
      $("#weather").innerHTML = '<p class="panel-placeholder">Weather location not configured.</p>';
      return;
    }
    if (!data.available) {
      $("#weather-period").textContent = "· NO FORECAST AVAILABLE";
      $("#weather-icon").innerHTML = "";
      $("#weather").innerHTML = "";
      return;
    }
    if (selectedDate === today) {
      $("#weather-period").textContent = "· NOW";
    } else {
      const forecastDate = formatDate(new Date(`${selectedDate}T00:00:00`), { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
      $("#weather-period").innerHTML = `· FORECAST FOR <strong class="forecast-date">${forecastDate}</strong>`;
    }
    const hourly = data.hours.map((item) => `<div class="weather-hour"><span>${formatDate(new Date(item.time), { hour: "2-digit", minute: "2-digit", hour12: false })}</span>${weatherIcon(item.condition, true)}<strong>${Math.round(item.temperature)}°</strong><small>${item.precipitationProbability}% rain</small><small>${Math.round(item.windSpeed)} mph</small></div>`).join("");
    const sunrise = formatDate(new Date(data.sunrise), { hour: "2-digit", minute: "2-digit", hour12: false });
    const sunset = formatDate(new Date(data.sunset), { hour: "2-digit", minute: "2-digit", hour12: false });
    $("#weather-icon").innerHTML = weatherIcon(data.condition);
    const warning = data.warnings?.[0];
    const warningText = typeof warning === "string" ? warning : warning?.text || "Weather warning";
    const warningColour = typeof warning === "object" && warning?.colour ? warning.colour : "#c65b3d";
    const temperature = warning
      ? `<button class="temperature warning-temperature" style="--warning-colour:${escapeHtml(warningColour)}" type="button" aria-label="Show weather warning">${Math.round(data.maxTemperature)}°</button>`
      : `<strong class="temperature">${Math.round(data.maxTemperature)}°</strong>`;
    $("#weather").innerHTML = `<div class="current-weather">${temperature}<div><span>${escapeHtml(data.condition)}</span><small>Low ${Math.round(data.minTemperature)}° · Wind ${Math.round(data.windSpeed)} mph</small></div><div class="weather-stats"><span>Sunrise <strong>${sunrise}</strong></span><span>Sunset <strong>${sunset}</strong></span></div></div><div class="weather-hours">${hourly}</div>`;
    if (warning) {
      $(".warning-temperature").addEventListener("click", () => {
        const viewer = document.createElement("div");
        viewer.className = "warning-viewer";
        viewer.innerHTML = `<div class="warning-box" style="--warning-colour:${escapeHtml(warningColour)}"><h3>Weather warning</h3><p>${escapeHtml(warningText)}</p></div>`;
        viewer.addEventListener("click", () => viewer.remove());
        document.body.append(viewer);
      });
    }
  } catch {
    $("#weather-period").textContent = "· NO FORECAST AVAILABLE";
    $("#weather-icon").innerHTML = "";
    $("#weather").innerHTML = '<p class="panel-placeholder">Weather temporarily unavailable.</p>';
  }
}

async function loadPhoto() {
  try {
    const response = await fetch("/api/natgeo");
    const data = await response.json();
    if (!data.configured) {
      $("#photo").innerHTML = '<p class="panel-placeholder">Today’s photograph is unavailable.</p>';
      return;
    }
    const photoTitle = data.title || "National Geographic Photo of the Day";
    const cardTitle = photoTitle.split(/\s*\|\s*/)[0];
    $("#photo-heading").textContent = cardTitle;
    $("#photo").innerHTML = `<div class="photo-stage"><button class="photo-link" type="button"><img src="${escapeHtml(data.image)}" alt="${escapeHtml(photoTitle)}" /></button><div class="photo-description"><p>${escapeHtml(data.description || "No description is available for today’s photograph.")}</p></div></div>`;
    const photoStage = $(".photo-stage");
    let photoSwipeStartY = null;
    photoStage.addEventListener("touchstart", (event) => {
      if (event.touches.length === 1) photoSwipeStartY = event.touches[0].clientY;
    }, { passive: true });
    photoStage.addEventListener("touchend", (event) => {
      if (photoSwipeStartY !== null && event.changedTouches.length === 1) {
        const deltaY = event.changedTouches[0].clientY - photoSwipeStartY;
        if (deltaY <= -48) photoStage.classList.add("show-description");
        if (deltaY >= 48) photoStage.classList.remove("show-description");
      }
      photoSwipeStartY = null;
    }, { passive: true });
    photoStage.addEventListener("touchcancel", () => {
      photoSwipeStartY = null;
    }, { passive: true });
    $(".photo-link").addEventListener("click", () => {
      const viewer = document.createElement("div");
      viewer.className = "photo-viewer";
      viewer.setAttribute("role", "dialog");
      viewer.setAttribute("aria-label", "Photo of the day");
      viewer.innerHTML = `<img src="${escapeHtml(data.image)}" alt="${escapeHtml(photoTitle)}" />`;
      viewer.addEventListener("click", () => viewer.remove());
      document.body.append(viewer);
    });
  } catch {
    $("#photo").innerHTML = '<p class="panel-placeholder">Today’s photograph is temporarily unavailable.</p>';
  }
}

document.querySelectorAll(".view-button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".view-button").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  state.view = button.dataset.view;
  if (state.view === "agenda") state.offset = 0;
  loadCalendar();
}));
function shiftView(direction) {
  if (state.view === "month") {
    const anchor = new Date();
    anchor.setDate(anchor.getDate() + state.offset);
    const shifted = new Date(anchor.getFullYear(), anchor.getMonth() + direction, 15);
    const today = startOfDay(new Date());
    state.offset = Math.round((startOfDay(shifted) - today) / 86400000);
  } else state.offset += direction * (state.view === "week" ? 7 : 1);
  loadCalendar();
}
$("#previous").addEventListener("click", () => shiftView(-1));
$("#next").addEventListener("click", () => shiftView(1));
$("#clock").addEventListener("click", () => window.location.reload());
$("#clock").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") window.location.reload();
});

updateClock();
loadCalendar();
loadWeather();
loadPhoto();
setInterval(updateClock, 1000);
setInterval(loadCalendar, 5 * 60 * 1000);
setInterval(loadWeather, 15 * 60 * 1000);
setInterval(loadPhoto, 60 * 60 * 1000);
