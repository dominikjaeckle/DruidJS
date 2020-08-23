var app = (function () {
    'use strict';

    function noop() { }
    function is_promise(value) {
        return value && typeof value === 'object' && typeof value.then === 'function';
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function svg_element(name) {
        return document.createElementNS('http://www.w3.org/2000/svg', name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
    }
    function toggle_class(element, name, toggle) {
        element.classList[toggle ? 'add' : 'remove'](name);
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error(`Function called outside component initialization`);
        return current_component;
    }
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail);
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
            }
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }

    function handle_promise(promise, info) {
        const token = info.token = {};
        function update(type, index, key, value) {
            if (info.token !== token)
                return;
            info.resolved = value;
            let child_ctx = info.ctx;
            if (key !== undefined) {
                child_ctx = child_ctx.slice();
                child_ctx[key] = value;
            }
            const block = type && (info.current = type)(child_ctx);
            let needs_flush = false;
            if (info.block) {
                if (info.blocks) {
                    info.blocks.forEach((block, i) => {
                        if (i !== index && block) {
                            group_outros();
                            transition_out(block, 1, 1, () => {
                                info.blocks[i] = null;
                            });
                            check_outros();
                        }
                    });
                }
                else {
                    info.block.d(1);
                }
                block.c();
                transition_in(block, 1);
                block.m(info.mount(), info.anchor);
                needs_flush = true;
            }
            info.block = block;
            if (info.blocks)
                info.blocks[index] = block;
            if (needs_flush) {
                flush();
            }
        }
        if (is_promise(promise)) {
            const current_component = get_current_component();
            promise.then(value => {
                set_current_component(current_component);
                update(info.then, 1, info.value, value);
                set_current_component(null);
            }, error => {
                set_current_component(current_component);
                update(info.catch, 2, info.error, error);
                set_current_component(null);
            });
            // if we previously had a then/catch block, destroy it
            if (info.current !== info.pending) {
                update(info.pending, 0);
                return true;
            }
        }
        else {
            if (info.current !== info.then) {
                update(info.then, 1, info.value, promise);
                return true;
            }
            info.resolved = promise;
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function ascending(a, b) {
      return a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN;
    }

    function bisector(compare) {
      if (compare.length === 1) compare = ascendingComparator(compare);
      return {
        left: function(a, x, lo, hi) {
          if (lo == null) lo = 0;
          if (hi == null) hi = a.length;
          while (lo < hi) {
            var mid = lo + hi >>> 1;
            if (compare(a[mid], x) < 0) lo = mid + 1;
            else hi = mid;
          }
          return lo;
        },
        right: function(a, x, lo, hi) {
          if (lo == null) lo = 0;
          if (hi == null) hi = a.length;
          while (lo < hi) {
            var mid = lo + hi >>> 1;
            if (compare(a[mid], x) > 0) hi = mid;
            else lo = mid + 1;
          }
          return lo;
        }
      };
    }

    function ascendingComparator(f) {
      return function(d, x) {
        return ascending(f(d), x);
      };
    }

    var ascendingBisect = bisector(ascending);
    var bisectRight = ascendingBisect.right;

    function number(x) {
      return x === null ? NaN : +x;
    }

    function extent(values, valueof) {
      var n = values.length,
          i = -1,
          value,
          min,
          max;

      if (valueof == null) {
        while (++i < n) { // Find the first comparable value.
          if ((value = values[i]) != null && value >= value) {
            min = max = value;
            while (++i < n) { // Compare the remaining values.
              if ((value = values[i]) != null) {
                if (min > value) min = value;
                if (max < value) max = value;
              }
            }
          }
        }
      }

      else {
        while (++i < n) { // Find the first comparable value.
          if ((value = valueof(values[i], i, values)) != null && value >= value) {
            min = max = value;
            while (++i < n) { // Compare the remaining values.
              if ((value = valueof(values[i], i, values)) != null) {
                if (min > value) min = value;
                if (max < value) max = value;
              }
            }
          }
        }
      }

      return [min, max];
    }

    function sequence(start, stop, step) {
      start = +start, stop = +stop, step = (n = arguments.length) < 2 ? (stop = start, start = 0, 1) : n < 3 ? 1 : +step;

      var i = -1,
          n = Math.max(0, Math.ceil((stop - start) / step)) | 0,
          range = new Array(n);

      while (++i < n) {
        range[i] = start + i * step;
      }

      return range;
    }

    var e10 = Math.sqrt(50),
        e5 = Math.sqrt(10),
        e2 = Math.sqrt(2);

    function ticks(start, stop, count) {
      var reverse,
          i = -1,
          n,
          ticks,
          step;

      stop = +stop, start = +start, count = +count;
      if (start === stop && count > 0) return [start];
      if (reverse = stop < start) n = start, start = stop, stop = n;
      if ((step = tickIncrement(start, stop, count)) === 0 || !isFinite(step)) return [];

      if (step > 0) {
        start = Math.ceil(start / step);
        stop = Math.floor(stop / step);
        ticks = new Array(n = Math.ceil(stop - start + 1));
        while (++i < n) ticks[i] = (start + i) * step;
      } else {
        start = Math.floor(start * step);
        stop = Math.ceil(stop * step);
        ticks = new Array(n = Math.ceil(start - stop + 1));
        while (++i < n) ticks[i] = (start - i) / step;
      }

      if (reverse) ticks.reverse();

      return ticks;
    }

    function tickIncrement(start, stop, count) {
      var step = (stop - start) / Math.max(0, count),
          power = Math.floor(Math.log(step) / Math.LN10),
          error = step / Math.pow(10, power);
      return power >= 0
          ? (error >= e10 ? 10 : error >= e5 ? 5 : error >= e2 ? 2 : 1) * Math.pow(10, power)
          : -Math.pow(10, -power) / (error >= e10 ? 10 : error >= e5 ? 5 : error >= e2 ? 2 : 1);
    }

    function tickStep(start, stop, count) {
      var step0 = Math.abs(stop - start) / Math.max(0, count),
          step1 = Math.pow(10, Math.floor(Math.log(step0) / Math.LN10)),
          error = step0 / step1;
      if (error >= e10) step1 *= 10;
      else if (error >= e5) step1 *= 5;
      else if (error >= e2) step1 *= 2;
      return stop < start ? -step1 : step1;
    }

    function mean(values, valueof) {
      var n = values.length,
          m = n,
          i = -1,
          value,
          sum = 0;

      if (valueof == null) {
        while (++i < n) {
          if (!isNaN(value = number(values[i]))) sum += value;
          else --m;
        }
      }

      else {
        while (++i < n) {
          if (!isNaN(value = number(valueof(values[i], i, values)))) sum += value;
          else --m;
        }
      }

      if (m) return sum / m;
    }

    var noop$1 = {value: function() {}};

    function dispatch() {
      for (var i = 0, n = arguments.length, _ = {}, t; i < n; ++i) {
        if (!(t = arguments[i] + "") || (t in _) || /[\s.]/.test(t)) throw new Error("illegal type: " + t);
        _[t] = [];
      }
      return new Dispatch(_);
    }

    function Dispatch(_) {
      this._ = _;
    }

    function parseTypenames(typenames, types) {
      return typenames.trim().split(/^|\s+/).map(function(t) {
        var name = "", i = t.indexOf(".");
        if (i >= 0) name = t.slice(i + 1), t = t.slice(0, i);
        if (t && !types.hasOwnProperty(t)) throw new Error("unknown type: " + t);
        return {type: t, name: name};
      });
    }

    Dispatch.prototype = dispatch.prototype = {
      constructor: Dispatch,
      on: function(typename, callback) {
        var _ = this._,
            T = parseTypenames(typename + "", _),
            t,
            i = -1,
            n = T.length;

        // If no callback was specified, return the callback of the given type and name.
        if (arguments.length < 2) {
          while (++i < n) if ((t = (typename = T[i]).type) && (t = get(_[t], typename.name))) return t;
          return;
        }

        // If a type was specified, set the callback for the given type and name.
        // Otherwise, if a null callback was specified, remove callbacks of the given name.
        if (callback != null && typeof callback !== "function") throw new Error("invalid callback: " + callback);
        while (++i < n) {
          if (t = (typename = T[i]).type) _[t] = set(_[t], typename.name, callback);
          else if (callback == null) for (t in _) _[t] = set(_[t], typename.name, null);
        }

        return this;
      },
      copy: function() {
        var copy = {}, _ = this._;
        for (var t in _) copy[t] = _[t].slice();
        return new Dispatch(copy);
      },
      call: function(type, that) {
        if ((n = arguments.length - 2) > 0) for (var args = new Array(n), i = 0, n, t; i < n; ++i) args[i] = arguments[i + 2];
        if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
        for (t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
      },
      apply: function(type, that, args) {
        if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
        for (var t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
      }
    };

    function get(type, name) {
      for (var i = 0, n = type.length, c; i < n; ++i) {
        if ((c = type[i]).name === name) {
          return c.value;
        }
      }
    }

    function set(type, name, callback) {
      for (var i = 0, n = type.length; i < n; ++i) {
        if (type[i].name === name) {
          type[i] = noop$1, type = type.slice(0, i).concat(type.slice(i + 1));
          break;
        }
      }
      if (callback != null) type.push({name: name, value: callback});
      return type;
    }

    function define(constructor, factory, prototype) {
      constructor.prototype = factory.prototype = prototype;
      prototype.constructor = constructor;
    }

    function extend(parent, definition) {
      var prototype = Object.create(parent.prototype);
      for (var key in definition) prototype[key] = definition[key];
      return prototype;
    }

    function Color() {}

    var darker = 0.7;
    var brighter = 1 / darker;

    var reI = "\\s*([+-]?\\d+)\\s*",
        reN = "\\s*([+-]?\\d*\\.?\\d+(?:[eE][+-]?\\d+)?)\\s*",
        reP = "\\s*([+-]?\\d*\\.?\\d+(?:[eE][+-]?\\d+)?)%\\s*",
        reHex = /^#([0-9a-f]{3,8})$/,
        reRgbInteger = new RegExp("^rgb\\(" + [reI, reI, reI] + "\\)$"),
        reRgbPercent = new RegExp("^rgb\\(" + [reP, reP, reP] + "\\)$"),
        reRgbaInteger = new RegExp("^rgba\\(" + [reI, reI, reI, reN] + "\\)$"),
        reRgbaPercent = new RegExp("^rgba\\(" + [reP, reP, reP, reN] + "\\)$"),
        reHslPercent = new RegExp("^hsl\\(" + [reN, reP, reP] + "\\)$"),
        reHslaPercent = new RegExp("^hsla\\(" + [reN, reP, reP, reN] + "\\)$");

    var named = {
      aliceblue: 0xf0f8ff,
      antiquewhite: 0xfaebd7,
      aqua: 0x00ffff,
      aquamarine: 0x7fffd4,
      azure: 0xf0ffff,
      beige: 0xf5f5dc,
      bisque: 0xffe4c4,
      black: 0x000000,
      blanchedalmond: 0xffebcd,
      blue: 0x0000ff,
      blueviolet: 0x8a2be2,
      brown: 0xa52a2a,
      burlywood: 0xdeb887,
      cadetblue: 0x5f9ea0,
      chartreuse: 0x7fff00,
      chocolate: 0xd2691e,
      coral: 0xff7f50,
      cornflowerblue: 0x6495ed,
      cornsilk: 0xfff8dc,
      crimson: 0xdc143c,
      cyan: 0x00ffff,
      darkblue: 0x00008b,
      darkcyan: 0x008b8b,
      darkgoldenrod: 0xb8860b,
      darkgray: 0xa9a9a9,
      darkgreen: 0x006400,
      darkgrey: 0xa9a9a9,
      darkkhaki: 0xbdb76b,
      darkmagenta: 0x8b008b,
      darkolivegreen: 0x556b2f,
      darkorange: 0xff8c00,
      darkorchid: 0x9932cc,
      darkred: 0x8b0000,
      darksalmon: 0xe9967a,
      darkseagreen: 0x8fbc8f,
      darkslateblue: 0x483d8b,
      darkslategray: 0x2f4f4f,
      darkslategrey: 0x2f4f4f,
      darkturquoise: 0x00ced1,
      darkviolet: 0x9400d3,
      deeppink: 0xff1493,
      deepskyblue: 0x00bfff,
      dimgray: 0x696969,
      dimgrey: 0x696969,
      dodgerblue: 0x1e90ff,
      firebrick: 0xb22222,
      floralwhite: 0xfffaf0,
      forestgreen: 0x228b22,
      fuchsia: 0xff00ff,
      gainsboro: 0xdcdcdc,
      ghostwhite: 0xf8f8ff,
      gold: 0xffd700,
      goldenrod: 0xdaa520,
      gray: 0x808080,
      green: 0x008000,
      greenyellow: 0xadff2f,
      grey: 0x808080,
      honeydew: 0xf0fff0,
      hotpink: 0xff69b4,
      indianred: 0xcd5c5c,
      indigo: 0x4b0082,
      ivory: 0xfffff0,
      khaki: 0xf0e68c,
      lavender: 0xe6e6fa,
      lavenderblush: 0xfff0f5,
      lawngreen: 0x7cfc00,
      lemonchiffon: 0xfffacd,
      lightblue: 0xadd8e6,
      lightcoral: 0xf08080,
      lightcyan: 0xe0ffff,
      lightgoldenrodyellow: 0xfafad2,
      lightgray: 0xd3d3d3,
      lightgreen: 0x90ee90,
      lightgrey: 0xd3d3d3,
      lightpink: 0xffb6c1,
      lightsalmon: 0xffa07a,
      lightseagreen: 0x20b2aa,
      lightskyblue: 0x87cefa,
      lightslategray: 0x778899,
      lightslategrey: 0x778899,
      lightsteelblue: 0xb0c4de,
      lightyellow: 0xffffe0,
      lime: 0x00ff00,
      limegreen: 0x32cd32,
      linen: 0xfaf0e6,
      magenta: 0xff00ff,
      maroon: 0x800000,
      mediumaquamarine: 0x66cdaa,
      mediumblue: 0x0000cd,
      mediumorchid: 0xba55d3,
      mediumpurple: 0x9370db,
      mediumseagreen: 0x3cb371,
      mediumslateblue: 0x7b68ee,
      mediumspringgreen: 0x00fa9a,
      mediumturquoise: 0x48d1cc,
      mediumvioletred: 0xc71585,
      midnightblue: 0x191970,
      mintcream: 0xf5fffa,
      mistyrose: 0xffe4e1,
      moccasin: 0xffe4b5,
      navajowhite: 0xffdead,
      navy: 0x000080,
      oldlace: 0xfdf5e6,
      olive: 0x808000,
      olivedrab: 0x6b8e23,
      orange: 0xffa500,
      orangered: 0xff4500,
      orchid: 0xda70d6,
      palegoldenrod: 0xeee8aa,
      palegreen: 0x98fb98,
      paleturquoise: 0xafeeee,
      palevioletred: 0xdb7093,
      papayawhip: 0xffefd5,
      peachpuff: 0xffdab9,
      peru: 0xcd853f,
      pink: 0xffc0cb,
      plum: 0xdda0dd,
      powderblue: 0xb0e0e6,
      purple: 0x800080,
      rebeccapurple: 0x663399,
      red: 0xff0000,
      rosybrown: 0xbc8f8f,
      royalblue: 0x4169e1,
      saddlebrown: 0x8b4513,
      salmon: 0xfa8072,
      sandybrown: 0xf4a460,
      seagreen: 0x2e8b57,
      seashell: 0xfff5ee,
      sienna: 0xa0522d,
      silver: 0xc0c0c0,
      skyblue: 0x87ceeb,
      slateblue: 0x6a5acd,
      slategray: 0x708090,
      slategrey: 0x708090,
      snow: 0xfffafa,
      springgreen: 0x00ff7f,
      steelblue: 0x4682b4,
      tan: 0xd2b48c,
      teal: 0x008080,
      thistle: 0xd8bfd8,
      tomato: 0xff6347,
      turquoise: 0x40e0d0,
      violet: 0xee82ee,
      wheat: 0xf5deb3,
      white: 0xffffff,
      whitesmoke: 0xf5f5f5,
      yellow: 0xffff00,
      yellowgreen: 0x9acd32
    };

    define(Color, color, {
      copy: function(channels) {
        return Object.assign(new this.constructor, this, channels);
      },
      displayable: function() {
        return this.rgb().displayable();
      },
      hex: color_formatHex, // Deprecated! Use color.formatHex.
      formatHex: color_formatHex,
      formatHsl: color_formatHsl,
      formatRgb: color_formatRgb,
      toString: color_formatRgb
    });

    function color_formatHex() {
      return this.rgb().formatHex();
    }

    function color_formatHsl() {
      return hslConvert(this).formatHsl();
    }

    function color_formatRgb() {
      return this.rgb().formatRgb();
    }

    function color(format) {
      var m, l;
      format = (format + "").trim().toLowerCase();
      return (m = reHex.exec(format)) ? (l = m[1].length, m = parseInt(m[1], 16), l === 6 ? rgbn(m) // #ff0000
          : l === 3 ? new Rgb((m >> 8 & 0xf) | (m >> 4 & 0xf0), (m >> 4 & 0xf) | (m & 0xf0), ((m & 0xf) << 4) | (m & 0xf), 1) // #f00
          : l === 8 ? rgba(m >> 24 & 0xff, m >> 16 & 0xff, m >> 8 & 0xff, (m & 0xff) / 0xff) // #ff000000
          : l === 4 ? rgba((m >> 12 & 0xf) | (m >> 8 & 0xf0), (m >> 8 & 0xf) | (m >> 4 & 0xf0), (m >> 4 & 0xf) | (m & 0xf0), (((m & 0xf) << 4) | (m & 0xf)) / 0xff) // #f000
          : null) // invalid hex
          : (m = reRgbInteger.exec(format)) ? new Rgb(m[1], m[2], m[3], 1) // rgb(255, 0, 0)
          : (m = reRgbPercent.exec(format)) ? new Rgb(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, 1) // rgb(100%, 0%, 0%)
          : (m = reRgbaInteger.exec(format)) ? rgba(m[1], m[2], m[3], m[4]) // rgba(255, 0, 0, 1)
          : (m = reRgbaPercent.exec(format)) ? rgba(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, m[4]) // rgb(100%, 0%, 0%, 1)
          : (m = reHslPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, 1) // hsl(120, 50%, 50%)
          : (m = reHslaPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, m[4]) // hsla(120, 50%, 50%, 1)
          : named.hasOwnProperty(format) ? rgbn(named[format]) // eslint-disable-line no-prototype-builtins
          : format === "transparent" ? new Rgb(NaN, NaN, NaN, 0)
          : null;
    }

    function rgbn(n) {
      return new Rgb(n >> 16 & 0xff, n >> 8 & 0xff, n & 0xff, 1);
    }

    function rgba(r, g, b, a) {
      if (a <= 0) r = g = b = NaN;
      return new Rgb(r, g, b, a);
    }

    function rgbConvert(o) {
      if (!(o instanceof Color)) o = color(o);
      if (!o) return new Rgb;
      o = o.rgb();
      return new Rgb(o.r, o.g, o.b, o.opacity);
    }

    function rgb(r, g, b, opacity) {
      return arguments.length === 1 ? rgbConvert(r) : new Rgb(r, g, b, opacity == null ? 1 : opacity);
    }

    function Rgb(r, g, b, opacity) {
      this.r = +r;
      this.g = +g;
      this.b = +b;
      this.opacity = +opacity;
    }

    define(Rgb, rgb, extend(Color, {
      brighter: function(k) {
        k = k == null ? brighter : Math.pow(brighter, k);
        return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
      },
      darker: function(k) {
        k = k == null ? darker : Math.pow(darker, k);
        return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
      },
      rgb: function() {
        return this;
      },
      displayable: function() {
        return (-0.5 <= this.r && this.r < 255.5)
            && (-0.5 <= this.g && this.g < 255.5)
            && (-0.5 <= this.b && this.b < 255.5)
            && (0 <= this.opacity && this.opacity <= 1);
      },
      hex: rgb_formatHex, // Deprecated! Use color.formatHex.
      formatHex: rgb_formatHex,
      formatRgb: rgb_formatRgb,
      toString: rgb_formatRgb
    }));

    function rgb_formatHex() {
      return "#" + hex(this.r) + hex(this.g) + hex(this.b);
    }

    function rgb_formatRgb() {
      var a = this.opacity; a = isNaN(a) ? 1 : Math.max(0, Math.min(1, a));
      return (a === 1 ? "rgb(" : "rgba(")
          + Math.max(0, Math.min(255, Math.round(this.r) || 0)) + ", "
          + Math.max(0, Math.min(255, Math.round(this.g) || 0)) + ", "
          + Math.max(0, Math.min(255, Math.round(this.b) || 0))
          + (a === 1 ? ")" : ", " + a + ")");
    }

    function hex(value) {
      value = Math.max(0, Math.min(255, Math.round(value) || 0));
      return (value < 16 ? "0" : "") + value.toString(16);
    }

    function hsla(h, s, l, a) {
      if (a <= 0) h = s = l = NaN;
      else if (l <= 0 || l >= 1) h = s = NaN;
      else if (s <= 0) h = NaN;
      return new Hsl(h, s, l, a);
    }

    function hslConvert(o) {
      if (o instanceof Hsl) return new Hsl(o.h, o.s, o.l, o.opacity);
      if (!(o instanceof Color)) o = color(o);
      if (!o) return new Hsl;
      if (o instanceof Hsl) return o;
      o = o.rgb();
      var r = o.r / 255,
          g = o.g / 255,
          b = o.b / 255,
          min = Math.min(r, g, b),
          max = Math.max(r, g, b),
          h = NaN,
          s = max - min,
          l = (max + min) / 2;
      if (s) {
        if (r === max) h = (g - b) / s + (g < b) * 6;
        else if (g === max) h = (b - r) / s + 2;
        else h = (r - g) / s + 4;
        s /= l < 0.5 ? max + min : 2 - max - min;
        h *= 60;
      } else {
        s = l > 0 && l < 1 ? 0 : h;
      }
      return new Hsl(h, s, l, o.opacity);
    }

    function hsl(h, s, l, opacity) {
      return arguments.length === 1 ? hslConvert(h) : new Hsl(h, s, l, opacity == null ? 1 : opacity);
    }

    function Hsl(h, s, l, opacity) {
      this.h = +h;
      this.s = +s;
      this.l = +l;
      this.opacity = +opacity;
    }

    define(Hsl, hsl, extend(Color, {
      brighter: function(k) {
        k = k == null ? brighter : Math.pow(brighter, k);
        return new Hsl(this.h, this.s, this.l * k, this.opacity);
      },
      darker: function(k) {
        k = k == null ? darker : Math.pow(darker, k);
        return new Hsl(this.h, this.s, this.l * k, this.opacity);
      },
      rgb: function() {
        var h = this.h % 360 + (this.h < 0) * 360,
            s = isNaN(h) || isNaN(this.s) ? 0 : this.s,
            l = this.l,
            m2 = l + (l < 0.5 ? l : 1 - l) * s,
            m1 = 2 * l - m2;
        return new Rgb(
          hsl2rgb(h >= 240 ? h - 240 : h + 120, m1, m2),
          hsl2rgb(h, m1, m2),
          hsl2rgb(h < 120 ? h + 240 : h - 120, m1, m2),
          this.opacity
        );
      },
      displayable: function() {
        return (0 <= this.s && this.s <= 1 || isNaN(this.s))
            && (0 <= this.l && this.l <= 1)
            && (0 <= this.opacity && this.opacity <= 1);
      },
      formatHsl: function() {
        var a = this.opacity; a = isNaN(a) ? 1 : Math.max(0, Math.min(1, a));
        return (a === 1 ? "hsl(" : "hsla(")
            + (this.h || 0) + ", "
            + (this.s || 0) * 100 + "%, "
            + (this.l || 0) * 100 + "%"
            + (a === 1 ? ")" : ", " + a + ")");
      }
    }));

    /* From FvD 13.37, CSS Color Module Level 3 */
    function hsl2rgb(h, m1, m2) {
      return (h < 60 ? m1 + (m2 - m1) * h / 60
          : h < 180 ? m2
          : h < 240 ? m1 + (m2 - m1) * (240 - h) / 60
          : m1) * 255;
    }

    function basis(t1, v0, v1, v2, v3) {
      var t2 = t1 * t1, t3 = t2 * t1;
      return ((1 - 3 * t1 + 3 * t2 - t3) * v0
          + (4 - 6 * t2 + 3 * t3) * v1
          + (1 + 3 * t1 + 3 * t2 - 3 * t3) * v2
          + t3 * v3) / 6;
    }

    function basis$1(values) {
      var n = values.length - 1;
      return function(t) {
        var i = t <= 0 ? (t = 0) : t >= 1 ? (t = 1, n - 1) : Math.floor(t * n),
            v1 = values[i],
            v2 = values[i + 1],
            v0 = i > 0 ? values[i - 1] : 2 * v1 - v2,
            v3 = i < n - 1 ? values[i + 2] : 2 * v2 - v1;
        return basis((t - i / n) * n, v0, v1, v2, v3);
      };
    }

    function constant(x) {
      return function() {
        return x;
      };
    }

    function linear(a, d) {
      return function(t) {
        return a + t * d;
      };
    }

    function exponential(a, b, y) {
      return a = Math.pow(a, y), b = Math.pow(b, y) - a, y = 1 / y, function(t) {
        return Math.pow(a + t * b, y);
      };
    }

    function gamma(y) {
      return (y = +y) === 1 ? nogamma : function(a, b) {
        return b - a ? exponential(a, b, y) : constant(isNaN(a) ? b : a);
      };
    }

    function nogamma(a, b) {
      var d = b - a;
      return d ? linear(a, d) : constant(isNaN(a) ? b : a);
    }

    var interpolateRgb = (function rgbGamma(y) {
      var color = gamma(y);

      function rgb$1(start, end) {
        var r = color((start = rgb(start)).r, (end = rgb(end)).r),
            g = color(start.g, end.g),
            b = color(start.b, end.b),
            opacity = nogamma(start.opacity, end.opacity);
        return function(t) {
          start.r = r(t);
          start.g = g(t);
          start.b = b(t);
          start.opacity = opacity(t);
          return start + "";
        };
      }

      rgb$1.gamma = rgbGamma;

      return rgb$1;
    })(1);

    function rgbSpline(spline) {
      return function(colors) {
        var n = colors.length,
            r = new Array(n),
            g = new Array(n),
            b = new Array(n),
            i, color;
        for (i = 0; i < n; ++i) {
          color = rgb(colors[i]);
          r[i] = color.r || 0;
          g[i] = color.g || 0;
          b[i] = color.b || 0;
        }
        r = spline(r);
        g = spline(g);
        b = spline(b);
        color.opacity = 1;
        return function(t) {
          color.r = r(t);
          color.g = g(t);
          color.b = b(t);
          return color + "";
        };
      };
    }

    var rgbBasis = rgbSpline(basis$1);

    function numberArray(a, b) {
      if (!b) b = [];
      var n = a ? Math.min(b.length, a.length) : 0,
          c = b.slice(),
          i;
      return function(t) {
        for (i = 0; i < n; ++i) c[i] = a[i] * (1 - t) + b[i] * t;
        return c;
      };
    }

    function isNumberArray(x) {
      return ArrayBuffer.isView(x) && !(x instanceof DataView);
    }

    function genericArray(a, b) {
      var nb = b ? b.length : 0,
          na = a ? Math.min(nb, a.length) : 0,
          x = new Array(na),
          c = new Array(nb),
          i;

      for (i = 0; i < na; ++i) x[i] = interpolateValue(a[i], b[i]);
      for (; i < nb; ++i) c[i] = b[i];

      return function(t) {
        for (i = 0; i < na; ++i) c[i] = x[i](t);
        return c;
      };
    }

    function date(a, b) {
      var d = new Date;
      return a = +a, b = +b, function(t) {
        return d.setTime(a * (1 - t) + b * t), d;
      };
    }

    function interpolateNumber(a, b) {
      return a = +a, b = +b, function(t) {
        return a * (1 - t) + b * t;
      };
    }

    function object(a, b) {
      var i = {},
          c = {},
          k;

      if (a === null || typeof a !== "object") a = {};
      if (b === null || typeof b !== "object") b = {};

      for (k in b) {
        if (k in a) {
          i[k] = interpolateValue(a[k], b[k]);
        } else {
          c[k] = b[k];
        }
      }

      return function(t) {
        for (k in i) c[k] = i[k](t);
        return c;
      };
    }

    var reA = /[-+]?(?:\d+\.?\d*|\.?\d+)(?:[eE][-+]?\d+)?/g,
        reB = new RegExp(reA.source, "g");

    function zero(b) {
      return function() {
        return b;
      };
    }

    function one(b) {
      return function(t) {
        return b(t) + "";
      };
    }

    function interpolateString(a, b) {
      var bi = reA.lastIndex = reB.lastIndex = 0, // scan index for next number in b
          am, // current match in a
          bm, // current match in b
          bs, // string preceding current number in b, if any
          i = -1, // index in s
          s = [], // string constants and placeholders
          q = []; // number interpolators

      // Coerce inputs to strings.
      a = a + "", b = b + "";

      // Interpolate pairs of numbers in a & b.
      while ((am = reA.exec(a))
          && (bm = reB.exec(b))) {
        if ((bs = bm.index) > bi) { // a string precedes the next number in b
          bs = b.slice(bi, bs);
          if (s[i]) s[i] += bs; // coalesce with previous string
          else s[++i] = bs;
        }
        if ((am = am[0]) === (bm = bm[0])) { // numbers in a & b match
          if (s[i]) s[i] += bm; // coalesce with previous string
          else s[++i] = bm;
        } else { // interpolate non-matching numbers
          s[++i] = null;
          q.push({i: i, x: interpolateNumber(am, bm)});
        }
        bi = reB.lastIndex;
      }

      // Add remains of b.
      if (bi < b.length) {
        bs = b.slice(bi);
        if (s[i]) s[i] += bs; // coalesce with previous string
        else s[++i] = bs;
      }

      // Special optimization for only a single match.
      // Otherwise, interpolate each of the numbers and rejoin the string.
      return s.length < 2 ? (q[0]
          ? one(q[0].x)
          : zero(b))
          : (b = q.length, function(t) {
              for (var i = 0, o; i < b; ++i) s[(o = q[i]).i] = o.x(t);
              return s.join("");
            });
    }

    function interpolateValue(a, b) {
      var t = typeof b, c;
      return b == null || t === "boolean" ? constant(b)
          : (t === "number" ? interpolateNumber
          : t === "string" ? ((c = color(b)) ? (b = c, interpolateRgb) : interpolateString)
          : b instanceof color ? interpolateRgb
          : b instanceof Date ? date
          : isNumberArray(b) ? numberArray
          : Array.isArray(b) ? genericArray
          : typeof b.valueOf !== "function" && typeof b.toString !== "function" || isNaN(b) ? object
          : interpolateNumber)(a, b);
    }

    function interpolateRound(a, b) {
      return a = +a, b = +b, function(t) {
        return Math.round(a * (1 - t) + b * t);
      };
    }

    var emptyOn = dispatch("start", "end", "cancel", "interrupt");

    var prefix = "$";

    function Map$1() {}

    Map$1.prototype = map.prototype = {
      constructor: Map$1,
      has: function(key) {
        return (prefix + key) in this;
      },
      get: function(key) {
        return this[prefix + key];
      },
      set: function(key, value) {
        this[prefix + key] = value;
        return this;
      },
      remove: function(key) {
        var property = prefix + key;
        return property in this && delete this[property];
      },
      clear: function() {
        for (var property in this) if (property[0] === prefix) delete this[property];
      },
      keys: function() {
        var keys = [];
        for (var property in this) if (property[0] === prefix) keys.push(property.slice(1));
        return keys;
      },
      values: function() {
        var values = [];
        for (var property in this) if (property[0] === prefix) values.push(this[property]);
        return values;
      },
      entries: function() {
        var entries = [];
        for (var property in this) if (property[0] === prefix) entries.push({key: property.slice(1), value: this[property]});
        return entries;
      },
      size: function() {
        var size = 0;
        for (var property in this) if (property[0] === prefix) ++size;
        return size;
      },
      empty: function() {
        for (var property in this) if (property[0] === prefix) return false;
        return true;
      },
      each: function(f) {
        for (var property in this) if (property[0] === prefix) f(this[property], property.slice(1), this);
      }
    };

    function map(object, f) {
      var map = new Map$1;

      // Copy constructor.
      if (object instanceof Map$1) object.each(function(value, key) { map.set(key, value); });

      // Index array by numeric index or specified key function.
      else if (Array.isArray(object)) {
        var i = -1,
            n = object.length,
            o;

        if (f == null) while (++i < n) map.set(i, object[i]);
        else while (++i < n) map.set(f(o = object[i], i, object), o);
      }

      // Convert object to map.
      else if (object) for (var key in object) map.set(key, object[key]);

      return map;
    }

    function nest() {
      var keys = [],
          sortKeys = [],
          sortValues,
          rollup,
          nest;

      function apply(array, depth, createResult, setResult) {
        if (depth >= keys.length) {
          if (sortValues != null) array.sort(sortValues);
          return rollup != null ? rollup(array) : array;
        }

        var i = -1,
            n = array.length,
            key = keys[depth++],
            keyValue,
            value,
            valuesByKey = map(),
            values,
            result = createResult();

        while (++i < n) {
          if (values = valuesByKey.get(keyValue = key(value = array[i]) + "")) {
            values.push(value);
          } else {
            valuesByKey.set(keyValue, [value]);
          }
        }

        valuesByKey.each(function(values, key) {
          setResult(result, key, apply(values, depth, createResult, setResult));
        });

        return result;
      }

      function entries(map, depth) {
        if (++depth > keys.length) return map;
        var array, sortKey = sortKeys[depth - 1];
        if (rollup != null && depth >= keys.length) array = map.entries();
        else array = [], map.each(function(v, k) { array.push({key: k, values: entries(v, depth)}); });
        return sortKey != null ? array.sort(function(a, b) { return sortKey(a.key, b.key); }) : array;
      }

      return nest = {
        object: function(array) { return apply(array, 0, createObject, setObject); },
        map: function(array) { return apply(array, 0, createMap, setMap); },
        entries: function(array) { return entries(apply(array, 0, createMap, setMap), 0); },
        key: function(d) { keys.push(d); return nest; },
        sortKeys: function(order) { sortKeys[keys.length - 1] = order; return nest; },
        sortValues: function(order) { sortValues = order; return nest; },
        rollup: function(f) { rollup = f; return nest; }
      };
    }

    function createObject() {
      return {};
    }

    function setObject(object, key, value) {
      object[key] = value;
    }

    function createMap() {
      return map();
    }

    function setMap(map, key, value) {
      map.set(key, value);
    }

    function Set$1() {}

    var proto = map.prototype;

    Set$1.prototype = set$1.prototype = {
      constructor: Set$1,
      has: proto.has,
      add: function(value) {
        value += "";
        this[prefix + value] = value;
        return this;
      },
      remove: proto.remove,
      clear: proto.clear,
      values: proto.keys,
      size: proto.size,
      empty: proto.empty,
      each: proto.each
    };

    function set$1(object, f) {
      var set = new Set$1;

      // Copy constructor.
      if (object instanceof Set$1) object.each(function(value) { set.add(value); });

      // Otherwise, assume it’s an array.
      else if (object) {
        var i = -1, n = object.length;
        if (f == null) while (++i < n) set.add(object[i]);
        else while (++i < n) set.add(f(object[i], i, object));
      }

      return set;
    }

    function responseJson(response) {
      if (!response.ok) throw new Error(response.status + " " + response.statusText);
      if (response.status === 204 || response.status === 205) return;
      return response.json();
    }

    function json(input, init) {
      return fetch(input, init).then(responseJson);
    }

    // Computes the decimal coefficient and exponent of the specified number x with
    // significant digits p, where x is positive and p is in [1, 21] or undefined.
    // For example, formatDecimal(1.23) returns ["123", 0].
    function formatDecimal(x, p) {
      if ((i = (x = p ? x.toExponential(p - 1) : x.toExponential()).indexOf("e")) < 0) return null; // NaN, ±Infinity
      var i, coefficient = x.slice(0, i);

      // The string returned by toExponential either has the form \d\.\d+e[-+]\d+
      // (e.g., 1.2e+3) or the form \de[-+]\d+ (e.g., 1e+3).
      return [
        coefficient.length > 1 ? coefficient[0] + coefficient.slice(2) : coefficient,
        +x.slice(i + 1)
      ];
    }

    function exponent(x) {
      return x = formatDecimal(Math.abs(x)), x ? x[1] : NaN;
    }

    function formatGroup(grouping, thousands) {
      return function(value, width) {
        var i = value.length,
            t = [],
            j = 0,
            g = grouping[0],
            length = 0;

        while (i > 0 && g > 0) {
          if (length + g + 1 > width) g = Math.max(1, width - length);
          t.push(value.substring(i -= g, i + g));
          if ((length += g + 1) > width) break;
          g = grouping[j = (j + 1) % grouping.length];
        }

        return t.reverse().join(thousands);
      };
    }

    function formatNumerals(numerals) {
      return function(value) {
        return value.replace(/[0-9]/g, function(i) {
          return numerals[+i];
        });
      };
    }

    // [[fill]align][sign][symbol][0][width][,][.precision][~][type]
    var re = /^(?:(.)?([<>=^]))?([+\-( ])?([$#])?(0)?(\d+)?(,)?(\.\d+)?(~)?([a-z%])?$/i;

    function formatSpecifier(specifier) {
      if (!(match = re.exec(specifier))) throw new Error("invalid format: " + specifier);
      var match;
      return new FormatSpecifier({
        fill: match[1],
        align: match[2],
        sign: match[3],
        symbol: match[4],
        zero: match[5],
        width: match[6],
        comma: match[7],
        precision: match[8] && match[8].slice(1),
        trim: match[9],
        type: match[10]
      });
    }

    formatSpecifier.prototype = FormatSpecifier.prototype; // instanceof

    function FormatSpecifier(specifier) {
      this.fill = specifier.fill === undefined ? " " : specifier.fill + "";
      this.align = specifier.align === undefined ? ">" : specifier.align + "";
      this.sign = specifier.sign === undefined ? "-" : specifier.sign + "";
      this.symbol = specifier.symbol === undefined ? "" : specifier.symbol + "";
      this.zero = !!specifier.zero;
      this.width = specifier.width === undefined ? undefined : +specifier.width;
      this.comma = !!specifier.comma;
      this.precision = specifier.precision === undefined ? undefined : +specifier.precision;
      this.trim = !!specifier.trim;
      this.type = specifier.type === undefined ? "" : specifier.type + "";
    }

    FormatSpecifier.prototype.toString = function() {
      return this.fill
          + this.align
          + this.sign
          + this.symbol
          + (this.zero ? "0" : "")
          + (this.width === undefined ? "" : Math.max(1, this.width | 0))
          + (this.comma ? "," : "")
          + (this.precision === undefined ? "" : "." + Math.max(0, this.precision | 0))
          + (this.trim ? "~" : "")
          + this.type;
    };

    // Trims insignificant zeros, e.g., replaces 1.2000k with 1.2k.
    function formatTrim(s) {
      out: for (var n = s.length, i = 1, i0 = -1, i1; i < n; ++i) {
        switch (s[i]) {
          case ".": i0 = i1 = i; break;
          case "0": if (i0 === 0) i0 = i; i1 = i; break;
          default: if (!+s[i]) break out; if (i0 > 0) i0 = 0; break;
        }
      }
      return i0 > 0 ? s.slice(0, i0) + s.slice(i1 + 1) : s;
    }

    var prefixExponent;

    function formatPrefixAuto(x, p) {
      var d = formatDecimal(x, p);
      if (!d) return x + "";
      var coefficient = d[0],
          exponent = d[1],
          i = exponent - (prefixExponent = Math.max(-8, Math.min(8, Math.floor(exponent / 3))) * 3) + 1,
          n = coefficient.length;
      return i === n ? coefficient
          : i > n ? coefficient + new Array(i - n + 1).join("0")
          : i > 0 ? coefficient.slice(0, i) + "." + coefficient.slice(i)
          : "0." + new Array(1 - i).join("0") + formatDecimal(x, Math.max(0, p + i - 1))[0]; // less than 1y!
    }

    function formatRounded(x, p) {
      var d = formatDecimal(x, p);
      if (!d) return x + "";
      var coefficient = d[0],
          exponent = d[1];
      return exponent < 0 ? "0." + new Array(-exponent).join("0") + coefficient
          : coefficient.length > exponent + 1 ? coefficient.slice(0, exponent + 1) + "." + coefficient.slice(exponent + 1)
          : coefficient + new Array(exponent - coefficient.length + 2).join("0");
    }

    var formatTypes = {
      "%": function(x, p) { return (x * 100).toFixed(p); },
      "b": function(x) { return Math.round(x).toString(2); },
      "c": function(x) { return x + ""; },
      "d": function(x) { return Math.round(x).toString(10); },
      "e": function(x, p) { return x.toExponential(p); },
      "f": function(x, p) { return x.toFixed(p); },
      "g": function(x, p) { return x.toPrecision(p); },
      "o": function(x) { return Math.round(x).toString(8); },
      "p": function(x, p) { return formatRounded(x * 100, p); },
      "r": formatRounded,
      "s": formatPrefixAuto,
      "X": function(x) { return Math.round(x).toString(16).toUpperCase(); },
      "x": function(x) { return Math.round(x).toString(16); }
    };

    function identity(x) {
      return x;
    }

    var map$1 = Array.prototype.map,
        prefixes = ["y","z","a","f","p","n","µ","m","","k","M","G","T","P","E","Z","Y"];

    function formatLocale(locale) {
      var group = locale.grouping === undefined || locale.thousands === undefined ? identity : formatGroup(map$1.call(locale.grouping, Number), locale.thousands + ""),
          currencyPrefix = locale.currency === undefined ? "" : locale.currency[0] + "",
          currencySuffix = locale.currency === undefined ? "" : locale.currency[1] + "",
          decimal = locale.decimal === undefined ? "." : locale.decimal + "",
          numerals = locale.numerals === undefined ? identity : formatNumerals(map$1.call(locale.numerals, String)),
          percent = locale.percent === undefined ? "%" : locale.percent + "",
          minus = locale.minus === undefined ? "-" : locale.minus + "",
          nan = locale.nan === undefined ? "NaN" : locale.nan + "";

      function newFormat(specifier) {
        specifier = formatSpecifier(specifier);

        var fill = specifier.fill,
            align = specifier.align,
            sign = specifier.sign,
            symbol = specifier.symbol,
            zero = specifier.zero,
            width = specifier.width,
            comma = specifier.comma,
            precision = specifier.precision,
            trim = specifier.trim,
            type = specifier.type;

        // The "n" type is an alias for ",g".
        if (type === "n") comma = true, type = "g";

        // The "" type, and any invalid type, is an alias for ".12~g".
        else if (!formatTypes[type]) precision === undefined && (precision = 12), trim = true, type = "g";

        // If zero fill is specified, padding goes after sign and before digits.
        if (zero || (fill === "0" && align === "=")) zero = true, fill = "0", align = "=";

        // Compute the prefix and suffix.
        // For SI-prefix, the suffix is lazily computed.
        var prefix = symbol === "$" ? currencyPrefix : symbol === "#" && /[boxX]/.test(type) ? "0" + type.toLowerCase() : "",
            suffix = symbol === "$" ? currencySuffix : /[%p]/.test(type) ? percent : "";

        // What format function should we use?
        // Is this an integer type?
        // Can this type generate exponential notation?
        var formatType = formatTypes[type],
            maybeSuffix = /[defgprs%]/.test(type);

        // Set the default precision if not specified,
        // or clamp the specified precision to the supported range.
        // For significant precision, it must be in [1, 21].
        // For fixed precision, it must be in [0, 20].
        precision = precision === undefined ? 6
            : /[gprs]/.test(type) ? Math.max(1, Math.min(21, precision))
            : Math.max(0, Math.min(20, precision));

        function format(value) {
          var valuePrefix = prefix,
              valueSuffix = suffix,
              i, n, c;

          if (type === "c") {
            valueSuffix = formatType(value) + valueSuffix;
            value = "";
          } else {
            value = +value;

            // Determine the sign. -0 is not less than 0, but 1 / -0 is!
            var valueNegative = value < 0 || 1 / value < 0;

            // Perform the initial formatting.
            value = isNaN(value) ? nan : formatType(Math.abs(value), precision);

            // Trim insignificant zeros.
            if (trim) value = formatTrim(value);

            // If a negative value rounds to zero after formatting, and no explicit positive sign is requested, hide the sign.
            if (valueNegative && +value === 0 && sign !== "+") valueNegative = false;

            // Compute the prefix and suffix.
            valuePrefix = (valueNegative ? (sign === "(" ? sign : minus) : sign === "-" || sign === "(" ? "" : sign) + valuePrefix;
            valueSuffix = (type === "s" ? prefixes[8 + prefixExponent / 3] : "") + valueSuffix + (valueNegative && sign === "(" ? ")" : "");

            // Break the formatted value into the integer “value” part that can be
            // grouped, and fractional or exponential “suffix” part that is not.
            if (maybeSuffix) {
              i = -1, n = value.length;
              while (++i < n) {
                if (c = value.charCodeAt(i), 48 > c || c > 57) {
                  valueSuffix = (c === 46 ? decimal + value.slice(i + 1) : value.slice(i)) + valueSuffix;
                  value = value.slice(0, i);
                  break;
                }
              }
            }
          }

          // If the fill character is not "0", grouping is applied before padding.
          if (comma && !zero) value = group(value, Infinity);

          // Compute the padding.
          var length = valuePrefix.length + value.length + valueSuffix.length,
              padding = length < width ? new Array(width - length + 1).join(fill) : "";

          // If the fill character is "0", grouping is applied after padding.
          if (comma && zero) value = group(padding + value, padding.length ? width - valueSuffix.length : Infinity), padding = "";

          // Reconstruct the final output based on the desired alignment.
          switch (align) {
            case "<": value = valuePrefix + value + valueSuffix + padding; break;
            case "=": value = valuePrefix + padding + value + valueSuffix; break;
            case "^": value = padding.slice(0, length = padding.length >> 1) + valuePrefix + value + valueSuffix + padding.slice(length); break;
            default: value = padding + valuePrefix + value + valueSuffix; break;
          }

          return numerals(value);
        }

        format.toString = function() {
          return specifier + "";
        };

        return format;
      }

      function formatPrefix(specifier, value) {
        var f = newFormat((specifier = formatSpecifier(specifier), specifier.type = "f", specifier)),
            e = Math.max(-8, Math.min(8, Math.floor(exponent(value) / 3))) * 3,
            k = Math.pow(10, -e),
            prefix = prefixes[8 + e / 3];
        return function(value) {
          return f(k * value) + prefix;
        };
      }

      return {
        format: newFormat,
        formatPrefix: formatPrefix
      };
    }

    var locale;
    var format;
    var formatPrefix;

    defaultLocale({
      decimal: ".",
      thousands: ",",
      grouping: [3],
      currency: ["$", ""],
      minus: "-"
    });

    function defaultLocale(definition) {
      locale = formatLocale(definition);
      format = locale.format;
      formatPrefix = locale.formatPrefix;
      return locale;
    }

    function precisionFixed(step) {
      return Math.max(0, -exponent(Math.abs(step)));
    }

    function precisionPrefix(step, value) {
      return Math.max(0, Math.max(-8, Math.min(8, Math.floor(exponent(value) / 3))) * 3 - exponent(Math.abs(step)));
    }

    function precisionRound(step, max) {
      step = Math.abs(step), max = Math.abs(max) - step;
      return Math.max(0, exponent(max) - exponent(step)) + 1;
    }

    function initRange(domain, range) {
      switch (arguments.length) {
        case 0: break;
        case 1: this.range(domain); break;
        default: this.range(range).domain(domain); break;
      }
      return this;
    }

    function initInterpolator(domain, interpolator) {
      switch (arguments.length) {
        case 0: break;
        case 1: this.interpolator(domain); break;
        default: this.interpolator(interpolator).domain(domain); break;
      }
      return this;
    }

    var array = Array.prototype;

    var map$2 = array.map;
    var slice = array.slice;

    function constant$1(x) {
      return function() {
        return x;
      };
    }

    function number$1(x) {
      return +x;
    }

    var unit = [0, 1];

    function identity$1(x) {
      return x;
    }

    function normalize(a, b) {
      return (b -= (a = +a))
          ? function(x) { return (x - a) / b; }
          : constant$1(isNaN(b) ? NaN : 0.5);
    }

    function clamper(domain) {
      var a = domain[0], b = domain[domain.length - 1], t;
      if (a > b) t = a, a = b, b = t;
      return function(x) { return Math.max(a, Math.min(b, x)); };
    }

    // normalize(a, b)(x) takes a domain value x in [a,b] and returns the corresponding parameter t in [0,1].
    // interpolate(a, b)(t) takes a parameter t in [0,1] and returns the corresponding range value x in [a,b].
    function bimap(domain, range, interpolate) {
      var d0 = domain[0], d1 = domain[1], r0 = range[0], r1 = range[1];
      if (d1 < d0) d0 = normalize(d1, d0), r0 = interpolate(r1, r0);
      else d0 = normalize(d0, d1), r0 = interpolate(r0, r1);
      return function(x) { return r0(d0(x)); };
    }

    function polymap(domain, range, interpolate) {
      var j = Math.min(domain.length, range.length) - 1,
          d = new Array(j),
          r = new Array(j),
          i = -1;

      // Reverse descending domains.
      if (domain[j] < domain[0]) {
        domain = domain.slice().reverse();
        range = range.slice().reverse();
      }

      while (++i < j) {
        d[i] = normalize(domain[i], domain[i + 1]);
        r[i] = interpolate(range[i], range[i + 1]);
      }

      return function(x) {
        var i = bisectRight(domain, x, 1, j) - 1;
        return r[i](d[i](x));
      };
    }

    function copy(source, target) {
      return target
          .domain(source.domain())
          .range(source.range())
          .interpolate(source.interpolate())
          .clamp(source.clamp())
          .unknown(source.unknown());
    }

    function transformer() {
      var domain = unit,
          range = unit,
          interpolate = interpolateValue,
          transform,
          untransform,
          unknown,
          clamp = identity$1,
          piecewise,
          output,
          input;

      function rescale() {
        piecewise = Math.min(domain.length, range.length) > 2 ? polymap : bimap;
        output = input = null;
        return scale;
      }

      function scale(x) {
        return isNaN(x = +x) ? unknown : (output || (output = piecewise(domain.map(transform), range, interpolate)))(transform(clamp(x)));
      }

      scale.invert = function(y) {
        return clamp(untransform((input || (input = piecewise(range, domain.map(transform), interpolateNumber)))(y)));
      };

      scale.domain = function(_) {
        return arguments.length ? (domain = map$2.call(_, number$1), clamp === identity$1 || (clamp = clamper(domain)), rescale()) : domain.slice();
      };

      scale.range = function(_) {
        return arguments.length ? (range = slice.call(_), rescale()) : range.slice();
      };

      scale.rangeRound = function(_) {
        return range = slice.call(_), interpolate = interpolateRound, rescale();
      };

      scale.clamp = function(_) {
        return arguments.length ? (clamp = _ ? clamper(domain) : identity$1, scale) : clamp !== identity$1;
      };

      scale.interpolate = function(_) {
        return arguments.length ? (interpolate = _, rescale()) : interpolate;
      };

      scale.unknown = function(_) {
        return arguments.length ? (unknown = _, scale) : unknown;
      };

      return function(t, u) {
        transform = t, untransform = u;
        return rescale();
      };
    }

    function continuous(transform, untransform) {
      return transformer()(transform, untransform);
    }

    function tickFormat(start, stop, count, specifier) {
      var step = tickStep(start, stop, count),
          precision;
      specifier = formatSpecifier(specifier == null ? ",f" : specifier);
      switch (specifier.type) {
        case "s": {
          var value = Math.max(Math.abs(start), Math.abs(stop));
          if (specifier.precision == null && !isNaN(precision = precisionPrefix(step, value))) specifier.precision = precision;
          return formatPrefix(specifier, value);
        }
        case "":
        case "e":
        case "g":
        case "p":
        case "r": {
          if (specifier.precision == null && !isNaN(precision = precisionRound(step, Math.max(Math.abs(start), Math.abs(stop))))) specifier.precision = precision - (specifier.type === "e");
          break;
        }
        case "f":
        case "%": {
          if (specifier.precision == null && !isNaN(precision = precisionFixed(step))) specifier.precision = precision - (specifier.type === "%") * 2;
          break;
        }
      }
      return format(specifier);
    }

    function linearish(scale) {
      var domain = scale.domain;

      scale.ticks = function(count) {
        var d = domain();
        return ticks(d[0], d[d.length - 1], count == null ? 10 : count);
      };

      scale.tickFormat = function(count, specifier) {
        var d = domain();
        return tickFormat(d[0], d[d.length - 1], count == null ? 10 : count, specifier);
      };

      scale.nice = function(count) {
        if (count == null) count = 10;

        var d = domain(),
            i0 = 0,
            i1 = d.length - 1,
            start = d[i0],
            stop = d[i1],
            step;

        if (stop < start) {
          step = start, start = stop, stop = step;
          step = i0, i0 = i1, i1 = step;
        }

        step = tickIncrement(start, stop, count);

        if (step > 0) {
          start = Math.floor(start / step) * step;
          stop = Math.ceil(stop / step) * step;
          step = tickIncrement(start, stop, count);
        } else if (step < 0) {
          start = Math.ceil(start * step) / step;
          stop = Math.floor(stop * step) / step;
          step = tickIncrement(start, stop, count);
        }

        if (step > 0) {
          d[i0] = Math.floor(start / step) * step;
          d[i1] = Math.ceil(stop / step) * step;
          domain(d);
        } else if (step < 0) {
          d[i0] = Math.ceil(start * step) / step;
          d[i1] = Math.floor(stop * step) / step;
          domain(d);
        }

        return scale;
      };

      return scale;
    }

    function linear$1() {
      var scale = continuous(identity$1, identity$1);

      scale.copy = function() {
        return copy(scale, linear$1());
      };

      initRange.apply(scale, arguments);

      return linearish(scale);
    }

    function transformer$1() {
      var x0 = 0,
          x1 = 1,
          t0,
          t1,
          k10,
          transform,
          interpolator = identity$1,
          clamp = false,
          unknown;

      function scale(x) {
        return isNaN(x = +x) ? unknown : interpolator(k10 === 0 ? 0.5 : (x = (transform(x) - t0) * k10, clamp ? Math.max(0, Math.min(1, x)) : x));
      }

      scale.domain = function(_) {
        return arguments.length ? (t0 = transform(x0 = +_[0]), t1 = transform(x1 = +_[1]), k10 = t0 === t1 ? 0 : 1 / (t1 - t0), scale) : [x0, x1];
      };

      scale.clamp = function(_) {
        return arguments.length ? (clamp = !!_, scale) : clamp;
      };

      scale.interpolator = function(_) {
        return arguments.length ? (interpolator = _, scale) : interpolator;
      };

      scale.unknown = function(_) {
        return arguments.length ? (unknown = _, scale) : unknown;
      };

      return function(t) {
        transform = t, t0 = t(x0), t1 = t(x1), k10 = t0 === t1 ? 0 : 1 / (t1 - t0);
        return scale;
      };
    }

    function copy$1(source, target) {
      return target
          .domain(source.domain())
          .interpolator(source.interpolator())
          .clamp(source.clamp())
          .unknown(source.unknown());
    }

    function sequential() {
      var scale = linearish(transformer$1()(identity$1));

      scale.copy = function() {
        return copy$1(scale, sequential());
      };

      return initInterpolator.apply(scale, arguments);
    }

    function colors(specifier) {
      var n = specifier.length / 6 | 0, colors = new Array(n), i = 0;
      while (i < n) colors[i] = "#" + specifier.slice(i * 6, ++i * 6);
      return colors;
    }

    function ramp(scheme) {
      return rgbBasis(scheme[scheme.length - 1]);
    }

    var scheme = new Array(3).concat(
      "fee0d2fc9272de2d26",
      "fee5d9fcae91fb6a4acb181d",
      "fee5d9fcae91fb6a4ade2d26a50f15",
      "fee5d9fcbba1fc9272fb6a4ade2d26a50f15",
      "fee5d9fcbba1fc9272fb6a4aef3b2ccb181d99000d",
      "fff5f0fee0d2fcbba1fc9272fb6a4aef3b2ccb181d99000d",
      "fff5f0fee0d2fcbba1fc9272fb6a4aef3b2ccb181da50f1567000d"
    ).map(colors);

    var Reds = ramp(scheme);

    /**
     * Computes the euclidean distance (l_2) between {@link a} and {@link b}.
     * @memberof module:metrics
     * @alias euclidean
     * @param {Array<Number>} a 
     * @param {Array<Number>} b 
     * @returns {Number} the euclidean distance between {@link a} and {@link b}.  
     */
    function euclidean(a, b) {
        return Math.sqrt(euclidean_squared(a, b));
    }

    /**
     * Numerical stable summation with the Neumair summation algorithm.
     * @memberof module:numerical
     * @alias neumair_sum
     * @param {Array} summands - Array of values to sum up.
     * @returns {number} The sum.
     * @see {@link https://en.wikipedia.org/wiki/Kahan_summation_algorithm#Further_enhancements}
     */
    function neumair_sum(summands) {
        let n = summands.length;
        let sum = 0;
        let compensation = 0;

        for (let i = 0; i < n; ++i) {
            let summand = summands[i];
            let t = sum + summand;
            if (Math.abs(sum) >= Math.abs(summand)) {
                compensation += (sum - t) + summand;
            } else {
                compensation += (summand - t) + sum;
            }
            sum = t;
        }
        return sum + compensation;
    }

    /**
     * Computes the squared euclidean distance (l_2^2) between {@link a} and {@link b}.
     * @memberof module:metrics
     * @alias euclidean_squared
     * @param {Array<Number>} a 
     * @param {Array<Number>} b 
     * @returns {Number} the squared euclidean distance between {@link a} and {@link b}.  
     */
    function euclidean_squared(a, b) {
        if (a.length != b.length) return undefined
        let n = a.length;
        let s = new Array(n);
        for (let i = 0; i < n; ++i) {
            let x = a[i];
            let y = b[i];
            s[i] = ((x - y) * (x - y));
        }
        return neumair_sum(s);
    }

    function k_nearest_neighbors(A, k, distance_matrix = null, metric = euclidean) {
        let n = A.length;
        let D = distance_matrix || dmatrix(A, metric);
        for (let i = 0; i < n; ++i) {
            D[i] = D[i].map((d,j) => {
                return {
                    i: i, j: j, distance: D[i][j]
                }
            }).sort((a, b) => a.distance - b.distance)
            .slice(1, k + 1);
        }
        return D
    }

    function dmatrix(A, metric = euclidean) {
        if (metric === undefined) return undefined;
        let n = A.length;
        let D = new Array(n);
        for (let i = 0; i < n; ++i) {
            D[i] = new Array(n);
        }
        for (let i = 0; i < n; ++i) {
            for (let j = i + 1; j < n; ++j) {
                D[i][j] = D[j][i] = metric(A[i], A[j]);
            }
        }
        return D;
    }

    function linspace(start, end, number = null) {
        if (!number) {
            number = Math.max(Math.round(end - start) + 1, 1);
        }
        if (number < 2) {
            return number === 1 ? [start] : [];
        }
        let result = new Array(number);
        number -= 1;
        for (let i = number; i >= 0; --i) {
            result[i] = (i * end + (number - i) * start) / number;
        }
        return result
    }

    //import { neumair_sum } from "../numerical/index";

    function norm(v, metric = euclidean) {
    //export default function(vector, p=2, metric = euclidean) {
        let vector = null;
        if (v instanceof Matrix) {
            let [rows, cols] = v.shape;
            if (rows === 1) vector = v.row(0);
            else if (cols === 1) vector = v.col(0);
            else throw "matrix must be 1d!"
        } else {
            vector = v;
        }
        let n = vector.length;
        let z = new Array(n);
        z.fill(0);
        return metric(vector, z);
        
        
        /*let v;
        if (vector instanceof Matrix) {
            let [ rows, cols ] = v.shape;
            if (rows === 1) {
                v = vector.row(0);
            } else if (cols === 1) {
                v = vector.col(0);
            } else {
                throw "matrix must be 1d"
            }
        } else {
            v = vector;
        }
        return Math.pow(neumair_sum(v.map(e => Math.pow(e, p))), 1 / p)*/
    }

    /**
     * @class
     * @alias Matrix
     * @requires module:numerical/neumair_sum
     */
    class Matrix{
        /**
         * creates a new Matrix. Entries are stored in a Float64Array. 
         * @constructor
         * @memberof module:matrix
         * @alias Matrix
         * @param {number} rows - The amount of rows of the matrix.
         * @param {number} cols - The amount of columns of the matrix.
         * @param {(function|string|number)} value=0 - Can be a function with row and col as parameters, a number, or "zeros", "identity" or "I", or "center".
         *  - **function**: for each entry the function gets called with the parameters for the actual row and column.
         *  - **string**: allowed are
         *      - "zero", creates a zero matrix.
         *      - "identity" or "I", creates an identity matrix.
         *      - "center", creates an center matrix.
         *  - **number**: create a matrix filled with the given value.
         * @example
         * 
         * let A = new Matrix(10, 10, () => Math.random()); //creates a 10 times 10 random matrix.
         * let B = new Matrix(3, 3, "I"); // creates a 3 times 3 identity matrix.
         * @returns {Matrix} returns a {@link rows} times {@link cols} Matrix filled with {@link value}.
         */
        constructor(rows=null, cols=null, value=null) {
            this._rows = rows;
            this._cols = cols;
            this._data = null;
            if (rows && cols) {
                if (!value) {
                    this._data = new Float64Array(rows * cols);
                    return this;
                }
                if (typeof(value) === "function") {
                    this._data = new Float64Array(rows * cols);
                    for (let row = 0; row < rows; ++row) {
                        for (let col = 0; col < cols; ++col) {
                            this._data[row * cols + col] = value(row, col);
                        }
                    }
                    return this;
                }
                if (typeof(value) === "string") {
                    if (value === "zeros") {
                        return new Matrix(rows, cols, 0); 
                    }
                    if (value === "identity" || value === "I") {
                        this._data = new Float64Array(rows * cols);
                        for (let row = 0; row < rows; ++row) {
                            this._data[row * cols + row] = 1;
                        }
                        return this;
                    }
                    if (value === "center" && rows == cols) {
                        this._data = new Float64Array(rows * cols);
                        value = (i, j) => (i === j ? 1 : 0) - (1 / rows);
                        for (let row = 0; row < rows; ++row) {
                            for (let col = 0; col < cols; ++col) {
                                this._data[row * cols + col] = value(row, col);
                            }
                        }
                        return this;
                    }
                }
                if (typeof(value) === "number") {
                    this._data = new Float64Array(rows * cols);
                    for (let row = 0; row < rows; ++row) {
                        for (let col = 0; col < cols; ++col) {
                            this._data[row * cols + col] = value;
                        }
                    }
                    return this;
                }
            }
            return this;
        }

        /**
         * Creates a Matrix out of {@link A}.
         * @param {(Matrix|Array|Float64Array|number)} A - The matrix, array, or number, which should converted to a Matrix.
         * @param {"row"|"col"|"diag"} [type = "row"] - If {@link A} is a Array or Float64Array, then type defines if it is a row- or a column vector. 
         * @returns {Matrix}
         * 
         * @example
         * let A = Matrix.from([[1, 0], [0, 1]]); //creates a two by two identity matrix.
         * let S = Matrix.from([1, 2, 3], "diag"); // creates a three by three matrix with 1, 2, 3 on its diagonal.
         */
        static from(A, type="row") {
            if (A instanceof Matrix) {
                return A.clone();
            } else if (Array.isArray(A) || A instanceof Float64Array) {
                let m = A.length;
                if (m === 0) throw "Array is empty";
                // 1d
                if (!Array.isArray(A[0]) && !(A[0] instanceof Float64Array)) {
                    if (type === "row") {  
                        return new Matrix(1, m, (_, j) => A[j]);
                    } else if (type === "col") {
                        return new Matrix(m, 1, (i) => A[i]);
                    } else if (type === "diag") {
                        return new Matrix(m, m, (i, j) => (i == j) ? A[i] : 0);
                    } else {
                        throw "1d array has NaN entries"
                    }
                // 2d
                } else if (Array.isArray(A[0]) || A[0] instanceof Float64Array) {
                    let n = A[0].length;
                    for (let row = 0; row < m; ++row) {
                        if (A[row].length !== n) throw "various array lengths";
                    }
                    return new Matrix(m, n, (i, j) => A[i][j])
                }
            } else if (typeof(A) === "number") {
                return new Matrix(1, 1, A);
            } else {
                throw "error"
            }
        }

        /**
         * Returns the {@link row}th row from the Matrix.
         * @param {int} row 
         * @returns {Array}
         */
        row(row) {
            let result_row = new Array(this._cols);
            for (let col = 0; col < this._cols; ++col) {
                result_row[col] = this._data[row * this._cols + col];
            }
            return result_row;
        }

        /**
         * Sets the entries of {@link row}th row from the Matrix to the entries from {@link values}.
         * @param {int} row 
         * @param {Array} values 
         * @returns {Matrix}
         */
        set_row(row, values) {
            let cols = this._cols;
            if (Array.isArray(values) && values.length === cols) {
                let offset = row * cols;
                for (let col = 0; col < cols; ++col) {
                    this._data[offset + col] = values[col];
                }
            } else if (values instanceof Matrix && values.shape[1] === cols && values.shape[0] === 1) {
                let offset = row * cols;
                for (let col = 0; col < cols; ++col) {
                    this._data[offset + col] = values._data[col];
                }
            }
            return this;
        }

        /**
         * Returns the {@link col}th column from the Matrix.
         * @param {int} col 
         * @returns {Array}
         */
        col(col) {
            let result_col = new Array(this._rows);
            for (let row = 0; row < this._rows; ++row) {
                result_col[row] = this._data[row * this._cols + col];
            }
            return result_col;
        }

        /**
         * Returns the {@link col}th entry from the {@link row}th row of the Matrix.
         * @param {int} row 
         * @param {int} col 
         * @returns {float64}
         */
        entry(row, col) {
            return this._data[row * this._cols + col];
        }

        /**
         * Sets the {@link col}th entry from the {@link row}th row of the Matrix to the given {@link value}.
         * @param {int} row 
         * @param {int} col 
         * @param {float64} value
         * @returns {Matrix}
         */
        set_entry(row, col, value) {
            this._data[row * this._cols + col] = value;
            return this;
        }

        /**
         * Returns a new transposed Matrix.
         * @returns {Matrix}
         */
        transpose() {
            let B = new Matrix(this._cols, this._rows, (row, col) => this.entry(col, row));
            return B;
        }

        /**
         * Returns a new transposed Matrix. Short-form of {@function transpose}.
         * @returns {Matrix}
         */
        get T() {
            return this.transpose();
        }

        /**
         * Returns the inverse of the Matrix.
         * @returns {Matrix}
         */
        inverse() {
            const rows = this._rows;
            const cols = this._cols;
            let B = new Matrix(rows, 2 * cols, (i,j) => {
                if (j >= cols) {
                    return (i === (j - cols)) ? 1 : 0;
                } else {
                    return this.entry(i, j);
                }
            });
            let h = 0; 
            let k = 0;
            while (h < rows && k < cols) {
                var i_max = 0;
                let max_val = -Infinity;
                for (let i = h; i < rows; ++i) {
                    let val = Math.abs(B.entry(i,k));
                    if (max_val < val) {
                        i_max = i;
                        max_val = val;
                    }
                }
                if (B.entry(i_max, k) == 0) {
                    k++;
                } else {
                    // swap rows
                    for (let j = 0; j < 2 * cols; ++j) {
                        let h_val = B.entry(h, j);
                        let i_val = B.entry(i_max, j);
                        B.set_entry(h, j, h_val);
                        B.set_entry(i_max, j, i_val);
                    }
                    for (let i = h + 1; i < rows; ++i) {
                        let f = B.entry(i, k) / B.entry(h, k);
                        B.set_entry(i, k, 0);
                        for (let j = k + 1; j < 2 * cols; ++j) {
                            B.set_entry(i, j, B.entry(i, j) - B.entry(h, j) * f);
                        }
                    }
                    h++;
                    k++;
                }
            }

            for (let row = 0; row < rows; ++row) {
                let f = B.entry(row, row);
                for (let col = row; col < 2 * cols; ++col) {
                    B.set_entry(row, col, B.entry(row, col) / f);
                }
            }
            
            for (let row = rows - 1; row >= 0; --row) {
                let B_row_row = B.entry(row, row);
                for (let i = 0; i < row; i++) {
                    let B_i_row = B.entry(i, row);
                    let f = B_i_row / B_row_row;
                    for (let j = i; j < 2 * cols; ++j) {
                        let B_i_j = B.entry(i,j);
                        let B_row_j = B.entry(row, j);
                        B_i_j = B_i_j - B_row_j * f;
                        B.set_entry(i, j, B_i_j);
                    }
                }
            }

            return new Matrix(rows, cols, (i,j) => B.entry(i, j + cols));
        }

        /**
         * Returns the dot product. If {@link B} is an Array or Float64Array then an Array gets returned. If {@link B} is a Matrix then a Matrix gets returned.
         * @param {(Matrix|Array|Float64Array)} B the right side
         * @returns {(Matrix|Array)}
         */
        dot(B) {
            if (B instanceof Matrix) {
                let A = this;
                if (A.shape[1] !== B.shape[0]) {
                    throw `A.dot(B): A is a ${A.shape.join(" x ")}-Matrix, B is a ${B.shape.join(" x ")}-Matrix: 
                A has ${A.shape[1]} cols and B ${B.shape[0]} rows. 
                Must be equal!`;
                }
                let I = A.shape[1];
                let C = new Matrix(A.shape[0], B.shape[1], (row, col) => {
                    let A_i = A.row(row);
                    let B_i = B.col(col);
                    for (let i = 0; i < I; ++i) {
                        A_i[i] *= B_i[i];
                    }
                    return neumair_sum(A_i);
                });
                return C;
            } else if (Array.isArray(B) || (B instanceof Float64Array)) {
                let rows = this._rows;
                if (B.length !== rows)  {
                    throw `A.dot(B): A has ${rows} cols and B has ${B.length} rows. Must be equal!`
                }
                let C = new Array(rows);
                for (let row = 0; row < rows; ++row) {
                    C[row] = neumair_sum(this.row(row).map(e => e * B[row]));
                }
                return C;
            } else {
                throw `B must be Matrix or Array`;
            }
        }

        /**
         * Computes the outer product from {@link this} and {@link B}.
         * @param {Matrix} B 
         * @returns {Matrix}
         */
        outer(B) {
            let A = this;
            let l = A._data.length;
            let r = B._data.length;
            if (l != r) return undefined;
            let C = new Matrix();
            C.shape = [l, l, (i, j) => {
                if (i <= j) {
                    return A._data[i] * B._data[j];
                } else {
                    return C.entry(j, i);
                }
            }];
            return C;
        }

        /**
         * Appends matrix {@link B} to the matrix.
         * @param {Matrix} B - matrix to append.
         * @param {"horizontal"|"vertical"|"diag"} [type = "horizontal"] - type of concatenation.
         * @returns {Matrix}
         * @example
         * 
         * let A = Matrix.from([[1, 1], [1, 1]]); // 2 by 2 matrix filled with ones.
         * let B = Matrix.from([[2, 2], [2, 2]]); // 2 by 2 matrix filled with twos.
         * 
         * A.concat(B, "horizontal"); // 2 by 4 matrix. [[1, 1, 2, 2], [1, 1, 2, 2]]
         * A.concat(B, "vertical"); // 4 by 2 matrix. [[1, 1], [1, 1], [2, 2], [2, 2]]
         * A.concat(B, "diag"); // 4 by 4 matrix. [[1, 1, 0, 0], [1, 1, 0, 0], [0, 0, 2, 2], [0, 0, 2, 2]]
         */
        concat(B, type="horizontal") {
            const A = this;
            const [rows_A, cols_A] = A.shape;
            const [rows_B, cols_B] = B.shape;
            if (type == "horizontal") {
                if (rows_A != rows_B) throw `A.concat(B, "horizontal"): A and B need same number of rows, A has ${rows_A} rows, B has ${rows_B} rows.`;
                const X = new Matrix(rows_A, cols_A + cols_B, "zeros");
                X.set_block(0, 0, A);
                X.set_block(0, cols_A, B);
                return X;
            } else if (type == "vertical") {
                if (cols_A != cols_B) throw `A.concat(B, "vertical"): A and B need same number of columns, A has ${cols_A} columns, B has ${cols_B} columns.`;
                const X = new Matrix(rows_A + rows_B, cols_A, "zeros");
                X.set_block(0, 0, A);
                X.set_block(rows_A, 0, B);
                return X;
            } else if (type == "diag") {
                const X = new Matrix(rows_A + rows_B, cols_A + cols_B, "zeros");
                X.set_block(0, 0, A);
                X.set_block(rows_A, cols_A, B);
                return X;
            } else {
                throw `type must be "horizontal" or "vertical", but type is ${type}!`;
            }
        }

        /**
         * Writes the entries of B in A at an offset position given by {@link offset_row} and {@link offset_col}.
         * @param {int} offset_row 
         * @param {int} offset_col 
         * @param {Matrix} B 
         * @returns {Matrix}
         */
        set_block(offset_row, offset_col, B) {
            let [ rows, cols ] = B.shape;
            for (let row = 0; row < rows; ++row) {
                if (row > this._rows) continue;
                for (let col = 0; col < cols; ++col) {
                    if (col > this._cols) continue;
                    this.set_entry(row + offset_row, col + offset_col, B.entry(row, col));
                }
            }
            return this;
        }

        /**
         * Extracts the entries from the {@link start_row}th row to the {@link end_row}th row, the {@link start_col}th column to the {@link end_col}th column of the matrix.
         * If {@link end_row} or {@link end_col} is empty, the respective value is set to {@link this.rows} or {@link this.cols}.
         * @param {Number} start_row 
         * @param {Number} start_col
         * @param {Number} [end_row = null]
         * @param {Number} [end_col = null] 
         * @returns {Matrix} Returns a end_row - start_row times end_col - start_col matrix, with respective entries from the matrix.
         * @example
         * 
         * let A = Matrix.from([[1, 2, 3], [4, 5, 6], [7, 8, 9]]); // a 3 by 3 matrix.
         * 
         * A.get_block(1, 1).to2dArray; // [[5, 6], [8, 9]]
         * A.get_block(0, 0, 1, 1).to2dArray; // [[1]]
         * A.get_block(1, 1, 2, 2).to2dArray; // [[5]]
         * A.get_block(0, 0, 2, 2).to2dArray; // [[1, 2], [4, 5]]
         */
        get_block(start_row, start_col, end_row = null, end_col = null) {
            const [ rows, cols ] = this.shape;
            /*if (!end_row)) {
                end_row = rows;
            }
                end_col = cols;
            }*/
            end_row = end_row || rows;
            end_col = end_col || cols;
            if (end_row <= start_row || end_col <= start_col) {
                throw `
                end_row must be greater than start_row, and 
                end_col must be greater than start_col, but
                end_row = ${end_row}, start_row = ${start_row}, end_col = ${end_col}, and start_col = ${start_col}!`;
            }
            const X = new Matrix(end_row - start_row, end_col - start_col, "zeros");
            for (let row = start_row, new_row = 0; row < end_row; ++row, ++new_row) {
                for (let col = start_col, new_col = 0; col < end_col; ++col, ++new_col) {
                    X.set_entry(new_row, new_col, this.entry(row, col));
                }
            }
            return X;
            //return new Matrix(end_row - start_row, end_col - start_col, (i, j) => this.entry(i + start_row, j + start_col));
        }

        /**
         * Applies a function to each entry of the matrix.
         * @param {function} f function takes 2 parameters, the value of the actual entry and a value given by the function {@link v}. The result of {@link f} gets writen to the Matrix.
         * @param {function} v function takes 2 parameters for row and col, and returns a value witch should be applied to the colth entry of the rowth row of the matrix.
         */
        _apply_array(f, v) {
            const data = this._data;
            const [ rows, cols ] = this.shape;
            for (let row = 0; row < rows; ++row) {
                const o = row * cols;
                for (let col = 0; col < cols; ++col) {
                    const i = o + col;
                    const d = data[i];
                    data[i] = f(d, v(row, col));
                }
            }
            return this; 
        }

        _apply_rowwise_array(values, f) {
            return this._apply_array(f, (i, j) => values[j]);
        }

        _apply_colwise_array(values, f) {
            const data = this._data;
            const [ rows, cols ] = this.shape;
            for (let row = 0; row < rows; ++row) {
                const o = row * cols;
                for (let col = 0; col < cols; ++col) {
                    const i = o + col;
                    const d = data[i];
                    data[i] = f(d, values[row]);
                }
            }
            return this; 
        }

        _apply(value, f) {
            let data = this._data;
            if (value instanceof Matrix) {
                let [ value_rows, value_cols ] = value.shape;
                let [ rows, cols ] = this.shape;
                if (value_rows === 1) {
                    if (cols !== value_cols) {
                        throw `cols !== value_cols`;
                    }
                    for (let row = 0; row < rows; ++row) {
                        for (let col = 0; col < cols; ++col) {
                            data[row * cols + col] = f(data[row * cols + col], value.entry(0, col));
                        }
                    }
                } else if (value_cols === 1) {
                    if (rows !== value_rows) {
                        throw `rows !== value_rows`;
                    }
                    for (let row = 0; row < rows; ++row) {
                        for (let col = 0; col < cols; ++col) {
                            data[row * cols + col] = f(data[row * cols + col], value.entry(row, 0));
                        }
                    }
                } else if (rows == value_rows && cols == value_cols) {
                    for (let row = 0; row < rows; ++row) {
                        for (let col = 0; col < cols; ++col) {
                            data[row * cols + col] = f(data[row * cols + col], value.entry(row, col));
                        }
                    }
                } else {
                    throw `error`;
                }
            } else if (Array.isArray(value)) {
                let rows = this._rows;
                let cols = this._cols;
                if (value.length === rows) {
                    for (let row = 0; row < rows; ++row) {
                        for (let col = 0; col < cols; ++col) {
                            data[row * cols + col] = f(data[row * cols + col], value[row]);
                        }
                    }
                } else if (value.length === cols) {
                    for (let row = 0; row < rows; ++row) {
                        for (let col = 0; col < cols; ++col) {
                            data[row * cols + col] = f(data[row * cols + col], value[col]);
                        }
                    }
                } else {
                    throw `error`;
                }
            } else {
                for (let i = 0, n = this._rows * this._cols; i < n; ++i) {
                    data[i] = f(data[i], value);
                }
            }
            return this;
        }

        /**
         * Clones the Matrix.
         * @returns {Matrix}
         */
        clone() {
            let B = new Matrix();
            B._rows = this._rows;
            B._cols = this._cols;
            B._data = this._data.slice(0);
            return B;
        }

        mult(value) {
            return this.clone()._apply(value, (a,b) => a * b);
        }

        divide(value) {
            return this.clone()._apply(value, (a,b) => a / b);
        }

        add(value) {
            return this.clone()._apply(value, (a,b) => a + b);
        }

        sub(value) {
            return this.clone()._apply(value, (a,b) => a - b);
        }

        /**
         * Returns the number of rows and columns of the Matrix.
         * @returns {Array} An Array in the form [rows, columns].
         */
        get shape() {
            return [this._rows, this._cols];
        }

        /**
         * Returns the matrix in the given shape with the given function which returns values for the entries of the matrix.
         * @param {Array} parameter - takes an Array in the form [rows, cols, value], where rows and cols are the number of rows and columns of the matrix, and value is a function which takes two parameters (row and col) which has to return a value for the colth entry of the rowth row.
         * @returns {Matrix}
         */
        set shape([rows, cols, value = () => 0]) {
            this._rows = rows;
            this._cols = cols;
            this._data = new Float64Array(rows * cols);
            for (let row = 0; row < rows; ++row) {
                for (let col = 0; col < cols; ++col) {
                    this._data[row * cols + col] = value(row, col);
                }
            }
            return this;
        }

        /**
         * Returns the Matrix as a two-dimensional Array.
         * @returns {Array}
         */
        get to2dArray() {
            const rows = this._rows;
            const cols = this._cols;
            let result = new Array(rows);
            for (let row = 0; row < rows; ++row) {
                let result_col = new Array(cols);
                for (let col = 0; col < cols; ++col) {
                    result_col[col] = this.entry(row, col);
                }
                result[row] = result_col;
            }
            return result;
        }

        /**
         * Returns the diagonal of the Matrix.
         * @returns {Array}
         */
        get diag() {
            const rows = this._rows;
            const cols = this._cols;
            const min_row_col = Math.min(rows, cols);
            let result = new Array(min_row_col);
            for (let i = 0; i < min_row_col; ++i) {
                result[i] = this.entry(i,i);
            }
            return result;
        }

        /**
         * Returns the mean of all entries of the Matrix.
         * @returns {float64}
         */
        get mean() {
            const data = this._data;
            const n = this._rows * this._cols;
            let sum = 0;
            for (let i = 0; i < n; ++i) {
                sum += data[i];
            }
            return sum / n;
        }

        /**
         * Returns the mean of each row of the matrix.
         * @returns {Array}
         */
        get meanRows() {
            const data = this._data;
            const rows = this._rows;
            const cols = this._cols;
            let result = [];
            for (let row = 0; row < rows; ++row) {
                result[row] = 0;
                for (let col = 0; col < cols; ++col) {
                    result[row] += data[row * cols + col];
                }
                result[row] /= cols;
            }
            return result;
        }

        /** Returns the mean of each column of the matrix.
         * @returns {Array}
         */
        get meanCols() {
            const data = this._data;
            const rows = this._rows;
            const cols = this._cols;
            let result = [];
            for (let col = 0; col < cols; ++col) {
                result[col] = 0;
                for (let row = 0; row < rows; ++row) {
                    result[col] += data[row * cols + col];
                }
                result[col] /= rows;
            }
            return result;
        }

        static solve_CG(A, b, randomizer, tol=1e-3) {
            const rows = A.shape[0];
            const cols = b.shape[1];
            let result = new Matrix(rows, 0);
            for (let i = 0; i < cols; ++i) {
                let x = new Matrix(rows, 1, () => randomizer.random);
                let b_i = Matrix.from(b.col(i)).T;
                let r = b_i.sub(A.dot(x));
                let d = r.clone();
                do {
                    const z = A.dot(d);
                    const alpha = r.T.dot(r).entry(0, 0) / d.T.dot(z).entry(0, 0);
                    x = x.add(d.mult(alpha));
                    const r_next = r.sub(z.mult(alpha));
                    const beta = r_next.T.dot(r_next).entry(0, 0) / r.T.dot(r).entry(0, 0);
                    d = r_next.add(d.mult(beta));
                    r = r_next;
                } while (Math.abs(r.mean) > tol);
                result = result.concat(x, "horizontal");
            }
            return result;
        }

        /**
         * Solves the equation {@link A}x = {@link b}. Returns the result x.
         * @param {Matrix} A - Matrix or LU Decomposition
         * @param {Matrix} b - Matrix
         * @returns {Matrix}
         */
        static solve(A, b) {
            let { L: L, U: U } = ("L" in A && "U" in A) ? A : Matrix.LU(A);
            let rows = L.shape[0];
            let x = b.clone();
            
            // forward
            for (let row = 0; row < rows; ++row) {
                for (let col = 0; col < row - 1; ++col) {
                    x.set_entry(0, row, x.entry(0, row) - L.entry(row, col) * x.entry(1, col));
                }
                x.set_entry(0, row, x.entry(0, row) / L.entry(row, row));
            }
            
            // backward
            for (let row = rows - 1; row >= 0; --row) {
                for (let col = rows - 1; col > row; --col) {
                    x.set_entry(0, row, x.entry(0, row) - U.entry(row, col) * x.entry(0, col));
                }
                x.set_entry(0, row, x.entry(0, row) / U.entry(row, row));
            }

            return x;
        }

        /**
         * {@link L}{@link U} decomposition of the Matrix {@link A}. Creates two matrices, so that the dot product LU equals A.
         * @param {Matrix} A 
         * @returns {{L: Matrix, U: Matrix}} result - Returns the left triangle matrix {@link L} and the upper triangle matrix {@link U}.
         */
        static LU(A) {
            const rows = A.shape[0];
            const L = new Matrix(rows, rows, "zeros");
            const U = new Matrix(rows, rows, "identity");
            
            for (let j = 0; j < rows; ++j) {
                for (let i = j; i < rows; ++i) {
                    let sum = 0;
                    for (let k = 0; k < j; ++k) {
                        sum += L.entry(i, k) * U.entry(k, j);
                    }
                    L.set_entry(i, j, A.entry(i, j) - sum);
                }
                for (let i = j; i < rows; ++i) {
                    if (L.entry(j, j) === 0) {
                        return undefined;
                    }
                    let sum = 0;
                    for (let k = 0; k < j; ++k) {
                        sum += L.entry(j, k) * U.entry(k, i);
                    }
                    U.set_entry(j, i, (A.entry(j, i) - sum) / L.entry(j, j));
                }
            }

            return { L: L, U: U };
        }

        /**
         * Computes the {@link k} components of the SVD decomposition of the matrix {@link M}
         * @param {Matrix} A 
         * @param {int} [k=2] 
         * @returns {{U: Matrix, Sigma: Matrix, V: Matrix}}
         */
        static SVD(A, k=2) {
            /*const MT = M.T;
            let MtM = MT.dot(M);
            let MMt = M.dot(MT);
            let { eigenvectors: V, eigenvalues: Sigma } = simultaneous_poweriteration(MtM, k);
            let { eigenvectors: U } = simultaneous_poweriteration(MMt, k);
            return { U: U, Sigma: Sigma.map(sigma => Math.sqrt(sigma)), V: V };*/
            
            //Algorithm 1a: Householder reduction to bidiagonal form:
            const [m, n] = A.shape;
            let U = new Matrix(m, n, (i, j) => i == j ? 1 : 0);
            console.log(U.to2dArray);
            let V = new Matrix(n, m, (i, j) => i == j ? 1 : 0);
            console.log(V.to2dArray);
            let B = Matrix.bidiagonal(A.clone(), U, V);
            console.log(U,V,B);
            return { U: U, "Sigma": B, V: V };
        }
    }

    class Randomizer {
        // https://github.com/bmurray7/mersenne-twister-examples/blob/master/javascript-mersenne-twister.js
        /**
         * Mersenne Twister
         * @param {*} _seed 
         */
        constructor(_seed) {
            this._N = 624;
            this._M = 397;
            this._MATRIX_A = 0x9908b0df;
            this._UPPER_MASK = 0x80000000;
            this._LOWER_MASK = 0x7fffffff;
            this._mt = new Array(this._N);
            this._mti = this.N + 1;

            this.seed = _seed || new Date().getTime();
            return this;
        }

        set seed(_seed) {
            this._seed = _seed;
            let mt = this._mt;

            mt[0] = _seed >>> 0;
            for (this._mti = 1; this._mti < this._N; this._mti += 1) {
                let mti = this._mti;
                let s = mt[mti - 1] ^ (mt[mti - 1] >>> 30);
                mt[mti] = (((((s & 0xffff0000) >>> 16) * 1812433253) << 16) + (s & 0x0000ffff) * 1812433253) + mti;
                mt[mti] >>>= 0;
            }
        }

        get seed() {
            return this._seed;
        }

        get random() {
            return this.random_int * (1.0 / 4294967296.0)
        }

        get random_int() {
            let y, mag01 = new Array(0x0, this._MATRIX_A);
            if (this._mti >= this._N) {
                let kk;

                if (this._mti == this._N + 1) {
                    this.seed = 5489;
                }

                let N_M = this._N - this._M;
                let M_N = this._M - this._N;

                for (kk = 0; kk < N_M; ++kk) {
                    y = (this._mt[kk] & this._UPPER_MASK) | (this._mt[kk + 1] & this._LOWER_MASK);
                    this._mt[kk] = this._mt[kk + this._M] ^ (y >>> 1) ^ mag01[y & 0x1];
                }
                for (; kk < this._N - 1; ++kk) {
                    y = (this._mt[kk] & this._UPPER_MASK) | (this._mt[kk + 1] & this._LOWER_MASK);
                    this._mt[kk] = this._mt[kk + M_N] ^ (y >>> 1) ^ mag01[y & 0x1];
                }

                y = (this._mt[this._N - 1] & this._UPPER_MASK) | (this._mt[0] & this._LOWER_MASK);
                this._mt[this._N - 1] = this._mt[this._M - 1] ^ (y >>> 1) ^ mag01[y & 0x1];

                this._mti = 0;
            }

            y = this._mt[this._mti += 1];
            y ^= (y >>> 11);
            y ^= (y << 7) & 0x9d2c5680;
            y ^= (y << 15) & 0xefc60000;
            y ^= (y >>> 18);

            return y >>> 0;
        }

        choice(A, n) {
            if (A instanceof Matrix) {
                let [rows, cols] = A.shape;
                if (n > rows) throw "n bigger than A!";
                let sample = new Array(n);
                let index_list = linspace(0, rows - 1);
                for (let i = 0, l = index_list.length; i < n; ++i, --l) {
                    let random_index = this.random_int % l;
                    sample[i] = index_list.splice(random_index, 1)[0];
                }
                return sample.map(d => A.row(d));
            } else if (Array.isArray(A) || A instanceof Float64Array) {
                let rows = A.length;
                if (n > rows) {
                    throw "n bigger than A!";
                }
                let sample = new Array(n);
                let index_list = linspace(0, rows - 1);
                for (let i = 0, l = index_list.length; i < n; ++i, --l) {
                    let random_index = this.random_int % l;
                    sample[i] = index_list.splice(random_index, 1)[0];
                }
                return sample.map(d => A[d]);
            }
        }

        static choice(A, n, seed=19870307) {
            let [rows, cols] = A.shape;
            if (n > rows) throw "n bigger than A!"
            let rand = new Randomizer(seed);
            let sample = new Array(n);
            let index_list = linspace(0, rows - 1);
            /*let index_list = new Array(rows);
            for (let i = 0; i < rows; ++i) {
                index_list[i] = i;
            }*/
            //let result = new Matrix(n, cols);
            for (let i = 0, l = index_list.length; i < n; ++i, --l) {
                let random_index = rand.random_int % l;
                sample[i] = index_list.splice(random_index, 1)[0];
                //random_index = index_list.splice(random_index, 1)[0];
                //result.set_row(i, A.row(random_index))
            }
            //return result;
            //return new Matrix(n, cols, (row, col) => A.entry(sample[row], col))
            return sample.map(d => A.row(d));
        }
    }

    /**
     * @class
     * @alias Heap
     */
    class Heap {
        /**
         * A heap is a datastructure holding its elements in a specific way, so that the top element would be the first entry of an ordered list.
         * @constructor
         * @memberof module:datastructure
         * @alias Heap
         * @param {Array=} elements - Contains the elements for the Heap. {@link elements} can be null.
         * @param {Function} [accessor = (d) => d] - Function returns the value of the element.
         * @param {("min"|"max"|Function)} [comparator = "min"] - Function returning true or false defining the wished order of the Heap, or String for predefined function. ("min" for a Min-Heap, "max" for a Max_heap)
         * @returns {Heap}
         * @see {@link https://en.wikipedia.org/wiki/Binary_heap}
         */
        constructor(elements = null, accessor = d => d, comparator = "min") {
            if (elements) {
                return Heap.heapify(elements, accessor, comparator);
            } else {
                this._accessor = accessor;
                this._container = [];
                if (comparator == "min") {
                    this._comparator = (a, b) => a < b;
                } else if (comparator == "max") {
                    this._comparator = (a, b) => a > b;
                } else {
                    this._comparator = comparator;
                }
                return this
            }
        }

        /**
         * Creates a Heap from an Array
         * @param {Array|Set} elements - Contains the elements for the Heap.
         * @param {Function=} [accessor = (d) => d] - Function returns the value of the element.
         * @param {(String=|Function)} [comparator = "min"] - Function returning true or false defining the wished order of the Heap, or String for predefined function. ("min" for a Min-Heap, "max" for a Max_heap)
         * @returns {Heap}
         */
        static heapify(elements, accessor = d => d, comparator = "min") {
            const heap = new Heap(null, accessor, comparator);
            const container = heap._container;
            for (const e of elements) {
                container.push({
                    "element": e,
                    "value": accessor(e),
                });
            }
            for (let i = Math.floor((elements.length / 2) - 1); i >= 0; --i) {
                heap._heapify_down(i);
            }
            return heap;
        }

        /**
         * Swaps elements of container array.
         * @private
         * @param {Number} index_a 
         * @param {Number} index_b 
         */
        _swap(index_a, index_b) {
            const container = this._container;
            [container[index_b], container[index_a]] = [container[index_a], container[index_b]];
            return;
        }

        /**
         * @private
         */
        _heapify_up() {
            const container = this._container;
            let index = container.length - 1;
            while (index > 0) {
                let parentIndex = Math.floor((index - 1) / 2);
                if (!this._comparator(container[index].value, container[parentIndex].value)) {
                    break;
                } else {
                this._swap(parentIndex, index);
                index = parentIndex;
                }
            }
        }

        /**
         * Pushes the element to the heap.
         * @param {} element
         * @returns {Heap}
         */
        push(element) {
            const value = this._accessor(element);
            //const node = new Node(element, value);
            const node = {"element": element, "value": value};
            this._container.push(node);
            this._heapify_up();
            return this;
        }

        /**
         * @private
         * @param {Number} [start_index = 0] 
         */
        _heapify_down(start_index=0) {
            const container = this._container;
            const comparator = this._comparator;
            const length = container.length;
            let left = 2 * start_index + 1;
            let right = 2 * start_index + 2;
            let index = start_index;
            if (index > length) throw "index higher than length"
            if (left < length && comparator(container[left].value, container[index].value)) {
                index = left;
            }
            if (right < length && comparator(container[right].value, container[index].value)) {
                index = right;
            }
            if (index !== start_index) {
                this._swap(start_index, index);
                this._heapify_down(index);
            }
        }

        /**
         * Removes and returns the top entry of the heap.
         * @returns {Object} Object consists of the element and its value (computed by {@link accessor}).
         */
        pop() {
            const container = this._container;
            if (container.length === 0) {
                return null;
            } else if (container.length === 1) {
                return container.pop();
            }
            this._swap(0, container.length - 1);
            const item = container.pop();
            this._heapify_down();
            return item;
        }

        /**
         * Returns the top entry of the heap without removing it.
         * @returns {Object} Object consists of the element and its value (computed by {@link accessor}).
         */
        get first() {
            return this._container.length > 0 ? this._container[0] : null;
        }


        /**
         * Yields the raw data
         * @yields {Object} Object consists of the element and its value (computed by {@link accessor}).
         */
        * iterate() {
            for (let i = 0, n = this._container.length; i < n; ++i) {
                yield this._container[i].element;
            }
        }

        /**
         * Returns the heap as ordered array.
         * @returns {Array} Array consisting the elements ordered by {@link comparator}.
         */
        toArray() {
            return this.data()
                .sort((a,b) => this._comparator(a, b) ? -1 : 0)
        }

        /**
         * Returns elements of container array.
         * @returns {Array} Array consisting the elements.
         */
        data() {
            return this._container
                .map(d => d.element)
        }

        /**
         * Returns the container array.
         * @returns {Array} The container array.
         */
        raw_data() {
            return this._container;
        }

        /**
         * The size of the heap.
         * @returns {Number}
         */
        get length() {
            return this._container.length;
        }

        /**
         * Returns false if the the heap has entries, true if the heap has no entries.
         * @returns {Boolean}
         */
        get empty() {
            return this.length === 0;
        }
    }

    /**
     * @class
     * @alias BallTree
     */
    class BallTree {
        /**
         * Generates a BallTree with given {@link elements}.
         * @constructor
         * @memberof module:knn
         * @alias BallTree
         * @param {Array=} elements - Elements which should be added to the BallTree
         * @param {Function} [metric = euclidean] metric to use: (a, b) => distance
         * @see {@link https://en.wikipedia.org/wiki/Ball_tree}
         * @see {@link https://github.com/invisal/noobjs/blob/master/src/tree/BallTree.js}
         * @returns {BallTree}
         */
        constructor(elements = null, metric = euclidean) {
            this._Node = class {
                constructor(pivot, child1=null, child2=null, radius=null) {
                    this.pivot = pivot;
                    this.child1 = child1;
                    this.child2 = child2;
                    this.radius = radius;
                }
            };
            this._Leaf = class {
                constructor(points) {
                    this.points = points;
                }
            };
            this._metric = metric;
            if (elements) {
                this.add(elements);
            }
            return this;
        }

        /**
         * 
         * @param {Array<*>} elements - new elements.
         * @returns {BallTree}
         */
        add(elements) {
            elements = elements.map((element, index) => {
                return {index: index, element: element}
            });
            this._root = this._construct(elements);
            return this;
        }

        /**
         * @private
         * @param {Array<*>} elements 
         * @returns {Node} root of balltree.
         */
        _construct(elements) {
            if (elements.length === 1) {
                return new this._Leaf(elements);
            } else {
                let c = this._greatest_spread(elements);
                let sorted_elements = elements.sort((a, b) => a.element[c] - b.element[c]);
                let n = sorted_elements.length;
                let p_index = Math.floor(n / 2);
                let p = elements[p_index];
                let L = sorted_elements.slice(0, p_index);
                let R = sorted_elements.slice(p_index, n);
                let radius = Math.max(...elements.map(d => this._metric(p.element, d.element)));
                let B;
                if (L.length > 0 && R.length > 0) {         
                    B = new this._Node(p, this._construct(L), this._construct(R), radius);
                } else {
                    B = new this._Leaf(elements);
                }
                return B;
            }
        }

        /**
         * @private
         * @param {Node} B 
         * @returns {Number}
         */
        _greatest_spread(B) {
            let d = B[0].element.length;
            let start = new Array(d);

            for (let i = 0; i < d; ++i) {
                start[i] = [Infinity, -Infinity];
            }

            let spread = B.reduce((acc, current) => {
                for (let i = 0; i < d; ++i) {
                    acc[i][0] = Math.min(acc[i][0], current.element[i]);
                    acc[i][1] = Math.max(acc[i][1], current.element[i]);
                }
                return acc;
            }, start);
            spread = spread.map(d => d[1] - d[0]);
            
            let c = 0;
            for (let i = 0; i < d; ++i) {
                c = spread[i] > spread[c] ? i : c;
            }
            return c
        }

        /**
         * 
         * @param {*} t - query element.
         * @param {Number} [k = 5] - number of nearest neighbors to return.
         * @returns {Heap} - Heap consists of the {@link k} nearest neighbors.
         */
        search(t, k = 5) {
            return this._search(t, k, new Heap(null, d => this._metric(d.element, t), "max"), this._root);
        }

        /**
         * @private
         * @param {*} t - query element.
         * @param {Number} [k = 5] - number of nearest neighbors to return.
         * @param {Heap} Q - Heap consists of the currently found {@link k} nearest neighbors.
         * @param {Node|Leaf} B 
         */
        _search(t, k, Q, B) {
            // B is Node
            if (Q.length >= k && B.pivot && B.radius && this._metric(t, B.pivot.element) - B.radius >= Q.first.value) {
                return Q;
            } 
            if (B.child1) this._search(t, k, Q, B.child1);
            if (B.child2) this._search(t, k, Q, B.child2);
            
            // B is leaf
            if (B.points) {
                for (let i = 0, n = B.points.length; i < n; ++i) {
                    let p = B.points[i];
                    if (k > Q.length) {
                        Q.push(p);
                    } else {
                        Q.push(p);
                        Q.pop();
                    }
                }
            }
            return Q;
        }


    }

    /**
     * Computes the QR Decomposition of the Matrix {@link A} using Gram-Schmidt process.
     * @memberof module:linear_algebra
     * @alias qr
     * @param {Matrix} A
     * @returns {{R: Matrix, Q: Matrix}}
     * @see {@link https://en.wikipedia.org/wiki/QR_decomposition#Using_the_Gram%E2%80%93Schmidt_process}
     */
    function qr(A) {
        const [rows, cols] = A.shape;
        const Q = new Matrix(rows, cols, "identity");
        const R = new Matrix(cols, cols, 0);

        for (let j = 0; j < cols; ++j) {
            let v = A.col(j);
            for (let i = 0; i < j; ++i) {
                const q = Q.col(i);
                const q_dot_v = neumair_sum(q.map((q_, k) => q_ * v[k]));
                R.set_entry(i,j, q_dot_v);
                v = v.map((v_, k) => v_ - q_dot_v * q[k]);
            }
            const v_norm = norm(v, euclidean);
            for (let k = 0; k < rows; ++k) {
                Q.set_entry(k, j, v[k] / v_norm);
            }
            R.set_entry(j,j, v_norm);
        }
        return {"R": R, "Q": Q};
    }

    function simultaneous_poweriteration(A, k = 2, max_iterations=100, seed=1212) {
        let randomizer;
        if (seed instanceof Randomizer) {
            randomizer = seed;
        } else {
            randomizer = new Randomizer(seed);
        }
        if (!(A instanceof Matrix)) A = Matrix.from(A);
        let n = A.shape[0];
        let { Q: Q, R: R } = qr(new Matrix(n, k, () => randomizer.random));
        while(max_iterations--) {
            let oldR = R.clone();
            let Z = A.dot(Q);
            let QR = qr(Z);
            [ Q, R ] = [ QR.Q, QR.R ]; 
            if (neumair_sum(R.sub(oldR).diag) / n < 1e-12) {
                max_iterations = 0;
            }        
        }

        let eigenvalues = R.diag;
        let eigenvectors = Q.transpose().to2dArray;//.map((d,i) => d.map(dd => dd * eigenvalues[i]))
        return {
            "eigenvalues": eigenvalues,
            "eigenvectors": eigenvectors
        };
    }

    /**
     * @class
     * @alias DR
     */
    class DR{
        static parameter_list = [];
        /**
         * 
         * @constructor
         * @memberof module:dimensionality_reduction
         * @alias DR
         * @param {Matrix|Array<Array<Number>>} X - the high-dimensional data. 
         * @param {number} [d = 2] - the dimensionality of the projection.
         * @param {function} [metric = euclidean] - the metric which defines the distance between two points.  
         * @param {seed} [seed=1987] - the seed value for the random number generator.
         * @returns {DR}
         */
        constructor(X, d=2, metric=euclidean, seed=1212) {
            if (Array.isArray(X)) {
                this._type = "array";
                this.X = Matrix.from(X);
            } else if (X instanceof Matrix) {
                this._type = "matrix";
                this.X = X;
            } else {
                throw "no valid type for X";
            }
            [this._N, this._D] = this.X.shape;
            this._d = d;
            this._metric = metric;
            this._seed = seed;
            this._randomizer = new Randomizer(seed);
            this._is_initialized = false;
            return this;
        }
            
        /**
         * Set and get parameters
         * @param {String} name - name of the parameter.
         * @param {Number} [value = null] - value of the parameter to set, if null then return actual parameter value.
         */
        parameter(name, value=null) {
            if (this.parameter_list.findIndex(parameter => parameter === name) === -1) {
                throw `${name} is not a valid parameter!`;
            } 
            if (value) {
                this[`_${name}`] = value;
                return this; 
            } else {
                return this[`_${name}`];
            }
        }

        /**
         * Alias for 'parameter'.
         * @param {String} name 
         * @param {Number} value 
         */
        para(name, value=null) {
            return this.parameter(name, value);
        }

        /**
         * Alias for 'parameter'.
         * @param {String} name 
         * @param {Number} value 
         */
        p(name, value=null) {
            return this.parameter(name, value);
        }

        /**
         * Computes the projection.
         * @returns {Matrix} Returns the projection.
         */
        transform() {
            this.check_init();
            return this.Y;
        }

        check_init() {
            if (!this._is_initialized && typeof this.init === "function") {
                this.init();
                this._is_initialized = true;
            }
        }

        /**
         * @returns {Matrix} Returns the projection.
         */
        get projection() {
            return this._type === "matrix" ? this.Y : this.Y.to2dArray;
        }

        async transform_async() {
            return this.transform();
        }
    }

    /**
     * @class
     * @alias PCA
     * @augments DR
     */
    class PCA extends DR{
        /**
         * @constructor
         * @memberof module:dimensionality_reduction
         * @alias PCA 
         * @param {Matrix|Array<Array<Number>>} X - the high-dimensional data.
         * @param {Number} [d = 2] - the dimensionality of the projection.
         * @returns {PCA}
         */
        constructor(X, d=2) {
            super(X, d);
            return this;
        }

        /**
         * Transforms the inputdata {@link X} to dimenionality {@link d}.
         */
        transform() {
            let X = this.X;
            let D = X.shape[1];
            let O = new Matrix(D, D, "center");
            let X_cent = X.dot(O);

            let C = X_cent.transpose().dot(X_cent);
            let { eigenvectors: V } = simultaneous_poweriteration(C, this._d);
            V = Matrix.from(V).transpose();
            this.Y = X.dot(V);
            return this.Y
        }
    }

    /**
     * @class
     * @alias MDS
     */
    class MDS extends DR{
        /**
         * 
         * @constructor
         * @memberof module:dimensionality_reduction
         * @alias MDS
         * @param {Matrix} X - the high-dimensional data.
         * @param {Number} neighbors - the label / class of each data point.
         * @param {Number} [d = 2] - the dimensionality of the projection.
         * @param {Function} [metric = euclidean] - the metric which defines the distance between two points.  
         * @param {Number} [seed = 1212] - the dimensionality of the projection.
         */
        
        constructor(X, d=2, metric=euclidean, seed=1212) {
            super(X, d, metric, seed);
            return this;
        }

        /**
         * Transforms the inputdata {@link X} to dimenionality {@link d}.
         */
        transform() {
            const X = this.X;
            //let sum_reduce = (a,b) => a + b
            const rows = X.shape[0];
            const metric = this._metric;
            let ai_ = [];
            let a_j = [];
            for (let i = 0; i < rows; ++i) {
                ai_.push(0);
                a_j.push(0);
            }
            let a__ = 0;
            const A = new Matrix();
            A.shape = [rows, rows, (i,j) => {
                let val = 0;
                if (i < j) {
                    val = metric(X.row(i), X.row(j));
                } else if (i > j) {
                    val = A.entry(j,i);
                }
                ai_[i] += val;
                a_j[j] += val;
                a__ += val;
                return val;
            }];
            this._d_X = A;
            ai_ = ai_.map(v => v / rows);
            a_j = a_j.map(v => v / rows);
            a__ /= (rows ** 2);
            const B = new Matrix(rows, rows, (i, j) => (A.entry(i, j) - ai_[i] - a_j[j] + a__));
            //B.shape = [rows, rows, (i,j) => (A.entry(i,j) - (A.row(i).reduce(sum_reduce) / rows) - (A.col(j).reduce(sum_reduce) / rows) + a__)]
                    
            const { eigenvectors: V } = simultaneous_poweriteration(B, this._d);
            this.Y = Matrix.from(V).transpose();
            
            return this.projection;
        }

        get stress() {
            const N = this.X.shape[0];
            const Y = this.Y;
            const d_X = this._d_X; /*new Matrix();
            d_X.shape = [N, N, (i, j) => {
                return i < j ? metric(X.row(i), X.row(j)) : d_X.entry(j, i);
            }]*/
            const d_Y = new Matrix();
            d_Y.shape = [N, N, (i, j) => {
                return i < j ? euclidean(Y.row(i), Y.row(j)) : d_Y.entry(j, i);
            }];
            let top_sum = 0;
            let bottom_sum = 0;
            for (let i = 0; i < N; ++i) {
                for (let j = i + 1; j < N; ++j) {
                    top_sum += Math.pow(d_X.entry(i, j) - d_Y.entry(i, j), 2);
                    bottom_sum += Math.pow(d_X.entry(i, j), 2);
                }
            }
            return Math.sqrt(top_sum / bottom_sum);
        }
    }

    /**
     * @class
     * @alias ISOMAP
     */
    class ISOMAP extends DR {
        /**
         * 
         * @constructor
         * @memberof module:dimensionality_reduction
         * @alias ISOMAP
         * @param {Matrix} X - the high-dimensional data. 
         * @param {Number} neighbors - the number of neighbors {@link ISOMAP} should use to project the data.
         * @param {Number} [d = 2] - the dimensionality of the projection. 
         * @param {Function} [metric = euclidean] - the metric which defines the distance between two points. 
         * @param {Number} [seed = 1212] - the dimensionality of the projection.
         */
        constructor(X, neighbors, d = 2, metric = euclidean, seed=1212) {
            super(X, d, metric, seed);
            super.parameter_list = ["k"];
            this._k = neighbors || Math.max(Math.floor(X.shape[0] / 10), 2);
        }

        /**
         * Computes the projection.
         * @returns {Matrix} Returns the projection.
         */
        transform() {
            let X = this.X;
            let rows = X.shape[0];
            // TODO: make knn extern and parameter for constructor or transform?
            let D = new Matrix();
            D.shape = [rows, rows, (i,j) => i <= j ? this._metric(X.row(i), X.row(j)) : D.entry(j,i)];
            let kNearestNeighbors = [];
            for (let i = 0; i < rows; ++i) {
                let row = D.row(i).map((d,i) => { 
                    return {
                        "index": i,
                        "distance": d
                    }
                });
                let H = new Heap(row, d => d.distance, "min");
                kNearestNeighbors.push(H.toArray().slice(1, this._k + 1));
            }
            
            /*D = dijkstra(kNearestNeighbors);*/
            // compute shortest paths
            // TODO: make extern
            /** @see {@link https://en.wikipedia.org/wiki/Floyd%E2%80%93Warshall_algorithm} */
            let G = new Matrix(rows, rows, (i,j) => {
                let other = kNearestNeighbors[i].find(n => n.index === j);
                return other ? other.distance : Infinity
            });

            for (let i = 0; i < rows; ++i) {
                for (let j = 0; j < rows; ++j) {
                    for (let k = 0; k < rows; ++k) {
                        G.set_entry(i, j, Math.min(G.entry(i, j), G.entry(i, k) + G.entry(k, j)));
                    }
                }
            }
            
            let ai_ = [];
            let a_j = [];
            for (let i = 0; i < rows; ++i) {
                ai_.push(0);
                a_j.push(0);
            }
            let a__ = 0;
            let A = new Matrix(rows, rows, (i,j) => {
                let val = G.entry(i, j);
                val = val === Infinity ? 0 : val;
                ai_[i] += val;
                a_j[j] += val;
                a__ += val;
                return val;
            });
            
            ai_ = ai_.map(v => v / rows);
            a_j = a_j.map(v => v / rows);
            a__ /= (rows ** 2);
            let B = new Matrix(rows, rows, (i,j) => (A.entry(i,j) - ai_[i] - a_j[j] + a__));
                 
            // compute d eigenvectors
            let { eigenvectors: V } = simultaneous_poweriteration(B, this._d);
            this.Y = Matrix.from(V).transpose();
            // return embedding
            return this.projection;
        }


        /**
         * Set and get parameters
         * @param {String} name - name of the parameter.
         * @param {Number} [value = null] - value of the parameter to set, if null then return actual parameter value.
         */
        parameter(name, value=null) {
            return super.parameter(name, value);
        }

        /**
         * Alias for 'parameter'.
         * @param {String} name 
         * @param {Number} value 
         */
        para(name, value=null) {
            return this.parameter(name, value);
        }

        /**
         * Alias for 'parameter'.
         * @param {String} name 
         * @param {Number} value 
         */
        p(name, value=null) {
            return this.parameter(name, value);
        }
    }

    /**
     * @class
     * @alias FASTMAP
     */
    class FASTMAP extends DR{
        /**
         * 
         * @constructor
         * @memberof module:dimensionality_reduction
         * @alias FASTMAP
         * @param {Matrix} X - the high-dimensional data. 
         * @param {Number} [d = 2] - the dimensionality of the projection.
         * @param {Function} [metric = euclidean] - the metric which defines the distance between two points.  
         * @param {Number} [seed = 1212] - the dimensionality of the projection.
         * @returns {FASTMAP}
         */
        constructor(X, d=2, metric=euclidean, seed=1212) {
            super(X, d, metric, seed);
            this._col = -1;
            return this;
        }

        /**
         * Chooses two points which are the most distant in the actual projection.
         * @private
         * @param {function} dist 
         * @returns {Array} An array consisting of first index, second index, and distance between the two points.
         */
        _choose_distant_objects(dist) {
            const X = this.X;
            const N = X.shape[0];
            let a_index = this._randomizer.random_int % N - 1;
            let b_index = null;
            let max_dist = -Infinity;
            for (let i = 0; i < N; ++i) {
                const d_ai = dist(a_index, i);
                if (d_ai > max_dist) {
                    max_dist = d_ai;
                    b_index = i;
                }
            }
            max_dist = -Infinity;
            for (let i = 0; i < N; ++i) {
                const d_bi = dist(b_index, i);
                if (d_bi > max_dist) {
                    max_dist = d_bi;
                    a_index = i;
                }
            }
            return [a_index, b_index, max_dist];
        }

        /**
         * Computes the projection.
         * @returns {Matrix} The {@link d}-dimensional projection of the data matrix {@link X}.
         */
        transform() {
            const X = this.X;
            const N = X.shape[0];
            const d = this._d;
            const metric = this._metric;
            const Y = new Matrix(N, d);
            let dist = (a, b) => metric(X.row(a), X.row(b));
            let old_dist = dist;

            while(this._col < d - 1) {
                this._col += 1;
                let _col = this._col;
                // choose pivot objects
                const [a_index, b_index, d_ab] = this._choose_distant_objects(dist);
                // record id of pivot objects
                //PA[0].push(a_index);
                //PA[1].push(b_index);
                if (d_ab === 0) {
                    // because all inter-object distances are zeros
                    for (let i = 0; i < N; ++i) {
                        Y.set_entry(i, _col, 0);
                    }
                } else {
                    // project the objects on the line (O_a, O_b)
                    for (let i = 0; i < N; ++i) {
                        const d_ai = dist(a_index, i);
                        const d_bi = dist(b_index, i);
                        const y_i = (d_ai ** 2 + d_ab ** 2 - d_bi ** 2) / (2 * d_ab);
                        Y.set_entry(i, _col, y_i);
                    }
                    // consider the projections of the objects on a
                    // hyperplane perpendicluar to the line (a, b);
                    // the distance function D'() between two 
                    // projections is given by Eq.4
                    dist = (a, b) => Math.sqrt((old_dist(a, b) ** 2) - ((Y.entry(a, _col) - Y.entry(b, _col)) ** 2));
                }
            }
            // return embedding
            this.Y = Y;
            return this.projection;
        }
    }

    /**
     * @class
     * @alias LDA
     */
    class LDA extends DR {
        static parameter_list = ["labels"];

        /**
         * 
         * @constructor
         * @memberof module:dimensionality_reduction
         * @alias LDA
         * @param {Matrix} X - the high-dimensional data.
         * @param {Array} labels - the label / class of each data point.
         * @param {number} [d = 2] - the dimensionality of the projection.
         * @param {function} [metric = euclidean] - the metric which defines the distance between two points.  
         * @param {Number} [seed = 1212] - the dimensionality of the projection.
         */
        constructor(X, labels, d = 2, metric = euclidean, seed=1212) {
            super(X, d, metric, seed);
            super.parameter_list = druid.LDA.parameter_list;
            this.parameter("labels", labels);
            return this;
        }

        /**
         * Transforms the inputdata {@link X} to dimenionality {@link d}.
         */
        transform() {
            let X = this.X;
            let [ rows, cols ] = X.shape;
            let labels = this._labels;
            let unique_labels = {};
            let label_id = 0;
            labels.forEach((l, i) => {
                if (l in unique_labels) {
                    unique_labels[l].count++;
                    unique_labels[l].rows.push(X.row(i));
                } else {
                    unique_labels[l] = {
                        "id": label_id++,
                        "count": 1,
                        "rows": [X.row(i)]
                    };
                }
            });
            
            // create X_mean and vector means;
            let X_mean = X.mean;
            let V_mean = new Matrix(label_id, cols);
            for (let label in unique_labels) {
                let V = Matrix.from(unique_labels[label].rows);
                let v_mean = V.meanCols;
                for (let j = 0; j < cols; ++j) {
                    V_mean.set_entry(unique_labels[label].id, j, v_mean[j]);
                }           
            }
            // scatter_between
            let S_b = new Matrix(cols, cols);
            for (let label in unique_labels) {
                let v = V_mean.row(unique_labels[label].id);
                let m = new Matrix(cols, 1, (j) => v[j] - X_mean);
                let N = unique_labels[label].count;
                S_b = S_b.add(m.dot(m.transpose()).mult(N));
            }

            // scatter_within
            let S_w = new Matrix(cols, cols);
            for (let label in unique_labels) {
                let v = V_mean.row(unique_labels[label].id);
                let m = new Matrix(cols, 1, (j) => v[j]);
                let R = unique_labels[label].rows;
                for (let i = 0, n = unique_labels[label].count; i < n; ++i) {
                    let row_v = new Matrix(cols, 1, (j,_) => R[i][j] - m.entry(j, 0));
                    S_w = S_w.add(row_v.dot(row_v.transpose()));
                }
            }

            let { eigenvectors: V } = simultaneous_poweriteration(S_w.inverse().dot(S_b), this.d);
            V = Matrix.from(V).transpose();
            this.Y = X.dot(V);

            // return embedding
            return this.projection;
        }
    }

    /**
     * @class
     * @alias LLE
     */
    class LLE extends DR {
        static parameter_list = ["k"];

        /**
         * 
         * @constructor
         * @memberof module:dimensionality_reduction
         * @alias LLE
         * @param {Matrix} X - the high-dimensional data.
         * @param {Number} neighbors - the label / class of each data point.
         * @param {Number} [d = 2] - the dimensionality of the projection.
         * @param {Function} [metric = euclidean] - the metric which defines the distance between two points.  
         * @param {Number} [seed = 1212] - the dimensionality of the projection.
         */
        constructor(X, neighbors, d=2, metric=euclidean, seed=1212) {
            super(X, d, metric, seed);
            super.parameter_list = druid.LLE.parameter_list;
            this.parameter("k", neighbors);
            return this;
        }

        /**
         * Transforms the inputdata {@link X} to dimenionality {@link d}.
         */
        transform() {
            const X = this.X;
            const d = this._d;
            const [ rows, cols ] = X.shape;
            const k = this._k;
            const nN = k_nearest_neighbors(X.to2dArray, k, null, this._metric);
            const O = new Matrix(k, 1, 1);
            const W = new Matrix(rows, rows);

            for (let row = 0; row < rows; ++row) {
                const Z = new Matrix(k, cols, (i, j) => X.entry(nN[row][i].j, j) - X.entry(row, j));
                const C = Z.dot(Z.transpose());
                if ( k > cols ) {
                    const C_trace = neumair_sum(C.diag) / 1000;
                    for (let j = 0; j < k; ++j) {
                        C.set_entry(j, j, C.entry(j, j) + C_trace);
                    }
                }

                // reconstruct;
                let w = Matrix.solve(C, O);
                const w_sum = neumair_sum(w.col(0));
                w = w.divide(w_sum);
                for (let j = 0; j < k; ++j) {
                    W.set_entry(row, nN[row][j].j, w.entry(j, 0));
                }
            }
            // comp embedding
            let I = new Matrix(rows, rows, "identity");
            let IW = I.sub(W);
            let M = IW.transpose().dot(IW);
            let { eigenvectors: V } = simultaneous_poweriteration(M.transpose().inverse(), d + 1);
            
            this.Y = Matrix.from(V.slice(1, 1 + d)).transpose();

            // return embedding
            return this.projection;
        }
    }

    /**
     * @class
     * @alias LTSA
     */
    class LTSA extends DR {
        static parameter_list = ["k"];

        /**
         * 
         * @constructor
         * @memberof module:dimensionality_reduction
         * @alias LTSA
         * @param {Matrix} X - the high-dimensional data.
         * @param {Number} neighbors - the label / class of each data point.
         * @param {Number} [d = 2] - the dimensionality of the projection.
         * @param {Function} [metric = euclidean] - the metric which defines the distance between two points.  
         * @param {Number} [seed = 1212] - the dimensionality of the projection.
         * @see {@link https://epubs.siam.org/doi/abs/10.1137/S1064827502419154}
         */
        constructor(X, neighbors, d=2, metric=euclidean, seed=1212) {
            super(X, d, metric, seed);
            super.parameter_list = druid.LTSA.parameter_list;
            this.parameter("k", neighbors || Math.max(Math.floor(this.X.shape[0] / 10), 2));
            return this;
        }

        /**
         * Transforms the inputdata {@link X} to dimenionality {@link d}.
         */
        transform() {
            const X = this.X;
            const d = this._d;
            const [ rows, D ] = X.shape;
            const k = this._k;
            // 1.1 determine k nearest neighbors
            const nN = k_nearest_neighbors(X.to2dArray, k, null, this._metric);
            // center matrix
            const O = new Matrix(D, D, "center");
            const B = new Matrix(rows, rows, 0);
            
            for (let row = 0; row < rows; ++row) {
                // 1.2 compute the d largest eigenvectors of the correlation matrix
                const I_i = [row, ...nN[row].map(n => n.j)];
                let X_i = Matrix.from(I_i.map(n => X.row(n)));
                // center X_i
                X_i = X_i.dot(O);
                // correlation matrix
                const C = X_i.dot(X_i.transpose());
                const { eigenvectors: g } = simultaneous_poweriteration(C, d);
                //g.push(linspace(0, k).map(_ => 1 / Math.sqrt(k + 1)));
                const G_i_t = Matrix.from(g);
                // 2. Constructing alignment matrix
                const W_i = G_i_t.transpose().dot(G_i_t).add(1 / Math.sqrt(k + 1));
                for (let i = 0; i < k + 1; ++i) {
                    for (let j = 0; j < k + 1; ++j) {
                        B.set_entry(I_i[i], I_i[j], B.entry(I_i[i], I_i[j]) - (i === j ? 1 : 0 ) + W_i.entry(i, j));
                    }
                }
            }

            // 3. Aligning global coordinates
            const { eigenvectors: Y } = simultaneous_poweriteration(B, d + 1);
            this.Y = Matrix.from(Y.slice(1)).transpose();

            // return embedding
            return this.projection;
        }
    }

    /**
     * @class
     * @alias TSNE
     */
    class TSNE extends DR {
        static parameter_list = ["perplexity", "epsilon"];

        /**
         * 
         * @constructor
         * @memberof module:dimensionality_reduction
         * @alias TSNE
         * @param {Matrix} X - the high-dimensional data. 
         * @param {Number} [perplexity = 50] - perplexity.
         * @param {Number} [epsilon = 10] - learning parameter.
         * @param {Number} [d = 2] - the dimensionality of the projection.
         * @param {Function} [metric = euclidean] - the metric which defines the distance between two points.  
         * @param {Number} [seed = 1212] - the dimensionality of the projection.
         * @returns {TSNE}
         */
        
        constructor(X, perplexity=50, epsilon=10, d=2, metric=euclidean, seed=1212) {
            super(X, d, metric, seed);
            super.parameter_list = druid.TSNE.parameter_list;
            [ this._N, this._D ] = X.shape;
            this.parameter("perplexity", Math.min(perplexity, this._N - 1));
            this.parameter("epsilon", epsilon);
            this._iter = 0;
            this.Y = new Matrix(this._N, this._d, () => this._randomizer.random);
            return this;
        }

        init(distance_matrix=null) {
            // init
            const Htarget = Math.log(this._perplexity);
            const N = this._N;
            const D = this._D;
            const metric = this._metric;
            const X = this.X;
            let Delta;
            if (distance_matrix) {
                Delta = distance_matrix;
            } else {
                Delta = new Matrix(N, N);
                for (let i = 0; i < N; ++i) {
                    for (let j = i + 1; j < N; ++j) {
                        const distance = metric(X.row(i), X.row(j));
                        Delta.set_entry(i, j, distance);
                        Delta.set_entry(j, i, distance);
                    }
                }

            } 
                
            const P = new Matrix(N, N, "zeros");

            this._ystep = new Matrix(N, D, "zeros");
            this._gains = new Matrix(N, D, 1);

            // search for fitting sigma
            let prow = new Array(N).fill(0);
            const tol = 1e-4;
            const maxtries = 50;
            for (let i = 0; i < N; ++i) {
                let betamin = -Infinity;
                let betamax = Infinity;
                let beta = 1;
                let done = false;

                let num = 0;
                while(!done) {
                    let psum = 0;
                    for (let j = 0; j < N; ++j) {
                        let pj = Math.exp(-Delta.entry(i, j) * beta);
                        if (i === j) pj = 0;
                        prow[j] = pj;
                        psum += pj;
                    }
                    let Hhere = 0;
                    for (let j = 0; j < N; ++j) {
                        let pj = (psum === 0) ? 0 : prow[j] / psum;
                        prow[j] = pj;
                        if (pj > 1e-7) {
                            Hhere -= pj * Math.log(pj);
                        }
                    }
                    if (Hhere > Htarget) {
                        betamin = beta;
                        beta = (betamax === Infinity) ? (beta * 2) : ((beta + betamax) / 2);
                    } else {
                        betamax = beta;
                        beta = (betamin === -Infinity) ? (beta / 2) : ((beta + betamin) / 2);
                    }
                    ++num;
                    if (Math.abs(Hhere - Htarget) < tol) done = true;
                    if (num >= maxtries) done = true;
                }

                for (let j = 0; j < N; ++j) {
                    P.set_entry(i, j, prow[j]);
                }
            }

            //compute probabilities
            const Pout = new Matrix(N, N, "zeros");
            const N2 = N * 2;
            for (let i = 0; i < N; ++i) {
                for (let j = i; j < N; ++j) {
                    const p = Math.max((P.entry(i, j) + P.entry(j, i)) / N2, 1e-100);
                    Pout.set_entry(i, j, p);
                    Pout.set_entry(j, i, p);
                }
            }
            this._P = Pout;
            return this;
        }

        transform(iterations=500) {
            this.check_init();
            for (let i = 0; i < iterations; ++i) {
                this.next();
            }
            return this.projection;
        }

        * generator() {
            this.check_init();
            while (true) {
                this.next();
                yield {
                    "projection": this.projection,
                    "iteration": this._iter,
                };
            }
        }

        // perform optimization
        next() {
            const iter = ++this._iter;
            const P = this._P;
            const ystep = this._ystep;
            const gains = this._gains;
            const N = this._N;
            const epsilon = this._epsilon;
            const dim = this._d;
            let Y = this.Y;

            //calc cost gradient;
            const pmul = iter < 100 ? 4 : 1;
            
            // compute Q dist (unnormalized)
            const Qu = new Matrix(N, N, "zeros");
            let qsum = 0;
            for (let i = 0; i < N; ++i) {
                for (let j = i + 1; j < N; ++j) {
                    let dsum = 0;
                    for (let d = 0; d < dim; ++d) {
                        const dhere = Y.entry(i, d) - Y.entry(j, d);
                        dsum += dhere * dhere;
                    }
                    const qu = 1 / (1 + dsum);
                    Qu.set_entry(i, j, qu);
                    Qu.set_entry(j, i, qu);
                    qsum += 2 * qu;
                }
            }

            // normalize Q dist
            const Q = new Matrix(N, N, 0);
            for (let i = 0; i < N; ++i) {
                for (let j = i + 1; j < N; ++j) {
                    const val = Math.max(Qu.entry(i, j) / qsum, 1e-100);
                    Q.set_entry(i, j, val);
                    Q.set_entry(j, i, val);
                }
            }

            //let cost = 0;
            //let grad = [];
            const grad = new Matrix(N, dim, "zeros");
            for (let i = 0; i < N; ++i) {
                //let gsum = new Float64Array(dim);//Array(dim).fill(0);
                for (let j = 0; j < N; ++j) {
                    //cost += -P.entry(i, j) * Math.log(Q.entry(i, j));
                    const premult = 4 * (pmul * P.entry(i, j) - Q.entry(i, j)) * Qu.entry(i, j);
                    for (let d = 0; d < dim; ++d) {
                        //gsum[d] += premult * (Y.entry(i, d) - Y.entry(j, d));
                        grad.set_entry(i, d, grad.entry(i, d) + premult * (Y.entry(i, d) - Y.entry(j, d)));
                    }
                }
                //grad.push(gsum);
            }

            // perform gradient step
            let ymean = new Float64Array(dim);
            for (let i = 0; i < N; ++i) {
                for (let d = 0; d < dim; ++d) {
                    const gid = grad.entry(i, d);
                    const sid = ystep.entry(i, d);
                    const gainid = gains.entry(i, d);
                    
                    let newgain = Math.sign(gid) === Math.sign(sid) ? gainid * .8 : gainid + .2;
                    if (newgain < .01) newgain = .01;
                    gains.set_entry(i, d, newgain);

                    const momval = iter < 250 ? .5 : .8;
                    const newsid = momval * sid - epsilon * newgain * gid;
                    ystep.set_entry(i, d, newsid);

                    Y.set_entry(i, d, Y.entry(i, d) + newsid);
                    ymean[d] += Y.entry(i, d);
                }
            }

            for (let i = 0; i < N; ++i) {
                for (let d = 0; d < 2; ++d) {
                    Y.set_entry(i, d, Y.entry(i, d) - ymean[d] / N);
                }
            }

            return this.Y;
        }
    }

    // http://optimization-js.github.io/optimization-js/optimization.js.html#line438
    function powell(f, x0, max_iter=300) {
        const epsilon = 1e-2;
        const n = x0.length;
        let alpha = 1e-3;
        let pfx = 10000;
        let x = x0.slice();
        let fx = f(x);
        let convergence = false;
        
        while (max_iter-- >= 0 && !convergence) {
            convergence = true;
            for (let i = 0; i < n; ++i) {
                x[i] += 1e-6;
                let fxi = f(x);
                x[i] -= 1e-6;
                let dx = (fxi - fx) / 1e-6;
                if (Math.abs(dx) > epsilon) {
                    convergence = false;
                }
                x[i] -= alpha * dx;
                fx = f(x);
            }
            alpha *= (pfx >= fx ? 1.05 : 0.4);
            pfx = fx;
        }
        return x;
    }

    class UMAP extends DR {
        static parameter_list = ["local_connectivity", "min_dist"];

        constructor(X, local_connectivity=1, min_dist=1, d=2, metric=euclidean, seed=1212) {
            super(X, d, metric, seed);
            super.parameter_list = druid.UMAP.parameter_list;
            [ this._N, this._D ] = X.shape;
            this.parameter("local_connectivity", local_connectivity);
            this.parameter("min_dist", min_dist);
            this._iter = 0;
            this._n_neighbors = 11;
            this._spread = 1;
            this._set_op_mix_ratio = 1;
            this._repulsion_strength = 1;
            this._negative_sample_rate = 5;
            this._n_epochs = 350;
            this._initial_alpha = 1;
            this.Y = new Matrix(this._N, this._d, () => this._randomizer.random);
        }

        _find_ab_params(spread, min_dist) {
            function curve(x, a, b) {
                return 1 / (1 + a * Math.pow(x, 2 * b));
            }
          
            var xv = linspace(0, spread * 3, 300);
            var yv = linspace(0, spread * 3, 300);
            
            for ( var i = 0, n = xv.length; i < n; ++i ) {
                if (xv[i] < min_dist) {
                    yv[i] = 1;
                } else {
                    yv[i] = Math.exp(-(xv[i] - min_dist) / spread);
                }
            }
          
            function err(p) {
                var error = linspace(1, 300).map((_, i) => yv[i] - curve(xv[i], p[0], p[1]));
                return Math.sqrt(neumair_sum(error.map(e => e * e)));
            }
          
            var [ a, b ] = powell(err, [1, 1]);
            return [ a, b ]
        }

        _compute_membership_strengths(distances, sigmas, rhos) {
            for (let i = 0, n = distances.length; i < n; ++i) {
                for (let j = 0, m = distances[i].length; j < m; ++j) {
                    let v = distances[i][j].value - rhos[i];
                    let value = 1;
                    if (v > 0) {
                        value = Math.exp(-v / sigmas[i]);
                    }
                    distances[i][j].value = value;
                }
            }
            return distances;
        }

        _smooth_knn_dist(knn, k) {
            const SMOOTH_K_TOLERANCE = 1e-5;
            const MIN_K_DIST_SCALE = 1e-3;
            const n_iter = 64;
            const local_connectivity = this._local_connectivity;
            const bandwidth = 1;
            const target = Math.log2(k) * bandwidth;
            const rhos = [];
            const sigmas = [];
            const X = this.X;

            let distances = [];
            for (let i = 0, n = X.shape[0]; i < n; ++i) {
                let x_i = X.row(i);
                distances.push(knn.search(x_i, Math.max(local_connectivity, k)).raw_data().reverse());
            }

            for (let i = 0, n = X.shape[0]; i < n; ++i) {
                let search_result = distances[i];
                rhos.push(search_result[0].value);

                let lo = 0;
                let hi = Infinity;
                let mid = 1;

                for (let x = 0; x < n_iter; ++x) {
                    let psum = 0;
                    for (let j = 0; j < k; ++j) {
                        let d = search_result[j].value - rhos[i];
                        psum += (d > 0 ? Math.exp(-(d / mid)) : 1);
                    }
                    if (Math.abs(psum - target) < SMOOTH_K_TOLERANCE) {
                        break;
                    }
                    if (psum > target) {
                        //[hi, mid] = [mid, (lo + hi) / 2];
                        hi = mid;
                        mid = (lo + hi) / 2; // PROBLEM mit hi?????
                    } else {
                        lo = mid;
                        if (hi === Infinity) {
                            mid *= 2;
                        } else {
                            mid = (lo + hi) / 2;
                        }
                    }
                }
                sigmas[i] = mid;

                const mean_ithd = search_result.reduce((a, b) => a + b.value, 0) / search_result.length;
                //let mean_d = null;
                if (rhos[i] > 0) {
                    if (sigmas[i] < MIN_K_DIST_SCALE * mean_ithd) {
                        sigmas[i] = MIN_K_DIST_SCALE * mean_ithd;
                    }
                } else {
                    const mean_d = distances.reduce((acc, res) => acc + res.reduce((a, b) => a + b.value, 0) / res.length);
                    if (sigmas[i] > MIN_K_DIST_SCALE * mean_d) {
                        sigmas[i] = MIN_K_DIST_SCALE * mean_d;
                    }
                    
                }
            }
            return {
                "distances": distances, 
                "sigmas": sigmas, 
                "rhos": rhos
            }
        }

        _fuzzy_simplicial_set(X, n_neighbors) {
            const knn = new BallTree(X.to2dArray, euclidean);
            let { distances, sigmas, rhos } = this._smooth_knn_dist(knn, n_neighbors);
            distances = this._compute_membership_strengths(distances, sigmas, rhos);
            let result = new Matrix(X.shape[0], X.shape[0], "zeros");
            for (let i = 0, n = X.shape[0]; i < n; ++i) {
                for (let j = 0; j < n_neighbors; ++j) {
                    result.set_entry(i, distances[i][j].element.index, distances[i][j].value);
                }
            }
            const transposed_result = result.T;
            const prod_matrix = result.mult(transposed_result);
            result = result
                .add(transposed_result)
                .sub(prod_matrix)
                .mult(this._set_op_mix_ratio)
                .add(prod_matrix.mult(1 - this._set_op_mix_ratio));
            return result;
        }

        _make_epochs_per_sample(graph, n_epochs) {
            const { data: weights } = this._tocoo(graph);
            let result = new Array(weights.length).fill(-1);
            const weights_max = Math.max(...weights);
            const n_samples = weights.map(w => n_epochs * (w / weights_max));
            result = result.map((d, i) => (n_samples[i] > 0) ? Math.round(n_epochs / n_samples[i]) : d);
            return result;
        }

        _tocoo(graph) {
            const rows = [];
            const cols = [];
            const data = [];
            const [ rows_n, cols_n ] = graph.shape;
            for (let row = 0; row < rows_n; ++row) {
                for (let col = 0; col < cols_n; ++col) {
                    const entry = graph.entry(row, col);
                    if (entry !== 0) {
                        rows.push(row);
                        cols.push(col);
                        data.push(entry);
                    }
                }
            }
            return {rows: rows, cols: cols, data: data};
        }

        init() {
            const [ a, b ] = this._find_ab_params(this._spread, this._min_dist);
            this._a = a;
            this._b = b;
            this._graph = this._fuzzy_simplicial_set(this.X, this._n_neighbors);
            this._epochs_per_sample = this._make_epochs_per_sample(this._graph, this._n_epochs);
            this._epochs_per_negative_sample = this._epochs_per_sample.map(d => d * this._negative_sample_rate);
            this._epoch_of_next_sample = this._epochs_per_sample.slice();
            this._epoch_of_next_negative_sample = this._epochs_per_negative_sample.slice();
            const { rows, cols } = this._tocoo(this._graph);
            this._head = rows;
            this._tail = cols;
            return this
        }

        set local_connectivity(value) {
            this._local_connectivity = value;
        }

        get local_connectivity() {
            return this._local_connectivity;
        }

        set min_dist(value) {
            this._min_dist = value;
        }

        get min_dist() {
            return this._min_dist;
        }

        transform(iterations) {
            this.check_init();
            iterations = iterations || this._n_epochs;
            for (let i = 0; i < iterations; ++i) {
                this.next();
            }
            return this.projection;
        }

        * generator() {
            this.check_init();
            this._iter = 0;
            while (this._iter < this._n_epochs) {
                this.next();
                yield this.projection;
            }
            return this.projection;
        }

        _clip(x) {
            if (x > 4) return 4;
            if (x < -4) return -4;
            return x;
        }

        _optimize_layout(head_embedding, tail_embedding, head, tail) {
            const { 
                _d: dim, 
                _alpha: alpha, 
                _repulsion_strength: repulsion_strength, 
                _a: a, 
                _b: b,
                _epochs_per_sample: epochs_per_sample,
                _epochs_per_negative_sample: epochs_per_negative_sample,
                _epoch_of_next_negative_sample: epoch_of_next_negative_sample,
                _epoch_of_next_sample: epoch_of_next_sample,
                _clip: clip
            } = this;
            const tail_length = tail.length;

            for (let i = 0, n = epochs_per_sample.length; i < n; ++i) {
                if (epoch_of_next_sample[i] <= this._iter) {
                    const j = head[i];
                    const k = tail[i];
                    const current = head_embedding.row(j);
                    const other = tail_embedding.row(k);
                    const dist = euclidean(current, other);//this._metric(current, other);
                    let grad_coeff = 0;
                    if (dist > 0) {
                        grad_coeff = (-2 * a * b * Math.pow(dist, b - 1)) / (a * Math.pow(dist, b) + 1);
                    }
                    for (let d = 0; d < dim; ++d) {
                        const grad_d = clip(grad_coeff * (current[d] - other[d])) * alpha;
                        const c = current[d] + grad_d;
                        const o = other[d] - grad_d;
                        current[d] = c;
                        other[d] = o;
                        head_embedding.set_entry(j, d, c);
                        tail_embedding.set_entry(k, d, o);
                    }
                    epoch_of_next_sample[i] += epochs_per_sample[i];
                    const n_neg_samples = (this._iter - epoch_of_next_negative_sample[i]) / epochs_per_negative_sample[i];
                    for (let p = 0; p < n_neg_samples; ++p) {
                        const k = Math.floor(this._randomizer.random * tail_length);
                        const other = tail_embedding.row(tail[k]);
                        const dist = euclidean(current, other);//this._metric(current, other);
                        let grad_coeff = 0;
                        if (dist > 0) {
                            grad_coeff = (2 * repulsion_strength * b) / ((.01 + dist) * (a * Math.pow(dist, b) + 1));
                        } else if (j == k) {
                            continue;
                        }
                        for (let d = 0; d < dim; ++d) {
                            const grad_d = clip(grad_coeff * (current[d] - other[d])) * alpha;
                            const c = current[d] + grad_d;
                            const o = other[d] - grad_d;
                            current[d] = c;
                            other[d] = o;
                            head_embedding.set_entry(j, d, c);
                            tail_embedding.set_entry(tail[k], d, o);
                        }
                    }
                    epoch_of_next_negative_sample[i] += (n_neg_samples * epochs_per_negative_sample[i]);
                }
            }
            return head_embedding;
        }

        next() {
            let iter = ++this._iter;
            let Y = this.Y;

            this._alpha = (this._initial_alpha * (1 - iter / this._n_epochs));
            this.Y = this._optimize_layout(Y, Y, this._head, this._tail);

            return this.Y;
        }
    }

    /**
     * @class
     * @alias TriMap
     */
    class TriMap extends DR{
        static parameter_list = ["weight_adj", "c"];
        /**
         * 
         * @constructor
         * @memberof module:dimensionality_reduction
         * @alias TriMap
         * @param {Matrix} X - the high-dimensional data. 
         * @param {Number} [weight_adj = 500] - scaling factor.
         * @param {Number} [c = 5] - number of triplets multiplier.
         * @param {Number} [d = 2] - the dimensionality of the projection.
         * @param {Function} [metric = euclidean] - the metric which defines the distance between two points.  
         * @param {Number} [seed = 1212] - the dimensionality of the projection.
         * @returns {TriMap}
         * @see {@link https://arxiv.org/pdf/1910.00204v1.pdf}
         * @see {@link https://github.com/eamid/trimap}
         */
        constructor(X, weight_adj = 500, c = 5, d = 2, metric = euclidean, seed=1212) {
            super(X, d, metric, seed);
            super.parameter_list = druid.TriMap.parameter_list;
            this.parameter("weight_adj", weight_adj);
            this.parameter("c", c);
            return this;
        }

        /**
         * 
         * @param {Matrix} [pca = null] - Initial Embedding (if null then PCA gets used). 
         * @param {KNN} [knn = null] - KNN Object (if null then BallTree gets used). 
         */
        init(pca = null, knn = null) {
            const X = this.X;
            const N = X.shape[0];
            const d = this._d;
            const metric = this._metric;
            const c = this._c;
            this.n_inliers = 2 * c;
            this.n_outliers = 1 * c;
            this.n_random = 1 * c;
            this.Y = pca || new PCA(X, d).transform();//.mult(.01);
            this.knn = knn || new BallTree(X.to2dArray, metric);
            const {triplets, weights} = this._generate_triplets(this.n_inliers, this.n_outliers, this.n_random);
            this.triplets = triplets;
            this.weights = weights;
            this.lr = 1000 * N / triplets.shape[0];
            this.C = Infinity;
            this.tol = 1e-7;
            this.vel = new Matrix(N, d, 0);
            this.gain = new Matrix(N, d, 1);
            return this;
        }

        /**
         * Generates {@link n_inliers} x {@link n_outliers} x {@link n_random} triplets.
         * @param {Number} n_inliers 
         * @param {Number} n_outliers 
         * @param {Number} n_random 
         */
        _generate_triplets(n_inliers, n_outliers, n_random) {
            const metric = this._metric;
            const weight_adj = this._weight_adj;
            const X = this.X;
            const N = X.shape[0];
            const knn = this.knn;
            const n_extra = Math.min(n_inliers + 20, N);
            const nbrs = new Matrix(N, n_extra);
            const knn_distances = new Matrix(N, n_extra);
            for (let i = 0; i < N; ++i) {
                knn.search(X.row(i), n_extra + 1)
                    .raw_data()
                    .filter(d => d.value != 0)
                    .sort((a, b) => a.value - b.value)
                    .forEach((d, j) => {
                        nbrs.set_entry(i, j, d.element.index);
                        knn_distances.set_entry(i, j, d.value);
                    });
            }
            // scale parameter
            const sig = new Float64Array(N);
            for (let i = 0; i < N; ++i) {
                sig[i] = Math.max(
                       (knn_distances.entry(i, 3) +
                        knn_distances.entry(i, 4) +
                        knn_distances.entry(i, 5) +
                        knn_distances.entry(i, 6)) / 4,
                        1e-10);
            }
            
            const P = this._find_p(knn_distances, sig, nbrs);
            
            let triplets = this._sample_knn_triplets(P, nbrs, n_inliers, n_outliers);
            let n_triplets = triplets.shape[0];
            const outlier_distances = new Float64Array(n_triplets);
            for (let i = 0; i < n_triplets; ++i) {
                const j = triplets.entry(i, 0);
                const k = triplets.entry(i, 2);
                outlier_distances[i] = metric(X.row(j), X.row(k));
            }
            let weights = this._find_weights(triplets, P, nbrs, outlier_distances, sig);
            
            if (n_random > 0) {
                const {random_triplets, random_weights} = this._sample_random_triplets(X, n_random, sig);
                triplets = triplets.concat(random_triplets, "vertical");
                weights = Float64Array.from([...weights, ...random_weights]);
            }
            n_triplets = triplets.shape[0];
            let max_weight = -Infinity;
            for (let i = 0; i < n_triplets; ++i) {
                if (isNaN(weights[i])) {weights[i] = 0;}
                if (max_weight < weights[i]) max_weight = weights[i];
            }
            let max_weight_2 = -Infinity;
            for (let i = 0; i < n_triplets; ++i) {
                weights[i] /= max_weight;
                weights[i] += .0001;
                weights[i] = Math.log(1 + weight_adj * weights[i]);
                if (max_weight_2 < weights[i]) max_weight_2 = weights[i];
            }
            for (let i = 0; i < n_triplets; ++i) {
                weights[i] /= max_weight_2;
            }
            return {
                "triplets": triplets,
                "weights": weights,
            }
        }

        /**
         * Calculates the similarity matrix P
         * @private
         * @param {Matrix} knn_distances - matrix of pairwise knn distances
         * @param {Float64Array} sig - scaling factor for the distances
         * @param {Matrix} nbrs - nearest neighbors
         * @returns {Matrix} pairwise similarity matrix
         */
        _find_p(knn_distances, sig, nbrs) {
            const [N, n_neighbors] = knn_distances.shape;
            return new Matrix(N, n_neighbors, (i, j) => {
                return Math.exp(-((knn_distances.entry(i, j) ** 2) / sig[i] / sig[nbrs.entry(i, j)]));
            });
        }

        /**
         * Sample nearest neighbors triplets based on the similarity values given in P.
         * @private
         * @param {Matrix} P - Matrix of pairwise similarities between each point and its neighbors given in matrix nbrs.
         * @param {Matrix} nbrs - Nearest neighbors indices for each point. The similarity values are given in matrix {@link P}. Row i corresponds to the i-th point.
         * @param {Number} n_inliers - Number of inlier points.
         * @param {Number} n_outliers - Number of outlier points.
         * 
         */
        _sample_knn_triplets(P, nbrs, n_inliers, n_outliers) {
            const N = nbrs.shape[0];
            const triplets = new Matrix(N * n_inliers * n_outliers, 3);
            for (let i = 0; i < N; ++i) {
                let n_i = i * n_inliers * n_outliers;
                const sort_indices = this.__argsort(P.row(i).map(d => -d));
                for (let j = 0; j < n_inliers; ++j) {
                    let n_j = j * n_outliers;
                    const sim = nbrs.entry(i, sort_indices[j]);
                    const samples = this._rejection_sample(n_outliers, N, sort_indices.slice(0, j + 1));
                    for (let k = 0; k < n_outliers; ++k) {
                        const index = n_i + n_j + k;
                        const out = samples[k];
                        triplets.set_entry(index, 0, i);
                        triplets.set_entry(index, 1, sim);
                        triplets.set_entry(index, 2, out);
                    }
                }
            }
            return triplets;
        }

        /**
         * Should do the same as np.argsort()
         * @private
         * @param {Array} A 
         */
        __argsort(A) {
            return A
                .map((d, i) => {return {d: d, i: i};})
                .sort((a, b) => a.d - b.d)
                .map((d) => d.i);
        }

        /**
         * Samples {@link n_samples} integers from a given interval [0, {@link max_int}] while rejection the values that are in the {@link rejects}.
         * @private
         * @param {*} n_samples 
         * @param {*} max_int 
         * @param {*} rejects 
         */
        _rejection_sample(n_samples, max_int, rejects) {
            const randomizer = this._randomizer;
            const interval = linspace(0, max_int - 1).filter(d => rejects.indexOf(d) < 0);
            return randomizer.choice(interval, Math.min(n_samples, interval.length - 2));
        }

        /**
         * Calculates the weights for the sampled nearest neighbors triplets
         * @private
         * @param {Matrix} triplets - Sampled Triplets.
         * @param {Matrix} P - Pairwise similarity matrix.
         * @param {Matrix} nbrs - nearest Neighbors
         * @param {Float64Array} outlier_distances - Matrix of pairwise outlier distances
         * @param {Float64Array} sig - scaling factor for the distances.
         */
        _find_weights(triplets, P, nbrs, outlier_distances, sig) {
            const n_triplets = triplets.shape[0];
            const weights = new Float64Array(n_triplets);
            for (let t = 0; t < n_triplets; ++t) {
                const i = triplets.entry(t, 0);
                const sim = nbrs.row(i).indexOf(triplets.entry(t, 1));
                const p_sim = P.entry(i, sim);
                let p_out = Math.exp(-(outlier_distances[t] ** 2 / (sig[i] * sig[triplets.entry(t, 2)])));
                if (p_out < 1e-20) p_out = 1e-20;
                weights[t] = p_sim / p_out;
            }
            return weights;
        }

        /**
         * Sample uniformly ranom triplets
         * @private
         * @param {Matrix} X - Data matrix.
         * @param {Number} n_random - Number of random triplets per point
         * @param {Float64Array} sig - Scaling factor for the distances
         */
        _sample_random_triplets(X, n_random, sig) {
            const metric = this._metric;
            const randomizer = this._randomizer;
            const N = X.shape[0];
            const random_triplets = new Matrix(N * n_random, 3);
            const random_weights = new Float64Array(N * n_random);
            for (let i = 0; i < N; ++i) {
                const n_i = i * n_random;
                const indices = [...linspace(0, i - 1), ...linspace(i + 1, N - 1)];
                for (let j = 0; j < n_random; ++j) {
                    let [sim, out] = randomizer.choice(indices, 2);
                    let p_sim = Math.exp(-((metric(X.row(i), X.row(sim)) ** 2) / (sig[i] * sig[sim])));
                    if (p_sim < 1e-20) p_sim = 1e-20;
                    let p_out = Math.exp(-((metric(X.row(i), X.row(out)) ** 2) / (sig[i] * sig[out]))); 
                    if (p_out < 1e-20) p_out = 1e-20;

                    if (p_sim < p_out) {
                        [sim, out] = [out, sim];
                        [p_sim, p_out] = [p_out, p_sim];
                    }
                    const index = n_i + j;
                    random_triplets.set_entry(index, 0, i);
                    random_triplets.set_entry(index, 1, sim);
                    random_triplets.set_entry(index, 2, out);
                    random_weights[index] = p_sim / p_out;
                }
            }
            return {
                "random_triplets": random_triplets,
                "random_weights": random_weights,
            }
        }

        /**
         * Computes the gradient for updating the embedding.
         * @param {Matrix} Y - The embedding
         */
        _grad(Y) {
            const n_inliers = this.n_inliers;
            const n_outliers = this.n_outliers;
            const triplets = this.triplets;
            const weights = this.weights;
            const [N, dim] = Y.shape;
            const n_triplets = triplets.shape[0];
            const grad = new Matrix(N, dim, 0);
            let y_ij = new Array(dim).fill(0);
            let y_ik = new Array(dim).fill(0);
            let d_ij = 1;
            let d_ik = 1;
            let n_viol = 0;
            let loss = 0;
            const n_knn_triplets = N * n_inliers * n_outliers;

            for (let t = 0; t < n_triplets; ++t) {
                const [i, j, k] = triplets.row(t);
                // update y_ij, y_ik, d_ij, d_ik
                if (t % n_outliers == 0 || t >= n_knn_triplets) {
                    d_ij = 1;
                    d_ik = 1;
                    for (let d = 0; d < dim; ++d) {
                        const Y_id = Y.entry(i, d);
                        const Y_jd = Y.entry(j, d);
                        const Y_kd = Y.entry(k, d);
                        y_ij[d] = Y_id - Y_jd;
                        y_ik[d] = Y_id - Y_kd;
                        d_ij += (y_ij[d] ** 2);
                        d_ik += (y_ik[d] ** 2);
                    }
                // update y_ik and d_ik only
                } else {
                    d_ik = 1;
                    for (let d = 0; d < dim; ++d) {
                        const Y_id = Y.entry(i, d);
                        const Y_kd = Y.entry(k, d);
                        y_ik[d] = Y_id - Y_kd;
                        d_ik += (y_ik[d] ** 2);
                    }
                }

                if (d_ij > d_ik) ++n_viol;
                loss += weights[t] / (1 + d_ik / d_ij);
                const w = (weights[t] / (d_ij + d_ik)) ** 2;
                for (let d = 0; d < dim; ++d) {
                    const gs = y_ij[d] * d_ik * w;
                    const go = y_ik[d] * d_ij * w;
                    grad.set_entry(i, d, grad.entry(i, d) + gs - go);
                    grad.set_entry(j, d, grad.entry(j, d) - gs);
                    grad.set_entry(k, d, grad.entry(k, d) + go);
                }
            }
            return {
                "grad": grad,
                "loss": loss,
                "n_viol": n_viol,
            };
        }

        /**
         * 
         * @param {Number} max_iteration 
         */
        transform(max_iteration = 400) {
            this.check_init();
            for (let iter = 0; iter < max_iteration; ++iter) {
                this._next(iter);
            }
            return this.Y;
        }

        /**
         * @yields {Matrix}
         * @returns {Matrix}
         */
        * generator() {
            this.check_init();
            for (let iter = 0; iter < 800; ++iter) {
                yield this._next(iter);
            }
            return this.Y;
        }

        /**
         * Does the iteration step.
         * @private
         * @param {Number} iter 
         */
        _next(iter) {
            const gamma = iter > 150 ? .5 : .3;
            const old_C = this.C;
            const vel = this.vel;
            const Y = this.Y.add(vel.mult(gamma));
            const {grad, loss, n_viol} = this._grad(Y);
            this.C = loss;
            this.Y = this._update_embedding(Y, iter, grad);
            this.lr *= (old_C > loss + this.tol)  ? 1.01 : .9;
            return this.Y;
        }

        /**
         * Updates the embedding.
         * @private
         * @param {Matrix} Y 
         * @param {Number} iter 
         * @param {Matrix} grad 
         */
        _update_embedding(Y, iter, grad) {
            const [N, dim] = Y.shape;
            const gamma = iter > 150 ? .9 : .5; // moment parameter
            const min_gain = .01;
            const gain = this.gain;
            const vel = this.vel;
            const lr = this.lr;
            for (let i = 0; i < N; ++i) {
                for (let d = 0; d < dim; ++d) {
                    const new_gain = (Math.sign(vel.entry(i, d)) != Math.sign(grad.entry(i, d))) ? gain.entry(i, d) + .2 : Math.max(gain.entry(i, d) * .8, min_gain);
                    gain.set_entry(i, d, new_gain);
                    vel.set_entry(i, d, gamma * vel.entry(i, d) - lr * gain.entry(i, d) * grad.entry(i, d));
                    Y.set_entry(i, d, Y.entry(i, d) + vel.entry(i, d));
                }
            }
            return Y;
        }
    }

    var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

    function createCommonjsModule(fn, basedir, module) {
    	return module = {
    	  path: basedir,
    	  exports: {},
    	  require: function (path, base) {
          return commonjsRequire(path, (base === undefined || base === null) ? module.path : base);
        }
    	}, fn(module, module.exports), module.exports;
    }

    function commonjsRequire () {
    	throw new Error('Dynamic requires are not currently supported by @rollup/plugin-commonjs');
    }

    var download = createCommonjsModule(function (module, exports) {
    //download.js v4.2, by dandavis; 2008-2016. [MIT] see http://danml.com/download.html for tests/usage
    // v1 landed a FF+Chrome compat way of downloading strings to local un-named files, upgraded to use a hidden frame and optional mime
    // v2 added named files via a[download], msSaveBlob, IE (10+) support, and window.URL support for larger+faster saves than dataURLs
    // v3 added dataURL and Blob Input, bind-toggle arity, and legacy dataURL fallback was improved with force-download mime and base64 support. 3.1 improved safari handling.
    // v4 adds AMD/UMD, commonJS, and plain browser support
    // v4.1 adds url download capability via solo URL argument (same domain/CORS only)
    // v4.2 adds semantic variable names, long (over 2MB) dataURL support, and hidden by default temp anchors
    // https://github.com/rndme/download

    (function (root, factory) {
    	{
    		// Node. Does not work with strict CommonJS, but
    		// only CommonJS-like environments that support module.exports,
    		// like Node.
    		module.exports = factory();
    	}
    }(commonjsGlobal, function () {

    	return function download(data, strFileName, strMimeType) {

    		var self = window, // this script is only for browsers anyway...
    			defaultMime = "application/octet-stream", // this default mime also triggers iframe downloads
    			mimeType = strMimeType || defaultMime,
    			payload = data,
    			url = !strFileName && !strMimeType && payload,
    			anchor = document.createElement("a"),
    			toString = function(a){return String(a);},
    			myBlob = (self.Blob || self.MozBlob || self.WebKitBlob || toString),
    			fileName = strFileName || "download",
    			blob,
    			reader;
    			myBlob= myBlob.call ? myBlob.bind(self) : Blob ;
    	  
    		if(String(this)==="true"){ //reverse arguments, allowing download.bind(true, "text/xml", "export.xml") to act as a callback
    			payload=[payload, mimeType];
    			mimeType=payload[0];
    			payload=payload[1];
    		}


    		if(url && url.length< 2048){ // if no filename and no mime, assume a url was passed as the only argument
    			fileName = url.split("/").pop().split("?")[0];
    			anchor.href = url; // assign href prop to temp anchor
    		  	if(anchor.href.indexOf(url) !== -1){ // if the browser determines that it's a potentially valid url path:
            		var ajax=new XMLHttpRequest();
            		ajax.open( "GET", url, true);
            		ajax.responseType = 'blob';
            		ajax.onload= function(e){ 
    				  download(e.target.response, fileName, defaultMime);
    				};
            		setTimeout(function(){ ajax.send();}, 0); // allows setting custom ajax headers using the return:
    			    return ajax;
    			} // end if valid url?
    		} // end if url?


    		//go ahead and download dataURLs right away
    		if(/^data:([\w+-]+\/[\w+.-]+)?[,;]/.test(payload)){
    		
    			if(payload.length > (1024*1024*1.999) && myBlob !== toString ){
    				payload=dataUrlToBlob(payload);
    				mimeType=payload.type || defaultMime;
    			}else {			
    				return navigator.msSaveBlob ?  // IE10 can't do a[download], only Blobs:
    					navigator.msSaveBlob(dataUrlToBlob(payload), fileName) :
    					saver(payload) ; // everyone else can save dataURLs un-processed
    			}
    			
    		}else {//not data url, is it a string with special needs?
    			if(/([\x80-\xff])/.test(payload)){			  
    				var i=0, tempUiArr= new Uint8Array(payload.length), mx=tempUiArr.length;
    				for(i;i<mx;++i) tempUiArr[i]= payload.charCodeAt(i);
    			 	payload=new myBlob([tempUiArr], {type: mimeType});
    			}		  
    		}
    		blob = payload instanceof myBlob ?
    			payload :
    			new myBlob([payload], {type: mimeType}) ;


    		function dataUrlToBlob(strUrl) {
    			var parts= strUrl.split(/[:;,]/),
    			type= parts[1],
    			decoder= parts[2] == "base64" ? atob : decodeURIComponent,
    			binData= decoder( parts.pop() ),
    			mx= binData.length,
    			i= 0,
    			uiArr= new Uint8Array(mx);

    			for(i;i<mx;++i) uiArr[i]= binData.charCodeAt(i);

    			return new myBlob([uiArr], {type: type});
    		 }

    		function saver(url, winMode){

    			if ('download' in anchor) { //html5 A[download]
    				anchor.href = url;
    				anchor.setAttribute("download", fileName);
    				anchor.className = "download-js-link";
    				anchor.innerHTML = "downloading...";
    				anchor.style.display = "none";
    				document.body.appendChild(anchor);
    				setTimeout(function() {
    					anchor.click();
    					document.body.removeChild(anchor);
    					if(winMode===true){setTimeout(function(){ self.URL.revokeObjectURL(anchor.href);}, 250 );}
    				}, 66);
    				return true;
    			}

    			// handle non-a[download] safari as best we can:
    			if(/(Version)\/(\d+)\.(\d+)(?:\.(\d+))?.*Safari\//.test(navigator.userAgent)) {
    				if(/^data:/.test(url))	url="data:"+url.replace(/^data:([\w\/\-\+]+)/, defaultMime);
    				if(!window.open(url)){ // popup blocked, offer direct download:
    					if(confirm("Displaying New Document\n\nUse Save As... to download, then click back to return to this page.")){ location.href=url; }
    				}
    				return true;
    			}

    			//do iframe dataURL download (old ch+FF):
    			var f = document.createElement("iframe");
    			document.body.appendChild(f);

    			if(!winMode && /^data:/.test(url)){ // force a mime that will download:
    				url="data:"+url.replace(/^data:([\w\/\-\+]+)/, defaultMime);
    			}
    			f.src=url;
    			setTimeout(function(){ document.body.removeChild(f); }, 333);

    		}//end saver




    		if (navigator.msSaveBlob) { // IE10+ : (has Blob, but not a[download] or URL)
    			return navigator.msSaveBlob(blob, fileName);
    		}

    		if(self.URL){ // simple fast and modern way using Blob and URL:
    			saver(self.URL.createObjectURL(blob), true);
    		}else {
    			// handle non-Blob()+non-URL browsers:
    			if(typeof blob === "string" || blob.constructor===toString ){
    				try{
    					return saver( "data:" +  mimeType   + ";base64,"  +  self.btoa(blob)  );
    				}catch(y){
    					return saver( "data:" +  mimeType   + "," + encodeURIComponent(blob)  );
    				}
    			}

    			// Blob but not URL support:
    			reader=new FileReader();
    			reader.onload=function(e){
    				saver(this.result);
    			};
    			reader.readAsDataURL(blob);
    		}
    		return true;
    	}; /* end download() */
    }));
    });

    /* src/SuppEvalAlt.svelte generated by Svelte v3.24.1 */

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[17] = list[i];
    	child_ctx[19] = i;
    	return child_ctx;
    }

    function get_each_context_4(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[17] = list[i];
    	child_ctx[19] = i;
    	return child_ctx;
    }

    function get_each_context_3(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[23] = list[i];
    	child_ctx[25] = i;
    	return child_ctx;
    }

    function get_each_context_2(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[20] = list[i];
    	child_ctx[22] = i;
    	return child_ctx;
    }

    function get_each_context_6(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[19] = list[i];
    	return child_ctx;
    }

    function get_each_context_5(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[16] = list[i];
    	return child_ctx;
    }

    function get_each_context_7(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[31] = list[i];
    	return child_ctx;
    }

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[14] = list[i];
    	child_ctx[15] = list;
    	child_ctx[16] = i;
    	return child_ctx;
    }

    // (128:12) {#each d3.range(steps) as t}
    function create_each_block_7(ctx) {
    	let g1;
    	let rect;
    	let rect_fill_value;
    	let g0;
    	let text_1;
    	let t_value = format(".0f")(100 + (/*C*/ ctx[6].domain()[1] - 100) / steps * /*t*/ ctx[31]) + "";
    	let t;
    	let text_1_fill_value;
    	let g0_transform_value;
    	let g1_transform_value;

    	return {
    		c() {
    			g1 = svg_element("g");
    			rect = svg_element("rect");
    			g0 = svg_element("g");
    			text_1 = svg_element("text");
    			t = text(t_value);
    			attr(rect, "width", W);
    			attr(rect, "height", W);
    			attr(rect, "fill", rect_fill_value = /*c*/ ctx[7](100 + (/*C*/ ctx[6].domain()[1] - 100) / steps * /*t*/ ctx[31]));
    			attr(rect, "class", "svelte-17trsa6");
    			set_style(text_1, "pointer-events", "none");
    			attr(text_1, "text-anchor", "middle");
    			attr(text_1, "dominant-baseline", "central");
    			attr(text_1, "font-family", "Courier Prime");
    			attr(text_1, "font-size", "0.6em");
    			attr(text_1, "font-weight", "800");

    			attr(text_1, "fill", text_1_fill_value = 100 + (/*C*/ ctx[6].domain()[1] - 100) / steps * /*t*/ ctx[31] > lim
    			? "white"
    			: "#333");

    			attr(text_1, "class", "svelte-17trsa6");
    			attr(g0, "transform", g0_transform_value = "translate(" + W / 2 + ", " + W / 2 + ") rotate(45)");
    			attr(g0, "class", "svelte-17trsa6");
    			attr(g1, "transform", g1_transform_value = "translate(" + -(steps - /*t*/ ctx[31]) * (W + wm) + ", 0)");
    			attr(g1, "class", "svelte-17trsa6");
    		},
    		m(target, anchor) {
    			insert(target, g1, anchor);
    			append(g1, rect);
    			append(g1, g0);
    			append(g0, text_1);
    			append(text_1, t);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(g1);
    		}
    	};
    }

    // (177:16) {#each d3.range(31) as j}
    function create_each_block_6(ctx) {
    	let rect;
    	let rect_x_value;
    	let rect_y_value;
    	let rect_fill_value;

    	return {
    		c() {
    			rect = svg_element("rect");
    			attr(rect, "x", rect_x_value = /*j*/ ctx[19] * (W + wm));
    			attr(rect, "y", rect_y_value = (7 - /*i*/ ctx[16]) * ch);
    			attr(rect, "width", W);
    			attr(rect, "height", ch);
    			attr(rect, "fill", rect_fill_value = /*lc*/ ctx[8](/*winner*/ ctx[9](/*d*/ ctx[14].values.find(func_2), /*d*/ ctx[14].values.find(func_3), /*d*/ ctx[14].values.find(func_4), /*i*/ ctx[16], /*j*/ ctx[19])));
    			attr(rect, "class", "svelte-17trsa6");
    		},
    		m(target, anchor) {
    			insert(target, rect, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*D*/ 1 && rect_fill_value !== (rect_fill_value = /*lc*/ ctx[8](/*winner*/ ctx[9](/*d*/ ctx[14].values.find(func_2), /*d*/ ctx[14].values.find(func_3), /*d*/ ctx[14].values.find(func_4), /*i*/ ctx[16], /*j*/ ctx[19])))) {
    				attr(rect, "fill", rect_fill_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(rect);
    		}
    	};
    }

    // (176:12) {#each d3.range(8) as i}
    function create_each_block_5(ctx) {
    	let each_1_anchor;
    	let each_value_6 = sequence(31);
    	let each_blocks = [];

    	for (let i = 0; i < each_value_6.length; i += 1) {
    		each_blocks[i] = create_each_block_6(get_each_context_6(ctx, each_value_6, i));
    	}

    	return {
    		c() {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			each_1_anchor = empty();
    		},
    		m(target, anchor) {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(target, anchor);
    			}

    			insert(target, each_1_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*lc, winner, D*/ 769) {
    				each_value_6 = sequence(31);
    				let i;

    				for (i = 0; i < each_value_6.length; i += 1) {
    					const child_ctx = get_each_context_6(ctx, each_value_6, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block_6(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_6.length;
    			}
    		},
    		d(detaching) {
    			destroy_each(each_blocks, detaching);
    			if (detaching) detach(each_1_anchor);
    		}
    	};
    }

    // (214:24) {#if col && d3.mean(col.dur, d => d[2] - d[0]) < 10000 }
    function create_if_block(ctx) {
    	let g;
    	let text_1;
    	let t_value = format(".0f")(mean(/*col*/ ctx[17].dur, func_8)) + "";
    	let t;
    	let text_1_fill_value;
    	let g_transform_value;

    	return {
    		c() {
    			g = svg_element("g");
    			text_1 = svg_element("text");
    			t = text(t_value);
    			set_style(text_1, "pointer-events", "none");
    			attr(text_1, "text-anchor", "middle");
    			attr(text_1, "dominant-baseline", "central");
    			attr(text_1, "font-family", "Courier Prime");
    			attr(text_1, "font-size", "0.6em");
    			attr(text_1, "font-weight", "800");

    			attr(text_1, "fill", text_1_fill_value = mean(/*col*/ ctx[17].dur, func_9) > lim || mean(/*col*/ ctx[17].dur, func_10) < 100
    			? "white"
    			: "#333");

    			attr(text_1, "class", "svelte-17trsa6");
    			attr(g, "transform", g_transform_value = "translate(" + (/*j*/ ctx[19] * (W + wm) + W / 2) + ", " + ((8 - /*l*/ ctx[25]) * (h + hm) + h / 2) + ") rotate(45) scale(1, 1)");
    			attr(g, "class", "svelte-17trsa6");
    		},
    		m(target, anchor) {
    			insert(target, g, anchor);
    			append(g, text_1);
    			append(text_1, t);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*D*/ 1 && t_value !== (t_value = format(".0f")(mean(/*col*/ ctx[17].dur, func_8)) + "")) set_data(t, t_value);

    			if (dirty[0] & /*D*/ 1 && text_1_fill_value !== (text_1_fill_value = mean(/*col*/ ctx[17].dur, func_9) > lim || mean(/*col*/ ctx[17].dur, func_10) < 100
    			? "white"
    			: "#333")) {
    				attr(text_1, "fill", text_1_fill_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(g);
    		}
    	};
    }

    // (199:20) {#each d3.range(31).map(y => row[y] || 0) as col, j}
    function create_each_block_4(ctx) {
    	let rect;
    	let title;

    	let t_value = (/*col*/ ctx[17]
    	? format(".2f")(mean(/*col*/ ctx[17].dur, func_6)) + "ms"
    	: "") + "";

    	let t;
    	let rect_x_value;
    	let rect_y_value;
    	let rect_fill_value;
    	let show_if = /*col*/ ctx[17] && mean(/*col*/ ctx[17].dur, func) < 10000;
    	let if_block_anchor;
    	let mounted;
    	let dispose;
    	let if_block = show_if && create_if_block(ctx);

    	return {
    		c() {
    			rect = svg_element("rect");
    			title = svg_element("title");
    			t = text(t_value);
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    			attr(rect, "width", W);
    			attr(rect, "height", h);
    			attr(rect, "x", rect_x_value = /*j*/ ctx[19] * (W + wm));
    			attr(rect, "y", rect_y_value = (8 - /*l*/ ctx[25]) * (h + hm));

    			attr(rect, "fill", rect_fill_value = /*col*/ ctx[17]
    			? /*c*/ ctx[7](mean(/*col*/ ctx[17].dur, func_7))
    			: "url(#none)");

    			attr(rect, "class", "svelte-17trsa6");
    			toggle_class(rect, "data", !/*computing*/ ctx[1]);
    		},
    		m(target, anchor) {
    			insert(target, rect, anchor);
    			append(rect, title);
    			append(title, t);
    			if (if_block) if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);

    			if (!mounted) {
    				dispose = listen(rect, "click", function () {
    					if (is_function(/*dispatch*/ ctx[3]("select", {
    						"d": /*col*/ ctx[17].d,
    						"n": /*col*/ ctx[17].n,
    						"dr": /*librow*/ ctx[20].DR
    					}))) /*dispatch*/ ctx[3]("select", {
    						"d": /*col*/ ctx[17].d,
    						"n": /*col*/ ctx[17].n,
    						"dr": /*librow*/ ctx[20].DR
    					}).apply(this, arguments);
    				});

    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (dirty[0] & /*D*/ 1 && t_value !== (t_value = (/*col*/ ctx[17]
    			? format(".2f")(mean(/*col*/ ctx[17].dur, func_6)) + "ms"
    			: "") + "")) set_data(t, t_value);

    			if (dirty[0] & /*D*/ 1 && rect_fill_value !== (rect_fill_value = /*col*/ ctx[17]
    			? /*c*/ ctx[7](mean(/*col*/ ctx[17].dur, func_7))
    			: "url(#none)")) {
    				attr(rect, "fill", rect_fill_value);
    			}

    			if (dirty[0] & /*computing*/ 2) {
    				toggle_class(rect, "data", !/*computing*/ ctx[1]);
    			}

    			if (dirty[0] & /*D*/ 1) show_if = /*col*/ ctx[17] && mean(/*col*/ ctx[17].dur, func) < 10000;

    			if (show_if) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(rect);
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (195:16) {#each librow as row, l}
    function create_each_block_3(ctx) {
    	let g;
    	let text_1;
    	let t_value = Math.floor(2 * 5 ** ((/*l*/ ctx[25] + 1) / 2)) + "";
    	let t;
    	let g_transform_value;
    	let each_1_anchor;

    	function func_5(...args) {
    		return /*func_5*/ ctx[10](/*row*/ ctx[23], ...args);
    	}

    	let each_value_4 = sequence(31).map(func_5);
    	let each_blocks = [];

    	for (let i = 0; i < each_value_4.length; i += 1) {
    		each_blocks[i] = create_each_block_4(get_each_context_4(ctx, each_value_4, i));
    	}

    	return {
    		c() {
    			g = svg_element("g");
    			text_1 = svg_element("text");
    			t = text(t_value);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			each_1_anchor = empty();
    			attr(text_1, "dominant-baseline", "central");
    			attr(text_1, "text-anchor", "end");
    			attr(text_1, "font-family", "Courier Prime");
    			attr(text_1, "class", "svelte-17trsa6");
    			attr(g, "transform", g_transform_value = "translate(-5, " + ((8 - /*l*/ ctx[25]) * (h + hm) + h / 2) + ")");
    			attr(g, "class", "svelte-17trsa6");
    		},
    		m(target, anchor) {
    			insert(target, g, anchor);
    			append(g, text_1);
    			append(text_1, t);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(target, anchor);
    			}

    			insert(target, each_1_anchor, anchor);
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (dirty[0] & /*D, c, computing, dispatch*/ 139) {
    				each_value_4 = sequence(31).map(func_5);
    				let i;

    				for (i = 0; i < each_value_4.length; i += 1) {
    					const child_ctx = get_each_context_4(ctx, each_value_4, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block_4(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_4.length;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(g);
    			destroy_each(each_blocks, detaching);
    			if (detaching) detach(each_1_anchor);
    		}
    	};
    }

    // (189:8) {#each d.values as librow, k}
    function create_each_block_2(ctx) {
    	let g1;
    	let g0;
    	let text_1;
    	let t_value = /*librow*/ ctx[20].LIB + "";
    	let t;
    	let circle;
    	let circle_fill_value;
    	let g0_transform_value;
    	let g1_transform_value;
    	let each_value_3 = /*librow*/ ctx[20];
    	let each_blocks = [];

    	for (let i = 0; i < each_value_3.length; i += 1) {
    		each_blocks[i] = create_each_block_3(get_each_context_3(ctx, each_value_3, i));
    	}

    	return {
    		c() {
    			g1 = svg_element("g");
    			g0 = svg_element("g");
    			text_1 = svg_element("text");
    			t = text(t_value);
    			circle = svg_element("circle");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr(text_1, "text-anchor", "end");
    			attr(text_1, "dominant-baseline", "central");
    			attr(text_1, "font-size", "1.3em");
    			attr(text_1, "font-family", "Courier Prime");
    			attr(text_1, "class", "svelte-17trsa6");
    			attr(circle, "cx", "15");
    			attr(circle, "r", "10");
    			attr(circle, "fill", circle_fill_value = /*lc*/ ctx[8](/*librow*/ ctx[20].LIB));
    			attr(g0, "transform", g0_transform_value = "translate(-60, " + 9 * (h + hm) / 2 + ") rotate(-90)");
    			attr(g0, "class", "svelte-17trsa6");
    			attr(g1, "transform", g1_transform_value = "translate(" + /*margin*/ ctx[5].left + ", " + (/*margin*/ ctx[5].top + /*k*/ ctx[22] * (/*H*/ ctx[4] + m)) + ")");
    			attr(g1, "class", "svelte-17trsa6");
    		},
    		m(target, anchor) {
    			insert(target, g1, anchor);
    			append(g1, g0);
    			append(g0, text_1);
    			append(text_1, t);
    			append(g0, circle);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(g1, null);
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*D*/ 1 && t_value !== (t_value = /*librow*/ ctx[20].LIB + "")) set_data(t, t_value);

    			if (dirty[0] & /*D*/ 1 && circle_fill_value !== (circle_fill_value = /*lc*/ ctx[8](/*librow*/ ctx[20].LIB))) {
    				attr(circle, "fill", circle_fill_value);
    			}

    			if (dirty[0] & /*D, c, computing, dispatch*/ 139) {
    				each_value_3 = /*librow*/ ctx[20];
    				let i;

    				for (i = 0; i < each_value_3.length; i += 1) {
    					const child_ctx = get_each_context_3(ctx, each_value_3, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block_3(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(g1, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_3.length;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(g1);
    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    // (233:12) {#each d3.range(31).map(j => d.values[0][0][j] || {n: Math.floor(16 + 2 ** ((j+1)/2 + 1))}) as col, j}
    function create_each_block_1(ctx) {
    	let g;
    	let text_1;
    	let t_value = /*col*/ ctx[17].n + "";
    	let t;
    	let g_transform_value;

    	return {
    		c() {
    			g = svg_element("g");
    			text_1 = svg_element("text");
    			t = text(t_value);
    			attr(text_1, "dominant-baseline", "central");
    			attr(text_1, "font-family", "Courier Prime");
    			attr(text_1, "class", "svelte-17trsa6");
    			attr(g, "transform", g_transform_value = "translate(" + (/*j*/ ctx[19] * (W + wm) + W / 2) + ", 5) rotate(60)");
    			attr(g, "class", "svelte-17trsa6");
    		},
    		m(target, anchor) {
    			insert(target, g, anchor);
    			append(g, text_1);
    			append(text_1, t);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*D*/ 1 && t_value !== (t_value = /*col*/ ctx[17].n + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(g);
    		}
    	};
    }

    // (94:0) {#each d3.nest().key(d => d.DR).entries(D) as d, i}
    function create_each_block(ctx) {
    	let svg;
    	let defs;
    	let pattern0;
    	let path0;
    	let path1;
    	let path2;
    	let marker;
    	let path3;
    	let pattern1;
    	let line0;
    	let line0_stroke_value;
    	let line1;
    	let line1_stroke_value;
    	let pattern2;
    	let line2;
    	let line2_stroke_value;
    	let line3;
    	let line3_stroke_value;
    	let pattern3;
    	let line4;
    	let line4_stroke_value;
    	let line5;
    	let line5_stroke_value;
    	let text0;
    	let t0_value = /*d*/ ctx[14].key + "";
    	let t0;
    	let text0_x_value;
    	let text0_y_value;
    	let g3;
    	let g1;
    	let rect;
    	let rect_fill_value;
    	let g0;
    	let text1;
    	let t1;
    	let g0_transform_value;
    	let g1_transform_value;
    	let g2;
    	let text2;
    	let t2;
    	let g2_transform_value;
    	let g3_transform_value;
    	let g5;
    	let g4;
    	let line6;
    	let line6_x__value;
    	let line6_x__value_1;
    	let line7;
    	let line7_x__value;
    	let line7_x__value_1;
    	let text3;
    	let t3;
    	let g4_transform_value;
    	let g5_transform_value;
    	let g6;
    	let g6_transform_value;
    	let g7;
    	let line8;
    	let line8_x__value;
    	let line8_x__value_1;
    	let line9;
    	let line9_x__value;
    	let line9_x__value_1;
    	let text4;
    	let t4;
    	let g7_transform_value;
    	let g8;
    	let line10;
    	let line10_x__value;
    	let line10_x__value_1;
    	let line11;
    	let line11_x__value;
    	let line11_x__value_1;
    	let text5;
    	let t5;
    	let g8_transform_value;
    	let svg_width_value;
    	let svg_height_value;
    	let i = /*i*/ ctx[16];
    	let t6;
    	let br;
    	let each_value_7 = sequence(steps);
    	let each_blocks_3 = [];

    	for (let i = 0; i < each_value_7.length; i += 1) {
    		each_blocks_3[i] = create_each_block_7(get_each_context_7(ctx, each_value_7, i));
    	}

    	let each_value_5 = sequence(8);
    	let each_blocks_2 = [];

    	for (let i = 0; i < each_value_5.length; i += 1) {
    		each_blocks_2[i] = create_each_block_5(get_each_context_5(ctx, each_value_5, i));
    	}

    	let each_value_2 = /*d*/ ctx[14].values;
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_2.length; i += 1) {
    		each_blocks_1[i] = create_each_block_2(get_each_context_2(ctx, each_value_2, i));
    	}

    	function func_11(...args) {
    		return /*func_11*/ ctx[11](/*d*/ ctx[14], ...args);
    	}

    	let each_value_1 = sequence(31).map(func_11);
    	let each_blocks = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
    	}

    	const assign_svg = () => /*svg_binding*/ ctx[12](svg, i);
    	const unassign_svg = () => /*svg_binding*/ ctx[12](null, i);

    	return {
    		c() {
    			svg = svg_element("svg");
    			defs = svg_element("defs");
    			pattern0 = svg_element("pattern");
    			path0 = svg_element("path");
    			path1 = svg_element("path");
    			path2 = svg_element("path");
    			marker = svg_element("marker");
    			path3 = svg_element("path");
    			pattern1 = svg_element("pattern");
    			line0 = svg_element("line");
    			line1 = svg_element("line");
    			pattern2 = svg_element("pattern");
    			line2 = svg_element("line");
    			line3 = svg_element("line");
    			pattern3 = svg_element("pattern");
    			line4 = svg_element("line");
    			line5 = svg_element("line");
    			text0 = svg_element("text");
    			t0 = text(t0_value);
    			g3 = svg_element("g");

    			for (let i = 0; i < each_blocks_3.length; i += 1) {
    				each_blocks_3[i].c();
    			}

    			g1 = svg_element("g");
    			rect = svg_element("rect");
    			g0 = svg_element("g");
    			text1 = svg_element("text");
    			t1 = text("≤100");
    			g2 = svg_element("g");
    			text2 = svg_element("text");
    			t2 = text("t/ms:");
    			g5 = svg_element("g");
    			g4 = svg_element("g");
    			line6 = svg_element("line");
    			line7 = svg_element("line");
    			text3 = svg_element("text");
    			t3 = text("D");

    			for (let i = 0; i < each_blocks_2.length; i += 1) {
    				each_blocks_2[i].c();
    			}

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].c();
    			}

    			g6 = svg_element("g");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			g7 = svg_element("g");
    			line8 = svg_element("line");
    			line9 = svg_element("line");
    			text4 = svg_element("text");
    			t4 = text("D");
    			g8 = svg_element("g");
    			line10 = svg_element("line");
    			line11 = svg_element("line");
    			text5 = svg_element("text");
    			t5 = text("N");
    			t6 = space();
    			br = element("br");
    			set_style(path0, "stroke", "#333");
    			set_style(path0, "stroke-width", "1px");
    			attr(path0, "d", "M 2.5768547924690237,-3.7795275590551185 10.135909910579262,3.7795275590551185");
    			set_style(path1, "stroke", "#333");
    			set_style(path1, "stroke-width", "1px");
    			attr(path1, "d", "M -3.7795275590551185,-3.7795275590551185 10.135909910579262,10.135909910579262");
    			set_style(path2, "stroke", "#333");
    			set_style(path2, "stroke-width", "1px");
    			attr(path2, "d", "M -3.7795275590551185,2.5768547924690237 3.7795275590551185,10.135909910579262");
    			attr(pattern0, "id", "none");
    			attr(pattern0, "x", "0");
    			attr(pattern0, "y", "0");
    			attr(pattern0, "width", "6.356382351524142");
    			attr(pattern0, "height", "6.356382351524142");
    			attr(pattern0, "patternUnits", "userSpaceOnUse");
    			attr(path3, "d", "M0,0 L0,6 L9,3 z");
    			attr(path3, "fill", "#000");
    			attr(marker, "id", "arrow");
    			attr(marker, "markerWidth", "10");
    			attr(marker, "markerHeight", "10");
    			attr(marker, "refX", "0");
    			attr(marker, "refY", "3");
    			attr(marker, "orient", "auto");
    			attr(marker, "markerUnits", "strokeWidth");
    			attr(line0, "x1", "0");
    			attr(line0, "y", "0");
    			attr(line0, "x2", "0");
    			attr(line0, "y2", "6");
    			attr(line0, "stroke", line0_stroke_value = /*lc*/ ctx[8]("sklearn"));
    			attr(line0, "stroke-width", "6");
    			attr(line1, "x1", "6");
    			attr(line1, "y", "0");
    			attr(line1, "x2", "6");
    			attr(line1, "y2", "6");
    			attr(line1, "stroke", line1_stroke_value = /*lc*/ ctx[8]("druid"));
    			attr(line1, "stroke-width", "6.1");
    			attr(pattern1, "id", "dr_sk");
    			attr(pattern1, "patternUnits", "userSpaceOnUse");
    			attr(pattern1, "width", "6");
    			attr(pattern1, "height", "6");
    			attr(pattern1, "patternTransform", "rotate(-45)");
    			attr(line2, "x1", "0");
    			attr(line2, "y", "0");
    			attr(line2, "x2", "0");
    			attr(line2, "y2", "6");
    			attr(line2, "stroke", line2_stroke_value = /*lc*/ ctx[8]("js"));
    			attr(line2, "stroke-width", "6");
    			attr(line3, "x1", "6");
    			attr(line3, "y", "0");
    			attr(line3, "x2", "6");
    			attr(line3, "y2", "6");
    			attr(line3, "stroke", line3_stroke_value = /*lc*/ ctx[8]("druid"));
    			attr(line3, "stroke-width", "6.1");
    			attr(pattern2, "id", "dr_js");
    			attr(pattern2, "patternUnits", "userSpaceOnUse");
    			attr(pattern2, "width", "6");
    			attr(pattern2, "height", "6");
    			attr(pattern2, "patternTransform", "rotate(-45)");
    			attr(line4, "x1", "0");
    			attr(line4, "y", "0");
    			attr(line4, "x2", "0");
    			attr(line4, "y2", "6");
    			attr(line4, "stroke", line4_stroke_value = /*lc*/ ctx[8]("js"));
    			attr(line4, "stroke-width", "6");
    			attr(line5, "x1", "6");
    			attr(line5, "y", "0");
    			attr(line5, "x2", "6");
    			attr(line5, "y2", "6");
    			attr(line5, "stroke", line5_stroke_value = /*lc*/ ctx[8]("sklearn"));
    			attr(line5, "stroke-width", "6.1");
    			attr(pattern3, "id", "sk_js");
    			attr(pattern3, "patternUnits", "userSpaceOnUse");
    			attr(pattern3, "width", "6");
    			attr(pattern3, "height", "6");
    			attr(pattern3, "patternTransform", "rotate(-45)");
    			attr(text0, "x", text0_x_value = /*margin*/ ctx[5].left);
    			attr(text0, "y", text0_y_value = 28);
    			attr(text0, "text-anchor", "start");
    			attr(text0, "dominant-baseline", "central");
    			attr(text0, "font-size", "1.3em");
    			attr(text0, "class", "svelte-17trsa6");
    			attr(rect, "width", W);
    			attr(rect, "height", W);
    			attr(rect, "fill", rect_fill_value = /*c*/ ctx[7](0));
    			attr(rect, "class", "svelte-17trsa6");
    			set_style(text1, "pointer-events", "none");
    			attr(text1, "text-anchor", "middle");
    			attr(text1, "dominant-baseline", "central");
    			attr(text1, "font-family", "Courier Prime");
    			attr(text1, "font-size", "0.6em");
    			attr(text1, "font-weight", "800");
    			attr(text1, "fill", "white");
    			attr(text1, "class", "svelte-17trsa6");
    			attr(g0, "transform", g0_transform_value = "translate(" + W / 2 + ", " + W / 2 + ") rotate(45)");
    			attr(g0, "class", "svelte-17trsa6");
    			attr(g1, "transform", g1_transform_value = "translate(" + -(steps + 1) * (W + wm) + ", 0)");
    			attr(g1, "class", "svelte-17trsa6");
    			attr(text2, "text-anchor", "end");
    			attr(text2, "dominant-baseline", "middle");
    			attr(text2, "font-size", "20");
    			attr(text2, "font-family", "Courier Prime");
    			attr(text2, "class", "svelte-17trsa6");
    			attr(g2, "transform", g2_transform_value = "translate(" + (-(steps + 1) * (W + wm) - 5) + ", " + W / 2 + ")");
    			attr(g2, "class", "svelte-17trsa6");
    			attr(g3, "transform", g3_transform_value = "translate(" + (/*margin*/ ctx[5].left + 31 * (W + wm)) + ", " + 15 + ")");
    			attr(g3, "class", "svelte-17trsa6");
    			attr(line6, "x1", line6_x__value = -20);
    			attr(line6, "x2", line6_x__value_1 = -10);
    			attr(line6, "stroke", "black");
    			attr(line7, "x1", line7_x__value = 10);
    			attr(line7, "x2", line7_x__value_1 = 20);
    			attr(line7, "stroke", "black");
    			attr(line7, "marker-end", "url(#arrow)");
    			attr(text3, "text-anchor", "middle");
    			attr(text3, "dominant-baseline", "middle");
    			attr(text3, "font-size", "20");
    			attr(text3, "font-family", "Courier Prime");
    			attr(text3, "class", "svelte-17trsa6");
    			attr(g4, "transform", g4_transform_value = "translate(" + -15 + ", " + 25 + ") rotate(-90)");
    			attr(g4, "class", "svelte-17trsa6");
    			attr(g5, "transform", g5_transform_value = "translate(" + /*margin*/ ctx[5].left + ", " + /*margin*/ ctx[5].top2 + ")");
    			attr(g5, "class", "svelte-17trsa6");
    			attr(g6, "transform", g6_transform_value = "translate(" + /*margin*/ ctx[5].left + ", " + (/*margin*/ ctx[5].top + /*d*/ ctx[14].values.length * (/*H*/ ctx[4] + m)) + ")");
    			attr(g6, "class", "svelte-17trsa6");
    			attr(line8, "x1", line8_x__value = -30);
    			attr(line8, "x2", line8_x__value_1 = -10);
    			attr(line8, "stroke", "black");
    			attr(line9, "x1", line9_x__value = 10);
    			attr(line9, "x2", line9_x__value_1 = 30);
    			attr(line9, "stroke", "black");
    			attr(line9, "marker-end", "url(#arrow)");
    			attr(text4, "text-anchor", "middle");
    			attr(text4, "dominant-baseline", "middle");
    			attr(text4, "font-size", "20");
    			attr(text4, "font-family", "Courier Prime");
    			attr(text4, "class", "svelte-17trsa6");
    			attr(g7, "transform", g7_transform_value = "translate(" + (/*margin*/ ctx[5].left - 35) + ", " + (/*margin*/ ctx[5].top + /*d*/ ctx[14].values.length * (/*H*/ ctx[4] + m) - 20) + ") rotate(-90)");
    			attr(g7, "class", "svelte-17trsa6");
    			attr(line10, "x1", line10_x__value = -30);
    			attr(line10, "x2", line10_x__value_1 = -10);
    			attr(line10, "stroke", "black");
    			attr(line11, "x1", line11_x__value = 10);
    			attr(line11, "x2", line11_x__value_1 = 30);
    			attr(line11, "stroke", "black");
    			attr(line11, "marker-end", "url(#arrow)");
    			attr(text5, "text-anchor", "middle");
    			attr(text5, "dominant-baseline", "middle");
    			attr(text5, "font-size", "20");
    			attr(text5, "font-family", "Courier Prime");
    			attr(text5, "class", "svelte-17trsa6");
    			attr(g8, "transform", g8_transform_value = "translate(" + (/*margin*/ ctx[5].left + 20) + ", " + (/*margin*/ ctx[5].top + /*d*/ ctx[14].values.length * (/*H*/ ctx[4] + m) + 35) + ")");
    			attr(g8, "class", "svelte-17trsa6");
    			attr(svg, "width", svg_width_value = /*margin*/ ctx[5].left + 31 * (W + wm) + /*margin*/ ctx[5].right);
    			attr(svg, "height", svg_height_value = /*margin*/ ctx[5].top + /*d*/ ctx[14].values.length * (/*H*/ ctx[4] + m) + /*margin*/ ctx[5].bottom);
    		},
    		m(target, anchor) {
    			insert(target, svg, anchor);
    			append(svg, defs);
    			append(defs, pattern0);
    			append(pattern0, path0);
    			append(pattern0, path1);
    			append(pattern0, path2);
    			append(defs, marker);
    			append(marker, path3);
    			append(defs, pattern1);
    			append(pattern1, line0);
    			append(pattern1, line1);
    			append(defs, pattern2);
    			append(pattern2, line2);
    			append(pattern2, line3);
    			append(defs, pattern3);
    			append(pattern3, line4);
    			append(pattern3, line5);
    			append(svg, text0);
    			append(text0, t0);
    			append(svg, g3);

    			for (let i = 0; i < each_blocks_3.length; i += 1) {
    				each_blocks_3[i].m(g3, null);
    			}

    			append(g3, g1);
    			append(g1, rect);
    			append(g1, g0);
    			append(g0, text1);
    			append(text1, t1);
    			append(g3, g2);
    			append(g2, text2);
    			append(text2, t2);
    			append(svg, g5);
    			append(g5, g4);
    			append(g4, line6);
    			append(g4, line7);
    			append(g4, text3);
    			append(text3, t3);

    			for (let i = 0; i < each_blocks_2.length; i += 1) {
    				each_blocks_2[i].m(g5, null);
    			}

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].m(svg, null);
    			}

    			append(svg, g6);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(g6, null);
    			}

    			append(svg, g7);
    			append(g7, line8);
    			append(g7, line9);
    			append(g7, text4);
    			append(text4, t4);
    			append(svg, g8);
    			append(g8, line10);
    			append(g8, line11);
    			append(g8, text5);
    			append(text5, t5);
    			assign_svg();
    			insert(target, t6, anchor);
    			insert(target, br, anchor);
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			if (dirty[0] & /*D*/ 1 && t0_value !== (t0_value = /*d*/ ctx[14].key + "")) set_data(t0, t0_value);

    			if (dirty[0] & /*C, c*/ 192) {
    				each_value_7 = sequence(steps);
    				let i;

    				for (i = 0; i < each_value_7.length; i += 1) {
    					const child_ctx = get_each_context_7(ctx, each_value_7, i);

    					if (each_blocks_3[i]) {
    						each_blocks_3[i].p(child_ctx, dirty);
    					} else {
    						each_blocks_3[i] = create_each_block_7(child_ctx);
    						each_blocks_3[i].c();
    						each_blocks_3[i].m(g3, g1);
    					}
    				}

    				for (; i < each_blocks_3.length; i += 1) {
    					each_blocks_3[i].d(1);
    				}

    				each_blocks_3.length = each_value_7.length;
    			}

    			if (dirty[0] & /*lc, winner, D*/ 769) {
    				each_value_5 = sequence(8);
    				let i;

    				for (i = 0; i < each_value_5.length; i += 1) {
    					const child_ctx = get_each_context_5(ctx, each_value_5, i);

    					if (each_blocks_2[i]) {
    						each_blocks_2[i].p(child_ctx, dirty);
    					} else {
    						each_blocks_2[i] = create_each_block_5(child_ctx);
    						each_blocks_2[i].c();
    						each_blocks_2[i].m(g5, null);
    					}
    				}

    				for (; i < each_blocks_2.length; i += 1) {
    					each_blocks_2[i].d(1);
    				}

    				each_blocks_2.length = each_value_5.length;
    			}

    			if (dirty[0] & /*margin, H, D, c, computing, dispatch, lc*/ 443) {
    				each_value_2 = /*d*/ ctx[14].values;
    				let i;

    				for (i = 0; i < each_value_2.length; i += 1) {
    					const child_ctx = get_each_context_2(ctx, each_value_2, i);

    					if (each_blocks_1[i]) {
    						each_blocks_1[i].p(child_ctx, dirty);
    					} else {
    						each_blocks_1[i] = create_each_block_2(child_ctx);
    						each_blocks_1[i].c();
    						each_blocks_1[i].m(svg, g6);
    					}
    				}

    				for (; i < each_blocks_1.length; i += 1) {
    					each_blocks_1[i].d(1);
    				}

    				each_blocks_1.length = each_value_2.length;
    			}

    			if (dirty[0] & /*D*/ 1) {
    				each_value_1 = sequence(31).map(func_11);
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1(ctx, each_value_1, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block_1(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(g6, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_1.length;
    			}

    			if (dirty[0] & /*D*/ 1 && g6_transform_value !== (g6_transform_value = "translate(" + /*margin*/ ctx[5].left + ", " + (/*margin*/ ctx[5].top + /*d*/ ctx[14].values.length * (/*H*/ ctx[4] + m)) + ")")) {
    				attr(g6, "transform", g6_transform_value);
    			}

    			if (dirty[0] & /*D*/ 1 && g7_transform_value !== (g7_transform_value = "translate(" + (/*margin*/ ctx[5].left - 35) + ", " + (/*margin*/ ctx[5].top + /*d*/ ctx[14].values.length * (/*H*/ ctx[4] + m) - 20) + ") rotate(-90)")) {
    				attr(g7, "transform", g7_transform_value);
    			}

    			if (dirty[0] & /*D*/ 1 && g8_transform_value !== (g8_transform_value = "translate(" + (/*margin*/ ctx[5].left + 20) + ", " + (/*margin*/ ctx[5].top + /*d*/ ctx[14].values.length * (/*H*/ ctx[4] + m) + 35) + ")")) {
    				attr(g8, "transform", g8_transform_value);
    			}

    			if (dirty[0] & /*D*/ 1 && svg_height_value !== (svg_height_value = /*margin*/ ctx[5].top + /*d*/ ctx[14].values.length * (/*H*/ ctx[4] + m) + /*margin*/ ctx[5].bottom)) {
    				attr(svg, "height", svg_height_value);
    			}

    			if (i !== /*i*/ ctx[16]) {
    				unassign_svg();
    				i = /*i*/ ctx[16];
    				assign_svg();
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(svg);
    			destroy_each(each_blocks_3, detaching);
    			destroy_each(each_blocks_2, detaching);
    			destroy_each(each_blocks_1, detaching);
    			destroy_each(each_blocks, detaching);
    			unassign_svg();
    			if (detaching) detach(t6);
    			if (detaching) detach(br);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let each_1_anchor;
    	let each_value = nest().key(func_1).entries(/*D*/ ctx[0]);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	return {
    		c() {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			each_1_anchor = empty();
    		},
    		m(target, anchor) {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(target, anchor);
    			}

    			insert(target, each_1_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*margin, D, H, svgs, c, computing, dispatch, lc, winner, C*/ 1023) {
    				each_value = nest().key(func_1).entries(/*D*/ ctx[0]);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			destroy_each(each_blocks, detaching);
    			if (detaching) detach(each_1_anchor);
    		}
    	};
    }

    let W = 24;
    let h = 24;
    let hm = 3;
    let wm = 3;
    let m = 25;
    let ch = 5;
    const steps = 20;
    const lim = 6000;
    const func = d => d[2] - d[0];
    const func_1 = d => d.DR;
    const func_2 = d => d.LIB == "druid";
    const func_3 = d => d.LIB == "sklearn";
    const func_4 = d => d.LIB == "js";
    const func_6 = d => d[2] - d[0];
    const func_7 = d => d[2] - d[0];
    const func_8 = d => d[2] - d[0];
    const func_9 = d => d[2] - d[0];
    const func_10 = d => d[2] - d[0];

    function instance($$self, $$props, $$invalidate) {
    	let { D } = $$props;
    	let { computing } = $$props;
    	const dispatch = createEventDispatcher();
    	let H = 8 * (h + hm);

    	let margin = {
    		top: 50 + 8 * ch + wm,
    		top2: 55,
    		left: 80,
    		bottom: 65,
    		right: 30
    	};

    	let C = sequential(Reds).//.domain([0, d3.max(D.flat().flat().map(d => d.dur).flat(), d => d[2] - d[0])]);
    	domain([0, 10000]);

    	let c = x => x < 100
    	? "lightslategray"
    	: x > 10000 ? "url(#none)" : C(x);

    	let lc = lib => {
    		return ({
    			"druid": "mediumseagreen",
    			"sklearn": "orange",
    			"js": "slateblue",
    			"dr_sk": "url(#dr_sk)",
    			"dr_js": "url(#dr_js)",
    			"sk_js": "url(#sk_js)",
    			"none": "url(#none)"
    		})[lib];
    	};

    	let svgs = [];

    	function winner(dr, sk, js, d, n) {
    		//console.log(dr, sk, js, d, n)
    		let values = [dr, sk, js].filter(D => D).map(D => {
    			// select d and n
    			//console.log(D)
    			if (D.length < d) return undefined; // remove not existing

    			const row = D[d].filter(d => d);
    			if (row.length <= n) return undefined;
    			const col = row[n];
    			return col.dur.map(d => [d[2] - d[0], D.LIB.slice(0, 2)]);
    		}).filter(D => D).flat().filter(d => d[0] < 10000); // remoove undefineds

    		if (values.length == 0) return "none";

    		let [f, s, ...rest] = values.//.filter(d => d[0] > 10000)
    		sort((a, b) => ascending(a[0] || null, b[0] || null));

    		switch (f[1] + s[1]) {
    			case "sksk":
    				return "sklearn";
    			case "skdr":
    			case "drsk":
    				return "dr_sk";
    			case "drdr":
    				return "druid";
    			case "drjs":
    			case "jsdr":
    				return "dr_js";
    			case "jsjs":
    				return "js";
    			case "skjs":
    			case "jssk":
    				return "sk_js";
    			default:
    				return "none";
    		}
    	}

    	const func_5 = (row, y) => row[y] || 0;

    	const func_11 = (d, j) => d.values[0][0][j] || {
    		n: Math.floor(16 + 2 ** ((j + 1) / 2 + 1))
    	};

    	function svg_binding($$value, i) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			svgs[i] = $$value;
    			$$invalidate(2, svgs);
    		});
    	}

    	$$self.$$set = $$props => {
    		if ("D" in $$props) $$invalidate(0, D = $$props.D);
    		if ("computing" in $$props) $$invalidate(1, computing = $$props.computing);
    	};

    	return [
    		D,
    		computing,
    		svgs,
    		dispatch,
    		H,
    		margin,
    		C,
    		c,
    		lc,
    		winner,
    		func_5,
    		func_11,
    		svg_binding
    	];
    }

    class SuppEvalAlt extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, { D: 0, computing: 1 }, [-1, -1]);
    	}
    }

    /* src/ScatterPlotAlt.svelte generated by Svelte v3.24.1 */

    function get_each_context$1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[3] = list[i];
    	child_ctx[8] = i;
    	return child_ctx;
    }

    // (41:4) {#if DR && n && d}
    function create_if_block_1(ctx) {
    	let text_1;
    	let t0;
    	let tspan;
    	let t1;
    	let t2;
    	let t3;

    	return {
    		c() {
    			text_1 = svg_element("text");
    			t0 = text(/*DR*/ ctx[0]);
    			tspan = svg_element("tspan");
    			t1 = text(/*n*/ ctx[2]);
    			t2 = text("×");
    			t3 = text(/*d*/ ctx[3]);
    			attr(tspan, "dx", "12");
    			attr(text_1, "x", "5");
    			attr(text_1, "y", "5");
    			attr(text_1, "dominant-baseline", "hanging");
    			attr(text_1, "font-family", "Courier Prime");
    		},
    		m(target, anchor) {
    			insert(target, text_1, anchor);
    			append(text_1, t0);
    			append(text_1, tspan);
    			append(tspan, t1);
    			append(tspan, t2);
    			append(tspan, t3);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*DR*/ 1) set_data(t0, /*DR*/ ctx[0]);
    			if (dirty & /*n*/ 4) set_data(t1, /*n*/ ctx[2]);
    			if (dirty & /*d*/ 8) set_data(t3, /*d*/ ctx[3]);
    		},
    		d(detaching) {
    			if (detaching) detach(text_1);
    		}
    	};
    }

    // (42:4) {#if Y}
    function create_if_block$1(ctx) {
    	let g;
    	let each_value = /*Y*/ ctx[1];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$1(get_each_context$1(ctx, each_value, i));
    	}

    	return {
    		c() {
    			g = svg_element("g");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr(g, "transform", "translate(0, 0)");
    		},
    		m(target, anchor) {
    			insert(target, g, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(g, null);
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*x, Y, y, r*/ 50) {
    				each_value = /*Y*/ ctx[1];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$1(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block$1(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(g, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(g);
    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    // (44:12) {#each Y as d, i}
    function create_each_block$1(ctx) {
    	let g;
    	let circle;
    	let g_transform_value;

    	return {
    		c() {
    			g = svg_element("g");
    			circle = svg_element("circle");
    			attr(circle, "r", r);
    			attr(circle, "fill", "none");
    			attr(circle, "stroke", "black");
    			attr(g, "transform", g_transform_value = "translate(" + /*x*/ ctx[4](/*d*/ ctx[3][0]) + "," + /*y*/ ctx[5](/*d*/ ctx[3][1]) + ")");
    		},
    		m(target, anchor) {
    			insert(target, g, anchor);
    			append(g, circle);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*x, Y, y*/ 50 && g_transform_value !== (g_transform_value = "translate(" + /*x*/ ctx[4](/*d*/ ctx[3][0]) + "," + /*y*/ ctx[5](/*d*/ ctx[3][1]) + ")")) {
    				attr(g, "transform", g_transform_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(g);
    		}
    	};
    }

    function create_fragment$1(ctx) {
    	let svg;
    	let if_block0_anchor;
    	let t;
    	let hr;
    	let if_block0 = /*DR*/ ctx[0] && /*n*/ ctx[2] && /*d*/ ctx[3] && create_if_block_1(ctx);
    	let if_block1 = /*Y*/ ctx[1] && create_if_block$1(ctx);

    	return {
    		c() {
    			svg = svg_element("svg");
    			if (if_block0) if_block0.c();
    			if_block0_anchor = empty();
    			if (if_block1) if_block1.c();
    			t = space();
    			hr = element("hr");
    			attr(svg, "width", width);
    			attr(svg, "height", height);
    		},
    		m(target, anchor) {
    			insert(target, svg, anchor);
    			if (if_block0) if_block0.m(svg, null);
    			append(svg, if_block0_anchor);
    			if (if_block1) if_block1.m(svg, null);
    			insert(target, t, anchor);
    			insert(target, hr, anchor);
    		},
    		p(ctx, [dirty]) {
    			if (/*DR*/ ctx[0] && /*n*/ ctx[2] && /*d*/ ctx[3]) {
    				if (if_block0) {
    					if_block0.p(ctx, dirty);
    				} else {
    					if_block0 = create_if_block_1(ctx);
    					if_block0.c();
    					if_block0.m(svg, if_block0_anchor);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (/*Y*/ ctx[1]) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);
    				} else {
    					if_block1 = create_if_block$1(ctx);
    					if_block1.c();
    					if_block1.m(svg, null);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(svg);
    			if (if_block0) if_block0.d();
    			if (if_block1) if_block1.d();
    			if (detaching) detach(t);
    			if (detaching) detach(hr);
    		}
    	};
    }

    let width = 500;
    let height = 500;
    let margin = 10;
    let r = 2.5;

    function instance$1($$self, $$props, $$invalidate) {
    	let { DR } = $$props;
    	let { Y = [] } = $$props;
    	let { d } = $$props;
    	let { n } = $$props;

    	function get_scales(data) {
    		let [x_min, x_max] = extent(data, d => d[0]);
    		let [y_min, y_max] = extent(data, d => d[1]);
    		let [x_span, y_span] = [x_max - x_min, y_max - y_min];
    		let offset = Math.abs(x_span - y_span) / 2;

    		if (x_span > y_span) {
    			y_min -= offset;
    			y_max += offset;
    		} else {
    			x_min -= offset;
    			x_max += offset;
    		}

    		return [
    			linear$1().domain([x_min, x_max]).nice().rangeRound([margin + r, width - (margin + r)]),
    			linear$1().domain([y_min, y_max]).nice().rangeRound([height - (margin + r), margin + r])
    		];
    	}

    	$$self.$$set = $$props => {
    		if ("DR" in $$props) $$invalidate(0, DR = $$props.DR);
    		if ("Y" in $$props) $$invalidate(1, Y = $$props.Y);
    		if ("d" in $$props) $$invalidate(3, d = $$props.d);
    		if ("n" in $$props) $$invalidate(2, n = $$props.n);
    	};

    	let x;
    	let y;

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*Y*/ 2) {
    			 $$invalidate(4, [x, y] = get_scales(Y), x, ($$invalidate(5, y), $$invalidate(1, Y)));
    		}
    	};

    	return [DR, Y, n, d, x, y];
    }

    class ScatterPlotAlt extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, { DR: 0, Y: 1, d: 3, n: 2 });
    	}
    }

    /* src/App.svelte generated by Svelte v3.24.1 */

    function create_if_block$2(ctx) {
    	let p;
    	let span;
    	let t1;
    	let t2;
    	let t3;

    	return {
    		c() {
    			p = element("p");
    			span = element("span");
    			span.textContent = "Runtime";
    			t1 = space();
    			t2 = text(/*t*/ ctx[1]);
    			t3 = text("ms");
    			attr(p, "font-family", "Courier Prime");
    		},
    		m(target, anchor) {
    			insert(target, p, anchor);
    			append(p, span);
    			append(p, t1);
    			append(p, t2);
    			append(p, t3);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*t*/ 2) set_data(t2, /*t*/ ctx[1]);
    		},
    		d(detaching) {
    			if (detaching) detach(p);
    		}
    	};
    }

    // (1:0) <script>     import * as d3 from "d3";     import * as druid from "@saehrimnir/druidjs";      import Eval from "./Eval.svelte";     import Scatterplot from "./Scatterplot.svelte";     import Compare from "./Compare.svelte";     import SmallComp from "./SmallComp.svelte";     import SmallCompAlt from "./SmallCompAlt.svelte";     import SuppComp from "./SuppComp.svelte";     import SuppEval from "./SuppEval.svelte";     import SuppEvalAlt from "./SuppEvalAlt.svelte";     import ScatterPlotAlt from "./ScatterPlotAlt.svelte";      let w = 15;     let h = 15;     let margin = 50;      async function load_data(path) {         let data = await d3.json(path)         //data.PCA = data.PCA.map(rows => rows.filter((d, i) => i < 32));         for (const key of Object.keys(data)) {             data[key] = data[key].map(rows => rows.filter((d, i) => i >= 1 && i < 32))         }
    function create_catch_block(ctx) {
    	return {
    		c: noop,
    		m: noop,
    		p: noop,
    		i: noop,
    		o: noop,
    		d: noop
    	};
    }

    // (276:8) {:then D}
    function create_then_block(ctx) {
    	let suppevalalt;
    	let current;
    	suppevalalt = new SuppEvalAlt({ props: { D: /*D*/ ctx[14], computing } });
    	suppevalalt.$on("select", /*selected*/ ctx[3]);

    	return {
    		c() {
    			create_component(suppevalalt.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(suppevalalt, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const suppevalalt_changes = {};

    			if (dirty & /*$$scope*/ 32768) {
    				suppevalalt_changes.$$scope = { dirty, ctx };
    			}

    			suppevalalt.$set(suppevalalt_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(suppevalalt.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(suppevalalt.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(suppevalalt, detaching);
    		}
    	};
    }

    // (274:33)              <p></p>         {:then D}
    function create_pending_block(ctx) {
    	let p;

    	return {
    		c() {
    			p = element("p");
    		},
    		m(target, anchor) {
    			insert(target, p, anchor);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(p);
    		}
    	};
    }

    function create_fragment$2(ctx) {
    	let main;
    	let aside;
    	let scatterplotalt;
    	let t0;
    	let t1;
    	let section0;
    	let promise;
    	let t2;
    	let section1;
    	let current;
    	let mounted;
    	let dispose;

    	scatterplotalt = new ScatterPlotAlt({
    			props: {
    				Y: /*R*/ ctx[0] ? /*R*/ ctx[0].Y : [],
    				DR: /*R*/ ctx[0]?.DR,
    				d: /*R*/ ctx[0]?.d,
    				n: /*R*/ ctx[0]?.n
    			}
    		});

    	let if_block = /*t*/ ctx[1] != undefined && create_if_block$2(ctx);

    	let info = {
    		ctx,
    		current: null,
    		token: null,
    		pending: create_pending_block,
    		then: create_then_block,
    		catch: create_catch_block,
    		value: 14,
    		blocks: [,,,]
    	};

    	handle_promise(promise = /*load_supp*/ ctx[2](false), info);

    	return {
    		c() {
    			main = element("main");
    			aside = element("aside");
    			create_component(scatterplotalt.$$.fragment);
    			t0 = space();
    			if (if_block) if_block.c();
    			t1 = space();
    			section0 = element("section");
    			info.block.c();
    			t2 = space();
    			section1 = element("section");
    			attr(aside, "class", "svelte-lqai1k");
    			attr(section0, "class", "svelte-lqai1k");
    			attr(section1, "class", "svelte-lqai1k");
    		},
    		m(target, anchor) {
    			insert(target, main, anchor);
    			append(main, aside);
    			mount_component(scatterplotalt, aside, null);
    			append(aside, t0);
    			if (if_block) if_block.m(aside, null);
    			append(main, t1);
    			append(main, section0);
    			info.block.m(section0, info.anchor = null);
    			info.mount = () => section0;
    			info.anchor = null;
    			append(main, t2);
    			append(main, section1);
    			current = true;

    			if (!mounted) {
    				dispose = listen(aside, "mouseenter", /*mouseenter_handler*/ ctx[4]);
    				mounted = true;
    			}
    		},
    		p(new_ctx, [dirty]) {
    			ctx = new_ctx;
    			const scatterplotalt_changes = {};
    			if (dirty & /*R*/ 1) scatterplotalt_changes.Y = /*R*/ ctx[0] ? /*R*/ ctx[0].Y : [];
    			if (dirty & /*R*/ 1) scatterplotalt_changes.DR = /*R*/ ctx[0]?.DR;
    			if (dirty & /*R*/ 1) scatterplotalt_changes.d = /*R*/ ctx[0]?.d;
    			if (dirty & /*R*/ 1) scatterplotalt_changes.n = /*R*/ ctx[0]?.n;
    			scatterplotalt.$set(scatterplotalt_changes);

    			if (/*t*/ ctx[1] != undefined) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block$2(ctx);
    					if_block.c();
    					if_block.m(aside, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			{
    				const child_ctx = ctx.slice();
    				child_ctx[14] = info.resolved;
    				info.block.p(child_ctx, dirty);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(scatterplotalt.$$.fragment, local);
    			transition_in(info.block);
    			current = true;
    		},
    		o(local) {
    			transition_out(scatterplotalt.$$.fragment, local);

    			for (let i = 0; i < 3; i += 1) {
    				const block = info.blocks[i];
    				transition_out(block);
    			}

    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_component(scatterplotalt);
    			if (if_block) if_block.d();
    			info.block.d();
    			info.token = null;
    			info = null;
    			mounted = false;
    			dispose();
    		}
    	};
    }
    let computing = false;

    function wait(t) {
    	return new Promise(res => {
    			window.setTimeout(res, t);
    		});
    }

    function instance$2($$self, $$props, $$invalidate) {

    	async function load_data_supp(path, lib) {
    		let D = await json(path);

    		let data = Object.keys(D).map(key => {
    			let rows = D[key].map((row, i) => {
    				return row.filter((d, i) => i >= 1 && i < 32 && d != 0);
    			});

    			rows.DR = key;
    			rows.LIB = lib;
    			return rows;
    		});

    		return data; //.filter(d => d.LIB != "druid");
    	}

    	async function load_supp(full = true) {
    		let D = [];

    		let list = full
    		? [
    				["eval6_8x14.json", "druid"],
    				["eval_sklearn.json", "sklearn"],
    				["eval_js.json", "js"],
    				["eval_supp.json", "druid"]
    			]
    		: [["eval6_8x14.json", "druid"], ["eval_supp.json", "druid"]];

    		for (const [path, lib] of list) {
    			D.push(await load_data_supp(path, lib));
    		}

    		return D.flat().sort((a, b) => ascending(a.DR, b.DR)).sort((a, b) => ascending(a.LIB, b.LIB));
    	}

    	function comp(V, DR, classes) {
    		return new Promise(res => {
    				switch (DR) {
    					case "UMAP":
    						new UMAP(V).transform_async().then(Y => {
    							res(Y.to2dArray);
    						});
    						break;
    					case "TSNE":
    						new TSNE(V).transform_async().then(Y => res(Y.to2dArray));
    						break;
    					case "LDA":
    						new LDA(V, V.to2dArray.map(d => 0)).transform_async().then(Y => res(Y.to2dArray));
    						break;
    					case "ISOMAP":
    						new ISOMAP(V).transform_async().then(Y => res(Y.to2dArray));
    						break;
    					case "MDS":
    						new MDS(V).transform_async().then(Y => res(Y.to2dArray));
    						break;
    					case "PCA":
    						new PCA(V).transform_async().then(Y => res(Y.to2dArray));
    						break;
    					case "MDS":
    						new MDS(V).transform_async().then(Y => res(Y.to2dArray));
    						break;
    					case "LLE":
    						new LLE(V, 34).transform_async().then(Y => res(Y.to2dArray));
    						break;
    					case "LTSA":
    						new LTSA(V, 34).transform_async().then(Y => res(Y.to2dArray));
    						break;
    					case "TriMap":
    						new TriMap(V, 100000, 4).init().transform_async().then(Y => res(Y.to2dArray));
    						break;
    					default:
    						new FASTMAP(V).transform_async().then(Y => res(Y.to2dArray));
    						break;
    				}
    			});
    	}

    	let R;
    	let t;
    	let interval;
    	let start = performance.now();

    	async function selected(e) {

    		try {
    			$$invalidate(0, R = null);
    			const { d, n, dr } = e.detail;
    			let computing = true;
    			let X = new Matrix(n, d, () => Math.random());
    			await wait(10);
    			start = performance.now();

    			/* let ifunc = (start) => {
        
        console.log(start, t)
        t = Math.round(performance.now() - start);
    }
    interval = window.setInterval(ifunc, 10, start) */
    			comp(X, dr).then(async Y => {
    				$$invalidate(1, t = format(".2f")(performance.now() - start));
    				await wait(10);
    				$$invalidate(0, R = { Y, DR: dr, d, n });
    				window.clearInterval(interval);
    				computing = false;
    			});
    		} catch(e) {
    			window.clearInterval(interval);
    		} finally {
    			
    		}
    	}

    	const mouseenter_handler = () => {
    		$$invalidate(0, R = null);
    		$$invalidate(1, t = undefined);
    	};

    	return [R, t, load_supp, selected, mouseenter_handler];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, {});
    	}
    }

    const app = new App({
    	target: document.body,
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map