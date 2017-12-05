'use strict';

var async = require('async');
var nconf = require('nconf');

var meta = require('../meta');
var user = require('../user');
var privileges = require('../privileges');
var plugins = require('../plugins');

var controllers = {
	helpers: require('../controllers/helpers'),
};

module.exports = function (middleware) {
	middleware.authenticate = function (req, res, next) {
		if (req.uid) {
			return next();
		}

		if (plugins.hasListeners('action:middleware.authenticate')) {
			return plugins.fireHook('action:middleware.authenticate', {
				req: req,
				res: res,
				next: next,
			});
		}

		controllers.helpers.notAllowed(req, res);
	};

	middleware.ensureSelfOrGlobalPrivilege = function (req, res, next) {
		ensureSelfOrMethod(user.isAdminOrGlobalMod, req, res, next);
	};

	middleware.ensureSelfOrPrivileged = function (req, res, next) {
		ensureSelfOrMethod(user.isPrivileged, req, res, next);
	};

	function ensureSelfOrMethod(method, req, res, next) {
		/*
			The "self" part of this middleware hinges on you having used
			middleware.exposeUid prior to invoking this middleware.
		*/
		async.waterfall([
			function (next) {
				if (!req.uid) {
					return setImmediate(next, null, false);
				}

				if (req.uid === parseInt(res.locals.uid, 10)) {
					return setImmediate(next, null, true);
				}

				method(req.uid, next);
			},
			function (allowed, next) {
				if (!allowed) {
					return controllers.helpers.notAllowed(req, res);
				}
				next();
			},
		], next);
	}

	middleware.checkGlobalPrivacySettings = function (req, res, next) {
		if (!req.uid && !!parseInt(meta.config.privateUserInfo, 10)) {
			return middleware.authenticate(req, res, next);
		}

		next();
	};

	middleware.checkAccountPermissions = function (req, res, next) {
		// This middleware ensures that only the requested user and admins can pass
		async.waterfall([
			function (next) {
				middleware.authenticate(req, res, next);
			},
			function (next) {
				user.getUidByUserslug(req.params.userslug, next);
			},
			function (uid, next) {
				privileges.users.canEdit(req.uid, uid, next);
			},
			function (allowed, next) {
				if (allowed) {
					return next(null, allowed);
				}

				// For the account/info page only, allow plain moderators through
				if (/user\/.+\/info$/.test(req.path)) {
					user.isModeratorOfAnyCategory(req.uid, next);
				} else {
					next(null, false);
				}
			},
			function (allowed) {
				if (allowed) {
					return next();
				}
				controllers.helpers.notAllowed(req, res);
			},
		], next);
	};

	middleware.redirectToAccountIfLoggedIn = function (req, res, next) {
		if (req.session.forceLogin || !req.uid) {
			return next();
		}

		async.waterfall([
			function (next) {
				user.getUserField(req.uid, 'userslug', next);
			},
			function (userslug) {
				controllers.helpers.redirect(res, '/user/' + userslug);
			},
		], next);
	};

	middleware.redirectUidToUserslug = function (req, res, next) {
		var uid = parseInt(req.params.uid, 10);
		if (!uid) {
			return next();
		}
		async.waterfall([
			function (next) {
				user.getUserField(uid, 'userslug', next);
			},
			function (userslug) {
				if (!userslug) {
					return next();
				}
				var path = req.path.replace(/^\/api/, '')
					.replace('uid', 'user')
					.replace(uid, function () { return userslug; });
				controllers.helpers.redirect(res, path);
			},
		], next);
	};

	middleware.redirectMeToUserslug = function (req, res, next) {
		var uid = req.uid;
		async.waterfall([
			function (next) {
				user.getUserField(uid, 'userslug', next);
			},
			function (userslug) {
				if (!userslug) {
					return res.status(401).send('not-authorized');
				}
				var path = req.path.replace(/^(\/api)?\/me/, '/user/' + userslug);
				controllers.helpers.redirect(res, path);
			},
		], next);
	};

	middleware.isAdmin = function (req, res, next) {
		async.waterfall([
			function (next) {
				user.isAdministrator(req.uid, next);
			},
			function (isAdmin, next) {
				if (!isAdmin) {
					return controllers.helpers.notAllowed(req, res);
				}
				user.hasPassword(req.uid, next);
			},
			function (hasPassword, next) {
				if (!hasPassword) {
					return next();
				}

				var loginTime = req.session.meta ? req.session.meta.datetime : 0;
				var adminReloginDuration = (meta.config.adminReloginDuration || 60) * 60000;
				var disabled = parseInt(meta.config.adminReloginDuration, 10) === 0;
				if (disabled || (loginTime && parseInt(loginTime, 10) > Date.now() - adminReloginDuration)) {
					var timeLeft = parseInt(loginTime, 10) - (Date.now() - adminReloginDuration);
					if (timeLeft < Math.min(300000, adminReloginDuration)) {
						req.session.meta.datetime += Math.min(300000, adminReloginDuration);
					}

					return next();
				}

				var returnTo = req.path;
				if (nconf.get('relative_path')) {
					returnTo = req.path.replace(new RegExp('^' + nconf.get('relative_path')), '');
				}
				returnTo = returnTo.replace(/^\/api/, '');

				req.session.returnTo = nconf.get('relative_path') + returnTo;
				req.session.forceLogin = 1;
				if (res.locals.isAPI) {
					res.status(401).json({});
				} else {
					res.redirect(nconf.get('relative_path') + '/login');
				}
			},
		], next);
	};

	middleware.requireUser = function (req, res, next) {
		if (req.uid) {
			return next();
		}

		res.status(403).render('403', { title: '[[global:403.title]]' });
	};

	middleware.registrationComplete = function (req, res, next) {
		// If the user's session contains registration data, redirect the user to complete registration
		if (!req.session.hasOwnProperty('registration')) {
			return next();
		}
		if (!req.path.endsWith('/register/complete')) {
			controllers.helpers.redirect(res, '/register/complete');
		} else {
			return next();
		}
	};
};
