'use strict';

var async = require('async');

var db = require('../../database');
var groups = require('../../groups');
var categories = require('../../categories');
var privileges = require('../../privileges');
var plugins = require('../../plugins');
var events = require('../../events');

var Categories = module.exports;

Categories.create = function (socket, data, callback) {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	categories.create(data, callback);
};

Categories.getAll = function (socket, data, callback) {
	async.waterfall([
		async.apply(db.getSortedSetRange, 'categories:cid', 0, -1),
		async.apply(categories.getCategoriesData),
		function (categories, next) {
			// Hook changes, there is no req, and res
			plugins.fireHook('filter:admin.categories.get', { categories: categories }, next);
		},
		function (result, next) {
			next(null, categories.getTree(result.categories, 0));
		},
	], callback);
};

Categories.getNames = function (socket, data, callback) {
	categories.getAllCategoryFields(['cid', 'name'], callback);
};

Categories.purge = function (socket, cid, callback) {
	var name;
	async.waterfall([
		function (next) {
			categories.getCategoryField(cid, 'name', next);
		},
		function (_name, next) {
			name = _name;
			categories.purge(cid, socket.uid, next);
		},
		function (next) {
			events.log({
				type: 'category-purge',
				uid: socket.uid,
				ip: socket.ip,
				cid: cid,
				name: name,
			});
			setImmediate(next);
		},
	], callback);
};

Categories.update = function (socket, data, callback) {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	categories.update(data, callback);
};

Categories.setPrivilege = function (socket, data, callback) {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	if (Array.isArray(data.privilege)) {
		async.each(data.privilege, function (privilege, next) {
			groups[data.set ? 'join' : 'leave']('cid:' + data.cid + ':privileges:' + privilege, data.member, next);
		}, callback);
	} else {
		groups[data.set ? 'join' : 'leave']('cid:' + data.cid + ':privileges:' + data.privilege, data.member, callback);
	}
};

Categories.getPrivilegeSettings = function (socket, cid, callback) {
	privileges.categories.list(cid, callback);
};

Categories.copyPrivilegesToChildren = function (socket, cid, callback) {
	async.waterfall([
		function (next) {
			categories.getCategories([cid], socket.uid, next);
		},
		function (categories, next) {
			var category = categories[0];

			async.eachSeries(category.children, function (child, next) {
				copyPrivilegesToChildrenRecursive(cid, child, next);
			}, next);
		},
	], callback);
};

function copyPrivilegesToChildrenRecursive(parentCid, category, callback) {
	async.waterfall([
		function (next) {
			categories.copyPrivilegesFrom(parentCid, category.cid, next);
		},
		function (next) {
			async.eachSeries(category.children, function (child, next) {
				copyPrivilegesToChildrenRecursive(parentCid, child, next);
			}, next);
		},
	], callback);
}

Categories.copySettingsFrom = function (socket, data, callback) {
	categories.copySettingsFrom(data.fromCid, data.toCid, true, callback);
};

Categories.copyPrivilegesFrom = function (socket, data, callback) {
	categories.copyPrivilegesFrom(data.fromCid, data.toCid, callback);
};
