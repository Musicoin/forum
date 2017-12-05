
'use strict';

var async = require('async');
var nconf = require('nconf');
var querystring = require('querystring');

var pagination = require('../pagination');
var user = require('../user');
var topics = require('../topics');
var plugins = require('../plugins');
var helpers = require('./helpers');

var unreadController = module.exports;

unreadController.get = function (req, res, next) {
	var page = parseInt(req.query.page, 10) || 1;
	var results;
	var cid = req.query.cid;
	var filter = req.params.filter || '';
	var settings;

	async.waterfall([
		function (next) {
			plugins.fireHook('filter:unread.getValidFilters', { filters: Object.assign({}, helpers.validFilters) }, next);
		},
		function (data, _next) {
			if (!data.filters[filter]) {
				return next();
			}

			async.parallel({
				watchedCategories: function (next) {
					helpers.getWatchedCategories(req.uid, cid, next);
				},
				settings: function (next) {
					user.getSettings(req.uid, next);
				},
			}, _next);
		},
		function (_results, next) {
			results = _results;
			settings = results.settings;
			var start = Math.max(0, (page - 1) * settings.topicsPerPage);
			var stop = start + settings.topicsPerPage - 1;
			var cutoff = req.session.unreadCutoff ? req.session.unreadCutoff : topics.unreadCutoff();
			topics.getUnreadTopics({
				cid: cid,
				uid: req.uid,
				start: start,
				stop: stop,
				filter: filter,
				cutoff: cutoff,
			}, next);
		},
		function (data) {
			data.pageCount = Math.max(1, Math.ceil(data.topicCount / settings.topicsPerPage));
			data.pagination = pagination.create(page, data.pageCount, req.query);

			if (settings.usePagination && (page < 1 || page > data.pageCount)) {
				req.query.page = Math.max(1, Math.min(data.pageCount, page));
				return helpers.redirect(res, '/unread?' + querystring.stringify(req.query));
			}

			data.categories = results.watchedCategories.categories;
			data.selectedCategory = results.watchedCategories.selectedCategory;
			data.selectedCids = results.watchedCategories.selectedCids;
			if (req.originalUrl.startsWith(nconf.get('relative_path') + '/api/unread') || req.originalUrl.startsWith(nconf.get('relative_path') + '/unread')) {
				data.breadcrumbs = helpers.buildBreadcrumbs([{ text: '[[unread:title]]' }]);
			}

			data.title = '[[pages:unread]]';
			data.filters = helpers.buildFilters('unread', filter);

			data.selectedFilter = data.filters.find(function (filter) {
				return filter && filter.selected;
			});

			data.querystring = cid ? '?' + querystring.stringify({ cid: cid }) : '';
			res.render('unread', data);
		},
	], next);
};

unreadController.unreadTotal = function (req, res, next) {
	var filter = req.params.filter || '';

	async.waterfall([
		function (next) {
			plugins.fireHook('filter:unread.getValidFilters', { filters: Object.assign({}, helpers.validFilters) }, next);
		},
		function (data, _next) {
			if (!data.filters[filter]) {
				return next();
			}
			topics.getTotalUnread(req.uid, filter, _next);
		},
		function (data) {
			res.json(data);
		},
	], next);
};
