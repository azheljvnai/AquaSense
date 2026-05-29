/**
 * Global Vitest setup — minimal browser globals for modules that dispatch DOM events.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.CustomEvent = dom.window.CustomEvent;
global.Event = dom.window.Event;
