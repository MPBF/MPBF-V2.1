"use strict";

const upstream = require("minimatch");

function legacyPart(part) {
  // glob 7 uses both part._glob and String.match(part) during traversal.
  // Keep upstream's nonrecursive Matcher (and its safe test implementation),
  // rather than compiling legacy regular expressions or replacing .set types.
  if (part && typeof part === "object" && !(part instanceof RegExp)
    && typeof part.test === "function" && !Object.hasOwn(part, "_glob")) {
    Object.defineProperties(part, {
      _glob: { value: part.pattern },
      [Symbol.match]: {
        value(value) { return this.test(value) ? [value] : null; },
      },
    });
  }
  return part;
}

// minimatch 3 and 5 exported a callable function, while modern versions export
// an object. Keep old consumers callable without retaining vulnerable parsing.
function callable(api) {
  // Upstream defaults() returns a callable matcher, not its module object.
  const run = typeof api === "function" ? api : api.minimatch;
  const match = (path, pattern, options) => run(path, pattern, options);
  Object.assign(match, api);
  match.minimatch = match;
  match.Minimatch = class LegacyMinimatch extends api.Minimatch {
    parse(pattern) {
      return legacyPart(super.parse(pattern));
    }
    static defaults(options) {
      return callable(api.defaults(options)).Minimatch;
    }
  };
  match.defaults = options => callable(api.defaults(options));
  return match;
}

module.exports = callable(upstream);
