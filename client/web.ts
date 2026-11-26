import { useLayoutEffect, useRef } from "react";
import type { View } from "react-native";

export type BindPillView = (node: View) => (() => void) | undefined;

// RN Web forwards the ref value but can discard a callback ref's cleanup. Pair each mounted
// instance with its own effect, including the off-screen measuring instance Paseo unmounts.
export function usePillRef(bind?: BindPillView) {
  const ref = useRef<View>(null);
  useLayoutEffect(() => {
    if (ref.current) return bind?.(ref.current);
  }, [bind]);
  return bind ? ref : undefined;
}

// Structural types for React Native Web refs. The shared TS config also runs on native.
interface WebElement {
  parentElement: WebElement | null;
  previousElementSibling: WebElement | null;
  closest(selector: string): WebElement | null;
  querySelector(selector: string): WebElement | null;
  getBoundingClientRect(): { left: number; right: number; top: number; bottom: number; width: number; height: number };
  addEventListener(name: string, listener: (event: { currentTarget: WebElement }) => void): void;
  removeEventListener(name: string, listener: (event: { currentTarget: WebElement }) => void): void;
  style: { display: string; visibility: string };
  inert: boolean;
}

interface Layer {
  frame: WebElement;
  portal: WebElement;
  savedDisplay?: string;
}

function restore(layer: Layer) {
  if (layer.savedDisplay === undefined) return;
  layer.portal.style.display = layer.savedDisplay;
  delete layer.savedDisplay;
}

// In Paseo 0.17.4 every mounted copy of one button opens its own menu portal. Both the
// card and its full-screen backdrop belong to the portal. Retain the one beside the opener.
export function createPillRefs(): { anchor: BindPillView; content: BindPillView } {
  const buttons = new Set<WebElement>();
  const layers = new Set<Layer>();
  let opener: WebElement | null = null;
  const remember = (event: { currentTarget: WebElement }) => { opener = event.currentTarget; };

  function reconcile() {
    for (const layer of layers) restore(layer);
    if (layers.size < 2) return;

    const visible = [...buttons].filter(button => {
      const { width, height } = button.getBoundingClientRect();
      return width > 0 && height > 0;
    });
    const button = opener && visible.includes(opener) ? opener : visible.length === 1 ? visible[0] : null;
    if (!button) return;
    const anchor = button.getBoundingClientRect();
    let nearest: Layer | undefined;
    let shortest = Infinity;
    for (const layer of layers) {
      const rect = layer.frame.getBoundingClientRect();
      // The host remounts the measured card on placement. Wait for that ref before comparing.
      if (!rect.width || !rect.height || rect.right <= 0 || rect.bottom <= 0) return;
      const gap = Math.min(Math.abs(rect.bottom - anchor.top), Math.abs(rect.top - anchor.bottom));
      const distance = Math.abs(rect.left - anchor.left) + gap;
      if (distance < shortest) {
        nearest = layer;
        shortest = distance;
      }
    }
    for (const layer of layers) {
      if (layer === nearest) continue;
      layer.savedDisplay = layer.portal.style.display;
      layer.portal.style.display = "none";
    }
  }

  function updateListeners() {
    for (const button of buttons) {
      if (buttons.size > 1) {
        button.addEventListener("pointerdown", remember);
        button.addEventListener("focus", remember);
      } else {
        button.removeEventListener("pointerdown", remember);
        button.removeEventListener("focus", remember);
      }
    }
  }
  return {
    anchor(node) {
      const button = (node as unknown as WebElement).closest("button,[role=button]");
      if (!button) return;
      buttons.add(button);
      updateListeners();
      return () => {
        button.removeEventListener("pointerdown", remember);
        button.removeEventListener("focus", remember);
        buttons.delete(button);
        if (opener === button) opener = null;
        updateListeners();
      };
    },
    content(node) {
      const frame = (node as unknown as WebElement).closest('[data-menu-surface="true"]');
      const portal = frame?.closest("#overlay-root > *");
      if (!frame || !portal) return;
      const layer = { frame, portal };
      layers.add(layer);
      if (layers.size > 1) queueMicrotask(reconcile);
      return () => {
        restore(layer);
        layers.delete(layer);
        if (layers.size) queueMicrotask(reconcile);
      };
    },
  };
}


// On compact Web, Paseo 0.17.4 renders one pair of siblings per sheet in a shared
// host: the backdrop wrapper followed by the sheet containing the slider.
function findSheet(node: WebElement) {
  const shell = node.closest('[data-testid="compact-shell"]');
  if (!shell) return;
  let panel = node.closest('[role="slider"]')?.parentElement;
  while (panel && panel !== shell) {
    const backdrop = panel.previousElementSibling;
    if (backdrop?.querySelector(':scope > [role="button"][aria-label]')) return { panel, backdrop };
    panel = panel.parentElement;
  }
}

function maskSheet(element: WebElement) {
  const { visibility } = element.style;
  const { inert } = element;
  element.style.visibility = "hidden";
  element.inert = true;
  return () => {
    element.style.visibility = visibility;
    element.inert = inert;
  };
}

export function createSheetRef(): BindPillView {
  const sheets = new Map<WebElement, { backdrop: WebElement; restore?: () => void }>();

  return node => {
    const sheet = findSheet(node as unknown as WebElement);
    if (!sheet || sheets.has(sheet.panel)) return;
    // The host dismisses the top sheet first. Leave that sheet interactive, and keep
    // the older sheets measured and masked until the host unmounts them.
    for (const [panel, previous] of sheets) {
      if (previous.restore) continue;
      const restorePanel = maskSheet(panel);
      const restoreBackdrop = maskSheet(previous.backdrop);
      previous.restore = () => { restorePanel(); restoreBackdrop(); };
    }
    const current: { backdrop: WebElement; restore?: () => void } = { backdrop: sheet.backdrop };
    sheets.set(sheet.panel, current);
    return () => {
      current.restore?.();
      sheets.delete(sheet.panel);
    };
  };
}
