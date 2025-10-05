
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
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
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
    function validate_each_argument(arg) {
        if (typeof arg !== 'string' && !(arg && typeof arg === 'object' && 'length' in arg)) {
            let msg = '{#each} only iterates over array-like objects.';
            if (typeof Symbol === 'function' && arg && Symbol.iterator in arg) {
                msg += ' You can use a spread to convert this iterable into an array.';
            }
            throw new Error(msg);
        }
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

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[10] = list[i];
    	return child_ctx;
    }

    // (74:24) {#if sidebarExpanded}
    function create_if_block(ctx) {
    	let span;
    	let t_value = /*tab*/ ctx[10].label + "";
    	let t;

    	const block = {
    		c: function create() {
    			span = element("span");
    			t = text(t_value);
    			attr_dev(span, "class", "tab-label svelte-slgbnb");
    			add_location(span, file, 73, 45, 2357);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, span, anchor);
    			append_dev(span, t);
    		},
    		p: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(span);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block.name,
    		type: "if",
    		source: "(74:24) {#if sidebarExpanded}",
    		ctx
    	});

    	return block;
    }

    // (70:16) {#each tabs as tab}
    function create_each_block(ctx) {
    	let div;
    	let span;
    	let t0_value = /*tab*/ ctx[10].icon + "";
    	let t0;
    	let t1;
    	let t2;
    	let mounted;
    	let dispose;
    	let if_block = /*sidebarExpanded*/ ctx[3] && create_if_block(ctx);

    	function click_handler() {
    		return /*click_handler*/ ctx[9](/*tab*/ ctx[10]);
    	}

    	const block = {
    		c: function create() {
    			div = element("div");
    			span = element("span");
    			t0 = text(t0_value);
    			t1 = space();
    			if (if_block) if_block.c();
    			t2 = space();
    			attr_dev(span, "class", "tab-icon svelte-slgbnb");
    			add_location(span, file, 72, 24, 2271);
    			attr_dev(div, "class", "tab svelte-slgbnb");
    			toggle_class(div, "active", /*selectedTab*/ ctx[2] === /*tab*/ ctx[10].id);
    			add_location(div, file, 70, 20, 2131);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, span);
    			append_dev(span, t0);
    			append_dev(div, t1);
    			if (if_block) if_block.m(div, null);
    			append_dev(div, t2);

    			if (!mounted) {
    				dispose = listen_dev(div, "click", click_handler, false, false, false, false);
    				mounted = true;
    			}
    		},
    		p: function update(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (/*sidebarExpanded*/ ctx[3]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					if_block.m(div, t2);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (dirty & /*selectedTab, tabs*/ 36) {
    				toggle_class(div, "active", /*selectedTab*/ ctx[2] === /*tab*/ ctx[10].id);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			if (if_block) if_block.d();
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block.name,
    		type: "each",
    		source: "(70:16) {#each tabs as tab}",
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
    	let span;
    	let t1_value = /*selectedTabData*/ ctx[4].label + "";
    	let t1;
    	let t2;
    	let button0;
    	let t3_value = (/*isDarkTheme*/ ctx[1] ? '☀️' : '🌙') + "";
    	let t3;
    	let t4;
    	let button1;
    	let t6;
    	let div4;
    	let aside;
    	let div3;
    	let div2;
    	let t7;
    	let button2;
    	let t8_value = (/*sidebarExpanded*/ ctx[3] ? '◀' : '▶') + "";
    	let t8;
    	let t9;
    	let main;
    	let h1;
    	let t10;
    	let t11;
    	let t12;
    	let mounted;
    	let dispose;
    	let each_value = /*tabs*/ ctx[5];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	const block = {
    		c: function create() {
    			header = element("header");
    			div1 = element("div");
    			img = element("img");
    			t0 = space();
    			div0 = element("div");
    			span = element("span");
    			t1 = text(t1_value);
    			t2 = space();
    			button0 = element("button");
    			t3 = text(t3_value);
    			t4 = space();
    			button1 = element("button");
    			button1.textContent = "📥";
    			t6 = space();
    			div4 = element("div");
    			aside = element("aside");
    			div3 = element("div");
    			div2 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t7 = space();
    			button2 = element("button");
    			t8 = text(t8_value);
    			t9 = space();
    			main = element("main");
    			h1 = element("h1");
    			t10 = text("Hello ");
    			t11 = text(/*name*/ ctx[0]);
    			t12 = text("!");
    			if (!src_url_equal(img.src, img_src_value = "/orly.png")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "alt", "Orly Logo");
    			attr_dev(img, "class", "logo svelte-slgbnb");
    			add_location(img, file, 51, 8, 1423);
    			attr_dev(span, "class", "selected-tab-label svelte-slgbnb");
    			add_location(span, file, 53, 12, 1524);
    			attr_dev(div0, "class", "tab-label-area svelte-slgbnb");
    			add_location(div0, file, 52, 8, 1483);
    			attr_dev(button0, "class", "theme-toggle-btn svelte-slgbnb");
    			add_location(button0, file, 55, 8, 1611);
    			attr_dev(button1, "class", "login-btn svelte-slgbnb");
    			add_location(button1, file, 58, 8, 1734);
    			attr_dev(div1, "class", "header-content svelte-slgbnb");
    			add_location(div1, file, 50, 4, 1386);
    			attr_dev(header, "class", "main-header svelte-slgbnb");
    			toggle_class(header, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			add_location(header, file, 49, 0, 1322);
    			attr_dev(div2, "class", "tabs svelte-slgbnb");
    			add_location(div2, file, 68, 12, 2056);
    			attr_dev(button2, "class", "toggle-btn svelte-slgbnb");
    			add_location(button2, file, 78, 12, 2519);
    			attr_dev(div3, "class", "sidebar-content svelte-slgbnb");
    			add_location(div3, file, 67, 8, 2014);
    			attr_dev(aside, "class", "sidebar svelte-slgbnb");
    			toggle_class(aside, "collapsed", !/*sidebarExpanded*/ ctx[3]);
    			toggle_class(aside, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			add_location(aside, file, 65, 4, 1905);
    			attr_dev(h1, "class", "svelte-slgbnb");
    			add_location(h1, file, 86, 8, 2735);
    			attr_dev(main, "class", "main-content svelte-slgbnb");
    			add_location(main, file, 85, 4, 2699);
    			attr_dev(div4, "class", "app-container svelte-slgbnb");
    			toggle_class(div4, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			add_location(div4, file, 63, 0, 1821);
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
    			append_dev(div0, span);
    			append_dev(span, t1);
    			append_dev(div1, t2);
    			append_dev(div1, button0);
    			append_dev(button0, t3);
    			append_dev(div1, t4);
    			append_dev(div1, button1);
    			insert_dev(target, t6, anchor);
    			insert_dev(target, div4, anchor);
    			append_dev(div4, aside);
    			append_dev(aside, div3);
    			append_dev(div3, div2);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				if (each_blocks[i]) {
    					each_blocks[i].m(div2, null);
    				}
    			}

    			append_dev(div3, t7);
    			append_dev(div3, button2);
    			append_dev(button2, t8);
    			append_dev(div4, t9);
    			append_dev(div4, main);
    			append_dev(main, h1);
    			append_dev(h1, t10);
    			append_dev(h1, t11);
    			append_dev(h1, t12);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", /*toggleTheme*/ ctx[7], false, false, false, false),
    					listen_dev(button2, "click", /*toggleSidebar*/ ctx[6], false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*selectedTabData*/ 16 && t1_value !== (t1_value = /*selectedTabData*/ ctx[4].label + "")) set_data_dev(t1, t1_value);
    			if (dirty & /*isDarkTheme*/ 2 && t3_value !== (t3_value = (/*isDarkTheme*/ ctx[1] ? '☀️' : '🌙') + "")) set_data_dev(t3, t3_value);

    			if (dirty & /*isDarkTheme*/ 2) {
    				toggle_class(header, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			}

    			if (dirty & /*selectedTab, tabs, selectTab, sidebarExpanded*/ 300) {
    				each_value = /*tabs*/ ctx[5];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div2, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (dirty & /*sidebarExpanded*/ 8 && t8_value !== (t8_value = (/*sidebarExpanded*/ ctx[3] ? '◀' : '▶') + "")) set_data_dev(t8, t8_value);

    			if (dirty & /*sidebarExpanded*/ 8) {
    				toggle_class(aside, "collapsed", !/*sidebarExpanded*/ ctx[3]);
    			}

    			if (dirty & /*isDarkTheme*/ 2) {
    				toggle_class(aside, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			}

    			if (dirty & /*name*/ 1) set_data_dev(t11, /*name*/ ctx[0]);

    			if (dirty & /*isDarkTheme*/ 2) {
    				toggle_class(div4, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(header);
    			if (detaching) detach_dev(t6);
    			if (detaching) detach_dev(div4);
    			destroy_each(each_blocks, detaching);
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
    	let selectedTabData;
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('App', slots, []);
    	let { name } = $$props;
    	let sidebarExpanded = true;
    	let isDarkTheme = false;
    	let selectedTab = 'global';

    	// Load theme preference from localStorage on component initialization
    	if (typeof localStorage !== 'undefined') {
    		const savedTheme = localStorage.getItem('isDarkTheme');

    		if (savedTheme !== null) {
    			isDarkTheme = JSON.parse(savedTheme);
    		}
    	}

    	const tabs = [
    		{
    			id: 'follows',
    			icon: '👥',
    			label: 'follows'
    		},
    		{
    			id: 'global',
    			icon: '🌍',
    			label: 'global'
    		},
    		{ id: 'write', icon: '✏️', label: 'write' }
    	];

    	function toggleSidebar() {
    		$$invalidate(3, sidebarExpanded = !sidebarExpanded);
    	}

    	function toggleTheme() {
    		$$invalidate(1, isDarkTheme = !isDarkTheme);

    		// Save theme preference to localStorage
    		if (typeof localStorage !== 'undefined') {
    			localStorage.setItem('isDarkTheme', JSON.stringify(isDarkTheme));
    		}
    	}

    	function selectTab(tabId) {
    		$$invalidate(2, selectedTab = tabId);
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

    	const click_handler = tab => selectTab(tab.id);

    	$$self.$$set = $$props => {
    		if ('name' in $$props) $$invalidate(0, name = $$props.name);
    	};

    	$$self.$capture_state = () => ({
    		name,
    		sidebarExpanded,
    		isDarkTheme,
    		selectedTab,
    		tabs,
    		toggleSidebar,
    		toggleTheme,
    		selectTab,
    		selectedTabData
    	});

    	$$self.$inject_state = $$props => {
    		if ('name' in $$props) $$invalidate(0, name = $$props.name);
    		if ('sidebarExpanded' in $$props) $$invalidate(3, sidebarExpanded = $$props.sidebarExpanded);
    		if ('isDarkTheme' in $$props) $$invalidate(1, isDarkTheme = $$props.isDarkTheme);
    		if ('selectedTab' in $$props) $$invalidate(2, selectedTab = $$props.selectedTab);
    		if ('selectedTabData' in $$props) $$invalidate(4, selectedTabData = $$props.selectedTabData);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*selectedTab*/ 4) {
    			$$invalidate(4, selectedTabData = tabs.find(tab => tab.id === selectedTab));
    		}

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

    	return [
    		name,
    		isDarkTheme,
    		selectedTab,
    		sidebarExpanded,
    		selectedTabData,
    		tabs,
    		toggleSidebar,
    		toggleTheme,
    		selectTab,
    		click_handler
    	];
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
