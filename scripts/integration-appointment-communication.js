'use strict';

const assert = require('node:assert/strict');
const {
  availabilityCacheItems,
  filterSlotsAgainstAppointments,
  localDateKey,
  normalizeAvailability
} = require('../src/services/dealer-availability-service');
const {
  NEXA_PRO_APPOINTMENT_COMMUNICATION_V1,
  appointmentConfirmation,
  appointmentConversationPlan
} = require('../src/services/appointment-communication-service');
const {
  NEXA_BILINGUAL_APPOINTMENT_LIBRARY_V1,
  classifyAppointmentMessage,
  libraryStatistics
} = require('../src/services/appointment-communication-library-service');

const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const now = new Date();
now.setSeconds(0, 0);
const blockedDay = new Date(now);
blockedDay.setDate(blockedDay.getDate() + 1);
blockedDay.setHours(12, 0, 0, 0);
const firstDay = new Date(blockedDay);
firstDay.setDate(firstDay.getDate() + 1);
const secondDay = new Date(firstDay);
secondDay.setDate(secondDay.getDate() + 1);

function at(date, hour, minute) {
  const value = new Date(date);
  value.setHours(hour, minute || 0, 0, 0);
  return value;
}

function usDate(value) {
  return String(value.getMonth() + 1).padStart(2, '0') + '/' + String(value.getDate()).padStart(2, '0') + '/' + value.getFullYear();
}

const payload = {
  dealer_id: 'dealer-pro', dealer_name: 'Professional Dealer', store_id: 'store-pro', store_name: 'Professional Motors',
  phone: '239-555-0199', email: 'appointments@example.com', location: '100 Main Street, Naples, FL', slot_minutes: 30,
  weekly_schedule: {
    [weekdays[firstDay.getDay()]]: { open: '09:00', close: '17:00' },
    [weekdays[secondDay.getDay()]]: { open: '10:00', close: '16:00' }
  },
  blocked_dates: [localDateKey(blockedDay)],
  verified_open_slots: [
    { slot_id: 'first-10', start_at: at(firstDay, 10).toISOString(), available: true, location: 'Main showroom' },
    { slot_id: 'first-13', start_at: at(firstDay, 13).toISOString(), available: true, location: 'Main showroom' },
    { slot_id: 'first-15', start_at: at(firstDay, 15, 30).toISOString(), available: true, location: 'Main showroom' },
    { slot_id: 'second-10', start_at: at(secondDay, 10).toISOString(), available: true, location: 'Main showroom' },
    { slot_id: 'second-14', start_at: at(secondDay, 14).toISOString(), available: true, location: 'Main showroom' }
  ]
};
const cached = availabilityCacheItems(payload);
const slots = normalizeAvailability(cached, {
  auto_appointments_min_notice_hours: 0,
  auto_appointments_max_days: 30,
  auto_appointments_duration_minutes: 30
}, now);
let passed = 0;
let total = 0;

function test(name, fn) {
  total += 1;
  try {
    fn();
    passed += 1;
    console.log('PASS ' + name);
  } catch (error) {
    console.error('FAIL ' + name + ': ' + (error.stack || error.message));
    process.exitCode = 1;
  }
}

test('professional appointment communication contract marker is present', function () {
  assert.equal(NEXA_PRO_APPOINTMENT_COMMUNICATION_V1, 'NEXA_PRO_APPOINTMENT_COMMUNICATION_V1');
  assert.equal(NEXA_BILINGUAL_APPOINTMENT_LIBRARY_V1, 'NEXA_BILINGUAL_APPOINTMENT_LIBRARY_V1');
  const summary = libraryStatistics();
  assert.deepEqual(summary.locales, ['en', 'es']);
  assert.ok(summary.phrases >= 300);
  assert.ok(summary.templates >= 68);
});

test('day inquiry states dealer hours, every verified option and a convenience question', function () {
  const plan = appointmentConversationPlan({
    payload: cached, slots: slots, conversation: { messages: [] },
    message: '¿Qué horarios tienen para una cita el ' + usDate(firstDay) + '?', locale: 'es', referenceDate: now
  });
  assert.equal(plan.decision, 'offer_same_day');
  assert.match(plan.response, /9:00 AM a 5:00 PM/i);
  assert.match(plan.response, /10:00 AM/);
  assert.match(plan.response, /1:00 PM/);
  assert.match(plan.response, /3:30 PM/);
  assert.match(plan.response, /le recomiendo|le resulta conveniente|le reservo/i);
});

test('unavailable time offers other verified times on the same day', function () {
  const plan = appointmentConversationPlan({
    payload: cached, slots: slots, conversation: { messages: [] },
    message: '¿Puedo hacer una cita el ' + usDate(firstDay) + ' a las 11:00 AM?', locale: 'es', referenceDate: now
  });
  assert.equal(plan.decision, 'offer_same_day');
  assert.match(plan.response, /hora solicitada no está disponible|ese horario ya no aparece disponible/i);
  assert.match(plan.response, /10:00 AM/);
  assert.match(plan.response, /1:00 PM/);
});

test('blocked day offers the next verified available day', function () {
  const plan = appointmentConversationPlan({
    payload: cached, slots: slots, conversation: { messages: [] },
    message: 'Necesito una cita el ' + usDate(blockedDay), locale: 'es', referenceDate: now
  });
  assert.equal(plan.decision, 'blocked_day');
  assert.match(plan.response, /día off|fecha bloqueada|bloquead[oa](?:\s+en)?(?:\s+su)?\s+Agenda/i);
  assert.match(plan.response, /siguiente fecha disponible|próxima fecha disponible|siguiente fecha con disponibilidad/i);
  assert.match(plan.response, /10:00 AM/);
});

const firstConversation = {
  messages: [
    { direction: 'inbound', body: '¿Qué horarios tienen para una cita el ' + usDate(firstDay) + '?' },
    { direction: 'outbound', body: 'Las horas disponibles verificadas son 10:00 AM, 1:00 PM y 3:30 PM. ¿Cuál le conviene?' }
  ]
};

test('customer rejection of offered hours advances to the next available day', function () {
  const conversation = { messages: firstConversation.messages.concat({ direction: 'inbound', body: 'Ninguno me conviene, ¿tiene otro día?' }) };
  const plan = appointmentConversationPlan({ payload: cached, slots: slots, conversation: conversation, message: 'Ninguno me conviene, ¿tiene otro día?', locale: 'es', referenceDate: now });
  assert.equal(plan.decision, 'offer_next_day');
  assert.match(plan.response, /siguiente fecha|próxima fecha|otra opción|no quedan más espacios/i);
  assert.match(plan.response, /10:00 AM/);
  assert.match(plan.response, /2:00 PM/);
});

test('customer appointment decline closes politely with dealer contact details', function () {
  const conversation = { messages: firstConversation.messages.concat({ direction: 'inbound', body: 'No gracias, no quiero una cita.' }) };
  const plan = appointmentConversationPlan({ payload: cached, slots: slots, conversation: conversation, message: 'No gracias, no quiero una cita.', locale: 'es', referenceDate: now });
  assert.equal(plan.decision, 'decline');
  assert.match(plan.response, /no hay problema|dejamos la cita sin programar/i);
  assert.match(plan.response, /239-555-0199/);
  assert.match(plan.response, /appointments@example\.com/);
  assert.match(plan.response, /100 Main Street/);
  assert.match(plan.response, /mismo chat/i);
});

test('time-only follow-up selects the verified slot and authorizes creation', function () {
  const conversation = { messages: firstConversation.messages.concat({ direction: 'inbound', body: 'La de las 10:00 AM me conviene.' }) };
  const plan = appointmentConversationPlan({ payload: cached, slots: slots, conversation: conversation, message: 'La de las 10:00 AM me conviene.', locale: 'es', referenceDate: now });
  assert.equal(plan.decision, 'select_slot');
  assert.equal(plan.shouldCreate, true);
  assert.equal(plan.selectedSlot.id, 'first-10');
});

test('availability question does not create an appointment without commitment', function () {
  const plan = appointmentConversationPlan({
    payload: cached, slots: slots, conversation: { messages: [] },
    message: '¿Hay una cita disponible el ' + usDate(firstDay) + ' a las 10:00 AM?', locale: 'es', referenceDate: now
  });
  assert.equal(plan.decision, 'exact_available');
  assert.equal(plan.shouldCreate, false);
  assert.match(plan.response, /disponible y verificada|sigue disponible/i);
  assert.match(plan.response, /prepare la cita|le reservo/i);
});

test('appointment confirmation includes date, time, location and change contact', function () {
  const confirmation = appointmentConfirmation(slots.find(function find(slot) { return slot.id === 'first-10'; }), 'es', cached);
  assert.match(confirmation, /10:00 AM/);
  assert.match(confirmation, /Main showroom/);
  assert.match(confirmation, /239-555-0199/);
  assert.match(confirmation, /cambiarla|cualquier cambio/i);
});

test('appointment library recognizes the exact contextual phrase that previously fell into inventory Knowledge', function () {
  const match = classifyAppointmentMessage('y tienes algo mas disponible para ese dia', 'es', true);
  assert.equal(match.matched, true);
  assert.equal(match.intent, 'same_day_alternative');
});

test('an ambiguous inventory availability question is not captured without appointment context', function () {
  const plan = appointmentConversationPlan({ payload: cached, slots: slots, conversation: { messages: [] }, message: '¿Tienen algo disponible?', locale: 'es', referenceDate: now });
  assert.equal(plan.relevant, false);
});

test('local Agenda conflicts are removed before the appointment library can recommend a slot', function () {
  const occupied = slots.find(function find(slot) { return slot.id === 'first-10'; });
  const filtered = filterSlotsAgainstAppointments(slots, [{ status: 'Scheduled', start_at: occupied.start.toISOString(), end_at: occupied.end.toISOString() }]);
  assert.equal(filtered.some(function stillOffered(slot) { return slot.id === 'first-10'; }), false);
  assert.equal(filtered.some(function remains(slot) { return slot.id === 'first-13'; }), true);
});

test('reported conversation remains locked to appointments and recommends verified Agenda alternatives', function () {
  const reference = new Date(2026, 6, 19, 4, 29, 0, 0);
  function fixed(day, hour, minute) { return new Date(2026, 6, day, hour, minute || 0, 0, 0).toISOString(); }
  const reportedPayload = {
    dealer_name: 'Somerset Automotive Sales Network Inc', phone: '239-799-1416', location: 'Somerset dealer',
    blocked_dates: ['2026-07-20'],
    weekly_schedule: { tuesday: { open: '09:00', close: '19:00' }, wednesday: { open: '09:00', close: '20:00' } },
    verified_open_slots: [
      { slot_id: 'tuesday-1730', start_at: fixed(21, 17, 30), available: true },
      { slot_id: 'tuesday-1830', start_at: fixed(21, 18, 30), available: true },
      { slot_id: 'wednesday-1930', start_at: fixed(22, 19, 30), available: true }
    ]
  };
  const reportedCached = availabilityCacheItems(reportedPayload);
  const reportedSlots = normalizeAvailability(reportedCached, { auto_appointments_min_notice_hours: 0, auto_appointments_max_days: 30, auto_appointments_duration_minutes: 30 }, reference);
  const messages = [
    { direction: 'outbound', body: 'Entendido, el próximo lunes. Permítame confirmar los horarios disponibles después de las 7 de la noche para esa fecha y le responderé en breve.', sent_at: fixed(19, 0, 38) },
    { direction: 'inbound', body: 'pudistes confirmar si puedo tener una cita el lunes y que horarios pudiera tener disponibles?', sent_at: fixed(19, 3, 34) },
    { direction: 'outbound', body: 'Ese día aparece como día off o fecha bloqueada en el horario verificado del dealer.', sent_at: fixed(19, 3, 35) },
    { direction: 'inbound', body: 'y tienes algo mas disponible para ese dia', sent_at: fixed(19, 4, 29) }
  ];
  const plan = appointmentConversationPlan({ payload: reportedCached, slots: reportedSlots, conversation: { messages: messages }, message: messages[messages.length - 1].body, locale: 'es', referenceDate: reference });
  assert.equal(plan.decision, 'blocked_day');
  assert.equal(plan.libraryIntent, 'same_day_alternative');
  assert.equal(plan.preference.type, 'after');
  assert.equal(plan.preference.minutes, 19 * 60);
  assert.match(plan.response, /no puedo ofrecer ninguna hora ese día|no hay otro horario disponible ese día/i);
  assert.match(plan.response, /6:30 PM/);
  assert.match(plan.response, /7:30 PM/);
  assert.match(plan.response, /miércoles/i);
  assert.doesNotMatch(plan.response, /vehículo eléctrico|inventario/i);

  const dealerOffer = { direction: 'outbound', body: plan.response, sent_at: fixed(19, 4, 30) };
  const buyerSelection = { direction: 'inbound', body: 'La de las 7:30 PM me conviene.', sent_at: fixed(19, 4, 31) };
  const selection = appointmentConversationPlan({ payload: reportedCached, slots: reportedSlots, conversation: { messages: messages.concat(dealerOffer, buyerSelection) }, message: buyerSelection.body, locale: 'es', referenceDate: reference });
  assert.equal(selection.decision, 'select_slot');
  assert.equal(selection.shouldCreate, true);
  assert.equal(selection.selectedSlot.id, 'wednesday-1930');
});

test('English appointment context keeps an elliptical same-day follow-up out of inventory Knowledge', function () {
  const conversation = { messages: [
    { direction: 'inbound', body: 'Can I schedule an appointment next Tuesday?' },
    { direction: 'outbound', body: 'Tuesday has verified appointment times at 10:00 AM and 2:00 PM.' },
    { direction: 'inbound', body: 'Do you have anything else available that day?' }
  ] };
  const plan = appointmentConversationPlan({ payload: cached, slots: slots, conversation: conversation, message: 'Do you have anything else available that day?', locale: 'en', referenceDate: now });
  assert.equal(plan.relevant, true);
  assert.equal(plan.libraryIntent, 'same_day_alternative');
  assert.doesNotMatch(plan.response, /vehicle inventory|electric or hybrid/i);
});

console.log('Professional appointment communication tests: ' + passed + '/' + total + ' passed.');
if (process.exitCode) process.exit(process.exitCode);
