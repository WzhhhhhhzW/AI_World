const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const sandbox = vm.createContext({fetch: () => new Promise(() => {}), console});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/ui-assets.js'), 'utf8'), sandbox);
const frame = (elapsed, fps=8, count=4) => sandbox.uiAnimationFrame(elapsed, fps, count);

test('new effects tolerate a frame timestamp just before their creation', () => {
  for (const elapsed of [-15, -0.5, -0.001, 0]) {
    assert.equal(frame(elapsed), 0);
  }
});

test('animation indices wrap and always select an existing frame', () => {
  assert.equal(frame(125), 1);
  assert.equal(frame(499), 3);
  assert.equal(frame(500), 0);
  assert.equal(frame(1000), 0);
  assert.equal(frame(NaN), 0);
  for (let elapsed=-100; elapsed<10000; elapsed+=7) {
    const index=frame(elapsed);
    assert.ok(Number.isInteger(index) && index>=0 && index<4);
  }
});
