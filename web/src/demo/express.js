// بديل خفيف لـ Express.Router يعمل داخل المتصفح بنفس واجهة المسارات
export function Router() {
  const stack = [];
  const add = (method) => (path, ...handlers) => { stack.push({ method, path, keys: [], re: compile(path), handlers }); };
  const router = {
    stack,
    // use(fn...) لكل المسارات، أو use('/orders/:id', fn...) لمسار وما تحته
    use(...handlers) {
      if (typeof handlers[0] === 'string') {
        const prefix = handlers.shift();
        const keys = [];
        const re = new RegExp('^' + prefix.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '(?:/|$)');
        stack.push({ method: null, prefix: { re, keys }, handlers });
      } else stack.push({ method: null, handlers });
    },
    get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE'),
  };
  return router;
}

function compile(path) {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  re.keys = keys;
  return re;
}

/** تنفيذ طلب على الموجّه وإرجاع {status, data} */
export async function dispatch(router, { method, url, body, headers }) {
  const [path, qs = ''] = url.split('?');
  const req = { method, path, url, body: body ?? {}, headers, params: {}, query: Object.fromEntries(new URLSearchParams(qs)) };
  let status = 200;
  let data = null;
  let done = false;
  const res = {
    status(s) { status = s; return res; },
    json(d) { data = d; done = true; return res; },
  };

  const layers = [];
  for (const l of router.stack) {
    if (!l.method) {
      if (l.prefix) {
        const m = l.prefix.re.exec(path);
        if (!m) continue;
        layers.push((rq, rs, next) => { rq.params = Object.fromEntries(l.prefix.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); next(); }, ...l.handlers);
      } else layers.push(...l.handlers);
      continue;
    }
    if (l.method !== method) continue;
    const m = l.re.exec(path);
    if (!m) continue;
    layers.push((rq, rs, next) => {
      rq.params = Object.fromEntries(l.re.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      next();
    }, ...l.handlers);
    break;
  }

  try {
    let i = 0;
    const next = (err) => {
      if (err) throw err;
      if (done || i >= layers.length) return;
      const fn = layers[i++];
      fn(req, res, next);
    };
    next();
    if (!done) { status = 404; data = { error: 'المسار غير موجود' }; }
  } catch (err) {
    status = err.status || 500;
    if (status >= 500) console.error(err);
    data = { error: status >= 500 ? 'خطأ في الخادم' : err.message };
  }
  return { status, data: JSON.parse(JSON.stringify(data)) };
}

export default { Router };
