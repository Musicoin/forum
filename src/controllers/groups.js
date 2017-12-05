'use strict';

var async = require('async');
var validator = require('validator');

var meta = require('../meta');
var groups = require('../groups');
var user = require('../user');
var helpers = require('./helpers');

var groupsController = {};

groupsController.list = function (req, res, next) {
	var sort = req.query.sort || 'alpha';

	groupsController.getGroupsFromSet(req.uid, sort, 0, 14, function (err, data) {
		if (err) {
			return next(err);
		}
		data.title = '[[pages:groups]]';
		data.breadcrumbs = helpers.buildBreadcrumbs([{ text: '[[pages:groups]]' }]);
		res.render('groups/list', data);
	});
};

groupsController.getGroupsFromSet = function (uid, sort, start, stop, callback) {
	var set = 'groups:visible:name';
	if (sort === 'count') {
		set = 'groups:visible:memberCount';
	} else if (sort === 'date') {
		set = 'groups:visible:createtime';
	}

	async.waterfall([
		function (next) {
			groups.getGroupsFromSet(set, uid, start, stop, next);
		},
		function (groupsData, next) {
			next(null, {
				groups: groupsData,
				allowGroupCreation: parseInt(meta.config.allowGroupCreation, 10) === 1,
				nextStart: stop + 1,
			});
		},
	], callback);
};

groupsController.details = function (req, res, callback) {
	var groupName;
	async.waterfall([
		function (next) {
			groups.getGroupNameByGroupSlug(req.params.slug, next);
		},
		function (_groupName, next) {
			groupName = _groupName;
			if (!groupName) {
				return callback();
			}
			async.parallel({
				exists: async.apply(groups.exists, groupName),
				hidden: async.apply(groups.isHidden, groupName),
			}, next);
		},
		function (results, next) {
			if (!results.exists) {
				return callback();
			}
			if (!results.hidden) {
				return next();
			}
			async.parallel({
				isMember: async.apply(groups.isMember, req.uid, groupName),
				isInvited: async.apply(groups.isInvited, req.uid, groupName),
			}, function (err, checks) {
				if (err || checks.isMember || checks.isInvited) {
					return next(err);
				}
				callback();
			});
		},
		function (next) {
			async.parallel({
				group: function (next) {
					groups.get(groupName, {
						uid: req.uid,
						truncateUserList: true,
						userListCount: 20,
					}, next);
				},
				posts: function (next) {
					groups.getLatestMemberPosts(groupName, 10, req.uid, next);
				},
				isAdmin: function (next) {
					user.isAdministrator(req.uid, next);
				},
				isGlobalMod: function (next) {
					user.isGlobalModerator(req.uid, next);
				},
			}, next);
		},
		function (results) {
			if (!results.group) {
				return callback();
			}
			results.group.isOwner = results.group.isOwner || results.isAdmin || (results.isGlobalMod && !results.group.system);
			results.title = '[[pages:group, ' + results.group.displayName + ']]';
			results.breadcrumbs = helpers.buildBreadcrumbs([{ text: '[[pages:groups]]', url: '/groups' }, { text: results.group.displayName }]);
			results.allowPrivateGroups = parseInt(meta.config.allowPrivateGroups, 10) === 1;

			res.render('groups/details', results);
		},
	], callback);
};

groupsController.members = function (req, res, callback) {
	var groupName;
	async.waterfall([
		function (next) {
			groups.getGroupNameByGroupSlug(req.params.slug, next);
		},
		function (_groupName, next) {
			if (!_groupName) {
				return callback();
			}
			groupName = _groupName;
			async.parallel({
				isAdminOrGlobalMod: async.apply(user.isAdminOrGlobalMod, req.uid),
				isMember: async.apply(groups.isMember, req.uid, groupName),
				isHidden: async.apply(groups.isHidden, groupName),
			}, next);
		},
		function (results, next) {
			if (results.isHidden && !results.isMember && !results.isAdminOrGlobalMod) {
				return callback();
			}

			user.getUsersFromSet('group:' + groupName + ':members', req.uid, 0, 49, next);
		},
		function (users) {
			var breadcrumbs = helpers.buildBreadcrumbs([
				{ text: '[[pages:groups]]', url: '/groups' },
				{ text: validator.escape(String(groupName)), url: '/groups/' + req.params.slug },
				{ text: '[[groups:details.members]]' },
			]);

			res.render('groups/members', {
				users: users,
				nextStart: 50,
				loadmore_display: users.length > 50 ? 'block' : 'hide',
				breadcrumbs: breadcrumbs,
			});
		},
	], callback);
};

groupsController.uploadCover = function (req, res, next) {
	var params = JSON.parse(req.body.params);

	async.waterfall([
		function (next) {
			groups.ownership.isOwner(req.uid, params.groupName, next);
		},
		function (isOwner, next) {
			if (!isOwner) {
				return next(new Error('[[error:no-privileges]]'));
			}

			groups.updateCover(req.uid, {
				file: req.files.files[0].path,
				groupName: params.groupName,
			}, next);
		},
	], function (err, image) {
		if (err) {
			return next(err);
		}
		res.json([{ url: image.url }]);
	});
};

module.exports = groupsController;
