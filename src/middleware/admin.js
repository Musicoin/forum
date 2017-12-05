'use strict';

var async = require('async');
var winston = require('winston');
var user = require('../user');
var meta = require('../meta');
var plugins = require('../plugins');
var jsesc = require('jsesc');

var controllers = {
	api: require('../controllers/api'),
	helpers: require('../controllers/helpers'),
};

module.exports = function (middleware) {
	middleware.admin = {};
	middleware.admin.isAdmin = function (req, res, next) {
		winston.warn('[middleware.admin.isAdmin] deprecation warning, no need to use this from plugins!');
		middleware.isAdmin(req, res, next);
	};

	middleware.admin.buildHeader = function (req, res, next) {
		res.locals.renderAdminHeader = true;

		async.waterfall([
			function (next) {
				controllers.api.getConfig(req, res, next);
			},
			function (config, next) {
				res.locals.config = config;
				next();
			},
		], next);
	};

	middleware.admin.renderHeader = function (req, res, data, next) {
		var custom_header = {
			plugins: [],
			authentication: [],
		};

		async.waterfall([
			function (next) {
				async.parallel({
					userData: function (next) {
						user.getUserFields(req.uid, ['username', 'userslug', 'email', 'picture', 'email:confirmed'], next);
					},
					scripts: function (next) {
						getAdminScripts(next);
					},
					custom_header: function (next) {
						plugins.fireHook('filter:admin.header.build', custom_header, next);
					},
					config: function (next) {
						controllers.api.getConfig(req, res, next);
					},
					configs: function (next) {
						meta.configs.list(next);
					},
				}, next);
			},
			function (results, next) {
				var userData = results.userData;
				userData.uid = req.uid;
				userData['email:confirmed'] = parseInt(userData['email:confirmed'], 10) === 1;

				res.locals.config = results.config;

				var acpPath = req.path.slice(1).split('/');
				acpPath.forEach(function (path, i) {
					acpPath[i] = path.charAt(0).toUpperCase() + path.slice(1);
				});
				acpPath = acpPath.join(' > ');

				var templateValues = {
					config: results.config,
					configJSON: jsesc(JSON.stringify(results.config), { isScriptContext: true }),
					relative_path: results.config.relative_path,
					adminConfigJSON: encodeURIComponent(JSON.stringify(results.configs)),
					user: userData,
					userJSON: jsesc(JSON.stringify(userData), { isScriptContext: true }),
					plugins: results.custom_header.plugins,
					authentication: results.custom_header.authentication,
					scripts: results.scripts,
					'cache-buster': meta.config['cache-buster'] || '',
					env: !!process.env.NODE_ENV,
					title: (acpPath || 'Dashboard') + ' | NodeBB Admin Control Panel',
					bodyClass: data.bodyClass,
				};

				templateValues.template = { name: res.locals.template };
				templateValues.template[res.locals.template] = true;

				req.app.render('admin/header', templateValues, next);
			},
		], next);
	};

	function getAdminScripts(callback) {
		async.waterfall([
			function (next) {
				plugins.fireHook('filter:admin.scripts.get', [], next);
			},
			function (scripts, next) {
				next(null, scripts.map(function (script) {
					return { src: script };
				}));
			},
		], callback);
	}

	middleware.admin.renderFooter = function (req, res, data, next) {
		req.app.render('admin/footer', data, next);
	};
};
