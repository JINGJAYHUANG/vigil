// US federal holidays (5 U.S.C. 6103(a)) with the observed-date rule OPM applies to most federal employees:
// a holiday on a Saturday is observed on the Friday before, one on a Sunday on the Monday after.
// Used for 21 CFR 803.53 five-work-day reports ("work day means Monday through Friday, except Federal holidays", 803.3).
// Inauguration Day (Washington, DC area only) is not included.

import { addDays } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** 0 = Sunday ... 6 = Saturday, for an ISO date. */
export function weekday(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

/** The n-th given weekday of a month (n = -1 for the last one). */
function nthWeekday(year, month, dow, n) {
  if (n > 0) {
    const first = weekday(iso(year, month, 1));
    return iso(year, month, 1 + ((dow - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = weekday(iso(year, month, lastDay));
  return iso(year, month, lastDay - ((last - dow + 7) % 7));
}

function observed(isoDate) {
  const dow = weekday(isoDate);
  if (dow === 6) return addDays(isoDate, -1);
  if (dow === 0) return addDays(isoDate, 1);
  return isoDate;
}

/** Holidays of one calendar year as [{ date (observed), actual, name }]. */
export function federalHolidaysOf(year) {
  const list = [
    [iso(year, 1, 1), 'New Year’s Day'],
    [nthWeekday(year, 1, 1, 3), 'Birthday of Martin Luther King, Jr.'],
    [nthWeekday(year, 2, 1, 3), 'Washington’s Birthday'],
    [nthWeekday(year, 5, 1, -1), 'Memorial Day'],
    [iso(year, 6, 19), 'Juneteenth National Independence Day'],
    [iso(year, 7, 4), 'Independence Day'],
    [nthWeekday(year, 9, 1, 1), 'Labor Day'],
    [nthWeekday(year, 10, 1, 2), 'Columbus Day'],
    [iso(year, 11, 11), 'Veterans Day'],
    [nthWeekday(year, 11, 4, 4), 'Thanksgiving Day'],
    [iso(year, 12, 25), 'Christmas Day'],
  ];
  return list.map(([actual, name]) => ({ date: observed(actual), actual, name }));
}

const cache = new Map();
function observedSet(year) {
  if (!cache.has(year)) {
    // A holiday of the next year can be observed in this one (1 January on a Saturday is observed on 31 December).
    const dates = [year - 1, year, year + 1].flatMap((y) => federalHolidaysOf(y).map((h) => h.date));
    cache.set(year, new Set(dates.filter((d) => d.startsWith(`${year}-`))));
  }
  return cache.get(year);
}

export function isFederalHoliday(isoDate) {
  return observedSet(Number(isoDate.slice(0, 4))).has(isoDate);
}

export function isWorkDay(isoDate) {
  const dow = weekday(isoDate);
  return dow !== 0 && dow !== 6 && !isFederalHoliday(isoDate);
}

/** The date `n` work days after `isoDate` (the start day itself is day 0 and is not counted). */
export function addWorkDays(isoDate, n) {
  let day = isoDate;
  let left = n;
  while (left > 0) {
    day = addDays(day, 1);
    if (isWorkDay(day)) left -= 1;
  }
  return day;
}

/** Non-work days skipped between `fromIso` (exclusive) and `toIso` (inclusive), for explanations. */
export function skippedDays(fromIso, toIso) {
  const out = [];
  for (let day = addDays(fromIso, 1); day <= toIso; day = addDays(day, 1)) {
    if (!isWorkDay(day)) out.push(day);
  }
  return out;
}
