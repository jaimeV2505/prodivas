const React = require("react");
const mv = (v = 0) => ({ get: () => v, set() {}, on: () => () => {}, getPrevious: () => v, isAnimating: () => false });
const MOTION_PROPS = new Set(["initial","animate","exit","transition","whileInView","whileTap","whileHover","whileFocus","viewport","layout","layoutId","variants","onAnimationComplete","onViewportEnter"]);
function strip(props) {
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (MOTION_PROPS.has(k)) continue;
    if (k === "style" && v) { const st = {}; for (const [a, b] of Object.entries(v)) { if (b && typeof b === "object" && "get" in b) continue; st[a] = b; } out.style = st; continue; }
    out[k] = v;
  }
  return out;
}
const motion = new Proxy({}, { get: (_, tag) => React.forwardRef((props, ref) => React.createElement(tag, { ...strip(props), ref })) });
module.exports = {
  motion,
  AnimatePresence: ({ children }) => children,
  useReducedMotion: () => false,
  useScroll: () => ({ scrollYProgress: mv(0), scrollY: mv(0) }),
  useTransform: () => mv(0),
  useMotionValue: (v) => mv(v),
  useSpring: () => mv(0),
  useInView: () => true,
  useMotionValueEvent: () => {},
};
