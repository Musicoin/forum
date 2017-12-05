'use strict';


var async = require('async');
var nconf = require('nconf');

var user = require('../user');
var meta = require('../meta');
var topics = require('../topics');
var posts = require('../posts');
var privileges = require('../privileges');
var plugins = require('../plugins');
var helpers = require('./helpers');
var pagination = require('../pagination');
var utils = require('../utils');

var topicsController = module.exports;

topicsController.get = function (req, res, callback) {
	var tid = req.params.topic_id;
	var currentPage = parseInt(req.query.page, 10) || 1;
	var pageCount = 1;
	var userPrivileges;
	var settings;
	var rssToken;

	if ((req.params.post_index && !utils.isNumber(req.params.post_index)) || !utils.isNumber(tid)) {
		return callback();
	}

	async.waterfall([
		function (next) {
			async.parallel({
				privileges: function (next) {
					privileges.topics.get(tid, req.uid, next);
				},
				settings: function (next) {
					user.getSettings(req.uid, next);
				},
				topic: function (next) {
					topics.getTopicData(tid, next);
				},
				rssToken: function (next) {
					user.auth.getFeedToken(req.uid, next);
				},
			}, next);
		},
		function (results, next) {
			if (!results.topic) {
				return callback();
			}

			userPrivileges = results.privileges;
			rssToken = results.rssToken;

			if (!userPrivileges['topics:read'] || (parseInt(results.topic.deleted, 10) && !userPrivileges.view_deleted)) {
				return helpers.notAllowed(req, res);
			}

			if (!res.locals.isAPI && (!req.params.slug || results.topic.slug !== tid + '/' + req.params.slug) && (results.topic.slug && results.topic.slug !== tid + '/')) {
				var url = '/topic/' + results.topic.slug;
				if (req.params.post_index) {
					url += '/' + req.params.post_index;
				}
				if (currentPage > 1) {
					url += '?page=' + currentPage;
				}
				return helpers.redirect(res, url);
			}

			settings = results.settings;
			var postCount = parseInt(results.topic.postcount, 10);
			pageCount = Math.max(1, Math.ceil(postCount / settings.postsPerPage));
			results.topic.postcount = postCount;

			if (utils.isNumber(req.params.post_index) && (req.params.post_index < 1 || req.params.post_index > postCount)) {
				return helpers.redirect(res, '/topic/' + req.params.topic_id + '/' + req.params.slug + (req.params.post_index > postCount ? '/' + postCount : ''));
			}

			if (settings.usePagination && (currentPage < 1 || currentPage > pageCount)) {
				return callback();
			}

			var set = 'tid:' + tid + ':posts';
			var reverse = false;
			// `sort` qs has priority over user setting
			var sort = req.query.sort || settings.topicPostSort;
			if (sort === 'newest_to_oldest') {
				reverse = true;
			} else if (sort === 'most_votes') {
				reverse = true;
				set = 'tid:' + tid + ':posts:votes';
			}

			var postIndex = 0;

			req.params.post_index = parseInt(req.params.post_index, 10) || 0;
			if (reverse && req.params.post_index === 1) {
				req.params.post_index = 0;
			}
			if (!settings.usePagination) {
				if (req.params.post_index !== 0) {
					currentPage = 1;
				}
				if (reverse) {
					postIndex = Math.max(0, postCount - (req.params.post_index || postCount) - Math.ceil(settings.postsPerPage / 2));
				} else {
					postIndex = Math.max(0, (req.params.post_index || 1) - Math.ceil(settings.postsPerPage / 2));
				}
			} else if (!req.query.page) {
				var index;
				if (reverse) {
					index = Math.max(0, postCount - (req.params.post_index || postCount) + 2);
				} else {
					index = Math.max(0, req.params.post_index) || 0;
				}

				currentPage = Math.max(1, Math.ceil(index / settings.postsPerPage));
			}

			var start = ((currentPage - 1) * settings.postsPerPage) + postIndex;
			var stop = start + settings.postsPerPage - 1;

			topics.getTopicWithPosts(results.topic, set, req.uid, start, stop, reverse, next);
		},
		function (topicData, next) {
			if (topicData.category.disabled) {
				return callback();
			}

			topics.modifyPostsByPrivilege(topicData, userPrivileges);

			plugins.fireHook('filter:controllers.topic.get', { topicData: topicData, uid: req.uid }, next);
		},
		function (data, next) {
			buildBreadcrumbs(data.topicData, next);
		},
		function (topicData) {
			topicData.privileges = userPrivileges;
			topicData.topicStaleDays = parseInt(meta.config.topicStaleDays, 10) || 60;
			topicData['reputation:disabled'] = parseInt(meta.config['reputation:disabled'], 10) === 1;
			topicData['downvote:disabled'] = parseInt(meta.config['downvote:disabled'], 10) === 1;
			topicData['feeds:disableRSS'] = parseInt(meta.config['feeds:disableRSS'], 10) === 1;
			topicData.bookmarkThreshold = parseInt(meta.config.bookmarkThreshold, 10) || 5;
			topicData.postEditDuration = parseInt(meta.config.postEditDuration, 10) || 0;
			topicData.postDeleteDuration = parseInt(meta.config.postDeleteDuration, 10) || 0;
			topicData.scrollToMyPost = settings.scrollToMyPost;
			topicData.rssFeedUrl = nconf.get('relative_path') + '/topic/' + topicData.tid + '.rss';
			if (req.uid) {
				topicData.rssFeedUrl += '?uid=' + req.uid + '&token=' + rssToken;
			}

			addTags(topicData, req, res);

			topicData.postIndex = req.params.post_index;
			topicData.pagination = pagination.create(currentPage, pageCount, req.query);
			topicData.pagination.rel.forEach(function (rel) {
				rel.href = nconf.get('url') + '/topic/' + topicData.slug + rel.href;
				res.locals.linkTags.push(rel);
			});

			req.session.tids_viewed = req.session.tids_viewed || {};
			if (!req.session.tids_viewed[tid] || req.session.tids_viewed[tid] < Date.now() - 3600000) {
				topics.increaseViewCount(tid);
				req.session.tids_viewed[tid] = Date.now();
			}

			if (req.uid) {
				topics.markAsRead([tid], req.uid, function (err, markedRead) {
					if (err) {
						return callback(err);
					}
					if (markedRead) {
						topics.pushUnreadCount(req.uid);
						topics.markTopicNotificationsRead([tid], req.uid);
					}
				});
			}

			res.render('topic', topicData);
		},
	], callback);
};

function buildBreadcrumbs(topicData, callback) {
	var breadcrumbs = [
		{
			text: topicData.category.name,
			url: nconf.get('relative_path') + '/category/' + topicData.category.slug,
		},
		{
			text: topicData.title,
		},
	];

	async.waterfall([
		function (next) {
			helpers.buildCategoryBreadcrumbs(topicData.category.parentCid, next);
		},
		function (crumbs, next) {
			topicData.breadcrumbs = crumbs.concat(breadcrumbs);
			next(null, topicData);
		},
	], callback);
}

function addTags(topicData, req, res) {
	function findPost(index) {
		for (var i = 0; i < topicData.posts.length; i += 1) {
			if (parseInt(topicData.posts[i].index, 10) === parseInt(index, 10)) {
				return topicData.posts[i];
			}
		}
	}
	var description = '';
	var postAtIndex = findPost(Math.max(0, req.params.post_index - 1));

	if (postAtIndex && postAtIndex.content) {
		description = utils.stripHTMLTags(utils.decodeHTMLEntities(postAtIndex.content));
	}

	if (description.length > 255) {
		description = description.substr(0, 255) + '...';
	}

	var ogImageUrl = '';
	if (topicData.thumb) {
		ogImageUrl = topicData.thumb;
	} else if (topicData.category.backgroundImage && (!postAtIndex || !postAtIndex.index)) {
		ogImageUrl = topicData.category.backgroundImage;
	} else if (postAtIndex && postAtIndex.user && postAtIndex.user.picture) {
		ogImageUrl = postAtIndex.user.picture;
	} else if (meta.config['og:image']) {
		ogImageUrl = meta.config['og:image'];
	} else if (meta.config['brand:logo']) {
		ogImageUrl = meta.config['brand:logo'];
	} else {
		ogImageUrl = '/logo.png';
	}

	if (typeof ogImageUrl === 'string' && ogImageUrl.indexOf('http') === -1) {
		ogImageUrl = nconf.get('url') + ogImageUrl;
	}

	description = description.replace(/\n/g, ' ');
	res.locals.metaTags = [
		{
			name: 'title',
			content: topicData.titleRaw,
		},
		{
			name: 'description',
			content: description,
		},
		{
			property: 'og:title',
			content: topicData.titleRaw,
		},
		{
			property: 'og:description',
			content: description,
		},
		{
			property: 'og:type',
			content: 'article',
		},
		{
			property: 'og:image',
			content: ogImageUrl,
			noEscape: true,
		},
		{
			property: 'og:image:url',
			content: ogImageUrl,
			noEscape: true,
		},
		{
			property: 'article:published_time',
			content: utils.toISOString(topicData.timestamp),
		},
		{
			property: 'article:modified_time',
			content: utils.toISOString(topicData.lastposttime),
		},
		{
			property: 'article:section',
			content: topicData.category ? topicData.category.name : '',
		},
	];

	res.locals.linkTags = [
		{
			rel: 'alternate',
			type: 'application/rss+xml',
			href: topicData.rssFeedUrl,
		},
		{
			rel: 'canonical',
			href: nconf.get('url') + '/topic/' + topicData.slug,
		},
	];

	if (topicData.category) {
		res.locals.linkTags.push({
			rel: 'up',
			href: nconf.get('url') + '/category/' + topicData.category.slug,
		});
	}
}

topicsController.teaser = function (req, res, next) {
	var tid = req.params.topic_id;

	if (!utils.isNumber(tid)) {
		return next();
	}

	async.waterfall([
		function (next) {
			privileges.topics.can('read', tid, req.uid, next);
		},
		function (canRead, next) {
			if (!canRead) {
				return res.status(403).json('[[error:no-privileges]]');
			}
			topics.getLatestUndeletedPid(tid, next);
		},
		function (pid, next) {
			if (!pid) {
				return res.status(404).json('not-found');
			}
			posts.getPostSummaryByPids([pid], req.uid, { stripTags: false }, next);
		},
		function (posts) {
			if (!posts.length) {
				return res.status(404).json('not-found');
			}
			res.json(posts[0]);
		},
	], next);
};

topicsController.pagination = function (req, res, callback) {
	var tid = req.params.topic_id;
	var currentPage = parseInt(req.query.page, 10) || 1;

	if (!utils.isNumber(tid)) {
		return callback();
	}

	async.parallel({
		privileges: async.apply(privileges.topics.get, tid, req.uid),
		settings: async.apply(user.getSettings, req.uid),
		topic: async.apply(topics.getTopicData, tid),
	}, function (err, results) {
		if (err || !results.topic) {
			return callback(err);
		}

		if (!results.privileges.read || (parseInt(results.topic.deleted, 10) && !results.privileges.view_deleted)) {
			return helpers.notAllowed(req, res);
		}

		var postCount = parseInt(results.topic.postcount, 10);
		var pageCount = Math.max(1, Math.ceil((postCount - 1) / results.settings.postsPerPage));

		var paginationData = pagination.create(currentPage, pageCount);
		paginationData.rel.forEach(function (rel) {
			rel.href = nconf.get('url') + '/topic/' + results.topic.slug + rel.href;
		});

		res.json(paginationData);
	});
};
