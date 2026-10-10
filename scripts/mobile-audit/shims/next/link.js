const React = require("react");
function Link({ href, children, prefetch, scroll, replace, ...rest }) {
  return React.createElement("a", { href: typeof href === "string" ? href : href && href.pathname, ...rest }, children);
}
module.exports = Link; module.exports.default = Link; module.exports.__esModule = true;
