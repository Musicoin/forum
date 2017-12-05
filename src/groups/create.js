'use strict';

var async = require('async');
var meta = require('../meta');
var plugins = require('../plugins');
var utils = require('../utils');
var db = require('../database');

module.exports = function (Groups) {
	Groups.create = function (data, callback) {
		var system = isSystemGroup(data);
		var groupData;
		var timestamp = data.timestamp || Date.now();
		var disableJoinRequests = parseInt(data.disableJoinRequests, 10) === 1 ? 1 : 0;
		if (data.name === 'administrators') {
			disableJoinRequests = 1;
		}
		async.waterfall([
			function (next) {
				validateGroupName(data.name, next);
			},
			function (next) {
				meta.userOrGroupExists(data.name, next);
			},
			function (exists, next) {
				if (exists) {
					return next(new Error('[[error:group-already-exists]]'));
				}

				var memberCount = data.hasOwnProperty('ownerUid') ? 1 : 0;
				var isPrivate = data.hasOwnProperty('private') ? parseInt(data.private, 10) : 1;
				var slug = utils.slugify(data.name);
				groupData = {
					name: data.name,
					slug: slug,
					createtime: timestamp,
					userTitle: data.userTitle || data.name,
					description: data.description || '',
					memberCount: memberCount,
					deleted: 0,
					hidden: parseInt(data.hidden, 10) === 1 ? 1 : 0,
					system: system ? 1 : 0,
					private: isPrivate,
					disableJoinRequests: disableJoinRequests,
				};
				plugins.fireHook('filter:group.create', { group: groupData, data: data }, next);
			},
			function (results, next) {
				var tasks = [
					async.apply(db.sortedSetAdd, 'groups:createtime', groupData.createtime, groupData.name),
					async.apply(db.setObject, 'group:' + groupData.name, groupData),
				];

				if (data.hasOwnProperty('ownerUid')) {
					tasks.push(async.apply(db.setAdd, 'group:' + groupData.name + ':owners', data.ownerUid));
					tasks.push(async.apply(db.sortedSetAdd, 'group:' + groupData.name + ':members', timestamp, data.ownerUid));

					groupData.ownerUid = data.ownerUid;
				}

				if (!data.hidden && !system) {
					tasks.push(async.apply(db.sortedSetAdd, 'groups:visible:createtime', timestamp, groupData.name));
					tasks.push(async.apply(db.sortedSetAdd, 'groups:visible:memberCount', groupData.memberCount, groupData.name));
					tasks.push(async.apply(db.sortedSetAdd, 'groups:visible:name', 0, groupData.name.toLowerCase() + ':' + groupData.name));
				}

				tasks.push(async.apply(db.setObjectField, 'groupslug:groupname', groupData.slug, groupData.name));

				async.series(tasks, next);
			},
			function (results, next) {
				plugins.fireHook('action:group.create', { group: groupData });
				next(null, groupData);
			},
		], callback);
	};

	function isSystemGroup(data) {
		return data.system === true || parseInt(data.system, 10) === 1 ||
			data.name === 'administrators' || data.name === 'registered-users' || data.name === 'Global Moderators' ||
			Groups.isPrivilegeGroup(data.name);
	}

	function validateGroupName(name, callback) {
		if (!name) {
			return callback(new Error('[[error:group-name-too-short]]'));
		}

		if (!Groups.isPrivilegeGroup(name) && name.length > (parseInt(meta.config.maximumGroupNameLength, 10) || 255)) {
			return callback(new Error('[[error:group-name-too-long]]'));
		}

		if (!Groups.isPrivilegeGroup(name) && name.indexOf(':') !== -1) {
			return callback(new Error('[[error:invalid-group-name]]'));
		}

		if (name.indexOf('/') !== -1 || !utils.slugify(name)) {
			return callback(new Error('[[error:invalid-group-name]]'));
		}

		callback();
	}
};
