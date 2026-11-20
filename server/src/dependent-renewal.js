import { one } from './db.js';

/** List / card reference date: active term end, else last ACTIVE renewal end, else birth (age), else null. */
export function dependentListDate(activeTermTo, latestRenewalTermTo, birthAge) {
  if (activeTermTo) return activeTermTo;
  if (latestRenewalTermTo) return latestRenewalTermTo;
  if (birthAge) return birthAge;
  return null;
}

export function mapDependentRenewalFields(row) {
  const renewal_active = !!row.active_term_to;
  return {
    ...row,
    latest_renewal_term_to: row.latest_renewal_term_to ?? null,
    active_term_to: row.active_term_to ?? null,
    renewal_active,
    can_print: renewal_active,
    display_date: dependentListDate(row.active_term_to, row.latest_renewal_term_to, row.age),
  };
}

/** ACTIVE AppRenewals row whose term covers today (same notion as live dependent membership). */
export async function hasActiveDependentRenewal(clientId, dependentId, t = null) {
  const row = await one(
    `SELECT TOP 1 id FROM dbo.AppRenewals
     WHERE client_id=@client AND dependent_id=@dep AND status='ACTIVE'
       AND term_from<=CAST(GETDATE() AS date) AND term_to>=CAST(GETDATE() AS date)
     ORDER BY term_to DESC`,
    { client: clientId, dep: dependentId },
    t,
  );
  return !!row;
}

/** ACTIVE primary renewal whose term covers today (dependent_id IS NULL). */
export async function activePrimaryRenewal(clientId, t = null) {
  return one(
    `SELECT TOP 1 id, term_from, term_to, service_code FROM dbo.AppRenewals
     WHERE client_id=@client AND dependent_id IS NULL AND status='ACTIVE'
       AND ISNULL(transaction_kind,N'RENEWAL')=N'RENEWAL'
       AND term_from<=CAST(GETDATE() AS date) AND term_to>=CAST(GETDATE() AS date)
     ORDER BY term_to DESC`,
    { client: clientId },
    t,
  );
}

export async function activeDependentRenewal(clientId, dependentId, t = null) {
  return one(
    `SELECT TOP 1 id, term_from, term_to, service_code FROM dbo.AppRenewals
     WHERE client_id=@client AND dependent_id=@dep AND status='ACTIVE'
       AND ISNULL(transaction_kind,N'RENEWAL')=N'RENEWAL'
       AND term_from<=CAST(GETDATE() AS date) AND term_to>=CAST(GETDATE() AS date)
     ORDER BY term_to DESC`,
    { client: clientId, dep: dependentId },
    t,
  );
}