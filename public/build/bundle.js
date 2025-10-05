
(function(l, r) { if (!l || l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (self.location.host || 'localhost').split(':')[0] + ':35730/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(self.document);
var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
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
    let src_url_equal_anchor;
    function src_url_equal(element_src, url) {
        if (!src_url_equal_anchor) {
            src_url_equal_anchor = document.createElement('a');
        }
        src_url_equal_anchor.href = url;
        return element_src === src_url_equal_anchor.href;
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
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
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
    function toggle_class(element, name, toggle) {
        element.classList[toggle ? 'add' : 'remove'](name);
    }
    function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, cancelable, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    let render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = /* @__PURE__ */ Promise.resolve();
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
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        // Do not reenter flush while dirty components are updated, as this can
        // result in an infinite loop. Instead, let the inner flush handle it.
        // Reentrancy is ok afterwards for bindings etc.
        if (flushidx !== 0) {
            return;
        }
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            try {
                while (flushidx < dirty_components.length) {
                    const component = dirty_components[flushidx];
                    flushidx++;
                    set_current_component(component);
                    update(component.$$);
                }
            }
            catch (e) {
                // reset dirty state to not end up in a deadlocked state and then rethrow
                dirty_components.length = 0;
                flushidx = 0;
                throw e;
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
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
        seen_callbacks.clear();
        set_current_component(saved_component);
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
    /**
     * Useful for example to execute remaining `afterUpdate` callbacks before executing `destroy`.
     */
    function flush_render_callbacks(fns) {
        const filtered = [];
        const targets = [];
        render_callbacks.forEach((c) => fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c));
        targets.forEach((c) => c());
        render_callbacks = filtered;
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
                // if the component was destroyed immediately
                // it will update the `$$.on_destroy` reference to `null`.
                // the destructured on_destroy may still reference to the old array
                if (component.$$.on_destroy) {
                    component.$$.on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            flush_render_callbacks($$.after_update);
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
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: [],
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
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
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            if (!is_function(callback)) {
                return noop;
            }
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

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.59.2' }, detail), { bubbles: true }));
    }
    function append_dev(target, node) {
        dispatch_dev('SvelteDOMInsert', { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation, has_stop_immediate_propagation) {
        const modifiers = options === true ? ['capture'] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        if (has_stop_immediate_propagation)
            modifiers.push('stopImmediatePropagation');
        dispatch_dev('SvelteDOMAddEventListener', { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev('SvelteDOMRemoveEventListener', { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev('SvelteDOMRemoveAttribute', { node, attribute });
        else
            dispatch_dev('SvelteDOMSetAttribute', { node, attribute, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.data === data)
            return;
        dispatch_dev('SvelteDOMSetData', { node: text, data });
        text.data = data;
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    /* src/App.svelte generated by Svelte v3.59.2 */

    const file = "src/App.svelte";

    // (46:5) {#if sidebarExpanded}
    function create_if_block_2(ctx) {
    	let span;

    	const block = {
    		c: function create() {
    			span = element("span");
    			span.textContent = "follows";
    			attr_dev(span, "class", "tab-label svelte-oyyzx8");
    			add_location(span, file, 45, 26, 1161);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_2.name,
    		type: "if",
    		source: "(46:5) {#if sidebarExpanded}",
    		ctx
    	});

    	return block;
    }

    // (50:5) {#if sidebarExpanded}
    function create_if_block_1(ctx) {
    	let span;

    	const block = {
    		c: function create() {
    			span = element("span");
    			span.textContent = "global";
    			attr_dev(span, "class", "tab-label svelte-oyyzx8");
    			add_location(span, file, 49, 26, 1302);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1.name,
    		type: "if",
    		source: "(50:5) {#if sidebarExpanded}",
    		ctx
    	});

    	return block;
    }

    // (54:5) {#if sidebarExpanded}
    function create_if_block(ctx) {
    	let span;

    	const block = {
    		c: function create() {
    			span = element("span");
    			span.textContent = "write";
    			attr_dev(span, "class", "tab-label svelte-oyyzx8");
    			add_location(span, file, 53, 26, 1442);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block.name,
    		type: "if",
    		source: "(54:5) {#if sidebarExpanded}",
    		ctx
    	});

    	return block;
    }

    function create_fragment(ctx) {
    	let header;
    	let div1;
    	let img;
    	let img_src_value;
    	let t0;
    	let div0;
    	let textarea;
    	let t1;
    	let button0;
    	let t2_value = (/*isDarkTheme*/ ctx[1] ? '☀️' : '🌙') + "";
    	let t2;
    	let t3;
    	let button1;
    	let t5;
    	let div7;
    	let aside;
    	let div6;
    	let div5;
    	let div2;
    	let span0;
    	let t7;
    	let t8;
    	let div3;
    	let span1;
    	let t10;
    	let t11;
    	let div4;
    	let span2;
    	let t13;
    	let t14;
    	let button2;
    	let t15_value = (/*sidebarExpanded*/ ctx[2] ? '◀' : '▶') + "";
    	let t15;
    	let t16;
    	let main;
    	let h1;
    	let t17;
    	let t18;
    	let t19;
    	let mounted;
    	let dispose;
    	let if_block0 = /*sidebarExpanded*/ ctx[2] && create_if_block_2(ctx);
    	let if_block1 = /*sidebarExpanded*/ ctx[2] && create_if_block_1(ctx);
    	let if_block2 = /*sidebarExpanded*/ ctx[2] && create_if_block(ctx);

    	const block = {
    		c: function create() {
    			header = element("header");
    			div1 = element("div");
    			img = element("img");
    			t0 = space();
    			div0 = element("div");
    			textarea = element("textarea");
    			t1 = space();
    			button0 = element("button");
    			t2 = text(t2_value);
    			t3 = space();
    			button1 = element("button");
    			button1.textContent = "Login";
    			t5 = space();
    			div7 = element("div");
    			aside = element("aside");
    			div6 = element("div");
    			div5 = element("div");
    			div2 = element("div");
    			span0 = element("span");
    			span0.textContent = "👥";
    			t7 = space();
    			if (if_block0) if_block0.c();
    			t8 = space();
    			div3 = element("div");
    			span1 = element("span");
    			span1.textContent = "🌍";
    			t10 = space();
    			if (if_block1) if_block1.c();
    			t11 = space();
    			div4 = element("div");
    			span2 = element("span");
    			span2.textContent = "✏️";
    			t13 = space();
    			if (if_block2) if_block2.c();
    			t14 = space();
    			button2 = element("button");
    			t15 = text(t15_value);
    			t16 = space();
    			main = element("main");
    			h1 = element("h1");
    			t17 = text("Hello ");
    			t18 = text(/*name*/ ctx[0]);
    			t19 = text("!");
    			if (!src_url_equal(img.src, img_src_value = "/orly.png")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "alt", "Orly Logo");
    			attr_dev(img, "class", "logo svelte-oyyzx8");
    			add_location(img, file, 26, 2, 514);
    			attr_dev(textarea, "placeholder", "What's on your mind?");
    			attr_dev(textarea, "class", "svelte-oyyzx8");
    			add_location(textarea, file, 28, 3, 596);
    			attr_dev(div0, "class", "text-area svelte-oyyzx8");
    			add_location(div0, file, 27, 2, 569);
    			attr_dev(button0, "class", "theme-toggle-btn svelte-oyyzx8");
    			add_location(button0, file, 30, 2, 664);
    			attr_dev(button1, "class", "login-btn svelte-oyyzx8");
    			add_location(button1, file, 33, 2, 766);
    			attr_dev(div1, "class", "header-content svelte-oyyzx8");
    			add_location(div1, file, 25, 1, 483);
    			attr_dev(header, "class", "main-header svelte-oyyzx8");
    			toggle_class(header, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			add_location(header, file, 24, 0, 422);
    			attr_dev(span0, "class", "tab-icon svelte-oyyzx8");
    			add_location(span0, file, 44, 5, 1102);
    			attr_dev(div2, "class", "tab svelte-oyyzx8");
    			add_location(div2, file, 43, 4, 1079);
    			attr_dev(span1, "class", "tab-icon svelte-oyyzx8");
    			add_location(span1, file, 48, 5, 1243);
    			attr_dev(div3, "class", "tab svelte-oyyzx8");
    			add_location(div3, file, 47, 4, 1220);
    			attr_dev(span2, "class", "tab-icon svelte-oyyzx8");
    			add_location(span2, file, 52, 5, 1383);
    			attr_dev(div4, "class", "tab svelte-oyyzx8");
    			add_location(div4, file, 51, 4, 1360);
    			attr_dev(div5, "class", "tabs svelte-oyyzx8");
    			add_location(div5, file, 42, 3, 1056);
    			attr_dev(button2, "class", "toggle-btn svelte-oyyzx8");
    			add_location(button2, file, 56, 3, 1508);
    			attr_dev(div6, "class", "sidebar-content svelte-oyyzx8");
    			add_location(div6, file, 41, 2, 1023);
    			attr_dev(aside, "class", "sidebar svelte-oyyzx8");
    			toggle_class(aside, "collapsed", !/*sidebarExpanded*/ ctx[2]);
    			toggle_class(aside, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			add_location(aside, file, 40, 1, 931);
    			attr_dev(h1, "class", "svelte-oyyzx8");
    			add_location(h1, file, 64, 2, 1682);
    			attr_dev(main, "class", "main-content svelte-oyyzx8");
    			add_location(main, file, 63, 1, 1652);
    			attr_dev(div7, "class", "app-container svelte-oyyzx8");
    			toggle_class(div7, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			add_location(div7, file, 38, 0, 853);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, header, anchor);
    			append_dev(header, div1);
    			append_dev(div1, img);
    			append_dev(div1, t0);
    			append_dev(div1, div0);
    			append_dev(div0, textarea);
    			append_dev(div1, t1);
    			append_dev(div1, button0);
    			append_dev(button0, t2);
    			append_dev(div1, t3);
    			append_dev(div1, button1);
    			insert_dev(target, t5, anchor);
    			insert_dev(target, div7, anchor);
    			append_dev(div7, aside);
    			append_dev(aside, div6);
    			append_dev(div6, div5);
    			append_dev(div5, div2);
    			append_dev(div2, span0);
    			append_dev(div2, t7);
    			if (if_block0) if_block0.m(div2, null);
    			append_dev(div5, t8);
    			append_dev(div5, div3);
    			append_dev(div3, span1);
    			append_dev(div3, t10);
    			if (if_block1) if_block1.m(div3, null);
    			append_dev(div5, t11);
    			append_dev(div5, div4);
    			append_dev(div4, span2);
    			append_dev(div4, t13);
    			if (if_block2) if_block2.m(div4, null);
    			append_dev(div6, t14);
    			append_dev(div6, button2);
    			append_dev(button2, t15);
    			append_dev(div7, t16);
    			append_dev(div7, main);
    			append_dev(main, h1);
    			append_dev(h1, t17);
    			append_dev(h1, t18);
    			append_dev(h1, t19);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", /*toggleTheme*/ ctx[4], false, false, false, false),
    					listen_dev(button2, "click", /*toggleSidebar*/ ctx[3], false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*isDarkTheme*/ 2 && t2_value !== (t2_value = (/*isDarkTheme*/ ctx[1] ? '☀️' : '🌙') + "")) set_data_dev(t2, t2_value);

    			if (dirty & /*isDarkTheme*/ 2) {
    				toggle_class(header, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			}

    			if (/*sidebarExpanded*/ ctx[2]) {
    				if (if_block0) ; else {
    					if_block0 = create_if_block_2(ctx);
    					if_block0.c();
    					if_block0.m(div2, null);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (/*sidebarExpanded*/ ctx[2]) {
    				if (if_block1) ; else {
    					if_block1 = create_if_block_1(ctx);
    					if_block1.c();
    					if_block1.m(div3, null);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}

    			if (/*sidebarExpanded*/ ctx[2]) {
    				if (if_block2) ; else {
    					if_block2 = create_if_block(ctx);
    					if_block2.c();
    					if_block2.m(div4, null);
    				}
    			} else if (if_block2) {
    				if_block2.d(1);
    				if_block2 = null;
    			}

    			if (dirty & /*sidebarExpanded*/ 4 && t15_value !== (t15_value = (/*sidebarExpanded*/ ctx[2] ? '◀' : '▶') + "")) set_data_dev(t15, t15_value);

    			if (dirty & /*sidebarExpanded*/ 4) {
    				toggle_class(aside, "collapsed", !/*sidebarExpanded*/ ctx[2]);
    			}

    			if (dirty & /*isDarkTheme*/ 2) {
    				toggle_class(aside, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			}

    			if (dirty & /*name*/ 1) set_data_dev(t18, /*name*/ ctx[0]);

    			if (dirty & /*isDarkTheme*/ 2) {
    				toggle_class(div7, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(header);
    			if (detaching) detach_dev(t5);
    			if (detaching) detach_dev(div7);
    			if (if_block0) if_block0.d();
    			if (if_block1) if_block1.d();
    			if (if_block2) if_block2.d();
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('App', slots, []);
    	let { name } = $$props;
    	let sidebarExpanded = true;
    	let isDarkTheme = false;

    	function toggleSidebar() {
    		$$invalidate(2, sidebarExpanded = !sidebarExpanded);
    	}

    	function toggleTheme() {
    		$$invalidate(1, isDarkTheme = !isDarkTheme);
    	}

    	$$self.$$.on_mount.push(function () {
    		if (name === undefined && !('name' in $$props || $$self.$$.bound[$$self.$$.props['name']])) {
    			console.warn("<App> was created without expected prop 'name'");
    		}
    	});

    	const writable_props = ['name'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ('name' in $$props) $$invalidate(0, name = $$props.name);
    	};

    	$$self.$capture_state = () => ({
    		name,
    		sidebarExpanded,
    		isDarkTheme,
    		toggleSidebar,
    		toggleTheme
    	});

    	$$self.$inject_state = $$props => {
    		if ('name' in $$props) $$invalidate(0, name = $$props.name);
    		if ('sidebarExpanded' in $$props) $$invalidate(2, sidebarExpanded = $$props.sidebarExpanded);
    		if ('isDarkTheme' in $$props) $$invalidate(1, isDarkTheme = $$props.isDarkTheme);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*isDarkTheme*/ 2) {
    			if (typeof document !== 'undefined') {
    				if (isDarkTheme) {
    					document.body.classList.add('dark-theme');
    				} else {
    					document.body.classList.remove('dark-theme');
    				}
    			}
    		}
    	};

    	return [name, isDarkTheme, sidebarExpanded, toggleSidebar, toggleTheme];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment, safe_not_equal, { name: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment.name
    		});
    	}

    	get name() {
    		throw new Error("<App>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set name(value) {
    		throw new Error("<App>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    const app = new App({
    	target: document.body,
    	props: {
    		name: 'world'
    	}
    });

    return app;

})();
//# sourceMappingURL=bundle.js.map
