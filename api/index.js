// GENERADO por `npm run vercel` a partir de vercel/entrada.ts. No editar a mano.

// node_modules/postgres/src/index.js
import os from "os";
import fs from "fs";

// node_modules/postgres/src/query.js
var originCache = /* @__PURE__ */ new Map();
var originStackCache = /* @__PURE__ */ new Map();
var originError = /* @__PURE__ */ Symbol("OriginError");
var CLOSE = {};
var Query = class extends Promise {
  constructor(strings, args, handler, canceller, options = {}) {
    let resolve, reject;
    super((a, b2) => {
      resolve = a;
      reject = b2;
    });
    this.tagged = Array.isArray(strings.raw);
    this.strings = strings;
    this.args = args;
    this.handler = handler;
    this.canceller = canceller;
    this.options = options;
    this.state = null;
    this.statement = null;
    this.resolve = (x) => (this.active = false, resolve(x));
    this.reject = (x) => (this.active = false, reject(x));
    this.active = false;
    this.cancelled = null;
    this.executed = false;
    this.signature = "";
    this[originError] = this.handler.debug ? new Error() : this.tagged && cachedError(this.strings);
  }
  get origin() {
    return (this.handler.debug ? this[originError].stack : this.tagged && originStackCache.has(this.strings) ? originStackCache.get(this.strings) : originStackCache.set(this.strings, this[originError].stack).get(this.strings)) || "";
  }
  static get [Symbol.species]() {
    return Promise;
  }
  cancel() {
    return this.canceller && (this.canceller(this), this.canceller = null);
  }
  simple() {
    this.options.simple = true;
    this.options.prepare = false;
    return this;
  }
  async readable() {
    this.simple();
    this.streaming = true;
    return this;
  }
  async writable() {
    this.simple();
    this.streaming = true;
    return this;
  }
  cursor(rows = 1, fn) {
    this.options.simple = false;
    if (typeof rows === "function") {
      fn = rows;
      rows = 1;
    }
    this.cursorRows = rows;
    if (typeof fn === "function")
      return this.cursorFn = fn, this;
    let prev;
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          if (this.executed && !this.active)
            return { done: true };
          prev && prev();
          const promise = new Promise((resolve, reject) => {
            this.cursorFn = (value) => {
              resolve({ value, done: false });
              return new Promise((r) => prev = r);
            };
            this.resolve = () => (this.active = false, resolve({ done: true }));
            this.reject = (x) => (this.active = false, reject(x));
          });
          this.execute();
          return promise;
        },
        return() {
          prev && prev(CLOSE);
          return { done: true };
        }
      })
    };
  }
  describe() {
    this.options.simple = false;
    this.onlyDescribe = this.options.prepare = true;
    return this;
  }
  stream() {
    throw new Error(".stream has been renamed to .forEach");
  }
  forEach(fn) {
    this.forEachFn = fn;
    this.handle();
    return this;
  }
  raw() {
    this.isRaw = true;
    return this;
  }
  values() {
    this.isRaw = "values";
    return this;
  }
  async handle() {
    !this.executed && (this.executed = true) && await 1 && this.handler(this);
  }
  execute() {
    this.handle();
    return this;
  }
  then() {
    this.handle();
    return super.then.apply(this, arguments);
  }
  catch() {
    this.handle();
    return super.catch.apply(this, arguments);
  }
  finally() {
    this.handle();
    return super.finally.apply(this, arguments);
  }
};
function cachedError(xs) {
  if (originCache.has(xs))
    return originCache.get(xs);
  const x = Error.stackTraceLimit;
  Error.stackTraceLimit = 4;
  originCache.set(xs, new Error());
  Error.stackTraceLimit = x;
  return originCache.get(xs);
}

// node_modules/postgres/src/errors.js
var PostgresError = class extends Error {
  constructor(x) {
    super(x.message);
    this.name = this.constructor.name;
    Object.assign(this, x);
  }
};
var Errors = {
  connection,
  postgres,
  generic,
  notSupported
};
function connection(x, options, socket) {
  const { host, port } = socket || options;
  const error = Object.assign(
    new Error("write " + x + " " + (options.path || host + ":" + port)),
    {
      code: x,
      errno: x,
      address: options.path || host
    },
    options.path ? {} : { port }
  );
  Error.captureStackTrace(error, connection);
  return error;
}
function postgres(x) {
  const error = new PostgresError(x);
  Error.captureStackTrace(error, postgres);
  return error;
}
function generic(code, message) {
  const error = Object.assign(new Error(code + ": " + message), { code });
  Error.captureStackTrace(error, generic);
  return error;
}
function notSupported(x) {
  const error = Object.assign(
    new Error(x + " (B) is not supported"),
    {
      code: "MESSAGE_NOT_SUPPORTED",
      name: x
    }
  );
  Error.captureStackTrace(error, notSupported);
  return error;
}

// node_modules/postgres/src/types.js
var types = {
  string: {
    to: 25,
    from: null,
    // defaults to string
    serialize: (x) => "" + x
  },
  number: {
    to: 0,
    from: [21, 23, 26, 700, 701],
    serialize: (x) => "" + x,
    parse: (x) => +x
  },
  json: {
    to: 114,
    from: [114, 3802],
    serialize: (x) => JSON.stringify(x),
    parse: (x) => JSON.parse(x)
  },
  boolean: {
    to: 16,
    from: 16,
    serialize: (x) => x === true ? "t" : "f",
    parse: (x) => x === "t"
  },
  date: {
    to: 1184,
    from: [1082, 1114, 1184],
    serialize: (x) => (x instanceof Date ? x : new Date(x)).toISOString(),
    parse: (x) => new Date(x)
  },
  bytea: {
    to: 17,
    from: 17,
    serialize: (x) => "\\x" + Buffer.from(x).toString("hex"),
    parse: (x) => Buffer.from(x.slice(2), "hex")
  }
};
var NotTagged = class {
  then() {
    notTagged();
  }
  catch() {
    notTagged();
  }
  finally() {
    notTagged();
  }
};
var Identifier = class extends NotTagged {
  constructor(value) {
    super();
    this.value = escapeIdentifier(value);
  }
};
var Parameter = class extends NotTagged {
  constructor(value, type, array) {
    super();
    this.value = value;
    this.type = type;
    this.array = array;
  }
};
var Builder = class extends NotTagged {
  constructor(first, rest) {
    super();
    this.first = first;
    this.rest = rest;
  }
  build(before, parameters, types2, options) {
    const keyword = builders.map(([x, fn]) => ({ fn, i: before.search(x) })).sort((a, b2) => a.i - b2.i).pop();
    return keyword.i === -1 ? escapeIdentifiers(this.first, options) : keyword.fn(this.first, this.rest, parameters, types2, options);
  }
};
function handleValue(x, parameters, types2, options) {
  let value = x instanceof Parameter ? x.value : x;
  if (value === void 0) {
    x instanceof Parameter ? x.value = options.transform.undefined : value = x = options.transform.undefined;
    if (value === void 0)
      throw Errors.generic("UNDEFINED_VALUE", "Undefined values are not allowed");
  }
  return "$" + types2.push(
    x instanceof Parameter ? (parameters.push(x.value), x.array ? x.array[x.type || inferType(x.value)] || x.type || firstIsString(x.value) : x.type) : (parameters.push(x), inferType(x))
  );
}
var defaultHandlers = typeHandlers(types);
function stringify(q, string, value, parameters, types2, options) {
  for (let i = 1; i < q.strings.length; i++) {
    string += stringifyValue(string, value, parameters, types2, options) + q.strings[i];
    value = q.args[i];
  }
  return string;
}
function stringifyValue(string, value, parameters, types2, o) {
  return value instanceof Builder ? value.build(string, parameters, types2, o) : value instanceof Query ? fragment(value, parameters, types2, o) : value instanceof Identifier ? value.value : value && value[0] instanceof Query ? value.reduce((acc, x) => acc + " " + fragment(x, parameters, types2, o), "") : handleValue(value, parameters, types2, o);
}
function fragment(q, parameters, types2, options) {
  q.fragment = true;
  return stringify(q, q.strings[0], q.args[0], parameters, types2, options);
}
function valuesBuilder(first, parameters, types2, columns, options) {
  return first.map(
    (row) => "(" + columns.map(
      (column) => stringifyValue("values", row[column], parameters, types2, options)
    ).join(",") + ")"
  ).join(",");
}
function values(first, rest, parameters, types2, options) {
  const multi = Array.isArray(first[0]);
  const columns = rest.length ? rest.flat() : Object.keys(multi ? first[0] : first);
  return valuesBuilder(multi ? first : [first], parameters, types2, columns, options);
}
function select(first, rest, parameters, types2, options) {
  typeof first === "string" && (first = [first].concat(rest));
  if (Array.isArray(first))
    return escapeIdentifiers(first, options);
  let value;
  const columns = rest.length ? rest.flat() : Object.keys(first);
  return columns.map((x) => {
    value = first[x];
    return (value instanceof Query ? fragment(value, parameters, types2, options) : value instanceof Identifier ? value.value : handleValue(value, parameters, types2, options)) + " as " + escapeIdentifier(options.transform.column.to ? options.transform.column.to(x) : x);
  }).join(",");
}
var builders = Object.entries({
  values,
  in: (...xs) => {
    const x = values(...xs);
    return x === "()" ? "(null)" : x;
  },
  select,
  as: select,
  returning: select,
  "\\(": select,
  update(first, rest, parameters, types2, options) {
    return (rest.length ? rest.flat() : Object.keys(first)).map(
      (x) => escapeIdentifier(options.transform.column.to ? options.transform.column.to(x) : x) + "=" + stringifyValue("values", first[x], parameters, types2, options)
    );
  },
  insert(first, rest, parameters, types2, options) {
    const columns = rest.length ? rest.flat() : Object.keys(Array.isArray(first) ? first[0] : first);
    return "(" + escapeIdentifiers(columns, options) + ")values" + valuesBuilder(Array.isArray(first) ? first : [first], parameters, types2, columns, options);
  }
}).map(([x, fn]) => [new RegExp("((?:^|[\\s(])" + x + "(?:$|[\\s(]))(?![\\s\\S]*\\1)", "i"), fn]);
function notTagged() {
  throw Errors.generic("NOT_TAGGED_CALL", "Query not called as a tagged template literal");
}
var serializers = defaultHandlers.serializers;
var parsers = defaultHandlers.parsers;
function firstIsString(x) {
  if (Array.isArray(x))
    return firstIsString(x[0]);
  return typeof x === "string" ? 1009 : 0;
}
var mergeUserTypes = function(types2) {
  const user = typeHandlers(types2 || {});
  return {
    serializers: Object.assign({}, serializers, user.serializers),
    parsers: Object.assign({}, parsers, user.parsers)
  };
};
function typeHandlers(types2) {
  return Object.keys(types2).reduce((acc, k) => {
    types2[k].from && [].concat(types2[k].from).forEach((x) => acc.parsers[x] = types2[k].parse);
    if (types2[k].serialize) {
      acc.serializers[types2[k].to] = types2[k].serialize;
      types2[k].from && [].concat(types2[k].from).forEach((x) => acc.serializers[x] = types2[k].serialize);
    }
    return acc;
  }, { parsers: {}, serializers: {} });
}
function escapeIdentifiers(xs, { transform: { column } }) {
  return xs.map((x) => escapeIdentifier(column.to ? column.to(x) : x)).join(",");
}
var escapeIdentifier = function escape(str) {
  return '"' + str.replace(/"/g, '""').replace(/\./g, '"."') + '"';
};
var inferType = function inferType2(x) {
  return x instanceof Parameter ? x.type : x instanceof Date ? 1184 : x instanceof Uint8Array ? 17 : x === true || x === false ? 16 : typeof x === "bigint" ? 20 : Array.isArray(x) ? inferType2(x[0]) : 0;
};
var escapeBackslash = /\\/g;
var escapeQuote = /"/g;
function arrayEscape(x) {
  return x.replace(escapeBackslash, "\\\\").replace(escapeQuote, '\\"');
}
var arraySerializer = function arraySerializer2(xs, serializer, options, typarray) {
  if (Array.isArray(xs) === false)
    return xs;
  if (!xs.length)
    return "{}";
  const first = xs[0];
  const delimiter = typarray === 1020 ? ";" : ",";
  if (Array.isArray(first) && !first.type)
    return "{" + xs.map((x) => arraySerializer2(x, serializer, options, typarray)).join(delimiter) + "}";
  return "{" + xs.map((x) => {
    if (x === void 0) {
      x = options.transform.undefined;
      if (x === void 0)
        throw Errors.generic("UNDEFINED_VALUE", "Undefined values are not allowed");
    }
    return x === null ? "null" : '"' + arrayEscape(serializer ? serializer(x.type ? x.value : x) : "" + x) + '"';
  }).join(delimiter) + "}";
};
var arrayParserState = {
  i: 0,
  char: null,
  str: "",
  quoted: false,
  last: 0
};
var arrayParser = function arrayParser2(x, parser, typarray) {
  arrayParserState.i = arrayParserState.last = 0;
  return arrayParserLoop(arrayParserState, x, parser, typarray);
};
function arrayParserLoop(s, x, parser, typarray) {
  const xs = [];
  const delimiter = typarray === 1020 ? ";" : ",";
  for (; s.i < x.length; s.i++) {
    s.char = x[s.i];
    if (s.quoted) {
      if (s.char === "\\") {
        s.str += x[++s.i];
      } else if (s.char === '"') {
        xs.push(parser ? parser(s.str) : s.str);
        s.str = "";
        s.quoted = x[s.i + 1] === '"';
        s.last = s.i + 2;
      } else {
        s.str += s.char;
      }
    } else if (s.char === '"') {
      s.quoted = true;
    } else if (s.char === "{") {
      s.last = ++s.i;
      xs.push(arrayParserLoop(s, x, parser, typarray));
    } else if (s.char === "}") {
      s.quoted = false;
      s.last < s.i && xs.push(parser ? parser(x.slice(s.last, s.i)) : x.slice(s.last, s.i));
      s.last = s.i + 1;
      break;
    } else if (s.char === delimiter && s.p !== "}" && s.p !== '"') {
      xs.push(parser ? parser(x.slice(s.last, s.i)) : x.slice(s.last, s.i));
      s.last = s.i + 1;
    }
    s.p = s.char;
  }
  s.last < s.i && xs.push(parser ? parser(x.slice(s.last, s.i + 1)) : x.slice(s.last, s.i + 1));
  return xs;
}
var toCamel = (x) => {
  let str = x[0];
  for (let i = 1; i < x.length; i++)
    str += x[i] === "_" ? x[++i].toUpperCase() : x[i];
  return str;
};
var toPascal = (x) => {
  let str = x[0].toUpperCase();
  for (let i = 1; i < x.length; i++)
    str += x[i] === "_" ? x[++i].toUpperCase() : x[i];
  return str;
};
var toKebab = (x) => x.replace(/_/g, "-");
var fromCamel = (x) => x.replace(/([A-Z])/g, "_$1").toLowerCase();
var fromPascal = (x) => (x.slice(0, 1) + x.slice(1).replace(/([A-Z])/g, "_$1")).toLowerCase();
var fromKebab = (x) => x.replace(/-/g, "_");
function createJsonTransform(fn) {
  return function jsonTransform(x, column) {
    return typeof x === "object" && x !== null && (column.type === 114 || column.type === 3802) ? Array.isArray(x) ? x.map((x2) => jsonTransform(x2, column)) : Object.entries(x).reduce((acc, [k, v]) => Object.assign(acc, { [fn(k)]: jsonTransform(v, column) }), {}) : x;
  };
}
toCamel.column = { from: toCamel };
toCamel.value = { from: createJsonTransform(toCamel) };
fromCamel.column = { to: fromCamel };
var camel = { ...toCamel };
camel.column.to = fromCamel;
toPascal.column = { from: toPascal };
toPascal.value = { from: createJsonTransform(toPascal) };
fromPascal.column = { to: fromPascal };
var pascal = { ...toPascal };
pascal.column.to = fromPascal;
toKebab.column = { from: toKebab };
toKebab.value = { from: createJsonTransform(toKebab) };
fromKebab.column = { to: fromKebab };
var kebab = { ...toKebab };
kebab.column.to = fromKebab;

// node_modules/postgres/src/connection.js
import net from "net";
import tls from "tls";
import crypto2 from "crypto";
import Stream from "stream";
import { performance } from "perf_hooks";

// node_modules/postgres/src/result.js
var Result = class extends Array {
  constructor() {
    super();
    Object.defineProperties(this, {
      count: { value: null, writable: true },
      state: { value: null, writable: true },
      command: { value: null, writable: true },
      columns: { value: null, writable: true },
      statement: { value: null, writable: true }
    });
  }
  static get [Symbol.species]() {
    return Array;
  }
};

// node_modules/postgres/src/queue.js
var queue_default = Queue;
function Queue(initial = []) {
  let xs = initial.slice();
  let index = 0;
  return {
    get length() {
      return xs.length - index;
    },
    remove: (x) => {
      const index2 = xs.indexOf(x);
      return index2 === -1 ? null : (xs.splice(index2, 1), x);
    },
    push: (x) => (xs.push(x), x),
    shift: () => {
      const out = xs[index++];
      if (index === xs.length) {
        index = 0;
        xs = [];
      } else {
        xs[index - 1] = void 0;
      }
      return out;
    }
  };
}

// node_modules/postgres/src/bytes.js
var size = 256;
var buffer = Buffer.allocUnsafe(size);
var messages = "BCcDdEFfHPpQSX".split("").reduce((acc, x) => {
  const v = x.charCodeAt(0);
  acc[x] = () => {
    buffer[0] = v;
    b.i = 5;
    return b;
  };
  return acc;
}, {});
var b = Object.assign(reset, messages, {
  N: String.fromCharCode(0),
  i: 0,
  inc(x) {
    b.i += x;
    return b;
  },
  str(x) {
    const length = Buffer.byteLength(x);
    fit(length);
    b.i += buffer.write(x, b.i, length, "utf8");
    return b;
  },
  i16(x) {
    fit(2);
    buffer.writeUInt16BE(x, b.i);
    b.i += 2;
    return b;
  },
  i32(x, i) {
    if (i || i === 0) {
      buffer.writeUInt32BE(x, i);
      return b;
    }
    fit(4);
    buffer.writeUInt32BE(x, b.i);
    b.i += 4;
    return b;
  },
  z(x) {
    fit(x);
    buffer.fill(0, b.i, b.i + x);
    b.i += x;
    return b;
  },
  raw(x) {
    buffer = Buffer.concat([buffer.subarray(0, b.i), x]);
    b.i = buffer.length;
    return b;
  },
  end(at = 1) {
    buffer.writeUInt32BE(b.i - at, at);
    const out = buffer.subarray(0, b.i);
    b.i = 0;
    buffer = Buffer.allocUnsafe(size);
    return out;
  }
});
var bytes_default = b;
function fit(x) {
  if (buffer.length - b.i < x) {
    const prev = buffer, length = prev.length;
    buffer = Buffer.allocUnsafe(length + (length >> 1) + x);
    prev.copy(buffer);
  }
}
function reset() {
  b.i = 0;
  return b;
}

// node_modules/postgres/src/connection.js
var connection_default = Connection;
var uid = 1;
var Sync = bytes_default().S().end();
var Flush = bytes_default().H().end();
var SSLRequest = bytes_default().i32(8).i32(80877103).end(8);
var ExecuteUnnamed = Buffer.concat([bytes_default().E().str(bytes_default.N).i32(0).end(), Sync]);
var DescribeUnnamed = bytes_default().D().str("S").str(bytes_default.N).end();
var noop = () => {
};
var retryRoutines = /* @__PURE__ */ new Set([
  "FetchPreparedStatement",
  "RevalidateCachedQuery",
  "transformAssignedExpr"
]);
var errorFields = {
  83: "severity_local",
  // S
  86: "severity",
  // V
  67: "code",
  // C
  77: "message",
  // M
  68: "detail",
  // D
  72: "hint",
  // H
  80: "position",
  // P
  112: "internal_position",
  // p
  113: "internal_query",
  // q
  87: "where",
  // W
  115: "schema_name",
  // s
  116: "table_name",
  // t
  99: "column_name",
  // c
  100: "data type_name",
  // d
  110: "constraint_name",
  // n
  70: "file",
  // F
  76: "line",
  // L
  82: "routine"
  // R
};
function Connection(options, queues = {}, { onopen = noop, onend = noop, onclose = noop } = {}) {
  const {
    sslnegotiation,
    ssl,
    max,
    user,
    host,
    port,
    database,
    parsers: parsers2,
    transform,
    onnotice,
    onnotify,
    onparameter,
    max_pipeline,
    keep_alive,
    backoff: backoff2,
    target_session_attrs
  } = options;
  const sent = queue_default(), id = uid++, backend = { pid: null, secret: null }, idleTimer = timer(end, options.idle_timeout), lifeTimer = timer(end, options.max_lifetime), connectTimer = timer(connectTimedOut, options.connect_timeout);
  let socket = null, cancelMessage, errorResponse = null, result = new Result(), incoming = Buffer.alloc(0), needsTypes = options.fetch_types, backendParameters = {}, statements = {}, statementId = Math.random().toString(36).slice(2), statementCount = 1, closedTime = 0, remaining = 0, hostIndex = 0, retries = 0, length = 0, delay = 0, rows = 0, serverSignature = null, nextWriteTimer = null, terminated = false, incomings = null, results = null, initial = null, ending = null, stream = null, chunk = null, ended = null, nonce = null, query = null, final = null;
  const connection2 = {
    queue: queues.closed,
    idleTimer,
    connect(query2) {
      initial = query2;
      reconnect();
    },
    terminate,
    execute,
    cancel,
    end,
    count: 0,
    id
  };
  queues.closed && queues.closed.push(connection2);
  return connection2;
  async function createSocket() {
    let x;
    try {
      x = options.socket ? await Promise.resolve(options.socket(options)) : new net.Socket();
    } catch (e) {
      error(e);
      return;
    }
    x.on("error", error);
    x.on("close", closed);
    x.on("drain", drain);
    return x;
  }
  async function cancel({ pid, secret }, resolve, reject) {
    try {
      cancelMessage = bytes_default().i32(16).i32(80877102).i32(pid).i32(secret).end(16);
      await connect();
      socket.once("error", reject);
      socket.once("close", resolve);
    } catch (error2) {
      reject(error2);
    }
  }
  function execute(q) {
    if (terminated)
      return queryError(q, Errors.connection("CONNECTION_DESTROYED", options));
    if (stream)
      return queryError(q, Errors.generic("COPY_IN_PROGRESS", "You cannot execute queries during copy"));
    if (q.cancelled)
      return;
    try {
      q.state = backend;
      query ? sent.push(q) : (query = q, query.active = true);
      build(q);
      return write(toBuffer(q)) && !q.describeFirst && !q.cursorFn && sent.length < max_pipeline && (!q.options.onexecute || q.options.onexecute(connection2));
    } catch (error2) {
      sent.length === 0 && write(Sync);
      errored(error2);
      return true;
    }
  }
  function toBuffer(q) {
    if (q.parameters.length >= 65534)
      throw Errors.generic("MAX_PARAMETERS_EXCEEDED", "Max number of parameters (65534) exceeded");
    return q.options.simple ? bytes_default().Q().str(q.statement.string + bytes_default.N).end() : q.describeFirst ? Buffer.concat([describe(q), Flush]) : q.prepare ? q.prepared ? prepared(q) : Buffer.concat([describe(q), prepared(q)]) : unnamed(q);
  }
  function describe(q) {
    return Buffer.concat([
      Parse(q.statement.string, q.parameters, q.statement.types, q.statement.name),
      Describe("S", q.statement.name)
    ]);
  }
  function prepared(q) {
    return Buffer.concat([
      Bind(q.parameters, q.statement.types, q.statement.name, q.cursorName),
      q.cursorFn ? Execute("", q.cursorRows) : ExecuteUnnamed
    ]);
  }
  function unnamed(q) {
    return Buffer.concat([
      Parse(q.statement.string, q.parameters, q.statement.types),
      DescribeUnnamed,
      prepared(q)
    ]);
  }
  function build(q) {
    const parameters = [], types2 = [];
    const string = stringify(q, q.strings[0], q.args[0], parameters, types2, options);
    !q.tagged && q.args.forEach((x) => handleValue(x, parameters, types2, options));
    q.prepare = options.prepare && ("prepare" in q.options ? q.options.prepare : true);
    q.string = string;
    q.signature = q.prepare && types2 + string;
    q.onlyDescribe && delete statements[q.signature];
    q.parameters = q.parameters || parameters;
    q.prepared = q.prepare && q.signature in statements;
    q.describeFirst = q.onlyDescribe || parameters.length && !q.prepared;
    q.statement = q.prepared ? statements[q.signature] : { string, types: types2, name: q.prepare ? statementId + statementCount++ : "" };
    typeof options.debug === "function" && options.debug(id, string, parameters, types2);
  }
  function write(x, fn) {
    chunk = chunk ? Buffer.concat([chunk, x]) : Buffer.from(x);
    if (fn || chunk.length >= 1024)
      return nextWrite(fn);
    nextWriteTimer === null && (nextWriteTimer = setImmediate(nextWrite));
    return true;
  }
  function nextWrite(fn) {
    const x = socket.write(chunk, fn);
    nextWriteTimer !== null && clearImmediate(nextWriteTimer);
    chunk = nextWriteTimer = null;
    return x;
  }
  function connectTimedOut() {
    errored(Errors.connection("CONNECT_TIMEOUT", options, socket));
    socket.destroy();
  }
  async function secure() {
    if (sslnegotiation !== "direct") {
      write(SSLRequest);
      const canSSL = await new Promise((r) => socket.once("data", (x) => r(x[0] === 83)));
      if (!canSSL && ssl === "prefer")
        return connected();
    }
    const options2 = {
      socket,
      servername: net.isIP(socket.host) ? void 0 : socket.host
    };
    if (sslnegotiation === "direct")
      options2.ALPNProtocols = ["postgresql"];
    if (ssl === "require" || ssl === "allow" || ssl === "prefer")
      options2.rejectUnauthorized = false;
    else if (typeof ssl === "object")
      Object.assign(options2, ssl);
    socket.removeAllListeners();
    socket = tls.connect(options2);
    socket.on("secureConnect", connected);
    socket.on("error", error);
    socket.on("close", closed);
    socket.on("drain", drain);
  }
  function drain() {
    !query && onopen(connection2);
  }
  function data(x) {
    if (incomings) {
      incomings.push(x);
      remaining -= x.length;
      if (remaining > 0)
        return;
    }
    incoming = incomings ? Buffer.concat(incomings, length - remaining) : incoming.length === 0 ? x : Buffer.concat([incoming, x], incoming.length + x.length);
    while (incoming.length > 4) {
      length = incoming.readUInt32BE(1);
      if (length >= incoming.length) {
        remaining = length - incoming.length;
        incomings = [incoming];
        break;
      }
      try {
        handle(incoming.subarray(0, length + 1));
      } catch (e) {
        query && (query.cursorFn || query.describeFirst) && write(Sync);
        errored(e);
      }
      incoming = incoming.subarray(length + 1);
      remaining = 0;
      incomings = null;
    }
  }
  async function connect() {
    terminated = false;
    backendParameters = {};
    socket || (socket = await createSocket());
    if (!socket)
      return;
    connectTimer.start();
    if (options.socket)
      return ssl ? secure() : connected();
    socket.on("connect", ssl ? secure : connected);
    if (options.path)
      return socket.connect(options.path);
    socket.ssl = ssl;
    socket.connect(port[hostIndex], host[hostIndex]);
    socket.host = host[hostIndex];
    socket.port = port[hostIndex];
    hostIndex = (hostIndex + 1) % port.length;
  }
  function reconnect() {
    setTimeout(connect, closedTime ? Math.max(0, closedTime + delay - performance.now()) : 0);
  }
  function connected() {
    try {
      statements = {};
      needsTypes = options.fetch_types;
      statementId = Math.random().toString(36).slice(2);
      statementCount = 1;
      lifeTimer.start();
      socket.on("data", data);
      keep_alive && socket.setKeepAlive && socket.setKeepAlive(true, 1e3 * keep_alive);
      const s = StartupMessage();
      write(s);
    } catch (err) {
      error(err);
    }
  }
  function error(err) {
    if (connection2.queue === queues.connecting && options.host[retries + 1])
      return;
    errored(err);
    while (sent.length)
      queryError(sent.shift(), err);
  }
  function errored(err) {
    stream && (stream.destroy(err), stream = null);
    query && queryError(query, err);
    initial && (queryError(initial, err), initial = null);
  }
  function queryError(query2, err) {
    if (query2.reserve)
      return query2.reject(err);
    if (!err || typeof err !== "object")
      err = new Error(err);
    "query" in err || "parameters" in err || Object.defineProperties(err, {
      stack: { value: err.stack + query2.origin.replace(/.*\n/, "\n"), enumerable: options.debug },
      query: { value: query2.string, enumerable: options.debug },
      parameters: { value: query2.parameters, enumerable: options.debug },
      args: { value: query2.args, enumerable: options.debug },
      types: { value: query2.statement && query2.statement.types, enumerable: options.debug }
    });
    query2.reject(err);
  }
  function end() {
    return ending || (!connection2.reserved && onend(connection2), !connection2.reserved && !initial && !query && sent.length === 0 ? (terminate(), new Promise((r) => socket && socket.readyState !== "closed" ? socket.once("close", r) : r())) : ending = new Promise((r) => ended = r));
  }
  function terminate() {
    terminated = true;
    if (stream || query || initial || sent.length)
      error(Errors.connection("CONNECTION_DESTROYED", options));
    clearImmediate(nextWriteTimer);
    if (socket) {
      socket.removeListener("data", data);
      socket.removeListener("connect", connected);
      socket.readyState === "open" && socket.end(bytes_default().X().end());
    }
    ended && (ended(), ending = ended = null);
  }
  async function closed(hadError) {
    incoming = Buffer.alloc(0);
    remaining = 0;
    incomings = null;
    clearImmediate(nextWriteTimer);
    socket.removeListener("data", data);
    socket.removeListener("connect", connected);
    idleTimer.cancel();
    lifeTimer.cancel();
    connectTimer.cancel();
    socket.removeAllListeners();
    socket = null;
    if (initial)
      return reconnect();
    !hadError && (query || sent.length) && error(Errors.connection("CONNECTION_CLOSED", options, socket));
    closedTime = performance.now();
    hadError && options.shared.retries++;
    delay = (typeof backoff2 === "function" ? backoff2(options.shared.retries) : backoff2) * 1e3;
    onclose(connection2, Errors.connection("CONNECTION_CLOSED", options, socket));
  }
  function handle(xs, x = xs[0]) {
    (x === 68 ? DataRow : (
      // D
      x === 100 ? CopyData : (
        // d
        x === 65 ? NotificationResponse : (
          // A
          x === 83 ? ParameterStatus : (
            // S
            x === 90 ? ReadyForQuery : (
              // Z
              x === 67 ? CommandComplete : (
                // C
                x === 50 ? BindComplete : (
                  // 2
                  x === 49 ? ParseComplete : (
                    // 1
                    x === 116 ? ParameterDescription : (
                      // t
                      x === 84 ? RowDescription : (
                        // T
                        x === 82 ? Authentication : (
                          // R
                          x === 110 ? NoData : (
                            // n
                            x === 75 ? BackendKeyData : (
                              // K
                              x === 69 ? ErrorResponse : (
                                // E
                                x === 115 ? PortalSuspended : (
                                  // s
                                  x === 51 ? CloseComplete : (
                                    // 3
                                    x === 71 ? CopyInResponse : (
                                      // G
                                      x === 78 ? NoticeResponse : (
                                        // N
                                        x === 72 ? CopyOutResponse : (
                                          // H
                                          x === 99 ? CopyDone : (
                                            // c
                                            x === 73 ? EmptyQueryResponse : (
                                              // I
                                              x === 86 ? FunctionCallResponse : (
                                                // V
                                                x === 118 ? NegotiateProtocolVersion : (
                                                  // v
                                                  x === 87 ? CopyBothResponse : (
                                                    // W
                                                    /* c8 ignore next */
                                                    UnknownMessage
                                                  )
                                                )
                                              )
                                            )
                                          )
                                        )
                                      )
                                    )
                                  )
                                )
                              )
                            )
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    ))(xs);
  }
  function DataRow(x) {
    let index = 7;
    let length2;
    let column;
    let value;
    const row = query.isRaw ? new Array(query.statement.columns.length) : {};
    for (let i = 0; i < query.statement.columns.length; i++) {
      column = query.statement.columns[i];
      length2 = x.readInt32BE(index);
      index += 4;
      value = length2 === -1 ? null : query.isRaw === true ? x.subarray(index, index += length2) : column.parser === void 0 ? x.toString("utf8", index, index += length2) : column.parser.array === true ? column.parser(x.toString("utf8", index + 1, index += length2)) : column.parser(x.toString("utf8", index, index += length2));
      query.isRaw ? row[i] = query.isRaw === true ? value : transform.value.from ? transform.value.from(value, column) : value : row[column.name] = transform.value.from ? transform.value.from(value, column) : value;
    }
    query.forEachFn ? query.forEachFn(transform.row.from ? transform.row.from(row) : row, result) : result[rows++] = transform.row.from ? transform.row.from(row) : row;
  }
  function ParameterStatus(x) {
    const [k, v] = x.toString("utf8", 5, x.length - 1).split(bytes_default.N);
    backendParameters[k] = v;
    if (options.parameters[k] !== v) {
      options.parameters[k] = v;
      onparameter && onparameter(k, v);
    }
  }
  function ReadyForQuery(x) {
    if (query) {
      if (errorResponse) {
        query.retried ? errored(query.retried) : query.prepared && retryRoutines.has(errorResponse.routine) ? retry(query, errorResponse) : errored(errorResponse);
      } else {
        query.resolve(results || result);
      }
    } else if (errorResponse) {
      errored(errorResponse);
    }
    query = results = errorResponse = null;
    result = new Result();
    connectTimer.cancel();
    if (initial) {
      if (target_session_attrs) {
        if (!backendParameters.in_hot_standby || !backendParameters.default_transaction_read_only)
          return fetchState();
        else if (tryNext(target_session_attrs, backendParameters))
          return terminate();
      }
      if (needsTypes) {
        initial.reserve && (initial = null);
        return fetchArrayTypes();
      }
      initial && !initial.reserve && execute(initial);
      options.shared.retries = retries = 0;
      initial = null;
      return;
    }
    while (sent.length && (query = sent.shift()) && (query.active = true, query.cancelled))
      Connection(options).cancel(query.state, query.cancelled.resolve, query.cancelled.reject);
    if (query)
      return;
    connection2.reserved ? !connection2.reserved.release && x[5] === 73 ? ending ? terminate() : (connection2.reserved = null, onopen(connection2)) : connection2.reserved() : ending ? terminate() : onopen(connection2);
  }
  function CommandComplete(x) {
    rows = 0;
    for (let i = x.length - 1; i > 0; i--) {
      if (x[i] === 32 && x[i + 1] < 58 && result.count === null)
        result.count = +x.toString("utf8", i + 1, x.length - 1);
      if (x[i - 1] >= 65) {
        result.command = x.toString("utf8", 5, i);
        result.state = backend;
        break;
      }
    }
    final && (final(), final = null);
    if (result.command === "BEGIN" && max !== 1 && !connection2.reserved)
      return errored(Errors.generic("UNSAFE_TRANSACTION", "Only use sql.begin, sql.reserved or max: 1"));
    if (query.options.simple)
      return BindComplete();
    if (query.cursorFn) {
      result.count && query.cursorFn(result);
      write(Sync);
    }
  }
  function ParseComplete() {
    query.parsing = false;
  }
  function BindComplete() {
    !result.statement && (result.statement = query.statement);
    result.columns = query.statement.columns;
  }
  function ParameterDescription(x) {
    const length2 = x.readUInt16BE(5);
    for (let i = 0; i < length2; ++i)
      !query.statement.types[i] && (query.statement.types[i] = x.readUInt32BE(7 + i * 4));
    query.prepare && (statements[query.signature] = query.statement);
    query.describeFirst && !query.onlyDescribe && (write(prepared(query)), query.describeFirst = false);
  }
  function RowDescription(x) {
    if (result.command) {
      results = results || [result];
      results.push(result = new Result());
      result.count = null;
      query.statement.columns = null;
    }
    const length2 = x.readUInt16BE(5);
    let index = 7;
    let start;
    query.statement.columns = Array(length2);
    for (let i = 0; i < length2; ++i) {
      start = index;
      while (x[index++] !== 0) ;
      const table = x.readUInt32BE(index);
      const number = x.readUInt16BE(index + 4);
      const type = x.readUInt32BE(index + 6);
      query.statement.columns[i] = {
        name: transform.column.from ? transform.column.from(x.toString("utf8", start, index - 1)) : x.toString("utf8", start, index - 1),
        parser: parsers2[type],
        table,
        number,
        type
      };
      index += 18;
    }
    result.statement = query.statement;
    if (query.onlyDescribe)
      return query.resolve(query.statement), write(Sync);
  }
  async function Authentication(x, type = x.readUInt32BE(5)) {
    (type === 3 ? AuthenticationCleartextPassword : type === 5 ? AuthenticationMD5Password : type === 10 ? SASL : type === 11 ? SASLContinue : type === 12 ? SASLFinal : type !== 0 ? UnknownAuth : noop)(x, type);
  }
  async function AuthenticationCleartextPassword() {
    const payload = await Pass();
    write(
      bytes_default().p().str(payload).z(1).end()
    );
  }
  async function AuthenticationMD5Password(x) {
    const payload = "md5" + await md5(
      Buffer.concat([
        Buffer.from(await md5(await Pass() + user)),
        x.subarray(9)
      ])
    );
    write(
      bytes_default().p().str(payload).z(1).end()
    );
  }
  async function SASL() {
    nonce = (await crypto2.randomBytes(18)).toString("base64");
    bytes_default().p().str("SCRAM-SHA-256" + bytes_default.N);
    const i = bytes_default.i;
    write(bytes_default.inc(4).str("n,,n=*,r=" + nonce).i32(bytes_default.i - i - 4, i).end());
  }
  async function SASLContinue(x) {
    const res = x.toString("utf8", 9).split(",").reduce((acc, x2) => (acc[x2[0]] = x2.slice(2), acc), {});
    const saltedPassword = await crypto2.pbkdf2Sync(
      await Pass(),
      Buffer.from(res.s, "base64"),
      parseInt(res.i),
      32,
      "sha256"
    );
    const clientKey = await hmac(saltedPassword, "Client Key");
    const auth = "n=*,r=" + nonce + ",r=" + res.r + ",s=" + res.s + ",i=" + res.i + ",c=biws,r=" + res.r;
    serverSignature = (await hmac(await hmac(saltedPassword, "Server Key"), auth)).toString("base64");
    const payload = "c=biws,r=" + res.r + ",p=" + xor(
      clientKey,
      Buffer.from(await hmac(await sha256(clientKey), auth))
    ).toString("base64");
    write(
      bytes_default().p().str(payload).end()
    );
  }
  function SASLFinal(x) {
    if (x.toString("utf8", 9).split(bytes_default.N, 1)[0].slice(2) === serverSignature)
      return;
    errored(Errors.generic("SASL_SIGNATURE_MISMATCH", "The server did not return the correct signature"));
    socket.destroy();
  }
  function Pass() {
    return Promise.resolve(
      typeof options.pass === "function" ? options.pass() : options.pass
    );
  }
  function NoData() {
    result.statement = query.statement;
    result.statement.columns = [];
    if (query.onlyDescribe)
      return query.resolve(query.statement), write(Sync);
  }
  function BackendKeyData(x) {
    backend.pid = x.readUInt32BE(5);
    backend.secret = x.readUInt32BE(9);
  }
  async function fetchArrayTypes() {
    needsTypes = false;
    const types2 = await new Query([`
      select b.oid, b.typarray
      from pg_catalog.pg_type a
      left join pg_catalog.pg_type b on b.oid = a.typelem
      where a.typcategory = 'A'
      group by b.oid, b.typarray
      order by b.oid
    `], [], execute);
    types2.forEach(({ oid, typarray }) => addArrayType(oid, typarray));
  }
  function addArrayType(oid, typarray) {
    if (!!options.parsers[typarray] && !!options.serializers[typarray]) return;
    const parser = options.parsers[oid];
    options.shared.typeArrayMap[oid] = typarray;
    options.parsers[typarray] = (xs) => arrayParser(xs, parser, typarray);
    options.parsers[typarray].array = true;
    options.serializers[typarray] = (xs) => arraySerializer(xs, options.serializers[oid], options, typarray);
  }
  function tryNext(x, xs) {
    return x === "read-write" && xs.default_transaction_read_only === "on" || x === "read-only" && xs.default_transaction_read_only === "off" || x === "primary" && xs.in_hot_standby === "on" || x === "standby" && xs.in_hot_standby === "off" || x === "prefer-standby" && xs.in_hot_standby === "off" && options.host[retries];
  }
  function fetchState() {
    const query2 = new Query([`
      show transaction_read_only;
      select pg_catalog.pg_is_in_recovery()
    `], [], execute, null, { simple: true });
    query2.resolve = ([[a], [b2]]) => {
      backendParameters.default_transaction_read_only = a.transaction_read_only;
      backendParameters.in_hot_standby = b2.pg_is_in_recovery ? "on" : "off";
    };
    query2.execute();
  }
  function ErrorResponse(x) {
    if (query) {
      (query.cursorFn || query.describeFirst) && write(Sync);
      errorResponse = Errors.postgres(parseError(x));
    } else {
      errored(Errors.postgres(parseError(x)));
    }
  }
  function retry(q, error2) {
    delete statements[q.signature];
    q.retried = error2;
    execute(q);
  }
  function NotificationResponse(x) {
    if (!onnotify)
      return;
    let index = 9;
    while (x[index++] !== 0) ;
    onnotify(
      x.toString("utf8", 9, index - 1),
      x.toString("utf8", index, x.length - 1)
    );
  }
  async function PortalSuspended() {
    try {
      const x = await Promise.resolve(query.cursorFn(result));
      rows = 0;
      x === CLOSE ? write(Close(query.portal)) : (result = new Result(), write(Execute("", query.cursorRows)));
    } catch (err) {
      write(Sync);
      query.reject(err);
    }
  }
  function CloseComplete() {
    result.count && query.cursorFn(result);
    query.resolve(result);
  }
  function CopyInResponse() {
    stream = new Stream.Writable({
      autoDestroy: true,
      write(chunk2, encoding, callback) {
        socket.write(bytes_default().d().raw(chunk2).end(), callback);
      },
      destroy(error2, callback) {
        callback(error2);
        socket.write(bytes_default().f().str(error2 + bytes_default.N).end());
        stream = null;
      },
      final(callback) {
        socket.write(bytes_default().c().end());
        final = callback;
        stream = null;
      }
    });
    query.resolve(stream);
  }
  function CopyOutResponse() {
    stream = new Stream.Readable({
      read() {
        socket.resume();
      }
    });
    query.resolve(stream);
  }
  function CopyBothResponse() {
    stream = new Stream.Duplex({
      autoDestroy: true,
      read() {
        socket.resume();
      },
      /* c8 ignore next 11 */
      write(chunk2, encoding, callback) {
        socket.write(bytes_default().d().raw(chunk2).end(), callback);
      },
      destroy(error2, callback) {
        callback(error2);
        socket.write(bytes_default().f().str(error2 + bytes_default.N).end());
        stream = null;
      },
      final(callback) {
        socket.write(bytes_default().c().end());
        final = callback;
      }
    });
    query.resolve(stream);
  }
  function CopyData(x) {
    stream && (stream.push(x.subarray(5)) || socket.pause());
  }
  function CopyDone() {
    stream && stream.push(null);
    stream = null;
  }
  function NoticeResponse(x) {
    onnotice ? onnotice(parseError(x)) : console.log(parseError(x));
  }
  function EmptyQueryResponse() {
  }
  function FunctionCallResponse() {
    errored(Errors.notSupported("FunctionCallResponse"));
  }
  function NegotiateProtocolVersion() {
    errored(Errors.notSupported("NegotiateProtocolVersion"));
  }
  function UnknownMessage(x) {
    console.error("Postgres.js : Unknown Message:", x[0]);
  }
  function UnknownAuth(x, type) {
    console.error("Postgres.js : Unknown Auth:", type);
  }
  function Bind(parameters, types2, statement = "", portal = "") {
    let prev, type;
    bytes_default().B().str(portal + bytes_default.N).str(statement + bytes_default.N).i16(0).i16(parameters.length);
    parameters.forEach((x, i) => {
      if (x === null)
        return bytes_default.i32(4294967295);
      type = types2[i];
      parameters[i] = x = type in options.serializers ? options.serializers[type](x) : "" + x;
      prev = bytes_default.i;
      bytes_default.inc(4).str(x).i32(bytes_default.i - prev - 4, prev);
    });
    bytes_default.i16(0);
    return bytes_default.end();
  }
  function Parse(str, parameters, types2, name = "") {
    bytes_default().P().str(name + bytes_default.N).str(str + bytes_default.N).i16(parameters.length);
    parameters.forEach((x, i) => bytes_default.i32(types2[i] || 0));
    return bytes_default.end();
  }
  function Describe(x, name = "") {
    return bytes_default().D().str(x).str(name + bytes_default.N).end();
  }
  function Execute(portal = "", rows2 = 0) {
    return Buffer.concat([
      bytes_default().E().str(portal + bytes_default.N).i32(rows2).end(),
      Flush
    ]);
  }
  function Close(portal = "") {
    return Buffer.concat([
      bytes_default().C().str("P").str(portal + bytes_default.N).end(),
      bytes_default().S().end()
    ]);
  }
  function StartupMessage() {
    return cancelMessage || bytes_default().inc(4).i16(3).z(2).str(
      Object.entries(Object.assign(
        {
          user,
          database,
          client_encoding: "UTF8"
        },
        options.connection
      )).filter(([, v]) => v).map(([k, v]) => k + bytes_default.N + v).join(bytes_default.N)
    ).z(2).end(0);
  }
}
function parseError(x) {
  const error = {};
  let start = 5;
  for (let i = 5; i < x.length - 1; i++) {
    if (x[i] === 0) {
      error[errorFields[x[start]]] = x.toString("utf8", start + 1, i);
      start = i + 1;
    }
  }
  return error;
}
function md5(x) {
  return crypto2.createHash("md5").update(x).digest("hex");
}
function hmac(key, x) {
  return crypto2.createHmac("sha256", key).update(x).digest();
}
function sha256(x) {
  return crypto2.createHash("sha256").update(x).digest();
}
function xor(a, b2) {
  const length = Math.max(a.length, b2.length);
  const buffer2 = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i++)
    buffer2[i] = a[i] ^ b2[i];
  return buffer2;
}
function timer(fn, seconds) {
  seconds = typeof seconds === "function" ? seconds() : seconds;
  if (!seconds)
    return { cancel: noop, start: noop };
  let timer2;
  return {
    cancel() {
      timer2 && (clearTimeout(timer2), timer2 = null);
    },
    start() {
      timer2 && clearTimeout(timer2);
      timer2 = setTimeout(done, seconds * 1e3, arguments);
    }
  };
  function done(args) {
    fn.apply(null, args);
    timer2 = null;
  }
}

// node_modules/postgres/src/subscribe.js
var noop2 = () => {
};
function Subscribe(postgres2, options) {
  const subscribers = /* @__PURE__ */ new Map(), slot = "postgresjs_" + Math.random().toString(36).slice(2), state = {};
  let connection2, stream, ended = false;
  const sql2 = subscribe.sql = postgres2({
    ...options,
    transform: { column: {}, value: {}, row: {} },
    max: 1,
    fetch_types: false,
    idle_timeout: null,
    max_lifetime: null,
    connection: {
      ...options.connection,
      replication: "database"
    },
    onclose: async function() {
      if (ended)
        return;
      stream = null;
      state.pid = state.secret = void 0;
      connected(await init(sql2, slot, options.publications));
      subscribers.forEach((event) => event.forEach(({ onsubscribe }) => onsubscribe()));
    },
    no_subscribe: true
  });
  const end = sql2.end, close = sql2.close;
  sql2.end = async () => {
    ended = true;
    stream && await new Promise((r) => (stream.once("close", r), stream.end()));
    return end();
  };
  sql2.close = async () => {
    stream && await new Promise((r) => (stream.once("close", r), stream.end()));
    return close();
  };
  return subscribe;
  async function subscribe(event, fn, onsubscribe = noop2, onerror = noop2) {
    event = parseEvent(event);
    if (!connection2)
      connection2 = init(sql2, slot, options.publications);
    const subscriber = { fn, onsubscribe };
    const fns = subscribers.has(event) ? subscribers.get(event).add(subscriber) : subscribers.set(event, /* @__PURE__ */ new Set([subscriber])).get(event);
    const unsubscribe = () => {
      fns.delete(subscriber);
      fns.size === 0 && subscribers.delete(event);
    };
    return connection2.then((x) => {
      connected(x);
      onsubscribe();
      stream && stream.on("error", onerror);
      return { unsubscribe, state, sql: sql2 };
    });
  }
  function connected(x) {
    stream = x.stream;
    state.pid = x.state.pid;
    state.secret = x.state.secret;
  }
  async function init(sql3, slot2, publications) {
    if (!publications)
      throw new Error("Missing publication names");
    const xs = await sql3.unsafe(
      `CREATE_REPLICATION_SLOT ${slot2} TEMPORARY LOGICAL pgoutput NOEXPORT_SNAPSHOT`
    );
    const [x] = xs;
    const stream2 = await sql3.unsafe(
      `START_REPLICATION SLOT ${slot2} LOGICAL ${x.consistent_point} (proto_version '1', publication_names '${publications}')`
    ).writable();
    const state2 = {
      lsn: Buffer.concat(x.consistent_point.split("/").map((x2) => Buffer.from(("00000000" + x2).slice(-8), "hex")))
    };
    stream2.on("data", data);
    stream2.on("error", error);
    stream2.on("close", sql3.close);
    return { stream: stream2, state: xs.state };
    function error(e) {
      console.error("Unexpected error during logical streaming - reconnecting", e);
    }
    function data(x2) {
      if (x2[0] === 119) {
        parse(x2.subarray(25), state2, sql3.options.parsers, handle, options.transform);
      } else if (x2[0] === 107 && x2[17]) {
        state2.lsn = x2.subarray(1, 9);
        pong();
      }
    }
    function handle(a, b2) {
      const path = b2.relation.schema + "." + b2.relation.table;
      call("*", a, b2);
      call("*:" + path, a, b2);
      b2.relation.keys.length && call("*:" + path + "=" + b2.relation.keys.map((x2) => a[x2.name]), a, b2);
      call(b2.command, a, b2);
      call(b2.command + ":" + path, a, b2);
      b2.relation.keys.length && call(b2.command + ":" + path + "=" + b2.relation.keys.map((x2) => a[x2.name]), a, b2);
    }
    function pong() {
      const x2 = Buffer.alloc(34);
      x2[0] = "r".charCodeAt(0);
      x2.fill(state2.lsn, 1);
      x2.writeBigInt64BE(BigInt(Date.now() - Date.UTC(2e3, 0, 1)) * BigInt(1e3), 25);
      stream2.write(x2);
    }
  }
  function call(x, a, b2) {
    subscribers.has(x) && subscribers.get(x).forEach(({ fn }) => fn(a, b2, x));
  }
}
function Time(x) {
  return new Date(Date.UTC(2e3, 0, 1) + Number(x / BigInt(1e3)));
}
function parse(x, state, parsers2, handle, transform) {
  const char = (acc, [k, v]) => (acc[k.charCodeAt(0)] = v, acc);
  Object.entries({
    R: (x2) => {
      let i = 1;
      const r = state[x2.readUInt32BE(i)] = {
        schema: x2.toString("utf8", i += 4, i = x2.indexOf(0, i)) || "pg_catalog",
        table: x2.toString("utf8", i + 1, i = x2.indexOf(0, i + 1)),
        columns: Array(x2.readUInt16BE(i += 2)),
        keys: []
      };
      i += 2;
      let columnIndex = 0, column;
      while (i < x2.length) {
        column = r.columns[columnIndex++] = {
          key: x2[i++],
          name: transform.column.from ? transform.column.from(x2.toString("utf8", i, i = x2.indexOf(0, i))) : x2.toString("utf8", i, i = x2.indexOf(0, i)),
          type: x2.readUInt32BE(i += 1),
          parser: parsers2[x2.readUInt32BE(i)],
          atttypmod: x2.readUInt32BE(i += 4)
        };
        column.key && r.keys.push(column);
        i += 4;
      }
    },
    Y: () => {
    },
    // Type
    O: () => {
    },
    // Origin
    B: (x2) => {
      state.date = Time(x2.readBigInt64BE(9));
      state.lsn = x2.subarray(1, 9);
    },
    I: (x2) => {
      let i = 1;
      const relation = state[x2.readUInt32BE(i)];
      const { row } = tuples(x2, relation.columns, i += 7, transform);
      handle(row, {
        command: "insert",
        relation
      });
    },
    D: (x2) => {
      let i = 1;
      const relation = state[x2.readUInt32BE(i)];
      i += 4;
      const key = x2[i] === 75;
      handle(
        key || x2[i] === 79 ? tuples(x2, relation.columns, i += 3, transform).row : null,
        {
          command: "delete",
          relation,
          key
        }
      );
    },
    U: (x2) => {
      let i = 1;
      const relation = state[x2.readUInt32BE(i)];
      i += 4;
      const key = x2[i] === 75;
      const xs = key || x2[i] === 79 ? tuples(x2, relation.columns, i += 3, transform) : null;
      xs && (i = xs.i);
      const { row } = tuples(x2, relation.columns, i + 3, transform);
      handle(row, {
        command: "update",
        relation,
        key,
        old: xs && xs.row
      });
    },
    T: () => {
    },
    // Truncate,
    C: () => {
    }
    // Commit
  }).reduce(char, {})[x[0]](x);
}
function tuples(x, columns, xi, transform) {
  let type, column, value;
  const row = transform.raw ? new Array(columns.length) : {};
  for (let i = 0; i < columns.length; i++) {
    type = x[xi++];
    column = columns[i];
    value = type === 110 ? null : type === 117 ? void 0 : column.parser === void 0 ? x.toString("utf8", xi + 4, xi += 4 + x.readUInt32BE(xi)) : column.parser.array === true ? column.parser(x.toString("utf8", xi + 5, xi += 4 + x.readUInt32BE(xi))) : column.parser(x.toString("utf8", xi + 4, xi += 4 + x.readUInt32BE(xi)));
    transform.raw ? row[i] = transform.raw === true ? value : transform.value.from ? transform.value.from(value, column) : value : row[column.name] = transform.value.from ? transform.value.from(value, column) : value;
  }
  return { i: xi, row: transform.row.from ? transform.row.from(row) : row };
}
function parseEvent(x) {
  const xs = x.match(/^(\*|insert|update|delete)?:?([^.]+?\.?[^=]+)?=?(.+)?/i) || [];
  if (!xs)
    throw new Error("Malformed subscribe pattern: " + x);
  const [, command, path, key] = xs;
  return (command || "*") + (path ? ":" + (path.indexOf(".") === -1 ? "public." + path : path) : "") + (key ? "=" + key : "");
}

// node_modules/postgres/src/large.js
import Stream2 from "stream";
function largeObject(sql2, oid, mode = 131072 | 262144) {
  return new Promise(async (resolve, reject) => {
    await sql2.begin(async (sql3) => {
      let finish;
      !oid && ([{ oid }] = await sql3`select lo_creat(-1) as oid`);
      const [{ fd }] = await sql3`select lo_open(${oid}, ${mode}) as fd`;
      const lo = {
        writable,
        readable,
        close: () => sql3`select lo_close(${fd})`.then(finish),
        tell: () => sql3`select lo_tell64(${fd})`,
        read: (x) => sql3`select loread(${fd}, ${x}) as data`,
        write: (x) => sql3`select lowrite(${fd}, ${x})`,
        truncate: (x) => sql3`select lo_truncate64(${fd}, ${x})`,
        seek: (x, whence = 0) => sql3`select lo_lseek64(${fd}, ${x}, ${whence})`,
        size: () => sql3`
          select
            lo_lseek64(${fd}, location, 0) as position,
            seek.size
          from (
            select
              lo_lseek64($1, 0, 2) as size,
              tell.location
            from (select lo_tell64($1) as location) tell
          ) seek
        `
      };
      resolve(lo);
      return new Promise(async (r) => finish = r);
      async function readable({
        highWaterMark = 2048 * 8,
        start = 0,
        end = Infinity
      } = {}) {
        let max = end - start;
        start && await lo.seek(start);
        return new Stream2.Readable({
          highWaterMark,
          async read(size2) {
            const l = size2 > max ? size2 - max : size2;
            max -= size2;
            const [{ data }] = await lo.read(l);
            this.push(data);
            if (data.length < size2)
              this.push(null);
          }
        });
      }
      async function writable({
        highWaterMark = 2048 * 8,
        start = 0
      } = {}) {
        start && await lo.seek(start);
        return new Stream2.Writable({
          highWaterMark,
          write(chunk, encoding, callback) {
            lo.write(chunk).then(() => callback(), callback);
          }
        });
      }
    }).catch(reject);
  });
}

// node_modules/postgres/src/index.js
Object.assign(Postgres, {
  PostgresError,
  toPascal,
  pascal,
  toCamel,
  camel,
  toKebab,
  kebab,
  fromPascal,
  fromCamel,
  fromKebab,
  BigInt: {
    to: 20,
    from: [20],
    parse: (x) => BigInt(x),
    // eslint-disable-line
    serialize: (x) => x.toString()
  }
});
var src_default = Postgres;
function Postgres(a, b2) {
  const options = parseOptions(a, b2), subscribe = options.no_subscribe || Subscribe(Postgres, { ...options });
  let ending = false;
  const queries = queue_default(), connecting = queue_default(), reserved = queue_default(), closed = queue_default(), ended = queue_default(), open = queue_default(), busy = queue_default(), full = queue_default(), queues = { connecting, reserved, closed, ended, open, busy, full };
  const connections = [...Array(options.max)].map(() => connection_default(options, queues, { onopen, onend, onclose }));
  const sql2 = Sql(handler);
  Object.assign(sql2, {
    get parameters() {
      return options.parameters;
    },
    largeObject: largeObject.bind(null, sql2),
    subscribe,
    CLOSE,
    END: CLOSE,
    PostgresError,
    options,
    reserve,
    listen,
    begin,
    close,
    end
  });
  return sql2;
  function Sql(handler2) {
    handler2.debug = options.debug;
    Object.entries(options.types).reduce((acc, [name, type]) => {
      acc[name] = (x) => new Parameter(x, type.to);
      return acc;
    }, typed);
    Object.assign(sql3, {
      types: typed,
      typed,
      unsafe,
      notify,
      array,
      json: json3,
      file
    });
    return sql3;
    function typed(value, type) {
      return new Parameter(value, type);
    }
    function sql3(strings, ...args) {
      const query = strings && Array.isArray(strings.raw) ? new Query(strings, args, handler2, cancel) : typeof strings === "string" && !args.length ? new Identifier(options.transform.column.to ? options.transform.column.to(strings) : strings) : new Builder(strings, args);
      return query;
    }
    function unsafe(string, args = [], options2 = {}) {
      arguments.length === 2 && !Array.isArray(args) && (options2 = args, args = []);
      const query = new Query([string], args, handler2, cancel, {
        prepare: false,
        ...options2,
        simple: "simple" in options2 ? options2.simple : args.length === 0
      });
      return query;
    }
    function file(path, args = [], options2 = {}) {
      arguments.length === 2 && !Array.isArray(args) && (options2 = args, args = []);
      const query = new Query([], args, (query2) => {
        fs.readFile(path, "utf8", (err, string) => {
          if (err)
            return query2.reject(err);
          query2.strings = [string];
          handler2(query2);
        });
      }, cancel, {
        ...options2,
        simple: "simple" in options2 ? options2.simple : args.length === 0
      });
      return query;
    }
  }
  async function listen(name, fn, onlisten) {
    const listener = { fn, onlisten };
    const sql3 = listen.sql || (listen.sql = Postgres({
      ...options,
      max: 1,
      idle_timeout: null,
      max_lifetime: null,
      fetch_types: false,
      onclose() {
        Object.entries(listen.channels).forEach(([name2, { listeners }]) => {
          delete listen.channels[name2];
          Promise.all(listeners.map((l) => listen(name2, l.fn, l.onlisten).catch(() => {
          })));
        });
      },
      onnotify(c, x) {
        c in listen.channels && listen.channels[c].listeners.forEach((l) => l.fn(x));
      }
    }));
    const channels = listen.channels || (listen.channels = {}), exists = name in channels;
    if (exists) {
      channels[name].listeners.push(listener);
      const result2 = await channels[name].result;
      listener.onlisten && listener.onlisten();
      return { state: result2.state, unlisten };
    }
    channels[name] = { result: sql3`listen ${sql3.unsafe('"' + name.replace(/"/g, '""') + '"')}`, listeners: [listener] };
    const result = await channels[name].result;
    listener.onlisten && listener.onlisten();
    return { state: result.state, unlisten };
    async function unlisten() {
      if (name in channels === false)
        return;
      channels[name].listeners = channels[name].listeners.filter((x) => x !== listener);
      if (channels[name].listeners.length)
        return;
      delete channels[name];
      return sql3`unlisten ${sql3.unsafe('"' + name.replace(/"/g, '""') + '"')}`;
    }
  }
  async function notify(channel, payload) {
    return await sql2`select pg_notify(${channel}, ${"" + payload})`;
  }
  async function reserve() {
    const queue = queue_default();
    const c = open.length ? open.shift() : await new Promise((resolve, reject) => {
      const query = { reserve: resolve, reject };
      queries.push(query);
      closed.length && connect(closed.shift(), query);
    });
    move(c, reserved);
    c.reserved = () => queue.length ? c.execute(queue.shift()) : move(c, reserved);
    c.reserved.release = true;
    const sql3 = Sql(handler2);
    sql3.release = () => {
      c.reserved = null;
      onopen(c);
    };
    return sql3;
    function handler2(q) {
      c.queue === full ? queue.push(q) : c.execute(q) || move(c, full);
    }
  }
  async function begin(options2, fn) {
    !fn && (fn = options2, options2 = "");
    const queries2 = queue_default();
    let savepoints = 0, connection2, prepare = null;
    try {
      await sql2.unsafe("begin " + options2.replace(/[^a-z ]/ig, ""), [], { onexecute }).execute();
      return await Promise.race([
        scope(connection2, fn),
        new Promise((_, reject) => connection2.onclose = reject)
      ]);
    } catch (error) {
      throw error;
    }
    async function scope(c, fn2, name) {
      const sql3 = Sql(handler2);
      sql3.savepoint = savepoint;
      sql3.prepare = (x) => prepare = x.replace(/[^a-z0-9$-_. ]/gi);
      let uncaughtError, result;
      name && await sql3`savepoint ${sql3(name)}`;
      try {
        result = await new Promise((resolve, reject) => {
          const x = fn2(sql3);
          Promise.resolve(Array.isArray(x) ? Promise.all(x) : x).then(resolve, reject);
        });
        if (uncaughtError)
          throw uncaughtError;
      } catch (e) {
        await (name ? sql3`rollback to ${sql3(name)}` : sql3`rollback`);
        throw e instanceof PostgresError && e.code === "25P02" && uncaughtError || e;
      }
      if (!name) {
        prepare ? await sql3`prepare transaction '${sql3.unsafe(prepare)}'` : await sql3`commit`;
      }
      return result;
      function savepoint(name2, fn3) {
        if (name2 && Array.isArray(name2.raw))
          return savepoint((sql4) => sql4.apply(sql4, arguments));
        arguments.length === 1 && (fn3 = name2, name2 = null);
        return scope(c, fn3, "s" + savepoints++ + (name2 ? "_" + name2 : ""));
      }
      function handler2(q) {
        q.catch((e) => uncaughtError || (uncaughtError = e));
        c.queue === full ? queries2.push(q) : c.execute(q) || move(c, full);
      }
    }
    function onexecute(c) {
      connection2 = c;
      move(c, reserved);
      c.reserved = () => queries2.length ? c.execute(queries2.shift()) : move(c, reserved);
    }
  }
  function move(c, queue) {
    c.queue.remove(c);
    queue.push(c);
    c.queue = queue;
    queue === open ? c.idleTimer.start() : c.idleTimer.cancel();
    return c;
  }
  function json3(x) {
    return new Parameter(x, 3802);
  }
  function array(x, type) {
    if (!Array.isArray(x))
      return array(Array.from(arguments));
    return new Parameter(x, type || (x.length ? inferType(x) || 25 : 0), options.shared.typeArrayMap);
  }
  function handler(query) {
    if (ending)
      return query.reject(Errors.connection("CONNECTION_ENDED", options, options));
    if (open.length)
      return go(open.shift(), query);
    if (closed.length)
      return connect(closed.shift(), query);
    busy.length ? go(busy.shift(), query) : queries.push(query);
  }
  function go(c, query) {
    return c.execute(query) ? move(c, busy) : move(c, full);
  }
  function cancel(query) {
    return new Promise((resolve, reject) => {
      query.state ? query.active ? connection_default(options).cancel(query.state, resolve, reject) : query.cancelled = { resolve, reject } : (queries.remove(query), query.cancelled = true, query.reject(Errors.generic("57014", "canceling statement due to user request")), resolve());
    });
  }
  async function end({ timeout = null } = {}) {
    if (ending)
      return ending;
    await 1;
    let timer2;
    return ending = Promise.race([
      new Promise((r) => timeout !== null && (timer2 = setTimeout(destroy, timeout * 1e3, r))),
      Promise.all(connections.map((c) => c.end()).concat(
        listen.sql ? listen.sql.end({ timeout: 0 }) : [],
        subscribe.sql ? subscribe.sql.end({ timeout: 0 }) : []
      ))
    ]).then(() => clearTimeout(timer2));
  }
  async function close() {
    await Promise.all(connections.map((c) => c.end()));
  }
  async function destroy(resolve) {
    await Promise.all(connections.map((c) => c.terminate()));
    while (queries.length)
      queries.shift().reject(Errors.connection("CONNECTION_DESTROYED", options));
    resolve();
  }
  function connect(c, query) {
    move(c, connecting);
    c.connect(query);
    return c;
  }
  function onend(c) {
    move(c, ended);
  }
  function onopen(c) {
    if (queries.length === 0)
      return move(c, open);
    let max = Math.ceil(queries.length / (connecting.length + 1)), ready = true;
    while (ready && queries.length && max-- > 0) {
      const query = queries.shift();
      if (query.reserve)
        return query.reserve(c);
      ready = c.execute(query);
    }
    ready ? move(c, busy) : move(c, full);
  }
  function onclose(c, e) {
    move(c, closed);
    c.reserved = null;
    c.onclose && (c.onclose(e), c.onclose = null);
    options.onclose && options.onclose(c.id);
    queries.length && connect(c, queries.shift());
  }
}
function parseOptions(a, b2) {
  if (a && a.shared)
    return a;
  const env = process.env, o = (!a || typeof a === "string" ? b2 : a) || {}, { url, multihost } = parseUrl(a), query = [...url.searchParams].reduce((a2, [b3, c]) => (a2[b3] = c, a2), {}), host = o.hostname || o.host || multihost || url.hostname || env.PGHOST || "localhost", port = o.port || url.port || env.PGPORT || 5432, user = o.user || o.username || url.username || env.PGUSERNAME || env.PGUSER || osUsername();
  o.no_prepare && (o.prepare = false);
  query.sslmode && (query.ssl = query.sslmode, delete query.sslmode);
  "timeout" in o && (console.log("The timeout option is deprecated, use idle_timeout instead"), o.idle_timeout = o.timeout);
  query.sslrootcert === "system" && (query.ssl = "verify-full");
  const ints = ["idle_timeout", "connect_timeout", "max_lifetime", "max_pipeline", "backoff", "keep_alive"];
  const defaults = {
    max: globalThis.Cloudflare ? 3 : 10,
    ssl: false,
    sslnegotiation: null,
    idle_timeout: null,
    connect_timeout: 30,
    max_lifetime,
    max_pipeline: 100,
    backoff,
    keep_alive: 60,
    prepare: true,
    debug: false,
    fetch_types: true,
    publications: "alltables",
    target_session_attrs: null
  };
  return {
    host: Array.isArray(host) ? host : host.split(",").map((x) => x.split(":")[0]),
    port: Array.isArray(port) ? port : host.split(",").map((x) => parseInt(x.split(":")[1] || port)),
    path: o.path || host.indexOf("/") > -1 && host + "/.s.PGSQL." + port,
    database: o.database || o.db || (url.pathname || "").slice(1) || env.PGDATABASE || user,
    user,
    pass: o.pass || o.password || url.password || env.PGPASSWORD || "",
    ...Object.entries(defaults).reduce(
      (acc, [k, d]) => {
        const value = k in o ? o[k] : k in query ? query[k] === "disable" || query[k] === "false" ? false : query[k] : env["PG" + k.toUpperCase()] || d;
        acc[k] = typeof value === "string" && ints.includes(k) ? +value : value;
        return acc;
      },
      {}
    ),
    connection: {
      application_name: env.PGAPPNAME || "postgres.js",
      ...o.connection,
      ...Object.entries(query).reduce((acc, [k, v]) => (k in defaults || (acc[k] = v), acc), {})
    },
    types: o.types || {},
    target_session_attrs: tsa(o, url, env),
    onnotice: o.onnotice,
    onnotify: o.onnotify,
    onclose: o.onclose,
    onparameter: o.onparameter,
    socket: o.socket,
    transform: parseTransform(o.transform || { undefined: void 0 }),
    parameters: {},
    shared: { retries: 0, typeArrayMap: {} },
    ...mergeUserTypes(o.types)
  };
}
function tsa(o, url, env) {
  const x = o.target_session_attrs || url.searchParams.get("target_session_attrs") || env.PGTARGETSESSIONATTRS;
  if (!x || ["read-write", "read-only", "primary", "standby", "prefer-standby"].includes(x))
    return x;
  throw new Error("target_session_attrs " + x + " is not supported");
}
function backoff(retries) {
  return (0.5 + Math.random() / 2) * Math.min(3 ** retries / 100, 20);
}
function max_lifetime() {
  return 60 * (30 + Math.random() * 30);
}
function parseTransform(x) {
  return {
    undefined: x.undefined,
    column: {
      from: typeof x.column === "function" ? x.column : x.column && x.column.from,
      to: x.column && x.column.to
    },
    value: {
      from: typeof x.value === "function" ? x.value : x.value && x.value.from,
      to: x.value && x.value.to
    },
    row: {
      from: typeof x.row === "function" ? x.row : x.row && x.row.from,
      to: x.row && x.row.to
    }
  };
}
function parseUrl(url) {
  if (!url || typeof url !== "string")
    return { url: { searchParams: /* @__PURE__ */ new Map() } };
  let host = url;
  host = host.slice(host.indexOf("://") + 3).split(/[?/]/)[0];
  host = decodeURIComponent(host.slice(host.indexOf("@") + 1));
  const urlObj = new URL(url.replace(host, host.split(",")[0]));
  return {
    url: {
      username: decodeURIComponent(urlObj.username),
      password: decodeURIComponent(urlObj.password),
      host: urlObj.host,
      hostname: urlObj.hostname,
      port: urlObj.port,
      pathname: urlObj.pathname,
      searchParams: urlObj.searchParams
    },
    multihost: host.indexOf(",") > -1 && host
  };
}
function osUsername() {
  try {
    return os.userInfo().username;
  } catch (_) {
    return process.env.USERNAME || process.env.USER || process.env.LOGNAME;
  }
}

// netlify/lib/api.ts
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

// supabase/functions/actualizar-mercado/nucleo.ts
var URL_OBJETO_AHLEDGER = "https://api.ahledger.com/v1/items/";
async function pedirObjetoAhledger(f, id, juego = "forever", userAgent = "mercadowow/0.1 (uso personal)") {
  let r;
  try {
    r = await f(`${URL_OBJETO_AHLEDGER}${id}?game=${juego}`, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(2e4)
    });
  } catch (e) {
    return { tipo: "parar", motivo: `Error de conexión: ${e.message ?? e}` };
  }
  if (r.status === 404) {
    await r.body?.cancel();
    return { tipo: "no_encontrado" };
  }
  if (r.status !== 200) {
    await r.body?.cancel();
    return { tipo: "parar", motivo: `HTTP ${r.status}` };
  }
  const j = await r.json().catch(() => null);
  if (!j || j.id !== id || typeof j.name !== "string" || !j.name.trim()) return { tipo: "no_encontrado" };
  return { tipo: "ok", objeto: j };
}

// netlify/lib/api.ts
var CLAVE_MINIMA = 12;
var RANGOS = ["24h", "7d", "30d", "90d"];
var ErrorFuente = class extends Error {
};
async function historialAhledger(f, urlTabla, id, rango) {
  const mercado = urlTabla.match(/\/pricetable\/([a-z0-9.]+)$/)?.[1];
  if (!mercado) throw new ErrorFuente("Mercado de AHledger mal configurado");
  let r;
  try {
    r = await f(`https://api.ahledger.com/v1/prices/${mercado}/${id}?range=${rango}`, {
      headers: { "User-Agent": "mercadowow/0.1 (uso personal)", Accept: "application/json" },
      signal: AbortSignal.timeout(2e4)
    });
  } catch (e) {
    throw new ErrorFuente(`No se pudo consultar AHledger: ${e.message ?? e}`);
  }
  if (r.status === 404) return vacio();
  if (!r.ok) throw new ErrorFuente(`AHledger respondió HTTP ${r.status}`);
  const j = await r.json();
  if (j?.market !== mercado) throw new ErrorFuente("AHledger devolvió otro mercado");
  const serie = Array.isArray(j.series) ? j.series : [];
  const t = (s) => Date.parse(s.t);
  const n = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
  const l = j.latest;
  return {
    fuente: "ahledger",
    rango,
    paso_ms: rango === "24h" || rango === "7d" ? 36e5 : 864e5,
    nombres: ["Compra mínima", "Mediana"],
    puntos: serie.filter((s) => !Number.isNaN(t(s))).map((s) => [t(s), n(s.min), n(s.median)]),
    cantidad: serie.filter((s) => !Number.isNaN(t(s))).map((s) => [t(s), n(s.quantity)]),
    med7: null,
    med30: null,
    ultimo: l ? {
      hora: l.observedAt ?? null,
      precio: n(l.minBuyout),
      mediana: n(l.median),
      cantidad: n(l.quantity),
      subastas: n(l.auctions),
      mediana7d: n(l.median7d),
      mediana30d: n(l.median30d),
      mediana90d: n(l.median90d),
      origen: typeof l.source === "string" ? l.source : null
    } : null,
    ventas: j.sales && typeof j.sales.estimatedPerDay === "number" ? { por_dia: j.sales.estimatedPerDay, dias: j.sales.windowDays ?? null } : null,
    atribucion: { texto: "Prices from AHledger", url: "https://ahledger.com" },
    nota: null
  };
  function vacio() {
    return {
      fuente: "ahledger",
      rango,
      paso_ms: null,
      nombres: ["Compra mínima", "Mediana"],
      puntos: [],
      cantidad: [],
      med7: null,
      med30: null,
      ultimo: null,
      ventas: null,
      atribucion: { texto: "Prices from AHledger", url: "https://ahledger.com" },
      nota: null
    };
  }
}
var COOKIE = "mw_sesion";
var DURACION_S = 30 * 24 * 3600;
var json = (status, cuerpo, extra = {}) => new Response(JSON.stringify(cuerpo), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }
});
var b64url = (b2) => b2.toString("base64url");
function firmar(clave, carga) {
  return b64url(createHmac("sha256", "mercadowow-sesion:" + clave).update(carga).digest());
}
function crearToken(clave, ahora) {
  const exp = Math.floor(ahora.getTime() / 1e3) + DURACION_S;
  const carga = `v1.${exp}`;
  return `${carga}.${firmar(clave, carga)}`;
}
function tokenValido(clave, token, ahora) {
  if (!token) return false;
  const partes = token.split(".");
  if (partes.length !== 3 || partes[0] !== "v1" || !/^\d+$/.test(partes[1])) return false;
  if (Number(partes[1]) * 1e3 <= ahora.getTime()) return false;
  const esperado = Buffer.from(firmar(clave, `v1.${partes[1]}`));
  const recibido = Buffer.from(partes[2]);
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}
function claveCorrecta(clave, intento) {
  const a = createHash("sha256").update(clave).digest();
  const b2 = createHash("sha256").update(intento).digest();
  return timingSafeEqual(a, b2);
}
function leerCookie(req, nombre) {
  const cab = req.headers.get("cookie") ?? "";
  for (const parte of cab.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nombre) return v.join("=");
  }
  return null;
}
async function llamar(db2, sql2, params) {
  const filas = await db2.consulta(sql2, params);
  const r = filas[0]?.r;
  return typeof r === "string" ? JSON.parse(r) : r;
}
function crearApi(db2, o) {
  const ahora = o.ahora ?? (() => /* @__PURE__ */ new Date());
  const segura = o.segura ?? true;
  const configurada = typeof o.clave === "string" && o.clave.length >= CLAVE_MINIMA;
  const sinConfigurar = () => json(500, {
    error: typeof o.clave === "string" && o.clave.length > 0 ? `CLAVE_ACCESO es demasiado corta: necesita al menos ${CLAVE_MINIMA} caracteres. Cámbiala en las variables de entorno del alojamiento y vuelve a desplegar.` : `Falta CLAVE_ACCESO en las variables de entorno del alojamiento (mínimo ${CLAVE_MINIMA} caracteres). Añádela para el entorno de producción y vuelve a desplegar.`
  });
  const autenticado = (req) => configurada && tokenValido(o.clave, leerCookie(req, COOKIE), ahora());
  const cookie = (valor, maxAge) => `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${segura ? "; Secure" : ""}`;
  const fallaBd = (e) => {
    const msg = String(e?.message ?? e);
    const codigo = e?.code;
    if (codigo === "P0001") return json(422, { error: msg });
    if (codigo === "42883" || codigo === "42P01") {
      return json(503, { error: "Faltan migraciones en Supabase: ejecuta configurar.bat" });
    }
    console.error("Error de base de datos:", msg);
    return json(503, { error: "No se pudo conectar con Supabase" });
  };
  const historialPropio = async (mercado, id, rango) => {
    const dias = { "24h": 1, "7d": 7, "30d": 30, "90d": 60 }[rango];
    const h = await llamar(db2, "select historial_objeto($1, $2::integer, $3::integer) as r", [mercado, id, dias]);
    const cant = await llamar(db2, "select coalesce(jsonb_agg(jsonb_build_array((extract(epoch from p.hour) * 1000)::bigint, p.quantity) order by p.hour), '[]'::jsonb) as r from price_hourly p join markets m on m.id = p.market_id where m.key = $1 and p.item_id = $2::integer and p.quantity is not null and p.hour > now() - make_interval(days => $3::integer)", [mercado, id, dias]);
    return {
      fuente: "propio",
      rango,
      paso_ms: null,
      nombres: ["Compra mínima", "Valor de mercado"],
      puntos: h?.puntos ?? [],
      cantidad: cant?.length ? cant : null,
      med7: h?.med7 ?? null,
      med30: h?.med30 ?? null,
      ultimo: null,
      nota: rango === "90d" ? "El historial propio se guarda como máximo 60 días." : null
    };
  };
  const altaPorId = async (mercado, id) => {
    const m = (await db2.consulta("select game_type, is_demo from markets where key = $1", [mercado]))[0];
    if (!m || m.is_demo) return false;
    const r = await pedirObjetoAhledger(o.fetch ?? fetch, id, String(m.game_type));
    if (r.tipo !== "ok") return false;
    await db2.consulta(
      "select guardar_catalogo($1, $2::text::jsonb, 'ahledger', $3::timestamptz) as r",
      [m.game_type, JSON.stringify([r.objeto]), ahora().toISOString()]
    );
    return true;
  };
  const leerJson = async (req, maxBytes) => {
    const largo = Number(req.headers.get("content-length") ?? 0);
    if (largo > maxBytes) throw new RangeError("demasiado grande");
    const texto = await req.text();
    if (texto.length > maxBytes) throw new RangeError("demasiado grande");
    return JSON.parse(texto);
  };
  return {
    async login(req, ip) {
      if (!configurada) return sinConfigurar();
      if (req.method !== "POST") return json(405, { error: "Método no permitido" });
      let intento = "";
      try {
        const cuerpo = await req.json();
        intento = typeof cuerpo?.clave === "string" ? cuerpo.clave : "";
      } catch {
        return json(400, { error: "Petición mal formada" });
      }
      try {
        const bloqueado = (await db2.consulta(
          "select login_bloqueado($1, $2::timestamptz) as b",
          [ip, ahora().toISOString()]
        ))[0]?.b;
        if (bloqueado) {
          return json(429, { error: "Demasiados intentos fallidos. Espera 15 minutos." });
        }
        const ok = intento.length > 0 && claveCorrecta(o.clave, intento);
        await db2.consulta("select registrar_login($1, $2, $3::timestamptz)", [ip, ok, ahora().toISOString()]);
        if (!ok) return json(401, { error: "Contraseña incorrecta" });
      } catch (e) {
        return fallaBd(e);
      }
      return json(200, { ok: true }, { "Set-Cookie": cookie(crearToken(o.clave, ahora()), DURACION_S) });
    },
    async logout(_req) {
      return json(200, { ok: true }, { "Set-Cookie": cookie("", 0) });
    },
    async estado(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      let mercado = new URL(req.url).searchParams.get("mercado") || "";
      try {
        const principal = await db2.consulta("select mercado_principal() as m", []).then((f) => f[0]?.m).catch(() => null) || o.mercado;
        if (!mercado) mercado = principal;
        const r = await llamar(db2, "select estado_mercado($1) as r", [mercado]);
        if (!r) return json(404, { error: `Mercado ${mercado} no registrado` });
        const mercados = await llamar(db2, "select listar_mercados() as r", []);
        return json(200, {
          ...r,
          mercados,
          mercado_principal: principal,
          autenticado: true,
          base_de_datos: { proveedor: "Supabase", proyecto: o.proyecto, migraciones_pendientes: [] }
        });
      } catch (e) {
        return fallaBd(e);
      }
    },
    async importar(req) {
      if (!configurada) return sinConfigurar();
      if (req.method !== "POST") return json(405, { error: "Método no permitido" });
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      let c;
      try {
        c = await leerJson(req, 5e6);
      } catch (e) {
        return json(
          e instanceof RangeError ? 413 : 400,
          { error: e instanceof RangeError ? "Archivo demasiado grande (máx. 5 MB)" : "Petición mal formada" }
        );
      }
      if (typeof c?.mercado !== "string" || typeof c?.hora_dato !== "string" || !Array.isArray(c?.filas)) {
        return json(400, { error: "Faltan mercado, hora_dato o filas" });
      }
      try {
        const r = await llamar(
          db2,
          "select importar_precios($1, $2::timestamptz, $3::text::jsonb, $4, $5::timestamptz) as r",
          [
            c.mercado,
            c.hora_dato,
            JSON.stringify(c.filas),
            String(c.nombre_archivo ?? "sin nombre"),
            ahora().toISOString()
          ]
        );
        return json(200, r);
      } catch (e) {
        return fallaBd(e);
      }
    },
    async precios(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const mercado = new URL(req.url).searchParams.get("mercado") || o.mercado;
      try {
        const v = await llamar(db2, "select version_mercado($1) as r", [mercado]);
        if (!v) return json(404, { error: `Mercado ${mercado} no registrado` });
        const motor = await llamar(db2, "select recalcular_recomendaciones($1) as r", [mercado]);
        const objetos = await llamar(db2, "select tabla_precios($1) as r", [mercado]);
        const resumen = await llamar(db2, "select resumen_recomendaciones($1) as r", [mercado]);
        return json(200, { mercado, version: v, motor, resumen, objetos });
      } catch (e) {
        return fallaBd(e);
      }
    },
    async version(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const mercado = new URL(req.url).searchParams.get("mercado") || o.mercado;
      try {
        const v = await llamar(db2, "select version_mercado($1) as r", [mercado]);
        return v ? json(200, v) : json(404, { error: `Mercado ${mercado} no registrado` });
      } catch (e) {
        return fallaBd(e);
      }
    },
    async explicacion(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const id = Number(u.get("id"));
      if (!Number.isInteger(id) || id <= 0) return json(400, { error: "Falta id" });
      try {
        await llamar(db2, "select recalcular_recomendaciones($1) as r", [mercado]);
        const r = await llamar(db2, "select explicar_objeto($1, $2::integer) as r", [mercado, id]);
        return r ? json(200, r) : json(404, { error: "Objeto sin recomendación en este mercado" });
      } catch (e) {
        return fallaBd(e);
      }
    },
    async ajustes(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      try {
        if (req.method === "GET") return json(200, await llamar(db2, "select leer_ajustes() as r", []));
        if (req.method !== "POST") return json(405, { error: "Método no permitido" });
        let c;
        try {
          c = await leerJson(req, 5e3);
        } catch {
          return json(400, { error: "Petición mal formada" });
        }
        if (!c || typeof c !== "object" || Array.isArray(c)) return json(400, { error: "Se esperaba un objeto" });
        return json(200, await llamar(db2, "select guardar_ajustes($1::text::jsonb) as r", [JSON.stringify(c)]));
      } catch (e) {
        return fallaBd(e);
      }
    },
    async historial(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const id = Number(u.get("id"));
      const dias = Number(u.get("dias") ?? 30);
      if (!Number.isInteger(id) || id <= 0) return json(400, { error: "Falta id" });
      if (!Number.isInteger(dias) || dias < 1 || dias > 60) return json(400, { error: "dias debe estar entre 1 y 60" });
      try {
        return json(200, await llamar(db2, "select historial_objeto($1, $2::integer, $3::integer) as r", [mercado, id, dias]));
      } catch (e) {
        return fallaBd(e);
      }
    },
    async inventario(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      if (req.method === "GET") {
        const mercado = new URL(req.url).searchParams.get("mercado") || o.mercado;
        try {
          await llamar(db2, "select recalcular_recomendaciones($1) as r", [mercado]);
          return json(200, await llamar(db2, "select inventario_valorado($1) as r", [mercado]));
        } catch (e) {
          return fallaBd(e);
        }
      }
      if (req.method !== "POST") return json(405, { error: "Método no permitido" });
      let c;
      try {
        c = await leerJson(req, 2e6);
      } catch {
        return json(400, { error: "Petición mal formada" });
      }
      const entero = (v) => Number.isInteger(v);
      const costeOk = (v) => v === null || v === void 0 || entero(v);
      if (typeof c?.mercado !== "string") return json(400, { error: "Falta mercado" });
      try {
        switch (c.accion) {
          case "agregar":
            if (!entero(c.item_id) || !entero(c.cantidad) || !costeOk(c.coste)) return json(400, { error: "Datos del lote no válidos" });
            return json(200, await llamar(
              db2,
              "select agregar_inventario($1, $2::integer, $3::integer, $4::bigint, $5) as r",
              [c.mercado, c.item_id, c.cantidad, c.coste ?? null, c.nota ?? null]
            ));
          case "editar":
            if (!entero(c.id) || !entero(c.cantidad) || !costeOk(c.coste)) return json(400, { error: "Datos del lote no válidos" });
            return json(200, await llamar(
              db2,
              "select editar_inventario($1, $2::bigint, $3::integer, $4::bigint, $5) as r",
              [c.mercado, c.id, c.cantidad, c.coste ?? null, c.nota ?? null]
            ));
          case "borrar":
            if (!entero(c.id)) return json(400, { error: "Falta id" });
            return json(200, await llamar(db2, "select borrar_inventario($1, $2::bigint) as r", [c.mercado, c.id]));
          case "importar":
            if (!Array.isArray(c.filas)) return json(400, { error: "Faltan filas" });
            return json(200, await llamar(
              db2,
              "select importar_inventario($1, $2::text::jsonb, $3::boolean) as r",
              [c.mercado, JSON.stringify(c.filas), c.reemplazar === true]
            ));
          default:
            return json(400, { error: "Acción desconocida" });
        }
      } catch (e) {
        return fallaBd(e);
      }
    },
    async ventas(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      if (req.method === "GET") {
        const mercado = new URL(req.url).searchParams.get("mercado") || o.mercado;
        try {
          await llamar(db2, "select recalcular_recomendaciones($1) as r", [mercado]);
          const lista = await llamar(db2, "select ventas_listado($1, $2::timestamptz) as r", [mercado, ahora().toISOString()]);
          const evaluacion = await llamar(db2, "select evaluar_recomendaciones($1, $2::timestamptz) as r", [mercado, ahora().toISOString()]);
          return json(200, { ...lista, evaluacion });
        } catch (e) {
          return fallaBd(e);
        }
      }
      if (req.method !== "POST") return json(405, { error: "Método no permitido" });
      let c;
      try {
        c = await leerJson(req, 5e3);
      } catch {
        return json(400, { error: "Petición mal formada" });
      }
      const entero = (v) => Number.isInteger(v);
      const opcional = (v) => v === null || v === void 0 || entero(v);
      if (typeof c?.mercado !== "string") return json(400, { error: "Falta mercado" });
      try {
        if (c.accion === "registrar") {
          if (!entero(c.item_id) || !entero(c.cantidad) || !entero(c.precio) || typeof c.vendido_en !== "string" || !opcional(c.comision) || !opcional(c.deposito) || !opcional(c.lote_id)) {
            return json(400, { error: "Datos de la venta no válidos" });
          }
          return json(200, await llamar(
            db2,
            `select registrar_venta($1, $2::integer, $3::integer, $4::bigint, $5::timestamptz, $6::bigint, $7::bigint,
                                    $8::bigint, $9::boolean, $10, $11::timestamptz) as r`,
            [
              c.mercado,
              c.item_id,
              c.cantidad,
              c.precio,
              c.vendido_en,
              c.comision ?? null,
              c.deposito ?? null,
              c.lote_id ?? null,
              c.descontar === true,
              c.nota ?? null,
              ahora().toISOString()
            ]
          ));
        }
        if (c.accion === "borrar") {
          if (!entero(c.id)) return json(400, { error: "Falta id" });
          return json(200, await llamar(db2, "select borrar_venta($1, $2::bigint) as r", [c.mercado, c.id]));
        }
        return json(400, { error: "Acción desconocida" });
      } catch (e) {
        return fallaBd(e);
      }
    },
    /** Historial para el gráfico: de AHledger (24 h, 7, 30 y 90 días) o, en otros mercados, el propio. */
    async historialFuente(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const id = Number(u.get("id"));
      const rango = u.get("rango") ?? "7d";
      if (!Number.isInteger(id) || id <= 0) return json(400, { error: "Falta id" });
      if (!RANGOS.includes(rango)) return json(400, { error: `rango debe ser ${RANGOS.join(", ")}` });
      try {
        const m = (await db2.consulta("select provider, source_url from markets where key = $1", [mercado]))[0];
        if (!m) return json(404, { error: `Mercado ${mercado} no registrado` });
        return json(200, m.provider === "ahledger" && u.get("guardado") !== "1" ? await historialAhledger(o.fetch ?? fetch, String(m.source_url), id, rango) : await historialPropio(mercado, id, rango));
      } catch (e) {
        if (e instanceof ErrorFuente) return json(502, { error: e.message });
        return fallaBd(e);
      }
    },
    async catalogo(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const q = (u.get("q") ?? "").trim().slice(0, 80);
      if (!q) return json(200, { q, resultados: [] });
      try {
        let resultados = await llamar(db2, "select buscar_catalogo($1, $2, 20) as r", [mercado, q]);
        if (/^\d{1,9}$/.test(q) && !resultados.some((r) => r.id === Number(q))) {
          const anadido = await altaPorId(mercado, Number(q));
          if (anadido) resultados = await llamar(db2, "select buscar_catalogo($1, $2, 20) as r", [mercado, q]);
        }
        return json(200, { q, resultados });
      } catch (e) {
        return fallaBd(e);
      }
    },
    async objeto(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const id = Number(u.get("id"));
      if (!Number.isInteger(id) || id <= 0) return json(400, { error: "Falta id" });
      try {
        let f = await llamar(db2, "select ficha_objeto($1, $2::integer) as r", [mercado, id]);
        if (!f?.en_catalogo && await altaPorId(mercado, id)) {
          f = await llamar(db2, "select ficha_objeto($1, $2::integer) as r", [mercado, id]);
        }
        return f ? json(200, f) : json(404, { error: "Ese objeto no existe en el catálogo ni en AHledger" });
      } catch (e) {
        return fallaBd(e);
      }
    },
    async categorias(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const mercado = new URL(req.url).searchParams.get("mercado") || o.mercado;
      try {
        return json(200, await llamar(db2, "select categorias_mercado($1) as r", [mercado]));
      } catch (e) {
        return fallaBd(e);
      }
    },
    /** Cobertura del catálogo (GET) e importación verificable de IDs (POST {ids: number[]}). */
    async cobertura(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      try {
        if (req.method === "GET") {
          const informe = new URL(req.url).searchParams.get("informe") === "1";
          return json(200, await llamar(db2, informe ? "select informe_catalogo('forever') as r" : "select cobertura_catalogo('forever') as r", []));
        }
        if (req.method !== "POST") return json(405, { error: "Método no permitido" });
        let c;
        try {
          c = await leerJson(req, 1e5);
        } catch {
          return json(400, { error: "Petición mal formada" });
        }
        if (!Array.isArray(c?.ids) || !c.ids.length || c.ids.length > 5e3 || !c.ids.every((x) => Number.isInteger(x) && Math.abs(x) < 2 ** 31)) {
          return json(400, { error: "ids debe ser una lista de 1 a 5000 números enteros" });
        }
        return json(200, await llamar(
          db2,
          "select solicitar_catalogo('forever', $1::integer[], $2::timestamptz) as r",
          [c.ids, ahora().toISOString()]
        ));
      } catch (e) {
        return fallaBd(e);
      }
    },
    /** Banda de precios para «Qué hacer con este objeto» (X1): leer (GET) y guardar (POST {ajustes}). */
    async perfilSubasta(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      try {
        if (req.method === "GET") return json(200, await llamar(db2, "select leer_perfil_subasta() as r", []));
        if (req.method !== "POST") return json(405, { error: "Método no permitido" });
        let c;
        try {
          c = await leerJson(req, 2e3);
        } catch {
          return json(400, { error: "Petición mal formada" });
        }
        if (!c?.ajustes || typeof c.ajustes !== "object" || Array.isArray(c.ajustes)) return json(400, { error: "Faltan los ajustes" });
        return json(200, await llamar(db2, "select guardar_perfil_subasta($1::text::jsonb) as r", [JSON.stringify(c.ajustes)]));
      } catch (e) {
        return fallaBd(e);
      }
    },
    /** Mapa de materiales (W3): variación por periodo, agrupada por familia. */
    async mapa(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const casa = u.get("ambito") === "casa";
      if (!["casa", "materiales", null].includes(u.get("ambito"))) return json(400, { error: "ambito debe ser materiales o casa" });
      const p = {};
      for (const k of casa ? ["periodo", "clase", "subclase", "calidad", "solo_ofertas"] : ["periodo", "profesion", "familia", "calidad", "solo_ofertas"]) {
        const v = u.get(k);
        if (v !== null && v !== "") p[k] = v.slice(0, 80);
      }
      if (p.solo_ofertas !== void 0 && !["true", "false"].includes(p.solo_ofertas)) {
        return json(400, { error: "solo_ofertas debe ser true o false" });
      }
      try {
        return json(200, await llamar(
          db2,
          `select ${casa ? "mapa_casa" : "mapa_materiales"}($1, $2::text::jsonb) as r`,
          [mercado, JSON.stringify(p)]
        ));
      } catch (e) {
        return fallaBd(e);
      }
    },
    /** Tabla del Mercado paginada sobre todo el catálogo (V2): filtros, orden y página en la base de datos. */
    async mercado(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const p = {};
      for (const k of [
        "q",
        "categoria",
        "subcategoria",
        "calidad",
        "profesion",
        "rol",
        "materiales",
        "familia",
        "nivel_min",
        "nivel_max",
        "precio_min",
        "precio_max",
        "solo_ofertas",
        "oportunidad",
        "ventas_region_min",
        "lista",
        "orden",
        "dir",
        "pagina",
        "por_pagina"
      ]) {
        const v = u.get(k);
        if (v !== null && v !== "") p[k] = v.slice(0, 80);
      }
      for (const k of ["solo_ofertas", "materiales"]) {
        if (p[k] !== void 0 && !["true", "false"].includes(p[k])) return json(400, { error: `${k} debe ser true o false` });
      }
      try {
        return json(200, await llamar(db2, "select mercado_pagina($1, $2::text::jsonb) as r", [mercado, JSON.stringify(p)]));
      } catch (e) {
        return fallaBd(e);
      }
    },
    /** Recetas (R5): ?profesion=X → lista con coste; ?objeto=ID → fabricación y usos; nada → profesiones. */
    async recetas(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const base = u.get("base") || "mediana";
      if (!["mediana", "minimo", "tsm"].includes(base)) return json(400, { error: "base debe ser mediana, minimo o tsm" });
      const profesion = u.get("profesion");
      const objeto = u.get("objeto");
      try {
        if (u.get("fabricacion") !== null) {
          return json(200, await llamar(db2, "select datos_fabricacion($1) as r", [mercado]));
        }
        if (u.get("historial") !== null) {
          const ids = (u.get("ids") ?? "").split(",").filter(Boolean).map(Number);
          if (!ids.length || ids.length > 300 || !ids.every((n) => Number.isInteger(n) && n > 0)) {
            return json(400, { error: "ids: entre 1 y 300 números separados por comas" });
          }
          const dias = Number(u.get("dias") ?? 7);
          if (![1, 7, 30, 90].includes(dias)) return json(400, { error: "dias debe ser 1, 7, 30 o 90" });
          return json(200, await llamar(db2, "select historial_fabricacion($1, $2::integer[], $3) as r", [mercado, ids, dias]));
        }
        if (objeto !== null) {
          const id = Number(objeto);
          if (!Number.isInteger(id) || id <= 0) return json(400, { error: "objeto no válido" });
          return json(200, await llamar(db2, "select recetas_objeto($1, $2::integer, $3) as r", [mercado, id, base]));
        }
        if (profesion !== null) {
          return json(200, await llamar(db2, "select recetas_profesion($1, $2, $3) as r", [mercado, profesion.slice(0, 40), base]));
        }
        return json(200, await llamar(db2, "select profesiones_recetas($1) as r", [mercado]));
      } catch (e) {
        return fallaBd(e);
      }
    },
    /**
     * Precios de compra al NPC introducidos por ti (X4). GET: lista. POST {filas: [{id, precio}], aplicar}:
     * comprueba cada fila (vista previa) y, con aplicar = true, guarda las aceptadas.
     */
    async compraNpc(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const mercado = new URL(req.url).searchParams.get("mercado") || o.mercado;
      try {
        if (req.method === "GET") return json(200, await llamar(db2, "select listar_compra_npc($1) as r", [mercado]));
        if (req.method !== "POST") return json(405, { error: "Método no permitido" });
        let c;
        try {
          c = await leerJson(req, 2e5);
        } catch {
          return json(400, { error: "Petición mal formada" });
        }
        if (!Array.isArray(c?.filas) || typeof c?.aplicar !== "boolean") return json(400, { error: "Faltan filas o aplicar" });
        if (c.filas.length > 2e3) return json(400, { error: "Máximo 2000 filas por importación" });
        return json(200, await llamar(
          db2,
          "select importar_compra_npc($1, $2::text::jsonb, $3::boolean, $4::timestamptz) as r",
          [mercado, JSON.stringify(c.filas), c.aplicar, ahora().toISOString()]
        ));
      } catch (e) {
        return fallaBd(e);
      }
    },
    /** Ficha oficial de un objeto (texto del juego en español, de Blizzard) para el cuadro del icono. */
    async tooltip(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const id = Number(u.get("id"));
      if (!Number.isInteger(id) || id <= 0 || id > 2147483647) return json(400, { error: "id no válido" });
      try {
        return json(200, { ficha: await llamar(db2, "select ficha_blizzard($1, $2::integer) as r", [mercado, id]) });
      } catch (e) {
        return fallaBd(e);
      }
    },
    /** Nombres oficiales en español ({id: nombre}) y cuántos hay (API de Blizzard). */
    async nombresEs(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const mercado = new URL(req.url).searchParams.get("mercado") || o.mercado;
      try {
        return json(200, await llamar(db2, "select nombres_es($1) as r", [mercado]));
      } catch (e) {
        return fallaBd(e);
      }
    },
    /** Listas propias (X6). GET ?objeto=ID: listas (y si lo contienen). POST {accion, …}: gestionar. */
    async listas(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      try {
        if (req.method === "GET") {
          const obj = new URL(req.url).searchParams.get("objeto");
          const id = obj === null || obj === "" ? null : Number(obj);
          if (id !== null && (!Number.isInteger(id) || id <= 0)) return json(400, { error: "objeto no válido" });
          return json(200, await llamar(db2, "select listar_listas($1::integer) as r", [id]));
        }
        if (req.method !== "POST") return json(405, { error: "Método no permitido" });
        let c;
        try {
          c = await leerJson(req, 5e3);
        } catch {
          return json(400, { error: "Petición mal formada" });
        }
        if (!c || typeof c !== "object" || Array.isArray(c) || typeof c.accion !== "string") return json(400, { error: "Falta accion" });
        return json(200, await llamar(db2, "select gestionar_lista($1::text::jsonb) as r", [JSON.stringify(c)]));
      } catch (e) {
        return fallaBd(e);
      }
    },
    /** Alertas por umbral (X6). GET ?mercado&objeto: alertas y avisos. POST {accion, …}: crear, borrar, visto. */
    async alertas(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      try {
        if (req.method === "GET") {
          const obj = u.get("objeto");
          const id = obj === null || obj === "" ? null : Number(obj);
          if (id !== null && (!Number.isInteger(id) || id <= 0)) return json(400, { error: "objeto no válido" });
          return json(200, await llamar(db2, "select leer_alertas($1, $2::integer) as r", [mercado, id]));
        }
        if (req.method !== "POST") return json(405, { error: "Método no permitido" });
        let c;
        try {
          c = await leerJson(req, 2e4);
        } catch {
          return json(400, { error: "Petición mal formada" });
        }
        if (!c || typeof c !== "object" || Array.isArray(c) || typeof c.accion !== "string") return json(400, { error: "Falta accion" });
        return json(200, await llamar(db2, "select gestionar_alerta($1, $2::text::jsonb) as r", [mercado, JSON.stringify(c)]));
      } catch (e) {
        return fallaBd(e);
      }
    },
    /** Reglas de comisión y depósito (auction_fee_rules): leer y editar. */
    async tasas(req) {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      try {
        if (req.method === "GET") return json(200, await llamar(db2, "select leer_tasas('forever') as r", []));
        if (req.method !== "POST") return json(405, { error: "Método no permitido" });
        let c;
        try {
          c = await leerJson(req, 2e3);
        } catch {
          return json(400, { error: "Petición mal formada" });
        }
        if (!Number.isInteger(c?.id) || !c?.cambios || typeof c.cambios !== "object" || Array.isArray(c.cambios)) {
          return json(400, { error: "Faltan id o cambios" });
        }
        return json(200, await llamar(
          db2,
          "select guardar_tasa($1::smallint, $2::text::jsonb, $3::date) as r",
          [c.id, JSON.stringify(c.cambios), ahora().toISOString().slice(0, 10)]
        ));
      } catch (e) {
        return fallaBd(e);
      }
    },
    async favorito(req) {
      if (!configurada) return sinConfigurar();
      if (req.method !== "POST") return json(405, { error: "Método no permitido" });
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      let c;
      try {
        c = await leerJson(req, 1e3);
      } catch {
        return json(400, { error: "Petición mal formada" });
      }
      if (typeof c?.mercado !== "string" || !Number.isInteger(c?.id) || typeof c?.favorito !== "boolean") {
        return json(400, { error: "Faltan mercado, id o favorito" });
      }
      try {
        return json(200, await llamar(
          db2,
          "select marcar_favorito($1, $2::integer, $3::boolean) as r",
          [c.mercado, c.id, c.favorito]
        ));
      } catch (e) {
        return fallaBd(e);
      }
    },
    async demo(req) {
      if (!configurada) return sinConfigurar();
      if (req.method !== "POST") return json(405, { error: "Método no permitido" });
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      let dias = 30;
      try {
        const c = await leerJson(req, 1e3);
        if (c?.dias !== void 0) dias = Number(c.dias);
      } catch {
      }
      if (!Number.isInteger(dias) || dias < 1 || dias > 60) return json(400, { error: "dias debe estar entre 1 y 60" });
      try {
        return json(200, await llamar(
          db2,
          "select generar_demo($1::integer, $2::timestamptz) as r",
          [dias, ahora().toISOString()]
        ));
      } catch (e) {
        return fallaBd(e);
      }
    },
    async actualizar(req) {
      if (!configurada) return sinConfigurar();
      if (req.method !== "POST") return json(405, { error: "Método no permitido" });
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      let mercado = o.mercado;
      try {
        const c = await leerJson(req, 1e3);
        if (typeof c?.mercado === "string" && c.mercado.length <= 100) mercado = c.mercado;
      } catch {
      }
      try {
        const r = await llamar(db2, "select solicitar_actualizacion($1) as r", [mercado]);
        if (!r?.ok) {
          const mensajes = {
            en_curso: "Ya hay una actualización en curso.",
            espera: `Espera ${r?.segundos ?? 0} s antes de volver a pedirla.`,
            mercado_sin_fuente: "Este mercado no tiene descarga automática."
          };
          return json(
            r?.motivo === "espera" ? 429 : 409,
            { ...r, mensaje: mensajes[r?.motivo] ?? "No disponible" }
          );
        }
        await db2.consulta("select disparar_si_corresponde()", []);
        return json(202, { ok: true, mensaje: "Actualización solicitada." });
      } catch (e) {
        return fallaBd(e);
      }
    }
  };
}

// netlify/lib/netlify.ts
var sql = null;
var db = {
  consulta(q, p) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL en las variables de entorno del alojamiento");
    sql ??= src_default(url, { max: 1, idle_timeout: 20, connect_timeout: 15, prepare: false });
    return sql.unsafe(q, p);
  }
};
var proyecto = (process.env.SUPABASE_URL ?? "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? "?";
var api = crearApi(db, {
  clave: process.env.CLAVE_ACCESO,
  mercado: process.env.MERCADO ?? "ahledger:forever:us:pvp-horde",
  proyecto
});

// vercel/rutas.ts
var RUTAS = {
  actualizar: "actualizar",
  ajustes: "ajustes",
  alertas: "alertas",
  listas: "listas",
  catalogo: "catalogo",
  categorias: "categorias",
  cobertura: "cobertura",
  "compra-npc": "compraNpc",
  demo: "demo",
  estado: "estado",
  explicacion: "explicacion",
  favorito: "favorito",
  "historial-fuente": "historialFuente",
  historial: "historial",
  importar: "importar",
  inventario: "inventario",
  login: "login",
  logout: "logout",
  mapa: "mapa",
  mercado: "mercado",
  "nombres-es": "nombresEs",
  objeto: "objeto",
  "perfil-subasta": "perfilSubasta",
  precios: "precios",
  recetas: "recetas",
  tasas: "tasas",
  tooltip: "tooltip",
  ventas: "ventas",
  version: "version"
};
var PARAM = "__ruta";
var json2 = (estado, cuerpo) => new Response(JSON.stringify(cuerpo), {
  status: estado,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
function rutaDe(url) {
  const m = url.pathname.match(/^\/api\/([a-z-]+)\/?$/);
  if (m && m[1] !== "index") return m[1];
  return url.searchParams.get(PARAM) ?? "";
}
var ipDe = (req) => req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "desconocida";
async function despachar(req, api2) {
  const url = new URL(req.url);
  const ruta = rutaDe(url);
  const metodo = Object.hasOwn(RUTAS, ruta) ? RUTAS[ruta] : null;
  if (!metodo || typeof api2[metodo] !== "function") return json2(404, { error: "No existe esa ruta" });
  let limpio = req;
  if (url.searchParams.has(PARAM)) {
    url.searchParams.delete(PARAM);
    url.pathname = `/api/${ruta}`;
    limpio = new Request(url, req);
  }
  return api2[metodo](limpio, ipDe(req));
}

// vercel/entrada.ts
var atender = (req) => despachar(req, api);
var GET = atender;
var POST = atender;
var PUT = atender;
var PATCH = atender;
var DELETE = atender;
var HEAD = atender;
var OPTIONS = atender;
export {
  DELETE,
  GET,
  HEAD,
  OPTIONS,
  PATCH,
  POST,
  PUT
};
