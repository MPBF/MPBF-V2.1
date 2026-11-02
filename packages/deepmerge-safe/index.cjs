'use strict';

// Derived from deepmerge 4.3.1 dist/cjs.js (MIT); see LICENSE and README.md.
function isMergeableObject(value) {
  return !!value && typeof value === 'object' && !isSpecial(value);
}

function isSpecial(value) {
  var tag = Object.prototype.toString.call(value);
  var reactType = typeof Symbol === 'function' && Symbol.for
    ? Symbol.for('react.element') : 0xeac7;
  return tag === '[object RegExp]' || tag === '[object Date]'
    || value.$$typeof === reactType;
}

function emptyTarget(value) {
  return Array.isArray(value) ? [] : {};
}

function cloneUnlessOtherwiseSpecified(value, options) {
  return options.clone !== false && options.isMergeableObject(value)
    ? deepmerge(emptyTarget(value), value, options) : value;
}

function defaultArrayMerge(target, source, options) {
  return target.concat(source).map(function (element) {
    return cloneUnlessOtherwiseSpecified(element, options);
  });
}

function getMergeFunction(key, options) {
  if (!options.customMerge) return deepmerge;
  var customMerge = options.customMerge(key);
  return typeof customMerge === 'function' ? customMerge : deepmerge;
}

function getKeys(target) {
  return Object.keys(target).concat(Object.getOwnPropertySymbols
    ? Object.getOwnPropertySymbols(target).filter(function (symbol) {
      return Object.prototype.propertyIsEnumerable.call(target, symbol);
    }) : []);
}

function propertyIsOnObject(object, property) {
  try {
    return property in object;
  } catch (_) {
    return false;
  }
}

function propertyIsUnsafe(target, key) {
  return propertyIsOnObject(target, key)
    && !(Object.prototype.hasOwnProperty.call(target, key)
      && Object.prototype.propertyIsEnumerable.call(target, key));
}

// Security fix: never invoke inherited setters, particularly __proto__.
function writeOwn(destination, key, value) {
  Object.defineProperty(destination, key, {
    value: value, enumerable: true, configurable: true, writable: true,
  });
}

function mergeObject(target, source, options) {
  var destination = {};
  if (options.isMergeableObject(target)) {
    getKeys(target).forEach(function (key) {
      writeOwn(destination, key, cloneUnlessOtherwiseSpecified(target[key], options));
    });
  }
  getKeys(source).forEach(function (key) {
    if (propertyIsUnsafe(target, key)) return;
    if (propertyIsOnObject(target, key) && options.isMergeableObject(source[key])) {
      writeOwn(destination, key, getMergeFunction(key, options)(target[key], source[key], options));
    } else {
      writeOwn(destination, key, cloneUnlessOtherwiseSpecified(source[key], options));
    }
  });
  return destination;
}

function deepmerge(target, source, options) {
  options = options || {};
  options.arrayMerge = options.arrayMerge || defaultArrayMerge;
  options.isMergeableObject = options.isMergeableObject || isMergeableObject;
  options.cloneUnlessOtherwiseSpecified = cloneUnlessOtherwiseSpecified;
  var sourceIsArray = Array.isArray(source);
  var targetIsArray = Array.isArray(target);
  if (sourceIsArray !== targetIsArray) {
    return cloneUnlessOtherwiseSpecified(source, options);
  } else if (sourceIsArray) {
    return options.arrayMerge(target, source, options);
  }
  return mergeObject(target, source, options);
}

deepmerge.all = function (array, options) {
  if (!Array.isArray(array)) throw new Error('first argument should be an array');
  return array.reduce(function (previous, next) {
    return deepmerge(previous, next, options);
  }, {});
};

module.exports = deepmerge;
