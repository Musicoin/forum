'use strict';

var async = require('async');

var db = require('../../database');
var user = require('../../user');
var meta = require('../../meta');
var plugins = require('../../plugins');
var helpers = require('../helpers');
var groups = require('../../groups');
var accountHelpers = require('./helpers');
var privileges = require('../../privileges');
var file = require('../../file');

var editController = module.exports;

editController.get = function (req, res, callback) {
	async.waterfall([
		function (next) {
			accountHelpers.getUserDataByUserSlug(req.params.userslug, req.uid, next);
		},
		function (userData, next) {
			if (!userData) {
				return callback();
			}
			userData.maximumSignatureLength = parseInt(meta.config.maximumSignatureLength, 10) || 255;
			userData.maximumAboutMeLength = parseInt(meta.config.maximumAboutMeLength, 10) || 1000;
			userData.maximumProfileImageSize = parseInt(meta.config.maximumProfileImageSize, 10);
			userData.allowProfileImageUploads = parseInt(meta.config.allowProfileImageUploads, 10) === 1;
			userData.allowAccountDelete = parseInt(meta.config.allowAccountDelete, 10) === 1;
			userData.profileImageDimension = parseInt(meta.config.profileImageDimension, 10) || 200;
			userData.defaultAvatar = user.getDefaultAvatar();

			userData.groups = userData.groups.filter(function (group) {
				return group && group.userTitleEnabled && !groups.isPrivilegeGroup(group.name) && group.name !== 'registered-users';
			});
			userData.groups.forEach(function (group) {
				group.selected = group.name === userData.groupTitle;
			});

			userData.title = '[[pages:account/edit, ' + userData.username + ']]';
			userData.breadcrumbs = helpers.buildBreadcrumbs([
				{
					text: userData.username,
					url: '/user/' + userData.userslug,
				},
				{
					text: '[[user:edit]]',
				},
			]);
			userData.editButtons = [];

			plugins.fireHook('filter:user.account.edit', userData, next);
		},
		function (userData) {
			res.render('account/edit', userData);
		},
	], callback);
};

editController.password = function (req, res, next) {
	renderRoute('password', req, res, next);
};

editController.username = function (req, res, next) {
	renderRoute('username', req, res, next);
};

editController.email = function (req, res, next) {
	renderRoute('email', req, res, next);
};

function renderRoute(name, req, res, next) {
	async.waterfall([
		function (next) {
			getUserData(req, next, next);
		},
		function (userData) {
			if (!userData) {
				return next();
			}

			if ((name === 'username' && userData['username:disableEdit']) || (name === 'email' && userData['email:disableEdit'])) {
				return next();
			}

			if (name === 'password') {
				userData.minimumPasswordLength = parseInt(meta.config.minimumPasswordLength, 10);
				userData.minimumPasswordStrength = parseInt(meta.config.minimumPasswordStrength || 0, 10);
			}

			userData.title = '[[pages:account/edit/' + name + ', ' + userData.username + ']]';
			userData.breadcrumbs = helpers.buildBreadcrumbs([
				{
					text: userData.username,
					url: '/user/' + userData.userslug,
				},
				{
					text: '[[user:edit]]',
					url: '/user/' + userData.userslug + '/edit',
				},
				{
					text: '[[user:' + name + ']]',
				},
			]);

			res.render('account/edit/' + name, userData);
		},
	], next);
}

function getUserData(req, next, callback) {
	var userData;
	async.waterfall([
		function (next) {
			accountHelpers.getUserDataByUserSlug(req.params.userslug, req.uid, next);
		},
		function (data, next) {
			userData = data;
			if (!userData) {
				return callback(null, null);
			}
			db.getObjectField('user:' + userData.uid, 'password', next);
		},
		function (password, next) {
			userData.hasPassword = !!password;
			next(null, userData);
		},
	], callback);
}

editController.uploadPicture = function (req, res, next) {
	var userPhoto = req.files.files[0];

	var updateUid;

	async.waterfall([
		function (next) {
			user.getUidByUserslug(req.params.userslug, next);
		},
		function (uid, next) {
			updateUid = uid;

			privileges.users.canEdit(req.uid, uid, next);
		},
		function (isAllowed, next) {
			if (!isAllowed) {
				return helpers.notAllowed(req, res);
			}

			user.uploadPicture(updateUid, userPhoto, next);
		},
	], function (err, image) {
		file.delete(userPhoto.path);
		if (err) {
			return next(err);
		}

		res.json([{
			name: userPhoto.name,
			url: image.url,
		}]);
	});
};

editController.uploadCoverPicture = function (req, res, next) {
	var params = JSON.parse(req.body.params);
	var coverPhoto = req.files.files[0];

	user.updateCoverPicture({
		file: coverPhoto,
		uid: params.uid,
	}, function (err, image) {
		file.delete(coverPhoto.path);
		if (err) {
			return next(err);
		}

		res.json([{
			url: image.url,
		}]);
	});
};
