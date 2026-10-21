/**
 * The marker under the chosen button of a group slides to the button that was
 * just picked, instead of vanishing from one and appearing on the other.
 *
 * Every group in the app is a `.segmented` control or the `.nav` bar, and each
 * marks its chosen button with the `on` class. Rather than wrap every one of
 * them in a component, this watches the page for those groups and draws the
 * marker itself: it measures the chosen button and hands its box to the group
 * as CSS variables, and the stylesheet draws the marker from them (see
 * `[data-slide]` in styles.css). A group the script has not reached yet keeps
 * the plain style, with the marker painted on the button.
 */

const GROUPS = '.segmented, .nav';

let queued = false;
const sized = new WeakSet<Element>();
const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());

function schedule(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    document.querySelectorAll<HTMLElement>(GROUPS).forEach(place);
  });
}

function place(group: HTMLElement): void {
  if (resizes && !sized.has(group)) {
    sized.add(group);
    resizes.observe(group);
  }
  const on = group.querySelector<HTMLElement>('button.on');
  if (!on || on.offsetWidth === 0) {
    delete group.dataset.slide;
    return;
  }
  // Offsets rather than screen boxes: a button shrinking under a finger, or a
  // modal still scaling in, would otherwise move the marker with it. The nav
  // wraps its buttons in an anchor for the guide, so walk up to the group.
  let x = 0;
  let y = 0;
  let el: HTMLElement | null = on;
  while (el && el !== group) {
    x += el.offsetLeft;
    y += el.offsetTop;
    el = el.offsetParent as HTMLElement | null;
  }
  if (el !== group) return;
  group.style.setProperty('--slide-x', `${x}px`);
  group.style.setProperty('--slide-y', `${y}px`);
  group.style.setProperty('--slide-w', `${on.offsetWidth}px`);
  group.style.setProperty('--slide-h', `${on.offsetHeight}px`);
  // The first placement is a jump: a group that just appeared should show its
  // choice where it is, not fly in from the corner.
  if (!group.dataset.slide) {
    group.dataset.slide = 'set';
    requestAnimationFrame(() => {
      if (group.dataset.slide === 'set') group.dataset.slide = 'move';
    });
  }
}

export function startSlidingTabs(): void {
  // A new button or group, or a choice that moved. Text changing inside the
  // page, which a live training screen does many times a second, is not one.
  new MutationObserver((records) => {
    for (const r of records) {
      const hit =
        r.type === 'attributes'
          ? (r.target as Element).closest(GROUPS) !== null
          : Array.from(r.addedNodes).some((n) => n.nodeType === Node.ELEMENT_NODE);
      if (hit) return schedule();
    }
  }).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  window.addEventListener('resize', schedule);
  // Labels get wider once the web font arrives.
  void document.fonts?.ready.then(schedule);
  schedule();
}
