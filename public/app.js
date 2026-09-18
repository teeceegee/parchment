const state = { view: "agenda", offset: 0, events: [] };
const $ = (selector) => document.querySelector(selector);

const formatDate = (date, options) => new Intl.DateTimeFormat(undefined, options).format(date);
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));

function updateClock() {
  const now = new Date();
  $("#time").textContent = formatDate(now, { hour: "2-digit", minute: "2-digit" });
  $("#date").textContent = formatDate(now, { weekday: "long", day: "numeric", month: "long" });
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

function renderHeading(range) {
  const label = state.view === "month" ? "MONTH" : state.view === "week" ? "WEEK" : state.offset === 0 ? "" : "DAY";
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
    state.view = "agenda";
    document.querySelectorAll(".view-button").forEach((item) => item.classList.toggle("active", item.dataset.view === "agenda"));
    loadCalendar();
  }));
}

async function loadCalendar() {
  const range = rangeForState();
  renderHeading(range);
  $("#status").textContent = "Updating…";
  try {
    const query = new URLSearchParams({ from: range.start.toISOString(), to: range.end.toISOString() });
    const response = await fetch(`/api/calendar?${query}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.events = data.events;
    renderLegend(state.events);
    if (state.view === "month") renderMonth(state.events, range);
    else renderEvents(state.events);
    const stale = data.statuses?.some((item) => item.status !== "ok");
    $("#status").textContent = `${stale ? "Showing cached calendar data · " : ""}Last updated ${formatDate(new Date(), { hour: "numeric", minute: "2-digit" })}`;
  } catch (error) {
    $("#status").textContent = "Unable to update calendar";
  }
}

async function loadWeather() {
  try {
    const response = await fetch("/api/weather");
    const data = await response.json();
    if (!data.configured) {
      $("#weather").innerHTML = '<p class="panel-placeholder">Weather location not configured.</p>';
      return;
    }
    const hourly = data.hours.map((item) => `<div class="weather-hour"><span>${formatDate(new Date(item.time), { hour: "numeric" })}</span><strong>${Math.round(item.temperature)}°</strong><small>${item.precipitationProbability}% rain</small></div>`).join("");
    $("#weather").innerHTML = `<div class="current-weather"><strong>${Math.round(data.current.temperature)}°</strong><div><span>${escapeHtml(data.current.condition)}</span><small>Wind ${Math.round(data.current.windSpeed)} km/h</small></div></div><div class="weather-hours">${hourly}</div>`;
  } catch {
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
    $("#photo").innerHTML = `<a class="photo-link" href="${escapeHtml(data.sourceUrl)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(data.image)}" alt="${escapeHtml(data.title || "National Geographic Photo of the Day")}" /><span class="photo-caption">${escapeHtml(data.title || "View today’s photograph")}</span></a>`;
  } catch {
    $("#photo").innerHTML = '<p class="panel-placeholder">Today’s photograph is temporarily unavailable.</p>';
  }
}

document.querySelectorAll(".view-button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".view-button").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  state.view = button.dataset.view;
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

updateClock();
loadCalendar();
loadWeather();
loadPhoto();
setInterval(updateClock, 1000);
setInterval(loadCalendar, 5 * 60 * 1000);
setInterval(loadWeather, 15 * 60 * 1000);
setInterval(loadPhoto, 60 * 60 * 1000);
