'use strict';

const crypto = require('node:crypto');

const NEXA_LIVE_DEALER_AVAILABILITY_V1 = 'NEXA_LIVE_DEALER_AVAILABILITY_V1';
const NEXA_APPOINTMENT_CONSISTENCY_GUARD_V1 = 'NEXA_APPOINTMENT_CONSISTENCY_GUARD_V1';

const SLOT_KEYS = new Set([
  'verified_open_slots', 'verified_slots', 'open_slots', 'available_slots', 'slots',
  'dealer_appointment_availability', 'appointment_availability', 'availability',
  'available_times', 'open_times'
]);
const BLOCKED_DATE_KEYS = new Set(['blocked_dates', 'off_dates', 'days_off', 'closed_dates', 'unavailable_dates']);
const OPEN_DATE_KEYS = new Set(['open_dates', 'available_dates', 'special_open_dates']);
const WEEKLY_SCHEDULE_KEYS = new Set(['weekly_schedule', 'business_hours', 'dealer_schedule', 'availability_schedule']);
const UNAVAILABLE_TIME_KEYS = new Set(['booked_times', 'unavailable_times', 'blocked_times', 'booked_slots']);
const ASSIGNED_LISTING_KEYS = new Set(['assigned_listings', 'listings']);
const WEEKDAYS = {
  sunday: 0, domingo: 0, monday: 1, lunes: 1, tuesday: 2, martes: 2, wednesday: 3, miercoles: 3,
  thursday: 4, jueves: 4, friday: 5, viernes: 5, saturday: 6, sabado: 6
};

function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }
function number(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clamp(value, minimum, maximum) { return Math.min(Math.max(number(value, minimum), minimum), maximum); }
function normalized(value) { return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function dateKeyFromValue(value) {
  if (value instanceof Date) return localDateKey(value);
  if (typeof value === 'string') {
    const exact = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (exact) return exact[1];
  }
  if (value && typeof value === 'object') {
    return dateKeyFromValue(value.date || value.appointment_date || value.blocked_date || value.off_date || value.open_date || value.start_at || value.datetime);
  }
  return '';
}

function truthy(value) {
  if (value === true || value === 1) return true;
  return ['1', 'true', 'yes', 'on', 'enabled', 'open', 'available'].includes(normalized(value));
}

function falsey(value) {
  if (value === false || value === 0 || value === null) return true;
  return ['0', 'false', 'no', 'off', 'disabled', 'closed', 'unavailable', 'blocked'].includes(normalized(value));
}

function looksLikeSlot(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (record.start_at || record.starts_at || record.datetime || record.date_time) return true;
  const date = record.appointment_date || record.date || record.open_date;
  const time = record.start_time || record.appointment_time || record.time || record.from_time;
  return Boolean(date && time);
}

function inheritedSlotContext(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return {};
  const output = {};
  for (const key of [
    'dealer_id', 'dealer_name', 'store_id', 'store_name', 'reseller_id', 'listing_id', 'listing_title',
    'location', 'address', 'timezone', 'slot_minutes', 'slot_duration_minutes', 'duration_minutes',
    'date', 'appointment_date', 'open_date'
  ]) {
    if (record[key] !== undefined && record[key] !== null && typeof record[key] !== 'object') output[key] = record[key];
  }
  return output;
}

function expandSlotRecord(record, inherited) {
  const source = Object.assign({}, inherited || {}, record || {});
  const date = source.appointment_date || source.date || source.open_date;
  const times = source.times || source.available_times || source.open_times;
  if (date && Array.isArray(times)) {
    return times.map(function expandTime(item) {
      if (item && typeof item === 'object') return Object.assign({}, source, item, { date: item.date || date });
      return Object.assign({}, source, { date: date, start_time: item });
    });
  }
  return looksLikeSlot(source) ? [source] : [];
}

function availabilitySlotRecords(payload) {
  const found = [];
  function visit(value, hinted, inherited, depth) {
    if (depth > 7 || value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.slice(0, 1000).forEach(function visitItem(item) {
        if ((typeof item === 'string' || typeof item === 'number') && hinted && inherited && dateKeyFromValue(inherited)) {
          found.push(Object.assign({}, inherited, { start_time: item }));
        } else {
          visit(item, hinted, inherited, depth + 1);
        }
      });
      return;
    }
    if (typeof value !== 'object') return;
    const expanded = expandSlotRecord(value, inherited);
    if (looksLikeSlot(value) || (hinted && expanded.length)) found.push.apply(found, expanded);
    Object.entries(value).forEach(function inspect(entry) {
      const key = normalized(entry[0]);
      const child = entry[1];
      if (SLOT_KEYS.has(key)) {
        const slotContext = Object.assign({}, inherited || {}, inheritedSlotContext(value));
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          Object.entries(child).forEach(function keyedDate(pair) {
            const inheritedDate = /^20\d{2}-\d{2}-\d{2}$/.test(pair[0]) ? Object.assign({}, slotContext, { date: pair[0] }) : slotContext;
            visit(pair[1], true, inheritedDate, depth + 1);
          });
        } else visit(child, true, slotContext, depth + 1);
      } else if (['data', 'result', 'items', 'records', 'rows', 'availability_snapshot', 'calendar_snapshot', 'calendar', 'stores', 'store', 'days'].includes(key)) {
        const childContext = Object.assign({}, inherited || {}, inheritedSlotContext(value));
        visit(child, false, childContext, depth + 1);
      }
    });
  }
  visit(payload, Array.isArray(payload), null, 0);
  const unique = new Map();
  found.forEach(function keep(record, index) {
    if (!record || typeof record !== 'object') return;
    const identity = text(record.slot_id || record.availability_id || record.id)
      || [text(record.start_at || record.datetime), dateKeyFromValue(record), text(record.start_time || record.appointment_time || record.time), text(record.store_id), text(record.listing_id)].join('|')
      || String(index);
    if (!unique.has(identity)) unique.set(identity, record);
  });
  return Array.from(unique.values());
}

function collectNamedValues(payload, wantedKeys, limit) {
  const output = [];
  function visit(value, depth) {
    if (depth > 7 || value === undefined || value === null || output.length >= limit) return;
    if (Array.isArray(value)) {
      value.slice(0, limit).forEach(function visitItem(item) { visit(item, depth + 1); });
      return;
    }
    if (typeof value !== 'object') return;
    Object.entries(value).forEach(function inspect(entry) {
      if (output.length >= limit) return;
      const key = normalized(entry[0]);
      if (wantedKeys.has(key)) {
        const child = entry[1];
        if (Array.isArray(child)) output.push.apply(output, child.slice(0, limit - output.length));
        else if (child !== undefined && child !== null) output.push(child);
      } else visit(entry[1], depth + 1);
    });
  }
  visit(payload, 0);
  return output.slice(0, limit);
}

function collectDateKeys(payload, wantedKeys) {
  const dates = new Set();
  collectNamedValues(payload, wantedKeys, 500).forEach(function addDate(value) {
    if (Array.isArray(value)) value.forEach(function nested(item) { const key = dateKeyFromValue(item); if (key) dates.add(key); });
    else {
      const key = dateKeyFromValue(value);
      if (key) dates.add(key);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.keys(value).forEach(function keyedDate(candidate) { if (/^20\d{2}-\d{2}-\d{2}$/.test(candidate) && !falsey(value[candidate])) dates.add(candidate); });
      }
    }
  });
  return dates;
}

function firstNamedValue(payload, wantedKeys) {
  let found = null;
  function visit(value, depth) {
    if (found !== null || depth > 7 || value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.slice(0, 500).forEach(function visitItem(item) { visit(item, depth + 1); });
      return;
    }
    if (typeof value !== 'object') return;
    for (const entry of Object.entries(value)) {
      if (wantedKeys.has(normalized(entry[0]))) {
        found = entry[1];
        return;
      }
      visit(entry[1], depth + 1);
      if (found !== null) return;
    }
  }
  visit(payload, 0);
  return found;
}

function weekdayScheduleEntry(schedule, date) {
  if (!schedule || !date || Number.isNaN(date.getTime())) return null;
  const dayNumber = date.getDay();
  if (Array.isArray(schedule)) {
    return schedule.find(function sameDay(row) {
      if (!row || typeof row !== 'object') return false;
      const day = normalized(row.day_of_week || row.weekday || row.day || row.name);
      return WEEKDAYS[day] === dayNumber || Number(row.day_number) === dayNumber;
    }) || null;
  }
  if (typeof schedule === 'object') {
    const key = Object.keys(schedule).find(function sameDay(name) { return WEEKDAYS[normalized(name)] === dayNumber; });
    return key ? schedule[key] : null;
  }
  return null;
}

function scheduleEntryIsOff(entry) {
  if (entry === null || entry === undefined || entry === false || entry === 0) return true;
  if (typeof entry === 'string') return ['off', 'closed', 'unavailable', 'blocked', 'day off'].includes(normalized(entry));
  if (typeof entry !== 'object') return false;
  const status = normalized(entry.status || entry.state);
  if (['off', 'closed', 'unavailable', 'blocked', 'disabled'].includes(status)) return true;
  if (truthy(entry.is_off) || truthy(entry.day_off) || truthy(entry.closed) || truthy(entry.blocked)) return true;
  if (Object.prototype.hasOwnProperty.call(entry, 'available') && falsey(entry.available)) return true;
  if (Object.prototype.hasOwnProperty.call(entry, 'enabled') && falsey(entry.enabled)) return true;
  if (Object.prototype.hasOwnProperty.call(entry, 'is_open') && falsey(entry.is_open)) return true;
  return false;
}

function clockMinutes(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const hour = Math.floor(value);
    const minute = Math.round((value - hour) * 60);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
  }
  const source = normalized(value);
  if (!source) return null;
  const match = source.match(/(?:^|\s)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s|$)/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3] || '';
  if (period === 'pm' && hour < 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function scheduleIntervals(entry, depth) {
  if (depth > 5 || entry === undefined || entry === null || scheduleEntryIsOff(entry)) return [];
  if (Array.isArray(entry)) {
    if (entry.length >= 2 && entry.every(function scalar(item) { return ['string', 'number'].includes(typeof item); })) {
      const start = clockMinutes(entry[0]);
      const end = clockMinutes(entry[1]);
      return start !== null && end !== null && end > start ? [{ start: start, end: end }] : [];
    }
    return entry.reduce(function combine(result, item) { return result.concat(scheduleIntervals(item, depth + 1)); }, []);
  }
  if (typeof entry === 'string') {
    const values = entry.match(/\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi) || [];
    if (values.length >= 2) {
      const start = clockMinutes(values[0]);
      const end = clockMinutes(values[1]);
      return start !== null && end !== null && end > start ? [{ start: start, end: end }] : [];
    }
    return [];
  }
  if (typeof entry !== 'object') return [];
  const startValue = entry.open_time !== undefined ? entry.open_time
    : entry.start_time !== undefined ? entry.start_time
      : entry.opens_at !== undefined ? entry.opens_at
        : entry.open !== undefined ? entry.open
          : entry.start !== undefined ? entry.start
            : entry.from_time !== undefined ? entry.from_time : entry.from;
  const endValue = entry.close_time !== undefined ? entry.close_time
    : entry.end_time !== undefined ? entry.end_time
      : entry.closes_at !== undefined ? entry.closes_at
        : entry.close !== undefined ? entry.close
          : entry.end !== undefined ? entry.end
            : entry.to_time !== undefined ? entry.to_time : entry.to;
  const start = clockMinutes(startValue);
  const end = clockMinutes(endValue);
  const direct = start !== null && end !== null && end > start ? [{ start: start, end: end }] : [];
  const nested = ['periods', 'hours', 'intervals', 'ranges', 'times'].reduce(function collect(result, key) {
    return entry[key] !== undefined ? result.concat(scheduleIntervals(entry[key], depth + 1)) : result;
  }, []);
  return direct.concat(nested);
}

function dailyScheduleWindow(payload, value, slots) {
  const date = value instanceof Date ? value : new Date(value);
  const slotContext = commonSlotContext(slots);
  if (Number.isNaN(date.getTime()) || dateAvailabilityState(payload, date, Object.assign({}, slotContext, { verifiedSlots: slots })).blocked) return null;
  const dateKey = localDateKey(date);
  const specialOpen = slotContext.ambiguous ? null : collectScopedNamedValues(payload, OPEN_DATE_KEYS, slotContext, 500).find(function matchingOpenDate(entry) {
    return entry && typeof entry === 'object' && dateKeyFromValue(entry) === dateKey;
  });
  let intervals = scheduleIntervals(specialOpen, 0);
  let source = intervals.length ? 'special_open_date' : '';
  if (!intervals.length && !slotContext.ambiguous) {
    const schedule = firstScopedNamedValue(payload, WEEKLY_SCHEDULE_KEYS, slotContext);
    const entry = weekdayScheduleEntry(schedule, date);
    intervals = scheduleIntervals(entry, 0);
    if (intervals.length) source = 'weekly_schedule';
  }
  if (intervals.length) {
    return {
      start_minutes: Math.min.apply(Math, intervals.map(function start(interval) { return interval.start; })),
      end_minutes: Math.max.apply(Math, intervals.map(function end(interval) { return interval.end; })),
      source: source,
      intervals: intervals
    };
  }
  const sameDay = (slots || []).filter(function matchingSlot(slot) {
    return slot && slot.start instanceof Date && localDateKey(slot.start) === dateKey;
  });
  if (!sameDay.length) return null;
  const startMinutes = Math.min.apply(Math, sameDay.map(function start(slot) { return slot.start.getHours() * 60 + slot.start.getMinutes(); }));
  const endMinutes = Math.max.apply(Math, sameDay.map(function end(slot) { return slot.end.getHours() * 60 + slot.end.getMinutes(); }));
  return { start_minutes: startMinutes, end_minutes: endMinutes, source: 'verified_slots', intervals: [] };
}

function commonSlotContext(slots) {
  const source = (slots || []).filter(Boolean);
  const output = {};
  let ambiguous = false;
  for (const key of ['store_id', 'dealer_id', 'listing_id']) {
    const values = Array.from(new Set(source.map(function value(slot) {
      return text(slot && (slot[key] || slot.raw && slot.raw[key]));
    }).filter(Boolean)));
    if (values.length === 1) output[key] = values[0];
    if (values.length > 1) ambiguous = true;
  }
  output.ambiguous = ambiguous;
  return output;
}

function recordMatchesContext(record, inherited, context) {
  if (!context || context.ambiguous) return true;
  const effective = Object.assign({}, inherited || {}, inheritedSlotContext(record));
  for (const key of ['store_id', 'dealer_id', 'listing_id']) {
    const expected = text(context[key]);
    const actual = text(effective[key]);
    if (expected && actual && expected !== actual) return false;
  }
  return true;
}

function collectScopedNamedValues(payload, wantedKeys, context, limit) {
  if (!context || context.ambiguous || (!context.store_id && !context.dealer_id && !context.listing_id)) {
    return collectNamedValues(payload, wantedKeys, limit);
  }
  const output = [];
  function visit(value, inherited, depth) {
    if (depth > 7 || value === undefined || value === null || output.length >= limit) return;
    if (Array.isArray(value)) {
      value.slice(0, limit).forEach(function visitItem(item) { visit(item, inherited, depth + 1); });
      return;
    }
    if (typeof value !== 'object' || !recordMatchesContext(value, inherited, context)) return;
    const nextContext = Object.assign({}, inherited || {}, inheritedSlotContext(value));
    Object.entries(value).forEach(function inspect(entry) {
      if (output.length >= limit) return;
      if (wantedKeys.has(normalized(entry[0]))) {
        const child = entry[1];
        if (Array.isArray(child)) output.push.apply(output, child.slice(0, limit - output.length));
        else if (child !== undefined && child !== null) output.push(child);
      } else visit(entry[1], nextContext, depth + 1);
    });
  }
  visit(payload, {}, 0);
  return output.slice(0, limit);
}

function scopedDateKeys(payload, wantedKeys, context) {
  const dates = new Set();
  collectScopedNamedValues(payload, wantedKeys, context, 500).forEach(function addDate(value) {
    const key = dateKeyFromValue(value);
    if (key) dates.add(key);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.keys(value).forEach(function keyedDate(candidate) {
        if (/^20\d{2}-\d{2}-\d{2}$/.test(candidate) && !falsey(value[candidate])) dates.add(candidate);
      });
    }
  });
  return dates;
}

function firstScopedNamedValue(payload, wantedKeys, context) {
  const values = collectScopedNamedValues(payload, wantedKeys, context, 1);
  return values.length ? values[0] : null;
}

function valueContainsDate(value, key) {
  if (dateKeyFromValue(value) === key) return true;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value).some(function keyedDate(candidate) {
      return candidate === key && !falsey(value[candidate]);
    });
  }
  return false;
}

function explicitContextMatch(record, inherited, context) {
  if (!context || context.ambiguous) return false;
  const effective = Object.assign({}, inherited || {}, inheritedSlotContext(record));
  let matched = false;
  for (const key of ['store_id', 'dealer_id', 'listing_id']) {
    const expected = text(context[key]);
    const actual = text(effective[key]);
    if (expected && actual && expected !== actual) return false;
    if (expected && actual && expected === actual) matched = true;
  }
  return matched;
}

function hasExplicitScopedDate(payload, wantedKeys, key, context) {
  let found = false;
  function visit(value, inherited, depth) {
    if (found || depth > 7 || value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.slice(0, 1000).forEach(function visitItem(item) { visit(item, inherited, depth + 1); });
      return;
    }
    if (typeof value !== 'object' || !recordMatchesContext(value, inherited, context)) return;
    const nextContext = Object.assign({}, inherited || {}, inheritedSlotContext(value));
    Object.entries(value).forEach(function inspect(entry) {
      if (found) return;
      if (wantedKeys.has(normalized(entry[0])) && explicitContextMatch(value, inherited, context)) {
        const values = Array.isArray(entry[1]) ? entry[1] : [entry[1]];
        if (values.some(function matchingDate(item) { return valueContainsDate(item, key); })) found = true;
      } else visit(entry[1], nextContext, depth + 1);
    });
  }
  visit(payload, {}, 0);
  return found;
}

function calendarDayState(payload, key, context) {
  const state = { blocked: false, open: false };
  function visit(value, inherited, depth) {
    if (depth > 7 || value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.slice(0, 1000).forEach(function visitItem(item) { visit(item, inherited, depth + 1); });
      return;
    }
    if (typeof value !== 'object' || !recordMatchesContext(value, inherited, context)) return;
    const nextContext = Object.assign({}, inherited || {}, inheritedSlotContext(value));
    const hasScope = !context || context.ambiguous || (!context.store_id && !context.dealer_id && !context.listing_id)
      || explicitContextMatch(value, inherited, context);
    if (hasScope && dateKeyFromValue(value) === key) {
      if (truthy(value.blocked) || truthy(value.closed) || truthy(value.is_off)
        || Object.prototype.hasOwnProperty.call(value, 'is_open') && falsey(value.is_open)) state.blocked = true;
      if (truthy(value.is_open) || truthy(value.open) || truthy(value.available)) state.open = true;
    }
    Object.values(value).forEach(function child(item) { visit(item, nextContext, depth + 1); });
  }
  visit(payload, {}, 0);
  return state;
}

function slotIsVerifiedOpenForDate(slot, key) {
  if (!slot) return false;
  const start = slot.start instanceof Date ? slot.start : availabilityStart(slot.raw || slot);
  if (!start || localDateKey(start) !== key) return false;
  const raw = slot.raw || slot;
  const status = normalized(raw.status || raw.state);
  const unavailableStatus = ['unavailable', 'blocked', 'booked', 'closed', 'disabled', 'off', 'cancelled', 'canceled'].includes(status)
    || truthy(raw.booked) || truthy(raw.blocked) || truthy(raw.closed) || truthy(raw.is_booked) || truthy(raw.is_blocked);
  const availabilityValue = raw.available !== undefined ? raw.available : raw.is_available;
  return availabilityValue === undefined ? !unavailableStatus : truthy(availabilityValue) && !unavailableStatus;
}

function dateAvailabilityState(payload, value, context) {
  const date = value instanceof Date ? value : new Date(value);
  const key = localDateKey(date);
  if (!key) return { blocked: false, reason: '' };
  const options = context || {};
  const verifiedSlots = [].concat(options.verifiedSlots || [], options.verifiedSlot || []).filter(Boolean);
  const dayState = calendarDayState(payload, key, options);
  if (hasExplicitScopedDate(payload, BLOCKED_DATE_KEYS, key, options) || dayState.blocked) {
    return { blocked: true, reason: dayState.blocked ? 'calendar_day_off' : 'blocked_date' };
  }
  if (verifiedSlots.some(function verified(slot) { return slotIsVerifiedOpenForDate(slot, key); })) {
    return { blocked: false, reason: 'verified_open_slot' };
  }
  if (dayState.open) return { blocked: false, reason: 'calendar_open_day' };
  if (scopedDateKeys(payload, BLOCKED_DATE_KEYS, options).has(key)) return { blocked: true, reason: 'blocked_date' };
  if (scopedDateKeys(payload, OPEN_DATE_KEYS, options).has(key)) return { blocked: false, reason: 'special_open_date' };
  const schedule = firstScopedNamedValue(payload, WEEKLY_SCHEDULE_KEYS, options);
  if (!schedule) return { blocked: false, reason: '' };
  const entry = weekdayScheduleEntry(schedule, date);
  return scheduleEntryIsOff(entry) ? { blocked: true, reason: 'weekly_day_off' } : { blocked: false, reason: entry ? 'weekly_schedule' : '' };
}

function availabilityStart(slot) {
  if (!slot || typeof slot !== 'object') return null;
  const direct = text(slot.start_at || slot.starts_at || slot.datetime || slot.date_time || slot.start);
  if (direct) {
    const parsed = new Date(direct);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const date = text(slot.appointment_date || slot.date || slot.open_date);
  const time = text(slot.start_time || slot.appointment_time || slot.time || slot.from_time || slot.open_time);
  if (!date) return null;
  const parsed = new Date(time ? date + 'T' + time : date + 'T00:00:00');
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function conflictsWithPublishedUnavailableTime(payload, slot, start, end) {
  return collectNamedValues(payload, UNAVAILABLE_TIME_KEYS, 500).some(function conflicts(record) {
    if (!record || typeof record !== 'object') return false;
    const unavailableStart = availabilityStart(record);
    if (!unavailableStart) return false;
    const directEnd = text(record.end_at || record.ends_at || record.end);
    const endTime = text(record.end_time || record.to_time || record.close_time);
    const parsedEnd = directEnd ? new Date(directEnd) : endTime ? new Date(localDateKey(unavailableStart) + 'T' + endTime) : null;
    const unavailableEnd = parsedEnd && !Number.isNaN(parsedEnd.getTime()) ? parsedEnd : new Date(unavailableStart.getTime() + 60000);
    if (slot.store_id && record.store_id && text(slot.store_id) !== text(record.store_id)) return false;
    if (slot.listing_id && record.listing_id && text(slot.listing_id) !== text(record.listing_id)) return false;
    return start < unavailableEnd && end > unavailableStart;
  });
}

function slotIdentity(slot, index) {
  return text(slot && (slot.slot_id || slot.availability_id || slot.id))
    || crypto.createHash('sha256').update(JSON.stringify(slot || {}) + ':' + index).digest('hex').slice(0, 24);
}

function normalizeAvailability(payload, settings, referenceDate) {
  const options = settings || {};
  const now = referenceDate || new Date();
  const minNotice = clamp(options.auto_appointments_min_notice_hours, 0, 168) * 3600000;
  const maxDate = new Date(now.getTime() + clamp(options.auto_appointments_max_days, 1, 365) * 86400000);
  let slotMinutes = number(firstNamedValue(payload, new Set(['slot_minutes', 'slot_duration_minutes', 'duration_minutes'])), 0);
  if (!slotMinutes) slotMinutes = clamp(options.auto_appointments_duration_minutes, 10, 480);
  const unique = new Map();
  availabilitySlotRecords(payload).forEach(function mapSlot(slot, index) {
    const start = availabilityStart(slot);
    if (!start) return;
    const status = normalized(slot.status || slot.state);
    const unavailableStatus = ['unavailable', 'blocked', 'booked', 'closed', 'disabled', 'off', 'cancelled', 'canceled'].includes(status)
      || truthy(slot.booked) || truthy(slot.blocked) || truthy(slot.closed) || truthy(slot.is_booked) || truthy(slot.is_blocked);
    const availabilityValue = slot.available !== undefined ? slot.available : slot.is_available;
    const isAvailable = availabilityValue === undefined ? !unavailableStatus : truthy(availabilityValue) && !unavailableStatus;
    if (!isAvailable || dateAvailabilityState(payload, start, Object.assign({}, commonSlotContext([slot]), { verifiedSlot: slot })).blocked
      || start.getTime() < now.getTime() + minNotice || start > maxDate) return;
    const duration = clamp(slot.duration_minutes || slot.slot_minutes || slotMinutes, 10, 480);
    const directEnd = text(slot.end_at || slot.ends_at || slot.end);
    const endTime = text(slot.end_time || slot.to_time || slot.close_time);
    const parsedEnd = directEnd ? new Date(directEnd) : endTime ? new Date(localDateKey(start) + 'T' + endTime) : null;
    const end = parsedEnd && !Number.isNaN(parsedEnd.getTime()) ? parsedEnd : new Date(start.getTime() + duration * 60000);
    if (conflictsWithPublishedUnavailableTime(payload, slot, start, end)) return;
    const normalizedSlot = {
      id: slotIdentity(slot, index),
      start: start,
      end: end,
      location: text(slot.location || slot.address || firstNamedValue(payload, new Set(['location', 'address']))),
      dealer_id: text(slot.dealer_id || firstNamedValue(payload, new Set(['dealer_id']))),
      store_id: text(slot.store_id || firstNamedValue(payload, new Set(['store_id']))),
      listing_id: text(slot.listing_id),
      raw: slot
    };
    const identity = normalizedSlot.id + '|' + normalizedSlot.start.toISOString();
    if (!unique.has(identity)) unique.set(identity, normalizedSlot);
  });
  return Array.from(unique.values()).sort(function sortSlots(a, b) { return a.start - b.start; });
}

function slotConflictsWithAppointments(slot, appointments) {
  if (!slot || !(slot.start instanceof Date) || !(slot.end instanceof Date)) return true;
  return (appointments || []).some(function overlaps(appointment) {
    if (String(appointment && appointment.status || '').toLowerCase() !== 'scheduled') return false;
    if (slot.store_id && appointment.store_id && text(slot.store_id) !== text(appointment.store_id)) return false;
    const start = new Date(appointment.start_at);
    if (Number.isNaN(start.getTime())) return false;
    const parsedEnd = appointment.end_at ? new Date(appointment.end_at) : new Date(start.getTime() + 30 * 60000);
    const end = Number.isNaN(parsedEnd.getTime()) ? new Date(start.getTime() + 30 * 60000) : parsedEnd;
    return slot.start < end && slot.end > start;
  });
}

function filterSlotsAgainstAppointments(slots, appointments) {
  return (slots || []).filter(function availableLocally(slot) { return !slotConflictsWithAppointments(slot, appointments); });
}

function availabilityCacheItems(payload) {
  if (!payload || (typeof payload !== 'object' && !Array.isArray(payload))) return [];
  const snapshotBody = Array.isArray(payload) ? { verified_open_slots: payload } : payload;
  const snapshot = Object.assign({}, snapshotBody, {
    id: 'dealer-appointment-availability-snapshot',
    record_type: 'availability_snapshot'
  });
  const slots = availabilitySlotRecords(payload).map(function cacheSlot(slot) {
    return Object.assign({}, slot, { record_type: 'verified_open_slot' });
  });
  return [snapshot].concat(slots);
}

function availabilityItemCount(payload) {
  const count = availabilitySlotRecords(payload).length;
  return count || (payload && typeof payload === 'object' ? 1 : 0);
}

function compactAvailabilityContext(payload, settings, referenceDate) {
  const primaryPayload = Array.isArray(payload)
    ? (payload.find(function snapshot(item) { return item && item.record_type === 'availability_snapshot'; }) || payload[0] || {})
    : payload;
  const slots = normalizeAvailability(payload, Object.assign({
    auto_appointments_min_notice_hours: 0,
    auto_appointments_max_days: 365,
    auto_appointments_duration_minutes: 30
  }, settings || {}), referenceDate || new Date()).slice(0, 60);
  const scalar = function scalar(keys) {
    const wanted = new Set(keys);
    const preferred = firstNamedValue(primaryPayload, wanted);
    return preferred === null || preferred === undefined ? firstNamedValue(payload, wanted) : preferred;
  };
  const schedule = firstNamedValue(primaryPayload, WEEKLY_SCHEDULE_KEYS) || firstNamedValue(payload, WEEKLY_SCHEDULE_KEYS);
  const blockedDates = Array.from(collectDateKeys(payload, BLOCKED_DATE_KEYS)).sort().slice(0, 120);
  const openDates = Array.from(collectDateKeys(payload, OPEN_DATE_KEYS)).sort().slice(0, 120);
  return {
    source: 'website:dealer-appointment-availability',
    verified: true,
    last_synced_at: scalar(['__last_seen_at', 'last_synced_at', 'synced_at']) || null,
    dealer_id: scalar(['dealer_id']) || null,
    dealer_name: scalar(['dealer_name']) || null,
    store_id: scalar(['store_id']) || null,
    store_name: scalar(['store_name']) || null,
    phone: scalar(['phone', 'dealer_phone', 'store_phone']) || null,
    email: scalar(['email', 'dealer_email', 'store_email']) || null,
    location: scalar(['location', 'address', 'dealer_location', 'store_location']) || null,
    timezone: scalar(['timezone']) || null,
    slot_minutes: number(scalar(['slot_minutes', 'slot_duration_minutes', 'duration_minutes']), null),
    weekly_schedule: schedule || null,
    blocked_dates: blockedDates,
    open_dates: openDates,
    booked_unavailable_times: collectNamedValues(payload, UNAVAILABLE_TIME_KEYS, 80),
    assigned_listings: collectNamedValues(payload, ASSIGNED_LISTING_KEYS, 80),
    verified_open_slots: slots.map(function safeSlot(slot) {
      return {
        slot_id: slot.id,
        start_at: slot.start.toISOString(),
        end_at: slot.end.toISOString(),
        location: slot.location || null,
        dealer_id: slot.dealer_id || null,
        store_id: slot.store_id || null,
        listing_id: slot.listing_id || null
      };
    })
  };
}

function parseTimeParts(message) {
  const source = normalized(message);
  const meridiem = source.match(/(?:\bat\s+|\ba\s+las?\s+|\b)(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  const dayPart = source.match(/\ba\s+las?\s+(\d{1,2})(?::(\d{2}))?\s+de\s+la\s+(manana|tarde|noche|madrugada)\b/i);
  const clock = source.match(/\b(\d{1,2}):(\d{2})\b/);
  const bare = source.match(/\ba\s+las?\s+(\d{1,2})\b/i);
  const match = meridiem || dayPart || clock || bare;
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = text(match[3]).replaceAll('.', '').toLowerCase();
  if (period === 'pm' && hour < 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;
  if (period === 'tarde' && hour < 12) hour += 12;
  if (period === 'noche' && hour >= 1 && hour < 12) hour += 12;
  if ((period === 'manana' || period === 'madrugada') && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour: hour, minute: minute, ambiguous: !meridiem && !dayPart };
}

function parseRequestedDateTime(message, referenceDate) {
  const source = normalized(message);
  const now = referenceDate ? new Date(referenceDate) : new Date();
  let date = null;
  const iso = source.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  const slash = source.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/);
  if (iso) date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  else if (slash) {
    let year = slash[3] ? Number(slash[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    date = new Date(year, Number(slash[1]) - 1, Number(slash[2]));
  } else if (/\b(tomorrow|manana)\b/.test(source)) {
    date = new Date(now); date.setDate(date.getDate() + 1);
  } else if (/\b(today|hoy)\b/.test(source)) {
    date = new Date(now);
  } else {
    for (const pair of Object.entries(WEEKDAYS)) {
      if (new RegExp('\\b' + pair[0] + '\\b').test(source)) {
        date = new Date(now);
        let add = (pair[1] - date.getDay() + 7) % 7;
        if (add === 0) add = 7;
        date.setDate(date.getDate() + add);
        break;
      }
    }
  }
  const time = parseTimeParts(source);
  if (!date) return { date: null, time: time, exact: false };
  date.setHours(time ? time.hour : 0, time ? time.minute : 0, 0, 0);
  return { date: date, time: time, exact: Boolean(time) };
}

function isAppointmentAvailabilityIntent(message) {
  return /\b(appointments?|schedules?|available times?|opening hours?|business hours?|book|test drive|citas?|agendar|horarios?|horas? disponibles?|disponibilidad|dias? disponibles?|reservar|prueba de manejo|dias? off)\b/i.test(normalized(message));
}

module.exports = {
  BLOCKED_DATE_KEYS,
  NEXA_APPOINTMENT_CONSISTENCY_GUARD_V1,
  NEXA_LIVE_DEALER_AVAILABILITY_V1,
  OPEN_DATE_KEYS,
  SLOT_KEYS,
  WEEKLY_SCHEDULE_KEYS,
  availabilityCacheItems,
  availabilityItemCount,
  availabilityStart,
  availabilitySlotRecords,
  compactAvailabilityContext,
  dateAvailabilityState,
  filterSlotsAgainstAppointments,
  dailyScheduleWindow,
  isAppointmentAvailabilityIntent,
  localDateKey,
  normalizeAvailability,
  parseRequestedDateTime,
  slotConflictsWithAppointments
};
