
'use strict';

var async = require('async');

var utils = require('../utils');
var meta = require('../meta');
var db = require('../database');
var groups = require('../groups');
var plugins = require('../plugins');

module.exports = function (User) {
	User.updateProfile = function (uid, data, callback) {
		var fields = ['username', 'email', 'fullname', 'website', 'location',
			'groupTitle', 'birthday', 'signature', 'aboutme'];

		var updateUid = data.uid;
		var oldData;

		if (data.aboutme !== undefined && data.aboutme.length > meta.config.maximumAboutMeLength) {
			return callback(new Error('[[error:about-me-too-long, ' + meta.config.maximumAboutMeLength + ']]'));
		}

		if (data.signature !== undefined && data.signature.length > meta.config.maximumSignatureLength) {
			return callback(new Error('[[error:signature-too-long, ' + meta.config.maximumSignatureLength + ']]'));
		}

		async.waterfall([
			function (next) {
				plugins.fireHook('filter:user.updateProfile', { uid: uid, data: data, fields: fields }, next);
			},
			function (data, next) {
				fields = data.fields;
				data = data.data;

				async.series([
					async.apply(isEmailAvailable, data, updateUid),
					async.apply(isUsernameAvailable, data, updateUid),
					async.apply(isGroupTitleValid, data),
				], function (err) {
					next(err);
				});
			},
			function (next) {
				User.getUserFields(updateUid, fields, next);
			},
			function (_oldData, next) {
				oldData = _oldData;
				async.each(fields, function (field, next) {
					if (!(data[field] !== undefined && typeof data[field] === 'string')) {
						return next();
					}

					data[field] = data[field].trim();

					if (field === 'email') {
						return updateEmail(updateUid, data.email, next);
					} else if (field === 'username') {
						return updateUsername(updateUid, data.username, next);
					} else if (field === 'fullname') {
						return updateFullname(updateUid, data.fullname, next);
					} else if (field === 'signature') {
						data[field] = utils.stripHTMLTags(data[field]);
					}

					User.setUserField(updateUid, field, data[field], next);
				}, next);
			},
			function (next) {
				plugins.fireHook('action:user.updateProfile', { uid: uid, data: data, fields: fields, oldData: oldData });
				User.getUserFields(updateUid, ['email', 'username', 'userslug', 'picture', 'icon:text', 'icon:bgColor'], next);
			},
		], callback);
	};

	function isEmailAvailable(data, uid, callback) {
		if (!data.email) {
			return callback();
		}

		if (!utils.isEmailValid(data.email)) {
			return callback(new Error('[[error:invalid-email]]'));
		}

		async.waterfall([
			function (next) {
				User.getUserField(uid, 'email', next);
			},
			function (email, next) {
				if (email === data.email) {
					return callback();
				}
				User.email.available(data.email, next);
			},
			function (available, next) {
				next(!available ? new Error('[[error:email-taken]]') : null);
			},
		], callback);
	}

	function isUsernameAvailable(data, uid, callback) {
		if (!data.username) {
			return callback();
		}
		data.username = data.username.trim();
		async.waterfall([
			function (next) {
				User.getUserFields(uid, ['username', 'userslug'], next);
			},
			function (userData, next) {
				var userslug = utils.slugify(data.username);

				if (data.username.length < meta.config.minimumUsernameLength) {
					return next(new Error('[[error:username-too-short]]'));
				}

				if (data.username.length > meta.config.maximumUsernameLength) {
					return next(new Error('[[error:username-too-long]]'));
				}

				if (!utils.isUserNameValid(data.username) || !userslug) {
					return next(new Error('[[error:invalid-username]]'));
				}

				if (userslug === userData.userslug) {
					return callback();
				}
				User.existsBySlug(userslug, next);
			},
			function (exists, next) {
				next(exists ? new Error('[[error:username-taken]]') : null);
			},
		], callback);
	}

	function isGroupTitleValid(data, callback) {
		if (data.groupTitle === 'registered-users' || groups.isPrivilegeGroup(data.groupTitle)) {
			callback(new Error('[[error:invalid-group-title]]'));
		} else {
			callback();
		}
	}

	function updateEmail(uid, newEmail, callback) {
		async.waterfall([
			function (next) {
				User.getUserField(uid, 'email', next);
			},
			function (oldEmail, next) {
				oldEmail = oldEmail || '';

				if (oldEmail === newEmail) {
					return callback();
				}
				async.series([
					async.apply(db.sortedSetRemove, 'email:uid', oldEmail.toLowerCase()),
					async.apply(db.sortedSetRemove, 'email:sorted', oldEmail.toLowerCase() + ':' + uid),
				], function (err) {
					next(err);
				});
			},
			function (next) {
				async.parallel([
					function (next) {
						db.sortedSetAdd('email:uid', uid, newEmail.toLowerCase(), next);
					},
					function (next) {
						db.sortedSetAdd('email:sorted', 0, newEmail.toLowerCase() + ':' + uid, next);
					},
					function (next) {
						db.sortedSetAdd('user:' + uid + ':emails', Date.now(), newEmail + ':' + Date.now(), next);
					},
					function (next) {
						User.setUserField(uid, 'email', newEmail, next);
					},
					function (next) {
						if (parseInt(meta.config.requireEmailConfirmation, 10) === 1 && newEmail) {
							User.email.sendValidationEmail(uid, {
								email: newEmail,
							});
						}
						User.setUserField(uid, 'email:confirmed', 0, next);
					},
					function (next) {
						db.sortedSetAdd('users:notvalidated', Date.now(), uid, next);
					},
					function (next) {
						User.reset.cleanByUid(uid, next);
					},
				], function (err) {
					next(err);
				});
			},
		], callback);
	}

	function updateUsername(uid, newUsername, callback) {
		if (!newUsername) {
			return setImmediate(callback);
		}

		async.waterfall([
			function (next) {
				User.getUserFields(uid, ['username', 'userslug'], next);
			},
			function (userData, next) {
				if (userData.username === newUsername) {
					return callback();
				}
				async.parallel([
					function (next) {
						updateUidMapping('username', uid, newUsername, userData.username, next);
					},
					function (next) {
						var newUserslug = utils.slugify(newUsername);
						updateUidMapping('userslug', uid, newUserslug, userData.userslug, next);
					},
					function (next) {
						var now = Date.now();
						async.series([
							async.apply(db.sortedSetRemove, 'username:sorted', userData.username.toLowerCase() + ':' + uid),
							async.apply(db.sortedSetAdd, 'username:sorted', 0, newUsername.toLowerCase() + ':' + uid),
							async.apply(db.sortedSetAdd, 'user:' + uid + ':usernames', now, newUsername + ':' + now),
						], next);
					},
				], next);
			},
		], function (err) {
			callback(err);
		});
	}

	function updateUidMapping(field, uid, value, oldValue, callback) {
		if (value === oldValue) {
			return callback();
		}

		async.series([
			function (next) {
				db.sortedSetRemove(field + ':uid', oldValue, next);
			},
			function (next) {
				User.setUserField(uid, field, value, next);
			},
			function (next) {
				if (value) {
					db.sortedSetAdd(field + ':uid', uid, value, next);
				} else {
					next();
				}
			},
		], callback);
	}

	function updateFullname(uid, newFullname, callback) {
		async.waterfall([
			function (next) {
				User.getUserField(uid, 'fullname', next);
			},
			function (fullname, next) {
				updateUidMapping('fullname', uid, newFullname, fullname, next);
			},
		], callback);
	}

	User.changePassword = function (uid, data, callback) {
		if (!uid || !data || !data.uid) {
			return callback(new Error('[[error:invalid-uid]]'));
		}

		async.waterfall([
			function (next) {
				User.isPasswordValid(data.newPassword, next);
			},
			function (next) {
				if (parseInt(uid, 10) !== parseInt(data.uid, 10)) {
					User.isAdministrator(uid, next);
				} else {
					User.isPasswordCorrect(uid, data.currentPassword, next);
				}
			},
			function (isAdminOrPasswordMatch, next) {
				if (!isAdminOrPasswordMatch) {
					return next(new Error('[[error:change_password_error_wrong_current]]'));
				}

				User.hashPassword(data.newPassword, next);
			},
			function (hashedPassword, next) {
				async.parallel([
					async.apply(User.setUserFields, data.uid, {
						password: hashedPassword,
						rss_token: utils.generateUUID(),
					}),
					async.apply(User.reset.updateExpiry, data.uid),
					async.apply(User.auth.revokeAllSessions, data.uid),
				], function (err) {
					next(err);
				});
			},
		], callback);
	};
};
