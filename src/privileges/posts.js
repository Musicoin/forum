
'use strict';

var async = require('async');
var _ = require('lodash');

var meta = require('../meta');
var posts = require('../posts');
var topics = require('../topics');
var user = require('../user');
var helpers = require('./helpers');
var plugins = require('../plugins');
var utils = require('../utils');

module.exports = function (privileges) {
	privileges.posts = {};

	privileges.posts.get = function (pids, uid, callback) {
		if (!Array.isArray(pids) || !pids.length) {
			return callback(null, []);
		}

		async.waterfall([
			function (next) {
				posts.getCidsByPids(pids, next);
			},
			function (cids, next) {
				async.parallel({
					isAdmin: async.apply(user.isAdministrator, uid),
					isModerator: async.apply(user.isModerator, uid, cids),
					isOwner: async.apply(posts.isOwner, pids, uid),
					'topics:read': async.apply(helpers.isUserAllowedTo, 'topics:read', uid, cids),
					read: async.apply(helpers.isUserAllowedTo, 'read', uid, cids),
					'posts:edit': async.apply(helpers.isUserAllowedTo, 'posts:edit', uid, cids),
				}, next);
			},
			function (results, next) {
				var privileges = pids.map(function (pid, i) {
					var isAdminOrMod = results.isAdmin || results.isModerator[i];
					var editable = isAdminOrMod || (results.isOwner[i] && results['posts:edit'][i]);

					return {
						editable: editable,
						view_deleted: editable,
						move: isAdminOrMod,
						isAdminOrMod: isAdminOrMod,
						'topics:read': results['topics:read'][i] || isAdminOrMod,
						read: results.read[i] || isAdminOrMod,
					};
				});

				next(null, privileges);
			},
		], callback);
	};

	privileges.posts.can = function (privilege, pid, uid, callback) {
		async.waterfall([
			function (next) {
				posts.getCidByPid(pid, next);
			},
			function (cid, next) {
				privileges.categories.can(privilege, cid, uid, next);
			},
		], callback);
	};

	privileges.posts.filter = function (privilege, pids, uid, callback) {
		if (!Array.isArray(pids) || !pids.length) {
			return callback(null, []);
		}
		var cids;
		var postData;
		var tids;
		var tidToTopic = {};

		pids = _.uniq(pids);

		async.waterfall([
			function (next) {
				posts.getPostsFields(pids, ['uid', 'tid', 'deleted'], next);
			},
			function (_posts, next) {
				postData = _posts;
				tids = _.uniq(_posts.map(function (post) {
					return post && post.tid;
				}).filter(Boolean));

				topics.getTopicsFields(tids, ['deleted', 'cid'], next);
			},
			function (topicData, next) {
				topicData.forEach(function (topic, index) {
					if (topic) {
						tidToTopic[tids[index]] = topic;
					}
				});

				cids = postData.map(function (post, index) {
					if (post) {
						post.pid = pids[index];
						post.topic = tidToTopic[post.tid];
					}
					return tidToTopic[post.tid] && tidToTopic[post.tid].cid;
				}).filter(function (cid, index, array) {
					return cid && array.indexOf(cid) === index;
				});

				privileges.categories.getBase(privilege, cids, uid, next);
			},
			function (results, next) {
				var isModOf = {};
				cids = cids.filter(function (cid, index) {
					isModOf[cid] = results.isModerators[index];
					return !results.categories[index].disabled &&
						(results.allowedTo[index] || results.isAdmin || results.isModerators[index]);
				});


				pids = postData.filter(function (post) {
					return post.topic && cids.indexOf(post.topic.cid) !== -1 &&
						((parseInt(post.topic.deleted, 10) !== 1 && parseInt(post.deleted, 10) !== 1) || results.isAdmin || isModOf[post.cid]);
				}).map(function (post) {
					return post.pid;
				});

				plugins.fireHook('filter:privileges.posts.filter', {
					privilege: privilege,
					uid: uid,
					pids: pids,
				}, function (err, data) {
					next(err, data ? data.pids : null);
				});
			},
		], callback);
	};

	privileges.posts.canEdit = function (pid, uid, callback) {
		async.waterfall([
			function (next) {
				async.parallel({
					isEditable: async.apply(isPostEditable, pid, uid),
					isAdminOrMod: async.apply(isAdminOrMod, pid, uid),
				}, next);
			},
			function (results, next) {
				if (results.isAdminOrMod) {
					return next(null, { flag: true });
				}

				next(null, results.isEditable);
			},
		], callback);
	};

	privileges.posts.canDelete = function (pid, uid, callback) {
		var postData;
		async.waterfall([
			function (next) {
				posts.getPostFields(pid, ['uid', 'tid', 'timestamp', 'deleterUid'], next);
			},
			function (_postData, next) {
				postData = _postData;
				async.parallel({
					isAdminOrMod: async.apply(isAdminOrMod, pid, uid),
					isLocked: async.apply(topics.isLocked, postData.tid),
					isOwner: async.apply(posts.isOwner, pid, uid),
					'posts:delete': async.apply(privileges.posts.can, 'posts:delete', pid, uid),
				}, next);
			},
			function (results, next) {
				if (results.isAdminOrMod) {
					return next(null, { flag: true });
				}

				if (results.isLocked) {
					return next(null, { flag: false, message: '[[error:topic-locked]]' });
				}

				if (!results['posts:delete']) {
					return next(null, { flag: false, message: '[[error:no-privileges]]' });
				}

				var postDeleteDuration = parseInt(meta.config.postDeleteDuration, 10);
				if (postDeleteDuration && (Date.now() - parseInt(postData.timestamp, 10) > postDeleteDuration * 1000)) {
					return next(null, { flag: false, message: '[[error:post-delete-duration-expired, ' + meta.config.postDeleteDuration + ']]' });
				}
				var deleterUid = parseInt(postData.deleterUid, 10) || 0;
				var flag = results.isOwner && (deleterUid === 0 || deleterUid === parseInt(postData.uid, 10));
				next(null, { flag: flag, message: '[[error:no-privileges]]' });
			},
		], callback);
	};

	privileges.posts.canFlag = function (pid, uid, callback) {
		async.waterfall([
			function (next) {
				async.parallel({
					userReputation: async.apply(user.getUserField, uid, 'reputation'),
					isAdminOrMod: async.apply(isAdminOrMod, pid, uid),
				}, next);
			},
			function (results, next) {
				var minimumReputation = utils.isNumber(meta.config['privileges:flag']) ? parseInt(meta.config['privileges:flag'], 10) : 0;
				var canFlag = results.isAdminOrMod || parseInt(results.userReputation, 10) >= minimumReputation;
				next(null, { flag: canFlag });
			},
		], callback);
	};

	privileges.posts.canMove = function (pid, uid, callback) {
		async.waterfall([
			function (next) {
				posts.isMain(pid, next);
			},
			function (isMain, next) {
				if (isMain) {
					return next(new Error('[[error:cant-move-mainpost]]'));
				}
				isAdminOrMod(pid, uid, next);
			},
		], callback);
	};

	privileges.posts.canPurge = function (pid, uid, callback) {
		async.waterfall([
			function (next) {
				posts.getCidByPid(pid, next);
			},
			function (cid, next) {
				async.parallel({
					purge: async.apply(privileges.categories.isUserAllowedTo, 'purge', cid, uid),
					owner: async.apply(posts.isOwner, pid, uid),
					isAdminOrMod: async.apply(privileges.categories.isAdminOrMod, cid, uid),
				}, next);
			},
			function (results, next) {
				next(null, results.isAdminOrMod || (results.purge && results.owner));
			},
		], callback);
	};

	function isPostEditable(pid, uid, callback) {
		async.waterfall([
			function (next) {
				posts.getPostFields(pid, ['tid', 'timestamp'], next);
			},
			function (postData, next) {
				var postEditDuration = parseInt(meta.config.postEditDuration, 10);
				if (postEditDuration && Date.now() - parseInt(postData.timestamp, 10) > postEditDuration * 1000) {
					return callback(null, { flag: false, message: '[[error:post-edit-duration-expired, ' + meta.config.postEditDuration + ']]' });
				}
				topics.isLocked(postData.tid, next);
			},
			function (isLocked, next) {
				if (isLocked) {
					return callback(null, { flag: false, message: '[[error:topic-locked]]' });
				}

				async.parallel({
					owner: async.apply(posts.isOwner, pid, uid),
					edit: async.apply(privileges.posts.can, 'posts:edit', pid, uid),
				}, next);
			},
			function (result, next) {
				next(null, { flag: result.owner && result.edit, message: '[[error:no-privileges]]' });
			},
		], callback);
	}

	function isAdminOrMod(pid, uid, callback) {
		helpers.some([
			function (next) {
				async.waterfall([
					function (next) {
						posts.getCidByPid(pid, next);
					},
					function (cid, next) {
						user.isModerator(uid, cid, next);
					},
				], next);
			},
			function (next) {
				user.isAdministrator(uid, next);
			},
		], callback);
	}
};
