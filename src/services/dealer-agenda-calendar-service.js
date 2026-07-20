'use strict';

const crypto = require('node:crypto');

const NEXA_DEALER_AGENDA_CALENDAR_SYNC_V1 = 'NEXA_DEALER_AGENDA_CALENDAR_SYNC_V1';

function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }

function sourcePayload(payload) {
  if (Array.isArray(payload)) return { stores: payload };
  return payload && typeof payload === 'object' ? payload : {};
}

function storesFromCalendar(payload) {
  const source = sourcePayload(payload);
  if (Array.isArray(source.stores)) return source.stores;
  if (source.store && typeof source.store === 'object') return [source.store];
  return source.store_id || Array.isArray(source.days) ? [source] : [];
}

function appointmentStart(item) {
  if (!item || typeof item !== 'object') return '';
  if (text(item.start_at)) return text(item.start_at);
  const date = text(item.appointment_date || item.date);
  const time = text(item.appointment_time || item.start_time || item.time);
  return date && time ? date + 'T' + time : date;
}

function appointmentIdentity(item, index) {
  const explicit = text(item && (item.appointment_id || item.order_id || item.id));
  if (explicit) return explicit;
  return crypto.createHash('sha256').update(JSON.stringify(item || {}) + ':' + index).digest('hex').slice(0, 24);
}

function collectAppointments(payload) {
  const source = sourcePayload(payload);
  const collected = [];
  const seen = new Set();
  function add(item, context, index) {
    if (!item || typeof item !== 'object') return;
    const normalized = Object.assign({}, context || {}, item);
    const identity = appointmentIdentity(normalized, index);
    if (seen.has(identity)) return;
    seen.add(identity);
    collected.push(Object.assign({}, normalized, {
      id: identity,
      appointment_id: normalized.appointment_id || normalized.id || identity,
      start_at: appointmentStart(normalized),
      status: normalized.status || normalized.appointment_status || 'scheduled',
      record_type: 'calendar_appointment'
    }));
  }
  (Array.isArray(source.appointments) ? source.appointments : []).forEach(function top(item, index) { add(item, {}, index); });
  storesFromCalendar(source).forEach(function store(store, storeIndex) {
    const storeContext = { store_id: store.store_id || null, store_name: store.store_name || null };
    (Array.isArray(store.appointments) ? store.appointments : []).forEach(function storeAppointment(item, index) { add(item, storeContext, storeIndex * 1000 + index); });
    (Array.isArray(store.days) ? store.days : []).forEach(function day(day, dayIndex) {
      const dayContext = Object.assign({}, storeContext, { appointment_date: day.date || day.appointment_date || null });
      (Array.isArray(day.appointments) ? day.appointments : []).forEach(function dayAppointment(item, index) { add(item, dayContext, storeIndex * 100000 + dayIndex * 1000 + index); });
    });
  });
  return collected;
}

function countOpenSlots(payload) {
  const source = sourcePayload(payload);
  if (Number.isFinite(Number(source.verified_open_slots))) return Number(source.verified_open_slots);
  let count = 0;
  storesFromCalendar(source).forEach(function store(store) {
    if (Number.isFinite(Number(store.verified_open_slots))) count += Number(store.verified_open_slots);
    (Array.isArray(store.days) ? store.days : []).forEach(function day(day) {
      for (const key of ['available_slots','verified_open_slots','open_slots']) {
        if (Array.isArray(day[key])) { count += day[key].length; return; }
      }
    });
  });
  return count;
}

function blockedDates(payload) {
  const dates = new Set();
  storesFromCalendar(payload).forEach(function store(store) {
    for (const key of ['blocked_dates','off_dates','closed_dates']) {
      (Array.isArray(store[key]) ? store[key] : []).forEach(function add(value) { if (text(value)) dates.add(text(value.date || value)); });
    }
    (Array.isArray(store.days) ? store.days : []).forEach(function day(day) {
      if (day && (day.blocked === true || day.closed === true || day.is_off === true || day.is_open === false)) {
        if (text(day.date)) dates.add(text(day.date));
      }
    });
  });
  return Array.from(dates).sort();
}

function calendarCacheItems(payload) {
  const source = sourcePayload(payload);
  if (!Object.keys(source).length) return [];
  const snapshot = Object.assign({}, source, {
    id: 'dealer-agenda-calendar-snapshot',
    record_type: 'calendar_snapshot',
    marker: NEXA_DEALER_AGENDA_CALENDAR_SYNC_V1
  });
  return [snapshot].concat(collectAppointments(source));
}

function calendarAppointmentsFromCache(rows) {
  const items = Array.isArray(rows) ? rows : [];
  const snapshot = items.find(function findSnapshot(item) { return item && item.record_type === 'calendar_snapshot'; });
  const direct = items.filter(function directAppointment(item) { return item && item.record_type === 'calendar_appointment'; });
  return direct.length ? direct : collectAppointments(snapshot || {});
}

function calendarItemCount(payload) {
  const appointments = collectAppointments(payload).length;
  const openSlots = countOpenSlots(payload);
  return appointments + openSlots || (Object.keys(sourcePayload(payload)).length ? 1 : 0);
}

function compactDealerAgendaContext(payload) {
  const source = Array.isArray(payload)
    ? (payload.find(function snapshot(item) { return item && item.record_type === 'calendar_snapshot'; }) || {})
    : sourcePayload(payload);
  const appointments = collectAppointments(source).slice(0, 80);
  return {
    source: 'website:dealer-agenda-calendar',
    verified: true,
    marker: NEXA_DEALER_AGENDA_CALENDAR_SYNC_V1,
    appointment_count: Number(source.appointment_count || appointments.length),
    verified_open_slots: countOpenSlots(source),
    blocked_dates: blockedDates(source).slice(0, 120),
    stores: storesFromCalendar(source).slice(0, 20),
    appointments: appointments
  };
}

module.exports = {
  NEXA_DEALER_AGENDA_CALENDAR_SYNC_V1,
  blockedDates,
  calendarCacheItems,
  calendarAppointmentsFromCache,
  calendarItemCount,
  collectAppointments,
  compactDealerAgendaContext,
  countOpenSlots,
  storesFromCalendar
};
