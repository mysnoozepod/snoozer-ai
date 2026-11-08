(() => {
  const VALUES = ['Soft', 'Medium Soft', 'Medium Firm', 'Firm'];

  function selectedSize(root) {
    const productInfo = root.closest('product-info');
    if (!productInfo) return '';
    const sizeControl = [...productInfo.querySelectorAll('select, input[type="radio"]')]
      .find((control) => /(^|\[)size(\]|$)/i.test(control.name || '') && (control.tagName === 'SELECT' || control.checked));
    return sizeControl?.value || '';
  }

  function normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  function resolveMapping(mappings, { size, left, right }) {
    if (!size || !left || !right) return null;
    return mappings.find((entry) => entry.available !== false && normalize(entry.size) === normalize(size)
      && entry.left === left && entry.right === right) || null;
  }

  globalThis.SnoozePodDualComfortContract = { VALUES: [...VALUES], resolveMapping };

  function init(root) {
    if (!root || root.dataset.dualComfortReady === 'true') return;
    root.dataset.dualComfortReady = 'true';

    const productInfo = root.closest('product-info');
    const formId = root.dataset.productForm;
    const form = document.getElementById(formId);
    const status = root.querySelector('[data-dual-comfort-status]');
    const summary = root.querySelector('[data-dual-comfort-summary]');
    const leftInput = root.querySelector('[data-dual-comfort-property="left"]');
    const rightInput = root.querySelector('[data-dual-comfort-property="right"]');
    const mappingElement = root.querySelector('[data-dual-comfort-mappings]');
    const mappings = JSON.parse(mappingElement?.textContent || '[]');
    const submit = form?.querySelector('[name="add"]');
    const variantInput = form?.querySelector('[name="id"]');
    const originalSubmitLabel = submit?.querySelector('span')?.textContent?.trim() || 'Add to cart';

    const announce = (message) => {
      if (status) status.textContent = message;
    };

    const update = ({ announceChange = false } = {}) => {
      const left = root.querySelector('input[name$="-left"]:checked')?.value || '';
      const right = root.querySelector('input[name$="-right"]:checked')?.value || '';
      const size = selectedSize(root);

      leftInput.value = left;
      rightInput.value = right;
      summary.textContent = left && right
        ? `Selected configuration: Left ${left} / Right ${right}`
        : 'Select a comfort level for each side.';

      const match = resolveMapping(mappings, { size, left, right });

      if (match && variantInput && submit) {
        variantInput.value = String(match.variantId);
        variantInput.dispatchEvent(new Event('change', { bubbles: true }));
        submit.disabled = false;
        submit.setAttribute('aria-disabled', 'false');
        const label = submit.querySelector('span');
        if (label) label.textContent = originalSubmitLabel;
        announce(`Left ${left} and right ${right} comfort are available for ${size}. Add to cart is enabled.`);
        root.dataset.orderable = 'true';
        return;
      }

      if (submit) {
        submit.disabled = true;
        submit.setAttribute('aria-disabled', 'true');
        const label = submit.querySelector('span');
        if (label) label.textContent = 'Configuration unavailable';
      }
      root.dataset.orderable = 'false';

      if (announceChange) {
        if (!left || !right) announce('Select a comfort level for both sides.');
        else if (!size) announce('Select a mattress size.');
        else announce(`Left ${left} and right ${right} comfort for ${size} is not yet verified for online ordering. Book a Snooze Session for help.`);
      }
    };

    root.addEventListener('change', () => update({ announceChange: true }));
    productInfo?.addEventListener('change', (event) => {
      if (!root.contains(event.target)) update({ announceChange: true });
    });
    form?.addEventListener('submit', (event) => {
      update({ announceChange: true });
      if (root.dataset.orderable !== 'true') {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    for (const input of root.querySelectorAll('input[type="radio"]')) {
      if (!VALUES.includes(input.value)) input.disabled = true;
    }
    update();
  }

  function initAll(container = document) {
    container.querySelectorAll('[data-dual-comfort]').forEach(init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initAll());
  } else {
    initAll();
  }
  document.addEventListener('shopify:section:load', (event) => initAll(event.target));
})();
