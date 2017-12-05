'use strict';

var async = require('async');
var _ = require('lodash');

var db = require('./database');
var utils = require('./utils');
var user = require('./user');
var topics = require('./topics');
var privileges = require('./privileges');
var plugins = require('./plugins');

var Posts = module.exports;

require('./posts/create')(Posts);
require('./posts/delete')(Posts);
require('./posts/edit')(Posts);
require('./posts/parse')(Posts);
require('./posts/user')(Posts);
require('./posts/topics')(Posts);
require('./posts/category')(Posts);
require('./posts/summary')(Posts);
require('./posts/recent')(Posts);
require('./posts/tools')(Posts);
require('./posts/votes')(Posts);
require('./posts/bookmarks')(Posts);
require('./posts/queue')(Posts);

Posts.exists = function (pid, callback) {
	db.isSortedSetMember('posts:pid', pid, callback);
};

Posts.getPidsFromSet = function (set, start, stop, reverse, callback) {
	if (isNaN(start) || isNaN(stop)) {
		return callback(null, []);
	}
	db[reverse ? 'getSortedSetRevRange' : 'getSortedSetRange'](set, start, stop, callback);
};

Posts.getPostsByPids = function (pids, uid, callback) {
	if (!Array.isArray(pids) || !pids.length) {
		return callback(null, []);
	}

	async.waterfall([
		function (next) {
			var keys = pids.map(function (pid) {
				return 'post:' + pid;
			});
			db.getObjects(keys, next);
		},
		function (posts, next) {
			async.map(posts, function (post, next) {
				if (!post) {
					return next();
				}
				post.upvotes = parseInt(post.upvotes, 10) || 0;
				post.downvotes = parseInt(post.downvotes, 10) || 0;
				post.votes = post.upvotes - post.downvotes;
				post.timestampISO = utils.toISOString(post.timestamp);
				post.editedISO = parseInt(post.edited, 10) !== 0 ? utils.toISOString(post.edited) : '';
				Posts.parsePost(post, next);
			}, next);
		},
		function (posts, next) {
			plugins.fireHook('filter:post.getPosts', { posts: posts, uid: uid }, next);
		},
		function (data, next) {
			if (!data || !Array.isArray(data.posts)) {
				return next(null, []);
			}
			data.posts = data.posts.filter(Boolean);
			next(null, data.posts);
		},
	], callback);
};

Posts.getPostSummariesFromSet = function (set, uid, start, stop, callback) {
	async.waterfall([
		function (next) {
			db.getSortedSetRevRange(set, start, stop, next);
		},
		function (pids, next) {
			privileges.posts.filter('read', pids, uid, next);
		},
		function (pids, next) {
			Posts.getPostSummaryByPids(pids, uid, { stripTags: false }, next);
		},
		function (posts, next) {
			next(null, { posts: posts, nextStart: stop + 1 });
		},
	], callback);
};

Posts.getPostData = function (pid, callback) {
	async.waterfall([
		function (next) {
			db.getObject('post:' + pid, next);
		},
		function (data, next) {
			plugins.fireHook('filter:post.getPostData', { post: data }, next);
		},
		function (data, next) {
			next(null, data.post);
		},
	], callback);
};

Posts.getPostField = function (pid, field, callback) {
	async.waterfall([
		function (next) {
			Posts.getPostFields(pid, [field], next);
		},
		function (data, next) {
			next(null, data[field]);
		},
	], callback);
};

Posts.getPostFields = function (pid, fields, callback) {
	async.waterfall([
		function (next) {
			db.getObjectFields('post:' + pid, fields, next);
		},
		function (data, next) {
			data.pid = pid;

			plugins.fireHook('filter:post.getFields', { posts: [data], fields: fields }, next);
		},
		function (data, next) {
			next(null, (data && Array.isArray(data.posts) && data.posts.length) ? data.posts[0] : null);
		},
	], callback);
};

Posts.getPostsFields = function (pids, fields, callback) {
	if (!Array.isArray(pids) || !pids.length) {
		return callback(null, []);
	}

	var keys = pids.map(function (pid) {
		return 'post:' + pid;
	});

	async.waterfall([
		function (next) {
			db.getObjectsFields(keys, fields, next);
		},
		function (posts, next) {
			plugins.fireHook('filter:post.getFields', { posts: posts, fields: fields }, next);
		},
		function (data, next) {
			next(null, (data && Array.isArray(data.posts)) ? data.posts : null);
		},
	], callback);
};

Posts.setPostField = function (pid, field, value, callback) {
	async.waterfall([
		function (next) {
			db.setObjectField('post:' + pid, field, value, next);
		},
		function (next) {
			var data = {
				pid: pid,
			};
			data[field] = value;
			plugins.fireHook('action:post.setFields', { data: data });
			next();
		},
	], callback);
};

Posts.setPostFields = function (pid, data, callback) {
	async.waterfall([
		function (next) {
			db.setObject('post:' + pid, data, next);
		},
		function (next) {
			data.pid = pid;
			plugins.fireHook('action:post.setFields', { data: data });
			next();
		},
	], callback);
};

Posts.getPidIndex = function (pid, tid, topicPostSort, callback) {
	async.waterfall([
		function (next) {
			var set = topicPostSort === 'most_votes' ? 'tid:' + tid + ':posts:votes' : 'tid:' + tid + ':posts';
			db.sortedSetRank(set, pid, next);
		},
		function (index, next) {
			if (!utils.isNumber(index)) {
				return next(null, 0);
			}
			next(null, parseInt(index, 10) + 1);
		},
	], callback);
};

Posts.getPostIndices = function (posts, uid, callback) {
	if (!Array.isArray(posts) || !posts.length) {
		return callback(null, []);
	}

	async.waterfall([
		function (next) {
			user.getSettings(uid, next);
		},
		function (settings, next) {
			var byVotes = settings.topicPostSort === 'most_votes';
			var sets = posts.map(function (post) {
				return byVotes ? 'tid:' + post.tid + ':posts:votes' : 'tid:' + post.tid + ':posts';
			});

			var uniqueSets = _.uniq(sets);
			var method = 'sortedSetsRanks';
			if (uniqueSets.length === 1) {
				method = 'sortedSetRanks';
				sets = uniqueSets[0];
			}

			var pids = posts.map(function (post) {
				return post.pid;
			});

			db[method](sets, pids, next);
		},
		function (indices, next) {
			for (var i = 0; i < indices.length; i += 1) {
				indices[i] = utils.isNumber(indices[i]) ? parseInt(indices[i], 10) + 1 : 0;
			}

			next(null, indices);
		},
	], callback);
};

Posts.updatePostVoteCount = function (postData, callback) {
	if (!postData || !postData.pid || !postData.tid) {
		return callback();
	}
	async.parallel([
		function (next) {
			if (postData.uid) {
				if (postData.votes > 0) {
					db.sortedSetAdd('uid:' + postData.uid + ':posts:votes', postData.votes, postData.pid, next);
				} else {
					db.sortedSetRemove('uid:' + postData.uid + ':posts:votes', postData.pid, next);
				}
			} else {
				next();
			}
		},
		function (next) {
			async.waterfall([
				function (next) {
					topics.getTopicField(postData.tid, 'mainPid', next);
				},
				function (mainPid, next) {
					if (parseInt(mainPid, 10) === parseInt(postData.pid, 10)) {
						return next();
					}
					db.sortedSetAdd('tid:' + postData.tid + ':posts:votes', postData.votes, postData.pid, next);
				},
			], next);
		},
		function (next) {
			db.sortedSetAdd('posts:votes', postData.votes, postData.pid, next);
		},
		function (next) {
			Posts.setPostFields(postData.pid, { upvotes: postData.upvotes, downvotes: postData.downvotes }, next);
		},
	], function (err) {
		callback(err);
	});
};

Posts.modifyPostByPrivilege = function (post, isAdminOrMod) {
	if (post.deleted && !(isAdminOrMod || post.selfPost)) {
		post.content = '[[topic:post_is_deleted]]';
		if (post.user) {
			post.user.signature = '';
		}
	}
};
