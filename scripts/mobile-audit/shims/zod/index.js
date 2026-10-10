const chain = () => new Proxy(function () {}, {
  get: (_, k) => (k === "safeParse" ? (v) => ({ success: true, data: v }) : k === "parse" ? (v) => v : () => chain()),
  apply: () => chain(),
});
module.exports = { z: new Proxy({}, { get: () => () => chain() }) };
