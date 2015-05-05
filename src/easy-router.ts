/**
 * Unobtrusive and ultra-lightweight router library 100% compatible with the Backbone.Router's style for declaring routes,
 * while providing the following advantages:
 * - Unobtrusive, it is designed from the beginning to be integrated with other libraries / frameworks (also vanilla).
 * - Great performance, only native functions are used.
 * - Small footprint, 5kb for minified version.
 * - No dependencies, no jQuery, no Underscore... zero dependencies.
 * - Supports both routes' styles, hash and the pushState of History API.
 * - Proper JSDoc used in the source code.
 * - Works with normal script include and as well in CommonJS style.
 * - Written in [ESNext](https://babeljs.io/) for the future and transpiled to ES5 with UMD format for right now.
 *
 * ¿Want to create a modern hibrid-app or a website using something like React, Web Components, Handlebars, vanilla JS, etc.?
 * ¿Have an existing Backbone project and want to migrate to a more modern framework?
 * Good news, EasyRouter will integrates perfectly with all of those!
 */

/**
 * EasyRouter provides methods for routing client-side pages, and connecting them to actions.
 *
 * During page load, after your application has finished creating all of its routers,
 * be sure to call start() on the router instance to let know him you have already
 * finished the routing setup.
 */

const root: any = typeof window === 'undefined' ? this : window;
const document = root.document;

// Cached regular expressions for matching named param parts and splatted
// parts of route strings.
const optionalParam = /\((.*?)\)/g;
const namedParam = /(\(\?)?:\w+/g;
const splatParam = /\*\w+/g;
const escapeRegExp = /[\-{}\[\]+?.,\\\^$|#\s]/g;
const trueHash = /#(.*)$/;
const isRoot = /[^\/]$/;

// Cached regex for stripping a leading hash/slash and trailing space.
const routeStripper = /^[#\/]|\s+$/g;
// Cached regex for stripping leading and trailing slashes.
const rootStripper = /^\/+|\/+$/g;
// Cached regex for removing a trailing slash.
const trailingSlash = /\/$/;
// Cached regex for stripping urls of hash.
const pathStripper = /#.*$/;

export interface RequestHandler {
    (fragment: string, message?: any): void
}

/**
 * Handles cross-browser history management, based on either
 * [pushState](http://diveintohtml5.info/history.html) and real URLs, or
 * [onhashchange](https://developer.mozilla.org/en-US/docs/DOM/window.onhashchange)
 * and URL fragments.
 * @constructor
 */
class History {
    // Has the history handling already been started?
    private static _started = false;
    private _location = root.location;
    private _history = root.history;
    private _handlers: any = [];
    private _evtHandlers: any = {};
    private _root: string;
    private _hasPushState: boolean;
    private _wantsHashChange: boolean;
    private _wantsPushState: boolean;
    private _fragment: string;

    constructor() {
        this._checkUrl = this._checkUrl.bind(this);
    }

    /**
     * Are we at the app root?
     * @returns {boolean} if we are in the root.
     */
    atRoot(): boolean {
        return this._location.pathname.replace(isRoot, '$&/') === this._root;
    }

    /**
     * Gets the true hash value. Cannot use location.hash directly due to bug
     * in Firefox where location.hash will always be decoded.
     * @returns {string} The hash.
     */
    getHash(): string {
        const match = this._location.href.match(trueHash);
        return match ? match[1] : '';
    }

    /**
     * Get the cross-browser normalized URL fragment, either from the URL,
     * the hash, or the override.
     * @param {string} fragment The url fragment
     * @param {boolean} forcePushState flag to force the usage of pushSate
     * @returns {string} The fragment.
     */
    getFragment(fragment?: string, forcePushState?: boolean): string {
        let fragmentAux = fragment;
        if (fragmentAux === undefined || fragmentAux === null) {
            if (this._hasPushState || !this._wantsHashChange || forcePushState) {
                fragmentAux = root.decodeURI(this._location.pathname + this._location.search);
                const rootUrl = this._root.replace(trailingSlash, '');
                if (fragmentAux.lastIndexOf(rootUrl, 0) === 0) {
                    fragmentAux = fragmentAux.slice(rootUrl.length);
                }
            } else {
                fragmentAux = this.getHash();
            }
        } else {
            fragmentAux = root.decodeURI(fragmentAux);
        }
        return fragmentAux.replace(routeStripper, '');
    }

    /**
     * Start the route change handling, returning `true` if the current URL matches
     * an existing route, and `false` otherwise.
     * @param {Object} options Options
     * @returns {boolean} true if the current fragment matched some handler, false otherwise.
     */
    start(options: any = {}): boolean {

        if (History._started) {
            throw new Error('Router.history has already been started');
        }

        History._started = true;

        // Figure out the initial configuration. Is pushState desired ... is it available?
        this._root = options.root || '/';
        this._wantsHashChange = options.hashChange !== false;
        this._wantsPushState = !!options.pushState;
        this._hasPushState = !!(options.pushState && this._history && this._history.pushState);
        const fragment = this.getFragment();

        // Normalize root to always include a leading and trailing slash.
        this._root = ('/' + this._root + '/').replace(rootStripper, '/');

        // Depending on whether we're using pushState or hashes, and whether
        // 'onhashchange' is supported, determine how we check the URL state.
        if (this._hasPushState) {
            root.addEventListener('popstate', this._checkUrl);
        } else if (this._wantsHashChange && ('onhashchange' in root)) {
            root.addEventListener('hashchange', this._checkUrl);
        }

        // Determine if we need to change the base url, for a pushState link
        // opened by a non-pushState browser.
        this._fragment = fragment;

        // Transition from hashChange to pushState or vice versa if both are
        // requested.
        if (this._wantsHashChange && this._wantsPushState) {
            // If we've started off with a route from a `pushState`-enabled
            // browser, but we're currently in a browser that doesn't support it...
            if (!this._hasPushState && !this.atRoot()) {
                this._fragment = this.getFragment(null, true);
                this._location.replace(this._root + '#' + this._fragment);
                // Return immediately as browser will do redirect to new url
                return true;
                // Or if we've started out with a hash-based route, but we're currently
                // in a browser where it could be `pushState`-based instead...
            } else if (this._hasPushState && this.atRoot() && this._location.hash) {
                this._fragment = this.getHash().replace(routeStripper, '');
                this._history.replaceState({}, document.title, this._root + this._fragment);
            }
        }

        if (options.silent !== true) {
            return this._loadUrl();
        }

        return false;
    }

    /**
     * Disable Router.history, perhaps temporarily. Not useful in a real app,
     * but possibly useful for unit testing Routers.
     */
    stop() {
        root.removeEventListener('popstate', this._checkUrl);
        root.removeEventListener('hashchange', this._checkUrl);
        History._started = false;
    }

    /**
     * Add a route to be tested when the fragment changes. Routes added later
     * may override previous routes.
     * @param {RegExp} rRoute The route.
     * @param {Function} callback Method to be executed.
     */
    addHandler(rRoute: RegExp, callback: RequestHandler) {
        this._handlers.unshift({ route: rRoute, callback: callback });
    }

    /**
     * Checks the current URL to see if it has changed, and if it has,
     * calls `loadUrl`.
     * @returns {boolean} true if navigated, false otherwise.
     * @private
     */
    private _checkUrl() {
        const fragment = this.getFragment();
        if (fragment === this._fragment) {
            return false;
        }
        this._loadUrl();
    }

    /**
     * Attempt to load the current URL fragment. If a route succeeds with a
     * match, returns `true`. If no defined routes matches the fragment,
     * returns `false`.
     * @param {string} fragment E.g.: 'user/pepito'
     * @param {Object} message E.g.: {msg: 'Password changed', type: 'success'}
     * @returns {boolean} true if the fragment matched some handler, false otherwise.
     * @private
     */
    private _loadUrl(fragment?: string, message?: string): boolean {
        this._fragment = this.getFragment(fragment);
        const n = this._handlers.length;
        for (let i = 0; i < n; i++) {
            let handler = this._handlers[i];
            if (handler.route.test(this._fragment)) {
                handler.callback(this._fragment, message);
                return true;
            }
        }
        return false;
    }

    /**
     * Save a fragment into the hash history, or replace the URL state if the
     * 'replace' option is passed. You are responsible for properly URL-encoding
     * the fragment in advance.
     *
     * The options object can contain `trigger: true` if you wish to have the
     * route callback be fired (not usually desirable), or `replace: true`, if
     * you wish to modify the current URL without adding an entry to the history.
     * @param {string} fragment Fragment to navigate to
     * @param {Object=} message Options object.
     * @param {Object=} options Options object.
     * @returns {boolean} true if the fragment matched some handler, false otherwise.
     */
    navigate(fragment: string, message?: any, options: any = {}) {

        if (!History._started) {
            return false;
        }

        let fragmentAux = this.getFragment(fragment);

        let url = this._root + fragmentAux;

        // Strip the hash for matching.
        fragmentAux = fragmentAux.replace(pathStripper, '');

        if (this._fragment === fragmentAux) {
            return false;
        }

        this._fragment = fragmentAux;

        // Don't include a trailing slash on the root.
        if (fragmentAux === '' && url !== '/') {
            url = url.slice(0, -1);
        }

        // If pushState is available, we use it to set the fragment as a real URL.
        if (this._hasPushState) {
            this._history[options.replace ? 'replaceState' : 'pushState']({}, document.title, url);
            // If hash changes haven't been explicitly disabled, update the hash
            // fragment to store history.
        } else if (this._wantsHashChange) {
            this._updateHash(fragmentAux, options.replace);
            // If you've told us that you explicitly don't want fallback hashchange-
            // based history, then `navigate` becomes a page refresh.
        } else {
            return this._location.assign(url);
        }

        if (options.trigger !== false) {
            return this._loadUrl(fragmentAux, message);
        }

        return false;
    }

    /**
     * Add event listener.
     * @param {string} evt Name of the event.
     * @param {Function} callback Method.
     * @returns {History} this history
     */
    on(evt: string, callback: Function): History {
        if (this._evtHandlers[evt] === undefined) {
            this._evtHandlers[evt] = [];
        }
        this._evtHandlers[evt].push(callback);
        return this;
    }

    /**
     * Remove event listener.
     * @param {string} evt Name of the event.
     * @param {Function} callback Method.
     * @returns {History} this history
     */
    off(evt: string, callback: Function): History {
        if (this._evtHandlers[evt]) {
            const callbacks = this._evtHandlers[evt];
            const n = callbacks.length;
            for (let i = 0; i < n; i++) {
                if (callbacks[i] === callback) {
                    callbacks.splice(i, 1);
                    if (callbacks.length === 0) {
                        delete this._evtHandlers[evt];
                    }
                    break;
                }
            }
        }
        return this;
    }

    /**
     * Events triggering.
     * @param {string} evt Name of the event being triggered.
     */
    trigger(evt: string, ...restParams: any[]) {
        const callbacks = this._evtHandlers[evt];
        if (callbacks === undefined) {
            return;
        }
        const callbacksLength = callbacks.length;
        for (let i = 0; i < callbacksLength; i++) {
            callbacks[i].apply(this, restParams);
        }
    }

    /**
     * Update the hash location, either replacing the current entry, or adding
     * a new one to the browser history.
     * @param {string} fragment URL fragment
     * @param {boolean} replace flag
     * @private
     */
    private _updateHash(fragment: string, replace?: boolean) {
        if (replace) {
            const href = this._location.href.replace(/(javascript:|#).*$/, '');
            this._location.replace(href + '#' + fragment);
        } else {
            // Some browsers require that `hash` contains a leading #.
            this._location.hash = '#' + fragment;
        }
    }
}


class Router {

    static history: History;
    private _evtHandlers = {};
    private _opts: any;
    private _old: any;
    private trigger = History.prototype.trigger;
    private on = History.prototype.on;
    private off = History.prototype.off;

    /**
     * Constructor for the router.
     * Routers map faux-URLs to actions, and fire events when routes are
     * matched. Creating a new one sets its `routes` hash, if not set statically.
     * @param {Object} options options.root is a string indicating the site's context, defaults to '/'.
     * @constructor
     */
    constructor(options = {}) {
        this._opts = options
        this._bindHandlers();
    }

    /**
     * Manually bind a single named route to a callback.
     * The route argument may be a routing string or regular expression, each matching capture
     * from the route or regular expression will be passed as an argument to the onCallback.
     * @param {Object} handler The handler entry.
     * @returns {Router} this router
     */
    addHandler(handler: any) {

        const rRoute = Router._routeToRegExp(handler.route);

        Router.history.addHandler(rRoute, (fragment, message?) => {

            const params = Router._extractParameters(rRoute, fragment);

            const paramsAux = params.slice(0);

            const evtRoute: any = {
                new: { fragment: fragment, params: paramsAux, message: message }
            };

            if (this._old) {
                evtRoute.old = { fragment: this._old.fragment, params: this._old.params };
            }

            this.trigger('route:before', evtRoute);
            Router.history.trigger('route:before', this, evtRoute);

            if (evtRoute.canceled) {
                return;
            }

            params.push(evtRoute);

            if (this._old && this._old.handler.deactivate) {
                this._old.handler.deactivate.apply(this._old.handler);
            }

            handler.activate.apply(handler, params);

            this.trigger('route:after', evtRoute);
            Router.history.trigger('route:after', this, evtRoute);

            this._old = { fragment: fragment, params: paramsAux, handler: handler };
        });

        return this;
    }

    /**
     * Simple proxy to `Router.history` to save a fragment into the history.
     * @param {string} fragment Route to navigate to.
     * @param {Object=} message parameters
     * @param {Object=} options parameters
     * @returns {Router} this router
     */
    navigate(fragment: string, message?: any, options?: any): Router {
        Router.history.navigate(fragment, message, options);
        return this;
    }

    /**
     * Bind all defined routes to `Router.history`. We have to reverse the
     * order of the routes here to support behavior where the most general
     * routes can be defined at the bottom of the route map.
     * @private
     */
    private _bindHandlers() {
        if (!this._opts.map) {
            return;
        }
        const routes = this._opts.map;
        const routesN = routes.length - 1;
        for (let i = routesN; i >= 0; i--) {
            this.addHandler(routes[i]);
        }
    }

    /**
     * Convert a route string into a regular expression, suitable for matching
     * against the current location fragment.
     * @param {string} route The route
     * @returns {RegExp} the obtained regex
     * @private
     */
    static _routeToRegExp(route: string): RegExp {
        const routeAux = route.replace(escapeRegExp, '\\$&')
            .replace(optionalParam, '(?:$1)?')
            .replace(namedParam, (match, optional) => {
            return optional ? match : '([^/?]+)';
        })
            .replace(splatParam, '([^?]*?)');
        return new RegExp('^' + routeAux + '(?:\\?([\\s\\S]*))?$');
    }

    /**
     * Given a route, and a URL fragment that it matches, return the array of
     * extracted decoded parameters. Empty or unmatched parameters will be
     * treated as `null` to normalize cross-browser behavior.
     * @param {RegExp} route The alias
     * @param {string} fragment The url part
     * @returns {string[]} the extracted parameters
     * @private
     */
    static _extractParameters(route: RegExp, fragment: string): string[] {
        const params = route.exec(fragment).slice(1);
        return params.map((param, i) => {
            // Don't decode the search params.
            if (i === params.length - 1) {
                return param;
            }
            return param === undefined ? undefined : decodeURIComponent(param);
        });
    }

}


/**
 * Create the default Router.History.
 * @type {History}
 */
Router.history = new History();


export { History, Router };
