module.exports = { after: (fn) => fn, NextResponse: { json: (b) => b, redirect: (u) => u } };
