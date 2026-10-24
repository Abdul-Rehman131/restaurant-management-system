/**
 * While a Radix overlay is open, Radix hides the rest of the page from assistive tech with
 * aria-hidden (marked data-aria-hidden), but that content stays focusable (axe
 * aria-hidden-focus). This makes the same elements `inert` for exactly as long, so hidden
 * content can never take focus. The observer runs as a microtask, before Radix returns focus
 * to the trigger on close.
 */
export function syncInertWithAriaHidden(root: HTMLElement = document.body): () => void {
  const sync = (element: Element) => {
    if (!(element instanceof HTMLElement)) return;
    const hidden = element.hasAttribute('data-aria-hidden') && element.ariaHidden === 'true';
    if (hidden && !element.inert) {
      element.inert = true;
      element.dataset['rmsInert'] = '';
    } else if (!hidden && 'rmsInert' in element.dataset) {
      element.inert = false;
      delete element.dataset['rmsInert'];
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) sync(mutation.target as Element);
  });
  observer.observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-hidden', 'data-aria-hidden'],
  });
  return () => {
    observer.disconnect();
  };
}
