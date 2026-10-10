module.exports = {
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect: (u) => { throw new Error("redirect " + u); },
  notFound: () => { throw new Error("notFound"); },
};
