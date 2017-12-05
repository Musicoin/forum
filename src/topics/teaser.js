
'use strict';

var async = require('async');
var _ = require('lodash');
var winston = require('winston');

var meta = require('../meta');
var user = require('../user');
var posts = require('../posts');
var plugins = require('../plugins');
var utils = require('../utils');

module.exports = function (Topics) {
	Topics.getTeasers = function (topics, uid, callback) {
		if (typeof uid === 'function') {
			winston.warn('[Topics.getTeasers] this usage is deprecated please provide uid');
			callback = uid;
			uid = 0;
		}
		if (!Array.isArray(topics) || !topics.length) {
			return callback(null, []);
		}

		var counts = [];
		var teaserPids = [];
		var postData;
		var tidToPost = {};

		topics.forEach(function (topic) {
			counts.push(topic && (parseInt(topic.postcount, 10) || 0));
			if (topic) {
				if (topic.teaserPid === 'null') {
					delete topic.teaserPid;
				}

				switch (meta.config.teaserPost) {
				case 'first':
					teaserPids.push(topic.mainPid);
					break;

				case 'last-post':
					teaserPids.push(topic.teaserPid || topic.mainPid);
					break;

				case 'last-reply':	// intentional fall-through
				default:
					teaserPids.push(topic.teaserPid);
					break;
				}
			}
		});

		async.waterfall([
			function (next) {
				posts.getPostsFields(teaserPids, ['pid', 'uid', 'timestamp', 'tid', 'content'], next);
			},
			function (_postData, next) {
				postData = _postData;
				var uids = _.uniq(postData.map(function (post) {
					return post.uid;
				}));

				user.getUsersFields(uids, ['uid', 'username', 'userslug', 'picture'], next);
			},
			function (usersData, next) {
				var users = {};
				usersData.forEach(function (user) {
					users[user.uid] = user;
				});


				async.each(postData, function (post, next) {
					// If the post author isn't represented in the retrieved users' data, then it means they were deleted, assume guest.
					if (!users.hasOwnProperty(post.uid)) {
						post.uid = 0;
					}

					post.user = users[post.uid];
					post.timestampISO = utils.toISOString(post.timestamp);
					tidToPost[post.tid] = post;
					posts.parsePost(post, next);
				}, next);
			},
			function (next) {
				var teasers = topics.map(function (topic, index) {
					if (!topic) {
						return null;
					}
					if (tidToPost[topic.tid]) {
						tidToPost[topic.tid].index = meta.config.teaserPost === 'first' ? 1 : counts[index];
						if (tidToPost[topic.tid].content) {
							tidToPost[topic.tid].content = utils.stripHTMLTags(tidToPost[topic.tid].content, utils.stripTags);
						}
					}
					return tidToPost[topic.tid];
				});

				plugins.fireHook('filter:teasers.get', { teasers: teasers, uid: uid }, next);
			},
			function (data, next) {
				next(null, data.teasers);
			},
		], callback);
	};

	Topics.getTeasersByTids = function (tids, uid, callback) {
		if (typeof uid === 'function') {
			winston.warn('[Topics.getTeasersByTids] this usage is deprecated please provide uid');
			callback = uid;
			uid = 0;
		}
		if (!Array.isArray(tids) || !tids.length) {
			return callback(null, []);
		}
		async.waterfall([
			function (next) {
				Topics.getTopicsFields(tids, ['tid', 'postcount', 'teaserPid', 'mainPid'], next);
			},
			function (topics, next) {
				Topics.getTeasers(topics, uid, next);
			},
		], callback);
	};

	Topics.getTeaser = function (tid, uid, callback) {
		if (typeof uid === 'function') {
			winston.warn('[Topics.getTeaser] this usage is deprecated please provide uid');
			callback = uid;
			uid = 0;
		}
		Topics.getTeasersByTids([tid], uid, function (err, teasers) {
			callback(err, Array.isArray(teasers) && teasers.length ? teasers[0] : null);
		});
	};

	Topics.updateTeaser = function (tid, callback) {
		async.waterfall([
			function (next) {
				Topics.getLatestUndeletedReply(tid, next);
			},
			function (pid, next) {
				pid = pid || null;
				if (pid) {
					Topics.setTopicField(tid, 'teaserPid', pid, next);
				} else {
					Topics.deleteTopicField(tid, 'teaserPid', next);
				}
			},
		], callback);
	};
};
