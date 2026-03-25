import { Window } from "happy-dom";

const window = new Window();

Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  navigator: window.navigator,
});
