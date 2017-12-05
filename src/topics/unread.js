
'use strict';

var async = require('async');
var _ = require('lodash');

var db = require('../database');
var user = require('../user');
var notifications = require('../notifications');
var categories = require('../categories');
var privileges = require('../privileges');
var meta = require('../meta');
var utils = require('../utils');
var plugins = require('../plugins');

module.exports = function (Topics) {
	Topics.getTotalUnread = function (uid, filter, callback) {
		if (!callback) {
			callback = filter;
			filter = '';
		}
		Topics.getUnreadTids({ cid: 0, uid: uid, filter: filter }, function (err, tids) {
			callback(err, Array.isArray(tids) ? tids.length : 0);
		});
	};

	Topics.getUnreadTopics = function (params, callback) {
		var unreadTopics = {
			showSelect: true,
			nextStart: 0,
			topics: [],
		};

		async.waterfall([
			function (next) {
				Topics.getUnreadTids(params, next);
			},
			function (tids, next) {
				unreadTopics.topicCount = tids.length;

				if (!tids.length) {
					return next(null, []);
				}

				if (params.stop === -1) {
					tids = tids.slice(params.start);
				} else {
					tids = tids.slice(params.start, params.stop + 1);
				}

				Topics.getTopicsByTids(tids, params.uid, next);
			},
			function (topicData, next) {
				if (!topicData.length) {
					return next(null, unreadTopics);
				}

				unreadTopics.topics = topicData;
				unreadTopics.nextStart = params.stop + 1;
				next(null, unreadTopics);
			},
		], callback);
	};

	Topics.unreadCutoff = function () {
		var cutoff = parseInt(meta.config.unreadCutoff, 10) || 2;
		return Date.now() - (cutoff * 86400000);
	};

	Topics.getUnreadTids = function (params, callback) {
		var uid = parseInt(params.uid, 10);
		if (uid === 0) {
			return callback(null, []);
		}

		var cutoff = params.cutoff || Topics.unreadCutoff();

		if (params.cid && !Array.isArray(params.cid)) {
			params.cid = [params.cid];
		}

		async.waterfall([
			function (next) {
				async.parallel({
					ignoredTids: function (next) {
						user.getIgnoredTids(uid, 0, -1, next);
					},
					recentTids: function (next) {
						db.getSortedSetRevRangeByScoreWithScores('topics:recent', 0, -1, '+inf', cutoff, next);
					},
					userScores: function (next) {
						db.getSortedSetRevRangeByScoreWithScores('uid:' + uid + ':tids_read', 0, -1, '+inf', cutoff, next);
					},
					tids_unread: function (next) {
						db.getSortedSetRevRangeWithScores('uid:' + uid + ':tids_unread', 0, -1, next);
					},
				}, next);
			},
			function (results, next) {
				if (results.recentTids && !results.recentTids.length && !results.tids_unread.length) {
					return callback(null, []);
				}

				var userRead = {};
				results.userScores.forEach(function (userItem) {
					userRead[userItem.value] = userItem.score;
				});

				results.recentTids = results.recentTids.concat(results.tids_unread);
				results.recentTids.sort(function (a, b) {
					return b.score - a.score;
				});

				var tids = results.recentTids.filter(function (recentTopic) {
					if (results.ignoredTids.indexOf(recentTopic.value.toString()) !== -1) {
						return false;
					}
					switch (params.filter) {
					case 'new':
						return !userRead[recentTopic.value];
					default:
						return !userRead[recentTopic.value] || recentTopic.score > userRead[recentTopic.value];
					}
				}).map(function (topic) {
					return topic.value;
				});

				tids = _.uniq(tids);

				if (params.filter === 'watched') {
					Topics.filterWatchedTids(tids, uid, next);
				} else if (params.filter === 'unreplied') {
					Topics.filterUnrepliedTids(tids, next);
				} else {
					next(null, tids);
				}
			},
			function (tids, next) {
				tids = tids.slice(0, 200);

				filterTopics(uid, tids, params.cid, params.filter, next);
			},
			function (tids, next) {
				plugins.fireHook('filter:topics.getUnreadTids', {
					uid: uid,
					tids: tids,
					cid: params.cid,
					filter: params.filter,
				}, next);
			},
			function (results, next) {
				next(null, results.tids);
			},
		], callback);
	};


	function filterTopics(uid, tids, cid, filter, callback) {
		if (!tids.length) {
			return callback(null, tids);
		}

		async.waterfall([
			function (next) {
				privileges.topics.filterTids('read', tids, uid, next);
			},
			function (tids, next) {
				async.parallel({
					topics: function (next) {
						Topics.getTopicsFields(tids, ['tid', 'cid'], next);
					},
					isTopicsFollowed: function (next) {
						if (filter === 'watched' || filter === 'new') {
							return next(null, []);
						}
						db.sortedSetScores('uid:' + uid + ':followed_tids', tids, next);
					},
					ignoredCids: function (next) {
						if (filter === 'watched') {
							return next(null, []);
						}
						user.getIgnoredCategories(uid, next);
					},
				}, next);
			},
			function (results, next) {
				var topics = results.topics;
				cid = cid && cid.map(String);
				tids = topics.filter(function (topic, index) {
					return topic && topic.cid &&
						(!!results.isTopicsFollowed[index] || results.ignoredCids.indexOf(topic.cid.toString()) === -1) &&
						(!cid || (cid.length && cid.indexOf(String(topic.cid)) !== -1));
				}).map(function (topic) {
					return topic.tid;
				});
				next(null, tids);
			},
		], callback);
	}

	Topics.pushUnreadCount = function (uid, callback) {
		callback = callback || function () {};

		if (!uid || parseInt(uid, 10) === 0) {
			return setImmediate(callback);
		}

		async.waterfall([
			function (next) {
				async.parallel({
					unreadTopicCount: async.apply(Topics.getTotalUnread, uid),
					unreadNewTopicCount: async.apply(Topics.getTotalUnread, uid, 'new'),
					unreadWatchedTopicCount: async.apply(Topics.getTotalUnread, uid, 'watched'),
				}, next);
			},
			function (results, next) {
				require('../socket.io').in('uid_' + uid).emit('event:unread.updateCount', results);
				setImmediate(next);
			},
		], callback);
	};

	Topics.markAsUnreadForAll = function (tid, callback) {
		Topics.markCategoryUnreadForAll(tid, callback);
	};

	Topics.markAsRead = function (tids, uid, callback) {
		callback = callback || function () {};
		if (!Array.isArray(tids) || !tids.length) {
			return setImmediate(callback, null, false);
		}

		tids = _.uniq(tids).filter(function (tid) {
			return tid && utils.isNumber(tid);
		});

		if (!tids.length) {
			return setImmediate(callback, null, false);
		}

		async.waterfall([
			function (next) {
				async.parallel({
					topicScores: async.apply(db.sortedSetScores, 'topics:recent', tids),
					userScores: async.apply(db.sortedSetScores, 'uid:' + uid + ':tids_read', tids),
				}, next);
			},
			function (results, next) {
				tids = tids.filter(function (tid, index) {
					return results.topicScores[index] && (!results.userScores[index] || results.userScores[index] < results.topicScores[index]);
				});

				if (!tids.length) {
					return callback(null, false);
				}

				var now = Date.now();
				var scores = tids.map(function () {
					return now;
				});

				async.parallel({
					markRead: async.apply(db.sortedSetAdd, 'uid:' + uid + ':tids_read', scores, tids),
					markUnread: async.apply(db.sortedSetRemove, 'uid:' + uid + ':tids_unread', tids),
					topicData: async.apply(Topics.getTopicsFields, tids, ['cid']),
				}, next);
			},
			function (results, next) {
				var cids = results.topicData.map(function (topic) {
					return topic && topic.cid;
				}).filter(Boolean);

				cids = _.uniq(cids);

				categories.markAsRead(cids, uid, next);
			},
			function (next) {
				plugins.fireHook('action:topics.markAsRead', { uid: uid, tids: tids });
				next(null, true);
			},
		], callback);
	};

	Topics.markAllRead = function (uid, callback) {
		async.waterfall([
			function (next) {
				db.getSortedSetRevRangeByScore('topics:recent', 0, -1, '+inf', Topics.unreadCutoff(), next);
			},
			function (tids, next) {
				Topics.markTopicNotificationsRead(tids, uid);
				Topics.markAsRead(tids, uid, next);
			},
			function (markedRead, next) {
				db.delete('uid:' + uid + ':tids_unread', next);
			},
		], callback);
	};

	Topics.markTopicNotificationsRead = function (tids, uid, callback) {
		callback = callback || function () {};
		if (!Array.isArray(tids) || !tids.length) {
			return callback();
		}

		async.waterfall([
			function (next) {
				user.notifications.getUnreadByField(uid, 'tid', tids, next);
			},
			function (nids, next) {
				notifications.markReadMultiple(nids, uid, next);
			},
			function (next) {
				user.notifications.pushCount(uid);
				next();
			},
		], callback);
	};

	Topics.markCategoryUnreadForAll = function (tid, callback) {
		async.waterfall([
			function (next) {
				Topics.getTopicField(tid, 'cid', next);
			},
			function (cid, next) {
				categories.markAsUnreadForAll(cid, next);
			},
		], callback);
	};

	Topics.hasReadTopics = function (tids, uid, callback) {
		if (!parseInt(uid, 10)) {
			return callback(null, tids.map(function () {
				return false;
			}));
		}

		async.waterfall([
			function (next) {
				async.parallel({
					recentScores: function (next) {
						db.sortedSetScores('topics:recent', tids, next);
					},
					userScores: function (next) {
						db.sortedSetScores('uid:' + uid + ':tids_read', tids, next);
					},
					tids_unread: function (next) {
						db.sortedSetScores('uid:' + uid + ':tids_unread', tids, next);
					},
				}, next);
			},
			function (results, next) {
				var cutoff = Topics.unreadCutoff();
				var result = tids.map(function (tid, index) {
					return !results.tids_unread[index] &&
						(results.recentScores[index] < cutoff ||
						!!(results.userScores[index] && results.userScores[index] >= results.recentScores[index]));
				});

				next(null, result);
			},
		], callback);
	};

	Topics.hasReadTopic = function (tid, uid, callback) {
		Topics.hasReadTopics([tid], uid, function (err, hasRead) {
			callback(err, Array.isArray(hasRead) && hasRead.length ? hasRead[0] : false);
		});
	};

	Topics.markUnread = function (tid, uid, callback) {
		async.waterfall([
			function (next) {
				Topics.exists(tid, next);
			},
			function (exists, next) {
				if (!exists) {
					return next(new Error('[[error:no-topic]]'));
				}
				db.sortedSetRemove('uid:' + uid + ':tids_read', tid, next);
			},
			function (next) {
				db.sortedSetAdd('uid:' + uid + ':tids_unread', Date.now(), tid, next);
			},
		], callback);
	};

	Topics.filterNewTids = function (tids, uid, callback) {
		async.waterfall([
			function (next) {
				db.sortedSetScores('uid:' + uid + ':tids_read', tids, next);
			},
			function (scores, next) {
				tids = tids.filter(function (tid, index) {
					return tid && !scores[index];
				});
				next(null, tids);
			},
		], callback);
	};

	Topics.filterUnrepliedTids = function (tids, callback) {
		async.waterfall([
			function (next) {
				db.sortedSetScores('topics:posts', tids, next);
			},
			function (scores, next) {
				tids = tids.filter(function (tid, index) {
					return tid && scores[index] <= 1;
				});
				next(null, tids);
			},
		], callback);
	};
};
