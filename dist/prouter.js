
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require, exports, module);
  } else {
    root.prouter = factory();
  }
}(this, function(require, exports, module) {

var prouter;
(function (prouter) {
    // Establish the root object, `window` (`self`) in the browser, or `global` on the server.
    // We use `self` instead of `window` for `WebWorker` support.
    var _global = (typeof self === 'object' && self.self === self && self) ||
        (typeof global === 'object' && global.global === global && global);
    var _DEF_OPTIONS = { mode: 'hash', root: '/' };
    /**
     * The main path matching regexp utility.
     * @type {RegExp} path regexp.
     */
    var PATH_STRIPPER = new RegExp([
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
    // Cached regex for default route.
    var DEF_ROUTE = /.*/;
    var RouteHelper = (function () {
        function RouteHelper() {
        }
        /**
         * Escape a regular expression string.
         * @param  {String} str the string to scape
         * @return {String} the escaped string
         */
        RouteHelper._escapeString = function (str) {
            return str.replace(/([.+*?=^!:${}()[\]|\/])/g, '\\$1');
        };
        /**
         * Escape the capturing group by escaping special characters and meaning.
         * @param  {String} group the group to escape
         * @return {String} escaped group.
         */
        RouteHelper._escapeGroup = function (group) {
            return group.replace(/([=!:$\/()])/g, '\\$1');
        };
        RouteHelper.clearSlashes = function (path) {
            return path.replace(/\/$/, '').replace(/^\//, '');
        };
        /**
         * Get the flags for a regexp from the options.
         * @param  {Object} opts the options object for building the flags.
         * @return {String} flags.
         */
        RouteHelper._flags = function (opts) {
            return opts['sensitive'] ? '' : 'i';
        };
        /**
         * Parse a string for the raw tokens.
         * @param  {String} path
         * @return {Array} tokens.
         */
        RouteHelper._parse = function (path) {
            var tokens = [];
            var key = 0;
            var index = 0;
            var pathIt = '';
            var res;
            while ((res = PATH_STRIPPER.exec(path))) {
                var m = res[0];
                var escaped = res[1];
                var offset = res.index;
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
                var prefix = res[2];
                var name_1 = res[3];
                var capture = res[4];
                var group = res[5];
                var suffix = res[6];
                var asterisk = res[7];
                var repeat = suffix === '+' || suffix === '*';
                var optional = suffix === '?' || suffix === '*';
                var delimiter = prefix || '/';
                var pattern = capture || group || (asterisk ? '.*' : '[^' + delimiter + ']+?');
                tokens.push({
                    name: name_1 || (key++).toString(),
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
        };
        /**
         * Expose a function for taking tokens and returning a RegExp.
         * @param  {Array}  tokens
         * @param  {Object} options
         * @return {RegExp} the regexp.
         */
        RouteHelper._tokensToPathExp = function (tokens, options) {
            if (options === void 0) { options = {}; }
            var strict = options['strict'];
            var end = options['end'] !== false;
            var route = '';
            var lastToken = tokens[tokens.length - 1];
            var endsWithSlash = typeof lastToken === 'string' && lastToken.length && lastToken.charAt(lastToken.length - 1) === '/';
            // Iterate over the tokens and create our regexp string.
            for (var i = 0; i < tokens.length; i++) {
                var token = tokens[i];
                if (typeof token === 'string') {
                    route += RouteHelper._escapeString(token);
                }
                else {
                    var prefix = RouteHelper._escapeString(token.prefix);
                    var capture = token.pattern;
                    if (token.repeat) {
                        capture += '(?:' + prefix + capture + ')*';
                    }
                    if (token.optional) {
                        if (prefix) {
                            capture = '(?:' + prefix + '(' + capture + '))?';
                        }
                        else {
                            capture = '(' + capture + ')?';
                        }
                    }
                    else {
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
            }
            else {
                // In non-ending mode, we need the capturing groups to match as much as
                // possible by using a positive lookahead to the end or next path segment.
                route += strict && endsWithSlash ? '' : '(?=\\/|$)';
            }
            return new RegExp('^' + route, RouteHelper._flags(options));
        };
        RouteHelper.parseSearchString = function (search) {
            var searchParams = {};
            if (search.charAt(0) === '?') {
                search = search.slice(1);
            }
            var paramsArr = search.split('&');
            for (var i = 0; i < paramsArr.length; i++) {
                var pair = paramsArr[i].split('=');
                searchParams[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
            }
            return searchParams;
        };
        RouteHelper.parsePath = function (path) {
            var parser;
            if (typeof _global.URL === 'function') {
                parser = new _global.URL(path, 'http://example.com');
            }
            else {
                parser = document.createElement('a');
                parser.href = 'http://example.com/' + path;
            }
            var parsedPath = {
                path: RouteHelper.clearSlashes(parser.pathname),
                query: RouteHelper.parseSearchString(parser.search),
                queryString: parser.search
            };
            return parsedPath;
        };
        /**
         * Create a path regexp from string input.
         * @param  {String} path
         * @param  {Object} options
         * @return {RegExp} the regexp
         */
        RouteHelper.stringToPathExp = function (path, options) {
            var tokens = RouteHelper._parse(path);
            var pathExp = RouteHelper._tokensToPathExp(tokens, options);
            pathExp.keys = [];
            // Attach keys back to the regexp.
            for (var i = 0; i < tokens.length; i++) {
                if (typeof tokens[i] !== 'string') {
                    pathExp.keys.push(tokens[i]);
                }
            }
            return pathExp;
        };
        return RouteHelper;
    })();
    var Router = (function () {
        function Router() {
        }
        Router.listen = function (options) {
            if (this._listening) {
                throw new Error('Router already listening.');
            }
            this._listening = true;
            this.config(options);
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
            return this;
        };
        Router.config = function (options) {
            for (var prop in _DEF_OPTIONS) {
                if (options[prop] !== undefined) {
                    this._options[prop] = options[prop];
                }
                else if (this._options[prop] === undefined) {
                    this._options[prop] = _DEF_OPTIONS[prop];
                }
            }
            return this;
        };
        Router.stop = function () {
            if (this._options.mode === 'history') {
                removeEventListener('popstate', this._loadCurrent, false);
                history.pushState(null, null, this._options.root);
            }
            else {
                removeEventListener('hashchange', this._loadCurrent, false);
                location.hash = '#';
            }
            this._handlers = [];
            this._listening = false;
            return this;
        };
        Router.getCurrent = function () {
            var fragment;
            if (this._options.mode === 'history') {
                var root = this._options.root;
                fragment = RouteHelper.clearSlashes(decodeURI(location.pathname + location.search));
                fragment = fragment.replace(/\?(.*)$/, '');
                fragment = root !== '/' ? fragment.replace(root, '') : fragment;
            }
            else {
                var match = location.href.match(/#(.*)$/);
                fragment = match ? match[1] : '';
            }
            fragment = RouteHelper.clearSlashes(fragment);
            return fragment;
        };
        Router.navigate = function (path) {
            path = RouteHelper.clearSlashes(path);
            switch (this._options.mode) {
                case 'history':
                    this._load(path);
                    history.pushState(null, null, this._options.root + path);
                    break;
                case 'hash':
                    var oldPath = this.getCurrent();
                    // If the path has not changed, force _loadPath since the 'hashchange' event will not be triggered.
                    if (path === oldPath) {
                        this._load(path);
                    }
                    location.hash = '#' + path;
                    break;
            }
        };
        Router.use = function (path, activate) {
            if (activate instanceof RouteGroup || path instanceof RouteGroup) {
                var parentPath;
                if (path instanceof RouteGroup) {
                    activate = path;
                }
                else {
                    parentPath = RouteHelper.clearSlashes(path);
                }
                this._handlers = this._obtainHandlers(parentPath, activate);
            }
            else {
                var pathExp;
                // If default route.
                if (typeof path === 'function') {
                    activate = path;
                    pathExp = DEF_ROUTE;
                }
                else {
                    path = RouteHelper.clearSlashes(path);
                    pathExp = RouteHelper.stringToPathExp(path);
                }
                this._handlers.push({ pathExp: pathExp, activate: activate });
            }
            return this;
        };
        Router._loadCurrent = function () {
            var path = this.getCurrent();
            return this._load(path);
        };
        Router._load = function (path) {
            var requestProcessors = this._obtainRequestProcessors(path);
            var current = this.getCurrent();
            var count = 0;
            for (var i = 0; i < requestProcessors.length; i++) {
                var requestProcessor = requestProcessors[i];
                requestProcessor.request.old = current;
                var next = requestProcessor.activate.call(null, requestProcessor.request);
                if (next === false) {
                    break;
                }
                else {
                    count++;
                }
            }
            return count > 0;
        };
        Router._obtainHandlers = function (parentPath, routeGroup, handlers) {
            if (handlers === void 0) { handlers = []; }
            var groupHandlers = routeGroup._handlers;
            for (var i = 0; i < groupHandlers.length; i++) {
                var itHandler = groupHandlers[i];
                var subPath = void 0;
                var activate = void 0;
                if (typeof itHandler.path === 'function') {
                    activate = itHandler.path;
                }
                else {
                    activate = itHandler.activate;
                    subPath = RouteHelper.clearSlashes(itHandler.path);
                }
                var pathExp = void 0;
                if (parentPath === undefined || subPath === undefined) {
                    if (parentPath === undefined && subPath === undefined) {
                        pathExp = DEF_ROUTE;
                    }
                    else if (parentPath === undefined) {
                        pathExp = RouteHelper.stringToPathExp(subPath);
                    }
                    else {
                        pathExp = RouteHelper.stringToPathExp(parentPath);
                    }
                }
                else {
                    var path = parentPath + '/' + subPath;
                    pathExp = RouteHelper.stringToPathExp(path);
                }
                handlers.push({ pathExp: pathExp, activate: activate });
            }
            return handlers;
        };
        /**
         * Given a route, and a path that it matches, return the object of
         * extracted decoded parameters.
         * @param {string} path The uri's path part.
         * @param {PathExp} route The alias
         * @returns {NavigationParams} the extracted parameters
         * @private
         */
        Router._obtainRequest = function (path, pathExp) {
            var request = RouteHelper.parsePath(path);
            request.params = {};
            var result = pathExp ? pathExp.exec(request.path) : null;
            if (!result) {
                return request;
            }
            var args = result.slice(1);
            var keys = pathExp.keys;
            for (var i = 0; i < args.length; i++) {
                if (args[i] !== undefined) {
                    request.params[keys[i].name] = decodeURIComponent(args[i]);
                }
            }
            return request;
        };
        Router._obtainRequestProcessors = function (path) {
            var parsedPath = RouteHelper.parsePath(path);
            var requestProcessors = [];
            for (var i = 0; i < this._handlers.length; i++) {
                var handler = this._handlers[i];
                var match = handler.pathExp.test(parsedPath.path);
                if (match) {
                    var request = this._obtainRequest(path, handler.pathExp);
                    var requestProcessor = { activate: handler.activate, request: request };
                    requestProcessors.push(requestProcessor);
                }
            }
            return requestProcessors;
        };
        Router._handlers = [];
        Router._options = {};
        Router._listening = false;
        return Router;
    })();
    prouter.Router = Router;
    var RouteGroup = (function () {
        function RouteGroup() {
            this._handlers = [];
        }
        RouteGroup.prototype.use = function (path, activate) {
            this._handlers.push({ path: path, activate: activate });
        };
        return RouteGroup;
    })();
    prouter.RouteGroup = RouteGroup;
})(prouter || (prouter = {}));

return prouter;

}));

//# sourceMappingURL=prouter.js.map