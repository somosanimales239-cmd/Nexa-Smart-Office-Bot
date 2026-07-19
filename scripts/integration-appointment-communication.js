'use strict';

const assert = require('node:assert/strict');
const {
  availabilityCacheItems,
  localDateKey,
  normalizeAvailability
} = require('../src/services/dealer-availability-service');
const {
  NEXA_PRO_APPOINTMENT_COMMUNICATION_V1,
  appointmentConfirmation,
  appointmentConversationPlan
} = require('../src/services/appointment-communication-service');

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

function test(name, fn) {
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
  assert.match(plan.response, /conveniente alguno/i);
});

test('unavailable time offers other verified times on the same day', function () {
  const plan = appointmentConversationPlan({
    payload: cached, slots: slots, conversation: { messages: [] },
    message: '¿Puedo hacer una cita el ' + usDate(firstDay) + ' a las 11:00 AM?', locale: 'es', referenceDate: now
  });
  assert.equal(plan.decision, 'offer_same_day');
  assert.match(plan.response, /hora solicitada no está disponible/i);
  assert.match(plan.response, /10:00 AM/);
  assert.match(plan.response, /1:00 PM/);
});

test('blocked day offers the next verified available day', function () {
  const plan = appointmentConversationPlan({
    payload: cached, slots: slots, conversation: { messages: [] },
    message: 'Necesito una cita el ' + usDate(blockedDay), locale: 'es', referenceDate: now
  });
  assert.equal(plan.decision, 'blocked_day');
  assert.match(plan.response, /día off|fecha bloqueada/i);
  assert.match(plan.response, /siguiente día con disponibilidad verificada/i);
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
  assert.match(plan.response, /busquemos otra opción/i);
  assert.match(plan.response, /10:00 AM/);
  assert.match(plan.response, /2:00 PM/);
});

test('customer appointment decline closes politely with dealer contact details', function () {
  const conversation = { messages: firstConversation.messages.concat({ direction: 'inbound', body: 'No gracias, no quiero una cita.' }) };
  const plan = appointmentConversationPlan({ payload: cached, slots: slots, conversation: conversation, message: 'No gracias, no quiero una cita.', locale: 'es', referenceDate: now });
  assert.equal(plan.decision, 'decline');
  assert.match(plan.response, /no hay problema/i);
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
  assert.match(plan.response, /disponible y verificada/i);
  assert.match(plan.response, /prepare la cita/i);
});

test('appointment confirmation includes date, time, location and change contact', function () {
  const confirmation = appointmentConfirmation(slots.find(function find(slot) { return slot.id === 'first-10'; }), 'es', cached);
  assert.match(confirmation, /10:00 AM/);
  assert.match(confirmation, /Main showroom/);
  assert.match(confirmation, /239-555-0199/);
  assert.match(confirmation, /cambiarla/i);
});

console.log('Professional appointment communication tests: ' + passed + '/9 passed.');
if (process.exitCode) process.exit(process.exitCode);
