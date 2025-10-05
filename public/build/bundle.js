
(function(l, r) { if (!l || l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (self.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(self.document);
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

    const globals = (typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : global);
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
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function stop_propagation(fn) {
        return function (event) {
            event.stopPropagation();
            // @ts-ignore
            return fn.call(this, event);
        };
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
    function set_input_value(input, value) {
        input.value = value == null ? '' : value;
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
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    /**
     * Creates an event dispatcher that can be used to dispatch [component events](/docs#template-syntax-component-directives-on-eventname).
     * Event dispatchers are functions that can take two arguments: `name` and `detail`.
     *
     * Component events created with `createEventDispatcher` create a
     * [CustomEvent](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent).
     * These events do not [bubble](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Building_blocks/Events#Event_bubbling_and_capture).
     * The `detail` argument corresponds to the [CustomEvent.detail](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent/detail)
     * property and can contain any type of data.
     *
     * https://svelte.dev/docs#run-time-svelte-createeventdispatcher
     */
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail, { cancelable = false } = {}) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail, { cancelable });
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
                return !event.defaultPrevented;
            }
            return true;
        };
    }
    // TODO figure out if we still want to support
    // shorthand events, or if we want to implement
    // a real bubbling mechanism
    function bubble(component, event) {
        const callbacks = component.$$.callbacks[event.type];
        if (callbacks) {
            // @ts-ignore
            callbacks.slice().forEach(fn => fn.call(this, event));
        }
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
    function add_flush_callback(fn) {
        flush_callbacks.push(fn);
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
    let outros;
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
        else if (callback) {
            callback();
        }
    }

    function bind(component, name, callback) {
        const index = component.$$.props[name];
        if (index !== undefined) {
            component.$$.bound[index] = callback;
            callback(component.$$.ctx[index]);
        }
    }
    function create_component(block) {
        block && block.c();
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
    function prop_dev(node, property, value) {
        node[property] = value;
        dispatch_dev('SvelteDOMSetProperty', { node, property, value });
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

    /* src/LoginModal.svelte generated by Svelte v3.59.2 */

    const { Error: Error_1, window: window_1 } = globals;
    const file$1 = "src/LoginModal.svelte";

    // (146:0) {#if showModal}
    function create_if_block$1(ctx) {
    	let div5;
    	let div4;
    	let div0;
    	let h2;
    	let t1;
    	let button0;
    	let t3;
    	let div3;
    	let div1;
    	let button1;
    	let t5;
    	let button2;
    	let t7;
    	let div2;
    	let t8;
    	let t9;
    	let mounted;
    	let dispose;

    	function select_block_type(ctx, dirty) {
    		if (/*activeTab*/ ctx[2] === 'extension') return create_if_block_3$1;
    		return create_else_block$1;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block0 = current_block_type(ctx);
    	let if_block1 = /*errorMessage*/ ctx[5] && create_if_block_2$1(ctx);
    	let if_block2 = /*successMessage*/ ctx[6] && create_if_block_1$1(ctx);

    	const block = {
    		c: function create() {
    			div5 = element("div");
    			div4 = element("div");
    			div0 = element("div");
    			h2 = element("h2");
    			h2.textContent = "Login to Nostr";
    			t1 = space();
    			button0 = element("button");
    			button0.textContent = "×";
    			t3 = space();
    			div3 = element("div");
    			div1 = element("div");
    			button1 = element("button");
    			button1.textContent = "Extension";
    			t5 = space();
    			button2 = element("button");
    			button2.textContent = "Nsec";
    			t7 = space();
    			div2 = element("div");
    			if_block0.c();
    			t8 = space();
    			if (if_block1) if_block1.c();
    			t9 = space();
    			if (if_block2) if_block2.c();
    			attr_dev(h2, "class", "svelte-9yzcwg");
    			add_location(h2, file$1, 149, 16, 4706);
    			attr_dev(button0, "class", "close-btn svelte-9yzcwg");
    			add_location(button0, file$1, 150, 16, 4746);
    			attr_dev(div0, "class", "modal-header svelte-9yzcwg");
    			add_location(div0, file$1, 148, 12, 4663);
    			attr_dev(button1, "class", "tab-btn svelte-9yzcwg");
    			toggle_class(button1, "active", /*activeTab*/ ctx[2] === 'extension');
    			add_location(button1, file$1, 155, 20, 4938);
    			attr_dev(button2, "class", "tab-btn svelte-9yzcwg");
    			toggle_class(button2, "active", /*activeTab*/ ctx[2] === 'nsec');
    			add_location(button2, file$1, 162, 20, 5222);
    			attr_dev(div1, "class", "tabs svelte-9yzcwg");
    			add_location(div1, file$1, 154, 16, 4899);
    			attr_dev(div2, "class", "tab-content svelte-9yzcwg");
    			add_location(div2, file$1, 171, 16, 5527);
    			attr_dev(div3, "class", "tab-container svelte-9yzcwg");
    			add_location(div3, file$1, 153, 12, 4855);
    			attr_dev(div4, "class", "modal svelte-9yzcwg");
    			toggle_class(div4, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			add_location(div4, file$1, 147, 8, 4575);
    			attr_dev(div5, "class", "modal-overlay svelte-9yzcwg");
    			add_location(div5, file$1, 146, 4, 4517);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div5, anchor);
    			append_dev(div5, div4);
    			append_dev(div4, div0);
    			append_dev(div0, h2);
    			append_dev(div0, t1);
    			append_dev(div0, button0);
    			append_dev(div4, t3);
    			append_dev(div4, div3);
    			append_dev(div3, div1);
    			append_dev(div1, button1);
    			append_dev(div1, t5);
    			append_dev(div1, button2);
    			append_dev(div3, t7);
    			append_dev(div3, div2);
    			if_block0.m(div2, null);
    			append_dev(div2, t8);
    			if (if_block1) if_block1.m(div2, null);
    			append_dev(div2, t9);
    			if (if_block2) if_block2.m(div2, null);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", /*closeModal*/ ctx[7], false, false, false, false),
    					listen_dev(button1, "click", /*click_handler_1*/ ctx[13], false, false, false, false),
    					listen_dev(button2, "click", /*click_handler_2*/ ctx[14], false, false, false, false),
    					listen_dev(div4, "click", stop_propagation(/*click_handler*/ ctx[12]), false, false, true, false),
    					listen_dev(div5, "click", /*closeModal*/ ctx[7], false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*activeTab*/ 4) {
    				toggle_class(button1, "active", /*activeTab*/ ctx[2] === 'extension');
    			}

    			if (dirty & /*activeTab*/ 4) {
    				toggle_class(button2, "active", /*activeTab*/ ctx[2] === 'nsec');
    			}

    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block0) {
    				if_block0.p(ctx, dirty);
    			} else {
    				if_block0.d(1);
    				if_block0 = current_block_type(ctx);

    				if (if_block0) {
    					if_block0.c();
    					if_block0.m(div2, t8);
    				}
    			}

    			if (/*errorMessage*/ ctx[5]) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);
    				} else {
    					if_block1 = create_if_block_2$1(ctx);
    					if_block1.c();
    					if_block1.m(div2, t9);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}

    			if (/*successMessage*/ ctx[6]) {
    				if (if_block2) {
    					if_block2.p(ctx, dirty);
    				} else {
    					if_block2 = create_if_block_1$1(ctx);
    					if_block2.c();
    					if_block2.m(div2, null);
    				}
    			} else if (if_block2) {
    				if_block2.d(1);
    				if_block2 = null;
    			}

    			if (dirty & /*isDarkTheme*/ 2) {
    				toggle_class(div4, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div5);
    			if_block0.d();
    			if (if_block1) if_block1.d();
    			if (if_block2) if_block2.d();
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$1.name,
    		type: "if",
    		source: "(146:0) {#if showModal}",
    		ctx
    	});

    	return block;
    }

    // (184:20) {:else}
    function create_else_block$1(ctx) {
    	let div;
    	let p;
    	let t1;
    	let input;
    	let t2;
    	let button;

    	let t3_value = (/*isLoading*/ ctx[4]
    	? 'Logging in...'
    	: 'Log in with nsec') + "";

    	let t3;
    	let button_disabled_value;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			div = element("div");
    			p = element("p");
    			p.textContent = "Enter your nsec (private key) to login. This will be stored securely in your browser.";
    			t1 = space();
    			input = element("input");
    			t2 = space();
    			button = element("button");
    			t3 = text(t3_value);
    			attr_dev(p, "class", "svelte-9yzcwg");
    			add_location(p, file$1, 185, 28, 6269);
    			attr_dev(input, "type", "password");
    			attr_dev(input, "placeholder", "nsec1...");
    			input.disabled = /*isLoading*/ ctx[4];
    			attr_dev(input, "class", "nsec-input svelte-9yzcwg");
    			add_location(input, file$1, 186, 28, 6390);
    			attr_dev(button, "class", "login-nsec-btn svelte-9yzcwg");
    			button.disabled = button_disabled_value = /*isLoading*/ ctx[4] || !/*nsecInput*/ ctx[3].trim();
    			add_location(button, file$1, 193, 28, 6719);
    			attr_dev(div, "class", "nsec-login svelte-9yzcwg");
    			add_location(div, file$1, 184, 24, 6216);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, p);
    			append_dev(div, t1);
    			append_dev(div, input);
    			set_input_value(input, /*nsecInput*/ ctx[3]);
    			append_dev(div, t2);
    			append_dev(div, button);
    			append_dev(button, t3);

    			if (!mounted) {
    				dispose = [
    					listen_dev(input, "input", /*input_input_handler*/ ctx[15]),
    					listen_dev(button, "click", /*loginWithNsec*/ ctx[10], false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*isLoading*/ 16) {
    				prop_dev(input, "disabled", /*isLoading*/ ctx[4]);
    			}

    			if (dirty & /*nsecInput*/ 8 && input.value !== /*nsecInput*/ ctx[3]) {
    				set_input_value(input, /*nsecInput*/ ctx[3]);
    			}

    			if (dirty & /*isLoading*/ 16 && t3_value !== (t3_value = (/*isLoading*/ ctx[4]
    			? 'Logging in...'
    			: 'Log in with nsec') + "")) set_data_dev(t3, t3_value);

    			if (dirty & /*isLoading, nsecInput*/ 24 && button_disabled_value !== (button_disabled_value = /*isLoading*/ ctx[4] || !/*nsecInput*/ ctx[3].trim())) {
    				prop_dev(button, "disabled", button_disabled_value);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block$1.name,
    		type: "else",
    		source: "(184:20) {:else}",
    		ctx
    	});

    	return block;
    }

    // (173:20) {#if activeTab === 'extension'}
    function create_if_block_3$1(ctx) {
    	let div;
    	let p;
    	let t1;
    	let button;

    	let t2_value = (/*isLoading*/ ctx[4]
    	? 'Connecting...'
    	: 'Log in using extension') + "";

    	let t2;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			div = element("div");
    			p = element("p");
    			p.textContent = "Login using a NIP-07 compatible browser extension like nos2x or Alby.";
    			t1 = space();
    			button = element("button");
    			t2 = text(t2_value);
    			attr_dev(p, "class", "svelte-9yzcwg");
    			add_location(p, file$1, 174, 28, 5687);
    			attr_dev(button, "class", "login-extension-btn svelte-9yzcwg");
    			button.disabled = /*isLoading*/ ctx[4];
    			add_location(button, file$1, 175, 28, 5792);
    			attr_dev(div, "class", "extension-login svelte-9yzcwg");
    			add_location(div, file$1, 173, 24, 5629);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, p);
    			append_dev(div, t1);
    			append_dev(div, button);
    			append_dev(button, t2);

    			if (!mounted) {
    				dispose = listen_dev(button, "click", /*loginWithExtension*/ ctx[9], false, false, false, false);
    				mounted = true;
    			}
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*isLoading*/ 16 && t2_value !== (t2_value = (/*isLoading*/ ctx[4]
    			? 'Connecting...'
    			: 'Log in using extension') + "")) set_data_dev(t2, t2_value);

    			if (dirty & /*isLoading*/ 16) {
    				prop_dev(button, "disabled", /*isLoading*/ ctx[4]);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_3$1.name,
    		type: "if",
    		source: "(173:20) {#if activeTab === 'extension'}",
    		ctx
    	});

    	return block;
    }

    // (204:20) {#if errorMessage}
    function create_if_block_2$1(ctx) {
    	let div;
    	let t;

    	const block = {
    		c: function create() {
    			div = element("div");
    			t = text(/*errorMessage*/ ctx[5]);
    			attr_dev(div, "class", "message error-message svelte-9yzcwg");
    			add_location(div, file$1, 204, 24, 7206);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, t);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*errorMessage*/ 32) set_data_dev(t, /*errorMessage*/ ctx[5]);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_2$1.name,
    		type: "if",
    		source: "(204:20) {#if errorMessage}",
    		ctx
    	});

    	return block;
    }

    // (208:20) {#if successMessage}
    function create_if_block_1$1(ctx) {
    	let div;
    	let t;

    	const block = {
    		c: function create() {
    			div = element("div");
    			t = text(/*successMessage*/ ctx[6]);
    			attr_dev(div, "class", "message success-message svelte-9yzcwg");
    			add_location(div, file$1, 208, 24, 7374);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, t);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*successMessage*/ 64) set_data_dev(t, /*successMessage*/ ctx[6]);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1$1.name,
    		type: "if",
    		source: "(208:20) {#if successMessage}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$1(ctx) {
    	let if_block_anchor;
    	let mounted;
    	let dispose;
    	let if_block = /*showModal*/ ctx[0] && create_if_block$1(ctx);

    	const block = {
    		c: function create() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		l: function claim(nodes) {
    			throw new Error_1("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert_dev(target, if_block_anchor, anchor);

    			if (!mounted) {
    				dispose = listen_dev(window_1, "keydown", /*handleKeydown*/ ctx[11], false, false, false, false);
    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (/*showModal*/ ctx[0]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block$1(ctx);
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach_dev(if_block_anchor);
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$1.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function validateNsec(nsec) {
    	// Basic validation for nsec format
    	if (!nsec.startsWith('nsec1')) {
    		return false;
    	}

    	// Should be around 63 characters long
    	if (nsec.length < 60 || nsec.length > 70) {
    		return false;
    	}

    	return true;
    }

    function nsecToHex(nsec) {
    	// This is a simplified conversion - in a real app you'd use a proper library
    	// For demo purposes, we'll simulate the conversion
    	try {
    		// Remove 'nsec1' prefix and decode (simplified)
    		const withoutPrefix = nsec.slice(5);

    		// In reality, you'd use bech32 decoding here
    		// For now, we'll generate a mock hex key
    		return 'mock_' + withoutPrefix.slice(0, 32);
    	} catch(error) {
    		throw new Error('Invalid nsec format');
    	}
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('LoginModal', slots, []);
    	const dispatch = createEventDispatcher();
    	let { showModal = false } = $$props;
    	let { isDarkTheme = false } = $$props;
    	let activeTab = 'extension';
    	let nsecInput = '';
    	let isLoading = false;
    	let errorMessage = '';
    	let successMessage = '';

    	function closeModal() {
    		$$invalidate(0, showModal = false);
    		$$invalidate(3, nsecInput = '');
    		$$invalidate(5, errorMessage = '');
    		$$invalidate(6, successMessage = '');
    		dispatch('close');
    	}

    	function switchTab(tab) {
    		$$invalidate(2, activeTab = tab);
    		$$invalidate(5, errorMessage = '');
    		$$invalidate(6, successMessage = '');
    	}

    	async function loginWithExtension() {
    		$$invalidate(4, isLoading = true);
    		$$invalidate(5, errorMessage = '');
    		$$invalidate(6, successMessage = '');

    		try {
    			// Check if window.nostr is available
    			if (!window.nostr) {
    				throw new Error('No Nostr extension found. Please install a NIP-07 compatible extension like nos2x or Alby.');
    			}

    			// Get public key from extension
    			const pubkey = await window.nostr.getPublicKey();

    			if (pubkey) {
    				// Store authentication info
    				localStorage.setItem('nostr_auth_method', 'extension');

    				localStorage.setItem('nostr_pubkey', pubkey);
    				$$invalidate(6, successMessage = 'Successfully logged in with extension!');

    				dispatch('login', {
    					method: 'extension',
    					pubkey,
    					signer: window.nostr
    				});

    				setTimeout(
    					() => {
    						closeModal();
    					},
    					1500
    				);
    			}
    		} catch(error) {
    			$$invalidate(5, errorMessage = error.message);
    		} finally {
    			$$invalidate(4, isLoading = false);
    		}
    	}

    	async function loginWithNsec() {
    		$$invalidate(4, isLoading = true);
    		$$invalidate(5, errorMessage = '');
    		$$invalidate(6, successMessage = '');

    		try {
    			if (!nsecInput.trim()) {
    				throw new Error('Please enter your nsec');
    			}

    			if (!validateNsec(nsecInput.trim())) {
    				throw new Error('Invalid nsec format. Must start with "nsec1"');
    			}

    			// Convert nsec to hex format (simplified for demo)
    			const privateKey = nsecToHex(nsecInput.trim());

    			// In a real implementation, you'd derive the public key from private key
    			const publicKey = 'derived_' + privateKey.slice(5, 37);

    			// Store securely (in production, consider more secure storage)
    			localStorage.setItem('nostr_auth_method', 'nsec');

    			localStorage.setItem('nostr_pubkey', publicKey);
    			localStorage.setItem('nostr_privkey', privateKey);
    			$$invalidate(6, successMessage = 'Successfully logged in with nsec!');

    			dispatch('login', {
    				method: 'nsec',
    				pubkey: publicKey,
    				privateKey
    			});

    			setTimeout(
    				() => {
    					closeModal();
    				},
    				1500
    			);
    		} catch(error) {
    			$$invalidate(5, errorMessage = error.message);
    		} finally {
    			$$invalidate(4, isLoading = false);
    		}
    	}

    	function handleKeydown(event) {
    		if (event.key === 'Escape') {
    			closeModal();
    		}

    		if (event.key === 'Enter' && activeTab === 'nsec') {
    			loginWithNsec();
    		}
    	}

    	const writable_props = ['showModal', 'isDarkTheme'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<LoginModal> was created with unknown prop '${key}'`);
    	});

    	function click_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	const click_handler_1 = () => switchTab('extension');
    	const click_handler_2 = () => switchTab('nsec');

    	function input_input_handler() {
    		nsecInput = this.value;
    		$$invalidate(3, nsecInput);
    	}

    	$$self.$$set = $$props => {
    		if ('showModal' in $$props) $$invalidate(0, showModal = $$props.showModal);
    		if ('isDarkTheme' in $$props) $$invalidate(1, isDarkTheme = $$props.isDarkTheme);
    	};

    	$$self.$capture_state = () => ({
    		createEventDispatcher,
    		dispatch,
    		showModal,
    		isDarkTheme,
    		activeTab,
    		nsecInput,
    		isLoading,
    		errorMessage,
    		successMessage,
    		closeModal,
    		switchTab,
    		loginWithExtension,
    		validateNsec,
    		nsecToHex,
    		loginWithNsec,
    		handleKeydown
    	});

    	$$self.$inject_state = $$props => {
    		if ('showModal' in $$props) $$invalidate(0, showModal = $$props.showModal);
    		if ('isDarkTheme' in $$props) $$invalidate(1, isDarkTheme = $$props.isDarkTheme);
    		if ('activeTab' in $$props) $$invalidate(2, activeTab = $$props.activeTab);
    		if ('nsecInput' in $$props) $$invalidate(3, nsecInput = $$props.nsecInput);
    		if ('isLoading' in $$props) $$invalidate(4, isLoading = $$props.isLoading);
    		if ('errorMessage' in $$props) $$invalidate(5, errorMessage = $$props.errorMessage);
    		if ('successMessage' in $$props) $$invalidate(6, successMessage = $$props.successMessage);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [
    		showModal,
    		isDarkTheme,
    		activeTab,
    		nsecInput,
    		isLoading,
    		errorMessage,
    		successMessage,
    		closeModal,
    		switchTab,
    		loginWithExtension,
    		loginWithNsec,
    		handleKeydown,
    		click_handler,
    		click_handler_1,
    		click_handler_2,
    		input_input_handler
    	];
    }

    class LoginModal extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, { showModal: 0, isDarkTheme: 1 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "LoginModal",
    			options,
    			id: create_fragment$1.name
    		});
    	}

    	get showModal() {
    		throw new Error_1("<LoginModal>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set showModal(value) {
    		throw new Error_1("<LoginModal>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get isDarkTheme() {
    		throw new Error_1("<LoginModal>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set isDarkTheme(value) {
    		throw new Error_1("<LoginModal>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    // Default Nostr relays for searching
    const DEFAULT_RELAYS = [
        'wss://relay.damus.io',
        'wss://relay.nostr.band',
        'wss://nos.lol',
        'wss://relay.nostr.net',
        'wss://relay.minibits.cash',
        'wss://relay.coinos.io/',
        'wss://nwc.primal.net',
        'wss://relay.orly.dev',
    ];

    // Simple WebSocket relay manager
    class NostrClient {
        constructor() {
            this.relays = new Map();
            this.subscriptions = new Map();
        }

        async connect() {
            console.log('Starting connection to', DEFAULT_RELAYS.length, 'relays...');
            
            const connectionPromises = DEFAULT_RELAYS.map(relayUrl => {
                return new Promise((resolve) => {
                    try {
                        console.log(`Attempting to connect to ${relayUrl}`);
                        const ws = new WebSocket(relayUrl);
                        
                        ws.onopen = () => {
                            console.log(`✓ Successfully connected to ${relayUrl}`);
                            resolve(true);
                        };
                        
                        ws.onerror = (error) => {
                            console.error(`✗ Error connecting to ${relayUrl}:`, error);
                            resolve(false);
                        };
                        
                        ws.onclose = (event) => {
                            console.warn(`Connection closed to ${relayUrl}:`, event.code, event.reason);
                        };
                        
                        ws.onmessage = (event) => {
                            console.log(`Message from ${relayUrl}:`, event.data);
                            try {
                                this.handleMessage(relayUrl, JSON.parse(event.data));
                            } catch (error) {
                                console.error(`Failed to parse message from ${relayUrl}:`, error, event.data);
                            }
                        };
                        
                        this.relays.set(relayUrl, ws);
                        
                        // Timeout after 5 seconds
                        setTimeout(() => {
                            if (ws.readyState !== WebSocket.OPEN) {
                                console.warn(`Connection timeout for ${relayUrl}`);
                                resolve(false);
                            }
                        }, 5000);
                        
                    } catch (error) {
                        console.error(`Failed to create WebSocket for ${relayUrl}:`, error);
                        resolve(false);
                    }
                });
            });
            
            const results = await Promise.all(connectionPromises);
            const successfulConnections = results.filter(Boolean).length;
            console.log(`Connected to ${successfulConnections}/${DEFAULT_RELAYS.length} relays`);
            
            // Wait a bit more for connections to stabilize
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        handleMessage(relayUrl, message) {
            console.log(`Processing message from ${relayUrl}:`, message);
            const [type, subscriptionId, event, ...rest] = message;
            
            console.log(`Message type: ${type}, subscriptionId: ${subscriptionId}`);
            
            if (type === 'EVENT') {
                console.log(`Received EVENT for subscription ${subscriptionId}:`, event);
                if (this.subscriptions.has(subscriptionId)) {
                    console.log(`Found callback for subscription ${subscriptionId}, executing...`);
                    const callback = this.subscriptions.get(subscriptionId);
                    callback(event);
                } else {
                    console.warn(`No callback found for subscription ${subscriptionId}`);
                }
            } else if (type === 'EOSE') {
                console.log(`End of stored events for subscription ${subscriptionId} from ${relayUrl}`);
            } else if (type === 'NOTICE') {
                console.warn(`Notice from ${relayUrl}:`, subscriptionId);
            } else {
                console.log(`Unknown message type ${type} from ${relayUrl}:`, message);
            }
        }

        subscribe(filters, callback) {
            const subscriptionId = Math.random().toString(36).substring(7);
            console.log(`Creating subscription ${subscriptionId} with filters:`, filters);
            
            this.subscriptions.set(subscriptionId, callback);
            
            const subscription = ['REQ', subscriptionId, filters];
            console.log(`Subscription message:`, JSON.stringify(subscription));
            
            let sentCount = 0;
            for (const [relayUrl, ws] of this.relays) {
                console.log(`Checking relay ${relayUrl}, readyState: ${ws.readyState} (${ws.readyState === WebSocket.OPEN ? 'OPEN' : 'NOT OPEN'})`);
                if (ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify(subscription));
                        console.log(`✓ Sent subscription to ${relayUrl}`);
                        sentCount++;
                    } catch (error) {
                        console.error(`✗ Failed to send subscription to ${relayUrl}:`, error);
                    }
                } else {
                    console.warn(`✗ Cannot send to ${relayUrl}, connection not ready`);
                }
            }
            
            console.log(`Subscription ${subscriptionId} sent to ${sentCount}/${this.relays.size} relays`);
            return subscriptionId;
        }

        unsubscribe(subscriptionId) {
            this.subscriptions.delete(subscriptionId);
            
            const closeMessage = ['CLOSE', subscriptionId];
            
            for (const [relayUrl, ws] of this.relays) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(closeMessage));
                }
            }
        }

        disconnect() {
            for (const [relayUrl, ws] of this.relays) {
                ws.close();
            }
            this.relays.clear();
            this.subscriptions.clear();
        }
    }

    // Create a global client instance
    const nostrClient = new NostrClient();

    // Fetch user profile metadata (kind 0)
    async function fetchUserProfile(pubkey) {
        return new Promise((resolve, reject) => {
            let profileFound = false;
            
            console.log(`Starting profile fetch for pubkey: ${pubkey}`);
            
            const timeout = setTimeout(() => {
                if (!profileFound) {
                    console.log('Profile fetch timeout reached');
                    reject(new Error('Profile fetch timeout'));
                }
            }, 15000); // Increased timeout to 15 seconds
            
            // Wait a bit to ensure connections are ready
            setTimeout(() => {
                console.log('Starting subscription after connection delay...');
                const subscriptionId = nostrClient.subscribe(
                    {
                        kinds: [0],
                        authors: [pubkey],
                        limit: 1
                    },
                    (event) => {
                        console.log('Profile event received:', event);
                        if (!profileFound) {
                            profileFound = true;
                            clearTimeout(timeout);
                            
                            try {
                                const profile = JSON.parse(event.content);
                                console.log('Parsed profile data:', profile);
                                resolve({
                                    name: profile.name || profile.display_name || '',
                                    picture: profile.picture || '',
                                    banner: profile.banner || '',
                                    about: profile.about || '',
                                    nip05: profile.nip05 || '',
                                    lud16: profile.lud16 || profile.lud06 || ''
                                });
                            } catch (error) {
                                console.error('Failed to parse profile data:', error);
                                reject(new Error('Failed to parse profile data'));
                            }
                            
                            nostrClient.unsubscribe(subscriptionId);
                        }
                    }
                );
            }, 2000); // Wait 2 seconds for connections to be ready
        });
    }

    // Initialize client connection
    async function initializeNostrClient() {
        await nostrClient.connect();
    }

    /* src/App.svelte generated by Svelte v3.59.2 */

    const { console: console_1 } = globals;
    const file = "src/App.svelte";

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[24] = list[i];
    	return child_ctx;
    }

    // (142:8) {:else}
    function create_else_block_2(ctx) {
    	let button;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			button = element("button");
    			button.textContent = "📥";
    			attr_dev(button, "class", "login-btn svelte-q1t33y");
    			add_location(button, file, 142, 12, 4499);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, button, anchor);

    			if (!mounted) {
    				dispose = listen_dev(button, "click", /*openLoginModal*/ ctx[14], false, false, false, false);
    				mounted = true;
    			}
    		},
    		p: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(button);
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block_2.name,
    		type: "else",
    		source: "(142:8) {:else}",
    		ctx
    	});

    	return block;
    }

    // (128:8) {#if isLoggedIn}
    function create_if_block_7(ctx) {
    	let div;
    	let button0;
    	let t0;
    	let span;
    	let t1_value = (/*userProfile*/ ctx[7]?.name || /*userPubkey*/ ctx[6].slice(0, 8) + '...') + "";
    	let t1;
    	let t2;
    	let button1;
    	let mounted;
    	let dispose;

    	function select_block_type_1(ctx, dirty) {
    		if (/*userProfile*/ ctx[7]?.picture) return create_if_block_8;
    		return create_else_block_1;
    	}

    	let current_block_type = select_block_type_1(ctx);
    	let if_block = current_block_type(ctx);

    	const block = {
    		c: function create() {
    			div = element("div");
    			button0 = element("button");
    			if_block.c();
    			t0 = space();
    			span = element("span");
    			t1 = text(t1_value);
    			t2 = space();
    			button1 = element("button");
    			button1.textContent = "🚪";
    			attr_dev(span, "class", "user-name svelte-q1t33y");
    			add_location(span, file, 135, 20, 4216);
    			attr_dev(button0, "class", "user-profile-btn svelte-q1t33y");
    			add_location(button0, file, 129, 16, 3865);
    			attr_dev(button1, "class", "logout-btn svelte-q1t33y");
    			add_location(button1, file, 139, 16, 4389);
    			attr_dev(div, "class", "user-info svelte-q1t33y");
    			add_location(div, file, 128, 12, 3825);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, button0);
    			if_block.m(button0, null);
    			append_dev(button0, t0);
    			append_dev(button0, span);
    			append_dev(span, t1);
    			append_dev(div, t2);
    			append_dev(div, button1);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", /*openSettingsDrawer*/ ctx[18], false, false, false, false),
    					listen_dev(button1, "click", /*handleLogout*/ ctx[16], false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, dirty) {
    			if (current_block_type === (current_block_type = select_block_type_1(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(button0, t0);
    				}
    			}

    			if (dirty & /*userProfile, userPubkey*/ 192 && t1_value !== (t1_value = (/*userProfile*/ ctx[7]?.name || /*userPubkey*/ ctx[6].slice(0, 8) + '...') + "")) set_data_dev(t1, t1_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			if_block.d();
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_7.name,
    		type: "if",
    		source: "(128:8) {#if isLoggedIn}",
    		ctx
    	});

    	return block;
    }

    // (133:20) {:else}
    function create_else_block_1(ctx) {
    	let div;

    	const block = {
    		c: function create() {
    			div = element("div");
    			div.textContent = "👤";
    			attr_dev(div, "class", "user-avatar-placeholder svelte-q1t33y");
    			add_location(div, file, 133, 24, 4124);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    		},
    		p: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block_1.name,
    		type: "else",
    		source: "(133:20) {:else}",
    		ctx
    	});

    	return block;
    }

    // (131:20) {#if userProfile?.picture}
    function create_if_block_8(ctx) {
    	let img;
    	let img_src_value;

    	const block = {
    		c: function create() {
    			img = element("img");
    			if (!src_url_equal(img.src, img_src_value = /*userProfile*/ ctx[7].picture)) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "alt", "User avatar");
    			attr_dev(img, "class", "user-avatar svelte-q1t33y");
    			add_location(img, file, 131, 24, 4000);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, img, anchor);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*userProfile*/ 128 && !src_url_equal(img.src, img_src_value = /*userProfile*/ ctx[7].picture)) {
    				attr_dev(img, "src", img_src_value);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(img);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_8.name,
    		type: "if",
    		source: "(131:20) {#if userProfile?.picture}",
    		ctx
    	});

    	return block;
    }

    // (159:24) {#if sidebarExpanded}
    function create_if_block_6(ctx) {
    	let span;
    	let t_value = /*tab*/ ctx[24].label + "";
    	let t;

    	const block = {
    		c: function create() {
    			span = element("span");
    			t = text(t_value);
    			attr_dev(span, "class", "tab-label svelte-q1t33y");
    			add_location(span, file, 158, 45, 5162);
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
    		id: create_if_block_6.name,
    		type: "if",
    		source: "(159:24) {#if sidebarExpanded}",
    		ctx
    	});

    	return block;
    }

    // (155:16) {#each tabs as tab}
    function create_each_block(ctx) {
    	let div;
    	let span;
    	let t0_value = /*tab*/ ctx[24].icon + "";
    	let t0;
    	let t1;
    	let t2;
    	let mounted;
    	let dispose;
    	let if_block = /*sidebarExpanded*/ ctx[3] && create_if_block_6(ctx);

    	function click_handler_1() {
    		return /*click_handler_1*/ ctx[21](/*tab*/ ctx[24]);
    	}

    	const block = {
    		c: function create() {
    			div = element("div");
    			span = element("span");
    			t0 = text(t0_value);
    			t1 = space();
    			if (if_block) if_block.c();
    			t2 = space();
    			attr_dev(span, "class", "tab-icon svelte-q1t33y");
    			add_location(span, file, 157, 24, 5076);
    			attr_dev(div, "class", "tab svelte-q1t33y");
    			toggle_class(div, "active", /*selectedTab*/ ctx[2] === /*tab*/ ctx[24].id);
    			add_location(div, file, 155, 20, 4936);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, span);
    			append_dev(span, t0);
    			append_dev(div, t1);
    			if (if_block) if_block.m(div, null);
    			append_dev(div, t2);

    			if (!mounted) {
    				dispose = listen_dev(div, "click", click_handler_1, false, false, false, false);
    				mounted = true;
    			}
    		},
    		p: function update(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (/*sidebarExpanded*/ ctx[3]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_6(ctx);
    					if_block.c();
    					if_block.m(div, t2);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (dirty & /*selectedTab, tabs*/ 1028) {
    				toggle_class(div, "active", /*selectedTab*/ ctx[2] === /*tab*/ ctx[24].id);
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
    		source: "(155:16) {#each tabs as tab}",
    		ctx
    	});

    	return block;
    }

    // (177:0) {#if showSettingsDrawer}
    function create_if_block(ctx) {
    	let div3;
    	let div2;
    	let div0;
    	let h2;
    	let t1;
    	let button;
    	let t3;
    	let div1;
    	let mounted;
    	let dispose;
    	let if_block = /*userProfile*/ ctx[7] && create_if_block_1(ctx);

    	const block = {
    		c: function create() {
    			div3 = element("div");
    			div2 = element("div");
    			div0 = element("div");
    			h2 = element("h2");
    			h2.textContent = "Settings";
    			t1 = space();
    			button = element("button");
    			button.textContent = "✕";
    			t3 = space();
    			div1 = element("div");
    			if (if_block) if_block.c();
    			attr_dev(h2, "class", "svelte-q1t33y");
    			add_location(h2, file, 180, 16, 5847);
    			attr_dev(button, "class", "close-btn svelte-q1t33y");
    			add_location(button, file, 181, 16, 5881);
    			attr_dev(div0, "class", "drawer-header svelte-q1t33y");
    			add_location(div0, file, 179, 12, 5803);
    			attr_dev(div1, "class", "drawer-content svelte-q1t33y");
    			add_location(div1, file, 183, 12, 5980);
    			attr_dev(div2, "class", "settings-drawer svelte-q1t33y");
    			toggle_class(div2, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			add_location(div2, file, 178, 8, 5705);
    			attr_dev(div3, "class", "drawer-overlay svelte-q1t33y");
    			add_location(div3, file, 177, 4, 5637);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div3, anchor);
    			append_dev(div3, div2);
    			append_dev(div2, div0);
    			append_dev(div0, h2);
    			append_dev(div0, t1);
    			append_dev(div0, button);
    			append_dev(div2, t3);
    			append_dev(div2, div1);
    			if (if_block) if_block.m(div1, null);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button, "click", /*closeSettingsDrawer*/ ctx[19], false, false, false, false),
    					listen_dev(div2, "click", stop_propagation(/*click_handler*/ ctx[20]), false, false, true, false),
    					listen_dev(div3, "click", /*closeSettingsDrawer*/ ctx[19], false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, dirty) {
    			if (/*userProfile*/ ctx[7]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_1(ctx);
    					if_block.c();
    					if_block.m(div1, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (dirty & /*isDarkTheme*/ 2) {
    				toggle_class(div2, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div3);
    			if (if_block) if_block.d();
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block.name,
    		type: "if",
    		source: "(177:0) {#if showSettingsDrawer}",
    		ctx
    	});

    	return block;
    }

    // (185:16) {#if userProfile}
    function create_if_block_1(ctx) {
    	let div2;
    	let t0;
    	let div1;
    	let t1;
    	let div0;
    	let h3;
    	let t2_value = (/*userProfile*/ ctx[7].name || 'Unknown User') + "";
    	let t2;
    	let t3;
    	let t4;
    	let if_block0 = /*userProfile*/ ctx[7].banner && create_if_block_5(ctx);

    	function select_block_type_2(ctx, dirty) {
    		if (/*userProfile*/ ctx[7].picture) return create_if_block_4;
    		return create_else_block;
    	}

    	let current_block_type = select_block_type_2(ctx);
    	let if_block1 = current_block_type(ctx);
    	let if_block2 = /*userProfile*/ ctx[7].about && create_if_block_3(ctx);
    	let if_block3 = /*userProfile*/ ctx[7].nip05 && create_if_block_2(ctx);

    	const block = {
    		c: function create() {
    			div2 = element("div");
    			if (if_block0) if_block0.c();
    			t0 = space();
    			div1 = element("div");
    			if_block1.c();
    			t1 = space();
    			div0 = element("div");
    			h3 = element("h3");
    			t2 = text(t2_value);
    			t3 = space();
    			if (if_block2) if_block2.c();
    			t4 = space();
    			if (if_block3) if_block3.c();
    			attr_dev(h3, "class", "svelte-q1t33y");
    			add_location(h3, file, 196, 32, 6730);
    			attr_dev(div0, "class", "profile-details svelte-q1t33y");
    			add_location(div0, file, 195, 28, 6668);
    			attr_dev(div1, "class", "profile-info svelte-q1t33y");
    			add_location(div1, file, 189, 24, 6301);
    			attr_dev(div2, "class", "profile-section svelte-q1t33y");
    			add_location(div2, file, 185, 20, 6063);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div2, anchor);
    			if (if_block0) if_block0.m(div2, null);
    			append_dev(div2, t0);
    			append_dev(div2, div1);
    			if_block1.m(div1, null);
    			append_dev(div1, t1);
    			append_dev(div1, div0);
    			append_dev(div0, h3);
    			append_dev(h3, t2);
    			append_dev(div0, t3);
    			if (if_block2) if_block2.m(div0, null);
    			append_dev(div0, t4);
    			if (if_block3) if_block3.m(div0, null);
    		},
    		p: function update(ctx, dirty) {
    			if (/*userProfile*/ ctx[7].banner) {
    				if (if_block0) {
    					if_block0.p(ctx, dirty);
    				} else {
    					if_block0 = create_if_block_5(ctx);
    					if_block0.c();
    					if_block0.m(div2, t0);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (current_block_type === (current_block_type = select_block_type_2(ctx)) && if_block1) {
    				if_block1.p(ctx, dirty);
    			} else {
    				if_block1.d(1);
    				if_block1 = current_block_type(ctx);

    				if (if_block1) {
    					if_block1.c();
    					if_block1.m(div1, t1);
    				}
    			}

    			if (dirty & /*userProfile*/ 128 && t2_value !== (t2_value = (/*userProfile*/ ctx[7].name || 'Unknown User') + "")) set_data_dev(t2, t2_value);

    			if (/*userProfile*/ ctx[7].about) {
    				if (if_block2) {
    					if_block2.p(ctx, dirty);
    				} else {
    					if_block2 = create_if_block_3(ctx);
    					if_block2.c();
    					if_block2.m(div0, t4);
    				}
    			} else if (if_block2) {
    				if_block2.d(1);
    				if_block2 = null;
    			}

    			if (/*userProfile*/ ctx[7].nip05) {
    				if (if_block3) {
    					if_block3.p(ctx, dirty);
    				} else {
    					if_block3 = create_if_block_2(ctx);
    					if_block3.c();
    					if_block3.m(div0, null);
    				}
    			} else if (if_block3) {
    				if_block3.d(1);
    				if_block3 = null;
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div2);
    			if (if_block0) if_block0.d();
    			if_block1.d();
    			if (if_block2) if_block2.d();
    			if (if_block3) if_block3.d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1.name,
    		type: "if",
    		source: "(185:16) {#if userProfile}",
    		ctx
    	});

    	return block;
    }

    // (187:24) {#if userProfile.banner}
    function create_if_block_5(ctx) {
    	let img;
    	let img_src_value;

    	const block = {
    		c: function create() {
    			img = element("img");
    			if (!src_url_equal(img.src, img_src_value = /*userProfile*/ ctx[7].banner)) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "alt", "Profile banner");
    			attr_dev(img, "class", "profile-banner svelte-q1t33y");
    			add_location(img, file, 187, 28, 6170);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, img, anchor);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*userProfile*/ 128 && !src_url_equal(img.src, img_src_value = /*userProfile*/ ctx[7].banner)) {
    				attr_dev(img, "src", img_src_value);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(img);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_5.name,
    		type: "if",
    		source: "(187:24) {#if userProfile.banner}",
    		ctx
    	});

    	return block;
    }

    // (193:28) {:else}
    function create_else_block(ctx) {
    	let div;

    	const block = {
    		c: function create() {
    			div = element("div");
    			div.textContent = "👤";
    			attr_dev(div, "class", "profile-avatar-placeholder svelte-q1t33y");
    			add_location(div, file, 193, 32, 6557);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    		},
    		p: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block.name,
    		type: "else",
    		source: "(193:28) {:else}",
    		ctx
    	});

    	return block;
    }

    // (191:28) {#if userProfile.picture}
    function create_if_block_4(ctx) {
    	let img;
    	let img_src_value;

    	const block = {
    		c: function create() {
    			img = element("img");
    			if (!src_url_equal(img.src, img_src_value = /*userProfile*/ ctx[7].picture)) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "alt", "User avatar");
    			attr_dev(img, "class", "profile-avatar svelte-q1t33y");
    			add_location(img, file, 191, 32, 6414);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, img, anchor);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*userProfile*/ 128 && !src_url_equal(img.src, img_src_value = /*userProfile*/ ctx[7].picture)) {
    				attr_dev(img, "src", img_src_value);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(img);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_4.name,
    		type: "if",
    		source: "(191:28) {#if userProfile.picture}",
    		ctx
    	});

    	return block;
    }

    // (198:32) {#if userProfile.about}
    function create_if_block_3(ctx) {
    	let p;
    	let t_value = /*userProfile*/ ctx[7].about + "";
    	let t;

    	const block = {
    		c: function create() {
    			p = element("p");
    			t = text(t_value);
    			attr_dev(p, "class", "profile-about svelte-q1t33y");
    			add_location(p, file, 198, 36, 6868);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, p, anchor);
    			append_dev(p, t);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*userProfile*/ 128 && t_value !== (t_value = /*userProfile*/ ctx[7].about + "")) set_data_dev(t, t_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(p);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_3.name,
    		type: "if",
    		source: "(198:32) {#if userProfile.about}",
    		ctx
    	});

    	return block;
    }

    // (201:32) {#if userProfile.nip05}
    function create_if_block_2(ctx) {
    	let p;
    	let t_value = /*userProfile*/ ctx[7].nip05 + "";
    	let t;

    	const block = {
    		c: function create() {
    			p = element("p");
    			t = text(t_value);
    			attr_dev(p, "class", "profile-nip05 svelte-q1t33y");
    			add_location(p, file, 201, 36, 7047);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, p, anchor);
    			append_dev(p, t);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*userProfile*/ 128 && t_value !== (t_value = /*userProfile*/ ctx[7].nip05 + "")) set_data_dev(t, t_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(p);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_2.name,
    		type: "if",
    		source: "(201:32) {#if userProfile.nip05}",
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
    	let t1_value = /*selectedTabData*/ ctx[9].label + "";
    	let t1;
    	let t2;
    	let button0;
    	let t3_value = (/*isDarkTheme*/ ctx[1] ? '☀️' : '🌙') + "";
    	let t3;
    	let t4;
    	let t5;
    	let div4;
    	let aside;
    	let div3;
    	let div2;
    	let t6;
    	let button1;
    	let t7_value = (/*sidebarExpanded*/ ctx[3] ? '◀' : '▶') + "";
    	let t7;
    	let t8;
    	let main;
    	let h1;
    	let t9;
    	let t10;
    	let t11;
    	let t12;
    	let t13;
    	let loginmodal;
    	let updating_showModal;
    	let current;
    	let mounted;
    	let dispose;

    	function select_block_type(ctx, dirty) {
    		if (/*isLoggedIn*/ ctx[5]) return create_if_block_7;
    		return create_else_block_2;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block0 = current_block_type(ctx);
    	let each_value = /*tabs*/ ctx[10];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	let if_block1 = /*showSettingsDrawer*/ ctx[8] && create_if_block(ctx);

    	function loginmodal_showModal_binding(value) {
    		/*loginmodal_showModal_binding*/ ctx[22](value);
    	}

    	let loginmodal_props = { isDarkTheme: /*isDarkTheme*/ ctx[1] };

    	if (/*showLoginModal*/ ctx[4] !== void 0) {
    		loginmodal_props.showModal = /*showLoginModal*/ ctx[4];
    	}

    	loginmodal = new LoginModal({ props: loginmodal_props, $$inline: true });
    	binding_callbacks.push(() => bind(loginmodal, 'showModal', loginmodal_showModal_binding));
    	loginmodal.$on("login", /*handleLogin*/ ctx[15]);
    	loginmodal.$on("close", /*closeLoginModal*/ ctx[17]);

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
    			if_block0.c();
    			t5 = space();
    			div4 = element("div");
    			aside = element("aside");
    			div3 = element("div");
    			div2 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t6 = space();
    			button1 = element("button");
    			t7 = text(t7_value);
    			t8 = space();
    			main = element("main");
    			h1 = element("h1");
    			t9 = text("Hello ");
    			t10 = text(/*name*/ ctx[0]);
    			t11 = text("!");
    			t12 = space();
    			if (if_block1) if_block1.c();
    			t13 = space();
    			create_component(loginmodal.$$.fragment);
    			if (!src_url_equal(img.src, img_src_value = "/orly.png")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "alt", "Orly Logo");
    			attr_dev(img, "class", "logo svelte-q1t33y");
    			add_location(img, file, 120, 8, 3485);
    			attr_dev(span, "class", "selected-tab-label svelte-q1t33y");
    			add_location(span, file, 122, 12, 3586);
    			attr_dev(div0, "class", "tab-label-area svelte-q1t33y");
    			add_location(div0, file, 121, 8, 3545);
    			attr_dev(button0, "class", "theme-toggle-btn svelte-q1t33y");
    			add_location(button0, file, 124, 8, 3673);
    			attr_dev(div1, "class", "header-content svelte-q1t33y");
    			add_location(div1, file, 119, 4, 3448);
    			attr_dev(header, "class", "main-header svelte-q1t33y");
    			toggle_class(header, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			add_location(header, file, 118, 0, 3384);
    			attr_dev(div2, "class", "tabs svelte-q1t33y");
    			add_location(div2, file, 153, 12, 4861);
    			attr_dev(button1, "class", "toggle-btn svelte-q1t33y");
    			add_location(button1, file, 163, 12, 5324);
    			attr_dev(div3, "class", "sidebar-content svelte-q1t33y");
    			add_location(div3, file, 152, 8, 4819);
    			attr_dev(aside, "class", "sidebar svelte-q1t33y");
    			toggle_class(aside, "collapsed", !/*sidebarExpanded*/ ctx[3]);
    			toggle_class(aside, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			add_location(aside, file, 150, 4, 4710);
    			attr_dev(h1, "class", "svelte-q1t33y");
    			add_location(h1, file, 171, 8, 5540);
    			attr_dev(main, "class", "main-content svelte-q1t33y");
    			add_location(main, file, 170, 4, 5504);
    			attr_dev(div4, "class", "app-container svelte-q1t33y");
    			toggle_class(div4, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			add_location(div4, file, 148, 0, 4626);
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
    			if_block0.m(div1, null);
    			insert_dev(target, t5, anchor);
    			insert_dev(target, div4, anchor);
    			append_dev(div4, aside);
    			append_dev(aside, div3);
    			append_dev(div3, div2);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				if (each_blocks[i]) {
    					each_blocks[i].m(div2, null);
    				}
    			}

    			append_dev(div3, t6);
    			append_dev(div3, button1);
    			append_dev(button1, t7);
    			append_dev(div4, t8);
    			append_dev(div4, main);
    			append_dev(main, h1);
    			append_dev(h1, t9);
    			append_dev(h1, t10);
    			append_dev(h1, t11);
    			insert_dev(target, t12, anchor);
    			if (if_block1) if_block1.m(target, anchor);
    			insert_dev(target, t13, anchor);
    			mount_component(loginmodal, target, anchor);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", /*toggleTheme*/ ctx[12], false, false, false, false),
    					listen_dev(button1, "click", /*toggleSidebar*/ ctx[11], false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if ((!current || dirty & /*selectedTabData*/ 512) && t1_value !== (t1_value = /*selectedTabData*/ ctx[9].label + "")) set_data_dev(t1, t1_value);
    			if ((!current || dirty & /*isDarkTheme*/ 2) && t3_value !== (t3_value = (/*isDarkTheme*/ ctx[1] ? '☀️' : '🌙') + "")) set_data_dev(t3, t3_value);

    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block0) {
    				if_block0.p(ctx, dirty);
    			} else {
    				if_block0.d(1);
    				if_block0 = current_block_type(ctx);

    				if (if_block0) {
    					if_block0.c();
    					if_block0.m(div1, null);
    				}
    			}

    			if (!current || dirty & /*isDarkTheme*/ 2) {
    				toggle_class(header, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			}

    			if (dirty & /*selectedTab, tabs, selectTab, sidebarExpanded*/ 9228) {
    				each_value = /*tabs*/ ctx[10];
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

    			if ((!current || dirty & /*sidebarExpanded*/ 8) && t7_value !== (t7_value = (/*sidebarExpanded*/ ctx[3] ? '◀' : '▶') + "")) set_data_dev(t7, t7_value);

    			if (!current || dirty & /*sidebarExpanded*/ 8) {
    				toggle_class(aside, "collapsed", !/*sidebarExpanded*/ ctx[3]);
    			}

    			if (!current || dirty & /*isDarkTheme*/ 2) {
    				toggle_class(aside, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			}

    			if (!current || dirty & /*name*/ 1) set_data_dev(t10, /*name*/ ctx[0]);

    			if (!current || dirty & /*isDarkTheme*/ 2) {
    				toggle_class(div4, "dark-theme", /*isDarkTheme*/ ctx[1]);
    			}

    			if (/*showSettingsDrawer*/ ctx[8]) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);
    				} else {
    					if_block1 = create_if_block(ctx);
    					if_block1.c();
    					if_block1.m(t13.parentNode, t13);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}

    			const loginmodal_changes = {};
    			if (dirty & /*isDarkTheme*/ 2) loginmodal_changes.isDarkTheme = /*isDarkTheme*/ ctx[1];

    			if (!updating_showModal && dirty & /*showLoginModal*/ 16) {
    				updating_showModal = true;
    				loginmodal_changes.showModal = /*showLoginModal*/ ctx[4];
    				add_flush_callback(() => updating_showModal = false);
    			}

    			loginmodal.$set(loginmodal_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(loginmodal.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(loginmodal.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(header);
    			if_block0.d();
    			if (detaching) detach_dev(t5);
    			if (detaching) detach_dev(div4);
    			destroy_each(each_blocks, detaching);
    			if (detaching) detach_dev(t12);
    			if (if_block1) if_block1.d(detaching);
    			if (detaching) detach_dev(t13);
    			destroy_component(loginmodal, detaching);
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
    	let showLoginModal = false;
    	let isLoggedIn = false;
    	let userPubkey = '';
    	let authMethod = '';
    	let userProfile = null;
    	let showSettingsDrawer = false;

    	// Load theme preference from localStorage on component initialization
    	if (typeof localStorage !== 'undefined') {
    		const savedTheme = localStorage.getItem('isDarkTheme');

    		if (savedTheme !== null) {
    			isDarkTheme = JSON.parse(savedTheme);
    		}

    		// Check for existing authentication
    		const storedAuthMethod = localStorage.getItem('nostr_auth_method');

    		const storedPubkey = localStorage.getItem('nostr_pubkey');

    		if (storedAuthMethod && storedPubkey) {
    			isLoggedIn = true;
    			userPubkey = storedPubkey;
    			authMethod = storedAuthMethod;
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

    	function openLoginModal() {
    		if (!isLoggedIn) {
    			$$invalidate(4, showLoginModal = true);
    		}
    	}

    	async function handleLogin(event) {
    		const { method, pubkey, privateKey, signer } = event.detail;
    		$$invalidate(5, isLoggedIn = true);
    		$$invalidate(6, userPubkey = pubkey);
    		authMethod = method;
    		$$invalidate(4, showLoginModal = false);

    		// Initialize Nostr client and fetch profile
    		try {
    			await initializeNostrClient();
    			$$invalidate(7, userProfile = await fetchUserProfile(pubkey));
    			console.log('Profile loaded:', userProfile);
    		} catch(error) {
    			console.error('Failed to load profile:', error);
    		}
    	}

    	function handleLogout() {
    		$$invalidate(5, isLoggedIn = false);
    		$$invalidate(6, userPubkey = '');
    		authMethod = '';
    		$$invalidate(7, userProfile = null);
    		$$invalidate(8, showSettingsDrawer = false);

    		// Clear stored authentication
    		if (typeof localStorage !== 'undefined') {
    			localStorage.removeItem('nostr_auth_method');
    			localStorage.removeItem('nostr_pubkey');
    			localStorage.removeItem('nostr_privkey');
    		}
    	}

    	function closeLoginModal() {
    		$$invalidate(4, showLoginModal = false);
    	}

    	function openSettingsDrawer() {
    		$$invalidate(8, showSettingsDrawer = true);
    	}

    	function closeSettingsDrawer() {
    		$$invalidate(8, showSettingsDrawer = false);
    	}

    	$$self.$$.on_mount.push(function () {
    		if (name === undefined && !('name' in $$props || $$self.$$.bound[$$self.$$.props['name']])) {
    			console_1.warn("<App> was created without expected prop 'name'");
    		}
    	});

    	const writable_props = ['name'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console_1.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	function click_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	const click_handler_1 = tab => selectTab(tab.id);

    	function loginmodal_showModal_binding(value) {
    		showLoginModal = value;
    		$$invalidate(4, showLoginModal);
    	}

    	$$self.$$set = $$props => {
    		if ('name' in $$props) $$invalidate(0, name = $$props.name);
    	};

    	$$self.$capture_state = () => ({
    		LoginModal,
    		initializeNostrClient,
    		fetchUserProfile,
    		name,
    		sidebarExpanded,
    		isDarkTheme,
    		selectedTab,
    		showLoginModal,
    		isLoggedIn,
    		userPubkey,
    		authMethod,
    		userProfile,
    		showSettingsDrawer,
    		tabs,
    		toggleSidebar,
    		toggleTheme,
    		selectTab,
    		openLoginModal,
    		handleLogin,
    		handleLogout,
    		closeLoginModal,
    		openSettingsDrawer,
    		closeSettingsDrawer,
    		selectedTabData
    	});

    	$$self.$inject_state = $$props => {
    		if ('name' in $$props) $$invalidate(0, name = $$props.name);
    		if ('sidebarExpanded' in $$props) $$invalidate(3, sidebarExpanded = $$props.sidebarExpanded);
    		if ('isDarkTheme' in $$props) $$invalidate(1, isDarkTheme = $$props.isDarkTheme);
    		if ('selectedTab' in $$props) $$invalidate(2, selectedTab = $$props.selectedTab);
    		if ('showLoginModal' in $$props) $$invalidate(4, showLoginModal = $$props.showLoginModal);
    		if ('isLoggedIn' in $$props) $$invalidate(5, isLoggedIn = $$props.isLoggedIn);
    		if ('userPubkey' in $$props) $$invalidate(6, userPubkey = $$props.userPubkey);
    		if ('authMethod' in $$props) authMethod = $$props.authMethod;
    		if ('userProfile' in $$props) $$invalidate(7, userProfile = $$props.userProfile);
    		if ('showSettingsDrawer' in $$props) $$invalidate(8, showSettingsDrawer = $$props.showSettingsDrawer);
    		if ('selectedTabData' in $$props) $$invalidate(9, selectedTabData = $$props.selectedTabData);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*selectedTab*/ 4) {
    			$$invalidate(9, selectedTabData = tabs.find(tab => tab.id === selectedTab));
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
    		showLoginModal,
    		isLoggedIn,
    		userPubkey,
    		userProfile,
    		showSettingsDrawer,
    		selectedTabData,
    		tabs,
    		toggleSidebar,
    		toggleTheme,
    		selectTab,
    		openLoginModal,
    		handleLogin,
    		handleLogout,
    		closeLoginModal,
    		openSettingsDrawer,
    		closeSettingsDrawer,
    		click_handler,
    		click_handler_1,
    		loginmodal_showModal_binding
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
