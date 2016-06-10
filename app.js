"use strict";
(function() {

Error.stackTraceLimit = Infinity;

var $global, $module;
if (typeof window !== "undefined") { /* web page */
  $global = window;
} else if (typeof self !== "undefined") { /* web worker */
  $global = self;
} else if (typeof global !== "undefined") { /* Node.js */
  $global = global;
  $global.require = require;
} else { /* others (e.g. Nashorn) */
  $global = this;
}

if ($global === undefined || $global.Array === undefined) {
  throw new Error("no global object found");
}
if (typeof module !== "undefined") {
  $module = module;
}

var $packages = {}, $idCounter = 0;
var $keys = function(m) { return m ? Object.keys(m) : []; };
var $flushConsole = function() {};
var $throwRuntimeError; /* set by package "runtime" */
var $throwNilPointerError = function() { $throwRuntimeError("invalid memory address or nil pointer dereference"); };
var $call = function(fn, rcvr, args) { return fn.apply(rcvr, args); };
var $makeFunc = function(fn) { return function() { return $externalize(fn(this, new ($sliceType($jsObjectPtr))($global.Array.prototype.slice.call(arguments, []))), $emptyInterface); }; };

var $mapArray = function(array, f) {
  var newArray = new array.constructor(array.length);
  for (var i = 0; i < array.length; i++) {
    newArray[i] = f(array[i]);
  }
  return newArray;
};

var $methodVal = function(recv, name) {
  var vals = recv.$methodVals || {};
  recv.$methodVals = vals; /* noop for primitives */
  var f = vals[name];
  if (f !== undefined) {
    return f;
  }
  var method = recv[name];
  f = function() {
    $stackDepthOffset--;
    try {
      return method.apply(recv, arguments);
    } finally {
      $stackDepthOffset++;
    }
  };
  vals[name] = f;
  return f;
};

var $methodExpr = function(typ, name) {
  var method = typ.prototype[name];
  if (method.$expr === undefined) {
    method.$expr = function() {
      $stackDepthOffset--;
      try {
        if (typ.wrapped) {
          arguments[0] = new typ(arguments[0]);
        }
        return Function.call.apply(method, arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return method.$expr;
};

var $ifaceMethodExprs = {};
var $ifaceMethodExpr = function(name) {
  var expr = $ifaceMethodExprs["$" + name];
  if (expr === undefined) {
    expr = $ifaceMethodExprs["$" + name] = function() {
      $stackDepthOffset--;
      try {
        return Function.call.apply(arguments[0][name], arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return expr;
};

var $subslice = function(slice, low, high, max) {
  if (low < 0 || high < low || max < high || high > slice.$capacity || max > slice.$capacity) {
    $throwRuntimeError("slice bounds out of range");
  }
  var s = new slice.constructor(slice.$array);
  s.$offset = slice.$offset + low;
  s.$length = slice.$length - low;
  s.$capacity = slice.$capacity - low;
  if (high !== undefined) {
    s.$length = high - low;
  }
  if (max !== undefined) {
    s.$capacity = max - low;
  }
  return s;
};

var $sliceToArray = function(slice) {
  if (slice.$length === 0) {
    return [];
  }
  if (slice.$array.constructor !== Array) {
    return slice.$array.subarray(slice.$offset, slice.$offset + slice.$length);
  }
  return slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
};

var $decodeRune = function(str, pos) {
  var c0 = str.charCodeAt(pos);

  if (c0 < 0x80) {
    return [c0, 1];
  }

  if (c0 !== c0 || c0 < 0xC0) {
    return [0xFFFD, 1];
  }

  var c1 = str.charCodeAt(pos + 1);
  if (c1 !== c1 || c1 < 0x80 || 0xC0 <= c1) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xE0) {
    var r = (c0 & 0x1F) << 6 | (c1 & 0x3F);
    if (r <= 0x7F) {
      return [0xFFFD, 1];
    }
    return [r, 2];
  }

  var c2 = str.charCodeAt(pos + 2);
  if (c2 !== c2 || c2 < 0x80 || 0xC0 <= c2) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF0) {
    var r = (c0 & 0x0F) << 12 | (c1 & 0x3F) << 6 | (c2 & 0x3F);
    if (r <= 0x7FF) {
      return [0xFFFD, 1];
    }
    if (0xD800 <= r && r <= 0xDFFF) {
      return [0xFFFD, 1];
    }
    return [r, 3];
  }

  var c3 = str.charCodeAt(pos + 3);
  if (c3 !== c3 || c3 < 0x80 || 0xC0 <= c3) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF8) {
    var r = (c0 & 0x07) << 18 | (c1 & 0x3F) << 12 | (c2 & 0x3F) << 6 | (c3 & 0x3F);
    if (r <= 0xFFFF || 0x10FFFF < r) {
      return [0xFFFD, 1];
    }
    return [r, 4];
  }

  return [0xFFFD, 1];
};

var $encodeRune = function(r) {
  if (r < 0 || r > 0x10FFFF || (0xD800 <= r && r <= 0xDFFF)) {
    r = 0xFFFD;
  }
  if (r <= 0x7F) {
    return String.fromCharCode(r);
  }
  if (r <= 0x7FF) {
    return String.fromCharCode(0xC0 | r >> 6, 0x80 | (r & 0x3F));
  }
  if (r <= 0xFFFF) {
    return String.fromCharCode(0xE0 | r >> 12, 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
  }
  return String.fromCharCode(0xF0 | r >> 18, 0x80 | (r >> 12 & 0x3F), 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
};

var $stringToBytes = function(str) {
  var array = new Uint8Array(str.length);
  for (var i = 0; i < str.length; i++) {
    array[i] = str.charCodeAt(i);
  }
  return array;
};

var $bytesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i += 10000) {
    str += String.fromCharCode.apply(undefined, slice.$array.subarray(slice.$offset + i, slice.$offset + Math.min(slice.$length, i + 10000)));
  }
  return str;
};

var $stringToRunes = function(str) {
  var array = new Int32Array(str.length);
  var rune, j = 0;
  for (var i = 0; i < str.length; i += rune[1], j++) {
    rune = $decodeRune(str, i);
    array[j] = rune[0];
  }
  return array.subarray(0, j);
};

var $runesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i++) {
    str += $encodeRune(slice.$array[slice.$offset + i]);
  }
  return str;
};

var $copyString = function(dst, src) {
  var n = Math.min(src.length, dst.$length);
  for (var i = 0; i < n; i++) {
    dst.$array[dst.$offset + i] = src.charCodeAt(i);
  }
  return n;
};

var $copySlice = function(dst, src) {
  var n = Math.min(src.$length, dst.$length);
  $copyArray(dst.$array, src.$array, dst.$offset, src.$offset, n, dst.constructor.elem);
  return n;
};

var $copyArray = function(dst, src, dstOffset, srcOffset, n, elem) {
  if (n === 0 || (dst === src && dstOffset === srcOffset)) {
    return;
  }

  if (src.subarray) {
    dst.set(src.subarray(srcOffset, srcOffset + n), dstOffset);
    return;
  }

  switch (elem.kind) {
  case $kindArray:
  case $kindStruct:
    if (dst === src && dstOffset > srcOffset) {
      for (var i = n - 1; i >= 0; i--) {
        elem.copy(dst[dstOffset + i], src[srcOffset + i]);
      }
      return;
    }
    for (var i = 0; i < n; i++) {
      elem.copy(dst[dstOffset + i], src[srcOffset + i]);
    }
    return;
  }

  if (dst === src && dstOffset > srcOffset) {
    for (var i = n - 1; i >= 0; i--) {
      dst[dstOffset + i] = src[srcOffset + i];
    }
    return;
  }
  for (var i = 0; i < n; i++) {
    dst[dstOffset + i] = src[srcOffset + i];
  }
};

var $clone = function(src, type) {
  var clone = type.zero();
  type.copy(clone, src);
  return clone;
};

var $pointerOfStructConversion = function(obj, type) {
  if(obj.$proxies === undefined) {
    obj.$proxies = {};
    obj.$proxies[obj.constructor.string] = obj;
  }
  var proxy = obj.$proxies[type.string];
  if (proxy === undefined) {
    var properties = {};
    for (var i = 0; i < type.elem.fields.length; i++) {
      (function(fieldProp) {
        properties[fieldProp] = {
          get: function() { return obj[fieldProp]; },
          set: function(value) { obj[fieldProp] = value; }
        };
      })(type.elem.fields[i].prop);
    }
    proxy = Object.create(type.prototype, properties);
    proxy.$val = proxy;
    obj.$proxies[type.string] = proxy;
    proxy.$proxies = obj.$proxies;
  }
  return proxy;
};

var $append = function(slice) {
  return $internalAppend(slice, arguments, 1, arguments.length - 1);
};

var $appendSlice = function(slice, toAppend) {
  if (toAppend.constructor === String) {
    var bytes = $stringToBytes(toAppend);
    return $internalAppend(slice, bytes, 0, bytes.length);
  }
  return $internalAppend(slice, toAppend.$array, toAppend.$offset, toAppend.$length);
};

var $internalAppend = function(slice, array, offset, length) {
  if (length === 0) {
    return slice;
  }

  var newArray = slice.$array;
  var newOffset = slice.$offset;
  var newLength = slice.$length + length;
  var newCapacity = slice.$capacity;

  if (newLength > newCapacity) {
    newOffset = 0;
    newCapacity = Math.max(newLength, slice.$capacity < 1024 ? slice.$capacity * 2 : Math.floor(slice.$capacity * 5 / 4));

    if (slice.$array.constructor === Array) {
      newArray = slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
      newArray.length = newCapacity;
      var zero = slice.constructor.elem.zero;
      for (var i = slice.$length; i < newCapacity; i++) {
        newArray[i] = zero();
      }
    } else {
      newArray = new slice.$array.constructor(newCapacity);
      newArray.set(slice.$array.subarray(slice.$offset, slice.$offset + slice.$length));
    }
  }

  $copyArray(newArray, array, newOffset + slice.$length, offset, length, slice.constructor.elem);

  var newSlice = new slice.constructor(newArray);
  newSlice.$offset = newOffset;
  newSlice.$length = newLength;
  newSlice.$capacity = newCapacity;
  return newSlice;
};

var $equal = function(a, b, type) {
  if (type === $jsObjectPtr) {
    return a === b;
  }
  switch (type.kind) {
  case $kindComplex64:
  case $kindComplex128:
    return a.$real === b.$real && a.$imag === b.$imag;
  case $kindInt64:
  case $kindUint64:
    return a.$high === b.$high && a.$low === b.$low;
  case $kindArray:
    if (a.length !== b.length) {
      return false;
    }
    for (var i = 0; i < a.length; i++) {
      if (!$equal(a[i], b[i], type.elem)) {
        return false;
      }
    }
    return true;
  case $kindStruct:
    for (var i = 0; i < type.fields.length; i++) {
      var f = type.fields[i];
      if (!$equal(a[f.prop], b[f.prop], f.typ)) {
        return false;
      }
    }
    return true;
  case $kindInterface:
    return $interfaceIsEqual(a, b);
  default:
    return a === b;
  }
};

var $interfaceIsEqual = function(a, b) {
  if (a === $ifaceNil || b === $ifaceNil) {
    return a === b;
  }
  if (a.constructor !== b.constructor) {
    return false;
  }
  if (a.constructor === $jsObjectPtr) {
    return a.object === b.object;
  }
  if (!a.constructor.comparable) {
    $throwRuntimeError("comparing uncomparable type " + a.constructor.string);
  }
  return $equal(a.$val, b.$val, a.constructor);
};

var $min = Math.min;
var $mod = function(x, y) { return x % y; };
var $parseInt = parseInt;
var $parseFloat = function(f) {
  if (f !== undefined && f !== null && f.constructor === Number) {
    return f;
  }
  return parseFloat(f);
};

var $froundBuf = new Float32Array(1);
var $fround = Math.fround || function(f) {
  $froundBuf[0] = f;
  return $froundBuf[0];
};

var $imul = Math.imul || function(a, b) {
  var ah = (a >>> 16) & 0xffff;
  var al = a & 0xffff;
  var bh = (b >>> 16) & 0xffff;
  var bl = b & 0xffff;
  return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) >> 0);
};

var $floatKey = function(f) {
  if (f !== f) {
    $idCounter++;
    return "NaN$" + $idCounter;
  }
  return String(f);
};

var $flatten64 = function(x) {
  return x.$high * 4294967296 + x.$low;
};

var $shiftLeft64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high << y | x.$low >>> (32 - y), (x.$low << y) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$low << (y - 32), 0);
  }
  return new x.constructor(0, 0);
};

var $shiftRightInt64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$high >> 31, (x.$high >> (y - 32)) >>> 0);
  }
  if (x.$high < 0) {
    return new x.constructor(-1, 4294967295);
  }
  return new x.constructor(0, 0);
};

var $shiftRightUint64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >>> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(0, x.$high >>> (y - 32));
  }
  return new x.constructor(0, 0);
};

var $mul64 = function(x, y) {
  var high = 0, low = 0;
  if ((y.$low & 1) !== 0) {
    high = x.$high;
    low = x.$low;
  }
  for (var i = 1; i < 32; i++) {
    if ((y.$low & 1<<i) !== 0) {
      high += x.$high << i | x.$low >>> (32 - i);
      low += (x.$low << i) >>> 0;
    }
  }
  for (var i = 0; i < 32; i++) {
    if ((y.$high & 1<<i) !== 0) {
      high += x.$low << i;
    }
  }
  return new x.constructor(high, low);
};

var $div64 = function(x, y, returnRemainder) {
  if (y.$high === 0 && y.$low === 0) {
    $throwRuntimeError("integer divide by zero");
  }

  var s = 1;
  var rs = 1;

  var xHigh = x.$high;
  var xLow = x.$low;
  if (xHigh < 0) {
    s = -1;
    rs = -1;
    xHigh = -xHigh;
    if (xLow !== 0) {
      xHigh--;
      xLow = 4294967296 - xLow;
    }
  }

  var yHigh = y.$high;
  var yLow = y.$low;
  if (y.$high < 0) {
    s *= -1;
    yHigh = -yHigh;
    if (yLow !== 0) {
      yHigh--;
      yLow = 4294967296 - yLow;
    }
  }

  var high = 0, low = 0, n = 0;
  while (yHigh < 2147483648 && ((xHigh > yHigh) || (xHigh === yHigh && xLow > yLow))) {
    yHigh = (yHigh << 1 | yLow >>> 31) >>> 0;
    yLow = (yLow << 1) >>> 0;
    n++;
  }
  for (var i = 0; i <= n; i++) {
    high = high << 1 | low >>> 31;
    low = (low << 1) >>> 0;
    if ((xHigh > yHigh) || (xHigh === yHigh && xLow >= yLow)) {
      xHigh = xHigh - yHigh;
      xLow = xLow - yLow;
      if (xLow < 0) {
        xHigh--;
        xLow += 4294967296;
      }
      low++;
      if (low === 4294967296) {
        high++;
        low = 0;
      }
    }
    yLow = (yLow >>> 1 | yHigh << (32 - 1)) >>> 0;
    yHigh = yHigh >>> 1;
  }

  if (returnRemainder) {
    return new x.constructor(xHigh * rs, xLow * rs);
  }
  return new x.constructor(high * s, low * s);
};

var $divComplex = function(n, d) {
  var ninf = n.$real === Infinity || n.$real === -Infinity || n.$imag === Infinity || n.$imag === -Infinity;
  var dinf = d.$real === Infinity || d.$real === -Infinity || d.$imag === Infinity || d.$imag === -Infinity;
  var nnan = !ninf && (n.$real !== n.$real || n.$imag !== n.$imag);
  var dnan = !dinf && (d.$real !== d.$real || d.$imag !== d.$imag);
  if(nnan || dnan) {
    return new n.constructor(NaN, NaN);
  }
  if (ninf && !dinf) {
    return new n.constructor(Infinity, Infinity);
  }
  if (!ninf && dinf) {
    return new n.constructor(0, 0);
  }
  if (d.$real === 0 && d.$imag === 0) {
    if (n.$real === 0 && n.$imag === 0) {
      return new n.constructor(NaN, NaN);
    }
    return new n.constructor(Infinity, Infinity);
  }
  var a = Math.abs(d.$real);
  var b = Math.abs(d.$imag);
  if (a <= b) {
    var ratio = d.$real / d.$imag;
    var denom = d.$real * ratio + d.$imag;
    return new n.constructor((n.$real * ratio + n.$imag) / denom, (n.$imag * ratio - n.$real) / denom);
  }
  var ratio = d.$imag / d.$real;
  var denom = d.$imag * ratio + d.$real;
  return new n.constructor((n.$imag * ratio + n.$real) / denom, (n.$imag - n.$real * ratio) / denom);
};

var $kindBool = 1;
var $kindInt = 2;
var $kindInt8 = 3;
var $kindInt16 = 4;
var $kindInt32 = 5;
var $kindInt64 = 6;
var $kindUint = 7;
var $kindUint8 = 8;
var $kindUint16 = 9;
var $kindUint32 = 10;
var $kindUint64 = 11;
var $kindUintptr = 12;
var $kindFloat32 = 13;
var $kindFloat64 = 14;
var $kindComplex64 = 15;
var $kindComplex128 = 16;
var $kindArray = 17;
var $kindChan = 18;
var $kindFunc = 19;
var $kindInterface = 20;
var $kindMap = 21;
var $kindPtr = 22;
var $kindSlice = 23;
var $kindString = 24;
var $kindStruct = 25;
var $kindUnsafePointer = 26;

var $methodSynthesizers = [];
var $addMethodSynthesizer = function(f) {
  if ($methodSynthesizers === null) {
    f();
    return;
  }
  $methodSynthesizers.push(f);
};
var $synthesizeMethods = function() {
  $methodSynthesizers.forEach(function(f) { f(); });
  $methodSynthesizers = null;
};

var $ifaceKeyFor = function(x) {
  if (x === $ifaceNil) {
    return 'nil';
  }
  var c = x.constructor;
  return c.string + '$' + c.keyFor(x.$val);
};

var $identity = function(x) { return x; };

var $typeIDCounter = 0;

var $idKey = function(x) {
  if (x.$id === undefined) {
    $idCounter++;
    x.$id = $idCounter;
  }
  return String(x.$id);
};

var $newType = function(size, kind, string, name, pkg, constructor) {
  var typ;
  switch(kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $identity;
    break;

  case $kindString:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return "$" + x; };
    break;

  case $kindFloat32:
  case $kindFloat64:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return $floatKey(x); };
    break;

  case $kindInt64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindUint64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >>> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindComplex64:
    typ = function(real, imag) {
      this.$real = $fround(real);
      this.$imag = $fround(imag);
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindComplex128:
    typ = function(real, imag) {
      this.$real = real;
      this.$imag = imag;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindArray:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, "", "", function(array) {
      this.$get = function() { return array; };
      this.$set = function(v) { typ.copy(this, v); };
      this.$val = array;
    });
    typ.init = function(elem, len) {
      typ.elem = elem;
      typ.len = len;
      typ.comparable = elem.comparable;
      typ.keyFor = function(x) {
        return Array.prototype.join.call($mapArray(x, function(e) {
          return String(elem.keyFor(e)).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }), "$");
      };
      typ.copy = function(dst, src) {
        $copyArray(dst, src, 0, 0, src.length, elem);
      };
      typ.ptr.init(typ);
      Object.defineProperty(typ.ptr.nil, "nilCheck", { get: $throwNilPointerError });
    };
    break;

  case $kindChan:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $idKey;
    typ.init = function(elem, sendOnly, recvOnly) {
      typ.elem = elem;
      typ.sendOnly = sendOnly;
      typ.recvOnly = recvOnly;
    };
    break;

  case $kindFunc:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(params, results, variadic) {
      typ.params = params;
      typ.results = results;
      typ.variadic = variadic;
      typ.comparable = false;
    };
    break;

  case $kindInterface:
    typ = { implementedBy: {}, missingMethodFor: {} };
    typ.keyFor = $ifaceKeyFor;
    typ.init = function(methods) {
      typ.methods = methods;
      methods.forEach(function(m) {
        $ifaceNil[m.prop] = $throwNilPointerError;
      });
    };
    break;

  case $kindMap:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(key, elem) {
      typ.key = key;
      typ.elem = elem;
      typ.comparable = false;
    };
    break;

  case $kindPtr:
    typ = constructor || function(getter, setter, target) {
      this.$get = getter;
      this.$set = setter;
      this.$target = target;
      this.$val = this;
    };
    typ.keyFor = $idKey;
    typ.init = function(elem) {
      typ.elem = elem;
      typ.wrapped = (elem.kind === $kindArray);
      typ.nil = new typ($throwNilPointerError, $throwNilPointerError);
    };
    break;

  case $kindSlice:
    typ = function(array) {
      if (array.constructor !== typ.nativeArray) {
        array = new typ.nativeArray(array);
      }
      this.$array = array;
      this.$offset = 0;
      this.$length = array.length;
      this.$capacity = array.length;
      this.$val = this;
    };
    typ.init = function(elem) {
      typ.elem = elem;
      typ.comparable = false;
      typ.nativeArray = $nativeArray(elem.kind);
      typ.nil = new typ([]);
    };
    break;

  case $kindStruct:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, "", "", constructor);
    typ.ptr.elem = typ;
    typ.ptr.prototype.$get = function() { return this; };
    typ.ptr.prototype.$set = function(v) { typ.copy(this, v); };
    typ.init = function(fields) {
      typ.fields = fields;
      fields.forEach(function(f) {
        if (!f.typ.comparable) {
          typ.comparable = false;
        }
      });
      typ.keyFor = function(x) {
        var val = x.$val;
        return $mapArray(fields, function(f) {
          return String(f.typ.keyFor(val[f.prop])).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }).join("$");
      };
      typ.copy = function(dst, src) {
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          switch (f.typ.kind) {
          case $kindArray:
          case $kindStruct:
            f.typ.copy(dst[f.prop], src[f.prop]);
            continue;
          default:
            dst[f.prop] = src[f.prop];
            continue;
          }
        }
      };
      /* nil value */
      var properties = {};
      fields.forEach(function(f) {
        properties[f.prop] = { get: $throwNilPointerError, set: $throwNilPointerError };
      });
      typ.ptr.nil = Object.create(constructor.prototype, properties);
      typ.ptr.nil.$val = typ.ptr.nil;
      /* methods for embedded fields */
      $addMethodSynthesizer(function() {
        var synthesizeMethod = function(target, m, f) {
          if (target.prototype[m.prop] !== undefined) { return; }
          target.prototype[m.prop] = function() {
            var v = this.$val[f.prop];
            if (f.typ === $jsObjectPtr) {
              v = new $jsObjectPtr(v);
            }
            if (v.$val === undefined) {
              v = new f.typ(v);
            }
            return v[m.prop].apply(v, arguments);
          };
        };
        fields.forEach(function(f) {
          if (f.name === "") {
            $methodSet(f.typ).forEach(function(m) {
              synthesizeMethod(typ, m, f);
              synthesizeMethod(typ.ptr, m, f);
            });
            $methodSet($ptrType(f.typ)).forEach(function(m) {
              synthesizeMethod(typ.ptr, m, f);
            });
          }
        });
      });
    };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  switch (kind) {
  case $kindBool:
  case $kindMap:
    typ.zero = function() { return false; };
    break;

  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8 :
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
  case $kindFloat32:
  case $kindFloat64:
    typ.zero = function() { return 0; };
    break;

  case $kindString:
    typ.zero = function() { return ""; };
    break;

  case $kindInt64:
  case $kindUint64:
  case $kindComplex64:
  case $kindComplex128:
    var zero = new typ(0, 0);
    typ.zero = function() { return zero; };
    break;

  case $kindPtr:
  case $kindSlice:
    typ.zero = function() { return typ.nil; };
    break;

  case $kindChan:
    typ.zero = function() { return $chanNil; };
    break;

  case $kindFunc:
    typ.zero = function() { return $throwNilPointerError; };
    break;

  case $kindInterface:
    typ.zero = function() { return $ifaceNil; };
    break;

  case $kindArray:
    typ.zero = function() {
      var arrayClass = $nativeArray(typ.elem.kind);
      if (arrayClass !== Array) {
        return new arrayClass(typ.len);
      }
      var array = new Array(typ.len);
      for (var i = 0; i < typ.len; i++) {
        array[i] = typ.elem.zero();
      }
      return array;
    };
    break;

  case $kindStruct:
    typ.zero = function() { return new typ.ptr(); };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  typ.id = $typeIDCounter;
  $typeIDCounter++;
  typ.size = size;
  typ.kind = kind;
  typ.string = string;
  typ.typeName = name;
  typ.pkg = pkg;
  typ.methods = [];
  typ.methodSetCache = null;
  typ.comparable = true;
  return typ;
};

var $methodSet = function(typ) {
  if (typ.methodSetCache !== null) {
    return typ.methodSetCache;
  }
  var base = {};

  var isPtr = (typ.kind === $kindPtr);
  if (isPtr && typ.elem.kind === $kindInterface) {
    typ.methodSetCache = [];
    return [];
  }

  var current = [{typ: isPtr ? typ.elem : typ, indirect: isPtr}];

  var seen = {};

  while (current.length > 0) {
    var next = [];
    var mset = [];

    current.forEach(function(e) {
      if (seen[e.typ.string]) {
        return;
      }
      seen[e.typ.string] = true;

      if(e.typ.typeName !== "") {
        mset = mset.concat(e.typ.methods);
        if (e.indirect) {
          mset = mset.concat($ptrType(e.typ).methods);
        }
      }

      switch (e.typ.kind) {
      case $kindStruct:
        e.typ.fields.forEach(function(f) {
          if (f.name === "") {
            var fTyp = f.typ;
            var fIsPtr = (fTyp.kind === $kindPtr);
            next.push({typ: fIsPtr ? fTyp.elem : fTyp, indirect: e.indirect || fIsPtr});
          }
        });
        break;

      case $kindInterface:
        mset = mset.concat(e.typ.methods);
        break;
      }
    });

    mset.forEach(function(m) {
      if (base[m.name] === undefined) {
        base[m.name] = m;
      }
    });

    current = next;
  }

  typ.methodSetCache = [];
  Object.keys(base).sort().forEach(function(name) {
    typ.methodSetCache.push(base[name]);
  });
  return typ.methodSetCache;
};

var $Bool          = $newType( 1, $kindBool,          "bool",           "bool",       "", null);
var $Int           = $newType( 4, $kindInt,           "int",            "int",        "", null);
var $Int8          = $newType( 1, $kindInt8,          "int8",           "int8",       "", null);
var $Int16         = $newType( 2, $kindInt16,         "int16",          "int16",      "", null);
var $Int32         = $newType( 4, $kindInt32,         "int32",          "int32",      "", null);
var $Int64         = $newType( 8, $kindInt64,         "int64",          "int64",      "", null);
var $Uint          = $newType( 4, $kindUint,          "uint",           "uint",       "", null);
var $Uint8         = $newType( 1, $kindUint8,         "uint8",          "uint8",      "", null);
var $Uint16        = $newType( 2, $kindUint16,        "uint16",         "uint16",     "", null);
var $Uint32        = $newType( 4, $kindUint32,        "uint32",         "uint32",     "", null);
var $Uint64        = $newType( 8, $kindUint64,        "uint64",         "uint64",     "", null);
var $Uintptr       = $newType( 4, $kindUintptr,       "uintptr",        "uintptr",    "", null);
var $Float32       = $newType( 4, $kindFloat32,       "float32",        "float32",    "", null);
var $Float64       = $newType( 8, $kindFloat64,       "float64",        "float64",    "", null);
var $Complex64     = $newType( 8, $kindComplex64,     "complex64",      "complex64",  "", null);
var $Complex128    = $newType(16, $kindComplex128,    "complex128",     "complex128", "", null);
var $String        = $newType( 8, $kindString,        "string",         "string",     "", null);
var $UnsafePointer = $newType( 4, $kindUnsafePointer, "unsafe.Pointer", "Pointer",    "", null);

var $nativeArray = function(elemKind) {
  switch (elemKind) {
  case $kindInt:
    return Int32Array;
  case $kindInt8:
    return Int8Array;
  case $kindInt16:
    return Int16Array;
  case $kindInt32:
    return Int32Array;
  case $kindUint:
    return Uint32Array;
  case $kindUint8:
    return Uint8Array;
  case $kindUint16:
    return Uint16Array;
  case $kindUint32:
    return Uint32Array;
  case $kindUintptr:
    return Uint32Array;
  case $kindFloat32:
    return Float32Array;
  case $kindFloat64:
    return Float64Array;
  default:
    return Array;
  }
};
var $toNativeArray = function(elemKind, array) {
  var nativeArray = $nativeArray(elemKind);
  if (nativeArray === Array) {
    return array;
  }
  return new nativeArray(array);
};
var $arrayTypes = {};
var $arrayType = function(elem, len) {
  var typeKey = elem.id + "$" + len;
  var typ = $arrayTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(12, $kindArray, "[" + len + "]" + elem.string, "", "", null);
    $arrayTypes[typeKey] = typ;
    typ.init(elem, len);
  }
  return typ;
};

var $chanType = function(elem, sendOnly, recvOnly) {
  var string = (recvOnly ? "<-" : "") + "chan" + (sendOnly ? "<- " : " ") + elem.string;
  var field = sendOnly ? "SendChan" : (recvOnly ? "RecvChan" : "Chan");
  var typ = elem[field];
  if (typ === undefined) {
    typ = $newType(4, $kindChan, string, "", "", null);
    elem[field] = typ;
    typ.init(elem, sendOnly, recvOnly);
  }
  return typ;
};
var $Chan = function(elem, capacity) {
  if (capacity < 0 || capacity > 2147483647) {
    $throwRuntimeError("makechan: size out of range");
  }
  this.$elem = elem;
  this.$capacity = capacity;
  this.$buffer = [];
  this.$sendQueue = [];
  this.$recvQueue = [];
  this.$closed = false;
};
var $chanNil = new $Chan(null, 0);
$chanNil.$sendQueue = $chanNil.$recvQueue = { length: 0, push: function() {}, shift: function() { return undefined; }, indexOf: function() { return -1; } };

var $funcTypes = {};
var $funcType = function(params, results, variadic) {
  var typeKey = $mapArray(params, function(p) { return p.id; }).join(",") + "$" + $mapArray(results, function(r) { return r.id; }).join(",") + "$" + variadic;
  var typ = $funcTypes[typeKey];
  if (typ === undefined) {
    var paramTypes = $mapArray(params, function(p) { return p.string; });
    if (variadic) {
      paramTypes[paramTypes.length - 1] = "..." + paramTypes[paramTypes.length - 1].substr(2);
    }
    var string = "func(" + paramTypes.join(", ") + ")";
    if (results.length === 1) {
      string += " " + results[0].string;
    } else if (results.length > 1) {
      string += " (" + $mapArray(results, function(r) { return r.string; }).join(", ") + ")";
    }
    typ = $newType(4, $kindFunc, string, "", "", null);
    $funcTypes[typeKey] = typ;
    typ.init(params, results, variadic);
  }
  return typ;
};

var $interfaceTypes = {};
var $interfaceType = function(methods) {
  var typeKey = $mapArray(methods, function(m) { return m.pkg + "," + m.name + "," + m.typ.id; }).join("$");
  var typ = $interfaceTypes[typeKey];
  if (typ === undefined) {
    var string = "interface {}";
    if (methods.length !== 0) {
      string = "interface { " + $mapArray(methods, function(m) {
        return (m.pkg !== "" ? m.pkg + "." : "") + m.name + m.typ.string.substr(4);
      }).join("; ") + " }";
    }
    typ = $newType(8, $kindInterface, string, "", "", null);
    $interfaceTypes[typeKey] = typ;
    typ.init(methods);
  }
  return typ;
};
var $emptyInterface = $interfaceType([]);
var $ifaceNil = {};
var $error = $newType(8, $kindInterface, "error", "error", "", null);
$error.init([{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}]);

var $mapTypes = {};
var $mapType = function(key, elem) {
  var typeKey = key.id + "$" + elem.id;
  var typ = $mapTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(4, $kindMap, "map[" + key.string + "]" + elem.string, "", "", null);
    $mapTypes[typeKey] = typ;
    typ.init(key, elem);
  }
  return typ;
};
var $makeMap = function(keyForFunc, entries) {
  var m = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    m[keyForFunc(e.k)] = e;
  }
  return m;
};

var $ptrType = function(elem) {
  var typ = elem.ptr;
  if (typ === undefined) {
    typ = $newType(4, $kindPtr, "*" + elem.string, "", "", null);
    elem.ptr = typ;
    typ.init(elem);
  }
  return typ;
};

var $newDataPointer = function(data, constructor) {
  if (constructor.elem.kind === $kindStruct) {
    return data;
  }
  return new constructor(function() { return data; }, function(v) { data = v; });
};

var $indexPtr = function(array, index, constructor) {
  array.$ptr = array.$ptr || {};
  return array.$ptr[index] || (array.$ptr[index] = new constructor(function() { return array[index]; }, function(v) { array[index] = v; }));
};

var $sliceType = function(elem) {
  var typ = elem.slice;
  if (typ === undefined) {
    typ = $newType(12, $kindSlice, "[]" + elem.string, "", "", null);
    elem.slice = typ;
    typ.init(elem);
  }
  return typ;
};
var $makeSlice = function(typ, length, capacity) {
  capacity = capacity || length;
  if (length < 0 || length > 2147483647) {
    $throwRuntimeError("makeslice: len out of range");
  }
  if (capacity < 0 || capacity < length || capacity > 2147483647) {
    $throwRuntimeError("makeslice: cap out of range");
  }
  var array = new typ.nativeArray(capacity);
  if (typ.nativeArray === Array) {
    for (var i = 0; i < capacity; i++) {
      array[i] = typ.elem.zero();
    }
  }
  var slice = new typ(array);
  slice.$length = length;
  return slice;
};

var $structTypes = {};
var $structType = function(fields) {
  var typeKey = $mapArray(fields, function(f) { return f.name + "," + f.typ.id + "," + f.tag; }).join("$");
  var typ = $structTypes[typeKey];
  if (typ === undefined) {
    var string = "struct { " + $mapArray(fields, function(f) {
      return f.name + " " + f.typ.string + (f.tag !== "" ? (" \"" + f.tag.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"") : "");
    }).join("; ") + " }";
    if (fields.length === 0) {
      string = "struct {}";
    }
    typ = $newType(0, $kindStruct, string, "", "", function() {
      this.$val = this;
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var arg = arguments[i];
        this[f.prop] = arg !== undefined ? arg : f.typ.zero();
      }
    });
    $structTypes[typeKey] = typ;
    typ.init(fields);
  }
  return typ;
};

var $assertType = function(value, type, returnTuple) {
  var isInterface = (type.kind === $kindInterface), ok, missingMethod = "";
  if (value === $ifaceNil) {
    ok = false;
  } else if (!isInterface) {
    ok = value.constructor === type;
  } else {
    var valueTypeString = value.constructor.string;
    ok = type.implementedBy[valueTypeString];
    if (ok === undefined) {
      ok = true;
      var valueMethodSet = $methodSet(value.constructor);
      var interfaceMethods = type.methods;
      for (var i = 0; i < interfaceMethods.length; i++) {
        var tm = interfaceMethods[i];
        var found = false;
        for (var j = 0; j < valueMethodSet.length; j++) {
          var vm = valueMethodSet[j];
          if (vm.name === tm.name && vm.pkg === tm.pkg && vm.typ === tm.typ) {
            found = true;
            break;
          }
        }
        if (!found) {
          ok = false;
          type.missingMethodFor[valueTypeString] = tm.name;
          break;
        }
      }
      type.implementedBy[valueTypeString] = ok;
    }
    if (!ok) {
      missingMethod = type.missingMethodFor[valueTypeString];
    }
  }

  if (!ok) {
    if (returnTuple) {
      return [type.zero(), false];
    }
    $panic(new $packages["runtime"].TypeAssertionError.ptr("", (value === $ifaceNil ? "" : value.constructor.string), type.string, missingMethod));
  }

  if (!isInterface) {
    value = value.$val;
  }
  if (type === $jsObjectPtr) {
    value = value.object;
  }
  return returnTuple ? [value, true] : value;
};

var $stackDepthOffset = 0;
var $getStackDepth = function() {
  var err = new Error();
  if (err.stack === undefined) {
    return undefined;
  }
  return $stackDepthOffset + err.stack.split("\n").length;
};

var $panicStackDepth = null, $panicValue;
var $callDeferred = function(deferred, jsErr, fromPanic) {
  if (!fromPanic && deferred !== null && deferred.index >= $curGoroutine.deferStack.length) {
    throw jsErr;
  }
  if (jsErr !== null) {
    var newErr = null;
    try {
      $curGoroutine.deferStack.push(deferred);
      $panic(new $jsErrorPtr(jsErr));
    } catch (err) {
      newErr = err;
    }
    $curGoroutine.deferStack.pop();
    $callDeferred(deferred, newErr);
    return;
  }
  if ($curGoroutine.asleep) {
    return;
  }

  $stackDepthOffset--;
  var outerPanicStackDepth = $panicStackDepth;
  var outerPanicValue = $panicValue;

  var localPanicValue = $curGoroutine.panicStack.pop();
  if (localPanicValue !== undefined) {
    $panicStackDepth = $getStackDepth();
    $panicValue = localPanicValue;
  }

  try {
    while (true) {
      if (deferred === null) {
        deferred = $curGoroutine.deferStack[$curGoroutine.deferStack.length - 1];
        if (deferred === undefined) {
          /* The panic reached the top of the stack. Clear it and throw it as a JavaScript error. */
          $panicStackDepth = null;
          if (localPanicValue.Object instanceof Error) {
            throw localPanicValue.Object;
          }
          var msg;
          if (localPanicValue.constructor === $String) {
            msg = localPanicValue.$val;
          } else if (localPanicValue.Error !== undefined) {
            msg = localPanicValue.Error();
          } else if (localPanicValue.String !== undefined) {
            msg = localPanicValue.String();
          } else {
            msg = localPanicValue;
          }
          throw new Error(msg);
        }
      }
      var call = deferred.pop();
      if (call === undefined) {
        $curGoroutine.deferStack.pop();
        if (localPanicValue !== undefined) {
          deferred = null;
          continue;
        }
        return;
      }
      var r = call[0].apply(call[2], call[1]);
      if (r && r.$blk !== undefined) {
        deferred.push([r.$blk, [], r]);
        if (fromPanic) {
          throw null;
        }
        return;
      }

      if (localPanicValue !== undefined && $panicStackDepth === null) {
        throw null; /* error was recovered */
      }
    }
  } finally {
    if (localPanicValue !== undefined) {
      if ($panicStackDepth !== null) {
        $curGoroutine.panicStack.push(localPanicValue);
      }
      $panicStackDepth = outerPanicStackDepth;
      $panicValue = outerPanicValue;
    }
    $stackDepthOffset++;
  }
};

var $panic = function(value) {
  $curGoroutine.panicStack.push(value);
  $callDeferred(null, null, true);
};
var $recover = function() {
  if ($panicStackDepth === null || ($panicStackDepth !== undefined && $panicStackDepth !== $getStackDepth() - 2)) {
    return $ifaceNil;
  }
  $panicStackDepth = null;
  return $panicValue;
};
var $throw = function(err) { throw err; };

var $dummyGoroutine = { asleep: false, exit: false, deferStack: [], panicStack: [], canBlock: false };
var $curGoroutine = $dummyGoroutine, $totalGoroutines = 0, $awakeGoroutines = 0, $checkForDeadlock = true;
var $mainFinished = false;
var $go = function(fun, args, direct) {
  $totalGoroutines++;
  $awakeGoroutines++;
  var $goroutine = function() {
    try {
      $curGoroutine = $goroutine;
      var r = fun.apply(undefined, args);
      if (r && r.$blk !== undefined) {
        fun = function() { return r.$blk(); };
        args = [];
        return;
      }
      $goroutine.exit = true;
    } catch (err) {
      if (!$goroutine.exit) {
        throw err;
      }
    } finally {
      $curGoroutine = $dummyGoroutine;
      if ($goroutine.exit) { /* also set by runtime.Goexit() */
        $totalGoroutines--;
        $goroutine.asleep = true;
      }
      if ($goroutine.asleep) {
        $awakeGoroutines--;
        if (!$mainFinished && $awakeGoroutines === 0 && $checkForDeadlock) {
          console.error("fatal error: all goroutines are asleep - deadlock!");
          if ($global.process !== undefined) {
            $global.process.exit(2);
          }
        }
      }
    }
  };
  $goroutine.asleep = false;
  $goroutine.exit = false;
  $goroutine.deferStack = [];
  $goroutine.panicStack = [];
  $goroutine.canBlock = true;
  $schedule($goroutine, direct);
};

var $scheduled = [], $schedulerActive = false;
var $runScheduled = function() {
  try {
    var r;
    while ((r = $scheduled.shift()) !== undefined) {
      r();
    }
    $schedulerActive = false;
  } finally {
    if ($schedulerActive) {
      setTimeout($runScheduled, 0);
    }
  }
};
var $schedule = function(goroutine, direct) {
  if (goroutine.asleep) {
    goroutine.asleep = false;
    $awakeGoroutines++;
  }

  if (direct) {
    goroutine();
    return;
  }

  $scheduled.push(goroutine);
  if (!$schedulerActive) {
    $schedulerActive = true;
    setTimeout($runScheduled, 0);
  }
};

var $setTimeout = function(f, t) {
  $awakeGoroutines++;
  return setTimeout(function() {
    $awakeGoroutines--;
    f();
  }, t);
};

var $block = function() {
  if (!$curGoroutine.canBlock) {
    $throwRuntimeError("cannot block in JavaScript callback, fix by wrapping code in goroutine");
  }
  $curGoroutine.asleep = true;
};

var $send = function(chan, value) {
  if (chan.$closed) {
    $throwRuntimeError("send on closed channel");
  }
  var queuedRecv = chan.$recvQueue.shift();
  if (queuedRecv !== undefined) {
    queuedRecv([value, true]);
    return;
  }
  if (chan.$buffer.length < chan.$capacity) {
    chan.$buffer.push(value);
    return;
  }

  var thisGoroutine = $curGoroutine;
  chan.$sendQueue.push(function() {
    $schedule(thisGoroutine);
    return value;
  });
  $block();
  return {
    $blk: function() {
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
    }
  };
};
var $recv = function(chan) {
  var queuedSend = chan.$sendQueue.shift();
  if (queuedSend !== undefined) {
    chan.$buffer.push(queuedSend());
  }
  var bufferedValue = chan.$buffer.shift();
  if (bufferedValue !== undefined) {
    return [bufferedValue, true];
  }
  if (chan.$closed) {
    return [chan.$elem.zero(), false];
  }

  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.value; } };
  var queueEntry = function(v) {
    f.value = v;
    $schedule(thisGoroutine);
  };
  chan.$recvQueue.push(queueEntry);
  $block();
  return f;
};
var $close = function(chan) {
  if (chan.$closed) {
    $throwRuntimeError("close of closed channel");
  }
  chan.$closed = true;
  while (true) {
    var queuedSend = chan.$sendQueue.shift();
    if (queuedSend === undefined) {
      break;
    }
    queuedSend(); /* will panic because of closed channel */
  }
  while (true) {
    var queuedRecv = chan.$recvQueue.shift();
    if (queuedRecv === undefined) {
      break;
    }
    queuedRecv([chan.$elem.zero(), false]);
  }
};
var $select = function(comms) {
  var ready = [];
  var selection = -1;
  for (var i = 0; i < comms.length; i++) {
    var comm = comms[i];
    var chan = comm[0];
    switch (comm.length) {
    case 0: /* default */
      selection = i;
      break;
    case 1: /* recv */
      if (chan.$sendQueue.length !== 0 || chan.$buffer.length !== 0 || chan.$closed) {
        ready.push(i);
      }
      break;
    case 2: /* send */
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
      if (chan.$recvQueue.length !== 0 || chan.$buffer.length < chan.$capacity) {
        ready.push(i);
      }
      break;
    }
  }

  if (ready.length !== 0) {
    selection = ready[Math.floor(Math.random() * ready.length)];
  }
  if (selection !== -1) {
    var comm = comms[selection];
    switch (comm.length) {
    case 0: /* default */
      return [selection];
    case 1: /* recv */
      return [selection, $recv(comm[0])];
    case 2: /* send */
      $send(comm[0], comm[1]);
      return [selection];
    }
  }

  var entries = [];
  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.selection; } };
  var removeFromQueues = function() {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var queue = entry[0];
      var index = queue.indexOf(entry[1]);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    }
  };
  for (var i = 0; i < comms.length; i++) {
    (function(i) {
      var comm = comms[i];
      switch (comm.length) {
      case 1: /* recv */
        var queueEntry = function(value) {
          f.selection = [i, value];
          removeFromQueues();
          $schedule(thisGoroutine);
        };
        entries.push([comm[0].$recvQueue, queueEntry]);
        comm[0].$recvQueue.push(queueEntry);
        break;
      case 2: /* send */
        var queueEntry = function() {
          if (comm[0].$closed) {
            $throwRuntimeError("send on closed channel");
          }
          f.selection = [i];
          removeFromQueues();
          $schedule(thisGoroutine);
          return comm[1];
        };
        entries.push([comm[0].$sendQueue, queueEntry]);
        comm[0].$sendQueue.push(queueEntry);
        break;
      }
    })(i);
  }
  $block();
  return f;
};

var $jsObjectPtr, $jsErrorPtr;

var $needsExternalization = function(t) {
  switch (t.kind) {
    case $kindBool:
    case $kindInt:
    case $kindInt8:
    case $kindInt16:
    case $kindInt32:
    case $kindUint:
    case $kindUint8:
    case $kindUint16:
    case $kindUint32:
    case $kindUintptr:
    case $kindFloat32:
    case $kindFloat64:
      return false;
    default:
      return t !== $jsObjectPtr;
  }
};

var $externalize = function(v, t) {
  if (t === $jsObjectPtr) {
    return v;
  }
  switch (t.kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindFloat32:
  case $kindFloat64:
    return v;
  case $kindInt64:
  case $kindUint64:
    return $flatten64(v);
  case $kindArray:
    if ($needsExternalization(t.elem)) {
      return $mapArray(v, function(e) { return $externalize(e, t.elem); });
    }
    return v;
  case $kindFunc:
    return $externalizeFunction(v, t, false);
  case $kindInterface:
    if (v === $ifaceNil) {
      return null;
    }
    if (v.constructor === $jsObjectPtr) {
      return v.$val.object;
    }
    return $externalize(v.$val, v.constructor);
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var entry = v[keys[i]];
      m[$externalize(entry.k, t.key)] = $externalize(entry.v, t.elem);
    }
    return m;
  case $kindPtr:
    if (v === t.nil) {
      return null;
    }
    return $externalize(v.$get(), t.elem);
  case $kindSlice:
    if ($needsExternalization(t.elem)) {
      return $mapArray($sliceToArray(v), function(e) { return $externalize(e, t.elem); });
    }
    return $sliceToArray(v);
  case $kindString:
    if (v.search(/^[\x00-\x7F]*$/) !== -1) {
      return v;
    }
    var s = "", r;
    for (var i = 0; i < v.length; i += r[1]) {
      r = $decodeRune(v, i);
      var c = r[0];
      if (c > 0xFFFF) {
        var h = Math.floor((c - 0x10000) / 0x400) + 0xD800;
        var l = (c - 0x10000) % 0x400 + 0xDC00;
        s += String.fromCharCode(h, l);
        continue;
      }
      s += String.fromCharCode(c);
    }
    return s;
  case $kindStruct:
    var timePkg = $packages["time"];
    if (timePkg !== undefined && v.constructor === timePkg.Time.ptr) {
      var milli = $div64(v.UnixNano(), new $Int64(0, 1000000));
      return new Date($flatten64(milli));
    }

    var noJsObject = {};
    var searchJsObject = function(v, t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      switch (t.kind) {
      case $kindPtr:
        if (v === t.nil) {
          return noJsObject;
        }
        return searchJsObject(v.$get(), t.elem);
      case $kindStruct:
        var f = t.fields[0];
        return searchJsObject(v[f.prop], f.typ);
      case $kindInterface:
        return searchJsObject(v.$val, v.constructor);
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(v, t);
    if (o !== noJsObject) {
      return o;
    }

    o = {};
    for (var i = 0; i < t.fields.length; i++) {
      var f = t.fields[i];
      if (f.pkg !== "") { /* not exported */
        continue;
      }
      o[f.name] = $externalize(v[f.prop], f.typ);
    }
    return o;
  }
  $throwRuntimeError("cannot externalize " + t.string);
};

var $externalizeFunction = function(v, t, passThis) {
  if (v === $throwNilPointerError) {
    return null;
  }
  if (v.$externalizeWrapper === undefined) {
    $checkForDeadlock = false;
    v.$externalizeWrapper = function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = [];
          for (var j = i; j < arguments.length; j++) {
            varargs.push($internalize(arguments[j], vt));
          }
          args.push(new (t.params[i])(varargs));
          break;
        }
        args.push($internalize(arguments[i], t.params[i]));
      }
      var canBlock = $curGoroutine.canBlock;
      $curGoroutine.canBlock = false;
      try {
        var result = v.apply(passThis ? this : undefined, args);
      } finally {
        $curGoroutine.canBlock = canBlock;
      }
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $externalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $externalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  }
  return v.$externalizeWrapper;
};

var $internalize = function(v, t, recv) {
  if (t === $jsObjectPtr) {
    return v;
  }
  if (t === $jsObjectPtr.elem) {
    $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
  }
  if (v && v.__internal_object__ !== undefined) {
    return $assertType(v.__internal_object__, t, false);
  }
  var timePkg = $packages["time"];
  if (timePkg !== undefined && t === timePkg.Time) {
    if (!(v !== null && v !== undefined && v.constructor === Date)) {
      $throwRuntimeError("cannot internalize time.Time from " + typeof v + ", must be Date");
    }
    return timePkg.Unix(new $Int64(0, 0), new $Int64(0, v.getTime() * 1000000));
  }
  switch (t.kind) {
  case $kindBool:
    return !!v;
  case $kindInt:
    return parseInt(v);
  case $kindInt8:
    return parseInt(v) << 24 >> 24;
  case $kindInt16:
    return parseInt(v) << 16 >> 16;
  case $kindInt32:
    return parseInt(v) >> 0;
  case $kindUint:
    return parseInt(v);
  case $kindUint8:
    return parseInt(v) << 24 >>> 24;
  case $kindUint16:
    return parseInt(v) << 16 >>> 16;
  case $kindUint32:
  case $kindUintptr:
    return parseInt(v) >>> 0;
  case $kindInt64:
  case $kindUint64:
    return new t(0, v);
  case $kindFloat32:
  case $kindFloat64:
    return parseFloat(v);
  case $kindArray:
    if (v.length !== t.len) {
      $throwRuntimeError("got array with wrong size from JavaScript native");
    }
    return $mapArray(v, function(e) { return $internalize(e, t.elem); });
  case $kindFunc:
    return function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = arguments[i];
          for (var j = 0; j < varargs.$length; j++) {
            args.push($externalize(varargs.$array[varargs.$offset + j], vt));
          }
          break;
        }
        args.push($externalize(arguments[i], t.params[i]));
      }
      var result = v.apply(recv, args);
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $internalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $internalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  case $kindInterface:
    if (t.methods.length !== 0) {
      $throwRuntimeError("cannot internalize " + t.string);
    }
    if (v === null) {
      return $ifaceNil;
    }
    if (v === undefined) {
      return new $jsObjectPtr(undefined);
    }
    switch (v.constructor) {
    case Int8Array:
      return new ($sliceType($Int8))(v);
    case Int16Array:
      return new ($sliceType($Int16))(v);
    case Int32Array:
      return new ($sliceType($Int))(v);
    case Uint8Array:
      return new ($sliceType($Uint8))(v);
    case Uint16Array:
      return new ($sliceType($Uint16))(v);
    case Uint32Array:
      return new ($sliceType($Uint))(v);
    case Float32Array:
      return new ($sliceType($Float32))(v);
    case Float64Array:
      return new ($sliceType($Float64))(v);
    case Array:
      return $internalize(v, $sliceType($emptyInterface));
    case Boolean:
      return new $Bool(!!v);
    case Date:
      if (timePkg === undefined) {
        /* time package is not present, internalize as &js.Object{Date} so it can be externalized into original Date. */
        return new $jsObjectPtr(v);
      }
      return new timePkg.Time($internalize(v, timePkg.Time));
    case Function:
      var funcType = $funcType([$sliceType($emptyInterface)], [$jsObjectPtr], true);
      return new funcType($internalize(v, funcType));
    case Number:
      return new $Float64(parseFloat(v));
    case String:
      return new $String($internalize(v, $String));
    default:
      if ($global.Node && v instanceof $global.Node) {
        return new $jsObjectPtr(v);
      }
      var mapType = $mapType($String, $emptyInterface);
      return new mapType($internalize(v, mapType));
    }
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var k = $internalize(keys[i], t.key);
      m[t.key.keyFor(k)] = { k: k, v: $internalize(v[keys[i]], t.elem) };
    }
    return m;
  case $kindPtr:
    if (t.elem.kind === $kindStruct) {
      return $internalize(v, t.elem);
    }
  case $kindSlice:
    return new t($mapArray(v, function(e) { return $internalize(e, t.elem); }));
  case $kindString:
    v = String(v);
    if (v.search(/^[\x00-\x7F]*$/) !== -1) {
      return v;
    }
    var s = "";
    var i = 0;
    while (i < v.length) {
      var h = v.charCodeAt(i);
      if (0xD800 <= h && h <= 0xDBFF) {
        var l = v.charCodeAt(i + 1);
        var c = (h - 0xD800) * 0x400 + l - 0xDC00 + 0x10000;
        s += $encodeRune(c);
        i += 2;
        continue;
      }
      s += $encodeRune(h);
      i++;
    }
    return s;
  case $kindStruct:
    var noJsObject = {};
    var searchJsObject = function(t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      if (t === $jsObjectPtr.elem) {
        $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
      }
      switch (t.kind) {
      case $kindPtr:
        return searchJsObject(t.elem);
      case $kindStruct:
        var f = t.fields[0];
        var o = searchJsObject(f.typ);
        if (o !== noJsObject) {
          var n = new t.ptr();
          n[f.prop] = o;
          return n;
        }
        return noJsObject;
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(t);
    if (o !== noJsObject) {
      return o;
    }
  }
  $throwRuntimeError("cannot internalize " + t.string);
};

$packages["github.com/gopherjs/gopherjs/js"] = (function() {
	var $pkg = {}, $init, Object, Error, sliceType, ptrType, ptrType$1, MakeFunc, init;
	Object = $pkg.Object = $newType(0, $kindStruct, "js.Object", "Object", "github.com/gopherjs/gopherjs/js", function(object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.object = null;
			return;
		}
		this.object = object_;
	});
	Error = $pkg.Error = $newType(0, $kindStruct, "js.Error", "Error", "github.com/gopherjs/gopherjs/js", function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	sliceType = $sliceType($emptyInterface);
	ptrType = $ptrType(Object);
	ptrType$1 = $ptrType(Error);
	Object.ptr.prototype.Get = function(key) {
		var $ptr, key, o;
		o = this;
		return o.object[$externalize(key, $String)];
	};
	Object.prototype.Get = function(key) { return this.$val.Get(key); };
	Object.ptr.prototype.Set = function(key, value) {
		var $ptr, key, o, value;
		o = this;
		o.object[$externalize(key, $String)] = $externalize(value, $emptyInterface);
	};
	Object.prototype.Set = function(key, value) { return this.$val.Set(key, value); };
	Object.ptr.prototype.Delete = function(key) {
		var $ptr, key, o;
		o = this;
		delete o.object[$externalize(key, $String)];
	};
	Object.prototype.Delete = function(key) { return this.$val.Delete(key); };
	Object.ptr.prototype.Length = function() {
		var $ptr, o;
		o = this;
		return $parseInt(o.object.length);
	};
	Object.prototype.Length = function() { return this.$val.Length(); };
	Object.ptr.prototype.Index = function(i) {
		var $ptr, i, o;
		o = this;
		return o.object[i];
	};
	Object.prototype.Index = function(i) { return this.$val.Index(i); };
	Object.ptr.prototype.SetIndex = function(i, value) {
		var $ptr, i, o, value;
		o = this;
		o.object[i] = $externalize(value, $emptyInterface);
	};
	Object.prototype.SetIndex = function(i, value) { return this.$val.SetIndex(i, value); };
	Object.ptr.prototype.Call = function(name, args) {
		var $ptr, args, name, o, obj;
		o = this;
		return (obj = o.object, obj[$externalize(name, $String)].apply(obj, $externalize(args, sliceType)));
	};
	Object.prototype.Call = function(name, args) { return this.$val.Call(name, args); };
	Object.ptr.prototype.Invoke = function(args) {
		var $ptr, args, o;
		o = this;
		return o.object.apply(undefined, $externalize(args, sliceType));
	};
	Object.prototype.Invoke = function(args) { return this.$val.Invoke(args); };
	Object.ptr.prototype.New = function(args) {
		var $ptr, args, o;
		o = this;
		return new ($global.Function.prototype.bind.apply(o.object, [undefined].concat($externalize(args, sliceType))));
	};
	Object.prototype.New = function(args) { return this.$val.New(args); };
	Object.ptr.prototype.Bool = function() {
		var $ptr, o;
		o = this;
		return !!(o.object);
	};
	Object.prototype.Bool = function() { return this.$val.Bool(); };
	Object.ptr.prototype.String = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $String);
	};
	Object.prototype.String = function() { return this.$val.String(); };
	Object.ptr.prototype.Int = function() {
		var $ptr, o;
		o = this;
		return $parseInt(o.object) >> 0;
	};
	Object.prototype.Int = function() { return this.$val.Int(); };
	Object.ptr.prototype.Int64 = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $Int64);
	};
	Object.prototype.Int64 = function() { return this.$val.Int64(); };
	Object.ptr.prototype.Uint64 = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $Uint64);
	};
	Object.prototype.Uint64 = function() { return this.$val.Uint64(); };
	Object.ptr.prototype.Float = function() {
		var $ptr, o;
		o = this;
		return $parseFloat(o.object);
	};
	Object.prototype.Float = function() { return this.$val.Float(); };
	Object.ptr.prototype.Interface = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $emptyInterface);
	};
	Object.prototype.Interface = function() { return this.$val.Interface(); };
	Object.ptr.prototype.Unsafe = function() {
		var $ptr, o;
		o = this;
		return o.object;
	};
	Object.prototype.Unsafe = function() { return this.$val.Unsafe(); };
	Error.ptr.prototype.Error = function() {
		var $ptr, err;
		err = this;
		return "JavaScript error: " + $internalize(err.Object.message, $String);
	};
	Error.prototype.Error = function() { return this.$val.Error(); };
	Error.ptr.prototype.Stack = function() {
		var $ptr, err;
		err = this;
		return $internalize(err.Object.stack, $String);
	};
	Error.prototype.Stack = function() { return this.$val.Stack(); };
	MakeFunc = function(fn) {
		var $ptr, fn;
		return $makeFunc(fn);
	};
	$pkg.MakeFunc = MakeFunc;
	init = function() {
		var $ptr, e;
		e = new Error.ptr(null);
	};
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([$String], [ptrType], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([$String, $emptyInterface], [], false)}, {prop: "Delete", name: "Delete", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [ptrType], false)}, {prop: "SetIndex", name: "SetIndex", pkg: "", typ: $funcType([$Int, $emptyInterface], [], false)}, {prop: "Call", name: "Call", pkg: "", typ: $funcType([$String, sliceType], [ptrType], true)}, {prop: "Invoke", name: "Invoke", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "New", name: "New", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "Bool", name: "Bool", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Int64", name: "Int64", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Uint64", name: "Uint64", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "Float", name: "Float", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Interface", name: "Interface", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Unsafe", name: "Unsafe", pkg: "", typ: $funcType([], [$Uintptr], false)}];
	ptrType$1.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Stack", name: "Stack", pkg: "", typ: $funcType([], [$String], false)}];
	Object.init([{prop: "object", name: "object", pkg: "github.com/gopherjs/gopherjs/js", typ: ptrType, tag: ""}]);
	Error.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime/internal/sys"] = (function() {
	var $pkg = {}, $init;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime"] = (function() {
	var $pkg = {}, $init, js, sys, TypeAssertionError, errorString, ptrType$4, init, GOROOT, Goexit;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	sys = $packages["runtime/internal/sys"];
	TypeAssertionError = $pkg.TypeAssertionError = $newType(0, $kindStruct, "runtime.TypeAssertionError", "TypeAssertionError", "runtime", function(interfaceString_, concreteString_, assertedString_, missingMethod_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.interfaceString = "";
			this.concreteString = "";
			this.assertedString = "";
			this.missingMethod = "";
			return;
		}
		this.interfaceString = interfaceString_;
		this.concreteString = concreteString_;
		this.assertedString = assertedString_;
		this.missingMethod = missingMethod_;
	});
	errorString = $pkg.errorString = $newType(8, $kindString, "runtime.errorString", "errorString", "runtime", null);
	ptrType$4 = $ptrType(TypeAssertionError);
	init = function() {
		var $ptr, e, jsPkg;
		jsPkg = $packages[$externalize("github.com/gopherjs/gopherjs/js", $String)];
		$jsObjectPtr = jsPkg.Object.ptr;
		$jsErrorPtr = jsPkg.Error.ptr;
		$throwRuntimeError = (function(msg) {
			var $ptr, msg;
			$panic(new errorString(msg));
		});
		e = $ifaceNil;
		e = new TypeAssertionError.ptr("", "", "", "");
	};
	GOROOT = function() {
		var $ptr, goroot, process;
		process = $global.process;
		if (process === undefined) {
			return "/";
		}
		goroot = process.env.GOROOT;
		if (!(goroot === undefined)) {
			return $internalize(goroot, $String);
		}
		return "/usr/local/go";
	};
	$pkg.GOROOT = GOROOT;
	Goexit = function() {
		var $ptr;
		$curGoroutine.exit = $externalize(true, $Bool);
		$throw(null);
	};
	$pkg.Goexit = Goexit;
	TypeAssertionError.ptr.prototype.RuntimeError = function() {
		var $ptr;
	};
	TypeAssertionError.prototype.RuntimeError = function() { return this.$val.RuntimeError(); };
	TypeAssertionError.ptr.prototype.Error = function() {
		var $ptr, e, inter;
		e = this;
		inter = e.interfaceString;
		if (inter === "") {
			inter = "interface";
		}
		if (e.concreteString === "") {
			return "interface conversion: " + inter + " is nil, not " + e.assertedString;
		}
		if (e.missingMethod === "") {
			return "interface conversion: " + inter + " is " + e.concreteString + ", not " + e.assertedString;
		}
		return "interface conversion: " + e.concreteString + " is not " + e.assertedString + ": missing method " + e.missingMethod;
	};
	TypeAssertionError.prototype.Error = function() { return this.$val.Error(); };
	errorString.prototype.RuntimeError = function() {
		var $ptr, e;
		e = this.$val;
	};
	$ptrType(errorString).prototype.RuntimeError = function() { return new errorString(this.$get()).RuntimeError(); };
	errorString.prototype.Error = function() {
		var $ptr, e;
		e = this.$val;
		return "runtime error: " + e;
	};
	$ptrType(errorString).prototype.Error = function() { return new errorString(this.$get()).Error(); };
	ptrType$4.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	TypeAssertionError.init([{prop: "interfaceString", name: "interfaceString", pkg: "runtime", typ: $String, tag: ""}, {prop: "concreteString", name: "concreteString", pkg: "runtime", typ: $String, tag: ""}, {prop: "assertedString", name: "assertedString", pkg: "runtime", typ: $String, tag: ""}, {prop: "missingMethod", name: "missingMethod", pkg: "runtime", typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sys.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["errors"] = (function() {
	var $pkg = {}, $init, errorString, ptrType, New;
	errorString = $pkg.errorString = $newType(0, $kindStruct, "errors.errorString", "errorString", "errors", function(s_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.s = "";
			return;
		}
		this.s = s_;
	});
	ptrType = $ptrType(errorString);
	New = function(text) {
		var $ptr, text;
		return new errorString.ptr(text);
	};
	$pkg.New = New;
	errorString.ptr.prototype.Error = function() {
		var $ptr, e;
		e = this;
		return e.s;
	};
	errorString.prototype.Error = function() { return this.$val.Error(); };
	ptrType.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.init([{prop: "s", name: "s", pkg: "errors", typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["math"] = (function() {
	var $pkg = {}, $init, js, arrayType, arrayType$1, arrayType$2, structType, arrayType$3, math, buf, pow10tab, init, init$1;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	arrayType = $arrayType($Uint32, 2);
	arrayType$1 = $arrayType($Float32, 2);
	arrayType$2 = $arrayType($Float64, 1);
	structType = $structType([{prop: "uint32array", name: "uint32array", pkg: "math", typ: arrayType, tag: ""}, {prop: "float32array", name: "float32array", pkg: "math", typ: arrayType$1, tag: ""}, {prop: "float64array", name: "float64array", pkg: "math", typ: arrayType$2, tag: ""}]);
	arrayType$3 = $arrayType($Float64, 70);
	init = function() {
		var $ptr, ab;
		ab = new ($global.ArrayBuffer)(8);
		buf.uint32array = new ($global.Uint32Array)(ab);
		buf.float32array = new ($global.Float32Array)(ab);
		buf.float64array = new ($global.Float64Array)(ab);
	};
	init$1 = function() {
		var $ptr, _q, i, m, x;
		pow10tab[0] = 1;
		pow10tab[1] = 10;
		i = 2;
		while (true) {
			if (!(i < 70)) { break; }
			m = (_q = i / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
			((i < 0 || i >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[i] = ((m < 0 || m >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[m]) * (x = i - m >> 0, ((x < 0 || x >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[x])));
			i = i + (1) >> 0;
		}
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		buf = new structType.ptr(arrayType.zero(), arrayType$1.zero(), arrayType$2.zero());
		pow10tab = arrayType$3.zero();
		math = $global.Math;
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode/utf8"] = (function() {
	var $pkg = {}, $init, acceptRange, first, acceptRanges, DecodeRune, DecodeRuneInString, DecodeLastRune, DecodeLastRuneInString, RuneLen, EncodeRune, RuneStart;
	acceptRange = $pkg.acceptRange = $newType(0, $kindStruct, "utf8.acceptRange", "acceptRange", "unicode/utf8", function(lo_, hi_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.lo = 0;
			this.hi = 0;
			return;
		}
		this.lo = lo_;
		this.hi = hi_;
	});
	DecodeRune = function(p) {
		var $ptr, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, accept, b1, b2, b3, mask, n, p, p0, r, size, sz, x, x$1;
		r = 0;
		size = 0;
		n = p.$length;
		if (n < 1) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		p0 = (0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0]);
		x = ((p0 < 0 || p0 >= first.length) ? $throwRuntimeError("index out of range") : first[p0]);
		if (x >= 240) {
			mask = ((x >> 0) << 31 >> 0) >> 31 >> 0;
			_tmp$2 = ((((0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0]) >> 0) & ~mask) >> 0) | (65533 & mask);
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		sz = (x & 7) >>> 0;
		accept = $clone((x$1 = x >>> 4 << 24 >>> 24, ((x$1 < 0 || x$1 >= acceptRanges.length) ? $throwRuntimeError("index out of range") : acceptRanges[x$1])), acceptRange);
		if (n < (sz >> 0)) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		b1 = (1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1]);
		if (b1 < accept.lo || accept.hi < b1) {
			_tmp$6 = 65533;
			_tmp$7 = 1;
			r = _tmp$6;
			size = _tmp$7;
			return [r, size];
		}
		if (sz === 2) {
			_tmp$8 = ((((p0 & 31) >>> 0) >> 0) << 6 >> 0) | (((b1 & 63) >>> 0) >> 0);
			_tmp$9 = 2;
			r = _tmp$8;
			size = _tmp$9;
			return [r, size];
		}
		b2 = (2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2]);
		if (b2 < 128 || 191 < b2) {
			_tmp$10 = 65533;
			_tmp$11 = 1;
			r = _tmp$10;
			size = _tmp$11;
			return [r, size];
		}
		if (sz === 3) {
			_tmp$12 = (((((p0 & 15) >>> 0) >> 0) << 12 >> 0) | ((((b1 & 63) >>> 0) >> 0) << 6 >> 0)) | (((b2 & 63) >>> 0) >> 0);
			_tmp$13 = 3;
			r = _tmp$12;
			size = _tmp$13;
			return [r, size];
		}
		b3 = (3 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 3]);
		if (b3 < 128 || 191 < b3) {
			_tmp$14 = 65533;
			_tmp$15 = 1;
			r = _tmp$14;
			size = _tmp$15;
			return [r, size];
		}
		_tmp$16 = ((((((p0 & 7) >>> 0) >> 0) << 18 >> 0) | ((((b1 & 63) >>> 0) >> 0) << 12 >> 0)) | ((((b2 & 63) >>> 0) >> 0) << 6 >> 0)) | (((b3 & 63) >>> 0) >> 0);
		_tmp$17 = 4;
		r = _tmp$16;
		size = _tmp$17;
		return [r, size];
	};
	$pkg.DecodeRune = DecodeRune;
	DecodeRuneInString = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, accept, mask, n, r, s, s0, s1, s2, s3, size, sz, x, x$1;
		r = 0;
		size = 0;
		n = s.length;
		if (n < 1) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		s0 = s.charCodeAt(0);
		x = ((s0 < 0 || s0 >= first.length) ? $throwRuntimeError("index out of range") : first[s0]);
		if (x >= 240) {
			mask = ((x >> 0) << 31 >> 0) >> 31 >> 0;
			_tmp$2 = (((s.charCodeAt(0) >> 0) & ~mask) >> 0) | (65533 & mask);
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		sz = (x & 7) >>> 0;
		accept = $clone((x$1 = x >>> 4 << 24 >>> 24, ((x$1 < 0 || x$1 >= acceptRanges.length) ? $throwRuntimeError("index out of range") : acceptRanges[x$1])), acceptRange);
		if (n < (sz >> 0)) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		s1 = s.charCodeAt(1);
		if (s1 < accept.lo || accept.hi < s1) {
			_tmp$6 = 65533;
			_tmp$7 = 1;
			r = _tmp$6;
			size = _tmp$7;
			return [r, size];
		}
		if (sz === 2) {
			_tmp$8 = ((((s0 & 31) >>> 0) >> 0) << 6 >> 0) | (((s1 & 63) >>> 0) >> 0);
			_tmp$9 = 2;
			r = _tmp$8;
			size = _tmp$9;
			return [r, size];
		}
		s2 = s.charCodeAt(2);
		if (s2 < 128 || 191 < s2) {
			_tmp$10 = 65533;
			_tmp$11 = 1;
			r = _tmp$10;
			size = _tmp$11;
			return [r, size];
		}
		if (sz === 3) {
			_tmp$12 = (((((s0 & 15) >>> 0) >> 0) << 12 >> 0) | ((((s1 & 63) >>> 0) >> 0) << 6 >> 0)) | (((s2 & 63) >>> 0) >> 0);
			_tmp$13 = 3;
			r = _tmp$12;
			size = _tmp$13;
			return [r, size];
		}
		s3 = s.charCodeAt(3);
		if (s3 < 128 || 191 < s3) {
			_tmp$14 = 65533;
			_tmp$15 = 1;
			r = _tmp$14;
			size = _tmp$15;
			return [r, size];
		}
		_tmp$16 = ((((((s0 & 7) >>> 0) >> 0) << 18 >> 0) | ((((s1 & 63) >>> 0) >> 0) << 12 >> 0)) | ((((s2 & 63) >>> 0) >> 0) << 6 >> 0)) | (((s3 & 63) >>> 0) >> 0);
		_tmp$17 = 4;
		r = _tmp$16;
		size = _tmp$17;
		return [r, size];
	};
	$pkg.DecodeRuneInString = DecodeRuneInString;
	DecodeLastRune = function(p) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, end, lim, p, r, size, start;
		r = 0;
		size = 0;
		end = p.$length;
		if (end === 0) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		start = end - 1 >> 0;
		r = (((start < 0 || start >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + start]) >> 0);
		if (r < 128) {
			_tmp$2 = r;
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		lim = end - 4 >> 0;
		if (lim < 0) {
			lim = 0;
		}
		start = start - (1) >> 0;
		while (true) {
			if (!(start >= lim)) { break; }
			if (RuneStart(((start < 0 || start >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + start]))) {
				break;
			}
			start = start - (1) >> 0;
		}
		if (start < 0) {
			start = 0;
		}
		_tuple = DecodeRune($subslice(p, start, end));
		r = _tuple[0];
		size = _tuple[1];
		if (!(((start + size >> 0) === end))) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		_tmp$6 = r;
		_tmp$7 = size;
		r = _tmp$6;
		size = _tmp$7;
		return [r, size];
	};
	$pkg.DecodeLastRune = DecodeLastRune;
	DecodeLastRuneInString = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, end, lim, r, s, size, start;
		r = 0;
		size = 0;
		end = s.length;
		if (end === 0) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		start = end - 1 >> 0;
		r = (s.charCodeAt(start) >> 0);
		if (r < 128) {
			_tmp$2 = r;
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		lim = end - 4 >> 0;
		if (lim < 0) {
			lim = 0;
		}
		start = start - (1) >> 0;
		while (true) {
			if (!(start >= lim)) { break; }
			if (RuneStart(s.charCodeAt(start))) {
				break;
			}
			start = start - (1) >> 0;
		}
		if (start < 0) {
			start = 0;
		}
		_tuple = DecodeRuneInString(s.substring(start, end));
		r = _tuple[0];
		size = _tuple[1];
		if (!(((start + size >> 0) === end))) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		_tmp$6 = r;
		_tmp$7 = size;
		r = _tmp$6;
		size = _tmp$7;
		return [r, size];
	};
	$pkg.DecodeLastRuneInString = DecodeLastRuneInString;
	RuneLen = function(r) {
		var $ptr, r;
		if (r < 0) {
			return -1;
		} else if (r <= 127) {
			return 1;
		} else if (r <= 2047) {
			return 2;
		} else if (55296 <= r && r <= 57343) {
			return -1;
		} else if (r <= 65535) {
			return 3;
		} else if (r <= 1114111) {
			return 4;
		}
		return -1;
	};
	$pkg.RuneLen = RuneLen;
	EncodeRune = function(p, r) {
		var $ptr, i, p, r;
		i = (r >>> 0);
		if (i <= 127) {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = (r << 24 >>> 24));
			return 1;
		} else if (i <= 2047) {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((192 | ((r >> 6 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 2;
		} else if ((i > 1114111) || (55296 <= i && i <= 57343)) {
			r = 65533;
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((224 | ((r >> 12 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 3;
		} else if (i <= 65535) {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((224 | ((r >> 12 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 3;
		} else {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((240 | ((r >> 18 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | ((((r >> 12 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = ((128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(3 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 3] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 4;
		}
	};
	$pkg.EncodeRune = EncodeRune;
	RuneStart = function(b) {
		var $ptr, b;
		return !((((b & 192) >>> 0) === 128));
	};
	$pkg.RuneStart = RuneStart;
	acceptRange.init([{prop: "lo", name: "lo", pkg: "unicode/utf8", typ: $Uint8, tag: ""}, {prop: "hi", name: "hi", pkg: "unicode/utf8", typ: $Uint8, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		first = $toNativeArray($kindUint8, [240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 19, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 35, 3, 3, 52, 4, 4, 4, 68, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241]);
		acceptRanges = $toNativeArray($kindStruct, [new acceptRange.ptr(128, 191), new acceptRange.ptr(160, 191), new acceptRange.ptr(128, 159), new acceptRange.ptr(144, 191), new acceptRange.ptr(128, 143)]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["strconv"] = (function() {
	var $pkg = {}, $init, errors, math, utf8, sliceType$4, sliceType$5, sliceType$6, arrayType$3, arrayType$4, isPrint16, isNotPrint16, isPrint32, isNotPrint32, isGraphic, shifts, FormatUint, FormatInt, Itoa, formatBits, quoteWith, Quote, QuoteToASCII, CanBackquote, bsearch16, bsearch32, IsPrint, isInGraphicList;
	errors = $packages["errors"];
	math = $packages["math"];
	utf8 = $packages["unicode/utf8"];
	sliceType$4 = $sliceType($Uint16);
	sliceType$5 = $sliceType($Uint32);
	sliceType$6 = $sliceType($Uint8);
	arrayType$3 = $arrayType($Uint8, 65);
	arrayType$4 = $arrayType($Uint8, 4);
	FormatUint = function(i, base) {
		var $ptr, _tuple, base, i, s;
		_tuple = formatBits(sliceType$6.nil, i, base, false, false);
		s = _tuple[1];
		return s;
	};
	$pkg.FormatUint = FormatUint;
	FormatInt = function(i, base) {
		var $ptr, _tuple, base, i, s;
		_tuple = formatBits(sliceType$6.nil, new $Uint64(i.$high, i.$low), base, (i.$high < 0 || (i.$high === 0 && i.$low < 0)), false);
		s = _tuple[1];
		return s;
	};
	$pkg.FormatInt = FormatInt;
	Itoa = function(i) {
		var $ptr, i;
		return FormatInt(new $Int64(0, i), 10);
	};
	$pkg.Itoa = Itoa;
	formatBits = function(dst, u, base, neg, append_) {
		var $ptr, _q, _q$1, a, append_, b, b$1, base, d, dst, i, j, m, neg, q, q$1, q$2, qs, s, s$1, u, us, us$1, x, x$1;
		d = sliceType$6.nil;
		s = "";
		if (base < 2 || base > 36) {
			$panic(new $String("strconv: illegal AppendInt/FormatInt base"));
		}
		a = arrayType$3.zero();
		i = 65;
		if (neg) {
			u = new $Uint64(-u.$high, -u.$low);
		}
		if (base === 10) {
			if (true) {
				while (true) {
					if (!((u.$high > 0 || (u.$high === 0 && u.$low > 4294967295)))) { break; }
					q = $div64(u, new $Uint64(0, 1000000000), false);
					us = ((x = $mul64(q, new $Uint64(0, 1000000000)), new $Uint64(u.$high - x.$high, u.$low - x.$low)).$low >>> 0);
					j = 9;
					while (true) {
						if (!(j > 0)) { break; }
						i = i - (1) >> 0;
						qs = (_q = us / 10, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
						((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = (((us - ($imul(qs, 10) >>> 0) >>> 0) + 48 >>> 0) << 24 >>> 24));
						us = qs;
						j = j - (1) >> 0;
					}
					u = q;
				}
			}
			us$1 = (u.$low >>> 0);
			while (true) {
				if (!(us$1 >= 10)) { break; }
				i = i - (1) >> 0;
				q$1 = (_q$1 = us$1 / 10, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
				((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = (((us$1 - ($imul(q$1, 10) >>> 0) >>> 0) + 48 >>> 0) << 24 >>> 24));
				us$1 = q$1;
			}
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = ((us$1 + 48 >>> 0) << 24 >>> 24));
		} else {
			s$1 = ((base < 0 || base >= shifts.length) ? $throwRuntimeError("index out of range") : shifts[base]);
			if (s$1 > 0) {
				b = new $Uint64(0, base);
				m = (b.$low >>> 0) - 1 >>> 0;
				while (true) {
					if (!((u.$high > b.$high || (u.$high === b.$high && u.$low >= b.$low)))) { break; }
					i = i - (1) >> 0;
					((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((((u.$low >>> 0) & m) >>> 0)));
					u = $shiftRightUint64(u, (s$1));
				}
				i = i - (1) >> 0;
				((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((u.$low >>> 0)));
			} else {
				b$1 = new $Uint64(0, base);
				while (true) {
					if (!((u.$high > b$1.$high || (u.$high === b$1.$high && u.$low >= b$1.$low)))) { break; }
					i = i - (1) >> 0;
					q$2 = $div64(u, b$1, false);
					((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt(((x$1 = $mul64(q$2, b$1), new $Uint64(u.$high - x$1.$high, u.$low - x$1.$low)).$low >>> 0)));
					u = q$2;
				}
				i = i - (1) >> 0;
				((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((u.$low >>> 0)));
			}
		}
		if (neg) {
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = 45);
		}
		if (append_) {
			d = $appendSlice(dst, $subslice(new sliceType$6(a), i));
			return [d, s];
		}
		s = $bytesToString($subslice(new sliceType$6(a), i));
		return [d, s];
	};
	quoteWith = function(s, quote, ASCIIonly, graphicOnly) {
		var $ptr, ASCIIonly, _1, _q, _tuple, buf, graphicOnly, n, quote, r, runeTmp, s, s$1, s$2, width;
		runeTmp = arrayType$4.zero();
		buf = $makeSlice(sliceType$6, 0, (_q = ($imul(3, s.length)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")));
		buf = $append(buf, quote);
		width = 0;
		while (true) {
			if (!(s.length > 0)) { break; }
			r = (s.charCodeAt(0) >> 0);
			width = 1;
			if (r >= 128) {
				_tuple = utf8.DecodeRuneInString(s);
				r = _tuple[0];
				width = _tuple[1];
			}
			if ((width === 1) && (r === 65533)) {
				buf = $appendSlice(buf, "\\x");
				buf = $append(buf, "0123456789abcdef".charCodeAt((s.charCodeAt(0) >>> 4 << 24 >>> 24)));
				buf = $append(buf, "0123456789abcdef".charCodeAt(((s.charCodeAt(0) & 15) >>> 0)));
				s = s.substring(width);
				continue;
			}
			if ((r === (quote >> 0)) || (r === 92)) {
				buf = $append(buf, 92);
				buf = $append(buf, (r << 24 >>> 24));
				s = s.substring(width);
				continue;
			}
			if (ASCIIonly) {
				if (r < 128 && IsPrint(r)) {
					buf = $append(buf, (r << 24 >>> 24));
					s = s.substring(width);
					continue;
				}
			} else if (IsPrint(r) || graphicOnly && isInGraphicList(r)) {
				n = utf8.EncodeRune(new sliceType$6(runeTmp), r);
				buf = $appendSlice(buf, $subslice(new sliceType$6(runeTmp), 0, n));
				s = s.substring(width);
				continue;
			}
			_1 = r;
			if (_1 === (7)) {
				buf = $appendSlice(buf, "\\a");
			} else if (_1 === (8)) {
				buf = $appendSlice(buf, "\\b");
			} else if (_1 === (12)) {
				buf = $appendSlice(buf, "\\f");
			} else if (_1 === (10)) {
				buf = $appendSlice(buf, "\\n");
			} else if (_1 === (13)) {
				buf = $appendSlice(buf, "\\r");
			} else if (_1 === (9)) {
				buf = $appendSlice(buf, "\\t");
			} else if (_1 === (11)) {
				buf = $appendSlice(buf, "\\v");
			} else {
				if (r < 32) {
					buf = $appendSlice(buf, "\\x");
					buf = $append(buf, "0123456789abcdef".charCodeAt((s.charCodeAt(0) >>> 4 << 24 >>> 24)));
					buf = $append(buf, "0123456789abcdef".charCodeAt(((s.charCodeAt(0) & 15) >>> 0)));
				} else if (r > 1114111) {
					r = 65533;
					buf = $appendSlice(buf, "\\u");
					s$1 = 12;
					while (true) {
						if (!(s$1 >= 0)) { break; }
						buf = $append(buf, "0123456789abcdef".charCodeAt((((r >> $min((s$1 >>> 0), 31)) >> 0) & 15)));
						s$1 = s$1 - (4) >> 0;
					}
				} else if (r < 65536) {
					buf = $appendSlice(buf, "\\u");
					s$1 = 12;
					while (true) {
						if (!(s$1 >= 0)) { break; }
						buf = $append(buf, "0123456789abcdef".charCodeAt((((r >> $min((s$1 >>> 0), 31)) >> 0) & 15)));
						s$1 = s$1 - (4) >> 0;
					}
				} else {
					buf = $appendSlice(buf, "\\U");
					s$2 = 28;
					while (true) {
						if (!(s$2 >= 0)) { break; }
						buf = $append(buf, "0123456789abcdef".charCodeAt((((r >> $min((s$2 >>> 0), 31)) >> 0) & 15)));
						s$2 = s$2 - (4) >> 0;
					}
				}
			}
			s = s.substring(width);
		}
		buf = $append(buf, quote);
		return $bytesToString(buf);
	};
	Quote = function(s) {
		var $ptr, s;
		return quoteWith(s, 34, false, false);
	};
	$pkg.Quote = Quote;
	QuoteToASCII = function(s) {
		var $ptr, s;
		return quoteWith(s, 34, true, false);
	};
	$pkg.QuoteToASCII = QuoteToASCII;
	CanBackquote = function(s) {
		var $ptr, _tuple, r, s, wid;
		while (true) {
			if (!(s.length > 0)) { break; }
			_tuple = utf8.DecodeRuneInString(s);
			r = _tuple[0];
			wid = _tuple[1];
			s = s.substring(wid);
			if (wid > 1) {
				if (r === 65279) {
					return false;
				}
				continue;
			}
			if (r === 65533) {
				return false;
			}
			if ((r < 32 && !((r === 9))) || (r === 96) || (r === 127)) {
				return false;
			}
		}
		return true;
	};
	$pkg.CanBackquote = CanBackquote;
	bsearch16 = function(a, x) {
		var $ptr, _q, _tmp, _tmp$1, a, h, i, j, x;
		_tmp = 0;
		_tmp$1 = a.$length;
		i = _tmp;
		j = _tmp$1;
		while (true) {
			if (!(i < j)) { break; }
			h = i + (_q = ((j - i >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			if (((h < 0 || h >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + h]) < x) {
				i = h + 1 >> 0;
			} else {
				j = h;
			}
		}
		return i;
	};
	bsearch32 = function(a, x) {
		var $ptr, _q, _tmp, _tmp$1, a, h, i, j, x;
		_tmp = 0;
		_tmp$1 = a.$length;
		i = _tmp;
		j = _tmp$1;
		while (true) {
			if (!(i < j)) { break; }
			h = i + (_q = ((j - i >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			if (((h < 0 || h >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + h]) < x) {
				i = h + 1 >> 0;
			} else {
				j = h;
			}
		}
		return i;
	};
	IsPrint = function(r) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, i, i$1, isNotPrint, isNotPrint$1, isPrint, isPrint$1, j, j$1, r, rr, rr$1, x, x$1, x$2, x$3;
		if (r <= 255) {
			if (32 <= r && r <= 126) {
				return true;
			}
			if (161 <= r && r <= 255) {
				return !((r === 173));
			}
			return false;
		}
		if (0 <= r && r < 65536) {
			_tmp = (r << 16 >>> 16);
			_tmp$1 = isPrint16;
			_tmp$2 = isNotPrint16;
			rr = _tmp;
			isPrint = _tmp$1;
			isNotPrint = _tmp$2;
			i = bsearch16(isPrint, rr);
			if (i >= isPrint.$length || rr < (x = (i & ~1) >> 0, ((x < 0 || x >= isPrint.$length) ? $throwRuntimeError("index out of range") : isPrint.$array[isPrint.$offset + x])) || (x$1 = i | 1, ((x$1 < 0 || x$1 >= isPrint.$length) ? $throwRuntimeError("index out of range") : isPrint.$array[isPrint.$offset + x$1])) < rr) {
				return false;
			}
			j = bsearch16(isNotPrint, rr);
			return j >= isNotPrint.$length || !((((j < 0 || j >= isNotPrint.$length) ? $throwRuntimeError("index out of range") : isNotPrint.$array[isNotPrint.$offset + j]) === rr));
		}
		_tmp$3 = (r >>> 0);
		_tmp$4 = isPrint32;
		_tmp$5 = isNotPrint32;
		rr$1 = _tmp$3;
		isPrint$1 = _tmp$4;
		isNotPrint$1 = _tmp$5;
		i$1 = bsearch32(isPrint$1, rr$1);
		if (i$1 >= isPrint$1.$length || rr$1 < (x$2 = (i$1 & ~1) >> 0, ((x$2 < 0 || x$2 >= isPrint$1.$length) ? $throwRuntimeError("index out of range") : isPrint$1.$array[isPrint$1.$offset + x$2])) || (x$3 = i$1 | 1, ((x$3 < 0 || x$3 >= isPrint$1.$length) ? $throwRuntimeError("index out of range") : isPrint$1.$array[isPrint$1.$offset + x$3])) < rr$1) {
			return false;
		}
		if (r >= 131072) {
			return true;
		}
		r = r - (65536) >> 0;
		j$1 = bsearch16(isNotPrint$1, (r << 16 >>> 16));
		return j$1 >= isNotPrint$1.$length || !((((j$1 < 0 || j$1 >= isNotPrint$1.$length) ? $throwRuntimeError("index out of range") : isNotPrint$1.$array[isNotPrint$1.$offset + j$1]) === (r << 16 >>> 16)));
	};
	$pkg.IsPrint = IsPrint;
	isInGraphicList = function(r) {
		var $ptr, i, r, rr;
		if (r > 65535) {
			return false;
		}
		rr = (r << 16 >>> 16);
		i = bsearch16(isGraphic, rr);
		return i < isGraphic.$length && (rr === ((i < 0 || i >= isGraphic.$length) ? $throwRuntimeError("index out of range") : isGraphic.$array[isGraphic.$offset + i]));
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrRange = errors.New("value out of range");
		$pkg.ErrSyntax = errors.New("invalid syntax");
		isPrint16 = new sliceType$4([32, 126, 161, 887, 890, 895, 900, 1366, 1369, 1418, 1421, 1479, 1488, 1514, 1520, 1524, 1542, 1563, 1566, 1805, 1808, 1866, 1869, 1969, 1984, 2042, 2048, 2093, 2096, 2139, 2142, 2142, 2208, 2228, 2275, 2444, 2447, 2448, 2451, 2482, 2486, 2489, 2492, 2500, 2503, 2504, 2507, 2510, 2519, 2519, 2524, 2531, 2534, 2555, 2561, 2570, 2575, 2576, 2579, 2617, 2620, 2626, 2631, 2632, 2635, 2637, 2641, 2641, 2649, 2654, 2662, 2677, 2689, 2745, 2748, 2765, 2768, 2768, 2784, 2787, 2790, 2801, 2809, 2809, 2817, 2828, 2831, 2832, 2835, 2873, 2876, 2884, 2887, 2888, 2891, 2893, 2902, 2903, 2908, 2915, 2918, 2935, 2946, 2954, 2958, 2965, 2969, 2975, 2979, 2980, 2984, 2986, 2990, 3001, 3006, 3010, 3014, 3021, 3024, 3024, 3031, 3031, 3046, 3066, 3072, 3129, 3133, 3149, 3157, 3162, 3168, 3171, 3174, 3183, 3192, 3257, 3260, 3277, 3285, 3286, 3294, 3299, 3302, 3314, 3329, 3386, 3389, 3406, 3415, 3415, 3423, 3427, 3430, 3445, 3449, 3455, 3458, 3478, 3482, 3517, 3520, 3526, 3530, 3530, 3535, 3551, 3558, 3567, 3570, 3572, 3585, 3642, 3647, 3675, 3713, 3716, 3719, 3722, 3725, 3725, 3732, 3751, 3754, 3773, 3776, 3789, 3792, 3801, 3804, 3807, 3840, 3948, 3953, 4058, 4096, 4295, 4301, 4301, 4304, 4685, 4688, 4701, 4704, 4749, 4752, 4789, 4792, 4805, 4808, 4885, 4888, 4954, 4957, 4988, 4992, 5017, 5024, 5109, 5112, 5117, 5120, 5788, 5792, 5880, 5888, 5908, 5920, 5942, 5952, 5971, 5984, 6003, 6016, 6109, 6112, 6121, 6128, 6137, 6144, 6157, 6160, 6169, 6176, 6263, 6272, 6314, 6320, 6389, 6400, 6443, 6448, 6459, 6464, 6464, 6468, 6509, 6512, 6516, 6528, 6571, 6576, 6601, 6608, 6618, 6622, 6683, 6686, 6780, 6783, 6793, 6800, 6809, 6816, 6829, 6832, 6846, 6912, 6987, 6992, 7036, 7040, 7155, 7164, 7223, 7227, 7241, 7245, 7295, 7360, 7367, 7376, 7417, 7424, 7669, 7676, 7957, 7960, 7965, 7968, 8005, 8008, 8013, 8016, 8061, 8064, 8147, 8150, 8175, 8178, 8190, 8208, 8231, 8240, 8286, 8304, 8305, 8308, 8348, 8352, 8382, 8400, 8432, 8448, 8587, 8592, 9210, 9216, 9254, 9280, 9290, 9312, 11123, 11126, 11157, 11160, 11193, 11197, 11217, 11244, 11247, 11264, 11507, 11513, 11559, 11565, 11565, 11568, 11623, 11631, 11632, 11647, 11670, 11680, 11842, 11904, 12019, 12032, 12245, 12272, 12283, 12289, 12438, 12441, 12543, 12549, 12589, 12593, 12730, 12736, 12771, 12784, 19893, 19904, 40917, 40960, 42124, 42128, 42182, 42192, 42539, 42560, 42743, 42752, 42925, 42928, 42935, 42999, 43051, 43056, 43065, 43072, 43127, 43136, 43204, 43214, 43225, 43232, 43261, 43264, 43347, 43359, 43388, 43392, 43481, 43486, 43574, 43584, 43597, 43600, 43609, 43612, 43714, 43739, 43766, 43777, 43782, 43785, 43790, 43793, 43798, 43808, 43877, 43888, 44013, 44016, 44025, 44032, 55203, 55216, 55238, 55243, 55291, 63744, 64109, 64112, 64217, 64256, 64262, 64275, 64279, 64285, 64449, 64467, 64831, 64848, 64911, 64914, 64967, 65008, 65021, 65024, 65049, 65056, 65131, 65136, 65276, 65281, 65470, 65474, 65479, 65482, 65487, 65490, 65495, 65498, 65500, 65504, 65518, 65532, 65533]);
		isNotPrint16 = new sliceType$4([173, 907, 909, 930, 1328, 1376, 1416, 1424, 1757, 2111, 2436, 2473, 2481, 2526, 2564, 2601, 2609, 2612, 2615, 2621, 2653, 2692, 2702, 2706, 2729, 2737, 2740, 2758, 2762, 2820, 2857, 2865, 2868, 2910, 2948, 2961, 2971, 2973, 3017, 3076, 3085, 3089, 3113, 3141, 3145, 3159, 3200, 3204, 3213, 3217, 3241, 3252, 3269, 3273, 3295, 3312, 3332, 3341, 3345, 3397, 3401, 3460, 3506, 3516, 3541, 3543, 3715, 3721, 3736, 3744, 3748, 3750, 3756, 3770, 3781, 3783, 3912, 3992, 4029, 4045, 4294, 4681, 4695, 4697, 4745, 4785, 4799, 4801, 4823, 4881, 5760, 5901, 5997, 6001, 6431, 6751, 7415, 8024, 8026, 8028, 8030, 8117, 8133, 8156, 8181, 8335, 11209, 11311, 11359, 11558, 11687, 11695, 11703, 11711, 11719, 11727, 11735, 11743, 11930, 12352, 12687, 12831, 13055, 43470, 43519, 43815, 43823, 64311, 64317, 64319, 64322, 64325, 65107, 65127, 65141, 65511]);
		isPrint32 = new sliceType$5([65536, 65613, 65616, 65629, 65664, 65786, 65792, 65794, 65799, 65843, 65847, 65932, 65936, 65947, 65952, 65952, 66000, 66045, 66176, 66204, 66208, 66256, 66272, 66299, 66304, 66339, 66352, 66378, 66384, 66426, 66432, 66499, 66504, 66517, 66560, 66717, 66720, 66729, 66816, 66855, 66864, 66915, 66927, 66927, 67072, 67382, 67392, 67413, 67424, 67431, 67584, 67589, 67592, 67640, 67644, 67644, 67647, 67742, 67751, 67759, 67808, 67829, 67835, 67867, 67871, 67897, 67903, 67903, 67968, 68023, 68028, 68047, 68050, 68102, 68108, 68147, 68152, 68154, 68159, 68167, 68176, 68184, 68192, 68255, 68288, 68326, 68331, 68342, 68352, 68405, 68409, 68437, 68440, 68466, 68472, 68497, 68505, 68508, 68521, 68527, 68608, 68680, 68736, 68786, 68800, 68850, 68858, 68863, 69216, 69246, 69632, 69709, 69714, 69743, 69759, 69825, 69840, 69864, 69872, 69881, 69888, 69955, 69968, 70006, 70016, 70093, 70096, 70132, 70144, 70205, 70272, 70313, 70320, 70378, 70384, 70393, 70400, 70412, 70415, 70416, 70419, 70457, 70460, 70468, 70471, 70472, 70475, 70477, 70480, 70480, 70487, 70487, 70493, 70499, 70502, 70508, 70512, 70516, 70784, 70855, 70864, 70873, 71040, 71093, 71096, 71133, 71168, 71236, 71248, 71257, 71296, 71351, 71360, 71369, 71424, 71449, 71453, 71467, 71472, 71487, 71840, 71922, 71935, 71935, 72384, 72440, 73728, 74649, 74752, 74868, 74880, 75075, 77824, 78894, 82944, 83526, 92160, 92728, 92736, 92777, 92782, 92783, 92880, 92909, 92912, 92917, 92928, 92997, 93008, 93047, 93053, 93071, 93952, 94020, 94032, 94078, 94095, 94111, 110592, 110593, 113664, 113770, 113776, 113788, 113792, 113800, 113808, 113817, 113820, 113823, 118784, 119029, 119040, 119078, 119081, 119154, 119163, 119272, 119296, 119365, 119552, 119638, 119648, 119665, 119808, 119967, 119970, 119970, 119973, 119974, 119977, 120074, 120077, 120134, 120138, 120485, 120488, 120779, 120782, 121483, 121499, 121519, 124928, 125124, 125127, 125142, 126464, 126500, 126503, 126523, 126530, 126530, 126535, 126548, 126551, 126564, 126567, 126619, 126625, 126651, 126704, 126705, 126976, 127019, 127024, 127123, 127136, 127150, 127153, 127221, 127232, 127244, 127248, 127339, 127344, 127386, 127462, 127490, 127504, 127546, 127552, 127560, 127568, 127569, 127744, 128720, 128736, 128748, 128752, 128755, 128768, 128883, 128896, 128980, 129024, 129035, 129040, 129095, 129104, 129113, 129120, 129159, 129168, 129197, 129296, 129304, 129408, 129412, 129472, 129472, 131072, 173782, 173824, 177972, 177984, 178205, 178208, 183969, 194560, 195101, 917760, 917999]);
		isNotPrint32 = new sliceType$4([12, 39, 59, 62, 926, 2057, 2102, 2134, 2291, 2564, 2580, 2584, 4285, 4405, 4576, 4626, 4743, 4745, 4750, 4766, 4868, 4905, 4913, 4916, 9327, 27231, 27482, 27490, 54357, 54429, 54445, 54458, 54460, 54468, 54534, 54549, 54557, 54586, 54591, 54597, 54609, 55968, 60932, 60960, 60963, 60968, 60979, 60984, 60986, 61000, 61002, 61004, 61008, 61011, 61016, 61018, 61020, 61022, 61024, 61027, 61035, 61043, 61048, 61053, 61055, 61066, 61092, 61098, 61632, 61648, 61743, 62842, 62884]);
		isGraphic = new sliceType$4([160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8239, 8287, 12288]);
		shifts = $toNativeArray($kindUint, [0, 0, 1, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/gopherjs/gopherjs/nosync"] = (function() {
	var $pkg = {}, $init, Mutex, Once, ptrType, funcType, ptrType$3;
	Mutex = $pkg.Mutex = $newType(0, $kindStruct, "nosync.Mutex", "Mutex", "github.com/gopherjs/gopherjs/nosync", function(locked_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.locked = false;
			return;
		}
		this.locked = locked_;
	});
	Once = $pkg.Once = $newType(0, $kindStruct, "nosync.Once", "Once", "github.com/gopherjs/gopherjs/nosync", function(doing_, done_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.doing = false;
			this.done = false;
			return;
		}
		this.doing = doing_;
		this.done = done_;
	});
	ptrType = $ptrType(Mutex);
	funcType = $funcType([], [], false);
	ptrType$3 = $ptrType(Once);
	Mutex.ptr.prototype.Lock = function() {
		var $ptr, m;
		m = this;
		if (m.locked) {
			$panic(new $String("nosync: mutex is already locked"));
		}
		m.locked = true;
	};
	Mutex.prototype.Lock = function() { return this.$val.Lock(); };
	Mutex.ptr.prototype.Unlock = function() {
		var $ptr, m;
		m = this;
		if (!m.locked) {
			$panic(new $String("nosync: unlock of unlocked mutex"));
		}
		m.locked = false;
	};
	Mutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	Once.ptr.prototype.Do = function(f) {
		var $ptr, f, o, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; f = $f.f; o = $f.o; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		o = [o];
		o[0] = this;
		if (o[0].done) {
			return;
		}
		if (o[0].doing) {
			$panic(new $String("nosync: Do called within f"));
		}
		o[0].doing = true;
		$deferred.push([(function(o) { return function() {
			var $ptr;
			o[0].doing = false;
			o[0].done = true;
		}; })(o), []]);
		$r = f(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Once.ptr.prototype.Do }; } $f.$ptr = $ptr; $f.f = f; $f.o = o; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	Once.prototype.Do = function(f) { return this.$val.Do(f); };
	ptrType.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	ptrType$3.methods = [{prop: "Do", name: "Do", pkg: "", typ: $funcType([funcType], [], false)}];
	Mutex.init([{prop: "locked", name: "locked", pkg: "github.com/gopherjs/gopherjs/nosync", typ: $Bool, tag: ""}]);
	Once.init([{prop: "doing", name: "doing", pkg: "github.com/gopherjs/gopherjs/nosync", typ: $Bool, tag: ""}, {prop: "done", name: "done", pkg: "github.com/gopherjs/gopherjs/nosync", typ: $Bool, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["internal/race"] = (function() {
	var $pkg = {}, $init, Acquire, Release, ReleaseMerge, Disable, Enable;
	Acquire = function(addr) {
		var $ptr, addr;
	};
	$pkg.Acquire = Acquire;
	Release = function(addr) {
		var $ptr, addr;
	};
	$pkg.Release = Release;
	ReleaseMerge = function(addr) {
		var $ptr, addr;
	};
	$pkg.ReleaseMerge = ReleaseMerge;
	Disable = function() {
		var $ptr;
	};
	$pkg.Disable = Disable;
	Enable = function() {
		var $ptr;
	};
	$pkg.Enable = Enable;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync/atomic"] = (function() {
	var $pkg = {}, $init, js, CompareAndSwapInt32, AddInt32, LoadUint32, StoreUint32;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	CompareAndSwapInt32 = function(addr, old, new$1) {
		var $ptr, addr, new$1, old;
		if (addr.$get() === old) {
			addr.$set(new$1);
			return true;
		}
		return false;
	};
	$pkg.CompareAndSwapInt32 = CompareAndSwapInt32;
	AddInt32 = function(addr, delta) {
		var $ptr, addr, delta, new$1;
		new$1 = addr.$get() + delta >> 0;
		addr.$set(new$1);
		return new$1;
	};
	$pkg.AddInt32 = AddInt32;
	LoadUint32 = function(addr) {
		var $ptr, addr;
		return addr.$get();
	};
	$pkg.LoadUint32 = LoadUint32;
	StoreUint32 = function(addr, val) {
		var $ptr, addr, val;
		addr.$set(val);
	};
	$pkg.StoreUint32 = StoreUint32;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync"] = (function() {
	var $pkg = {}, $init, race, runtime, atomic, Pool, Mutex, Locker, Once, poolLocal, syncSema, RWMutex, rlocker, ptrType, sliceType, ptrType$1, chanType, sliceType$1, ptrType$4, ptrType$6, sliceType$3, ptrType$7, ptrType$8, funcType, ptrType$12, funcType$1, ptrType$13, arrayType$1, semWaiters, allPools, runtime_Syncsemcheck, runtime_registerPoolCleanup, runtime_Semacquire, runtime_Semrelease, runtime_canSpin, poolCleanup, init, indexLocal, init$1, runtime_doSpin;
	race = $packages["internal/race"];
	runtime = $packages["runtime"];
	atomic = $packages["sync/atomic"];
	Pool = $pkg.Pool = $newType(0, $kindStruct, "sync.Pool", "Pool", "sync", function(local_, localSize_, store_, New_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.local = 0;
			this.localSize = 0;
			this.store = sliceType$3.nil;
			this.New = $throwNilPointerError;
			return;
		}
		this.local = local_;
		this.localSize = localSize_;
		this.store = store_;
		this.New = New_;
	});
	Mutex = $pkg.Mutex = $newType(0, $kindStruct, "sync.Mutex", "Mutex", "sync", function(state_, sema_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.state = 0;
			this.sema = 0;
			return;
		}
		this.state = state_;
		this.sema = sema_;
	});
	Locker = $pkg.Locker = $newType(8, $kindInterface, "sync.Locker", "Locker", "sync", null);
	Once = $pkg.Once = $newType(0, $kindStruct, "sync.Once", "Once", "sync", function(m_, done_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.m = new Mutex.ptr(0, 0);
			this.done = 0;
			return;
		}
		this.m = m_;
		this.done = done_;
	});
	poolLocal = $pkg.poolLocal = $newType(0, $kindStruct, "sync.poolLocal", "poolLocal", "sync", function(private$0_, shared_, Mutex_, pad_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.private$0 = $ifaceNil;
			this.shared = sliceType$3.nil;
			this.Mutex = new Mutex.ptr(0, 0);
			this.pad = arrayType$1.zero();
			return;
		}
		this.private$0 = private$0_;
		this.shared = shared_;
		this.Mutex = Mutex_;
		this.pad = pad_;
	});
	syncSema = $pkg.syncSema = $newType(0, $kindStruct, "sync.syncSema", "syncSema", "sync", function(lock_, head_, tail_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.lock = 0;
			this.head = 0;
			this.tail = 0;
			return;
		}
		this.lock = lock_;
		this.head = head_;
		this.tail = tail_;
	});
	RWMutex = $pkg.RWMutex = $newType(0, $kindStruct, "sync.RWMutex", "RWMutex", "sync", function(w_, writerSem_, readerSem_, readerCount_, readerWait_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.w = new Mutex.ptr(0, 0);
			this.writerSem = 0;
			this.readerSem = 0;
			this.readerCount = 0;
			this.readerWait = 0;
			return;
		}
		this.w = w_;
		this.writerSem = writerSem_;
		this.readerSem = readerSem_;
		this.readerCount = readerCount_;
		this.readerWait = readerWait_;
	});
	rlocker = $pkg.rlocker = $newType(0, $kindStruct, "sync.rlocker", "rlocker", "sync", function(w_, writerSem_, readerSem_, readerCount_, readerWait_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.w = new Mutex.ptr(0, 0);
			this.writerSem = 0;
			this.readerSem = 0;
			this.readerCount = 0;
			this.readerWait = 0;
			return;
		}
		this.w = w_;
		this.writerSem = writerSem_;
		this.readerSem = readerSem_;
		this.readerCount = readerCount_;
		this.readerWait = readerWait_;
	});
	ptrType = $ptrType(Pool);
	sliceType = $sliceType(ptrType);
	ptrType$1 = $ptrType($Uint32);
	chanType = $chanType($Bool, false, false);
	sliceType$1 = $sliceType(chanType);
	ptrType$4 = $ptrType($Int32);
	ptrType$6 = $ptrType(poolLocal);
	sliceType$3 = $sliceType($emptyInterface);
	ptrType$7 = $ptrType(rlocker);
	ptrType$8 = $ptrType(RWMutex);
	funcType = $funcType([], [$emptyInterface], false);
	ptrType$12 = $ptrType(Mutex);
	funcType$1 = $funcType([], [], false);
	ptrType$13 = $ptrType(Once);
	arrayType$1 = $arrayType($Uint8, 128);
	runtime_Syncsemcheck = function(size) {
		var $ptr, size;
	};
	Pool.ptr.prototype.Get = function() {
		var $ptr, _r, p, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; p = $f.p; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		/* */ if (p.store.$length === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (p.store.$length === 0) { */ case 1:
			/* */ if (!(p.New === $throwNilPointerError)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(p.New === $throwNilPointerError)) { */ case 3:
				_r = p.New(); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				/* */ $s = 6; case 6:
				return _r;
			/* } */ case 4:
			return $ifaceNil;
		/* } */ case 2:
		x$2 = (x = p.store, x$1 = p.store.$length - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		p.store = $subslice(p.store, 0, (p.store.$length - 1 >> 0));
		return x$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Pool.ptr.prototype.Get }; } $f.$ptr = $ptr; $f._r = _r; $f.p = p; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Pool.prototype.Get = function() { return this.$val.Get(); };
	Pool.ptr.prototype.Put = function(x) {
		var $ptr, p, x;
		p = this;
		if ($interfaceIsEqual(x, $ifaceNil)) {
			return;
		}
		p.store = $append(p.store, x);
	};
	Pool.prototype.Put = function(x) { return this.$val.Put(x); };
	runtime_registerPoolCleanup = function(cleanup) {
		var $ptr, cleanup;
	};
	runtime_Semacquire = function(s) {
		var $ptr, _entry, _key, _r, ch, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _key = $f._key; _r = $f._r; ch = $f.ch; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ if (s.$get() === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (s.$get() === 0) { */ case 1:
			ch = new $Chan($Bool, 0);
			_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: $append((_entry = semWaiters[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : sliceType$1.nil), ch) };
			_r = $recv(ch); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r[0];
		/* } */ case 2:
		s.$set(s.$get() - (1) >>> 0);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: runtime_Semacquire }; } $f.$ptr = $ptr; $f._entry = _entry; $f._key = _key; $f._r = _r; $f.ch = ch; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_Semrelease = function(s) {
		var $ptr, _entry, _key, ch, s, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _key = $f._key; ch = $f.ch; s = $f.s; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s.$set(s.$get() + (1) >>> 0);
		w = (_entry = semWaiters[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : sliceType$1.nil);
		if (w.$length === 0) {
			return;
		}
		ch = (0 >= w.$length ? $throwRuntimeError("index out of range") : w.$array[w.$offset + 0]);
		w = $subslice(w, 1);
		_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: w };
		if (w.$length === 0) {
			delete semWaiters[ptrType$1.keyFor(s)];
		}
		$r = $send(ch, true); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: runtime_Semrelease }; } $f.$ptr = $ptr; $f._entry = _entry; $f._key = _key; $f.ch = ch; $f.s = s; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_canSpin = function(i) {
		var $ptr, i;
		return false;
	};
	Mutex.ptr.prototype.Lock = function() {
		var $ptr, awoke, iter, m, new$1, old, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; awoke = $f.awoke; iter = $f.iter; m = $f.m; new$1 = $f.new$1; old = $f.old; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), 0, 1)) {
			if (false) {
				race.Acquire(m);
			}
			return;
		}
		awoke = false;
		iter = 0;
		/* while (true) { */ case 1:
			old = m.state;
			new$1 = old | 1;
			/* */ if (!(((old & 1) === 0))) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(((old & 1) === 0))) { */ case 3:
				if (runtime_canSpin(iter)) {
					if (!awoke && ((old & 2) === 0) && !(((old >> 2 >> 0) === 0)) && atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, old | 2)) {
						awoke = true;
					}
					runtime_doSpin();
					iter = iter + (1) >> 0;
					/* continue; */ $s = 1; continue;
				}
				new$1 = old + 4 >> 0;
			/* } */ case 4:
			if (awoke) {
				if ((new$1 & 2) === 0) {
					$panic(new $String("sync: inconsistent mutex state"));
				}
				new$1 = (new$1 & ~(2)) >> 0;
			}
			/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 5:
				if ((old & 1) === 0) {
					/* break; */ $s = 2; continue;
				}
				$r = runtime_Semacquire((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m)))); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				awoke = true;
				iter = 0;
			/* } */ case 6:
		/* } */ $s = 1; continue; case 2:
		if (false) {
			race.Acquire(m);
		}
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Lock }; } $f.$ptr = $ptr; $f.awoke = awoke; $f.iter = iter; $f.m = m; $f.new$1 = new$1; $f.old = old; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Lock = function() { return this.$val.Lock(); };
	Mutex.ptr.prototype.Unlock = function() {
		var $ptr, m, new$1, old, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; m = $f.m; new$1 = $f.new$1; old = $f.old; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (false) {
			race.Release(m);
		}
		new$1 = atomic.AddInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), -1);
		if ((((new$1 + 1 >> 0)) & 1) === 0) {
			$panic(new $String("sync: unlock of unlocked mutex"));
		}
		old = new$1;
		/* while (true) { */ case 1:
			if (((old >> 2 >> 0) === 0) || !(((old & 3) === 0))) {
				return;
			}
			new$1 = ((old - 4 >> 0)) | 2;
			/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 3:
				$r = runtime_Semrelease((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m)))); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return;
			/* } */ case 4:
			old = m.state;
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Unlock }; } $f.$ptr = $ptr; $f.m = m; $f.new$1 = new$1; $f.old = old; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	Once.ptr.prototype.Do = function(f) {
		var $ptr, f, o, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; f = $f.f; o = $f.o; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		o = this;
		if (atomic.LoadUint32((o.$ptr_done || (o.$ptr_done = new ptrType$1(function() { return this.$target.done; }, function($v) { this.$target.done = $v; }, o)))) === 1) {
			return;
		}
		$r = o.m.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(o.m, "Unlock"), []]);
		/* */ if (o.done === 0) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (o.done === 0) { */ case 2:
			$deferred.push([atomic.StoreUint32, [(o.$ptr_done || (o.$ptr_done = new ptrType$1(function() { return this.$target.done; }, function($v) { this.$target.done = $v; }, o))), 1]]);
			$r = f(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Once.ptr.prototype.Do }; } $f.$ptr = $ptr; $f.f = f; $f.o = o; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	Once.prototype.Do = function(f) { return this.$val.Do(f); };
	poolCleanup = function() {
		var $ptr, _i, _i$1, _ref, _ref$1, i, i$1, j, l, p, x;
		_ref = allPools;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			p = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= allPools.$length) ? $throwRuntimeError("index out of range") : allPools.$array[allPools.$offset + i] = ptrType.nil);
			i$1 = 0;
			while (true) {
				if (!(i$1 < (p.localSize >> 0))) { break; }
				l = indexLocal(p.local, i$1);
				l.private$0 = $ifaceNil;
				_ref$1 = l.shared;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.$length)) { break; }
					j = _i$1;
					(x = l.shared, ((j < 0 || j >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + j] = $ifaceNil));
					_i$1++;
				}
				l.shared = sliceType$3.nil;
				i$1 = i$1 + (1) >> 0;
			}
			p.local = 0;
			p.localSize = 0;
			_i++;
		}
		allPools = new sliceType([]);
	};
	init = function() {
		var $ptr;
		runtime_registerPoolCleanup(poolCleanup);
	};
	indexLocal = function(l, i) {
		var $ptr, i, l, x;
		return (x = l, (x.nilCheck, ((i < 0 || i >= x.length) ? $throwRuntimeError("index out of range") : x[i])));
	};
	init$1 = function() {
		var $ptr, s;
		s = new syncSema.ptr(0, 0, 0);
		runtime_Syncsemcheck(12);
	};
	runtime_doSpin = function() {
		$throwRuntimeError("native function not implemented: sync.runtime_doSpin");
	};
	RWMutex.ptr.prototype.RLock = function() {
		var $ptr, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.Disable();
		}
		/* */ if (atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$4(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), 1) < 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$4(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), 1) < 0) { */ case 1:
			$r = runtime_Semacquire((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw)))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		if (false) {
			race.Enable();
			race.Acquire((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw))));
		}
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.RLock }; } $f.$ptr = $ptr; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.RLock = function() { return this.$val.RLock(); };
	RWMutex.ptr.prototype.RUnlock = function() {
		var $ptr, r, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.ReleaseMerge((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw))));
			race.Disable();
		}
		r = atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$4(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), -1);
		/* */ if (r < 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (r < 0) { */ case 1:
			if (((r + 1 >> 0) === 0) || ((r + 1 >> 0) === -1073741824)) {
				race.Enable();
				$panic(new $String("sync: RUnlock of unlocked RWMutex"));
			}
			/* */ if (atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$4(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), -1) === 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$4(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), -1) === 0) { */ case 3:
				$r = runtime_Semrelease((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw)))); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 4:
		/* } */ case 2:
		if (false) {
			race.Enable();
		}
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.RUnlock }; } $f.$ptr = $ptr; $f.r = r; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.RUnlock = function() { return this.$val.RUnlock(); };
	RWMutex.ptr.prototype.Lock = function() {
		var $ptr, r, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.Disable();
		}
		$r = rw.w.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		r = atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$4(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), -1073741824) + 1073741824 >> 0;
		/* */ if (!((r === 0)) && !((atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$4(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), r) === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((r === 0)) && !((atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$4(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), r) === 0))) { */ case 2:
			$r = runtime_Semacquire((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw)))); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		if (false) {
			race.Enable();
			race.Acquire((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw))));
			race.Acquire((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw))));
		}
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.Lock }; } $f.$ptr = $ptr; $f.r = r; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.Lock = function() { return this.$val.Lock(); };
	RWMutex.ptr.prototype.Unlock = function() {
		var $ptr, i, r, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; i = $f.i; r = $f.r; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.Release((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw))));
			race.Release((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw))));
			race.Disable();
		}
		r = atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$4(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), 1073741824);
		if (r >= 1073741824) {
			race.Enable();
			$panic(new $String("sync: Unlock of unlocked RWMutex"));
		}
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < (r >> 0))) { break; } */ if(!(i < (r >> 0))) { $s = 2; continue; }
			$r = runtime_Semrelease((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw)))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		$r = rw.w.Unlock(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (false) {
			race.Enable();
		}
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.Unlock }; } $f.$ptr = $ptr; $f.i = i; $f.r = r; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	RWMutex.ptr.prototype.RLocker = function() {
		var $ptr, rw;
		rw = this;
		return $pointerOfStructConversion(rw, ptrType$7);
	};
	RWMutex.prototype.RLocker = function() { return this.$val.RLocker(); };
	rlocker.ptr.prototype.Lock = function() {
		var $ptr, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		$r = $pointerOfStructConversion(r, ptrType$8).RLock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: rlocker.ptr.prototype.Lock }; } $f.$ptr = $ptr; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	rlocker.prototype.Lock = function() { return this.$val.Lock(); };
	rlocker.ptr.prototype.Unlock = function() {
		var $ptr, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		$r = $pointerOfStructConversion(r, ptrType$8).RUnlock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: rlocker.ptr.prototype.Unlock }; } $f.$ptr = $ptr; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	rlocker.prototype.Unlock = function() { return this.$val.Unlock(); };
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Put", name: "Put", pkg: "", typ: $funcType([$emptyInterface], [], false)}, {prop: "getSlow", name: "getSlow", pkg: "sync", typ: $funcType([], [$emptyInterface], false)}, {prop: "pin", name: "pin", pkg: "sync", typ: $funcType([], [ptrType$6], false)}, {prop: "pinSlow", name: "pinSlow", pkg: "sync", typ: $funcType([], [ptrType$6], false)}];
	ptrType$12.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	ptrType$13.methods = [{prop: "Do", name: "Do", pkg: "", typ: $funcType([funcType$1], [], false)}];
	ptrType$8.methods = [{prop: "RLock", name: "RLock", pkg: "", typ: $funcType([], [], false)}, {prop: "RUnlock", name: "RUnlock", pkg: "", typ: $funcType([], [], false)}, {prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}, {prop: "RLocker", name: "RLocker", pkg: "", typ: $funcType([], [Locker], false)}];
	ptrType$7.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	Pool.init([{prop: "local", name: "local", pkg: "sync", typ: $UnsafePointer, tag: ""}, {prop: "localSize", name: "localSize", pkg: "sync", typ: $Uintptr, tag: ""}, {prop: "store", name: "store", pkg: "sync", typ: sliceType$3, tag: ""}, {prop: "New", name: "New", pkg: "", typ: funcType, tag: ""}]);
	Mutex.init([{prop: "state", name: "state", pkg: "sync", typ: $Int32, tag: ""}, {prop: "sema", name: "sema", pkg: "sync", typ: $Uint32, tag: ""}]);
	Locker.init([{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}]);
	Once.init([{prop: "m", name: "m", pkg: "sync", typ: Mutex, tag: ""}, {prop: "done", name: "done", pkg: "sync", typ: $Uint32, tag: ""}]);
	poolLocal.init([{prop: "private$0", name: "private", pkg: "sync", typ: $emptyInterface, tag: ""}, {prop: "shared", name: "shared", pkg: "sync", typ: sliceType$3, tag: ""}, {prop: "Mutex", name: "", pkg: "", typ: Mutex, tag: ""}, {prop: "pad", name: "pad", pkg: "sync", typ: arrayType$1, tag: ""}]);
	syncSema.init([{prop: "lock", name: "lock", pkg: "sync", typ: $Uintptr, tag: ""}, {prop: "head", name: "head", pkg: "sync", typ: $UnsafePointer, tag: ""}, {prop: "tail", name: "tail", pkg: "sync", typ: $UnsafePointer, tag: ""}]);
	RWMutex.init([{prop: "w", name: "w", pkg: "sync", typ: Mutex, tag: ""}, {prop: "writerSem", name: "writerSem", pkg: "sync", typ: $Uint32, tag: ""}, {prop: "readerSem", name: "readerSem", pkg: "sync", typ: $Uint32, tag: ""}, {prop: "readerCount", name: "readerCount", pkg: "sync", typ: $Int32, tag: ""}, {prop: "readerWait", name: "readerWait", pkg: "sync", typ: $Int32, tag: ""}]);
	rlocker.init([{prop: "w", name: "w", pkg: "sync", typ: Mutex, tag: ""}, {prop: "writerSem", name: "writerSem", pkg: "sync", typ: $Uint32, tag: ""}, {prop: "readerSem", name: "readerSem", pkg: "sync", typ: $Uint32, tag: ""}, {prop: "readerCount", name: "readerCount", pkg: "sync", typ: $Int32, tag: ""}, {prop: "readerWait", name: "readerWait", pkg: "sync", typ: $Int32, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = race.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = atomic.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		allPools = sliceType.nil;
		semWaiters = {};
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["io"] = (function() {
	var $pkg = {}, $init, errors, sync, Reader, Writer, RuneReader, sliceType, errWhence, errOffset;
	errors = $packages["errors"];
	sync = $packages["sync"];
	Reader = $pkg.Reader = $newType(8, $kindInterface, "io.Reader", "Reader", "io", null);
	Writer = $pkg.Writer = $newType(8, $kindInterface, "io.Writer", "Writer", "io", null);
	RuneReader = $pkg.RuneReader = $newType(8, $kindInterface, "io.RuneReader", "RuneReader", "io", null);
	sliceType = $sliceType($Uint8);
	Reader.init([{prop: "Read", name: "Read", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}]);
	Writer.init([{prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}]);
	RuneReader.init([{prop: "ReadRune", name: "ReadRune", pkg: "", typ: $funcType([], [$Int32, $Int, $error], false)}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrShortWrite = errors.New("short write");
		$pkg.ErrShortBuffer = errors.New("short buffer");
		$pkg.EOF = errors.New("EOF");
		$pkg.ErrUnexpectedEOF = errors.New("unexpected EOF");
		$pkg.ErrNoProgress = errors.New("multiple Read calls return no data or error");
		errWhence = errors.New("Seek: invalid whence");
		errOffset = errors.New("Seek: invalid offset");
		$pkg.ErrClosedPipe = errors.New("io: read/write on closed pipe");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode"] = (function() {
	var $pkg = {}, $init, RangeTable, Range16, Range32, CaseRange, d, foldPair, arrayType, sliceType, sliceType$1, ptrType, sliceType$2, sliceType$3, sliceType$4, _C, _Cc, _Cf, _Co, _Cs, _L, _Ll, _Lm, _Lo, _Lt, _Lu, _M, _Mc, _Me, _Mn, _N, _Nd, _Nl, _No, _P, _Pc, _Pd, _Pe, _Pf, _Pi, _Po, _Ps, _S, _Sc, _Sk, _Sm, _So, _Z, _Zl, _Zp, _Zs, _Ahom, _Anatolian_Hieroglyphs, _Arabic, _Armenian, _Avestan, _Balinese, _Bamum, _Bassa_Vah, _Batak, _Bengali, _Bopomofo, _Brahmi, _Braille, _Buginese, _Buhid, _Canadian_Aboriginal, _Carian, _Caucasian_Albanian, _Chakma, _Cham, _Cherokee, _Common, _Coptic, _Cuneiform, _Cypriot, _Cyrillic, _Deseret, _Devanagari, _Duployan, _Egyptian_Hieroglyphs, _Elbasan, _Ethiopic, _Georgian, _Glagolitic, _Gothic, _Grantha, _Greek, _Gujarati, _Gurmukhi, _Han, _Hangul, _Hanunoo, _Hatran, _Hebrew, _Hiragana, _Imperial_Aramaic, _Inherited, _Inscriptional_Pahlavi, _Inscriptional_Parthian, _Javanese, _Kaithi, _Kannada, _Katakana, _Kayah_Li, _Kharoshthi, _Khmer, _Khojki, _Khudawadi, _Lao, _Latin, _Lepcha, _Limbu, _Linear_A, _Linear_B, _Lisu, _Lycian, _Lydian, _Mahajani, _Malayalam, _Mandaic, _Manichaean, _Meetei_Mayek, _Mende_Kikakui, _Meroitic_Cursive, _Meroitic_Hieroglyphs, _Miao, _Modi, _Mongolian, _Mro, _Multani, _Myanmar, _Nabataean, _New_Tai_Lue, _Nko, _Ogham, _Ol_Chiki, _Old_Hungarian, _Old_Italic, _Old_North_Arabian, _Old_Permic, _Old_Persian, _Old_South_Arabian, _Old_Turkic, _Oriya, _Osmanya, _Pahawh_Hmong, _Palmyrene, _Pau_Cin_Hau, _Phags_Pa, _Phoenician, _Psalter_Pahlavi, _Rejang, _Runic, _Samaritan, _Saurashtra, _Sharada, _Shavian, _Siddham, _SignWriting, _Sinhala, _Sora_Sompeng, _Sundanese, _Syloti_Nagri, _Syriac, _Tagalog, _Tagbanwa, _Tai_Le, _Tai_Tham, _Tai_Viet, _Takri, _Tamil, _Telugu, _Thaana, _Thai, _Tibetan, _Tifinagh, _Tirhuta, _Ugaritic, _Vai, _Warang_Citi, _Yi, _White_Space, _CaseRanges, properties, caseOrbit, foldCommon, foldGreek, foldInherited, foldL, foldLl, foldLt, foldLu, foldM, foldMn, to, IsDigit, IsPrint, In, IsLetter, IsSpace, is16, is32, Is, isExcludingLatin, To, ToUpper, ToLower, SimpleFold;
	RangeTable = $pkg.RangeTable = $newType(0, $kindStruct, "unicode.RangeTable", "RangeTable", "unicode", function(R16_, R32_, LatinOffset_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.R16 = sliceType.nil;
			this.R32 = sliceType$1.nil;
			this.LatinOffset = 0;
			return;
		}
		this.R16 = R16_;
		this.R32 = R32_;
		this.LatinOffset = LatinOffset_;
	});
	Range16 = $pkg.Range16 = $newType(0, $kindStruct, "unicode.Range16", "Range16", "unicode", function(Lo_, Hi_, Stride_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Lo = 0;
			this.Hi = 0;
			this.Stride = 0;
			return;
		}
		this.Lo = Lo_;
		this.Hi = Hi_;
		this.Stride = Stride_;
	});
	Range32 = $pkg.Range32 = $newType(0, $kindStruct, "unicode.Range32", "Range32", "unicode", function(Lo_, Hi_, Stride_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Lo = 0;
			this.Hi = 0;
			this.Stride = 0;
			return;
		}
		this.Lo = Lo_;
		this.Hi = Hi_;
		this.Stride = Stride_;
	});
	CaseRange = $pkg.CaseRange = $newType(0, $kindStruct, "unicode.CaseRange", "CaseRange", "unicode", function(Lo_, Hi_, Delta_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Lo = 0;
			this.Hi = 0;
			this.Delta = arrayType.zero();
			return;
		}
		this.Lo = Lo_;
		this.Hi = Hi_;
		this.Delta = Delta_;
	});
	d = $pkg.d = $newType(12, $kindArray, "unicode.d", "d", "unicode", null);
	foldPair = $pkg.foldPair = $newType(0, $kindStruct, "unicode.foldPair", "foldPair", "unicode", function(From_, To_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.From = 0;
			this.To = 0;
			return;
		}
		this.From = From_;
		this.To = To_;
	});
	arrayType = $arrayType($Int32, 3);
	sliceType = $sliceType(Range16);
	sliceType$1 = $sliceType(Range32);
	ptrType = $ptrType(RangeTable);
	sliceType$2 = $sliceType(ptrType);
	sliceType$3 = $sliceType(CaseRange);
	sliceType$4 = $sliceType(foldPair);
	to = function(_case, r, caseRange) {
		var $ptr, _case, _q, caseRange, cr, delta, hi, lo, m, r, x;
		if (_case < 0 || 3 <= _case) {
			return 65533;
		}
		lo = 0;
		hi = caseRange.$length;
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			cr = ((m < 0 || m >= caseRange.$length) ? $throwRuntimeError("index out of range") : caseRange.$array[caseRange.$offset + m]);
			if ((cr.Lo >> 0) <= r && r <= (cr.Hi >> 0)) {
				delta = (x = cr.Delta, ((_case < 0 || _case >= x.length) ? $throwRuntimeError("index out of range") : x[_case]));
				if (delta > 1114111) {
					return (cr.Lo >> 0) + ((((((r - (cr.Lo >> 0) >> 0)) & ~1) >> 0) | ((_case & 1) >> 0))) >> 0;
				}
				return r + delta >> 0;
			}
			if (r < (cr.Lo >> 0)) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		return r;
	};
	IsDigit = function(r) {
		var $ptr, r;
		if (r <= 255) {
			return 48 <= r && r <= 57;
		}
		return isExcludingLatin($pkg.Digit, r);
	};
	$pkg.IsDigit = IsDigit;
	IsPrint = function(r) {
		var $ptr, r, x;
		if ((r >>> 0) <= 255) {
			return !(((((x = (r << 24 >>> 24), ((x < 0 || x >= properties.length) ? $throwRuntimeError("index out of range") : properties[x])) & 128) >>> 0) === 0));
		}
		return In(r, $pkg.PrintRanges);
	};
	$pkg.IsPrint = IsPrint;
	In = function(r, ranges) {
		var $ptr, _i, _ref, inside, r, ranges;
		_ref = ranges;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			inside = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (Is(inside, r)) {
				return true;
			}
			_i++;
		}
		return false;
	};
	$pkg.In = In;
	IsLetter = function(r) {
		var $ptr, r, x;
		if ((r >>> 0) <= 255) {
			return !(((((x = (r << 24 >>> 24), ((x < 0 || x >= properties.length) ? $throwRuntimeError("index out of range") : properties[x])) & 96) >>> 0) === 0));
		}
		return isExcludingLatin($pkg.Letter, r);
	};
	$pkg.IsLetter = IsLetter;
	IsSpace = function(r) {
		var $ptr, _1, r;
		if ((r >>> 0) <= 255) {
			_1 = r;
			if ((_1 === (9)) || (_1 === (10)) || (_1 === (11)) || (_1 === (12)) || (_1 === (13)) || (_1 === (32)) || (_1 === (133)) || (_1 === (160))) {
				return true;
			}
			return false;
		}
		return isExcludingLatin($pkg.White_Space, r);
	};
	$pkg.IsSpace = IsSpace;
	is16 = function(ranges, r) {
		var $ptr, _i, _q, _r, _r$1, _ref, hi, i, lo, m, r, range_, range_$1, ranges;
		if (ranges.$length <= 18 || r <= 255) {
			_ref = ranges;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				range_ = ((i < 0 || i >= ranges.$length) ? $throwRuntimeError("index out of range") : ranges.$array[ranges.$offset + i]);
				if (r < range_.Lo) {
					return false;
				}
				if (r <= range_.Hi) {
					return (_r = ((r - range_.Lo << 16 >>> 16)) % range_.Stride, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) === 0;
				}
				_i++;
			}
			return false;
		}
		lo = 0;
		hi = ranges.$length;
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			range_$1 = ((m < 0 || m >= ranges.$length) ? $throwRuntimeError("index out of range") : ranges.$array[ranges.$offset + m]);
			if (range_$1.Lo <= r && r <= range_$1.Hi) {
				return (_r$1 = ((r - range_$1.Lo << 16 >>> 16)) % range_$1.Stride, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0;
			}
			if (r < range_$1.Lo) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		return false;
	};
	is32 = function(ranges, r) {
		var $ptr, _i, _q, _r, _r$1, _ref, hi, i, lo, m, r, range_, range_$1, ranges;
		if (ranges.$length <= 18) {
			_ref = ranges;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				range_ = ((i < 0 || i >= ranges.$length) ? $throwRuntimeError("index out of range") : ranges.$array[ranges.$offset + i]);
				if (r < range_.Lo) {
					return false;
				}
				if (r <= range_.Hi) {
					return (_r = ((r - range_.Lo >>> 0)) % range_.Stride, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) === 0;
				}
				_i++;
			}
			return false;
		}
		lo = 0;
		hi = ranges.$length;
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			range_$1 = $clone(((m < 0 || m >= ranges.$length) ? $throwRuntimeError("index out of range") : ranges.$array[ranges.$offset + m]), Range32);
			if (range_$1.Lo <= r && r <= range_$1.Hi) {
				return (_r$1 = ((r - range_$1.Lo >>> 0)) % range_$1.Stride, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0;
			}
			if (r < range_$1.Lo) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		return false;
	};
	Is = function(rangeTab, r) {
		var $ptr, r, r16, r32, rangeTab, x;
		r16 = rangeTab.R16;
		if (r16.$length > 0 && r <= ((x = r16.$length - 1 >> 0, ((x < 0 || x >= r16.$length) ? $throwRuntimeError("index out of range") : r16.$array[r16.$offset + x])).Hi >> 0)) {
			return is16(r16, (r << 16 >>> 16));
		}
		r32 = rangeTab.R32;
		if (r32.$length > 0 && r >= ((0 >= r32.$length ? $throwRuntimeError("index out of range") : r32.$array[r32.$offset + 0]).Lo >> 0)) {
			return is32(r32, (r >>> 0));
		}
		return false;
	};
	$pkg.Is = Is;
	isExcludingLatin = function(rangeTab, r) {
		var $ptr, off, r, r16, r32, rangeTab, x;
		r16 = rangeTab.R16;
		off = rangeTab.LatinOffset;
		if (r16.$length > off && r <= ((x = r16.$length - 1 >> 0, ((x < 0 || x >= r16.$length) ? $throwRuntimeError("index out of range") : r16.$array[r16.$offset + x])).Hi >> 0)) {
			return is16($subslice(r16, off), (r << 16 >>> 16));
		}
		r32 = rangeTab.R32;
		if (r32.$length > 0 && r >= ((0 >= r32.$length ? $throwRuntimeError("index out of range") : r32.$array[r32.$offset + 0]).Lo >> 0)) {
			return is32(r32, (r >>> 0));
		}
		return false;
	};
	To = function(_case, r) {
		var $ptr, _case, r;
		return to(_case, r, $pkg.CaseRanges);
	};
	$pkg.To = To;
	ToUpper = function(r) {
		var $ptr, r;
		if (r <= 127) {
			if (97 <= r && r <= 122) {
				r = r - (32) >> 0;
			}
			return r;
		}
		return To(0, r);
	};
	$pkg.ToUpper = ToUpper;
	ToLower = function(r) {
		var $ptr, r;
		if (r <= 127) {
			if (65 <= r && r <= 90) {
				r = r + (32) >> 0;
			}
			return r;
		}
		return To(1, r);
	};
	$pkg.ToLower = ToLower;
	SimpleFold = function(r) {
		var $ptr, _q, hi, l, lo, m, r;
		lo = 0;
		hi = caseOrbit.$length;
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			if ((((m < 0 || m >= caseOrbit.$length) ? $throwRuntimeError("index out of range") : caseOrbit.$array[caseOrbit.$offset + m]).From >> 0) < r) {
				lo = m + 1 >> 0;
			} else {
				hi = m;
			}
		}
		if (lo < caseOrbit.$length && ((((lo < 0 || lo >= caseOrbit.$length) ? $throwRuntimeError("index out of range") : caseOrbit.$array[caseOrbit.$offset + lo]).From >> 0) === r)) {
			return (((lo < 0 || lo >= caseOrbit.$length) ? $throwRuntimeError("index out of range") : caseOrbit.$array[caseOrbit.$offset + lo]).To >> 0);
		}
		l = ToLower(r);
		if (!((l === r))) {
			return l;
		}
		return ToUpper(r);
	};
	$pkg.SimpleFold = SimpleFold;
	RangeTable.init([{prop: "R16", name: "R16", pkg: "", typ: sliceType, tag: ""}, {prop: "R32", name: "R32", pkg: "", typ: sliceType$1, tag: ""}, {prop: "LatinOffset", name: "LatinOffset", pkg: "", typ: $Int, tag: ""}]);
	Range16.init([{prop: "Lo", name: "Lo", pkg: "", typ: $Uint16, tag: ""}, {prop: "Hi", name: "Hi", pkg: "", typ: $Uint16, tag: ""}, {prop: "Stride", name: "Stride", pkg: "", typ: $Uint16, tag: ""}]);
	Range32.init([{prop: "Lo", name: "Lo", pkg: "", typ: $Uint32, tag: ""}, {prop: "Hi", name: "Hi", pkg: "", typ: $Uint32, tag: ""}, {prop: "Stride", name: "Stride", pkg: "", typ: $Uint32, tag: ""}]);
	CaseRange.init([{prop: "Lo", name: "Lo", pkg: "", typ: $Uint32, tag: ""}, {prop: "Hi", name: "Hi", pkg: "", typ: $Uint32, tag: ""}, {prop: "Delta", name: "Delta", pkg: "", typ: d, tag: ""}]);
	d.init($Int32, 3);
	foldPair.init([{prop: "From", name: "From", pkg: "", typ: $Uint16, tag: ""}, {prop: "To", name: "To", pkg: "", typ: $Uint16, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_C = new RangeTable.ptr(new sliceType([new Range16.ptr(0, 31, 1), new Range16.ptr(127, 159, 1), new Range16.ptr(173, 1536, 1363), new Range16.ptr(1537, 1541, 1), new Range16.ptr(1564, 1757, 193), new Range16.ptr(1807, 6158, 4351), new Range16.ptr(8203, 8207, 1), new Range16.ptr(8234, 8238, 1), new Range16.ptr(8288, 8292, 1), new Range16.ptr(8294, 8303, 1), new Range16.ptr(55296, 63743, 1), new Range16.ptr(65279, 65529, 250), new Range16.ptr(65530, 65531, 1)]), new sliceType$1([new Range32.ptr(69821, 113824, 44003), new Range32.ptr(113825, 113827, 1), new Range32.ptr(119155, 119162, 1), new Range32.ptr(917505, 917536, 31), new Range32.ptr(917537, 917631, 1), new Range32.ptr(983040, 1048573, 1), new Range32.ptr(1048576, 1114109, 1)]), 2);
		_Cc = new RangeTable.ptr(new sliceType([new Range16.ptr(0, 31, 1), new Range16.ptr(127, 159, 1)]), sliceType$1.nil, 2);
		_Cf = new RangeTable.ptr(new sliceType([new Range16.ptr(173, 1536, 1363), new Range16.ptr(1537, 1541, 1), new Range16.ptr(1564, 1757, 193), new Range16.ptr(1807, 6158, 4351), new Range16.ptr(8203, 8207, 1), new Range16.ptr(8234, 8238, 1), new Range16.ptr(8288, 8292, 1), new Range16.ptr(8294, 8303, 1), new Range16.ptr(65279, 65529, 250), new Range16.ptr(65530, 65531, 1)]), new sliceType$1([new Range32.ptr(69821, 113824, 44003), new Range32.ptr(113825, 113827, 1), new Range32.ptr(119155, 119162, 1), new Range32.ptr(917505, 917536, 31), new Range32.ptr(917537, 917631, 1)]), 0);
		_Co = new RangeTable.ptr(new sliceType([new Range16.ptr(57344, 63743, 1)]), new sliceType$1([new Range32.ptr(983040, 1048573, 1), new Range32.ptr(1048576, 1114109, 1)]), 0);
		_Cs = new RangeTable.ptr(new sliceType([new Range16.ptr(55296, 57343, 1)]), sliceType$1.nil, 0);
		_L = new RangeTable.ptr(new sliceType([new Range16.ptr(65, 90, 1), new Range16.ptr(97, 122, 1), new Range16.ptr(170, 181, 11), new Range16.ptr(186, 192, 6), new Range16.ptr(193, 214, 1), new Range16.ptr(216, 246, 1), new Range16.ptr(248, 705, 1), new Range16.ptr(710, 721, 1), new Range16.ptr(736, 740, 1), new Range16.ptr(748, 750, 2), new Range16.ptr(880, 884, 1), new Range16.ptr(886, 887, 1), new Range16.ptr(890, 893, 1), new Range16.ptr(895, 902, 7), new Range16.ptr(904, 906, 1), new Range16.ptr(908, 910, 2), new Range16.ptr(911, 929, 1), new Range16.ptr(931, 1013, 1), new Range16.ptr(1015, 1153, 1), new Range16.ptr(1162, 1327, 1), new Range16.ptr(1329, 1366, 1), new Range16.ptr(1369, 1377, 8), new Range16.ptr(1378, 1415, 1), new Range16.ptr(1488, 1514, 1), new Range16.ptr(1520, 1522, 1), new Range16.ptr(1568, 1610, 1), new Range16.ptr(1646, 1647, 1), new Range16.ptr(1649, 1747, 1), new Range16.ptr(1749, 1765, 16), new Range16.ptr(1766, 1774, 8), new Range16.ptr(1775, 1786, 11), new Range16.ptr(1787, 1788, 1), new Range16.ptr(1791, 1808, 17), new Range16.ptr(1810, 1839, 1), new Range16.ptr(1869, 1957, 1), new Range16.ptr(1969, 1994, 25), new Range16.ptr(1995, 2026, 1), new Range16.ptr(2036, 2037, 1), new Range16.ptr(2042, 2048, 6), new Range16.ptr(2049, 2069, 1), new Range16.ptr(2074, 2084, 10), new Range16.ptr(2088, 2112, 24), new Range16.ptr(2113, 2136, 1), new Range16.ptr(2208, 2228, 1), new Range16.ptr(2308, 2361, 1), new Range16.ptr(2365, 2384, 19), new Range16.ptr(2392, 2401, 1), new Range16.ptr(2417, 2432, 1), new Range16.ptr(2437, 2444, 1), new Range16.ptr(2447, 2448, 1), new Range16.ptr(2451, 2472, 1), new Range16.ptr(2474, 2480, 1), new Range16.ptr(2482, 2486, 4), new Range16.ptr(2487, 2489, 1), new Range16.ptr(2493, 2510, 17), new Range16.ptr(2524, 2525, 1), new Range16.ptr(2527, 2529, 1), new Range16.ptr(2544, 2545, 1), new Range16.ptr(2565, 2570, 1), new Range16.ptr(2575, 2576, 1), new Range16.ptr(2579, 2600, 1), new Range16.ptr(2602, 2608, 1), new Range16.ptr(2610, 2611, 1), new Range16.ptr(2613, 2614, 1), new Range16.ptr(2616, 2617, 1), new Range16.ptr(2649, 2652, 1), new Range16.ptr(2654, 2674, 20), new Range16.ptr(2675, 2676, 1), new Range16.ptr(2693, 2701, 1), new Range16.ptr(2703, 2705, 1), new Range16.ptr(2707, 2728, 1), new Range16.ptr(2730, 2736, 1), new Range16.ptr(2738, 2739, 1), new Range16.ptr(2741, 2745, 1), new Range16.ptr(2749, 2768, 19), new Range16.ptr(2784, 2785, 1), new Range16.ptr(2809, 2821, 12), new Range16.ptr(2822, 2828, 1), new Range16.ptr(2831, 2832, 1), new Range16.ptr(2835, 2856, 1), new Range16.ptr(2858, 2864, 1), new Range16.ptr(2866, 2867, 1), new Range16.ptr(2869, 2873, 1), new Range16.ptr(2877, 2908, 31), new Range16.ptr(2909, 2911, 2), new Range16.ptr(2912, 2913, 1), new Range16.ptr(2929, 2947, 18), new Range16.ptr(2949, 2954, 1), new Range16.ptr(2958, 2960, 1), new Range16.ptr(2962, 2965, 1), new Range16.ptr(2969, 2970, 1), new Range16.ptr(2972, 2974, 2), new Range16.ptr(2975, 2979, 4), new Range16.ptr(2980, 2984, 4), new Range16.ptr(2985, 2986, 1), new Range16.ptr(2990, 3001, 1), new Range16.ptr(3024, 3077, 53), new Range16.ptr(3078, 3084, 1), new Range16.ptr(3086, 3088, 1), new Range16.ptr(3090, 3112, 1), new Range16.ptr(3114, 3129, 1), new Range16.ptr(3133, 3160, 27), new Range16.ptr(3161, 3162, 1), new Range16.ptr(3168, 3169, 1), new Range16.ptr(3205, 3212, 1), new Range16.ptr(3214, 3216, 1), new Range16.ptr(3218, 3240, 1), new Range16.ptr(3242, 3251, 1), new Range16.ptr(3253, 3257, 1), new Range16.ptr(3261, 3294, 33), new Range16.ptr(3296, 3297, 1), new Range16.ptr(3313, 3314, 1), new Range16.ptr(3333, 3340, 1), new Range16.ptr(3342, 3344, 1), new Range16.ptr(3346, 3386, 1), new Range16.ptr(3389, 3423, 17), new Range16.ptr(3424, 3425, 1), new Range16.ptr(3450, 3455, 1), new Range16.ptr(3461, 3478, 1), new Range16.ptr(3482, 3505, 1), new Range16.ptr(3507, 3515, 1), new Range16.ptr(3517, 3520, 3), new Range16.ptr(3521, 3526, 1), new Range16.ptr(3585, 3632, 1), new Range16.ptr(3634, 3635, 1), new Range16.ptr(3648, 3654, 1), new Range16.ptr(3713, 3714, 1), new Range16.ptr(3716, 3719, 3), new Range16.ptr(3720, 3722, 2), new Range16.ptr(3725, 3732, 7), new Range16.ptr(3733, 3735, 1), new Range16.ptr(3737, 3743, 1), new Range16.ptr(3745, 3747, 1), new Range16.ptr(3749, 3751, 2), new Range16.ptr(3754, 3755, 1), new Range16.ptr(3757, 3760, 1), new Range16.ptr(3762, 3763, 1), new Range16.ptr(3773, 3776, 3), new Range16.ptr(3777, 3780, 1), new Range16.ptr(3782, 3804, 22), new Range16.ptr(3805, 3807, 1), new Range16.ptr(3840, 3904, 64), new Range16.ptr(3905, 3911, 1), new Range16.ptr(3913, 3948, 1), new Range16.ptr(3976, 3980, 1), new Range16.ptr(4096, 4138, 1), new Range16.ptr(4159, 4176, 17), new Range16.ptr(4177, 4181, 1), new Range16.ptr(4186, 4189, 1), new Range16.ptr(4193, 4197, 4), new Range16.ptr(4198, 4206, 8), new Range16.ptr(4207, 4208, 1), new Range16.ptr(4213, 4225, 1), new Range16.ptr(4238, 4256, 18), new Range16.ptr(4257, 4293, 1), new Range16.ptr(4295, 4301, 6), new Range16.ptr(4304, 4346, 1), new Range16.ptr(4348, 4680, 1), new Range16.ptr(4682, 4685, 1), new Range16.ptr(4688, 4694, 1), new Range16.ptr(4696, 4698, 2), new Range16.ptr(4699, 4701, 1), new Range16.ptr(4704, 4744, 1), new Range16.ptr(4746, 4749, 1), new Range16.ptr(4752, 4784, 1), new Range16.ptr(4786, 4789, 1), new Range16.ptr(4792, 4798, 1), new Range16.ptr(4800, 4802, 2), new Range16.ptr(4803, 4805, 1), new Range16.ptr(4808, 4822, 1), new Range16.ptr(4824, 4880, 1), new Range16.ptr(4882, 4885, 1), new Range16.ptr(4888, 4954, 1), new Range16.ptr(4992, 5007, 1), new Range16.ptr(5024, 5109, 1), new Range16.ptr(5112, 5117, 1), new Range16.ptr(5121, 5740, 1), new Range16.ptr(5743, 5759, 1), new Range16.ptr(5761, 5786, 1), new Range16.ptr(5792, 5866, 1), new Range16.ptr(5873, 5880, 1), new Range16.ptr(5888, 5900, 1), new Range16.ptr(5902, 5905, 1), new Range16.ptr(5920, 5937, 1), new Range16.ptr(5952, 5969, 1), new Range16.ptr(5984, 5996, 1), new Range16.ptr(5998, 6000, 1), new Range16.ptr(6016, 6067, 1), new Range16.ptr(6103, 6108, 5), new Range16.ptr(6176, 6263, 1), new Range16.ptr(6272, 6312, 1), new Range16.ptr(6314, 6320, 6), new Range16.ptr(6321, 6389, 1), new Range16.ptr(6400, 6430, 1), new Range16.ptr(6480, 6509, 1), new Range16.ptr(6512, 6516, 1), new Range16.ptr(6528, 6571, 1), new Range16.ptr(6576, 6601, 1), new Range16.ptr(6656, 6678, 1), new Range16.ptr(6688, 6740, 1), new Range16.ptr(6823, 6917, 94), new Range16.ptr(6918, 6963, 1), new Range16.ptr(6981, 6987, 1), new Range16.ptr(7043, 7072, 1), new Range16.ptr(7086, 7087, 1), new Range16.ptr(7098, 7141, 1), new Range16.ptr(7168, 7203, 1), new Range16.ptr(7245, 7247, 1), new Range16.ptr(7258, 7293, 1), new Range16.ptr(7401, 7404, 1), new Range16.ptr(7406, 7409, 1), new Range16.ptr(7413, 7414, 1), new Range16.ptr(7424, 7615, 1), new Range16.ptr(7680, 7957, 1), new Range16.ptr(7960, 7965, 1), new Range16.ptr(7968, 8005, 1), new Range16.ptr(8008, 8013, 1), new Range16.ptr(8016, 8023, 1), new Range16.ptr(8025, 8031, 2), new Range16.ptr(8032, 8061, 1), new Range16.ptr(8064, 8116, 1), new Range16.ptr(8118, 8124, 1), new Range16.ptr(8126, 8130, 4), new Range16.ptr(8131, 8132, 1), new Range16.ptr(8134, 8140, 1), new Range16.ptr(8144, 8147, 1), new Range16.ptr(8150, 8155, 1), new Range16.ptr(8160, 8172, 1), new Range16.ptr(8178, 8180, 1), new Range16.ptr(8182, 8188, 1), new Range16.ptr(8305, 8319, 14), new Range16.ptr(8336, 8348, 1), new Range16.ptr(8450, 8455, 5), new Range16.ptr(8458, 8467, 1), new Range16.ptr(8469, 8473, 4), new Range16.ptr(8474, 8477, 1), new Range16.ptr(8484, 8490, 2), new Range16.ptr(8491, 8493, 1), new Range16.ptr(8495, 8505, 1), new Range16.ptr(8508, 8511, 1), new Range16.ptr(8517, 8521, 1), new Range16.ptr(8526, 8579, 53), new Range16.ptr(8580, 11264, 2684), new Range16.ptr(11265, 11310, 1), new Range16.ptr(11312, 11358, 1), new Range16.ptr(11360, 11492, 1), new Range16.ptr(11499, 11502, 1), new Range16.ptr(11506, 11507, 1), new Range16.ptr(11520, 11557, 1), new Range16.ptr(11559, 11565, 6), new Range16.ptr(11568, 11623, 1), new Range16.ptr(11631, 11648, 17), new Range16.ptr(11649, 11670, 1), new Range16.ptr(11680, 11686, 1), new Range16.ptr(11688, 11694, 1), new Range16.ptr(11696, 11702, 1), new Range16.ptr(11704, 11710, 1), new Range16.ptr(11712, 11718, 1), new Range16.ptr(11720, 11726, 1), new Range16.ptr(11728, 11734, 1), new Range16.ptr(11736, 11742, 1), new Range16.ptr(11823, 12293, 470), new Range16.ptr(12294, 12337, 43), new Range16.ptr(12338, 12341, 1), new Range16.ptr(12347, 12348, 1), new Range16.ptr(12353, 12438, 1), new Range16.ptr(12445, 12447, 1), new Range16.ptr(12449, 12538, 1), new Range16.ptr(12540, 12543, 1), new Range16.ptr(12549, 12589, 1), new Range16.ptr(12593, 12686, 1), new Range16.ptr(12704, 12730, 1), new Range16.ptr(12784, 12799, 1), new Range16.ptr(13312, 19893, 1), new Range16.ptr(19968, 40917, 1), new Range16.ptr(40960, 42124, 1), new Range16.ptr(42192, 42237, 1), new Range16.ptr(42240, 42508, 1), new Range16.ptr(42512, 42527, 1), new Range16.ptr(42538, 42539, 1), new Range16.ptr(42560, 42606, 1), new Range16.ptr(42623, 42653, 1), new Range16.ptr(42656, 42725, 1), new Range16.ptr(42775, 42783, 1), new Range16.ptr(42786, 42888, 1), new Range16.ptr(42891, 42925, 1), new Range16.ptr(42928, 42935, 1), new Range16.ptr(42999, 43009, 1), new Range16.ptr(43011, 43013, 1), new Range16.ptr(43015, 43018, 1), new Range16.ptr(43020, 43042, 1), new Range16.ptr(43072, 43123, 1), new Range16.ptr(43138, 43187, 1), new Range16.ptr(43250, 43255, 1), new Range16.ptr(43259, 43261, 2), new Range16.ptr(43274, 43301, 1), new Range16.ptr(43312, 43334, 1), new Range16.ptr(43360, 43388, 1), new Range16.ptr(43396, 43442, 1), new Range16.ptr(43471, 43488, 17), new Range16.ptr(43489, 43492, 1), new Range16.ptr(43494, 43503, 1), new Range16.ptr(43514, 43518, 1), new Range16.ptr(43520, 43560, 1), new Range16.ptr(43584, 43586, 1), new Range16.ptr(43588, 43595, 1), new Range16.ptr(43616, 43638, 1), new Range16.ptr(43642, 43646, 4), new Range16.ptr(43647, 43695, 1), new Range16.ptr(43697, 43701, 4), new Range16.ptr(43702, 43705, 3), new Range16.ptr(43706, 43709, 1), new Range16.ptr(43712, 43714, 2), new Range16.ptr(43739, 43741, 1), new Range16.ptr(43744, 43754, 1), new Range16.ptr(43762, 43764, 1), new Range16.ptr(43777, 43782, 1), new Range16.ptr(43785, 43790, 1), new Range16.ptr(43793, 43798, 1), new Range16.ptr(43808, 43814, 1), new Range16.ptr(43816, 43822, 1), new Range16.ptr(43824, 43866, 1), new Range16.ptr(43868, 43877, 1), new Range16.ptr(43888, 44002, 1), new Range16.ptr(44032, 55203, 1), new Range16.ptr(55216, 55238, 1), new Range16.ptr(55243, 55291, 1), new Range16.ptr(63744, 64109, 1), new Range16.ptr(64112, 64217, 1), new Range16.ptr(64256, 64262, 1), new Range16.ptr(64275, 64279, 1), new Range16.ptr(64285, 64287, 2), new Range16.ptr(64288, 64296, 1), new Range16.ptr(64298, 64310, 1), new Range16.ptr(64312, 64316, 1), new Range16.ptr(64318, 64320, 2), new Range16.ptr(64321, 64323, 2), new Range16.ptr(64324, 64326, 2), new Range16.ptr(64327, 64433, 1), new Range16.ptr(64467, 64829, 1), new Range16.ptr(64848, 64911, 1), new Range16.ptr(64914, 64967, 1), new Range16.ptr(65008, 65019, 1), new Range16.ptr(65136, 65140, 1), new Range16.ptr(65142, 65276, 1), new Range16.ptr(65313, 65338, 1), new Range16.ptr(65345, 65370, 1), new Range16.ptr(65382, 65470, 1), new Range16.ptr(65474, 65479, 1), new Range16.ptr(65482, 65487, 1), new Range16.ptr(65490, 65495, 1), new Range16.ptr(65498, 65500, 1)]), new sliceType$1([new Range32.ptr(65536, 65547, 1), new Range32.ptr(65549, 65574, 1), new Range32.ptr(65576, 65594, 1), new Range32.ptr(65596, 65597, 1), new Range32.ptr(65599, 65613, 1), new Range32.ptr(65616, 65629, 1), new Range32.ptr(65664, 65786, 1), new Range32.ptr(66176, 66204, 1), new Range32.ptr(66208, 66256, 1), new Range32.ptr(66304, 66335, 1), new Range32.ptr(66352, 66368, 1), new Range32.ptr(66370, 66377, 1), new Range32.ptr(66384, 66421, 1), new Range32.ptr(66432, 66461, 1), new Range32.ptr(66464, 66499, 1), new Range32.ptr(66504, 66511, 1), new Range32.ptr(66560, 66717, 1), new Range32.ptr(66816, 66855, 1), new Range32.ptr(66864, 66915, 1), new Range32.ptr(67072, 67382, 1), new Range32.ptr(67392, 67413, 1), new Range32.ptr(67424, 67431, 1), new Range32.ptr(67584, 67589, 1), new Range32.ptr(67592, 67594, 2), new Range32.ptr(67595, 67637, 1), new Range32.ptr(67639, 67640, 1), new Range32.ptr(67644, 67647, 3), new Range32.ptr(67648, 67669, 1), new Range32.ptr(67680, 67702, 1), new Range32.ptr(67712, 67742, 1), new Range32.ptr(67808, 67826, 1), new Range32.ptr(67828, 67829, 1), new Range32.ptr(67840, 67861, 1), new Range32.ptr(67872, 67897, 1), new Range32.ptr(67968, 68023, 1), new Range32.ptr(68030, 68031, 1), new Range32.ptr(68096, 68112, 16), new Range32.ptr(68113, 68115, 1), new Range32.ptr(68117, 68119, 1), new Range32.ptr(68121, 68147, 1), new Range32.ptr(68192, 68220, 1), new Range32.ptr(68224, 68252, 1), new Range32.ptr(68288, 68295, 1), new Range32.ptr(68297, 68324, 1), new Range32.ptr(68352, 68405, 1), new Range32.ptr(68416, 68437, 1), new Range32.ptr(68448, 68466, 1), new Range32.ptr(68480, 68497, 1), new Range32.ptr(68608, 68680, 1), new Range32.ptr(68736, 68786, 1), new Range32.ptr(68800, 68850, 1), new Range32.ptr(69635, 69687, 1), new Range32.ptr(69763, 69807, 1), new Range32.ptr(69840, 69864, 1), new Range32.ptr(69891, 69926, 1), new Range32.ptr(69968, 70002, 1), new Range32.ptr(70006, 70019, 13), new Range32.ptr(70020, 70066, 1), new Range32.ptr(70081, 70084, 1), new Range32.ptr(70106, 70108, 2), new Range32.ptr(70144, 70161, 1), new Range32.ptr(70163, 70187, 1), new Range32.ptr(70272, 70278, 1), new Range32.ptr(70280, 70282, 2), new Range32.ptr(70283, 70285, 1), new Range32.ptr(70287, 70301, 1), new Range32.ptr(70303, 70312, 1), new Range32.ptr(70320, 70366, 1), new Range32.ptr(70405, 70412, 1), new Range32.ptr(70415, 70416, 1), new Range32.ptr(70419, 70440, 1), new Range32.ptr(70442, 70448, 1), new Range32.ptr(70450, 70451, 1), new Range32.ptr(70453, 70457, 1), new Range32.ptr(70461, 70480, 19), new Range32.ptr(70493, 70497, 1), new Range32.ptr(70784, 70831, 1), new Range32.ptr(70852, 70853, 1), new Range32.ptr(70855, 71040, 185), new Range32.ptr(71041, 71086, 1), new Range32.ptr(71128, 71131, 1), new Range32.ptr(71168, 71215, 1), new Range32.ptr(71236, 71296, 60), new Range32.ptr(71297, 71338, 1), new Range32.ptr(71424, 71449, 1), new Range32.ptr(71840, 71903, 1), new Range32.ptr(71935, 72384, 449), new Range32.ptr(72385, 72440, 1), new Range32.ptr(73728, 74649, 1), new Range32.ptr(74880, 75075, 1), new Range32.ptr(77824, 78894, 1), new Range32.ptr(82944, 83526, 1), new Range32.ptr(92160, 92728, 1), new Range32.ptr(92736, 92766, 1), new Range32.ptr(92880, 92909, 1), new Range32.ptr(92928, 92975, 1), new Range32.ptr(92992, 92995, 1), new Range32.ptr(93027, 93047, 1), new Range32.ptr(93053, 93071, 1), new Range32.ptr(93952, 94020, 1), new Range32.ptr(94032, 94099, 67), new Range32.ptr(94100, 94111, 1), new Range32.ptr(110592, 110593, 1), new Range32.ptr(113664, 113770, 1), new Range32.ptr(113776, 113788, 1), new Range32.ptr(113792, 113800, 1), new Range32.ptr(113808, 113817, 1), new Range32.ptr(119808, 119892, 1), new Range32.ptr(119894, 119964, 1), new Range32.ptr(119966, 119967, 1), new Range32.ptr(119970, 119973, 3), new Range32.ptr(119974, 119977, 3), new Range32.ptr(119978, 119980, 1), new Range32.ptr(119982, 119993, 1), new Range32.ptr(119995, 119997, 2), new Range32.ptr(119998, 120003, 1), new Range32.ptr(120005, 120069, 1), new Range32.ptr(120071, 120074, 1), new Range32.ptr(120077, 120084, 1), new Range32.ptr(120086, 120092, 1), new Range32.ptr(120094, 120121, 1), new Range32.ptr(120123, 120126, 1), new Range32.ptr(120128, 120132, 1), new Range32.ptr(120134, 120138, 4), new Range32.ptr(120139, 120144, 1), new Range32.ptr(120146, 120485, 1), new Range32.ptr(120488, 120512, 1), new Range32.ptr(120514, 120538, 1), new Range32.ptr(120540, 120570, 1), new Range32.ptr(120572, 120596, 1), new Range32.ptr(120598, 120628, 1), new Range32.ptr(120630, 120654, 1), new Range32.ptr(120656, 120686, 1), new Range32.ptr(120688, 120712, 1), new Range32.ptr(120714, 120744, 1), new Range32.ptr(120746, 120770, 1), new Range32.ptr(120772, 120779, 1), new Range32.ptr(124928, 125124, 1), new Range32.ptr(126464, 126467, 1), new Range32.ptr(126469, 126495, 1), new Range32.ptr(126497, 126498, 1), new Range32.ptr(126500, 126503, 3), new Range32.ptr(126505, 126514, 1), new Range32.ptr(126516, 126519, 1), new Range32.ptr(126521, 126523, 2), new Range32.ptr(126530, 126535, 5), new Range32.ptr(126537, 126541, 2), new Range32.ptr(126542, 126543, 1), new Range32.ptr(126545, 126546, 1), new Range32.ptr(126548, 126551, 3), new Range32.ptr(126553, 126561, 2), new Range32.ptr(126562, 126564, 2), new Range32.ptr(126567, 126570, 1), new Range32.ptr(126572, 126578, 1), new Range32.ptr(126580, 126583, 1), new Range32.ptr(126585, 126588, 1), new Range32.ptr(126590, 126592, 2), new Range32.ptr(126593, 126601, 1), new Range32.ptr(126603, 126619, 1), new Range32.ptr(126625, 126627, 1), new Range32.ptr(126629, 126633, 1), new Range32.ptr(126635, 126651, 1), new Range32.ptr(131072, 173782, 1), new Range32.ptr(173824, 177972, 1), new Range32.ptr(177984, 178205, 1), new Range32.ptr(178208, 183969, 1), new Range32.ptr(194560, 195101, 1)]), 6);
		_Ll = new RangeTable.ptr(new sliceType([new Range16.ptr(97, 122, 1), new Range16.ptr(181, 223, 42), new Range16.ptr(224, 246, 1), new Range16.ptr(248, 255, 1), new Range16.ptr(257, 311, 2), new Range16.ptr(312, 328, 2), new Range16.ptr(329, 375, 2), new Range16.ptr(378, 382, 2), new Range16.ptr(383, 384, 1), new Range16.ptr(387, 389, 2), new Range16.ptr(392, 396, 4), new Range16.ptr(397, 402, 5), new Range16.ptr(405, 409, 4), new Range16.ptr(410, 411, 1), new Range16.ptr(414, 417, 3), new Range16.ptr(419, 421, 2), new Range16.ptr(424, 426, 2), new Range16.ptr(427, 429, 2), new Range16.ptr(432, 436, 4), new Range16.ptr(438, 441, 3), new Range16.ptr(442, 445, 3), new Range16.ptr(446, 447, 1), new Range16.ptr(454, 460, 3), new Range16.ptr(462, 476, 2), new Range16.ptr(477, 495, 2), new Range16.ptr(496, 499, 3), new Range16.ptr(501, 505, 4), new Range16.ptr(507, 563, 2), new Range16.ptr(564, 569, 1), new Range16.ptr(572, 575, 3), new Range16.ptr(576, 578, 2), new Range16.ptr(583, 591, 2), new Range16.ptr(592, 659, 1), new Range16.ptr(661, 687, 1), new Range16.ptr(881, 883, 2), new Range16.ptr(887, 891, 4), new Range16.ptr(892, 893, 1), new Range16.ptr(912, 940, 28), new Range16.ptr(941, 974, 1), new Range16.ptr(976, 977, 1), new Range16.ptr(981, 983, 1), new Range16.ptr(985, 1007, 2), new Range16.ptr(1008, 1011, 1), new Range16.ptr(1013, 1019, 3), new Range16.ptr(1020, 1072, 52), new Range16.ptr(1073, 1119, 1), new Range16.ptr(1121, 1153, 2), new Range16.ptr(1163, 1215, 2), new Range16.ptr(1218, 1230, 2), new Range16.ptr(1231, 1327, 2), new Range16.ptr(1377, 1415, 1), new Range16.ptr(5112, 5117, 1), new Range16.ptr(7424, 7467, 1), new Range16.ptr(7531, 7543, 1), new Range16.ptr(7545, 7578, 1), new Range16.ptr(7681, 7829, 2), new Range16.ptr(7830, 7837, 1), new Range16.ptr(7839, 7935, 2), new Range16.ptr(7936, 7943, 1), new Range16.ptr(7952, 7957, 1), new Range16.ptr(7968, 7975, 1), new Range16.ptr(7984, 7991, 1), new Range16.ptr(8000, 8005, 1), new Range16.ptr(8016, 8023, 1), new Range16.ptr(8032, 8039, 1), new Range16.ptr(8048, 8061, 1), new Range16.ptr(8064, 8071, 1), new Range16.ptr(8080, 8087, 1), new Range16.ptr(8096, 8103, 1), new Range16.ptr(8112, 8116, 1), new Range16.ptr(8118, 8119, 1), new Range16.ptr(8126, 8130, 4), new Range16.ptr(8131, 8132, 1), new Range16.ptr(8134, 8135, 1), new Range16.ptr(8144, 8147, 1), new Range16.ptr(8150, 8151, 1), new Range16.ptr(8160, 8167, 1), new Range16.ptr(8178, 8180, 1), new Range16.ptr(8182, 8183, 1), new Range16.ptr(8458, 8462, 4), new Range16.ptr(8463, 8467, 4), new Range16.ptr(8495, 8505, 5), new Range16.ptr(8508, 8509, 1), new Range16.ptr(8518, 8521, 1), new Range16.ptr(8526, 8580, 54), new Range16.ptr(11312, 11358, 1), new Range16.ptr(11361, 11365, 4), new Range16.ptr(11366, 11372, 2), new Range16.ptr(11377, 11379, 2), new Range16.ptr(11380, 11382, 2), new Range16.ptr(11383, 11387, 1), new Range16.ptr(11393, 11491, 2), new Range16.ptr(11492, 11500, 8), new Range16.ptr(11502, 11507, 5), new Range16.ptr(11520, 11557, 1), new Range16.ptr(11559, 11565, 6), new Range16.ptr(42561, 42605, 2), new Range16.ptr(42625, 42651, 2), new Range16.ptr(42787, 42799, 2), new Range16.ptr(42800, 42801, 1), new Range16.ptr(42803, 42865, 2), new Range16.ptr(42866, 42872, 1), new Range16.ptr(42874, 42876, 2), new Range16.ptr(42879, 42887, 2), new Range16.ptr(42892, 42894, 2), new Range16.ptr(42897, 42899, 2), new Range16.ptr(42900, 42901, 1), new Range16.ptr(42903, 42921, 2), new Range16.ptr(42933, 42935, 2), new Range16.ptr(43002, 43824, 822), new Range16.ptr(43825, 43866, 1), new Range16.ptr(43872, 43877, 1), new Range16.ptr(43888, 43967, 1), new Range16.ptr(64256, 64262, 1), new Range16.ptr(64275, 64279, 1), new Range16.ptr(65345, 65370, 1)]), new sliceType$1([new Range32.ptr(66600, 66639, 1), new Range32.ptr(68800, 68850, 1), new Range32.ptr(71872, 71903, 1), new Range32.ptr(119834, 119859, 1), new Range32.ptr(119886, 119892, 1), new Range32.ptr(119894, 119911, 1), new Range32.ptr(119938, 119963, 1), new Range32.ptr(119990, 119993, 1), new Range32.ptr(119995, 119997, 2), new Range32.ptr(119998, 120003, 1), new Range32.ptr(120005, 120015, 1), new Range32.ptr(120042, 120067, 1), new Range32.ptr(120094, 120119, 1), new Range32.ptr(120146, 120171, 1), new Range32.ptr(120198, 120223, 1), new Range32.ptr(120250, 120275, 1), new Range32.ptr(120302, 120327, 1), new Range32.ptr(120354, 120379, 1), new Range32.ptr(120406, 120431, 1), new Range32.ptr(120458, 120485, 1), new Range32.ptr(120514, 120538, 1), new Range32.ptr(120540, 120545, 1), new Range32.ptr(120572, 120596, 1), new Range32.ptr(120598, 120603, 1), new Range32.ptr(120630, 120654, 1), new Range32.ptr(120656, 120661, 1), new Range32.ptr(120688, 120712, 1), new Range32.ptr(120714, 120719, 1), new Range32.ptr(120746, 120770, 1), new Range32.ptr(120772, 120777, 1), new Range32.ptr(120779, 120779, 1)]), 4);
		_Lm = new RangeTable.ptr(new sliceType([new Range16.ptr(688, 705, 1), new Range16.ptr(710, 721, 1), new Range16.ptr(736, 740, 1), new Range16.ptr(748, 750, 2), new Range16.ptr(884, 890, 6), new Range16.ptr(1369, 1600, 231), new Range16.ptr(1765, 1766, 1), new Range16.ptr(2036, 2037, 1), new Range16.ptr(2042, 2074, 32), new Range16.ptr(2084, 2088, 4), new Range16.ptr(2417, 3654, 1237), new Range16.ptr(3782, 4348, 566), new Range16.ptr(6103, 6211, 108), new Range16.ptr(6823, 7288, 465), new Range16.ptr(7289, 7293, 1), new Range16.ptr(7468, 7530, 1), new Range16.ptr(7544, 7579, 35), new Range16.ptr(7580, 7615, 1), new Range16.ptr(8305, 8319, 14), new Range16.ptr(8336, 8348, 1), new Range16.ptr(11388, 11389, 1), new Range16.ptr(11631, 11823, 192), new Range16.ptr(12293, 12337, 44), new Range16.ptr(12338, 12341, 1), new Range16.ptr(12347, 12445, 98), new Range16.ptr(12446, 12540, 94), new Range16.ptr(12541, 12542, 1), new Range16.ptr(40981, 42232, 1251), new Range16.ptr(42233, 42237, 1), new Range16.ptr(42508, 42623, 115), new Range16.ptr(42652, 42653, 1), new Range16.ptr(42775, 42783, 1), new Range16.ptr(42864, 42888, 24), new Range16.ptr(43000, 43001, 1), new Range16.ptr(43471, 43494, 23), new Range16.ptr(43632, 43741, 109), new Range16.ptr(43763, 43764, 1), new Range16.ptr(43868, 43871, 1), new Range16.ptr(65392, 65438, 46), new Range16.ptr(65439, 65439, 1)]), new sliceType$1([new Range32.ptr(92992, 92992, 1), new Range32.ptr(92993, 92995, 1), new Range32.ptr(94099, 94111, 1)]), 0);
		_Lo = new RangeTable.ptr(new sliceType([new Range16.ptr(170, 186, 16), new Range16.ptr(443, 448, 5), new Range16.ptr(449, 451, 1), new Range16.ptr(660, 1488, 828), new Range16.ptr(1489, 1514, 1), new Range16.ptr(1520, 1522, 1), new Range16.ptr(1568, 1599, 1), new Range16.ptr(1601, 1610, 1), new Range16.ptr(1646, 1647, 1), new Range16.ptr(1649, 1747, 1), new Range16.ptr(1749, 1774, 25), new Range16.ptr(1775, 1786, 11), new Range16.ptr(1787, 1788, 1), new Range16.ptr(1791, 1808, 17), new Range16.ptr(1810, 1839, 1), new Range16.ptr(1869, 1957, 1), new Range16.ptr(1969, 1994, 25), new Range16.ptr(1995, 2026, 1), new Range16.ptr(2048, 2069, 1), new Range16.ptr(2112, 2136, 1), new Range16.ptr(2208, 2228, 1), new Range16.ptr(2308, 2361, 1), new Range16.ptr(2365, 2384, 19), new Range16.ptr(2392, 2401, 1), new Range16.ptr(2418, 2432, 1), new Range16.ptr(2437, 2444, 1), new Range16.ptr(2447, 2448, 1), new Range16.ptr(2451, 2472, 1), new Range16.ptr(2474, 2480, 1), new Range16.ptr(2482, 2486, 4), new Range16.ptr(2487, 2489, 1), new Range16.ptr(2493, 2510, 17), new Range16.ptr(2524, 2525, 1), new Range16.ptr(2527, 2529, 1), new Range16.ptr(2544, 2545, 1), new Range16.ptr(2565, 2570, 1), new Range16.ptr(2575, 2576, 1), new Range16.ptr(2579, 2600, 1), new Range16.ptr(2602, 2608, 1), new Range16.ptr(2610, 2611, 1), new Range16.ptr(2613, 2614, 1), new Range16.ptr(2616, 2617, 1), new Range16.ptr(2649, 2652, 1), new Range16.ptr(2654, 2674, 20), new Range16.ptr(2675, 2676, 1), new Range16.ptr(2693, 2701, 1), new Range16.ptr(2703, 2705, 1), new Range16.ptr(2707, 2728, 1), new Range16.ptr(2730, 2736, 1), new Range16.ptr(2738, 2739, 1), new Range16.ptr(2741, 2745, 1), new Range16.ptr(2749, 2768, 19), new Range16.ptr(2784, 2785, 1), new Range16.ptr(2809, 2821, 12), new Range16.ptr(2822, 2828, 1), new Range16.ptr(2831, 2832, 1), new Range16.ptr(2835, 2856, 1), new Range16.ptr(2858, 2864, 1), new Range16.ptr(2866, 2867, 1), new Range16.ptr(2869, 2873, 1), new Range16.ptr(2877, 2908, 31), new Range16.ptr(2909, 2911, 2), new Range16.ptr(2912, 2913, 1), new Range16.ptr(2929, 2947, 18), new Range16.ptr(2949, 2954, 1), new Range16.ptr(2958, 2960, 1), new Range16.ptr(2962, 2965, 1), new Range16.ptr(2969, 2970, 1), new Range16.ptr(2972, 2974, 2), new Range16.ptr(2975, 2979, 4), new Range16.ptr(2980, 2984, 4), new Range16.ptr(2985, 2986, 1), new Range16.ptr(2990, 3001, 1), new Range16.ptr(3024, 3077, 53), new Range16.ptr(3078, 3084, 1), new Range16.ptr(3086, 3088, 1), new Range16.ptr(3090, 3112, 1), new Range16.ptr(3114, 3129, 1), new Range16.ptr(3133, 3160, 27), new Range16.ptr(3161, 3162, 1), new Range16.ptr(3168, 3169, 1), new Range16.ptr(3205, 3212, 1), new Range16.ptr(3214, 3216, 1), new Range16.ptr(3218, 3240, 1), new Range16.ptr(3242, 3251, 1), new Range16.ptr(3253, 3257, 1), new Range16.ptr(3261, 3294, 33), new Range16.ptr(3296, 3297, 1), new Range16.ptr(3313, 3314, 1), new Range16.ptr(3333, 3340, 1), new Range16.ptr(3342, 3344, 1), new Range16.ptr(3346, 3386, 1), new Range16.ptr(3389, 3423, 17), new Range16.ptr(3424, 3425, 1), new Range16.ptr(3450, 3455, 1), new Range16.ptr(3461, 3478, 1), new Range16.ptr(3482, 3505, 1), new Range16.ptr(3507, 3515, 1), new Range16.ptr(3517, 3520, 3), new Range16.ptr(3521, 3526, 1), new Range16.ptr(3585, 3632, 1), new Range16.ptr(3634, 3635, 1), new Range16.ptr(3648, 3653, 1), new Range16.ptr(3713, 3714, 1), new Range16.ptr(3716, 3719, 3), new Range16.ptr(3720, 3722, 2), new Range16.ptr(3725, 3732, 7), new Range16.ptr(3733, 3735, 1), new Range16.ptr(3737, 3743, 1), new Range16.ptr(3745, 3747, 1), new Range16.ptr(3749, 3751, 2), new Range16.ptr(3754, 3755, 1), new Range16.ptr(3757, 3760, 1), new Range16.ptr(3762, 3763, 1), new Range16.ptr(3773, 3776, 3), new Range16.ptr(3777, 3780, 1), new Range16.ptr(3804, 3807, 1), new Range16.ptr(3840, 3904, 64), new Range16.ptr(3905, 3911, 1), new Range16.ptr(3913, 3948, 1), new Range16.ptr(3976, 3980, 1), new Range16.ptr(4096, 4138, 1), new Range16.ptr(4159, 4176, 17), new Range16.ptr(4177, 4181, 1), new Range16.ptr(4186, 4189, 1), new Range16.ptr(4193, 4197, 4), new Range16.ptr(4198, 4206, 8), new Range16.ptr(4207, 4208, 1), new Range16.ptr(4213, 4225, 1), new Range16.ptr(4238, 4304, 66), new Range16.ptr(4305, 4346, 1), new Range16.ptr(4349, 4680, 1), new Range16.ptr(4682, 4685, 1), new Range16.ptr(4688, 4694, 1), new Range16.ptr(4696, 4698, 2), new Range16.ptr(4699, 4701, 1), new Range16.ptr(4704, 4744, 1), new Range16.ptr(4746, 4749, 1), new Range16.ptr(4752, 4784, 1), new Range16.ptr(4786, 4789, 1), new Range16.ptr(4792, 4798, 1), new Range16.ptr(4800, 4802, 2), new Range16.ptr(4803, 4805, 1), new Range16.ptr(4808, 4822, 1), new Range16.ptr(4824, 4880, 1), new Range16.ptr(4882, 4885, 1), new Range16.ptr(4888, 4954, 1), new Range16.ptr(4992, 5007, 1), new Range16.ptr(5121, 5740, 1), new Range16.ptr(5743, 5759, 1), new Range16.ptr(5761, 5786, 1), new Range16.ptr(5792, 5866, 1), new Range16.ptr(5873, 5880, 1), new Range16.ptr(5888, 5900, 1), new Range16.ptr(5902, 5905, 1), new Range16.ptr(5920, 5937, 1), new Range16.ptr(5952, 5969, 1), new Range16.ptr(5984, 5996, 1), new Range16.ptr(5998, 6000, 1), new Range16.ptr(6016, 6067, 1), new Range16.ptr(6108, 6176, 68), new Range16.ptr(6177, 6210, 1), new Range16.ptr(6212, 6263, 1), new Range16.ptr(6272, 6312, 1), new Range16.ptr(6314, 6320, 6), new Range16.ptr(6321, 6389, 1), new Range16.ptr(6400, 6430, 1), new Range16.ptr(6480, 6509, 1), new Range16.ptr(6512, 6516, 1), new Range16.ptr(6528, 6571, 1), new Range16.ptr(6576, 6601, 1), new Range16.ptr(6656, 6678, 1), new Range16.ptr(6688, 6740, 1), new Range16.ptr(6917, 6963, 1), new Range16.ptr(6981, 6987, 1), new Range16.ptr(7043, 7072, 1), new Range16.ptr(7086, 7087, 1), new Range16.ptr(7098, 7141, 1), new Range16.ptr(7168, 7203, 1), new Range16.ptr(7245, 7247, 1), new Range16.ptr(7258, 7287, 1), new Range16.ptr(7401, 7404, 1), new Range16.ptr(7406, 7409, 1), new Range16.ptr(7413, 7414, 1), new Range16.ptr(8501, 8504, 1), new Range16.ptr(11568, 11623, 1), new Range16.ptr(11648, 11670, 1), new Range16.ptr(11680, 11686, 1), new Range16.ptr(11688, 11694, 1), new Range16.ptr(11696, 11702, 1), new Range16.ptr(11704, 11710, 1), new Range16.ptr(11712, 11718, 1), new Range16.ptr(11720, 11726, 1), new Range16.ptr(11728, 11734, 1), new Range16.ptr(11736, 11742, 1), new Range16.ptr(12294, 12348, 54), new Range16.ptr(12353, 12438, 1), new Range16.ptr(12447, 12449, 2), new Range16.ptr(12450, 12538, 1), new Range16.ptr(12543, 12549, 6), new Range16.ptr(12550, 12589, 1), new Range16.ptr(12593, 12686, 1), new Range16.ptr(12704, 12730, 1), new Range16.ptr(12784, 12799, 1), new Range16.ptr(13312, 19893, 1), new Range16.ptr(19968, 40917, 1), new Range16.ptr(40960, 40980, 1), new Range16.ptr(40982, 42124, 1), new Range16.ptr(42192, 42231, 1), new Range16.ptr(42240, 42507, 1), new Range16.ptr(42512, 42527, 1), new Range16.ptr(42538, 42539, 1), new Range16.ptr(42606, 42656, 50), new Range16.ptr(42657, 42725, 1), new Range16.ptr(42895, 42999, 104), new Range16.ptr(43003, 43009, 1), new Range16.ptr(43011, 43013, 1), new Range16.ptr(43015, 43018, 1), new Range16.ptr(43020, 43042, 1), new Range16.ptr(43072, 43123, 1), new Range16.ptr(43138, 43187, 1), new Range16.ptr(43250, 43255, 1), new Range16.ptr(43259, 43261, 2), new Range16.ptr(43274, 43301, 1), new Range16.ptr(43312, 43334, 1), new Range16.ptr(43360, 43388, 1), new Range16.ptr(43396, 43442, 1), new Range16.ptr(43488, 43492, 1), new Range16.ptr(43495, 43503, 1), new Range16.ptr(43514, 43518, 1), new Range16.ptr(43520, 43560, 1), new Range16.ptr(43584, 43586, 1), new Range16.ptr(43588, 43595, 1), new Range16.ptr(43616, 43631, 1), new Range16.ptr(43633, 43638, 1), new Range16.ptr(43642, 43646, 4), new Range16.ptr(43647, 43695, 1), new Range16.ptr(43697, 43701, 4), new Range16.ptr(43702, 43705, 3), new Range16.ptr(43706, 43709, 1), new Range16.ptr(43712, 43714, 2), new Range16.ptr(43739, 43740, 1), new Range16.ptr(43744, 43754, 1), new Range16.ptr(43762, 43777, 15), new Range16.ptr(43778, 43782, 1), new Range16.ptr(43785, 43790, 1), new Range16.ptr(43793, 43798, 1), new Range16.ptr(43808, 43814, 1), new Range16.ptr(43816, 43822, 1), new Range16.ptr(43968, 44002, 1), new Range16.ptr(44032, 55203, 1), new Range16.ptr(55216, 55238, 1), new Range16.ptr(55243, 55291, 1), new Range16.ptr(63744, 64109, 1), new Range16.ptr(64112, 64217, 1), new Range16.ptr(64285, 64287, 2), new Range16.ptr(64288, 64296, 1), new Range16.ptr(64298, 64310, 1), new Range16.ptr(64312, 64316, 1), new Range16.ptr(64318, 64320, 2), new Range16.ptr(64321, 64323, 2), new Range16.ptr(64324, 64326, 2), new Range16.ptr(64327, 64433, 1), new Range16.ptr(64467, 64829, 1), new Range16.ptr(64848, 64911, 1), new Range16.ptr(64914, 64967, 1), new Range16.ptr(65008, 65019, 1), new Range16.ptr(65136, 65140, 1), new Range16.ptr(65142, 65276, 1), new Range16.ptr(65382, 65391, 1), new Range16.ptr(65393, 65437, 1), new Range16.ptr(65440, 65470, 1), new Range16.ptr(65474, 65479, 1), new Range16.ptr(65482, 65487, 1), new Range16.ptr(65490, 65495, 1), new Range16.ptr(65498, 65500, 1)]), new sliceType$1([new Range32.ptr(65536, 65547, 1), new Range32.ptr(65549, 65574, 1), new Range32.ptr(65576, 65594, 1), new Range32.ptr(65596, 65597, 1), new Range32.ptr(65599, 65613, 1), new Range32.ptr(65616, 65629, 1), new Range32.ptr(65664, 65786, 1), new Range32.ptr(66176, 66204, 1), new Range32.ptr(66208, 66256, 1), new Range32.ptr(66304, 66335, 1), new Range32.ptr(66352, 66368, 1), new Range32.ptr(66370, 66377, 1), new Range32.ptr(66384, 66421, 1), new Range32.ptr(66432, 66461, 1), new Range32.ptr(66464, 66499, 1), new Range32.ptr(66504, 66511, 1), new Range32.ptr(66640, 66717, 1), new Range32.ptr(66816, 66855, 1), new Range32.ptr(66864, 66915, 1), new Range32.ptr(67072, 67382, 1), new Range32.ptr(67392, 67413, 1), new Range32.ptr(67424, 67431, 1), new Range32.ptr(67584, 67589, 1), new Range32.ptr(67592, 67594, 2), new Range32.ptr(67595, 67637, 1), new Range32.ptr(67639, 67640, 1), new Range32.ptr(67644, 67647, 3), new Range32.ptr(67648, 67669, 1), new Range32.ptr(67680, 67702, 1), new Range32.ptr(67712, 67742, 1), new Range32.ptr(67808, 67826, 1), new Range32.ptr(67828, 67829, 1), new Range32.ptr(67840, 67861, 1), new Range32.ptr(67872, 67897, 1), new Range32.ptr(67968, 68023, 1), new Range32.ptr(68030, 68031, 1), new Range32.ptr(68096, 68112, 16), new Range32.ptr(68113, 68115, 1), new Range32.ptr(68117, 68119, 1), new Range32.ptr(68121, 68147, 1), new Range32.ptr(68192, 68220, 1), new Range32.ptr(68224, 68252, 1), new Range32.ptr(68288, 68295, 1), new Range32.ptr(68297, 68324, 1), new Range32.ptr(68352, 68405, 1), new Range32.ptr(68416, 68437, 1), new Range32.ptr(68448, 68466, 1), new Range32.ptr(68480, 68497, 1), new Range32.ptr(68608, 68680, 1), new Range32.ptr(69635, 69687, 1), new Range32.ptr(69763, 69807, 1), new Range32.ptr(69840, 69864, 1), new Range32.ptr(69891, 69926, 1), new Range32.ptr(69968, 70002, 1), new Range32.ptr(70006, 70019, 13), new Range32.ptr(70020, 70066, 1), new Range32.ptr(70081, 70084, 1), new Range32.ptr(70106, 70108, 2), new Range32.ptr(70144, 70161, 1), new Range32.ptr(70163, 70187, 1), new Range32.ptr(70272, 70278, 1), new Range32.ptr(70280, 70282, 2), new Range32.ptr(70283, 70285, 1), new Range32.ptr(70287, 70301, 1), new Range32.ptr(70303, 70312, 1), new Range32.ptr(70320, 70366, 1), new Range32.ptr(70405, 70412, 1), new Range32.ptr(70415, 70416, 1), new Range32.ptr(70419, 70440, 1), new Range32.ptr(70442, 70448, 1), new Range32.ptr(70450, 70451, 1), new Range32.ptr(70453, 70457, 1), new Range32.ptr(70461, 70480, 19), new Range32.ptr(70493, 70497, 1), new Range32.ptr(70784, 70831, 1), new Range32.ptr(70852, 70853, 1), new Range32.ptr(70855, 71040, 185), new Range32.ptr(71041, 71086, 1), new Range32.ptr(71128, 71131, 1), new Range32.ptr(71168, 71215, 1), new Range32.ptr(71236, 71296, 60), new Range32.ptr(71297, 71338, 1), new Range32.ptr(71424, 71449, 1), new Range32.ptr(71935, 72384, 449), new Range32.ptr(72385, 72440, 1), new Range32.ptr(73728, 74649, 1), new Range32.ptr(74880, 75075, 1), new Range32.ptr(77824, 78894, 1), new Range32.ptr(82944, 83526, 1), new Range32.ptr(92160, 92728, 1), new Range32.ptr(92736, 92766, 1), new Range32.ptr(92880, 92909, 1), new Range32.ptr(92928, 92975, 1), new Range32.ptr(93027, 93047, 1), new Range32.ptr(93053, 93071, 1), new Range32.ptr(93952, 94020, 1), new Range32.ptr(94032, 110592, 16560), new Range32.ptr(110593, 113664, 3071), new Range32.ptr(113665, 113770, 1), new Range32.ptr(113776, 113788, 1), new Range32.ptr(113792, 113800, 1), new Range32.ptr(113808, 113817, 1), new Range32.ptr(124928, 125124, 1), new Range32.ptr(126464, 126467, 1), new Range32.ptr(126469, 126495, 1), new Range32.ptr(126497, 126498, 1), new Range32.ptr(126500, 126503, 3), new Range32.ptr(126505, 126514, 1), new Range32.ptr(126516, 126519, 1), new Range32.ptr(126521, 126523, 2), new Range32.ptr(126530, 126535, 5), new Range32.ptr(126537, 126541, 2), new Range32.ptr(126542, 126543, 1), new Range32.ptr(126545, 126546, 1), new Range32.ptr(126548, 126551, 3), new Range32.ptr(126553, 126561, 2), new Range32.ptr(126562, 126564, 2), new Range32.ptr(126567, 126570, 1), new Range32.ptr(126572, 126578, 1), new Range32.ptr(126580, 126583, 1), new Range32.ptr(126585, 126588, 1), new Range32.ptr(126590, 126592, 2), new Range32.ptr(126593, 126601, 1), new Range32.ptr(126603, 126619, 1), new Range32.ptr(126625, 126627, 1), new Range32.ptr(126629, 126633, 1), new Range32.ptr(126635, 126651, 1), new Range32.ptr(131072, 173782, 1), new Range32.ptr(173824, 177972, 1), new Range32.ptr(177984, 178205, 1), new Range32.ptr(178208, 183969, 1), new Range32.ptr(194560, 195101, 1)]), 1);
		_Lt = new RangeTable.ptr(new sliceType([new Range16.ptr(453, 459, 3), new Range16.ptr(498, 8072, 7574), new Range16.ptr(8073, 8079, 1), new Range16.ptr(8088, 8095, 1), new Range16.ptr(8104, 8111, 1), new Range16.ptr(8124, 8140, 16), new Range16.ptr(8188, 8188, 1)]), sliceType$1.nil, 0);
		_Lu = new RangeTable.ptr(new sliceType([new Range16.ptr(65, 90, 1), new Range16.ptr(192, 214, 1), new Range16.ptr(216, 222, 1), new Range16.ptr(256, 310, 2), new Range16.ptr(313, 327, 2), new Range16.ptr(330, 376, 2), new Range16.ptr(377, 381, 2), new Range16.ptr(385, 386, 1), new Range16.ptr(388, 390, 2), new Range16.ptr(391, 393, 2), new Range16.ptr(394, 395, 1), new Range16.ptr(398, 401, 1), new Range16.ptr(403, 404, 1), new Range16.ptr(406, 408, 1), new Range16.ptr(412, 413, 1), new Range16.ptr(415, 416, 1), new Range16.ptr(418, 422, 2), new Range16.ptr(423, 425, 2), new Range16.ptr(428, 430, 2), new Range16.ptr(431, 433, 2), new Range16.ptr(434, 435, 1), new Range16.ptr(437, 439, 2), new Range16.ptr(440, 444, 4), new Range16.ptr(452, 461, 3), new Range16.ptr(463, 475, 2), new Range16.ptr(478, 494, 2), new Range16.ptr(497, 500, 3), new Range16.ptr(502, 504, 1), new Range16.ptr(506, 562, 2), new Range16.ptr(570, 571, 1), new Range16.ptr(573, 574, 1), new Range16.ptr(577, 579, 2), new Range16.ptr(580, 582, 1), new Range16.ptr(584, 590, 2), new Range16.ptr(880, 882, 2), new Range16.ptr(886, 895, 9), new Range16.ptr(902, 904, 2), new Range16.ptr(905, 906, 1), new Range16.ptr(908, 910, 2), new Range16.ptr(911, 913, 2), new Range16.ptr(914, 929, 1), new Range16.ptr(931, 939, 1), new Range16.ptr(975, 978, 3), new Range16.ptr(979, 980, 1), new Range16.ptr(984, 1006, 2), new Range16.ptr(1012, 1015, 3), new Range16.ptr(1017, 1018, 1), new Range16.ptr(1021, 1071, 1), new Range16.ptr(1120, 1152, 2), new Range16.ptr(1162, 1216, 2), new Range16.ptr(1217, 1229, 2), new Range16.ptr(1232, 1326, 2), new Range16.ptr(1329, 1366, 1), new Range16.ptr(4256, 4293, 1), new Range16.ptr(4295, 4301, 6), new Range16.ptr(5024, 5109, 1), new Range16.ptr(7680, 7828, 2), new Range16.ptr(7838, 7934, 2), new Range16.ptr(7944, 7951, 1), new Range16.ptr(7960, 7965, 1), new Range16.ptr(7976, 7983, 1), new Range16.ptr(7992, 7999, 1), new Range16.ptr(8008, 8013, 1), new Range16.ptr(8025, 8031, 2), new Range16.ptr(8040, 8047, 1), new Range16.ptr(8120, 8123, 1), new Range16.ptr(8136, 8139, 1), new Range16.ptr(8152, 8155, 1), new Range16.ptr(8168, 8172, 1), new Range16.ptr(8184, 8187, 1), new Range16.ptr(8450, 8455, 5), new Range16.ptr(8459, 8461, 1), new Range16.ptr(8464, 8466, 1), new Range16.ptr(8469, 8473, 4), new Range16.ptr(8474, 8477, 1), new Range16.ptr(8484, 8490, 2), new Range16.ptr(8491, 8493, 1), new Range16.ptr(8496, 8499, 1), new Range16.ptr(8510, 8511, 1), new Range16.ptr(8517, 8579, 62), new Range16.ptr(11264, 11310, 1), new Range16.ptr(11360, 11362, 2), new Range16.ptr(11363, 11364, 1), new Range16.ptr(11367, 11373, 2), new Range16.ptr(11374, 11376, 1), new Range16.ptr(11378, 11381, 3), new Range16.ptr(11390, 11392, 1), new Range16.ptr(11394, 11490, 2), new Range16.ptr(11499, 11501, 2), new Range16.ptr(11506, 42560, 31054), new Range16.ptr(42562, 42604, 2), new Range16.ptr(42624, 42650, 2), new Range16.ptr(42786, 42798, 2), new Range16.ptr(42802, 42862, 2), new Range16.ptr(42873, 42877, 2), new Range16.ptr(42878, 42886, 2), new Range16.ptr(42891, 42893, 2), new Range16.ptr(42896, 42898, 2), new Range16.ptr(42902, 42922, 2), new Range16.ptr(42923, 42925, 1), new Range16.ptr(42928, 42932, 1), new Range16.ptr(42934, 65313, 22379), new Range16.ptr(65314, 65338, 1)]), new sliceType$1([new Range32.ptr(66560, 66599, 1), new Range32.ptr(68736, 68786, 1), new Range32.ptr(71840, 71871, 1), new Range32.ptr(119808, 119833, 1), new Range32.ptr(119860, 119885, 1), new Range32.ptr(119912, 119937, 1), new Range32.ptr(119964, 119966, 2), new Range32.ptr(119967, 119973, 3), new Range32.ptr(119974, 119977, 3), new Range32.ptr(119978, 119980, 1), new Range32.ptr(119982, 119989, 1), new Range32.ptr(120016, 120041, 1), new Range32.ptr(120068, 120069, 1), new Range32.ptr(120071, 120074, 1), new Range32.ptr(120077, 120084, 1), new Range32.ptr(120086, 120092, 1), new Range32.ptr(120120, 120121, 1), new Range32.ptr(120123, 120126, 1), new Range32.ptr(120128, 120132, 1), new Range32.ptr(120134, 120138, 4), new Range32.ptr(120139, 120144, 1), new Range32.ptr(120172, 120197, 1), new Range32.ptr(120224, 120249, 1), new Range32.ptr(120276, 120301, 1), new Range32.ptr(120328, 120353, 1), new Range32.ptr(120380, 120405, 1), new Range32.ptr(120432, 120457, 1), new Range32.ptr(120488, 120512, 1), new Range32.ptr(120546, 120570, 1), new Range32.ptr(120604, 120628, 1), new Range32.ptr(120662, 120686, 1), new Range32.ptr(120720, 120744, 1), new Range32.ptr(120778, 120778, 1)]), 3);
		_M = new RangeTable.ptr(new sliceType([new Range16.ptr(768, 879, 1), new Range16.ptr(1155, 1161, 1), new Range16.ptr(1425, 1469, 1), new Range16.ptr(1471, 1473, 2), new Range16.ptr(1474, 1476, 2), new Range16.ptr(1477, 1479, 2), new Range16.ptr(1552, 1562, 1), new Range16.ptr(1611, 1631, 1), new Range16.ptr(1648, 1750, 102), new Range16.ptr(1751, 1756, 1), new Range16.ptr(1759, 1764, 1), new Range16.ptr(1767, 1768, 1), new Range16.ptr(1770, 1773, 1), new Range16.ptr(1809, 1840, 31), new Range16.ptr(1841, 1866, 1), new Range16.ptr(1958, 1968, 1), new Range16.ptr(2027, 2035, 1), new Range16.ptr(2070, 2073, 1), new Range16.ptr(2075, 2083, 1), new Range16.ptr(2085, 2087, 1), new Range16.ptr(2089, 2093, 1), new Range16.ptr(2137, 2139, 1), new Range16.ptr(2275, 2307, 1), new Range16.ptr(2362, 2364, 1), new Range16.ptr(2366, 2383, 1), new Range16.ptr(2385, 2391, 1), new Range16.ptr(2402, 2403, 1), new Range16.ptr(2433, 2435, 1), new Range16.ptr(2492, 2494, 2), new Range16.ptr(2495, 2500, 1), new Range16.ptr(2503, 2504, 1), new Range16.ptr(2507, 2509, 1), new Range16.ptr(2519, 2530, 11), new Range16.ptr(2531, 2561, 30), new Range16.ptr(2562, 2563, 1), new Range16.ptr(2620, 2622, 2), new Range16.ptr(2623, 2626, 1), new Range16.ptr(2631, 2632, 1), new Range16.ptr(2635, 2637, 1), new Range16.ptr(2641, 2672, 31), new Range16.ptr(2673, 2677, 4), new Range16.ptr(2689, 2691, 1), new Range16.ptr(2748, 2750, 2), new Range16.ptr(2751, 2757, 1), new Range16.ptr(2759, 2761, 1), new Range16.ptr(2763, 2765, 1), new Range16.ptr(2786, 2787, 1), new Range16.ptr(2817, 2819, 1), new Range16.ptr(2876, 2878, 2), new Range16.ptr(2879, 2884, 1), new Range16.ptr(2887, 2888, 1), new Range16.ptr(2891, 2893, 1), new Range16.ptr(2902, 2903, 1), new Range16.ptr(2914, 2915, 1), new Range16.ptr(2946, 3006, 60), new Range16.ptr(3007, 3010, 1), new Range16.ptr(3014, 3016, 1), new Range16.ptr(3018, 3021, 1), new Range16.ptr(3031, 3072, 41), new Range16.ptr(3073, 3075, 1), new Range16.ptr(3134, 3140, 1), new Range16.ptr(3142, 3144, 1), new Range16.ptr(3146, 3149, 1), new Range16.ptr(3157, 3158, 1), new Range16.ptr(3170, 3171, 1), new Range16.ptr(3201, 3203, 1), new Range16.ptr(3260, 3262, 2), new Range16.ptr(3263, 3268, 1), new Range16.ptr(3270, 3272, 1), new Range16.ptr(3274, 3277, 1), new Range16.ptr(3285, 3286, 1), new Range16.ptr(3298, 3299, 1), new Range16.ptr(3329, 3331, 1), new Range16.ptr(3390, 3396, 1), new Range16.ptr(3398, 3400, 1), new Range16.ptr(3402, 3405, 1), new Range16.ptr(3415, 3426, 11), new Range16.ptr(3427, 3458, 31), new Range16.ptr(3459, 3530, 71), new Range16.ptr(3535, 3540, 1), new Range16.ptr(3542, 3544, 2), new Range16.ptr(3545, 3551, 1), new Range16.ptr(3570, 3571, 1), new Range16.ptr(3633, 3636, 3), new Range16.ptr(3637, 3642, 1), new Range16.ptr(3655, 3662, 1), new Range16.ptr(3761, 3764, 3), new Range16.ptr(3765, 3769, 1), new Range16.ptr(3771, 3772, 1), new Range16.ptr(3784, 3789, 1), new Range16.ptr(3864, 3865, 1), new Range16.ptr(3893, 3897, 2), new Range16.ptr(3902, 3903, 1), new Range16.ptr(3953, 3972, 1), new Range16.ptr(3974, 3975, 1), new Range16.ptr(3981, 3991, 1), new Range16.ptr(3993, 4028, 1), new Range16.ptr(4038, 4139, 101), new Range16.ptr(4140, 4158, 1), new Range16.ptr(4182, 4185, 1), new Range16.ptr(4190, 4192, 1), new Range16.ptr(4194, 4196, 1), new Range16.ptr(4199, 4205, 1), new Range16.ptr(4209, 4212, 1), new Range16.ptr(4226, 4237, 1), new Range16.ptr(4239, 4250, 11), new Range16.ptr(4251, 4253, 1), new Range16.ptr(4957, 4959, 1), new Range16.ptr(5906, 5908, 1), new Range16.ptr(5938, 5940, 1), new Range16.ptr(5970, 5971, 1), new Range16.ptr(6002, 6003, 1), new Range16.ptr(6068, 6099, 1), new Range16.ptr(6109, 6155, 46), new Range16.ptr(6156, 6157, 1), new Range16.ptr(6313, 6432, 119), new Range16.ptr(6433, 6443, 1), new Range16.ptr(6448, 6459, 1), new Range16.ptr(6679, 6683, 1), new Range16.ptr(6741, 6750, 1), new Range16.ptr(6752, 6780, 1), new Range16.ptr(6783, 6832, 49), new Range16.ptr(6833, 6846, 1), new Range16.ptr(6912, 6916, 1), new Range16.ptr(6964, 6980, 1), new Range16.ptr(7019, 7027, 1), new Range16.ptr(7040, 7042, 1), new Range16.ptr(7073, 7085, 1), new Range16.ptr(7142, 7155, 1), new Range16.ptr(7204, 7223, 1), new Range16.ptr(7376, 7378, 1), new Range16.ptr(7380, 7400, 1), new Range16.ptr(7405, 7410, 5), new Range16.ptr(7411, 7412, 1), new Range16.ptr(7416, 7417, 1), new Range16.ptr(7616, 7669, 1), new Range16.ptr(7676, 7679, 1), new Range16.ptr(8400, 8432, 1), new Range16.ptr(11503, 11505, 1), new Range16.ptr(11647, 11744, 97), new Range16.ptr(11745, 11775, 1), new Range16.ptr(12330, 12335, 1), new Range16.ptr(12441, 12442, 1), new Range16.ptr(42607, 42610, 1), new Range16.ptr(42612, 42621, 1), new Range16.ptr(42654, 42655, 1), new Range16.ptr(42736, 42737, 1), new Range16.ptr(43010, 43014, 4), new Range16.ptr(43019, 43043, 24), new Range16.ptr(43044, 43047, 1), new Range16.ptr(43136, 43137, 1), new Range16.ptr(43188, 43204, 1), new Range16.ptr(43232, 43249, 1), new Range16.ptr(43302, 43309, 1), new Range16.ptr(43335, 43347, 1), new Range16.ptr(43392, 43395, 1), new Range16.ptr(43443, 43456, 1), new Range16.ptr(43493, 43561, 68), new Range16.ptr(43562, 43574, 1), new Range16.ptr(43587, 43596, 9), new Range16.ptr(43597, 43643, 46), new Range16.ptr(43644, 43645, 1), new Range16.ptr(43696, 43698, 2), new Range16.ptr(43699, 43700, 1), new Range16.ptr(43703, 43704, 1), new Range16.ptr(43710, 43711, 1), new Range16.ptr(43713, 43755, 42), new Range16.ptr(43756, 43759, 1), new Range16.ptr(43765, 43766, 1), new Range16.ptr(44003, 44010, 1), new Range16.ptr(44012, 44013, 1), new Range16.ptr(64286, 65024, 738), new Range16.ptr(65025, 65039, 1), new Range16.ptr(65056, 65071, 1)]), new sliceType$1([new Range32.ptr(66045, 66272, 227), new Range32.ptr(66422, 66426, 1), new Range32.ptr(68097, 68099, 1), new Range32.ptr(68101, 68102, 1), new Range32.ptr(68108, 68111, 1), new Range32.ptr(68152, 68154, 1), new Range32.ptr(68159, 68325, 166), new Range32.ptr(68326, 69632, 1306), new Range32.ptr(69633, 69634, 1), new Range32.ptr(69688, 69702, 1), new Range32.ptr(69759, 69762, 1), new Range32.ptr(69808, 69818, 1), new Range32.ptr(69888, 69890, 1), new Range32.ptr(69927, 69940, 1), new Range32.ptr(70003, 70016, 13), new Range32.ptr(70017, 70018, 1), new Range32.ptr(70067, 70080, 1), new Range32.ptr(70090, 70092, 1), new Range32.ptr(70188, 70199, 1), new Range32.ptr(70367, 70378, 1), new Range32.ptr(70400, 70403, 1), new Range32.ptr(70460, 70462, 2), new Range32.ptr(70463, 70468, 1), new Range32.ptr(70471, 70472, 1), new Range32.ptr(70475, 70477, 1), new Range32.ptr(70487, 70498, 11), new Range32.ptr(70499, 70502, 3), new Range32.ptr(70503, 70508, 1), new Range32.ptr(70512, 70516, 1), new Range32.ptr(70832, 70851, 1), new Range32.ptr(71087, 71093, 1), new Range32.ptr(71096, 71104, 1), new Range32.ptr(71132, 71133, 1), new Range32.ptr(71216, 71232, 1), new Range32.ptr(71339, 71351, 1), new Range32.ptr(71453, 71467, 1), new Range32.ptr(92912, 92916, 1), new Range32.ptr(92976, 92982, 1), new Range32.ptr(94033, 94078, 1), new Range32.ptr(94095, 94098, 1), new Range32.ptr(113821, 113822, 1), new Range32.ptr(119141, 119145, 1), new Range32.ptr(119149, 119154, 1), new Range32.ptr(119163, 119170, 1), new Range32.ptr(119173, 119179, 1), new Range32.ptr(119210, 119213, 1), new Range32.ptr(119362, 119364, 1), new Range32.ptr(121344, 121398, 1), new Range32.ptr(121403, 121452, 1), new Range32.ptr(121461, 121476, 15), new Range32.ptr(121499, 121503, 1), new Range32.ptr(121505, 121519, 1), new Range32.ptr(125136, 125142, 1), new Range32.ptr(917760, 917999, 1)]), 0);
		_Mc = new RangeTable.ptr(new sliceType([new Range16.ptr(2307, 2363, 56), new Range16.ptr(2366, 2368, 1), new Range16.ptr(2377, 2380, 1), new Range16.ptr(2382, 2383, 1), new Range16.ptr(2434, 2435, 1), new Range16.ptr(2494, 2496, 1), new Range16.ptr(2503, 2504, 1), new Range16.ptr(2507, 2508, 1), new Range16.ptr(2519, 2563, 44), new Range16.ptr(2622, 2624, 1), new Range16.ptr(2691, 2750, 59), new Range16.ptr(2751, 2752, 1), new Range16.ptr(2761, 2763, 2), new Range16.ptr(2764, 2818, 54), new Range16.ptr(2819, 2878, 59), new Range16.ptr(2880, 2887, 7), new Range16.ptr(2888, 2891, 3), new Range16.ptr(2892, 2903, 11), new Range16.ptr(3006, 3007, 1), new Range16.ptr(3009, 3010, 1), new Range16.ptr(3014, 3016, 1), new Range16.ptr(3018, 3020, 1), new Range16.ptr(3031, 3073, 42), new Range16.ptr(3074, 3075, 1), new Range16.ptr(3137, 3140, 1), new Range16.ptr(3202, 3203, 1), new Range16.ptr(3262, 3264, 2), new Range16.ptr(3265, 3268, 1), new Range16.ptr(3271, 3272, 1), new Range16.ptr(3274, 3275, 1), new Range16.ptr(3285, 3286, 1), new Range16.ptr(3330, 3331, 1), new Range16.ptr(3390, 3392, 1), new Range16.ptr(3398, 3400, 1), new Range16.ptr(3402, 3404, 1), new Range16.ptr(3415, 3458, 43), new Range16.ptr(3459, 3535, 76), new Range16.ptr(3536, 3537, 1), new Range16.ptr(3544, 3551, 1), new Range16.ptr(3570, 3571, 1), new Range16.ptr(3902, 3903, 1), new Range16.ptr(3967, 4139, 172), new Range16.ptr(4140, 4145, 5), new Range16.ptr(4152, 4155, 3), new Range16.ptr(4156, 4182, 26), new Range16.ptr(4183, 4194, 11), new Range16.ptr(4195, 4196, 1), new Range16.ptr(4199, 4205, 1), new Range16.ptr(4227, 4228, 1), new Range16.ptr(4231, 4236, 1), new Range16.ptr(4239, 4250, 11), new Range16.ptr(4251, 4252, 1), new Range16.ptr(6070, 6078, 8), new Range16.ptr(6079, 6085, 1), new Range16.ptr(6087, 6088, 1), new Range16.ptr(6435, 6438, 1), new Range16.ptr(6441, 6443, 1), new Range16.ptr(6448, 6449, 1), new Range16.ptr(6451, 6456, 1), new Range16.ptr(6681, 6682, 1), new Range16.ptr(6741, 6743, 2), new Range16.ptr(6753, 6755, 2), new Range16.ptr(6756, 6765, 9), new Range16.ptr(6766, 6770, 1), new Range16.ptr(6916, 6965, 49), new Range16.ptr(6971, 6973, 2), new Range16.ptr(6974, 6977, 1), new Range16.ptr(6979, 6980, 1), new Range16.ptr(7042, 7073, 31), new Range16.ptr(7078, 7079, 1), new Range16.ptr(7082, 7143, 61), new Range16.ptr(7146, 7148, 1), new Range16.ptr(7150, 7154, 4), new Range16.ptr(7155, 7204, 49), new Range16.ptr(7205, 7211, 1), new Range16.ptr(7220, 7221, 1), new Range16.ptr(7393, 7410, 17), new Range16.ptr(7411, 12334, 4923), new Range16.ptr(12335, 43043, 30708), new Range16.ptr(43044, 43047, 3), new Range16.ptr(43136, 43137, 1), new Range16.ptr(43188, 43203, 1), new Range16.ptr(43346, 43347, 1), new Range16.ptr(43395, 43444, 49), new Range16.ptr(43445, 43450, 5), new Range16.ptr(43451, 43453, 2), new Range16.ptr(43454, 43456, 1), new Range16.ptr(43567, 43568, 1), new Range16.ptr(43571, 43572, 1), new Range16.ptr(43597, 43643, 46), new Range16.ptr(43645, 43755, 110), new Range16.ptr(43758, 43759, 1), new Range16.ptr(43765, 44003, 238), new Range16.ptr(44004, 44006, 2), new Range16.ptr(44007, 44009, 2), new Range16.ptr(44010, 44012, 2)]), new sliceType$1([new Range32.ptr(69632, 69634, 2), new Range32.ptr(69762, 69808, 46), new Range32.ptr(69809, 69810, 1), new Range32.ptr(69815, 69816, 1), new Range32.ptr(69932, 70018, 86), new Range32.ptr(70067, 70069, 1), new Range32.ptr(70079, 70080, 1), new Range32.ptr(70188, 70190, 1), new Range32.ptr(70194, 70195, 1), new Range32.ptr(70197, 70368, 171), new Range32.ptr(70369, 70370, 1), new Range32.ptr(70402, 70403, 1), new Range32.ptr(70462, 70463, 1), new Range32.ptr(70465, 70468, 1), new Range32.ptr(70471, 70472, 1), new Range32.ptr(70475, 70477, 1), new Range32.ptr(70487, 70498, 11), new Range32.ptr(70499, 70832, 333), new Range32.ptr(70833, 70834, 1), new Range32.ptr(70841, 70843, 2), new Range32.ptr(70844, 70846, 1), new Range32.ptr(70849, 71087, 238), new Range32.ptr(71088, 71089, 1), new Range32.ptr(71096, 71099, 1), new Range32.ptr(71102, 71216, 114), new Range32.ptr(71217, 71218, 1), new Range32.ptr(71227, 71228, 1), new Range32.ptr(71230, 71340, 110), new Range32.ptr(71342, 71343, 1), new Range32.ptr(71350, 71456, 106), new Range32.ptr(71457, 71462, 5), new Range32.ptr(94033, 94078, 1), new Range32.ptr(119141, 119142, 1), new Range32.ptr(119149, 119154, 1)]), 0);
		_Me = new RangeTable.ptr(new sliceType([new Range16.ptr(1160, 1161, 1), new Range16.ptr(6846, 8413, 1567), new Range16.ptr(8414, 8416, 1), new Range16.ptr(8418, 8420, 1), new Range16.ptr(42608, 42610, 1)]), sliceType$1.nil, 0);
		_Mn = new RangeTable.ptr(new sliceType([new Range16.ptr(768, 879, 1), new Range16.ptr(1155, 1159, 1), new Range16.ptr(1425, 1469, 1), new Range16.ptr(1471, 1473, 2), new Range16.ptr(1474, 1476, 2), new Range16.ptr(1477, 1479, 2), new Range16.ptr(1552, 1562, 1), new Range16.ptr(1611, 1631, 1), new Range16.ptr(1648, 1750, 102), new Range16.ptr(1751, 1756, 1), new Range16.ptr(1759, 1764, 1), new Range16.ptr(1767, 1768, 1), new Range16.ptr(1770, 1773, 1), new Range16.ptr(1809, 1840, 31), new Range16.ptr(1841, 1866, 1), new Range16.ptr(1958, 1968, 1), new Range16.ptr(2027, 2035, 1), new Range16.ptr(2070, 2073, 1), new Range16.ptr(2075, 2083, 1), new Range16.ptr(2085, 2087, 1), new Range16.ptr(2089, 2093, 1), new Range16.ptr(2137, 2139, 1), new Range16.ptr(2275, 2306, 1), new Range16.ptr(2362, 2364, 2), new Range16.ptr(2369, 2376, 1), new Range16.ptr(2381, 2385, 4), new Range16.ptr(2386, 2391, 1), new Range16.ptr(2402, 2403, 1), new Range16.ptr(2433, 2492, 59), new Range16.ptr(2497, 2500, 1), new Range16.ptr(2509, 2530, 21), new Range16.ptr(2531, 2561, 30), new Range16.ptr(2562, 2620, 58), new Range16.ptr(2625, 2626, 1), new Range16.ptr(2631, 2632, 1), new Range16.ptr(2635, 2637, 1), new Range16.ptr(2641, 2672, 31), new Range16.ptr(2673, 2677, 4), new Range16.ptr(2689, 2690, 1), new Range16.ptr(2748, 2753, 5), new Range16.ptr(2754, 2757, 1), new Range16.ptr(2759, 2760, 1), new Range16.ptr(2765, 2786, 21), new Range16.ptr(2787, 2817, 30), new Range16.ptr(2876, 2879, 3), new Range16.ptr(2881, 2884, 1), new Range16.ptr(2893, 2902, 9), new Range16.ptr(2914, 2915, 1), new Range16.ptr(2946, 3008, 62), new Range16.ptr(3021, 3072, 51), new Range16.ptr(3134, 3136, 1), new Range16.ptr(3142, 3144, 1), new Range16.ptr(3146, 3149, 1), new Range16.ptr(3157, 3158, 1), new Range16.ptr(3170, 3171, 1), new Range16.ptr(3201, 3260, 59), new Range16.ptr(3263, 3270, 7), new Range16.ptr(3276, 3277, 1), new Range16.ptr(3298, 3299, 1), new Range16.ptr(3329, 3393, 64), new Range16.ptr(3394, 3396, 1), new Range16.ptr(3405, 3426, 21), new Range16.ptr(3427, 3530, 103), new Range16.ptr(3538, 3540, 1), new Range16.ptr(3542, 3633, 91), new Range16.ptr(3636, 3642, 1), new Range16.ptr(3655, 3662, 1), new Range16.ptr(3761, 3764, 3), new Range16.ptr(3765, 3769, 1), new Range16.ptr(3771, 3772, 1), new Range16.ptr(3784, 3789, 1), new Range16.ptr(3864, 3865, 1), new Range16.ptr(3893, 3897, 2), new Range16.ptr(3953, 3966, 1), new Range16.ptr(3968, 3972, 1), new Range16.ptr(3974, 3975, 1), new Range16.ptr(3981, 3991, 1), new Range16.ptr(3993, 4028, 1), new Range16.ptr(4038, 4141, 103), new Range16.ptr(4142, 4144, 1), new Range16.ptr(4146, 4151, 1), new Range16.ptr(4153, 4154, 1), new Range16.ptr(4157, 4158, 1), new Range16.ptr(4184, 4185, 1), new Range16.ptr(4190, 4192, 1), new Range16.ptr(4209, 4212, 1), new Range16.ptr(4226, 4229, 3), new Range16.ptr(4230, 4237, 7), new Range16.ptr(4253, 4957, 704), new Range16.ptr(4958, 4959, 1), new Range16.ptr(5906, 5908, 1), new Range16.ptr(5938, 5940, 1), new Range16.ptr(5970, 5971, 1), new Range16.ptr(6002, 6003, 1), new Range16.ptr(6068, 6069, 1), new Range16.ptr(6071, 6077, 1), new Range16.ptr(6086, 6089, 3), new Range16.ptr(6090, 6099, 1), new Range16.ptr(6109, 6155, 46), new Range16.ptr(6156, 6157, 1), new Range16.ptr(6313, 6432, 119), new Range16.ptr(6433, 6434, 1), new Range16.ptr(6439, 6440, 1), new Range16.ptr(6450, 6457, 7), new Range16.ptr(6458, 6459, 1), new Range16.ptr(6679, 6680, 1), new Range16.ptr(6683, 6742, 59), new Range16.ptr(6744, 6750, 1), new Range16.ptr(6752, 6754, 2), new Range16.ptr(6757, 6764, 1), new Range16.ptr(6771, 6780, 1), new Range16.ptr(6783, 6832, 49), new Range16.ptr(6833, 6845, 1), new Range16.ptr(6912, 6915, 1), new Range16.ptr(6964, 6966, 2), new Range16.ptr(6967, 6970, 1), new Range16.ptr(6972, 6978, 6), new Range16.ptr(7019, 7027, 1), new Range16.ptr(7040, 7041, 1), new Range16.ptr(7074, 7077, 1), new Range16.ptr(7080, 7081, 1), new Range16.ptr(7083, 7085, 1), new Range16.ptr(7142, 7144, 2), new Range16.ptr(7145, 7149, 4), new Range16.ptr(7151, 7153, 1), new Range16.ptr(7212, 7219, 1), new Range16.ptr(7222, 7223, 1), new Range16.ptr(7376, 7378, 1), new Range16.ptr(7380, 7392, 1), new Range16.ptr(7394, 7400, 1), new Range16.ptr(7405, 7412, 7), new Range16.ptr(7416, 7417, 1), new Range16.ptr(7616, 7669, 1), new Range16.ptr(7676, 7679, 1), new Range16.ptr(8400, 8412, 1), new Range16.ptr(8417, 8421, 4), new Range16.ptr(8422, 8432, 1), new Range16.ptr(11503, 11505, 1), new Range16.ptr(11647, 11744, 97), new Range16.ptr(11745, 11775, 1), new Range16.ptr(12330, 12333, 1), new Range16.ptr(12441, 12442, 1), new Range16.ptr(42607, 42612, 5), new Range16.ptr(42613, 42621, 1), new Range16.ptr(42654, 42655, 1), new Range16.ptr(42736, 42737, 1), new Range16.ptr(43010, 43014, 4), new Range16.ptr(43019, 43045, 26), new Range16.ptr(43046, 43204, 158), new Range16.ptr(43232, 43249, 1), new Range16.ptr(43302, 43309, 1), new Range16.ptr(43335, 43345, 1), new Range16.ptr(43392, 43394, 1), new Range16.ptr(43443, 43446, 3), new Range16.ptr(43447, 43449, 1), new Range16.ptr(43452, 43493, 41), new Range16.ptr(43561, 43566, 1), new Range16.ptr(43569, 43570, 1), new Range16.ptr(43573, 43574, 1), new Range16.ptr(43587, 43596, 9), new Range16.ptr(43644, 43696, 52), new Range16.ptr(43698, 43700, 1), new Range16.ptr(43703, 43704, 1), new Range16.ptr(43710, 43711, 1), new Range16.ptr(43713, 43756, 43), new Range16.ptr(43757, 43766, 9), new Range16.ptr(44005, 44008, 3), new Range16.ptr(44013, 64286, 20273), new Range16.ptr(65024, 65039, 1), new Range16.ptr(65056, 65071, 1)]), new sliceType$1([new Range32.ptr(66045, 66272, 227), new Range32.ptr(66422, 66426, 1), new Range32.ptr(68097, 68099, 1), new Range32.ptr(68101, 68102, 1), new Range32.ptr(68108, 68111, 1), new Range32.ptr(68152, 68154, 1), new Range32.ptr(68159, 68325, 166), new Range32.ptr(68326, 69633, 1307), new Range32.ptr(69688, 69702, 1), new Range32.ptr(69759, 69761, 1), new Range32.ptr(69811, 69814, 1), new Range32.ptr(69817, 69818, 1), new Range32.ptr(69888, 69890, 1), new Range32.ptr(69927, 69931, 1), new Range32.ptr(69933, 69940, 1), new Range32.ptr(70003, 70016, 13), new Range32.ptr(70017, 70070, 53), new Range32.ptr(70071, 70078, 1), new Range32.ptr(70090, 70092, 1), new Range32.ptr(70191, 70193, 1), new Range32.ptr(70196, 70198, 2), new Range32.ptr(70199, 70367, 168), new Range32.ptr(70371, 70378, 1), new Range32.ptr(70400, 70401, 1), new Range32.ptr(70460, 70464, 4), new Range32.ptr(70502, 70508, 1), new Range32.ptr(70512, 70516, 1), new Range32.ptr(70835, 70840, 1), new Range32.ptr(70842, 70847, 5), new Range32.ptr(70848, 70850, 2), new Range32.ptr(70851, 71090, 239), new Range32.ptr(71091, 71093, 1), new Range32.ptr(71100, 71101, 1), new Range32.ptr(71103, 71104, 1), new Range32.ptr(71132, 71133, 1), new Range32.ptr(71219, 71226, 1), new Range32.ptr(71229, 71231, 2), new Range32.ptr(71232, 71339, 107), new Range32.ptr(71341, 71344, 3), new Range32.ptr(71345, 71349, 1), new Range32.ptr(71351, 71453, 102), new Range32.ptr(71454, 71455, 1), new Range32.ptr(71458, 71461, 1), new Range32.ptr(71463, 71467, 1), new Range32.ptr(92912, 92916, 1), new Range32.ptr(92976, 92982, 1), new Range32.ptr(94095, 94098, 1), new Range32.ptr(113821, 113822, 1), new Range32.ptr(119143, 119145, 1), new Range32.ptr(119163, 119170, 1), new Range32.ptr(119173, 119179, 1), new Range32.ptr(119210, 119213, 1), new Range32.ptr(119362, 119364, 1), new Range32.ptr(121344, 121398, 1), new Range32.ptr(121403, 121452, 1), new Range32.ptr(121461, 121476, 15), new Range32.ptr(121499, 121503, 1), new Range32.ptr(121505, 121519, 1), new Range32.ptr(125136, 125142, 1), new Range32.ptr(917760, 917999, 1)]), 0);
		_N = new RangeTable.ptr(new sliceType([new Range16.ptr(48, 57, 1), new Range16.ptr(178, 179, 1), new Range16.ptr(185, 188, 3), new Range16.ptr(189, 190, 1), new Range16.ptr(1632, 1641, 1), new Range16.ptr(1776, 1785, 1), new Range16.ptr(1984, 1993, 1), new Range16.ptr(2406, 2415, 1), new Range16.ptr(2534, 2543, 1), new Range16.ptr(2548, 2553, 1), new Range16.ptr(2662, 2671, 1), new Range16.ptr(2790, 2799, 1), new Range16.ptr(2918, 2927, 1), new Range16.ptr(2930, 2935, 1), new Range16.ptr(3046, 3058, 1), new Range16.ptr(3174, 3183, 1), new Range16.ptr(3192, 3198, 1), new Range16.ptr(3302, 3311, 1), new Range16.ptr(3430, 3445, 1), new Range16.ptr(3558, 3567, 1), new Range16.ptr(3664, 3673, 1), new Range16.ptr(3792, 3801, 1), new Range16.ptr(3872, 3891, 1), new Range16.ptr(4160, 4169, 1), new Range16.ptr(4240, 4249, 1), new Range16.ptr(4969, 4988, 1), new Range16.ptr(5870, 5872, 1), new Range16.ptr(6112, 6121, 1), new Range16.ptr(6128, 6137, 1), new Range16.ptr(6160, 6169, 1), new Range16.ptr(6470, 6479, 1), new Range16.ptr(6608, 6618, 1), new Range16.ptr(6784, 6793, 1), new Range16.ptr(6800, 6809, 1), new Range16.ptr(6992, 7001, 1), new Range16.ptr(7088, 7097, 1), new Range16.ptr(7232, 7241, 1), new Range16.ptr(7248, 7257, 1), new Range16.ptr(8304, 8308, 4), new Range16.ptr(8309, 8313, 1), new Range16.ptr(8320, 8329, 1), new Range16.ptr(8528, 8578, 1), new Range16.ptr(8581, 8585, 1), new Range16.ptr(9312, 9371, 1), new Range16.ptr(9450, 9471, 1), new Range16.ptr(10102, 10131, 1), new Range16.ptr(11517, 12295, 778), new Range16.ptr(12321, 12329, 1), new Range16.ptr(12344, 12346, 1), new Range16.ptr(12690, 12693, 1), new Range16.ptr(12832, 12841, 1), new Range16.ptr(12872, 12879, 1), new Range16.ptr(12881, 12895, 1), new Range16.ptr(12928, 12937, 1), new Range16.ptr(12977, 12991, 1), new Range16.ptr(42528, 42537, 1), new Range16.ptr(42726, 42735, 1), new Range16.ptr(43056, 43061, 1), new Range16.ptr(43216, 43225, 1), new Range16.ptr(43264, 43273, 1), new Range16.ptr(43472, 43481, 1), new Range16.ptr(43504, 43513, 1), new Range16.ptr(43600, 43609, 1), new Range16.ptr(44016, 44025, 1), new Range16.ptr(65296, 65305, 1)]), new sliceType$1([new Range32.ptr(65799, 65843, 1), new Range32.ptr(65856, 65912, 1), new Range32.ptr(65930, 65931, 1), new Range32.ptr(66273, 66299, 1), new Range32.ptr(66336, 66339, 1), new Range32.ptr(66369, 66378, 9), new Range32.ptr(66513, 66517, 1), new Range32.ptr(66720, 66729, 1), new Range32.ptr(67672, 67679, 1), new Range32.ptr(67705, 67711, 1), new Range32.ptr(67751, 67759, 1), new Range32.ptr(67835, 67839, 1), new Range32.ptr(67862, 67867, 1), new Range32.ptr(68028, 68029, 1), new Range32.ptr(68032, 68047, 1), new Range32.ptr(68050, 68095, 1), new Range32.ptr(68160, 68167, 1), new Range32.ptr(68221, 68222, 1), new Range32.ptr(68253, 68255, 1), new Range32.ptr(68331, 68335, 1), new Range32.ptr(68440, 68447, 1), new Range32.ptr(68472, 68479, 1), new Range32.ptr(68521, 68527, 1), new Range32.ptr(68858, 68863, 1), new Range32.ptr(69216, 69246, 1), new Range32.ptr(69714, 69743, 1), new Range32.ptr(69872, 69881, 1), new Range32.ptr(69942, 69951, 1), new Range32.ptr(70096, 70105, 1), new Range32.ptr(70113, 70132, 1), new Range32.ptr(70384, 70393, 1), new Range32.ptr(70864, 70873, 1), new Range32.ptr(71248, 71257, 1), new Range32.ptr(71360, 71369, 1), new Range32.ptr(71472, 71483, 1), new Range32.ptr(71904, 71922, 1), new Range32.ptr(74752, 74862, 1), new Range32.ptr(92768, 92777, 1), new Range32.ptr(93008, 93017, 1), new Range32.ptr(93019, 93025, 1), new Range32.ptr(119648, 119665, 1), new Range32.ptr(120782, 120831, 1), new Range32.ptr(125127, 125135, 1), new Range32.ptr(127232, 127244, 1)]), 4);
		_Nd = new RangeTable.ptr(new sliceType([new Range16.ptr(48, 57, 1), new Range16.ptr(1632, 1641, 1), new Range16.ptr(1776, 1785, 1), new Range16.ptr(1984, 1993, 1), new Range16.ptr(2406, 2415, 1), new Range16.ptr(2534, 2543, 1), new Range16.ptr(2662, 2671, 1), new Range16.ptr(2790, 2799, 1), new Range16.ptr(2918, 2927, 1), new Range16.ptr(3046, 3055, 1), new Range16.ptr(3174, 3183, 1), new Range16.ptr(3302, 3311, 1), new Range16.ptr(3430, 3439, 1), new Range16.ptr(3558, 3567, 1), new Range16.ptr(3664, 3673, 1), new Range16.ptr(3792, 3801, 1), new Range16.ptr(3872, 3881, 1), new Range16.ptr(4160, 4169, 1), new Range16.ptr(4240, 4249, 1), new Range16.ptr(6112, 6121, 1), new Range16.ptr(6160, 6169, 1), new Range16.ptr(6470, 6479, 1), new Range16.ptr(6608, 6617, 1), new Range16.ptr(6784, 6793, 1), new Range16.ptr(6800, 6809, 1), new Range16.ptr(6992, 7001, 1), new Range16.ptr(7088, 7097, 1), new Range16.ptr(7232, 7241, 1), new Range16.ptr(7248, 7257, 1), new Range16.ptr(42528, 42537, 1), new Range16.ptr(43216, 43225, 1), new Range16.ptr(43264, 43273, 1), new Range16.ptr(43472, 43481, 1), new Range16.ptr(43504, 43513, 1), new Range16.ptr(43600, 43609, 1), new Range16.ptr(44016, 44025, 1), new Range16.ptr(65296, 65305, 1)]), new sliceType$1([new Range32.ptr(66720, 66729, 1), new Range32.ptr(69734, 69743, 1), new Range32.ptr(69872, 69881, 1), new Range32.ptr(69942, 69951, 1), new Range32.ptr(70096, 70105, 1), new Range32.ptr(70384, 70393, 1), new Range32.ptr(70864, 70873, 1), new Range32.ptr(71248, 71257, 1), new Range32.ptr(71360, 71369, 1), new Range32.ptr(71472, 71481, 1), new Range32.ptr(71904, 71913, 1), new Range32.ptr(92768, 92777, 1), new Range32.ptr(93008, 93017, 1), new Range32.ptr(120782, 120831, 1)]), 1);
		_Nl = new RangeTable.ptr(new sliceType([new Range16.ptr(5870, 5872, 1), new Range16.ptr(8544, 8578, 1), new Range16.ptr(8581, 8584, 1), new Range16.ptr(12295, 12321, 26), new Range16.ptr(12322, 12329, 1), new Range16.ptr(12344, 12346, 1), new Range16.ptr(42726, 42735, 1)]), new sliceType$1([new Range32.ptr(65856, 65908, 1), new Range32.ptr(66369, 66378, 9), new Range32.ptr(66513, 66517, 1), new Range32.ptr(74752, 74862, 1)]), 0);
		_No = new RangeTable.ptr(new sliceType([new Range16.ptr(178, 179, 1), new Range16.ptr(185, 188, 3), new Range16.ptr(189, 190, 1), new Range16.ptr(2548, 2553, 1), new Range16.ptr(2930, 2935, 1), new Range16.ptr(3056, 3058, 1), new Range16.ptr(3192, 3198, 1), new Range16.ptr(3440, 3445, 1), new Range16.ptr(3882, 3891, 1), new Range16.ptr(4969, 4988, 1), new Range16.ptr(6128, 6137, 1), new Range16.ptr(6618, 8304, 1686), new Range16.ptr(8308, 8313, 1), new Range16.ptr(8320, 8329, 1), new Range16.ptr(8528, 8543, 1), new Range16.ptr(8585, 9312, 727), new Range16.ptr(9313, 9371, 1), new Range16.ptr(9450, 9471, 1), new Range16.ptr(10102, 10131, 1), new Range16.ptr(11517, 12690, 1173), new Range16.ptr(12691, 12693, 1), new Range16.ptr(12832, 12841, 1), new Range16.ptr(12872, 12879, 1), new Range16.ptr(12881, 12895, 1), new Range16.ptr(12928, 12937, 1), new Range16.ptr(12977, 12991, 1), new Range16.ptr(43056, 43061, 1)]), new sliceType$1([new Range32.ptr(65799, 65843, 1), new Range32.ptr(65909, 65912, 1), new Range32.ptr(65930, 65931, 1), new Range32.ptr(66273, 66299, 1), new Range32.ptr(66336, 66339, 1), new Range32.ptr(67672, 67679, 1), new Range32.ptr(67705, 67711, 1), new Range32.ptr(67751, 67759, 1), new Range32.ptr(67835, 67839, 1), new Range32.ptr(67862, 67867, 1), new Range32.ptr(68028, 68029, 1), new Range32.ptr(68032, 68047, 1), new Range32.ptr(68050, 68095, 1), new Range32.ptr(68160, 68167, 1), new Range32.ptr(68221, 68222, 1), new Range32.ptr(68253, 68255, 1), new Range32.ptr(68331, 68335, 1), new Range32.ptr(68440, 68447, 1), new Range32.ptr(68472, 68479, 1), new Range32.ptr(68521, 68527, 1), new Range32.ptr(68858, 68863, 1), new Range32.ptr(69216, 69246, 1), new Range32.ptr(69714, 69733, 1), new Range32.ptr(70113, 70132, 1), new Range32.ptr(71482, 71483, 1), new Range32.ptr(71914, 71922, 1), new Range32.ptr(93019, 93025, 1), new Range32.ptr(119648, 119665, 1), new Range32.ptr(125127, 125135, 1), new Range32.ptr(127232, 127244, 1)]), 3);
		_P = new RangeTable.ptr(new sliceType([new Range16.ptr(33, 35, 1), new Range16.ptr(37, 42, 1), new Range16.ptr(44, 47, 1), new Range16.ptr(58, 59, 1), new Range16.ptr(63, 64, 1), new Range16.ptr(91, 93, 1), new Range16.ptr(95, 123, 28), new Range16.ptr(125, 161, 36), new Range16.ptr(167, 171, 4), new Range16.ptr(182, 183, 1), new Range16.ptr(187, 191, 4), new Range16.ptr(894, 903, 9), new Range16.ptr(1370, 1375, 1), new Range16.ptr(1417, 1418, 1), new Range16.ptr(1470, 1472, 2), new Range16.ptr(1475, 1478, 3), new Range16.ptr(1523, 1524, 1), new Range16.ptr(1545, 1546, 1), new Range16.ptr(1548, 1549, 1), new Range16.ptr(1563, 1566, 3), new Range16.ptr(1567, 1642, 75), new Range16.ptr(1643, 1645, 1), new Range16.ptr(1748, 1792, 44), new Range16.ptr(1793, 1805, 1), new Range16.ptr(2039, 2041, 1), new Range16.ptr(2096, 2110, 1), new Range16.ptr(2142, 2404, 262), new Range16.ptr(2405, 2416, 11), new Range16.ptr(2800, 3572, 772), new Range16.ptr(3663, 3674, 11), new Range16.ptr(3675, 3844, 169), new Range16.ptr(3845, 3858, 1), new Range16.ptr(3860, 3898, 38), new Range16.ptr(3899, 3901, 1), new Range16.ptr(3973, 4048, 75), new Range16.ptr(4049, 4052, 1), new Range16.ptr(4057, 4058, 1), new Range16.ptr(4170, 4175, 1), new Range16.ptr(4347, 4960, 613), new Range16.ptr(4961, 4968, 1), new Range16.ptr(5120, 5741, 621), new Range16.ptr(5742, 5787, 45), new Range16.ptr(5788, 5867, 79), new Range16.ptr(5868, 5869, 1), new Range16.ptr(5941, 5942, 1), new Range16.ptr(6100, 6102, 1), new Range16.ptr(6104, 6106, 1), new Range16.ptr(6144, 6154, 1), new Range16.ptr(6468, 6469, 1), new Range16.ptr(6686, 6687, 1), new Range16.ptr(6816, 6822, 1), new Range16.ptr(6824, 6829, 1), new Range16.ptr(7002, 7008, 1), new Range16.ptr(7164, 7167, 1), new Range16.ptr(7227, 7231, 1), new Range16.ptr(7294, 7295, 1), new Range16.ptr(7360, 7367, 1), new Range16.ptr(7379, 8208, 829), new Range16.ptr(8209, 8231, 1), new Range16.ptr(8240, 8259, 1), new Range16.ptr(8261, 8273, 1), new Range16.ptr(8275, 8286, 1), new Range16.ptr(8317, 8318, 1), new Range16.ptr(8333, 8334, 1), new Range16.ptr(8968, 8971, 1), new Range16.ptr(9001, 9002, 1), new Range16.ptr(10088, 10101, 1), new Range16.ptr(10181, 10182, 1), new Range16.ptr(10214, 10223, 1), new Range16.ptr(10627, 10648, 1), new Range16.ptr(10712, 10715, 1), new Range16.ptr(10748, 10749, 1), new Range16.ptr(11513, 11516, 1), new Range16.ptr(11518, 11519, 1), new Range16.ptr(11632, 11776, 144), new Range16.ptr(11777, 11822, 1), new Range16.ptr(11824, 11842, 1), new Range16.ptr(12289, 12291, 1), new Range16.ptr(12296, 12305, 1), new Range16.ptr(12308, 12319, 1), new Range16.ptr(12336, 12349, 13), new Range16.ptr(12448, 12539, 91), new Range16.ptr(42238, 42239, 1), new Range16.ptr(42509, 42511, 1), new Range16.ptr(42611, 42622, 11), new Range16.ptr(42738, 42743, 1), new Range16.ptr(43124, 43127, 1), new Range16.ptr(43214, 43215, 1), new Range16.ptr(43256, 43258, 1), new Range16.ptr(43260, 43310, 50), new Range16.ptr(43311, 43359, 48), new Range16.ptr(43457, 43469, 1), new Range16.ptr(43486, 43487, 1), new Range16.ptr(43612, 43615, 1), new Range16.ptr(43742, 43743, 1), new Range16.ptr(43760, 43761, 1), new Range16.ptr(44011, 64830, 20819), new Range16.ptr(64831, 65040, 209), new Range16.ptr(65041, 65049, 1), new Range16.ptr(65072, 65106, 1), new Range16.ptr(65108, 65121, 1), new Range16.ptr(65123, 65128, 5), new Range16.ptr(65130, 65131, 1), new Range16.ptr(65281, 65283, 1), new Range16.ptr(65285, 65290, 1), new Range16.ptr(65292, 65295, 1), new Range16.ptr(65306, 65307, 1), new Range16.ptr(65311, 65312, 1), new Range16.ptr(65339, 65341, 1), new Range16.ptr(65343, 65371, 28), new Range16.ptr(65373, 65375, 2), new Range16.ptr(65376, 65381, 1)]), new sliceType$1([new Range32.ptr(65792, 65794, 1), new Range32.ptr(66463, 66512, 49), new Range32.ptr(66927, 67671, 744), new Range32.ptr(67871, 67903, 32), new Range32.ptr(68176, 68184, 1), new Range32.ptr(68223, 68336, 113), new Range32.ptr(68337, 68342, 1), new Range32.ptr(68409, 68415, 1), new Range32.ptr(68505, 68508, 1), new Range32.ptr(69703, 69709, 1), new Range32.ptr(69819, 69820, 1), new Range32.ptr(69822, 69825, 1), new Range32.ptr(69952, 69955, 1), new Range32.ptr(70004, 70005, 1), new Range32.ptr(70085, 70089, 1), new Range32.ptr(70093, 70107, 14), new Range32.ptr(70109, 70111, 1), new Range32.ptr(70200, 70205, 1), new Range32.ptr(70313, 70854, 541), new Range32.ptr(71105, 71127, 1), new Range32.ptr(71233, 71235, 1), new Range32.ptr(71484, 71486, 1), new Range32.ptr(74864, 74868, 1), new Range32.ptr(92782, 92783, 1), new Range32.ptr(92917, 92983, 66), new Range32.ptr(92984, 92987, 1), new Range32.ptr(92996, 113823, 20827), new Range32.ptr(121479, 121483, 1)]), 11);
		_Pc = new RangeTable.ptr(new sliceType([new Range16.ptr(95, 8255, 8160), new Range16.ptr(8256, 8276, 20), new Range16.ptr(65075, 65076, 1), new Range16.ptr(65101, 65103, 1), new Range16.ptr(65343, 65343, 1)]), sliceType$1.nil, 0);
		_Pd = new RangeTable.ptr(new sliceType([new Range16.ptr(45, 1418, 1373), new Range16.ptr(1470, 5120, 3650), new Range16.ptr(6150, 8208, 2058), new Range16.ptr(8209, 8213, 1), new Range16.ptr(11799, 11802, 3), new Range16.ptr(11834, 11835, 1), new Range16.ptr(11840, 12316, 476), new Range16.ptr(12336, 12448, 112), new Range16.ptr(65073, 65074, 1), new Range16.ptr(65112, 65123, 11), new Range16.ptr(65293, 65293, 1)]), sliceType$1.nil, 0);
		_Pe = new RangeTable.ptr(new sliceType([new Range16.ptr(41, 93, 52), new Range16.ptr(125, 3899, 3774), new Range16.ptr(3901, 5788, 1887), new Range16.ptr(8262, 8318, 56), new Range16.ptr(8334, 8969, 635), new Range16.ptr(8971, 9002, 31), new Range16.ptr(10089, 10101, 2), new Range16.ptr(10182, 10215, 33), new Range16.ptr(10217, 10223, 2), new Range16.ptr(10628, 10648, 2), new Range16.ptr(10713, 10715, 2), new Range16.ptr(10749, 11811, 1062), new Range16.ptr(11813, 11817, 2), new Range16.ptr(12297, 12305, 2), new Range16.ptr(12309, 12315, 2), new Range16.ptr(12318, 12319, 1), new Range16.ptr(64830, 65048, 218), new Range16.ptr(65078, 65092, 2), new Range16.ptr(65096, 65114, 18), new Range16.ptr(65116, 65118, 2), new Range16.ptr(65289, 65341, 52), new Range16.ptr(65373, 65379, 3)]), sliceType$1.nil, 1);
		_Pf = new RangeTable.ptr(new sliceType([new Range16.ptr(187, 8217, 8030), new Range16.ptr(8221, 8250, 29), new Range16.ptr(11779, 11781, 2), new Range16.ptr(11786, 11789, 3), new Range16.ptr(11805, 11809, 4)]), sliceType$1.nil, 0);
		_Pi = new RangeTable.ptr(new sliceType([new Range16.ptr(171, 8216, 8045), new Range16.ptr(8219, 8220, 1), new Range16.ptr(8223, 8249, 26), new Range16.ptr(11778, 11780, 2), new Range16.ptr(11785, 11788, 3), new Range16.ptr(11804, 11808, 4)]), sliceType$1.nil, 0);
		_Po = new RangeTable.ptr(new sliceType([new Range16.ptr(33, 35, 1), new Range16.ptr(37, 39, 1), new Range16.ptr(42, 46, 2), new Range16.ptr(47, 58, 11), new Range16.ptr(59, 63, 4), new Range16.ptr(64, 92, 28), new Range16.ptr(161, 167, 6), new Range16.ptr(182, 183, 1), new Range16.ptr(191, 894, 703), new Range16.ptr(903, 1370, 467), new Range16.ptr(1371, 1375, 1), new Range16.ptr(1417, 1472, 55), new Range16.ptr(1475, 1478, 3), new Range16.ptr(1523, 1524, 1), new Range16.ptr(1545, 1546, 1), new Range16.ptr(1548, 1549, 1), new Range16.ptr(1563, 1566, 3), new Range16.ptr(1567, 1642, 75), new Range16.ptr(1643, 1645, 1), new Range16.ptr(1748, 1792, 44), new Range16.ptr(1793, 1805, 1), new Range16.ptr(2039, 2041, 1), new Range16.ptr(2096, 2110, 1), new Range16.ptr(2142, 2404, 262), new Range16.ptr(2405, 2416, 11), new Range16.ptr(2800, 3572, 772), new Range16.ptr(3663, 3674, 11), new Range16.ptr(3675, 3844, 169), new Range16.ptr(3845, 3858, 1), new Range16.ptr(3860, 3973, 113), new Range16.ptr(4048, 4052, 1), new Range16.ptr(4057, 4058, 1), new Range16.ptr(4170, 4175, 1), new Range16.ptr(4347, 4960, 613), new Range16.ptr(4961, 4968, 1), new Range16.ptr(5741, 5742, 1), new Range16.ptr(5867, 5869, 1), new Range16.ptr(5941, 5942, 1), new Range16.ptr(6100, 6102, 1), new Range16.ptr(6104, 6106, 1), new Range16.ptr(6144, 6149, 1), new Range16.ptr(6151, 6154, 1), new Range16.ptr(6468, 6469, 1), new Range16.ptr(6686, 6687, 1), new Range16.ptr(6816, 6822, 1), new Range16.ptr(6824, 6829, 1), new Range16.ptr(7002, 7008, 1), new Range16.ptr(7164, 7167, 1), new Range16.ptr(7227, 7231, 1), new Range16.ptr(7294, 7295, 1), new Range16.ptr(7360, 7367, 1), new Range16.ptr(7379, 8214, 835), new Range16.ptr(8215, 8224, 9), new Range16.ptr(8225, 8231, 1), new Range16.ptr(8240, 8248, 1), new Range16.ptr(8251, 8254, 1), new Range16.ptr(8257, 8259, 1), new Range16.ptr(8263, 8273, 1), new Range16.ptr(8275, 8277, 2), new Range16.ptr(8278, 8286, 1), new Range16.ptr(11513, 11516, 1), new Range16.ptr(11518, 11519, 1), new Range16.ptr(11632, 11776, 144), new Range16.ptr(11777, 11782, 5), new Range16.ptr(11783, 11784, 1), new Range16.ptr(11787, 11790, 3), new Range16.ptr(11791, 11798, 1), new Range16.ptr(11800, 11801, 1), new Range16.ptr(11803, 11806, 3), new Range16.ptr(11807, 11818, 11), new Range16.ptr(11819, 11822, 1), new Range16.ptr(11824, 11833, 1), new Range16.ptr(11836, 11839, 1), new Range16.ptr(11841, 12289, 448), new Range16.ptr(12290, 12291, 1), new Range16.ptr(12349, 12539, 190), new Range16.ptr(42238, 42239, 1), new Range16.ptr(42509, 42511, 1), new Range16.ptr(42611, 42622, 11), new Range16.ptr(42738, 42743, 1), new Range16.ptr(43124, 43127, 1), new Range16.ptr(43214, 43215, 1), new Range16.ptr(43256, 43258, 1), new Range16.ptr(43260, 43310, 50), new Range16.ptr(43311, 43359, 48), new Range16.ptr(43457, 43469, 1), new Range16.ptr(43486, 43487, 1), new Range16.ptr(43612, 43615, 1), new Range16.ptr(43742, 43743, 1), new Range16.ptr(43760, 43761, 1), new Range16.ptr(44011, 65040, 21029), new Range16.ptr(65041, 65046, 1), new Range16.ptr(65049, 65072, 23), new Range16.ptr(65093, 65094, 1), new Range16.ptr(65097, 65100, 1), new Range16.ptr(65104, 65106, 1), new Range16.ptr(65108, 65111, 1), new Range16.ptr(65119, 65121, 1), new Range16.ptr(65128, 65130, 2), new Range16.ptr(65131, 65281, 150), new Range16.ptr(65282, 65283, 1), new Range16.ptr(65285, 65287, 1), new Range16.ptr(65290, 65294, 2), new Range16.ptr(65295, 65306, 11), new Range16.ptr(65307, 65311, 4), new Range16.ptr(65312, 65340, 28), new Range16.ptr(65377, 65380, 3), new Range16.ptr(65381, 65381, 1)]), new sliceType$1([new Range32.ptr(65792, 65792, 1), new Range32.ptr(65793, 65794, 1), new Range32.ptr(66463, 66512, 49), new Range32.ptr(66927, 67671, 744), new Range32.ptr(67871, 67903, 32), new Range32.ptr(68176, 68184, 1), new Range32.ptr(68223, 68336, 113), new Range32.ptr(68337, 68342, 1), new Range32.ptr(68409, 68415, 1), new Range32.ptr(68505, 68508, 1), new Range32.ptr(69703, 69709, 1), new Range32.ptr(69819, 69820, 1), new Range32.ptr(69822, 69825, 1), new Range32.ptr(69952, 69955, 1), new Range32.ptr(70004, 70005, 1), new Range32.ptr(70085, 70089, 1), new Range32.ptr(70093, 70107, 14), new Range32.ptr(70109, 70111, 1), new Range32.ptr(70200, 70205, 1), new Range32.ptr(70313, 70854, 541), new Range32.ptr(71105, 71127, 1), new Range32.ptr(71233, 71235, 1), new Range32.ptr(71484, 71486, 1), new Range32.ptr(74864, 74868, 1), new Range32.ptr(92782, 92783, 1), new Range32.ptr(92917, 92983, 66), new Range32.ptr(92984, 92987, 1), new Range32.ptr(92996, 113823, 20827), new Range32.ptr(121479, 121483, 1)]), 8);
		_Ps = new RangeTable.ptr(new sliceType([new Range16.ptr(40, 91, 51), new Range16.ptr(123, 3898, 3775), new Range16.ptr(3900, 5787, 1887), new Range16.ptr(8218, 8222, 4), new Range16.ptr(8261, 8317, 56), new Range16.ptr(8333, 8968, 635), new Range16.ptr(8970, 9001, 31), new Range16.ptr(10088, 10100, 2), new Range16.ptr(10181, 10214, 33), new Range16.ptr(10216, 10222, 2), new Range16.ptr(10627, 10647, 2), new Range16.ptr(10712, 10714, 2), new Range16.ptr(10748, 11810, 1062), new Range16.ptr(11812, 11816, 2), new Range16.ptr(11842, 12296, 454), new Range16.ptr(12298, 12304, 2), new Range16.ptr(12308, 12314, 2), new Range16.ptr(12317, 64831, 52514), new Range16.ptr(65047, 65077, 30), new Range16.ptr(65079, 65091, 2), new Range16.ptr(65095, 65113, 18), new Range16.ptr(65115, 65117, 2), new Range16.ptr(65288, 65339, 51), new Range16.ptr(65371, 65375, 4), new Range16.ptr(65378, 65378, 1)]), sliceType$1.nil, 1);
		_S = new RangeTable.ptr(new sliceType([new Range16.ptr(36, 43, 7), new Range16.ptr(60, 62, 1), new Range16.ptr(94, 96, 2), new Range16.ptr(124, 126, 2), new Range16.ptr(162, 166, 1), new Range16.ptr(168, 169, 1), new Range16.ptr(172, 174, 2), new Range16.ptr(175, 177, 1), new Range16.ptr(180, 184, 4), new Range16.ptr(215, 247, 32), new Range16.ptr(706, 709, 1), new Range16.ptr(722, 735, 1), new Range16.ptr(741, 747, 1), new Range16.ptr(749, 751, 2), new Range16.ptr(752, 767, 1), new Range16.ptr(885, 900, 15), new Range16.ptr(901, 1014, 113), new Range16.ptr(1154, 1421, 267), new Range16.ptr(1422, 1423, 1), new Range16.ptr(1542, 1544, 1), new Range16.ptr(1547, 1550, 3), new Range16.ptr(1551, 1758, 207), new Range16.ptr(1769, 1789, 20), new Range16.ptr(1790, 2038, 248), new Range16.ptr(2546, 2547, 1), new Range16.ptr(2554, 2555, 1), new Range16.ptr(2801, 2928, 127), new Range16.ptr(3059, 3066, 1), new Range16.ptr(3199, 3449, 250), new Range16.ptr(3647, 3841, 194), new Range16.ptr(3842, 3843, 1), new Range16.ptr(3859, 3861, 2), new Range16.ptr(3862, 3863, 1), new Range16.ptr(3866, 3871, 1), new Range16.ptr(3892, 3896, 2), new Range16.ptr(4030, 4037, 1), new Range16.ptr(4039, 4044, 1), new Range16.ptr(4046, 4047, 1), new Range16.ptr(4053, 4056, 1), new Range16.ptr(4254, 4255, 1), new Range16.ptr(5008, 5017, 1), new Range16.ptr(6107, 6464, 357), new Range16.ptr(6622, 6655, 1), new Range16.ptr(7009, 7018, 1), new Range16.ptr(7028, 7036, 1), new Range16.ptr(8125, 8127, 2), new Range16.ptr(8128, 8129, 1), new Range16.ptr(8141, 8143, 1), new Range16.ptr(8157, 8159, 1), new Range16.ptr(8173, 8175, 1), new Range16.ptr(8189, 8190, 1), new Range16.ptr(8260, 8274, 14), new Range16.ptr(8314, 8316, 1), new Range16.ptr(8330, 8332, 1), new Range16.ptr(8352, 8382, 1), new Range16.ptr(8448, 8449, 1), new Range16.ptr(8451, 8454, 1), new Range16.ptr(8456, 8457, 1), new Range16.ptr(8468, 8470, 2), new Range16.ptr(8471, 8472, 1), new Range16.ptr(8478, 8483, 1), new Range16.ptr(8485, 8489, 2), new Range16.ptr(8494, 8506, 12), new Range16.ptr(8507, 8512, 5), new Range16.ptr(8513, 8516, 1), new Range16.ptr(8522, 8525, 1), new Range16.ptr(8527, 8586, 59), new Range16.ptr(8587, 8592, 5), new Range16.ptr(8593, 8967, 1), new Range16.ptr(8972, 9000, 1), new Range16.ptr(9003, 9210, 1), new Range16.ptr(9216, 9254, 1), new Range16.ptr(9280, 9290, 1), new Range16.ptr(9372, 9449, 1), new Range16.ptr(9472, 10087, 1), new Range16.ptr(10132, 10180, 1), new Range16.ptr(10183, 10213, 1), new Range16.ptr(10224, 10626, 1), new Range16.ptr(10649, 10711, 1), new Range16.ptr(10716, 10747, 1), new Range16.ptr(10750, 11123, 1), new Range16.ptr(11126, 11157, 1), new Range16.ptr(11160, 11193, 1), new Range16.ptr(11197, 11208, 1), new Range16.ptr(11210, 11217, 1), new Range16.ptr(11244, 11247, 1), new Range16.ptr(11493, 11498, 1), new Range16.ptr(11904, 11929, 1), new Range16.ptr(11931, 12019, 1), new Range16.ptr(12032, 12245, 1), new Range16.ptr(12272, 12283, 1), new Range16.ptr(12292, 12306, 14), new Range16.ptr(12307, 12320, 13), new Range16.ptr(12342, 12343, 1), new Range16.ptr(12350, 12351, 1), new Range16.ptr(12443, 12444, 1), new Range16.ptr(12688, 12689, 1), new Range16.ptr(12694, 12703, 1), new Range16.ptr(12736, 12771, 1), new Range16.ptr(12800, 12830, 1), new Range16.ptr(12842, 12871, 1), new Range16.ptr(12880, 12896, 16), new Range16.ptr(12897, 12927, 1), new Range16.ptr(12938, 12976, 1), new Range16.ptr(12992, 13054, 1), new Range16.ptr(13056, 13311, 1), new Range16.ptr(19904, 19967, 1), new Range16.ptr(42128, 42182, 1), new Range16.ptr(42752, 42774, 1), new Range16.ptr(42784, 42785, 1), new Range16.ptr(42889, 42890, 1), new Range16.ptr(43048, 43051, 1), new Range16.ptr(43062, 43065, 1), new Range16.ptr(43639, 43641, 1), new Range16.ptr(43867, 64297, 20430), new Range16.ptr(64434, 64449, 1), new Range16.ptr(65020, 65021, 1), new Range16.ptr(65122, 65124, 2), new Range16.ptr(65125, 65126, 1), new Range16.ptr(65129, 65284, 155), new Range16.ptr(65291, 65308, 17), new Range16.ptr(65309, 65310, 1), new Range16.ptr(65342, 65344, 2), new Range16.ptr(65372, 65374, 2), new Range16.ptr(65504, 65510, 1), new Range16.ptr(65512, 65518, 1), new Range16.ptr(65532, 65533, 1)]), new sliceType$1([new Range32.ptr(65847, 65855, 1), new Range32.ptr(65913, 65929, 1), new Range32.ptr(65932, 65936, 4), new Range32.ptr(65937, 65947, 1), new Range32.ptr(65952, 66000, 48), new Range32.ptr(66001, 66044, 1), new Range32.ptr(67703, 67704, 1), new Range32.ptr(68296, 71487, 3191), new Range32.ptr(92988, 92991, 1), new Range32.ptr(92997, 113820, 20823), new Range32.ptr(118784, 119029, 1), new Range32.ptr(119040, 119078, 1), new Range32.ptr(119081, 119140, 1), new Range32.ptr(119146, 119148, 1), new Range32.ptr(119171, 119172, 1), new Range32.ptr(119180, 119209, 1), new Range32.ptr(119214, 119272, 1), new Range32.ptr(119296, 119361, 1), new Range32.ptr(119365, 119552, 187), new Range32.ptr(119553, 119638, 1), new Range32.ptr(120513, 120539, 26), new Range32.ptr(120571, 120597, 26), new Range32.ptr(120629, 120655, 26), new Range32.ptr(120687, 120713, 26), new Range32.ptr(120745, 120771, 26), new Range32.ptr(120832, 121343, 1), new Range32.ptr(121399, 121402, 1), new Range32.ptr(121453, 121460, 1), new Range32.ptr(121462, 121475, 1), new Range32.ptr(121477, 121478, 1), new Range32.ptr(126704, 126705, 1), new Range32.ptr(126976, 127019, 1), new Range32.ptr(127024, 127123, 1), new Range32.ptr(127136, 127150, 1), new Range32.ptr(127153, 127167, 1), new Range32.ptr(127169, 127183, 1), new Range32.ptr(127185, 127221, 1), new Range32.ptr(127248, 127278, 1), new Range32.ptr(127280, 127339, 1), new Range32.ptr(127344, 127386, 1), new Range32.ptr(127462, 127490, 1), new Range32.ptr(127504, 127546, 1), new Range32.ptr(127552, 127560, 1), new Range32.ptr(127568, 127569, 1), new Range32.ptr(127744, 128377, 1), new Range32.ptr(128379, 128419, 1), new Range32.ptr(128421, 128720, 1), new Range32.ptr(128736, 128748, 1), new Range32.ptr(128752, 128755, 1), new Range32.ptr(128768, 128883, 1), new Range32.ptr(128896, 128980, 1), new Range32.ptr(129024, 129035, 1), new Range32.ptr(129040, 129095, 1), new Range32.ptr(129104, 129113, 1), new Range32.ptr(129120, 129159, 1), new Range32.ptr(129168, 129197, 1), new Range32.ptr(129296, 129304, 1), new Range32.ptr(129408, 129412, 1), new Range32.ptr(129472, 129472, 1)]), 10);
		_Sc = new RangeTable.ptr(new sliceType([new Range16.ptr(36, 162, 126), new Range16.ptr(163, 165, 1), new Range16.ptr(1423, 1547, 124), new Range16.ptr(2546, 2547, 1), new Range16.ptr(2555, 2801, 246), new Range16.ptr(3065, 3647, 582), new Range16.ptr(6107, 8352, 2245), new Range16.ptr(8353, 8382, 1), new Range16.ptr(43064, 65020, 21956), new Range16.ptr(65129, 65284, 155), new Range16.ptr(65504, 65505, 1), new Range16.ptr(65509, 65510, 1)]), sliceType$1.nil, 2);
		_Sk = new RangeTable.ptr(new sliceType([new Range16.ptr(94, 96, 2), new Range16.ptr(168, 175, 7), new Range16.ptr(180, 184, 4), new Range16.ptr(706, 709, 1), new Range16.ptr(722, 735, 1), new Range16.ptr(741, 747, 1), new Range16.ptr(749, 751, 2), new Range16.ptr(752, 767, 1), new Range16.ptr(885, 900, 15), new Range16.ptr(901, 8125, 7224), new Range16.ptr(8127, 8129, 1), new Range16.ptr(8141, 8143, 1), new Range16.ptr(8157, 8159, 1), new Range16.ptr(8173, 8175, 1), new Range16.ptr(8189, 8190, 1), new Range16.ptr(12443, 12444, 1), new Range16.ptr(42752, 42774, 1), new Range16.ptr(42784, 42785, 1), new Range16.ptr(42889, 42890, 1), new Range16.ptr(43867, 64434, 20567), new Range16.ptr(64435, 64449, 1), new Range16.ptr(65342, 65344, 2), new Range16.ptr(65507, 65507, 1)]), new sliceType$1([new Range32.ptr(127995, 127995, 1), new Range32.ptr(127996, 127999, 1)]), 3);
		_Sm = new RangeTable.ptr(new sliceType([new Range16.ptr(43, 60, 17), new Range16.ptr(61, 62, 1), new Range16.ptr(124, 126, 2), new Range16.ptr(172, 177, 5), new Range16.ptr(215, 247, 32), new Range16.ptr(1014, 1542, 528), new Range16.ptr(1543, 1544, 1), new Range16.ptr(8260, 8274, 14), new Range16.ptr(8314, 8316, 1), new Range16.ptr(8330, 8332, 1), new Range16.ptr(8472, 8512, 40), new Range16.ptr(8513, 8516, 1), new Range16.ptr(8523, 8592, 69), new Range16.ptr(8593, 8596, 1), new Range16.ptr(8602, 8603, 1), new Range16.ptr(8608, 8614, 3), new Range16.ptr(8622, 8654, 32), new Range16.ptr(8655, 8658, 3), new Range16.ptr(8660, 8692, 32), new Range16.ptr(8693, 8959, 1), new Range16.ptr(8992, 8993, 1), new Range16.ptr(9084, 9115, 31), new Range16.ptr(9116, 9139, 1), new Range16.ptr(9180, 9185, 1), new Range16.ptr(9655, 9665, 10), new Range16.ptr(9720, 9727, 1), new Range16.ptr(9839, 10176, 337), new Range16.ptr(10177, 10180, 1), new Range16.ptr(10183, 10213, 1), new Range16.ptr(10224, 10239, 1), new Range16.ptr(10496, 10626, 1), new Range16.ptr(10649, 10711, 1), new Range16.ptr(10716, 10747, 1), new Range16.ptr(10750, 11007, 1), new Range16.ptr(11056, 11076, 1), new Range16.ptr(11079, 11084, 1), new Range16.ptr(64297, 65122, 825), new Range16.ptr(65124, 65126, 1), new Range16.ptr(65291, 65308, 17), new Range16.ptr(65309, 65310, 1), new Range16.ptr(65372, 65374, 2), new Range16.ptr(65506, 65513, 7), new Range16.ptr(65514, 65516, 1)]), new sliceType$1([new Range32.ptr(120513, 120539, 26), new Range32.ptr(120571, 120597, 26), new Range32.ptr(120629, 120655, 26), new Range32.ptr(120687, 120713, 26), new Range32.ptr(120745, 120771, 26), new Range32.ptr(126704, 126705, 1)]), 5);
		_So = new RangeTable.ptr(new sliceType([new Range16.ptr(166, 169, 3), new Range16.ptr(174, 176, 2), new Range16.ptr(1154, 1421, 267), new Range16.ptr(1422, 1550, 128), new Range16.ptr(1551, 1758, 207), new Range16.ptr(1769, 1789, 20), new Range16.ptr(1790, 2038, 248), new Range16.ptr(2554, 2928, 374), new Range16.ptr(3059, 3064, 1), new Range16.ptr(3066, 3199, 133), new Range16.ptr(3449, 3841, 392), new Range16.ptr(3842, 3843, 1), new Range16.ptr(3859, 3861, 2), new Range16.ptr(3862, 3863, 1), new Range16.ptr(3866, 3871, 1), new Range16.ptr(3892, 3896, 2), new Range16.ptr(4030, 4037, 1), new Range16.ptr(4039, 4044, 1), new Range16.ptr(4046, 4047, 1), new Range16.ptr(4053, 4056, 1), new Range16.ptr(4254, 4255, 1), new Range16.ptr(5008, 5017, 1), new Range16.ptr(6464, 6622, 158), new Range16.ptr(6623, 6655, 1), new Range16.ptr(7009, 7018, 1), new Range16.ptr(7028, 7036, 1), new Range16.ptr(8448, 8449, 1), new Range16.ptr(8451, 8454, 1), new Range16.ptr(8456, 8457, 1), new Range16.ptr(8468, 8470, 2), new Range16.ptr(8471, 8478, 7), new Range16.ptr(8479, 8483, 1), new Range16.ptr(8485, 8489, 2), new Range16.ptr(8494, 8506, 12), new Range16.ptr(8507, 8522, 15), new Range16.ptr(8524, 8525, 1), new Range16.ptr(8527, 8586, 59), new Range16.ptr(8587, 8597, 10), new Range16.ptr(8598, 8601, 1), new Range16.ptr(8604, 8607, 1), new Range16.ptr(8609, 8610, 1), new Range16.ptr(8612, 8613, 1), new Range16.ptr(8615, 8621, 1), new Range16.ptr(8623, 8653, 1), new Range16.ptr(8656, 8657, 1), new Range16.ptr(8659, 8661, 2), new Range16.ptr(8662, 8691, 1), new Range16.ptr(8960, 8967, 1), new Range16.ptr(8972, 8991, 1), new Range16.ptr(8994, 9000, 1), new Range16.ptr(9003, 9083, 1), new Range16.ptr(9085, 9114, 1), new Range16.ptr(9140, 9179, 1), new Range16.ptr(9186, 9210, 1), new Range16.ptr(9216, 9254, 1), new Range16.ptr(9280, 9290, 1), new Range16.ptr(9372, 9449, 1), new Range16.ptr(9472, 9654, 1), new Range16.ptr(9656, 9664, 1), new Range16.ptr(9666, 9719, 1), new Range16.ptr(9728, 9838, 1), new Range16.ptr(9840, 10087, 1), new Range16.ptr(10132, 10175, 1), new Range16.ptr(10240, 10495, 1), new Range16.ptr(11008, 11055, 1), new Range16.ptr(11077, 11078, 1), new Range16.ptr(11085, 11123, 1), new Range16.ptr(11126, 11157, 1), new Range16.ptr(11160, 11193, 1), new Range16.ptr(11197, 11208, 1), new Range16.ptr(11210, 11217, 1), new Range16.ptr(11244, 11247, 1), new Range16.ptr(11493, 11498, 1), new Range16.ptr(11904, 11929, 1), new Range16.ptr(11931, 12019, 1), new Range16.ptr(12032, 12245, 1), new Range16.ptr(12272, 12283, 1), new Range16.ptr(12292, 12306, 14), new Range16.ptr(12307, 12320, 13), new Range16.ptr(12342, 12343, 1), new Range16.ptr(12350, 12351, 1), new Range16.ptr(12688, 12689, 1), new Range16.ptr(12694, 12703, 1), new Range16.ptr(12736, 12771, 1), new Range16.ptr(12800, 12830, 1), new Range16.ptr(12842, 12871, 1), new Range16.ptr(12880, 12896, 16), new Range16.ptr(12897, 12927, 1), new Range16.ptr(12938, 12976, 1), new Range16.ptr(12992, 13054, 1), new Range16.ptr(13056, 13311, 1), new Range16.ptr(19904, 19967, 1), new Range16.ptr(42128, 42182, 1), new Range16.ptr(43048, 43051, 1), new Range16.ptr(43062, 43063, 1), new Range16.ptr(43065, 43639, 574), new Range16.ptr(43640, 43641, 1), new Range16.ptr(65021, 65508, 487), new Range16.ptr(65512, 65517, 5), new Range16.ptr(65518, 65532, 14), new Range16.ptr(65533, 65533, 1)]), new sliceType$1([new Range32.ptr(65847, 65847, 1), new Range32.ptr(65848, 65855, 1), new Range32.ptr(65913, 65929, 1), new Range32.ptr(65932, 65936, 4), new Range32.ptr(65937, 65947, 1), new Range32.ptr(65952, 66000, 48), new Range32.ptr(66001, 66044, 1), new Range32.ptr(67703, 67704, 1), new Range32.ptr(68296, 71487, 3191), new Range32.ptr(92988, 92991, 1), new Range32.ptr(92997, 113820, 20823), new Range32.ptr(118784, 119029, 1), new Range32.ptr(119040, 119078, 1), new Range32.ptr(119081, 119140, 1), new Range32.ptr(119146, 119148, 1), new Range32.ptr(119171, 119172, 1), new Range32.ptr(119180, 119209, 1), new Range32.ptr(119214, 119272, 1), new Range32.ptr(119296, 119361, 1), new Range32.ptr(119365, 119552, 187), new Range32.ptr(119553, 119638, 1), new Range32.ptr(120832, 121343, 1), new Range32.ptr(121399, 121402, 1), new Range32.ptr(121453, 121460, 1), new Range32.ptr(121462, 121475, 1), new Range32.ptr(121477, 121478, 1), new Range32.ptr(126976, 127019, 1), new Range32.ptr(127024, 127123, 1), new Range32.ptr(127136, 127150, 1), new Range32.ptr(127153, 127167, 1), new Range32.ptr(127169, 127183, 1), new Range32.ptr(127185, 127221, 1), new Range32.ptr(127248, 127278, 1), new Range32.ptr(127280, 127339, 1), new Range32.ptr(127344, 127386, 1), new Range32.ptr(127462, 127490, 1), new Range32.ptr(127504, 127546, 1), new Range32.ptr(127552, 127560, 1), new Range32.ptr(127568, 127569, 1), new Range32.ptr(127744, 127994, 1), new Range32.ptr(128000, 128377, 1), new Range32.ptr(128379, 128419, 1), new Range32.ptr(128421, 128720, 1), new Range32.ptr(128736, 128748, 1), new Range32.ptr(128752, 128755, 1), new Range32.ptr(128768, 128883, 1), new Range32.ptr(128896, 128980, 1), new Range32.ptr(129024, 129035, 1), new Range32.ptr(129040, 129095, 1), new Range32.ptr(129104, 129113, 1), new Range32.ptr(129120, 129159, 1), new Range32.ptr(129168, 129197, 1), new Range32.ptr(129296, 129304, 1), new Range32.ptr(129408, 129412, 1), new Range32.ptr(129472, 129472, 1)]), 2);
		_Z = new RangeTable.ptr(new sliceType([new Range16.ptr(32, 160, 128), new Range16.ptr(5760, 8192, 2432), new Range16.ptr(8193, 8202, 1), new Range16.ptr(8232, 8233, 1), new Range16.ptr(8239, 8287, 48), new Range16.ptr(12288, 12288, 1)]), sliceType$1.nil, 1);
		_Zl = new RangeTable.ptr(new sliceType([new Range16.ptr(8232, 8232, 1)]), sliceType$1.nil, 0);
		_Zp = new RangeTable.ptr(new sliceType([new Range16.ptr(8233, 8233, 1)]), sliceType$1.nil, 0);
		_Zs = new RangeTable.ptr(new sliceType([new Range16.ptr(32, 160, 128), new Range16.ptr(5760, 8192, 2432), new Range16.ptr(8193, 8202, 1), new Range16.ptr(8239, 8287, 48), new Range16.ptr(12288, 12288, 1)]), sliceType$1.nil, 1);
		$pkg.Cc = _Cc;
		$pkg.Cf = _Cf;
		$pkg.Co = _Co;
		$pkg.Cs = _Cs;
		$pkg.Digit = _Nd;
		$pkg.Nd = _Nd;
		$pkg.Letter = _L;
		$pkg.L = _L;
		$pkg.Lm = _Lm;
		$pkg.Lo = _Lo;
		$pkg.Ll = _Ll;
		$pkg.M = _M;
		$pkg.Mc = _Mc;
		$pkg.Me = _Me;
		$pkg.Mn = _Mn;
		$pkg.Nl = _Nl;
		$pkg.No = _No;
		$pkg.N = _N;
		$pkg.C = _C;
		$pkg.Pc = _Pc;
		$pkg.Pd = _Pd;
		$pkg.Pe = _Pe;
		$pkg.Pf = _Pf;
		$pkg.Pi = _Pi;
		$pkg.Po = _Po;
		$pkg.Ps = _Ps;
		$pkg.P = _P;
		$pkg.Sc = _Sc;
		$pkg.Sk = _Sk;
		$pkg.Sm = _Sm;
		$pkg.So = _So;
		$pkg.Z = _Z;
		$pkg.S = _S;
		$pkg.PrintRanges = new sliceType$2([$pkg.L, $pkg.M, $pkg.N, $pkg.P, $pkg.S]);
		$pkg.Lt = _Lt;
		$pkg.Lu = _Lu;
		$pkg.Zl = _Zl;
		$pkg.Zp = _Zp;
		$pkg.Zs = _Zs;
		$pkg.Categories = $makeMap($String.keyFor, [{ k: "C", v: $pkg.C }, { k: "Cc", v: $pkg.Cc }, { k: "Cf", v: $pkg.Cf }, { k: "Co", v: $pkg.Co }, { k: "Cs", v: $pkg.Cs }, { k: "L", v: $pkg.L }, { k: "Ll", v: $pkg.Ll }, { k: "Lm", v: $pkg.Lm }, { k: "Lo", v: $pkg.Lo }, { k: "Lt", v: $pkg.Lt }, { k: "Lu", v: $pkg.Lu }, { k: "M", v: $pkg.M }, { k: "Mc", v: $pkg.Mc }, { k: "Me", v: $pkg.Me }, { k: "Mn", v: $pkg.Mn }, { k: "N", v: $pkg.N }, { k: "Nd", v: $pkg.Nd }, { k: "Nl", v: $pkg.Nl }, { k: "No", v: $pkg.No }, { k: "P", v: $pkg.P }, { k: "Pc", v: $pkg.Pc }, { k: "Pd", v: $pkg.Pd }, { k: "Pe", v: $pkg.Pe }, { k: "Pf", v: $pkg.Pf }, { k: "Pi", v: $pkg.Pi }, { k: "Po", v: $pkg.Po }, { k: "Ps", v: $pkg.Ps }, { k: "S", v: $pkg.S }, { k: "Sc", v: $pkg.Sc }, { k: "Sk", v: $pkg.Sk }, { k: "Sm", v: $pkg.Sm }, { k: "So", v: $pkg.So }, { k: "Z", v: $pkg.Z }, { k: "Zl", v: $pkg.Zl }, { k: "Zp", v: $pkg.Zp }, { k: "Zs", v: $pkg.Zs }]);
		_Ahom = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(71424, 71449, 1), new Range32.ptr(71453, 71467, 1), new Range32.ptr(71472, 71487, 1)]), 0);
		_Anatolian_Hieroglyphs = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(82944, 83526, 1)]), 0);
		_Arabic = new RangeTable.ptr(new sliceType([new Range16.ptr(1536, 1540, 1), new Range16.ptr(1542, 1547, 1), new Range16.ptr(1549, 1562, 1), new Range16.ptr(1566, 1566, 1), new Range16.ptr(1568, 1599, 1), new Range16.ptr(1601, 1610, 1), new Range16.ptr(1622, 1647, 1), new Range16.ptr(1649, 1756, 1), new Range16.ptr(1758, 1791, 1), new Range16.ptr(1872, 1919, 1), new Range16.ptr(2208, 2228, 1), new Range16.ptr(2275, 2303, 1), new Range16.ptr(64336, 64449, 1), new Range16.ptr(64467, 64829, 1), new Range16.ptr(64848, 64911, 1), new Range16.ptr(64914, 64967, 1), new Range16.ptr(65008, 65021, 1), new Range16.ptr(65136, 65140, 1), new Range16.ptr(65142, 65276, 1)]), new sliceType$1([new Range32.ptr(69216, 69246, 1), new Range32.ptr(126464, 126467, 1), new Range32.ptr(126469, 126495, 1), new Range32.ptr(126497, 126498, 1), new Range32.ptr(126500, 126500, 1), new Range32.ptr(126503, 126503, 1), new Range32.ptr(126505, 126514, 1), new Range32.ptr(126516, 126519, 1), new Range32.ptr(126521, 126521, 1), new Range32.ptr(126523, 126523, 1), new Range32.ptr(126530, 126530, 1), new Range32.ptr(126535, 126535, 1), new Range32.ptr(126537, 126537, 1), new Range32.ptr(126539, 126539, 1), new Range32.ptr(126541, 126543, 1), new Range32.ptr(126545, 126546, 1), new Range32.ptr(126548, 126548, 1), new Range32.ptr(126551, 126551, 1), new Range32.ptr(126553, 126553, 1), new Range32.ptr(126555, 126555, 1), new Range32.ptr(126557, 126557, 1), new Range32.ptr(126559, 126559, 1), new Range32.ptr(126561, 126562, 1), new Range32.ptr(126564, 126564, 1), new Range32.ptr(126567, 126570, 1), new Range32.ptr(126572, 126578, 1), new Range32.ptr(126580, 126583, 1), new Range32.ptr(126585, 126588, 1), new Range32.ptr(126590, 126590, 1), new Range32.ptr(126592, 126601, 1), new Range32.ptr(126603, 126619, 1), new Range32.ptr(126625, 126627, 1), new Range32.ptr(126629, 126633, 1), new Range32.ptr(126635, 126651, 1), new Range32.ptr(126704, 126705, 1)]), 0);
		_Armenian = new RangeTable.ptr(new sliceType([new Range16.ptr(1329, 1366, 1), new Range16.ptr(1369, 1375, 1), new Range16.ptr(1377, 1415, 1), new Range16.ptr(1418, 1418, 1), new Range16.ptr(1421, 1423, 1), new Range16.ptr(64275, 64279, 1)]), sliceType$1.nil, 0);
		_Avestan = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(68352, 68405, 1), new Range32.ptr(68409, 68415, 1)]), 0);
		_Balinese = new RangeTable.ptr(new sliceType([new Range16.ptr(6912, 6987, 1), new Range16.ptr(6992, 7036, 1)]), sliceType$1.nil, 0);
		_Bamum = new RangeTable.ptr(new sliceType([new Range16.ptr(42656, 42743, 1)]), new sliceType$1([new Range32.ptr(92160, 92728, 1)]), 0);
		_Bassa_Vah = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(92880, 92909, 1), new Range32.ptr(92912, 92917, 1)]), 0);
		_Batak = new RangeTable.ptr(new sliceType([new Range16.ptr(7104, 7155, 1), new Range16.ptr(7164, 7167, 1)]), sliceType$1.nil, 0);
		_Bengali = new RangeTable.ptr(new sliceType([new Range16.ptr(2432, 2435, 1), new Range16.ptr(2437, 2444, 1), new Range16.ptr(2447, 2448, 1), new Range16.ptr(2451, 2472, 1), new Range16.ptr(2474, 2480, 1), new Range16.ptr(2482, 2482, 1), new Range16.ptr(2486, 2489, 1), new Range16.ptr(2492, 2500, 1), new Range16.ptr(2503, 2504, 1), new Range16.ptr(2507, 2510, 1), new Range16.ptr(2519, 2519, 1), new Range16.ptr(2524, 2525, 1), new Range16.ptr(2527, 2531, 1), new Range16.ptr(2534, 2555, 1)]), sliceType$1.nil, 0);
		_Bopomofo = new RangeTable.ptr(new sliceType([new Range16.ptr(746, 747, 1), new Range16.ptr(12549, 12589, 1), new Range16.ptr(12704, 12730, 1)]), sliceType$1.nil, 0);
		_Brahmi = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(69632, 69709, 1), new Range32.ptr(69714, 69743, 1), new Range32.ptr(69759, 69759, 1)]), 0);
		_Braille = new RangeTable.ptr(new sliceType([new Range16.ptr(10240, 10495, 1)]), sliceType$1.nil, 0);
		_Buginese = new RangeTable.ptr(new sliceType([new Range16.ptr(6656, 6683, 1), new Range16.ptr(6686, 6687, 1)]), sliceType$1.nil, 0);
		_Buhid = new RangeTable.ptr(new sliceType([new Range16.ptr(5952, 5971, 1)]), sliceType$1.nil, 0);
		_Canadian_Aboriginal = new RangeTable.ptr(new sliceType([new Range16.ptr(5120, 5759, 1), new Range16.ptr(6320, 6389, 1)]), sliceType$1.nil, 0);
		_Carian = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(66208, 66256, 1)]), 0);
		_Caucasian_Albanian = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(66864, 66915, 1), new Range32.ptr(66927, 66927, 1)]), 0);
		_Chakma = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(69888, 69940, 1), new Range32.ptr(69942, 69955, 1)]), 0);
		_Cham = new RangeTable.ptr(new sliceType([new Range16.ptr(43520, 43574, 1), new Range16.ptr(43584, 43597, 1), new Range16.ptr(43600, 43609, 1), new Range16.ptr(43612, 43615, 1)]), sliceType$1.nil, 0);
		_Cherokee = new RangeTable.ptr(new sliceType([new Range16.ptr(5024, 5109, 1), new Range16.ptr(5112, 5117, 1), new Range16.ptr(43888, 43967, 1)]), sliceType$1.nil, 0);
		_Common = new RangeTable.ptr(new sliceType([new Range16.ptr(0, 64, 1), new Range16.ptr(91, 96, 1), new Range16.ptr(123, 169, 1), new Range16.ptr(171, 185, 1), new Range16.ptr(187, 191, 1), new Range16.ptr(215, 215, 1), new Range16.ptr(247, 247, 1), new Range16.ptr(697, 735, 1), new Range16.ptr(741, 745, 1), new Range16.ptr(748, 767, 1), new Range16.ptr(884, 884, 1), new Range16.ptr(894, 894, 1), new Range16.ptr(901, 901, 1), new Range16.ptr(903, 903, 1), new Range16.ptr(1417, 1417, 1), new Range16.ptr(1541, 1541, 1), new Range16.ptr(1548, 1548, 1), new Range16.ptr(1563, 1564, 1), new Range16.ptr(1567, 1567, 1), new Range16.ptr(1600, 1600, 1), new Range16.ptr(1757, 1757, 1), new Range16.ptr(2404, 2405, 1), new Range16.ptr(3647, 3647, 1), new Range16.ptr(4053, 4056, 1), new Range16.ptr(4347, 4347, 1), new Range16.ptr(5867, 5869, 1), new Range16.ptr(5941, 5942, 1), new Range16.ptr(6146, 6147, 1), new Range16.ptr(6149, 6149, 1), new Range16.ptr(7379, 7379, 1), new Range16.ptr(7393, 7393, 1), new Range16.ptr(7401, 7404, 1), new Range16.ptr(7406, 7411, 1), new Range16.ptr(7413, 7414, 1), new Range16.ptr(8192, 8203, 1), new Range16.ptr(8206, 8292, 1), new Range16.ptr(8294, 8304, 1), new Range16.ptr(8308, 8318, 1), new Range16.ptr(8320, 8334, 1), new Range16.ptr(8352, 8382, 1), new Range16.ptr(8448, 8485, 1), new Range16.ptr(8487, 8489, 1), new Range16.ptr(8492, 8497, 1), new Range16.ptr(8499, 8525, 1), new Range16.ptr(8527, 8543, 1), new Range16.ptr(8585, 8587, 1), new Range16.ptr(8592, 9210, 1), new Range16.ptr(9216, 9254, 1), new Range16.ptr(9280, 9290, 1), new Range16.ptr(9312, 10239, 1), new Range16.ptr(10496, 11123, 1), new Range16.ptr(11126, 11157, 1), new Range16.ptr(11160, 11193, 1), new Range16.ptr(11197, 11208, 1), new Range16.ptr(11210, 11217, 1), new Range16.ptr(11244, 11247, 1), new Range16.ptr(11776, 11842, 1), new Range16.ptr(12272, 12283, 1), new Range16.ptr(12288, 12292, 1), new Range16.ptr(12294, 12294, 1), new Range16.ptr(12296, 12320, 1), new Range16.ptr(12336, 12343, 1), new Range16.ptr(12348, 12351, 1), new Range16.ptr(12443, 12444, 1), new Range16.ptr(12448, 12448, 1), new Range16.ptr(12539, 12540, 1), new Range16.ptr(12688, 12703, 1), new Range16.ptr(12736, 12771, 1), new Range16.ptr(12832, 12895, 1), new Range16.ptr(12927, 13007, 1), new Range16.ptr(13144, 13311, 1), new Range16.ptr(19904, 19967, 1), new Range16.ptr(42752, 42785, 1), new Range16.ptr(42888, 42890, 1), new Range16.ptr(43056, 43065, 1), new Range16.ptr(43310, 43310, 1), new Range16.ptr(43471, 43471, 1), new Range16.ptr(43867, 43867, 1), new Range16.ptr(64830, 64831, 1), new Range16.ptr(65040, 65049, 1), new Range16.ptr(65072, 65106, 1), new Range16.ptr(65108, 65126, 1), new Range16.ptr(65128, 65131, 1), new Range16.ptr(65279, 65279, 1), new Range16.ptr(65281, 65312, 1), new Range16.ptr(65339, 65344, 1), new Range16.ptr(65371, 65381, 1), new Range16.ptr(65392, 65392, 1), new Range16.ptr(65438, 65439, 1), new Range16.ptr(65504, 65510, 1), new Range16.ptr(65512, 65518, 1), new Range16.ptr(65529, 65533, 1)]), new sliceType$1([new Range32.ptr(65792, 65794, 1), new Range32.ptr(65799, 65843, 1), new Range32.ptr(65847, 65855, 1), new Range32.ptr(65936, 65947, 1), new Range32.ptr(66000, 66044, 1), new Range32.ptr(66273, 66299, 1), new Range32.ptr(113824, 113827, 1), new Range32.ptr(118784, 119029, 1), new Range32.ptr(119040, 119078, 1), new Range32.ptr(119081, 119142, 1), new Range32.ptr(119146, 119162, 1), new Range32.ptr(119171, 119172, 1), new Range32.ptr(119180, 119209, 1), new Range32.ptr(119214, 119272, 1), new Range32.ptr(119552, 119638, 1), new Range32.ptr(119648, 119665, 1), new Range32.ptr(119808, 119892, 1), new Range32.ptr(119894, 119964, 1), new Range32.ptr(119966, 119967, 1), new Range32.ptr(119970, 119970, 1), new Range32.ptr(119973, 119974, 1), new Range32.ptr(119977, 119980, 1), new Range32.ptr(119982, 119993, 1), new Range32.ptr(119995, 119995, 1), new Range32.ptr(119997, 120003, 1), new Range32.ptr(120005, 120069, 1), new Range32.ptr(120071, 120074, 1), new Range32.ptr(120077, 120084, 1), new Range32.ptr(120086, 120092, 1), new Range32.ptr(120094, 120121, 1), new Range32.ptr(120123, 120126, 1), new Range32.ptr(120128, 120132, 1), new Range32.ptr(120134, 120134, 1), new Range32.ptr(120138, 120144, 1), new Range32.ptr(120146, 120485, 1), new Range32.ptr(120488, 120779, 1), new Range32.ptr(120782, 120831, 1), new Range32.ptr(126976, 127019, 1), new Range32.ptr(127024, 127123, 1), new Range32.ptr(127136, 127150, 1), new Range32.ptr(127153, 127167, 1), new Range32.ptr(127169, 127183, 1), new Range32.ptr(127185, 127221, 1), new Range32.ptr(127232, 127244, 1), new Range32.ptr(127248, 127278, 1), new Range32.ptr(127280, 127339, 1), new Range32.ptr(127344, 127386, 1), new Range32.ptr(127462, 127487, 1), new Range32.ptr(127489, 127490, 1), new Range32.ptr(127504, 127546, 1), new Range32.ptr(127552, 127560, 1), new Range32.ptr(127568, 127569, 1), new Range32.ptr(127744, 128377, 1), new Range32.ptr(128379, 128419, 1), new Range32.ptr(128421, 128720, 1), new Range32.ptr(128736, 128748, 1), new Range32.ptr(128752, 128755, 1), new Range32.ptr(128768, 128883, 1), new Range32.ptr(128896, 128980, 1), new Range32.ptr(129024, 129035, 1), new Range32.ptr(129040, 129095, 1), new Range32.ptr(129104, 129113, 1), new Range32.ptr(129120, 129159, 1), new Range32.ptr(129168, 129197, 1), new Range32.ptr(129296, 129304, 1), new Range32.ptr(129408, 129412, 1), new Range32.ptr(129472, 129472, 1), new Range32.ptr(917505, 917505, 1), new Range32.ptr(917536, 917631, 1)]), 7);
		_Coptic = new RangeTable.ptr(new sliceType([new Range16.ptr(994, 1007, 1), new Range16.ptr(11392, 11507, 1), new Range16.ptr(11513, 11519, 1)]), sliceType$1.nil, 0);
		_Cuneiform = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(73728, 74649, 1), new Range32.ptr(74752, 74862, 1), new Range32.ptr(74864, 74868, 1), new Range32.ptr(74880, 75075, 1)]), 0);
		_Cypriot = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(67584, 67589, 1), new Range32.ptr(67592, 67592, 1), new Range32.ptr(67594, 67637, 1), new Range32.ptr(67639, 67640, 1), new Range32.ptr(67644, 67644, 1), new Range32.ptr(67647, 67647, 1)]), 0);
		_Cyrillic = new RangeTable.ptr(new sliceType([new Range16.ptr(1024, 1156, 1), new Range16.ptr(1159, 1327, 1), new Range16.ptr(7467, 7467, 1), new Range16.ptr(7544, 7544, 1), new Range16.ptr(11744, 11775, 1), new Range16.ptr(42560, 42655, 1), new Range16.ptr(65070, 65071, 1)]), sliceType$1.nil, 0);
		_Deseret = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(66560, 66639, 1)]), 0);
		_Devanagari = new RangeTable.ptr(new sliceType([new Range16.ptr(2304, 2384, 1), new Range16.ptr(2387, 2403, 1), new Range16.ptr(2406, 2431, 1), new Range16.ptr(43232, 43261, 1)]), sliceType$1.nil, 0);
		_Duployan = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(113664, 113770, 1), new Range32.ptr(113776, 113788, 1), new Range32.ptr(113792, 113800, 1), new Range32.ptr(113808, 113817, 1), new Range32.ptr(113820, 113823, 1)]), 0);
		_Egyptian_Hieroglyphs = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(77824, 78894, 1)]), 0);
		_Elbasan = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(66816, 66855, 1)]), 0);
		_Ethiopic = new RangeTable.ptr(new sliceType([new Range16.ptr(4608, 4680, 1), new Range16.ptr(4682, 4685, 1), new Range16.ptr(4688, 4694, 1), new Range16.ptr(4696, 4696, 1), new Range16.ptr(4698, 4701, 1), new Range16.ptr(4704, 4744, 1), new Range16.ptr(4746, 4749, 1), new Range16.ptr(4752, 4784, 1), new Range16.ptr(4786, 4789, 1), new Range16.ptr(4792, 4798, 1), new Range16.ptr(4800, 4800, 1), new Range16.ptr(4802, 4805, 1), new Range16.ptr(4808, 4822, 1), new Range16.ptr(4824, 4880, 1), new Range16.ptr(4882, 4885, 1), new Range16.ptr(4888, 4954, 1), new Range16.ptr(4957, 4988, 1), new Range16.ptr(4992, 5017, 1), new Range16.ptr(11648, 11670, 1), new Range16.ptr(11680, 11686, 1), new Range16.ptr(11688, 11694, 1), new Range16.ptr(11696, 11702, 1), new Range16.ptr(11704, 11710, 1), new Range16.ptr(11712, 11718, 1), new Range16.ptr(11720, 11726, 1), new Range16.ptr(11728, 11734, 1), new Range16.ptr(11736, 11742, 1), new Range16.ptr(43777, 43782, 1), new Range16.ptr(43785, 43790, 1), new Range16.ptr(43793, 43798, 1), new Range16.ptr(43808, 43814, 1), new Range16.ptr(43816, 43822, 1)]), sliceType$1.nil, 0);
		_Georgian = new RangeTable.ptr(new sliceType([new Range16.ptr(4256, 4293, 1), new Range16.ptr(4295, 4295, 1), new Range16.ptr(4301, 4301, 1), new Range16.ptr(4304, 4346, 1), new Range16.ptr(4348, 4351, 1), new Range16.ptr(11520, 11557, 1), new Range16.ptr(11559, 11559, 1), new Range16.ptr(11565, 11565, 1)]), sliceType$1.nil, 0);
		_Glagolitic = new RangeTable.ptr(new sliceType([new Range16.ptr(11264, 11310, 1), new Range16.ptr(11312, 11358, 1)]), sliceType$1.nil, 0);
		_Gothic = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(66352, 66378, 1)]), 0);
		_Grantha = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(70400, 70403, 1), new Range32.ptr(70405, 70412, 1), new Range32.ptr(70415, 70416, 1), new Range32.ptr(70419, 70440, 1), new Range32.ptr(70442, 70448, 1), new Range32.ptr(70450, 70451, 1), new Range32.ptr(70453, 70457, 1), new Range32.ptr(70460, 70468, 1), new Range32.ptr(70471, 70472, 1), new Range32.ptr(70475, 70477, 1), new Range32.ptr(70480, 70480, 1), new Range32.ptr(70487, 70487, 1), new Range32.ptr(70493, 70499, 1), new Range32.ptr(70502, 70508, 1), new Range32.ptr(70512, 70516, 1)]), 0);
		_Greek = new RangeTable.ptr(new sliceType([new Range16.ptr(880, 883, 1), new Range16.ptr(885, 887, 1), new Range16.ptr(890, 893, 1), new Range16.ptr(895, 895, 1), new Range16.ptr(900, 900, 1), new Range16.ptr(902, 902, 1), new Range16.ptr(904, 906, 1), new Range16.ptr(908, 908, 1), new Range16.ptr(910, 929, 1), new Range16.ptr(931, 993, 1), new Range16.ptr(1008, 1023, 1), new Range16.ptr(7462, 7466, 1), new Range16.ptr(7517, 7521, 1), new Range16.ptr(7526, 7530, 1), new Range16.ptr(7615, 7615, 1), new Range16.ptr(7936, 7957, 1), new Range16.ptr(7960, 7965, 1), new Range16.ptr(7968, 8005, 1), new Range16.ptr(8008, 8013, 1), new Range16.ptr(8016, 8023, 1), new Range16.ptr(8025, 8025, 1), new Range16.ptr(8027, 8027, 1), new Range16.ptr(8029, 8029, 1), new Range16.ptr(8031, 8061, 1), new Range16.ptr(8064, 8116, 1), new Range16.ptr(8118, 8132, 1), new Range16.ptr(8134, 8147, 1), new Range16.ptr(8150, 8155, 1), new Range16.ptr(8157, 8175, 1), new Range16.ptr(8178, 8180, 1), new Range16.ptr(8182, 8190, 1), new Range16.ptr(8486, 8486, 1), new Range16.ptr(43877, 43877, 1)]), new sliceType$1([new Range32.ptr(65856, 65932, 1), new Range32.ptr(65952, 65952, 1), new Range32.ptr(119296, 119365, 1)]), 0);
		_Gujarati = new RangeTable.ptr(new sliceType([new Range16.ptr(2689, 2691, 1), new Range16.ptr(2693, 2701, 1), new Range16.ptr(2703, 2705, 1), new Range16.ptr(2707, 2728, 1), new Range16.ptr(2730, 2736, 1), new Range16.ptr(2738, 2739, 1), new Range16.ptr(2741, 2745, 1), new Range16.ptr(2748, 2757, 1), new Range16.ptr(2759, 2761, 1), new Range16.ptr(2763, 2765, 1), new Range16.ptr(2768, 2768, 1), new Range16.ptr(2784, 2787, 1), new Range16.ptr(2790, 2801, 1), new Range16.ptr(2809, 2809, 1)]), sliceType$1.nil, 0);
		_Gurmukhi = new RangeTable.ptr(new sliceType([new Range16.ptr(2561, 2563, 1), new Range16.ptr(2565, 2570, 1), new Range16.ptr(2575, 2576, 1), new Range16.ptr(2579, 2600, 1), new Range16.ptr(2602, 2608, 1), new Range16.ptr(2610, 2611, 1), new Range16.ptr(2613, 2614, 1), new Range16.ptr(2616, 2617, 1), new Range16.ptr(2620, 2620, 1), new Range16.ptr(2622, 2626, 1), new Range16.ptr(2631, 2632, 1), new Range16.ptr(2635, 2637, 1), new Range16.ptr(2641, 2641, 1), new Range16.ptr(2649, 2652, 1), new Range16.ptr(2654, 2654, 1), new Range16.ptr(2662, 2677, 1)]), sliceType$1.nil, 0);
		_Han = new RangeTable.ptr(new sliceType([new Range16.ptr(11904, 11929, 1), new Range16.ptr(11931, 12019, 1), new Range16.ptr(12032, 12245, 1), new Range16.ptr(12293, 12293, 1), new Range16.ptr(12295, 12295, 1), new Range16.ptr(12321, 12329, 1), new Range16.ptr(12344, 12347, 1), new Range16.ptr(13312, 19893, 1), new Range16.ptr(19968, 40917, 1), new Range16.ptr(63744, 64109, 1), new Range16.ptr(64112, 64217, 1)]), new sliceType$1([new Range32.ptr(131072, 173782, 1), new Range32.ptr(173824, 177972, 1), new Range32.ptr(177984, 178205, 1), new Range32.ptr(178208, 183969, 1), new Range32.ptr(194560, 195101, 1)]), 0);
		_Hangul = new RangeTable.ptr(new sliceType([new Range16.ptr(4352, 4607, 1), new Range16.ptr(12334, 12335, 1), new Range16.ptr(12593, 12686, 1), new Range16.ptr(12800, 12830, 1), new Range16.ptr(12896, 12926, 1), new Range16.ptr(43360, 43388, 1), new Range16.ptr(44032, 55203, 1), new Range16.ptr(55216, 55238, 1), new Range16.ptr(55243, 55291, 1), new Range16.ptr(65440, 65470, 1), new Range16.ptr(65474, 65479, 1), new Range16.ptr(65482, 65487, 1), new Range16.ptr(65490, 65495, 1), new Range16.ptr(65498, 65500, 1)]), sliceType$1.nil, 0);
		_Hanunoo = new RangeTable.ptr(new sliceType([new Range16.ptr(5920, 5940, 1)]), sliceType$1.nil, 0);
		_Hatran = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(67808, 67826, 1), new Range32.ptr(67828, 67829, 1), new Range32.ptr(67835, 67839, 1)]), 0);
		_Hebrew = new RangeTable.ptr(new sliceType([new Range16.ptr(1425, 1479, 1), new Range16.ptr(1488, 1514, 1), new Range16.ptr(1520, 1524, 1), new Range16.ptr(64285, 64310, 1), new Range16.ptr(64312, 64316, 1), new Range16.ptr(64318, 64318, 1), new Range16.ptr(64320, 64321, 1), new Range16.ptr(64323, 64324, 1), new Range16.ptr(64326, 64335, 1)]), sliceType$1.nil, 0);
		_Hiragana = new RangeTable.ptr(new sliceType([new Range16.ptr(12353, 12438, 1), new Range16.ptr(12445, 12447, 1)]), new sliceType$1([new Range32.ptr(110593, 110593, 1), new Range32.ptr(127488, 127488, 1)]), 0);
		_Imperial_Aramaic = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(67648, 67669, 1), new Range32.ptr(67671, 67679, 1)]), 0);
		_Inherited = new RangeTable.ptr(new sliceType([new Range16.ptr(768, 879, 1), new Range16.ptr(1157, 1158, 1), new Range16.ptr(1611, 1621, 1), new Range16.ptr(1648, 1648, 1), new Range16.ptr(2385, 2386, 1), new Range16.ptr(6832, 6846, 1), new Range16.ptr(7376, 7378, 1), new Range16.ptr(7380, 7392, 1), new Range16.ptr(7394, 7400, 1), new Range16.ptr(7405, 7405, 1), new Range16.ptr(7412, 7412, 1), new Range16.ptr(7416, 7417, 1), new Range16.ptr(7616, 7669, 1), new Range16.ptr(7676, 7679, 1), new Range16.ptr(8204, 8205, 1), new Range16.ptr(8400, 8432, 1), new Range16.ptr(12330, 12333, 1), new Range16.ptr(12441, 12442, 1), new Range16.ptr(65024, 65039, 1), new Range16.ptr(65056, 65069, 1)]), new sliceType$1([new Range32.ptr(66045, 66045, 1), new Range32.ptr(66272, 66272, 1), new Range32.ptr(119143, 119145, 1), new Range32.ptr(119163, 119170, 1), new Range32.ptr(119173, 119179, 1), new Range32.ptr(119210, 119213, 1), new Range32.ptr(917760, 917999, 1)]), 0);
		_Inscriptional_Pahlavi = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(68448, 68466, 1), new Range32.ptr(68472, 68479, 1)]), 0);
		_Inscriptional_Parthian = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(68416, 68437, 1), new Range32.ptr(68440, 68447, 1)]), 0);
		_Javanese = new RangeTable.ptr(new sliceType([new Range16.ptr(43392, 43469, 1), new Range16.ptr(43472, 43481, 1), new Range16.ptr(43486, 43487, 1)]), sliceType$1.nil, 0);
		_Kaithi = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(69760, 69825, 1)]), 0);
		_Kannada = new RangeTable.ptr(new sliceType([new Range16.ptr(3201, 3203, 1), new Range16.ptr(3205, 3212, 1), new Range16.ptr(3214, 3216, 1), new Range16.ptr(3218, 3240, 1), new Range16.ptr(3242, 3251, 1), new Range16.ptr(3253, 3257, 1), new Range16.ptr(3260, 3268, 1), new Range16.ptr(3270, 3272, 1), new Range16.ptr(3274, 3277, 1), new Range16.ptr(3285, 3286, 1), new Range16.ptr(3294, 3294, 1), new Range16.ptr(3296, 3299, 1), new Range16.ptr(3302, 3311, 1), new Range16.ptr(3313, 3314, 1)]), sliceType$1.nil, 0);
		_Katakana = new RangeTable.ptr(new sliceType([new Range16.ptr(12449, 12538, 1), new Range16.ptr(12541, 12543, 1), new Range16.ptr(12784, 12799, 1), new Range16.ptr(13008, 13054, 1), new Range16.ptr(13056, 13143, 1), new Range16.ptr(65382, 65391, 1), new Range16.ptr(65393, 65437, 1)]), new sliceType$1([new Range32.ptr(110592, 110592, 1)]), 0);
		_Kayah_Li = new RangeTable.ptr(new sliceType([new Range16.ptr(43264, 43309, 1), new Range16.ptr(43311, 43311, 1)]), sliceType$1.nil, 0);
		_Kharoshthi = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(68096, 68099, 1), new Range32.ptr(68101, 68102, 1), new Range32.ptr(68108, 68115, 1), new Range32.ptr(68117, 68119, 1), new Range32.ptr(68121, 68147, 1), new Range32.ptr(68152, 68154, 1), new Range32.ptr(68159, 68167, 1), new Range32.ptr(68176, 68184, 1)]), 0);
		_Khmer = new RangeTable.ptr(new sliceType([new Range16.ptr(6016, 6109, 1), new Range16.ptr(6112, 6121, 1), new Range16.ptr(6128, 6137, 1), new Range16.ptr(6624, 6655, 1)]), sliceType$1.nil, 0);
		_Khojki = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(70144, 70161, 1), new Range32.ptr(70163, 70205, 1)]), 0);
		_Khudawadi = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(70320, 70378, 1), new Range32.ptr(70384, 70393, 1)]), 0);
		_Lao = new RangeTable.ptr(new sliceType([new Range16.ptr(3713, 3714, 1), new Range16.ptr(3716, 3716, 1), new Range16.ptr(3719, 3720, 1), new Range16.ptr(3722, 3722, 1), new Range16.ptr(3725, 3725, 1), new Range16.ptr(3732, 3735, 1), new Range16.ptr(3737, 3743, 1), new Range16.ptr(3745, 3747, 1), new Range16.ptr(3749, 3749, 1), new Range16.ptr(3751, 3751, 1), new Range16.ptr(3754, 3755, 1), new Range16.ptr(3757, 3769, 1), new Range16.ptr(3771, 3773, 1), new Range16.ptr(3776, 3780, 1), new Range16.ptr(3782, 3782, 1), new Range16.ptr(3784, 3789, 1), new Range16.ptr(3792, 3801, 1), new Range16.ptr(3804, 3807, 1)]), sliceType$1.nil, 0);
		_Latin = new RangeTable.ptr(new sliceType([new Range16.ptr(65, 90, 1), new Range16.ptr(97, 122, 1), new Range16.ptr(170, 170, 1), new Range16.ptr(186, 186, 1), new Range16.ptr(192, 214, 1), new Range16.ptr(216, 246, 1), new Range16.ptr(248, 696, 1), new Range16.ptr(736, 740, 1), new Range16.ptr(7424, 7461, 1), new Range16.ptr(7468, 7516, 1), new Range16.ptr(7522, 7525, 1), new Range16.ptr(7531, 7543, 1), new Range16.ptr(7545, 7614, 1), new Range16.ptr(7680, 7935, 1), new Range16.ptr(8305, 8305, 1), new Range16.ptr(8319, 8319, 1), new Range16.ptr(8336, 8348, 1), new Range16.ptr(8490, 8491, 1), new Range16.ptr(8498, 8498, 1), new Range16.ptr(8526, 8526, 1), new Range16.ptr(8544, 8584, 1), new Range16.ptr(11360, 11391, 1), new Range16.ptr(42786, 42887, 1), new Range16.ptr(42891, 42925, 1), new Range16.ptr(42928, 42935, 1), new Range16.ptr(42999, 43007, 1), new Range16.ptr(43824, 43866, 1), new Range16.ptr(43868, 43876, 1), new Range16.ptr(64256, 64262, 1), new Range16.ptr(65313, 65338, 1), new Range16.ptr(65345, 65370, 1)]), sliceType$1.nil, 6);
		_Lepcha = new RangeTable.ptr(new sliceType([new Range16.ptr(7168, 7223, 1), new Range16.ptr(7227, 7241, 1), new Range16.ptr(7245, 7247, 1)]), sliceType$1.nil, 0);
		_Limbu = new RangeTable.ptr(new sliceType([new Range16.ptr(6400, 6430, 1), new Range16.ptr(6432, 6443, 1), new Range16.ptr(6448, 6459, 1), new Range16.ptr(6464, 6464, 1), new Range16.ptr(6468, 6479, 1)]), sliceType$1.nil, 0);
		_Linear_A = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(67072, 67382, 1), new Range32.ptr(67392, 67413, 1), new Range32.ptr(67424, 67431, 1)]), 0);
		_Linear_B = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(65536, 65547, 1), new Range32.ptr(65549, 65574, 1), new Range32.ptr(65576, 65594, 1), new Range32.ptr(65596, 65597, 1), new Range32.ptr(65599, 65613, 1), new Range32.ptr(65616, 65629, 1), new Range32.ptr(65664, 65786, 1)]), 0);
		_Lisu = new RangeTable.ptr(new sliceType([new Range16.ptr(42192, 42239, 1)]), sliceType$1.nil, 0);
		_Lycian = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(66176, 66204, 1)]), 0);
		_Lydian = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(67872, 67897, 1), new Range32.ptr(67903, 67903, 1)]), 0);
		_Mahajani = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(69968, 70006, 1)]), 0);
		_Malayalam = new RangeTable.ptr(new sliceType([new Range16.ptr(3329, 3331, 1), new Range16.ptr(3333, 3340, 1), new Range16.ptr(3342, 3344, 1), new Range16.ptr(3346, 3386, 1), new Range16.ptr(3389, 3396, 1), new Range16.ptr(3398, 3400, 1), new Range16.ptr(3402, 3406, 1), new Range16.ptr(3415, 3415, 1), new Range16.ptr(3423, 3427, 1), new Range16.ptr(3430, 3445, 1), new Range16.ptr(3449, 3455, 1)]), sliceType$1.nil, 0);
		_Mandaic = new RangeTable.ptr(new sliceType([new Range16.ptr(2112, 2139, 1), new Range16.ptr(2142, 2142, 1)]), sliceType$1.nil, 0);
		_Manichaean = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(68288, 68326, 1), new Range32.ptr(68331, 68342, 1)]), 0);
		_Meetei_Mayek = new RangeTable.ptr(new sliceType([new Range16.ptr(43744, 43766, 1), new Range16.ptr(43968, 44013, 1), new Range16.ptr(44016, 44025, 1)]), sliceType$1.nil, 0);
		_Mende_Kikakui = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(124928, 125124, 1), new Range32.ptr(125127, 125142, 1)]), 0);
		_Meroitic_Cursive = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(68000, 68023, 1), new Range32.ptr(68028, 68047, 1), new Range32.ptr(68050, 68095, 1)]), 0);
		_Meroitic_Hieroglyphs = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(67968, 67999, 1)]), 0);
		_Miao = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(93952, 94020, 1), new Range32.ptr(94032, 94078, 1), new Range32.ptr(94095, 94111, 1)]), 0);
		_Modi = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(71168, 71236, 1), new Range32.ptr(71248, 71257, 1)]), 0);
		_Mongolian = new RangeTable.ptr(new sliceType([new Range16.ptr(6144, 6145, 1), new Range16.ptr(6148, 6148, 1), new Range16.ptr(6150, 6158, 1), new Range16.ptr(6160, 6169, 1), new Range16.ptr(6176, 6263, 1), new Range16.ptr(6272, 6314, 1)]), sliceType$1.nil, 0);
		_Mro = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(92736, 92766, 1), new Range32.ptr(92768, 92777, 1), new Range32.ptr(92782, 92783, 1)]), 0);
		_Multani = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(70272, 70278, 1), new Range32.ptr(70280, 70280, 1), new Range32.ptr(70282, 70285, 1), new Range32.ptr(70287, 70301, 1), new Range32.ptr(70303, 70313, 1)]), 0);
		_Myanmar = new RangeTable.ptr(new sliceType([new Range16.ptr(4096, 4255, 1), new Range16.ptr(43488, 43518, 1), new Range16.ptr(43616, 43647, 1)]), sliceType$1.nil, 0);
		_Nabataean = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(67712, 67742, 1), new Range32.ptr(67751, 67759, 1)]), 0);
		_New_Tai_Lue = new RangeTable.ptr(new sliceType([new Range16.ptr(6528, 6571, 1), new Range16.ptr(6576, 6601, 1), new Range16.ptr(6608, 6618, 1), new Range16.ptr(6622, 6623, 1)]), sliceType$1.nil, 0);
		_Nko = new RangeTable.ptr(new sliceType([new Range16.ptr(1984, 2042, 1)]), sliceType$1.nil, 0);
		_Ogham = new RangeTable.ptr(new sliceType([new Range16.ptr(5760, 5788, 1)]), sliceType$1.nil, 0);
		_Ol_Chiki = new RangeTable.ptr(new sliceType([new Range16.ptr(7248, 7295, 1)]), sliceType$1.nil, 0);
		_Old_Hungarian = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(68736, 68786, 1), new Range32.ptr(68800, 68850, 1), new Range32.ptr(68858, 68863, 1)]), 0);
		_Old_Italic = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(66304, 66339, 1)]), 0);
		_Old_North_Arabian = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(68224, 68255, 1)]), 0);
		_Old_Permic = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(66384, 66426, 1)]), 0);
		_Old_Persian = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(66464, 66499, 1), new Range32.ptr(66504, 66517, 1)]), 0);
		_Old_South_Arabian = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(68192, 68223, 1)]), 0);
		_Old_Turkic = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(68608, 68680, 1)]), 0);
		_Oriya = new RangeTable.ptr(new sliceType([new Range16.ptr(2817, 2819, 1), new Range16.ptr(2821, 2828, 1), new Range16.ptr(2831, 2832, 1), new Range16.ptr(2835, 2856, 1), new Range16.ptr(2858, 2864, 1), new Range16.ptr(2866, 2867, 1), new Range16.ptr(2869, 2873, 1), new Range16.ptr(2876, 2884, 1), new Range16.ptr(2887, 2888, 1), new Range16.ptr(2891, 2893, 1), new Range16.ptr(2902, 2903, 1), new Range16.ptr(2908, 2909, 1), new Range16.ptr(2911, 2915, 1), new Range16.ptr(2918, 2935, 1)]), sliceType$1.nil, 0);
		_Osmanya = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(66688, 66717, 1), new Range32.ptr(66720, 66729, 1)]), 0);
		_Pahawh_Hmong = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(92928, 92997, 1), new Range32.ptr(93008, 93017, 1), new Range32.ptr(93019, 93025, 1), new Range32.ptr(93027, 93047, 1), new Range32.ptr(93053, 93071, 1)]), 0);
		_Palmyrene = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(67680, 67711, 1)]), 0);
		_Pau_Cin_Hau = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(72384, 72440, 1)]), 0);
		_Phags_Pa = new RangeTable.ptr(new sliceType([new Range16.ptr(43072, 43127, 1)]), sliceType$1.nil, 0);
		_Phoenician = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(67840, 67867, 1), new Range32.ptr(67871, 67871, 1)]), 0);
		_Psalter_Pahlavi = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(68480, 68497, 1), new Range32.ptr(68505, 68508, 1), new Range32.ptr(68521, 68527, 1)]), 0);
		_Rejang = new RangeTable.ptr(new sliceType([new Range16.ptr(43312, 43347, 1), new Range16.ptr(43359, 43359, 1)]), sliceType$1.nil, 0);
		_Runic = new RangeTable.ptr(new sliceType([new Range16.ptr(5792, 5866, 1), new Range16.ptr(5870, 5880, 1)]), sliceType$1.nil, 0);
		_Samaritan = new RangeTable.ptr(new sliceType([new Range16.ptr(2048, 2093, 1), new Range16.ptr(2096, 2110, 1)]), sliceType$1.nil, 0);
		_Saurashtra = new RangeTable.ptr(new sliceType([new Range16.ptr(43136, 43204, 1), new Range16.ptr(43214, 43225, 1)]), sliceType$1.nil, 0);
		_Sharada = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(70016, 70093, 1), new Range32.ptr(70096, 70111, 1)]), 0);
		_Shavian = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(66640, 66687, 1)]), 0);
		_Siddham = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(71040, 71093, 1), new Range32.ptr(71096, 71133, 1)]), 0);
		_SignWriting = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(120832, 121483, 1), new Range32.ptr(121499, 121503, 1), new Range32.ptr(121505, 121519, 1)]), 0);
		_Sinhala = new RangeTable.ptr(new sliceType([new Range16.ptr(3458, 3459, 1), new Range16.ptr(3461, 3478, 1), new Range16.ptr(3482, 3505, 1), new Range16.ptr(3507, 3515, 1), new Range16.ptr(3517, 3517, 1), new Range16.ptr(3520, 3526, 1), new Range16.ptr(3530, 3530, 1), new Range16.ptr(3535, 3540, 1), new Range16.ptr(3542, 3542, 1), new Range16.ptr(3544, 3551, 1), new Range16.ptr(3558, 3567, 1), new Range16.ptr(3570, 3572, 1)]), new sliceType$1([new Range32.ptr(70113, 70132, 1)]), 0);
		_Sora_Sompeng = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(69840, 69864, 1), new Range32.ptr(69872, 69881, 1)]), 0);
		_Sundanese = new RangeTable.ptr(new sliceType([new Range16.ptr(7040, 7103, 1), new Range16.ptr(7360, 7367, 1)]), sliceType$1.nil, 0);
		_Syloti_Nagri = new RangeTable.ptr(new sliceType([new Range16.ptr(43008, 43051, 1)]), sliceType$1.nil, 0);
		_Syriac = new RangeTable.ptr(new sliceType([new Range16.ptr(1792, 1805, 1), new Range16.ptr(1807, 1866, 1), new Range16.ptr(1869, 1871, 1)]), sliceType$1.nil, 0);
		_Tagalog = new RangeTable.ptr(new sliceType([new Range16.ptr(5888, 5900, 1), new Range16.ptr(5902, 5908, 1)]), sliceType$1.nil, 0);
		_Tagbanwa = new RangeTable.ptr(new sliceType([new Range16.ptr(5984, 5996, 1), new Range16.ptr(5998, 6000, 1), new Range16.ptr(6002, 6003, 1)]), sliceType$1.nil, 0);
		_Tai_Le = new RangeTable.ptr(new sliceType([new Range16.ptr(6480, 6509, 1), new Range16.ptr(6512, 6516, 1)]), sliceType$1.nil, 0);
		_Tai_Tham = new RangeTable.ptr(new sliceType([new Range16.ptr(6688, 6750, 1), new Range16.ptr(6752, 6780, 1), new Range16.ptr(6783, 6793, 1), new Range16.ptr(6800, 6809, 1), new Range16.ptr(6816, 6829, 1)]), sliceType$1.nil, 0);
		_Tai_Viet = new RangeTable.ptr(new sliceType([new Range16.ptr(43648, 43714, 1), new Range16.ptr(43739, 43743, 1)]), sliceType$1.nil, 0);
		_Takri = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(71296, 71351, 1), new Range32.ptr(71360, 71369, 1)]), 0);
		_Tamil = new RangeTable.ptr(new sliceType([new Range16.ptr(2946, 2947, 1), new Range16.ptr(2949, 2954, 1), new Range16.ptr(2958, 2960, 1), new Range16.ptr(2962, 2965, 1), new Range16.ptr(2969, 2970, 1), new Range16.ptr(2972, 2972, 1), new Range16.ptr(2974, 2975, 1), new Range16.ptr(2979, 2980, 1), new Range16.ptr(2984, 2986, 1), new Range16.ptr(2990, 3001, 1), new Range16.ptr(3006, 3010, 1), new Range16.ptr(3014, 3016, 1), new Range16.ptr(3018, 3021, 1), new Range16.ptr(3024, 3024, 1), new Range16.ptr(3031, 3031, 1), new Range16.ptr(3046, 3066, 1)]), sliceType$1.nil, 0);
		_Telugu = new RangeTable.ptr(new sliceType([new Range16.ptr(3072, 3075, 1), new Range16.ptr(3077, 3084, 1), new Range16.ptr(3086, 3088, 1), new Range16.ptr(3090, 3112, 1), new Range16.ptr(3114, 3129, 1), new Range16.ptr(3133, 3140, 1), new Range16.ptr(3142, 3144, 1), new Range16.ptr(3146, 3149, 1), new Range16.ptr(3157, 3158, 1), new Range16.ptr(3160, 3162, 1), new Range16.ptr(3168, 3171, 1), new Range16.ptr(3174, 3183, 1), new Range16.ptr(3192, 3199, 1)]), sliceType$1.nil, 0);
		_Thaana = new RangeTable.ptr(new sliceType([new Range16.ptr(1920, 1969, 1)]), sliceType$1.nil, 0);
		_Thai = new RangeTable.ptr(new sliceType([new Range16.ptr(3585, 3642, 1), new Range16.ptr(3648, 3675, 1)]), sliceType$1.nil, 0);
		_Tibetan = new RangeTable.ptr(new sliceType([new Range16.ptr(3840, 3911, 1), new Range16.ptr(3913, 3948, 1), new Range16.ptr(3953, 3991, 1), new Range16.ptr(3993, 4028, 1), new Range16.ptr(4030, 4044, 1), new Range16.ptr(4046, 4052, 1), new Range16.ptr(4057, 4058, 1)]), sliceType$1.nil, 0);
		_Tifinagh = new RangeTable.ptr(new sliceType([new Range16.ptr(11568, 11623, 1), new Range16.ptr(11631, 11632, 1), new Range16.ptr(11647, 11647, 1)]), sliceType$1.nil, 0);
		_Tirhuta = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(70784, 70855, 1), new Range32.ptr(70864, 70873, 1)]), 0);
		_Ugaritic = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(66432, 66461, 1), new Range32.ptr(66463, 66463, 1)]), 0);
		_Vai = new RangeTable.ptr(new sliceType([new Range16.ptr(42240, 42539, 1)]), sliceType$1.nil, 0);
		_Warang_Citi = new RangeTable.ptr(new sliceType([]), new sliceType$1([new Range32.ptr(71840, 71922, 1), new Range32.ptr(71935, 71935, 1)]), 0);
		_Yi = new RangeTable.ptr(new sliceType([new Range16.ptr(40960, 42124, 1), new Range16.ptr(42128, 42182, 1)]), sliceType$1.nil, 0);
		$pkg.Ahom = _Ahom;
		$pkg.Anatolian_Hieroglyphs = _Anatolian_Hieroglyphs;
		$pkg.Arabic = _Arabic;
		$pkg.Armenian = _Armenian;
		$pkg.Avestan = _Avestan;
		$pkg.Balinese = _Balinese;
		$pkg.Bamum = _Bamum;
		$pkg.Bassa_Vah = _Bassa_Vah;
		$pkg.Batak = _Batak;
		$pkg.Bengali = _Bengali;
		$pkg.Bopomofo = _Bopomofo;
		$pkg.Brahmi = _Brahmi;
		$pkg.Braille = _Braille;
		$pkg.Buginese = _Buginese;
		$pkg.Buhid = _Buhid;
		$pkg.Canadian_Aboriginal = _Canadian_Aboriginal;
		$pkg.Carian = _Carian;
		$pkg.Caucasian_Albanian = _Caucasian_Albanian;
		$pkg.Chakma = _Chakma;
		$pkg.Cham = _Cham;
		$pkg.Cherokee = _Cherokee;
		$pkg.Common = _Common;
		$pkg.Coptic = _Coptic;
		$pkg.Cuneiform = _Cuneiform;
		$pkg.Cypriot = _Cypriot;
		$pkg.Cyrillic = _Cyrillic;
		$pkg.Deseret = _Deseret;
		$pkg.Devanagari = _Devanagari;
		$pkg.Duployan = _Duployan;
		$pkg.Egyptian_Hieroglyphs = _Egyptian_Hieroglyphs;
		$pkg.Elbasan = _Elbasan;
		$pkg.Ethiopic = _Ethiopic;
		$pkg.Georgian = _Georgian;
		$pkg.Glagolitic = _Glagolitic;
		$pkg.Gothic = _Gothic;
		$pkg.Grantha = _Grantha;
		$pkg.Greek = _Greek;
		$pkg.Gujarati = _Gujarati;
		$pkg.Gurmukhi = _Gurmukhi;
		$pkg.Han = _Han;
		$pkg.Hangul = _Hangul;
		$pkg.Hanunoo = _Hanunoo;
		$pkg.Hatran = _Hatran;
		$pkg.Hebrew = _Hebrew;
		$pkg.Hiragana = _Hiragana;
		$pkg.Imperial_Aramaic = _Imperial_Aramaic;
		$pkg.Inherited = _Inherited;
		$pkg.Inscriptional_Pahlavi = _Inscriptional_Pahlavi;
		$pkg.Inscriptional_Parthian = _Inscriptional_Parthian;
		$pkg.Javanese = _Javanese;
		$pkg.Kaithi = _Kaithi;
		$pkg.Kannada = _Kannada;
		$pkg.Katakana = _Katakana;
		$pkg.Kayah_Li = _Kayah_Li;
		$pkg.Kharoshthi = _Kharoshthi;
		$pkg.Khmer = _Khmer;
		$pkg.Khojki = _Khojki;
		$pkg.Khudawadi = _Khudawadi;
		$pkg.Lao = _Lao;
		$pkg.Latin = _Latin;
		$pkg.Lepcha = _Lepcha;
		$pkg.Limbu = _Limbu;
		$pkg.Linear_A = _Linear_A;
		$pkg.Linear_B = _Linear_B;
		$pkg.Lisu = _Lisu;
		$pkg.Lycian = _Lycian;
		$pkg.Lydian = _Lydian;
		$pkg.Mahajani = _Mahajani;
		$pkg.Malayalam = _Malayalam;
		$pkg.Mandaic = _Mandaic;
		$pkg.Manichaean = _Manichaean;
		$pkg.Meetei_Mayek = _Meetei_Mayek;
		$pkg.Mende_Kikakui = _Mende_Kikakui;
		$pkg.Meroitic_Cursive = _Meroitic_Cursive;
		$pkg.Meroitic_Hieroglyphs = _Meroitic_Hieroglyphs;
		$pkg.Miao = _Miao;
		$pkg.Modi = _Modi;
		$pkg.Mongolian = _Mongolian;
		$pkg.Mro = _Mro;
		$pkg.Multani = _Multani;
		$pkg.Myanmar = _Myanmar;
		$pkg.Nabataean = _Nabataean;
		$pkg.New_Tai_Lue = _New_Tai_Lue;
		$pkg.Nko = _Nko;
		$pkg.Ogham = _Ogham;
		$pkg.Ol_Chiki = _Ol_Chiki;
		$pkg.Old_Hungarian = _Old_Hungarian;
		$pkg.Old_Italic = _Old_Italic;
		$pkg.Old_North_Arabian = _Old_North_Arabian;
		$pkg.Old_Permic = _Old_Permic;
		$pkg.Old_Persian = _Old_Persian;
		$pkg.Old_South_Arabian = _Old_South_Arabian;
		$pkg.Old_Turkic = _Old_Turkic;
		$pkg.Oriya = _Oriya;
		$pkg.Osmanya = _Osmanya;
		$pkg.Pahawh_Hmong = _Pahawh_Hmong;
		$pkg.Palmyrene = _Palmyrene;
		$pkg.Pau_Cin_Hau = _Pau_Cin_Hau;
		$pkg.Phags_Pa = _Phags_Pa;
		$pkg.Phoenician = _Phoenician;
		$pkg.Psalter_Pahlavi = _Psalter_Pahlavi;
		$pkg.Rejang = _Rejang;
		$pkg.Runic = _Runic;
		$pkg.Samaritan = _Samaritan;
		$pkg.Saurashtra = _Saurashtra;
		$pkg.Sharada = _Sharada;
		$pkg.Shavian = _Shavian;
		$pkg.Siddham = _Siddham;
		$pkg.SignWriting = _SignWriting;
		$pkg.Sinhala = _Sinhala;
		$pkg.Sora_Sompeng = _Sora_Sompeng;
		$pkg.Sundanese = _Sundanese;
		$pkg.Syloti_Nagri = _Syloti_Nagri;
		$pkg.Syriac = _Syriac;
		$pkg.Tagalog = _Tagalog;
		$pkg.Tagbanwa = _Tagbanwa;
		$pkg.Tai_Le = _Tai_Le;
		$pkg.Tai_Tham = _Tai_Tham;
		$pkg.Tai_Viet = _Tai_Viet;
		$pkg.Takri = _Takri;
		$pkg.Tamil = _Tamil;
		$pkg.Telugu = _Telugu;
		$pkg.Thaana = _Thaana;
		$pkg.Thai = _Thai;
		$pkg.Tibetan = _Tibetan;
		$pkg.Tifinagh = _Tifinagh;
		$pkg.Tirhuta = _Tirhuta;
		$pkg.Ugaritic = _Ugaritic;
		$pkg.Vai = _Vai;
		$pkg.Warang_Citi = _Warang_Citi;
		$pkg.Yi = _Yi;
		$pkg.Scripts = $makeMap($String.keyFor, [{ k: "Ahom", v: $pkg.Ahom }, { k: "Anatolian_Hieroglyphs", v: $pkg.Anatolian_Hieroglyphs }, { k: "Arabic", v: $pkg.Arabic }, { k: "Armenian", v: $pkg.Armenian }, { k: "Avestan", v: $pkg.Avestan }, { k: "Balinese", v: $pkg.Balinese }, { k: "Bamum", v: $pkg.Bamum }, { k: "Bassa_Vah", v: $pkg.Bassa_Vah }, { k: "Batak", v: $pkg.Batak }, { k: "Bengali", v: $pkg.Bengali }, { k: "Bopomofo", v: $pkg.Bopomofo }, { k: "Brahmi", v: $pkg.Brahmi }, { k: "Braille", v: $pkg.Braille }, { k: "Buginese", v: $pkg.Buginese }, { k: "Buhid", v: $pkg.Buhid }, { k: "Canadian_Aboriginal", v: $pkg.Canadian_Aboriginal }, { k: "Carian", v: $pkg.Carian }, { k: "Caucasian_Albanian", v: $pkg.Caucasian_Albanian }, { k: "Chakma", v: $pkg.Chakma }, { k: "Cham", v: $pkg.Cham }, { k: "Cherokee", v: $pkg.Cherokee }, { k: "Common", v: $pkg.Common }, { k: "Coptic", v: $pkg.Coptic }, { k: "Cuneiform", v: $pkg.Cuneiform }, { k: "Cypriot", v: $pkg.Cypriot }, { k: "Cyrillic", v: $pkg.Cyrillic }, { k: "Deseret", v: $pkg.Deseret }, { k: "Devanagari", v: $pkg.Devanagari }, { k: "Duployan", v: $pkg.Duployan }, { k: "Egyptian_Hieroglyphs", v: $pkg.Egyptian_Hieroglyphs }, { k: "Elbasan", v: $pkg.Elbasan }, { k: "Ethiopic", v: $pkg.Ethiopic }, { k: "Georgian", v: $pkg.Georgian }, { k: "Glagolitic", v: $pkg.Glagolitic }, { k: "Gothic", v: $pkg.Gothic }, { k: "Grantha", v: $pkg.Grantha }, { k: "Greek", v: $pkg.Greek }, { k: "Gujarati", v: $pkg.Gujarati }, { k: "Gurmukhi", v: $pkg.Gurmukhi }, { k: "Han", v: $pkg.Han }, { k: "Hangul", v: $pkg.Hangul }, { k: "Hanunoo", v: $pkg.Hanunoo }, { k: "Hatran", v: $pkg.Hatran }, { k: "Hebrew", v: $pkg.Hebrew }, { k: "Hiragana", v: $pkg.Hiragana }, { k: "Imperial_Aramaic", v: $pkg.Imperial_Aramaic }, { k: "Inherited", v: $pkg.Inherited }, { k: "Inscriptional_Pahlavi", v: $pkg.Inscriptional_Pahlavi }, { k: "Inscriptional_Parthian", v: $pkg.Inscriptional_Parthian }, { k: "Javanese", v: $pkg.Javanese }, { k: "Kaithi", v: $pkg.Kaithi }, { k: "Kannada", v: $pkg.Kannada }, { k: "Katakana", v: $pkg.Katakana }, { k: "Kayah_Li", v: $pkg.Kayah_Li }, { k: "Kharoshthi", v: $pkg.Kharoshthi }, { k: "Khmer", v: $pkg.Khmer }, { k: "Khojki", v: $pkg.Khojki }, { k: "Khudawadi", v: $pkg.Khudawadi }, { k: "Lao", v: $pkg.Lao }, { k: "Latin", v: $pkg.Latin }, { k: "Lepcha", v: $pkg.Lepcha }, { k: "Limbu", v: $pkg.Limbu }, { k: "Linear_A", v: $pkg.Linear_A }, { k: "Linear_B", v: $pkg.Linear_B }, { k: "Lisu", v: $pkg.Lisu }, { k: "Lycian", v: $pkg.Lycian }, { k: "Lydian", v: $pkg.Lydian }, { k: "Mahajani", v: $pkg.Mahajani }, { k: "Malayalam", v: $pkg.Malayalam }, { k: "Mandaic", v: $pkg.Mandaic }, { k: "Manichaean", v: $pkg.Manichaean }, { k: "Meetei_Mayek", v: $pkg.Meetei_Mayek }, { k: "Mende_Kikakui", v: $pkg.Mende_Kikakui }, { k: "Meroitic_Cursive", v: $pkg.Meroitic_Cursive }, { k: "Meroitic_Hieroglyphs", v: $pkg.Meroitic_Hieroglyphs }, { k: "Miao", v: $pkg.Miao }, { k: "Modi", v: $pkg.Modi }, { k: "Mongolian", v: $pkg.Mongolian }, { k: "Mro", v: $pkg.Mro }, { k: "Multani", v: $pkg.Multani }, { k: "Myanmar", v: $pkg.Myanmar }, { k: "Nabataean", v: $pkg.Nabataean }, { k: "New_Tai_Lue", v: $pkg.New_Tai_Lue }, { k: "Nko", v: $pkg.Nko }, { k: "Ogham", v: $pkg.Ogham }, { k: "Ol_Chiki", v: $pkg.Ol_Chiki }, { k: "Old_Hungarian", v: $pkg.Old_Hungarian }, { k: "Old_Italic", v: $pkg.Old_Italic }, { k: "Old_North_Arabian", v: $pkg.Old_North_Arabian }, { k: "Old_Permic", v: $pkg.Old_Permic }, { k: "Old_Persian", v: $pkg.Old_Persian }, { k: "Old_South_Arabian", v: $pkg.Old_South_Arabian }, { k: "Old_Turkic", v: $pkg.Old_Turkic }, { k: "Oriya", v: $pkg.Oriya }, { k: "Osmanya", v: $pkg.Osmanya }, { k: "Pahawh_Hmong", v: $pkg.Pahawh_Hmong }, { k: "Palmyrene", v: $pkg.Palmyrene }, { k: "Pau_Cin_Hau", v: $pkg.Pau_Cin_Hau }, { k: "Phags_Pa", v: $pkg.Phags_Pa }, { k: "Phoenician", v: $pkg.Phoenician }, { k: "Psalter_Pahlavi", v: $pkg.Psalter_Pahlavi }, { k: "Rejang", v: $pkg.Rejang }, { k: "Runic", v: $pkg.Runic }, { k: "Samaritan", v: $pkg.Samaritan }, { k: "Saurashtra", v: $pkg.Saurashtra }, { k: "Sharada", v: $pkg.Sharada }, { k: "Shavian", v: $pkg.Shavian }, { k: "Siddham", v: $pkg.Siddham }, { k: "SignWriting", v: $pkg.SignWriting }, { k: "Sinhala", v: $pkg.Sinhala }, { k: "Sora_Sompeng", v: $pkg.Sora_Sompeng }, { k: "Sundanese", v: $pkg.Sundanese }, { k: "Syloti_Nagri", v: $pkg.Syloti_Nagri }, { k: "Syriac", v: $pkg.Syriac }, { k: "Tagalog", v: $pkg.Tagalog }, { k: "Tagbanwa", v: $pkg.Tagbanwa }, { k: "Tai_Le", v: $pkg.Tai_Le }, { k: "Tai_Tham", v: $pkg.Tai_Tham }, { k: "Tai_Viet", v: $pkg.Tai_Viet }, { k: "Takri", v: $pkg.Takri }, { k: "Tamil", v: $pkg.Tamil }, { k: "Telugu", v: $pkg.Telugu }, { k: "Thaana", v: $pkg.Thaana }, { k: "Thai", v: $pkg.Thai }, { k: "Tibetan", v: $pkg.Tibetan }, { k: "Tifinagh", v: $pkg.Tifinagh }, { k: "Tirhuta", v: $pkg.Tirhuta }, { k: "Ugaritic", v: $pkg.Ugaritic }, { k: "Vai", v: $pkg.Vai }, { k: "Warang_Citi", v: $pkg.Warang_Citi }, { k: "Yi", v: $pkg.Yi }]);
		_White_Space = new RangeTable.ptr(new sliceType([new Range16.ptr(9, 13, 1), new Range16.ptr(32, 32, 1), new Range16.ptr(133, 133, 1), new Range16.ptr(160, 160, 1), new Range16.ptr(5760, 5760, 1), new Range16.ptr(8192, 8202, 1), new Range16.ptr(8232, 8233, 1), new Range16.ptr(8239, 8239, 1), new Range16.ptr(8287, 8287, 1), new Range16.ptr(12288, 12288, 1)]), sliceType$1.nil, 4);
		$pkg.White_Space = _White_Space;
		_CaseRanges = new sliceType$3([new CaseRange.ptr(65, 90, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(97, 122, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(181, 181, $toNativeArray($kindInt32, [743, 0, 743])), new CaseRange.ptr(192, 214, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(216, 222, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(224, 246, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(248, 254, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(255, 255, $toNativeArray($kindInt32, [121, 0, 121])), new CaseRange.ptr(256, 303, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(304, 304, $toNativeArray($kindInt32, [0, -199, 0])), new CaseRange.ptr(305, 305, $toNativeArray($kindInt32, [-232, 0, -232])), new CaseRange.ptr(306, 311, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(313, 328, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(330, 375, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(376, 376, $toNativeArray($kindInt32, [0, -121, 0])), new CaseRange.ptr(377, 382, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(383, 383, $toNativeArray($kindInt32, [-300, 0, -300])), new CaseRange.ptr(384, 384, $toNativeArray($kindInt32, [195, 0, 195])), new CaseRange.ptr(385, 385, $toNativeArray($kindInt32, [0, 210, 0])), new CaseRange.ptr(386, 389, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(390, 390, $toNativeArray($kindInt32, [0, 206, 0])), new CaseRange.ptr(391, 392, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(393, 394, $toNativeArray($kindInt32, [0, 205, 0])), new CaseRange.ptr(395, 396, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(398, 398, $toNativeArray($kindInt32, [0, 79, 0])), new CaseRange.ptr(399, 399, $toNativeArray($kindInt32, [0, 202, 0])), new CaseRange.ptr(400, 400, $toNativeArray($kindInt32, [0, 203, 0])), new CaseRange.ptr(401, 402, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(403, 403, $toNativeArray($kindInt32, [0, 205, 0])), new CaseRange.ptr(404, 404, $toNativeArray($kindInt32, [0, 207, 0])), new CaseRange.ptr(405, 405, $toNativeArray($kindInt32, [97, 0, 97])), new CaseRange.ptr(406, 406, $toNativeArray($kindInt32, [0, 211, 0])), new CaseRange.ptr(407, 407, $toNativeArray($kindInt32, [0, 209, 0])), new CaseRange.ptr(408, 409, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(410, 410, $toNativeArray($kindInt32, [163, 0, 163])), new CaseRange.ptr(412, 412, $toNativeArray($kindInt32, [0, 211, 0])), new CaseRange.ptr(413, 413, $toNativeArray($kindInt32, [0, 213, 0])), new CaseRange.ptr(414, 414, $toNativeArray($kindInt32, [130, 0, 130])), new CaseRange.ptr(415, 415, $toNativeArray($kindInt32, [0, 214, 0])), new CaseRange.ptr(416, 421, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(422, 422, $toNativeArray($kindInt32, [0, 218, 0])), new CaseRange.ptr(423, 424, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(425, 425, $toNativeArray($kindInt32, [0, 218, 0])), new CaseRange.ptr(428, 429, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(430, 430, $toNativeArray($kindInt32, [0, 218, 0])), new CaseRange.ptr(431, 432, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(433, 434, $toNativeArray($kindInt32, [0, 217, 0])), new CaseRange.ptr(435, 438, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(439, 439, $toNativeArray($kindInt32, [0, 219, 0])), new CaseRange.ptr(440, 441, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(444, 445, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(447, 447, $toNativeArray($kindInt32, [56, 0, 56])), new CaseRange.ptr(452, 452, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(453, 453, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(454, 454, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(455, 455, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(456, 456, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(457, 457, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(458, 458, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(459, 459, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(460, 460, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(461, 476, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(477, 477, $toNativeArray($kindInt32, [-79, 0, -79])), new CaseRange.ptr(478, 495, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(497, 497, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(498, 498, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(499, 499, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(500, 501, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(502, 502, $toNativeArray($kindInt32, [0, -97, 0])), new CaseRange.ptr(503, 503, $toNativeArray($kindInt32, [0, -56, 0])), new CaseRange.ptr(504, 543, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(544, 544, $toNativeArray($kindInt32, [0, -130, 0])), new CaseRange.ptr(546, 563, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(570, 570, $toNativeArray($kindInt32, [0, 10795, 0])), new CaseRange.ptr(571, 572, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(573, 573, $toNativeArray($kindInt32, [0, -163, 0])), new CaseRange.ptr(574, 574, $toNativeArray($kindInt32, [0, 10792, 0])), new CaseRange.ptr(575, 576, $toNativeArray($kindInt32, [10815, 0, 10815])), new CaseRange.ptr(577, 578, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(579, 579, $toNativeArray($kindInt32, [0, -195, 0])), new CaseRange.ptr(580, 580, $toNativeArray($kindInt32, [0, 69, 0])), new CaseRange.ptr(581, 581, $toNativeArray($kindInt32, [0, 71, 0])), new CaseRange.ptr(582, 591, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(592, 592, $toNativeArray($kindInt32, [10783, 0, 10783])), new CaseRange.ptr(593, 593, $toNativeArray($kindInt32, [10780, 0, 10780])), new CaseRange.ptr(594, 594, $toNativeArray($kindInt32, [10782, 0, 10782])), new CaseRange.ptr(595, 595, $toNativeArray($kindInt32, [-210, 0, -210])), new CaseRange.ptr(596, 596, $toNativeArray($kindInt32, [-206, 0, -206])), new CaseRange.ptr(598, 599, $toNativeArray($kindInt32, [-205, 0, -205])), new CaseRange.ptr(601, 601, $toNativeArray($kindInt32, [-202, 0, -202])), new CaseRange.ptr(603, 603, $toNativeArray($kindInt32, [-203, 0, -203])), new CaseRange.ptr(604, 604, $toNativeArray($kindInt32, [42319, 0, 42319])), new CaseRange.ptr(608, 608, $toNativeArray($kindInt32, [-205, 0, -205])), new CaseRange.ptr(609, 609, $toNativeArray($kindInt32, [42315, 0, 42315])), new CaseRange.ptr(611, 611, $toNativeArray($kindInt32, [-207, 0, -207])), new CaseRange.ptr(613, 613, $toNativeArray($kindInt32, [42280, 0, 42280])), new CaseRange.ptr(614, 614, $toNativeArray($kindInt32, [42308, 0, 42308])), new CaseRange.ptr(616, 616, $toNativeArray($kindInt32, [-209, 0, -209])), new CaseRange.ptr(617, 617, $toNativeArray($kindInt32, [-211, 0, -211])), new CaseRange.ptr(619, 619, $toNativeArray($kindInt32, [10743, 0, 10743])), new CaseRange.ptr(620, 620, $toNativeArray($kindInt32, [42305, 0, 42305])), new CaseRange.ptr(623, 623, $toNativeArray($kindInt32, [-211, 0, -211])), new CaseRange.ptr(625, 625, $toNativeArray($kindInt32, [10749, 0, 10749])), new CaseRange.ptr(626, 626, $toNativeArray($kindInt32, [-213, 0, -213])), new CaseRange.ptr(629, 629, $toNativeArray($kindInt32, [-214, 0, -214])), new CaseRange.ptr(637, 637, $toNativeArray($kindInt32, [10727, 0, 10727])), new CaseRange.ptr(640, 640, $toNativeArray($kindInt32, [-218, 0, -218])), new CaseRange.ptr(643, 643, $toNativeArray($kindInt32, [-218, 0, -218])), new CaseRange.ptr(647, 647, $toNativeArray($kindInt32, [42282, 0, 42282])), new CaseRange.ptr(648, 648, $toNativeArray($kindInt32, [-218, 0, -218])), new CaseRange.ptr(649, 649, $toNativeArray($kindInt32, [-69, 0, -69])), new CaseRange.ptr(650, 651, $toNativeArray($kindInt32, [-217, 0, -217])), new CaseRange.ptr(652, 652, $toNativeArray($kindInt32, [-71, 0, -71])), new CaseRange.ptr(658, 658, $toNativeArray($kindInt32, [-219, 0, -219])), new CaseRange.ptr(669, 669, $toNativeArray($kindInt32, [42261, 0, 42261])), new CaseRange.ptr(670, 670, $toNativeArray($kindInt32, [42258, 0, 42258])), new CaseRange.ptr(837, 837, $toNativeArray($kindInt32, [84, 0, 84])), new CaseRange.ptr(880, 883, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(886, 887, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(891, 893, $toNativeArray($kindInt32, [130, 0, 130])), new CaseRange.ptr(895, 895, $toNativeArray($kindInt32, [0, 116, 0])), new CaseRange.ptr(902, 902, $toNativeArray($kindInt32, [0, 38, 0])), new CaseRange.ptr(904, 906, $toNativeArray($kindInt32, [0, 37, 0])), new CaseRange.ptr(908, 908, $toNativeArray($kindInt32, [0, 64, 0])), new CaseRange.ptr(910, 911, $toNativeArray($kindInt32, [0, 63, 0])), new CaseRange.ptr(913, 929, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(931, 939, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(940, 940, $toNativeArray($kindInt32, [-38, 0, -38])), new CaseRange.ptr(941, 943, $toNativeArray($kindInt32, [-37, 0, -37])), new CaseRange.ptr(945, 961, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(962, 962, $toNativeArray($kindInt32, [-31, 0, -31])), new CaseRange.ptr(963, 971, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(972, 972, $toNativeArray($kindInt32, [-64, 0, -64])), new CaseRange.ptr(973, 974, $toNativeArray($kindInt32, [-63, 0, -63])), new CaseRange.ptr(975, 975, $toNativeArray($kindInt32, [0, 8, 0])), new CaseRange.ptr(976, 976, $toNativeArray($kindInt32, [-62, 0, -62])), new CaseRange.ptr(977, 977, $toNativeArray($kindInt32, [-57, 0, -57])), new CaseRange.ptr(981, 981, $toNativeArray($kindInt32, [-47, 0, -47])), new CaseRange.ptr(982, 982, $toNativeArray($kindInt32, [-54, 0, -54])), new CaseRange.ptr(983, 983, $toNativeArray($kindInt32, [-8, 0, -8])), new CaseRange.ptr(984, 1007, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1008, 1008, $toNativeArray($kindInt32, [-86, 0, -86])), new CaseRange.ptr(1009, 1009, $toNativeArray($kindInt32, [-80, 0, -80])), new CaseRange.ptr(1010, 1010, $toNativeArray($kindInt32, [7, 0, 7])), new CaseRange.ptr(1011, 1011, $toNativeArray($kindInt32, [-116, 0, -116])), new CaseRange.ptr(1012, 1012, $toNativeArray($kindInt32, [0, -60, 0])), new CaseRange.ptr(1013, 1013, $toNativeArray($kindInt32, [-96, 0, -96])), new CaseRange.ptr(1015, 1016, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1017, 1017, $toNativeArray($kindInt32, [0, -7, 0])), new CaseRange.ptr(1018, 1019, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1021, 1023, $toNativeArray($kindInt32, [0, -130, 0])), new CaseRange.ptr(1024, 1039, $toNativeArray($kindInt32, [0, 80, 0])), new CaseRange.ptr(1040, 1071, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(1072, 1103, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(1104, 1119, $toNativeArray($kindInt32, [-80, 0, -80])), new CaseRange.ptr(1120, 1153, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1162, 1215, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1216, 1216, $toNativeArray($kindInt32, [0, 15, 0])), new CaseRange.ptr(1217, 1230, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1231, 1231, $toNativeArray($kindInt32, [-15, 0, -15])), new CaseRange.ptr(1232, 1327, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1329, 1366, $toNativeArray($kindInt32, [0, 48, 0])), new CaseRange.ptr(1377, 1414, $toNativeArray($kindInt32, [-48, 0, -48])), new CaseRange.ptr(4256, 4293, $toNativeArray($kindInt32, [0, 7264, 0])), new CaseRange.ptr(4295, 4295, $toNativeArray($kindInt32, [0, 7264, 0])), new CaseRange.ptr(4301, 4301, $toNativeArray($kindInt32, [0, 7264, 0])), new CaseRange.ptr(5024, 5103, $toNativeArray($kindInt32, [0, 38864, 0])), new CaseRange.ptr(5104, 5109, $toNativeArray($kindInt32, [0, 8, 0])), new CaseRange.ptr(5112, 5117, $toNativeArray($kindInt32, [-8, 0, -8])), new CaseRange.ptr(7545, 7545, $toNativeArray($kindInt32, [35332, 0, 35332])), new CaseRange.ptr(7549, 7549, $toNativeArray($kindInt32, [3814, 0, 3814])), new CaseRange.ptr(7680, 7829, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(7835, 7835, $toNativeArray($kindInt32, [-59, 0, -59])), new CaseRange.ptr(7838, 7838, $toNativeArray($kindInt32, [0, -7615, 0])), new CaseRange.ptr(7840, 7935, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(7936, 7943, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7944, 7951, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(7952, 7957, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7960, 7965, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(7968, 7975, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7976, 7983, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(7984, 7991, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7992, 7999, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8000, 8005, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8008, 8013, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8017, 8017, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8019, 8019, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8021, 8021, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8023, 8023, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8025, 8025, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8027, 8027, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8029, 8029, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8031, 8031, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8032, 8039, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8040, 8047, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8048, 8049, $toNativeArray($kindInt32, [74, 0, 74])), new CaseRange.ptr(8050, 8053, $toNativeArray($kindInt32, [86, 0, 86])), new CaseRange.ptr(8054, 8055, $toNativeArray($kindInt32, [100, 0, 100])), new CaseRange.ptr(8056, 8057, $toNativeArray($kindInt32, [128, 0, 128])), new CaseRange.ptr(8058, 8059, $toNativeArray($kindInt32, [112, 0, 112])), new CaseRange.ptr(8060, 8061, $toNativeArray($kindInt32, [126, 0, 126])), new CaseRange.ptr(8064, 8071, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8072, 8079, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8080, 8087, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8088, 8095, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8096, 8103, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8104, 8111, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8112, 8113, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8115, 8115, $toNativeArray($kindInt32, [9, 0, 9])), new CaseRange.ptr(8120, 8121, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8122, 8123, $toNativeArray($kindInt32, [0, -74, 0])), new CaseRange.ptr(8124, 8124, $toNativeArray($kindInt32, [0, -9, 0])), new CaseRange.ptr(8126, 8126, $toNativeArray($kindInt32, [-7205, 0, -7205])), new CaseRange.ptr(8131, 8131, $toNativeArray($kindInt32, [9, 0, 9])), new CaseRange.ptr(8136, 8139, $toNativeArray($kindInt32, [0, -86, 0])), new CaseRange.ptr(8140, 8140, $toNativeArray($kindInt32, [0, -9, 0])), new CaseRange.ptr(8144, 8145, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8152, 8153, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8154, 8155, $toNativeArray($kindInt32, [0, -100, 0])), new CaseRange.ptr(8160, 8161, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8165, 8165, $toNativeArray($kindInt32, [7, 0, 7])), new CaseRange.ptr(8168, 8169, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8170, 8171, $toNativeArray($kindInt32, [0, -112, 0])), new CaseRange.ptr(8172, 8172, $toNativeArray($kindInt32, [0, -7, 0])), new CaseRange.ptr(8179, 8179, $toNativeArray($kindInt32, [9, 0, 9])), new CaseRange.ptr(8184, 8185, $toNativeArray($kindInt32, [0, -128, 0])), new CaseRange.ptr(8186, 8187, $toNativeArray($kindInt32, [0, -126, 0])), new CaseRange.ptr(8188, 8188, $toNativeArray($kindInt32, [0, -9, 0])), new CaseRange.ptr(8486, 8486, $toNativeArray($kindInt32, [0, -7517, 0])), new CaseRange.ptr(8490, 8490, $toNativeArray($kindInt32, [0, -8383, 0])), new CaseRange.ptr(8491, 8491, $toNativeArray($kindInt32, [0, -8262, 0])), new CaseRange.ptr(8498, 8498, $toNativeArray($kindInt32, [0, 28, 0])), new CaseRange.ptr(8526, 8526, $toNativeArray($kindInt32, [-28, 0, -28])), new CaseRange.ptr(8544, 8559, $toNativeArray($kindInt32, [0, 16, 0])), new CaseRange.ptr(8560, 8575, $toNativeArray($kindInt32, [-16, 0, -16])), new CaseRange.ptr(8579, 8580, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(9398, 9423, $toNativeArray($kindInt32, [0, 26, 0])), new CaseRange.ptr(9424, 9449, $toNativeArray($kindInt32, [-26, 0, -26])), new CaseRange.ptr(11264, 11310, $toNativeArray($kindInt32, [0, 48, 0])), new CaseRange.ptr(11312, 11358, $toNativeArray($kindInt32, [-48, 0, -48])), new CaseRange.ptr(11360, 11361, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11362, 11362, $toNativeArray($kindInt32, [0, -10743, 0])), new CaseRange.ptr(11363, 11363, $toNativeArray($kindInt32, [0, -3814, 0])), new CaseRange.ptr(11364, 11364, $toNativeArray($kindInt32, [0, -10727, 0])), new CaseRange.ptr(11365, 11365, $toNativeArray($kindInt32, [-10795, 0, -10795])), new CaseRange.ptr(11366, 11366, $toNativeArray($kindInt32, [-10792, 0, -10792])), new CaseRange.ptr(11367, 11372, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11373, 11373, $toNativeArray($kindInt32, [0, -10780, 0])), new CaseRange.ptr(11374, 11374, $toNativeArray($kindInt32, [0, -10749, 0])), new CaseRange.ptr(11375, 11375, $toNativeArray($kindInt32, [0, -10783, 0])), new CaseRange.ptr(11376, 11376, $toNativeArray($kindInt32, [0, -10782, 0])), new CaseRange.ptr(11378, 11379, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11381, 11382, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11390, 11391, $toNativeArray($kindInt32, [0, -10815, 0])), new CaseRange.ptr(11392, 11491, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11499, 11502, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11506, 11507, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11520, 11557, $toNativeArray($kindInt32, [-7264, 0, -7264])), new CaseRange.ptr(11559, 11559, $toNativeArray($kindInt32, [-7264, 0, -7264])), new CaseRange.ptr(11565, 11565, $toNativeArray($kindInt32, [-7264, 0, -7264])), new CaseRange.ptr(42560, 42605, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42624, 42651, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42786, 42799, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42802, 42863, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42873, 42876, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42877, 42877, $toNativeArray($kindInt32, [0, -35332, 0])), new CaseRange.ptr(42878, 42887, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42891, 42892, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42893, 42893, $toNativeArray($kindInt32, [0, -42280, 0])), new CaseRange.ptr(42896, 42899, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42902, 42921, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42922, 42922, $toNativeArray($kindInt32, [0, -42308, 0])), new CaseRange.ptr(42923, 42923, $toNativeArray($kindInt32, [0, -42319, 0])), new CaseRange.ptr(42924, 42924, $toNativeArray($kindInt32, [0, -42315, 0])), new CaseRange.ptr(42925, 42925, $toNativeArray($kindInt32, [0, -42305, 0])), new CaseRange.ptr(42928, 42928, $toNativeArray($kindInt32, [0, -42258, 0])), new CaseRange.ptr(42929, 42929, $toNativeArray($kindInt32, [0, -42282, 0])), new CaseRange.ptr(42930, 42930, $toNativeArray($kindInt32, [0, -42261, 0])), new CaseRange.ptr(42931, 42931, $toNativeArray($kindInt32, [0, 928, 0])), new CaseRange.ptr(42932, 42935, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(43859, 43859, $toNativeArray($kindInt32, [-928, 0, -928])), new CaseRange.ptr(43888, 43967, $toNativeArray($kindInt32, [-38864, 0, -38864])), new CaseRange.ptr(65313, 65338, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(65345, 65370, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(66560, 66599, $toNativeArray($kindInt32, [0, 40, 0])), new CaseRange.ptr(66600, 66639, $toNativeArray($kindInt32, [-40, 0, -40])), new CaseRange.ptr(68736, 68786, $toNativeArray($kindInt32, [0, 64, 0])), new CaseRange.ptr(68800, 68850, $toNativeArray($kindInt32, [-64, 0, -64])), new CaseRange.ptr(71840, 71871, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(71872, 71903, $toNativeArray($kindInt32, [-32, 0, -32]))]);
		$pkg.CaseRanges = _CaseRanges;
		properties = $toNativeArray($kindUint8, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 144, 130, 130, 130, 136, 130, 130, 130, 130, 130, 130, 136, 130, 130, 130, 130, 132, 132, 132, 132, 132, 132, 132, 132, 132, 132, 130, 130, 136, 136, 136, 130, 130, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 130, 130, 130, 136, 130, 136, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 130, 136, 130, 136, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 16, 130, 136, 136, 136, 136, 136, 130, 136, 136, 224, 130, 136, 0, 136, 136, 136, 136, 132, 132, 136, 192, 130, 130, 136, 132, 224, 130, 132, 132, 132, 130, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 136, 160, 160, 160, 160, 160, 160, 160, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 136, 192, 192, 192, 192, 192, 192, 192, 192]);
		caseOrbit = new sliceType$4([new foldPair.ptr(75, 107), new foldPair.ptr(83, 115), new foldPair.ptr(107, 8490), new foldPair.ptr(115, 383), new foldPair.ptr(181, 924), new foldPair.ptr(197, 229), new foldPair.ptr(223, 7838), new foldPair.ptr(229, 8491), new foldPair.ptr(304, 304), new foldPair.ptr(305, 305), new foldPair.ptr(383, 83), new foldPair.ptr(452, 453), new foldPair.ptr(453, 454), new foldPair.ptr(454, 452), new foldPair.ptr(455, 456), new foldPair.ptr(456, 457), new foldPair.ptr(457, 455), new foldPair.ptr(458, 459), new foldPair.ptr(459, 460), new foldPair.ptr(460, 458), new foldPair.ptr(497, 498), new foldPair.ptr(498, 499), new foldPair.ptr(499, 497), new foldPair.ptr(837, 921), new foldPair.ptr(914, 946), new foldPair.ptr(917, 949), new foldPair.ptr(920, 952), new foldPair.ptr(921, 953), new foldPair.ptr(922, 954), new foldPair.ptr(924, 956), new foldPair.ptr(928, 960), new foldPair.ptr(929, 961), new foldPair.ptr(931, 962), new foldPair.ptr(934, 966), new foldPair.ptr(937, 969), new foldPair.ptr(946, 976), new foldPair.ptr(949, 1013), new foldPair.ptr(952, 977), new foldPair.ptr(953, 8126), new foldPair.ptr(954, 1008), new foldPair.ptr(956, 181), new foldPair.ptr(960, 982), new foldPair.ptr(961, 1009), new foldPair.ptr(962, 963), new foldPair.ptr(963, 931), new foldPair.ptr(966, 981), new foldPair.ptr(969, 8486), new foldPair.ptr(976, 914), new foldPair.ptr(977, 1012), new foldPair.ptr(981, 934), new foldPair.ptr(982, 928), new foldPair.ptr(1008, 922), new foldPair.ptr(1009, 929), new foldPair.ptr(1012, 920), new foldPair.ptr(1013, 917), new foldPair.ptr(7776, 7777), new foldPair.ptr(7777, 7835), new foldPair.ptr(7835, 7776), new foldPair.ptr(7838, 223), new foldPair.ptr(8126, 837), new foldPair.ptr(8486, 937), new foldPair.ptr(8490, 75), new foldPair.ptr(8491, 197)]);
		foldCommon = new RangeTable.ptr(new sliceType([new Range16.ptr(924, 956, 32)]), sliceType$1.nil, 0);
		foldGreek = new RangeTable.ptr(new sliceType([new Range16.ptr(181, 837, 656)]), sliceType$1.nil, 0);
		foldInherited = new RangeTable.ptr(new sliceType([new Range16.ptr(921, 953, 32), new Range16.ptr(8126, 8126, 1)]), sliceType$1.nil, 0);
		foldL = new RangeTable.ptr(new sliceType([new Range16.ptr(837, 837, 1)]), sliceType$1.nil, 0);
		foldLl = new RangeTable.ptr(new sliceType([new Range16.ptr(65, 90, 1), new Range16.ptr(192, 214, 1), new Range16.ptr(216, 222, 1), new Range16.ptr(256, 302, 2), new Range16.ptr(306, 310, 2), new Range16.ptr(313, 327, 2), new Range16.ptr(330, 376, 2), new Range16.ptr(377, 381, 2), new Range16.ptr(385, 386, 1), new Range16.ptr(388, 390, 2), new Range16.ptr(391, 393, 2), new Range16.ptr(394, 395, 1), new Range16.ptr(398, 401, 1), new Range16.ptr(403, 404, 1), new Range16.ptr(406, 408, 1), new Range16.ptr(412, 413, 1), new Range16.ptr(415, 416, 1), new Range16.ptr(418, 422, 2), new Range16.ptr(423, 425, 2), new Range16.ptr(428, 430, 2), new Range16.ptr(431, 433, 2), new Range16.ptr(434, 435, 1), new Range16.ptr(437, 439, 2), new Range16.ptr(440, 444, 4), new Range16.ptr(452, 453, 1), new Range16.ptr(455, 456, 1), new Range16.ptr(458, 459, 1), new Range16.ptr(461, 475, 2), new Range16.ptr(478, 494, 2), new Range16.ptr(497, 498, 1), new Range16.ptr(500, 502, 2), new Range16.ptr(503, 504, 1), new Range16.ptr(506, 562, 2), new Range16.ptr(570, 571, 1), new Range16.ptr(573, 574, 1), new Range16.ptr(577, 579, 2), new Range16.ptr(580, 582, 1), new Range16.ptr(584, 590, 2), new Range16.ptr(837, 880, 43), new Range16.ptr(882, 886, 4), new Range16.ptr(895, 902, 7), new Range16.ptr(904, 906, 1), new Range16.ptr(908, 910, 2), new Range16.ptr(911, 913, 2), new Range16.ptr(914, 929, 1), new Range16.ptr(931, 939, 1), new Range16.ptr(975, 984, 9), new Range16.ptr(986, 1006, 2), new Range16.ptr(1012, 1015, 3), new Range16.ptr(1017, 1018, 1), new Range16.ptr(1021, 1071, 1), new Range16.ptr(1120, 1152, 2), new Range16.ptr(1162, 1216, 2), new Range16.ptr(1217, 1229, 2), new Range16.ptr(1232, 1326, 2), new Range16.ptr(1329, 1366, 1), new Range16.ptr(4256, 4293, 1), new Range16.ptr(4295, 4301, 6), new Range16.ptr(5024, 5109, 1), new Range16.ptr(7680, 7828, 2), new Range16.ptr(7838, 7934, 2), new Range16.ptr(7944, 7951, 1), new Range16.ptr(7960, 7965, 1), new Range16.ptr(7976, 7983, 1), new Range16.ptr(7992, 7999, 1), new Range16.ptr(8008, 8013, 1), new Range16.ptr(8025, 8031, 2), new Range16.ptr(8040, 8047, 1), new Range16.ptr(8072, 8079, 1), new Range16.ptr(8088, 8095, 1), new Range16.ptr(8104, 8111, 1), new Range16.ptr(8120, 8124, 1), new Range16.ptr(8136, 8140, 1), new Range16.ptr(8152, 8155, 1), new Range16.ptr(8168, 8172, 1), new Range16.ptr(8184, 8188, 1), new Range16.ptr(8486, 8490, 4), new Range16.ptr(8491, 8498, 7), new Range16.ptr(8579, 11264, 2685), new Range16.ptr(11265, 11310, 1), new Range16.ptr(11360, 11362, 2), new Range16.ptr(11363, 11364, 1), new Range16.ptr(11367, 11373, 2), new Range16.ptr(11374, 11376, 1), new Range16.ptr(11378, 11381, 3), new Range16.ptr(11390, 11392, 1), new Range16.ptr(11394, 11490, 2), new Range16.ptr(11499, 11501, 2), new Range16.ptr(11506, 42560, 31054), new Range16.ptr(42562, 42604, 2), new Range16.ptr(42624, 42650, 2), new Range16.ptr(42786, 42798, 2), new Range16.ptr(42802, 42862, 2), new Range16.ptr(42873, 42877, 2), new Range16.ptr(42878, 42886, 2), new Range16.ptr(42891, 42893, 2), new Range16.ptr(42896, 42898, 2), new Range16.ptr(42902, 42922, 2), new Range16.ptr(42923, 42925, 1), new Range16.ptr(42928, 42932, 1), new Range16.ptr(42934, 65313, 22379), new Range16.ptr(65314, 65338, 1)]), new sliceType$1([new Range32.ptr(66560, 66599, 1), new Range32.ptr(68736, 68786, 1), new Range32.ptr(71840, 71871, 1)]), 3);
		foldLt = new RangeTable.ptr(new sliceType([new Range16.ptr(452, 454, 2), new Range16.ptr(455, 457, 2), new Range16.ptr(458, 460, 2), new Range16.ptr(497, 499, 2), new Range16.ptr(8064, 8071, 1), new Range16.ptr(8080, 8087, 1), new Range16.ptr(8096, 8103, 1), new Range16.ptr(8115, 8131, 16), new Range16.ptr(8179, 8179, 1)]), sliceType$1.nil, 0);
		foldLu = new RangeTable.ptr(new sliceType([new Range16.ptr(97, 122, 1), new Range16.ptr(181, 223, 42), new Range16.ptr(224, 246, 1), new Range16.ptr(248, 255, 1), new Range16.ptr(257, 303, 2), new Range16.ptr(307, 311, 2), new Range16.ptr(314, 328, 2), new Range16.ptr(331, 375, 2), new Range16.ptr(378, 382, 2), new Range16.ptr(383, 384, 1), new Range16.ptr(387, 389, 2), new Range16.ptr(392, 396, 4), new Range16.ptr(402, 405, 3), new Range16.ptr(409, 410, 1), new Range16.ptr(414, 417, 3), new Range16.ptr(419, 421, 2), new Range16.ptr(424, 429, 5), new Range16.ptr(432, 436, 4), new Range16.ptr(438, 441, 3), new Range16.ptr(445, 447, 2), new Range16.ptr(453, 454, 1), new Range16.ptr(456, 457, 1), new Range16.ptr(459, 460, 1), new Range16.ptr(462, 476, 2), new Range16.ptr(477, 495, 2), new Range16.ptr(498, 499, 1), new Range16.ptr(501, 505, 4), new Range16.ptr(507, 543, 2), new Range16.ptr(547, 563, 2), new Range16.ptr(572, 575, 3), new Range16.ptr(576, 578, 2), new Range16.ptr(583, 591, 2), new Range16.ptr(592, 596, 1), new Range16.ptr(598, 599, 1), new Range16.ptr(601, 603, 2), new Range16.ptr(604, 608, 4), new Range16.ptr(609, 613, 2), new Range16.ptr(614, 616, 2), new Range16.ptr(617, 619, 2), new Range16.ptr(620, 623, 3), new Range16.ptr(625, 626, 1), new Range16.ptr(629, 637, 8), new Range16.ptr(640, 643, 3), new Range16.ptr(647, 652, 1), new Range16.ptr(658, 669, 11), new Range16.ptr(670, 837, 167), new Range16.ptr(881, 883, 2), new Range16.ptr(887, 891, 4), new Range16.ptr(892, 893, 1), new Range16.ptr(940, 943, 1), new Range16.ptr(945, 974, 1), new Range16.ptr(976, 977, 1), new Range16.ptr(981, 983, 1), new Range16.ptr(985, 1007, 2), new Range16.ptr(1008, 1011, 1), new Range16.ptr(1013, 1019, 3), new Range16.ptr(1072, 1119, 1), new Range16.ptr(1121, 1153, 2), new Range16.ptr(1163, 1215, 2), new Range16.ptr(1218, 1230, 2), new Range16.ptr(1231, 1327, 2), new Range16.ptr(1377, 1414, 1), new Range16.ptr(5112, 5117, 1), new Range16.ptr(7545, 7549, 4), new Range16.ptr(7681, 7829, 2), new Range16.ptr(7835, 7841, 6), new Range16.ptr(7843, 7935, 2), new Range16.ptr(7936, 7943, 1), new Range16.ptr(7952, 7957, 1), new Range16.ptr(7968, 7975, 1), new Range16.ptr(7984, 7991, 1), new Range16.ptr(8000, 8005, 1), new Range16.ptr(8017, 8023, 2), new Range16.ptr(8032, 8039, 1), new Range16.ptr(8048, 8061, 1), new Range16.ptr(8112, 8113, 1), new Range16.ptr(8126, 8144, 18), new Range16.ptr(8145, 8160, 15), new Range16.ptr(8161, 8165, 4), new Range16.ptr(8526, 8580, 54), new Range16.ptr(11312, 11358, 1), new Range16.ptr(11361, 11365, 4), new Range16.ptr(11366, 11372, 2), new Range16.ptr(11379, 11382, 3), new Range16.ptr(11393, 11491, 2), new Range16.ptr(11500, 11502, 2), new Range16.ptr(11507, 11520, 13), new Range16.ptr(11521, 11557, 1), new Range16.ptr(11559, 11565, 6), new Range16.ptr(42561, 42605, 2), new Range16.ptr(42625, 42651, 2), new Range16.ptr(42787, 42799, 2), new Range16.ptr(42803, 42863, 2), new Range16.ptr(42874, 42876, 2), new Range16.ptr(42879, 42887, 2), new Range16.ptr(42892, 42897, 5), new Range16.ptr(42899, 42903, 4), new Range16.ptr(42905, 42921, 2), new Range16.ptr(42933, 42935, 2), new Range16.ptr(43859, 43888, 29), new Range16.ptr(43889, 43967, 1), new Range16.ptr(65345, 65370, 1)]), new sliceType$1([new Range32.ptr(66600, 66639, 1), new Range32.ptr(68800, 68850, 1), new Range32.ptr(71872, 71903, 1)]), 4);
		foldM = new RangeTable.ptr(new sliceType([new Range16.ptr(921, 953, 32), new Range16.ptr(8126, 8126, 1)]), sliceType$1.nil, 0);
		foldMn = new RangeTable.ptr(new sliceType([new Range16.ptr(921, 953, 32), new Range16.ptr(8126, 8126, 1)]), sliceType$1.nil, 0);
		$pkg.FoldCategory = $makeMap($String.keyFor, [{ k: "Common", v: foldCommon }, { k: "Greek", v: foldGreek }, { k: "Inherited", v: foldInherited }, { k: "L", v: foldL }, { k: "Ll", v: foldLl }, { k: "Lt", v: foldLt }, { k: "Lu", v: foldLu }, { k: "M", v: foldM }, { k: "Mn", v: foldMn }]);
		$pkg.FoldScript = $makeMap($String.keyFor, []);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["strings"] = (function() {
	var $pkg = {}, $init, errors, js, io, unicode, utf8, sliceType, IndexByte, Index, IndexRune, HasPrefix, Map, ToLower, TrimLeftFunc, TrimRightFunc, TrimFunc, indexFunc, lastIndexFunc, TrimSpace;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	io = $packages["io"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	sliceType = $sliceType($Uint8);
	IndexByte = function(s, c) {
		var $ptr, c, s;
		return $parseInt(s.indexOf($global.String.fromCharCode(c))) >> 0;
	};
	$pkg.IndexByte = IndexByte;
	Index = function(s, sep) {
		var $ptr, s, sep;
		return $parseInt(s.indexOf(sep)) >> 0;
	};
	$pkg.Index = Index;
	IndexRune = function(s, r) {
		var $ptr, _i, _ref, _rune, c, i, r, s;
		if (r < 128) {
			return IndexByte(s, (r << 24 >>> 24));
		} else {
			_ref = s;
			_i = 0;
			while (true) {
				if (!(_i < _ref.length)) { break; }
				_rune = $decodeRune(_ref, _i);
				i = _i;
				c = _rune[0];
				if (c === r) {
					return i;
				}
				_i += _rune[1];
			}
		}
		return -1;
	};
	$pkg.IndexRune = IndexRune;
	HasPrefix = function(s, prefix) {
		var $ptr, prefix, s;
		return s.length >= prefix.length && s.substring(0, prefix.length) === prefix;
	};
	$pkg.HasPrefix = HasPrefix;
	Map = function(mapping, s) {
		var $ptr, _i, _r, _ref, _rune, b, c, i, mapping, maxbytes, nb, nbytes, r, s, wid, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; _rune = $f._rune; b = $f.b; c = $f.c; i = $f.i; mapping = $f.mapping; maxbytes = $f.maxbytes; nb = $f.nb; nbytes = $f.nbytes; r = $f.r; s = $f.s; wid = $f.wid; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		maxbytes = s.length;
		nbytes = 0;
		b = sliceType.nil;
		_ref = s;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.length)) { break; } */ if(!(_i < _ref.length)) { $s = 2; continue; }
			_rune = $decodeRune(_ref, _i);
			i = _i;
			c = _rune[0];
			_r = mapping(c); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			r = _r;
			if (b === sliceType.nil) {
				if (r === c) {
					_i += _rune[1];
					/* continue; */ $s = 1; continue;
				}
				b = $makeSlice(sliceType, maxbytes);
				nbytes = $copyString(b, s.substring(0, i));
			}
			if (r >= 0) {
				wid = 1;
				if (r >= 128) {
					wid = utf8.RuneLen(r);
				}
				if ((nbytes + wid >> 0) > maxbytes) {
					maxbytes = ($imul(maxbytes, 2)) + 4 >> 0;
					nb = $makeSlice(sliceType, maxbytes);
					$copySlice(nb, $subslice(b, 0, nbytes));
					b = nb;
				}
				nbytes = nbytes + (utf8.EncodeRune($subslice(b, nbytes, maxbytes), r)) >> 0;
			}
			_i += _rune[1];
		/* } */ $s = 1; continue; case 2:
		if (b === sliceType.nil) {
			return s;
		}
		return $bytesToString($subslice(b, 0, nbytes));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Map }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f._rune = _rune; $f.b = b; $f.c = c; $f.i = i; $f.mapping = mapping; $f.maxbytes = maxbytes; $f.nb = nb; $f.nbytes = nbytes; $f.r = r; $f.s = s; $f.wid = wid; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Map = Map;
	ToLower = function(s) {
		var $ptr, _r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = Map(unicode.ToLower, s); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ToLower }; } $f.$ptr = $ptr; $f._r = _r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.ToLower = ToLower;
	TrimLeftFunc = function(s, f) {
		var $ptr, _r, f, i, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; f = $f.f; i = $f.i; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = indexFunc(s, f, false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		i = _r;
		if (i === -1) {
			return "";
		}
		return s.substring(i);
		/* */ } return; } if ($f === undefined) { $f = { $blk: TrimLeftFunc }; } $f.$ptr = $ptr; $f._r = _r; $f.f = f; $f.i = i; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.TrimLeftFunc = TrimLeftFunc;
	TrimRightFunc = function(s, f) {
		var $ptr, _r, _tuple, f, i, s, wid, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; f = $f.f; i = $f.i; s = $f.s; wid = $f.wid; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = lastIndexFunc(s, f, false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		i = _r;
		if (i >= 0 && s.charCodeAt(i) >= 128) {
			_tuple = utf8.DecodeRuneInString(s.substring(i));
			wid = _tuple[1];
			i = i + (wid) >> 0;
		} else {
			i = i + (1) >> 0;
		}
		return s.substring(0, i);
		/* */ } return; } if ($f === undefined) { $f = { $blk: TrimRightFunc }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.f = f; $f.i = i; $f.s = s; $f.wid = wid; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.TrimRightFunc = TrimRightFunc;
	TrimFunc = function(s, f) {
		var $ptr, _r, _r$1, f, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; f = $f.f; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = TrimLeftFunc(s, f); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = TrimRightFunc(_r, f); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: TrimFunc }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.TrimFunc = TrimFunc;
	indexFunc = function(s, f, truth) {
		var $ptr, _r, _tuple, f, r, s, start, truth, wid, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; f = $f.f; r = $f.r; s = $f.s; start = $f.start; truth = $f.truth; wid = $f.wid; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		start = 0;
		/* while (true) { */ case 1:
			/* if (!(start < s.length)) { break; } */ if(!(start < s.length)) { $s = 2; continue; }
			wid = 1;
			r = (s.charCodeAt(start) >> 0);
			if (r >= 128) {
				_tuple = utf8.DecodeRuneInString(s.substring(start));
				r = _tuple[0];
				wid = _tuple[1];
			}
			_r = f(r); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (_r === truth) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_r === truth) { */ case 3:
				return start;
			/* } */ case 4:
			start = start + (wid) >> 0;
		/* } */ $s = 1; continue; case 2:
		return -1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: indexFunc }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.f = f; $f.r = r; $f.s = s; $f.start = start; $f.truth = truth; $f.wid = wid; $f.$s = $s; $f.$r = $r; return $f;
	};
	lastIndexFunc = function(s, f, truth) {
		var $ptr, _r, _tuple, f, i, r, s, size, truth, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; f = $f.f; i = $f.i; r = $f.r; s = $f.s; size = $f.size; truth = $f.truth; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		i = s.length;
		/* while (true) { */ case 1:
			/* if (!(i > 0)) { break; } */ if(!(i > 0)) { $s = 2; continue; }
			_tuple = utf8.DecodeLastRuneInString(s.substring(0, i));
			r = _tuple[0];
			size = _tuple[1];
			i = i - (size) >> 0;
			_r = f(r); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (_r === truth) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_r === truth) { */ case 3:
				return i;
			/* } */ case 4:
		/* } */ $s = 1; continue; case 2:
		return -1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: lastIndexFunc }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.f = f; $f.i = i; $f.r = r; $f.s = s; $f.size = size; $f.truth = truth; $f.$s = $s; $f.$r = $r; return $f;
	};
	TrimSpace = function(s) {
		var $ptr, _r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = TrimFunc(s, unicode.IsSpace); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: TrimSpace }; } $f.$ptr = $ptr; $f._r = _r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.TrimSpace = TrimSpace;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["syscall"] = (function() {
	var $pkg = {}, $init, js, race, runtime, sync, mmapper, Errno, sliceType, sliceType$1, ptrType$2, arrayType$5, structType, ptrType$25, mapType, funcType, funcType$1, warningPrinted, lineBuffer, syscallModule, alreadyTriedToLoad, minusOne, envOnce, envLock, env, envs, mapper, errEAGAIN, errEINVAL, errENOENT, errors, init, printWarning, printToConsole, indexByte, runtime_envs, syscall, Syscall, Syscall6, copyenv, Getenv, itoa, uitoa, errnoErr, munmap, mmap;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	race = $packages["internal/race"];
	runtime = $packages["runtime"];
	sync = $packages["sync"];
	mmapper = $pkg.mmapper = $newType(0, $kindStruct, "syscall.mmapper", "mmapper", "syscall", function(Mutex_, active_, mmap_, munmap_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Mutex = new sync.Mutex.ptr(0, 0);
			this.active = false;
			this.mmap = $throwNilPointerError;
			this.munmap = $throwNilPointerError;
			return;
		}
		this.Mutex = Mutex_;
		this.active = active_;
		this.mmap = mmap_;
		this.munmap = munmap_;
	});
	Errno = $pkg.Errno = $newType(4, $kindUintptr, "syscall.Errno", "Errno", "syscall", null);
	sliceType = $sliceType($Uint8);
	sliceType$1 = $sliceType($String);
	ptrType$2 = $ptrType($Uint8);
	arrayType$5 = $arrayType($Uint8, 32);
	structType = $structType([{prop: "addr", name: "addr", pkg: "syscall", typ: $Uintptr, tag: ""}, {prop: "len", name: "len", pkg: "syscall", typ: $Int, tag: ""}, {prop: "cap", name: "cap", pkg: "syscall", typ: $Int, tag: ""}]);
	ptrType$25 = $ptrType(mmapper);
	mapType = $mapType(ptrType$2, sliceType);
	funcType = $funcType([$Uintptr, $Uintptr, $Int, $Int, $Int, $Int64], [$Uintptr, $error], false);
	funcType$1 = $funcType([$Uintptr, $Uintptr], [$error], false);
	init = function() {
		var $ptr;
		$flushConsole = (function() {
			var $ptr;
			if (!((lineBuffer.$length === 0))) {
				$global.console.log($externalize($bytesToString(lineBuffer), $String));
				lineBuffer = sliceType.nil;
			}
		});
	};
	printWarning = function() {
		var $ptr;
		if (!warningPrinted) {
			$global.console.error($externalize("warning: system calls not available, see https://github.com/gopherjs/gopherjs/blob/master/doc/syscalls.md", $String));
		}
		warningPrinted = true;
	};
	printToConsole = function(b) {
		var $ptr, b, goPrintToConsole, i;
		goPrintToConsole = $global.goPrintToConsole;
		if (!(goPrintToConsole === undefined)) {
			goPrintToConsole(b);
			return;
		}
		lineBuffer = $appendSlice(lineBuffer, b);
		while (true) {
			i = indexByte(lineBuffer, 10);
			if (i === -1) {
				break;
			}
			$global.console.log($externalize($bytesToString($subslice(lineBuffer, 0, i)), $String));
			lineBuffer = $subslice(lineBuffer, (i + 1 >> 0));
		}
	};
	indexByte = function(s, c) {
		var $ptr, _i, _ref, b, c, i, s;
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			b = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (b === c) {
				return i;
			}
			_i++;
		}
		return -1;
	};
	runtime_envs = function() {
		var $ptr, envkeys, envs$1, i, jsEnv, key, process;
		process = $global.process;
		if (process === undefined) {
			return sliceType$1.nil;
		}
		jsEnv = process.env;
		envkeys = $global.Object.keys(jsEnv);
		envs$1 = $makeSlice(sliceType$1, $parseInt(envkeys.length));
		i = 0;
		while (true) {
			if (!(i < $parseInt(envkeys.length))) { break; }
			key = $internalize(envkeys[i], $String);
			((i < 0 || i >= envs$1.$length) ? $throwRuntimeError("index out of range") : envs$1.$array[envs$1.$offset + i] = key + "=" + $internalize(jsEnv[$externalize(key, $String)], $String));
			i = i + (1) >> 0;
		}
		return envs$1;
	};
	syscall = function(name) {
		var $ptr, name, require, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		$deferred.push([(function() {
			var $ptr;
			$recover();
		}), []]);
		if (syscallModule === null) {
			if (alreadyTriedToLoad) {
				return null;
			}
			alreadyTriedToLoad = true;
			require = $global.require;
			if (require === undefined) {
				$panic(new $String(""));
			}
			syscallModule = require($externalize("syscall", $String));
		}
		return syscallModule[$externalize(name, $String)];
		/* */ } catch(err) { $err = err; return null; } finally { $callDeferred($deferred, $err); }
	};
	Syscall = function(trap, a1, a2, a3) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, a1, a2, a3, array, err, f, r, r1, r2, slice, trap;
		r1 = 0;
		r2 = 0;
		err = 0;
		f = syscall("Syscall");
		if (!(f === null)) {
			r = f(trap, a1, a2, a3);
			_tmp = (($parseInt(r[0]) >> 0) >>> 0);
			_tmp$1 = (($parseInt(r[1]) >> 0) >>> 0);
			_tmp$2 = (($parseInt(r[2]) >> 0) >>> 0);
			r1 = _tmp;
			r2 = _tmp$1;
			err = _tmp$2;
			return [r1, r2, err];
		}
		if ((trap === 1) && ((a1 === 1) || (a1 === 2))) {
			array = a2;
			slice = $makeSlice(sliceType, $parseInt(array.length));
			slice.$array = array;
			printToConsole(slice);
			_tmp$3 = ($parseInt(array.length) >>> 0);
			_tmp$4 = 0;
			_tmp$5 = 0;
			r1 = _tmp$3;
			r2 = _tmp$4;
			err = _tmp$5;
			return [r1, r2, err];
		}
		if (trap === 60) {
			runtime.Goexit();
		}
		printWarning();
		_tmp$6 = (minusOne >>> 0);
		_tmp$7 = 0;
		_tmp$8 = 13;
		r1 = _tmp$6;
		r2 = _tmp$7;
		err = _tmp$8;
		return [r1, r2, err];
	};
	$pkg.Syscall = Syscall;
	Syscall6 = function(trap, a1, a2, a3, a4, a5, a6) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, a1, a2, a3, a4, a5, a6, err, f, r, r1, r2, trap;
		r1 = 0;
		r2 = 0;
		err = 0;
		f = syscall("Syscall6");
		if (!(f === null)) {
			r = f(trap, a1, a2, a3, a4, a5, a6);
			_tmp = (($parseInt(r[0]) >> 0) >>> 0);
			_tmp$1 = (($parseInt(r[1]) >> 0) >>> 0);
			_tmp$2 = (($parseInt(r[2]) >> 0) >>> 0);
			r1 = _tmp;
			r2 = _tmp$1;
			err = _tmp$2;
			return [r1, r2, err];
		}
		if (!((trap === 202))) {
			printWarning();
		}
		_tmp$3 = (minusOne >>> 0);
		_tmp$4 = 0;
		_tmp$5 = 13;
		r1 = _tmp$3;
		r2 = _tmp$4;
		err = _tmp$5;
		return [r1, r2, err];
	};
	$pkg.Syscall6 = Syscall6;
	copyenv = function() {
		var $ptr, _entry, _i, _key, _ref, _tuple, i, j, key, ok, s;
		env = {};
		_ref = envs;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			s = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			j = 0;
			while (true) {
				if (!(j < s.length)) { break; }
				if (s.charCodeAt(j) === 61) {
					key = s.substring(0, j);
					_tuple = (_entry = env[$String.keyFor(key)], _entry !== undefined ? [_entry.v, true] : [0, false]);
					ok = _tuple[1];
					if (!ok) {
						_key = key; (env || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: i };
					} else {
						((i < 0 || i >= envs.$length) ? $throwRuntimeError("index out of range") : envs.$array[envs.$offset + i] = "");
					}
					break;
				}
				j = j + (1) >> 0;
			}
			_i++;
		}
	};
	Getenv = function(key) {
		var $ptr, _entry, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, found, i, i$1, key, ok, s, value, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tuple = $f._tuple; found = $f.found; i = $f.i; i$1 = $f.i$1; key = $f.key; ok = $f.ok; s = $f.s; value = $f.value; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		value = "";
		found = false;
		$r = envOnce.Do(copyenv); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (key.length === 0) {
			_tmp = "";
			_tmp$1 = false;
			value = _tmp;
			found = _tmp$1;
			return [value, found];
		}
		$r = envLock.RLock(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(envLock, "RUnlock"), []]);
		_tuple = (_entry = env[$String.keyFor(key)], _entry !== undefined ? [_entry.v, true] : [0, false]);
		i = _tuple[0];
		ok = _tuple[1];
		if (!ok) {
			_tmp$2 = "";
			_tmp$3 = false;
			value = _tmp$2;
			found = _tmp$3;
			return [value, found];
		}
		s = ((i < 0 || i >= envs.$length) ? $throwRuntimeError("index out of range") : envs.$array[envs.$offset + i]);
		i$1 = 0;
		while (true) {
			if (!(i$1 < s.length)) { break; }
			if (s.charCodeAt(i$1) === 61) {
				_tmp$4 = s.substring((i$1 + 1 >> 0));
				_tmp$5 = true;
				value = _tmp$4;
				found = _tmp$5;
				return [value, found];
			}
			i$1 = i$1 + (1) >> 0;
		}
		_tmp$6 = "";
		_tmp$7 = false;
		value = _tmp$6;
		found = _tmp$7;
		return [value, found];
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [value, found]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Getenv }; } $f.$ptr = $ptr; $f._entry = _entry; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tuple = _tuple; $f.found = found; $f.i = i; $f.i$1 = i$1; $f.key = key; $f.ok = ok; $f.s = s; $f.value = value; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	$pkg.Getenv = Getenv;
	itoa = function(val) {
		var $ptr, val;
		if (val < 0) {
			return "-" + uitoa((-val >>> 0));
		}
		return uitoa((val >>> 0));
	};
	uitoa = function(val) {
		var $ptr, _q, _r, buf, i, val;
		buf = arrayType$5.zero();
		i = 31;
		while (true) {
			if (!(val >= 10)) { break; }
			((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = (((_r = val % 10, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) + 48 >>> 0) << 24 >>> 24));
			i = i - (1) >> 0;
			val = (_q = val / (10), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		}
		((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = ((val + 48 >>> 0) << 24 >>> 24));
		return $bytesToString($subslice(new sliceType(buf), i));
	};
	mmapper.ptr.prototype.Mmap = function(fd, offset, length, prot, flags) {
		var $ptr, _key, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, addr, b, data, err, errno, fd, flags, length, m, offset, p, prot, sl, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _key = $f._key; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; addr = $f.addr; b = $f.b; data = $f.data; err = $f.err; errno = $f.errno; fd = $f.fd; flags = $f.flags; length = $f.length; m = $f.m; offset = $f.offset; p = $f.p; prot = $f.prot; sl = $f.sl; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		sl = [sl];
		data = sliceType.nil;
		err = $ifaceNil;
		m = this;
		if (length <= 0) {
			_tmp = sliceType.nil;
			_tmp$1 = new Errno(22);
			data = _tmp;
			err = _tmp$1;
			return [data, err];
		}
		_r = m.mmap(0, (length >>> 0), prot, flags, fd, offset); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		addr = _tuple[0];
		errno = _tuple[1];
		if (!($interfaceIsEqual(errno, $ifaceNil))) {
			_tmp$2 = sliceType.nil;
			_tmp$3 = errno;
			data = _tmp$2;
			err = _tmp$3;
			return [data, err];
		}
		sl[0] = new structType.ptr(addr, length, length);
		b = sl[0];
		p = $indexPtr(b.$array, b.$offset + (b.$capacity - 1 >> 0), ptrType$2);
		$r = m.Mutex.Lock(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(m.Mutex, "Unlock"), []]);
		_key = p; (m.active || $throwRuntimeError("assignment to entry in nil map"))[ptrType$2.keyFor(_key)] = { k: _key, v: b };
		_tmp$4 = b;
		_tmp$5 = $ifaceNil;
		data = _tmp$4;
		err = _tmp$5;
		return [data, err];
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [data, err]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: mmapper.ptr.prototype.Mmap }; } $f.$ptr = $ptr; $f._key = _key; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f.addr = addr; $f.b = b; $f.data = data; $f.err = err; $f.errno = errno; $f.fd = fd; $f.flags = flags; $f.length = length; $f.m = m; $f.offset = offset; $f.p = p; $f.prot = prot; $f.sl = sl; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	mmapper.prototype.Mmap = function(fd, offset, length, prot, flags) { return this.$val.Mmap(fd, offset, length, prot, flags); };
	mmapper.ptr.prototype.Munmap = function(data) {
		var $ptr, _entry, _r, b, data, err, errno, m, p, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _r = $f._r; b = $f.b; data = $f.data; err = $f.err; errno = $f.errno; m = $f.m; p = $f.p; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = $ifaceNil;
		m = this;
		if ((data.$length === 0) || !((data.$length === data.$capacity))) {
			err = new Errno(22);
			return err;
		}
		p = $indexPtr(data.$array, data.$offset + (data.$capacity - 1 >> 0), ptrType$2);
		$r = m.Mutex.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(m.Mutex, "Unlock"), []]);
		b = (_entry = m.active[ptrType$2.keyFor(p)], _entry !== undefined ? _entry.v : sliceType.nil);
		if (b === sliceType.nil || !($indexPtr(b.$array, b.$offset + 0, ptrType$2) === $indexPtr(data.$array, data.$offset + 0, ptrType$2))) {
			err = new Errno(22);
			return err;
		}
		_r = m.munmap($sliceToArray(b), (b.$length >>> 0)); /* */ $s = 2; case 2: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		errno = _r;
		if (!($interfaceIsEqual(errno, $ifaceNil))) {
			err = errno;
			return err;
		}
		delete m.active[ptrType$2.keyFor(p)];
		err = $ifaceNil;
		return err;
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  err; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: mmapper.ptr.prototype.Munmap }; } $f.$ptr = $ptr; $f._entry = _entry; $f._r = _r; $f.b = b; $f.data = data; $f.err = err; $f.errno = errno; $f.m = m; $f.p = p; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	mmapper.prototype.Munmap = function(data) { return this.$val.Munmap(data); };
	Errno.prototype.Error = function() {
		var $ptr, e, s;
		e = this.$val;
		if (0 <= (e >> 0) && (e >> 0) < 133) {
			s = ((e < 0 || e >= errors.length) ? $throwRuntimeError("index out of range") : errors[e]);
			if (!(s === "")) {
				return s;
			}
		}
		return "errno " + itoa((e >> 0));
	};
	$ptrType(Errno).prototype.Error = function() { return new Errno(this.$get()).Error(); };
	Errno.prototype.Temporary = function() {
		var $ptr, e;
		e = this.$val;
		return (e === 4) || (e === 24) || (e === 104) || (e === 103) || new Errno(e).Timeout();
	};
	$ptrType(Errno).prototype.Temporary = function() { return new Errno(this.$get()).Temporary(); };
	Errno.prototype.Timeout = function() {
		var $ptr, e;
		e = this.$val;
		return (e === 11) || (e === 11) || (e === 110);
	};
	$ptrType(Errno).prototype.Timeout = function() { return new Errno(this.$get()).Timeout(); };
	errnoErr = function(e) {
		var $ptr, _1, e;
		_1 = e;
		if (_1 === (0)) {
			return $ifaceNil;
		} else if (_1 === (11)) {
			return errEAGAIN;
		} else if (_1 === (22)) {
			return errEINVAL;
		} else if (_1 === (2)) {
			return errENOENT;
		}
		return new Errno(e);
	};
	munmap = function(addr, length) {
		var $ptr, _tuple, addr, e1, err, length;
		err = $ifaceNil;
		_tuple = Syscall(11, addr, length, 0);
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	mmap = function(addr, length, prot, flags, fd, offset) {
		var $ptr, _tuple, addr, e1, err, fd, flags, length, offset, prot, r0, xaddr;
		xaddr = 0;
		err = $ifaceNil;
		_tuple = Syscall6(9, addr, length, (prot >>> 0), (flags >>> 0), (fd >>> 0), (offset.$low >>> 0));
		r0 = _tuple[0];
		e1 = _tuple[2];
		xaddr = r0;
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [xaddr, err];
	};
	ptrType$25.methods = [{prop: "Mmap", name: "Mmap", pkg: "", typ: $funcType([$Int, $Int64, $Int, $Int, $Int], [sliceType, $error], false)}, {prop: "Munmap", name: "Munmap", pkg: "", typ: $funcType([sliceType], [$error], false)}];
	Errno.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Temporary", name: "Temporary", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Timeout", name: "Timeout", pkg: "", typ: $funcType([], [$Bool], false)}];
	mmapper.init([{prop: "Mutex", name: "", pkg: "", typ: sync.Mutex, tag: ""}, {prop: "active", name: "active", pkg: "syscall", typ: mapType, tag: ""}, {prop: "mmap", name: "mmap", pkg: "syscall", typ: funcType, tag: ""}, {prop: "munmap", name: "munmap", pkg: "syscall", typ: funcType$1, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = race.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		lineBuffer = sliceType.nil;
		syscallModule = null;
		envOnce = new sync.Once.ptr(new sync.Mutex.ptr(0, 0), 0);
		envLock = new sync.RWMutex.ptr(new sync.Mutex.ptr(0, 0), 0, 0, 0, 0);
		env = false;
		warningPrinted = false;
		alreadyTriedToLoad = false;
		minusOne = -1;
		envs = runtime_envs();
		errEAGAIN = new Errno(11);
		errEINVAL = new Errno(22);
		errENOENT = new Errno(2);
		errors = $toNativeArray($kindString, ["", "operation not permitted", "no such file or directory", "no such process", "interrupted system call", "input/output error", "no such device or address", "argument list too long", "exec format error", "bad file descriptor", "no child processes", "resource temporarily unavailable", "cannot allocate memory", "permission denied", "bad address", "block device required", "device or resource busy", "file exists", "invalid cross-device link", "no such device", "not a directory", "is a directory", "invalid argument", "too many open files in system", "too many open files", "inappropriate ioctl for device", "text file busy", "file too large", "no space left on device", "illegal seek", "read-only file system", "too many links", "broken pipe", "numerical argument out of domain", "numerical result out of range", "resource deadlock avoided", "file name too long", "no locks available", "function not implemented", "directory not empty", "too many levels of symbolic links", "", "no message of desired type", "identifier removed", "channel number out of range", "level 2 not synchronized", "level 3 halted", "level 3 reset", "link number out of range", "protocol driver not attached", "no CSI structure available", "level 2 halted", "invalid exchange", "invalid request descriptor", "exchange full", "no anode", "invalid request code", "invalid slot", "", "bad font file format", "device not a stream", "no data available", "timer expired", "out of streams resources", "machine is not on the network", "package not installed", "object is remote", "link has been severed", "advertise error", "srmount error", "communication error on send", "protocol error", "multihop attempted", "RFS specific error", "bad message", "value too large for defined data type", "name not unique on network", "file descriptor in bad state", "remote address changed", "can not access a needed shared library", "accessing a corrupted shared library", ".lib section in a.out corrupted", "attempting to link in too many shared libraries", "cannot exec a shared library directly", "invalid or incomplete multibyte or wide character", "interrupted system call should be restarted", "streams pipe error", "too many users", "socket operation on non-socket", "destination address required", "message too long", "protocol wrong type for socket", "protocol not available", "protocol not supported", "socket type not supported", "operation not supported", "protocol family not supported", "address family not supported by protocol", "address already in use", "cannot assign requested address", "network is down", "network is unreachable", "network dropped connection on reset", "software caused connection abort", "connection reset by peer", "no buffer space available", "transport endpoint is already connected", "transport endpoint is not connected", "cannot send after transport endpoint shutdown", "too many references: cannot splice", "connection timed out", "connection refused", "host is down", "no route to host", "operation already in progress", "operation now in progress", "stale NFS file handle", "structure needs cleaning", "not a XENIX named type file", "no XENIX semaphores available", "is a named type file", "remote I/O error", "disk quota exceeded", "no medium found", "wrong medium type", "operation canceled", "required key not available", "key has expired", "key has been revoked", "key was rejected by service", "owner died", "state not recoverable", "operation not possible due to RF-kill"]);
		mapper = new mmapper.ptr(new sync.Mutex.ptr(0, 0), {}, mmap, munmap);
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["time"] = (function() {
	var $pkg = {}, $init, errors, js, nosync, runtime, strings, syscall, runtimeTimer, ParseError, Timer, Time, Month, Weekday, Duration, Location, zone, zoneTrans, sliceType, sliceType$1, ptrType, sliceType$2, arrayType, sliceType$3, arrayType$1, arrayType$2, ptrType$1, funcType, arrayType$4, funcType$1, ptrType$2, ptrType$3, ptrType$4, chanType$1, ptrType$6, std0x, longDayNames, shortDayNames, shortMonthNames, longMonthNames, atoiError, errBad, errLeadingInt, months, days, daysBefore, utcLoc, utcLoc$24ptr, localLoc, localLoc$24ptr, localOnce, zoneinfo, badData, zoneDirs, _tuple, _r, init, initLocal, runtimeNano, startTimer, stopTimer, startsWithLowerCase, nextStdChunk, match, lookup, appendInt, atoi, formatNano, quote, isDigit, getnum, cutspace, skip, Parse, parse, parseTimeZone, parseGMT, parseNanoseconds, leadingInt, when, AfterFunc, goFunc, absWeekday, absClock, fmtFrac, fmtInt, absDate, daysIn, Unix, isLeap, norm, Date, div, FixedZone;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	nosync = $packages["github.com/gopherjs/gopherjs/nosync"];
	runtime = $packages["runtime"];
	strings = $packages["strings"];
	syscall = $packages["syscall"];
	runtimeTimer = $pkg.runtimeTimer = $newType(0, $kindStruct, "time.runtimeTimer", "runtimeTimer", "time", function(i_, when_, period_, f_, arg_, timeout_, active_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.i = 0;
			this.when = new $Int64(0, 0);
			this.period = new $Int64(0, 0);
			this.f = $throwNilPointerError;
			this.arg = $ifaceNil;
			this.timeout = null;
			this.active = false;
			return;
		}
		this.i = i_;
		this.when = when_;
		this.period = period_;
		this.f = f_;
		this.arg = arg_;
		this.timeout = timeout_;
		this.active = active_;
	});
	ParseError = $pkg.ParseError = $newType(0, $kindStruct, "time.ParseError", "ParseError", "time", function(Layout_, Value_, LayoutElem_, ValueElem_, Message_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Layout = "";
			this.Value = "";
			this.LayoutElem = "";
			this.ValueElem = "";
			this.Message = "";
			return;
		}
		this.Layout = Layout_;
		this.Value = Value_;
		this.LayoutElem = LayoutElem_;
		this.ValueElem = ValueElem_;
		this.Message = Message_;
	});
	Timer = $pkg.Timer = $newType(0, $kindStruct, "time.Timer", "Timer", "time", function(C_, r_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.C = $chanNil;
			this.r = new runtimeTimer.ptr(0, new $Int64(0, 0), new $Int64(0, 0), $throwNilPointerError, $ifaceNil, null, false);
			return;
		}
		this.C = C_;
		this.r = r_;
	});
	Time = $pkg.Time = $newType(0, $kindStruct, "time.Time", "Time", "time", function(sec_, nsec_, loc_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.sec = new $Int64(0, 0);
			this.nsec = 0;
			this.loc = ptrType$1.nil;
			return;
		}
		this.sec = sec_;
		this.nsec = nsec_;
		this.loc = loc_;
	});
	Month = $pkg.Month = $newType(4, $kindInt, "time.Month", "Month", "time", null);
	Weekday = $pkg.Weekday = $newType(4, $kindInt, "time.Weekday", "Weekday", "time", null);
	Duration = $pkg.Duration = $newType(8, $kindInt64, "time.Duration", "Duration", "time", null);
	Location = $pkg.Location = $newType(0, $kindStruct, "time.Location", "Location", "time", function(name_, zone_, tx_, cacheStart_, cacheEnd_, cacheZone_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.zone = sliceType.nil;
			this.tx = sliceType$1.nil;
			this.cacheStart = new $Int64(0, 0);
			this.cacheEnd = new $Int64(0, 0);
			this.cacheZone = ptrType.nil;
			return;
		}
		this.name = name_;
		this.zone = zone_;
		this.tx = tx_;
		this.cacheStart = cacheStart_;
		this.cacheEnd = cacheEnd_;
		this.cacheZone = cacheZone_;
	});
	zone = $pkg.zone = $newType(0, $kindStruct, "time.zone", "zone", "time", function(name_, offset_, isDST_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.offset = 0;
			this.isDST = false;
			return;
		}
		this.name = name_;
		this.offset = offset_;
		this.isDST = isDST_;
	});
	zoneTrans = $pkg.zoneTrans = $newType(0, $kindStruct, "time.zoneTrans", "zoneTrans", "time", function(when_, index_, isstd_, isutc_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.when = new $Int64(0, 0);
			this.index = 0;
			this.isstd = false;
			this.isutc = false;
			return;
		}
		this.when = when_;
		this.index = index_;
		this.isstd = isstd_;
		this.isutc = isutc_;
	});
	sliceType = $sliceType(zone);
	sliceType$1 = $sliceType(zoneTrans);
	ptrType = $ptrType(zone);
	sliceType$2 = $sliceType($String);
	arrayType = $arrayType($Uint8, 20);
	sliceType$3 = $sliceType($Uint8);
	arrayType$1 = $arrayType($Uint8, 9);
	arrayType$2 = $arrayType($Uint8, 64);
	ptrType$1 = $ptrType(Location);
	funcType = $funcType([], [], false);
	arrayType$4 = $arrayType($Uint8, 32);
	funcType$1 = $funcType([$emptyInterface, $Uintptr], [], false);
	ptrType$2 = $ptrType(js.Object);
	ptrType$3 = $ptrType(ParseError);
	ptrType$4 = $ptrType(Timer);
	chanType$1 = $chanType(Time, false, true);
	ptrType$6 = $ptrType(Time);
	init = function() {
		var $ptr;
		Unix(new $Int64(0, 0), new $Int64(0, 0));
	};
	initLocal = function() {
		var $ptr, d, i, j, s;
		d = new ($global.Date)();
		s = $internalize(d, $String);
		i = strings.IndexByte(s, 40);
		j = strings.IndexByte(s, 41);
		if ((i === -1) || (j === -1)) {
			localLoc.name = "UTC";
			return;
		}
		localLoc.name = s.substring((i + 1 >> 0), j);
		localLoc.zone = new sliceType([new zone.ptr(localLoc.name, $imul(($parseInt(d.getTimezoneOffset()) >> 0), -60), false)]);
	};
	runtimeNano = function() {
		var $ptr;
		return $mul64($internalize(new ($global.Date)().getTime(), $Int64), new $Int64(0, 1000000));
	};
	startTimer = function(t) {
		var $ptr, diff, t, x, x$1;
		t.active = true;
		diff = $div64(((x = t.when, x$1 = runtimeNano(), new $Int64(x.$high - x$1.$high, x.$low - x$1.$low))), new $Int64(0, 1000000), false);
		if ((diff.$high > 0 || (diff.$high === 0 && diff.$low > 2147483647))) {
			return;
		}
		if ((diff.$high < 0 || (diff.$high === 0 && diff.$low < 0))) {
			diff = new $Int64(0, 0);
		}
		t.timeout = $setTimeout((function() {
			var $ptr, x$2, x$3, x$4;
			t.active = false;
			$go(t.f, [t.arg, 0]);
			if (!((x$2 = t.period, (x$2.$high === 0 && x$2.$low === 0)))) {
				t.when = (x$3 = t.when, x$4 = t.period, new $Int64(x$3.$high + x$4.$high, x$3.$low + x$4.$low));
				startTimer(t);
			}
		}), $externalize(new $Int64(diff.$high + 0, diff.$low + 1), $Int64));
	};
	stopTimer = function(t) {
		var $ptr, t, wasActive;
		$global.clearTimeout(t.timeout);
		wasActive = t.active;
		t.active = false;
		return wasActive;
	};
	startsWithLowerCase = function(str) {
		var $ptr, c, str;
		if (str.length === 0) {
			return false;
		}
		c = str.charCodeAt(0);
		return 97 <= c && c <= 122;
	};
	nextStdChunk = function(layout) {
		var $ptr, _1, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$2, _tmp$20, _tmp$21, _tmp$22, _tmp$23, _tmp$24, _tmp$25, _tmp$26, _tmp$27, _tmp$28, _tmp$29, _tmp$3, _tmp$30, _tmp$31, _tmp$32, _tmp$33, _tmp$34, _tmp$35, _tmp$36, _tmp$37, _tmp$38, _tmp$39, _tmp$4, _tmp$40, _tmp$41, _tmp$42, _tmp$43, _tmp$44, _tmp$45, _tmp$46, _tmp$47, _tmp$48, _tmp$49, _tmp$5, _tmp$50, _tmp$51, _tmp$52, _tmp$53, _tmp$54, _tmp$55, _tmp$56, _tmp$57, _tmp$58, _tmp$59, _tmp$6, _tmp$60, _tmp$61, _tmp$62, _tmp$63, _tmp$64, _tmp$65, _tmp$66, _tmp$67, _tmp$68, _tmp$69, _tmp$7, _tmp$70, _tmp$71, _tmp$72, _tmp$73, _tmp$74, _tmp$75, _tmp$76, _tmp$77, _tmp$78, _tmp$79, _tmp$8, _tmp$80, _tmp$81, _tmp$82, _tmp$83, _tmp$84, _tmp$85, _tmp$86, _tmp$9, c, ch, i, j, layout, prefix, std, std$1, suffix, x;
		prefix = "";
		std = 0;
		suffix = "";
		i = 0;
		while (true) {
			if (!(i < layout.length)) { break; }
			c = (layout.charCodeAt(i) >> 0);
			_1 = c;
			if (_1 === (74)) {
				if (layout.length >= (i + 3 >> 0) && layout.substring(i, (i + 3 >> 0)) === "Jan") {
					if (layout.length >= (i + 7 >> 0) && layout.substring(i, (i + 7 >> 0)) === "January") {
						_tmp = layout.substring(0, i);
						_tmp$1 = 257;
						_tmp$2 = layout.substring((i + 7 >> 0));
						prefix = _tmp;
						std = _tmp$1;
						suffix = _tmp$2;
						return [prefix, std, suffix];
					}
					if (!startsWithLowerCase(layout.substring((i + 3 >> 0)))) {
						_tmp$3 = layout.substring(0, i);
						_tmp$4 = 258;
						_tmp$5 = layout.substring((i + 3 >> 0));
						prefix = _tmp$3;
						std = _tmp$4;
						suffix = _tmp$5;
						return [prefix, std, suffix];
					}
				}
			} else if (_1 === (77)) {
				if (layout.length >= (i + 3 >> 0)) {
					if (layout.substring(i, (i + 3 >> 0)) === "Mon") {
						if (layout.length >= (i + 6 >> 0) && layout.substring(i, (i + 6 >> 0)) === "Monday") {
							_tmp$6 = layout.substring(0, i);
							_tmp$7 = 261;
							_tmp$8 = layout.substring((i + 6 >> 0));
							prefix = _tmp$6;
							std = _tmp$7;
							suffix = _tmp$8;
							return [prefix, std, suffix];
						}
						if (!startsWithLowerCase(layout.substring((i + 3 >> 0)))) {
							_tmp$9 = layout.substring(0, i);
							_tmp$10 = 262;
							_tmp$11 = layout.substring((i + 3 >> 0));
							prefix = _tmp$9;
							std = _tmp$10;
							suffix = _tmp$11;
							return [prefix, std, suffix];
						}
					}
					if (layout.substring(i, (i + 3 >> 0)) === "MST") {
						_tmp$12 = layout.substring(0, i);
						_tmp$13 = 21;
						_tmp$14 = layout.substring((i + 3 >> 0));
						prefix = _tmp$12;
						std = _tmp$13;
						suffix = _tmp$14;
						return [prefix, std, suffix];
					}
				}
			} else if (_1 === (48)) {
				if (layout.length >= (i + 2 >> 0) && 49 <= layout.charCodeAt((i + 1 >> 0)) && layout.charCodeAt((i + 1 >> 0)) <= 54) {
					_tmp$15 = layout.substring(0, i);
					_tmp$16 = (x = layout.charCodeAt((i + 1 >> 0)) - 49 << 24 >>> 24, ((x < 0 || x >= std0x.length) ? $throwRuntimeError("index out of range") : std0x[x]));
					_tmp$17 = layout.substring((i + 2 >> 0));
					prefix = _tmp$15;
					std = _tmp$16;
					suffix = _tmp$17;
					return [prefix, std, suffix];
				}
			} else if (_1 === (49)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 53)) {
					_tmp$18 = layout.substring(0, i);
					_tmp$19 = 522;
					_tmp$20 = layout.substring((i + 2 >> 0));
					prefix = _tmp$18;
					std = _tmp$19;
					suffix = _tmp$20;
					return [prefix, std, suffix];
				}
				_tmp$21 = layout.substring(0, i);
				_tmp$22 = 259;
				_tmp$23 = layout.substring((i + 1 >> 0));
				prefix = _tmp$21;
				std = _tmp$22;
				suffix = _tmp$23;
				return [prefix, std, suffix];
			} else if (_1 === (50)) {
				if (layout.length >= (i + 4 >> 0) && layout.substring(i, (i + 4 >> 0)) === "2006") {
					_tmp$24 = layout.substring(0, i);
					_tmp$25 = 273;
					_tmp$26 = layout.substring((i + 4 >> 0));
					prefix = _tmp$24;
					std = _tmp$25;
					suffix = _tmp$26;
					return [prefix, std, suffix];
				}
				_tmp$27 = layout.substring(0, i);
				_tmp$28 = 263;
				_tmp$29 = layout.substring((i + 1 >> 0));
				prefix = _tmp$27;
				std = _tmp$28;
				suffix = _tmp$29;
				return [prefix, std, suffix];
			} else if (_1 === (95)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 50)) {
					if (layout.length >= (i + 5 >> 0) && layout.substring((i + 1 >> 0), (i + 5 >> 0)) === "2006") {
						_tmp$30 = layout.substring(0, (i + 1 >> 0));
						_tmp$31 = 273;
						_tmp$32 = layout.substring((i + 5 >> 0));
						prefix = _tmp$30;
						std = _tmp$31;
						suffix = _tmp$32;
						return [prefix, std, suffix];
					}
					_tmp$33 = layout.substring(0, i);
					_tmp$34 = 264;
					_tmp$35 = layout.substring((i + 2 >> 0));
					prefix = _tmp$33;
					std = _tmp$34;
					suffix = _tmp$35;
					return [prefix, std, suffix];
				}
			} else if (_1 === (51)) {
				_tmp$36 = layout.substring(0, i);
				_tmp$37 = 523;
				_tmp$38 = layout.substring((i + 1 >> 0));
				prefix = _tmp$36;
				std = _tmp$37;
				suffix = _tmp$38;
				return [prefix, std, suffix];
			} else if (_1 === (52)) {
				_tmp$39 = layout.substring(0, i);
				_tmp$40 = 525;
				_tmp$41 = layout.substring((i + 1 >> 0));
				prefix = _tmp$39;
				std = _tmp$40;
				suffix = _tmp$41;
				return [prefix, std, suffix];
			} else if (_1 === (53)) {
				_tmp$42 = layout.substring(0, i);
				_tmp$43 = 527;
				_tmp$44 = layout.substring((i + 1 >> 0));
				prefix = _tmp$42;
				std = _tmp$43;
				suffix = _tmp$44;
				return [prefix, std, suffix];
			} else if (_1 === (80)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 77)) {
					_tmp$45 = layout.substring(0, i);
					_tmp$46 = 531;
					_tmp$47 = layout.substring((i + 2 >> 0));
					prefix = _tmp$45;
					std = _tmp$46;
					suffix = _tmp$47;
					return [prefix, std, suffix];
				}
			} else if (_1 === (112)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 109)) {
					_tmp$48 = layout.substring(0, i);
					_tmp$49 = 532;
					_tmp$50 = layout.substring((i + 2 >> 0));
					prefix = _tmp$48;
					std = _tmp$49;
					suffix = _tmp$50;
					return [prefix, std, suffix];
				}
			} else if (_1 === (45)) {
				if (layout.length >= (i + 7 >> 0) && layout.substring(i, (i + 7 >> 0)) === "-070000") {
					_tmp$51 = layout.substring(0, i);
					_tmp$52 = 28;
					_tmp$53 = layout.substring((i + 7 >> 0));
					prefix = _tmp$51;
					std = _tmp$52;
					suffix = _tmp$53;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 9 >> 0) && layout.substring(i, (i + 9 >> 0)) === "-07:00:00") {
					_tmp$54 = layout.substring(0, i);
					_tmp$55 = 31;
					_tmp$56 = layout.substring((i + 9 >> 0));
					prefix = _tmp$54;
					std = _tmp$55;
					suffix = _tmp$56;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 5 >> 0) && layout.substring(i, (i + 5 >> 0)) === "-0700") {
					_tmp$57 = layout.substring(0, i);
					_tmp$58 = 27;
					_tmp$59 = layout.substring((i + 5 >> 0));
					prefix = _tmp$57;
					std = _tmp$58;
					suffix = _tmp$59;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 6 >> 0) && layout.substring(i, (i + 6 >> 0)) === "-07:00") {
					_tmp$60 = layout.substring(0, i);
					_tmp$61 = 30;
					_tmp$62 = layout.substring((i + 6 >> 0));
					prefix = _tmp$60;
					std = _tmp$61;
					suffix = _tmp$62;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 3 >> 0) && layout.substring(i, (i + 3 >> 0)) === "-07") {
					_tmp$63 = layout.substring(0, i);
					_tmp$64 = 29;
					_tmp$65 = layout.substring((i + 3 >> 0));
					prefix = _tmp$63;
					std = _tmp$64;
					suffix = _tmp$65;
					return [prefix, std, suffix];
				}
			} else if (_1 === (90)) {
				if (layout.length >= (i + 7 >> 0) && layout.substring(i, (i + 7 >> 0)) === "Z070000") {
					_tmp$66 = layout.substring(0, i);
					_tmp$67 = 23;
					_tmp$68 = layout.substring((i + 7 >> 0));
					prefix = _tmp$66;
					std = _tmp$67;
					suffix = _tmp$68;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 9 >> 0) && layout.substring(i, (i + 9 >> 0)) === "Z07:00:00") {
					_tmp$69 = layout.substring(0, i);
					_tmp$70 = 26;
					_tmp$71 = layout.substring((i + 9 >> 0));
					prefix = _tmp$69;
					std = _tmp$70;
					suffix = _tmp$71;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 5 >> 0) && layout.substring(i, (i + 5 >> 0)) === "Z0700") {
					_tmp$72 = layout.substring(0, i);
					_tmp$73 = 22;
					_tmp$74 = layout.substring((i + 5 >> 0));
					prefix = _tmp$72;
					std = _tmp$73;
					suffix = _tmp$74;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 6 >> 0) && layout.substring(i, (i + 6 >> 0)) === "Z07:00") {
					_tmp$75 = layout.substring(0, i);
					_tmp$76 = 25;
					_tmp$77 = layout.substring((i + 6 >> 0));
					prefix = _tmp$75;
					std = _tmp$76;
					suffix = _tmp$77;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 3 >> 0) && layout.substring(i, (i + 3 >> 0)) === "Z07") {
					_tmp$78 = layout.substring(0, i);
					_tmp$79 = 24;
					_tmp$80 = layout.substring((i + 3 >> 0));
					prefix = _tmp$78;
					std = _tmp$79;
					suffix = _tmp$80;
					return [prefix, std, suffix];
				}
			} else if (_1 === (46)) {
				if ((i + 1 >> 0) < layout.length && ((layout.charCodeAt((i + 1 >> 0)) === 48) || (layout.charCodeAt((i + 1 >> 0)) === 57))) {
					ch = layout.charCodeAt((i + 1 >> 0));
					j = i + 1 >> 0;
					while (true) {
						if (!(j < layout.length && (layout.charCodeAt(j) === ch))) { break; }
						j = j + (1) >> 0;
					}
					if (!isDigit(layout, j)) {
						std$1 = 32;
						if (layout.charCodeAt((i + 1 >> 0)) === 57) {
							std$1 = 33;
						}
						std$1 = std$1 | ((((j - ((i + 1 >> 0)) >> 0)) << 16 >> 0));
						_tmp$81 = layout.substring(0, i);
						_tmp$82 = std$1;
						_tmp$83 = layout.substring(j);
						prefix = _tmp$81;
						std = _tmp$82;
						suffix = _tmp$83;
						return [prefix, std, suffix];
					}
				}
			}
			i = i + (1) >> 0;
		}
		_tmp$84 = layout;
		_tmp$85 = 0;
		_tmp$86 = "";
		prefix = _tmp$84;
		std = _tmp$85;
		suffix = _tmp$86;
		return [prefix, std, suffix];
	};
	match = function(s1, s2) {
		var $ptr, c1, c2, i, s1, s2;
		i = 0;
		while (true) {
			if (!(i < s1.length)) { break; }
			c1 = s1.charCodeAt(i);
			c2 = s2.charCodeAt(i);
			if (!((c1 === c2))) {
				c1 = (c1 | (32)) >>> 0;
				c2 = (c2 | (32)) >>> 0;
				if (!((c1 === c2)) || c1 < 97 || c1 > 122) {
					return false;
				}
			}
			i = i + (1) >> 0;
		}
		return true;
	};
	lookup = function(tab, val) {
		var $ptr, _i, _ref, i, tab, v, val;
		_ref = tab;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			v = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (val.length >= v.length && match(val.substring(0, v.length), v)) {
				return [i, val.substring(v.length), $ifaceNil];
			}
			_i++;
		}
		return [-1, val, errBad];
	};
	appendInt = function(b, x, width) {
		var $ptr, _q, b, buf, i, q, u, w, width, x;
		u = (x >>> 0);
		if (x < 0) {
			b = $append(b, 45);
			u = (-x >>> 0);
		}
		buf = arrayType.zero();
		i = 20;
		while (true) {
			if (!(u >= 10)) { break; }
			i = i - (1) >> 0;
			q = (_q = u / 10, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
			((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = (((48 + u >>> 0) - (q * 10 >>> 0) >>> 0) << 24 >>> 24));
			u = q;
		}
		i = i - (1) >> 0;
		((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = ((48 + u >>> 0) << 24 >>> 24));
		w = 20 - i >> 0;
		while (true) {
			if (!(w < width)) { break; }
			b = $append(b, 48);
			w = w + (1) >> 0;
		}
		return $appendSlice(b, $subslice(new sliceType$3(buf), i));
	};
	atoi = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple$1, err, neg, q, rem, s, x;
		x = 0;
		err = $ifaceNil;
		neg = false;
		if (!(s === "") && ((s.charCodeAt(0) === 45) || (s.charCodeAt(0) === 43))) {
			neg = s.charCodeAt(0) === 45;
			s = s.substring(1);
		}
		_tuple$1 = leadingInt(s);
		q = _tuple$1[0];
		rem = _tuple$1[1];
		err = _tuple$1[2];
		x = ((q.$low + ((q.$high >> 31) * 4294967296)) >> 0);
		if (!($interfaceIsEqual(err, $ifaceNil)) || !(rem === "")) {
			_tmp = 0;
			_tmp$1 = atoiError;
			x = _tmp;
			err = _tmp$1;
			return [x, err];
		}
		if (neg) {
			x = -x;
		}
		_tmp$2 = x;
		_tmp$3 = $ifaceNil;
		x = _tmp$2;
		err = _tmp$3;
		return [x, err];
	};
	formatNano = function(b, nanosec, n, trim) {
		var $ptr, _q, _r$1, b, buf, n, nanosec, start, trim, u, x;
		u = nanosec;
		buf = arrayType$1.zero();
		start = 9;
		while (true) {
			if (!(start > 0)) { break; }
			start = start - (1) >> 0;
			((start < 0 || start >= buf.length) ? $throwRuntimeError("index out of range") : buf[start] = (((_r$1 = u % 10, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) + 48 >>> 0) << 24 >>> 24));
			u = (_q = u / (10), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		}
		if (n > 9) {
			n = 9;
		}
		if (trim) {
			while (true) {
				if (!(n > 0 && ((x = n - 1 >> 0, ((x < 0 || x >= buf.length) ? $throwRuntimeError("index out of range") : buf[x])) === 48))) { break; }
				n = n - (1) >> 0;
			}
			if (n === 0) {
				return b;
			}
		}
		b = $append(b, 46);
		return $appendSlice(b, $subslice(new sliceType$3(buf), 0, n));
	};
	Time.ptr.prototype.String = function() {
		var $ptr, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Format("2006-01-02 15:04:05.999999999 -0700 MST"); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.String }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.String = function() { return this.$val.String(); };
	Time.ptr.prototype.Format = function(layout) {
		var $ptr, _r$1, b, buf, layout, max, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; b = $f.b; buf = $f.buf; layout = $f.layout; max = $f.max; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		b = sliceType$3.nil;
		max = layout.length + 10 >> 0;
		if (max < 64) {
			buf = arrayType$2.zero();
			b = $subslice(new sliceType$3(buf), 0, 0);
		} else {
			b = $makeSlice(sliceType$3, 0, max);
		}
		_r$1 = t.AppendFormat(b, layout); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		b = _r$1;
		return $bytesToString(b);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Format }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.b = b; $f.buf = buf; $f.layout = layout; $f.max = max; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Format = function(layout) { return this.$val.Format(layout); };
	Time.ptr.prototype.AppendFormat = function(b, layout) {
		var $ptr, _1, _q, _q$1, _q$2, _q$3, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _tuple$1, _tuple$2, _tuple$3, _tuple$4, abs, absoffset, b, day, hour, hr, hr$1, layout, m, min, month, name, offset, prefix, s, sec, std, suffix, t, y, year, zone$1, zone$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _q = $f._q; _q$1 = $f._q$1; _q$2 = $f._q$2; _q$3 = $f._q$3; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; abs = $f.abs; absoffset = $f.absoffset; b = $f.b; day = $f.day; hour = $f.hour; hr = $f.hr; hr$1 = $f.hr$1; layout = $f.layout; m = $f.m; min = $f.min; month = $f.month; name = $f.name; offset = $f.offset; prefix = $f.prefix; s = $f.s; sec = $f.sec; std = $f.std; suffix = $f.suffix; t = $f.t; y = $f.y; year = $f.year; zone$1 = $f.zone$1; zone$2 = $f.zone$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.locabs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		name = _tuple$1[0];
		offset = _tuple$1[1];
		abs = _tuple$1[2];
		year = -1;
		month = 0;
		day = 0;
		hour = -1;
		min = 0;
		sec = 0;
		while (true) {
			if (!(!(layout === ""))) { break; }
			_tuple$2 = nextStdChunk(layout);
			prefix = _tuple$2[0];
			std = _tuple$2[1];
			suffix = _tuple$2[2];
			if (!(prefix === "")) {
				b = $appendSlice(b, prefix);
			}
			if (std === 0) {
				break;
			}
			layout = suffix;
			if (year < 0 && !(((std & 256) === 0))) {
				_tuple$3 = absDate(abs, true);
				year = _tuple$3[0];
				month = _tuple$3[1];
				day = _tuple$3[2];
			}
			if (hour < 0 && !(((std & 512) === 0))) {
				_tuple$4 = absClock(abs);
				hour = _tuple$4[0];
				min = _tuple$4[1];
				sec = _tuple$4[2];
			}
			switch (0) { default:
				_1 = std & 65535;
				if (_1 === (274)) {
					y = year;
					if (y < 0) {
						y = -y;
					}
					b = appendInt(b, (_r$2 = y % 100, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero")), 2);
				} else if (_1 === (273)) {
					b = appendInt(b, year, 4);
				} else if (_1 === (258)) {
					b = $appendSlice(b, new Month(month).String().substring(0, 3));
				} else if (_1 === (257)) {
					m = new Month(month).String();
					b = $appendSlice(b, m);
				} else if (_1 === (259)) {
					b = appendInt(b, (month >> 0), 0);
				} else if (_1 === (260)) {
					b = appendInt(b, (month >> 0), 2);
				} else if (_1 === (262)) {
					b = $appendSlice(b, new Weekday(absWeekday(abs)).String().substring(0, 3));
				} else if (_1 === (261)) {
					s = new Weekday(absWeekday(abs)).String();
					b = $appendSlice(b, s);
				} else if (_1 === (263)) {
					b = appendInt(b, day, 0);
				} else if (_1 === (264)) {
					if (day < 10) {
						b = $append(b, 32);
					}
					b = appendInt(b, day, 0);
				} else if (_1 === (265)) {
					b = appendInt(b, day, 2);
				} else if (_1 === (522)) {
					b = appendInt(b, hour, 2);
				} else if (_1 === (523)) {
					hr = (_r$3 = hour % 12, _r$3 === _r$3 ? _r$3 : $throwRuntimeError("integer divide by zero"));
					if (hr === 0) {
						hr = 12;
					}
					b = appendInt(b, hr, 0);
				} else if (_1 === (524)) {
					hr$1 = (_r$4 = hour % 12, _r$4 === _r$4 ? _r$4 : $throwRuntimeError("integer divide by zero"));
					if (hr$1 === 0) {
						hr$1 = 12;
					}
					b = appendInt(b, hr$1, 2);
				} else if (_1 === (525)) {
					b = appendInt(b, min, 0);
				} else if (_1 === (526)) {
					b = appendInt(b, min, 2);
				} else if (_1 === (527)) {
					b = appendInt(b, sec, 0);
				} else if (_1 === (528)) {
					b = appendInt(b, sec, 2);
				} else if (_1 === (531)) {
					if (hour >= 12) {
						b = $appendSlice(b, "PM");
					} else {
						b = $appendSlice(b, "AM");
					}
				} else if (_1 === (532)) {
					if (hour >= 12) {
						b = $appendSlice(b, "pm");
					} else {
						b = $appendSlice(b, "am");
					}
				} else if ((_1 === (22)) || (_1 === (25)) || (_1 === (23)) || (_1 === (24)) || (_1 === (26)) || (_1 === (27)) || (_1 === (30)) || (_1 === (28)) || (_1 === (29)) || (_1 === (31))) {
					if ((offset === 0) && ((std === 22) || (std === 25) || (std === 23) || (std === 24) || (std === 26))) {
						b = $append(b, 90);
						break;
					}
					zone$1 = (_q = offset / 60, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
					absoffset = offset;
					if (zone$1 < 0) {
						b = $append(b, 45);
						zone$1 = -zone$1;
						absoffset = -absoffset;
					} else {
						b = $append(b, 43);
					}
					b = appendInt(b, (_q$1 = zone$1 / 60, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero")), 2);
					if ((std === 25) || (std === 30) || (std === 26) || (std === 31)) {
						b = $append(b, 58);
					}
					if (!((std === 29)) && !((std === 24))) {
						b = appendInt(b, (_r$5 = zone$1 % 60, _r$5 === _r$5 ? _r$5 : $throwRuntimeError("integer divide by zero")), 2);
					}
					if ((std === 23) || (std === 28) || (std === 31) || (std === 26)) {
						if ((std === 31) || (std === 26)) {
							b = $append(b, 58);
						}
						b = appendInt(b, (_r$6 = absoffset % 60, _r$6 === _r$6 ? _r$6 : $throwRuntimeError("integer divide by zero")), 2);
					}
				} else if (_1 === (21)) {
					if (!(name === "")) {
						b = $appendSlice(b, name);
						break;
					}
					zone$2 = (_q$2 = offset / 60, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >> 0 : $throwRuntimeError("integer divide by zero"));
					if (zone$2 < 0) {
						b = $append(b, 45);
						zone$2 = -zone$2;
					} else {
						b = $append(b, 43);
					}
					b = appendInt(b, (_q$3 = zone$2 / 60, (_q$3 === _q$3 && _q$3 !== 1/0 && _q$3 !== -1/0) ? _q$3 >> 0 : $throwRuntimeError("integer divide by zero")), 2);
					b = appendInt(b, (_r$7 = zone$2 % 60, _r$7 === _r$7 ? _r$7 : $throwRuntimeError("integer divide by zero")), 2);
				} else if ((_1 === (32)) || (_1 === (33))) {
					b = formatNano(b, (t.Nanosecond() >>> 0), std >> 16 >> 0, (std & 65535) === 33);
				}
			}
		}
		return b;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.AppendFormat }; } $f.$ptr = $ptr; $f._1 = _1; $f._q = _q; $f._q$1 = _q$1; $f._q$2 = _q$2; $f._q$3 = _q$3; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f.abs = abs; $f.absoffset = absoffset; $f.b = b; $f.day = day; $f.hour = hour; $f.hr = hr; $f.hr$1 = hr$1; $f.layout = layout; $f.m = m; $f.min = min; $f.month = month; $f.name = name; $f.offset = offset; $f.prefix = prefix; $f.s = s; $f.sec = sec; $f.std = std; $f.suffix = suffix; $f.t = t; $f.y = y; $f.year = year; $f.zone$1 = zone$1; $f.zone$2 = zone$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.AppendFormat = function(b, layout) { return this.$val.AppendFormat(b, layout); };
	quote = function(s) {
		var $ptr, s;
		return "\"" + s + "\"";
	};
	ParseError.ptr.prototype.Error = function() {
		var $ptr, e;
		e = this;
		if (e.Message === "") {
			return "parsing time " + quote(e.Value) + " as " + quote(e.Layout) + ": cannot parse " + quote(e.ValueElem) + " as " + quote(e.LayoutElem);
		}
		return "parsing time " + quote(e.Value) + e.Message;
	};
	ParseError.prototype.Error = function() { return this.$val.Error(); };
	isDigit = function(s, i) {
		var $ptr, c, i, s;
		if (s.length <= i) {
			return false;
		}
		c = s.charCodeAt(i);
		return 48 <= c && c <= 57;
	};
	getnum = function(s, fixed) {
		var $ptr, fixed, s;
		if (!isDigit(s, 0)) {
			return [0, s, errBad];
		}
		if (!isDigit(s, 1)) {
			if (fixed) {
				return [0, s, errBad];
			}
			return [((s.charCodeAt(0) - 48 << 24 >>> 24) >> 0), s.substring(1), $ifaceNil];
		}
		return [($imul(((s.charCodeAt(0) - 48 << 24 >>> 24) >> 0), 10)) + ((s.charCodeAt(1) - 48 << 24 >>> 24) >> 0) >> 0, s.substring(2), $ifaceNil];
	};
	cutspace = function(s) {
		var $ptr, s;
		while (true) {
			if (!(s.length > 0 && (s.charCodeAt(0) === 32))) { break; }
			s = s.substring(1);
		}
		return s;
	};
	skip = function(value, prefix) {
		var $ptr, prefix, value;
		while (true) {
			if (!(prefix.length > 0)) { break; }
			if (prefix.charCodeAt(0) === 32) {
				if (value.length > 0 && !((value.charCodeAt(0) === 32))) {
					return [value, errBad];
				}
				prefix = cutspace(prefix);
				value = cutspace(value);
				continue;
			}
			if ((value.length === 0) || !((value.charCodeAt(0) === prefix.charCodeAt(0)))) {
				return [value, errBad];
			}
			prefix = prefix.substring(1);
			value = value.substring(1);
		}
		return [value, $ifaceNil];
	};
	Parse = function(layout, value) {
		var $ptr, _r$1, layout, value, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; layout = $f.layout; value = $f.value; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r$1 = parse(layout, value, $pkg.UTC, $pkg.Local); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Parse }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.layout = layout; $f.value = value; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Parse = Parse;
	parse = function(layout, value, defaultLocation, local) {
		var $ptr, _1, _2, _3, _4, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$2, _tmp$20, _tmp$21, _tmp$22, _tmp$23, _tmp$24, _tmp$25, _tmp$26, _tmp$27, _tmp$28, _tmp$29, _tmp$3, _tmp$30, _tmp$31, _tmp$32, _tmp$33, _tmp$34, _tmp$35, _tmp$36, _tmp$37, _tmp$38, _tmp$39, _tmp$4, _tmp$40, _tmp$41, _tmp$42, _tmp$43, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple$1, _tuple$10, _tuple$11, _tuple$12, _tuple$13, _tuple$14, _tuple$15, _tuple$16, _tuple$17, _tuple$18, _tuple$19, _tuple$2, _tuple$20, _tuple$21, _tuple$22, _tuple$23, _tuple$24, _tuple$25, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, _tuple$9, alayout, amSet, avalue, day, defaultLocation, err, hour, hour$1, hr, i, layout, local, min, min$1, mm, month, n, n$1, name, ndigit, nsec, offset, offset$1, ok, ok$1, p, pmSet, prefix, rangeErrString, sec, seconds, sign, ss, std, stdstr, suffix, t, t$1, value, x, x$1, x$2, x$3, x$4, x$5, year, z, zoneName, zoneOffset, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _2 = $f._2; _3 = $f._3; _4 = $f._4; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$10 = $f._tmp$10; _tmp$11 = $f._tmp$11; _tmp$12 = $f._tmp$12; _tmp$13 = $f._tmp$13; _tmp$14 = $f._tmp$14; _tmp$15 = $f._tmp$15; _tmp$16 = $f._tmp$16; _tmp$17 = $f._tmp$17; _tmp$18 = $f._tmp$18; _tmp$19 = $f._tmp$19; _tmp$2 = $f._tmp$2; _tmp$20 = $f._tmp$20; _tmp$21 = $f._tmp$21; _tmp$22 = $f._tmp$22; _tmp$23 = $f._tmp$23; _tmp$24 = $f._tmp$24; _tmp$25 = $f._tmp$25; _tmp$26 = $f._tmp$26; _tmp$27 = $f._tmp$27; _tmp$28 = $f._tmp$28; _tmp$29 = $f._tmp$29; _tmp$3 = $f._tmp$3; _tmp$30 = $f._tmp$30; _tmp$31 = $f._tmp$31; _tmp$32 = $f._tmp$32; _tmp$33 = $f._tmp$33; _tmp$34 = $f._tmp$34; _tmp$35 = $f._tmp$35; _tmp$36 = $f._tmp$36; _tmp$37 = $f._tmp$37; _tmp$38 = $f._tmp$38; _tmp$39 = $f._tmp$39; _tmp$4 = $f._tmp$4; _tmp$40 = $f._tmp$40; _tmp$41 = $f._tmp$41; _tmp$42 = $f._tmp$42; _tmp$43 = $f._tmp$43; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tmp$8 = $f._tmp$8; _tmp$9 = $f._tmp$9; _tuple$1 = $f._tuple$1; _tuple$10 = $f._tuple$10; _tuple$11 = $f._tuple$11; _tuple$12 = $f._tuple$12; _tuple$13 = $f._tuple$13; _tuple$14 = $f._tuple$14; _tuple$15 = $f._tuple$15; _tuple$16 = $f._tuple$16; _tuple$17 = $f._tuple$17; _tuple$18 = $f._tuple$18; _tuple$19 = $f._tuple$19; _tuple$2 = $f._tuple$2; _tuple$20 = $f._tuple$20; _tuple$21 = $f._tuple$21; _tuple$22 = $f._tuple$22; _tuple$23 = $f._tuple$23; _tuple$24 = $f._tuple$24; _tuple$25 = $f._tuple$25; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; _tuple$8 = $f._tuple$8; _tuple$9 = $f._tuple$9; alayout = $f.alayout; amSet = $f.amSet; avalue = $f.avalue; day = $f.day; defaultLocation = $f.defaultLocation; err = $f.err; hour = $f.hour; hour$1 = $f.hour$1; hr = $f.hr; i = $f.i; layout = $f.layout; local = $f.local; min = $f.min; min$1 = $f.min$1; mm = $f.mm; month = $f.month; n = $f.n; n$1 = $f.n$1; name = $f.name; ndigit = $f.ndigit; nsec = $f.nsec; offset = $f.offset; offset$1 = $f.offset$1; ok = $f.ok; ok$1 = $f.ok$1; p = $f.p; pmSet = $f.pmSet; prefix = $f.prefix; rangeErrString = $f.rangeErrString; sec = $f.sec; seconds = $f.seconds; sign = $f.sign; ss = $f.ss; std = $f.std; stdstr = $f.stdstr; suffix = $f.suffix; t = $f.t; t$1 = $f.t$1; value = $f.value; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; year = $f.year; z = $f.z; zoneName = $f.zoneName; zoneOffset = $f.zoneOffset; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tmp = layout;
		_tmp$1 = value;
		alayout = _tmp;
		avalue = _tmp$1;
		rangeErrString = "";
		amSet = false;
		pmSet = false;
		year = 0;
		month = 1;
		day = 1;
		hour = 0;
		min = 0;
		sec = 0;
		nsec = 0;
		z = ptrType$1.nil;
		zoneOffset = -1;
		zoneName = "";
		while (true) {
			err = $ifaceNil;
			_tuple$1 = nextStdChunk(layout);
			prefix = _tuple$1[0];
			std = _tuple$1[1];
			suffix = _tuple$1[2];
			stdstr = layout.substring(prefix.length, (layout.length - suffix.length >> 0));
			_tuple$2 = skip(value, prefix);
			value = _tuple$2[0];
			err = _tuple$2[1];
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, prefix, value, "")];
			}
			if (std === 0) {
				if (!((value.length === 0))) {
					return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, "", value, ": extra text: " + value)];
				}
				break;
			}
			layout = suffix;
			p = "";
			switch (0) { default:
				_1 = std & 65535;
				if (_1 === (274)) {
					if (value.length < 2) {
						err = errBad;
						break;
					}
					_tmp$2 = value.substring(0, 2);
					_tmp$3 = value.substring(2);
					p = _tmp$2;
					value = _tmp$3;
					_tuple$3 = atoi(p);
					year = _tuple$3[0];
					err = _tuple$3[1];
					if (year >= 69) {
						year = year + (1900) >> 0;
					} else {
						year = year + (2000) >> 0;
					}
				} else if (_1 === (273)) {
					if (value.length < 4 || !isDigit(value, 0)) {
						err = errBad;
						break;
					}
					_tmp$4 = value.substring(0, 4);
					_tmp$5 = value.substring(4);
					p = _tmp$4;
					value = _tmp$5;
					_tuple$4 = atoi(p);
					year = _tuple$4[0];
					err = _tuple$4[1];
				} else if (_1 === (258)) {
					_tuple$5 = lookup(shortMonthNames, value);
					month = _tuple$5[0];
					value = _tuple$5[1];
					err = _tuple$5[2];
				} else if (_1 === (257)) {
					_tuple$6 = lookup(longMonthNames, value);
					month = _tuple$6[0];
					value = _tuple$6[1];
					err = _tuple$6[2];
				} else if ((_1 === (259)) || (_1 === (260))) {
					_tuple$7 = getnum(value, std === 260);
					month = _tuple$7[0];
					value = _tuple$7[1];
					err = _tuple$7[2];
					if (month <= 0 || 12 < month) {
						rangeErrString = "month";
					}
				} else if (_1 === (262)) {
					_tuple$8 = lookup(shortDayNames, value);
					value = _tuple$8[1];
					err = _tuple$8[2];
				} else if (_1 === (261)) {
					_tuple$9 = lookup(longDayNames, value);
					value = _tuple$9[1];
					err = _tuple$9[2];
				} else if ((_1 === (263)) || (_1 === (264)) || (_1 === (265))) {
					if ((std === 264) && value.length > 0 && (value.charCodeAt(0) === 32)) {
						value = value.substring(1);
					}
					_tuple$10 = getnum(value, std === 265);
					day = _tuple$10[0];
					value = _tuple$10[1];
					err = _tuple$10[2];
					if (day < 0) {
						rangeErrString = "day";
					}
				} else if (_1 === (522)) {
					_tuple$11 = getnum(value, false);
					hour = _tuple$11[0];
					value = _tuple$11[1];
					err = _tuple$11[2];
					if (hour < 0 || 24 <= hour) {
						rangeErrString = "hour";
					}
				} else if ((_1 === (523)) || (_1 === (524))) {
					_tuple$12 = getnum(value, std === 524);
					hour = _tuple$12[0];
					value = _tuple$12[1];
					err = _tuple$12[2];
					if (hour < 0 || 12 < hour) {
						rangeErrString = "hour";
					}
				} else if ((_1 === (525)) || (_1 === (526))) {
					_tuple$13 = getnum(value, std === 526);
					min = _tuple$13[0];
					value = _tuple$13[1];
					err = _tuple$13[2];
					if (min < 0 || 60 <= min) {
						rangeErrString = "minute";
					}
				} else if ((_1 === (527)) || (_1 === (528))) {
					_tuple$14 = getnum(value, std === 528);
					sec = _tuple$14[0];
					value = _tuple$14[1];
					err = _tuple$14[2];
					if (sec < 0 || 60 <= sec) {
						rangeErrString = "second";
					}
					if (value.length >= 2 && (value.charCodeAt(0) === 46) && isDigit(value, 1)) {
						_tuple$15 = nextStdChunk(layout);
						std = _tuple$15[1];
						std = std & (65535);
						if ((std === 32) || (std === 33)) {
							break;
						}
						n = 2;
						while (true) {
							if (!(n < value.length && isDigit(value, n))) { break; }
							n = n + (1) >> 0;
						}
						_tuple$16 = parseNanoseconds(value, n);
						nsec = _tuple$16[0];
						rangeErrString = _tuple$16[1];
						err = _tuple$16[2];
						value = value.substring(n);
					}
				} else if (_1 === (531)) {
					if (value.length < 2) {
						err = errBad;
						break;
					}
					_tmp$6 = value.substring(0, 2);
					_tmp$7 = value.substring(2);
					p = _tmp$6;
					value = _tmp$7;
					_2 = p;
					if (_2 === ("PM")) {
						pmSet = true;
					} else if (_2 === ("AM")) {
						amSet = true;
					} else {
						err = errBad;
					}
				} else if (_1 === (532)) {
					if (value.length < 2) {
						err = errBad;
						break;
					}
					_tmp$8 = value.substring(0, 2);
					_tmp$9 = value.substring(2);
					p = _tmp$8;
					value = _tmp$9;
					_3 = p;
					if (_3 === ("pm")) {
						pmSet = true;
					} else if (_3 === ("am")) {
						amSet = true;
					} else {
						err = errBad;
					}
				} else if ((_1 === (22)) || (_1 === (25)) || (_1 === (23)) || (_1 === (24)) || (_1 === (26)) || (_1 === (27)) || (_1 === (29)) || (_1 === (30)) || (_1 === (28)) || (_1 === (31))) {
					if (((std === 22) || (std === 24) || (std === 25)) && value.length >= 1 && (value.charCodeAt(0) === 90)) {
						value = value.substring(1);
						z = $pkg.UTC;
						break;
					}
					_tmp$10 = "";
					_tmp$11 = "";
					_tmp$12 = "";
					_tmp$13 = "";
					sign = _tmp$10;
					hour$1 = _tmp$11;
					min$1 = _tmp$12;
					seconds = _tmp$13;
					if ((std === 25) || (std === 30)) {
						if (value.length < 6) {
							err = errBad;
							break;
						}
						if (!((value.charCodeAt(3) === 58))) {
							err = errBad;
							break;
						}
						_tmp$14 = value.substring(0, 1);
						_tmp$15 = value.substring(1, 3);
						_tmp$16 = value.substring(4, 6);
						_tmp$17 = "00";
						_tmp$18 = value.substring(6);
						sign = _tmp$14;
						hour$1 = _tmp$15;
						min$1 = _tmp$16;
						seconds = _tmp$17;
						value = _tmp$18;
					} else if ((std === 29) || (std === 24)) {
						if (value.length < 3) {
							err = errBad;
							break;
						}
						_tmp$19 = value.substring(0, 1);
						_tmp$20 = value.substring(1, 3);
						_tmp$21 = "00";
						_tmp$22 = "00";
						_tmp$23 = value.substring(3);
						sign = _tmp$19;
						hour$1 = _tmp$20;
						min$1 = _tmp$21;
						seconds = _tmp$22;
						value = _tmp$23;
					} else if ((std === 26) || (std === 31)) {
						if (value.length < 9) {
							err = errBad;
							break;
						}
						if (!((value.charCodeAt(3) === 58)) || !((value.charCodeAt(6) === 58))) {
							err = errBad;
							break;
						}
						_tmp$24 = value.substring(0, 1);
						_tmp$25 = value.substring(1, 3);
						_tmp$26 = value.substring(4, 6);
						_tmp$27 = value.substring(7, 9);
						_tmp$28 = value.substring(9);
						sign = _tmp$24;
						hour$1 = _tmp$25;
						min$1 = _tmp$26;
						seconds = _tmp$27;
						value = _tmp$28;
					} else if ((std === 23) || (std === 28)) {
						if (value.length < 7) {
							err = errBad;
							break;
						}
						_tmp$29 = value.substring(0, 1);
						_tmp$30 = value.substring(1, 3);
						_tmp$31 = value.substring(3, 5);
						_tmp$32 = value.substring(5, 7);
						_tmp$33 = value.substring(7);
						sign = _tmp$29;
						hour$1 = _tmp$30;
						min$1 = _tmp$31;
						seconds = _tmp$32;
						value = _tmp$33;
					} else {
						if (value.length < 5) {
							err = errBad;
							break;
						}
						_tmp$34 = value.substring(0, 1);
						_tmp$35 = value.substring(1, 3);
						_tmp$36 = value.substring(3, 5);
						_tmp$37 = "00";
						_tmp$38 = value.substring(5);
						sign = _tmp$34;
						hour$1 = _tmp$35;
						min$1 = _tmp$36;
						seconds = _tmp$37;
						value = _tmp$38;
					}
					_tmp$39 = 0;
					_tmp$40 = 0;
					_tmp$41 = 0;
					hr = _tmp$39;
					mm = _tmp$40;
					ss = _tmp$41;
					_tuple$17 = atoi(hour$1);
					hr = _tuple$17[0];
					err = _tuple$17[1];
					if ($interfaceIsEqual(err, $ifaceNil)) {
						_tuple$18 = atoi(min$1);
						mm = _tuple$18[0];
						err = _tuple$18[1];
					}
					if ($interfaceIsEqual(err, $ifaceNil)) {
						_tuple$19 = atoi(seconds);
						ss = _tuple$19[0];
						err = _tuple$19[1];
					}
					zoneOffset = ($imul(((($imul(hr, 60)) + mm >> 0)), 60)) + ss >> 0;
					_4 = sign.charCodeAt(0);
					if (_4 === (43)) {
					} else if (_4 === (45)) {
						zoneOffset = -zoneOffset;
					} else {
						err = errBad;
					}
				} else if (_1 === (21)) {
					if (value.length >= 3 && value.substring(0, 3) === "UTC") {
						z = $pkg.UTC;
						value = value.substring(3);
						break;
					}
					_tuple$20 = parseTimeZone(value);
					n$1 = _tuple$20[0];
					ok = _tuple$20[1];
					if (!ok) {
						err = errBad;
						break;
					}
					_tmp$42 = value.substring(0, n$1);
					_tmp$43 = value.substring(n$1);
					zoneName = _tmp$42;
					value = _tmp$43;
				} else if (_1 === (32)) {
					ndigit = 1 + ((std >> 16 >> 0)) >> 0;
					if (value.length < ndigit) {
						err = errBad;
						break;
					}
					_tuple$21 = parseNanoseconds(value, ndigit);
					nsec = _tuple$21[0];
					rangeErrString = _tuple$21[1];
					err = _tuple$21[2];
					value = value.substring(ndigit);
				} else if (_1 === (33)) {
					if (value.length < 2 || !((value.charCodeAt(0) === 46)) || value.charCodeAt(1) < 48 || 57 < value.charCodeAt(1)) {
						break;
					}
					i = 0;
					while (true) {
						if (!(i < 9 && (i + 1 >> 0) < value.length && 48 <= value.charCodeAt((i + 1 >> 0)) && value.charCodeAt((i + 1 >> 0)) <= 57)) { break; }
						i = i + (1) >> 0;
					}
					_tuple$22 = parseNanoseconds(value, 1 + i >> 0);
					nsec = _tuple$22[0];
					rangeErrString = _tuple$22[1];
					err = _tuple$22[2];
					value = value.substring((1 + i >> 0));
				}
			}
			if (!(rangeErrString === "")) {
				return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, stdstr, value, ": " + rangeErrString + " out of range")];
			}
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, stdstr, value, "")];
			}
		}
		if (pmSet && hour < 12) {
			hour = hour + (12) >> 0;
		} else if (amSet && (hour === 12)) {
			hour = 0;
		}
		if (day > daysIn((month >> 0), year)) {
			return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, "", value, ": day out of range")];
		}
		/* */ if (!(z === ptrType$1.nil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(z === ptrType$1.nil)) { */ case 1:
			_r$1 = Date(year, (month >> 0), day, hour, min, sec, nsec, z); /* */ $s = 3; case 3: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ $s = 4; case 4:
			return [_r$1, $ifaceNil];
		/* } */ case 2:
		/* */ if (!((zoneOffset === -1))) { $s = 5; continue; }
		/* */ $s = 6; continue;
		/* if (!((zoneOffset === -1))) { */ case 5:
			_r$2 = Date(year, (month >> 0), day, hour, min, sec, nsec, $pkg.UTC); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			t = $clone(_r$2, Time);
			t.sec = (x = t.sec, x$1 = new $Int64(0, zoneOffset), new $Int64(x.$high - x$1.$high, x.$low - x$1.$low));
			_r$3 = local.lookup((x$2 = t.sec, new $Int64(x$2.$high + -15, x$2.$low + 2288912640))); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			_tuple$23 = _r$3;
			name = _tuple$23[0];
			offset = _tuple$23[1];
			if ((offset === zoneOffset) && (zoneName === "" || name === zoneName)) {
				t.loc = local;
				return [t, $ifaceNil];
			}
			t.loc = FixedZone(zoneName, zoneOffset);
			return [t, $ifaceNil];
		/* } */ case 6:
		/* */ if (!(zoneName === "")) { $s = 9; continue; }
		/* */ $s = 10; continue;
		/* if (!(zoneName === "")) { */ case 9:
			_r$4 = Date(year, (month >> 0), day, hour, min, sec, nsec, $pkg.UTC); /* */ $s = 11; case 11: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			t$1 = $clone(_r$4, Time);
			_r$5 = local.lookupName(zoneName, (x$3 = t$1.sec, new $Int64(x$3.$high + -15, x$3.$low + 2288912640))); /* */ $s = 12; case 12: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
			_tuple$24 = _r$5;
			offset$1 = _tuple$24[0];
			ok$1 = _tuple$24[2];
			if (ok$1) {
				t$1.sec = (x$4 = t$1.sec, x$5 = new $Int64(0, offset$1), new $Int64(x$4.$high - x$5.$high, x$4.$low - x$5.$low));
				t$1.loc = local;
				return [t$1, $ifaceNil];
			}
			if (zoneName.length > 3 && zoneName.substring(0, 3) === "GMT") {
				_tuple$25 = atoi(zoneName.substring(3));
				offset$1 = _tuple$25[0];
				offset$1 = $imul(offset$1, (3600));
			}
			t$1.loc = FixedZone(zoneName, offset$1);
			return [t$1, $ifaceNil];
		/* } */ case 10:
		_r$6 = Date(year, (month >> 0), day, hour, min, sec, nsec, defaultLocation); /* */ $s = 13; case 13: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		/* */ $s = 14; case 14:
		return [_r$6, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: parse }; } $f.$ptr = $ptr; $f._1 = _1; $f._2 = _2; $f._3 = _3; $f._4 = _4; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$10 = _tmp$10; $f._tmp$11 = _tmp$11; $f._tmp$12 = _tmp$12; $f._tmp$13 = _tmp$13; $f._tmp$14 = _tmp$14; $f._tmp$15 = _tmp$15; $f._tmp$16 = _tmp$16; $f._tmp$17 = _tmp$17; $f._tmp$18 = _tmp$18; $f._tmp$19 = _tmp$19; $f._tmp$2 = _tmp$2; $f._tmp$20 = _tmp$20; $f._tmp$21 = _tmp$21; $f._tmp$22 = _tmp$22; $f._tmp$23 = _tmp$23; $f._tmp$24 = _tmp$24; $f._tmp$25 = _tmp$25; $f._tmp$26 = _tmp$26; $f._tmp$27 = _tmp$27; $f._tmp$28 = _tmp$28; $f._tmp$29 = _tmp$29; $f._tmp$3 = _tmp$3; $f._tmp$30 = _tmp$30; $f._tmp$31 = _tmp$31; $f._tmp$32 = _tmp$32; $f._tmp$33 = _tmp$33; $f._tmp$34 = _tmp$34; $f._tmp$35 = _tmp$35; $f._tmp$36 = _tmp$36; $f._tmp$37 = _tmp$37; $f._tmp$38 = _tmp$38; $f._tmp$39 = _tmp$39; $f._tmp$4 = _tmp$4; $f._tmp$40 = _tmp$40; $f._tmp$41 = _tmp$41; $f._tmp$42 = _tmp$42; $f._tmp$43 = _tmp$43; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tmp$8 = _tmp$8; $f._tmp$9 = _tmp$9; $f._tuple$1 = _tuple$1; $f._tuple$10 = _tuple$10; $f._tuple$11 = _tuple$11; $f._tuple$12 = _tuple$12; $f._tuple$13 = _tuple$13; $f._tuple$14 = _tuple$14; $f._tuple$15 = _tuple$15; $f._tuple$16 = _tuple$16; $f._tuple$17 = _tuple$17; $f._tuple$18 = _tuple$18; $f._tuple$19 = _tuple$19; $f._tuple$2 = _tuple$2; $f._tuple$20 = _tuple$20; $f._tuple$21 = _tuple$21; $f._tuple$22 = _tuple$22; $f._tuple$23 = _tuple$23; $f._tuple$24 = _tuple$24; $f._tuple$25 = _tuple$25; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f._tuple$8 = _tuple$8; $f._tuple$9 = _tuple$9; $f.alayout = alayout; $f.amSet = amSet; $f.avalue = avalue; $f.day = day; $f.defaultLocation = defaultLocation; $f.err = err; $f.hour = hour; $f.hour$1 = hour$1; $f.hr = hr; $f.i = i; $f.layout = layout; $f.local = local; $f.min = min; $f.min$1 = min$1; $f.mm = mm; $f.month = month; $f.n = n; $f.n$1 = n$1; $f.name = name; $f.ndigit = ndigit; $f.nsec = nsec; $f.offset = offset; $f.offset$1 = offset$1; $f.ok = ok; $f.ok$1 = ok$1; $f.p = p; $f.pmSet = pmSet; $f.prefix = prefix; $f.rangeErrString = rangeErrString; $f.sec = sec; $f.seconds = seconds; $f.sign = sign; $f.ss = ss; $f.std = std; $f.stdstr = stdstr; $f.suffix = suffix; $f.t = t; $f.t$1 = t$1; $f.value = value; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.year = year; $f.z = z; $f.zoneName = zoneName; $f.zoneOffset = zoneOffset; $f.$s = $s; $f.$r = $r; return $f;
	};
	parseTimeZone = function(value) {
		var $ptr, _1, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, c, length, nUpper, ok, value;
		length = 0;
		ok = false;
		if (value.length < 3) {
			_tmp = 0;
			_tmp$1 = false;
			length = _tmp;
			ok = _tmp$1;
			return [length, ok];
		}
		if (value.length >= 4 && (value.substring(0, 4) === "ChST" || value.substring(0, 4) === "MeST")) {
			_tmp$2 = 4;
			_tmp$3 = true;
			length = _tmp$2;
			ok = _tmp$3;
			return [length, ok];
		}
		if (value.substring(0, 3) === "GMT") {
			length = parseGMT(value);
			_tmp$4 = length;
			_tmp$5 = true;
			length = _tmp$4;
			ok = _tmp$5;
			return [length, ok];
		}
		nUpper = 0;
		nUpper = 0;
		while (true) {
			if (!(nUpper < 6)) { break; }
			if (nUpper >= value.length) {
				break;
			}
			c = value.charCodeAt(nUpper);
			if (c < 65 || 90 < c) {
				break;
			}
			nUpper = nUpper + (1) >> 0;
		}
		_1 = nUpper;
		if ((_1 === (0)) || (_1 === (1)) || (_1 === (2)) || (_1 === (6))) {
			_tmp$6 = 0;
			_tmp$7 = false;
			length = _tmp$6;
			ok = _tmp$7;
			return [length, ok];
		} else if (_1 === (5)) {
			if (value.charCodeAt(4) === 84) {
				_tmp$8 = 5;
				_tmp$9 = true;
				length = _tmp$8;
				ok = _tmp$9;
				return [length, ok];
			}
		} else if (_1 === (4)) {
			if (value.charCodeAt(3) === 84) {
				_tmp$10 = 4;
				_tmp$11 = true;
				length = _tmp$10;
				ok = _tmp$11;
				return [length, ok];
			}
		} else if (_1 === (3)) {
			_tmp$12 = 3;
			_tmp$13 = true;
			length = _tmp$12;
			ok = _tmp$13;
			return [length, ok];
		}
		_tmp$14 = 0;
		_tmp$15 = false;
		length = _tmp$14;
		ok = _tmp$15;
		return [length, ok];
	};
	parseGMT = function(value) {
		var $ptr, _tuple$1, err, rem, sign, value, x;
		value = value.substring(3);
		if (value.length === 0) {
			return 3;
		}
		sign = value.charCodeAt(0);
		if (!((sign === 45)) && !((sign === 43))) {
			return 3;
		}
		_tuple$1 = leadingInt(value.substring(1));
		x = _tuple$1[0];
		rem = _tuple$1[1];
		err = _tuple$1[2];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return 3;
		}
		if (sign === 45) {
			x = new $Int64(-x.$high, -x.$low);
		}
		if ((x.$high === 0 && x.$low === 0) || (x.$high < -1 || (x.$high === -1 && x.$low < 4294967282)) || (0 < x.$high || (0 === x.$high && 12 < x.$low))) {
			return 3;
		}
		return (3 + value.length >> 0) - rem.length >> 0;
	};
	parseNanoseconds = function(value, nbytes) {
		var $ptr, _tuple$1, err, i, nbytes, ns, rangeErrString, scaleDigits, value;
		ns = 0;
		rangeErrString = "";
		err = $ifaceNil;
		if (!((value.charCodeAt(0) === 46))) {
			err = errBad;
			return [ns, rangeErrString, err];
		}
		_tuple$1 = atoi(value.substring(1, nbytes));
		ns = _tuple$1[0];
		err = _tuple$1[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [ns, rangeErrString, err];
		}
		if (ns < 0 || 1000000000 <= ns) {
			rangeErrString = "fractional second";
			return [ns, rangeErrString, err];
		}
		scaleDigits = 10 - nbytes >> 0;
		i = 0;
		while (true) {
			if (!(i < scaleDigits)) { break; }
			ns = $imul(ns, (10));
			i = i + (1) >> 0;
		}
		return [ns, rangeErrString, err];
	};
	leadingInt = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, c, err, i, rem, s, x, x$1, x$2, x$3;
		x = new $Int64(0, 0);
		rem = "";
		err = $ifaceNil;
		i = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			c = s.charCodeAt(i);
			if (c < 48 || c > 57) {
				break;
			}
			if ((x.$high > 214748364 || (x.$high === 214748364 && x.$low > 3435973836))) {
				_tmp = new $Int64(0, 0);
				_tmp$1 = "";
				_tmp$2 = errLeadingInt;
				x = _tmp;
				rem = _tmp$1;
				err = _tmp$2;
				return [x, rem, err];
			}
			x = (x$1 = (x$2 = $mul64(x, new $Int64(0, 10)), x$3 = new $Int64(0, c), new $Int64(x$2.$high + x$3.$high, x$2.$low + x$3.$low)), new $Int64(x$1.$high - 0, x$1.$low - 48));
			if ((x.$high < 0 || (x.$high === 0 && x.$low < 0))) {
				_tmp$3 = new $Int64(0, 0);
				_tmp$4 = "";
				_tmp$5 = errLeadingInt;
				x = _tmp$3;
				rem = _tmp$4;
				err = _tmp$5;
				return [x, rem, err];
			}
			i = i + (1) >> 0;
		}
		_tmp$6 = x;
		_tmp$7 = s.substring(i);
		_tmp$8 = $ifaceNil;
		x = _tmp$6;
		rem = _tmp$7;
		err = _tmp$8;
		return [x, rem, err];
	};
	when = function(d) {
		var $ptr, d, t, x, x$1;
		if ((d.$high < 0 || (d.$high === 0 && d.$low <= 0))) {
			return runtimeNano();
		}
		t = (x = runtimeNano(), x$1 = new $Int64(d.$high, d.$low), new $Int64(x.$high + x$1.$high, x.$low + x$1.$low));
		if ((t.$high < 0 || (t.$high === 0 && t.$low < 0))) {
			t = new $Int64(2147483647, 4294967295);
		}
		return t;
	};
	Timer.ptr.prototype.Stop = function() {
		var $ptr, t;
		t = this;
		if (t.r.f === $throwNilPointerError) {
			$panic(new $String("time: Stop called on uninitialized Timer"));
		}
		return stopTimer(t.r);
	};
	Timer.prototype.Stop = function() { return this.$val.Stop(); };
	Timer.ptr.prototype.Reset = function(d) {
		var $ptr, active, d, t, w;
		t = this;
		if (t.r.f === $throwNilPointerError) {
			$panic(new $String("time: Reset called on uninitialized Timer"));
		}
		w = when(d);
		active = stopTimer(t.r);
		t.r.when = w;
		startTimer(t.r);
		return active;
	};
	Timer.prototype.Reset = function(d) { return this.$val.Reset(d); };
	AfterFunc = function(d, f) {
		var $ptr, d, f, t;
		t = new Timer.ptr($chanNil, new runtimeTimer.ptr(0, when(d), new $Int64(0, 0), goFunc, new funcType(f), null, false));
		startTimer(t.r);
		return t;
	};
	$pkg.AfterFunc = AfterFunc;
	goFunc = function(arg, seq) {
		var $ptr, arg, seq;
		$go($assertType(arg, funcType), []);
	};
	Time.ptr.prototype.After = function(u) {
		var $ptr, t, u, x, x$1, x$2, x$3;
		u = $clone(u, Time);
		t = $clone(this, Time);
		return (x = t.sec, x$1 = u.sec, (x.$high > x$1.$high || (x.$high === x$1.$high && x.$low > x$1.$low))) || (x$2 = t.sec, x$3 = u.sec, (x$2.$high === x$3.$high && x$2.$low === x$3.$low)) && t.nsec > u.nsec;
	};
	Time.prototype.After = function(u) { return this.$val.After(u); };
	Time.ptr.prototype.Before = function(u) {
		var $ptr, t, u, x, x$1, x$2, x$3;
		u = $clone(u, Time);
		t = $clone(this, Time);
		return (x = t.sec, x$1 = u.sec, (x.$high < x$1.$high || (x.$high === x$1.$high && x.$low < x$1.$low))) || (x$2 = t.sec, x$3 = u.sec, (x$2.$high === x$3.$high && x$2.$low === x$3.$low)) && t.nsec < u.nsec;
	};
	Time.prototype.Before = function(u) { return this.$val.Before(u); };
	Time.ptr.prototype.Equal = function(u) {
		var $ptr, t, u, x, x$1;
		u = $clone(u, Time);
		t = $clone(this, Time);
		return (x = t.sec, x$1 = u.sec, (x.$high === x$1.$high && x.$low === x$1.$low)) && (t.nsec === u.nsec);
	};
	Time.prototype.Equal = function(u) { return this.$val.Equal(u); };
	Month.prototype.String = function() {
		var $ptr, m, x;
		m = this.$val;
		return (x = m - 1 >> 0, ((x < 0 || x >= months.length) ? $throwRuntimeError("index out of range") : months[x]));
	};
	$ptrType(Month).prototype.String = function() { return new Month(this.$get()).String(); };
	Weekday.prototype.String = function() {
		var $ptr, d;
		d = this.$val;
		return ((d < 0 || d >= days.length) ? $throwRuntimeError("index out of range") : days[d]);
	};
	$ptrType(Weekday).prototype.String = function() { return new Weekday(this.$get()).String(); };
	Time.ptr.prototype.IsZero = function() {
		var $ptr, t, x;
		t = $clone(this, Time);
		return (x = t.sec, (x.$high === 0 && x.$low === 0)) && (t.nsec === 0);
	};
	Time.prototype.IsZero = function() { return this.$val.IsZero(); };
	Time.ptr.prototype.abs = function() {
		var $ptr, _r$1, _r$2, _tuple$1, l, offset, sec, t, x, x$1, x$2, x$3, x$4, x$5, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; l = $f.l; offset = $f.offset; sec = $f.sec; t = $f.t; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		l = t.loc;
		/* */ if (l === ptrType$1.nil || l === localLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (l === ptrType$1.nil || l === localLoc) { */ case 1:
			_r$1 = l.get(); /* */ $s = 3; case 3: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			l = _r$1;
		/* } */ case 2:
		sec = (x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640));
		/* */ if (!(l === utcLoc)) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!(l === utcLoc)) { */ case 4:
			/* */ if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { */ case 6:
				sec = (x$3 = new $Int64(0, l.cacheZone.offset), new $Int64(sec.$high + x$3.$high, sec.$low + x$3.$low));
				$s = 8; continue;
			/* } else { */ case 7:
				_r$2 = l.lookup(sec); /* */ $s = 9; case 9: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_tuple$1 = _r$2;
				offset = _tuple$1[1];
				sec = (x$4 = new $Int64(0, offset), new $Int64(sec.$high + x$4.$high, sec.$low + x$4.$low));
			/* } */ case 8:
		/* } */ case 5:
		return (x$5 = new $Int64(sec.$high + 2147483646, sec.$low + 450480384), new $Uint64(x$5.$high, x$5.$low));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.abs }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.l = l; $f.offset = offset; $f.sec = sec; $f.t = t; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.abs = function() { return this.$val.abs(); };
	Time.ptr.prototype.locabs = function() {
		var $ptr, _r$1, _r$2, _tuple$1, abs, l, name, offset, sec, t, x, x$1, x$2, x$3, x$4, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; abs = $f.abs; l = $f.l; name = $f.name; offset = $f.offset; sec = $f.sec; t = $f.t; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		offset = 0;
		abs = new $Uint64(0, 0);
		t = $clone(this, Time);
		l = t.loc;
		/* */ if (l === ptrType$1.nil || l === localLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (l === ptrType$1.nil || l === localLoc) { */ case 1:
			_r$1 = l.get(); /* */ $s = 3; case 3: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			l = _r$1;
		/* } */ case 2:
		sec = (x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640));
		/* */ if (!(l === utcLoc)) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!(l === utcLoc)) { */ case 4:
			/* */ if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { */ case 7:
				name = l.cacheZone.name;
				offset = l.cacheZone.offset;
				$s = 9; continue;
			/* } else { */ case 8:
				_r$2 = l.lookup(sec); /* */ $s = 10; case 10: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_tuple$1 = _r$2;
				name = _tuple$1[0];
				offset = _tuple$1[1];
			/* } */ case 9:
			sec = (x$3 = new $Int64(0, offset), new $Int64(sec.$high + x$3.$high, sec.$low + x$3.$low));
			$s = 6; continue;
		/* } else { */ case 5:
			name = "UTC";
		/* } */ case 6:
		abs = (x$4 = new $Int64(sec.$high + 2147483646, sec.$low + 450480384), new $Uint64(x$4.$high, x$4.$low));
		return [name, offset, abs];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.locabs }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.abs = abs; $f.l = l; $f.name = name; $f.offset = offset; $f.sec = sec; $f.t = t; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.locabs = function() { return this.$val.locabs(); };
	Time.ptr.prototype.Date = function() {
		var $ptr, _r$1, _tuple$1, day, month, t, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; day = $f.day; month = $f.month; t = $f.t; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		year = 0;
		month = 0;
		day = 0;
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		return [year, month, day];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Date }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.day = day; $f.month = month; $f.t = t; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Date = function() { return this.$val.Date(); };
	Time.ptr.prototype.Year = function() {
		var $ptr, _r$1, _tuple$1, t, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; t = $f.t; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(false); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		return year;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Year }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.t = t; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Year = function() { return this.$val.Year(); };
	Time.ptr.prototype.Month = function() {
		var $ptr, _r$1, _tuple$1, month, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; month = $f.month; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		month = _tuple$1[1];
		return month;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Month }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.month = month; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Month = function() { return this.$val.Month(); };
	Time.ptr.prototype.Day = function() {
		var $ptr, _r$1, _tuple$1, day, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; day = $f.day; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		day = _tuple$1[2];
		return day;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Day }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.day = day; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Day = function() { return this.$val.Day(); };
	Time.ptr.prototype.Weekday = function() {
		var $ptr, _r$1, _r$2, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = absWeekday(_r$1); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Weekday }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Weekday = function() { return this.$val.Weekday(); };
	absWeekday = function(abs) {
		var $ptr, _q, abs, sec;
		sec = $div64((new $Uint64(abs.$high + 0, abs.$low + 86400)), new $Uint64(0, 604800), true);
		return ((_q = (sec.$low >> 0) / 86400, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0);
	};
	Time.ptr.prototype.ISOWeek = function() {
		var $ptr, _q, _r$1, _r$2, _r$3, _r$4, _r$5, _tuple$1, day, dec31wday, jan1wday, month, t, wday, week, yday, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _tuple$1 = $f._tuple$1; day = $f.day; dec31wday = $f.dec31wday; jan1wday = $f.jan1wday; month = $f.month; t = $f.t; wday = $f.wday; week = $f.week; yday = $f.yday; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		year = 0;
		week = 0;
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		yday = _tuple$1[3];
		_r$3 = t.Weekday(); /* */ $s = 2; case 2: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		wday = (_r$2 = ((_r$3 + 6 >> 0) >> 0) % 7, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero"));
		week = (_q = (((yday - wday >> 0) + 7 >> 0)) / 7, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		jan1wday = (_r$4 = (((wday - yday >> 0) + 371 >> 0)) % 7, _r$4 === _r$4 ? _r$4 : $throwRuntimeError("integer divide by zero"));
		if (1 <= jan1wday && jan1wday <= 3) {
			week = week + (1) >> 0;
		}
		if (week === 0) {
			year = year - (1) >> 0;
			week = 52;
			if ((jan1wday === 4) || ((jan1wday === 5) && isLeap(year))) {
				week = week + (1) >> 0;
			}
		}
		if ((month === 12) && day >= 29 && wday < 3) {
			dec31wday = (_r$5 = (((wday + 31 >> 0) - day >> 0)) % 7, _r$5 === _r$5 ? _r$5 : $throwRuntimeError("integer divide by zero"));
			if (0 <= dec31wday && dec31wday <= 2) {
				year = year + (1) >> 0;
				week = 1;
			}
		}
		return [year, week];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.ISOWeek }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._tuple$1 = _tuple$1; $f.day = day; $f.dec31wday = dec31wday; $f.jan1wday = jan1wday; $f.month = month; $f.t = t; $f.wday = wday; $f.week = week; $f.yday = yday; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.ISOWeek = function() { return this.$val.ISOWeek(); };
	Time.ptr.prototype.Clock = function() {
		var $ptr, _r$1, _r$2, _tuple$1, hour, min, sec, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; hour = $f.hour; min = $f.min; sec = $f.sec; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		hour = 0;
		min = 0;
		sec = 0;
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = absClock(_r$1); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple$1 = _r$2;
		hour = _tuple$1[0];
		min = _tuple$1[1];
		sec = _tuple$1[2];
		/* */ $s = 3; case 3:
		return [hour, min, sec];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Clock }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.hour = hour; $f.min = min; $f.sec = sec; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Clock = function() { return this.$val.Clock(); };
	absClock = function(abs) {
		var $ptr, _q, _q$1, abs, hour, min, sec;
		hour = 0;
		min = 0;
		sec = 0;
		sec = ($div64(abs, new $Uint64(0, 86400), true).$low >> 0);
		hour = (_q = sec / 3600, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		sec = sec - (($imul(hour, 3600))) >> 0;
		min = (_q$1 = sec / 60, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
		sec = sec - (($imul(min, 60))) >> 0;
		return [hour, min, sec];
	};
	Time.ptr.prototype.Hour = function() {
		var $ptr, _q, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return (_q = ($div64(_r$1, new $Uint64(0, 86400), true).$low >> 0) / 3600, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Hour }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Hour = function() { return this.$val.Hour(); };
	Time.ptr.prototype.Minute = function() {
		var $ptr, _q, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return (_q = ($div64(_r$1, new $Uint64(0, 3600), true).$low >> 0) / 60, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Minute }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Minute = function() { return this.$val.Minute(); };
	Time.ptr.prototype.Second = function() {
		var $ptr, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return ($div64(_r$1, new $Uint64(0, 60), true).$low >> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Second }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Second = function() { return this.$val.Second(); };
	Time.ptr.prototype.Nanosecond = function() {
		var $ptr, t;
		t = $clone(this, Time);
		return (t.nsec >> 0);
	};
	Time.prototype.Nanosecond = function() { return this.$val.Nanosecond(); };
	Time.ptr.prototype.YearDay = function() {
		var $ptr, _r$1, _tuple$1, t, yday, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; t = $f.t; yday = $f.yday; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(false); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		yday = _tuple$1[3];
		return yday + 1 >> 0;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.YearDay }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.t = t; $f.yday = yday; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.YearDay = function() { return this.$val.YearDay(); };
	Duration.prototype.String = function() {
		var $ptr, _tuple$1, _tuple$2, buf, d, neg, prec, u, w;
		d = this;
		buf = arrayType$4.zero();
		w = 32;
		u = new $Uint64(d.$high, d.$low);
		neg = (d.$high < 0 || (d.$high === 0 && d.$low < 0));
		if (neg) {
			u = new $Uint64(-u.$high, -u.$low);
		}
		if ((u.$high < 0 || (u.$high === 0 && u.$low < 1000000000))) {
			prec = 0;
			w = w - (1) >> 0;
			((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 115);
			w = w - (1) >> 0;
			if ((u.$high === 0 && u.$low === 0)) {
				return "0";
			} else if ((u.$high < 0 || (u.$high === 0 && u.$low < 1000))) {
				prec = 0;
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 110);
			} else if ((u.$high < 0 || (u.$high === 0 && u.$low < 1000000))) {
				prec = 3;
				w = w - (1) >> 0;
				$copyString($subslice(new sliceType$3(buf), w), "\xC2\xB5");
			} else {
				prec = 6;
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 109);
			}
			_tuple$1 = fmtFrac($subslice(new sliceType$3(buf), 0, w), u, prec);
			w = _tuple$1[0];
			u = _tuple$1[1];
			w = fmtInt($subslice(new sliceType$3(buf), 0, w), u);
		} else {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 115);
			_tuple$2 = fmtFrac($subslice(new sliceType$3(buf), 0, w), u, 9);
			w = _tuple$2[0];
			u = _tuple$2[1];
			w = fmtInt($subslice(new sliceType$3(buf), 0, w), $div64(u, new $Uint64(0, 60), true));
			u = $div64(u, (new $Uint64(0, 60)), false);
			if ((u.$high > 0 || (u.$high === 0 && u.$low > 0))) {
				w = w - (1) >> 0;
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 109);
				w = fmtInt($subslice(new sliceType$3(buf), 0, w), $div64(u, new $Uint64(0, 60), true));
				u = $div64(u, (new $Uint64(0, 60)), false);
				if ((u.$high > 0 || (u.$high === 0 && u.$low > 0))) {
					w = w - (1) >> 0;
					((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 104);
					w = fmtInt($subslice(new sliceType$3(buf), 0, w), u);
				}
			}
		}
		if (neg) {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 45);
		}
		return $bytesToString($subslice(new sliceType$3(buf), w));
	};
	$ptrType(Duration).prototype.String = function() { return this.$get().String(); };
	fmtFrac = function(buf, v, prec) {
		var $ptr, _tmp, _tmp$1, buf, digit, i, nv, nw, prec, print, v, w;
		nw = 0;
		nv = new $Uint64(0, 0);
		w = buf.$length;
		print = false;
		i = 0;
		while (true) {
			if (!(i < prec)) { break; }
			digit = $div64(v, new $Uint64(0, 10), true);
			print = print || !((digit.$high === 0 && digit.$low === 0));
			if (print) {
				w = w - (1) >> 0;
				((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = ((digit.$low << 24 >>> 24) + 48 << 24 >>> 24));
			}
			v = $div64(v, (new $Uint64(0, 10)), false);
			i = i + (1) >> 0;
		}
		if (print) {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = 46);
		}
		_tmp = w;
		_tmp$1 = v;
		nw = _tmp;
		nv = _tmp$1;
		return [nw, nv];
	};
	fmtInt = function(buf, v) {
		var $ptr, buf, v, w;
		w = buf.$length;
		if ((v.$high === 0 && v.$low === 0)) {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = 48);
		} else {
			while (true) {
				if (!((v.$high > 0 || (v.$high === 0 && v.$low > 0)))) { break; }
				w = w - (1) >> 0;
				((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = (($div64(v, new $Uint64(0, 10), true).$low << 24 >>> 24) + 48 << 24 >>> 24));
				v = $div64(v, (new $Uint64(0, 10)), false);
			}
		}
		return w;
	};
	Duration.prototype.Nanoseconds = function() {
		var $ptr, d;
		d = this;
		return new $Int64(d.$high, d.$low);
	};
	$ptrType(Duration).prototype.Nanoseconds = function() { return this.$get().Nanoseconds(); };
	Duration.prototype.Seconds = function() {
		var $ptr, d, nsec, sec;
		d = this;
		sec = $div64(d, new Duration(0, 1000000000), false);
		nsec = $div64(d, new Duration(0, 1000000000), true);
		return $flatten64(sec) + $flatten64(nsec) * 1e-09;
	};
	$ptrType(Duration).prototype.Seconds = function() { return this.$get().Seconds(); };
	Duration.prototype.Minutes = function() {
		var $ptr, d, min, nsec;
		d = this;
		min = $div64(d, new Duration(13, 4165425152), false);
		nsec = $div64(d, new Duration(13, 4165425152), true);
		return $flatten64(min) + $flatten64(nsec) * 1.6666666666666667e-11;
	};
	$ptrType(Duration).prototype.Minutes = function() { return this.$get().Minutes(); };
	Duration.prototype.Hours = function() {
		var $ptr, d, hour, nsec;
		d = this;
		hour = $div64(d, new Duration(838, 817405952), false);
		nsec = $div64(d, new Duration(838, 817405952), true);
		return $flatten64(hour) + $flatten64(nsec) * 2.777777777777778e-13;
	};
	$ptrType(Duration).prototype.Hours = function() { return this.$get().Hours(); };
	Time.ptr.prototype.Add = function(d) {
		var $ptr, d, nsec, t, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7;
		t = $clone(this, Time);
		t.sec = (x = t.sec, x$1 = (x$2 = $div64(d, new Duration(0, 1000000000), false), new $Int64(x$2.$high, x$2.$low)), new $Int64(x.$high + x$1.$high, x.$low + x$1.$low));
		nsec = t.nsec + ((x$3 = $div64(d, new Duration(0, 1000000000), true), x$3.$low + ((x$3.$high >> 31) * 4294967296)) >> 0) >> 0;
		if (nsec >= 1000000000) {
			t.sec = (x$4 = t.sec, x$5 = new $Int64(0, 1), new $Int64(x$4.$high + x$5.$high, x$4.$low + x$5.$low));
			nsec = nsec - (1000000000) >> 0;
		} else if (nsec < 0) {
			t.sec = (x$6 = t.sec, x$7 = new $Int64(0, 1), new $Int64(x$6.$high - x$7.$high, x$6.$low - x$7.$low));
			nsec = nsec + (1000000000) >> 0;
		}
		t.nsec = nsec;
		return t;
	};
	Time.prototype.Add = function(d) { return this.$val.Add(d); };
	Time.ptr.prototype.Sub = function(u) {
		var $ptr, d, t, u, x, x$1, x$2, x$3, x$4;
		u = $clone(u, Time);
		t = $clone(this, Time);
		d = (x = $mul64((x$1 = (x$2 = t.sec, x$3 = u.sec, new $Int64(x$2.$high - x$3.$high, x$2.$low - x$3.$low)), new Duration(x$1.$high, x$1.$low)), new Duration(0, 1000000000)), x$4 = new Duration(0, (t.nsec - u.nsec >> 0)), new Duration(x.$high + x$4.$high, x.$low + x$4.$low));
		if (u.Add(d).Equal(t)) {
			return d;
		} else if (t.Before(u)) {
			return new Duration(-2147483648, 0);
		} else {
			return new Duration(2147483647, 4294967295);
		}
	};
	Time.prototype.Sub = function(u) { return this.$val.Sub(u); };
	Time.ptr.prototype.AddDate = function(years, months$1, days$1) {
		var $ptr, _r$1, _r$2, _r$3, _tuple$1, _tuple$2, day, days$1, hour, min, month, months$1, sec, t, year, years, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; day = $f.day; days$1 = $f.days$1; hour = $f.hour; min = $f.min; month = $f.month; months$1 = $f.months$1; sec = $f.sec; t = $f.t; year = $f.year; years = $f.years; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Date(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		_r$2 = t.Clock(); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple$2 = _r$2;
		hour = _tuple$2[0];
		min = _tuple$2[1];
		sec = _tuple$2[2];
		_r$3 = Date(year + years >> 0, month + (months$1 >> 0) >> 0, day + days$1 >> 0, hour, min, sec, (t.nsec >> 0), t.loc); /* */ $s = 3; case 3: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		/* */ $s = 4; case 4:
		return _r$3;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.AddDate }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.day = day; $f.days$1 = days$1; $f.hour = hour; $f.min = min; $f.month = month; $f.months$1 = months$1; $f.sec = sec; $f.t = t; $f.year = year; $f.years = years; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.AddDate = function(years, months$1, days$1) { return this.$val.AddDate(years, months$1, days$1); };
	Time.ptr.prototype.date = function(full) {
		var $ptr, _r$1, _r$2, _tuple$1, day, full, month, t, yday, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; day = $f.day; full = $f.full; month = $f.month; t = $f.t; yday = $f.yday; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		year = 0;
		month = 0;
		day = 0;
		yday = 0;
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = absDate(_r$1, full); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple$1 = _r$2;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		yday = _tuple$1[3];
		/* */ $s = 3; case 3:
		return [year, month, day, yday];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.date }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.day = day; $f.full = full; $f.month = month; $f.t = t; $f.yday = yday; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.date = function(full) { return this.$val.date(full); };
	absDate = function(abs, full) {
		var $ptr, _q, abs, begin, d, day, end, full, month, n, x, x$1, x$10, x$11, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, yday, year;
		year = 0;
		month = 0;
		day = 0;
		yday = 0;
		d = $div64(abs, new $Uint64(0, 86400), false);
		n = $div64(d, new $Uint64(0, 146097), false);
		y = $mul64(new $Uint64(0, 400), n);
		d = (x = $mul64(new $Uint64(0, 146097), n), new $Uint64(d.$high - x.$high, d.$low - x.$low));
		n = $div64(d, new $Uint64(0, 36524), false);
		n = (x$1 = $shiftRightUint64(n, 2), new $Uint64(n.$high - x$1.$high, n.$low - x$1.$low));
		y = (x$2 = $mul64(new $Uint64(0, 100), n), new $Uint64(y.$high + x$2.$high, y.$low + x$2.$low));
		d = (x$3 = $mul64(new $Uint64(0, 36524), n), new $Uint64(d.$high - x$3.$high, d.$low - x$3.$low));
		n = $div64(d, new $Uint64(0, 1461), false);
		y = (x$4 = $mul64(new $Uint64(0, 4), n), new $Uint64(y.$high + x$4.$high, y.$low + x$4.$low));
		d = (x$5 = $mul64(new $Uint64(0, 1461), n), new $Uint64(d.$high - x$5.$high, d.$low - x$5.$low));
		n = $div64(d, new $Uint64(0, 365), false);
		n = (x$6 = $shiftRightUint64(n, 2), new $Uint64(n.$high - x$6.$high, n.$low - x$6.$low));
		y = (x$7 = n, new $Uint64(y.$high + x$7.$high, y.$low + x$7.$low));
		d = (x$8 = $mul64(new $Uint64(0, 365), n), new $Uint64(d.$high - x$8.$high, d.$low - x$8.$low));
		year = ((x$9 = (x$10 = new $Int64(y.$high, y.$low), new $Int64(x$10.$high + -69, x$10.$low + 4075721025)), x$9.$low + ((x$9.$high >> 31) * 4294967296)) >> 0);
		yday = (d.$low >> 0);
		if (!full) {
			return [year, month, day, yday];
		}
		day = yday;
		if (isLeap(year)) {
			if (day > 59) {
				day = day - (1) >> 0;
			} else if ((day === 59)) {
				month = 2;
				day = 29;
				return [year, month, day, yday];
			}
		}
		month = ((_q = day / 31, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0);
		end = ((x$11 = month + 1 >> 0, ((x$11 < 0 || x$11 >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[x$11])) >> 0);
		begin = 0;
		if (day >= end) {
			month = month + (1) >> 0;
			begin = end;
		} else {
			begin = (((month < 0 || month >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[month]) >> 0);
		}
		month = month + (1) >> 0;
		day = (day - begin >> 0) + 1 >> 0;
		return [year, month, day, yday];
	};
	daysIn = function(m, year) {
		var $ptr, m, x, year;
		if ((m === 2) && isLeap(year)) {
			return 29;
		}
		return ((((m < 0 || m >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[m]) - (x = m - 1 >> 0, ((x < 0 || x >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[x])) >> 0) >> 0);
	};
	Time.ptr.prototype.UTC = function() {
		var $ptr, t;
		t = $clone(this, Time);
		t.loc = $pkg.UTC;
		return t;
	};
	Time.prototype.UTC = function() { return this.$val.UTC(); };
	Time.ptr.prototype.Local = function() {
		var $ptr, t;
		t = $clone(this, Time);
		t.loc = $pkg.Local;
		return t;
	};
	Time.prototype.Local = function() { return this.$val.Local(); };
	Time.ptr.prototype.In = function(loc) {
		var $ptr, loc, t;
		t = $clone(this, Time);
		if (loc === ptrType$1.nil) {
			$panic(new $String("time: missing Location in call to Time.In"));
		}
		t.loc = loc;
		return t;
	};
	Time.prototype.In = function(loc) { return this.$val.In(loc); };
	Time.ptr.prototype.Location = function() {
		var $ptr, l, t;
		t = $clone(this, Time);
		l = t.loc;
		if (l === ptrType$1.nil) {
			l = $pkg.UTC;
		}
		return l;
	};
	Time.prototype.Location = function() { return this.$val.Location(); };
	Time.ptr.prototype.Zone = function() {
		var $ptr, _r$1, _tuple$1, name, offset, t, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; name = $f.name; offset = $f.offset; t = $f.t; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		offset = 0;
		t = $clone(this, Time);
		_r$1 = t.loc.lookup((x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640))); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		name = _tuple$1[0];
		offset = _tuple$1[1];
		return [name, offset];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Zone }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.name = name; $f.offset = offset; $f.t = t; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Zone = function() { return this.$val.Zone(); };
	Time.ptr.prototype.Unix = function() {
		var $ptr, t, x;
		t = $clone(this, Time);
		return (x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640));
	};
	Time.prototype.Unix = function() { return this.$val.Unix(); };
	Time.ptr.prototype.UnixNano = function() {
		var $ptr, t, x, x$1, x$2;
		t = $clone(this, Time);
		return (x = $mul64(((x$1 = t.sec, new $Int64(x$1.$high + -15, x$1.$low + 2288912640))), new $Int64(0, 1000000000)), x$2 = new $Int64(0, t.nsec), new $Int64(x.$high + x$2.$high, x.$low + x$2.$low));
	};
	Time.prototype.UnixNano = function() { return this.$val.UnixNano(); };
	Time.ptr.prototype.MarshalBinary = function() {
		var $ptr, _q, _r$1, _r$2, _tuple$1, enc, offset, offsetMin, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; enc = $f.enc; offset = $f.offset; offsetMin = $f.offsetMin; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		offsetMin = 0;
		/* */ if (t.Location() === utcLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (t.Location() === utcLoc) { */ case 1:
			offsetMin = -1;
			$s = 3; continue;
		/* } else { */ case 2:
			_r$1 = t.Zone(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple$1 = _r$1;
			offset = _tuple$1[1];
			if (!(((_r$2 = offset % 60, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero")) === 0))) {
				return [sliceType$3.nil, errors.New("Time.MarshalBinary: zone offset has fractional minute")];
			}
			offset = (_q = offset / (60), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
			if (offset < -32768 || (offset === -1) || offset > 32767) {
				return [sliceType$3.nil, errors.New("Time.MarshalBinary: unexpected zone offset")];
			}
			offsetMin = (offset << 16 >> 16);
		/* } */ case 3:
		enc = new sliceType$3([1, ($shiftRightInt64(t.sec, 56).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 48).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 40).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 32).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 24).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 16).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 8).$low << 24 >>> 24), (t.sec.$low << 24 >>> 24), ((t.nsec >> 24 >> 0) << 24 >>> 24), ((t.nsec >> 16 >> 0) << 24 >>> 24), ((t.nsec >> 8 >> 0) << 24 >>> 24), (t.nsec << 24 >>> 24), ((offsetMin >> 8 << 16 >> 16) << 24 >>> 24), (offsetMin << 24 >>> 24)]);
		return [enc, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.MarshalBinary }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.enc = enc; $f.offset = offset; $f.offsetMin = offsetMin; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.MarshalBinary = function() { return this.$val.MarshalBinary(); };
	Time.ptr.prototype.UnmarshalBinary = function(data$1) {
		var $ptr, _r$1, _tuple$1, buf, data$1, localoff, offset, t, x, x$1, x$10, x$11, x$12, x$13, x$14, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; buf = $f.buf; data$1 = $f.data$1; localoff = $f.localoff; offset = $f.offset; t = $f.t; x = $f.x; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$13 = $f.x$13; x$14 = $f.x$14; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		buf = data$1;
		if (buf.$length === 0) {
			return errors.New("Time.UnmarshalBinary: no data");
		}
		if (!(((0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0]) === 1))) {
			return errors.New("Time.UnmarshalBinary: unsupported version");
		}
		if (!((buf.$length === 15))) {
			return errors.New("Time.UnmarshalBinary: invalid length");
		}
		buf = $subslice(buf, 1);
		t.sec = (x = (x$1 = (x$2 = (x$3 = (x$4 = (x$5 = (x$6 = new $Int64(0, (7 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 7])), x$7 = $shiftLeft64(new $Int64(0, (6 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 6])), 8), new $Int64(x$6.$high | x$7.$high, (x$6.$low | x$7.$low) >>> 0)), x$8 = $shiftLeft64(new $Int64(0, (5 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 5])), 16), new $Int64(x$5.$high | x$8.$high, (x$5.$low | x$8.$low) >>> 0)), x$9 = $shiftLeft64(new $Int64(0, (4 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 4])), 24), new $Int64(x$4.$high | x$9.$high, (x$4.$low | x$9.$low) >>> 0)), x$10 = $shiftLeft64(new $Int64(0, (3 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 3])), 32), new $Int64(x$3.$high | x$10.$high, (x$3.$low | x$10.$low) >>> 0)), x$11 = $shiftLeft64(new $Int64(0, (2 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 2])), 40), new $Int64(x$2.$high | x$11.$high, (x$2.$low | x$11.$low) >>> 0)), x$12 = $shiftLeft64(new $Int64(0, (1 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 1])), 48), new $Int64(x$1.$high | x$12.$high, (x$1.$low | x$12.$low) >>> 0)), x$13 = $shiftLeft64(new $Int64(0, (0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0])), 56), new $Int64(x.$high | x$13.$high, (x.$low | x$13.$low) >>> 0));
		buf = $subslice(buf, 8);
		t.nsec = ((((3 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 3]) >> 0) | (((2 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 2]) >> 0) << 8 >> 0)) | (((1 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 1]) >> 0) << 16 >> 0)) | (((0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0]) >> 0) << 24 >> 0);
		buf = $subslice(buf, 4);
		offset = $imul(((((1 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 1]) << 16 >> 16) | (((0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0]) << 16 >> 16) << 8 << 16 >> 16)) >> 0), 60);
		/* */ if (offset === -60) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (offset === -60) { */ case 1:
			t.loc = utcLoc;
			$s = 3; continue;
		/* } else { */ case 2:
			_r$1 = $pkg.Local.lookup((x$14 = t.sec, new $Int64(x$14.$high + -15, x$14.$low + 2288912640))); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple$1 = _r$1;
			localoff = _tuple$1[1];
			if (offset === localoff) {
				t.loc = $pkg.Local;
			} else {
				t.loc = FixedZone("", offset);
			}
		/* } */ case 3:
		return $ifaceNil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.UnmarshalBinary }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.buf = buf; $f.data$1 = data$1; $f.localoff = localoff; $f.offset = offset; $f.t = t; $f.x = x; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$13 = x$13; $f.x$14 = x$14; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.UnmarshalBinary = function(data$1) { return this.$val.UnmarshalBinary(data$1); };
	Time.ptr.prototype.GobEncode = function() {
		var $ptr, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.MarshalBinary(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.GobEncode }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.GobEncode = function() { return this.$val.GobEncode(); };
	Time.ptr.prototype.GobDecode = function(data$1) {
		var $ptr, _r$1, data$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; data$1 = $f.data$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r$1 = t.UnmarshalBinary(data$1); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.GobDecode }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.data$1 = data$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.GobDecode = function(data$1) { return this.$val.GobDecode(data$1); };
	Time.ptr.prototype.MarshalJSON = function() {
		var $ptr, _r$1, _r$2, b, t, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; b = $f.b; t = $f.t; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Year(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		y = _r$1;
		if (y < 0 || y >= 10000) {
			return [sliceType$3.nil, errors.New("Time.MarshalJSON: year outside of range [0,9999]")];
		}
		b = $makeSlice(sliceType$3, 0, 37);
		b = $append(b, 34);
		_r$2 = t.AppendFormat(b, "2006-01-02T15:04:05.999999999Z07:00"); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		b = _r$2;
		b = $append(b, 34);
		return [b, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.MarshalJSON }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.b = b; $f.t = t; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.MarshalJSON = function() { return this.$val.MarshalJSON(); };
	Time.ptr.prototype.UnmarshalJSON = function(data$1) {
		var $ptr, _r$1, _tuple$1, data$1, err, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; data$1 = $f.data$1; err = $f.err; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		err = $ifaceNil;
		t = this;
		_r$1 = Parse("\"2006-01-02T15:04:05Z07:00\"", $bytesToString(data$1)); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		Time.copy(t, _tuple$1[0]);
		err = _tuple$1[1];
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.UnmarshalJSON }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.data$1 = data$1; $f.err = err; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.UnmarshalJSON = function(data$1) { return this.$val.UnmarshalJSON(data$1); };
	Time.ptr.prototype.MarshalText = function() {
		var $ptr, _r$1, _r$2, b, t, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; b = $f.b; t = $f.t; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Year(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		y = _r$1;
		if (y < 0 || y >= 10000) {
			return [sliceType$3.nil, errors.New("Time.MarshalText: year outside of range [0,9999]")];
		}
		b = $makeSlice(sliceType$3, 0, 35);
		_r$2 = t.AppendFormat(b, "2006-01-02T15:04:05.999999999Z07:00"); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return [_r$2, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.MarshalText }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.b = b; $f.t = t; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.MarshalText = function() { return this.$val.MarshalText(); };
	Time.ptr.prototype.UnmarshalText = function(data$1) {
		var $ptr, _r$1, _tuple$1, data$1, err, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; data$1 = $f.data$1; err = $f.err; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		err = $ifaceNil;
		t = this;
		_r$1 = Parse("2006-01-02T15:04:05Z07:00", $bytesToString(data$1)); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		Time.copy(t, _tuple$1[0]);
		err = _tuple$1[1];
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.UnmarshalText }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.data$1 = data$1; $f.err = err; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.UnmarshalText = function(data$1) { return this.$val.UnmarshalText(data$1); };
	Unix = function(sec, nsec) {
		var $ptr, n, nsec, sec, x, x$1, x$2, x$3;
		if ((nsec.$high < 0 || (nsec.$high === 0 && nsec.$low < 0)) || (nsec.$high > 0 || (nsec.$high === 0 && nsec.$low >= 1000000000))) {
			n = $div64(nsec, new $Int64(0, 1000000000), false);
			sec = (x = n, new $Int64(sec.$high + x.$high, sec.$low + x.$low));
			nsec = (x$1 = $mul64(n, new $Int64(0, 1000000000)), new $Int64(nsec.$high - x$1.$high, nsec.$low - x$1.$low));
			if ((nsec.$high < 0 || (nsec.$high === 0 && nsec.$low < 0))) {
				nsec = (x$2 = new $Int64(0, 1000000000), new $Int64(nsec.$high + x$2.$high, nsec.$low + x$2.$low));
				sec = (x$3 = new $Int64(0, 1), new $Int64(sec.$high - x$3.$high, sec.$low - x$3.$low));
			}
		}
		return new Time.ptr(new $Int64(sec.$high + 14, sec.$low + 2006054656), ((nsec.$low + ((nsec.$high >> 31) * 4294967296)) >> 0), $pkg.Local);
	};
	$pkg.Unix = Unix;
	isLeap = function(year) {
		var $ptr, _r$1, _r$2, _r$3, year;
		return ((_r$1 = year % 4, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0) && (!(((_r$2 = year % 100, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero")) === 0)) || ((_r$3 = year % 400, _r$3 === _r$3 ? _r$3 : $throwRuntimeError("integer divide by zero")) === 0));
	};
	norm = function(hi, lo, base) {
		var $ptr, _q, _q$1, _tmp, _tmp$1, base, hi, lo, n, n$1, nhi, nlo;
		nhi = 0;
		nlo = 0;
		if (lo < 0) {
			n = (_q = ((-lo - 1 >> 0)) / base, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) + 1 >> 0;
			hi = hi - (n) >> 0;
			lo = lo + (($imul(n, base))) >> 0;
		}
		if (lo >= base) {
			n$1 = (_q$1 = lo / base, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
			hi = hi + (n$1) >> 0;
			lo = lo - (($imul(n$1, base))) >> 0;
		}
		_tmp = hi;
		_tmp$1 = lo;
		nhi = _tmp;
		nlo = _tmp$1;
		return [nhi, nlo];
	};
	Date = function(year, month, day, hour, min, sec, nsec, loc) {
		var $ptr, _r$1, _r$2, _r$3, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, abs, d, day, end, hour, loc, m, min, month, n, nsec, offset, sec, start, unix, utc, x, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; _tuple$8 = $f._tuple$8; abs = $f.abs; d = $f.d; day = $f.day; end = $f.end; hour = $f.hour; loc = $f.loc; m = $f.m; min = $f.min; month = $f.month; n = $f.n; nsec = $f.nsec; offset = $f.offset; sec = $f.sec; start = $f.start; unix = $f.unix; utc = $f.utc; x = $f.x; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$13 = $f.x$13; x$14 = $f.x$14; x$15 = $f.x$15; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; y = $f.y; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (loc === ptrType$1.nil) {
			$panic(new $String("time: missing Location in call to Date"));
		}
		m = (month >> 0) - 1 >> 0;
		_tuple$1 = norm(year, m, 12);
		year = _tuple$1[0];
		m = _tuple$1[1];
		month = (m >> 0) + 1 >> 0;
		_tuple$2 = norm(sec, nsec, 1000000000);
		sec = _tuple$2[0];
		nsec = _tuple$2[1];
		_tuple$3 = norm(min, sec, 60);
		min = _tuple$3[0];
		sec = _tuple$3[1];
		_tuple$4 = norm(hour, min, 60);
		hour = _tuple$4[0];
		min = _tuple$4[1];
		_tuple$5 = norm(day, hour, 24);
		day = _tuple$5[0];
		hour = _tuple$5[1];
		y = (x = (x$1 = new $Int64(0, year), new $Int64(x$1.$high - -69, x$1.$low - 4075721025)), new $Uint64(x.$high, x.$low));
		n = $div64(y, new $Uint64(0, 400), false);
		y = (x$2 = $mul64(new $Uint64(0, 400), n), new $Uint64(y.$high - x$2.$high, y.$low - x$2.$low));
		d = $mul64(new $Uint64(0, 146097), n);
		n = $div64(y, new $Uint64(0, 100), false);
		y = (x$3 = $mul64(new $Uint64(0, 100), n), new $Uint64(y.$high - x$3.$high, y.$low - x$3.$low));
		d = (x$4 = $mul64(new $Uint64(0, 36524), n), new $Uint64(d.$high + x$4.$high, d.$low + x$4.$low));
		n = $div64(y, new $Uint64(0, 4), false);
		y = (x$5 = $mul64(new $Uint64(0, 4), n), new $Uint64(y.$high - x$5.$high, y.$low - x$5.$low));
		d = (x$6 = $mul64(new $Uint64(0, 1461), n), new $Uint64(d.$high + x$6.$high, d.$low + x$6.$low));
		n = y;
		d = (x$7 = $mul64(new $Uint64(0, 365), n), new $Uint64(d.$high + x$7.$high, d.$low + x$7.$low));
		d = (x$8 = new $Uint64(0, (x$9 = month - 1 >> 0, ((x$9 < 0 || x$9 >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[x$9]))), new $Uint64(d.$high + x$8.$high, d.$low + x$8.$low));
		if (isLeap(year) && month >= 3) {
			d = (x$10 = new $Uint64(0, 1), new $Uint64(d.$high + x$10.$high, d.$low + x$10.$low));
		}
		d = (x$11 = new $Uint64(0, (day - 1 >> 0)), new $Uint64(d.$high + x$11.$high, d.$low + x$11.$low));
		abs = $mul64(d, new $Uint64(0, 86400));
		abs = (x$12 = new $Uint64(0, ((($imul(hour, 3600)) + ($imul(min, 60)) >> 0) + sec >> 0)), new $Uint64(abs.$high + x$12.$high, abs.$low + x$12.$low));
		unix = (x$13 = new $Int64(abs.$high, abs.$low), new $Int64(x$13.$high + -2147483647, x$13.$low + 3844486912));
		_r$1 = loc.lookup(unix); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$6 = _r$1;
		offset = _tuple$6[1];
		start = _tuple$6[3];
		end = _tuple$6[4];
		/* */ if (!((offset === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((offset === 0))) { */ case 2:
				utc = (x$14 = new $Int64(0, offset), new $Int64(unix.$high - x$14.$high, unix.$low - x$14.$low));
				/* */ if ((utc.$high < start.$high || (utc.$high === start.$high && utc.$low < start.$low))) { $s = 5; continue; }
				/* */ if ((utc.$high > end.$high || (utc.$high === end.$high && utc.$low >= end.$low))) { $s = 6; continue; }
				/* */ $s = 7; continue;
				/* if ((utc.$high < start.$high || (utc.$high === start.$high && utc.$low < start.$low))) { */ case 5:
					_r$2 = loc.lookup(new $Int64(start.$high - 0, start.$low - 1)); /* */ $s = 8; case 8: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					_tuple$7 = _r$2;
					offset = _tuple$7[1];
					$s = 7; continue;
				/* } else if ((utc.$high > end.$high || (utc.$high === end.$high && utc.$low >= end.$low))) { */ case 6:
					_r$3 = loc.lookup(end); /* */ $s = 9; case 9: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					_tuple$8 = _r$3;
					offset = _tuple$8[1];
				/* } */ case 7:
			case 4:
			unix = (x$15 = new $Int64(0, offset), new $Int64(unix.$high - x$15.$high, unix.$low - x$15.$low));
		/* } */ case 3:
		return new Time.ptr(new $Int64(unix.$high + 14, unix.$low + 2006054656), (nsec >> 0), loc);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Date }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f._tuple$8 = _tuple$8; $f.abs = abs; $f.d = d; $f.day = day; $f.end = end; $f.hour = hour; $f.loc = loc; $f.m = m; $f.min = min; $f.month = month; $f.n = n; $f.nsec = nsec; $f.offset = offset; $f.sec = sec; $f.start = start; $f.unix = unix; $f.utc = utc; $f.x = x; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$13 = x$13; $f.x$14 = x$14; $f.x$15 = x$15; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.y = y; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Date = Date;
	Time.ptr.prototype.Truncate = function(d) {
		var $ptr, _tuple$1, d, r, t;
		t = $clone(this, Time);
		if ((d.$high < 0 || (d.$high === 0 && d.$low <= 0))) {
			return t;
		}
		_tuple$1 = div(t, d);
		r = _tuple$1[1];
		return t.Add(new Duration(-r.$high, -r.$low));
	};
	Time.prototype.Truncate = function(d) { return this.$val.Truncate(d); };
	Time.ptr.prototype.Round = function(d) {
		var $ptr, _tuple$1, d, r, t, x;
		t = $clone(this, Time);
		if ((d.$high < 0 || (d.$high === 0 && d.$low <= 0))) {
			return t;
		}
		_tuple$1 = div(t, d);
		r = _tuple$1[1];
		if ((x = new Duration(r.$high + r.$high, r.$low + r.$low), (x.$high < d.$high || (x.$high === d.$high && x.$low < d.$low)))) {
			return t.Add(new Duration(-r.$high, -r.$low));
		}
		return t.Add(new Duration(d.$high - r.$high, d.$low - r.$low));
	};
	Time.prototype.Round = function(d) { return this.$val.Round(d); };
	div = function(t, d) {
		var $ptr, _q, _r$1, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, d, d0, d1, d1$1, neg, nsec, qmod2, r, sec, t, tmp, u0, u0x, u1, x, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$16, x$17, x$18, x$19, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		qmod2 = 0;
		r = new Duration(0, 0);
		t = $clone(t, Time);
		neg = false;
		nsec = t.nsec;
		if ((x = t.sec, (x.$high < 0 || (x.$high === 0 && x.$low < 0)))) {
			neg = true;
			t.sec = (x$1 = t.sec, new $Int64(-x$1.$high, -x$1.$low));
			nsec = -nsec;
			if (nsec < 0) {
				nsec = nsec + (1000000000) >> 0;
				t.sec = (x$2 = t.sec, x$3 = new $Int64(0, 1), new $Int64(x$2.$high - x$3.$high, x$2.$low - x$3.$low));
			}
		}
		if ((d.$high < 0 || (d.$high === 0 && d.$low < 1000000000)) && (x$4 = $div64(new Duration(0, 1000000000), (new Duration(d.$high + d.$high, d.$low + d.$low)), true), (x$4.$high === 0 && x$4.$low === 0))) {
			qmod2 = ((_q = nsec / ((d.$low + ((d.$high >> 31) * 4294967296)) >> 0), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0) & 1;
			r = new Duration(0, (_r$1 = nsec % ((d.$low + ((d.$high >> 31) * 4294967296)) >> 0), _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")));
		} else if ((x$5 = $div64(d, new Duration(0, 1000000000), true), (x$5.$high === 0 && x$5.$low === 0))) {
			d1 = (x$6 = $div64(d, new Duration(0, 1000000000), false), new $Int64(x$6.$high, x$6.$low));
			qmod2 = ((x$7 = $div64(t.sec, d1, false), x$7.$low + ((x$7.$high >> 31) * 4294967296)) >> 0) & 1;
			r = (x$8 = $mul64((x$9 = $div64(t.sec, d1, true), new Duration(x$9.$high, x$9.$low)), new Duration(0, 1000000000)), x$10 = new Duration(0, nsec), new Duration(x$8.$high + x$10.$high, x$8.$low + x$10.$low));
		} else {
			sec = (x$11 = t.sec, new $Uint64(x$11.$high, x$11.$low));
			tmp = $mul64(($shiftRightUint64(sec, 32)), new $Uint64(0, 1000000000));
			u1 = $shiftRightUint64(tmp, 32);
			u0 = $shiftLeft64(tmp, 32);
			tmp = $mul64(new $Uint64(sec.$high & 0, (sec.$low & 4294967295) >>> 0), new $Uint64(0, 1000000000));
			_tmp = u0;
			_tmp$1 = new $Uint64(u0.$high + tmp.$high, u0.$low + tmp.$low);
			u0x = _tmp;
			u0 = _tmp$1;
			if ((u0.$high < u0x.$high || (u0.$high === u0x.$high && u0.$low < u0x.$low))) {
				u1 = (x$12 = new $Uint64(0, 1), new $Uint64(u1.$high + x$12.$high, u1.$low + x$12.$low));
			}
			_tmp$2 = u0;
			_tmp$3 = (x$13 = new $Uint64(0, nsec), new $Uint64(u0.$high + x$13.$high, u0.$low + x$13.$low));
			u0x = _tmp$2;
			u0 = _tmp$3;
			if ((u0.$high < u0x.$high || (u0.$high === u0x.$high && u0.$low < u0x.$low))) {
				u1 = (x$14 = new $Uint64(0, 1), new $Uint64(u1.$high + x$14.$high, u1.$low + x$14.$low));
			}
			d1$1 = new $Uint64(d.$high, d.$low);
			while (true) {
				if (!(!((x$15 = $shiftRightUint64(d1$1, 63), (x$15.$high === 0 && x$15.$low === 1))))) { break; }
				d1$1 = $shiftLeft64(d1$1, (1));
			}
			d0 = new $Uint64(0, 0);
			while (true) {
				qmod2 = 0;
				if ((u1.$high > d1$1.$high || (u1.$high === d1$1.$high && u1.$low > d1$1.$low)) || (u1.$high === d1$1.$high && u1.$low === d1$1.$low) && (u0.$high > d0.$high || (u0.$high === d0.$high && u0.$low >= d0.$low))) {
					qmod2 = 1;
					_tmp$4 = u0;
					_tmp$5 = new $Uint64(u0.$high - d0.$high, u0.$low - d0.$low);
					u0x = _tmp$4;
					u0 = _tmp$5;
					if ((u0.$high > u0x.$high || (u0.$high === u0x.$high && u0.$low > u0x.$low))) {
						u1 = (x$16 = new $Uint64(0, 1), new $Uint64(u1.$high - x$16.$high, u1.$low - x$16.$low));
					}
					u1 = (x$17 = d1$1, new $Uint64(u1.$high - x$17.$high, u1.$low - x$17.$low));
				}
				if ((d1$1.$high === 0 && d1$1.$low === 0) && (x$18 = new $Uint64(d.$high, d.$low), (d0.$high === x$18.$high && d0.$low === x$18.$low))) {
					break;
				}
				d0 = $shiftRightUint64(d0, (1));
				d0 = (x$19 = $shiftLeft64((new $Uint64(d1$1.$high & 0, (d1$1.$low & 1) >>> 0)), 63), new $Uint64(d0.$high | x$19.$high, (d0.$low | x$19.$low) >>> 0));
				d1$1 = $shiftRightUint64(d1$1, (1));
			}
			r = new Duration(u0.$high, u0.$low);
		}
		if (neg && !((r.$high === 0 && r.$low === 0))) {
			qmod2 = (qmod2 ^ (1)) >> 0;
			r = new Duration(d.$high - r.$high, d.$low - r.$low);
		}
		return [qmod2, r];
	};
	Location.ptr.prototype.get = function() {
		var $ptr, l, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; l = $f.l; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		l = this;
		if (l === ptrType$1.nil) {
			return utcLoc;
		}
		/* */ if (l === localLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (l === localLoc) { */ case 1:
			$r = localOnce.Do(initLocal); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		return l;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.get }; } $f.$ptr = $ptr; $f.l = l; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.get = function() { return this.$val.get(); };
	Location.ptr.prototype.String = function() {
		var $ptr, _r$1, l, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; l = $f.l; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		l = this;
		_r$1 = l.get(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r$1.name;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.String }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.l = l; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.String = function() { return this.$val.String(); };
	FixedZone = function(name, offset) {
		var $ptr, l, name, offset, x;
		l = new Location.ptr(name, new sliceType([new zone.ptr(name, offset, false)]), new sliceType$1([new zoneTrans.ptr(new $Int64(-2147483648, 0), 0, false, false)]), new $Int64(-2147483648, 0), new $Int64(2147483647, 4294967295), ptrType.nil);
		l.cacheZone = (x = l.zone, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0]));
		return l;
	};
	$pkg.FixedZone = FixedZone;
	Location.ptr.prototype.lookup = function(sec) {
		var $ptr, _q, _r$1, end, hi, isDST, l, lim, lo, m, name, offset, sec, start, tx, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8, zone$1, zone$2, zone$3, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; end = $f.end; hi = $f.hi; isDST = $f.isDST; l = $f.l; lim = $f.lim; lo = $f.lo; m = $f.m; name = $f.name; offset = $f.offset; sec = $f.sec; start = $f.start; tx = $f.tx; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; zone$1 = $f.zone$1; zone$2 = $f.zone$2; zone$3 = $f.zone$3; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		offset = 0;
		isDST = false;
		start = new $Int64(0, 0);
		end = new $Int64(0, 0);
		l = this;
		_r$1 = l.get(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		l = _r$1;
		if (l.zone.$length === 0) {
			name = "UTC";
			offset = 0;
			isDST = false;
			start = new $Int64(-2147483648, 0);
			end = new $Int64(2147483647, 4294967295);
			return [name, offset, isDST, start, end];
		}
		zone$1 = l.cacheZone;
		if (!(zone$1 === ptrType.nil) && (x = l.cacheStart, (x.$high < sec.$high || (x.$high === sec.$high && x.$low <= sec.$low))) && (x$1 = l.cacheEnd, (sec.$high < x$1.$high || (sec.$high === x$1.$high && sec.$low < x$1.$low)))) {
			name = zone$1.name;
			offset = zone$1.offset;
			isDST = zone$1.isDST;
			start = l.cacheStart;
			end = l.cacheEnd;
			return [name, offset, isDST, start, end];
		}
		if ((l.tx.$length === 0) || (x$2 = (x$3 = l.tx, (0 >= x$3.$length ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 0])).when, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) {
			zone$2 = (x$4 = l.zone, x$5 = l.lookupFirstZone(), ((x$5 < 0 || x$5 >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + x$5]));
			name = zone$2.name;
			offset = zone$2.offset;
			isDST = zone$2.isDST;
			start = new $Int64(-2147483648, 0);
			if (l.tx.$length > 0) {
				end = (x$6 = l.tx, (0 >= x$6.$length ? $throwRuntimeError("index out of range") : x$6.$array[x$6.$offset + 0])).when;
			} else {
				end = new $Int64(2147483647, 4294967295);
			}
			return [name, offset, isDST, start, end];
		}
		tx = l.tx;
		end = new $Int64(2147483647, 4294967295);
		lo = 0;
		hi = tx.$length;
		while (true) {
			if (!((hi - lo >> 0) > 1)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			lim = ((m < 0 || m >= tx.$length) ? $throwRuntimeError("index out of range") : tx.$array[tx.$offset + m]).when;
			if ((sec.$high < lim.$high || (sec.$high === lim.$high && sec.$low < lim.$low))) {
				end = lim;
				hi = m;
			} else {
				lo = m;
			}
		}
		zone$3 = (x$7 = l.zone, x$8 = ((lo < 0 || lo >= tx.$length) ? $throwRuntimeError("index out of range") : tx.$array[tx.$offset + lo]).index, ((x$8 < 0 || x$8 >= x$7.$length) ? $throwRuntimeError("index out of range") : x$7.$array[x$7.$offset + x$8]));
		name = zone$3.name;
		offset = zone$3.offset;
		isDST = zone$3.isDST;
		start = ((lo < 0 || lo >= tx.$length) ? $throwRuntimeError("index out of range") : tx.$array[tx.$offset + lo]).when;
		return [name, offset, isDST, start, end];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.lookup }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f.end = end; $f.hi = hi; $f.isDST = isDST; $f.l = l; $f.lim = lim; $f.lo = lo; $f.m = m; $f.name = name; $f.offset = offset; $f.sec = sec; $f.start = start; $f.tx = tx; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.zone$1 = zone$1; $f.zone$2 = zone$2; $f.zone$3 = zone$3; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.lookup = function(sec) { return this.$val.lookup(sec); };
	Location.ptr.prototype.lookupFirstZone = function() {
		var $ptr, _i, _ref, l, x, x$1, x$2, x$3, x$4, x$5, zi, zi$1;
		l = this;
		if (!l.firstZoneUsed()) {
			return 0;
		}
		if (l.tx.$length > 0 && (x = l.zone, x$1 = (x$2 = l.tx, (0 >= x$2.$length ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + 0])).index, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])).isDST) {
			zi = ((x$3 = l.tx, (0 >= x$3.$length ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 0])).index >> 0) - 1 >> 0;
			while (true) {
				if (!(zi >= 0)) { break; }
				if (!(x$4 = l.zone, ((zi < 0 || zi >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + zi])).isDST) {
					return zi;
				}
				zi = zi - (1) >> 0;
			}
		}
		_ref = l.zone;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			zi$1 = _i;
			if (!(x$5 = l.zone, ((zi$1 < 0 || zi$1 >= x$5.$length) ? $throwRuntimeError("index out of range") : x$5.$array[x$5.$offset + zi$1])).isDST) {
				return zi$1;
			}
			_i++;
		}
		return 0;
	};
	Location.prototype.lookupFirstZone = function() { return this.$val.lookupFirstZone(); };
	Location.ptr.prototype.firstZoneUsed = function() {
		var $ptr, _i, _ref, l, tx;
		l = this;
		_ref = l.tx;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			tx = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), zoneTrans);
			if (tx.index === 0) {
				return true;
			}
			_i++;
		}
		return false;
	};
	Location.prototype.firstZoneUsed = function() { return this.$val.firstZoneUsed(); };
	Location.ptr.prototype.lookupName = function(name, unix) {
		var $ptr, _i, _i$1, _r$1, _r$2, _ref, _ref$1, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple$1, i, i$1, isDST, isDST$1, l, nam, name, offset, offset$1, ok, unix, x, x$1, x$2, zone$1, zone$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _i$1 = $f._i$1; _r$1 = $f._r$1; _r$2 = $f._r$2; _ref = $f._ref; _ref$1 = $f._ref$1; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple$1 = $f._tuple$1; i = $f.i; i$1 = $f.i$1; isDST = $f.isDST; isDST$1 = $f.isDST$1; l = $f.l; nam = $f.nam; name = $f.name; offset = $f.offset; offset$1 = $f.offset$1; ok = $f.ok; unix = $f.unix; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; zone$1 = $f.zone$1; zone$2 = $f.zone$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		offset = 0;
		isDST = false;
		ok = false;
		l = this;
		_r$1 = l.get(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		l = _r$1;
		_ref = l.zone;
		_i = 0;
		/* while (true) { */ case 2:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 3; continue; }
			i = _i;
			zone$1 = (x = l.zone, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			/* */ if (zone$1.name === name) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (zone$1.name === name) { */ case 4:
				_r$2 = l.lookup((x$1 = new $Int64(0, zone$1.offset), new $Int64(unix.$high - x$1.$high, unix.$low - x$1.$low))); /* */ $s = 6; case 6: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_tuple$1 = _r$2;
				nam = _tuple$1[0];
				offset$1 = _tuple$1[1];
				isDST$1 = _tuple$1[2];
				if (nam === zone$1.name) {
					_tmp = offset$1;
					_tmp$1 = isDST$1;
					_tmp$2 = true;
					offset = _tmp;
					isDST = _tmp$1;
					ok = _tmp$2;
					return [offset, isDST, ok];
				}
			/* } */ case 5:
			_i++;
		/* } */ $s = 2; continue; case 3:
		_ref$1 = l.zone;
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			i$1 = _i$1;
			zone$2 = (x$2 = l.zone, ((i$1 < 0 || i$1 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + i$1]));
			if (zone$2.name === name) {
				_tmp$3 = zone$2.offset;
				_tmp$4 = zone$2.isDST;
				_tmp$5 = true;
				offset = _tmp$3;
				isDST = _tmp$4;
				ok = _tmp$5;
				return [offset, isDST, ok];
			}
			_i$1++;
		}
		return [offset, isDST, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.lookupName }; } $f.$ptr = $ptr; $f._i = _i; $f._i$1 = _i$1; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._ref = _ref; $f._ref$1 = _ref$1; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple$1 = _tuple$1; $f.i = i; $f.i$1 = i$1; $f.isDST = isDST; $f.isDST$1 = isDST$1; $f.l = l; $f.nam = nam; $f.name = name; $f.offset = offset; $f.offset$1 = offset$1; $f.ok = ok; $f.unix = unix; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.zone$1 = zone$1; $f.zone$2 = zone$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.lookupName = function(name, unix) { return this.$val.lookupName(name, unix); };
	ptrType$3.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$4.methods = [{prop: "Stop", name: "Stop", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Reset", name: "Reset", pkg: "", typ: $funcType([Duration], [$Bool], false)}];
	Time.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Format", name: "Format", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "AppendFormat", name: "AppendFormat", pkg: "", typ: $funcType([sliceType$3, $String], [sliceType$3], false)}, {prop: "After", name: "After", pkg: "", typ: $funcType([Time], [$Bool], false)}, {prop: "Before", name: "Before", pkg: "", typ: $funcType([Time], [$Bool], false)}, {prop: "Equal", name: "Equal", pkg: "", typ: $funcType([Time], [$Bool], false)}, {prop: "IsZero", name: "IsZero", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "abs", name: "abs", pkg: "time", typ: $funcType([], [$Uint64], false)}, {prop: "locabs", name: "locabs", pkg: "time", typ: $funcType([], [$String, $Int, $Uint64], false)}, {prop: "Date", name: "Date", pkg: "", typ: $funcType([], [$Int, Month, $Int], false)}, {prop: "Year", name: "Year", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Month", name: "Month", pkg: "", typ: $funcType([], [Month], false)}, {prop: "Day", name: "Day", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Weekday", name: "Weekday", pkg: "", typ: $funcType([], [Weekday], false)}, {prop: "ISOWeek", name: "ISOWeek", pkg: "", typ: $funcType([], [$Int, $Int], false)}, {prop: "Clock", name: "Clock", pkg: "", typ: $funcType([], [$Int, $Int, $Int], false)}, {prop: "Hour", name: "Hour", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Minute", name: "Minute", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Second", name: "Second", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Nanosecond", name: "Nanosecond", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "YearDay", name: "YearDay", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Add", name: "Add", pkg: "", typ: $funcType([Duration], [Time], false)}, {prop: "Sub", name: "Sub", pkg: "", typ: $funcType([Time], [Duration], false)}, {prop: "AddDate", name: "AddDate", pkg: "", typ: $funcType([$Int, $Int, $Int], [Time], false)}, {prop: "date", name: "date", pkg: "time", typ: $funcType([$Bool], [$Int, Month, $Int, $Int], false)}, {prop: "UTC", name: "UTC", pkg: "", typ: $funcType([], [Time], false)}, {prop: "Local", name: "Local", pkg: "", typ: $funcType([], [Time], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([ptrType$1], [Time], false)}, {prop: "Location", name: "Location", pkg: "", typ: $funcType([], [ptrType$1], false)}, {prop: "Zone", name: "Zone", pkg: "", typ: $funcType([], [$String, $Int], false)}, {prop: "Unix", name: "Unix", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "UnixNano", name: "UnixNano", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "MarshalBinary", name: "MarshalBinary", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "GobEncode", name: "GobEncode", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "MarshalJSON", name: "MarshalJSON", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "MarshalText", name: "MarshalText", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "Truncate", name: "Truncate", pkg: "", typ: $funcType([Duration], [Time], false)}, {prop: "Round", name: "Round", pkg: "", typ: $funcType([Duration], [Time], false)}];
	ptrType$6.methods = [{prop: "UnmarshalBinary", name: "UnmarshalBinary", pkg: "", typ: $funcType([sliceType$3], [$error], false)}, {prop: "GobDecode", name: "GobDecode", pkg: "", typ: $funcType([sliceType$3], [$error], false)}, {prop: "UnmarshalJSON", name: "UnmarshalJSON", pkg: "", typ: $funcType([sliceType$3], [$error], false)}, {prop: "UnmarshalText", name: "UnmarshalText", pkg: "", typ: $funcType([sliceType$3], [$error], false)}];
	Month.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	Weekday.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	Duration.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Nanoseconds", name: "Nanoseconds", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Seconds", name: "Seconds", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Minutes", name: "Minutes", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Hours", name: "Hours", pkg: "", typ: $funcType([], [$Float64], false)}];
	ptrType$1.methods = [{prop: "get", name: "get", pkg: "time", typ: $funcType([], [ptrType$1], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "lookup", name: "lookup", pkg: "time", typ: $funcType([$Int64], [$String, $Int, $Bool, $Int64, $Int64], false)}, {prop: "lookupFirstZone", name: "lookupFirstZone", pkg: "time", typ: $funcType([], [$Int], false)}, {prop: "firstZoneUsed", name: "firstZoneUsed", pkg: "time", typ: $funcType([], [$Bool], false)}, {prop: "lookupName", name: "lookupName", pkg: "time", typ: $funcType([$String, $Int64], [$Int, $Bool, $Bool], false)}];
	runtimeTimer.init([{prop: "i", name: "i", pkg: "time", typ: $Int32, tag: ""}, {prop: "when", name: "when", pkg: "time", typ: $Int64, tag: ""}, {prop: "period", name: "period", pkg: "time", typ: $Int64, tag: ""}, {prop: "f", name: "f", pkg: "time", typ: funcType$1, tag: ""}, {prop: "arg", name: "arg", pkg: "time", typ: $emptyInterface, tag: ""}, {prop: "timeout", name: "timeout", pkg: "time", typ: ptrType$2, tag: ""}, {prop: "active", name: "active", pkg: "time", typ: $Bool, tag: ""}]);
	ParseError.init([{prop: "Layout", name: "Layout", pkg: "", typ: $String, tag: ""}, {prop: "Value", name: "Value", pkg: "", typ: $String, tag: ""}, {prop: "LayoutElem", name: "LayoutElem", pkg: "", typ: $String, tag: ""}, {prop: "ValueElem", name: "ValueElem", pkg: "", typ: $String, tag: ""}, {prop: "Message", name: "Message", pkg: "", typ: $String, tag: ""}]);
	Timer.init([{prop: "C", name: "C", pkg: "", typ: chanType$1, tag: ""}, {prop: "r", name: "r", pkg: "time", typ: runtimeTimer, tag: ""}]);
	Time.init([{prop: "sec", name: "sec", pkg: "time", typ: $Int64, tag: ""}, {prop: "nsec", name: "nsec", pkg: "time", typ: $Int32, tag: ""}, {prop: "loc", name: "loc", pkg: "time", typ: ptrType$1, tag: ""}]);
	Location.init([{prop: "name", name: "name", pkg: "time", typ: $String, tag: ""}, {prop: "zone", name: "zone", pkg: "time", typ: sliceType, tag: ""}, {prop: "tx", name: "tx", pkg: "time", typ: sliceType$1, tag: ""}, {prop: "cacheStart", name: "cacheStart", pkg: "time", typ: $Int64, tag: ""}, {prop: "cacheEnd", name: "cacheEnd", pkg: "time", typ: $Int64, tag: ""}, {prop: "cacheZone", name: "cacheZone", pkg: "time", typ: ptrType, tag: ""}]);
	zone.init([{prop: "name", name: "name", pkg: "time", typ: $String, tag: ""}, {prop: "offset", name: "offset", pkg: "time", typ: $Int, tag: ""}, {prop: "isDST", name: "isDST", pkg: "time", typ: $Bool, tag: ""}]);
	zoneTrans.init([{prop: "when", name: "when", pkg: "time", typ: $Int64, tag: ""}, {prop: "index", name: "index", pkg: "time", typ: $Uint8, tag: ""}, {prop: "isstd", name: "isstd", pkg: "time", typ: $Bool, tag: ""}, {prop: "isutc", name: "isutc", pkg: "time", typ: $Bool, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = nosync.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = syscall.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		localLoc = new Location.ptr("", sliceType.nil, sliceType$1.nil, new $Int64(0, 0), new $Int64(0, 0), ptrType.nil);
		localOnce = new nosync.Once.ptr(false, false);
		std0x = $toNativeArray($kindInt, [260, 265, 524, 526, 528, 274]);
		longDayNames = new sliceType$2(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
		shortDayNames = new sliceType$2(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
		shortMonthNames = new sliceType$2(["---", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
		longMonthNames = new sliceType$2(["---", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
		atoiError = errors.New("time: invalid number");
		errBad = errors.New("bad value for field");
		errLeadingInt = errors.New("time: bad [0-9]*");
		months = $toNativeArray($kindString, ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
		days = $toNativeArray($kindString, ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
		daysBefore = $toNativeArray($kindInt32, [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]);
		utcLoc = new Location.ptr("UTC", sliceType.nil, sliceType$1.nil, new $Int64(0, 0), new $Int64(0, 0), ptrType.nil);
		$pkg.UTC = utcLoc;
		$pkg.Local = localLoc;
		_r = syscall.Getenv("ZONEINFO"); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		zoneinfo = _tuple[0];
		badData = errors.New("malformed time zone information");
		zoneDirs = new sliceType$2(["/usr/share/zoneinfo/", "/usr/share/lib/zoneinfo/", "/usr/lib/locale/TZ/", runtime.GOROOT() + "/lib/time/zoneinfo.zip"]);
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/siongui/gopherjs-tooltip"] = (function() {
	var $pkg = {}, $init, js, strconv, time, Tooltip, ptrType, funcType, ptrType$1, isMouseInWord, tooltipPtr, onWordMouseOver, onWordMouseOut, AddTooltipToElement, init, NewTooltip, viewWidth, viewWidthInt;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	strconv = $packages["strconv"];
	time = $packages["time"];
	Tooltip = $pkg.Tooltip = $newType(0, $kindStruct, "tooltip.Tooltip", "Tooltip", "github.com/siongui/gopherjs-tooltip", function(self_, isMouseInTooltip_, left_, top_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.self = null;
			this.isMouseInTooltip = false;
			this.left = 0;
			this.top = 0;
			return;
		}
		this.self = self_;
		this.isMouseInTooltip = isMouseInTooltip_;
		this.left = left_;
		this.top = top_;
	});
	ptrType = $ptrType(Tooltip);
	funcType = $funcType([], [], false);
	ptrType$1 = $ptrType(js.Object);
	AddTooltipToElement = function(elm, tooltipContent) {
		var $ptr, elm, tooltipContent;
		elm.dataset.tooltipContent = $externalize(tooltipContent, $String);
		elm.onmouseover = onWordMouseOver;
		elm.onmouseout = onWordMouseOut;
	};
	$pkg.AddTooltipToElement = AddTooltipToElement;
	init = function() {
		var $ptr;
		tooltipPtr = NewTooltip();
	};
	Tooltip.ptr.prototype.onMouseEnter = function() {
		var $ptr, tt;
		tt = this;
		tt.isMouseInTooltip = true;
	};
	Tooltip.prototype.onMouseEnter = function() { return this.$val.onMouseEnter(); };
	Tooltip.ptr.prototype.onMouseLeave = function() {
		var $ptr, tt;
		tt = this;
		tt.isMouseInTooltip = false;
		tt.hide();
	};
	Tooltip.prototype.onMouseLeave = function() { return this.$val.onMouseLeave(); };
	Tooltip.ptr.prototype.registerMouseEnterLeaveHandler = function() {
		var $ptr, tt;
		tt = this;
		tt.self.onmouseenter = $externalize((function() {
			var $ptr;
			tt.onMouseEnter();
		}), funcType);
		tt.self.onmouseleave = $externalize((function() {
			var $ptr;
			tt.onMouseLeave();
		}), funcType);
	};
	Tooltip.prototype.registerMouseEnterLeaveHandler = function() { return this.$val.registerMouseEnterLeaveHandler(); };
	Tooltip.ptr.prototype.hide = function() {
		var $ptr, tt;
		tt = this;
		if (!tt.isMouseInTooltip) {
			tt.self.style.left = $externalize("-9999px", $String);
		}
	};
	Tooltip.prototype.hide = function() { return this.$val.hide(); };
	Tooltip.ptr.prototype.removeAllChildren = function() {
		var $ptr, tt;
		tt = this;
		while (true) {
			if (!(!!(tt.self.hasChildNodes()))) { break; }
			tt.self.removeChild(tt.self.lastChild);
		}
	};
	Tooltip.prototype.removeAllChildren = function() { return this.$val.removeAllChildren(); };
	Tooltip.ptr.prototype.setInnerHTML = function(html) {
		var $ptr, html, tt;
		tt = this;
		tt.removeAllChildren();
		tt.self.innerHTML = $externalize(html, $String);
	};
	Tooltip.prototype.setInnerHTML = function(html) { return this.$val.setInnerHTML(html); };
	Tooltip.ptr.prototype.setPosition = function(left, top) {
		var $ptr, left, top, tt;
		tt = this;
		tt.left = left;
		tt.top = top;
	};
	Tooltip.prototype.setPosition = function(left, top) { return this.$val.setPosition(left, top); };
	Tooltip.ptr.prototype.show = function() {
		var $ptr, offsetWidth, right, tt;
		tt = this;
		offsetWidth = $parseInt(tt.self.style.offsetWidth) >> 0;
		right = tt.left + offsetWidth >> 0;
		if (right > viewWidthInt()) {
			tt.left = right - viewWidthInt() >> 0;
		}
		tt.self.style.left = $externalize(strconv.Itoa(tt.left) + "px", $String);
		tt.self.style.top = $externalize(strconv.Itoa(tt.top) + "px", $String);
	};
	Tooltip.prototype.show = function() { return this.$val.show(); };
	Tooltip.ptr.prototype.appendToBodyElement = function() {
		var $ptr, tt;
		tt = this;
		$global.document.getElementsByTagName($externalize("body", $String)).item(0).appendChild(tt.self);
	};
	Tooltip.prototype.appendToBodyElement = function() { return this.$val.appendToBodyElement(); };
	Tooltip.ptr.prototype.createTooltipInstance = function() {
		var $ptr, tt;
		tt = this;
		tt.self = $global.document.createElement($externalize("div", $String));
		tt.self.classList.add($externalize("tooltip", $String));
		tt.self.style[$externalize("max-width", $String)] = $externalize(viewWidth() + "px", $String);
	};
	Tooltip.prototype.createTooltipInstance = function() { return this.$val.createTooltipInstance(); };
	Tooltip.ptr.prototype.appendCSSToHeadElement = function() {
		var $ptr, css, s, tt;
		tt = this;
		css = ".tooltip {\n\t\tposition: absolute;\n\t\tleft: -9999px;\n\t\tbackground-color: #CCFFFF;\n\t\tborder-radius: 10px;\n\t\tfont-family: Tahoma, Arial, serif;\n\t\tword-wrap: break-word;\n\t}";
		s = $global.document.createElement($externalize("style", $String));
		s.innerHTML = $externalize(css, $String);
		$global.document.getElementsByTagName($externalize("head", $String)).item(0).appendChild(s);
	};
	Tooltip.prototype.appendCSSToHeadElement = function() { return this.$val.appendCSSToHeadElement(); };
	NewTooltip = function() {
		var $ptr, tt;
		tt = new Tooltip.ptr(null, false, 0, 0);
		tt.appendCSSToHeadElement();
		tt.createTooltipInstance();
		tt.appendToBodyElement();
		tt.registerMouseEnterLeaveHandler();
		return tt;
	};
	$pkg.NewTooltip = NewTooltip;
	viewWidth = function() {
		var $ptr;
		return $internalize($global.innerWidth, $String);
	};
	viewWidthInt = function() {
		var $ptr;
		return $parseInt($global.innerWidth) >> 0;
	};
	ptrType.methods = [{prop: "onMouseEnter", name: "onMouseEnter", pkg: "github.com/siongui/gopherjs-tooltip", typ: $funcType([], [], false)}, {prop: "onMouseLeave", name: "onMouseLeave", pkg: "github.com/siongui/gopherjs-tooltip", typ: $funcType([], [], false)}, {prop: "registerMouseEnterLeaveHandler", name: "registerMouseEnterLeaveHandler", pkg: "github.com/siongui/gopherjs-tooltip", typ: $funcType([], [], false)}, {prop: "hide", name: "hide", pkg: "github.com/siongui/gopherjs-tooltip", typ: $funcType([], [], false)}, {prop: "removeAllChildren", name: "removeAllChildren", pkg: "github.com/siongui/gopherjs-tooltip", typ: $funcType([], [], false)}, {prop: "setInnerHTML", name: "setInnerHTML", pkg: "github.com/siongui/gopherjs-tooltip", typ: $funcType([$String], [], false)}, {prop: "setPosition", name: "setPosition", pkg: "github.com/siongui/gopherjs-tooltip", typ: $funcType([$Int, $Int], [], false)}, {prop: "show", name: "show", pkg: "github.com/siongui/gopherjs-tooltip", typ: $funcType([], [], false)}, {prop: "appendToBodyElement", name: "appendToBodyElement", pkg: "github.com/siongui/gopherjs-tooltip", typ: $funcType([], [], false)}, {prop: "createTooltipInstance", name: "createTooltipInstance", pkg: "github.com/siongui/gopherjs-tooltip", typ: $funcType([], [], false)}, {prop: "appendCSSToHeadElement", name: "appendCSSToHeadElement", pkg: "github.com/siongui/gopherjs-tooltip", typ: $funcType([], [], false)}];
	Tooltip.init([{prop: "self", name: "self", pkg: "github.com/siongui/gopherjs-tooltip", typ: ptrType$1, tag: ""}, {prop: "isMouseInTooltip", name: "isMouseInTooltip", pkg: "github.com/siongui/gopherjs-tooltip", typ: $Bool, tag: ""}, {prop: "left", name: "left", pkg: "github.com/siongui/gopherjs-tooltip", typ: $Int, tag: ""}, {prop: "top", name: "top", pkg: "github.com/siongui/gopherjs-tooltip", typ: $Int, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = time.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		tooltipPtr = ptrType.nil;
		$pkg.DELAY_INTERVAL = new time.Duration(0, 1000000000);
		isMouseInWord = false;
		onWordMouseOut = js.MakeFunc((function(this$1, arguments$1) {
			var $ptr, arguments$1, this$1;
			isMouseInWord = false;
			this$1.style.color = $externalize("", $String);
			time.AfterFunc($pkg.DELAY_INTERVAL, (function() {
				var $ptr;
				if (!isMouseInWord) {
					tooltipPtr.hide();
				}
			}));
			return $ifaceNil;
		}));
		onWordMouseOver = js.MakeFunc((function(this$1, arguments$1) {
			var $ptr, arguments$1, this$1;
			isMouseInWord = true;
			this$1.style.color = $externalize("red", $String);
			time.AfterFunc($pkg.DELAY_INTERVAL, (function() {
				var $ptr;
				if ($internalize(this$1.style.color, $String) === "red") {
					tooltipPtr.setInnerHTML($internalize(this$1.dataset.tooltipContent, $String));
					tooltipPtr.setPosition($parseInt(this$1.getBoundingClientRect().left) >> 0, ($parseInt(this$1.getBoundingClientRect().top) >> 0) + ($parseInt(this$1.offsetHeight) >> 0) >> 0);
					tooltipPtr.show();
				}
			}));
			return $ifaceNil;
		}));
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["bytes"] = (function() {
	var $pkg = {}, $init, errors, io, unicode, utf8, Buffer, readOp, ptrType, sliceType, arrayType, arrayType$1, IndexByte, Equal, makeSlice, Index, HasPrefix;
	errors = $packages["errors"];
	io = $packages["io"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	Buffer = $pkg.Buffer = $newType(0, $kindStruct, "bytes.Buffer", "Buffer", "bytes", function(buf_, off_, runeBytes_, bootstrap_, lastRead_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.buf = sliceType.nil;
			this.off = 0;
			this.runeBytes = arrayType.zero();
			this.bootstrap = arrayType$1.zero();
			this.lastRead = 0;
			return;
		}
		this.buf = buf_;
		this.off = off_;
		this.runeBytes = runeBytes_;
		this.bootstrap = bootstrap_;
		this.lastRead = lastRead_;
	});
	readOp = $pkg.readOp = $newType(4, $kindInt, "bytes.readOp", "readOp", "bytes", null);
	ptrType = $ptrType(Buffer);
	sliceType = $sliceType($Uint8);
	arrayType = $arrayType($Uint8, 4);
	arrayType$1 = $arrayType($Uint8, 64);
	IndexByte = function(s, c) {
		var $ptr, _i, _ref, b, c, i, s;
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			b = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (b === c) {
				return i;
			}
			_i++;
		}
		return -1;
	};
	$pkg.IndexByte = IndexByte;
	Equal = function(a, b) {
		var $ptr, _i, _ref, a, b, c, i;
		if (!((a.$length === b.$length))) {
			return false;
		}
		_ref = a;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			c = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (!((c === ((i < 0 || i >= b.$length) ? $throwRuntimeError("index out of range") : b.$array[b.$offset + i])))) {
				return false;
			}
			_i++;
		}
		return true;
	};
	$pkg.Equal = Equal;
	Buffer.ptr.prototype.Bytes = function() {
		var $ptr, b;
		b = this;
		return $subslice(b.buf, b.off);
	};
	Buffer.prototype.Bytes = function() { return this.$val.Bytes(); };
	Buffer.ptr.prototype.String = function() {
		var $ptr, b;
		b = this;
		if (b === ptrType.nil) {
			return "<nil>";
		}
		return $bytesToString($subslice(b.buf, b.off));
	};
	Buffer.prototype.String = function() { return this.$val.String(); };
	Buffer.ptr.prototype.Len = function() {
		var $ptr, b;
		b = this;
		return b.buf.$length - b.off >> 0;
	};
	Buffer.prototype.Len = function() { return this.$val.Len(); };
	Buffer.ptr.prototype.Cap = function() {
		var $ptr, b;
		b = this;
		return b.buf.$capacity;
	};
	Buffer.prototype.Cap = function() { return this.$val.Cap(); };
	Buffer.ptr.prototype.Truncate = function(n) {
		var $ptr, b, n;
		b = this;
		b.lastRead = 0;
		if (n < 0 || n > b.Len()) {
			$panic(new $String("bytes.Buffer: truncation out of range"));
		} else if ((n === 0)) {
			b.off = 0;
		}
		b.buf = $subslice(b.buf, 0, (b.off + n >> 0));
	};
	Buffer.prototype.Truncate = function(n) { return this.$val.Truncate(n); };
	Buffer.ptr.prototype.Reset = function() {
		var $ptr, b;
		b = this;
		b.Truncate(0);
	};
	Buffer.prototype.Reset = function() { return this.$val.Reset(); };
	Buffer.ptr.prototype.grow = function(n) {
		var $ptr, _q, b, buf, m, n;
		b = this;
		m = b.Len();
		if ((m === 0) && !((b.off === 0))) {
			b.Truncate(0);
		}
		if ((b.buf.$length + n >> 0) > b.buf.$capacity) {
			buf = sliceType.nil;
			if (b.buf === sliceType.nil && n <= 64) {
				buf = $subslice(new sliceType(b.bootstrap), 0);
			} else if ((m + n >> 0) <= (_q = b.buf.$capacity / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"))) {
				$copySlice(b.buf, $subslice(b.buf, b.off));
				buf = $subslice(b.buf, 0, m);
			} else {
				buf = makeSlice(($imul(2, b.buf.$capacity)) + n >> 0);
				$copySlice(buf, $subslice(b.buf, b.off));
			}
			b.buf = buf;
			b.off = 0;
		}
		b.buf = $subslice(b.buf, 0, ((b.off + m >> 0) + n >> 0));
		return b.off + m >> 0;
	};
	Buffer.prototype.grow = function(n) { return this.$val.grow(n); };
	Buffer.ptr.prototype.Grow = function(n) {
		var $ptr, b, m, n;
		b = this;
		if (n < 0) {
			$panic(new $String("bytes.Buffer.Grow: negative count"));
		}
		m = b.grow(n);
		b.buf = $subslice(b.buf, 0, m);
	};
	Buffer.prototype.Grow = function(n) { return this.$val.Grow(n); };
	Buffer.ptr.prototype.Write = function(p) {
		var $ptr, _tmp, _tmp$1, b, err, m, n, p;
		n = 0;
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		m = b.grow(p.$length);
		_tmp = $copySlice($subslice(b.buf, m), p);
		_tmp$1 = $ifaceNil;
		n = _tmp;
		err = _tmp$1;
		return [n, err];
	};
	Buffer.prototype.Write = function(p) { return this.$val.Write(p); };
	Buffer.ptr.prototype.WriteString = function(s) {
		var $ptr, _tmp, _tmp$1, b, err, m, n, s;
		n = 0;
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		m = b.grow(s.length);
		_tmp = $copyString($subslice(b.buf, m), s);
		_tmp$1 = $ifaceNil;
		n = _tmp;
		err = _tmp$1;
		return [n, err];
	};
	Buffer.prototype.WriteString = function(s) { return this.$val.WriteString(s); };
	Buffer.ptr.prototype.ReadFrom = function(r) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, b, e, err, free, m, n, newBuf, r, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tuple = $f._tuple; b = $f.b; e = $f.e; err = $f.err; free = $f.free; m = $f.m; n = $f.n; newBuf = $f.newBuf; r = $f.r; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = new $Int64(0, 0);
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		if (b.off >= b.buf.$length) {
			b.Truncate(0);
		}
		/* while (true) { */ case 1:
			free = b.buf.$capacity - b.buf.$length >> 0;
			if (free < 512) {
				newBuf = b.buf;
				if ((b.off + free >> 0) < 512) {
					newBuf = makeSlice(($imul(2, b.buf.$capacity)) + 512 >> 0);
				}
				$copySlice(newBuf, $subslice(b.buf, b.off));
				b.buf = $subslice(newBuf, 0, (b.buf.$length - b.off >> 0));
				b.off = 0;
			}
			_r = r.Read($subslice(b.buf, b.buf.$length, b.buf.$capacity)); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			m = _tuple[0];
			e = _tuple[1];
			b.buf = $subslice(b.buf, 0, (b.buf.$length + m >> 0));
			n = (x = new $Int64(0, m), new $Int64(n.$high + x.$high, n.$low + x.$low));
			if ($interfaceIsEqual(e, io.EOF)) {
				/* break; */ $s = 2; continue;
			}
			if (!($interfaceIsEqual(e, $ifaceNil))) {
				_tmp = n;
				_tmp$1 = e;
				n = _tmp;
				err = _tmp$1;
				return [n, err];
			}
		/* } */ $s = 1; continue; case 2:
		_tmp$2 = n;
		_tmp$3 = $ifaceNil;
		n = _tmp$2;
		err = _tmp$3;
		return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Buffer.ptr.prototype.ReadFrom }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tuple = _tuple; $f.b = b; $f.e = e; $f.err = err; $f.free = free; $f.m = m; $f.n = n; $f.newBuf = newBuf; $f.r = r; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Buffer.prototype.ReadFrom = function(r) { return this.$val.ReadFrom(r); };
	makeSlice = function(n) {
		var $ptr, n, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		$deferred.push([(function() {
			var $ptr;
			if (!($interfaceIsEqual($recover(), $ifaceNil))) {
				$panic($pkg.ErrTooLarge);
			}
		}), []]);
		return $makeSlice(sliceType, n);
		/* */ } catch(err) { $err = err; return sliceType.nil; } finally { $callDeferred($deferred, $err); }
	};
	Buffer.ptr.prototype.WriteTo = function(w) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, b, e, err, m, n, nBytes, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tuple = $f._tuple; b = $f.b; e = $f.e; err = $f.err; m = $f.m; n = $f.n; nBytes = $f.nBytes; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = new $Int64(0, 0);
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		/* */ if (b.off < b.buf.$length) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (b.off < b.buf.$length) { */ case 1:
			nBytes = b.Len();
			_r = w.Write($subslice(b.buf, b.off)); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			m = _tuple[0];
			e = _tuple[1];
			if (m > nBytes) {
				$panic(new $String("bytes.Buffer.WriteTo: invalid Write count"));
			}
			b.off = b.off + (m) >> 0;
			n = new $Int64(0, m);
			if (!($interfaceIsEqual(e, $ifaceNil))) {
				_tmp = n;
				_tmp$1 = e;
				n = _tmp;
				err = _tmp$1;
				return [n, err];
			}
			if (!((m === nBytes))) {
				_tmp$2 = n;
				_tmp$3 = io.ErrShortWrite;
				n = _tmp$2;
				err = _tmp$3;
				return [n, err];
			}
		/* } */ case 2:
		b.Truncate(0);
		return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Buffer.ptr.prototype.WriteTo }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tuple = _tuple; $f.b = b; $f.e = e; $f.err = err; $f.m = m; $f.n = n; $f.nBytes = nBytes; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	Buffer.prototype.WriteTo = function(w) { return this.$val.WriteTo(w); };
	Buffer.ptr.prototype.WriteByte = function(c) {
		var $ptr, b, c, m, x;
		b = this;
		b.lastRead = 0;
		m = b.grow(1);
		(x = b.buf, ((m < 0 || m >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + m] = c));
		return $ifaceNil;
	};
	Buffer.prototype.WriteByte = function(c) { return this.$val.WriteByte(c); };
	Buffer.ptr.prototype.WriteRune = function(r) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, b, err, n, r;
		n = 0;
		err = $ifaceNil;
		b = this;
		if (r < 128) {
			b.WriteByte((r << 24 >>> 24));
			_tmp = 1;
			_tmp$1 = $ifaceNil;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		n = utf8.EncodeRune($subslice(new sliceType(b.runeBytes), 0), r);
		b.Write($subslice(new sliceType(b.runeBytes), 0, n));
		_tmp$2 = n;
		_tmp$3 = $ifaceNil;
		n = _tmp$2;
		err = _tmp$3;
		return [n, err];
	};
	Buffer.prototype.WriteRune = function(r) { return this.$val.WriteRune(r); };
	Buffer.ptr.prototype.Read = function(p) {
		var $ptr, _tmp, _tmp$1, b, err, n, p;
		n = 0;
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		if (b.off >= b.buf.$length) {
			b.Truncate(0);
			if (p.$length === 0) {
				return [n, err];
			}
			_tmp = 0;
			_tmp$1 = io.EOF;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		n = $copySlice(p, $subslice(b.buf, b.off));
		b.off = b.off + (n) >> 0;
		if (n > 0) {
			b.lastRead = 2;
		}
		return [n, err];
	};
	Buffer.prototype.Read = function(p) { return this.$val.Read(p); };
	Buffer.ptr.prototype.Next = function(n) {
		var $ptr, b, data, m, n;
		b = this;
		b.lastRead = 0;
		m = b.Len();
		if (n > m) {
			n = m;
		}
		data = $subslice(b.buf, b.off, (b.off + n >> 0));
		b.off = b.off + (n) >> 0;
		if (n > 0) {
			b.lastRead = 2;
		}
		return data;
	};
	Buffer.prototype.Next = function(n) { return this.$val.Next(n); };
	Buffer.ptr.prototype.ReadByte = function() {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, b, c, err, x, x$1;
		c = 0;
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		if (b.off >= b.buf.$length) {
			b.Truncate(0);
			_tmp = 0;
			_tmp$1 = io.EOF;
			c = _tmp;
			err = _tmp$1;
			return [c, err];
		}
		c = (x = b.buf, x$1 = b.off, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		b.off = b.off + (1) >> 0;
		b.lastRead = 2;
		_tmp$2 = c;
		_tmp$3 = $ifaceNil;
		c = _tmp$2;
		err = _tmp$3;
		return [c, err];
	};
	Buffer.prototype.ReadByte = function() { return this.$val.ReadByte(); };
	Buffer.ptr.prototype.ReadRune = function() {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tuple, b, c, err, n, r, size, x, x$1;
		r = 0;
		size = 0;
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		if (b.off >= b.buf.$length) {
			b.Truncate(0);
			_tmp = 0;
			_tmp$1 = 0;
			_tmp$2 = io.EOF;
			r = _tmp;
			size = _tmp$1;
			err = _tmp$2;
			return [r, size, err];
		}
		b.lastRead = 1;
		c = (x = b.buf, x$1 = b.off, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		if (c < 128) {
			b.off = b.off + (1) >> 0;
			_tmp$3 = (c >> 0);
			_tmp$4 = 1;
			_tmp$5 = $ifaceNil;
			r = _tmp$3;
			size = _tmp$4;
			err = _tmp$5;
			return [r, size, err];
		}
		_tuple = utf8.DecodeRune($subslice(b.buf, b.off));
		r = _tuple[0];
		n = _tuple[1];
		b.off = b.off + (n) >> 0;
		_tmp$6 = r;
		_tmp$7 = n;
		_tmp$8 = $ifaceNil;
		r = _tmp$6;
		size = _tmp$7;
		err = _tmp$8;
		return [r, size, err];
	};
	Buffer.prototype.ReadRune = function() { return this.$val.ReadRune(); };
	Buffer.ptr.prototype.UnreadRune = function() {
		var $ptr, _tuple, b, n;
		b = this;
		if (!((b.lastRead === 1))) {
			return errors.New("bytes.Buffer: UnreadRune: previous operation was not ReadRune");
		}
		b.lastRead = 0;
		if (b.off > 0) {
			_tuple = utf8.DecodeLastRune($subslice(b.buf, 0, b.off));
			n = _tuple[1];
			b.off = b.off - (n) >> 0;
		}
		return $ifaceNil;
	};
	Buffer.prototype.UnreadRune = function() { return this.$val.UnreadRune(); };
	Buffer.ptr.prototype.UnreadByte = function() {
		var $ptr, b;
		b = this;
		if (!((b.lastRead === 1)) && !((b.lastRead === 2))) {
			return errors.New("bytes.Buffer: UnreadByte: previous operation was not a read");
		}
		b.lastRead = 0;
		if (b.off > 0) {
			b.off = b.off - (1) >> 0;
		}
		return $ifaceNil;
	};
	Buffer.prototype.UnreadByte = function() { return this.$val.UnreadByte(); };
	Buffer.ptr.prototype.ReadBytes = function(delim) {
		var $ptr, _tuple, b, delim, err, line, slice;
		line = sliceType.nil;
		err = $ifaceNil;
		b = this;
		_tuple = b.readSlice(delim);
		slice = _tuple[0];
		err = _tuple[1];
		line = $appendSlice(line, slice);
		return [line, err];
	};
	Buffer.prototype.ReadBytes = function(delim) { return this.$val.ReadBytes(delim); };
	Buffer.ptr.prototype.readSlice = function(delim) {
		var $ptr, _tmp, _tmp$1, b, delim, end, err, i, line;
		line = sliceType.nil;
		err = $ifaceNil;
		b = this;
		i = IndexByte($subslice(b.buf, b.off), delim);
		end = (b.off + i >> 0) + 1 >> 0;
		if (i < 0) {
			end = b.buf.$length;
			err = io.EOF;
		}
		line = $subslice(b.buf, b.off, end);
		b.off = end;
		b.lastRead = 2;
		_tmp = line;
		_tmp$1 = err;
		line = _tmp;
		err = _tmp$1;
		return [line, err];
	};
	Buffer.prototype.readSlice = function(delim) { return this.$val.readSlice(delim); };
	Buffer.ptr.prototype.ReadString = function(delim) {
		var $ptr, _tmp, _tmp$1, _tuple, b, delim, err, line, slice;
		line = "";
		err = $ifaceNil;
		b = this;
		_tuple = b.readSlice(delim);
		slice = _tuple[0];
		err = _tuple[1];
		_tmp = $bytesToString(slice);
		_tmp$1 = err;
		line = _tmp;
		err = _tmp$1;
		return [line, err];
	};
	Buffer.prototype.ReadString = function(delim) { return this.$val.ReadString(delim); };
	Index = function(s, sep) {
		var $ptr, c, i, n, o, s, sep, t;
		n = sep.$length;
		if (n === 0) {
			return 0;
		}
		if (n > s.$length) {
			return -1;
		}
		c = (0 >= sep.$length ? $throwRuntimeError("index out of range") : sep.$array[sep.$offset + 0]);
		if (n === 1) {
			return IndexByte(s, c);
		}
		i = 0;
		t = $subslice(s, 0, ((s.$length - n >> 0) + 1 >> 0));
		while (true) {
			if (!(i < t.$length)) { break; }
			if (!((((i < 0 || i >= t.$length) ? $throwRuntimeError("index out of range") : t.$array[t.$offset + i]) === c))) {
				o = IndexByte($subslice(t, i), c);
				if (o < 0) {
					break;
				}
				i = i + (o) >> 0;
			}
			if (Equal($subslice(s, i, (i + n >> 0)), sep)) {
				return i;
			}
			i = i + (1) >> 0;
		}
		return -1;
	};
	$pkg.Index = Index;
	HasPrefix = function(s, prefix) {
		var $ptr, prefix, s;
		return s.$length >= prefix.$length && Equal($subslice(s, 0, prefix.$length), prefix);
	};
	$pkg.HasPrefix = HasPrefix;
	ptrType.methods = [{prop: "Bytes", name: "Bytes", pkg: "", typ: $funcType([], [sliceType], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Cap", name: "Cap", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Truncate", name: "Truncate", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Reset", name: "Reset", pkg: "", typ: $funcType([], [], false)}, {prop: "grow", name: "grow", pkg: "bytes", typ: $funcType([$Int], [$Int], false)}, {prop: "Grow", name: "Grow", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([$String], [$Int, $error], false)}, {prop: "ReadFrom", name: "ReadFrom", pkg: "", typ: $funcType([io.Reader], [$Int64, $error], false)}, {prop: "WriteTo", name: "WriteTo", pkg: "", typ: $funcType([io.Writer], [$Int64, $error], false)}, {prop: "WriteByte", name: "WriteByte", pkg: "", typ: $funcType([$Uint8], [$error], false)}, {prop: "WriteRune", name: "WriteRune", pkg: "", typ: $funcType([$Int32], [$Int, $error], false)}, {prop: "Read", name: "Read", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}, {prop: "Next", name: "Next", pkg: "", typ: $funcType([$Int], [sliceType], false)}, {prop: "ReadByte", name: "ReadByte", pkg: "", typ: $funcType([], [$Uint8, $error], false)}, {prop: "ReadRune", name: "ReadRune", pkg: "", typ: $funcType([], [$Int32, $Int, $error], false)}, {prop: "UnreadRune", name: "UnreadRune", pkg: "", typ: $funcType([], [$error], false)}, {prop: "UnreadByte", name: "UnreadByte", pkg: "", typ: $funcType([], [$error], false)}, {prop: "ReadBytes", name: "ReadBytes", pkg: "", typ: $funcType([$Uint8], [sliceType, $error], false)}, {prop: "readSlice", name: "readSlice", pkg: "bytes", typ: $funcType([$Uint8], [sliceType, $error], false)}, {prop: "ReadString", name: "ReadString", pkg: "", typ: $funcType([$Uint8], [$String, $error], false)}];
	Buffer.init([{prop: "buf", name: "buf", pkg: "bytes", typ: sliceType, tag: ""}, {prop: "off", name: "off", pkg: "bytes", typ: $Int, tag: ""}, {prop: "runeBytes", name: "runeBytes", pkg: "bytes", typ: arrayType, tag: ""}, {prop: "bootstrap", name: "bootstrap", pkg: "bytes", typ: arrayType$1, tag: ""}, {prop: "lastRead", name: "lastRead", pkg: "bytes", typ: readOp, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrTooLarge = errors.New("bytes.Buffer: too large");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sort"] = (function() {
	var $pkg = {}, $init, insertionSort, siftDown, heapSort, medianOfThree, doPivot, quickSort, Sort;
	insertionSort = function(data, a, b) {
		var $ptr, _r, _v, a, b, data, i, j, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _v = $f._v; a = $f.a; b = $f.b; data = $f.data; i = $f.i; j = $f.j; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		i = a + 1 >> 0;
		/* while (true) { */ case 1:
			/* if (!(i < b)) { break; } */ if(!(i < b)) { $s = 2; continue; }
			j = i;
			/* while (true) { */ case 3:
				if (!(j > a)) { _v = false; $s = 5; continue s; }
				_r = data.Less(j, j - 1 >> 0); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_v = _r; case 5:
				/* if (!(_v)) { break; } */ if(!(_v)) { $s = 4; continue; }
				$r = data.Swap(j, j - 1 >> 0); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				j = j - (1) >> 0;
			/* } */ $s = 3; continue; case 4:
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: insertionSort }; } $f.$ptr = $ptr; $f._r = _r; $f._v = _v; $f.a = a; $f.b = b; $f.data = data; $f.i = i; $f.j = j; $f.$s = $s; $f.$r = $r; return $f;
	};
	siftDown = function(data, lo, hi, first) {
		var $ptr, _r, _r$1, _v, child, data, first, hi, lo, root, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _v = $f._v; child = $f.child; data = $f.data; first = $f.first; hi = $f.hi; lo = $f.lo; root = $f.root; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		root = lo;
		/* while (true) { */ case 1:
			child = ($imul(2, root)) + 1 >> 0;
			if (child >= hi) {
				/* break; */ $s = 2; continue;
			}
			if (!((child + 1 >> 0) < hi)) { _v = false; $s = 5; continue s; }
			_r = data.Less(first + child >> 0, (first + child >> 0) + 1 >> 0); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_v = _r; case 5:
			/* */ if (_v) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_v) { */ case 3:
				child = child + (1) >> 0;
			/* } */ case 4:
			_r$1 = data.Less(first + root >> 0, first + child >> 0); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ if (!_r$1) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (!_r$1) { */ case 7:
				return;
			/* } */ case 8:
			$r = data.Swap(first + root >> 0, first + child >> 0); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			root = child;
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: siftDown }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._v = _v; $f.child = child; $f.data = data; $f.first = first; $f.hi = hi; $f.lo = lo; $f.root = root; $f.$s = $s; $f.$r = $r; return $f;
	};
	heapSort = function(data, a, b) {
		var $ptr, _q, a, b, data, first, hi, i, i$1, lo, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; a = $f.a; b = $f.b; data = $f.data; first = $f.first; hi = $f.hi; i = $f.i; i$1 = $f.i$1; lo = $f.lo; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		first = a;
		lo = 0;
		hi = b - a >> 0;
		i = (_q = ((hi - 1 >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		/* while (true) { */ case 1:
			/* if (!(i >= 0)) { break; } */ if(!(i >= 0)) { $s = 2; continue; }
			$r = siftDown(data, i, hi, first); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			i = i - (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		i$1 = hi - 1 >> 0;
		/* while (true) { */ case 4:
			/* if (!(i$1 >= 0)) { break; } */ if(!(i$1 >= 0)) { $s = 5; continue; }
			$r = data.Swap(first, first + i$1 >> 0); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = siftDown(data, lo, i$1, first); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			i$1 = i$1 - (1) >> 0;
		/* } */ $s = 4; continue; case 5:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: heapSort }; } $f.$ptr = $ptr; $f._q = _q; $f.a = a; $f.b = b; $f.data = data; $f.first = first; $f.hi = hi; $f.i = i; $f.i$1 = i$1; $f.lo = lo; $f.$s = $s; $f.$r = $r; return $f;
	};
	medianOfThree = function(data, m1, m0, m2) {
		var $ptr, _r, _r$1, _r$2, data, m0, m1, m2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; data = $f.data; m0 = $f.m0; m1 = $f.m1; m2 = $f.m2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = data.Less(m1, m0); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (_r) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_r) { */ case 1:
			$r = data.Swap(m1, m0); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		_r$1 = data.Less(m2, m1); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ if (_r$1) { $s = 5; continue; }
		/* */ $s = 6; continue;
		/* if (_r$1) { */ case 5:
			$r = data.Swap(m2, m1); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			_r$2 = data.Less(m1, m0); /* */ $s = 11; case 11: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			/* */ if (_r$2) { $s = 9; continue; }
			/* */ $s = 10; continue;
			/* if (_r$2) { */ case 9:
				$r = data.Swap(m1, m0); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 10:
		/* } */ case 6:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: medianOfThree }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.data = data; $f.m0 = m0; $f.m1 = m1; $f.m2 = m2; $f.$s = $s; $f.$r = $r; return $f;
	};
	doPivot = function(data, lo, hi) {
		var $ptr, _q, _q$1, _q$2, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _tmp, _tmp$1, _tmp$2, _tmp$3, _v, _v$1, _v$2, _v$3, _v$4, a, b, c, data, dups, hi, lo, m, midhi, midlo, pivot, protect, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _q$1 = $f._q$1; _q$2 = $f._q$2; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _v = $f._v; _v$1 = $f._v$1; _v$2 = $f._v$2; _v$3 = $f._v$3; _v$4 = $f._v$4; a = $f.a; b = $f.b; c = $f.c; data = $f.data; dups = $f.dups; hi = $f.hi; lo = $f.lo; m = $f.m; midhi = $f.midhi; midlo = $f.midlo; pivot = $f.pivot; protect = $f.protect; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		midlo = 0;
		midhi = 0;
		m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
		/* */ if ((hi - lo >> 0) > 40) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ((hi - lo >> 0) > 40) { */ case 1:
			s = (_q$1 = ((hi - lo >> 0)) / 8, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
			$r = medianOfThree(data, lo, lo + s >> 0, lo + ($imul(2, s)) >> 0); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = medianOfThree(data, m, m - s >> 0, m + s >> 0); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = medianOfThree(data, hi - 1 >> 0, (hi - 1 >> 0) - s >> 0, (hi - 1 >> 0) - ($imul(2, s)) >> 0); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		$r = medianOfThree(data, lo, m, hi - 1 >> 0); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		pivot = lo;
		_tmp = lo + 1 >> 0;
		_tmp$1 = hi - 1 >> 0;
		a = _tmp;
		c = _tmp$1;
		/* while (true) { */ case 7:
			if (!(a < c)) { _v = false; $s = 9; continue s; }
			_r = data.Less(a, pivot); /* */ $s = 10; case 10: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_v = _r; case 9:
			/* if (!(_v)) { break; } */ if(!(_v)) { $s = 8; continue; }
			a = a + (1) >> 0;
		/* } */ $s = 7; continue; case 8:
		b = a;
		/* while (true) { */ case 11:
			/* while (true) { */ case 13:
				if (!(b < c)) { _v$1 = false; $s = 15; continue s; }
				_r$1 = data.Less(pivot, b); /* */ $s = 16; case 16: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_v$1 = !_r$1; case 15:
				/* if (!(_v$1)) { break; } */ if(!(_v$1)) { $s = 14; continue; }
				b = b + (1) >> 0;
			/* } */ $s = 13; continue; case 14:
			/* while (true) { */ case 17:
				if (!(b < c)) { _v$2 = false; $s = 19; continue s; }
				_r$2 = data.Less(pivot, c - 1 >> 0); /* */ $s = 20; case 20: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_v$2 = _r$2; case 19:
				/* if (!(_v$2)) { break; } */ if(!(_v$2)) { $s = 18; continue; }
				c = c - (1) >> 0;
			/* } */ $s = 17; continue; case 18:
			if (b >= c) {
				/* break; */ $s = 12; continue;
			}
			$r = data.Swap(b, c - 1 >> 0); /* */ $s = 21; case 21: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			b = b + (1) >> 0;
			c = c - (1) >> 0;
		/* } */ $s = 11; continue; case 12:
		protect = (hi - c >> 0) < 5;
		/* */ if (!protect && (hi - c >> 0) < (_q$2 = ((hi - lo >> 0)) / 4, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >> 0 : $throwRuntimeError("integer divide by zero"))) { $s = 22; continue; }
		/* */ $s = 23; continue;
		/* if (!protect && (hi - c >> 0) < (_q$2 = ((hi - lo >> 0)) / 4, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >> 0 : $throwRuntimeError("integer divide by zero"))) { */ case 22:
			dups = 0;
			_r$3 = data.Less(pivot, hi - 1 >> 0); /* */ $s = 26; case 26: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			/* */ if (!_r$3) { $s = 24; continue; }
			/* */ $s = 25; continue;
			/* if (!_r$3) { */ case 24:
				$r = data.Swap(c, hi - 1 >> 0); /* */ $s = 27; case 27: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				c = c + (1) >> 0;
				dups = dups + (1) >> 0;
			/* } */ case 25:
			_r$4 = data.Less(b - 1 >> 0, pivot); /* */ $s = 30; case 30: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			/* */ if (!_r$4) { $s = 28; continue; }
			/* */ $s = 29; continue;
			/* if (!_r$4) { */ case 28:
				b = b - (1) >> 0;
				dups = dups + (1) >> 0;
			/* } */ case 29:
			_r$5 = data.Less(m, pivot); /* */ $s = 33; case 33: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
			/* */ if (!_r$5) { $s = 31; continue; }
			/* */ $s = 32; continue;
			/* if (!_r$5) { */ case 31:
				$r = data.Swap(m, b - 1 >> 0); /* */ $s = 34; case 34: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				b = b - (1) >> 0;
				dups = dups + (1) >> 0;
			/* } */ case 32:
			protect = dups > 1;
		/* } */ case 23:
		/* */ if (protect) { $s = 35; continue; }
		/* */ $s = 36; continue;
		/* if (protect) { */ case 35:
			/* while (true) { */ case 37:
				/* while (true) { */ case 39:
					if (!(a < b)) { _v$3 = false; $s = 41; continue s; }
					_r$6 = data.Less(b - 1 >> 0, pivot); /* */ $s = 42; case 42: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
					_v$3 = !_r$6; case 41:
					/* if (!(_v$3)) { break; } */ if(!(_v$3)) { $s = 40; continue; }
					b = b - (1) >> 0;
				/* } */ $s = 39; continue; case 40:
				/* while (true) { */ case 43:
					if (!(a < b)) { _v$4 = false; $s = 45; continue s; }
					_r$7 = data.Less(a, pivot); /* */ $s = 46; case 46: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
					_v$4 = _r$7; case 45:
					/* if (!(_v$4)) { break; } */ if(!(_v$4)) { $s = 44; continue; }
					a = a + (1) >> 0;
				/* } */ $s = 43; continue; case 44:
				if (a >= b) {
					/* break; */ $s = 38; continue;
				}
				$r = data.Swap(a, b - 1 >> 0); /* */ $s = 47; case 47: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				a = a + (1) >> 0;
				b = b - (1) >> 0;
			/* } */ $s = 37; continue; case 38:
		/* } */ case 36:
		$r = data.Swap(pivot, b - 1 >> 0); /* */ $s = 48; case 48: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		_tmp$2 = b - 1 >> 0;
		_tmp$3 = c;
		midlo = _tmp$2;
		midhi = _tmp$3;
		return [midlo, midhi];
		/* */ } return; } if ($f === undefined) { $f = { $blk: doPivot }; } $f.$ptr = $ptr; $f._q = _q; $f._q$1 = _q$1; $f._q$2 = _q$2; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._v = _v; $f._v$1 = _v$1; $f._v$2 = _v$2; $f._v$3 = _v$3; $f._v$4 = _v$4; $f.a = a; $f.b = b; $f.c = c; $f.data = data; $f.dups = dups; $f.hi = hi; $f.lo = lo; $f.m = m; $f.midhi = midhi; $f.midlo = midlo; $f.pivot = pivot; $f.protect = protect; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	quickSort = function(data, a, b, maxDepth) {
		var $ptr, _r, _r$1, _tuple, a, b, data, i, maxDepth, mhi, mlo, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; a = $f.a; b = $f.b; data = $f.data; i = $f.i; maxDepth = $f.maxDepth; mhi = $f.mhi; mlo = $f.mlo; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* while (true) { */ case 1:
			/* if (!((b - a >> 0) > 12)) { break; } */ if(!((b - a >> 0) > 12)) { $s = 2; continue; }
			/* */ if (maxDepth === 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (maxDepth === 0) { */ case 3:
				$r = heapSort(data, a, b); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return;
			/* } */ case 4:
			maxDepth = maxDepth - (1) >> 0;
			_r = doPivot(data, a, b); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			mlo = _tuple[0];
			mhi = _tuple[1];
			/* */ if ((mlo - a >> 0) < (b - mhi >> 0)) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if ((mlo - a >> 0) < (b - mhi >> 0)) { */ case 7:
				$r = quickSort(data, a, mlo, maxDepth); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				a = mhi;
				$s = 9; continue;
			/* } else { */ case 8:
				$r = quickSort(data, mhi, b, maxDepth); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				b = mlo;
			/* } */ case 9:
		/* } */ $s = 1; continue; case 2:
		/* */ if ((b - a >> 0) > 1) { $s = 12; continue; }
		/* */ $s = 13; continue;
		/* if ((b - a >> 0) > 1) { */ case 12:
			i = a + 6 >> 0;
			/* while (true) { */ case 14:
				/* if (!(i < b)) { break; } */ if(!(i < b)) { $s = 15; continue; }
				_r$1 = data.Less(i, i - 6 >> 0); /* */ $s = 18; case 18: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				/* */ if (_r$1) { $s = 16; continue; }
				/* */ $s = 17; continue;
				/* if (_r$1) { */ case 16:
					$r = data.Swap(i, i - 6 >> 0); /* */ $s = 19; case 19: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 17:
				i = i + (1) >> 0;
			/* } */ $s = 14; continue; case 15:
			$r = insertionSort(data, a, b); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 13:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: quickSort }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.a = a; $f.b = b; $f.data = data; $f.i = i; $f.maxDepth = maxDepth; $f.mhi = mhi; $f.mlo = mlo; $f.$s = $s; $f.$r = $r; return $f;
	};
	Sort = function(data) {
		var $ptr, _r, data, i, maxDepth, n, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; data = $f.data; i = $f.i; maxDepth = $f.maxDepth; n = $f.n; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = data.Len(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		n = _r;
		maxDepth = 0;
		i = n;
		while (true) {
			if (!(i > 0)) { break; }
			maxDepth = maxDepth + (1) >> 0;
			i = (i >> $min((1), 31)) >> 0;
		}
		maxDepth = $imul(maxDepth, (2));
		$r = quickSort(data, 0, n, maxDepth); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Sort }; } $f.$ptr = $ptr; $f._r = _r; $f.data = data; $f.i = i; $f.maxDepth = maxDepth; $f.n = n; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Sort = Sort;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["regexp/syntax"] = (function() {
	var $pkg = {}, $init, bytes, sort, strconv, strings, unicode, utf8, patchList, frag, compiler, Error, ErrorCode, Flags, parser, charGroup, ranges, Prog, InstOp, EmptyOp, Inst, Regexp, Op, sliceType, sliceType$1, sliceType$2, sliceType$3, ptrType, sliceType$4, ptrType$1, sliceType$5, arrayType, arrayType$1, ptrType$2, ptrType$3, sliceType$6, arrayType$2, arrayType$3, ptrType$4, ptrType$5, ptrType$6, ptrType$7, anyRuneNotNL, anyRune, anyTable, code1, code2, code3, perlGroup, code4, code5, code6, code7, code8, code9, code10, code11, code12, code13, code14, code15, code16, code17, posixGroup, instOpNames, Compile, minFoldRune, repeatIsValid, cleanAlt, literalRegexp, Parse, isValidCaptureName, isCharClass, matchRune, mergeCharClass, unicodeTable, cleanClass, appendLiteral, appendRange, appendFoldedRange, appendClass, appendFoldedClass, appendNegatedClass, appendTable, appendNegatedTable, negateClass, checkUTF8, nextRune, isalnum, unhex, EmptyOpContext, IsWordChar, wordRune, bw, dumpProg, u32, dumpInst, writeRegexp, escape, simplify1;
	bytes = $packages["bytes"];
	sort = $packages["sort"];
	strconv = $packages["strconv"];
	strings = $packages["strings"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	patchList = $pkg.patchList = $newType(4, $kindUint32, "syntax.patchList", "patchList", "regexp/syntax", null);
	frag = $pkg.frag = $newType(0, $kindStruct, "syntax.frag", "frag", "regexp/syntax", function(i_, out_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.i = 0;
			this.out = 0;
			return;
		}
		this.i = i_;
		this.out = out_;
	});
	compiler = $pkg.compiler = $newType(0, $kindStruct, "syntax.compiler", "compiler", "regexp/syntax", function(p_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.p = ptrType.nil;
			return;
		}
		this.p = p_;
	});
	Error = $pkg.Error = $newType(0, $kindStruct, "syntax.Error", "Error", "regexp/syntax", function(Code_, Expr_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Code = "";
			this.Expr = "";
			return;
		}
		this.Code = Code_;
		this.Expr = Expr_;
	});
	ErrorCode = $pkg.ErrorCode = $newType(8, $kindString, "syntax.ErrorCode", "ErrorCode", "regexp/syntax", null);
	Flags = $pkg.Flags = $newType(2, $kindUint16, "syntax.Flags", "Flags", "regexp/syntax", null);
	parser = $pkg.parser = $newType(0, $kindStruct, "syntax.parser", "parser", "regexp/syntax", function(flags_, stack_, free_, numCap_, wholeRegexp_, tmpClass_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.flags = 0;
			this.stack = sliceType$5.nil;
			this.free = ptrType$1.nil;
			this.numCap = 0;
			this.wholeRegexp = "";
			this.tmpClass = sliceType.nil;
			return;
		}
		this.flags = flags_;
		this.stack = stack_;
		this.free = free_;
		this.numCap = numCap_;
		this.wholeRegexp = wholeRegexp_;
		this.tmpClass = tmpClass_;
	});
	charGroup = $pkg.charGroup = $newType(0, $kindStruct, "syntax.charGroup", "charGroup", "regexp/syntax", function(sign_, class$1_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.sign = 0;
			this.class$1 = sliceType.nil;
			return;
		}
		this.sign = sign_;
		this.class$1 = class$1_;
	});
	ranges = $pkg.ranges = $newType(0, $kindStruct, "syntax.ranges", "ranges", "regexp/syntax", function(p_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.p = ptrType$2.nil;
			return;
		}
		this.p = p_;
	});
	Prog = $pkg.Prog = $newType(0, $kindStruct, "syntax.Prog", "Prog", "regexp/syntax", function(Inst_, Start_, NumCap_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Inst = sliceType$4.nil;
			this.Start = 0;
			this.NumCap = 0;
			return;
		}
		this.Inst = Inst_;
		this.Start = Start_;
		this.NumCap = NumCap_;
	});
	InstOp = $pkg.InstOp = $newType(1, $kindUint8, "syntax.InstOp", "InstOp", "regexp/syntax", null);
	EmptyOp = $pkg.EmptyOp = $newType(1, $kindUint8, "syntax.EmptyOp", "EmptyOp", "regexp/syntax", null);
	Inst = $pkg.Inst = $newType(0, $kindStruct, "syntax.Inst", "Inst", "regexp/syntax", function(Op_, Out_, Arg_, Rune_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Op = 0;
			this.Out = 0;
			this.Arg = 0;
			this.Rune = sliceType.nil;
			return;
		}
		this.Op = Op_;
		this.Out = Out_;
		this.Arg = Arg_;
		this.Rune = Rune_;
	});
	Regexp = $pkg.Regexp = $newType(0, $kindStruct, "syntax.Regexp", "Regexp", "regexp/syntax", function(Op_, Flags_, Sub_, Sub0_, Rune_, Rune0_, Min_, Max_, Cap_, Name_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Op = 0;
			this.Flags = 0;
			this.Sub = sliceType$5.nil;
			this.Sub0 = arrayType.zero();
			this.Rune = sliceType.nil;
			this.Rune0 = arrayType$1.zero();
			this.Min = 0;
			this.Max = 0;
			this.Cap = 0;
			this.Name = "";
			return;
		}
		this.Op = Op_;
		this.Flags = Flags_;
		this.Sub = Sub_;
		this.Sub0 = Sub0_;
		this.Rune = Rune_;
		this.Rune0 = Rune0_;
		this.Min = Min_;
		this.Max = Max_;
		this.Cap = Cap_;
		this.Name = Name_;
	});
	Op = $pkg.Op = $newType(1, $kindUint8, "syntax.Op", "Op", "regexp/syntax", null);
	sliceType = $sliceType($Int32);
	sliceType$1 = $sliceType(unicode.Range16);
	sliceType$2 = $sliceType(unicode.Range32);
	sliceType$3 = $sliceType($String);
	ptrType = $ptrType(Prog);
	sliceType$4 = $sliceType(Inst);
	ptrType$1 = $ptrType(Regexp);
	sliceType$5 = $sliceType(ptrType$1);
	arrayType = $arrayType(ptrType$1, 1);
	arrayType$1 = $arrayType($Int32, 2);
	ptrType$2 = $ptrType(sliceType);
	ptrType$3 = $ptrType(unicode.RangeTable);
	sliceType$6 = $sliceType($Uint8);
	arrayType$2 = $arrayType($Uint8, 4);
	arrayType$3 = $arrayType($Uint8, 64);
	ptrType$4 = $ptrType(compiler);
	ptrType$5 = $ptrType(Error);
	ptrType$6 = $ptrType(parser);
	ptrType$7 = $ptrType(Inst);
	patchList.prototype.next = function(p) {
		var $ptr, i, l, p, x, x$1;
		l = this.$val;
		i = (x = p.Inst, x$1 = l >>> 1 >>> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		if (((l & 1) >>> 0) === 0) {
			return (i.Out >>> 0);
		}
		return (i.Arg >>> 0);
	};
	$ptrType(patchList).prototype.next = function(p) { return new patchList(this.$get()).next(p); };
	patchList.prototype.patch = function(p, val) {
		var $ptr, i, l, p, val, x, x$1;
		l = this.$val;
		while (true) {
			if (!(!((l === 0)))) { break; }
			i = (x = p.Inst, x$1 = l >>> 1 >>> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
			if (((l & 1) >>> 0) === 0) {
				l = (i.Out >>> 0);
				i.Out = val;
			} else {
				l = (i.Arg >>> 0);
				i.Arg = val;
			}
		}
	};
	$ptrType(patchList).prototype.patch = function(p, val) { return new patchList(this.$get()).patch(p, val); };
	patchList.prototype.append = function(p, l2) {
		var $ptr, i, l1, l2, last, next, p, x, x$1;
		l1 = this.$val;
		if (l1 === 0) {
			return l2;
		}
		if (l2 === 0) {
			return l1;
		}
		last = l1;
		while (true) {
			next = new patchList(last).next(p);
			if (next === 0) {
				break;
			}
			last = next;
		}
		i = (x = p.Inst, x$1 = last >>> 1 >>> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		if (((last & 1) >>> 0) === 0) {
			i.Out = (l2 >>> 0);
		} else {
			i.Arg = (l2 >>> 0);
		}
		return l1;
	};
	$ptrType(patchList).prototype.append = function(p, l2) { return new patchList(this.$get()).append(p, l2); };
	Compile = function(re) {
		var $ptr, c, f, re;
		c = new compiler.ptr(ptrType.nil);
		c.init();
		f = $clone(c.compile(re), frag);
		new patchList(f.out).patch(c.p, c.inst(4).i);
		c.p.Start = (f.i >> 0);
		return [c.p, $ifaceNil];
	};
	$pkg.Compile = Compile;
	compiler.ptr.prototype.init = function() {
		var $ptr, c;
		c = this;
		c.p = new Prog.ptr(sliceType$4.nil, 0, 0);
		c.p.NumCap = 2;
		c.inst(5);
	};
	compiler.prototype.init = function() { return this.$val.init(); };
	compiler.ptr.prototype.compile = function(re) {
		var $ptr, _1, _i, _i$1, _i$2, _ref, _ref$1, _ref$2, bra, c, f, f$1, f$2, f1, i, j, ket, re, sub, sub$1, sub$2, x, x$1, x$2, x$3;
		c = this;
		_1 = re.Op;
		if (_1 === (1)) {
			return c.fail();
		} else if (_1 === (2)) {
			return c.nop();
		} else if (_1 === (3)) {
			if (re.Rune.$length === 0) {
				return c.nop();
			}
			f = new frag.ptr(0, 0);
			_ref = re.Rune;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				j = _i;
				f1 = $clone(c.rune($subslice(re.Rune, j, (j + 1 >> 0)), re.Flags), frag);
				if (j === 0) {
					frag.copy(f, f1);
				} else {
					frag.copy(f, c.cat(f, f1));
				}
				_i++;
			}
			return f;
		} else if (_1 === (4)) {
			return c.rune(re.Rune, re.Flags);
		} else if (_1 === (5)) {
			return c.rune(anyRuneNotNL, 0);
		} else if (_1 === (6)) {
			return c.rune(anyRune, 0);
		} else if (_1 === (7)) {
			return c.empty(1);
		} else if (_1 === (8)) {
			return c.empty(2);
		} else if (_1 === (9)) {
			return c.empty(4);
		} else if (_1 === (10)) {
			return c.empty(8);
		} else if (_1 === (11)) {
			return c.empty(16);
		} else if (_1 === (12)) {
			return c.empty(32);
		} else if (_1 === (13)) {
			bra = $clone(c.cap(((re.Cap << 1 >> 0) >>> 0)), frag);
			sub = $clone(c.compile((x = re.Sub, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0]))), frag);
			ket = $clone(c.cap((((re.Cap << 1 >> 0) | 1) >>> 0)), frag);
			return c.cat(c.cat(bra, sub), ket);
		} else if (_1 === (14)) {
			return c.star(c.compile((x$1 = re.Sub, (0 >= x$1.$length ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + 0]))), !((((re.Flags & 32) >>> 0) === 0)));
		} else if (_1 === (15)) {
			return c.plus(c.compile((x$2 = re.Sub, (0 >= x$2.$length ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + 0]))), !((((re.Flags & 32) >>> 0) === 0)));
		} else if (_1 === (16)) {
			return c.quest(c.compile((x$3 = re.Sub, (0 >= x$3.$length ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 0]))), !((((re.Flags & 32) >>> 0) === 0)));
		} else if (_1 === (18)) {
			if (re.Sub.$length === 0) {
				return c.nop();
			}
			f$1 = new frag.ptr(0, 0);
			_ref$1 = re.Sub;
			_i$1 = 0;
			while (true) {
				if (!(_i$1 < _ref$1.$length)) { break; }
				i = _i$1;
				sub$1 = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
				if (i === 0) {
					frag.copy(f$1, c.compile(sub$1));
				} else {
					frag.copy(f$1, c.cat(f$1, c.compile(sub$1)));
				}
				_i$1++;
			}
			return f$1;
		} else if (_1 === (19)) {
			f$2 = new frag.ptr(0, 0);
			_ref$2 = re.Sub;
			_i$2 = 0;
			while (true) {
				if (!(_i$2 < _ref$2.$length)) { break; }
				sub$2 = ((_i$2 < 0 || _i$2 >= _ref$2.$length) ? $throwRuntimeError("index out of range") : _ref$2.$array[_ref$2.$offset + _i$2]);
				frag.copy(f$2, c.alt(f$2, c.compile(sub$2)));
				_i$2++;
			}
			return f$2;
		}
		$panic(new $String("regexp: unhandled case in compile"));
	};
	compiler.prototype.compile = function(re) { return this.$val.compile(re); };
	compiler.ptr.prototype.inst = function(op) {
		var $ptr, c, f, op;
		c = this;
		f = new frag.ptr((c.p.Inst.$length >>> 0), 0);
		c.p.Inst = $append(c.p.Inst, new Inst.ptr(op, 0, 0, sliceType.nil));
		return f;
	};
	compiler.prototype.inst = function(op) { return this.$val.inst(op); };
	compiler.ptr.prototype.nop = function() {
		var $ptr, c, f;
		c = this;
		f = $clone(c.inst(6), frag);
		f.out = ((f.i << 1 >>> 0) >>> 0);
		return f;
	};
	compiler.prototype.nop = function() { return this.$val.nop(); };
	compiler.ptr.prototype.fail = function() {
		var $ptr, c;
		c = this;
		return new frag.ptr(0, 0);
	};
	compiler.prototype.fail = function() { return this.$val.fail(); };
	compiler.ptr.prototype.cap = function(arg) {
		var $ptr, arg, c, f, x, x$1;
		c = this;
		f = $clone(c.inst(2), frag);
		f.out = ((f.i << 1 >>> 0) >>> 0);
		(x = c.p.Inst, x$1 = f.i, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])).Arg = arg;
		if (c.p.NumCap < ((arg >> 0) + 1 >> 0)) {
			c.p.NumCap = (arg >> 0) + 1 >> 0;
		}
		return f;
	};
	compiler.prototype.cap = function(arg) { return this.$val.cap(arg); };
	compiler.ptr.prototype.cat = function(f1, f2) {
		var $ptr, c, f1, f2;
		f2 = $clone(f2, frag);
		f1 = $clone(f1, frag);
		c = this;
		if ((f1.i === 0) || (f2.i === 0)) {
			return new frag.ptr(0, 0);
		}
		new patchList(f1.out).patch(c.p, f2.i);
		return new frag.ptr(f1.i, f2.out);
	};
	compiler.prototype.cat = function(f1, f2) { return this.$val.cat(f1, f2); };
	compiler.ptr.prototype.alt = function(f1, f2) {
		var $ptr, c, f, f1, f2, i, x, x$1;
		f2 = $clone(f2, frag);
		f1 = $clone(f1, frag);
		c = this;
		if (f1.i === 0) {
			return f2;
		}
		if (f2.i === 0) {
			return f1;
		}
		f = $clone(c.inst(0), frag);
		i = (x = c.p.Inst, x$1 = f.i, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		i.Out = f1.i;
		i.Arg = f2.i;
		f.out = new patchList(f1.out).append(c.p, f2.out);
		return f;
	};
	compiler.prototype.alt = function(f1, f2) { return this.$val.alt(f1, f2); };
	compiler.ptr.prototype.quest = function(f1, nongreedy) {
		var $ptr, c, f, f1, i, nongreedy, x, x$1;
		f1 = $clone(f1, frag);
		c = this;
		f = $clone(c.inst(0), frag);
		i = (x = c.p.Inst, x$1 = f.i, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		if (nongreedy) {
			i.Arg = f1.i;
			f.out = ((f.i << 1 >>> 0) >>> 0);
		} else {
			i.Out = f1.i;
			f.out = ((((f.i << 1 >>> 0) | 1) >>> 0) >>> 0);
		}
		f.out = new patchList(f.out).append(c.p, f1.out);
		return f;
	};
	compiler.prototype.quest = function(f1, nongreedy) { return this.$val.quest(f1, nongreedy); };
	compiler.ptr.prototype.star = function(f1, nongreedy) {
		var $ptr, c, f, f1, i, nongreedy, x, x$1;
		f1 = $clone(f1, frag);
		c = this;
		f = $clone(c.inst(0), frag);
		i = (x = c.p.Inst, x$1 = f.i, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		if (nongreedy) {
			i.Arg = f1.i;
			f.out = ((f.i << 1 >>> 0) >>> 0);
		} else {
			i.Out = f1.i;
			f.out = ((((f.i << 1 >>> 0) | 1) >>> 0) >>> 0);
		}
		new patchList(f1.out).patch(c.p, f.i);
		return f;
	};
	compiler.prototype.star = function(f1, nongreedy) { return this.$val.star(f1, nongreedy); };
	compiler.ptr.prototype.plus = function(f1, nongreedy) {
		var $ptr, c, f1, nongreedy;
		f1 = $clone(f1, frag);
		c = this;
		return new frag.ptr(f1.i, c.star(f1, nongreedy).out);
	};
	compiler.prototype.plus = function(f1, nongreedy) { return this.$val.plus(f1, nongreedy); };
	compiler.ptr.prototype.empty = function(op) {
		var $ptr, c, f, op, x, x$1;
		c = this;
		f = $clone(c.inst(3), frag);
		(x = c.p.Inst, x$1 = f.i, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])).Arg = (op >>> 0);
		f.out = ((f.i << 1 >>> 0) >>> 0);
		return f;
	};
	compiler.prototype.empty = function(op) { return this.$val.empty(op); };
	compiler.ptr.prototype.rune = function(r, flags) {
		var $ptr, c, f, flags, i, r, x, x$1;
		c = this;
		f = $clone(c.inst(7), frag);
		i = (x = c.p.Inst, x$1 = f.i, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		i.Rune = r;
		flags = (flags & (1)) >>> 0;
		if (!((r.$length === 1)) || (unicode.SimpleFold((0 >= r.$length ? $throwRuntimeError("index out of range") : r.$array[r.$offset + 0])) === (0 >= r.$length ? $throwRuntimeError("index out of range") : r.$array[r.$offset + 0]))) {
			flags = (flags & ~(1)) << 16 >>> 16;
		}
		i.Arg = (flags >>> 0);
		f.out = ((f.i << 1 >>> 0) >>> 0);
		if ((((flags & 1) >>> 0) === 0) && ((r.$length === 1) || (r.$length === 2) && ((0 >= r.$length ? $throwRuntimeError("index out of range") : r.$array[r.$offset + 0]) === (1 >= r.$length ? $throwRuntimeError("index out of range") : r.$array[r.$offset + 1])))) {
			i.Op = 8;
		} else if ((r.$length === 2) && ((0 >= r.$length ? $throwRuntimeError("index out of range") : r.$array[r.$offset + 0]) === 0) && ((1 >= r.$length ? $throwRuntimeError("index out of range") : r.$array[r.$offset + 1]) === 1114111)) {
			i.Op = 9;
		} else if ((r.$length === 4) && ((0 >= r.$length ? $throwRuntimeError("index out of range") : r.$array[r.$offset + 0]) === 0) && ((1 >= r.$length ? $throwRuntimeError("index out of range") : r.$array[r.$offset + 1]) === 9) && ((2 >= r.$length ? $throwRuntimeError("index out of range") : r.$array[r.$offset + 2]) === 11) && ((3 >= r.$length ? $throwRuntimeError("index out of range") : r.$array[r.$offset + 3]) === 1114111)) {
			i.Op = 10;
		}
		return f;
	};
	compiler.prototype.rune = function(r, flags) { return this.$val.rune(r, flags); };
	Error.ptr.prototype.Error = function() {
		var $ptr, e;
		e = this;
		return "error parsing regexp: " + new ErrorCode(e.Code).String() + ": `" + e.Expr + "`";
	};
	Error.prototype.Error = function() { return this.$val.Error(); };
	ErrorCode.prototype.String = function() {
		var $ptr, e;
		e = this.$val;
		return e;
	};
	$ptrType(ErrorCode).prototype.String = function() { return new ErrorCode(this.$get()).String(); };
	parser.ptr.prototype.newRegexp = function(op) {
		var $ptr, op, p, re;
		p = this;
		re = p.free;
		if (!(re === ptrType$1.nil)) {
			p.free = re.Sub0[0];
			Regexp.copy(re, new Regexp.ptr(0, 0, sliceType$5.nil, arrayType.zero(), sliceType.nil, arrayType$1.zero(), 0, 0, 0, ""));
		} else {
			re = new Regexp.ptr(0, 0, sliceType$5.nil, arrayType.zero(), sliceType.nil, arrayType$1.zero(), 0, 0, 0, "");
		}
		re.Op = op;
		return re;
	};
	parser.prototype.newRegexp = function(op) { return this.$val.newRegexp(op); };
	parser.ptr.prototype.reuse = function(re) {
		var $ptr, p, re;
		p = this;
		re.Sub0[0] = p.free;
		p.free = re;
	};
	parser.prototype.reuse = function(re) { return this.$val.reuse(re); };
	parser.ptr.prototype.push = function(re) {
		var $ptr, p, re, x, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$16, x$17, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		p = this;
		if ((re.Op === 4) && (re.Rune.$length === 2) && ((x = re.Rune, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])) === (x$1 = re.Rune, (1 >= x$1.$length ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + 1])))) {
			if (p.maybeConcat((x$16 = re.Rune, (0 >= x$16.$length ? $throwRuntimeError("index out of range") : x$16.$array[x$16.$offset + 0])), (p.flags & ~1) << 16 >>> 16)) {
				return ptrType$1.nil;
			}
			re.Op = 3;
			re.Rune = $subslice(re.Rune, 0, 1);
			re.Flags = (p.flags & ~1) << 16 >>> 16;
		} else if ((re.Op === 4) && (re.Rune.$length === 4) && ((x$2 = re.Rune, (0 >= x$2.$length ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + 0])) === (x$3 = re.Rune, (1 >= x$3.$length ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 1]))) && ((x$4 = re.Rune, (2 >= x$4.$length ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + 2])) === (x$5 = re.Rune, (3 >= x$5.$length ? $throwRuntimeError("index out of range") : x$5.$array[x$5.$offset + 3]))) && (unicode.SimpleFold((x$6 = re.Rune, (0 >= x$6.$length ? $throwRuntimeError("index out of range") : x$6.$array[x$6.$offset + 0]))) === (x$7 = re.Rune, (2 >= x$7.$length ? $throwRuntimeError("index out of range") : x$7.$array[x$7.$offset + 2]))) && (unicode.SimpleFold((x$8 = re.Rune, (2 >= x$8.$length ? $throwRuntimeError("index out of range") : x$8.$array[x$8.$offset + 2]))) === (x$9 = re.Rune, (0 >= x$9.$length ? $throwRuntimeError("index out of range") : x$9.$array[x$9.$offset + 0]))) || (re.Op === 4) && (re.Rune.$length === 2) && (((x$10 = re.Rune, (0 >= x$10.$length ? $throwRuntimeError("index out of range") : x$10.$array[x$10.$offset + 0])) + 1 >> 0) === (x$11 = re.Rune, (1 >= x$11.$length ? $throwRuntimeError("index out of range") : x$11.$array[x$11.$offset + 1]))) && (unicode.SimpleFold((x$12 = re.Rune, (0 >= x$12.$length ? $throwRuntimeError("index out of range") : x$12.$array[x$12.$offset + 0]))) === (x$13 = re.Rune, (1 >= x$13.$length ? $throwRuntimeError("index out of range") : x$13.$array[x$13.$offset + 1]))) && (unicode.SimpleFold((x$14 = re.Rune, (1 >= x$14.$length ? $throwRuntimeError("index out of range") : x$14.$array[x$14.$offset + 1]))) === (x$15 = re.Rune, (0 >= x$15.$length ? $throwRuntimeError("index out of range") : x$15.$array[x$15.$offset + 0])))) {
			if (p.maybeConcat((x$17 = re.Rune, (0 >= x$17.$length ? $throwRuntimeError("index out of range") : x$17.$array[x$17.$offset + 0])), (p.flags | 1) >>> 0)) {
				return ptrType$1.nil;
			}
			re.Op = 3;
			re.Rune = $subslice(re.Rune, 0, 1);
			re.Flags = (p.flags | 1) >>> 0;
		} else {
			p.maybeConcat(-1, 0);
		}
		p.stack = $append(p.stack, re);
		return re;
	};
	parser.prototype.push = function(re) { return this.$val.push(re); };
	parser.ptr.prototype.maybeConcat = function(r, flags) {
		var $ptr, flags, n, p, r, re1, re2, x, x$1, x$2, x$3, x$4;
		p = this;
		n = p.stack.$length;
		if (n < 2) {
			return false;
		}
		re1 = (x = p.stack, x$1 = n - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		re2 = (x$2 = p.stack, x$3 = n - 2 >> 0, ((x$3 < 0 || x$3 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + x$3]));
		if (!((re1.Op === 3)) || !((re2.Op === 3)) || !((((re1.Flags & 1) >>> 0) === ((re2.Flags & 1) >>> 0)))) {
			return false;
		}
		re2.Rune = $appendSlice(re2.Rune, re1.Rune);
		if (r >= 0) {
			re1.Rune = $subslice(new sliceType(re1.Rune0), 0, 1);
			(x$4 = re1.Rune, (0 >= x$4.$length ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + 0] = r));
			re1.Flags = flags;
			return true;
		}
		p.stack = $subslice(p.stack, 0, (n - 1 >> 0));
		p.reuse(re1);
		return false;
	};
	parser.prototype.maybeConcat = function(r, flags) { return this.$val.maybeConcat(r, flags); };
	parser.ptr.prototype.newLiteral = function(r, flags) {
		var $ptr, flags, p, r, re;
		p = this;
		re = p.newRegexp(3);
		re.Flags = flags;
		if (!((((flags & 1) >>> 0) === 0))) {
			r = minFoldRune(r);
		}
		re.Rune0[0] = r;
		re.Rune = $subslice(new sliceType(re.Rune0), 0, 1);
		return re;
	};
	parser.prototype.newLiteral = function(r, flags) { return this.$val.newLiteral(r, flags); };
	minFoldRune = function(r) {
		var $ptr, min, r, r0;
		if (r < 65 || r > 71903) {
			return r;
		}
		min = r;
		r0 = r;
		r = unicode.SimpleFold(r);
		while (true) {
			if (!(!((r === r0)))) { break; }
			if (min > r) {
				min = r;
			}
			r = unicode.SimpleFold(r);
		}
		return min;
	};
	parser.ptr.prototype.literal = function(r) {
		var $ptr, p, r;
		p = this;
		p.push(p.newLiteral(r, p.flags));
	};
	parser.prototype.literal = function(r) { return this.$val.literal(r); };
	parser.ptr.prototype.op = function(op) {
		var $ptr, op, p, re;
		p = this;
		re = p.newRegexp(op);
		re.Flags = p.flags;
		return p.push(re);
	};
	parser.prototype.op = function(op) { return this.$val.op(op); };
	parser.ptr.prototype.repeat = function(op, min, max, before, after, lastRepeat) {
		var $ptr, after, before, flags, lastRepeat, max, min, n, op, p, re, sub, x, x$1, x$2, x$3, x$4;
		p = this;
		flags = p.flags;
		if (!((((p.flags & 64) >>> 0) === 0))) {
			if (after.length > 0 && (after.charCodeAt(0) === 63)) {
				after = after.substring(1);
				flags = (flags ^ (32)) << 16 >>> 16;
			}
			if (!(lastRepeat === "")) {
				return ["", new Error.ptr("invalid nested repetition operator", lastRepeat.substring(0, (lastRepeat.length - after.length >> 0)))];
			}
		}
		n = p.stack.$length;
		if (n === 0) {
			return ["", new Error.ptr("missing argument to repetition operator", before.substring(0, (before.length - after.length >> 0)))];
		}
		sub = (x = p.stack, x$1 = n - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		if (sub.Op >= 128) {
			return ["", new Error.ptr("missing argument to repetition operator", before.substring(0, (before.length - after.length >> 0)))];
		}
		re = p.newRegexp(op);
		re.Min = min;
		re.Max = max;
		re.Flags = flags;
		re.Sub = $subslice(new sliceType$5(re.Sub0), 0, 1);
		(x$2 = re.Sub, (0 >= x$2.$length ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + 0] = sub));
		(x$3 = p.stack, x$4 = n - 1 >> 0, ((x$4 < 0 || x$4 >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + x$4] = re));
		if ((op === 17) && (min >= 2 || max >= 2) && !repeatIsValid(re, 1000)) {
			return ["", new Error.ptr("invalid repeat count", before.substring(0, (before.length - after.length >> 0)))];
		}
		return [after, $ifaceNil];
	};
	parser.prototype.repeat = function(op, min, max, before, after, lastRepeat) { return this.$val.repeat(op, min, max, before, after, lastRepeat); };
	repeatIsValid = function(re, n) {
		var $ptr, _i, _q, _ref, m, n, re, sub;
		if (re.Op === 17) {
			m = re.Max;
			if (m === 0) {
				return true;
			}
			if (m < 0) {
				m = re.Min;
			}
			if (m > n) {
				return false;
			}
			if (m > 0) {
				n = (_q = n / (m), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
			}
		}
		_ref = re.Sub;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			sub = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (!repeatIsValid(sub, n)) {
				return false;
			}
			_i++;
		}
		return true;
	};
	parser.ptr.prototype.concat = function() {
		var $ptr, _r, _r$1, i, p, subs, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; i = $f.i; p = $f.p; subs = $f.subs; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		p.maybeConcat(-1, 0);
		i = p.stack.$length;
		while (true) {
			if (!(i > 0 && (x = p.stack, x$1 = i - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])).Op < 128)) { break; }
			i = i - (1) >> 0;
		}
		subs = $subslice(p.stack, i);
		p.stack = $subslice(p.stack, 0, i);
		if (subs.$length === 0) {
			return p.push(p.newRegexp(2));
		}
		_r = p.collapse(subs, 18); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = p.push(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: parser.ptr.prototype.concat }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.i = i; $f.p = p; $f.subs = subs; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	parser.prototype.concat = function() { return this.$val.concat(); };
	parser.ptr.prototype.alternate = function() {
		var $ptr, _r, _r$1, i, p, subs, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; i = $f.i; p = $f.p; subs = $f.subs; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		i = p.stack.$length;
		while (true) {
			if (!(i > 0 && (x = p.stack, x$1 = i - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])).Op < 128)) { break; }
			i = i - (1) >> 0;
		}
		subs = $subslice(p.stack, i);
		p.stack = $subslice(p.stack, 0, i);
		/* */ if (subs.$length > 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (subs.$length > 0) { */ case 1:
			$r = cleanAlt((x$2 = subs.$length - 1 >> 0, ((x$2 < 0 || x$2 >= subs.$length) ? $throwRuntimeError("index out of range") : subs.$array[subs.$offset + x$2]))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		if (subs.$length === 0) {
			return p.push(p.newRegexp(1));
		}
		_r = p.collapse(subs, 19); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = p.push(_r); /* */ $s = 5; case 5: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 6; case 6:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: parser.ptr.prototype.alternate }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.i = i; $f.p = p; $f.subs = subs; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	parser.prototype.alternate = function() { return this.$val.alternate(); };
	cleanAlt = function(re) {
		var $ptr, _1, _r, re, x, x$1, x$2, x$3, x$4, x$5, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; re = $f.re; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_1 = re.Op;
			/* */ if (_1 === (4)) { $s = 2; continue; }
			/* */ $s = 3; continue;
			/* if (_1 === (4)) { */ case 2:
				_r = cleanClass((re.$ptr_Rune || (re.$ptr_Rune = new ptrType$2(function() { return this.$target.Rune; }, function($v) { this.$target.Rune = $v; }, re)))); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				re.Rune = _r;
				if ((re.Rune.$length === 2) && ((x = re.Rune, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])) === 0) && ((x$1 = re.Rune, (1 >= x$1.$length ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + 1])) === 1114111)) {
					re.Rune = sliceType.nil;
					re.Op = 6;
					return;
				}
				if ((re.Rune.$length === 4) && ((x$2 = re.Rune, (0 >= x$2.$length ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + 0])) === 0) && ((x$3 = re.Rune, (1 >= x$3.$length ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 1])) === 9) && ((x$4 = re.Rune, (2 >= x$4.$length ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + 2])) === 11) && ((x$5 = re.Rune, (3 >= x$5.$length ? $throwRuntimeError("index out of range") : x$5.$array[x$5.$offset + 3])) === 1114111)) {
					re.Rune = sliceType.nil;
					re.Op = 5;
					return;
				}
				if ((re.Rune.$capacity - re.Rune.$length >> 0) > 100) {
					re.Rune = $appendSlice($subslice(new sliceType(re.Rune0), 0, 0), re.Rune);
				}
			/* } */ case 3:
		case 1:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: cleanAlt }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f.re = re; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.$s = $s; $f.$r = $r; return $f;
	};
	parser.ptr.prototype.collapse = function(subs, op) {
		var $ptr, _i, _r, _ref, old, op, p, re, sub, subs, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; old = $f.old; op = $f.op; p = $f.p; re = $f.re; sub = $f.sub; subs = $f.subs; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		if (subs.$length === 1) {
			return (0 >= subs.$length ? $throwRuntimeError("index out of range") : subs.$array[subs.$offset + 0]);
		}
		re = p.newRegexp(op);
		re.Sub = $subslice(new sliceType$5(re.Sub0), 0, 0);
		_ref = subs;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			sub = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (sub.Op === op) {
				re.Sub = $appendSlice(re.Sub, sub.Sub);
				p.reuse(sub);
			} else {
				re.Sub = $append(re.Sub, sub);
			}
			_i++;
		}
		/* */ if (op === 19) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (op === 19) { */ case 1:
			_r = p.factor(re.Sub, re.Flags); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			re.Sub = _r;
			if (re.Sub.$length === 1) {
				old = re;
				re = (x = re.Sub, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0]));
				p.reuse(old);
			}
		/* } */ case 2:
		return re;
		/* */ } return; } if ($f === undefined) { $f = { $blk: parser.ptr.prototype.collapse }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f.old = old; $f.op = op; $f.p = p; $f.re = re; $f.sub = sub; $f.subs = subs; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	parser.prototype.collapse = function(subs, op) { return this.$val.collapse(subs, op); };
	parser.ptr.prototype.factor = function(sub, flags) {
		var $ptr, _i, _r, _r$1, _ref, _tmp, _tmp$1, _tuple, first, flags, i, i$1, i$2, i$3, ifirst, iflags, istr, j, j$1, j$2, j$3, max, out, p, prefix, prefix$1, re, re$1, reuse, same, start, str, strflags, sub, suffix, suffix$1, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; first = $f.first; flags = $f.flags; i = $f.i; i$1 = $f.i$1; i$2 = $f.i$2; i$3 = $f.i$3; ifirst = $f.ifirst; iflags = $f.iflags; istr = $f.istr; j = $f.j; j$1 = $f.j$1; j$2 = $f.j$2; j$3 = $f.j$3; max = $f.max; out = $f.out; p = $f.p; prefix = $f.prefix; prefix$1 = $f.prefix$1; re = $f.re; re$1 = $f.re$1; reuse = $f.reuse; same = $f.same; start = $f.start; str = $f.str; strflags = $f.strflags; sub = $f.sub; suffix = $f.suffix; suffix$1 = $f.suffix$1; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		if (sub.$length < 2) {
			return sub;
		}
		str = sliceType.nil;
		strflags = 0;
		start = 0;
		out = $subslice(sub, 0, 0);
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i <= sub.$length)) { break; } */ if(!(i <= sub.$length)) { $s = 2; continue; }
			istr = sliceType.nil;
			iflags = 0;
			/* */ if (i < sub.$length) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (i < sub.$length) { */ case 3:
				_tuple = p.leadingString(((i < 0 || i >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + i]));
				istr = _tuple[0];
				iflags = _tuple[1];
				if (iflags === strflags) {
					same = 0;
					while (true) {
						if (!(same < str.$length && same < istr.$length && (((same < 0 || same >= str.$length) ? $throwRuntimeError("index out of range") : str.$array[str.$offset + same]) === ((same < 0 || same >= istr.$length) ? $throwRuntimeError("index out of range") : istr.$array[istr.$offset + same])))) { break; }
						same = same + (1) >> 0;
					}
					if (same > 0) {
						str = $subslice(str, 0, same);
						i = i + (1) >> 0;
						/* continue; */ $s = 1; continue;
					}
				}
			/* } */ case 4:
			/* */ if (i === start) { $s = 5; continue; }
			/* */ if (i === (start + 1 >> 0)) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (i === start) { */ case 5:
				$s = 8; continue;
			/* } else if (i === (start + 1 >> 0)) { */ case 6:
				out = $append(out, ((start < 0 || start >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + start]));
				$s = 8; continue;
			/* } else { */ case 7:
				prefix = p.newRegexp(3);
				prefix.Flags = strflags;
				prefix.Rune = $appendSlice($subslice(prefix.Rune, 0, 0), str);
				j = start;
				while (true) {
					if (!(j < i)) { break; }
					((j < 0 || j >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + j] = p.removeLeadingString(((j < 0 || j >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + j]), str.$length));
					j = j + (1) >> 0;
				}
				_r = p.collapse($subslice(sub, start, i), 19); /* */ $s = 9; case 9: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				suffix = _r;
				re = p.newRegexp(18);
				re.Sub = $append($subslice(re.Sub, 0, 0), prefix, suffix);
				out = $append(out, re);
			/* } */ case 8:
			start = i;
			str = istr;
			strflags = iflags;
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		sub = out;
		start = 0;
		out = $subslice(sub, 0, 0);
		first = ptrType$1.nil;
		i$1 = 0;
		/* while (true) { */ case 10:
			/* if (!(i$1 <= sub.$length)) { break; } */ if(!(i$1 <= sub.$length)) { $s = 11; continue; }
			ifirst = ptrType$1.nil;
			/* */ if (i$1 < sub.$length) { $s = 12; continue; }
			/* */ $s = 13; continue;
			/* if (i$1 < sub.$length) { */ case 12:
				ifirst = p.leadingRegexp(((i$1 < 0 || i$1 >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + i$1]));
				if (!(first === ptrType$1.nil) && first.Equal(ifirst) && (isCharClass(first) || ((first.Op === 17) && (first.Min === first.Max) && isCharClass((x = first.Sub, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])))))) {
					i$1 = i$1 + (1) >> 0;
					/* continue; */ $s = 10; continue;
				}
			/* } */ case 13:
			/* */ if (i$1 === start) { $s = 14; continue; }
			/* */ if (i$1 === (start + 1 >> 0)) { $s = 15; continue; }
			/* */ $s = 16; continue;
			/* if (i$1 === start) { */ case 14:
				$s = 17; continue;
			/* } else if (i$1 === (start + 1 >> 0)) { */ case 15:
				out = $append(out, ((start < 0 || start >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + start]));
				$s = 17; continue;
			/* } else { */ case 16:
				prefix$1 = first;
				j$1 = start;
				while (true) {
					if (!(j$1 < i$1)) { break; }
					reuse = !((j$1 === start));
					((j$1 < 0 || j$1 >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + j$1] = p.removeLeadingRegexp(((j$1 < 0 || j$1 >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + j$1]), reuse));
					j$1 = j$1 + (1) >> 0;
				}
				_r$1 = p.collapse($subslice(sub, start, i$1), 19); /* */ $s = 18; case 18: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				suffix$1 = _r$1;
				re$1 = p.newRegexp(18);
				re$1.Sub = $append($subslice(re$1.Sub, 0, 0), prefix$1, suffix$1);
				out = $append(out, re$1);
			/* } */ case 17:
			start = i$1;
			first = ifirst;
			i$1 = i$1 + (1) >> 0;
		/* } */ $s = 10; continue; case 11:
		sub = out;
		start = 0;
		out = $subslice(sub, 0, 0);
		i$2 = 0;
		/* while (true) { */ case 19:
			/* if (!(i$2 <= sub.$length)) { break; } */ if(!(i$2 <= sub.$length)) { $s = 20; continue; }
			/* */ if (i$2 < sub.$length && isCharClass(((i$2 < 0 || i$2 >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + i$2]))) { $s = 21; continue; }
			/* */ $s = 22; continue;
			/* if (i$2 < sub.$length && isCharClass(((i$2 < 0 || i$2 >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + i$2]))) { */ case 21:
				i$2 = i$2 + (1) >> 0;
				/* continue; */ $s = 19; continue;
			/* } */ case 22:
			/* */ if (i$2 === start) { $s = 23; continue; }
			/* */ if (i$2 === (start + 1 >> 0)) { $s = 24; continue; }
			/* */ $s = 25; continue;
			/* if (i$2 === start) { */ case 23:
				$s = 26; continue;
			/* } else if (i$2 === (start + 1 >> 0)) { */ case 24:
				out = $append(out, ((start < 0 || start >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + start]));
				$s = 26; continue;
			/* } else { */ case 25:
				max = start;
				j$2 = start + 1 >> 0;
				while (true) {
					if (!(j$2 < i$2)) { break; }
					if (((max < 0 || max >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + max]).Op < ((j$2 < 0 || j$2 >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + j$2]).Op || (((max < 0 || max >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + max]).Op === ((j$2 < 0 || j$2 >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + j$2]).Op) && ((max < 0 || max >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + max]).Rune.$length < ((j$2 < 0 || j$2 >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + j$2]).Rune.$length) {
						max = j$2;
					}
					j$2 = j$2 + (1) >> 0;
				}
				_tmp = ((max < 0 || max >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + max]);
				_tmp$1 = ((start < 0 || start >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + start]);
				((start < 0 || start >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + start] = _tmp);
				((max < 0 || max >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + max] = _tmp$1);
				j$3 = start + 1 >> 0;
				while (true) {
					if (!(j$3 < i$2)) { break; }
					mergeCharClass(((start < 0 || start >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + start]), ((j$3 < 0 || j$3 >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + j$3]));
					p.reuse(((j$3 < 0 || j$3 >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + j$3]));
					j$3 = j$3 + (1) >> 0;
				}
				$r = cleanAlt(((start < 0 || start >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + start])); /* */ $s = 27; case 27: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				out = $append(out, ((start < 0 || start >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + start]));
			/* } */ case 26:
			if (i$2 < sub.$length) {
				out = $append(out, ((i$2 < 0 || i$2 >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + i$2]));
			}
			start = i$2 + 1 >> 0;
			i$2 = i$2 + (1) >> 0;
		/* } */ $s = 19; continue; case 20:
		sub = out;
		start = 0;
		out = $subslice(sub, 0, 0);
		_ref = sub;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i$3 = _i;
			if ((i$3 + 1 >> 0) < sub.$length && (((i$3 < 0 || i$3 >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + i$3]).Op === 2) && ((x$1 = i$3 + 1 >> 0, ((x$1 < 0 || x$1 >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + x$1])).Op === 2)) {
				_i++;
				continue;
			}
			out = $append(out, ((i$3 < 0 || i$3 >= sub.$length) ? $throwRuntimeError("index out of range") : sub.$array[sub.$offset + i$3]));
			_i++;
		}
		sub = out;
		return sub;
		/* */ } return; } if ($f === undefined) { $f = { $blk: parser.ptr.prototype.factor }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f.first = first; $f.flags = flags; $f.i = i; $f.i$1 = i$1; $f.i$2 = i$2; $f.i$3 = i$3; $f.ifirst = ifirst; $f.iflags = iflags; $f.istr = istr; $f.j = j; $f.j$1 = j$1; $f.j$2 = j$2; $f.j$3 = j$3; $f.max = max; $f.out = out; $f.p = p; $f.prefix = prefix; $f.prefix$1 = prefix$1; $f.re = re; $f.re$1 = re$1; $f.reuse = reuse; $f.same = same; $f.start = start; $f.str = str; $f.strflags = strflags; $f.sub = sub; $f.suffix = suffix; $f.suffix$1 = suffix$1; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	parser.prototype.factor = function(sub, flags) { return this.$val.factor(sub, flags); };
	parser.ptr.prototype.leadingString = function(re) {
		var $ptr, p, re, x;
		p = this;
		if ((re.Op === 18) && re.Sub.$length > 0) {
			re = (x = re.Sub, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0]));
		}
		if (!((re.Op === 3))) {
			return [sliceType.nil, 0];
		}
		return [re.Rune, (re.Flags & 1) >>> 0];
	};
	parser.prototype.leadingString = function(re) { return this.$val.leadingString(re); };
	parser.ptr.prototype.removeLeadingString = function(re, n) {
		var $ptr, _1, n, old, p, re, sub, x, x$1, x$2;
		p = this;
		if ((re.Op === 18) && re.Sub.$length > 0) {
			sub = (x = re.Sub, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0]));
			sub = p.removeLeadingString(sub, n);
			(x$1 = re.Sub, (0 >= x$1.$length ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + 0] = sub));
			if (sub.Op === 2) {
				p.reuse(sub);
				_1 = re.Sub.$length;
				if ((_1 === (0)) || (_1 === (1))) {
					re.Op = 2;
					re.Sub = sliceType$5.nil;
				} else if (_1 === (2)) {
					old = re;
					re = (x$2 = re.Sub, (1 >= x$2.$length ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + 1]));
					p.reuse(old);
				} else {
					$copySlice(re.Sub, $subslice(re.Sub, 1));
					re.Sub = $subslice(re.Sub, 0, (re.Sub.$length - 1 >> 0));
				}
			}
			return re;
		}
		if (re.Op === 3) {
			re.Rune = $subslice(re.Rune, 0, $copySlice(re.Rune, $subslice(re.Rune, n)));
			if (re.Rune.$length === 0) {
				re.Op = 2;
			}
		}
		return re;
	};
	parser.prototype.removeLeadingString = function(re, n) { return this.$val.removeLeadingString(re, n); };
	parser.ptr.prototype.leadingRegexp = function(re) {
		var $ptr, p, re, sub, x;
		p = this;
		if (re.Op === 2) {
			return ptrType$1.nil;
		}
		if ((re.Op === 18) && re.Sub.$length > 0) {
			sub = (x = re.Sub, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0]));
			if (sub.Op === 2) {
				return ptrType$1.nil;
			}
			return sub;
		}
		return re;
	};
	parser.prototype.leadingRegexp = function(re) { return this.$val.leadingRegexp(re); };
	parser.ptr.prototype.removeLeadingRegexp = function(re, reuse) {
		var $ptr, _1, old, p, re, reuse, x, x$1;
		p = this;
		if ((re.Op === 18) && re.Sub.$length > 0) {
			if (reuse) {
				p.reuse((x = re.Sub, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])));
			}
			re.Sub = $subslice(re.Sub, 0, $copySlice(re.Sub, $subslice(re.Sub, 1)));
			_1 = re.Sub.$length;
			if (_1 === (0)) {
				re.Op = 2;
				re.Sub = sliceType$5.nil;
			} else if (_1 === (1)) {
				old = re;
				re = (x$1 = re.Sub, (0 >= x$1.$length ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + 0]));
				p.reuse(old);
			}
			return re;
		}
		if (reuse) {
			p.reuse(re);
		}
		return p.newRegexp(2);
	};
	parser.prototype.removeLeadingRegexp = function(re, reuse) { return this.$val.removeLeadingRegexp(re, reuse); };
	literalRegexp = function(s, flags) {
		var $ptr, _i, _ref, _rune, c, flags, re, s;
		re = new Regexp.ptr(3, 0, sliceType$5.nil, arrayType.zero(), sliceType.nil, arrayType$1.zero(), 0, 0, 0, "");
		re.Flags = flags;
		re.Rune = $subslice(new sliceType(re.Rune0), 0, 0);
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.length)) { break; }
			_rune = $decodeRune(_ref, _i);
			c = _rune[0];
			if (re.Rune.$length >= re.Rune.$capacity) {
				re.Rune = new sliceType($stringToRunes(s));
				break;
			}
			re.Rune = $append(re.Rune, c);
			_i += _rune[1];
		}
		return re;
	};
	Parse = function(s, flags) {
		var $ptr, _1, _2, _3, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _struct, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, _tuple$9, after, after$1, before, before$1, c, c$1, err, err$1, err$2, err$3, flags, i, lastRepeat, lit, max, min, n, ok, op, p, r, r$1, re, repeat, rest, rest$1, rest$2, s, t, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _2 = $f._2; _3 = $f._3; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _struct = $f._struct; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; _tuple$8 = $f._tuple$8; _tuple$9 = $f._tuple$9; after = $f.after; after$1 = $f.after$1; before = $f.before; before$1 = $f.before$1; c = $f.c; c$1 = $f.c$1; err = $f.err; err$1 = $f.err$1; err$2 = $f.err$2; err$3 = $f.err$3; flags = $f.flags; i = $f.i; lastRepeat = $f.lastRepeat; lit = $f.lit; max = $f.max; min = $f.min; n = $f.n; ok = $f.ok; op = $f.op; p = $f.p; r = $f.r; r$1 = $f.r$1; re = $f.re; repeat = $f.repeat; rest = $f.rest; rest$1 = $f.rest$1; rest$2 = $f.rest$2; s = $f.s; t = $f.t; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (!((((flags & 2) >>> 0) === 0))) {
			err = checkUTF8(s);
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				return [ptrType$1.nil, err];
			}
			return [literalRegexp(s, flags), $ifaceNil];
		}
		p = new parser.ptr(0, sliceType$5.nil, ptrType$1.nil, 0, "", sliceType.nil);
		err$1 = $ifaceNil;
		c = 0;
		op = 0;
		lastRepeat = "";
		p.flags = flags;
		p.wholeRegexp = s;
		t = s;
		/* while (true) { */ case 1:
			/* if (!(!(t === ""))) { break; } */ if(!(!(t === ""))) { $s = 2; continue; }
			repeat = "";
				_1 = t.charCodeAt(0);
				/* */ if (_1 === (40)) { $s = 4; continue; }
				/* */ if (_1 === (124)) { $s = 5; continue; }
				/* */ if (_1 === (41)) { $s = 6; continue; }
				/* */ if (_1 === (94)) { $s = 7; continue; }
				/* */ if (_1 === (36)) { $s = 8; continue; }
				/* */ if (_1 === (46)) { $s = 9; continue; }
				/* */ if (_1 === (91)) { $s = 10; continue; }
				/* */ if ((_1 === (42)) || (_1 === (43)) || (_1 === (63))) { $s = 11; continue; }
				/* */ if (_1 === (123)) { $s = 12; continue; }
				/* */ if (_1 === (92)) { $s = 13; continue; }
				/* */ $s = 14; continue;
				/* if (_1 === (40)) { */ case 4:
					if (!((((p.flags & 64) >>> 0) === 0)) && t.length >= 2 && (t.charCodeAt(1) === 63)) {
						_tuple = p.parsePerlFlags(t);
						t = _tuple[0];
						err$1 = _tuple[1];
						if (!($interfaceIsEqual(err$1, $ifaceNil))) {
							return [ptrType$1.nil, err$1];
						}
						/* break; */ $s = 3; continue;
					}
					p.numCap = p.numCap + (1) >> 0;
					p.op(128).Cap = p.numCap;
					t = t.substring(1);
					$s = 15; continue;
				/* } else if (_1 === (124)) { */ case 5:
					_r = p.parseVerticalBar(); /* */ $s = 16; case 16: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					err$1 = _r;
					if (!($interfaceIsEqual(err$1, $ifaceNil))) {
						return [ptrType$1.nil, err$1];
					}
					t = t.substring(1);
					$s = 15; continue;
				/* } else if (_1 === (41)) { */ case 6:
					_r$1 = p.parseRightParen(); /* */ $s = 17; case 17: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					err$1 = _r$1;
					if (!($interfaceIsEqual(err$1, $ifaceNil))) {
						return [ptrType$1.nil, err$1];
					}
					t = t.substring(1);
					$s = 15; continue;
				/* } else if (_1 === (94)) { */ case 7:
					if (!((((p.flags & 16) >>> 0) === 0))) {
						p.op(9);
					} else {
						p.op(7);
					}
					t = t.substring(1);
					$s = 15; continue;
				/* } else if (_1 === (36)) { */ case 8:
					if (!((((p.flags & 16) >>> 0) === 0))) {
						_struct = p.op(10);
						_struct.Flags = (_struct.Flags | (256)) >>> 0;
					} else {
						p.op(8);
					}
					t = t.substring(1);
					$s = 15; continue;
				/* } else if (_1 === (46)) { */ case 9:
					if (!((((p.flags & 8) >>> 0) === 0))) {
						p.op(6);
					} else {
						p.op(5);
					}
					t = t.substring(1);
					$s = 15; continue;
				/* } else if (_1 === (91)) { */ case 10:
					_r$2 = p.parseClass(t); /* */ $s = 18; case 18: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					_tuple$1 = _r$2;
					t = _tuple$1[0];
					err$1 = _tuple$1[1];
					if (!($interfaceIsEqual(err$1, $ifaceNil))) {
						return [ptrType$1.nil, err$1];
					}
					$s = 15; continue;
				/* } else if ((_1 === (42)) || (_1 === (43)) || (_1 === (63))) { */ case 11:
					before = t;
					_2 = t.charCodeAt(0);
					if (_2 === (42)) {
						op = 14;
					} else if (_2 === (43)) {
						op = 15;
					} else if (_2 === (63)) {
						op = 16;
					}
					after = t.substring(1);
					_tuple$2 = p.repeat(op, 0, 0, before, after, lastRepeat);
					after = _tuple$2[0];
					err$1 = _tuple$2[1];
					if (!($interfaceIsEqual(err$1, $ifaceNil))) {
						return [ptrType$1.nil, err$1];
					}
					repeat = before;
					t = after;
					$s = 15; continue;
				/* } else if (_1 === (123)) { */ case 12:
					op = 17;
					before$1 = t;
					_tuple$3 = p.parseRepeat(t);
					min = _tuple$3[0];
					max = _tuple$3[1];
					after$1 = _tuple$3[2];
					ok = _tuple$3[3];
					if (!ok) {
						p.literal(123);
						t = t.substring(1);
						/* break; */ $s = 3; continue;
					}
					if (min < 0 || min > 1000 || max > 1000 || max >= 0 && min > max) {
						return [ptrType$1.nil, new Error.ptr("invalid repeat count", before$1.substring(0, (before$1.length - after$1.length >> 0)))];
					}
					_tuple$4 = p.repeat(op, min, max, before$1, after$1, lastRepeat);
					after$1 = _tuple$4[0];
					err$1 = _tuple$4[1];
					if (!($interfaceIsEqual(err$1, $ifaceNil))) {
						return [ptrType$1.nil, err$1];
					}
					repeat = before$1;
					t = after$1;
					$s = 15; continue;
				/* } else if (_1 === (92)) { */ case 13:
					if (!((((p.flags & 64) >>> 0) === 0)) && t.length >= 2) {
						_3 = t.charCodeAt(1);
						if (_3 === (65)) {
							p.op(9);
							t = t.substring(2);
							/* break BigSwitch; */ $s = 3; continue s;
						} else if (_3 === (98)) {
							p.op(11);
							t = t.substring(2);
							/* break BigSwitch; */ $s = 3; continue s;
						} else if (_3 === (66)) {
							p.op(12);
							t = t.substring(2);
							/* break BigSwitch; */ $s = 3; continue s;
						} else if (_3 === (67)) {
							return [ptrType$1.nil, new Error.ptr("invalid escape sequence", t.substring(0, 2))];
						} else if (_3 === (81)) {
							lit = "";
							i = strings.Index(t, "\\E");
							if (i < 0) {
								lit = t.substring(2);
								t = "";
							} else {
								lit = t.substring(2, i);
								t = t.substring((i + 2 >> 0));
							}
							while (true) {
								if (!(!(lit === ""))) { break; }
								_tuple$5 = nextRune(lit);
								c$1 = _tuple$5[0];
								rest = _tuple$5[1];
								err$2 = _tuple$5[2];
								if (!($interfaceIsEqual(err$2, $ifaceNil))) {
									return [ptrType$1.nil, err$2];
								}
								p.literal(c$1);
								lit = rest;
							}
							/* break BigSwitch; */ $s = 3; continue s;
						} else if (_3 === (122)) {
							p.op(10);
							t = t.substring(2);
							/* break BigSwitch; */ $s = 3; continue s;
						}
					}
					re = p.newRegexp(4);
					re.Flags = p.flags;
					/* */ if (t.length >= 2 && ((t.charCodeAt(1) === 112) || (t.charCodeAt(1) === 80))) { $s = 19; continue; }
					/* */ $s = 20; continue;
					/* if (t.length >= 2 && ((t.charCodeAt(1) === 112) || (t.charCodeAt(1) === 80))) { */ case 19:
						_r$3 = p.parseUnicodeClass(t, $subslice(new sliceType(re.Rune0), 0, 0)); /* */ $s = 21; case 21: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
						_tuple$6 = _r$3;
						r = _tuple$6[0];
						rest$1 = _tuple$6[1];
						err$3 = _tuple$6[2];
						if (!($interfaceIsEqual(err$3, $ifaceNil))) {
							return [ptrType$1.nil, err$3];
						}
						if (!(r === sliceType.nil)) {
							re.Rune = r;
							t = rest$1;
							p.push(re);
							/* break BigSwitch; */ $s = 3; continue s;
						}
					/* } */ case 20:
					_r$4 = p.parsePerlClassEscape(t, $subslice(new sliceType(re.Rune0), 0, 0)); /* */ $s = 22; case 22: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					_tuple$7 = _r$4;
					r$1 = _tuple$7[0];
					rest$2 = _tuple$7[1];
					if (!(r$1 === sliceType.nil)) {
						re.Rune = r$1;
						t = rest$2;
						p.push(re);
						/* break BigSwitch; */ $s = 3; continue s;
					}
					p.reuse(re);
					_tuple$8 = p.parseEscape(t);
					c = _tuple$8[0];
					t = _tuple$8[1];
					err$1 = _tuple$8[2];
					if (!($interfaceIsEqual(err$1, $ifaceNil))) {
						return [ptrType$1.nil, err$1];
					}
					p.literal(c);
					$s = 15; continue;
				/* } else { */ case 14:
					_tuple$9 = nextRune(t);
					c = _tuple$9[0];
					t = _tuple$9[1];
					err$1 = _tuple$9[2];
					if (!($interfaceIsEqual(err$1, $ifaceNil))) {
						return [ptrType$1.nil, err$1];
					}
					p.literal(c);
				/* } */ case 15:
			case 3:
			lastRepeat = repeat;
		/* } */ $s = 1; continue; case 2:
		_r$5 = p.concat(); /* */ $s = 23; case 23: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
		_r$5;
		_r$6 = p.swapVerticalBar(); /* */ $s = 26; case 26: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		/* */ if (_r$6) { $s = 24; continue; }
		/* */ $s = 25; continue;
		/* if (_r$6) { */ case 24:
			p.stack = $subslice(p.stack, 0, (p.stack.$length - 1 >> 0));
		/* } */ case 25:
		_r$7 = p.alternate(); /* */ $s = 27; case 27: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
		_r$7;
		n = p.stack.$length;
		if (!((n === 1))) {
			return [ptrType$1.nil, new Error.ptr("missing closing )", s)];
		}
		return [(x = p.stack, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])), $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Parse }; } $f.$ptr = $ptr; $f._1 = _1; $f._2 = _2; $f._3 = _3; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._struct = _struct; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f._tuple$8 = _tuple$8; $f._tuple$9 = _tuple$9; $f.after = after; $f.after$1 = after$1; $f.before = before; $f.before$1 = before$1; $f.c = c; $f.c$1 = c$1; $f.err = err; $f.err$1 = err$1; $f.err$2 = err$2; $f.err$3 = err$3; $f.flags = flags; $f.i = i; $f.lastRepeat = lastRepeat; $f.lit = lit; $f.max = max; $f.min = min; $f.n = n; $f.ok = ok; $f.op = op; $f.p = p; $f.r = r; $f.r$1 = r$1; $f.re = re; $f.repeat = repeat; $f.rest = rest; $f.rest$1 = rest$1; $f.rest$2 = rest$2; $f.s = s; $f.t = t; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Parse = Parse;
	parser.ptr.prototype.parseRepeat = function(s) {
		var $ptr, _tuple, _tuple$1, max, min, ok, ok1, p, rest, s;
		min = 0;
		max = 0;
		rest = "";
		ok = false;
		p = this;
		if (s === "" || !((s.charCodeAt(0) === 123))) {
			return [min, max, rest, ok];
		}
		s = s.substring(1);
		ok1 = false;
		_tuple = p.parseInt(s);
		min = _tuple[0];
		s = _tuple[1];
		ok1 = _tuple[2];
		if (!ok1) {
			return [min, max, rest, ok];
		}
		if (s === "") {
			return [min, max, rest, ok];
		}
		if (!((s.charCodeAt(0) === 44))) {
			max = min;
		} else {
			s = s.substring(1);
			if (s === "") {
				return [min, max, rest, ok];
			}
			if (s.charCodeAt(0) === 125) {
				max = -1;
			} else {
				_tuple$1 = p.parseInt(s);
				max = _tuple$1[0];
				s = _tuple$1[1];
				ok1 = _tuple$1[2];
				if (!ok1) {
					return [min, max, rest, ok];
				} else if (max < 0) {
					min = -1;
				}
			}
		}
		if (s === "" || !((s.charCodeAt(0) === 125))) {
			return [min, max, rest, ok];
		}
		rest = s.substring(1);
		ok = true;
		return [min, max, rest, ok];
	};
	parser.prototype.parseRepeat = function(s) { return this.$val.parseRepeat(s); };
	parser.ptr.prototype.parsePerlFlags = function(s) {
		var $ptr, _1, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, c, capture, end, err, flags, name, p, re, rest, s, sawFlag, sign, t;
		rest = "";
		err = $ifaceNil;
		p = this;
		t = s;
		if (t.length > 4 && (t.charCodeAt(2) === 80) && (t.charCodeAt(3) === 60)) {
			end = strings.IndexRune(t, 62);
			if (end < 0) {
				err = checkUTF8(t);
				if (!($interfaceIsEqual(err, $ifaceNil))) {
					_tmp = "";
					_tmp$1 = err;
					rest = _tmp;
					err = _tmp$1;
					return [rest, err];
				}
				_tmp$2 = "";
				_tmp$3 = new Error.ptr("invalid named capture", s);
				rest = _tmp$2;
				err = _tmp$3;
				return [rest, err];
			}
			capture = t.substring(0, (end + 1 >> 0));
			name = t.substring(4, end);
			err = checkUTF8(name);
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				_tmp$4 = "";
				_tmp$5 = err;
				rest = _tmp$4;
				err = _tmp$5;
				return [rest, err];
			}
			if (!isValidCaptureName(name)) {
				_tmp$6 = "";
				_tmp$7 = new Error.ptr("invalid named capture", capture);
				rest = _tmp$6;
				err = _tmp$7;
				return [rest, err];
			}
			p.numCap = p.numCap + (1) >> 0;
			re = p.op(128);
			re.Cap = p.numCap;
			re.Name = name;
			_tmp$8 = t.substring((end + 1 >> 0));
			_tmp$9 = $ifaceNil;
			rest = _tmp$8;
			err = _tmp$9;
			return [rest, err];
		}
		c = 0;
		t = t.substring(2);
		flags = p.flags;
		sign = 1;
		sawFlag = false;
		Loop:
		while (true) {
			if (!(!(t === ""))) { break; }
			_tuple = nextRune(t);
			c = _tuple[0];
			t = _tuple[1];
			err = _tuple[2];
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				_tmp$10 = "";
				_tmp$11 = err;
				rest = _tmp$10;
				err = _tmp$11;
				return [rest, err];
			}
			_1 = c;
			if (_1 === (105)) {
				flags = (flags | (1)) >>> 0;
				sawFlag = true;
			} else if (_1 === (109)) {
				flags = (flags & ~(16)) << 16 >>> 16;
				sawFlag = true;
			} else if (_1 === (115)) {
				flags = (flags | (8)) >>> 0;
				sawFlag = true;
			} else if (_1 === (85)) {
				flags = (flags | (32)) >>> 0;
				sawFlag = true;
			} else if (_1 === (45)) {
				if (sign < 0) {
					break Loop;
				}
				sign = -1;
				flags = ~flags << 16 >>> 16;
				sawFlag = false;
			} else if ((_1 === (58)) || (_1 === (41))) {
				if (sign < 0) {
					if (!sawFlag) {
						break Loop;
					}
					flags = ~flags << 16 >>> 16;
				}
				if (c === 58) {
					p.op(128);
				}
				p.flags = flags;
				_tmp$12 = t;
				_tmp$13 = $ifaceNil;
				rest = _tmp$12;
				err = _tmp$13;
				return [rest, err];
			} else {
				break Loop;
			}
		}
		_tmp$14 = "";
		_tmp$15 = new Error.ptr("invalid or unsupported Perl syntax", s.substring(0, (s.length - t.length >> 0)));
		rest = _tmp$14;
		err = _tmp$15;
		return [rest, err];
	};
	parser.prototype.parsePerlFlags = function(s) { return this.$val.parsePerlFlags(s); };
	isValidCaptureName = function(name) {
		var $ptr, _i, _ref, _rune, c, name;
		if (name === "") {
			return false;
		}
		_ref = name;
		_i = 0;
		while (true) {
			if (!(_i < _ref.length)) { break; }
			_rune = $decodeRune(_ref, _i);
			c = _rune[0];
			if (!((c === 95)) && !isalnum(c)) {
				return false;
			}
			_i += _rune[1];
		}
		return true;
	};
	parser.ptr.prototype.parseInt = function(s) {
		var $ptr, i, n, ok, p, rest, s, t;
		n = 0;
		rest = "";
		ok = false;
		p = this;
		if (s === "" || s.charCodeAt(0) < 48 || 57 < s.charCodeAt(0)) {
			return [n, rest, ok];
		}
		if (s.length >= 2 && (s.charCodeAt(0) === 48) && 48 <= s.charCodeAt(1) && s.charCodeAt(1) <= 57) {
			return [n, rest, ok];
		}
		t = s;
		while (true) {
			if (!(!(s === "") && 48 <= s.charCodeAt(0) && s.charCodeAt(0) <= 57)) { break; }
			s = s.substring(1);
		}
		rest = s;
		ok = true;
		t = t.substring(0, (t.length - s.length >> 0));
		i = 0;
		while (true) {
			if (!(i < t.length)) { break; }
			if (n >= 100000000) {
				n = -1;
				break;
			}
			n = (($imul(n, 10)) + (t.charCodeAt(i) >> 0) >> 0) - 48 >> 0;
			i = i + (1) >> 0;
		}
		return [n, rest, ok];
	};
	parser.prototype.parseInt = function(s) { return this.$val.parseInt(s); };
	isCharClass = function(re) {
		var $ptr, re;
		return (re.Op === 3) && (re.Rune.$length === 1) || (re.Op === 4) || (re.Op === 5) || (re.Op === 6);
	};
	matchRune = function(re, r) {
		var $ptr, _1, i, r, re, x, x$1, x$2, x$3;
		_1 = re.Op;
		if (_1 === (3)) {
			return (re.Rune.$length === 1) && ((x = re.Rune, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])) === r);
		} else if (_1 === (4)) {
			i = 0;
			while (true) {
				if (!(i < re.Rune.$length)) { break; }
				if ((x$1 = re.Rune, ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i])) <= r && r <= (x$2 = re.Rune, x$3 = i + 1 >> 0, ((x$3 < 0 || x$3 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + x$3]))) {
					return true;
				}
				i = i + (2) >> 0;
			}
			return false;
		} else if (_1 === (5)) {
			return !((r === 10));
		} else if (_1 === (6)) {
			return true;
		}
		return false;
	};
	parser.ptr.prototype.parseVerticalBar = function() {
		var $ptr, _r, _r$1, p, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; p = $f.p; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		_r = p.concat(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r;
		_r$1 = p.swapVerticalBar(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ if (!_r$1) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!_r$1) { */ case 2:
			p.op(129);
		/* } */ case 3:
		return $ifaceNil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: parser.ptr.prototype.parseVerticalBar }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.p = p; $f.$s = $s; $f.$r = $r; return $f;
	};
	parser.prototype.parseVerticalBar = function() { return this.$val.parseVerticalBar(); };
	mergeCharClass = function(dst, src) {
		var $ptr, _1, dst, src, x, x$1, x$2, x$3, x$4;
		switch (0) { default:
			_1 = dst.Op;
			if (_1 === (6)) {
			} else if (_1 === (5)) {
				if (matchRune(src, 10)) {
					dst.Op = 6;
				}
			} else if (_1 === (4)) {
				if (src.Op === 3) {
					dst.Rune = appendLiteral(dst.Rune, (x = src.Rune, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])), src.Flags);
				} else {
					dst.Rune = appendClass(dst.Rune, src.Rune);
				}
			} else if (_1 === (3)) {
				if (((x$1 = src.Rune, (0 >= x$1.$length ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + 0])) === (x$2 = dst.Rune, (0 >= x$2.$length ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + 0]))) && (src.Flags === dst.Flags)) {
					break;
				}
				dst.Op = 4;
				dst.Rune = appendLiteral($subslice(dst.Rune, 0, 0), (x$3 = dst.Rune, (0 >= x$3.$length ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 0])), dst.Flags);
				dst.Rune = appendLiteral(dst.Rune, (x$4 = src.Rune, (0 >= x$4.$length ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + 0])), src.Flags);
			}
		}
	};
	parser.ptr.prototype.swapVerticalBar = function() {
		var $ptr, _tmp, _tmp$1, n, p, re1, re1$1, re2, re3, x, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$16, x$17, x$18, x$19, x$2, x$20, x$21, x$3, x$4, x$5, x$6, x$7, x$8, x$9, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; n = $f.n; p = $f.p; re1 = $f.re1; re1$1 = $f.re1$1; re2 = $f.re2; re3 = $f.re3; x = $f.x; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$13 = $f.x$13; x$14 = $f.x$14; x$15 = $f.x$15; x$16 = $f.x$16; x$17 = $f.x$17; x$18 = $f.x$18; x$19 = $f.x$19; x$2 = $f.x$2; x$20 = $f.x$20; x$21 = $f.x$21; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		n = p.stack.$length;
		if (n >= 3 && ((x = p.stack, x$1 = n - 2 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])).Op === 129) && isCharClass((x$2 = p.stack, x$3 = n - 1 >> 0, ((x$3 < 0 || x$3 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + x$3]))) && isCharClass((x$4 = p.stack, x$5 = n - 3 >> 0, ((x$5 < 0 || x$5 >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + x$5])))) {
			re1 = (x$6 = p.stack, x$7 = n - 1 >> 0, ((x$7 < 0 || x$7 >= x$6.$length) ? $throwRuntimeError("index out of range") : x$6.$array[x$6.$offset + x$7]));
			re3 = (x$8 = p.stack, x$9 = n - 3 >> 0, ((x$9 < 0 || x$9 >= x$8.$length) ? $throwRuntimeError("index out of range") : x$8.$array[x$8.$offset + x$9]));
			if (re1.Op > re3.Op) {
				_tmp = re3;
				_tmp$1 = re1;
				re1 = _tmp;
				re3 = _tmp$1;
				(x$10 = p.stack, x$11 = n - 3 >> 0, ((x$11 < 0 || x$11 >= x$10.$length) ? $throwRuntimeError("index out of range") : x$10.$array[x$10.$offset + x$11] = re3));
			}
			mergeCharClass(re3, re1);
			p.reuse(re1);
			p.stack = $subslice(p.stack, 0, (n - 1 >> 0));
			return true;
		}
		/* */ if (n >= 2) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (n >= 2) { */ case 1:
			re1$1 = (x$12 = p.stack, x$13 = n - 1 >> 0, ((x$13 < 0 || x$13 >= x$12.$length) ? $throwRuntimeError("index out of range") : x$12.$array[x$12.$offset + x$13]));
			re2 = (x$14 = p.stack, x$15 = n - 2 >> 0, ((x$15 < 0 || x$15 >= x$14.$length) ? $throwRuntimeError("index out of range") : x$14.$array[x$14.$offset + x$15]));
			/* */ if (re2.Op === 129) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (re2.Op === 129) { */ case 3:
				/* */ if (n >= 3) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (n >= 3) { */ case 5:
					$r = cleanAlt((x$16 = p.stack, x$17 = n - 3 >> 0, ((x$17 < 0 || x$17 >= x$16.$length) ? $throwRuntimeError("index out of range") : x$16.$array[x$16.$offset + x$17]))); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 6:
				(x$18 = p.stack, x$19 = n - 2 >> 0, ((x$19 < 0 || x$19 >= x$18.$length) ? $throwRuntimeError("index out of range") : x$18.$array[x$18.$offset + x$19] = re1$1));
				(x$20 = p.stack, x$21 = n - 1 >> 0, ((x$21 < 0 || x$21 >= x$20.$length) ? $throwRuntimeError("index out of range") : x$20.$array[x$20.$offset + x$21] = re2));
				return true;
			/* } */ case 4:
		/* } */ case 2:
		return false;
		/* */ } return; } if ($f === undefined) { $f = { $blk: parser.ptr.prototype.swapVerticalBar }; } $f.$ptr = $ptr; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f.n = n; $f.p = p; $f.re1 = re1; $f.re1$1 = re1$1; $f.re2 = re2; $f.re3 = re3; $f.x = x; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$13 = x$13; $f.x$14 = x$14; $f.x$15 = x$15; $f.x$16 = x$16; $f.x$17 = x$17; $f.x$18 = x$18; $f.x$19 = x$19; $f.x$2 = x$2; $f.x$20 = x$20; $f.x$21 = x$21; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.$s = $s; $f.$r = $r; return $f;
	};
	parser.prototype.swapVerticalBar = function() { return this.$val.swapVerticalBar(); };
	parser.ptr.prototype.parseRightParen = function() {
		var $ptr, _r, _r$1, _r$2, n, p, re1, re2, x, x$1, x$2, x$3, x$4, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; n = $f.n; p = $f.p; re1 = $f.re1; re2 = $f.re2; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		_r = p.concat(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r;
		_r$1 = p.swapVerticalBar(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ if (_r$1) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (_r$1) { */ case 2:
			p.stack = $subslice(p.stack, 0, (p.stack.$length - 1 >> 0));
		/* } */ case 3:
		_r$2 = p.alternate(); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_r$2;
		n = p.stack.$length;
		if (n < 2) {
			return new Error.ptr("unexpected )", p.wholeRegexp);
		}
		re1 = (x = p.stack, x$1 = n - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		re2 = (x$2 = p.stack, x$3 = n - 2 >> 0, ((x$3 < 0 || x$3 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + x$3]));
		p.stack = $subslice(p.stack, 0, (n - 2 >> 0));
		if (!((re2.Op === 128))) {
			return new Error.ptr("unexpected )", p.wholeRegexp);
		}
		p.flags = re2.Flags;
		if (re2.Cap === 0) {
			p.push(re1);
		} else {
			re2.Op = 13;
			re2.Sub = $subslice(new sliceType$5(re2.Sub0), 0, 1);
			(x$4 = re2.Sub, (0 >= x$4.$length ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + 0] = re1));
			p.push(re2);
		}
		return $ifaceNil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: parser.ptr.prototype.parseRightParen }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.n = n; $f.p = p; $f.re1 = re1; $f.re2 = re2; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.$s = $s; $f.$r = $r; return $f;
	};
	parser.prototype.parseRightParen = function() { return this.$val.parseRightParen(); };
	parser.ptr.prototype.parseEscape = function(s) {
		var $ptr, _1, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$2, _tmp$20, _tmp$21, _tmp$22, _tmp$23, _tmp$24, _tmp$25, _tmp$26, _tmp$27, _tmp$28, _tmp$29, _tmp$3, _tmp$30, _tmp$31, _tmp$32, _tmp$33, _tmp$34, _tmp$35, _tmp$36, _tmp$37, _tmp$38, _tmp$39, _tmp$4, _tmp$40, _tmp$41, _tmp$42, _tmp$43, _tmp$44, _tmp$45, _tmp$46, _tmp$47, _tmp$48, _tmp$49, _tmp$5, _tmp$50, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, _tuple$1, _tuple$2, _tuple$3, c, err, i, nhex, p, r, rest, s, t, v, x, y;
		r = 0;
		rest = "";
		err = $ifaceNil;
		p = this;
		t = s.substring(1);
		if (t === "") {
			_tmp = 0;
			_tmp$1 = "";
			_tmp$2 = new Error.ptr("trailing backslash at end of expression", "");
			r = _tmp;
			rest = _tmp$1;
			err = _tmp$2;
			return [r, rest, err];
		}
		_tuple = nextRune(t);
		c = _tuple[0];
		t = _tuple[1];
		err = _tuple[2];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			_tmp$3 = 0;
			_tmp$4 = "";
			_tmp$5 = err;
			r = _tmp$3;
			rest = _tmp$4;
			err = _tmp$5;
			return [r, rest, err];
		}
		Switch:
		switch (0) { default:
			_1 = c;
			if ((_1 === (49)) || (_1 === (50)) || (_1 === (51)) || (_1 === (52)) || (_1 === (53)) || (_1 === (54)) || (_1 === (55))) {
				if (t === "" || t.charCodeAt(0) < 48 || t.charCodeAt(0) > 55) {
					break;
				}
				r = c - 48 >> 0;
				i = 1;
				while (true) {
					if (!(i < 3)) { break; }
					if (t === "" || t.charCodeAt(0) < 48 || t.charCodeAt(0) > 55) {
						break;
					}
					r = (($imul(r, 8)) + (t.charCodeAt(0) >> 0) >> 0) - 48 >> 0;
					t = t.substring(1);
					i = i + (1) >> 0;
				}
				_tmp$6 = r;
				_tmp$7 = t;
				_tmp$8 = $ifaceNil;
				r = _tmp$6;
				rest = _tmp$7;
				err = _tmp$8;
				return [r, rest, err];
			} else if (_1 === (48)) {
				r = c - 48 >> 0;
				i = 1;
				while (true) {
					if (!(i < 3)) { break; }
					if (t === "" || t.charCodeAt(0) < 48 || t.charCodeAt(0) > 55) {
						break;
					}
					r = (($imul(r, 8)) + (t.charCodeAt(0) >> 0) >> 0) - 48 >> 0;
					t = t.substring(1);
					i = i + (1) >> 0;
				}
				_tmp$9 = r;
				_tmp$10 = t;
				_tmp$11 = $ifaceNil;
				r = _tmp$9;
				rest = _tmp$10;
				err = _tmp$11;
				return [r, rest, err];
			} else if (_1 === (120)) {
				if (t === "") {
					break;
				}
				_tuple$1 = nextRune(t);
				c = _tuple$1[0];
				t = _tuple$1[1];
				err = _tuple$1[2];
				if (!($interfaceIsEqual(err, $ifaceNil))) {
					_tmp$12 = 0;
					_tmp$13 = "";
					_tmp$14 = err;
					r = _tmp$12;
					rest = _tmp$13;
					err = _tmp$14;
					return [r, rest, err];
				}
				if (c === 123) {
					nhex = 0;
					r = 0;
					while (true) {
						if (t === "") {
							break Switch;
						}
						_tuple$2 = nextRune(t);
						c = _tuple$2[0];
						t = _tuple$2[1];
						err = _tuple$2[2];
						if (!($interfaceIsEqual(err, $ifaceNil))) {
							_tmp$15 = 0;
							_tmp$16 = "";
							_tmp$17 = err;
							r = _tmp$15;
							rest = _tmp$16;
							err = _tmp$17;
							return [r, rest, err];
						}
						if (c === 125) {
							break;
						}
						v = unhex(c);
						if (v < 0) {
							break Switch;
						}
						r = ($imul(r, 16)) + v >> 0;
						if (r > 1114111) {
							break Switch;
						}
						nhex = nhex + (1) >> 0;
					}
					if (nhex === 0) {
						break Switch;
					}
					_tmp$18 = r;
					_tmp$19 = t;
					_tmp$20 = $ifaceNil;
					r = _tmp$18;
					rest = _tmp$19;
					err = _tmp$20;
					return [r, rest, err];
				}
				x = unhex(c);
				_tuple$3 = nextRune(t);
				c = _tuple$3[0];
				t = _tuple$3[1];
				err = _tuple$3[2];
				if (!($interfaceIsEqual(err, $ifaceNil))) {
					_tmp$21 = 0;
					_tmp$22 = "";
					_tmp$23 = err;
					r = _tmp$21;
					rest = _tmp$22;
					err = _tmp$23;
					return [r, rest, err];
				}
				y = unhex(c);
				if (x < 0 || y < 0) {
					break;
				}
				_tmp$24 = ($imul(x, 16)) + y >> 0;
				_tmp$25 = t;
				_tmp$26 = $ifaceNil;
				r = _tmp$24;
				rest = _tmp$25;
				err = _tmp$26;
				return [r, rest, err];
			} else if (_1 === (97)) {
				_tmp$27 = 7;
				_tmp$28 = t;
				_tmp$29 = err;
				r = _tmp$27;
				rest = _tmp$28;
				err = _tmp$29;
				return [r, rest, err];
			} else if (_1 === (102)) {
				_tmp$30 = 12;
				_tmp$31 = t;
				_tmp$32 = err;
				r = _tmp$30;
				rest = _tmp$31;
				err = _tmp$32;
				return [r, rest, err];
			} else if (_1 === (110)) {
				_tmp$33 = 10;
				_tmp$34 = t;
				_tmp$35 = err;
				r = _tmp$33;
				rest = _tmp$34;
				err = _tmp$35;
				return [r, rest, err];
			} else if (_1 === (114)) {
				_tmp$36 = 13;
				_tmp$37 = t;
				_tmp$38 = err;
				r = _tmp$36;
				rest = _tmp$37;
				err = _tmp$38;
				return [r, rest, err];
			} else if (_1 === (116)) {
				_tmp$39 = 9;
				_tmp$40 = t;
				_tmp$41 = err;
				r = _tmp$39;
				rest = _tmp$40;
				err = _tmp$41;
				return [r, rest, err];
			} else if (_1 === (118)) {
				_tmp$42 = 11;
				_tmp$43 = t;
				_tmp$44 = err;
				r = _tmp$42;
				rest = _tmp$43;
				err = _tmp$44;
				return [r, rest, err];
			} else if (c < 128 && !isalnum(c)) {
				_tmp$45 = c;
				_tmp$46 = t;
				_tmp$47 = $ifaceNil;
				r = _tmp$45;
				rest = _tmp$46;
				err = _tmp$47;
				return [r, rest, err];
			}
		}
		_tmp$48 = 0;
		_tmp$49 = "";
		_tmp$50 = new Error.ptr("invalid escape sequence", s.substring(0, (s.length - t.length >> 0)));
		r = _tmp$48;
		rest = _tmp$49;
		err = _tmp$50;
		return [r, rest, err];
	};
	parser.prototype.parseEscape = function(s) { return this.$val.parseEscape(s); };
	parser.ptr.prototype.parseClassChar = function(s, wholeClass) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tuple, _tuple$1, err, p, r, rest, s, wholeClass;
		r = 0;
		rest = "";
		err = $ifaceNil;
		p = this;
		if (s === "") {
			_tmp = 0;
			_tmp$1 = "";
			_tmp$2 = new Error.ptr("missing closing ]", wholeClass);
			r = _tmp;
			rest = _tmp$1;
			err = _tmp$2;
			return [r, rest, err];
		}
		if (s.charCodeAt(0) === 92) {
			_tuple = p.parseEscape(s);
			r = _tuple[0];
			rest = _tuple[1];
			err = _tuple[2];
			return [r, rest, err];
		}
		_tuple$1 = nextRune(s);
		r = _tuple$1[0];
		rest = _tuple$1[1];
		err = _tuple$1[2];
		return [r, rest, err];
	};
	parser.prototype.parseClassChar = function(s, wholeClass) { return this.$val.parseClassChar(s, wholeClass); };
	parser.ptr.prototype.parsePerlClassEscape = function(s, r) {
		var $ptr, _entry, _r, _tmp, _tmp$1, g, out, p, r, rest, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; g = $f.g; out = $f.out; p = $f.p; r = $f.r; rest = $f.rest; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		out = sliceType.nil;
		rest = "";
		p = this;
		if ((((p.flags & 64) >>> 0) === 0) || s.length < 2 || !((s.charCodeAt(0) === 92))) {
			return [out, rest];
		}
		g = $clone((_entry = perlGroup[$String.keyFor(s.substring(0, 2))], _entry !== undefined ? _entry.v : new charGroup.ptr(0, sliceType.nil)), charGroup);
		if (g.sign === 0) {
			return [out, rest];
		}
		_r = p.appendGroup(r, g); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tmp = _r;
		_tmp$1 = s.substring(2);
		out = _tmp;
		rest = _tmp$1;
		/* */ $s = 2; case 2:
		return [out, rest];
		/* */ } return; } if ($f === undefined) { $f = { $blk: parser.ptr.prototype.parsePerlClassEscape }; } $f.$ptr = $ptr; $f._entry = _entry; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f.g = g; $f.out = out; $f.p = p; $f.r = r; $f.rest = rest; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	parser.prototype.parsePerlClassEscape = function(s, r) { return this.$val.parsePerlClassEscape(s, r); };
	parser.ptr.prototype.parseNamedClass = function(s, r) {
		var $ptr, _entry, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, err, g, i, name, out, p, r, rest, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; err = $f.err; g = $f.g; i = $f.i; name = $f.name; out = $f.out; p = $f.p; r = $f.r; rest = $f.rest; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		out = sliceType.nil;
		rest = "";
		err = $ifaceNil;
		p = this;
		if (s.length < 2 || !((s.charCodeAt(0) === 91)) || !((s.charCodeAt(1) === 58))) {
			return [out, rest, err];
		}
		i = strings.Index(s.substring(2), ":]");
		if (i < 0) {
			return [out, rest, err];
		}
		i = i + (2) >> 0;
		_tmp = s.substring(0, (i + 2 >> 0));
		_tmp$1 = s.substring((i + 2 >> 0));
		name = _tmp;
		s = _tmp$1;
		g = $clone((_entry = posixGroup[$String.keyFor(name)], _entry !== undefined ? _entry.v : new charGroup.ptr(0, sliceType.nil)), charGroup);
		if (g.sign === 0) {
			_tmp$2 = sliceType.nil;
			_tmp$3 = "";
			_tmp$4 = new Error.ptr("invalid character class range", name);
			out = _tmp$2;
			rest = _tmp$3;
			err = _tmp$4;
			return [out, rest, err];
		}
		_r = p.appendGroup(r, g); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tmp$5 = _r;
		_tmp$6 = s;
		_tmp$7 = $ifaceNil;
		out = _tmp$5;
		rest = _tmp$6;
		err = _tmp$7;
		/* */ $s = 2; case 2:
		return [out, rest, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: parser.ptr.prototype.parseNamedClass }; } $f.$ptr = $ptr; $f._entry = _entry; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f.err = err; $f.g = g; $f.i = i; $f.name = name; $f.out = out; $f.p = p; $f.r = r; $f.rest = rest; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	parser.prototype.parseNamedClass = function(s, r) { return this.$val.parseNamedClass(s, r); };
	parser.ptr.prototype.appendGroup = function(r, g) {
		var $ptr, _r, g, p, r, tmp, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; g = $f.g; p = $f.p; r = $f.r; tmp = $f.tmp; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		g = $clone(g, charGroup);
		p = this;
		/* */ if (((p.flags & 1) >>> 0) === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (((p.flags & 1) >>> 0) === 0) { */ case 1:
			if (g.sign < 0) {
				r = appendNegatedClass(r, g.class$1);
			} else {
				r = appendClass(r, g.class$1);
			}
			$s = 3; continue;
		/* } else { */ case 2:
			tmp = $subslice(p.tmpClass, 0, 0);
			tmp = appendFoldedClass(tmp, g.class$1);
			p.tmpClass = tmp;
			_r = cleanClass((p.$ptr_tmpClass || (p.$ptr_tmpClass = new ptrType$2(function() { return this.$target.tmpClass; }, function($v) { this.$target.tmpClass = $v; }, p)))); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			tmp = _r;
			if (g.sign < 0) {
				r = appendNegatedClass(r, tmp);
			} else {
				r = appendClass(r, tmp);
			}
		/* } */ case 3:
		return r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: parser.ptr.prototype.appendGroup }; } $f.$ptr = $ptr; $f._r = _r; $f.g = g; $f.p = p; $f.r = r; $f.tmp = tmp; $f.$s = $s; $f.$r = $r; return $f;
	};
	parser.prototype.appendGroup = function(r, g) { return this.$val.appendGroup(r, g); };
	unicodeTable = function(name) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, name, t, t$1;
		if (name === "Any") {
			return [anyTable, anyTable];
		}
		t = (_entry = unicode.Categories[$String.keyFor(name)], _entry !== undefined ? _entry.v : ptrType$3.nil);
		if (!(t === ptrType$3.nil)) {
			return [t, (_entry$1 = unicode.FoldCategory[$String.keyFor(name)], _entry$1 !== undefined ? _entry$1.v : ptrType$3.nil)];
		}
		t$1 = (_entry$2 = unicode.Scripts[$String.keyFor(name)], _entry$2 !== undefined ? _entry$2.v : ptrType$3.nil);
		if (!(t$1 === ptrType$3.nil)) {
			return [t$1, (_entry$3 = unicode.FoldScript[$String.keyFor(name)], _entry$3 !== undefined ? _entry$3.v : ptrType$3.nil)];
		}
		return [ptrType$3.nil, ptrType$3.nil];
	};
	parser.ptr.prototype.parseUnicodeClass = function(s, r) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, _tuple$1, c, end, err, fold, name, out, p, r, rest, s, seq, sign, t, tab, tmp, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$10 = $f._tmp$10; _tmp$11 = $f._tmp$11; _tmp$12 = $f._tmp$12; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tmp$8 = $f._tmp$8; _tmp$9 = $f._tmp$9; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; c = $f.c; end = $f.end; err = $f.err; fold = $f.fold; name = $f.name; out = $f.out; p = $f.p; r = $f.r; rest = $f.rest; s = $f.s; seq = $f.seq; sign = $f.sign; t = $f.t; tab = $f.tab; tmp = $f.tmp; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		out = sliceType.nil;
		rest = "";
		err = $ifaceNil;
		p = this;
		if ((((p.flags & 128) >>> 0) === 0) || s.length < 2 || !((s.charCodeAt(0) === 92)) || !((s.charCodeAt(1) === 112)) && !((s.charCodeAt(1) === 80))) {
			return [out, rest, err];
		}
		sign = 1;
		if (s.charCodeAt(1) === 80) {
			sign = -1;
		}
		t = s.substring(2);
		_tuple = nextRune(t);
		c = _tuple[0];
		t = _tuple[1];
		err = _tuple[2];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [out, rest, err];
		}
		_tmp = "";
		_tmp$1 = "";
		seq = _tmp;
		name = _tmp$1;
		if (!((c === 123))) {
			seq = s.substring(0, (s.length - t.length >> 0));
			name = seq.substring(2);
		} else {
			end = strings.IndexRune(s, 125);
			if (end < 0) {
				err = checkUTF8(s);
				if (!($interfaceIsEqual(err, $ifaceNil))) {
					return [out, rest, err];
				}
				_tmp$2 = sliceType.nil;
				_tmp$3 = "";
				_tmp$4 = new Error.ptr("invalid character class range", s);
				out = _tmp$2;
				rest = _tmp$3;
				err = _tmp$4;
				return [out, rest, err];
			}
			_tmp$5 = s.substring(0, (end + 1 >> 0));
			_tmp$6 = s.substring((end + 1 >> 0));
			seq = _tmp$5;
			t = _tmp$6;
			name = s.substring(3, end);
			err = checkUTF8(name);
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				return [out, rest, err];
			}
		}
		if (!(name === "") && (name.charCodeAt(0) === 94)) {
			sign = -sign;
			name = name.substring(1);
		}
		_tuple$1 = unicodeTable(name);
		tab = _tuple$1[0];
		fold = _tuple$1[1];
		if (tab === ptrType$3.nil) {
			_tmp$7 = sliceType.nil;
			_tmp$8 = "";
			_tmp$9 = new Error.ptr("invalid character class range", seq);
			out = _tmp$7;
			rest = _tmp$8;
			err = _tmp$9;
			return [out, rest, err];
		}
		/* */ if ((((p.flags & 1) >>> 0) === 0) || fold === ptrType$3.nil) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ((((p.flags & 1) >>> 0) === 0) || fold === ptrType$3.nil) { */ case 1:
			if (sign > 0) {
				r = appendTable(r, tab);
			} else {
				r = appendNegatedTable(r, tab);
			}
			$s = 3; continue;
		/* } else { */ case 2:
			tmp = $subslice(p.tmpClass, 0, 0);
			tmp = appendTable(tmp, tab);
			tmp = appendTable(tmp, fold);
			p.tmpClass = tmp;
			_r = cleanClass((p.$ptr_tmpClass || (p.$ptr_tmpClass = new ptrType$2(function() { return this.$target.tmpClass; }, function($v) { this.$target.tmpClass = $v; }, p)))); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			tmp = _r;
			if (sign > 0) {
				r = appendClass(r, tmp);
			} else {
				r = appendNegatedClass(r, tmp);
			}
		/* } */ case 3:
		_tmp$10 = r;
		_tmp$11 = t;
		_tmp$12 = $ifaceNil;
		out = _tmp$10;
		rest = _tmp$11;
		err = _tmp$12;
		return [out, rest, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: parser.ptr.prototype.parseUnicodeClass }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$10 = _tmp$10; $f._tmp$11 = _tmp$11; $f._tmp$12 = _tmp$12; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tmp$8 = _tmp$8; $f._tmp$9 = _tmp$9; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.c = c; $f.end = end; $f.err = err; $f.fold = fold; $f.name = name; $f.out = out; $f.p = p; $f.r = r; $f.rest = rest; $f.s = s; $f.seq = seq; $f.sign = sign; $f.t = t; $f.tab = tab; $f.tmp = tmp; $f.$s = $s; $f.$r = $r; return $f;
	};
	parser.prototype.parseUnicodeClass = function(s, r) { return this.$val.parseUnicodeClass(s, r); };
	parser.ptr.prototype.parseClass = function(s) {
		var $ptr, _r, _r$1, _r$2, _r$3, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$2, _tmp$20, _tmp$21, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, class$1, err, err$1, err$2, first, hi, lo, nclass, nclass$1, nclass$2, nt, nt$1, nt$2, p, re, rest, rng, s, sign, size, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$10 = $f._tmp$10; _tmp$11 = $f._tmp$11; _tmp$12 = $f._tmp$12; _tmp$13 = $f._tmp$13; _tmp$14 = $f._tmp$14; _tmp$15 = $f._tmp$15; _tmp$16 = $f._tmp$16; _tmp$17 = $f._tmp$17; _tmp$18 = $f._tmp$18; _tmp$19 = $f._tmp$19; _tmp$2 = $f._tmp$2; _tmp$20 = $f._tmp$20; _tmp$21 = $f._tmp$21; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tmp$8 = $f._tmp$8; _tmp$9 = $f._tmp$9; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; class$1 = $f.class$1; err = $f.err; err$1 = $f.err$1; err$2 = $f.err$2; first = $f.first; hi = $f.hi; lo = $f.lo; nclass = $f.nclass; nclass$1 = $f.nclass$1; nclass$2 = $f.nclass$2; nt = $f.nt; nt$1 = $f.nt$1; nt$2 = $f.nt$2; p = $f.p; re = $f.re; rest = $f.rest; rng = $f.rng; s = $f.s; sign = $f.sign; size = $f.size; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rest = "";
		err = $ifaceNil;
		p = this;
		t = s.substring(1);
		re = p.newRegexp(4);
		re.Flags = p.flags;
		re.Rune = $subslice(new sliceType(re.Rune0), 0, 0);
		sign = 1;
		if (!(t === "") && (t.charCodeAt(0) === 94)) {
			sign = -1;
			t = t.substring(1);
			if (((p.flags & 4) >>> 0) === 0) {
				re.Rune = $append(re.Rune, 10, 10);
			}
		}
		class$1 = re.Rune;
		first = true;
		/* while (true) { */ case 1:
			/* if (!(t === "" || !((t.charCodeAt(0) === 93)) || first)) { break; } */ if(!(t === "" || !((t.charCodeAt(0) === 93)) || first)) { $s = 2; continue; }
			if (!(t === "") && (t.charCodeAt(0) === 45) && (((p.flags & 64) >>> 0) === 0) && !first && ((t.length === 1) || !((t.charCodeAt(1) === 93)))) {
				_tuple = utf8.DecodeRuneInString(t.substring(1));
				size = _tuple[1];
				_tmp = "";
				_tmp$1 = new Error.ptr("invalid character class range", t.substring(0, (1 + size >> 0)));
				rest = _tmp;
				err = _tmp$1;
				return [rest, err];
			}
			first = false;
			/* */ if (t.length > 2 && (t.charCodeAt(0) === 91) && (t.charCodeAt(1) === 58)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (t.length > 2 && (t.charCodeAt(0) === 91) && (t.charCodeAt(1) === 58)) { */ case 3:
				_r = p.parseNamedClass(t, class$1); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_tuple$1 = _r;
				nclass = _tuple$1[0];
				nt = _tuple$1[1];
				err$1 = _tuple$1[2];
				if (!($interfaceIsEqual(err$1, $ifaceNil))) {
					_tmp$2 = "";
					_tmp$3 = err$1;
					rest = _tmp$2;
					err = _tmp$3;
					return [rest, err];
				}
				if (!(nclass === sliceType.nil)) {
					_tmp$4 = nclass;
					_tmp$5 = nt;
					class$1 = _tmp$4;
					t = _tmp$5;
					/* continue; */ $s = 1; continue;
				}
			/* } */ case 4:
			_r$1 = p.parseUnicodeClass(t, class$1); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple$2 = _r$1;
			nclass$1 = _tuple$2[0];
			nt$1 = _tuple$2[1];
			err$2 = _tuple$2[2];
			if (!($interfaceIsEqual(err$2, $ifaceNil))) {
				_tmp$6 = "";
				_tmp$7 = err$2;
				rest = _tmp$6;
				err = _tmp$7;
				return [rest, err];
			}
			/* */ if (!(nclass$1 === sliceType.nil)) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (!(nclass$1 === sliceType.nil)) { */ case 7:
				_tmp$8 = nclass$1;
				_tmp$9 = nt$1;
				class$1 = _tmp$8;
				t = _tmp$9;
				/* continue; */ $s = 1; continue;
			/* } */ case 8:
			_r$2 = p.parsePerlClassEscape(t, class$1); /* */ $s = 9; case 9: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			_tuple$3 = _r$2;
			nclass$2 = _tuple$3[0];
			nt$2 = _tuple$3[1];
			if (!(nclass$2 === sliceType.nil)) {
				_tmp$10 = nclass$2;
				_tmp$11 = nt$2;
				class$1 = _tmp$10;
				t = _tmp$11;
				/* continue; */ $s = 1; continue;
			}
			rng = t;
			_tmp$12 = 0;
			_tmp$13 = 0;
			lo = _tmp$12;
			hi = _tmp$13;
			_tuple$4 = p.parseClassChar(t, s);
			lo = _tuple$4[0];
			t = _tuple$4[1];
			err$2 = _tuple$4[2];
			if (!($interfaceIsEqual(err$2, $ifaceNil))) {
				_tmp$14 = "";
				_tmp$15 = err$2;
				rest = _tmp$14;
				err = _tmp$15;
				return [rest, err];
			}
			hi = lo;
			if (t.length >= 2 && (t.charCodeAt(0) === 45) && !((t.charCodeAt(1) === 93))) {
				t = t.substring(1);
				_tuple$5 = p.parseClassChar(t, s);
				hi = _tuple$5[0];
				t = _tuple$5[1];
				err$2 = _tuple$5[2];
				if (!($interfaceIsEqual(err$2, $ifaceNil))) {
					_tmp$16 = "";
					_tmp$17 = err$2;
					rest = _tmp$16;
					err = _tmp$17;
					return [rest, err];
				}
				if (hi < lo) {
					rng = rng.substring(0, (rng.length - t.length >> 0));
					_tmp$18 = "";
					_tmp$19 = new Error.ptr("invalid character class range", rng);
					rest = _tmp$18;
					err = _tmp$19;
					return [rest, err];
				}
			}
			if (((p.flags & 1) >>> 0) === 0) {
				class$1 = appendRange(class$1, lo, hi);
			} else {
				class$1 = appendFoldedRange(class$1, lo, hi);
			}
		/* } */ $s = 1; continue; case 2:
		t = t.substring(1);
		re.Rune = class$1;
		_r$3 = cleanClass((re.$ptr_Rune || (re.$ptr_Rune = new ptrType$2(function() { return this.$target.Rune; }, function($v) { this.$target.Rune = $v; }, re)))); /* */ $s = 10; case 10: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		class$1 = _r$3;
		if (sign < 0) {
			class$1 = negateClass(class$1);
		}
		re.Rune = class$1;
		p.push(re);
		_tmp$20 = t;
		_tmp$21 = $ifaceNil;
		rest = _tmp$20;
		err = _tmp$21;
		return [rest, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: parser.ptr.prototype.parseClass }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$10 = _tmp$10; $f._tmp$11 = _tmp$11; $f._tmp$12 = _tmp$12; $f._tmp$13 = _tmp$13; $f._tmp$14 = _tmp$14; $f._tmp$15 = _tmp$15; $f._tmp$16 = _tmp$16; $f._tmp$17 = _tmp$17; $f._tmp$18 = _tmp$18; $f._tmp$19 = _tmp$19; $f._tmp$2 = _tmp$2; $f._tmp$20 = _tmp$20; $f._tmp$21 = _tmp$21; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tmp$8 = _tmp$8; $f._tmp$9 = _tmp$9; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f.class$1 = class$1; $f.err = err; $f.err$1 = err$1; $f.err$2 = err$2; $f.first = first; $f.hi = hi; $f.lo = lo; $f.nclass = nclass; $f.nclass$1 = nclass$1; $f.nclass$2 = nclass$2; $f.nt = nt; $f.nt$1 = nt$1; $f.nt$2 = nt$2; $f.p = p; $f.re = re; $f.rest = rest; $f.rng = rng; $f.s = s; $f.sign = sign; $f.size = size; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	parser.prototype.parseClass = function(s) { return this.$val.parseClass(s); };
	cleanClass = function(rp) {
		var $ptr, _tmp, _tmp$1, hi, i, lo, r, rp, w, x, x$1, x$2, x$3, x$4, x$5, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; hi = $f.hi; i = $f.i; lo = $f.lo; r = $f.r; rp = $f.rp; w = $f.w; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = sort.Sort((x = new ranges.ptr(rp), new x.constructor.elem(x))); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		r = rp.$get();
		if (r.$length < 2) {
			return r;
		}
		w = 2;
		i = 2;
		while (true) {
			if (!(i < r.$length)) { break; }
			_tmp = ((i < 0 || i >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + i]);
			_tmp$1 = (x$1 = i + 1 >> 0, ((x$1 < 0 || x$1 >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + x$1]));
			lo = _tmp;
			hi = _tmp$1;
			if (lo <= ((x$2 = w - 1 >> 0, ((x$2 < 0 || x$2 >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + x$2])) + 1 >> 0)) {
				if (hi > (x$3 = w - 1 >> 0, ((x$3 < 0 || x$3 >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + x$3]))) {
					(x$4 = w - 1 >> 0, ((x$4 < 0 || x$4 >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + x$4] = hi));
				}
				i = i + (2) >> 0;
				continue;
			}
			((w < 0 || w >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + w] = lo);
			(x$5 = w + 1 >> 0, ((x$5 < 0 || x$5 >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + x$5] = hi));
			w = w + (2) >> 0;
			i = i + (2) >> 0;
		}
		return $subslice(r, 0, w);
		/* */ } return; } if ($f === undefined) { $f = { $blk: cleanClass }; } $f.$ptr = $ptr; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f.hi = hi; $f.i = i; $f.lo = lo; $f.r = r; $f.rp = rp; $f.w = w; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.$s = $s; $f.$r = $r; return $f;
	};
	appendLiteral = function(r, x, flags) {
		var $ptr, flags, r, x;
		if (!((((flags & 1) >>> 0) === 0))) {
			return appendFoldedRange(r, x, x);
		}
		return appendRange(r, x, x);
	};
	appendRange = function(r, lo, hi) {
		var $ptr, _tmp, _tmp$1, hi, i, lo, n, r, rhi, rlo, x, x$1, x$2, x$3;
		n = r.$length;
		i = 2;
		while (true) {
			if (!(i <= 4)) { break; }
			if (n >= i) {
				_tmp = (x = n - i >> 0, ((x < 0 || x >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + x]));
				_tmp$1 = (x$1 = (n - i >> 0) + 1 >> 0, ((x$1 < 0 || x$1 >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + x$1]));
				rlo = _tmp;
				rhi = _tmp$1;
				if (lo <= (rhi + 1 >> 0) && rlo <= (hi + 1 >> 0)) {
					if (lo < rlo) {
						(x$2 = n - i >> 0, ((x$2 < 0 || x$2 >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + x$2] = lo));
					}
					if (hi > rhi) {
						(x$3 = (n - i >> 0) + 1 >> 0, ((x$3 < 0 || x$3 >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + x$3] = hi));
					}
					return r;
				}
			}
			i = i + (2) >> 0;
		}
		return $append(r, lo, hi);
	};
	appendFoldedRange = function(r, lo, hi) {
		var $ptr, c, f, hi, lo, r;
		if (lo <= 65 && hi >= 71903) {
			return appendRange(r, lo, hi);
		}
		if (hi < 65 || lo > 71903) {
			return appendRange(r, lo, hi);
		}
		if (lo < 65) {
			r = appendRange(r, lo, 64);
			lo = 65;
		}
		if (hi > 71903) {
			r = appendRange(r, 71904, hi);
			hi = 71903;
		}
		c = lo;
		while (true) {
			if (!(c <= hi)) { break; }
			r = appendRange(r, c, c);
			f = unicode.SimpleFold(c);
			while (true) {
				if (!(!((f === c)))) { break; }
				r = appendRange(r, f, f);
				f = unicode.SimpleFold(f);
			}
			c = c + (1) >> 0;
		}
		return r;
	};
	appendClass = function(r, x) {
		var $ptr, i, r, x, x$1;
		i = 0;
		while (true) {
			if (!(i < x.$length)) { break; }
			r = appendRange(r, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]), (x$1 = i + 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])));
			i = i + (2) >> 0;
		}
		return r;
	};
	appendFoldedClass = function(r, x) {
		var $ptr, i, r, x, x$1;
		i = 0;
		while (true) {
			if (!(i < x.$length)) { break; }
			r = appendFoldedRange(r, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]), (x$1 = i + 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])));
			i = i + (2) >> 0;
		}
		return r;
	};
	appendNegatedClass = function(r, x) {
		var $ptr, _tmp, _tmp$1, hi, i, lo, nextLo, r, x, x$1;
		nextLo = 0;
		i = 0;
		while (true) {
			if (!(i < x.$length)) { break; }
			_tmp = ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]);
			_tmp$1 = (x$1 = i + 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
			lo = _tmp;
			hi = _tmp$1;
			if (nextLo <= (lo - 1 >> 0)) {
				r = appendRange(r, nextLo, lo - 1 >> 0);
			}
			nextLo = hi + 1 >> 0;
			i = i + (2) >> 0;
		}
		if (nextLo <= 1114111) {
			r = appendRange(r, nextLo, 1114111);
		}
		return r;
	};
	appendTable = function(r, x) {
		var $ptr, _i, _i$1, _ref, _ref$1, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, c, c$1, hi, hi$1, lo, lo$1, r, stride, stride$1, x, xr, xr$1;
		_ref = x.R16;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			xr = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), unicode.Range16);
			_tmp = (xr.Lo >> 0);
			_tmp$1 = (xr.Hi >> 0);
			_tmp$2 = (xr.Stride >> 0);
			lo = _tmp;
			hi = _tmp$1;
			stride = _tmp$2;
			if (stride === 1) {
				r = appendRange(r, lo, hi);
				_i++;
				continue;
			}
			c = lo;
			while (true) {
				if (!(c <= hi)) { break; }
				r = appendRange(r, c, c);
				c = c + (stride) >> 0;
			}
			_i++;
		}
		_ref$1 = x.R32;
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			xr$1 = $clone(((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]), unicode.Range32);
			_tmp$3 = (xr$1.Lo >> 0);
			_tmp$4 = (xr$1.Hi >> 0);
			_tmp$5 = (xr$1.Stride >> 0);
			lo$1 = _tmp$3;
			hi$1 = _tmp$4;
			stride$1 = _tmp$5;
			if (stride$1 === 1) {
				r = appendRange(r, lo$1, hi$1);
				_i$1++;
				continue;
			}
			c$1 = lo$1;
			while (true) {
				if (!(c$1 <= hi$1)) { break; }
				r = appendRange(r, c$1, c$1);
				c$1 = c$1 + (stride$1) >> 0;
			}
			_i$1++;
		}
		return r;
	};
	appendNegatedTable = function(r, x) {
		var $ptr, _i, _i$1, _ref, _ref$1, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, c, c$1, hi, hi$1, lo, lo$1, nextLo, r, stride, stride$1, x, xr, xr$1;
		nextLo = 0;
		_ref = x.R16;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			xr = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), unicode.Range16);
			_tmp = (xr.Lo >> 0);
			_tmp$1 = (xr.Hi >> 0);
			_tmp$2 = (xr.Stride >> 0);
			lo = _tmp;
			hi = _tmp$1;
			stride = _tmp$2;
			if (stride === 1) {
				if (nextLo <= (lo - 1 >> 0)) {
					r = appendRange(r, nextLo, lo - 1 >> 0);
				}
				nextLo = hi + 1 >> 0;
				_i++;
				continue;
			}
			c = lo;
			while (true) {
				if (!(c <= hi)) { break; }
				if (nextLo <= (c - 1 >> 0)) {
					r = appendRange(r, nextLo, c - 1 >> 0);
				}
				nextLo = c + 1 >> 0;
				c = c + (stride) >> 0;
			}
			_i++;
		}
		_ref$1 = x.R32;
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			xr$1 = $clone(((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]), unicode.Range32);
			_tmp$3 = (xr$1.Lo >> 0);
			_tmp$4 = (xr$1.Hi >> 0);
			_tmp$5 = (xr$1.Stride >> 0);
			lo$1 = _tmp$3;
			hi$1 = _tmp$4;
			stride$1 = _tmp$5;
			if (stride$1 === 1) {
				if (nextLo <= (lo$1 - 1 >> 0)) {
					r = appendRange(r, nextLo, lo$1 - 1 >> 0);
				}
				nextLo = hi$1 + 1 >> 0;
				_i$1++;
				continue;
			}
			c$1 = lo$1;
			while (true) {
				if (!(c$1 <= hi$1)) { break; }
				if (nextLo <= (c$1 - 1 >> 0)) {
					r = appendRange(r, nextLo, c$1 - 1 >> 0);
				}
				nextLo = c$1 + 1 >> 0;
				c$1 = c$1 + (stride$1) >> 0;
			}
			_i$1++;
		}
		if (nextLo <= 1114111) {
			r = appendRange(r, nextLo, 1114111);
		}
		return r;
	};
	negateClass = function(r) {
		var $ptr, _tmp, _tmp$1, hi, i, lo, nextLo, r, w, x, x$1;
		nextLo = 0;
		w = 0;
		i = 0;
		while (true) {
			if (!(i < r.$length)) { break; }
			_tmp = ((i < 0 || i >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + i]);
			_tmp$1 = (x = i + 1 >> 0, ((x < 0 || x >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + x]));
			lo = _tmp;
			hi = _tmp$1;
			if (nextLo <= (lo - 1 >> 0)) {
				((w < 0 || w >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + w] = nextLo);
				(x$1 = w + 1 >> 0, ((x$1 < 0 || x$1 >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + x$1] = (lo - 1 >> 0)));
				w = w + (2) >> 0;
			}
			nextLo = hi + 1 >> 0;
			i = i + (2) >> 0;
		}
		r = $subslice(r, 0, w);
		if (nextLo <= 1114111) {
			r = $append(r, nextLo, 1114111);
		}
		return r;
	};
	ranges.ptr.prototype.Less = function(i, j) {
		var $ptr, i, j, p, ra, x, x$1;
		ra = $clone(this, ranges);
		p = ra.p.$get();
		i = $imul(i, (2));
		j = $imul(j, (2));
		return ((i < 0 || i >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + i]) < ((j < 0 || j >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + j]) || (((i < 0 || i >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + i]) === ((j < 0 || j >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + j])) && (x = i + 1 >> 0, ((x < 0 || x >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + x])) > (x$1 = j + 1 >> 0, ((x$1 < 0 || x$1 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + x$1]));
	};
	ranges.prototype.Less = function(i, j) { return this.$val.Less(i, j); };
	ranges.ptr.prototype.Len = function() {
		var $ptr, _q, ra;
		ra = $clone(this, ranges);
		return (_q = ra.p.$get().$length / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
	};
	ranges.prototype.Len = function() { return this.$val.Len(); };
	ranges.ptr.prototype.Swap = function(i, j) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, i, j, p, ra, x, x$1, x$2, x$3;
		ra = $clone(this, ranges);
		p = ra.p.$get();
		i = $imul(i, (2));
		j = $imul(j, (2));
		_tmp = ((j < 0 || j >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + j]);
		_tmp$1 = (x = j + 1 >> 0, ((x < 0 || x >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + x]));
		_tmp$2 = ((i < 0 || i >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + i]);
		_tmp$3 = (x$1 = i + 1 >> 0, ((x$1 < 0 || x$1 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + x$1]));
		((i < 0 || i >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + i] = _tmp);
		(x$2 = i + 1 >> 0, ((x$2 < 0 || x$2 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + x$2] = _tmp$1));
		((j < 0 || j >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + j] = _tmp$2);
		(x$3 = j + 1 >> 0, ((x$3 < 0 || x$3 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + x$3] = _tmp$3));
	};
	ranges.prototype.Swap = function(i, j) { return this.$val.Swap(i, j); };
	checkUTF8 = function(s) {
		var $ptr, _tuple, rune, s, size;
		while (true) {
			if (!(!(s === ""))) { break; }
			_tuple = utf8.DecodeRuneInString(s);
			rune = _tuple[0];
			size = _tuple[1];
			if ((rune === 65533) && (size === 1)) {
				return new Error.ptr("invalid UTF-8", s);
			}
			s = s.substring(size);
		}
		return $ifaceNil;
	};
	nextRune = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, c, err, s, size, t;
		c = 0;
		t = "";
		err = $ifaceNil;
		_tuple = utf8.DecodeRuneInString(s);
		c = _tuple[0];
		size = _tuple[1];
		if ((c === 65533) && (size === 1)) {
			_tmp = 0;
			_tmp$1 = "";
			_tmp$2 = new Error.ptr("invalid UTF-8", s);
			c = _tmp;
			t = _tmp$1;
			err = _tmp$2;
			return [c, t, err];
		}
		_tmp$3 = c;
		_tmp$4 = s.substring(size);
		_tmp$5 = $ifaceNil;
		c = _tmp$3;
		t = _tmp$4;
		err = _tmp$5;
		return [c, t, err];
	};
	isalnum = function(c) {
		var $ptr, c;
		return 48 <= c && c <= 57 || 65 <= c && c <= 90 || 97 <= c && c <= 122;
	};
	unhex = function(c) {
		var $ptr, c;
		if (48 <= c && c <= 57) {
			return c - 48 >> 0;
		}
		if (97 <= c && c <= 102) {
			return (c - 97 >> 0) + 10 >> 0;
		}
		if (65 <= c && c <= 70) {
			return (c - 65 >> 0) + 10 >> 0;
		}
		return -1;
	};
	InstOp.prototype.String = function() {
		var $ptr, i;
		i = this.$val;
		if ((i >>> 0) >= (instOpNames.$length >>> 0)) {
			return "";
		}
		return ((i < 0 || i >= instOpNames.$length) ? $throwRuntimeError("index out of range") : instOpNames.$array[instOpNames.$offset + i]);
	};
	$ptrType(InstOp).prototype.String = function() { return new InstOp(this.$get()).String(); };
	EmptyOpContext = function(r1, r2) {
		var $ptr, boundary, op, r1, r2;
		op = 32;
		boundary = 0;
		if (IsWordChar(r1)) {
			boundary = 1;
		} else if ((r1 === 10)) {
			op = (op | (1)) >>> 0;
		} else if (r1 < 0) {
			op = (op | (5)) >>> 0;
		}
		if (IsWordChar(r2)) {
			boundary = (boundary ^ (1)) << 24 >>> 24;
		} else if ((r2 === 10)) {
			op = (op | (2)) >>> 0;
		} else if (r2 < 0) {
			op = (op | (10)) >>> 0;
		}
		if (!((boundary === 0))) {
			op = (op ^ (48)) << 24 >>> 24;
		}
		return op;
	};
	$pkg.EmptyOpContext = EmptyOpContext;
	IsWordChar = function(r) {
		var $ptr, r;
		return 65 <= r && r <= 90 || 97 <= r && r <= 122 || 48 <= r && r <= 57 || (r === 95);
	};
	$pkg.IsWordChar = IsWordChar;
	Prog.ptr.prototype.String = function() {
		var $ptr, b, p;
		p = this;
		b = new bytes.Buffer.ptr(sliceType$6.nil, 0, arrayType$2.zero(), arrayType$3.zero(), 0);
		dumpProg(b, p);
		return b.String();
	};
	Prog.prototype.String = function() { return this.$val.String(); };
	Prog.ptr.prototype.skipNop = function(pc) {
		var $ptr, i, p, pc, x, x$1;
		p = this;
		i = (x = p.Inst, ((pc < 0 || pc >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + pc]));
		while (true) {
			if (!((i.Op === 6) || (i.Op === 2))) { break; }
			pc = i.Out;
			i = (x$1 = p.Inst, ((pc < 0 || pc >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + pc]));
		}
		return [i, pc];
	};
	Prog.prototype.skipNop = function(pc) { return this.$val.skipNop(pc); };
	Inst.ptr.prototype.op = function() {
		var $ptr, _1, i, op;
		i = this;
		op = i.Op;
		_1 = op;
		if ((_1 === (8)) || (_1 === (9)) || (_1 === (10))) {
			op = 7;
		}
		return op;
	};
	Inst.prototype.op = function() { return this.$val.op(); };
	Prog.ptr.prototype.Prefix = function() {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, _tuple$1, buf, complete, i, p, prefix, x;
		prefix = "";
		complete = false;
		p = this;
		_tuple = p.skipNop((p.Start >>> 0));
		i = _tuple[0];
		if (!((i.op() === 7)) || !((i.Rune.$length === 1))) {
			_tmp = "";
			_tmp$1 = i.Op === 4;
			prefix = _tmp;
			complete = _tmp$1;
			return [prefix, complete];
		}
		buf = new bytes.Buffer.ptr(sliceType$6.nil, 0, arrayType$2.zero(), arrayType$3.zero(), 0);
		while (true) {
			if (!((i.op() === 7) && (i.Rune.$length === 1) && ((((i.Arg << 16 >>> 16) & 1) >>> 0) === 0))) { break; }
			buf.WriteRune((x = i.Rune, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])));
			_tuple$1 = p.skipNop(i.Out);
			i = _tuple$1[0];
		}
		_tmp$2 = buf.String();
		_tmp$3 = i.Op === 4;
		prefix = _tmp$2;
		complete = _tmp$3;
		return [prefix, complete];
	};
	Prog.prototype.Prefix = function() { return this.$val.Prefix(); };
	Prog.ptr.prototype.StartCond = function() {
		var $ptr, _1, flag, i, p, pc, x, x$1;
		p = this;
		flag = 0;
		pc = (p.Start >>> 0);
		i = (x = p.Inst, ((pc < 0 || pc >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + pc]));
		Loop:
		while (true) {
			_1 = i.Op;
			if (_1 === (3)) {
				flag = (flag | ((i.Arg << 24 >>> 24))) >>> 0;
			} else if (_1 === (5)) {
				return 255;
			} else if ((_1 === (2)) || (_1 === (6))) {
			} else {
				break Loop;
			}
			pc = i.Out;
			i = (x$1 = p.Inst, ((pc < 0 || pc >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + pc]));
		}
		return flag;
	};
	Prog.prototype.StartCond = function() { return this.$val.StartCond(); };
	Inst.ptr.prototype.MatchRune = function(r) {
		var $ptr, i, r;
		i = this;
		return !((i.MatchRunePos(r) === -1));
	};
	Inst.prototype.MatchRune = function(r) { return this.$val.MatchRune(r); };
	Inst.ptr.prototype.MatchRunePos = function(r) {
		var $ptr, _q, _q$1, _q$2, c, hi, i, j, lo, m, r, r0, r1, rune, x, x$1, x$2;
		i = this;
		rune = i.Rune;
		if (rune.$length === 1) {
			r0 = (0 >= rune.$length ? $throwRuntimeError("index out of range") : rune.$array[rune.$offset + 0]);
			if (r === r0) {
				return 0;
			}
			if (!(((((i.Arg << 16 >>> 16) & 1) >>> 0) === 0))) {
				r1 = unicode.SimpleFold(r0);
				while (true) {
					if (!(!((r1 === r0)))) { break; }
					if (r === r1) {
						return 0;
					}
					r1 = unicode.SimpleFold(r1);
				}
			}
			return -1;
		}
		j = 0;
		while (true) {
			if (!(j < rune.$length && j <= 8)) { break; }
			if (r < ((j < 0 || j >= rune.$length) ? $throwRuntimeError("index out of range") : rune.$array[rune.$offset + j])) {
				return -1;
			}
			if (r <= (x = j + 1 >> 0, ((x < 0 || x >= rune.$length) ? $throwRuntimeError("index out of range") : rune.$array[rune.$offset + x]))) {
				return (_q = j / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
			}
			j = j + (2) >> 0;
		}
		lo = 0;
		hi = (_q$1 = rune.$length / 2, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q$2 = ((hi - lo >> 0)) / 2, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			c = (x$1 = $imul(2, m), ((x$1 < 0 || x$1 >= rune.$length) ? $throwRuntimeError("index out of range") : rune.$array[rune.$offset + x$1]));
			if (c <= r) {
				if (r <= (x$2 = ($imul(2, m)) + 1 >> 0, ((x$2 < 0 || x$2 >= rune.$length) ? $throwRuntimeError("index out of range") : rune.$array[rune.$offset + x$2]))) {
					return m;
				}
				lo = m + 1 >> 0;
			} else {
				hi = m;
			}
		}
		return -1;
	};
	Inst.prototype.MatchRunePos = function(r) { return this.$val.MatchRunePos(r); };
	wordRune = function(r) {
		var $ptr, r;
		return (r === 95) || (65 <= r && r <= 90) || (97 <= r && r <= 122) || (48 <= r && r <= 57);
	};
	Inst.ptr.prototype.MatchEmptyWidth = function(before, after) {
		var $ptr, _1, after, before, i;
		i = this;
		_1 = (i.Arg << 24 >>> 24);
		if (_1 === (1)) {
			return (before === 10) || (before === -1);
		} else if (_1 === (2)) {
			return (after === 10) || (after === -1);
		} else if (_1 === (4)) {
			return before === -1;
		} else if (_1 === (8)) {
			return after === -1;
		} else if (_1 === (16)) {
			return !(wordRune(before) === wordRune(after));
		} else if (_1 === (32)) {
			return wordRune(before) === wordRune(after);
		}
		$panic(new $String("unknown empty width arg"));
	};
	Inst.prototype.MatchEmptyWidth = function(before, after) { return this.$val.MatchEmptyWidth(before, after); };
	Inst.ptr.prototype.String = function() {
		var $ptr, b, i;
		i = this;
		b = new bytes.Buffer.ptr(sliceType$6.nil, 0, arrayType$2.zero(), arrayType$3.zero(), 0);
		dumpInst(b, i);
		return b.String();
	};
	Inst.prototype.String = function() { return this.$val.String(); };
	bw = function(b, args) {
		var $ptr, _i, _ref, args, b, s;
		_ref = args;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			s = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			b.WriteString(s);
			_i++;
		}
	};
	dumpProg = function(b, p) {
		var $ptr, _i, _ref, b, i, j, p, pc, x;
		_ref = p.Inst;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			j = _i;
			i = (x = p.Inst, ((j < 0 || j >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + j]));
			pc = strconv.Itoa(j);
			if (pc.length < 3) {
				b.WriteString("   ".substring(pc.length));
			}
			if (j === p.Start) {
				pc = pc + ("*");
			}
			bw(b, new sliceType$3([pc, "\t"]));
			dumpInst(b, i);
			bw(b, new sliceType$3(["\n"]));
			_i++;
		}
	};
	u32 = function(i) {
		var $ptr, i;
		return strconv.FormatUint(new $Uint64(0, i), 10);
	};
	dumpInst = function(b, i) {
		var $ptr, _1, b, i;
		_1 = i.Op;
		if (_1 === (0)) {
			bw(b, new sliceType$3(["alt -> ", u32(i.Out), ", ", u32(i.Arg)]));
		} else if (_1 === (1)) {
			bw(b, new sliceType$3(["altmatch -> ", u32(i.Out), ", ", u32(i.Arg)]));
		} else if (_1 === (2)) {
			bw(b, new sliceType$3(["cap ", u32(i.Arg), " -> ", u32(i.Out)]));
		} else if (_1 === (3)) {
			bw(b, new sliceType$3(["empty ", u32(i.Arg), " -> ", u32(i.Out)]));
		} else if (_1 === (4)) {
			bw(b, new sliceType$3(["match"]));
		} else if (_1 === (5)) {
			bw(b, new sliceType$3(["fail"]));
		} else if (_1 === (6)) {
			bw(b, new sliceType$3(["nop -> ", u32(i.Out)]));
		} else if (_1 === (7)) {
			if (i.Rune === sliceType.nil) {
				bw(b, new sliceType$3(["rune <nil>"]));
			}
			bw(b, new sliceType$3(["rune ", strconv.QuoteToASCII($runesToString(i.Rune))]));
			if (!(((((i.Arg << 16 >>> 16) & 1) >>> 0) === 0))) {
				bw(b, new sliceType$3(["/i"]));
			}
			bw(b, new sliceType$3([" -> ", u32(i.Out)]));
		} else if (_1 === (8)) {
			bw(b, new sliceType$3(["rune1 ", strconv.QuoteToASCII($runesToString(i.Rune)), " -> ", u32(i.Out)]));
		} else if (_1 === (9)) {
			bw(b, new sliceType$3(["any -> ", u32(i.Out)]));
		} else if (_1 === (10)) {
			bw(b, new sliceType$3(["anynotnl -> ", u32(i.Out)]));
		}
	};
	Regexp.ptr.prototype.Equal = function(y) {
		var $ptr, _1, _i, _i$1, _ref, _ref$1, i, i$1, r, sub, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8, y;
		x = this;
		if (x === ptrType$1.nil || y === ptrType$1.nil) {
			return x === y;
		}
		if (!((x.Op === y.Op))) {
			return false;
		}
		_1 = x.Op;
		if (_1 === (10)) {
			if (!((((x.Flags & 256) >>> 0) === ((y.Flags & 256) >>> 0)))) {
				return false;
			}
		} else if ((_1 === (3)) || (_1 === (4))) {
			if (!((x.Rune.$length === y.Rune.$length))) {
				return false;
			}
			_ref = x.Rune;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				r = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
				if (!((r === (x$1 = y.Rune, ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i]))))) {
					return false;
				}
				_i++;
			}
		} else if ((_1 === (19)) || (_1 === (18))) {
			if (!((x.Sub.$length === y.Sub.$length))) {
				return false;
			}
			_ref$1 = x.Sub;
			_i$1 = 0;
			while (true) {
				if (!(_i$1 < _ref$1.$length)) { break; }
				i$1 = _i$1;
				sub = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
				if (!sub.Equal((x$2 = y.Sub, ((i$1 < 0 || i$1 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + i$1])))) {
					return false;
				}
				_i$1++;
			}
		} else if ((_1 === (14)) || (_1 === (15)) || (_1 === (16))) {
			if (!((((x.Flags & 32) >>> 0) === ((y.Flags & 32) >>> 0))) || !(x$3 = x.Sub, (0 >= x$3.$length ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 0])).Equal((x$4 = y.Sub, (0 >= x$4.$length ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + 0])))) {
				return false;
			}
		} else if (_1 === (17)) {
			if (!((((x.Flags & 32) >>> 0) === ((y.Flags & 32) >>> 0))) || !((x.Min === y.Min)) || !((x.Max === y.Max)) || !(x$5 = x.Sub, (0 >= x$5.$length ? $throwRuntimeError("index out of range") : x$5.$array[x$5.$offset + 0])).Equal((x$6 = y.Sub, (0 >= x$6.$length ? $throwRuntimeError("index out of range") : x$6.$array[x$6.$offset + 0])))) {
				return false;
			}
		} else if (_1 === (13)) {
			if (!((x.Cap === y.Cap)) || !(x.Name === y.Name) || !(x$7 = x.Sub, (0 >= x$7.$length ? $throwRuntimeError("index out of range") : x$7.$array[x$7.$offset + 0])).Equal((x$8 = y.Sub, (0 >= x$8.$length ? $throwRuntimeError("index out of range") : x$8.$array[x$8.$offset + 0])))) {
				return false;
			}
		}
		return true;
	};
	Regexp.prototype.Equal = function(y) { return this.$val.Equal(y); };
	writeRegexp = function(b, re) {
		var $ptr, _1, _2, _i, _i$1, _i$2, _r, _ref, _ref$1, _ref$2, _tmp, _tmp$1, _tmp$2, _tmp$3, b, hi, hi$1, i, i$1, i$2, lo, lo$1, r, re, sub, sub$1, sub$2, x, x$1, x$10, x$11, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		switch (0) { default:
			_1 = re.Op;
			if (_1 === (1)) {
				b.WriteString("[^\\x00-\\x{10FFFF}]");
			} else if (_1 === (2)) {
				b.WriteString("(?:)");
			} else if (_1 === (3)) {
				if (!((((re.Flags & 1) >>> 0) === 0))) {
					b.WriteString("(?i:");
				}
				_ref = re.Rune;
				_i = 0;
				while (true) {
					if (!(_i < _ref.$length)) { break; }
					r = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
					escape(b, r, false);
					_i++;
				}
				if (!((((re.Flags & 1) >>> 0) === 0))) {
					b.WriteString(")");
				}
			} else if (_1 === (4)) {
				if (!(((_r = re.Rune.$length % 2, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) === 0))) {
					b.WriteString("[invalid char class]");
					break;
				}
				b.WriteRune(91);
				if (re.Rune.$length === 0) {
					b.WriteString("^\\x00-\\x{10FFFF}");
				} else if (((x = re.Rune, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])) === 0) && ((x$1 = re.Rune, x$2 = re.Rune.$length - 1 >> 0, ((x$2 < 0 || x$2 >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + x$2])) === 1114111)) {
					b.WriteRune(94);
					i = 1;
					while (true) {
						if (!(i < (re.Rune.$length - 1 >> 0))) { break; }
						_tmp = (x$3 = re.Rune, ((i < 0 || i >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + i])) + 1 >> 0;
						_tmp$1 = (x$4 = re.Rune, x$5 = i + 1 >> 0, ((x$5 < 0 || x$5 >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + x$5])) - 1 >> 0;
						lo = _tmp;
						hi = _tmp$1;
						escape(b, lo, lo === 45);
						if (!((lo === hi))) {
							b.WriteRune(45);
							escape(b, hi, hi === 45);
						}
						i = i + (2) >> 0;
					}
				} else {
					i$1 = 0;
					while (true) {
						if (!(i$1 < re.Rune.$length)) { break; }
						_tmp$2 = (x$6 = re.Rune, ((i$1 < 0 || i$1 >= x$6.$length) ? $throwRuntimeError("index out of range") : x$6.$array[x$6.$offset + i$1]));
						_tmp$3 = (x$7 = re.Rune, x$8 = i$1 + 1 >> 0, ((x$8 < 0 || x$8 >= x$7.$length) ? $throwRuntimeError("index out of range") : x$7.$array[x$7.$offset + x$8]));
						lo$1 = _tmp$2;
						hi$1 = _tmp$3;
						escape(b, lo$1, lo$1 === 45);
						if (!((lo$1 === hi$1))) {
							b.WriteRune(45);
							escape(b, hi$1, hi$1 === 45);
						}
						i$1 = i$1 + (2) >> 0;
					}
				}
				b.WriteRune(93);
			} else if (_1 === (5)) {
				b.WriteString("(?-s:.)");
			} else if (_1 === (6)) {
				b.WriteString("(?s:.)");
			} else if (_1 === (7)) {
				b.WriteString("(?m:^)");
			} else if (_1 === (8)) {
				b.WriteString("(?m:$)");
			} else if (_1 === (9)) {
				b.WriteString("\\A");
			} else if (_1 === (10)) {
				if (!((((re.Flags & 256) >>> 0) === 0))) {
					b.WriteString("(?-m:$)");
				} else {
					b.WriteString("\\z");
				}
			} else if (_1 === (11)) {
				b.WriteString("\\b");
			} else if (_1 === (12)) {
				b.WriteString("\\B");
			} else if (_1 === (13)) {
				if (!(re.Name === "")) {
					b.WriteString("(?P<");
					b.WriteString(re.Name);
					b.WriteRune(62);
				} else {
					b.WriteRune(40);
				}
				if (!(((x$9 = re.Sub, (0 >= x$9.$length ? $throwRuntimeError("index out of range") : x$9.$array[x$9.$offset + 0])).Op === 2))) {
					writeRegexp(b, (x$10 = re.Sub, (0 >= x$10.$length ? $throwRuntimeError("index out of range") : x$10.$array[x$10.$offset + 0])));
				}
				b.WriteRune(41);
			} else if ((_1 === (14)) || (_1 === (15)) || (_1 === (16)) || (_1 === (17))) {
				sub = (x$11 = re.Sub, (0 >= x$11.$length ? $throwRuntimeError("index out of range") : x$11.$array[x$11.$offset + 0]));
				if (sub.Op > 13 || (sub.Op === 3) && sub.Rune.$length > 1) {
					b.WriteString("(?:");
					writeRegexp(b, sub);
					b.WriteString(")");
				} else {
					writeRegexp(b, sub);
				}
				_2 = re.Op;
				if (_2 === (14)) {
					b.WriteRune(42);
				} else if (_2 === (15)) {
					b.WriteRune(43);
				} else if (_2 === (16)) {
					b.WriteRune(63);
				} else if (_2 === (17)) {
					b.WriteRune(123);
					b.WriteString(strconv.Itoa(re.Min));
					if (!((re.Max === re.Min))) {
						b.WriteRune(44);
						if (re.Max >= 0) {
							b.WriteString(strconv.Itoa(re.Max));
						}
					}
					b.WriteRune(125);
				}
				if (!((((re.Flags & 32) >>> 0) === 0))) {
					b.WriteRune(63);
				}
			} else if (_1 === (18)) {
				_ref$1 = re.Sub;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.$length)) { break; }
					sub$1 = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
					if (sub$1.Op === 19) {
						b.WriteString("(?:");
						writeRegexp(b, sub$1);
						b.WriteString(")");
					} else {
						writeRegexp(b, sub$1);
					}
					_i$1++;
				}
			} else if (_1 === (19)) {
				_ref$2 = re.Sub;
				_i$2 = 0;
				while (true) {
					if (!(_i$2 < _ref$2.$length)) { break; }
					i$2 = _i$2;
					sub$2 = ((_i$2 < 0 || _i$2 >= _ref$2.$length) ? $throwRuntimeError("index out of range") : _ref$2.$array[_ref$2.$offset + _i$2]);
					if (i$2 > 0) {
						b.WriteRune(124);
					}
					writeRegexp(b, sub$2);
					_i$2++;
				}
			} else {
				b.WriteString("<invalid op" + strconv.Itoa((re.Op >> 0)) + ">");
			}
		}
	};
	Regexp.ptr.prototype.String = function() {
		var $ptr, b, re;
		re = this;
		b = new bytes.Buffer.ptr(sliceType$6.nil, 0, arrayType$2.zero(), arrayType$3.zero(), 0);
		writeRegexp(b, re);
		return b.String();
	};
	Regexp.prototype.String = function() { return this.$val.String(); };
	escape = function(b, r, force) {
		var $ptr, _1, b, force, r, s;
		if (unicode.IsPrint(r)) {
			if (strings.IndexRune("\\.+*?()|[]{}^$", r) >= 0 || force) {
				b.WriteRune(92);
			}
			b.WriteRune(r);
			return;
		}
		switch (0) { default:
			_1 = r;
			if (_1 === (7)) {
				b.WriteString("\\a");
			} else if (_1 === (12)) {
				b.WriteString("\\f");
			} else if (_1 === (10)) {
				b.WriteString("\\n");
			} else if (_1 === (13)) {
				b.WriteString("\\r");
			} else if (_1 === (9)) {
				b.WriteString("\\t");
			} else if (_1 === (11)) {
				b.WriteString("\\v");
			} else {
				if (r < 256) {
					b.WriteString("\\x");
					s = strconv.FormatInt(new $Int64(0, r), 16);
					if (s.length === 1) {
						b.WriteRune(48);
					}
					b.WriteString(s);
					break;
				}
				b.WriteString("\\x{");
				b.WriteString(strconv.FormatInt(new $Int64(0, r), 16));
				b.WriteString("}");
			}
		}
	};
	Regexp.ptr.prototype.MaxCap = function() {
		var $ptr, _i, _ref, m, n, re, sub;
		re = this;
		m = 0;
		if (re.Op === 13) {
			m = re.Cap;
		}
		_ref = re.Sub;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			sub = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			n = sub.MaxCap();
			if (m < n) {
				m = n;
			}
			_i++;
		}
		return m;
	};
	Regexp.prototype.MaxCap = function() { return this.$val.MaxCap(); };
	Regexp.ptr.prototype.CapNames = function() {
		var $ptr, names, re;
		re = this;
		names = $makeSlice(sliceType$3, (re.MaxCap() + 1 >> 0));
		re.capNames(names);
		return names;
	};
	Regexp.prototype.CapNames = function() { return this.$val.CapNames(); };
	Regexp.ptr.prototype.capNames = function(names) {
		var $ptr, _i, _ref, names, re, sub, x;
		re = this;
		if (re.Op === 13) {
			(x = re.Cap, ((x < 0 || x >= names.$length) ? $throwRuntimeError("index out of range") : names.$array[names.$offset + x] = re.Name));
		}
		_ref = re.Sub;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			sub = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			sub.capNames(names);
			_i++;
		}
	};
	Regexp.prototype.capNames = function(names) { return this.$val.capNames(names); };
	Regexp.ptr.prototype.Simplify = function() {
		var $ptr, _1, _i, _ref, i, i$1, i$2, i$3, nre, nre$1, nre2, nsub, prefix, re, sub, sub$1, sub$2, suffix, x, x$1;
		re = this;
		if (re === ptrType$1.nil) {
			return ptrType$1.nil;
		}
		_1 = re.Op;
		if ((_1 === (13)) || (_1 === (18)) || (_1 === (19))) {
			nre = re;
			_ref = re.Sub;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				sub = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
				nsub = sub.Simplify();
				if (nre === re && !(nsub === sub)) {
					nre = new Regexp.ptr(0, 0, sliceType$5.nil, arrayType.zero(), sliceType.nil, arrayType$1.zero(), 0, 0, 0, "");
					Regexp.copy(nre, re);
					nre.Rune = sliceType.nil;
					nre.Sub = $appendSlice($subslice(new sliceType$5(nre.Sub0), 0, 0), $subslice(re.Sub, 0, i));
				}
				if (!(nre === re)) {
					nre.Sub = $append(nre.Sub, nsub);
				}
				_i++;
			}
			return nre;
		} else if ((_1 === (14)) || (_1 === (15)) || (_1 === (16))) {
			sub$1 = (x = re.Sub, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])).Simplify();
			return simplify1(re.Op, re.Flags, sub$1, re);
		} else if (_1 === (17)) {
			if ((re.Min === 0) && (re.Max === 0)) {
				return new Regexp.ptr(2, 0, sliceType$5.nil, arrayType.zero(), sliceType.nil, arrayType$1.zero(), 0, 0, 0, "");
			}
			sub$2 = (x$1 = re.Sub, (0 >= x$1.$length ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + 0])).Simplify();
			if (re.Max === -1) {
				if (re.Min === 0) {
					return simplify1(14, re.Flags, sub$2, ptrType$1.nil);
				}
				if (re.Min === 1) {
					return simplify1(15, re.Flags, sub$2, ptrType$1.nil);
				}
				nre$1 = new Regexp.ptr(18, 0, sliceType$5.nil, arrayType.zero(), sliceType.nil, arrayType$1.zero(), 0, 0, 0, "");
				nre$1.Sub = $subslice(new sliceType$5(nre$1.Sub0), 0, 0);
				i$1 = 0;
				while (true) {
					if (!(i$1 < (re.Min - 1 >> 0))) { break; }
					nre$1.Sub = $append(nre$1.Sub, sub$2);
					i$1 = i$1 + (1) >> 0;
				}
				nre$1.Sub = $append(nre$1.Sub, simplify1(15, re.Flags, sub$2, ptrType$1.nil));
				return nre$1;
			}
			if ((re.Min === 1) && (re.Max === 1)) {
				return sub$2;
			}
			prefix = ptrType$1.nil;
			if (re.Min > 0) {
				prefix = new Regexp.ptr(18, 0, sliceType$5.nil, arrayType.zero(), sliceType.nil, arrayType$1.zero(), 0, 0, 0, "");
				prefix.Sub = $subslice(new sliceType$5(prefix.Sub0), 0, 0);
				i$2 = 0;
				while (true) {
					if (!(i$2 < re.Min)) { break; }
					prefix.Sub = $append(prefix.Sub, sub$2);
					i$2 = i$2 + (1) >> 0;
				}
			}
			if (re.Max > re.Min) {
				suffix = simplify1(16, re.Flags, sub$2, ptrType$1.nil);
				i$3 = re.Min + 1 >> 0;
				while (true) {
					if (!(i$3 < re.Max)) { break; }
					nre2 = new Regexp.ptr(18, 0, sliceType$5.nil, arrayType.zero(), sliceType.nil, arrayType$1.zero(), 0, 0, 0, "");
					nre2.Sub = $append($subslice(new sliceType$5(nre2.Sub0), 0, 0), sub$2, suffix);
					suffix = simplify1(16, re.Flags, nre2, ptrType$1.nil);
					i$3 = i$3 + (1) >> 0;
				}
				if (prefix === ptrType$1.nil) {
					return suffix;
				}
				prefix.Sub = $append(prefix.Sub, suffix);
			}
			if (!(prefix === ptrType$1.nil)) {
				return prefix;
			}
			return new Regexp.ptr(1, 0, sliceType$5.nil, arrayType.zero(), sliceType.nil, arrayType$1.zero(), 0, 0, 0, "");
		}
		return re;
	};
	Regexp.prototype.Simplify = function() { return this.$val.Simplify(); };
	simplify1 = function(op, flags, sub, re) {
		var $ptr, flags, op, re, sub, x;
		if (sub.Op === 2) {
			return sub;
		}
		if ((op === sub.Op) && (((flags & 32) >>> 0) === ((sub.Flags & 32) >>> 0))) {
			return sub;
		}
		if (!(re === ptrType$1.nil) && (re.Op === op) && (((re.Flags & 32) >>> 0) === ((flags & 32) >>> 0)) && sub === (x = re.Sub, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0]))) {
			return re;
		}
		re = new Regexp.ptr(op, flags, sliceType$5.nil, arrayType.zero(), sliceType.nil, arrayType$1.zero(), 0, 0, 0, "");
		re.Sub = $append($subslice(new sliceType$5(re.Sub0), 0, 0), sub);
		return re;
	};
	patchList.methods = [{prop: "next", name: "next", pkg: "regexp/syntax", typ: $funcType([ptrType], [patchList], false)}, {prop: "patch", name: "patch", pkg: "regexp/syntax", typ: $funcType([ptrType, $Uint32], [], false)}, {prop: "append", name: "append", pkg: "regexp/syntax", typ: $funcType([ptrType, patchList], [patchList], false)}];
	ptrType$4.methods = [{prop: "init", name: "init", pkg: "regexp/syntax", typ: $funcType([], [], false)}, {prop: "compile", name: "compile", pkg: "regexp/syntax", typ: $funcType([ptrType$1], [frag], false)}, {prop: "inst", name: "inst", pkg: "regexp/syntax", typ: $funcType([InstOp], [frag], false)}, {prop: "nop", name: "nop", pkg: "regexp/syntax", typ: $funcType([], [frag], false)}, {prop: "fail", name: "fail", pkg: "regexp/syntax", typ: $funcType([], [frag], false)}, {prop: "cap", name: "cap", pkg: "regexp/syntax", typ: $funcType([$Uint32], [frag], false)}, {prop: "cat", name: "cat", pkg: "regexp/syntax", typ: $funcType([frag, frag], [frag], false)}, {prop: "alt", name: "alt", pkg: "regexp/syntax", typ: $funcType([frag, frag], [frag], false)}, {prop: "quest", name: "quest", pkg: "regexp/syntax", typ: $funcType([frag, $Bool], [frag], false)}, {prop: "star", name: "star", pkg: "regexp/syntax", typ: $funcType([frag, $Bool], [frag], false)}, {prop: "plus", name: "plus", pkg: "regexp/syntax", typ: $funcType([frag, $Bool], [frag], false)}, {prop: "empty", name: "empty", pkg: "regexp/syntax", typ: $funcType([EmptyOp], [frag], false)}, {prop: "rune", name: "rune", pkg: "regexp/syntax", typ: $funcType([sliceType, Flags], [frag], false)}];
	ptrType$5.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	ErrorCode.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$6.methods = [{prop: "newRegexp", name: "newRegexp", pkg: "regexp/syntax", typ: $funcType([Op], [ptrType$1], false)}, {prop: "reuse", name: "reuse", pkg: "regexp/syntax", typ: $funcType([ptrType$1], [], false)}, {prop: "push", name: "push", pkg: "regexp/syntax", typ: $funcType([ptrType$1], [ptrType$1], false)}, {prop: "maybeConcat", name: "maybeConcat", pkg: "regexp/syntax", typ: $funcType([$Int32, Flags], [$Bool], false)}, {prop: "newLiteral", name: "newLiteral", pkg: "regexp/syntax", typ: $funcType([$Int32, Flags], [ptrType$1], false)}, {prop: "literal", name: "literal", pkg: "regexp/syntax", typ: $funcType([$Int32], [], false)}, {prop: "op", name: "op", pkg: "regexp/syntax", typ: $funcType([Op], [ptrType$1], false)}, {prop: "repeat", name: "repeat", pkg: "regexp/syntax", typ: $funcType([Op, $Int, $Int, $String, $String, $String], [$String, $error], false)}, {prop: "concat", name: "concat", pkg: "regexp/syntax", typ: $funcType([], [ptrType$1], false)}, {prop: "alternate", name: "alternate", pkg: "regexp/syntax", typ: $funcType([], [ptrType$1], false)}, {prop: "collapse", name: "collapse", pkg: "regexp/syntax", typ: $funcType([sliceType$5, Op], [ptrType$1], false)}, {prop: "factor", name: "factor", pkg: "regexp/syntax", typ: $funcType([sliceType$5, Flags], [sliceType$5], false)}, {prop: "leadingString", name: "leadingString", pkg: "regexp/syntax", typ: $funcType([ptrType$1], [sliceType, Flags], false)}, {prop: "removeLeadingString", name: "removeLeadingString", pkg: "regexp/syntax", typ: $funcType([ptrType$1, $Int], [ptrType$1], false)}, {prop: "leadingRegexp", name: "leadingRegexp", pkg: "regexp/syntax", typ: $funcType([ptrType$1], [ptrType$1], false)}, {prop: "removeLeadingRegexp", name: "removeLeadingRegexp", pkg: "regexp/syntax", typ: $funcType([ptrType$1, $Bool], [ptrType$1], false)}, {prop: "parseRepeat", name: "parseRepeat", pkg: "regexp/syntax", typ: $funcType([$String], [$Int, $Int, $String, $Bool], false)}, {prop: "parsePerlFlags", name: "parsePerlFlags", pkg: "regexp/syntax", typ: $funcType([$String], [$String, $error], false)}, {prop: "parseInt", name: "parseInt", pkg: "regexp/syntax", typ: $funcType([$String], [$Int, $String, $Bool], false)}, {prop: "parseVerticalBar", name: "parseVerticalBar", pkg: "regexp/syntax", typ: $funcType([], [$error], false)}, {prop: "swapVerticalBar", name: "swapVerticalBar", pkg: "regexp/syntax", typ: $funcType([], [$Bool], false)}, {prop: "parseRightParen", name: "parseRightParen", pkg: "regexp/syntax", typ: $funcType([], [$error], false)}, {prop: "parseEscape", name: "parseEscape", pkg: "regexp/syntax", typ: $funcType([$String], [$Int32, $String, $error], false)}, {prop: "parseClassChar", name: "parseClassChar", pkg: "regexp/syntax", typ: $funcType([$String, $String], [$Int32, $String, $error], false)}, {prop: "parsePerlClassEscape", name: "parsePerlClassEscape", pkg: "regexp/syntax", typ: $funcType([$String, sliceType], [sliceType, $String], false)}, {prop: "parseNamedClass", name: "parseNamedClass", pkg: "regexp/syntax", typ: $funcType([$String, sliceType], [sliceType, $String, $error], false)}, {prop: "appendGroup", name: "appendGroup", pkg: "regexp/syntax", typ: $funcType([sliceType, charGroup], [sliceType], false)}, {prop: "parseUnicodeClass", name: "parseUnicodeClass", pkg: "regexp/syntax", typ: $funcType([$String, sliceType], [sliceType, $String, $error], false)}, {prop: "parseClass", name: "parseClass", pkg: "regexp/syntax", typ: $funcType([$String], [$String, $error], false)}];
	ranges.methods = [{prop: "Less", name: "Less", pkg: "", typ: $funcType([$Int, $Int], [$Bool], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Swap", name: "Swap", pkg: "", typ: $funcType([$Int, $Int], [], false)}];
	ptrType.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "skipNop", name: "skipNop", pkg: "regexp/syntax", typ: $funcType([$Uint32], [ptrType$7, $Uint32], false)}, {prop: "Prefix", name: "Prefix", pkg: "", typ: $funcType([], [$String, $Bool], false)}, {prop: "StartCond", name: "StartCond", pkg: "", typ: $funcType([], [EmptyOp], false)}];
	InstOp.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$7.methods = [{prop: "op", name: "op", pkg: "regexp/syntax", typ: $funcType([], [InstOp], false)}, {prop: "MatchRune", name: "MatchRune", pkg: "", typ: $funcType([$Int32], [$Bool], false)}, {prop: "MatchRunePos", name: "MatchRunePos", pkg: "", typ: $funcType([$Int32], [$Int], false)}, {prop: "MatchEmptyWidth", name: "MatchEmptyWidth", pkg: "", typ: $funcType([$Int32, $Int32], [$Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$1.methods = [{prop: "Equal", name: "Equal", pkg: "", typ: $funcType([ptrType$1], [$Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "MaxCap", name: "MaxCap", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "CapNames", name: "CapNames", pkg: "", typ: $funcType([], [sliceType$3], false)}, {prop: "capNames", name: "capNames", pkg: "regexp/syntax", typ: $funcType([sliceType$3], [], false)}, {prop: "Simplify", name: "Simplify", pkg: "", typ: $funcType([], [ptrType$1], false)}];
	frag.init([{prop: "i", name: "i", pkg: "regexp/syntax", typ: $Uint32, tag: ""}, {prop: "out", name: "out", pkg: "regexp/syntax", typ: patchList, tag: ""}]);
	compiler.init([{prop: "p", name: "p", pkg: "regexp/syntax", typ: ptrType, tag: ""}]);
	Error.init([{prop: "Code", name: "Code", pkg: "", typ: ErrorCode, tag: ""}, {prop: "Expr", name: "Expr", pkg: "", typ: $String, tag: ""}]);
	parser.init([{prop: "flags", name: "flags", pkg: "regexp/syntax", typ: Flags, tag: ""}, {prop: "stack", name: "stack", pkg: "regexp/syntax", typ: sliceType$5, tag: ""}, {prop: "free", name: "free", pkg: "regexp/syntax", typ: ptrType$1, tag: ""}, {prop: "numCap", name: "numCap", pkg: "regexp/syntax", typ: $Int, tag: ""}, {prop: "wholeRegexp", name: "wholeRegexp", pkg: "regexp/syntax", typ: $String, tag: ""}, {prop: "tmpClass", name: "tmpClass", pkg: "regexp/syntax", typ: sliceType, tag: ""}]);
	charGroup.init([{prop: "sign", name: "sign", pkg: "regexp/syntax", typ: $Int, tag: ""}, {prop: "class$1", name: "class", pkg: "regexp/syntax", typ: sliceType, tag: ""}]);
	ranges.init([{prop: "p", name: "p", pkg: "regexp/syntax", typ: ptrType$2, tag: ""}]);
	Prog.init([{prop: "Inst", name: "Inst", pkg: "", typ: sliceType$4, tag: ""}, {prop: "Start", name: "Start", pkg: "", typ: $Int, tag: ""}, {prop: "NumCap", name: "NumCap", pkg: "", typ: $Int, tag: ""}]);
	Inst.init([{prop: "Op", name: "Op", pkg: "", typ: InstOp, tag: ""}, {prop: "Out", name: "Out", pkg: "", typ: $Uint32, tag: ""}, {prop: "Arg", name: "Arg", pkg: "", typ: $Uint32, tag: ""}, {prop: "Rune", name: "Rune", pkg: "", typ: sliceType, tag: ""}]);
	Regexp.init([{prop: "Op", name: "Op", pkg: "", typ: Op, tag: ""}, {prop: "Flags", name: "Flags", pkg: "", typ: Flags, tag: ""}, {prop: "Sub", name: "Sub", pkg: "", typ: sliceType$5, tag: ""}, {prop: "Sub0", name: "Sub0", pkg: "", typ: arrayType, tag: ""}, {prop: "Rune", name: "Rune", pkg: "", typ: sliceType, tag: ""}, {prop: "Rune0", name: "Rune0", pkg: "", typ: arrayType$1, tag: ""}, {prop: "Min", name: "Min", pkg: "", typ: $Int, tag: ""}, {prop: "Max", name: "Max", pkg: "", typ: $Int, tag: ""}, {prop: "Cap", name: "Cap", pkg: "", typ: $Int, tag: ""}, {prop: "Name", name: "Name", pkg: "", typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = bytes.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sort.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		anyRuneNotNL = new sliceType([0, 9, 11, 1114111]);
		anyRune = new sliceType([0, 1114111]);
		anyTable = new unicode.RangeTable.ptr(new sliceType$1([new unicode.Range16.ptr(0, 65535, 1)]), new sliceType$2([new unicode.Range32.ptr(65536, 1114111, 1)]), 0);
		code1 = new sliceType([48, 57]);
		code2 = new sliceType([9, 10, 12, 13, 32, 32]);
		code3 = new sliceType([48, 57, 65, 90, 95, 95, 97, 122]);
		perlGroup = $makeMap($String.keyFor, [{ k: "\\d", v: new charGroup.ptr(1, code1) }, { k: "\\D", v: new charGroup.ptr(-1, code1) }, { k: "\\s", v: new charGroup.ptr(1, code2) }, { k: "\\S", v: new charGroup.ptr(-1, code2) }, { k: "\\w", v: new charGroup.ptr(1, code3) }, { k: "\\W", v: new charGroup.ptr(-1, code3) }]);
		code4 = new sliceType([48, 57, 65, 90, 97, 122]);
		code5 = new sliceType([65, 90, 97, 122]);
		code6 = new sliceType([0, 127]);
		code7 = new sliceType([9, 9, 32, 32]);
		code8 = new sliceType([0, 31, 127, 127]);
		code9 = new sliceType([48, 57]);
		code10 = new sliceType([33, 126]);
		code11 = new sliceType([97, 122]);
		code12 = new sliceType([32, 126]);
		code13 = new sliceType([33, 47, 58, 64, 91, 96, 123, 126]);
		code14 = new sliceType([9, 13, 32, 32]);
		code15 = new sliceType([65, 90]);
		code16 = new sliceType([48, 57, 65, 90, 95, 95, 97, 122]);
		code17 = new sliceType([48, 57, 65, 70, 97, 102]);
		posixGroup = $makeMap($String.keyFor, [{ k: "[:alnum:]", v: new charGroup.ptr(1, code4) }, { k: "[:^alnum:]", v: new charGroup.ptr(-1, code4) }, { k: "[:alpha:]", v: new charGroup.ptr(1, code5) }, { k: "[:^alpha:]", v: new charGroup.ptr(-1, code5) }, { k: "[:ascii:]", v: new charGroup.ptr(1, code6) }, { k: "[:^ascii:]", v: new charGroup.ptr(-1, code6) }, { k: "[:blank:]", v: new charGroup.ptr(1, code7) }, { k: "[:^blank:]", v: new charGroup.ptr(-1, code7) }, { k: "[:cntrl:]", v: new charGroup.ptr(1, code8) }, { k: "[:^cntrl:]", v: new charGroup.ptr(-1, code8) }, { k: "[:digit:]", v: new charGroup.ptr(1, code9) }, { k: "[:^digit:]", v: new charGroup.ptr(-1, code9) }, { k: "[:graph:]", v: new charGroup.ptr(1, code10) }, { k: "[:^graph:]", v: new charGroup.ptr(-1, code10) }, { k: "[:lower:]", v: new charGroup.ptr(1, code11) }, { k: "[:^lower:]", v: new charGroup.ptr(-1, code11) }, { k: "[:print:]", v: new charGroup.ptr(1, code12) }, { k: "[:^print:]", v: new charGroup.ptr(-1, code12) }, { k: "[:punct:]", v: new charGroup.ptr(1, code13) }, { k: "[:^punct:]", v: new charGroup.ptr(-1, code13) }, { k: "[:space:]", v: new charGroup.ptr(1, code14) }, { k: "[:^space:]", v: new charGroup.ptr(-1, code14) }, { k: "[:upper:]", v: new charGroup.ptr(1, code15) }, { k: "[:^upper:]", v: new charGroup.ptr(-1, code15) }, { k: "[:word:]", v: new charGroup.ptr(1, code16) }, { k: "[:^word:]", v: new charGroup.ptr(-1, code16) }, { k: "[:xdigit:]", v: new charGroup.ptr(1, code17) }, { k: "[:^xdigit:]", v: new charGroup.ptr(-1, code17) }]);
		instOpNames = new sliceType$3(["InstAlt", "InstAltMatch", "InstCapture", "InstEmptyWidth", "InstMatch", "InstFail", "InstNop", "InstRune", "InstRune1", "InstRuneAny", "InstRuneAnyNotNL"]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["regexp"] = (function() {
	var $pkg = {}, $init, bytes, nosync, io, syntax, sort, strconv, strings, unicode, utf8, job, bitState, queue, entry, thread, machine, onePassProg, onePassInst, queueOnePass, runeSlice, Regexp, input, inputString, inputBytes, inputReader, ptrType, sliceType, sliceType$1, sliceType$2, ptrType$1, sliceType$3, ptrType$2, sliceType$4, ptrType$3, sliceType$5, ptrType$4, sliceType$6, ptrType$5, ptrType$6, arrayType, arrayType$1, ptrType$7, sliceType$7, ptrType$8, sliceType$8, ptrType$9, ptrType$10, sliceType$9, sliceType$10, sliceType$11, sliceType$12, sliceType$13, sliceType$14, ptrType$11, funcType, funcType$1, funcType$2, funcType$3, ptrType$12, ptrType$13, ptrType$14, notBacktrack, empty, noRune, noNext, anyRuneNotNL, anyRune, notOnePass, maxBitStateLen, newBitState, shouldBacktrack, progMachine, onePassPrefix, onePassNext, iop, newQueue, mergeRuneSets, cleanupOnePass, onePassCopy, makeOnePass, compileOnePass, Compile, compile, MustCompile, quote, extract;
	bytes = $packages["bytes"];
	nosync = $packages["github.com/gopherjs/gopherjs/nosync"];
	io = $packages["io"];
	syntax = $packages["regexp/syntax"];
	sort = $packages["sort"];
	strconv = $packages["strconv"];
	strings = $packages["strings"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	job = $pkg.job = $newType(0, $kindStruct, "regexp.job", "job", "regexp", function(pc_, arg_, pos_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.pc = 0;
			this.arg = 0;
			this.pos = 0;
			return;
		}
		this.pc = pc_;
		this.arg = arg_;
		this.pos = pos_;
	});
	bitState = $pkg.bitState = $newType(0, $kindStruct, "regexp.bitState", "bitState", "regexp", function(prog_, end_, cap_, input_, jobs_, visited_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.prog = ptrType$2.nil;
			this.end = 0;
			this.cap = sliceType.nil;
			this.input = $ifaceNil;
			this.jobs = sliceType$4.nil;
			this.visited = sliceType$2.nil;
			return;
		}
		this.prog = prog_;
		this.end = end_;
		this.cap = cap_;
		this.input = input_;
		this.jobs = jobs_;
		this.visited = visited_;
	});
	queue = $pkg.queue = $newType(0, $kindStruct, "regexp.queue", "queue", "regexp", function(sparse_, dense_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.sparse = sliceType$2.nil;
			this.dense = sliceType$5.nil;
			return;
		}
		this.sparse = sparse_;
		this.dense = dense_;
	});
	entry = $pkg.entry = $newType(0, $kindStruct, "regexp.entry", "entry", "regexp", function(pc_, t_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.pc = 0;
			this.t = ptrType$4.nil;
			return;
		}
		this.pc = pc_;
		this.t = t_;
	});
	thread = $pkg.thread = $newType(0, $kindStruct, "regexp.thread", "thread", "regexp", function(inst_, cap_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.inst = ptrType$5.nil;
			this.cap = sliceType.nil;
			return;
		}
		this.inst = inst_;
		this.cap = cap_;
	});
	machine = $pkg.machine = $newType(0, $kindStruct, "regexp.machine", "machine", "regexp", function(re_, p_, op_, maxBitStateLen_, b_, q0_, q1_, pool_, matched_, matchcap_, inputBytes_, inputString_, inputReader_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.re = ptrType$3.nil;
			this.p = ptrType$2.nil;
			this.op = ptrType$1.nil;
			this.maxBitStateLen = 0;
			this.b = ptrType.nil;
			this.q0 = new queue.ptr(sliceType$2.nil, sliceType$5.nil);
			this.q1 = new queue.ptr(sliceType$2.nil, sliceType$5.nil);
			this.pool = sliceType$6.nil;
			this.matched = false;
			this.matchcap = sliceType.nil;
			this.inputBytes = new inputBytes.ptr(sliceType$3.nil);
			this.inputString = new inputString.ptr("");
			this.inputReader = new inputReader.ptr($ifaceNil, false, 0);
			return;
		}
		this.re = re_;
		this.p = p_;
		this.op = op_;
		this.maxBitStateLen = maxBitStateLen_;
		this.b = b_;
		this.q0 = q0_;
		this.q1 = q1_;
		this.pool = pool_;
		this.matched = matched_;
		this.matchcap = matchcap_;
		this.inputBytes = inputBytes_;
		this.inputString = inputString_;
		this.inputReader = inputReader_;
	});
	onePassProg = $pkg.onePassProg = $newType(0, $kindStruct, "regexp.onePassProg", "onePassProg", "regexp", function(Inst_, Start_, NumCap_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Inst = sliceType$7.nil;
			this.Start = 0;
			this.NumCap = 0;
			return;
		}
		this.Inst = Inst_;
		this.Start = Start_;
		this.NumCap = NumCap_;
	});
	onePassInst = $pkg.onePassInst = $newType(0, $kindStruct, "regexp.onePassInst", "onePassInst", "regexp", function(Inst_, Next_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Inst = new syntax.Inst.ptr(0, 0, 0, sliceType$1.nil);
			this.Next = sliceType$2.nil;
			return;
		}
		this.Inst = Inst_;
		this.Next = Next_;
	});
	queueOnePass = $pkg.queueOnePass = $newType(0, $kindStruct, "regexp.queueOnePass", "queueOnePass", "regexp", function(sparse_, dense_, size_, nextIndex_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.sparse = sliceType$2.nil;
			this.dense = sliceType$2.nil;
			this.size = 0;
			this.nextIndex = 0;
			return;
		}
		this.sparse = sparse_;
		this.dense = dense_;
		this.size = size_;
		this.nextIndex = nextIndex_;
	});
	runeSlice = $pkg.runeSlice = $newType(12, $kindSlice, "regexp.runeSlice", "runeSlice", "regexp", null);
	Regexp = $pkg.Regexp = $newType(0, $kindStruct, "regexp.Regexp", "Regexp", "regexp", function(expr_, prog_, onepass_, prefix_, prefixBytes_, prefixComplete_, prefixRune_, prefixEnd_, cond_, numSubexp_, subexpNames_, longest_, mu_, machine_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.expr = "";
			this.prog = ptrType$2.nil;
			this.onepass = ptrType$1.nil;
			this.prefix = "";
			this.prefixBytes = sliceType$3.nil;
			this.prefixComplete = false;
			this.prefixRune = 0;
			this.prefixEnd = 0;
			this.cond = 0;
			this.numSubexp = 0;
			this.subexpNames = sliceType$10.nil;
			this.longest = false;
			this.mu = new nosync.Mutex.ptr(false);
			this.machine = sliceType$9.nil;
			return;
		}
		this.expr = expr_;
		this.prog = prog_;
		this.onepass = onepass_;
		this.prefix = prefix_;
		this.prefixBytes = prefixBytes_;
		this.prefixComplete = prefixComplete_;
		this.prefixRune = prefixRune_;
		this.prefixEnd = prefixEnd_;
		this.cond = cond_;
		this.numSubexp = numSubexp_;
		this.subexpNames = subexpNames_;
		this.longest = longest_;
		this.mu = mu_;
		this.machine = machine_;
	});
	input = $pkg.input = $newType(8, $kindInterface, "regexp.input", "input", "regexp", null);
	inputString = $pkg.inputString = $newType(0, $kindStruct, "regexp.inputString", "inputString", "regexp", function(str_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.str = "";
			return;
		}
		this.str = str_;
	});
	inputBytes = $pkg.inputBytes = $newType(0, $kindStruct, "regexp.inputBytes", "inputBytes", "regexp", function(str_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.str = sliceType$3.nil;
			return;
		}
		this.str = str_;
	});
	inputReader = $pkg.inputReader = $newType(0, $kindStruct, "regexp.inputReader", "inputReader", "regexp", function(r_, atEOT_, pos_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.r = $ifaceNil;
			this.atEOT = false;
			this.pos = 0;
			return;
		}
		this.r = r_;
		this.atEOT = atEOT_;
		this.pos = pos_;
	});
	ptrType = $ptrType(bitState);
	sliceType = $sliceType($Int);
	sliceType$1 = $sliceType($Int32);
	sliceType$2 = $sliceType($Uint32);
	ptrType$1 = $ptrType(onePassProg);
	sliceType$3 = $sliceType($Uint8);
	ptrType$2 = $ptrType(syntax.Prog);
	sliceType$4 = $sliceType(job);
	ptrType$3 = $ptrType(Regexp);
	sliceType$5 = $sliceType(entry);
	ptrType$4 = $ptrType(thread);
	sliceType$6 = $sliceType(ptrType$4);
	ptrType$5 = $ptrType(syntax.Inst);
	ptrType$6 = $ptrType($Int);
	arrayType = $arrayType($Uint8, 4);
	arrayType$1 = $arrayType($Uint8, 64);
	ptrType$7 = $ptrType(queueOnePass);
	sliceType$7 = $sliceType(onePassInst);
	ptrType$8 = $ptrType($Uint32);
	sliceType$8 = $sliceType(sliceType$1);
	ptrType$9 = $ptrType(sliceType$1);
	ptrType$10 = $ptrType(machine);
	sliceType$9 = $sliceType(ptrType$10);
	sliceType$10 = $sliceType($String);
	sliceType$11 = $sliceType(sliceType$3);
	sliceType$12 = $sliceType(sliceType);
	sliceType$13 = $sliceType(sliceType$11);
	sliceType$14 = $sliceType(sliceType$10);
	ptrType$11 = $ptrType(queue);
	funcType = $funcType([$String], [$String], false);
	funcType$1 = $funcType([sliceType$3, sliceType], [sliceType$3], false);
	funcType$2 = $funcType([sliceType$3], [sliceType$3], false);
	funcType$3 = $funcType([sliceType], [], false);
	ptrType$12 = $ptrType(inputString);
	ptrType$13 = $ptrType(inputBytes);
	ptrType$14 = $ptrType(inputReader);
	maxBitStateLen = function(prog) {
		var $ptr, _q, prog;
		if (!shouldBacktrack(prog)) {
			return 0;
		}
		return (_q = 262144 / prog.Inst.$length, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
	};
	newBitState = function(prog) {
		var $ptr, prog;
		if (!shouldBacktrack(prog)) {
			return notBacktrack;
		}
		return new bitState.ptr(prog, 0, sliceType.nil, $ifaceNil, sliceType$4.nil, sliceType$2.nil);
	};
	shouldBacktrack = function(prog) {
		var $ptr, prog;
		return prog.Inst.$length <= 500;
	};
	bitState.ptr.prototype.reset = function(end, ncap) {
		var $ptr, _i, _i$1, _q, _ref, _ref$1, b, end, i, i$1, ncap, visitedSize, x, x$1;
		b = this;
		b.end = end;
		if (b.jobs.$capacity === 0) {
			b.jobs = $makeSlice(sliceType$4, 0, 256);
		} else {
			b.jobs = $subslice(b.jobs, 0, 0);
		}
		visitedSize = (_q = (((($imul(b.prog.Inst.$length, ((end + 1 >> 0)))) + 32 >> 0) - 1 >> 0)) / 32, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		if (b.visited.$capacity < visitedSize) {
			b.visited = $makeSlice(sliceType$2, visitedSize, 8192);
		} else {
			b.visited = $subslice(b.visited, 0, visitedSize);
			_ref = b.visited;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				(x = b.visited, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i] = 0));
				_i++;
			}
		}
		if (b.cap.$capacity < ncap) {
			b.cap = $makeSlice(sliceType, ncap);
		} else {
			b.cap = $subslice(b.cap, 0, ncap);
		}
		_ref$1 = b.cap;
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			i$1 = _i$1;
			(x$1 = b.cap, ((i$1 < 0 || i$1 >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i$1] = -1));
			_i$1++;
		}
	};
	bitState.prototype.reset = function(end, ncap) { return this.$val.reset(end, ncap); };
	bitState.ptr.prototype.shouldVisit = function(pc, pos) {
		var $ptr, _index, _q, _q$1, b, n, pc, pos, x, x$1, x$2, x$3, y, y$1;
		b = this;
		n = ((($imul((pc >> 0), ((b.end + 1 >> 0)))) + pos >> 0) >>> 0);
		if (!(((((x = b.visited, x$1 = (_q = n / 32, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero")), ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])) & (((y = (((n & 31) >>> 0)), y < 32 ? (1 << y) : 0) >>> 0))) >>> 0) === 0))) {
			return false;
		}
		_index = (_q$1 = n / 32, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
		(x$3 = b.visited, ((_index < 0 || _index >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + _index] = (((x$2 = b.visited, ((_index < 0 || _index >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + _index])) | (((y$1 = (((n & 31) >>> 0)), y$1 < 32 ? (1 << y$1) : 0) >>> 0))) >>> 0)));
		return true;
	};
	bitState.prototype.shouldVisit = function(pc, pos) { return this.$val.shouldVisit(pc, pos); };
	bitState.ptr.prototype.push = function(pc, pos, arg) {
		var $ptr, arg, b, pc, pos, x;
		b = this;
		if ((x = b.prog.Inst, ((pc < 0 || pc >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + pc])).Op === 5) {
			return;
		}
		if ((arg === 0) && !b.shouldVisit(pc, pos)) {
			return;
		}
		b.jobs = $append(b.jobs, new job.ptr(pc, arg, pos));
	};
	bitState.prototype.push = function(pc, pos, arg) { return this.$val.push(pc, pos, arg); };
	machine.ptr.prototype.tryBacktrack = function(b, i, pc, pos) {
		var $ptr, _1, _2, _3, _4, _r, _r$1, _r$2, _r$3, _r$4, _tuple, _tuple$1, _tuple$2, _tuple$3, arg, b, i, inst, l, longest, m, pc, pc$1, pos, pos$1, r, r$1, r$2, r$3, width, width$1, width$2, width$3, x, x$1, x$10, x$11, x$12, x$13, x$14, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _2 = $f._2; _3 = $f._3; _4 = $f._4; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; arg = $f.arg; b = $f.b; i = $f.i; inst = $f.inst; l = $f.l; longest = $f.longest; m = $f.m; pc = $f.pc; pc$1 = $f.pc$1; pos = $f.pos; pos$1 = $f.pos$1; r = $f.r; r$1 = $f.r$1; r$2 = $f.r$2; r$3 = $f.r$3; width = $f.width; width$1 = $f.width$1; width$2 = $f.width$2; width$3 = $f.width$3; x = $f.x; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$13 = $f.x$13; x$14 = $f.x$14; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		longest = m.re.longest;
		m.matched = false;
		b.push(pc, pos, 0);
		/* while (true) { */ case 1:
			/* if (!(b.jobs.$length > 0)) { break; } */ if(!(b.jobs.$length > 0)) { $s = 2; continue; }
			l = b.jobs.$length - 1 >> 0;
			pc$1 = (x = b.jobs, ((l < 0 || l >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + l])).pc;
			pos$1 = (x$1 = b.jobs, ((l < 0 || l >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + l])).pos;
			arg = (x$2 = b.jobs, ((l < 0 || l >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + l])).arg;
			b.jobs = $subslice(b.jobs, 0, l);
			/* goto Skip */ $s = 3; continue;
			/* CheckAndLoop: */ case 4:
			if (!b.shouldVisit(pc$1, pos$1)) {
				/* continue; */ $s = 1; continue;
			}
			/* Skip: */ case 3:
			inst = $clone((x$3 = b.prog.Inst, ((pc$1 < 0 || pc$1 >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + pc$1])), syntax.Inst);
				_1 = inst.Op;
				/* */ if (_1 === (5)) { $s = 6; continue; }
				/* */ if (_1 === (0)) { $s = 7; continue; }
				/* */ if (_1 === (1)) { $s = 8; continue; }
				/* */ if (_1 === (7)) { $s = 9; continue; }
				/* */ if (_1 === (8)) { $s = 10; continue; }
				/* */ if (_1 === (10)) { $s = 11; continue; }
				/* */ if (_1 === (9)) { $s = 12; continue; }
				/* */ if (_1 === (2)) { $s = 13; continue; }
				/* */ if (_1 === (3)) { $s = 14; continue; }
				/* */ if (_1 === (6)) { $s = 15; continue; }
				/* */ if (_1 === (4)) { $s = 16; continue; }
				/* */ $s = 17; continue;
				/* if (_1 === (5)) { */ case 6:
					$panic(new $String("unexpected InstFail"));
					$s = 18; continue;
				/* } else if (_1 === (0)) { */ case 7:
						_2 = arg;
						/* */ if (_2 === (0)) { $s = 20; continue; }
						/* */ if (_2 === (1)) { $s = 21; continue; }
						/* */ $s = 22; continue;
						/* if (_2 === (0)) { */ case 20:
							b.push(pc$1, pos$1, 1);
							pc$1 = inst.Out;
							/* goto CheckAndLoop */ $s = 4; continue;
							$s = 22; continue;
						/* } else if (_2 === (1)) { */ case 21:
							arg = 0;
							pc$1 = inst.Arg;
							/* goto CheckAndLoop */ $s = 4; continue;
						/* } */ case 22:
					case 19:
					$panic(new $String("bad arg in InstAlt"));
					$s = 18; continue;
				/* } else if (_1 === (1)) { */ case 8:
						_3 = (x$4 = b.prog.Inst, x$5 = inst.Out, ((x$5 < 0 || x$5 >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + x$5])).Op;
						/* */ if ((_3 === (7)) || (_3 === (8)) || (_3 === (9)) || (_3 === (10))) { $s = 24; continue; }
						/* */ $s = 25; continue;
						/* if ((_3 === (7)) || (_3 === (8)) || (_3 === (9)) || (_3 === (10))) { */ case 24:
							b.push(inst.Arg, pos$1, 0);
							pc$1 = inst.Arg;
							pos$1 = b.end;
							/* goto CheckAndLoop */ $s = 4; continue;
						/* } */ case 25:
					case 23:
					b.push(inst.Out, b.end, 0);
					pc$1 = inst.Out;
					/* goto CheckAndLoop */ $s = 4; continue;
					$s = 18; continue;
				/* } else if (_1 === (7)) { */ case 9:
					_r = i.step(pos$1); /* */ $s = 26; case 26: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					_tuple = _r;
					r = _tuple[0];
					width = _tuple[1];
					/* */ if (!inst.MatchRune(r)) { $s = 27; continue; }
					/* */ $s = 28; continue;
					/* if (!inst.MatchRune(r)) { */ case 27:
						/* continue; */ $s = 1; continue;
					/* } */ case 28:
					pos$1 = pos$1 + (width) >> 0;
					pc$1 = inst.Out;
					/* goto CheckAndLoop */ $s = 4; continue;
					$s = 18; continue;
				/* } else if (_1 === (8)) { */ case 10:
					_r$1 = i.step(pos$1); /* */ $s = 29; case 29: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					_tuple$1 = _r$1;
					r$1 = _tuple$1[0];
					width$1 = _tuple$1[1];
					/* */ if (!((r$1 === (x$6 = inst.Rune, (0 >= x$6.$length ? $throwRuntimeError("index out of range") : x$6.$array[x$6.$offset + 0]))))) { $s = 30; continue; }
					/* */ $s = 31; continue;
					/* if (!((r$1 === (x$6 = inst.Rune, (0 >= x$6.$length ? $throwRuntimeError("index out of range") : x$6.$array[x$6.$offset + 0]))))) { */ case 30:
						/* continue; */ $s = 1; continue;
					/* } */ case 31:
					pos$1 = pos$1 + (width$1) >> 0;
					pc$1 = inst.Out;
					/* goto CheckAndLoop */ $s = 4; continue;
					$s = 18; continue;
				/* } else if (_1 === (10)) { */ case 11:
					_r$2 = i.step(pos$1); /* */ $s = 32; case 32: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					_tuple$2 = _r$2;
					r$2 = _tuple$2[0];
					width$2 = _tuple$2[1];
					/* */ if ((r$2 === 10) || (r$2 === -1)) { $s = 33; continue; }
					/* */ $s = 34; continue;
					/* if ((r$2 === 10) || (r$2 === -1)) { */ case 33:
						/* continue; */ $s = 1; continue;
					/* } */ case 34:
					pos$1 = pos$1 + (width$2) >> 0;
					pc$1 = inst.Out;
					/* goto CheckAndLoop */ $s = 4; continue;
					$s = 18; continue;
				/* } else if (_1 === (9)) { */ case 12:
					_r$3 = i.step(pos$1); /* */ $s = 35; case 35: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					_tuple$3 = _r$3;
					r$3 = _tuple$3[0];
					width$3 = _tuple$3[1];
					/* */ if (r$3 === -1) { $s = 36; continue; }
					/* */ $s = 37; continue;
					/* if (r$3 === -1) { */ case 36:
						/* continue; */ $s = 1; continue;
					/* } */ case 37:
					pos$1 = pos$1 + (width$3) >> 0;
					pc$1 = inst.Out;
					/* goto CheckAndLoop */ $s = 4; continue;
					$s = 18; continue;
				/* } else if (_1 === (2)) { */ case 13:
						_4 = arg;
						/* */ if (_4 === (0)) { $s = 39; continue; }
						/* */ if (_4 === (1)) { $s = 40; continue; }
						/* */ $s = 41; continue;
						/* if (_4 === (0)) { */ case 39:
							if (0 <= inst.Arg && inst.Arg < (b.cap.$length >>> 0)) {
								b.push(pc$1, (x$7 = b.cap, x$8 = inst.Arg, ((x$8 < 0 || x$8 >= x$7.$length) ? $throwRuntimeError("index out of range") : x$7.$array[x$7.$offset + x$8])), 1);
								(x$9 = b.cap, x$10 = inst.Arg, ((x$10 < 0 || x$10 >= x$9.$length) ? $throwRuntimeError("index out of range") : x$9.$array[x$9.$offset + x$10] = pos$1));
							}
							pc$1 = inst.Out;
							/* goto CheckAndLoop */ $s = 4; continue;
							$s = 41; continue;
						/* } else if (_4 === (1)) { */ case 40:
							(x$11 = b.cap, x$12 = inst.Arg, ((x$12 < 0 || x$12 >= x$11.$length) ? $throwRuntimeError("index out of range") : x$11.$array[x$11.$offset + x$12] = pos$1));
							/* continue; */ $s = 1; continue;
						/* } */ case 41:
					case 38:
					$panic(new $String("bad arg in InstCapture"));
					/* continue; */ $s = 1; continue;
					$s = 18; continue;
				/* } else if (_1 === (3)) { */ case 14:
					_r$4 = i.context(pos$1); /* */ $s = 44; case 44: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					/* */ if (!(((((inst.Arg << 24 >>> 24) & ~_r$4) << 24 >>> 24) === 0))) { $s = 42; continue; }
					/* */ $s = 43; continue;
					/* if (!(((((inst.Arg << 24 >>> 24) & ~_r$4) << 24 >>> 24) === 0))) { */ case 42:
						/* continue; */ $s = 1; continue;
					/* } */ case 43:
					pc$1 = inst.Out;
					/* goto CheckAndLoop */ $s = 4; continue;
					$s = 18; continue;
				/* } else if (_1 === (6)) { */ case 15:
					pc$1 = inst.Out;
					/* goto CheckAndLoop */ $s = 4; continue;
					$s = 18; continue;
				/* } else if (_1 === (4)) { */ case 16:
					if (b.cap.$length === 0) {
						m.matched = true;
						return m.matched;
					}
					if (b.cap.$length > 1) {
						(x$13 = b.cap, (1 >= x$13.$length ? $throwRuntimeError("index out of range") : x$13.$array[x$13.$offset + 1] = pos$1));
					}
					if (!m.matched || (longest && pos$1 > 0 && pos$1 > (x$14 = m.matchcap, (1 >= x$14.$length ? $throwRuntimeError("index out of range") : x$14.$array[x$14.$offset + 1])))) {
						$copySlice(m.matchcap, b.cap);
					}
					m.matched = true;
					if (!longest) {
						return m.matched;
					}
					if (pos$1 === b.end) {
						return m.matched;
					}
					/* continue; */ $s = 1; continue;
					$s = 18; continue;
				/* } else { */ case 17:
					$panic(new $String("bad inst"));
				/* } */ case 18:
			case 5:
			$panic(new $String("unreachable"));
		/* } */ $s = 1; continue; case 2:
		return m.matched;
		/* */ } return; } if ($f === undefined) { $f = { $blk: machine.ptr.prototype.tryBacktrack }; } $f.$ptr = $ptr; $f._1 = _1; $f._2 = _2; $f._3 = _3; $f._4 = _4; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f.arg = arg; $f.b = b; $f.i = i; $f.inst = inst; $f.l = l; $f.longest = longest; $f.m = m; $f.pc = pc; $f.pc$1 = pc$1; $f.pos = pos; $f.pos$1 = pos$1; $f.r = r; $f.r$1 = r$1; $f.r$2 = r$2; $f.r$3 = r$3; $f.width = width; $f.width$1 = width$1; $f.width$2 = width$2; $f.width$3 = width$3; $f.x = x; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$13 = x$13; $f.x$14 = x$14; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.$s = $s; $f.$r = $r; return $f;
	};
	machine.prototype.tryBacktrack = function(b, i, pc, pos) { return this.$val.tryBacktrack(b, i, pc, pos); };
	machine.ptr.prototype.backtrack = function(i, pos, end, ncap) {
		var $ptr, _i, _r, _r$1, _r$2, _r$3, _r$4, _ref, _tuple, advance, b, end, i, i$1, m, ncap, pos, startCond, width, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _ref = $f._ref; _tuple = $f._tuple; advance = $f.advance; b = $f.b; end = $f.end; i = $f.i; i$1 = $f.i$1; m = $f.m; ncap = $f.ncap; pos = $f.pos; startCond = $f.startCond; width = $f.width; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		_r = i.canCheckPrefix(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!_r) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!_r) { */ case 1:
			$panic(new $String("backtrack called for a RuneReader"));
		/* } */ case 2:
		startCond = m.re.cond;
		if (startCond === 255) {
			return false;
		}
		if (!((((startCond & 4) >>> 0) === 0)) && !((pos === 0))) {
			return false;
		}
		b = m.b;
		b.reset(end, ncap);
		m.matchcap = $subslice(m.matchcap, 0, ncap);
		_ref = m.matchcap;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i$1 = _i;
			(x = m.matchcap, ((i$1 < 0 || i$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i$1] = -1));
			_i++;
		}
		/* */ if (!((((startCond & 4) >>> 0) === 0))) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!((((startCond & 4) >>> 0) === 0))) { */ case 4:
			if (b.cap.$length > 0) {
				(x$1 = b.cap, (0 >= x$1.$length ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + 0] = pos));
			}
			_r$1 = m.tryBacktrack(b, i, (m.p.Start >>> 0), pos); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ $s = 7; case 7:
			return _r$1;
		/* } */ case 5:
		width = -1;
		/* while (true) { */ case 8:
			/* if (!(pos <= end && !((width === 0)))) { break; } */ if(!(pos <= end && !((width === 0)))) { $s = 9; continue; }
			/* */ if (m.re.prefix.length > 0) { $s = 10; continue; }
			/* */ $s = 11; continue;
			/* if (m.re.prefix.length > 0) { */ case 10:
				_r$2 = i.index(m.re, pos); /* */ $s = 12; case 12: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				advance = _r$2;
				if (advance < 0) {
					return false;
				}
				pos = pos + (advance) >> 0;
			/* } */ case 11:
			if (b.cap.$length > 0) {
				(x$2 = b.cap, (0 >= x$2.$length ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + 0] = pos));
			}
			_r$3 = m.tryBacktrack(b, i, (m.p.Start >>> 0), pos); /* */ $s = 15; case 15: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			/* */ if (_r$3) { $s = 13; continue; }
			/* */ $s = 14; continue;
			/* if (_r$3) { */ case 13:
				return true;
			/* } */ case 14:
			_r$4 = i.step(pos); /* */ $s = 16; case 16: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			_tuple = _r$4;
			width = _tuple[1];
			pos = pos + (width) >> 0;
		/* } */ $s = 8; continue; case 9:
		return false;
		/* */ } return; } if ($f === undefined) { $f = { $blk: machine.ptr.prototype.backtrack }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._ref = _ref; $f._tuple = _tuple; $f.advance = advance; $f.b = b; $f.end = end; $f.i = i; $f.i$1 = i$1; $f.m = m; $f.ncap = ncap; $f.pos = pos; $f.startCond = startCond; $f.width = width; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	machine.prototype.backtrack = function(i, pos, end, ncap) { return this.$val.backtrack(i, pos, end, ncap); };
	machine.ptr.prototype.newInputBytes = function(b) {
		var $ptr, b, m;
		m = this;
		m.inputBytes.str = b;
		return m.inputBytes;
	};
	machine.prototype.newInputBytes = function(b) { return this.$val.newInputBytes(b); };
	machine.ptr.prototype.newInputString = function(s) {
		var $ptr, m, s;
		m = this;
		m.inputString.str = s;
		return m.inputString;
	};
	machine.prototype.newInputString = function(s) { return this.$val.newInputString(s); };
	machine.ptr.prototype.newInputReader = function(r) {
		var $ptr, m, r;
		m = this;
		m.inputReader.r = r;
		m.inputReader.atEOT = false;
		m.inputReader.pos = 0;
		return m.inputReader;
	};
	machine.prototype.newInputReader = function(r) { return this.$val.newInputReader(r); };
	progMachine = function(p, op) {
		var $ptr, m, n, ncap, op, p;
		m = new machine.ptr(ptrType$3.nil, p, op, 0, ptrType.nil, new queue.ptr(sliceType$2.nil, sliceType$5.nil), new queue.ptr(sliceType$2.nil, sliceType$5.nil), sliceType$6.nil, false, sliceType.nil, new inputBytes.ptr(sliceType$3.nil), new inputString.ptr(""), new inputReader.ptr($ifaceNil, false, 0));
		n = m.p.Inst.$length;
		queue.copy(m.q0, new queue.ptr($makeSlice(sliceType$2, n), $makeSlice(sliceType$5, 0, n)));
		queue.copy(m.q1, new queue.ptr($makeSlice(sliceType$2, n), $makeSlice(sliceType$5, 0, n)));
		ncap = p.NumCap;
		if (ncap < 2) {
			ncap = 2;
		}
		if (op === notOnePass) {
			m.maxBitStateLen = maxBitStateLen(p);
		}
		m.matchcap = $makeSlice(sliceType, ncap);
		return m;
	};
	machine.ptr.prototype.init = function(ncap) {
		var $ptr, _i, _ref, m, ncap, t;
		m = this;
		_ref = m.pool;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			t = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			t.cap = $subslice(t.cap, 0, ncap);
			_i++;
		}
		m.matchcap = $subslice(m.matchcap, 0, ncap);
	};
	machine.prototype.init = function(ncap) { return this.$val.init(ncap); };
	machine.ptr.prototype.alloc = function(i) {
		var $ptr, i, m, n, t, x, x$1;
		m = this;
		t = ptrType$4.nil;
		n = m.pool.$length;
		if (n > 0) {
			t = (x = m.pool, x$1 = n - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
			m.pool = $subslice(m.pool, 0, (n - 1 >> 0));
		} else {
			t = new thread.ptr(ptrType$5.nil, sliceType.nil);
			t.cap = $makeSlice(sliceType, m.matchcap.$length, m.matchcap.$capacity);
		}
		t.inst = i;
		return t;
	};
	machine.prototype.alloc = function(i) { return this.$val.alloc(i); };
	machine.ptr.prototype.match = function(i, pos) {
		var $ptr, _i, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _ref, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _v, advance, flag, i, i$1, m, nextq, pos, r, r1, runq, startCond, width, width1, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _ref = $f._ref; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tmp$8 = $f._tmp$8; _tmp$9 = $f._tmp$9; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _v = $f._v; advance = $f.advance; flag = $f.flag; i = $f.i; i$1 = $f.i$1; m = $f.m; nextq = $f.nextq; pos = $f.pos; r = $f.r; r1 = $f.r1; runq = $f.runq; startCond = $f.startCond; width = $f.width; width1 = $f.width1; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		startCond = m.re.cond;
		if (startCond === 255) {
			return false;
		}
		m.matched = false;
		_ref = m.matchcap;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i$1 = _i;
			(x = m.matchcap, ((i$1 < 0 || i$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i$1] = -1));
			_i++;
		}
		_tmp = m.q0;
		_tmp$1 = m.q1;
		runq = _tmp;
		nextq = _tmp$1;
		_tmp$2 = -1;
		_tmp$3 = -1;
		r = _tmp$2;
		r1 = _tmp$3;
		_tmp$4 = 0;
		_tmp$5 = 0;
		width = _tmp$4;
		width1 = _tmp$5;
		_r = i.step(pos); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		r = _tuple[0];
		width = _tuple[1];
		/* */ if (!((r === -1))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((r === -1))) { */ case 2:
			_r$1 = i.step(pos + width >> 0); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple$1 = _r$1;
			r1 = _tuple$1[0];
			width1 = _tuple$1[1];
		/* } */ case 3:
		flag = 0;
		/* */ if (pos === 0) { $s = 5; continue; }
		/* */ $s = 6; continue;
		/* if (pos === 0) { */ case 5:
			flag = syntax.EmptyOpContext(-1, r);
			$s = 7; continue;
		/* } else { */ case 6:
			_r$2 = i.context(pos); /* */ $s = 8; case 8: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			flag = _r$2;
		/* } */ case 7:
		/* while (true) { */ case 9:
			/* */ if (runq.dense.$length === 0) { $s = 11; continue; }
			/* */ $s = 12; continue;
			/* if (runq.dense.$length === 0) { */ case 11:
				if (!((((startCond & 4) >>> 0) === 0)) && !((pos === 0))) {
					/* break; */ $s = 10; continue;
				}
				if (m.matched) {
					/* break; */ $s = 10; continue;
				}
				if (!(m.re.prefix.length > 0 && !((r1 === m.re.prefixRune)))) { _v = false; $s = 15; continue s; }
				_r$3 = i.canCheckPrefix(); /* */ $s = 16; case 16: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				_v = _r$3; case 15:
				/* */ if (_v) { $s = 13; continue; }
				/* */ $s = 14; continue;
				/* if (_v) { */ case 13:
					_r$4 = i.index(m.re, pos); /* */ $s = 17; case 17: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					advance = _r$4;
					if (advance < 0) {
						/* break; */ $s = 10; continue;
					}
					pos = pos + (advance) >> 0;
					_r$5 = i.step(pos); /* */ $s = 18; case 18: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
					_tuple$2 = _r$5;
					r = _tuple$2[0];
					width = _tuple$2[1];
					_r$6 = i.step(pos + width >> 0); /* */ $s = 19; case 19: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
					_tuple$3 = _r$6;
					r1 = _tuple$3[0];
					width1 = _tuple$3[1];
				/* } */ case 14:
			/* } */ case 12:
			if (!m.matched) {
				if (m.matchcap.$length > 0) {
					(x$1 = m.matchcap, (0 >= x$1.$length ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + 0] = pos));
				}
				m.add(runq, (m.p.Start >>> 0), pos, m.matchcap, flag, ptrType$4.nil);
			}
			flag = syntax.EmptyOpContext(r, r1);
			m.step(runq, nextq, pos, pos + width >> 0, r, flag);
			if (width === 0) {
				/* break; */ $s = 10; continue;
			}
			if ((m.matchcap.$length === 0) && m.matched) {
				/* break; */ $s = 10; continue;
			}
			pos = pos + (width) >> 0;
			_tmp$6 = r1;
			_tmp$7 = width1;
			r = _tmp$6;
			width = _tmp$7;
			/* */ if (!((r === -1))) { $s = 20; continue; }
			/* */ $s = 21; continue;
			/* if (!((r === -1))) { */ case 20:
				_r$7 = i.step(pos + width >> 0); /* */ $s = 22; case 22: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
				_tuple$4 = _r$7;
				r1 = _tuple$4[0];
				width1 = _tuple$4[1];
			/* } */ case 21:
			_tmp$8 = nextq;
			_tmp$9 = runq;
			runq = _tmp$8;
			nextq = _tmp$9;
		/* } */ $s = 9; continue; case 10:
		m.clear(nextq);
		return m.matched;
		/* */ } return; } if ($f === undefined) { $f = { $blk: machine.ptr.prototype.match }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._ref = _ref; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tmp$8 = _tmp$8; $f._tmp$9 = _tmp$9; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._v = _v; $f.advance = advance; $f.flag = flag; $f.i = i; $f.i$1 = i$1; $f.m = m; $f.nextq = nextq; $f.pos = pos; $f.r = r; $f.r1 = r1; $f.runq = runq; $f.startCond = startCond; $f.width = width; $f.width1 = width1; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	machine.prototype.match = function(i, pos) { return this.$val.match(i, pos); };
	machine.ptr.prototype.clear = function(q) {
		var $ptr, _i, _ref, d, m, q;
		m = this;
		_ref = q.dense;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			d = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), entry);
			if (!(d.t === ptrType$4.nil)) {
				m.pool = $append(m.pool, d.t);
			}
			_i++;
		}
		q.dense = $subslice(q.dense, 0, 0);
	};
	machine.prototype.clear = function(q) { return this.$val.clear(q); };
	machine.ptr.prototype.step = function(runq, nextq, pos, nextPos, c, nextCond) {
		var $ptr, _1, _i, _ref, add, c, d, d$1, i, j, longest, m, nextCond, nextPos, nextq, pos, runq, t, x, x$1, x$2, x$3, x$4, x$5;
		m = this;
		longest = m.re.longest;
		j = 0;
		while (true) {
			if (!(j < runq.dense.$length)) { break; }
			d = (x = runq.dense, ((j < 0 || j >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + j]));
			t = d.t;
			if (t === ptrType$4.nil) {
				j = j + (1) >> 0;
				continue;
			}
			if (longest && m.matched && t.cap.$length > 0 && (x$1 = m.matchcap, (0 >= x$1.$length ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + 0])) < (x$2 = t.cap, (0 >= x$2.$length ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + 0]))) {
				m.pool = $append(m.pool, t);
				j = j + (1) >> 0;
				continue;
			}
			i = t.inst;
			add = false;
			_1 = i.Op;
			if (_1 === (4)) {
				if (t.cap.$length > 0 && (!longest || !m.matched || (x$3 = m.matchcap, (1 >= x$3.$length ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 1])) < pos)) {
					(x$4 = t.cap, (1 >= x$4.$length ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + 1] = pos));
					$copySlice(m.matchcap, t.cap);
				}
				if (!longest) {
					_ref = $subslice(runq.dense, (j + 1 >> 0));
					_i = 0;
					while (true) {
						if (!(_i < _ref.$length)) { break; }
						d$1 = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), entry);
						if (!(d$1.t === ptrType$4.nil)) {
							m.pool = $append(m.pool, d$1.t);
						}
						_i++;
					}
					runq.dense = $subslice(runq.dense, 0, 0);
				}
				m.matched = true;
			} else if (_1 === (7)) {
				add = i.MatchRune(c);
			} else if (_1 === (8)) {
				add = c === (x$5 = i.Rune, (0 >= x$5.$length ? $throwRuntimeError("index out of range") : x$5.$array[x$5.$offset + 0]));
			} else if (_1 === (9)) {
				add = true;
			} else if (_1 === (10)) {
				add = !((c === 10));
			} else {
				$panic(new $String("bad inst"));
			}
			if (add) {
				t = m.add(nextq, i.Out, nextPos, t.cap, nextCond, t);
			}
			if (!(t === ptrType$4.nil)) {
				m.pool = $append(m.pool, t);
			}
			j = j + (1) >> 0;
		}
		runq.dense = $subslice(runq.dense, 0, 0);
	};
	machine.prototype.step = function(runq, nextq, pos, nextPos, c, nextCond) { return this.$val.step(runq, nextq, pos, nextPos, c, nextCond); };
	machine.ptr.prototype.add = function(q, pc, pos, cap, cond, t) {
		var $ptr, _1, cap, cond, d, i, j, j$1, m, opos, pc, pos, q, t, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8;
		m = this;
		if (pc === 0) {
			return t;
		}
		j = (x = q.sparse, ((pc < 0 || pc >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + pc]));
		if (j < (q.dense.$length >>> 0) && ((x$1 = q.dense, ((j < 0 || j >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + j])).pc === pc)) {
			return t;
		}
		j$1 = q.dense.$length;
		q.dense = $subslice(q.dense, 0, (j$1 + 1 >> 0));
		d = (x$2 = q.dense, ((j$1 < 0 || j$1 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + j$1]));
		d.t = ptrType$4.nil;
		d.pc = pc;
		(x$3 = q.sparse, ((pc < 0 || pc >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + pc] = (j$1 >>> 0)));
		i = (x$4 = m.p.Inst, ((pc < 0 || pc >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + pc]));
		_1 = i.Op;
		if (_1 === (5)) {
		} else if ((_1 === (0)) || (_1 === (1))) {
			t = m.add(q, i.Out, pos, cap, cond, t);
			t = m.add(q, i.Arg, pos, cap, cond, t);
		} else if (_1 === (3)) {
			if ((((i.Arg << 24 >>> 24) & ~cond) << 24 >>> 24) === 0) {
				t = m.add(q, i.Out, pos, cap, cond, t);
			}
		} else if (_1 === (6)) {
			t = m.add(q, i.Out, pos, cap, cond, t);
		} else if (_1 === (2)) {
			if ((i.Arg >> 0) < cap.$length) {
				opos = (x$5 = i.Arg, ((x$5 < 0 || x$5 >= cap.$length) ? $throwRuntimeError("index out of range") : cap.$array[cap.$offset + x$5]));
				(x$6 = i.Arg, ((x$6 < 0 || x$6 >= cap.$length) ? $throwRuntimeError("index out of range") : cap.$array[cap.$offset + x$6] = pos));
				m.add(q, i.Out, pos, cap, cond, ptrType$4.nil);
				(x$7 = i.Arg, ((x$7 < 0 || x$7 >= cap.$length) ? $throwRuntimeError("index out of range") : cap.$array[cap.$offset + x$7] = opos));
			} else {
				t = m.add(q, i.Out, pos, cap, cond, t);
			}
		} else if ((_1 === (4)) || (_1 === (7)) || (_1 === (8)) || (_1 === (9)) || (_1 === (10))) {
			if (t === ptrType$4.nil) {
				t = m.alloc(i);
			} else {
				t.inst = i;
			}
			if (cap.$length > 0 && !((x$8 = t.cap, $indexPtr(x$8.$array, x$8.$offset + 0, ptrType$6)) === $indexPtr(cap.$array, cap.$offset + 0, ptrType$6))) {
				$copySlice(t.cap, cap);
			}
			d.t = t;
			t = ptrType$4.nil;
		} else {
			$panic(new $String("unhandled"));
		}
		return t;
	};
	machine.prototype.add = function(q, pc, pos, cap, cond, t) { return this.$val.add(q, pc, pos, cap, cond, t); };
	machine.ptr.prototype.onepass = function(i, pos) {
		var $ptr, _1, _i, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _ref, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _v, flag, i, i$1, inst, m, pc, pos, r, r1, startCond, width, width1, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _ref = $f._ref; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _v = $f._v; flag = $f.flag; i = $f.i; i$1 = $f.i$1; inst = $f.inst; m = $f.m; pc = $f.pc; pos = $f.pos; r = $f.r; r1 = $f.r1; startCond = $f.startCond; width = $f.width; width1 = $f.width1; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		inst = [inst];
		m = this;
		startCond = m.re.cond;
		if (startCond === 255) {
			return false;
		}
		m.matched = false;
		_ref = m.matchcap;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i$1 = _i;
			(x = m.matchcap, ((i$1 < 0 || i$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i$1] = -1));
			_i++;
		}
		_tmp = -1;
		_tmp$1 = -1;
		r = _tmp;
		r1 = _tmp$1;
		_tmp$2 = 0;
		_tmp$3 = 0;
		width = _tmp$2;
		width1 = _tmp$3;
		_r = i.step(pos); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		r = _tuple[0];
		width = _tuple[1];
		/* */ if (!((r === -1))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((r === -1))) { */ case 2:
			_r$1 = i.step(pos + width >> 0); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple$1 = _r$1;
			r1 = _tuple$1[0];
			width1 = _tuple$1[1];
		/* } */ case 3:
		flag = 0;
		/* */ if (pos === 0) { $s = 5; continue; }
		/* */ $s = 6; continue;
		/* if (pos === 0) { */ case 5:
			flag = syntax.EmptyOpContext(-1, r);
			$s = 7; continue;
		/* } else { */ case 6:
			_r$2 = i.context(pos); /* */ $s = 8; case 8: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			flag = _r$2;
		/* } */ case 7:
		pc = m.op.Start;
		inst[0] = $clone((x$1 = m.op.Inst, ((pc < 0 || pc >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + pc])), onePassInst);
		if (!((pos === 0) && ((((inst[0].Inst.Arg << 24 >>> 24) & ~flag) << 24 >>> 24) === 0) && m.re.prefix.length > 0)) { _v = false; $s = 11; continue s; }
		_r$3 = i.canCheckPrefix(); /* */ $s = 12; case 12: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		_v = _r$3; case 11:
		/* */ if (_v) { $s = 9; continue; }
		/* */ $s = 10; continue;
		/* if (_v) { */ case 9:
			_r$4 = i.hasPrefix(m.re); /* */ $s = 16; case 16: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			/* */ if (_r$4) { $s = 13; continue; }
			/* */ $s = 14; continue;
			/* if (_r$4) { */ case 13:
				pos = pos + (m.re.prefix.length) >> 0;
				_r$5 = i.step(pos); /* */ $s = 17; case 17: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
				_tuple$2 = _r$5;
				r = _tuple$2[0];
				width = _tuple$2[1];
				_r$6 = i.step(pos + width >> 0); /* */ $s = 18; case 18: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
				_tuple$3 = _r$6;
				r1 = _tuple$3[0];
				width1 = _tuple$3[1];
				_r$7 = i.context(pos); /* */ $s = 19; case 19: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
				flag = _r$7;
				pc = (m.re.prefixEnd >> 0);
				$s = 15; continue;
			/* } else { */ case 14:
				return m.matched;
			/* } */ case 15:
		/* } */ case 10:
		/* while (true) { */ case 20:
			onePassInst.copy(inst[0], (x$2 = m.op.Inst, ((pc < 0 || pc >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + pc])));
			pc = (inst[0].Inst.Out >> 0);
				_1 = inst[0].Inst.Op;
				/* */ if (_1 === (4)) { $s = 23; continue; }
				/* */ if (_1 === (7)) { $s = 24; continue; }
				/* */ if (_1 === (8)) { $s = 25; continue; }
				/* */ if (_1 === (9)) { $s = 26; continue; }
				/* */ if (_1 === (10)) { $s = 27; continue; }
				/* */ if ((_1 === (0)) || (_1 === (1))) { $s = 28; continue; }
				/* */ if (_1 === (5)) { $s = 29; continue; }
				/* */ if (_1 === (6)) { $s = 30; continue; }
				/* */ if (_1 === (3)) { $s = 31; continue; }
				/* */ if (_1 === (2)) { $s = 32; continue; }
				/* */ $s = 33; continue;
				/* if (_1 === (4)) { */ case 23:
					m.matched = true;
					if (m.matchcap.$length > 0) {
						(x$3 = m.matchcap, (0 >= x$3.$length ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 0] = 0));
						(x$4 = m.matchcap, (1 >= x$4.$length ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + 1] = pos));
					}
					return m.matched;
				/* } else if (_1 === (7)) { */ case 24:
					if (!inst[0].Inst.MatchRune(r)) {
						return m.matched;
					}
					$s = 34; continue;
				/* } else if (_1 === (8)) { */ case 25:
					if (!((r === (x$5 = inst[0].Inst.Rune, (0 >= x$5.$length ? $throwRuntimeError("index out of range") : x$5.$array[x$5.$offset + 0]))))) {
						return m.matched;
					}
					$s = 34; continue;
				/* } else if (_1 === (9)) { */ case 26:
					$s = 34; continue;
				/* } else if (_1 === (10)) { */ case 27:
					if (r === 10) {
						return m.matched;
					}
					$s = 34; continue;
				/* } else if ((_1 === (0)) || (_1 === (1))) { */ case 28:
					pc = (onePassNext(inst[0], r) >> 0);
					/* continue; */ $s = 20; continue;
					$s = 34; continue;
				/* } else if (_1 === (5)) { */ case 29:
					return m.matched;
				/* } else if (_1 === (6)) { */ case 30:
					/* continue; */ $s = 20; continue;
					$s = 34; continue;
				/* } else if (_1 === (3)) { */ case 31:
					if (!(((((inst[0].Inst.Arg << 24 >>> 24) & ~flag) << 24 >>> 24) === 0))) {
						return m.matched;
					}
					/* continue; */ $s = 20; continue;
					$s = 34; continue;
				/* } else if (_1 === (2)) { */ case 32:
					if ((inst[0].Inst.Arg >> 0) < m.matchcap.$length) {
						(x$6 = m.matchcap, x$7 = inst[0].Inst.Arg, ((x$7 < 0 || x$7 >= x$6.$length) ? $throwRuntimeError("index out of range") : x$6.$array[x$6.$offset + x$7] = pos));
					}
					/* continue; */ $s = 20; continue;
					$s = 34; continue;
				/* } else { */ case 33:
					$panic(new $String("bad inst"));
				/* } */ case 34:
			case 22:
			if (width === 0) {
				/* break; */ $s = 21; continue;
			}
			flag = syntax.EmptyOpContext(r, r1);
			pos = pos + (width) >> 0;
			_tmp$4 = r1;
			_tmp$5 = width1;
			r = _tmp$4;
			width = _tmp$5;
			/* */ if (!((r === -1))) { $s = 35; continue; }
			/* */ $s = 36; continue;
			/* if (!((r === -1))) { */ case 35:
				_r$8 = i.step(pos + width >> 0); /* */ $s = 37; case 37: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
				_tuple$4 = _r$8;
				r1 = _tuple$4[0];
				width1 = _tuple$4[1];
			/* } */ case 36:
		/* } */ $s = 20; continue; case 21:
		return m.matched;
		/* */ } return; } if ($f === undefined) { $f = { $blk: machine.ptr.prototype.onepass }; } $f.$ptr = $ptr; $f._1 = _1; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._ref = _ref; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._v = _v; $f.flag = flag; $f.i = i; $f.i$1 = i$1; $f.inst = inst; $f.m = m; $f.pc = pc; $f.pos = pos; $f.r = r; $f.r1 = r1; $f.startCond = startCond; $f.width = width; $f.width1 = width1; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.$s = $s; $f.$r = $r; return $f;
	};
	machine.prototype.onepass = function(i, pos) { return this.$val.onepass(i, pos); };
	Regexp.ptr.prototype.doExecute = function(r, b, s, pos, ncap) {
		var $ptr, _r, _r$1, _r$2, b, cap, i, m, ncap, pos, r, re, s, size, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; b = $f.b; cap = $f.cap; i = $f.i; m = $f.m; ncap = $f.ncap; pos = $f.pos; r = $f.r; re = $f.re; s = $f.s; size = $f.size; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = this;
		m = re.get();
		i = $ifaceNil;
		size = 0;
		if (!($interfaceIsEqual(r, $ifaceNil))) {
			i = m.newInputReader(r);
		} else if (!(b === sliceType$3.nil)) {
			i = m.newInputBytes(b);
			size = b.$length;
		} else {
			i = m.newInputString(s);
			size = s.length;
		}
		/* */ if (!(m.op === notOnePass)) { $s = 1; continue; }
		/* */ if (size < m.maxBitStateLen && $interfaceIsEqual(r, $ifaceNil)) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!(m.op === notOnePass)) { */ case 1:
			_r = m.onepass(i, pos); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (!_r) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (!_r) { */ case 5:
				re.put(m);
				return sliceType.nil;
			/* } */ case 6:
			$s = 4; continue;
		/* } else if (size < m.maxBitStateLen && $interfaceIsEqual(r, $ifaceNil)) { */ case 2:
			if (m.b === ptrType.nil) {
				m.b = newBitState(m.p);
			}
			_r$1 = m.backtrack(i, pos, size, ncap); /* */ $s = 10; case 10: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ if (!_r$1) { $s = 8; continue; }
			/* */ $s = 9; continue;
			/* if (!_r$1) { */ case 8:
				re.put(m);
				return sliceType.nil;
			/* } */ case 9:
			$s = 4; continue;
		/* } else { */ case 3:
			m.init(ncap);
			_r$2 = m.match(i, pos); /* */ $s = 13; case 13: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			/* */ if (!_r$2) { $s = 11; continue; }
			/* */ $s = 12; continue;
			/* if (!_r$2) { */ case 11:
				re.put(m);
				return sliceType.nil;
			/* } */ case 12:
		/* } */ case 4:
		if (ncap === 0) {
			re.put(m);
			return empty;
		}
		cap = $makeSlice(sliceType, m.matchcap.$length);
		$copySlice(cap, m.matchcap);
		re.put(m);
		return cap;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.doExecute }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.b = b; $f.cap = cap; $f.i = i; $f.m = m; $f.ncap = ncap; $f.pos = pos; $f.r = r; $f.re = re; $f.s = s; $f.size = size; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.doExecute = function(r, b, s, pos, ncap) { return this.$val.doExecute(r, b, s, pos, ncap); };
	onePassPrefix = function(p) {
		var $ptr, _tmp, _tmp$1, _tmp$10, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, buf, complete, i, p, pc, prefix, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8;
		prefix = "";
		complete = false;
		pc = 0;
		i = (x = p.Inst, x$1 = p.Start, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		if (!((i.Op === 3)) || (((((i.Arg << 24 >>> 24)) & 4) >>> 0) === 0)) {
			_tmp = "";
			_tmp$1 = i.Op === 4;
			_tmp$2 = (p.Start >>> 0);
			prefix = _tmp;
			complete = _tmp$1;
			pc = _tmp$2;
			return [prefix, complete, pc];
		}
		pc = i.Out;
		i = (x$2 = p.Inst, ((pc < 0 || pc >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + pc]));
		while (true) {
			if (!(i.Op === 6)) { break; }
			pc = i.Out;
			i = (x$3 = p.Inst, ((pc < 0 || pc >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + pc]));
		}
		if (!((iop(i) === 7)) || !((i.Rune.$length === 1))) {
			_tmp$3 = "";
			_tmp$4 = i.Op === 4;
			_tmp$5 = (p.Start >>> 0);
			prefix = _tmp$3;
			complete = _tmp$4;
			pc = _tmp$5;
			return [prefix, complete, pc];
		}
		buf = new bytes.Buffer.ptr(sliceType$3.nil, 0, arrayType.zero(), arrayType$1.zero(), 0);
		while (true) {
			if (!((iop(i) === 7) && (i.Rune.$length === 1) && ((((i.Arg << 16 >>> 16) & 1) >>> 0) === 0))) { break; }
			buf.WriteRune((x$4 = i.Rune, (0 >= x$4.$length ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + 0])));
			_tmp$6 = i.Out;
			_tmp$7 = (x$5 = p.Inst, x$6 = i.Out, ((x$6 < 0 || x$6 >= x$5.$length) ? $throwRuntimeError("index out of range") : x$5.$array[x$5.$offset + x$6]));
			pc = _tmp$6;
			i = _tmp$7;
		}
		if ((i.Op === 3) && !(((((i.Arg << 24 >>> 24) & 8) >>> 0) === 0)) && ((x$7 = p.Inst, x$8 = i.Out, ((x$8 < 0 || x$8 >= x$7.$length) ? $throwRuntimeError("index out of range") : x$7.$array[x$7.$offset + x$8])).Op === 4)) {
			complete = true;
		}
		_tmp$8 = buf.String();
		_tmp$9 = complete;
		_tmp$10 = pc;
		prefix = _tmp$8;
		complete = _tmp$9;
		pc = _tmp$10;
		return [prefix, complete, pc];
	};
	onePassNext = function(i, r) {
		var $ptr, i, next, r, x;
		next = i.Inst.MatchRunePos(r);
		if (next >= 0) {
			return (x = i.Next, ((next < 0 || next >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + next]));
		}
		if (i.Inst.Op === 1) {
			return i.Inst.Out;
		}
		return 0;
	};
	iop = function(i) {
		var $ptr, _1, i, op;
		op = i.Op;
		_1 = op;
		if ((_1 === (8)) || (_1 === (9)) || (_1 === (10))) {
			op = 7;
		}
		return op;
	};
	queueOnePass.ptr.prototype.empty = function() {
		var $ptr, q;
		q = this;
		return q.nextIndex >= q.size;
	};
	queueOnePass.prototype.empty = function() { return this.$val.empty(); };
	queueOnePass.ptr.prototype.next = function() {
		var $ptr, n, q, x, x$1;
		n = 0;
		q = this;
		n = (x = q.dense, x$1 = q.nextIndex, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		q.nextIndex = q.nextIndex + (1) >>> 0;
		return n;
	};
	queueOnePass.prototype.next = function() { return this.$val.next(); };
	queueOnePass.ptr.prototype.clear = function() {
		var $ptr, q;
		q = this;
		q.size = 0;
		q.nextIndex = 0;
	};
	queueOnePass.prototype.clear = function() { return this.$val.clear(); };
	queueOnePass.ptr.prototype.contains = function(u) {
		var $ptr, q, u, x, x$1, x$2, x$3;
		q = this;
		if (u >= (q.sparse.$length >>> 0)) {
			return false;
		}
		return (x = q.sparse, ((u < 0 || u >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + u])) < q.size && ((x$1 = q.dense, x$2 = (x$3 = q.sparse, ((u < 0 || u >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + u])), ((x$2 < 0 || x$2 >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + x$2])) === u);
	};
	queueOnePass.prototype.contains = function(u) { return this.$val.contains(u); };
	queueOnePass.ptr.prototype.insert = function(u) {
		var $ptr, q, u;
		q = this;
		if (!q.contains(u)) {
			q.insertNew(u);
		}
	};
	queueOnePass.prototype.insert = function(u) { return this.$val.insert(u); };
	queueOnePass.ptr.prototype.insertNew = function(u) {
		var $ptr, q, u, x, x$1, x$2;
		q = this;
		if (u >= (q.sparse.$length >>> 0)) {
			return;
		}
		(x = q.sparse, ((u < 0 || u >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + u] = q.size));
		(x$1 = q.dense, x$2 = q.size, ((x$2 < 0 || x$2 >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + x$2] = u));
		q.size = q.size + (1) >>> 0;
	};
	queueOnePass.prototype.insertNew = function(u) { return this.$val.insertNew(u); };
	newQueue = function(size) {
		var $ptr, q, size;
		q = ptrType$7.nil;
		q = new queueOnePass.ptr($makeSlice(sliceType$2, size), $makeSlice(sliceType$2, size), 0, 0);
		return q;
	};
	mergeRuneSets = function(leftRunes, rightRunes, leftPC, rightPC) {
		var $ptr, _r, _r$1, _r$2, _r$3, _tmp, _tmp$1, extend, ix, leftLen, leftPC, leftRunes, lx, merged, next, ok, rightLen, rightPC, rightRunes, rx, x, x$1, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; extend = $f.extend; ix = $f.ix; leftLen = $f.leftLen; leftPC = $f.leftPC; leftRunes = $f.leftRunes; lx = $f.lx; merged = $f.merged; next = $f.next; ok = $f.ok; rightLen = $f.rightLen; rightPC = $f.rightPC; rightRunes = $f.rightRunes; rx = $f.rx; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		ix = [ix];
		lx = [lx];
		merged = [merged];
		next = [next];
		ok = [ok];
		rx = [rx];
		leftLen = leftRunes.$get().$length;
		rightLen = rightRunes.$get().$length;
		if (!(((leftLen & 1) === 0)) || !(((rightLen & 1) === 0))) {
			$panic(new $String("mergeRuneSets odd length []rune"));
		}
		_tmp = 0;
		_tmp$1 = 0;
		lx[0] = _tmp;
		rx[0] = _tmp$1;
		merged[0] = $makeSlice(sliceType$1, 0);
		next[0] = $makeSlice(sliceType$2, 0);
		ok[0] = true;
		$deferred.push([(function(ix, lx, merged, next, ok, rx) { return function() {
			var $ptr;
			if (!ok[0]) {
				merged[0] = sliceType$1.nil;
				next[0] = sliceType$2.nil;
			}
		}; })(ix, lx, merged, next, ok, rx), []]);
		ix[0] = -1;
		extend = (function(ix, lx, merged, next, ok, rx) { return function(newLow, newArray, pc) {
			var $ptr, newArray, newLow, pc, x, x$1, x$2, x$3, x$4, x$5;
			if (ix[0] > 0 && (x = newArray.$get(), x$1 = newLow.$get(), ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])) <= ((ix[0] < 0 || ix[0] >= merged[0].$length) ? $throwRuntimeError("index out of range") : merged[0].$array[merged[0].$offset + ix[0]])) {
				return false;
			}
			merged[0] = $append(merged[0], (x$2 = newArray.$get(), x$3 = newLow.$get(), ((x$3 < 0 || x$3 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + x$3])), (x$4 = newArray.$get(), x$5 = newLow.$get() + 1 >> 0, ((x$5 < 0 || x$5 >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + x$5])));
			newLow.$set(newLow.$get() + (2) >> 0);
			ix[0] = ix[0] + (2) >> 0;
			next[0] = $append(next[0], pc);
			return true;
		}; })(ix, lx, merged, next, ok, rx);
		/* while (true) { */ case 1:
			/* if (!(lx[0] < leftLen || rx[0] < rightLen)) { break; } */ if(!(lx[0] < leftLen || rx[0] < rightLen)) { $s = 2; continue; }
				/* */ if (rx[0] >= rightLen) { $s = 4; continue; }
				/* */ if (lx[0] >= leftLen) { $s = 5; continue; }
				/* */ if ((x = rightRunes.$get(), ((rx[0] < 0 || rx[0] >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + rx[0]])) < (x$1 = leftRunes.$get(), ((lx[0] < 0 || lx[0] >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + lx[0]]))) { $s = 6; continue; }
				/* */ $s = 7; continue;
				/* if (rx[0] >= rightLen) { */ case 4:
					_r = extend((lx.$ptr || (lx.$ptr = new ptrType$6(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, lx))), leftRunes, leftPC); /* */ $s = 9; case 9: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					ok[0] = _r;
					$s = 8; continue;
				/* } else if (lx[0] >= leftLen) { */ case 5:
					_r$1 = extend((rx.$ptr || (rx.$ptr = new ptrType$6(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, rx))), rightRunes, rightPC); /* */ $s = 10; case 10: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					ok[0] = _r$1;
					$s = 8; continue;
				/* } else if ((x = rightRunes.$get(), ((rx[0] < 0 || rx[0] >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + rx[0]])) < (x$1 = leftRunes.$get(), ((lx[0] < 0 || lx[0] >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + lx[0]]))) { */ case 6:
					_r$2 = extend((rx.$ptr || (rx.$ptr = new ptrType$6(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, rx))), rightRunes, rightPC); /* */ $s = 11; case 11: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					ok[0] = _r$2;
					$s = 8; continue;
				/* } else { */ case 7:
					_r$3 = extend((lx.$ptr || (lx.$ptr = new ptrType$6(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, lx))), leftRunes, leftPC); /* */ $s = 12; case 12: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					ok[0] = _r$3;
				/* } */ case 8:
			case 3:
			if (!ok[0]) {
				return [noRune, noNext];
			}
		/* } */ $s = 1; continue; case 2:
		return [merged[0], next[0]];
		/* */ } return; } } catch(err) { $err = err; $s = -1; return [sliceType$1.nil, sliceType$2.nil]; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: mergeRuneSets }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f.extend = extend; $f.ix = ix; $f.leftLen = leftLen; $f.leftPC = leftPC; $f.leftRunes = leftRunes; $f.lx = lx; $f.merged = merged; $f.next = next; $f.ok = ok; $f.rightLen = rightLen; $f.rightPC = rightPC; $f.rightRunes = rightRunes; $f.rx = rx; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	cleanupOnePass = function(prog, original) {
		var $ptr, _1, _i, _ref, instOriginal, ix, original, prog, x, x$1, x$2;
		_ref = original.Inst;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			ix = _i;
			instOriginal = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), syntax.Inst);
			_1 = instOriginal.Op;
			if ((_1 === (0)) || (_1 === (1)) || (_1 === (7))) {
			} else if ((_1 === (2)) || (_1 === (3)) || (_1 === (6)) || (_1 === (4)) || (_1 === (5))) {
				(x = prog.Inst, ((ix < 0 || ix >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + ix])).Next = sliceType$2.nil;
			} else if ((_1 === (8)) || (_1 === (9)) || (_1 === (10))) {
				(x$1 = prog.Inst, ((ix < 0 || ix >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + ix])).Next = sliceType$2.nil;
				onePassInst.copy((x$2 = prog.Inst, ((ix < 0 || ix >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + ix])), new onePassInst.ptr($clone(instOriginal, syntax.Inst), sliceType$2.nil));
			}
			_i++;
		}
	};
	onePassCopy = function(prog) {
		var $ptr, _1, _i, _i$1, _ref, _ref$1, _tmp, _tmp$1, _tmp$2, _tmp$3, inst, instAlt, instOther, p, p_A_Alt, p_A_Other, p_B_Alt, p_B_Other, patch, pc, prog, x, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$16, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		p = new onePassProg.ptr(sliceType$7.nil, prog.Start, prog.NumCap);
		_ref = prog.Inst;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			inst = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), syntax.Inst);
			p.Inst = $append(p.Inst, new onePassInst.ptr($clone(inst, syntax.Inst), sliceType$2.nil));
			_i++;
		}
		_ref$1 = p.Inst;
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			pc = _i$1;
			_1 = (x = p.Inst, ((pc < 0 || pc >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + pc])).Inst.Op;
			if ((_1 === (0)) || (_1 === (1))) {
				p_A_Other = (x$1 = (x$2 = p.Inst, ((pc < 0 || pc >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + pc])), (x$1.$ptr_Out || (x$1.$ptr_Out = new ptrType$8(function() { return this.$target.Inst.Out; }, function($v) { this.$target.Inst.Out = $v; }, x$1))));
				p_A_Alt = (x$3 = (x$4 = p.Inst, ((pc < 0 || pc >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + pc])), (x$3.$ptr_Arg || (x$3.$ptr_Arg = new ptrType$8(function() { return this.$target.Inst.Arg; }, function($v) { this.$target.Inst.Arg = $v; }, x$3))));
				instAlt = $clone((x$5 = p.Inst, x$6 = p_A_Alt.$get(), ((x$6 < 0 || x$6 >= x$5.$length) ? $throwRuntimeError("index out of range") : x$5.$array[x$5.$offset + x$6])), onePassInst);
				if (!((instAlt.Inst.Op === 0) || (instAlt.Inst.Op === 1))) {
					_tmp = p_A_Other;
					_tmp$1 = p_A_Alt;
					p_A_Alt = _tmp;
					p_A_Other = _tmp$1;
					onePassInst.copy(instAlt, (x$7 = p.Inst, x$8 = p_A_Alt.$get(), ((x$8 < 0 || x$8 >= x$7.$length) ? $throwRuntimeError("index out of range") : x$7.$array[x$7.$offset + x$8])));
					if (!((instAlt.Inst.Op === 0) || (instAlt.Inst.Op === 1))) {
						_i$1++;
						continue;
					}
				}
				instOther = $clone((x$9 = p.Inst, x$10 = p_A_Other.$get(), ((x$10 < 0 || x$10 >= x$9.$length) ? $throwRuntimeError("index out of range") : x$9.$array[x$9.$offset + x$10])), onePassInst);
				if ((instOther.Inst.Op === 0) || (instOther.Inst.Op === 1)) {
					_i$1++;
					continue;
				}
				p_B_Alt = (x$11 = (x$12 = p.Inst, x$13 = p_A_Alt.$get(), ((x$13 < 0 || x$13 >= x$12.$length) ? $throwRuntimeError("index out of range") : x$12.$array[x$12.$offset + x$13])), (x$11.$ptr_Out || (x$11.$ptr_Out = new ptrType$8(function() { return this.$target.Inst.Out; }, function($v) { this.$target.Inst.Out = $v; }, x$11))));
				p_B_Other = (x$14 = (x$15 = p.Inst, x$16 = p_A_Alt.$get(), ((x$16 < 0 || x$16 >= x$15.$length) ? $throwRuntimeError("index out of range") : x$15.$array[x$15.$offset + x$16])), (x$14.$ptr_Arg || (x$14.$ptr_Arg = new ptrType$8(function() { return this.$target.Inst.Arg; }, function($v) { this.$target.Inst.Arg = $v; }, x$14))));
				patch = false;
				if (instAlt.Inst.Out === (pc >>> 0)) {
					patch = true;
				} else if (instAlt.Inst.Arg === (pc >>> 0)) {
					patch = true;
					_tmp$2 = p_B_Other;
					_tmp$3 = p_B_Alt;
					p_B_Alt = _tmp$2;
					p_B_Other = _tmp$3;
				}
				if (patch) {
					p_B_Alt.$set(p_A_Other.$get());
				}
				if (p_A_Other.$get() === p_B_Alt.$get()) {
					p_A_Alt.$set(p_B_Other.$get());
				}
			} else {
				_i$1++;
				continue;
			}
			_i$1++;
		}
		return p;
	};
	runeSlice.prototype.Len = function() {
		var $ptr, p;
		p = this;
		return p.$length;
	};
	$ptrType(runeSlice).prototype.Len = function() { return this.$get().Len(); };
	runeSlice.prototype.Less = function(i, j) {
		var $ptr, i, j, p;
		p = this;
		return ((i < 0 || i >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + i]) < ((j < 0 || j >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + j]);
	};
	$ptrType(runeSlice).prototype.Less = function(i, j) { return this.$get().Less(i, j); };
	runeSlice.prototype.Swap = function(i, j) {
		var $ptr, _tmp, _tmp$1, i, j, p;
		p = this;
		_tmp = ((j < 0 || j >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + j]);
		_tmp$1 = ((i < 0 || i >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + i]);
		((i < 0 || i >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + i] = _tmp);
		((j < 0 || j >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + j] = _tmp$1);
	};
	$ptrType(runeSlice).prototype.Swap = function(i, j) { return this.$get().Swap(i, j); };
	runeSlice.prototype.Sort = function() {
		var $ptr, p, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; p = $f.p; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		$r = sort.Sort(p); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: runeSlice.prototype.Sort }; } $f.$ptr = $ptr; $f.p = p; $f.$s = $s; $f.$r = $r; return $f;
	};
	$ptrType(runeSlice).prototype.Sort = function() { return this.$get().Sort(); };
	makeOnePass = function(p) {
		var $ptr, _i, _r, _ref, check, i, instQueue, m, onePassRunes, p, pc, visitQueue, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; check = $f.check; i = $f.i; instQueue = $f.instQueue; m = $f.m; onePassRunes = $f.onePassRunes; p = $f.p; pc = $f.pc; visitQueue = $f.visitQueue; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		check = [check];
		instQueue = [instQueue];
		onePassRunes = [onePassRunes];
		p = [p];
		visitQueue = [visitQueue];
		if (p[0].Inst.$length >= 1000) {
			return notOnePass;
		}
		instQueue[0] = newQueue(p[0].Inst.$length);
		visitQueue[0] = newQueue(p[0].Inst.$length);
		check[0] = $throwNilPointerError;
		onePassRunes[0] = $makeSlice(sliceType$8, p[0].Inst.$length);
		check[0] = (function(check, instQueue, onePassRunes, p, visitQueue) { return function $b(pc, m) {
			var $ptr, _1, _entry, _entry$1, _entry$2, _entry$3, _key, _key$1, _key$2, _key$3, _key$4, _key$5, _key$6, _key$7, _q, _q$1, _q$2, _q$3, _q$4, _r, _r$1, _r$2, _r$3, _r$4, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, _v, i, i$1, i$2, i$3, i$4, inst, m, matchArg, matchOut, ok, pc, r0, r0$1, r1, r1$1, runes, runes$1, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _entry$3 = $f._entry$3; _key = $f._key; _key$1 = $f._key$1; _key$2 = $f._key$2; _key$3 = $f._key$3; _key$4 = $f._key$4; _key$5 = $f._key$5; _key$6 = $f._key$6; _key$7 = $f._key$7; _q = $f._q; _q$1 = $f._q$1; _q$2 = $f._q$2; _q$3 = $f._q$3; _q$4 = $f._q$4; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tuple = $f._tuple; _v = $f._v; i = $f.i; i$1 = $f.i$1; i$2 = $f.i$2; i$3 = $f.i$3; i$4 = $f.i$4; inst = $f.inst; m = $f.m; matchArg = $f.matchArg; matchOut = $f.matchOut; ok = $f.ok; pc = $f.pc; r0 = $f.r0; r0$1 = $f.r0$1; r1 = $f.r1; r1$1 = $f.r1$1; runes = $f.runes; runes$1 = $f.runes$1; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			ok = false;
			ok = true;
			inst = (x = p[0].Inst, ((pc < 0 || pc >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + pc]));
			if (visitQueue[0].contains(pc)) {
				return ok;
			}
			visitQueue[0].insert(pc);
				_1 = inst.Inst.Op;
				/* */ if ((_1 === (0)) || (_1 === (1))) { $s = 2; continue; }
				/* */ if ((_1 === (2)) || (_1 === (6))) { $s = 3; continue; }
				/* */ if (_1 === (3)) { $s = 4; continue; }
				/* */ if ((_1 === (4)) || (_1 === (5))) { $s = 5; continue; }
				/* */ if (_1 === (7)) { $s = 6; continue; }
				/* */ if (_1 === (8)) { $s = 7; continue; }
				/* */ if (_1 === (9)) { $s = 8; continue; }
				/* */ if (_1 === (10)) { $s = 9; continue; }
				/* */ $s = 10; continue;
				/* if ((_1 === (0)) || (_1 === (1))) { */ case 2:
					_r = check[0](inst.Inst.Out, m); /* */ $s = 12; case 12: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					if (!(_r)) { _v = false; $s = 11; continue s; }
					_r$1 = check[0](inst.Inst.Arg, m); /* */ $s = 13; case 13: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					_v = _r$1; case 11:
					ok = _v;
					matchOut = (_entry = m[$Uint32.keyFor(inst.Inst.Out)], _entry !== undefined ? _entry.v : false);
					matchArg = (_entry$1 = m[$Uint32.keyFor(inst.Inst.Arg)], _entry$1 !== undefined ? _entry$1.v : false);
					if (matchOut && matchArg) {
						ok = false;
						/* break; */ $s = 1; continue;
					}
					if (matchArg) {
						_tmp = inst.Inst.Arg;
						_tmp$1 = inst.Inst.Out;
						inst.Inst.Out = _tmp;
						inst.Inst.Arg = _tmp$1;
						_tmp$2 = matchArg;
						_tmp$3 = matchOut;
						matchOut = _tmp$2;
						matchArg = _tmp$3;
					}
					if (matchOut) {
						_key = pc; (m || $throwRuntimeError("assignment to entry in nil map"))[$Uint32.keyFor(_key)] = { k: _key, v: true };
						inst.Inst.Op = 1;
					}
					_r$2 = mergeRuneSets($indexPtr(onePassRunes[0].$array, onePassRunes[0].$offset + inst.Inst.Out, ptrType$9), $indexPtr(onePassRunes[0].$array, onePassRunes[0].$offset + inst.Inst.Arg, ptrType$9), inst.Inst.Out, inst.Inst.Arg); /* */ $s = 14; case 14: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					_tuple = _r$2;
					((pc < 0 || pc >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + pc] = _tuple[0]);
					inst.Next = _tuple[1];
					if (inst.Next.$length > 0 && ((x$1 = inst.Next, (0 >= x$1.$length ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + 0])) === 4294967295)) {
						ok = false;
						/* break; */ $s = 1; continue;
					}
					$s = 10; continue;
				/* } else if ((_1 === (2)) || (_1 === (6))) { */ case 3:
					_r$3 = check[0](inst.Inst.Out, m); /* */ $s = 15; case 15: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					ok = _r$3;
					_key$1 = pc; (m || $throwRuntimeError("assignment to entry in nil map"))[$Uint32.keyFor(_key$1)] = { k: _key$1, v: (_entry$2 = m[$Uint32.keyFor(inst.Inst.Out)], _entry$2 !== undefined ? _entry$2.v : false) };
					((pc < 0 || pc >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + pc] = $appendSlice(new sliceType$1([]), (x$2 = inst.Inst.Out, ((x$2 < 0 || x$2 >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + x$2]))));
					inst.Next = new sliceType$2([]);
					i = (_q = ((pc < 0 || pc >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + pc]).$length / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
					while (true) {
						if (!(i >= 0)) { break; }
						inst.Next = $append(inst.Next, inst.Inst.Out);
						i = i - (1) >> 0;
					}
					$s = 10; continue;
				/* } else if (_1 === (3)) { */ case 4:
					_r$4 = check[0](inst.Inst.Out, m); /* */ $s = 16; case 16: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					ok = _r$4;
					_key$2 = pc; (m || $throwRuntimeError("assignment to entry in nil map"))[$Uint32.keyFor(_key$2)] = { k: _key$2, v: (_entry$3 = m[$Uint32.keyFor(inst.Inst.Out)], _entry$3 !== undefined ? _entry$3.v : false) };
					((pc < 0 || pc >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + pc] = $appendSlice(new sliceType$1([]), (x$3 = inst.Inst.Out, ((x$3 < 0 || x$3 >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + x$3]))));
					inst.Next = new sliceType$2([]);
					i$1 = (_q$1 = ((pc < 0 || pc >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + pc]).$length / 2, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
					while (true) {
						if (!(i$1 >= 0)) { break; }
						inst.Next = $append(inst.Next, inst.Inst.Out);
						i$1 = i$1 - (1) >> 0;
					}
					$s = 10; continue;
				/* } else if ((_1 === (4)) || (_1 === (5))) { */ case 5:
					_key$3 = pc; (m || $throwRuntimeError("assignment to entry in nil map"))[$Uint32.keyFor(_key$3)] = { k: _key$3, v: inst.Inst.Op === 4 };
					/* break; */ $s = 1; continue;
					$s = 10; continue;
				/* } else if (_1 === (7)) { */ case 6:
					_key$4 = pc; (m || $throwRuntimeError("assignment to entry in nil map"))[$Uint32.keyFor(_key$4)] = { k: _key$4, v: false };
					if (inst.Next.$length > 0) {
						/* break; */ $s = 1; continue;
					}
					instQueue[0].insert(inst.Inst.Out);
					if (inst.Inst.Rune.$length === 0) {
						((pc < 0 || pc >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + pc] = new sliceType$1([]));
						inst.Next = new sliceType$2([inst.Inst.Out]);
						/* break; */ $s = 1; continue;
					}
					runes = $makeSlice(sliceType$1, 0);
					/* */ if ((inst.Inst.Rune.$length === 1) && !(((((inst.Inst.Arg << 16 >>> 16) & 1) >>> 0) === 0))) { $s = 17; continue; }
					/* */ $s = 18; continue;
					/* if ((inst.Inst.Rune.$length === 1) && !(((((inst.Inst.Arg << 16 >>> 16) & 1) >>> 0) === 0))) { */ case 17:
						r0 = (x$4 = inst.Inst.Rune, (0 >= x$4.$length ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + 0]));
						runes = $append(runes, r0, r0);
						r1 = unicode.SimpleFold(r0);
						while (true) {
							if (!(!((r1 === r0)))) { break; }
							runes = $append(runes, r1, r1);
							r1 = unicode.SimpleFold(r1);
						}
						$r = sort.Sort($subslice(new runeSlice(runes.$array), runes.$offset, runes.$offset + runes.$length)); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						$s = 19; continue;
					/* } else { */ case 18:
						runes = $appendSlice(runes, inst.Inst.Rune);
					/* } */ case 19:
					((pc < 0 || pc >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + pc] = runes);
					inst.Next = new sliceType$2([]);
					i$2 = (_q$2 = ((pc < 0 || pc >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + pc]).$length / 2, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >> 0 : $throwRuntimeError("integer divide by zero"));
					while (true) {
						if (!(i$2 >= 0)) { break; }
						inst.Next = $append(inst.Next, inst.Inst.Out);
						i$2 = i$2 - (1) >> 0;
					}
					inst.Inst.Op = 7;
					$s = 10; continue;
				/* } else if (_1 === (8)) { */ case 7:
					_key$5 = pc; (m || $throwRuntimeError("assignment to entry in nil map"))[$Uint32.keyFor(_key$5)] = { k: _key$5, v: false };
					if (inst.Next.$length > 0) {
						/* break; */ $s = 1; continue;
					}
					instQueue[0].insert(inst.Inst.Out);
					runes$1 = new sliceType$1([]);
					/* */ if (!(((((inst.Inst.Arg << 16 >>> 16) & 1) >>> 0) === 0))) { $s = 21; continue; }
					/* */ $s = 22; continue;
					/* if (!(((((inst.Inst.Arg << 16 >>> 16) & 1) >>> 0) === 0))) { */ case 21:
						r0$1 = (x$5 = inst.Inst.Rune, (0 >= x$5.$length ? $throwRuntimeError("index out of range") : x$5.$array[x$5.$offset + 0]));
						runes$1 = $append(runes$1, r0$1, r0$1);
						r1$1 = unicode.SimpleFold(r0$1);
						while (true) {
							if (!(!((r1$1 === r0$1)))) { break; }
							runes$1 = $append(runes$1, r1$1, r1$1);
							r1$1 = unicode.SimpleFold(r1$1);
						}
						$r = sort.Sort($subslice(new runeSlice(runes$1.$array), runes$1.$offset, runes$1.$offset + runes$1.$length)); /* */ $s = 24; case 24: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						$s = 23; continue;
					/* } else { */ case 22:
						runes$1 = $append(runes$1, (x$6 = inst.Inst.Rune, (0 >= x$6.$length ? $throwRuntimeError("index out of range") : x$6.$array[x$6.$offset + 0])), (x$7 = inst.Inst.Rune, (0 >= x$7.$length ? $throwRuntimeError("index out of range") : x$7.$array[x$7.$offset + 0])));
					/* } */ case 23:
					((pc < 0 || pc >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + pc] = runes$1);
					inst.Next = new sliceType$2([]);
					i$3 = (_q$3 = ((pc < 0 || pc >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + pc]).$length / 2, (_q$3 === _q$3 && _q$3 !== 1/0 && _q$3 !== -1/0) ? _q$3 >> 0 : $throwRuntimeError("integer divide by zero"));
					while (true) {
						if (!(i$3 >= 0)) { break; }
						inst.Next = $append(inst.Next, inst.Inst.Out);
						i$3 = i$3 - (1) >> 0;
					}
					inst.Inst.Op = 7;
					$s = 10; continue;
				/* } else if (_1 === (9)) { */ case 8:
					_key$6 = pc; (m || $throwRuntimeError("assignment to entry in nil map"))[$Uint32.keyFor(_key$6)] = { k: _key$6, v: false };
					if (inst.Next.$length > 0) {
						/* break; */ $s = 1; continue;
					}
					instQueue[0].insert(inst.Inst.Out);
					((pc < 0 || pc >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + pc] = $appendSlice(new sliceType$1([]), anyRune));
					inst.Next = new sliceType$2([inst.Inst.Out]);
					$s = 10; continue;
				/* } else if (_1 === (10)) { */ case 9:
					_key$7 = pc; (m || $throwRuntimeError("assignment to entry in nil map"))[$Uint32.keyFor(_key$7)] = { k: _key$7, v: false };
					if (inst.Next.$length > 0) {
						/* break; */ $s = 1; continue;
					}
					instQueue[0].insert(inst.Inst.Out);
					((pc < 0 || pc >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + pc] = $appendSlice(new sliceType$1([]), anyRuneNotNL));
					inst.Next = new sliceType$2([]);
					i$4 = (_q$4 = ((pc < 0 || pc >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + pc]).$length / 2, (_q$4 === _q$4 && _q$4 !== 1/0 && _q$4 !== -1/0) ? _q$4 >> 0 : $throwRuntimeError("integer divide by zero"));
					while (true) {
						if (!(i$4 >= 0)) { break; }
						inst.Next = $append(inst.Next, inst.Inst.Out);
						i$4 = i$4 - (1) >> 0;
					}
				/* } */ case 10:
			case 1:
			return ok;
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._1 = _1; $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._entry$3 = _entry$3; $f._key = _key; $f._key$1 = _key$1; $f._key$2 = _key$2; $f._key$3 = _key$3; $f._key$4 = _key$4; $f._key$5 = _key$5; $f._key$6 = _key$6; $f._key$7 = _key$7; $f._q = _q; $f._q$1 = _q$1; $f._q$2 = _q$2; $f._q$3 = _q$3; $f._q$4 = _q$4; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tuple = _tuple; $f._v = _v; $f.i = i; $f.i$1 = i$1; $f.i$2 = i$2; $f.i$3 = i$3; $f.i$4 = i$4; $f.inst = inst; $f.m = m; $f.matchArg = matchArg; $f.matchOut = matchOut; $f.ok = ok; $f.pc = pc; $f.r0 = r0; $f.r0$1 = r0$1; $f.r1 = r1; $f.r1$1 = r1$1; $f.runes = runes; $f.runes$1 = runes$1; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.$s = $s; $f.$r = $r; return $f;
		}; })(check, instQueue, onePassRunes, p, visitQueue);
		instQueue[0].clear();
		instQueue[0].insert((p[0].Start >>> 0));
		m = (x = p[0].Inst.$length, ((x < 0 || x > 2147483647) ? $throwRuntimeError("makemap: size out of range") : {}));
		/* while (true) { */ case 1:
			/* if (!(!instQueue[0].empty())) { break; } */ if(!(!instQueue[0].empty())) { $s = 2; continue; }
			visitQueue[0].clear();
			pc = instQueue[0].next();
			_r = check[0](pc, m); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (!_r) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!_r) { */ case 3:
				p[0] = notOnePass;
				/* break; */ $s = 2; continue;
			/* } */ case 4:
		/* } */ $s = 1; continue; case 2:
		if (!(p[0] === notOnePass)) {
			_ref = p[0].Inst;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				(x$1 = p[0].Inst, ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i])).Inst.Rune = ((i < 0 || i >= onePassRunes[0].$length) ? $throwRuntimeError("index out of range") : onePassRunes[0].$array[onePassRunes[0].$offset + i]);
				_i++;
			}
		}
		return p[0];
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeOnePass }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f.check = check; $f.i = i; $f.instQueue = instQueue; $f.m = m; $f.onePassRunes = onePassRunes; $f.p = p; $f.pc = pc; $f.visitQueue = visitQueue; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	compileOnePass = function(prog) {
		var $ptr, _1, _i, _r, _ref, inst, opOut, p, prog, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _i = $f._i; _r = $f._r; _ref = $f._ref; inst = $f.inst; opOut = $f.opOut; p = $f.p; prog = $f.prog; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = ptrType$1.nil;
		if (prog.Start === 0) {
			p = notOnePass;
			return p;
		}
		if (!(((x = prog.Inst, x$1 = prog.Start, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])).Op === 3)) || !((((((x$2 = prog.Inst, x$3 = prog.Start, ((x$3 < 0 || x$3 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + x$3])).Arg << 24 >>> 24) & 4) >>> 0) === 4))) {
			p = notOnePass;
			return p;
		}
		_ref = prog.Inst;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			inst = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), syntax.Inst);
			opOut = (x$4 = prog.Inst, x$5 = inst.Out, ((x$5 < 0 || x$5 >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + x$5])).Op;
			_1 = inst.Op;
			if ((_1 === (0)) || (_1 === (1))) {
				if ((opOut === 4) || ((x$6 = prog.Inst, x$7 = inst.Arg, ((x$7 < 0 || x$7 >= x$6.$length) ? $throwRuntimeError("index out of range") : x$6.$array[x$6.$offset + x$7])).Op === 4)) {
					p = notOnePass;
					return p;
				}
			} else if (_1 === (3)) {
				if (opOut === 4) {
					if ((((inst.Arg << 24 >>> 24) & 8) >>> 0) === 8) {
						_i++;
						/* continue; */ $s = 1; continue;
					}
					p = notOnePass;
					return p;
				}
			} else if (opOut === 4) {
				p = notOnePass;
				return p;
			}
			_i++;
		/* } */ $s = 1; continue; case 2:
		p = onePassCopy(prog);
		_r = makeOnePass(p); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		p = _r;
		if (!(p === notOnePass)) {
			cleanupOnePass(p, prog);
		}
		p = p;
		return p;
		/* */ } return; } if ($f === undefined) { $f = { $blk: compileOnePass }; } $f.$ptr = $ptr; $f._1 = _1; $f._i = _i; $f._r = _r; $f._ref = _ref; $f.inst = inst; $f.opOut = opOut; $f.p = p; $f.prog = prog; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.ptr.prototype.String = function() {
		var $ptr, re;
		re = this;
		return re.expr;
	};
	Regexp.prototype.String = function() { return this.$val.String(); };
	Regexp.ptr.prototype.Copy = function() {
		var $ptr, r, re;
		re = this;
		r = $clone(re, Regexp);
		nosync.Mutex.copy(r.mu, new nosync.Mutex.ptr(false));
		r.machine = sliceType$9.nil;
		return r;
	};
	Regexp.prototype.Copy = function() { return this.$val.Copy(); };
	Compile = function(expr) {
		var $ptr, _r, expr, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; expr = $f.expr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = compile(expr, 212, false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Compile }; } $f.$ptr = $ptr; $f._r = _r; $f.expr = expr; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Compile = Compile;
	Regexp.ptr.prototype.Longest = function() {
		var $ptr, re;
		re = this;
		re.longest = true;
	};
	Regexp.prototype.Longest = function() { return this.$val.Longest(); };
	compile = function(expr, mode, longest) {
		var $ptr, _r, _r$1, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, capNames, err, expr, longest, maxCap, mode, prog, re, regexp, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; capNames = $f.capNames; err = $f.err; expr = $f.expr; longest = $f.longest; maxCap = $f.maxCap; mode = $f.mode; prog = $f.prog; re = $f.re; regexp = $f.regexp; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = syntax.Parse(expr, mode); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		re = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [ptrType$3.nil, err];
		}
		maxCap = re.MaxCap();
		capNames = re.CapNames();
		re = re.Simplify();
		_tuple$1 = syntax.Compile(re);
		prog = _tuple$1[0];
		err = _tuple$1[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [ptrType$3.nil, err];
		}
		_r$1 = compileOnePass(prog); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		regexp = new Regexp.ptr(expr, prog, _r$1, "", sliceType$3.nil, false, 0, 0, prog.StartCond(), maxCap, capNames, longest, new nosync.Mutex.ptr(false), sliceType$9.nil);
		if (regexp.onepass === notOnePass) {
			_tuple$2 = prog.Prefix();
			regexp.prefix = _tuple$2[0];
			regexp.prefixComplete = _tuple$2[1];
		} else {
			_tuple$3 = onePassPrefix(prog);
			regexp.prefix = _tuple$3[0];
			regexp.prefixComplete = _tuple$3[1];
			regexp.prefixEnd = _tuple$3[2];
		}
		if (!(regexp.prefix === "")) {
			regexp.prefixBytes = new sliceType$3($stringToBytes(regexp.prefix));
			_tuple$4 = utf8.DecodeRuneInString(regexp.prefix);
			regexp.prefixRune = _tuple$4[0];
		}
		return [regexp, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: compile }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f.capNames = capNames; $f.err = err; $f.expr = expr; $f.longest = longest; $f.maxCap = maxCap; $f.mode = mode; $f.prog = prog; $f.re = re; $f.regexp = regexp; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.ptr.prototype.get = function() {
		var $ptr, n, re, x, x$1, z, z$1;
		re = this;
		re.mu.Lock();
		n = re.machine.$length;
		if (n > 0) {
			z = (x = re.machine, x$1 = n - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
			re.machine = $subslice(re.machine, 0, (n - 1 >> 0));
			re.mu.Unlock();
			return z;
		}
		re.mu.Unlock();
		z$1 = progMachine(re.prog, re.onepass);
		z$1.re = re;
		return z$1;
	};
	Regexp.prototype.get = function() { return this.$val.get(); };
	Regexp.ptr.prototype.put = function(z) {
		var $ptr, re, z;
		re = this;
		re.mu.Lock();
		re.machine = $append(re.machine, z);
		re.mu.Unlock();
	};
	Regexp.prototype.put = function(z) { return this.$val.put(z); };
	MustCompile = function(str) {
		var $ptr, _r, _r$1, _tuple, error, regexp, str, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; error = $f.error; regexp = $f.regexp; str = $f.str; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = Compile(str); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		regexp = _tuple[0];
		error = _tuple[1];
		/* */ if (!($interfaceIsEqual(error, $ifaceNil))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!($interfaceIsEqual(error, $ifaceNil))) { */ case 2:
			_r$1 = error.Error(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			$panic(new $String("regexp: Compile(" + quote(str) + "): " + _r$1));
		/* } */ case 3:
		return regexp;
		/* */ } return; } if ($f === undefined) { $f = { $blk: MustCompile }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.error = error; $f.regexp = regexp; $f.str = str; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.MustCompile = MustCompile;
	quote = function(s) {
		var $ptr, s;
		if (strconv.CanBackquote(s)) {
			return "`" + s + "`";
		}
		return strconv.Quote(s);
	};
	Regexp.ptr.prototype.NumSubexp = function() {
		var $ptr, re;
		re = this;
		return re.numSubexp;
	};
	Regexp.prototype.NumSubexp = function() { return this.$val.NumSubexp(); };
	Regexp.ptr.prototype.SubexpNames = function() {
		var $ptr, re;
		re = this;
		return re.subexpNames;
	};
	Regexp.prototype.SubexpNames = function() { return this.$val.SubexpNames(); };
	inputString.ptr.prototype.step = function(pos) {
		var $ptr, c, i, pos;
		i = this;
		if (pos < i.str.length) {
			c = i.str.charCodeAt(pos);
			if (c < 128) {
				return [(c >> 0), 1];
			}
			return utf8.DecodeRuneInString(i.str.substring(pos));
		}
		return [-1, 0];
	};
	inputString.prototype.step = function(pos) { return this.$val.step(pos); };
	inputString.ptr.prototype.canCheckPrefix = function() {
		var $ptr, i;
		i = this;
		return true;
	};
	inputString.prototype.canCheckPrefix = function() { return this.$val.canCheckPrefix(); };
	inputString.ptr.prototype.hasPrefix = function(re) {
		var $ptr, i, re;
		i = this;
		return strings.HasPrefix(i.str, re.prefix);
	};
	inputString.prototype.hasPrefix = function(re) { return this.$val.hasPrefix(re); };
	inputString.ptr.prototype.index = function(re, pos) {
		var $ptr, i, pos, re;
		i = this;
		return strings.Index(i.str.substring(pos), re.prefix);
	};
	inputString.prototype.index = function(re, pos) { return this.$val.index(re, pos); };
	inputString.ptr.prototype.context = function(pos) {
		var $ptr, _tmp, _tmp$1, _tuple, _tuple$1, i, pos, r1, r2;
		i = this;
		_tmp = -1;
		_tmp$1 = -1;
		r1 = _tmp;
		r2 = _tmp$1;
		if (pos > 0 && pos <= i.str.length) {
			_tuple = utf8.DecodeLastRuneInString(i.str.substring(0, pos));
			r1 = _tuple[0];
		}
		if (pos < i.str.length) {
			_tuple$1 = utf8.DecodeRuneInString(i.str.substring(pos));
			r2 = _tuple$1[0];
		}
		return syntax.EmptyOpContext(r1, r2);
	};
	inputString.prototype.context = function(pos) { return this.$val.context(pos); };
	inputBytes.ptr.prototype.step = function(pos) {
		var $ptr, c, i, pos, x;
		i = this;
		if (pos < i.str.$length) {
			c = (x = i.str, ((pos < 0 || pos >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + pos]));
			if (c < 128) {
				return [(c >> 0), 1];
			}
			return utf8.DecodeRune($subslice(i.str, pos));
		}
		return [-1, 0];
	};
	inputBytes.prototype.step = function(pos) { return this.$val.step(pos); };
	inputBytes.ptr.prototype.canCheckPrefix = function() {
		var $ptr, i;
		i = this;
		return true;
	};
	inputBytes.prototype.canCheckPrefix = function() { return this.$val.canCheckPrefix(); };
	inputBytes.ptr.prototype.hasPrefix = function(re) {
		var $ptr, i, re;
		i = this;
		return bytes.HasPrefix(i.str, re.prefixBytes);
	};
	inputBytes.prototype.hasPrefix = function(re) { return this.$val.hasPrefix(re); };
	inputBytes.ptr.prototype.index = function(re, pos) {
		var $ptr, i, pos, re;
		i = this;
		return bytes.Index($subslice(i.str, pos), re.prefixBytes);
	};
	inputBytes.prototype.index = function(re, pos) { return this.$val.index(re, pos); };
	inputBytes.ptr.prototype.context = function(pos) {
		var $ptr, _tmp, _tmp$1, _tuple, _tuple$1, i, pos, r1, r2;
		i = this;
		_tmp = -1;
		_tmp$1 = -1;
		r1 = _tmp;
		r2 = _tmp$1;
		if (pos > 0 && pos <= i.str.$length) {
			_tuple = utf8.DecodeLastRune($subslice(i.str, 0, pos));
			r1 = _tuple[0];
		}
		if (pos < i.str.$length) {
			_tuple$1 = utf8.DecodeRune($subslice(i.str, pos));
			r2 = _tuple$1[0];
		}
		return syntax.EmptyOpContext(r1, r2);
	};
	inputBytes.prototype.context = function(pos) { return this.$val.context(pos); };
	inputReader.ptr.prototype.step = function(pos) {
		var $ptr, _r, _tuple, err, i, pos, r, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; err = $f.err; i = $f.i; pos = $f.pos; r = $f.r; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		i = this;
		if (!i.atEOT && !((pos === i.pos))) {
			return [-1, 0];
		}
		_r = i.r.ReadRune(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		r = _tuple[0];
		w = _tuple[1];
		err = _tuple[2];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			i.atEOT = true;
			return [-1, 0];
		}
		i.pos = i.pos + (w) >> 0;
		return [r, w];
		/* */ } return; } if ($f === undefined) { $f = { $blk: inputReader.ptr.prototype.step }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.err = err; $f.i = i; $f.pos = pos; $f.r = r; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	inputReader.prototype.step = function(pos) { return this.$val.step(pos); };
	inputReader.ptr.prototype.canCheckPrefix = function() {
		var $ptr, i;
		i = this;
		return false;
	};
	inputReader.prototype.canCheckPrefix = function() { return this.$val.canCheckPrefix(); };
	inputReader.ptr.prototype.hasPrefix = function(re) {
		var $ptr, i, re;
		i = this;
		return false;
	};
	inputReader.prototype.hasPrefix = function(re) { return this.$val.hasPrefix(re); };
	inputReader.ptr.prototype.index = function(re, pos) {
		var $ptr, i, pos, re;
		i = this;
		return -1;
	};
	inputReader.prototype.index = function(re, pos) { return this.$val.index(re, pos); };
	inputReader.ptr.prototype.context = function(pos) {
		var $ptr, i, pos;
		i = this;
		return 0;
	};
	inputReader.prototype.context = function(pos) { return this.$val.context(pos); };
	Regexp.ptr.prototype.LiteralPrefix = function() {
		var $ptr, _tmp, _tmp$1, complete, prefix, re;
		prefix = "";
		complete = false;
		re = this;
		_tmp = re.prefix;
		_tmp$1 = re.prefixComplete;
		prefix = _tmp;
		complete = _tmp$1;
		return [prefix, complete];
	};
	Regexp.prototype.LiteralPrefix = function() { return this.$val.LiteralPrefix(); };
	Regexp.ptr.prototype.MatchReader = function(r) {
		var $ptr, _r, r, re, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; r = $f.r; re = $f.re; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = this;
		_r = re.doExecute(r, sliceType$3.nil, "", 0, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return !(_r === sliceType.nil);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.MatchReader }; } $f.$ptr = $ptr; $f._r = _r; $f.r = r; $f.re = re; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.MatchReader = function(r) { return this.$val.MatchReader(r); };
	Regexp.ptr.prototype.MatchString = function(s) {
		var $ptr, _r, re, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; re = $f.re; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = this;
		_r = re.doExecute($ifaceNil, sliceType$3.nil, s, 0, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return !(_r === sliceType.nil);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.MatchString }; } $f.$ptr = $ptr; $f._r = _r; $f.re = re; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.MatchString = function(s) { return this.$val.MatchString(s); };
	Regexp.ptr.prototype.Match = function(b) {
		var $ptr, _r, b, re, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; b = $f.b; re = $f.re; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = this;
		_r = re.doExecute($ifaceNil, b, "", 0, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return !(_r === sliceType.nil);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.Match }; } $f.$ptr = $ptr; $f._r = _r; $f.b = b; $f.re = re; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.Match = function(b) { return this.$val.Match(b); };
	Regexp.ptr.prototype.ReplaceAllString = function(src, repl) {
		var $ptr, _r, b, n, re, repl, src, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; b = $f.b; n = $f.n; re = $f.re; repl = $f.repl; src = $f.src; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = [re];
		repl = [repl];
		src = [src];
		re[0] = this;
		n = 2;
		if (strings.Index(repl[0], "$") >= 0) {
			n = $imul(2, ((re[0].numSubexp + 1 >> 0)));
		}
		_r = re[0].replaceAll(sliceType$3.nil, src[0], n, (function(re, repl, src) { return function(dst, match) {
			var $ptr, dst, match;
			return re[0].expand(dst, repl[0], sliceType$3.nil, src[0], match);
		}; })(re, repl, src)); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		b = _r;
		return $bytesToString(b);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.ReplaceAllString }; } $f.$ptr = $ptr; $f._r = _r; $f.b = b; $f.n = n; $f.re = re; $f.repl = repl; $f.src = src; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.ReplaceAllString = function(src, repl) { return this.$val.ReplaceAllString(src, repl); };
	Regexp.ptr.prototype.ReplaceAllLiteralString = function(src, repl) {
		var $ptr, _r, re, repl, src, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; re = $f.re; repl = $f.repl; src = $f.src; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		repl = [repl];
		re = this;
		_r = re.replaceAll(sliceType$3.nil, src, 2, (function(repl) { return function(dst, match) {
			var $ptr, dst, match;
			return $appendSlice(dst, repl[0]);
		}; })(repl)); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return $bytesToString(_r);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.ReplaceAllLiteralString }; } $f.$ptr = $ptr; $f._r = _r; $f.re = re; $f.repl = repl; $f.src = src; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.ReplaceAllLiteralString = function(src, repl) { return this.$val.ReplaceAllLiteralString(src, repl); };
	Regexp.ptr.prototype.ReplaceAllStringFunc = function(src, repl) {
		var $ptr, _r, b, re, repl, src, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; b = $f.b; re = $f.re; repl = $f.repl; src = $f.src; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		repl = [repl];
		src = [src];
		re = this;
		_r = re.replaceAll(sliceType$3.nil, src[0], 2, (function(repl, src) { return function $b(dst, match) {
			var $ptr, _arg, _arg$1, _r, dst, match, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _r = $f._r; dst = $f.dst; match = $f.match; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_arg = dst;
			_r = repl[0](src[0].substring((0 >= match.$length ? $throwRuntimeError("index out of range") : match.$array[match.$offset + 0]), (1 >= match.$length ? $throwRuntimeError("index out of range") : match.$array[match.$offset + 1]))); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_arg$1 = _r;
			/* */ $s = 2; case 2:
			return $appendSlice(_arg, _arg$1);
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._r = _r; $f.dst = dst; $f.match = match; $f.$s = $s; $f.$r = $r; return $f;
		}; })(repl, src)); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		b = _r;
		return $bytesToString(b);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.ReplaceAllStringFunc }; } $f.$ptr = $ptr; $f._r = _r; $f.b = b; $f.re = re; $f.repl = repl; $f.src = src; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.ReplaceAllStringFunc = function(src, repl) { return this.$val.ReplaceAllStringFunc(src, repl); };
	Regexp.ptr.prototype.replaceAll = function(bsrc, src, nmatch, repl) {
		var $ptr, _r, _r$1, _tuple, _tuple$1, a, bsrc, buf, endPos, lastMatchEnd, nmatch, re, repl, searchPos, src, width, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; a = $f.a; bsrc = $f.bsrc; buf = $f.buf; endPos = $f.endPos; lastMatchEnd = $f.lastMatchEnd; nmatch = $f.nmatch; re = $f.re; repl = $f.repl; searchPos = $f.searchPos; src = $f.src; width = $f.width; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = this;
		lastMatchEnd = 0;
		searchPos = 0;
		buf = sliceType$3.nil;
		endPos = 0;
		if (!(bsrc === sliceType$3.nil)) {
			endPos = bsrc.$length;
		} else {
			endPos = src.length;
		}
		if (nmatch > re.prog.NumCap) {
			nmatch = re.prog.NumCap;
		}
		/* while (true) { */ case 1:
			/* if (!(searchPos <= endPos)) { break; } */ if(!(searchPos <= endPos)) { $s = 2; continue; }
			_r = re.doExecute($ifaceNil, bsrc, src, searchPos, nmatch); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			a = _r;
			if (a.$length === 0) {
				/* break; */ $s = 2; continue;
			}
			if (!(bsrc === sliceType$3.nil)) {
				buf = $appendSlice(buf, $subslice(bsrc, lastMatchEnd, (0 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 0])));
			} else {
				buf = $appendSlice(buf, src.substring(lastMatchEnd, (0 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 0])));
			}
			/* */ if ((1 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 1]) > lastMatchEnd || ((0 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 0]) === 0)) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if ((1 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 1]) > lastMatchEnd || ((0 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 0]) === 0)) { */ case 4:
				_r$1 = repl(buf, a); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				buf = _r$1;
			/* } */ case 5:
			lastMatchEnd = (1 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 1]);
			width = 0;
			if (!(bsrc === sliceType$3.nil)) {
				_tuple = utf8.DecodeRune($subslice(bsrc, searchPos));
				width = _tuple[1];
			} else {
				_tuple$1 = utf8.DecodeRuneInString(src.substring(searchPos));
				width = _tuple$1[1];
			}
			if ((searchPos + width >> 0) > (1 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 1])) {
				searchPos = searchPos + (width) >> 0;
			} else if ((searchPos + 1 >> 0) > (1 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 1])) {
				searchPos = searchPos + (1) >> 0;
			} else {
				searchPos = (1 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 1]);
			}
		/* } */ $s = 1; continue; case 2:
		if (!(bsrc === sliceType$3.nil)) {
			buf = $appendSlice(buf, $subslice(bsrc, lastMatchEnd));
		} else {
			buf = $appendSlice(buf, src.substring(lastMatchEnd));
		}
		return buf;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.replaceAll }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.a = a; $f.bsrc = bsrc; $f.buf = buf; $f.endPos = endPos; $f.lastMatchEnd = lastMatchEnd; $f.nmatch = nmatch; $f.re = re; $f.repl = repl; $f.searchPos = searchPos; $f.src = src; $f.width = width; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.replaceAll = function(bsrc, src, nmatch, repl) { return this.$val.replaceAll(bsrc, src, nmatch, repl); };
	Regexp.ptr.prototype.ReplaceAll = function(src, repl) {
		var $ptr, _r, b, n, re, repl, src, srepl, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; b = $f.b; n = $f.n; re = $f.re; repl = $f.repl; src = $f.src; srepl = $f.srepl; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = [re];
		repl = [repl];
		src = [src];
		srepl = [srepl];
		re[0] = this;
		n = 2;
		if (bytes.IndexByte(repl[0], 36) >= 0) {
			n = $imul(2, ((re[0].numSubexp + 1 >> 0)));
		}
		srepl[0] = "";
		_r = re[0].replaceAll(src[0], "", n, (function(re, repl, src, srepl) { return function(dst, match) {
			var $ptr, dst, match;
			if (!((srepl[0].length === repl[0].$length))) {
				srepl[0] = $bytesToString(repl[0]);
			}
			return re[0].expand(dst, srepl[0], src[0], "", match);
		}; })(re, repl, src, srepl)); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		b = _r;
		return b;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.ReplaceAll }; } $f.$ptr = $ptr; $f._r = _r; $f.b = b; $f.n = n; $f.re = re; $f.repl = repl; $f.src = src; $f.srepl = srepl; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.ReplaceAll = function(src, repl) { return this.$val.ReplaceAll(src, repl); };
	Regexp.ptr.prototype.ReplaceAllLiteral = function(src, repl) {
		var $ptr, _r, re, repl, src, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; re = $f.re; repl = $f.repl; src = $f.src; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		repl = [repl];
		re = this;
		_r = re.replaceAll(src, "", 2, (function(repl) { return function(dst, match) {
			var $ptr, dst, match;
			return $appendSlice(dst, repl[0]);
		}; })(repl)); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.ReplaceAllLiteral }; } $f.$ptr = $ptr; $f._r = _r; $f.re = re; $f.repl = repl; $f.src = src; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.ReplaceAllLiteral = function(src, repl) { return this.$val.ReplaceAllLiteral(src, repl); };
	Regexp.ptr.prototype.ReplaceAllFunc = function(src, repl) {
		var $ptr, _r, re, repl, src, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; re = $f.re; repl = $f.repl; src = $f.src; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		repl = [repl];
		src = [src];
		re = this;
		_r = re.replaceAll(src[0], "", 2, (function(repl, src) { return function $b(dst, match) {
			var $ptr, _arg, _arg$1, _r, dst, match, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _r = $f._r; dst = $f.dst; match = $f.match; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_arg = dst;
			_r = repl[0]($subslice(src[0], (0 >= match.$length ? $throwRuntimeError("index out of range") : match.$array[match.$offset + 0]), (1 >= match.$length ? $throwRuntimeError("index out of range") : match.$array[match.$offset + 1]))); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_arg$1 = _r;
			/* */ $s = 2; case 2:
			return $appendSlice(_arg, _arg$1);
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._r = _r; $f.dst = dst; $f.match = match; $f.$s = $s; $f.$r = $r; return $f;
		}; })(repl, src)); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.ReplaceAllFunc }; } $f.$ptr = $ptr; $f._r = _r; $f.re = re; $f.repl = repl; $f.src = src; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.ReplaceAllFunc = function(src, repl) { return this.$val.ReplaceAllFunc(src, repl); };
	Regexp.ptr.prototype.pad = function(a) {
		var $ptr, a, n, re;
		re = this;
		if (a === sliceType.nil) {
			return sliceType.nil;
		}
		n = $imul(((1 + re.numSubexp >> 0)), 2);
		while (true) {
			if (!(a.$length < n)) { break; }
			a = $append(a, -1);
		}
		return a;
	};
	Regexp.prototype.pad = function(a) { return this.$val.pad(a); };
	Regexp.ptr.prototype.allMatches = function(s, b, n, deliver) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tuple, _tuple$1, accept, b, deliver, end, i, matches, n, pos, prevMatchEnd, re, s, width, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; accept = $f.accept; b = $f.b; deliver = $f.deliver; end = $f.end; i = $f.i; matches = $f.matches; n = $f.n; pos = $f.pos; prevMatchEnd = $f.prevMatchEnd; re = $f.re; s = $f.s; width = $f.width; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = this;
		end = 0;
		if (b === sliceType$3.nil) {
			end = s.length;
		} else {
			end = b.$length;
		}
		_tmp = 0;
		_tmp$1 = 0;
		_tmp$2 = -1;
		pos = _tmp;
		i = _tmp$1;
		prevMatchEnd = _tmp$2;
		/* while (true) { */ case 1:
			/* if (!(i < n && pos <= end)) { break; } */ if(!(i < n && pos <= end)) { $s = 2; continue; }
			_r = re.doExecute($ifaceNil, b, s, pos, re.prog.NumCap); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			matches = _r;
			if (matches.$length === 0) {
				/* break; */ $s = 2; continue;
			}
			accept = true;
			if ((1 >= matches.$length ? $throwRuntimeError("index out of range") : matches.$array[matches.$offset + 1]) === pos) {
				if ((0 >= matches.$length ? $throwRuntimeError("index out of range") : matches.$array[matches.$offset + 0]) === prevMatchEnd) {
					accept = false;
				}
				width = 0;
				if (b === sliceType$3.nil) {
					_tuple = utf8.DecodeRuneInString(s.substring(pos, end));
					width = _tuple[1];
				} else {
					_tuple$1 = utf8.DecodeRune($subslice(b, pos, end));
					width = _tuple$1[1];
				}
				if (width > 0) {
					pos = pos + (width) >> 0;
				} else {
					pos = end + 1 >> 0;
				}
			} else {
				pos = (1 >= matches.$length ? $throwRuntimeError("index out of range") : matches.$array[matches.$offset + 1]);
			}
			prevMatchEnd = (1 >= matches.$length ? $throwRuntimeError("index out of range") : matches.$array[matches.$offset + 1]);
			/* */ if (accept) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (accept) { */ case 4:
				$r = deliver(re.pad(matches)); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				i = i + (1) >> 0;
			/* } */ case 5:
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.allMatches }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.accept = accept; $f.b = b; $f.deliver = deliver; $f.end = end; $f.i = i; $f.matches = matches; $f.n = n; $f.pos = pos; $f.prevMatchEnd = prevMatchEnd; $f.re = re; $f.s = s; $f.width = width; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.allMatches = function(s, b, n, deliver) { return this.$val.allMatches(s, b, n, deliver); };
	Regexp.ptr.prototype.Find = function(b) {
		var $ptr, _r, a, b, re, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; a = $f.a; b = $f.b; re = $f.re; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = this;
		_r = re.doExecute($ifaceNil, b, "", 0, 2); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		a = _r;
		if (a === sliceType.nil) {
			return sliceType$3.nil;
		}
		return $subslice(b, (0 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 0]), (1 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 1]));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.Find }; } $f.$ptr = $ptr; $f._r = _r; $f.a = a; $f.b = b; $f.re = re; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.Find = function(b) { return this.$val.Find(b); };
	Regexp.ptr.prototype.FindIndex = function(b) {
		var $ptr, _r, a, b, loc, re, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; a = $f.a; b = $f.b; loc = $f.loc; re = $f.re; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		loc = sliceType.nil;
		re = this;
		_r = re.doExecute($ifaceNil, b, "", 0, 2); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		a = _r;
		if (a === sliceType.nil) {
			loc = sliceType.nil;
			return loc;
		}
		loc = $subslice(a, 0, 2);
		return loc;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindIndex }; } $f.$ptr = $ptr; $f._r = _r; $f.a = a; $f.b = b; $f.loc = loc; $f.re = re; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindIndex = function(b) { return this.$val.FindIndex(b); };
	Regexp.ptr.prototype.FindString = function(s) {
		var $ptr, _r, a, re, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; a = $f.a; re = $f.re; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = this;
		_r = re.doExecute($ifaceNil, sliceType$3.nil, s, 0, 2); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		a = _r;
		if (a === sliceType.nil) {
			return "";
		}
		return s.substring((0 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 0]), (1 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 1]));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindString }; } $f.$ptr = $ptr; $f._r = _r; $f.a = a; $f.re = re; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindString = function(s) { return this.$val.FindString(s); };
	Regexp.ptr.prototype.FindStringIndex = function(s) {
		var $ptr, _r, a, loc, re, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; a = $f.a; loc = $f.loc; re = $f.re; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		loc = sliceType.nil;
		re = this;
		_r = re.doExecute($ifaceNil, sliceType$3.nil, s, 0, 2); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		a = _r;
		if (a === sliceType.nil) {
			loc = sliceType.nil;
			return loc;
		}
		loc = $subslice(a, 0, 2);
		return loc;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindStringIndex }; } $f.$ptr = $ptr; $f._r = _r; $f.a = a; $f.loc = loc; $f.re = re; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindStringIndex = function(s) { return this.$val.FindStringIndex(s); };
	Regexp.ptr.prototype.FindReaderIndex = function(r) {
		var $ptr, _r, a, loc, r, re, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; a = $f.a; loc = $f.loc; r = $f.r; re = $f.re; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		loc = sliceType.nil;
		re = this;
		_r = re.doExecute(r, sliceType$3.nil, "", 0, 2); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		a = _r;
		if (a === sliceType.nil) {
			loc = sliceType.nil;
			return loc;
		}
		loc = $subslice(a, 0, 2);
		return loc;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindReaderIndex }; } $f.$ptr = $ptr; $f._r = _r; $f.a = a; $f.loc = loc; $f.r = r; $f.re = re; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindReaderIndex = function(r) { return this.$val.FindReaderIndex(r); };
	Regexp.ptr.prototype.FindSubmatch = function(b) {
		var $ptr, _i, _r, _ref, a, b, i, re, ret, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; a = $f.a; b = $f.b; i = $f.i; re = $f.re; ret = $f.ret; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = this;
		_r = re.doExecute($ifaceNil, b, "", 0, re.prog.NumCap); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		a = _r;
		if (a === sliceType.nil) {
			return sliceType$11.nil;
		}
		ret = $makeSlice(sliceType$11, (1 + re.numSubexp >> 0));
		_ref = ret;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			if (($imul(2, i)) < a.$length && (x = $imul(2, i), ((x < 0 || x >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + x])) >= 0) {
				((i < 0 || i >= ret.$length) ? $throwRuntimeError("index out of range") : ret.$array[ret.$offset + i] = $subslice(b, (x$1 = $imul(2, i), ((x$1 < 0 || x$1 >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + x$1])), (x$2 = ($imul(2, i)) + 1 >> 0, ((x$2 < 0 || x$2 >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + x$2]))));
			}
			_i++;
		}
		return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindSubmatch }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f.a = a; $f.b = b; $f.i = i; $f.re = re; $f.ret = ret; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindSubmatch = function(b) { return this.$val.FindSubmatch(b); };
	Regexp.ptr.prototype.Expand = function(dst, template, src, match) {
		var $ptr, dst, match, re, src, template;
		re = this;
		return re.expand(dst, $bytesToString(template), src, "", match);
	};
	Regexp.prototype.Expand = function(dst, template, src, match) { return this.$val.Expand(dst, template, src, match); };
	Regexp.ptr.prototype.ExpandString = function(dst, template, src, match) {
		var $ptr, dst, match, re, src, template;
		re = this;
		return re.expand(dst, template, sliceType$3.nil, src, match);
	};
	Regexp.prototype.ExpandString = function(dst, template, src, match) { return this.$val.ExpandString(dst, template, src, match); };
	Regexp.ptr.prototype.expand = function(dst, template, bsrc, src, match) {
		var $ptr, _i, _ref, _tuple, bsrc, dst, i, i$1, match, name, namei, num, ok, re, rest, src, template, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		re = this;
		while (true) {
			if (!(template.length > 0)) { break; }
			i = strings.Index(template, "$");
			if (i < 0) {
				break;
			}
			dst = $appendSlice(dst, template.substring(0, i));
			template = template.substring(i);
			if (template.length > 1 && (template.charCodeAt(1) === 36)) {
				dst = $append(dst, 36);
				template = template.substring(2);
				continue;
			}
			_tuple = extract(template);
			name = _tuple[0];
			num = _tuple[1];
			rest = _tuple[2];
			ok = _tuple[3];
			if (!ok) {
				dst = $append(dst, 36);
				template = template.substring(1);
				continue;
			}
			template = rest;
			if (num >= 0) {
				if ((($imul(2, num)) + 1 >> 0) < match.$length && (x = $imul(2, num), ((x < 0 || x >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x])) >= 0) {
					if (!(bsrc === sliceType$3.nil)) {
						dst = $appendSlice(dst, $subslice(bsrc, (x$1 = $imul(2, num), ((x$1 < 0 || x$1 >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x$1])), (x$2 = ($imul(2, num)) + 1 >> 0, ((x$2 < 0 || x$2 >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x$2]))));
					} else {
						dst = $appendSlice(dst, src.substring((x$3 = $imul(2, num), ((x$3 < 0 || x$3 >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x$3])), (x$4 = ($imul(2, num)) + 1 >> 0, ((x$4 < 0 || x$4 >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x$4]))));
					}
				}
			} else {
				_ref = re.subexpNames;
				_i = 0;
				while (true) {
					if (!(_i < _ref.$length)) { break; }
					i$1 = _i;
					namei = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
					if (name === namei && (($imul(2, i$1)) + 1 >> 0) < match.$length && (x$5 = $imul(2, i$1), ((x$5 < 0 || x$5 >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x$5])) >= 0) {
						if (!(bsrc === sliceType$3.nil)) {
							dst = $appendSlice(dst, $subslice(bsrc, (x$6 = $imul(2, i$1), ((x$6 < 0 || x$6 >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x$6])), (x$7 = ($imul(2, i$1)) + 1 >> 0, ((x$7 < 0 || x$7 >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x$7]))));
						} else {
							dst = $appendSlice(dst, src.substring((x$8 = $imul(2, i$1), ((x$8 < 0 || x$8 >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x$8])), (x$9 = ($imul(2, i$1)) + 1 >> 0, ((x$9 < 0 || x$9 >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x$9]))));
						}
						break;
					}
					_i++;
				}
			}
		}
		dst = $appendSlice(dst, template);
		return dst;
	};
	Regexp.prototype.expand = function(dst, template, bsrc, src, match) { return this.$val.expand(dst, template, bsrc, src, match); };
	extract = function(str) {
		var $ptr, _tuple, brace, i, i$1, name, num, ok, rest, rune, size, str;
		name = "";
		num = 0;
		rest = "";
		ok = false;
		if (str.length < 2 || !((str.charCodeAt(0) === 36))) {
			return [name, num, rest, ok];
		}
		brace = false;
		if (str.charCodeAt(1) === 123) {
			brace = true;
			str = str.substring(2);
		} else {
			str = str.substring(1);
		}
		i = 0;
		while (true) {
			if (!(i < str.length)) { break; }
			_tuple = utf8.DecodeRuneInString(str.substring(i));
			rune = _tuple[0];
			size = _tuple[1];
			if (!unicode.IsLetter(rune) && !unicode.IsDigit(rune) && !((rune === 95))) {
				break;
			}
			i = i + (size) >> 0;
		}
		if (i === 0) {
			return [name, num, rest, ok];
		}
		name = str.substring(0, i);
		if (brace) {
			if (i >= str.length || !((str.charCodeAt(i) === 125))) {
				return [name, num, rest, ok];
			}
			i = i + (1) >> 0;
		}
		num = 0;
		i$1 = 0;
		while (true) {
			if (!(i$1 < name.length)) { break; }
			if (name.charCodeAt(i$1) < 48 || 57 < name.charCodeAt(i$1) || num >= 100000000) {
				num = -1;
				break;
			}
			num = (($imul(num, 10)) + (name.charCodeAt(i$1) >> 0) >> 0) - 48 >> 0;
			i$1 = i$1 + (1) >> 0;
		}
		if ((name.charCodeAt(0) === 48) && name.length > 1) {
			num = -1;
		}
		rest = str.substring(i);
		ok = true;
		return [name, num, rest, ok];
	};
	Regexp.ptr.prototype.FindSubmatchIndex = function(b) {
		var $ptr, _r, _r$1, b, re, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; b = $f.b; re = $f.re; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = this;
		_r = re.doExecute($ifaceNil, b, "", 0, re.prog.NumCap); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = re.pad(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindSubmatchIndex }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.b = b; $f.re = re; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindSubmatchIndex = function(b) { return this.$val.FindSubmatchIndex(b); };
	Regexp.ptr.prototype.FindStringSubmatch = function(s) {
		var $ptr, _i, _r, _ref, a, i, re, ret, s, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; a = $f.a; i = $f.i; re = $f.re; ret = $f.ret; s = $f.s; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = this;
		_r = re.doExecute($ifaceNil, sliceType$3.nil, s, 0, re.prog.NumCap); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		a = _r;
		if (a === sliceType.nil) {
			return sliceType$10.nil;
		}
		ret = $makeSlice(sliceType$10, (1 + re.numSubexp >> 0));
		_ref = ret;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			if (($imul(2, i)) < a.$length && (x = $imul(2, i), ((x < 0 || x >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + x])) >= 0) {
				((i < 0 || i >= ret.$length) ? $throwRuntimeError("index out of range") : ret.$array[ret.$offset + i] = s.substring((x$1 = $imul(2, i), ((x$1 < 0 || x$1 >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + x$1])), (x$2 = ($imul(2, i)) + 1 >> 0, ((x$2 < 0 || x$2 >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + x$2]))));
			}
			_i++;
		}
		return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindStringSubmatch }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f.a = a; $f.i = i; $f.re = re; $f.ret = ret; $f.s = s; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindStringSubmatch = function(s) { return this.$val.FindStringSubmatch(s); };
	Regexp.ptr.prototype.FindStringSubmatchIndex = function(s) {
		var $ptr, _r, _r$1, re, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; re = $f.re; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = this;
		_r = re.doExecute($ifaceNil, sliceType$3.nil, s, 0, re.prog.NumCap); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = re.pad(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindStringSubmatchIndex }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.re = re; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindStringSubmatchIndex = function(s) { return this.$val.FindStringSubmatchIndex(s); };
	Regexp.ptr.prototype.FindReaderSubmatchIndex = function(r) {
		var $ptr, _r, _r$1, r, re, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; r = $f.r; re = $f.re; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = this;
		_r = re.doExecute(r, sliceType$3.nil, "", 0, re.prog.NumCap); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = re.pad(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindReaderSubmatchIndex }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.r = r; $f.re = re; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindReaderSubmatchIndex = function(r) { return this.$val.FindReaderSubmatchIndex(r); };
	Regexp.ptr.prototype.FindAll = function(b, n) {
		var $ptr, b, n, re, result, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; b = $f.b; n = $f.n; re = $f.re; result = $f.result; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		b = [b];
		result = [result];
		re = this;
		if (n < 0) {
			n = b[0].$length + 1 >> 0;
		}
		result[0] = $makeSlice(sliceType$11, 0, 10);
		$r = re.allMatches("", b[0], n, (function(b, result) { return function(match) {
			var $ptr, match;
			result[0] = $append(result[0], $subslice(b[0], (0 >= match.$length ? $throwRuntimeError("index out of range") : match.$array[match.$offset + 0]), (1 >= match.$length ? $throwRuntimeError("index out of range") : match.$array[match.$offset + 1])));
		}; })(b, result)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (result[0].$length === 0) {
			return sliceType$11.nil;
		}
		return result[0];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindAll }; } $f.$ptr = $ptr; $f.b = b; $f.n = n; $f.re = re; $f.result = result; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindAll = function(b, n) { return this.$val.FindAll(b, n); };
	Regexp.ptr.prototype.FindAllIndex = function(b, n) {
		var $ptr, b, n, re, result, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; b = $f.b; n = $f.n; re = $f.re; result = $f.result; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		result = [result];
		re = this;
		if (n < 0) {
			n = b.$length + 1 >> 0;
		}
		result[0] = $makeSlice(sliceType$12, 0, 10);
		$r = re.allMatches("", b, n, (function(result) { return function(match) {
			var $ptr, match;
			result[0] = $append(result[0], $subslice(match, 0, 2));
		}; })(result)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (result[0].$length === 0) {
			return sliceType$12.nil;
		}
		return result[0];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindAllIndex }; } $f.$ptr = $ptr; $f.b = b; $f.n = n; $f.re = re; $f.result = result; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindAllIndex = function(b, n) { return this.$val.FindAllIndex(b, n); };
	Regexp.ptr.prototype.FindAllString = function(s, n) {
		var $ptr, n, re, result, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; n = $f.n; re = $f.re; result = $f.result; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		result = [result];
		s = [s];
		re = this;
		if (n < 0) {
			n = s[0].length + 1 >> 0;
		}
		result[0] = $makeSlice(sliceType$10, 0, 10);
		$r = re.allMatches(s[0], sliceType$3.nil, n, (function(result, s) { return function(match) {
			var $ptr, match;
			result[0] = $append(result[0], s[0].substring((0 >= match.$length ? $throwRuntimeError("index out of range") : match.$array[match.$offset + 0]), (1 >= match.$length ? $throwRuntimeError("index out of range") : match.$array[match.$offset + 1])));
		}; })(result, s)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (result[0].$length === 0) {
			return sliceType$10.nil;
		}
		return result[0];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindAllString }; } $f.$ptr = $ptr; $f.n = n; $f.re = re; $f.result = result; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindAllString = function(s, n) { return this.$val.FindAllString(s, n); };
	Regexp.ptr.prototype.FindAllStringIndex = function(s, n) {
		var $ptr, n, re, result, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; n = $f.n; re = $f.re; result = $f.result; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		result = [result];
		re = this;
		if (n < 0) {
			n = s.length + 1 >> 0;
		}
		result[0] = $makeSlice(sliceType$12, 0, 10);
		$r = re.allMatches(s, sliceType$3.nil, n, (function(result) { return function(match) {
			var $ptr, match;
			result[0] = $append(result[0], $subslice(match, 0, 2));
		}; })(result)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (result[0].$length === 0) {
			return sliceType$12.nil;
		}
		return result[0];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindAllStringIndex }; } $f.$ptr = $ptr; $f.n = n; $f.re = re; $f.result = result; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindAllStringIndex = function(s, n) { return this.$val.FindAllStringIndex(s, n); };
	Regexp.ptr.prototype.FindAllSubmatch = function(b, n) {
		var $ptr, b, n, re, result, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; b = $f.b; n = $f.n; re = $f.re; result = $f.result; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		b = [b];
		result = [result];
		re = this;
		if (n < 0) {
			n = b[0].$length + 1 >> 0;
		}
		result[0] = $makeSlice(sliceType$13, 0, 10);
		$r = re.allMatches("", b[0], n, (function(b, result) { return function(match) {
			var $ptr, _i, _q, _ref, j, match, slice, x, x$1, x$2;
			slice = $makeSlice(sliceType$11, (_q = match.$length / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")));
			_ref = slice;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				j = _i;
				if ((x = $imul(2, j), ((x < 0 || x >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x])) >= 0) {
					((j < 0 || j >= slice.$length) ? $throwRuntimeError("index out of range") : slice.$array[slice.$offset + j] = $subslice(b[0], (x$1 = $imul(2, j), ((x$1 < 0 || x$1 >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x$1])), (x$2 = ($imul(2, j)) + 1 >> 0, ((x$2 < 0 || x$2 >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x$2]))));
				}
				_i++;
			}
			result[0] = $append(result[0], slice);
		}; })(b, result)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (result[0].$length === 0) {
			return sliceType$13.nil;
		}
		return result[0];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindAllSubmatch }; } $f.$ptr = $ptr; $f.b = b; $f.n = n; $f.re = re; $f.result = result; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindAllSubmatch = function(b, n) { return this.$val.FindAllSubmatch(b, n); };
	Regexp.ptr.prototype.FindAllSubmatchIndex = function(b, n) {
		var $ptr, b, n, re, result, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; b = $f.b; n = $f.n; re = $f.re; result = $f.result; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		result = [result];
		re = this;
		if (n < 0) {
			n = b.$length + 1 >> 0;
		}
		result[0] = $makeSlice(sliceType$12, 0, 10);
		$r = re.allMatches("", b, n, (function(result) { return function(match) {
			var $ptr, match;
			result[0] = $append(result[0], match);
		}; })(result)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (result[0].$length === 0) {
			return sliceType$12.nil;
		}
		return result[0];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindAllSubmatchIndex }; } $f.$ptr = $ptr; $f.b = b; $f.n = n; $f.re = re; $f.result = result; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindAllSubmatchIndex = function(b, n) { return this.$val.FindAllSubmatchIndex(b, n); };
	Regexp.ptr.prototype.FindAllStringSubmatch = function(s, n) {
		var $ptr, n, re, result, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; n = $f.n; re = $f.re; result = $f.result; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		result = [result];
		s = [s];
		re = this;
		if (n < 0) {
			n = s[0].length + 1 >> 0;
		}
		result[0] = $makeSlice(sliceType$14, 0, 10);
		$r = re.allMatches(s[0], sliceType$3.nil, n, (function(result, s) { return function(match) {
			var $ptr, _i, _q, _ref, j, match, slice, x, x$1, x$2;
			slice = $makeSlice(sliceType$10, (_q = match.$length / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")));
			_ref = slice;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				j = _i;
				if ((x = $imul(2, j), ((x < 0 || x >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x])) >= 0) {
					((j < 0 || j >= slice.$length) ? $throwRuntimeError("index out of range") : slice.$array[slice.$offset + j] = s[0].substring((x$1 = $imul(2, j), ((x$1 < 0 || x$1 >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x$1])), (x$2 = ($imul(2, j)) + 1 >> 0, ((x$2 < 0 || x$2 >= match.$length) ? $throwRuntimeError("index out of range") : match.$array[match.$offset + x$2]))));
				}
				_i++;
			}
			result[0] = $append(result[0], slice);
		}; })(result, s)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (result[0].$length === 0) {
			return sliceType$14.nil;
		}
		return result[0];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindAllStringSubmatch }; } $f.$ptr = $ptr; $f.n = n; $f.re = re; $f.result = result; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindAllStringSubmatch = function(s, n) { return this.$val.FindAllStringSubmatch(s, n); };
	Regexp.ptr.prototype.FindAllStringSubmatchIndex = function(s, n) {
		var $ptr, n, re, result, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; n = $f.n; re = $f.re; result = $f.result; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		result = [result];
		re = this;
		if (n < 0) {
			n = s.length + 1 >> 0;
		}
		result[0] = $makeSlice(sliceType$12, 0, 10);
		$r = re.allMatches(s, sliceType$3.nil, n, (function(result) { return function(match) {
			var $ptr, match;
			result[0] = $append(result[0], match);
		}; })(result)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (result[0].$length === 0) {
			return sliceType$12.nil;
		}
		return result[0];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.FindAllStringSubmatchIndex }; } $f.$ptr = $ptr; $f.n = n; $f.re = re; $f.result = result; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.FindAllStringSubmatchIndex = function(s, n) { return this.$val.FindAllStringSubmatchIndex(s, n); };
	Regexp.ptr.prototype.Split = function(s, n) {
		var $ptr, _i, _r, _ref, beg, end, match, matches, n, re, s, strings$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; beg = $f.beg; end = $f.end; match = $f.match; matches = $f.matches; n = $f.n; re = $f.re; s = $f.s; strings$1 = $f.strings$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		re = this;
		if (n === 0) {
			return sliceType$10.nil;
		}
		if (re.expr.length > 0 && (s.length === 0)) {
			return new sliceType$10([""]);
		}
		_r = re.FindAllStringIndex(s, n); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		matches = _r;
		strings$1 = $makeSlice(sliceType$10, 0, matches.$length);
		beg = 0;
		end = 0;
		_ref = matches;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			match = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (n > 0 && strings$1.$length >= (n - 1 >> 0)) {
				break;
			}
			end = (0 >= match.$length ? $throwRuntimeError("index out of range") : match.$array[match.$offset + 0]);
			if (!(((1 >= match.$length ? $throwRuntimeError("index out of range") : match.$array[match.$offset + 1]) === 0))) {
				strings$1 = $append(strings$1, s.substring(beg, end));
			}
			beg = (1 >= match.$length ? $throwRuntimeError("index out of range") : match.$array[match.$offset + 1]);
			_i++;
		}
		if (!((end === s.length))) {
			strings$1 = $append(strings$1, s.substring(beg));
		}
		return strings$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Regexp.ptr.prototype.Split }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f.beg = beg; $f.end = end; $f.match = match; $f.matches = matches; $f.n = n; $f.re = re; $f.s = s; $f.strings$1 = strings$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Regexp.prototype.Split = function(s, n) { return this.$val.Split(s, n); };
	ptrType.methods = [{prop: "reset", name: "reset", pkg: "regexp", typ: $funcType([$Int, $Int], [], false)}, {prop: "shouldVisit", name: "shouldVisit", pkg: "regexp", typ: $funcType([$Uint32, $Int], [$Bool], false)}, {prop: "push", name: "push", pkg: "regexp", typ: $funcType([$Uint32, $Int, $Int], [], false)}];
	ptrType$10.methods = [{prop: "tryBacktrack", name: "tryBacktrack", pkg: "regexp", typ: $funcType([ptrType, input, $Uint32, $Int], [$Bool], false)}, {prop: "backtrack", name: "backtrack", pkg: "regexp", typ: $funcType([input, $Int, $Int, $Int], [$Bool], false)}, {prop: "newInputBytes", name: "newInputBytes", pkg: "regexp", typ: $funcType([sliceType$3], [input], false)}, {prop: "newInputString", name: "newInputString", pkg: "regexp", typ: $funcType([$String], [input], false)}, {prop: "newInputReader", name: "newInputReader", pkg: "regexp", typ: $funcType([io.RuneReader], [input], false)}, {prop: "init", name: "init", pkg: "regexp", typ: $funcType([$Int], [], false)}, {prop: "alloc", name: "alloc", pkg: "regexp", typ: $funcType([ptrType$5], [ptrType$4], false)}, {prop: "free", name: "free", pkg: "regexp", typ: $funcType([ptrType$4], [], false)}, {prop: "match", name: "match", pkg: "regexp", typ: $funcType([input, $Int], [$Bool], false)}, {prop: "clear", name: "clear", pkg: "regexp", typ: $funcType([ptrType$11], [], false)}, {prop: "step", name: "step", pkg: "regexp", typ: $funcType([ptrType$11, ptrType$11, $Int, $Int, $Int32, syntax.EmptyOp], [], false)}, {prop: "add", name: "add", pkg: "regexp", typ: $funcType([ptrType$11, $Uint32, $Int, sliceType, syntax.EmptyOp, ptrType$4], [ptrType$4], false)}, {prop: "onepass", name: "onepass", pkg: "regexp", typ: $funcType([input, $Int], [$Bool], false)}];
	ptrType$7.methods = [{prop: "empty", name: "empty", pkg: "regexp", typ: $funcType([], [$Bool], false)}, {prop: "next", name: "next", pkg: "regexp", typ: $funcType([], [$Uint32], false)}, {prop: "clear", name: "clear", pkg: "regexp", typ: $funcType([], [], false)}, {prop: "contains", name: "contains", pkg: "regexp", typ: $funcType([$Uint32], [$Bool], false)}, {prop: "insert", name: "insert", pkg: "regexp", typ: $funcType([$Uint32], [], false)}, {prop: "insertNew", name: "insertNew", pkg: "regexp", typ: $funcType([$Uint32], [], false)}];
	runeSlice.methods = [{prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Less", name: "Less", pkg: "", typ: $funcType([$Int, $Int], [$Bool], false)}, {prop: "Swap", name: "Swap", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Sort", name: "Sort", pkg: "", typ: $funcType([], [], false)}];
	ptrType$3.methods = [{prop: "doExecute", name: "doExecute", pkg: "regexp", typ: $funcType([io.RuneReader, sliceType$3, $String, $Int, $Int], [sliceType], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Copy", name: "Copy", pkg: "", typ: $funcType([], [ptrType$3], false)}, {prop: "Longest", name: "Longest", pkg: "", typ: $funcType([], [], false)}, {prop: "get", name: "get", pkg: "regexp", typ: $funcType([], [ptrType$10], false)}, {prop: "put", name: "put", pkg: "regexp", typ: $funcType([ptrType$10], [], false)}, {prop: "NumSubexp", name: "NumSubexp", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "SubexpNames", name: "SubexpNames", pkg: "", typ: $funcType([], [sliceType$10], false)}, {prop: "LiteralPrefix", name: "LiteralPrefix", pkg: "", typ: $funcType([], [$String, $Bool], false)}, {prop: "MatchReader", name: "MatchReader", pkg: "", typ: $funcType([io.RuneReader], [$Bool], false)}, {prop: "MatchString", name: "MatchString", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "Match", name: "Match", pkg: "", typ: $funcType([sliceType$3], [$Bool], false)}, {prop: "ReplaceAllString", name: "ReplaceAllString", pkg: "", typ: $funcType([$String, $String], [$String], false)}, {prop: "ReplaceAllLiteralString", name: "ReplaceAllLiteralString", pkg: "", typ: $funcType([$String, $String], [$String], false)}, {prop: "ReplaceAllStringFunc", name: "ReplaceAllStringFunc", pkg: "", typ: $funcType([$String, funcType], [$String], false)}, {prop: "replaceAll", name: "replaceAll", pkg: "regexp", typ: $funcType([sliceType$3, $String, $Int, funcType$1], [sliceType$3], false)}, {prop: "ReplaceAll", name: "ReplaceAll", pkg: "", typ: $funcType([sliceType$3, sliceType$3], [sliceType$3], false)}, {prop: "ReplaceAllLiteral", name: "ReplaceAllLiteral", pkg: "", typ: $funcType([sliceType$3, sliceType$3], [sliceType$3], false)}, {prop: "ReplaceAllFunc", name: "ReplaceAllFunc", pkg: "", typ: $funcType([sliceType$3, funcType$2], [sliceType$3], false)}, {prop: "pad", name: "pad", pkg: "regexp", typ: $funcType([sliceType], [sliceType], false)}, {prop: "allMatches", name: "allMatches", pkg: "regexp", typ: $funcType([$String, sliceType$3, $Int, funcType$3], [], false)}, {prop: "Find", name: "Find", pkg: "", typ: $funcType([sliceType$3], [sliceType$3], false)}, {prop: "FindIndex", name: "FindIndex", pkg: "", typ: $funcType([sliceType$3], [sliceType], false)}, {prop: "FindString", name: "FindString", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "FindStringIndex", name: "FindStringIndex", pkg: "", typ: $funcType([$String], [sliceType], false)}, {prop: "FindReaderIndex", name: "FindReaderIndex", pkg: "", typ: $funcType([io.RuneReader], [sliceType], false)}, {prop: "FindSubmatch", name: "FindSubmatch", pkg: "", typ: $funcType([sliceType$3], [sliceType$11], false)}, {prop: "Expand", name: "Expand", pkg: "", typ: $funcType([sliceType$3, sliceType$3, sliceType$3, sliceType], [sliceType$3], false)}, {prop: "ExpandString", name: "ExpandString", pkg: "", typ: $funcType([sliceType$3, $String, $String, sliceType], [sliceType$3], false)}, {prop: "expand", name: "expand", pkg: "regexp", typ: $funcType([sliceType$3, $String, sliceType$3, $String, sliceType], [sliceType$3], false)}, {prop: "FindSubmatchIndex", name: "FindSubmatchIndex", pkg: "", typ: $funcType([sliceType$3], [sliceType], false)}, {prop: "FindStringSubmatch", name: "FindStringSubmatch", pkg: "", typ: $funcType([$String], [sliceType$10], false)}, {prop: "FindStringSubmatchIndex", name: "FindStringSubmatchIndex", pkg: "", typ: $funcType([$String], [sliceType], false)}, {prop: "FindReaderSubmatchIndex", name: "FindReaderSubmatchIndex", pkg: "", typ: $funcType([io.RuneReader], [sliceType], false)}, {prop: "FindAll", name: "FindAll", pkg: "", typ: $funcType([sliceType$3, $Int], [sliceType$11], false)}, {prop: "FindAllIndex", name: "FindAllIndex", pkg: "", typ: $funcType([sliceType$3, $Int], [sliceType$12], false)}, {prop: "FindAllString", name: "FindAllString", pkg: "", typ: $funcType([$String, $Int], [sliceType$10], false)}, {prop: "FindAllStringIndex", name: "FindAllStringIndex", pkg: "", typ: $funcType([$String, $Int], [sliceType$12], false)}, {prop: "FindAllSubmatch", name: "FindAllSubmatch", pkg: "", typ: $funcType([sliceType$3, $Int], [sliceType$13], false)}, {prop: "FindAllSubmatchIndex", name: "FindAllSubmatchIndex", pkg: "", typ: $funcType([sliceType$3, $Int], [sliceType$12], false)}, {prop: "FindAllStringSubmatch", name: "FindAllStringSubmatch", pkg: "", typ: $funcType([$String, $Int], [sliceType$14], false)}, {prop: "FindAllStringSubmatchIndex", name: "FindAllStringSubmatchIndex", pkg: "", typ: $funcType([$String, $Int], [sliceType$12], false)}, {prop: "Split", name: "Split", pkg: "", typ: $funcType([$String, $Int], [sliceType$10], false)}];
	ptrType$12.methods = [{prop: "step", name: "step", pkg: "regexp", typ: $funcType([$Int], [$Int32, $Int], false)}, {prop: "canCheckPrefix", name: "canCheckPrefix", pkg: "regexp", typ: $funcType([], [$Bool], false)}, {prop: "hasPrefix", name: "hasPrefix", pkg: "regexp", typ: $funcType([ptrType$3], [$Bool], false)}, {prop: "index", name: "index", pkg: "regexp", typ: $funcType([ptrType$3, $Int], [$Int], false)}, {prop: "context", name: "context", pkg: "regexp", typ: $funcType([$Int], [syntax.EmptyOp], false)}];
	ptrType$13.methods = [{prop: "step", name: "step", pkg: "regexp", typ: $funcType([$Int], [$Int32, $Int], false)}, {prop: "canCheckPrefix", name: "canCheckPrefix", pkg: "regexp", typ: $funcType([], [$Bool], false)}, {prop: "hasPrefix", name: "hasPrefix", pkg: "regexp", typ: $funcType([ptrType$3], [$Bool], false)}, {prop: "index", name: "index", pkg: "regexp", typ: $funcType([ptrType$3, $Int], [$Int], false)}, {prop: "context", name: "context", pkg: "regexp", typ: $funcType([$Int], [syntax.EmptyOp], false)}];
	ptrType$14.methods = [{prop: "step", name: "step", pkg: "regexp", typ: $funcType([$Int], [$Int32, $Int], false)}, {prop: "canCheckPrefix", name: "canCheckPrefix", pkg: "regexp", typ: $funcType([], [$Bool], false)}, {prop: "hasPrefix", name: "hasPrefix", pkg: "regexp", typ: $funcType([ptrType$3], [$Bool], false)}, {prop: "index", name: "index", pkg: "regexp", typ: $funcType([ptrType$3, $Int], [$Int], false)}, {prop: "context", name: "context", pkg: "regexp", typ: $funcType([$Int], [syntax.EmptyOp], false)}];
	job.init([{prop: "pc", name: "pc", pkg: "regexp", typ: $Uint32, tag: ""}, {prop: "arg", name: "arg", pkg: "regexp", typ: $Int, tag: ""}, {prop: "pos", name: "pos", pkg: "regexp", typ: $Int, tag: ""}]);
	bitState.init([{prop: "prog", name: "prog", pkg: "regexp", typ: ptrType$2, tag: ""}, {prop: "end", name: "end", pkg: "regexp", typ: $Int, tag: ""}, {prop: "cap", name: "cap", pkg: "regexp", typ: sliceType, tag: ""}, {prop: "input", name: "input", pkg: "regexp", typ: input, tag: ""}, {prop: "jobs", name: "jobs", pkg: "regexp", typ: sliceType$4, tag: ""}, {prop: "visited", name: "visited", pkg: "regexp", typ: sliceType$2, tag: ""}]);
	queue.init([{prop: "sparse", name: "sparse", pkg: "regexp", typ: sliceType$2, tag: ""}, {prop: "dense", name: "dense", pkg: "regexp", typ: sliceType$5, tag: ""}]);
	entry.init([{prop: "pc", name: "pc", pkg: "regexp", typ: $Uint32, tag: ""}, {prop: "t", name: "t", pkg: "regexp", typ: ptrType$4, tag: ""}]);
	thread.init([{prop: "inst", name: "inst", pkg: "regexp", typ: ptrType$5, tag: ""}, {prop: "cap", name: "cap", pkg: "regexp", typ: sliceType, tag: ""}]);
	machine.init([{prop: "re", name: "re", pkg: "regexp", typ: ptrType$3, tag: ""}, {prop: "p", name: "p", pkg: "regexp", typ: ptrType$2, tag: ""}, {prop: "op", name: "op", pkg: "regexp", typ: ptrType$1, tag: ""}, {prop: "maxBitStateLen", name: "maxBitStateLen", pkg: "regexp", typ: $Int, tag: ""}, {prop: "b", name: "b", pkg: "regexp", typ: ptrType, tag: ""}, {prop: "q0", name: "q0", pkg: "regexp", typ: queue, tag: ""}, {prop: "q1", name: "q1", pkg: "regexp", typ: queue, tag: ""}, {prop: "pool", name: "pool", pkg: "regexp", typ: sliceType$6, tag: ""}, {prop: "matched", name: "matched", pkg: "regexp", typ: $Bool, tag: ""}, {prop: "matchcap", name: "matchcap", pkg: "regexp", typ: sliceType, tag: ""}, {prop: "inputBytes", name: "inputBytes", pkg: "regexp", typ: inputBytes, tag: ""}, {prop: "inputString", name: "inputString", pkg: "regexp", typ: inputString, tag: ""}, {prop: "inputReader", name: "inputReader", pkg: "regexp", typ: inputReader, tag: ""}]);
	onePassProg.init([{prop: "Inst", name: "Inst", pkg: "", typ: sliceType$7, tag: ""}, {prop: "Start", name: "Start", pkg: "", typ: $Int, tag: ""}, {prop: "NumCap", name: "NumCap", pkg: "", typ: $Int, tag: ""}]);
	onePassInst.init([{prop: "Inst", name: "", pkg: "", typ: syntax.Inst, tag: ""}, {prop: "Next", name: "Next", pkg: "", typ: sliceType$2, tag: ""}]);
	queueOnePass.init([{prop: "sparse", name: "sparse", pkg: "regexp", typ: sliceType$2, tag: ""}, {prop: "dense", name: "dense", pkg: "regexp", typ: sliceType$2, tag: ""}, {prop: "size", name: "size", pkg: "regexp", typ: $Uint32, tag: ""}, {prop: "nextIndex", name: "nextIndex", pkg: "regexp", typ: $Uint32, tag: ""}]);
	runeSlice.init($Int32);
	Regexp.init([{prop: "expr", name: "expr", pkg: "regexp", typ: $String, tag: ""}, {prop: "prog", name: "prog", pkg: "regexp", typ: ptrType$2, tag: ""}, {prop: "onepass", name: "onepass", pkg: "regexp", typ: ptrType$1, tag: ""}, {prop: "prefix", name: "prefix", pkg: "regexp", typ: $String, tag: ""}, {prop: "prefixBytes", name: "prefixBytes", pkg: "regexp", typ: sliceType$3, tag: ""}, {prop: "prefixComplete", name: "prefixComplete", pkg: "regexp", typ: $Bool, tag: ""}, {prop: "prefixRune", name: "prefixRune", pkg: "regexp", typ: $Int32, tag: ""}, {prop: "prefixEnd", name: "prefixEnd", pkg: "regexp", typ: $Uint32, tag: ""}, {prop: "cond", name: "cond", pkg: "regexp", typ: syntax.EmptyOp, tag: ""}, {prop: "numSubexp", name: "numSubexp", pkg: "regexp", typ: $Int, tag: ""}, {prop: "subexpNames", name: "subexpNames", pkg: "regexp", typ: sliceType$10, tag: ""}, {prop: "longest", name: "longest", pkg: "regexp", typ: $Bool, tag: ""}, {prop: "mu", name: "mu", pkg: "regexp", typ: nosync.Mutex, tag: ""}, {prop: "machine", name: "machine", pkg: "regexp", typ: sliceType$9, tag: ""}]);
	input.init([{prop: "canCheckPrefix", name: "canCheckPrefix", pkg: "regexp", typ: $funcType([], [$Bool], false)}, {prop: "context", name: "context", pkg: "regexp", typ: $funcType([$Int], [syntax.EmptyOp], false)}, {prop: "hasPrefix", name: "hasPrefix", pkg: "regexp", typ: $funcType([ptrType$3], [$Bool], false)}, {prop: "index", name: "index", pkg: "regexp", typ: $funcType([ptrType$3, $Int], [$Int], false)}, {prop: "step", name: "step", pkg: "regexp", typ: $funcType([$Int], [$Int32, $Int], false)}]);
	inputString.init([{prop: "str", name: "str", pkg: "regexp", typ: $String, tag: ""}]);
	inputBytes.init([{prop: "str", name: "str", pkg: "regexp", typ: sliceType$3, tag: ""}]);
	inputReader.init([{prop: "r", name: "r", pkg: "regexp", typ: io.RuneReader, tag: ""}, {prop: "atEOT", name: "atEOT", pkg: "regexp", typ: $Bool, tag: ""}, {prop: "pos", name: "pos", pkg: "regexp", typ: $Int, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = bytes.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = nosync.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = syntax.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sort.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		notBacktrack = ptrType.nil;
		empty = $makeSlice(sliceType, 0);
		noRune = new sliceType$1([]);
		noNext = new sliceType$2([4294967295]);
		anyRuneNotNL = new sliceType$1([0, 9, 11, 1114111]);
		anyRune = new sliceType$1([0, 1114111]);
		notOnePass = ptrType$1.nil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/siongui/gopherjs-tooltip-every-word"] = (function() {
	var $pkg = {}, $init, js, tooltip, regexp, strings, paliWord, _r, markPaliWordInSpan, toDom, traverse, AddTooltipToEveryWord;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	tooltip = $packages["github.com/siongui/gopherjs-tooltip"];
	regexp = $packages["regexp"];
	strings = $packages["strings"];
	markPaliWordInSpan = function(s) {
		var $ptr, _r$1, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r$1 = paliWord.ReplaceAllStringFunc(s, (function(match) {
			var $ptr, match;
			return "<span>" + match + "</span>";
		})); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: markPaliWordInSpan }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	toDom = function(s) {
		var $ptr, _r$1, _r$2, i, length, s, span, spanContainer, spans, tooltipContent, word, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; i = $f.i; length = $f.length; s = $f.s; span = $f.span; spanContainer = $f.spanContainer; spans = $f.spans; tooltipContent = $f.tooltipContent; word = $f.word; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		spanContainer = $global.document.createElement($externalize("span", $String));
		_r$1 = markPaliWordInSpan(s); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		spanContainer.innerHTML = $externalize(_r$1, $String);
		spans = spanContainer.getElementsByTagName($externalize("span", $String));
		length = $parseInt(spans.length) >> 0;
		i = 0;
		/* while (true) { */ case 2:
			/* if (!(i < length)) { break; } */ if(!(i < length)) { $s = 3; continue; }
			span = spans.item(i);
			_r$2 = strings.ToLower($internalize(span.innerHTML, $String)); /* */ $s = 4; case 4: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			word = _r$2;
			tooltipContent = word + " " + word + "<br>" + "<span>" + word + "</span>" + " " + word;
			tooltip.AddTooltipToElement(span, tooltipContent);
			i = i + (1) >> 0;
		/* } */ $s = 2; continue; case 3:
		return spanContainer;
		/* */ } return; } if ($f === undefined) { $f = { $blk: toDom }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.i = i; $f.length = length; $f.s = s; $f.span = span; $f.spanContainer = spanContainer; $f.spans = spans; $f.tooltipContent = tooltipContent; $f.word = word; $f.$s = $s; $f.$r = $r; return $f;
	};
	traverse = function(elm) {
		var $ptr, _r$1, _r$2, childNodesList, elm, i, length, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; childNodesList = $f.childNodesList; elm = $f.elm; i = $f.i; length = $f.length; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ if (($parseInt(elm.nodeType) >> 0) === 1) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (($parseInt(elm.nodeType) >> 0) === 1) { */ case 1:
			childNodesList = elm.childNodes;
			length = $parseInt(childNodesList.length) >> 0;
			i = 0;
			/* while (true) { */ case 3:
				/* if (!(i < length)) { break; } */ if(!(i < length)) { $s = 4; continue; }
				$r = traverse(childNodesList.item(i)); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				i = i + (1) >> 0;
			/* } */ $s = 3; continue; case 4:
			return;
		/* } */ case 2:
		/* */ if (($parseInt(elm.nodeType) >> 0) === 3) { $s = 6; continue; }
		/* */ $s = 7; continue;
		/* if (($parseInt(elm.nodeType) >> 0) === 3) { */ case 6:
			s = $internalize(elm.nodeValue, $String);
			_r$1 = strings.TrimSpace(s); /* */ $s = 10; case 10: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ if (!(_r$1 === "")) { $s = 8; continue; }
			/* */ $s = 9; continue;
			/* if (!(_r$1 === "")) { */ case 8:
				_r$2 = toDom(s); /* */ $s = 11; case 11: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				elm.parentNode.replaceChild(_r$2, elm);
			/* } */ case 9:
			return;
		/* } */ case 7:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: traverse }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.childNodesList = childNodesList; $f.elm = elm; $f.i = i; $f.length = length; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	AddTooltipToEveryWord = function(id) {
		var $ptr, element, id, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; element = $f.element; id = $f.id; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		element = $global.document.getElementById($externalize(id, $String));
		$r = traverse(element); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: AddTooltipToEveryWord }; } $f.$ptr = $ptr; $f.element = element; $f.id = id; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.AddTooltipToEveryWord = AddTooltipToEveryWord;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = tooltip.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = regexp.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		_r = regexp.MustCompile("[AaBbCcDdEeGgHhIiJjKkLlMmNnOoPpRrSsTtUuVvYy\xC4\x80\xC4\x81\xC4\xAA\xC4\xAB\xC5\xAA\xC5\xAB\xE1\xB9\x80\xE1\xB9\x81\xE1\xB9\x82\xE1\xB9\x83\xC5\x8A\xC5\x8B\xE1\xB9\x86\xE1\xB9\x87\xE1\xB9\x84\xE1\xB9\x85\xC3\x91\xC3\xB1\xE1\xB9\xAC\xE1\xB9\xAD\xE1\xB8\x8C\xE1\xB8\x8D\xE1\xB8\xB6\xE1\xB8\xB7]+"); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		paliWord = _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["main"] = (function() {
	var $pkg = {}, $init, wrapwords, main;
	wrapwords = $packages["github.com/siongui/gopherjs-tooltip-every-word"];
	main = function() {
		var $ptr, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = wrapwords.AddTooltipToEveryWord("wrap-every-word"); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: main }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = wrapwords.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ if ($pkg === $mainPkg) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if ($pkg === $mainPkg) { */ case 2:
			$r = main(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$mainFinished = true;
		/* } */ case 3:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$synthesizeMethods();
var $mainPkg = $packages["main"];
$packages["runtime"].$init();
$go($mainPkg.$init, [], true);
$flushConsole();

}).call(this);
//# sourceMappingURL=app.js.map
