import { bedgearOfficialProductDescriptionHtml } from './bedgear-brand-description.mjs';

export const COMFORT_LABELS = Object.freeze(['Soft', 'Medium Soft', 'Medium Firm', 'Firm']);

export const MATTRESS_CUSTOMER_NAMING = Object.freeze([
  Object.freeze({
    oldHandle: 'bedgear-s7-12-memory-foam',
    handle: '12-inch-memory-foam-mattress',
    title: '12" Memory Foam Mattress',
    menuTitle: '12" Memory Foam',
    feelLabel: 'Plush',
    mediaAlts: Object.freeze([
      '12" memory foam mattress in a bedroom setting',
      '12" memory foam mattress shown at an angle',
      '12" memory foam mattress corner and cover detail',
    ]),
  }),
  Object.freeze({
    oldHandle: 'bedgear-h6-12-hybrid',
    handle: '12-inch-hybrid-mattress',
    title: '12" Hybrid Mattress',
    menuTitle: '12" Hybrid',
    feelLabel: 'Plush',
    mediaAlts: Object.freeze([
      '12" hybrid mattress product view',
      '12" hybrid mattress in a bedroom setting',
      '12" hybrid mattress angle view',
    ]),
  }),
  Object.freeze({
    oldHandle: 'bedgear-m3-12-dual-comfort',
    handle: '12-inch-dual-comfort-mattress',
    title: '12" Dual Comfort Mattress',
    menuTitle: '12" Dual Comfort',
    mediaAlts: Object.freeze([
      '12" dual comfort mattress angle view',
      '12" dual comfort mattress front view',
      '12" dual comfort mattress in a bedroom setting',
    ]),
    comfortOptions: COMFORT_LABELS,
  }),
  Object.freeze({
    oldHandle: 'bedgear-m5-14-dual-comfort',
    handle: '14-inch-dual-comfort-mattress',
    title: '14" Dual Comfort Mattress',
    menuTitle: '14" Dual Comfort',
    mediaAlts: Object.freeze([
      '14" dual comfort mattress product view',
      '14" dual comfort mattress angle view',
      '14" dual comfort mattress in a bedroom setting',
    ]),
    comfortOptions: COMFORT_LABELS,
  }),
].map((entry) => Object.freeze({
  ...entry,
  descriptionHtml: bedgearOfficialProductDescriptionHtml(entry.handle),
})));

export function replaceCustomerFacingMattressNames(value) {
  let output = String(value || '');
  for (const mattress of MATTRESS_CUSTOMER_NAMING) {
    output = output
      .replaceAll(`/products/${mattress.oldHandle}`, `/products/${mattress.handle}`)
      .replace(new RegExp(`\\bBEDGEAR\\s+${mattress.oldHandle.includes('s7') ? 'S7' : mattress.oldHandle.includes('h6') ? 'H6' : mattress.oldHandle.includes('m3') ? 'M3' : 'M5'}\\b`, 'g'), mattress.title)
      .replace(new RegExp(`\\b${mattress.oldHandle.includes('s7') ? 'S7' : mattress.oldHandle.includes('h6') ? 'H6' : mattress.oldHandle.includes('m3') ? 'M3' : 'M5'}\\b`, 'g'), mattress.title);
  }
  return output;
}
