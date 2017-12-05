'use strict';

/**
 * Database Mock - wrapper for database.js, makes system use separate test db, instead of production
 * ATTENTION: testing db is flushed before every use!
 */

var async = require('async');
var winston = require('winston');
var path = require('path');
var nconf = require('nconf');
var url = require('url');
var errorText;


nconf.file({ file: path.join(__dirname, '../../config.json') });
nconf.defaults({
	base_dir: path.join(__dirname, '../..'),
	themes_path: path.join(__dirname, '../../node_modules'),
	upload_path: 'public/uploads',
	views_dir: path.join(__dirname, '../../build/public/templates'),
	relative_path: '',
});

if (!nconf.get('isCluster')) {
	nconf.set('isPrimary', 'true');
	nconf.set('isCluster', 'false');
}

var dbType = nconf.get('database');
var testDbConfig = nconf.get('test_database');
var productionDbConfig = nconf.get(dbType);

if (!testDbConfig) {
	errorText = 'test_database is not defined';
	winston.info(
		'\n===========================================================\n' +
		'Please, add parameters for test database in config.json\n' +
		'For example (redis):\n' +
		'"test_database": {\n' +
		'    "host": "127.0.0.1",\n' +
		'    "port": "6379",\n' +
		'    "password": "",\n' +
		'    "database": "1"\n' +
		'}\n' +
		' or (mongo):\n' +
		'"test_database": {\n' +
		'    "host": "127.0.0.1",\n' +
		'    "port": "27017",\n' +
		'    "password": "",\n' +
		'    "database": "1"\n' +
		'}\n' +
		' or (mongo) in a replicaset\n' +
		'"test_database": {\n' +
		'    "host": "127.0.0.1,127.0.0.1,127.0.0.1",\n' +
		'    "port": "27017,27018,27019",\n' +
		'    "username": "",\n' +
		'    "password": "",\n' +
		'    "database": "nodebb_test"\n' +
		'}\n' +
		'==========================================================='
	);
	winston.error(errorText);
	throw new Error(errorText);
}

if (testDbConfig.database === productionDbConfig.database &&
	testDbConfig.host === productionDbConfig.host &&
	testDbConfig.port === productionDbConfig.port) {
	errorText = 'test_database has the same config as production db';
	winston.error(errorText);
	throw new Error(errorText);
}

nconf.set(dbType, testDbConfig);

winston.info('database config');
winston.info(dbType);
winston.info(testDbConfig);

var db = require('../../src/database');
module.exports = db;

before(function (done) {
	this.timeout(30000);
	async.series([
		function (next) {
			db.init(next);
		},
		function (next) {
			db.createIndices(next);
		},
		function (next) {
			setupMockDefaults(next);
		},
		function (next) {
			db.initSessionStore(next);
		},
		function (next) {
			var meta = require('../../src/meta');

			// nconf defaults, if not set in config
			if (!nconf.get('sessionKey')) {
				nconf.set('sessionKey', 'express.sid');
			}
			// Parse out the relative_url and other goodies from the configured URL
			var urlObject = url.parse(nconf.get('url'));
			var relativePath = urlObject.pathname !== '/' ? urlObject.pathname : '';
			nconf.set('base_url', urlObject.protocol + '//' + urlObject.host);
			nconf.set('secure', urlObject.protocol === 'https:');
			nconf.set('use_port', !!urlObject.port);
			nconf.set('relative_path', relativePath);
			nconf.set('port', urlObject.port || nconf.get('port') || (nconf.get('PORT_ENV_VAR') ? nconf.get(nconf.get('PORT_ENV_VAR')) : false) || 4567);
			nconf.set('upload_path', path.join(nconf.get('base_dir'), nconf.get('upload_path')));
			nconf.set('upload_url', '/assets/uploads');

			nconf.set('core_templates_path', path.join(__dirname, '../../src/views'));
			nconf.set('base_templates_path', path.join(nconf.get('themes_path'), 'nodebb-theme-persona/templates'));
			nconf.set('theme_templates_path', meta.config['theme:templates'] ? path.join(nconf.get('themes_path'), meta.config['theme:id'], meta.config['theme:templates']) : nconf.get('base_templates_path'));
			nconf.set('theme_config', path.join(nconf.get('themes_path'), 'nodebb-theme-persona', 'theme.json'));
			nconf.set('bcrypt_rounds', 1);

			meta.dependencies.check(next);
		},
		function (next) {
			var	webserver = require('../../src/webserver');
			var sockets = require('../../src/socket.io');
			sockets.init(webserver.server);

			require('../../src/notifications').startJobs();
			require('../../src/user').startJobs();

			webserver.listen(next);
		},
	], done);

	// Iterate over all of the test suites/contexts
	this.test.parent.suites.forEach(function (suite) {
		// Attach an afterAll listener that resets the defaults
		suite.afterAll(function (done) {
			setupMockDefaults(done);
		});
	});
});

function setupMockDefaults(callback) {
	var meta = require('../../src/meta');

	async.series([
		function (next) {
			db.emptydb(next);
		},
		function (next) {
			winston.info('test_database flushed');
			setupDefaultConfigs(meta, next);
		},
		function (next) {
			meta.configs.init(next);
		},
		function (next) {
			meta.config.postDelay = 0;
			meta.config.initialPostDelay = 0;
			meta.config.newbiePostDelay = 0;

			enableDefaultPlugins(next);
		},
		function (next) {
			meta.themes.set({
				type: 'local',
				id: 'nodebb-theme-persona',
			}, next);
		},
	], callback);
}
db.setupMockDefaults = setupMockDefaults;

function setupDefaultConfigs(meta, next) {
	winston.info('Populating database with default configs, if not already set...\n');

	var defaults = require(path.join(nconf.get('base_dir'), 'install/data/defaults.json'));

	meta.configs.setOnEmpty(defaults, next);
}

function enableDefaultPlugins(callback) {
	winston.info('Enabling default plugins\n');

	var defaultEnabled = [
		'nodebb-plugin-dbsearch',
		'nodebb-plugin-soundpack-default',
	];

	winston.info('[install/enableDefaultPlugins] activating default plugins', defaultEnabled);

	db.sortedSetAdd('plugins:active', Object.keys(defaultEnabled), defaultEnabled, callback);
}

db.activatePlugin = function (id, callback) {
	db.sortedSetAdd('plugins:active', Date.now(), id, callback);
};
