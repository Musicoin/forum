'use strict';

var async = require('async');
var nconf = require('nconf');
var validator = require('validator');

var meta = require('../meta');
var user = require('../user');
var plugins = require('../plugins');
var helpers = require('./helpers');

var Controllers = module.exports;

Controllers.home = require('./home');
Controllers.topics = require('./topics');
Controllers.posts = require('./posts');
Controllers.categories = require('./categories');
Controllers.category = require('./category');
Controllers.unread = require('./unread');
Controllers.recent = require('./recent');
Controllers.popular = require('./popular');
Controllers.top = require('./top');
Controllers.tags = require('./tags');
Controllers.search = require('./search');
Controllers.user = require('./user');
Controllers.users = require('./users');
Controllers.groups = require('./groups');
Controllers.accounts = require('./accounts');
Controllers.authentication = require('./authentication');
Controllers.api = require('./api');
Controllers.admin = require('./admin');
Controllers.globalMods = require('./globalmods');
Controllers.mods = require('./mods');
Controllers.sitemap = require('./sitemap');
Controllers.osd = require('./osd');
Controllers['404'] = require('./404');
Controllers.errors = require('./errors');
Controllers.composer = require('./composer');

Controllers.reset = function (req, res, next) {
	if (req.params.code) {
		async.waterfall([
			function (next) {
				user.reset.validate(req.params.code, next);
			},
			function (valid) {
				res.render('reset_code', {
					valid: valid,
					displayExpiryNotice: req.session.passwordExpired,
					code: req.params.code,
					minimumPasswordLength: parseInt(meta.config.minimumPasswordLength, 10),
					breadcrumbs: helpers.buildBreadcrumbs([
						{
							text: '[[reset_password:reset_password]]',
							url: '/reset',
						},
						{
							text: '[[reset_password:update_password]]',
						},
					]),
					title: '[[pages:reset]]',
				});
				delete req.session.passwordExpired;
			},
		], next);
	} else {
		res.render('reset', {
			code: null,
			breadcrumbs: helpers.buildBreadcrumbs([{
				text: '[[reset_password:reset_password]]',
			}]),
			title: '[[pages:reset]]',
		});
	}
};

Controllers.login = function (req, res, next) {
	var data = {};
	var loginStrategies = require('../routes/authentication').getLoginStrategies();
	var registrationType = meta.config.registrationType || 'normal';

	var allowLoginWith = (meta.config.allowLoginWith || 'username-email');
	var returnTo = (req.headers['x-return-to'] || '').replace(nconf.get('base_url'), '');

	var errorText;
	if (req.query.error === 'csrf-invalid') {
		errorText = '[[error:csrf-invalid]]';
	} else if (req.query.error) {
		errorText = validator.escape(String(req.query.error));
	}

	if (returnTo) {
		req.session.returnTo = returnTo;
	}

	data.alternate_logins = loginStrategies.length > 0;
	data.authentication = loginStrategies;
	data.allowLocalLogin = parseInt(meta.config.allowLocalLogin, 10) === 1 || parseInt(req.query.local, 10) === 1;
	data.allowRegistration = registrationType === 'normal' || registrationType === 'admin-approval' || registrationType === 'admin-approval-ip';
	data.allowLoginWith = '[[login:' + allowLoginWith + ']]';
	data.breadcrumbs = helpers.buildBreadcrumbs([{
		text: '[[global:login]]',
	}]);
	data.error = req.flash('error')[0] || errorText;
	data.title = '[[pages:login]]';

	if (!data.allowLocalLogin && !data.allowRegistration && data.alternate_logins && data.authentication.length === 1) {
		if (res.locals.isAPI) {
			return helpers.redirect(res, {
				external: nconf.get('relative_path') + data.authentication[0].url,
			});
		}
		return res.redirect(nconf.get('relative_path') + data.authentication[0].url);
	}
	if (req.uid) {
		user.getUserFields(req.uid, ['username', 'email'], function (err, user) {
			if (err) {
				return next(err);
			}
			data.username = allowLoginWith === 'email' ? user.email : user.username;
			data.alternate_logins = false;
			res.render('login', data);
		});
	} else {
		res.render('login', data);
	}
};

Controllers.register = function (req, res, next) {
	var registrationType = meta.config.registrationType || 'normal';

	if (registrationType === 'disabled') {
		return next();
	}

	var errorText;
	if (req.query.error === 'csrf-invalid') {
		errorText = '[[error:csrf-invalid]]';
	}

	async.waterfall([
		function (next) {
			if (registrationType === 'invite-only' || registrationType === 'admin-invite-only') {
				user.verifyInvitation(req.query, next);
			} else {
				next();
			}
		},
		function (next) {
			plugins.fireHook('filter:parse.post', {
				postData: {
					content: meta.config.termsOfUse || '',
				},
			}, next);
		},
		function (termsOfUse) {
			var loginStrategies = require('../routes/authentication').getLoginStrategies();
			var data = {
				'register_window:spansize': loginStrategies.length ? 'col-md-6' : 'col-md-12',
				alternate_logins: !!loginStrategies.length,
			};

			data.authentication = loginStrategies;

			data.minimumUsernameLength = parseInt(meta.config.minimumUsernameLength, 10);
			data.maximumUsernameLength = parseInt(meta.config.maximumUsernameLength, 10);
			data.minimumPasswordLength = parseInt(meta.config.minimumPasswordLength, 10);
			data.minimumPasswordStrength = parseInt(meta.config.minimumPasswordStrength || 0, 10);
			data.termsOfUse = termsOfUse.postData.content;
			data.breadcrumbs = helpers.buildBreadcrumbs([{
				text: '[[register:register]]',
			}]);
			data.regFormEntry = [];
			data.error = req.flash('error')[0] || errorText;
			data.title = '[[pages:register]]';

			res.render('register', data);
		},
	], next);
};

Controllers.registerInterstitial = function (req, res, next) {
	if (!req.session.hasOwnProperty('registration')) {
		return res.redirect(nconf.get('relative_path') + '/register');
	}

	async.waterfall([
		function (next) {
			plugins.fireHook('filter:register.interstitial', {
				userData: req.session.registration,
				interstitials: [],
			}, next);
		},
		function (data, next) {
			if (!data.interstitials.length) {
				// No interstitials, redirect to home
				delete req.session.registration;
				return res.redirect('/');
			}
			var renders = data.interstitials.map(function (interstitial) {
				return async.apply(req.app.render.bind(req.app), interstitial.template, interstitial.data || {});
			});


			async.parallel(renders, next);
		},
		function (sections) {
			var errors = req.flash('error');
			res.render('registerComplete', {
				title: '[[pages:registration-complete]]',
				errors: errors,
				sections: sections,
			});
		},
	], next);
};

Controllers.confirmEmail = function (req, res) {
	user.email.confirm(req.params.code, function (err) {
		res.render('confirm', {
			error: err ? err.message : '',
			title: '[[pages:confirm]]',
		});
	});
};

Controllers.robots = function (req, res) {
	res.set('Content-Type', 'text/plain');

	if (meta.config['robots:txt']) {
		res.send(meta.config['robots:txt']);
	} else {
		res.send('User-agent: *\n' +
			'Disallow: ' + nconf.get('relative_path') + '/admin/\n' +
			'Sitemap: ' + nconf.get('url') + '/sitemap.xml');
	}
};

Controllers.manifest = function (req, res) {
	var manifest = {
		name: meta.config.title || 'NodeBB',
		start_url: nconf.get('relative_path') + '/',
		display: 'standalone',
		orientation: 'portrait',
		icons: [],
	};

	if (meta.config['brand:touchIcon']) {
		manifest.icons.push({
			src: nconf.get('relative_path') + '/assets/uploads/system/touchicon-36.png',
			sizes: '36x36',
			type: 'image/png',
			density: 0.75,
		}, {
			src: nconf.get('relative_path') + '/assets/uploads/system/touchicon-48.png',
			sizes: '48x48',
			type: 'image/png',
			density: 1.0,
		}, {
			src: nconf.get('relative_path') + '/assets/uploads/system/touchicon-72.png',
			sizes: '72x72',
			type: 'image/png',
			density: 1.5,
		}, {
			src: nconf.get('relative_path') + '/assets/uploads/system/touchicon-96.png',
			sizes: '96x96',
			type: 'image/png',
			density: 2.0,
		}, {
			src: nconf.get('relative_path') + '/assets/uploads/system/touchicon-144.png',
			sizes: '144x144',
			type: 'image/png',
			density: 3.0,
		}, {
			src: nconf.get('relative_path') + '/assets/uploads/system/touchicon-192.png',
			sizes: '192x192',
			type: 'image/png',
			density: 4.0,
		});
	}

	res.status(200).json(manifest);
};

Controllers.outgoing = function (req, res, next) {
	var url = req.query.url || '';
	var allowedProtocols = ['http', 'https', 'ftp', 'ftps', 'mailto', 'news', 'irc', 'gopher', 'nntp', 'feed', 'telnet', 'mms', 'rtsp', 'svn', 'tel', 'fax', 'xmpp', 'webcal'];
	var parsed = require('url').parse(url);

	if (!url || !parsed.protocol || !allowedProtocols.includes(parsed.protocol.slice(0, -1))) {
		return next();
	}

	res.render('outgoing', {
		outgoing: validator.escape(String(url)),
		title: meta.config.title,
		breadcrumbs: helpers.buildBreadcrumbs([{
			text: '[[notifications:outgoing_link]]',
		}]),
	});
};

Controllers.termsOfUse = function (req, res, next) {
	if (!meta.config.termsOfUse) {
		return next();
	}
	res.render('tos', {
		termsOfUse: meta.config.termsOfUse,
	});
};
