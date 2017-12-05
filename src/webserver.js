
'use strict';

var fs = require('fs');
var path = require('path');
var nconf = require('nconf');
var express = require('express');
var app = express();
var server;
var winston = require('winston');
var async = require('async');
var flash = require('connect-flash');
var compression = require('compression');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var useragent = require('express-useragent');
var favicon = require('serve-favicon');

var db = require('./database');
var file = require('./file');
var emailer = require('./emailer');
var meta = require('./meta');
var languages = require('./languages');
var logger = require('./logger');
var plugins = require('./plugins');
var flags = require('./flags');
var routes = require('./routes');
var auth = require('./routes/authentication');
var Benchpress = require('benchpressjs');

var helpers = require('../public/src/modules/helpers');

if (nconf.get('ssl')) {
	server = require('https').createServer({
		key: fs.readFileSync(nconf.get('ssl').key),
		cert: fs.readFileSync(nconf.get('ssl').cert),
	}, app);
} else {
	server = require('http').createServer(app);
}

module.exports.server = server;

server.on('error', function (err) {
	if (err.code === 'EADDRINUSE') {
		winston.error('NodeBB address in use, exiting...', err);
	} else {
		winston.error(err);
	}

	throw err;
});

module.exports.listen = function (callback) {
	callback = callback || function () { };
	emailer.registerApp(app);

	async.waterfall([
		function (next) {
			setupExpressApp(app, next);
		},
		function (next) {
			helpers.register();

			logger.init(app);

			initializeNodeBB(next);
		},
		function (next) {
			winston.info('NodeBB Ready');

			require('./socket.io').server.emit('event:nodebb.ready', {
				'cache-buster': meta.config['cache-buster'],
			});

			plugins.fireHook('action:nodebb.ready');

			listen(next);
		},
	], callback);
};

function initializeNodeBB(callback) {
	var middleware = require('./middleware');

	async.waterfall([
		async.apply(meta.themes.setupPaths),
		function (next) {
			plugins.init(app, middleware, next);
		},
		async.apply(plugins.fireHook, 'static:assets.prepare', {}),
		function (next) {
			plugins.fireHook('static:app.preload', {
				app: app,
				middleware: middleware,
			}, next);
		},
		function (next) {
			plugins.fireHook('filter:hotswap.prepare', [], next);
		},
		function (hotswapIds, next) {
			routes(app, middleware, hotswapIds, next);
		},
		function (next) {
			async.series([
				meta.sounds.addUploads,
				meta.blacklist.load,
				flags.init,
			], next);
		},
	], function (err) {
		callback(err);
	});
}

function setupExpressApp(app, callback) {
	var middleware = require('./middleware');

	var relativePath = nconf.get('relative_path');
	var viewsDir = nconf.get('views_dir');

	app.engine('tpl', function (filepath, data, next) {
		filepath = filepath.replace(/\.tpl$/, '.js');

		middleware.templatesOnDemand({
			filePath: filepath,
		}, null, function (err) {
			if (err) {
				return next(err);
			}

			Benchpress.__express(filepath, data, next);
		});
	});
	app.set('view engine', 'tpl');
	app.set('views', viewsDir);
	app.set('json spaces', global.env === 'development' ? 4 : 0);
	app.use(flash());

	app.enable('view cache');

	if (global.env !== 'development') {
		app.enable('cache');
		app.enable('minification');
	}

	app.use(compression());

	app.get(relativePath + '/ping', ping);
	app.get(relativePath + '/sping', ping);

	setupFavicon(app);

	app.use(relativePath + '/apple-touch-icon', middleware.routeTouchIcon);

	app.use(bodyParser.urlencoded({ extended: true }));
	app.use(bodyParser.json());
	app.use(cookieParser());
	app.use(useragent.express());

	app.use(session({
		store: db.sessionStore,
		secret: nconf.get('secret'),
		key: nconf.get('sessionKey'),
		cookie: setupCookie(),
		resave: true,
		saveUninitialized: true,
	}));

	app.use(middleware.addHeaders);
	app.use(middleware.processRender);
	auth.initialize(app, middleware);

	var toobusy = require('toobusy-js');
	toobusy.maxLag(parseInt(meta.config.eventLoopLagThreshold, 10) || 100);
	toobusy.interval(parseInt(meta.config.eventLoopInterval, 10) || 500);

	setupAutoLocale(app, callback);
}

function ping(req, res, next) {
	async.waterfall([
		function (next) {
			db.getObject('config', next);
		},
		function () {
			res.status(200).send(req.path === '/sping' ? 'healthy' : '200');
		},
	], next);
}

function setupFavicon(app) {
	var faviconPath = meta.config['brand:favicon'] || 'favicon.ico';
	faviconPath = path.join(nconf.get('base_dir'), 'public', faviconPath.replace(/assets\/uploads/, 'uploads'));
	if (file.existsSync(faviconPath)) {
		app.use(nconf.get('relative_path'), favicon(faviconPath));
	}
}

function setupCookie() {
	var ttl = meta.getSessionTTLSeconds() * 1000;

	var cookie = {
		maxAge: ttl,
	};

	if (nconf.get('cookieDomain') || meta.config.cookieDomain) {
		cookie.domain = nconf.get('cookieDomain') || meta.config.cookieDomain;
	}

	if (nconf.get('secure')) {
		cookie.secure = true;
	}

	var relativePath = nconf.get('relative_path');
	if (relativePath !== '') {
		cookie.path = relativePath;
	}

	return cookie;
}

function setupAutoLocale(app, callback) {
	languages.listCodes(function (err, codes) {
		if (err) {
			return callback(err);
		}

		var defaultLang = meta.config.defaultLang || 'en-GB';

		var langs = [defaultLang].concat(codes).filter(function (el, i, arr) {
			return arr.indexOf(el) === i;
		});

		app.use(function (req, res, next) {
			if (parseInt(req.uid, 10) > 0 || parseInt(meta.config.autoDetectLang, 10) !== 1) {
				return next();
			}

			var lang = req.acceptsLanguages(langs);
			if (!lang) {
				return next();
			}
			req.query.lang = lang;
			next();
		});

		callback();
	});
}

function listen(callback) {
	callback = callback || function () { };
	var port = nconf.get('port');
	var isSocket = isNaN(port);
	var socketPath = isSocket ? nconf.get('port') : '';

	if (Array.isArray(port)) {
		if (!port.length) {
			winston.error('[startup] empty ports array in config.json');
			process.exit();
		}

		winston.warn('[startup] If you want to start nodebb on multiple ports please use loader.js');
		winston.warn('[startup] Defaulting to first port in array, ' + port[0]);
		port = port[0];
		if (!port) {
			winston.error('[startup] Invalid port, exiting');
			process.exit();
		}
	}
	port = parseInt(port, 10);
	if ((port !== 80 && port !== 443) || nconf.get('trust_proxy') === true) {
		winston.info('Enabling \'trust proxy\'');
		app.enable('trust proxy');
	}

	if ((port === 80 || port === 443) && process.env.NODE_ENV !== 'development') {
		winston.info('Using ports 80 and 443 is not recommend; use a proxy instead. See README.md');
	}

	var bind_address = ((nconf.get('bind_address') === '0.0.0.0' || !nconf.get('bind_address')) ? '0.0.0.0' : nconf.get('bind_address'));
	var args = isSocket ? [socketPath] : [port, bind_address];
	var oldUmask;

	args.push(function (err) {
		if (err) {
			winston.info('[startup] NodeBB was unable to listen on: ' + bind_address + ':' + port);
			process.exit();
		}

		winston.info('NodeBB is now listening on: ' + (isSocket ? socketPath : bind_address + ':' + port));
		if (oldUmask) {
			process.umask(oldUmask);
		}
		callback();
	});

	// Alter umask if necessary
	if (isSocket) {
		oldUmask = process.umask('0000');
		module.exports.testSocket(socketPath, function (err) {
			if (err) {
				winston.error('[startup] NodeBB was unable to secure domain socket access (' + socketPath + ')', err);
				throw err;
			}

			server.listen.apply(server, args);
		});
	} else {
		server.listen.apply(server, args);
	}
}

module.exports.testSocket = function (socketPath, callback) {
	if (typeof socketPath !== 'string') {
		return callback(new Error('invalid socket path : ' + socketPath));
	}
	var net = require('net');
	var file = require('./file');
	async.series([
		function (next) {
			file.exists(socketPath, function (err, exists) {
				if (exists) {
					next();
				} else {
					callback(err);
				}
			});
		},
		function (next) {
			var testSocket = new net.Socket();
			testSocket.on('error', function (err) {
				next(err.code !== 'ECONNREFUSED' ? err : null);
			});
			testSocket.connect({ path: socketPath }, function () {
				// Something's listening here, abort
				callback(new Error('port-in-use'));
			});
		},
		async.apply(fs.unlink, socketPath),	// The socket was stale, kick it out of the way
	], callback);
};

