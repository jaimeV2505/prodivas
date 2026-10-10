module.exports = new Proxy({ __esModule: true }, { get: (t, k) => (k in t ? t[k] : async () => {}) });
