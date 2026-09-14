// lib/db.js

export async function getActiveBaskets(db) {
  const { results } = await db
    .prepare("SELECT id, name, description, image_path, arv_cents FROM baskets WHERE active = 1 ORDER BY id")
    .all();
  return results;
}

export async function getBasketById(db, id) {
  return db.prepare("SELECT * FROM baskets WHERE id = ?").bind(id).first();
}

export async function insertBasket(db, { name, description, image_path, arv_cents = null }) {
  const { meta } = await db
    .prepare("INSERT INTO baskets (name, description, image_path, arv_cents) VALUES (?, ?, ?, ?)")
    .bind(name, description, image_path, arv_cents)
    .run();
  return { id: meta.last_row_id };
}

export async function updateBasketArv(db, { id, arv_cents }) {
  await db.prepare("UPDATE baskets SET arv_cents = ? WHERE id = ?").bind(arv_cents, id).run();
}

export async function insertRaffleEntry(
  db,
  { basketId, donorName, donorEmail, ticketCount, entryMethod, stripeSessionId = null }
) {
  const { meta } = await db
    .prepare(
      `INSERT OR IGNORE INTO raffle_entries
        (basket_id, donor_name, donor_email, ticket_count, entry_method, stripe_session_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(basketId, donorName, donorEmail, ticketCount, entryMethod, stripeSessionId)
    .run();
  return { id: meta.last_row_id };
}

export async function getUpcomingWorkshopDays(db) {
  const { results } = await db
    .prepare(
      `SELECT id, title, event_date, location, price_full_cents, price_half_cents,
              capacity, seats_taken, (capacity - seats_taken) AS seatsRemaining
       FROM workshop_days
       WHERE active = 1 AND event_date >= date('now')
       ORDER BY event_date`
    )
    .all();
  return results;
}

export async function getWorkshopDayById(db, id) {
  return db.prepare("SELECT * FROM workshop_days WHERE id = ?").bind(id).first();
}

export async function insertWorkshopDay(
  db,
  { title, eventDate, location, priceFullCents, priceHalfCents, capacity }
) {
  const { meta } = await db
    .prepare(
      `INSERT INTO workshop_days
        (title, event_date, location, price_full_cents, price_half_cents, capacity)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(title, eventDate, location, priceFullCents, priceHalfCents, capacity)
    .run();
  return { id: meta.last_row_id };
}

export async function reserveSeat(db, workshopDayId) {
  const { meta } = await db
    .prepare(
      `UPDATE workshop_days
       SET seats_taken = seats_taken + 1
       WHERE id = ? AND seats_taken < capacity`
    )
    .bind(workshopDayId)
    .run();
  return meta.changes > 0;
}

export async function releaseSeat(db, workshopDayId) {
  const { meta } = await db
    .prepare(
      `UPDATE workshop_days
       SET seats_taken = seats_taken - 1
       WHERE id = ? AND seats_taken > 0`
    )
    .bind(workshopDayId)
    .run();
  return meta.changes > 0;
}

export async function insertPendingRegistration(db, r) {
  const { meta } = await db
    .prepare(
      `INSERT INTO registrations
        (workshop_day_id, child_name, child_dob, parent_name, address, phone, email,
         emergency_contact_name, emergency_contact_phone, allergies_medical,
         waiver_accepted, waiver_signature_name, waiver_timestamp, photo_release,
         registration_type, promo_code_used, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .bind(
      r.workshopDayId,
      r.childName,
      r.childDob,
      r.parentName,
      r.address,
      r.phone,
      r.email,
      r.emergencyContactName,
      r.emergencyContactPhone,
      r.allergiesMedical ?? null,
      r.waiverAccepted ? 1 : 0,
      r.waiverSignatureName,
      r.waiverTimestamp,
      r.photoRelease ? 1 : 0,
      r.registrationType,
      r.promoCodeUsed ?? null
    )
    .run();
  return { id: meta.last_row_id };
}

export async function confirmRegistration(db, id, { stripeSessionId, amountPaidCents = null, promoCodeUsed = null }) {
  await db
    .prepare(
      `UPDATE registrations
       SET status = 'confirmed', stripe_session_id = ?, amount_paid_cents = ?, promo_code_used = ?
       WHERE id = ?`
    )
    .bind(stripeSessionId, amountPaidCents, promoCodeUsed, id)
    .run();
}

export async function getRegistrationById(db, id) {
  return db.prepare("SELECT * FROM registrations WHERE id = ?").bind(id).first();
}

export async function expireRegistration(db, id) {
  await db
    .prepare("UPDATE registrations SET status = 'expired' WHERE id = ? AND status = 'pending'")
    .bind(id)
    .run();
}

export async function insertDonation(db, { donorName, donorEmail, amountCents, designation, stripeSessionId }) {
  const { meta } = await db
    .prepare(
      `INSERT OR IGNORE INTO donations (donor_name, donor_email, amount_cents, designation, stripe_session_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(donorName, donorEmail, amountCents, designation, stripeSessionId)
    .run();
  return { id: meta.last_row_id };
}

export async function listRaffleEntries(db, { basketId } = {}) {
  const stmt = basketId
    ? db.prepare("SELECT * FROM raffle_entries WHERE basket_id = ? ORDER BY created_at DESC").bind(basketId)
    : db.prepare("SELECT * FROM raffle_entries ORDER BY created_at DESC");
  const { results } = await stmt.all();
  return results;
}

export async function listRegistrations(db, { workshopDayId } = {}) {
  const stmt = workshopDayId
    ? db
        .prepare("SELECT * FROM registrations WHERE workshop_day_id = ? AND status = 'confirmed' ORDER BY created_at DESC")
        .bind(workshopDayId)
    : db.prepare("SELECT * FROM registrations WHERE status = 'confirmed' ORDER BY created_at DESC");
  const { results } = await stmt.all();
  return results;
}

export async function listDonations(db) {
  const { results } = await db.prepare("SELECT * FROM donations ORDER BY created_at DESC").all();
  return results;
}

export async function recordFailedLoginAttempt(db, ipAddress) {
  await db.prepare("INSERT INTO login_attempts (ip_address) VALUES (?)").bind(ipAddress).run();
}

export async function countRecentFailedLoginAttempts(db, ipAddress, windowMinutes) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM login_attempts
       WHERE ip_address = ? AND attempted_at >= datetime('now', ?)`
    )
    .bind(ipAddress, `-${windowMinutes} minutes`)
    .first();
  return row.count;
}
