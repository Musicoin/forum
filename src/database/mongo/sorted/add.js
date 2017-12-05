'use strict';

module.exports = function (db, module) {
	var helpers = module.helpers.mongo;

	module.sortedSetAdd = function (key, score, value, callback) {
		callback = callback || helpers.noop;
		if (!key) {
			return callback();
		}
		if (Array.isArray(score) && Array.isArray(value)) {
			return sortedSetAddBulk(key, score, value, callback);
		}

		value = helpers.valueToString(value);

		db.collection('objects').update({ _key: key, value: value }, { $set: { score: parseFloat(score) } }, { upsert: true, w: 1 }, function (err) {
			if (err && err.message.startsWith('E11000 duplicate key error')) {
				return process.nextTick(module.sortedSetAdd, key, score, value, callback);
			}
			callback(err);
		});
	};

	function sortedSetAddBulk(key, scores, values, callback) {
		if (!scores.length || !values.length) {
			return callback();
		}
		if (scores.length !== values.length) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		values = values.map(helpers.valueToString);

		var bulk = db.collection('objects').initializeUnorderedBulkOp();

		for (var i = 0; i < scores.length; i += 1) {
			bulk.find({ _key: key, value: values[i] }).upsert().updateOne({ $set: { score: parseFloat(scores[i]) } });
		}

		bulk.execute(function (err) {
			callback(err);
		});
	}

	module.sortedSetsAdd = function (keys, score, value, callback) {
		callback = callback || helpers.noop;
		if (!Array.isArray(keys) || !keys.length) {
			return callback();
		}
		value = helpers.valueToString(value);

		var bulk = db.collection('objects').initializeUnorderedBulkOp();

		for (var i = 0; i < keys.length; i += 1) {
			bulk.find({ _key: keys[i], value: value }).upsert().updateOne({ $set: { score: parseFloat(score) } });
		}

		bulk.execute(function (err) {
			callback(err);
		});
	};
};
