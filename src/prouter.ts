/**
 * Unobtrusive, forward-thinking and lightweight JavaScript router library.
 */
module prouter {

    /**
     * Contracts for static type checking.
     */
    export interface Options {
        mode?: string;
        root?: string;
        silent?: boolean;
    }

    export interface Path {
        path: string;
        query: Object;
        queryString: string;
    }

    export interface PathExp extends RegExp {
        keys?: PathExpToken[];
    }

    export interface PathExpToken {
        name: string;
        prefix: string;
        delimiter: string;
        optional: boolean;
        repeat: boolean;
        pattern: string;
    }

    export interface Handler {
        pathExp: PathExp;
        activate: Function;
    }

    export interface GroupHandler {
        path: any;
        activate: Function;
    }

    export interface RequestParams {
        [index: string]: string;
    }

    export interface Request extends Path {
        params?: RequestParams;
        oldPath?: string;
    }

    export interface RequestProcessor {
        request: Request;
        activate: Function;
    }

    /** @type {global} Allows to access the global var in the IDE, just for compilation. */
    declare const global: any;

    /**
     * Stablish the root object, `window` (`self`) in the browser, or `global` on the server.
     * We use `self` instead of `window` for `WebWorker` support.
     * @type {window} the root object
     */
    const _global = (typeof self === 'object' && self.self === self && self) ||
        (typeof global === 'object' && global.global === global && global);

    /** @type {RegExp} Cached regex for stripping out leading slashes. */
    const LEADING_SLASHES_STRIPPER = /^\/+|\/+$/;

    /** @type {RegExp} Cached regex for default route. */
    const DEF_ROUTE = /.*/;

    /**
     * The main path matching regexp utility.
     * @type {RegExp} path regexp.
     */
    const PATH_STRIPPER = new RegExp([
    // Match escaped characters that would otherwise appear in future matches.
    // This allows the user to escape special characters that won't transform.
        '(\\\\.)',
    // Match Express-style parameters and un-named parameters with a prefix
    // and optional suffixes. Matches appear as:
    //
    // "/:test(\\d+)?" => ["/", "test", "\d+", undefined, "?", undefined]
    // "/route(\\d+)"  => [undefined, undefined, undefined, "\d+", undefined, undefined]
    // "/*"            => ["/", undefined, undefined, undefined, undefined, "*"]
        '([\\/.])?(?:(?:\\:(\\w+)(?:\\(((?:\\\\.|[^()])+)\\))?|\\(((?:\\\\.|[^()])+)\\))([+*?])?|(\\*))'
    ].join('|'), 'g');


    /**
     * Collection of helpers for processing routes.
     */
    class RouteHelper {

        /**
         * Escape a regular expression string.
         * @param  {String} str the string to scape
         * @return {String} the escaped string
         */
        private static _escapeString(str: string): string {
            return str.replace(/([.+*?=^!:${}()[\]|\/])/g, '\\$1');
        }

        /**
         * Escape the capturing group by escaping special characters and meaning.
         * @param  {String} group the group to escape
         * @return {String} escaped group.
         */
        private static _escapeGroup(group: string): string {
            return group.replace(/([=!:$\/()])/g, '\\$1');
        }

        /**
         * Removes leading slashes from the given string.
         * @param  {string} path the uri fragment.
         * @return {string} string without leading slashes.
         */
        static clearSlashes(path: string): string {
            return path.replace(LEADING_SLASHES_STRIPPER, '');
        }

        /**
         * Get the flags for a regexp from the options.
         * @param  {Object} opts the options object for building the flags.
         * @return {String} flags.
         */
        private static _flags(opts: Object): string {
            return opts['sensitive'] ? '' : 'i';
        }

        /**
         * Parse a string for the raw tokens.
         * @param  {String} path the fragment to pase.
         * @return {Array} tokens the extracted tokens.
         */
        private static _parse(path: string): any[] {

            const tokens: any[] = [];
            let key = 0;
            let index = 0;
            let pathIt = '';
            let res: RegExpExecArray;

            while ((res = PATH_STRIPPER.exec(path))) {

                const m = res[0];
                const escaped = res[1];
                const offset = res.index;

                pathIt += path.slice(index, offset);
                index = offset + m.length;

                // Ignore already escaped sequences.
                if (escaped) {
                    pathIt += escaped[1];
                    continue;
                }

                // Push the current path onto the tokens.
                if (pathIt) {
                    tokens.push(pathIt);
                    pathIt = '';
                }

                const prefix = res[2];
                const name = res[3];
                const capture = res[4];
                const group = res[5];
                const suffix = res[6];
                const asterisk = res[7];

                const repeat = suffix === '+' || suffix === '*';
                const optional = suffix === '?' || suffix === '*';
                const delimiter = prefix || '/';
                const pattern = capture || group || (asterisk ? '.*' : '[^' + delimiter + ']+?');

                tokens.push({
                    name: name || (key++).toString(),
                    prefix: prefix || '',
                    delimiter: delimiter,
                    optional: optional,
                    repeat: repeat,
                    pattern: RouteHelper._escapeGroup(pattern)
                });
            }

            // Match any characters still remaining.
            if (index < path.length) {
                pathIt += path.substr(index);
            }

            // If the path exists, push it onto the end.
            if (pathIt) {
                tokens.push(pathIt);
            }

            return tokens;
        }

        /**
         * Expose a function for taking tokens and returning a RegExp.
         * @param  {Array} tokens used for create the expression.
         * @param  {Object} [options] configuration.
         * @return {PathExp} the resulting path expression.
         */
        private static _tokensToPathExp(tokens: any[], options: Object = {}): PathExp {

            const strict = options['strict'];
            const end = options['end'] !== false;
            let route = '';
            const lastToken = tokens[tokens.length - 1];
            const endsWithSlash = typeof lastToken === 'string' && lastToken.length && lastToken.charAt(lastToken.length - 1) === '/';

            // Iterate over the tokens and create our regexp string.
            for (let i = 0; i < tokens.length; i++) {

                const token = tokens[i];

                if (typeof token === 'string') {
                    route += RouteHelper._escapeString(token);
                } else {

                    const prefix = RouteHelper._escapeString(token.prefix);
                    let capture = token.pattern;

                    if (token.repeat) {
                        capture += '(?:' + prefix + capture + ')*';
                    }

                    if (token.optional) {
                        if (prefix) {
                            capture = '(?:' + prefix + '(' + capture + '))?';
                        } else {
                            capture = '(' + capture + ')?';
                        }
                    } else {
                        capture = prefix + '(' + capture + ')';
                    }

                    route += capture;
                }
            }

            // In non-strict mode we allow a slash at the end of match. If the path to
            // match already ends with a slash, we remove it for consistency. The slash
            // is valid at the end of a path match, not in the middle. This is important
            // in non-ending mode, where "/test/" shouldn't match "/test//route".
            if (!strict) {
                route = (endsWithSlash ? route.slice(0, -2) : route) + '(?:\\/(?=$))?';
            }

            if (end) {
                route += '$';
            } else {
                // In non-ending mode, we need the capturing groups to match as much as
                // possible by using a positive lookahead to the end or next path segment.
                route += strict && endsWithSlash ? '' : '(?=\\/|$)';
            }

            return new RegExp('^' + route, RouteHelper._flags(options));
        }

        /**
         * Transform a query-string to an object.
         * @param  {string} search the query string.
         * @return {Object} the resulting object.
         */
        static parseQuery(queryString: string): Object {
            const searchParams = {};
            if (queryString.charAt(0) === '?') {
                queryString = queryString.slice(1);
            }
            const paramsArr = queryString.split('&');
            for (let i = 0; i < paramsArr.length; i++) {
                const pair = paramsArr[i].split('=');
                searchParams[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
            }
            return searchParams;
        }

        /**
         * Transform a fragment to a Path object.
         * @param  {string} path the fragment to parse.
         * @return {Path} the resulting object.
         */
        static parsePath(path: string): Path {

            let parser: any;

            if (typeof _global.URL === 'function') {
                parser = new _global.URL(path, 'http://example.com');
            } else {
                parser = document.createElement('a');
                parser.href = 'http://example.com/' + path;
            }

            const parsedPath: Path = {
                path: RouteHelper.clearSlashes(parser.pathname),
                query: RouteHelper.parseQuery(parser.search),
                queryString: parser.search
            };

            return parsedPath;
        }

        /**
         * Create a path regexp from string input.
         * @param  {String} path the given url fragment.
         * @param  {Object} [options] configuration.
         * @return {PathExp} the resulting path expression.
         */
        static stringToPathExp(path: string, options?: Object): PathExp {

            const tokens = RouteHelper._parse(path);

            const pathExp = RouteHelper._tokensToPathExp(tokens, options);

            pathExp.keys = [];

            // Attach keys back to the regexp.
            for (let i = 0; i < tokens.length; i++) {
                if (typeof tokens[i] !== 'string') {
                    pathExp.keys.push(tokens[i]);
                }
            }

            return pathExp;
        }
    }

    /**
     * Core component for the routing system.
     */
    export class Router {

        /** @type {Options} Default options for initializing the router. */
        private static _DEF_OPTIONS: Options = { mode: 'hash', root: '/', silent: false };
        /** @type {Options} Options used when initializing the routing system. */
        private static _options: Options;
        /** @type {string} Current loaded path. */
        private static _loadedPath: string;
        /** @type {Handler[]} Handlers for the routing system. */
        private static _handlers: Handler[] = [];

        /**
         * Start the routing system, returning `true` if the current URL was loaded,
         * and `false` otherwise.
         * @param {Object} [options] Options
         * @return {boolean} true if the current fragment matched some handler, false otherwise.
         */
        static listen(options: Options): boolean {

            if (this._options) {
                throw new Error('Router already listening.');
            }

            this._options = {};

            for (let prop in Router._DEF_OPTIONS) {
                if (options[prop] !== undefined) {
                    this._options[prop] = options[prop];
                } else if (this._options[prop] === undefined) {
                    this._options[prop] = Router._DEF_OPTIONS[prop];
                }
            }

            switch (this._options.mode) {
                case 'history':
                    addEventListener('popstate', this._loadCurrent, false);
                    break;
                case 'hash':
                    addEventListener('hashchange', this._loadCurrent, false);
                    break;
                default:
                    throw new Error("Invalid mode '" + this._options.mode + "'. Valid modes are: 'history', 'hash'.");
            }

            let loaded = false;

            if (!this._options.silent) {
                loaded = this._loadCurrent();
            }

            return loaded;
        }

        /**
         * Disable the route-change-handling and resets the Router's state, perhaps temporarily.
         * Not useful in a real app; but useful for unit testing.
         * @return {Router} the router.
         */
        static stop(): Router {
            if (this._options.mode === 'history') {
                removeEventListener('popstate', this._loadCurrent, false);
                history.pushState(null, null, this._options.root);
            } else {
                removeEventListener('hashchange', this._loadCurrent, false);
                location.hash = '#';
            }
            this._handlers = [];
            this._loadedPath = null;
            this._options = null;
            return this;
        }

        /**
         * Retrieve the current path without the root prefix.
         * @return {string} the current path.
         */
        static getCurrent(): string {

            let path: string;

            if (this._options.mode === 'history') {
                const decodedUri = decodeURI(location.pathname + location.search);
                path = RouteHelper.clearSlashes(decodedUri);
                path = this._options.root === '/' ? path : path.slice(this._options.root.length);
            } else {
                const match = location.href.match(/#(.*)$/);
                path = match ? match[1] : '';
            }

            path = RouteHelper.clearSlashes(path);

            return path;
        }

        /**
         * Add the given middleware as a handler for the given path (defaulting to any path).
         * @param {string|Function|RouteGroup} path the fragment or the callback.
         * @param {Function|RouteGroup} [activate] the activate callback or the group of routes.
         * @return {Router} the router.
         */
        static use(path: any, activate?: any): Router {

            if (activate instanceof RouteGroup || path instanceof RouteGroup) {
                let parentPath: string;
                if (path instanceof RouteGroup) {
                    activate = path;
                } else {
                    parentPath = RouteHelper.clearSlashes(path);
                }
                this._handlers = this._extractHandlers(parentPath, activate);
            } else {
                let pathExp: PathExp;
                // If default route.
                if (typeof path === 'function') {
                    activate = path;
                    pathExp = DEF_ROUTE;
                } else {
                    path = RouteHelper.clearSlashes(path);
                    pathExp = RouteHelper.stringToPathExp(path);
                }
                this._handlers.push({ pathExp, activate });
            }

            return this;
        }

        /**
         * Change the current path and load it.
         * @param {string} path The fragment to navigate to
         * @returns {boolean} true if the path matched some handler, false otherwise.
         */
        static navigate(path: string): boolean {

            if (!this._options) {
                throw new Error("It is required to call the 'listen' function before navigating.");
            }

            path = RouteHelper.clearSlashes(path);

            switch (this._options.mode) {
                case 'history':
                    history.pushState(null, null, this._options.root + path);
                    break;
                case 'hash':
                    location.hash = '#' + path;
                    break;
            }

            return this._load(path);
        }

        /**
         * Load the current path if already not loaded.
         * @return {boolean} true if loaded, false otherwise.
         */
        private static _loadCurrent(): boolean {
            const currentPath = this.getCurrent();
            return currentPath === this._loadedPath ? false : this._load(currentPath);
        }

        /**
         * Attempt to load the given URL fragment. If a route succeeds with a
         * match, returns `true`; if no defined routes matches the fragment,
         * returns `false`.
         * @param {string} path E.g.: 'user/pepito'
         * @returns {boolean} true if the fragment matched some handler, false otherwise.
         */
        private static _load(path: string): boolean {

            const requestProcessors = this._obtainRequestProcessors(path);

            let count = 0;

            for (let i = 0; i < requestProcessors.length; i++) {
                const requestProcessor = requestProcessors[i];
                requestProcessor.request.oldPath = this._loadedPath;
                const next = requestProcessor.activate.call(null, requestProcessor.request);
                if (next === false) {
                    break;
                }
                count++;
            }

            const navigated = count > 0;

            this._loadedPath = path;

            return navigated;
        }

        /**
         * Extract the handlers from the given arguments.
         * @param  {string} parentPath The parent path of the group of routes.
         * @param  {RouteGroup} routeGroup The group of routes.
         * @param  {Handler[]=[]} [handlers] The holder for extracted handlers.
         * @return {Handler[]} The extracted handlers.
         */
        private static _extractHandlers(parentPath: string, routeGroup: RouteGroup, handlers: Handler[] = []): Handler[] {

            const groupHandlers = routeGroup._handlers;

            for (let i = 0; i < groupHandlers.length; i++) {

                const itHandler = groupHandlers[i];
                let subPath: string;
                let activate: Function;

                if (typeof itHandler.path === 'function') {
                    activate = itHandler.path;
                } else {
                    activate = itHandler.activate;
                    subPath = RouteHelper.clearSlashes(itHandler.path);
                }

                let pathExp: PathExp;

                if (parentPath === undefined || subPath === undefined) {
                    if (parentPath === undefined && subPath === undefined) {
                        pathExp = DEF_ROUTE;
                    } else if (parentPath === undefined) {
                        pathExp = RouteHelper.stringToPathExp(subPath);
                    } else {
                        pathExp = RouteHelper.stringToPathExp(parentPath);
                    }
                } else {
                    const path = parentPath + '/' + subPath;
                    pathExp = RouteHelper.stringToPathExp(path);
                }

                handlers.push({ pathExp, activate });
            }

            return handlers;
        }

        /**
         * Obtain the request processors for the given path according to the current handlers in the router.
         * @param  {string} path The url fragment to check.
         * @return {RequestProcessor[]} The obtained request processors.
         */
        private static _obtainRequestProcessors(path: string): RequestProcessor[] {

            const parsedPath = RouteHelper.parsePath(path);

            const requestProcessors: RequestProcessor[] = [];

            for (let i = 0; i < this._handlers.length; i++) {

                const handler = this._handlers[i];
                const match = handler.pathExp.test(parsedPath.path);

                if (match) {

                    const request = this._extractRequest(path, handler.pathExp);

                    const requestProcessor: RequestProcessor = { activate: handler.activate, request };

                    requestProcessors.push(requestProcessor);
                }
            }

            return requestProcessors;
        }

        /**
         * Extract a request from the given arguments, using decoded parameters.
         * @param {string} path The url fragment.
         * @param {PathExp} [pathExp] The path expression.
         * @returns {Request} The extracted request.
         */
        private static _extractRequest(path: string, pathExp?: PathExp): Request {

            const request: Request = RouteHelper.parsePath(path);
            request.params = {};

            const result = pathExp ? pathExp.exec(request.path) : null;

            if (!result) {
                return request;
            }

            const args = result.slice(1);
            const keys = pathExp.keys;

            for (let i = 0; i < args.length; i++) {
                if (args[i] !== undefined) {
                    request.params[keys[i].name] = decodeURIComponent(args[i]);
                }
            }

            return request;
        }
    }

    /**
     * Allows to use a group of routes as middleware.
     */
    export class RouteGroup {

        /** @type {GroupHandler[]} The list of handlers for this group. */
        _handlers: GroupHandler[] = [];

        /**
         * Add the given middleware function as handler for the given path (defaulting to any path).
         * @param {string|Function} path The fragment or the callback.
         * @param {Function} [activate] The activate callback or the group of routes.
         * @return {RouteGroup} The router group.
         */
        use(path: any, activate?: Function): RouteGroup {
            this._handlers.push({ path, activate });
            return this;
        }
    }

}
