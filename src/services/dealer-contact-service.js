'use strict';

const NEXA_LIVE_DEALER_CONTACT_V1 = 'NEXA_LIVE_DEALER_CONTACT_V1';

function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }
function normalized(value) {
  return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function safeJson(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '{}')); } catch (_) { return {}; }
}

function sameIdentity(left, right) {
  return Boolean(text(left) && text(right) && text(left) === text(right));
}

function recordIdentity(record, keys) {
  const source = record && typeof record === 'object' ? record : {};
  for (const key of keys) {
    if (text(source[key])) return text(source[key]);
  }
  return '';
}

function findByIdentity(rows, wanted, keys) {
  const id = text(wanted);
  if (!id) return null;
  return (rows || []).find(function matchingRecord(record) {
    return keys.some(function matchingKey(key) { return sameIdentity(record && record[key], id); });
  }) || null;
}

function labeledListingTitle(conversation) {
  const rows = conversation && Array.isArray(conversation.messages) ? conversation.messages.slice().reverse() : [];
  for (const row of rows) {
    const match = text(row && row.body).match(/(?:^|\n)\s*(?:listing|art[ií]culo|veh[ií]culo)\s*:\s*([^\n]+)/i);
    if (match && text(match[1])) return text(match[1]);
  }
  return '';
}

function conversationDealerScope(database, conversation) {
  const thread = conversation && conversation.thread && typeof conversation.thread === 'object' ? conversation.thread : {};
  const payload = safeJson(thread.payload_json);
  const contextType = normalized(thread.context_type || payload.context_type);
  const contextId = text(thread.context_id || payload.context_id);
  const orders = database && typeof database.listIntegrationCache === 'function'
    ? database.listIntegrationCache('orders', '', 500).concat(database.listIntegrationCache('reseller-appointments', '', 200)) : [];
  const listingRows = database && typeof database.listIntegrationCache === 'function'
    ? database.listIntegrationCache('listings', '', 500).concat(database.listIntegrationCache('reseller-listings', '', 500)) : [];
  const order = /order|lead/.test(contextType)
    ? findByIdentity(orders, contextId, ['id', 'order_id', 'lead_id', 'appointment_id']) : null;
  const explicitListingId = text(thread.listing_id || payload.listing_id || order && order.listing_id || (/listing|vehicle|inventory/.test(contextType) ? contextId : ''));
  const messageListingTitle = labeledListingTitle(conversation);
  let listing = findByIdentity(listingRows, explicitListingId, ['id', 'listing_id', 'assignment_id']);
  if (!listing && messageListingTitle) {
    const wantedTitle = normalized(messageListingTitle);
    listing = listingRows.find(function matchingTitle(item) {
      const candidate = normalized(item && (item.listing_title || item.title));
      return Boolean(candidate && (candidate === wantedTitle || candidate.includes(wantedTitle) || wantedTitle.includes(candidate)));
    }) || null;
  }
  return {
    context_type: contextType,
    context_id: contextId,
    order: order,
    listing: listing,
    listing_id: text(explicitListingId || listing && (listing.listing_id || listing.id)),
    listing_title: text(order && order.listing_title || listing && (listing.listing_title || listing.title) || messageListingTitle),
    store_id: text(thread.store_id || payload.store_id || order && order.store_id || listing && listing.store_id),
    dealer_id: text(thread.dealer_id || payload.dealer_id || order && order.dealer_id || listing && listing.dealer_id),
    store_name: text(order && order.store_name || listing && listing.store_name),
    dealer_name: text(order && order.dealer_name || listing && listing.dealer_name)
  };
}

function physicalAddress(record) {
  const source = record && typeof record === 'object' ? record : {};
  const primary = text(source.store_address || source.dealer_address || source.address
    || source.store_location || source.dealer_location || source.location);
  const parts = [primary, text(source.city), text(source.state), text(source.zip || source.postal_code)].filter(Boolean);
  const output = [];
  parts.forEach(function uniquePart(part) {
    const candidate = normalized(part);
    if (!candidate || output.some(function contained(existing) { return normalized(existing).includes(candidate) || candidate.includes(normalized(existing)); })) return;
    output.push(part);
  });
  return output.join(', ');
}

function inheritContactContext(parent, record) {
  const source = record && typeof record === 'object' ? record : {};
  const inherited = Object.assign({}, parent || {});
  for (const key of ['store_id','dealer_id','listing_id','store_name','dealer_name']) {
    if (text(source[key])) inherited[key] = text(source[key]);
  }
  return inherited;
}

function collectContactCandidates(value, sourceName, inherited, output, depth) {
  if (depth > 7 || value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.slice(0, 1000).forEach(function visit(item) { collectContactCandidates(item, sourceName, inherited, output, depth + 1); });
    return;
  }
  if (typeof value !== 'object') return;
  const context = inheritContactContext(inherited, value);
  const effective = Object.assign({}, context, value);
  if (physicalAddress(effective)) output.push(Object.assign({}, effective, { __source: sourceName }));
  Object.entries(value).forEach(function visitChild(entry) {
    if (entry[1] && typeof entry[1] === 'object') collectContactCandidates(entry[1], sourceName, context, output, depth + 1);
  });
}

function sourceRows(database, resource, limit) {
  return database && typeof database.listIntegrationCache === 'function'
    ? database.listIntegrationCache(resource, '', limit || 100) : [];
}

function dealerContactCandidates(database) {
  const output = [];
  const resources = [
    ['store', 5], ['stores', 100], ['dealer-appointment-availability', 500], ['dealer-agenda-calendar', 500],
    ['listings', 500], ['reseller-listings', 500]
  ];
  resources.forEach(function collectResource(pair) {
    sourceRows(database, pair[0], pair[1]).forEach(function collectRow(row) {
      collectContactCandidates(row, pair[0], {}, output, 0);
    });
  });
  const unique = new Map();
  output.forEach(function deduplicate(item) {
    const key = [normalized(physicalAddress(item)), text(item.store_id), text(item.dealer_id), text(item.listing_id)].join('|');
    if (!unique.has(key)) unique.set(key, item);
  });
  return Array.from(unique.values());
}

function assignedListingMatches(record, listingId) {
  const wanted = text(listingId);
  if (!wanted) return false;
  const assigned = [].concat(record && record.assigned_listings || [], record && record.listings || []);
  return assigned.some(function matchingListing(item) {
    return sameIdentity(item && (item.listing_id || item.id || item.assignment_listing_id), wanted);
  });
}

function candidateScore(record, scope, accountType) {
  let score = 0;
  const recordStore = text(record && record.store_id);
  const recordDealer = text(record && record.dealer_id);
  const recordListing = text(record && (record.listing_id || record.assignment_listing_id));
  if (scope.store_id) score += recordStore ? (sameIdentity(recordStore, scope.store_id) ? 120 : -500) : 0;
  if (scope.dealer_id) score += recordDealer ? (sameIdentity(recordDealer, scope.dealer_id) ? 80 : -300) : 0;
  if (scope.listing_id) {
    if (recordListing) score += sameIdentity(recordListing, scope.listing_id) ? 90 : -80;
    if (assignedListingMatches(record, scope.listing_id)) score += 100;
  }
  if (record.__source === 'store') score += accountType === 'dealer' ? 45 : 20;
  if (record.__source === 'dealer-appointment-availability') score += 35;
  if (record.__source === 'dealer-agenda-calendar') score += 25;
  if (record.__source === 'listings' || record.__source === 'reseller-listings') score += 15;
  if (text(record.address || record.store_address || record.dealer_address)) score += 15;
  if (/\d{2,}/.test(physicalAddress(record))) score += 30;
  if (text(record.phone || record.store_phone || record.dealer_phone)) score += 3;
  return score;
}

function publicContact(record, scope) {
  const source = record && typeof record === 'object' ? record : {};
  return {
    marker: NEXA_LIVE_DEALER_CONTACT_V1,
    verified: true,
    source: text(source.__source),
    dealer_id: text(source.dealer_id || scope.dealer_id),
    dealer_name: text(source.dealer_name || scope.dealer_name),
    store_id: text(source.store_id || scope.store_id),
    store_name: text(source.store_name || scope.store_name),
    listing_id: text(scope.listing_id),
    listing_title: text(scope.listing_title),
    address: physicalAddress(source),
    phone: text(source.store_phone || source.dealer_phone || source.phone),
    email: text(source.store_email || source.dealer_email || source.email),
    public_store_url: text(source.public_store_url || source.listing_url)
  };
}

function resolveDealerContact(database, conversation) {
  const scope = conversationDealerScope(database, conversation);
  const status = database && typeof database.getIntegrationStatus === 'function' ? database.getIntegrationStatus() : {};
  const accountType = normalized(status && status.account_type);
  const ranked = dealerContactCandidates(database).map(function score(record) {
    return { record: record, score: candidateScore(record, scope, accountType) };
  }).filter(function usable(item) { return item.score > -100 && physicalAddress(item.record); })
    .sort(function sort(left, right) { return right.score - left.score; });
  if (!ranked.length) return Object.assign(publicContact({}, scope), { verified: false, reason: 'dealer_address_not_synchronized' });
  const bestAddress = normalized(physicalAddress(ranked[0].record));
  const tiedDifferentAddress = ranked.length > 1 && ranked[1].score === ranked[0].score
    && normalized(physicalAddress(ranked[1].record)) !== bestAddress;
  const scoped = Boolean(scope.store_id || scope.dealer_id || scope.listing_id);
  if (tiedDifferentAddress && !scoped) return Object.assign(publicContact({}, scope), { verified: false, reason: 'multiple_dealer_addresses_require_listing_context' });
  return publicContact(ranked[0].record, scope);
}

function dealerAddressIntent(message) {
  const source = normalized(message);
  if (!source || /proof of residence|address verification|utility bill|prueba de residencia|comprobante de domicilio|verificar direccion/.test(source)) return false;
  return /\b(direccion|ubicacion|como llegar|como llego|donde esta|donde queda|address|directions|location|where is|where are|where located|how do i get there)\b/.test(source);
}

function contactResponse(contact, locale) {
  const spanish = locale === 'es';
  if (!contact || !contact.verified || !contact.address) {
    return spanish
      ? 'En este momento no aparece una dirección física verificada para ese dealer en los datos sincronizados. No quiero darle una dirección incorrecta; puede continuar por este mismo chat para que el equipo confirme el local correcto.'
      : 'A verified physical address for that dealer is not currently present in the synchronized data. I do not want to provide an incorrect address; please continue in this chat so the team can confirm the correct location.';
  }
  const subject = contact.listing_title
    ? (spanish ? 'El artículo ' + contact.listing_title : 'The ' + contact.listing_title)
    : (spanish ? 'El dealer' : 'The dealership');
  const dealer = text(contact.store_name || contact.dealer_name);
  const atDealer = dealer ? (spanish ? ' se encuentra en ' + dealer + ', en ' : ' is located at ' + dealer + ', at ') : (spanish ? ' se encuentra en ' : ' is located at ');
  const closing = spanish
    ? ' Si desea visitarlo, también puedo ayudarle a coordinar una cita en un horario disponible.'
    : ' If you would like to visit, I can also help arrange an appointment at an available time.';
  return subject + atDealer + contact.address + '.' + closing;
}

function liveDealerContactMatch(database, conversation, latestMessage, context) {
  if (!dealerAddressIntent(latestMessage)) return null;
  const contact = resolveDealerContact(database, conversation);
  const locale = context && context.locale === 'es' ? 'es' : 'en';
  return {
    matched: true,
    confidence: 1,
    latestMessage: text(latestMessage),
    knowledgeId: 'live-dealer-contact',
    label: 'Live dealer address and contact',
    category: 'Live connected business',
    intentKey: 'live_dealer_address',
    locale: locale,
    dealerSegment: context && context.segment || 'used-auto',
    safetyLevel: 'standard',
    requiredContext: [],
    builtIn: false,
    dynamic: true,
    libraryVersion: 'website-live',
    contact: contact,
    response: contactResponse(contact, locale)
  };
}

module.exports = {
  NEXA_LIVE_DEALER_CONTACT_V1,
  contactResponse,
  conversationDealerScope,
  dealerAddressIntent,
  dealerContactCandidates,
  liveDealerContactMatch,
  physicalAddress,
  resolveDealerContact
};
