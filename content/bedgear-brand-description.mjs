export const bedgearDescriptionSource = Object.freeze({
  label: 'BEDGEAR Boilerplate - Updated January 2026',
  sharedUrl: 'https://bedgear.pxm.pattern.com/share/RWlH0Qhcsk',
  sourceDate: '2026-01-22',
  version: '2026-01',
});

export const bedgearProductHandles = Object.freeze([
  'flex-l-adjustable-base',
  'flex-lsx-adjustable-base',
  'flex-sh-adjustable-base',
  'cotton-sheet-set',
  'dri-tec-sheet-set',
  'ver-tex-sheet-set',
  'dri-tec-mattress-protector',
  'ver-tex-mattress-protector',
  'stretchwick-mattress-encasement',
  'light-weight-comforter',
  'medium-weight-comforter',
  'ultra-weight-comforter',
  'cooling-performance-throw',
  'solid-white-duvet-sham-set',
  'light-grey-racetrack-duvet-sham-set',
  'react-pro-performance-topper',
  '12-inch-memory-foam-mattress',
  '12-inch-hybrid-mattress',
  '12-inch-dual-comfort-mattress',
  '14-inch-dual-comfort-mattress',
]);

export const mattressCustomerFacingHandles = Object.freeze([
  '12-inch-memory-foam-mattress',
  '12-inch-hybrid-mattress',
  '12-inch-dual-comfort-mattress',
  '14-inch-dual-comfort-mattress',
]);

export const bedgearBrandParagraphs = Object.freeze([
  'Since 2009, BEDGEAR has been redefining the way the world sleeps through innovation, personalization, and sustainability. As the Performance® sleep brand, BEDGEAR creates groundbreaking sleep solutions for those who aim to Wake Ready®. Designed for active lifestyles, BEDGEAR products feature moisture-wicking, instant-cooling, and airflow-maximizing materials that help your body naturally regulate temperature for optimal rest and recovery.',
  'Trusted at the highest level of competition, BEDGEAR is the Official Sleep Partner of the Dallas Mavericks and a preferred choice among professional athletes who rely on personalized sleep to enhance training and game-day readiness.',
  'Driven by the belief that One Size Does Not Fit All®, BEDGEAR designs Performance® Sleep Systems that are personally fit to each sleeper\'s body type, sleep position, and temperature preference—ensuring comfort without compromise, especially critical for individual support for those who sleep with partners. Engineered and manufactured in the USA and overseas, BEDGEAR\'s lineup includes modular mattresses, pillows, sheets, protectors, blankets, and the BEDGEAR Beauty Collection, along with bedding for kids, babies, pets, travel, and more.',
  'BEDGEAR is also committed to reducing waste through smarter design—planting a tree for every online order, incorporating recycled materials into Performance® Pillows, and engineering modular, personally fit products that get it right the first time.',
  'With more than 280 worldwide patents and trademarks and retail presence in over 6,500 stores across the globe, BEDGEAR continues to lead the evolution of personalized sleep.',
]);

export const bedgearBrandDescriptionHtml = [
  `<div data-mysnoozepod-bedgear-boilerplate="${bedgearDescriptionSource.version}">`,
  '<h3>About BEDGEAR</h3>',
  ...bedgearBrandParagraphs.map((paragraph) => `<p>${paragraph}</p>`),
  '</div>',
].join('');

const officialCopy = (sourceUrl, summary, features) => Object.freeze({ sourceUrl, summary, features: Object.freeze(features) });

export const bedgearOfficialProductCopy = Object.freeze({
  '12-inch-memory-foam-mattress': officialCopy(
    'https://bedgear.com/products/s-performance-mattresses',
    'This 12" all-foam mattress pairs conforming pressure relief with cooling and airflow-focused materials designed to limit heat buildup.',
    ['Plush comfort direction', 'Cooling cover', 'Ventilated comfort foam', 'Breathable side panels'],
  ),
  '12-inch-hybrid-mattress': officialCopy(
    'https://bedgear.com/products/h-hybrid-performance-pillowtop-mattress',
    'This 12" pillowtop mattress combines conforming comfort with responsive hybrid support and cooling, breathable materials.',
    ['Plush comfort direction', 'Integrated pillowtop', 'Hybrid suspension support', 'Cooling, breathable construction'],
  ),
  '12-inch-dual-comfort-mattress': officialCopy(
    'https://bedgear.com/products/m3-performance-mattress',
    'This 12" modular mattress uses interchangeable support components so each sleeper can choose an independent comfort direction. Its removable cooling cover and airflow-focused construction support easier care and breathable comfort.',
    ['Independent left and right comfort', 'Interchangeable support components', 'Removable, washable cooling cover', 'Airflow-focused chassis and vents'],
  ),
  '14-inch-dual-comfort-mattress': officialCopy(
    'https://bedgear.com/products/m5-performance-mattress',
    'This 14" modular mattress adds a taller comfort profile for deeper conforming pressure relief while allowing each side to be configured independently.',
    ['Independent left and right comfort', 'Enhanced comfort layer', 'Interchangeable support components', 'Removable cooling cover and airflow features'],
  ),
  'flex-l-adjustable-base': officialCopy(
    'https://bedgear.com/products/flex-l-adjustable-base',
    'The Flex L provides independent head and foot adjustment in a foldable, quick-assembly frame. Preset positions, a wireless remote, child lock, and emergency lowering cover the core adjustable-base functions.',
    ['Independent head and foot adjustment', 'Anti-Snore and Zero Gravity presets', 'Programmable wireless remote', 'Child lock and emergency lowering'],
  ),
  'flex-lsx-adjustable-base': officialCopy(
    'https://bedgear.com/products/flex-lsx-adjustable-base',
    'The Flex LSX is BEDGEAR\'s feature-rich adjustable base, with independent head, neck, lumbar, and foot adjustment plus dual massage, lighting, charging, and Bluetooth audio.',
    ['Four-zone powered adjustment', 'Dual-sided massage', 'Motion-activated underbed lighting', 'USB charging and Bluetooth audio'],
  ),
  'flex-sh-adjustable-base': officialCopy(
    'https://bedgear.com/products/flex-sh-split-head-adjustable-base',
    'The Flex SH is built for split-head sleep systems, giving each sleeper independent head and lumbar control while keeping the lower mattress surface shared.',
    ['Independent split-head adjustment', 'Two remotes with preset and programmable positions', 'Hidden retainer system for a split-head mattress', 'Underbed lighting, USB charging, and Bluetooth audio'],
  ),
  'cotton-sheet-set': officialCopy(
    'https://bedgear.com/products/cotton-sheet-set',
    'BEDGEAR\'s cotton performance sheets pair familiar softness with stretch and breathability for a modern take on classic cotton bedding.',
    ['Soft cotton-blend feel', 'All-way stretch', 'Breathable construction', 'Secure fitted-sheet grip'],
  ),
  'dri-tec-sheet-set': officialCopy(
    'https://bedgear.com/products/dri-tec-sheet-set',
    'Dri-Tec Performance sheets use a smooth, flexible knit engineered to move heat and moisture away from the sleeper while maintaining airflow.',
    ['Moisture-wicking Dri-Tec fabric', 'Smooth activewear-inspired feel', 'Breathable knit', 'Powerband secure fit'],
  ),
  'ver-tex-sheet-set': officialCopy(
    'https://bedgear.com/products/ver-tex-sheet-set-classic-colors',
    'Ver-Tex Performance sheets are designed for hot sleepers with a smooth, cool-to-the-touch surface and a secure fitted-sheet design.',
    ['Instant-cooling Ver-Tex fabric', 'Smooth feel', 'Powerband secure fit', 'Machine washable'],
  ),
  'dri-tec-mattress-protector': officialCopy(
    'https://bedgear.com/products/dri-tec-mattress-protector',
    'The Dri-Tec mattress protector combines a waterproof barrier with a moisture-wicking top surface and deep-pocket sidewalls that help it remain secure.',
    ['Waterproof protection', 'Moisture-wicking top layer', 'Breathable construction', 'Deep-pocket secure fit'],
  ),
  'ver-tex-mattress-protector': officialCopy(
    'https://bedgear.com/products/ver-tex-mattress-protector',
    'The Ver-Tex mattress protector pairs waterproof protection with a cool-to-the-touch surface. Its Powerband helps keep it smooth and secure, including on an adjustable base.',
    ['Waterproof protection', 'Instant-cooling Ver-Tex surface', 'Powerband secure fit', 'Machine washable'],
  ),
  'stretchwick-mattress-encasement': officialCopy(
    'https://bedgear.com/products/stretchwick-mattress-encasement-1',
    'The Stretchwick encasement surrounds the mattress on all six sides with a waterproof, stretchable layer designed to help guard against spills, allergens, dust mites, and bed bugs.',
    ['Six-sided coverage', 'Waterproof barrier', 'Stretch fit with zippered access', 'Machine washable'],
  ),
  'light-weight-comforter': officialCopy(
    'https://bedgear.com/products/performance-comforter',
    'The light-weight Performance comforter is the least insulated of BEDGEAR\'s three all-season comforter weights, using breathable channels and Climacore insulation to manage warmth without unnecessary bulk.',
    ['Lightest of three weight options', 'Climacore intelligent insulation', 'Airflow-focused channel construction', 'Machine washable'],
  ),
  'medium-weight-comforter': officialCopy(
    'https://bedgear.com/products/performance-comforter',
    'The medium-weight Performance comforter balances warmth and breathability with airflow channels and Climacore insulation designed to reduce overheating.',
    ['Middle of three weight options', 'Climacore intelligent insulation', 'Airflow-focused channel construction', 'Machine washable'],
  ),
  'ultra-weight-comforter': officialCopy(
    'https://bedgear.com/products/performance-comforter',
    'The ultra-weight Performance comforter is the warmest of BEDGEAR\'s three weight choices while retaining the line\'s breathable channels and Climacore insulation.',
    ['Warmest of three weight options', 'Climacore intelligent insulation', 'Airflow-focused channel construction', 'Machine washable'],
  ),
  'cooling-performance-throw': officialCopy(
    'https://bedgear.com/products/cooling-performance-throw',
    'The Cooling Performance throw uses smooth cooling fibers and breathable quilting to dissipate heat and provide lightweight, all-season comfort.',
    ['Cool-to-the-touch fibers', 'Breathable quilted construction', 'Lightweight all-season design', 'Machine washable'],
  ),
  'react-pro-performance-topper': officialCopy(
    'https://bedgear.com/products/react-pro-performance-mattress-topper',
    'The React Pro topper adds a plush, pressure-relieving comfort layer with cooling fabric, airflow features, and a Powerband that helps prevent shifting or bunching.',
    ['Ver-Tex instant-cooling fabric', 'Adaptive React Blend fill', 'Airflow-focused construction', 'Powerband secure fit'],
  ),
});

export function bedgearOfficialProductDescriptionHtml(handle) {
  const copy = bedgearOfficialProductCopy[handle];
  if (!copy) return '';
  const marker = mattressCustomerFacingHandles.includes(handle)
    ? 'data-mysnoozepod-mattress-product-copy="2026-11-08"'
    : 'data-mysnoozepod-bedgear-product-copy="2026-11-02"';
  return [
    `<div ${marker}>`,
    '<h3>Product Overview</h3>',
    `<p>${copy.summary}</p>`,
    '<h4>Key Features</h4>',
    `<ul>${copy.features.map((feature) => `<li>${feature}</li>`).join('')}</ul>`,
    '</div>',
  ].join('');
}

