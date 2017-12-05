'use strict';

var async = require('async');

var user = require('../user');
var categories = require('../categories');
var flags = require('../flags');
var analytics = require('../analytics');
var plugins = require('../plugins');
var adminPostQueueController = require('./admin/postqueue');

var modsController = module.exports;
modsController.flags = {};

modsController.flags.list = function (req, res, next) {
	var filters;
	var hasFilter;
	var validFilters = ['assignee', 'state', 'reporterId', 'type', 'targetUid', 'cid', 'quick'];
	async.waterfall([
		function (next) {
			async.parallel({
				isAdminOrGlobalMod: async.apply(user.isAdminOrGlobalMod, req.uid),
				moderatedCids: async.apply(user.getModeratedCids, req.uid),
				validFilters: async.apply(plugins.fireHook, 'filter:flags.validateFilters', { filters: validFilters }),
			}, next);
		},
		function (results, next) {
			if (!(results.isAdminOrGlobalMod || !!results.moderatedCids.length)) {
				return next(new Error('[[error:no-privileges]]'));
			}

			if (!results.isAdminOrGlobalMod && results.moderatedCids.length) {
				res.locals.cids = results.moderatedCids;
			}

			validFilters = results.validFilters.filters;

			// Parse query string params for filters
			hasFilter = false;

			filters = validFilters.reduce(function (memo, cur) {
				if (req.query.hasOwnProperty(cur)) {
					memo[cur] = req.query[cur];
				}

				return memo;
			}, {});
			hasFilter = !!Object.keys(filters).length;

			if (res.locals.cids) {
				if (!filters.cid) {
					// If mod and no cid filter, add filter for their modded categories
					filters.cid = res.locals.cids;
				} else if (Array.isArray(filters.cid)) {
					// Remove cids they do not moderate
					filters.cid = filters.cid.filter(function (cid) {
						return res.locals.cids.indexOf(String(cid)) !== -1;
					});
				} else if (res.locals.cids.indexOf(String(filters.cid)) === -1) {
					filters.cid = res.locals.cids;
					hasFilter = false;
				}
			}

			async.parallel({
				flags: async.apply(flags.list, filters, req.uid),
				analytics: async.apply(analytics.getDailyStatsForSet, 'analytics:flags', Date.now(), 30),
				categories: async.apply(categories.buildForSelect, req.uid, 'read'),
			}, next);
		},
		function (data) {
			// If res.locals.cids is populated, then slim down the categories list
			if (res.locals.cids) {
				data.categories = data.categories.filter(function (category) {
					return res.locals.cids.indexOf(String(category.cid)) !== -1;
				});
			}

			// Minimal returned set for templates.js
			data.categories = data.categories.reduce(function (memo, cur) {
				if (!res.locals.cids) {
					memo[cur.cid] = cur.name;
					return memo;
				}

				// If mod, remove categories they can't moderate
				if (res.locals.cids.indexOf(String(cur.cid)) !== -1) {
					memo[cur.cid] = cur.name;
				}

				return memo;
			}, {});

			res.render('flags/list', {
				flags: data.flags,
				analytics: data.analytics,
				categories: data.categories,
				hasFilter: hasFilter,
				filters: filters,
				title: '[[pages:flags]]',
			});
		},
	], next);
};

modsController.flags.detail = function (req, res, next) {
	async.parallel({
		isAdminOrGlobalMod: async.apply(user.isAdminOrGlobalMod, req.uid),
		moderatedCids: async.apply(user.getModeratedCids, req.uid),
		flagData: async.apply(flags.get, req.params.flagId),
		assignees: async.apply(user.getAdminsandGlobalModsandModerators),
	}, function (err, results) {
		if (err || !results.flagData) {
			return next(err || new Error('[[error:invalid-data]]'));
		} else if (!(results.isAdminOrGlobalMod || !!results.moderatedCids.length)) {
			return next(new Error('[[error:no-privileges]]'));
		}

		if (results.flagData.type === 'user') {
			results.flagData.type_path = 'uid';
		} else if (results.flagData.type === 'post') {
			results.flagData.type_path = 'post';
		}

		res.render('flags/detail', Object.assign(results.flagData, {
			assignees: results.assignees,
			type_bool: ['post', 'user', 'empty'].reduce(function (memo, cur) {
				if (cur !== 'empty') {
					memo[cur] = results.flagData.type === cur && !!Object.keys(results.flagData.target).length;
				} else {
					memo[cur] = !Object.keys(results.flagData.target).length;
				}

				return memo;
			}, {}),
			title: '[[pages:flag-details, ' + req.params.flagId + ']]',
		}));
	});
};

modsController.postQueue = function (req, res, next) {
	async.waterfall([
		function (next) {
			user.isPrivileged(req.uid, next);
		},
		function (isPrivileged, next) {
			if (!isPrivileged) {
				return next();
			}
			adminPostQueueController.get(req, res, next);
		},
	], next);
};

