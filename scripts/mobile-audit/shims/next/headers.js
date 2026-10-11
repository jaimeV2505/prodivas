module.exports = {
  cookies: async () => ({ get: () => undefined, set() {}, delete() {} }),
  headers: async () => ({ get: () => null }),
};
