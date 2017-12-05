'use strict';

var async = require('async');

var db = require('../database');

module.exports = function (Categories) {
	Categories.markAsRead = function (cids, uid, callback) {
		callback = callback || function () {};
		if (!Array.isArray(cids) || !cids.length) {
			return callback();
		}
		var keys = cids.map(function (cid) {
			return 'cid:' + cid + ':read_by_uid';
		});

		async.waterfall([
			function (next) {
				db.isMemberOfSets(keys, uid, next);
			},
			function (hasRead, next) {
				keys = keys.filter(function (key, index) {
					return !hasRead[index];
				});

				if (!keys.length) {
					return callback();
				}

				db.setsAdd(keys, uid, next);
			},
		], callback);
	};

	Categories.markAsUnreadForAll = function (cid, callback) {
		if (!parseInt(cid, 10)) {
			return callback();
		}
		callback = callback || function () {};
		db.delete('cid:' + cid + ':read_by_uid', callback);
	};

	Categories.hasReadCategories = function (cids, uid, callback) {
		var sets = cids.map(function (cid) {
			return 'cid:' + cid + ':read_by_uid';
		});

		db.isMemberOfSets(sets, uid, callback);
	};

	Categories.hasReadCategory = function (cid, uid, callback) {
		db.isSetMember('cid:' + cid + ':read_by_uid', uid, callback);
	};
};
