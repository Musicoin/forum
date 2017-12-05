'use strict';

var async = require('async');

var user = require('../../user');
var meta = require('../../meta');
var events = require('../../events');
var privileges = require('../../privileges');

module.exports = function (SocketUser) {
	SocketUser.changeUsernameEmail = function (socket, data, callback) {
		if (!data || !data.uid || !socket.uid) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		async.waterfall([
			function (next) {
				isAdminOrSelfAndPasswordMatch(socket.uid, data, next);
			},
			function (next) {
				SocketUser.updateProfile(socket, data, next);
			},
		], callback);
	};

	SocketUser.updateCover = function (socket, data, callback) {
		if (!socket.uid) {
			return callback(new Error('[[error:no-privileges]]'));
		}
		async.waterfall([
			function (next) {
				user.isAdminOrSelf(socket.uid, data.uid, next);
			},
			function (next) {
				user.updateCoverPicture(data, next);
			},
		], callback);
	};

	SocketUser.uploadCroppedPicture = function (socket, data, callback) {
		if (!socket.uid) {
			return callback(new Error('[[error:no-privileges]]'));
		}
		async.waterfall([
			function (next) {
				user.isAdminOrSelf(socket.uid, data.uid, next);
			},
			function (next) {
				user.uploadCroppedPicture(data, next);
			},
		], callback);
	};

	SocketUser.removeCover = function (socket, data, callback) {
		if (!socket.uid) {
			return callback(new Error('[[error:no-privileges]]'));
		}

		async.waterfall([
			function (next) {
				user.isAdminOrSelf(socket.uid, data.uid, next);
			},
			function (next) {
				user.removeCoverPicture(data, next);
			},
		], callback);
	};

	function isAdminOrSelfAndPasswordMatch(uid, data, callback) {
		async.waterfall([
			function (next) {
				async.parallel({
					isAdmin: async.apply(user.isAdministrator, uid),
					hasPassword: async.apply(user.hasPassword, data.uid),
					passwordMatch: function (next) {
						if (data.password) {
							user.isPasswordCorrect(data.uid, data.password, next);
						} else {
							next(null, false);
						}
					},
				}, next);
			},
			function (results, next) {
				var isSelf = parseInt(uid, 10) === parseInt(data.uid, 10);

				if (!results.isAdmin && !isSelf) {
					return next(new Error('[[error:no-privileges]]'));
				}

				if (isSelf && results.hasPassword && !results.passwordMatch) {
					return next(new Error('[[error:invalid-password]]'));
				}

				next();
			},
		], callback);
	}

	SocketUser.changePassword = function (socket, data, callback) {
		if (!socket.uid) {
			return callback(new Error('[[error:invalid-uid]]'));
		}

		if (!data || !data.uid) {
			return callback(new Error('[[error:invalid-data]]'));
		}
		async.waterfall([
			function (next) {
				user.changePassword(socket.uid, data, next);
			},
			function (next) {
				events.log({
					type: 'password-change',
					uid: socket.uid,
					targetUid: data.uid,
					ip: socket.ip,
				});
				next();
			},
		], callback);
	};

	SocketUser.updateProfile = function (socket, data, callback) {
		if (!socket.uid) {
			return callback(new Error('[[error:invalid-uid]]'));
		}

		if (!data || !data.uid) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		var oldUserData;
		async.waterfall([
			function (next) {
				user.getUserFields(data.uid, ['email', 'username'], next);
			},
			function (_oldUserData, next) {
				oldUserData = _oldUserData;
				if (!oldUserData || !oldUserData.username) {
					return next(new Error('[[error:invalid-data]]'));
				}

				async.parallel({
					isAdminOrGlobalMod: function (next) {
						user.isAdminOrGlobalMod(socket.uid, next);
					},
					canEdit: function (next) {
						privileges.users.canEdit(socket.uid, data.uid, next);
					},
				}, next);
			},
			function (results, next) {
				if (!results.canEdit) {
					return next(new Error('[[error:no-privileges]]'));
				}

				if (!results.isAdminOrGlobalMod && parseInt(meta.config['username:disableEdit'], 10) === 1) {
					data.username = oldUserData.username;
				}

				if (!results.isAdminOrGlobalMod && parseInt(meta.config['email:disableEdit'], 10) === 1) {
					data.email = oldUserData.email;
				}

				user.updateProfile(socket.uid, data, next);
			},
			function (userData, next) {
				function log(type, eventData) {
					eventData.type = type;
					eventData.uid = socket.uid;
					eventData.targetUid = data.uid;
					eventData.ip = socket.ip;

					events.log(eventData);
				}

				if (userData.email !== oldUserData.email) {
					log('email-change', { oldEmail: oldUserData.email, newEmail: userData.email });
				}

				if (userData.username !== oldUserData.username) {
					log('username-change', { oldUsername: oldUserData.username, newUsername: userData.username });
				}

				next(null, userData);
			},
		], callback);
	};
};
