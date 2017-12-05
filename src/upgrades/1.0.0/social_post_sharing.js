'use strict';

var db = require('../../database');

var async = require('async');

module.exports = {
	name: 'Social: Post Sharing',
	timestamp: Date.UTC(2016, 1, 25),
	method: function (callback) {
		var social = require('../../social');
		async.parallel([
			function (next) {
				social.setActivePostSharingNetworks(['facebook', 'google', 'twitter'], next);
			},
			function (next) {
				db.deleteObjectField('config', 'disableSocialButtons', next);
			},
		], callback);
	},
};
