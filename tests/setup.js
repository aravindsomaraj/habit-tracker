import '@testing-library/dom';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
});
