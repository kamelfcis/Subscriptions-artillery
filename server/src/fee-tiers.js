/** Parse legacy PriceList money columns (RDar = تجديد الدار). Values stay as in the DB. */
export function parseLegacyMoney(raw) {
  const s = String(raw ?? '').replace(/ج\.م/g, '').replace(/,/g, '.').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** Legacy tier text: preserved exactly (trim whitespace only). */
export function legacyTierText(value) {
  if (value == null) return null;
  const t = String(value).trim();
  return t === '' ? null : t;
}

export function mapPriceListServiceCode(idPrice) {
  const p = String(idPrice ?? '').trim();
  if (['01', '02', '03', '04'].includes(p)) return p;
  if (['1', '2', '3', '4'].includes(p)) return '0' + p;
  // Legacy PriceList.IdPrice is often an old fee id/amount, not AppServices code — import defaults those rows to 01.
  return '01';
}

/** True when a PriceList row applies to the chosen AppServices code (01–04). */
export function priceListRowMatchesService(idPrice, serviceCode) {
  const code = String(serviceCode ?? '').trim();
  const p = String(idPrice ?? '').trim();
  if (['01', '02', '03', '04'].includes(p)) return p === code;
  if (['1', '2', '3', '4'].includes(p)) return ('0' + p) === code;
  // Non-service IdPrice values are legacy tier rows shared across renewal services.
  return true;
}

export const PRICE_KIND = {
  RENEWAL: 'RENEWAL',
};

const KIND_LABEL = {
  RENEWAL: 'تجديد الدار',
};

const OFFICER_PRICE_CAT = 'ضباط خدمة او متقاعد';
/** Longest-first so «ملازم أول» wins over «ملازم». */
export const OFFICER_PRICE_RANKS = ['ملازم أول', 'ملازم', 'نقيب', 'رائد', 'مقدم', 'عقيد', 'عميد', 'لواء', 'فريق'];

export function officialFeeLabel(priceKind) {
  return KIND_LABEL[priceKind] || KIND_LABEL.RENEWAL;
}

/**
 * Client.jop often appends أركان حرب as «-اح» (e.g. عقيد-اح / عقيد -اح).
 * PriceList.Jop stores the base rank only (عقيد). Expand aliases for lookup.
 */
export function priceListJopAliases(tierJop) {
  const raw = tierJop == null ? '' : String(tierJop).trim();
  if (!raw) return [''];
  const aliases = new Set([raw]);
  const stripped = raw.replace(/\s*-?\s*اح\s*$/i, '').trim();
  if (stripped) aliases.add(stripped);
  for (const rank of OFFICER_PRICE_RANKS) {
    if (stripped === rank || stripped.startsWith(rank)) {
      aliases.add(rank);
      break;
    }
  }
  return [...aliases].filter((x) => x !== '');
}

/** Expand one PriceList row into official AppFeeSchedule rows (تجديد الدار / RDar only). */
export function priceListImportRows(row) {
  const tier_cat = legacyTierText(row.Cat);
  const tier_jop = legacyTierText(row.Jop);
  const service_code = mapPriceListServiceCode(row.IdPrice);
  const amount = parseLegacyMoney(row.RDar);
  if (amount === null) return [];
  const out = [];
  for (const target_type of ['MAIN', 'DEPENDENT']) {
    out.push({
      service_code,
      target_type,
      tier_cat,
      tier_jop,
      price_kind: PRICE_KIND.RENEWAL,
      label: officialFeeLabel(PRICE_KIND.RENEWAL),
      amount,
    });
  }
  return out;
}

/**
 * Client.Cat vocabulary differs from pricing-module PriceList.Cat labels.
 * عسكرى/مدنى members with military ranks resolve against ضباط خدمة او متقاعد + Jop.
 */
export function priceListCatAliases(tierCat) {
  const tc = tierCat == null ? '' : String(tierCat).trim();
  if (!tc) return [''];
  const map = {
    عسكرى: ['عسكرى', OFFICER_PRICE_CAT],
    عسكري: ['عسكري', OFFICER_PRICE_CAT],
    أبناء: ['أبناء', 'ابناء'],
    ابناء: ['ابناء', 'أبناء'],
    مدنى: ['مدنى', 'مدني', OFFICER_PRICE_CAT],
    مدني: ['مدني', 'مدنى', OFFICER_PRICE_CAT],
  };
  return map[tc] || [tc];
}

/**
 * Best real PriceList row for renewal (RDar / تجديد الدار) by member Cat + Jop.
 * Does not use Cat-only staging bridges: when the member has a jop, PriceList.Jop must match.
 */
export function pickPriceListRenewalRow(rows, serviceCode, tierCat, tierJop) {
  const tc = tierCat == null ? '' : String(tierCat).trim();
  const tj = tierJop == null ? '' : String(tierJop).trim();
  const cats = new Set(priceListCatAliases(tc));
  const jops = tj ? new Set(priceListJopAliases(tj)) : null;
  const candidates = rows.filter((p) => priceListRowMatchesService(p.IdPrice, serviceCode));
  const fits = candidates.filter((p) => {
    const c = legacyTierText(p.Cat) ?? '';
    const j = legacyTierText(p.Jop) ?? '';
    if (!cats.has(c) && !(c === '' && j === '')) return false;
    if (tj) return jops.has(j);
    return !j;
  });
  if (!fits.length) return null;
  fits.sort((a, b) => {
    const ca = legacyTierText(a.Cat) ?? '';
    const ja = legacyTierText(a.Jop) ?? '';
    const cb = legacyTierText(b.Cat) ?? '';
    const jb = legacyTierText(b.Jop) ?? '';
    const score = (c, j) => {
      if (c === tc && j === tj) return 6;
      if (cats.has(c) && j === tj) return 5;
      if (c === tc && jops?.has(j)) return 4;
      if (cats.has(c) && jops?.has(j)) return 3;
      if (c === tc && !j && !tj) return 2;
      if (cats.has(c) && !j && !tj) return 1;
      if (!c && !j && !tj) return 1;
      return 0;
    };
    return score(cb, jb) - score(ca, ja) || b.id - a.id;
  });
  return fits[0];
}

/**
 * SQL to load real PriceList candidates (Cat/Jop/IdPrice/RDar) for a renewal quote.
 * Joins member Cat aliases to PriceList.Cat and member jop to PriceList.Jop (تجديد الدار = RDar).
 */
export function renewalPriceListCandidateQuery(tierCat, tierJop) {
  const aliases = priceListCatAliases(tierCat);
  const rawJop = tierJop == null || String(tierJop).trim() === '' ? null : String(tierJop).trim();
  const jopAliases = rawJop ? priceListJopAliases(rawJop) : [];
  const params = {};
  const catPreds = aliases.map((alias, i) => {
    const key = 'cat' + i;
    params[key] = alias;
    return `LTRIM(RTRIM(ISNULL(p.Cat, N''))) = @${key}`;
  });
  const catSql = catPreds.length ? `(${catPreds.join(' OR ')})` : `LTRIM(RTRIM(ISNULL(p.Cat, N''))) = N''`;
  let jopSql;
  if (!rawJop) {
    jopSql = `(p.Jop IS NULL OR LTRIM(RTRIM(p.Jop)) = N'')`;
  } else {
    const jopPreds = jopAliases.map((alias, i) => {
      const key = 'jop' + i;
      params[key] = alias;
      return `LTRIM(RTRIM(ISNULL(p.Jop, N''))) = @${key}`;
    });
    jopSql = jopPreds.length ? `(${jopPreds.join(' OR ')})` : `LTRIM(RTRIM(ISNULL(p.Jop, N''))) = @jop0`;
    if (!jopPreds.length) params.jop0 = rawJop;
  }
  const statement = `SELECT p.id, p.Cat, p.Jop, p.IdPrice, p.RDar
FROM dbo.PriceList p
WHERE ${catSql}
  AND ${jopSql}`;
  return { statement, params };
}

/** Same Cat/Jop matching as renewal quotes, but uses RElnada (بدل فاقد). */
export function pickPriceListLostCardRow(rows, tierCat, tierJop) {
  const tc = tierCat == null ? '' : String(tierCat).trim();
  const tj = tierJop == null ? '' : String(tierJop).trim();
  const cats = new Set(priceListCatAliases(tc));
  const jops = tj ? new Set(priceListJopAliases(tj)) : null;
  const fits = rows.filter((p) => {
    const c = legacyTierText(p.Cat) ?? '';
    const j = legacyTierText(p.Jop) ?? '';
    if (!cats.has(c) && !(c === '' && j === '')) return false;
    if (tj) return jops.has(j);
    return !j;
  });
  if (!fits.length) return null;
  fits.sort((a, b) => {
    const ca = legacyTierText(a.Cat) ?? '';
    const ja = legacyTierText(a.Jop) ?? '';
    const cb = legacyTierText(b.Cat) ?? '';
    const jb = legacyTierText(b.Jop) ?? '';
    const score = (c, j) => {
      if (c === tc && j === tj) return 6;
      if (cats.has(c) && j === tj) return 5;
      if (c === tc && jops?.has(j)) return 4;
      if (cats.has(c) && jops?.has(j)) return 3;
      if (c === tc && !j && !tj) return 2;
      if (cats.has(c) && !j && !tj) return 1;
      if (!c && !j && !tj) return 1;
      return 0;
    };
    return score(cb, jb) - score(ca, ja) || b.id - a.id;
  });
  return fits[0];
}

export function lostCardPriceListCandidateQuery(tierCat, tierJop) {
  const { statement: catJopSql, params } = renewalPriceListCandidateQuery(tierCat, tierJop);
  const statement = catJopSql.replace(/p\.RDar\b/g, 'p.RDar, p.RElnada');
  return { statement, params };
}

/** Lost-card amount from a PriceList row (RElnada only). RElnada numeric-equal to RDar is treated as unset. */
export function parsePriceListLostCardAmount(row) {
  if (!row) return null;
  const lost = parseLegacyMoney(row.RElnada);
  if (lost === null) return null;
  const renewal = parseLegacyMoney(row.RDar);
  if (renewal !== null && lost === renewal) return null;
  return lost;
}
