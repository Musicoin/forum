'use strict';

var async = require('async');

var db = require('../database');

module.exports = function (User) {
	User.ban = function (uid, until, reason, callback) {
		// "until" (optional) is unix timestamp in milliseconds
		// "reason" (optional) is a string
		if (!callback && typeof until === 'function') {
			callback = until;
			until = 0;
			reason = '';
		} else if (!callback && typeof reason === 'function') {
			callback = reason;
			reason = '';
		}

		var now = Date.now();

		until = parseInt(until, 10);
		if (isNaN(until)) {
			return callback(new Error('[[error:ban-expiry-missing]]'));
		}

		var tasks = [
			async.apply(User.setUserField, uid, 'banned', 1),
			async.apply(db.sortedSetAdd, 'users:banned', now, uid),
			async.apply(db.sortedSetAdd, 'uid:' + uid + ':bans', now, until),
		];

		if (until > 0 && now < until) {
			tasks.push(async.apply(db.sortedSetAdd, 'users:banned:expire', until, uid));
			tasks.push(async.apply(User.setUserField, uid, 'banned:expire', until));
		} else {
			until = 0;
		}

		if (reason) {
			tasks.push(async.apply(db.sortedSetAdd, 'banned:' + uid + ':reasons', now, reason));
		}

		async.series(tasks, function (err) {
			callback(err);
		});
	};

	User.unban = function (uid, callback) {
		async.waterfall([
			function (next) {
				User.setUserFields(uid, { banned: 0, 'banned:expire': 0 }, next);
			},
			function (next) {
				db.sortedSetsRemove(['users:banned', 'users:banned:expire'], uid, next);
			},
		], callback);
	};

	User.isBanned = function (uid, callback) {
		async.waterfall([
			async.apply(User.getUserFields, uid, ['banned', 'banned:expire']),
			function (userData, next) {
				var banned = userData && parseInt(userData.banned, 10) === 1;
				if (!banned) {
					return next(null, banned);
				}

				// If they are banned, see if the ban has expired
				var stillBanned = !parseInt(userData['banned:expire'], 10) || Date.now() < parseInt(userData['banned:expire'], 10);

				if (stillBanned) {
					return next(null, true);
				}
				async.parallel([
					async.apply(db.sortedSetRemove.bind(db), 'users:banned:expire', uid),
					async.apply(db.sortedSetRemove.bind(db), 'users:banned', uid),
					async.apply(User.setUserFields, uid, { banned: 0, 'banned:expire': 0 }),
				], function (err) {
					next(err, false);
				});
			},
		], callback);
	};

	User.getBannedReason = function (uid, callback) {
		async.waterfall([
			function (next) {
				db.getSortedSetRevRange('banned:' + uid + ':reasons', 0, 0, next);
			},
			function (reasons, next) {
				next(null, reasons.length ? reasons[0] : '');
			},
		], callback);
	};
};
